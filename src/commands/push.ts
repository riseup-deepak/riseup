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
  stdin: boolean;
  space?: string;
  /** Explicit status from --publish / --draft. Undefined means "decide later". */
  status?: PostStatus;
  yes: boolean;
  dryRun: boolean;
  verbose: boolean;
}

export async function push(opts: PushOptions): Promise<number> {
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
    failure('No status resolved. Pass --draft or --publish.');
    return 1;
  }

  // --- Confirm ------------------------------------------------------------
  if (!opts.yes && !opts.dryRun) {
    const verb = status === 'published'
      ? `${bold('PUBLISH LIVE')} to your community`
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
