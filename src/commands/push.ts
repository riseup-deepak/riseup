import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CircleApiError, CircleClient } from '../circle/client.js';
import { createPost, type PostStatus } from '../circle/posts.js';
import { listSpaces } from '../circle/spaces.js';
import { loadConfig, requireToken, resolveSpaceId } from '../config.js';
import { readDocument, readStdin, parseDocument } from '../content/document.js';
import {
  ask,
  bold,
  cyan,
  dim,
  excerpt,
  failure,
  field,
  heading,
  info,
  isInteractive,
  success,
  warn,
} from '../ui.js';

export interface PushOptions {
  file?: string;
  /** Push every .md in this folder, ordered by publish_at then filename. */
  dir?: string;
  stdin: boolean;
  space?: string;
  /** Explicit status from --publish / --draft. Undefined means "decide later". */
  status?: PostStatus;
  yes: boolean;
  dryRun: boolean;
  verbose: boolean;
}

export async function push(opts: PushOptions): Promise<number> {
  // A folder is a batch of single pushes sharing one preview and one
  // confirmation. Everything is parsed up front, so a bad file stops the run
  // before anything reaches Circle.
  if (opts.dir) return pushDirectory(opts);

  const config = loadConfig();

  const source = opts.stdin
    ? parseDocument(await readStdin(), '<stdin>')
    : readDocument(opts.file!);

  const spaceId = resolveSpaceId(config, opts.space ?? source.space);
  const commentsEnabled = source.commentsEnabled ?? config.defaults.commentsEnabled;
  const likingEnabled = source.likingEnabled ?? config.defaults.likingEnabled;

  const token = opts.dryRun ? (process.env.CIRCLE_API_TOKEN ?? 'dry-run') : requireToken();
  const client = new CircleClient({ config, token, dryRun: opts.dryRun, verbose: opts.verbose });

  // Resolve the space to a human name so the preview shows where this lands.
  let spaceLabel = `id ${spaceId}`;
  if (!opts.dryRun) {
    try {
      const match = (await listSpaces(client)).find((s) => s.id === spaceId);
      if (match) spaceLabel = `${match.name} ${dim(`(id ${spaceId})`)}`;
    } catch {
      // Non-fatal: the create call below will surface any real auth problem.
    }
  }

  // --- Pre-flight preview -------------------------------------------------
  heading('About to post to Circle');
  field('community', config.community);
  field('space', spaceLabel);
  field('title', bold(source.title));
  field('length', `${source.words} words`);
  field('comments', commentsEnabled ? 'enabled' : 'disabled');
  field('liking', likingEnabled ? 'enabled' : 'disabled');
  if (source.source) field('source', dim(source.source));
  if (source.publishAt) field('publish at', source.publishAt);

  info('');
  info(excerpt(source.text));

  if (source.warnings.length) {
    info('');
    for (const w of source.warnings) warn(w);
  }

  // --- Decide draft vs published -----------------------------------------
  let status = opts.status ?? source.status;
  if (!status && !opts.yes) {
    info('');
    const answer = await ask(
      `${bold('Publish live, save as draft, or cancel?')} [${cyan('p')}ublish / ${cyan('d')}raft / ${cyan('c')}ancel]`,
      { p: 'published', publish: 'published', d: 'draft', draft: 'draft', c: 'cancel', cancel: 'cancel', '': 'cancel' },
    );
    if (answer === null) {
      failure(
        'No status given and this is not an interactive terminal.\n' +
          'Pass --draft or --publish (and --yes to skip confirmation).',
      );
      return 1;
    }
    if (answer === 'cancel') {
      info(dim('Cancelled. Nothing was sent.'));
      return 130;
    }
    status = answer as PostStatus;
  }
  if (!status) {
    failure('No status resolved. Pass --draft, --publish or --schedule.');
    return 1;
  }
  if (status === 'scheduled' && !source.publishAt) {
    failure(
      `${opts.file ?? '<stdin>'}: --schedule needs a "publish_at" in the frontmatter.\n` +
        'Use an ISO-8601 time with an explicit offset, e.g. 2026-09-08T09:00:00-05:00.',
    );
    return 1;
  }

  // --- Confirm ------------------------------------------------------------
  if (!opts.yes && !opts.dryRun) {
    const verb = status === 'published'
      ? `${bold('PUBLISH LIVE')} to your community`
      : status === 'scheduled'
        ? `${bold('SCHEDULE')} to go live at ${source.publishAt}`
        : 'save as a draft';
    const answer = await ask(`\nConfirm — ${verb}? [${cyan('y')}/${cyan('N')}]`, {
      y: 'yes', yes: 'yes', n: 'no', no: 'no', '': 'no',
    });
    if (answer === null) {
      failure('Not an interactive terminal — pass --yes to confirm non-interactively.');
      return 1;
    }
    if (answer !== 'yes') {
      info(dim('Cancelled. Nothing was sent.'));
      return 130;
    }
  }

  // --- Send ---------------------------------------------------------------
  try {
    const created = await createPost(client, config.apiVersion, {
      spaceId,
      title: source.title,
      html: source.html,
      tiptap: source.tiptap,
      status,
      commentsEnabled,
      likingEnabled,
      publishedAt: source.publishAt,
    });

    if (opts.dryRun) {
      info('');
      success('Dry run complete — nothing was sent to Circle.');
      return 0;
    }

    info('');
    success(
      status === 'published'
        ? `Published "${source.title}"`
        : status === 'scheduled'
          ? `Scheduled "${source.title}" for ${source.publishAt}`
          : `Saved "${source.title}" as a draft`,
    );
    if (created.url) info(`  ${cyan(created.url)}`);
    else if (created.id) info(dim(`  post id ${created.id}`));
    if (status === 'draft') {
      info(dim('  Open it in Circle to review and publish.'));
    }
    return 0;
  } catch (err) {
    if (err instanceof CircleApiError) {
      failure(err.message);
      if (err.hint) info(`\n${err.hint}`);
      if (err.status === 422) {
        info(
          dim(
            '\nIf a field name is wrong, fix buildCreatePostPayload() in src/circle/posts.ts\n' +
              'and re-check with --dry-run. That function is the only place the payload is built.',
          ),
        );
      }
      return 1;
    }
    throw err;
  }
}


/**
 * Push every markdown file in a folder.
 *
 * The whole batch is parsed and previewed before anything is sent, and there is
 * one confirmation for the run rather than one per post. A file that fails to
 * parse, or a scheduled post with no publish_at, stops the batch before the
 * first request. If a later post fails against Circle, the run stops there and
 * reports which files already went through, so a retry can start from the right
 * place instead of duplicating posts.
 */
async function pushDirectory(opts: PushOptions): Promise<number> {
  const config = loadConfig();

  const files = readdirSync(opts.dir!)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => join(opts.dir!, f));

  if (files.length === 0) {
    failure(`No .md files in ${opts.dir}`);
    return 1;
  }

  const docs = files.map((file) => ({ file, doc: readDocument(file) }));

  const status = opts.status;
  if (!status) {
    failure('A batch needs an explicit --draft, --publish or --schedule.');
    return 1;
  }

  const missing = docs.filter((d) => status === 'scheduled' && !d.doc.publishAt);
  if (missing.length) {
    failure(`${missing.length} file(s) have no "publish_at" and cannot be scheduled:`);
    for (const m of missing) info(`  ${m.file}`);
    return 1;
  }

  heading(`About to push ${docs.length} posts to Circle`);
  field('community', config.community);
  field('status', status);
  info('');
  for (const { doc } of docs) {
    const when = doc.publishAt ? dim(`  ${doc.publishAt}`) : '';
    info(`  ${bold(doc.title)}${when}`);
  }

  const warnings = docs.flatMap((d) => d.doc.warnings.map((w) => `${d.file}: ${w}`));
  if (warnings.length) {
    info('');
    for (const w of warnings) warn(w);
  }

  if (!opts.yes && !opts.dryRun) {
    const verb = status === 'published' ? `${bold('PUBLISH ALL OF THESE LIVE')}` : `save all of these as ${status}`;
    const answer = await ask(`\nConfirm — ${verb}? [${cyan('y')}/${cyan('N')}]`, {
      y: 'yes', yes: 'yes', n: 'no', no: 'no', '': 'no',
    });
    if (answer === null) {
      failure('Not an interactive terminal — pass --yes to confirm non-interactively.');
      return 1;
    }
    if (answer !== 'yes') {
      info(dim('Cancelled. Nothing was sent.'));
      return 130;
    }
  }

  const token = opts.dryRun ? (process.env.CIRCLE_API_TOKEN ?? 'dry-run') : requireToken();
  const client = new CircleClient({ config, token, dryRun: opts.dryRun, verbose: opts.verbose });

  const done: string[] = [];
  for (const { file, doc } of docs) {
    const spaceId = resolveSpaceId(config, opts.space ?? doc.space);
    try {
      const created = await createPost(client, config.apiVersion, {
        spaceId,
        title: doc.title,
        html: doc.html,
        tiptap: doc.tiptap,
        status,
        commentsEnabled: doc.commentsEnabled ?? config.defaults.commentsEnabled,
        likingEnabled: doc.likingEnabled ?? config.defaults.likingEnabled,
        publishedAt: doc.publishAt,
      });
      done.push(doc.title);
      if (!opts.dryRun) {
        success(`${done.length}/${docs.length}  ${doc.title}`);
        if (created.url) info(dim(`     ${created.url}`));
      }
    } catch (err) {
      failure(`Stopped at ${file}`);
      if (err instanceof CircleApiError) {
        failure(err.message);
        if (err.hint) info(`\n${err.hint}`);
      } else {
        failure((err as Error).message);
      }
      info('');
      info(`${done.length} post(s) were created before this failure:`);
      for (const t of done) info(dim(`  ${t}`));
      info('');
      info(dim('Remove those files from the folder before retrying, or you will create them twice.'));
      return 1;
    }
  }

  info('');
  success(
    opts.dryRun
      ? `Dry run complete — ${docs.length} posts checked, nothing was sent.`
      : `Done. ${docs.length} posts ${status === 'scheduled' ? 'scheduled' : status}.`,
  );
  return 0;
}
