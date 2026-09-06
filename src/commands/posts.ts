import { CircleClient } from '../circle/client.js';
import { findDuplicates, listPosts } from '../circle/posts.js';
import { loadConfig, requireToken, resolveSpaceId } from '../config.js';
import { bold, cyan, dim, failure, field, heading, info, success, warn } from '../ui.js';

export interface PostsOptions {
  space?: string;
  status?: string;
  json: boolean;
  verbose: boolean;
}

const STATUSES = ['all', 'draft', 'published', 'scheduled'];

/**
 * Read-only listing. Its job is to answer "how many of these are actually
 * there", which the admin web table cannot do reliably when many posts share a
 * publish time. See the note on listPosts().
 */
export async function posts(opts: PostsOptions): Promise<number> {
  const config = loadConfig();

  const status = (opts.status ?? 'all').toLowerCase();
  if (!STATUSES.includes(status)) {
    failure(`Unknown status "${opts.status}". Use one of: ${STATUSES.join(', ')}`);
    return 1;
  }

  let spaceId: number | undefined;
  if (opts.space) spaceId = resolveSpaceId(config, opts.space);

  const client = new CircleClient({ config, token: requireToken(), verbose: opts.verbose });
  const result = await listPosts(client, { spaceId, status });

  if (opts.json) {
    info(JSON.stringify(result, null, 2));
    return 0;
  }

  heading(`Posts in ${config.community}`);
  field('space', opts.space ? `${opts.space} (id ${spaceId})` : dim('(all spaces)'));
  field('status', status);
  field('unique posts', String(result.posts.length));
  if (result.apiCount !== undefined) field('count from Circle', String(result.apiCount));
  field('rows returned', `${result.rowsReturned} across ${result.pagesFetched} page(s)`);

  if (result.posts.length === 0) {
    info('');
    info('Nothing matched.');
    return 0;
  }

  const width = Math.max(...result.posts.map((p) => String(p.id).length));
  info('');
  for (const p of result.posts) {
    const when = p.publishedAt ? p.publishedAt.replace('T', ' ').slice(0, 16) : dim('unscheduled');
    const space = opts.space ? '' : dim(`  ${p.spaceName ?? `space ${p.spaceId}`}`);
    info(`  ${dim(String(p.id).padStart(width))}  ${when}  ${p.name}${space}`);
  }

  // A repeated id means Circle handed the same record back twice while paging.
  // That is the thing that makes the web table look like it has duplicates.
  if (result.repeatedIds.length) {
    info('');
    warn(
      `Circle returned ${result.repeatedIds.length} id(s) on more than one page: ` +
        `${result.repeatedIds.join(', ')}.`,
    );
    info(dim('  That is paging over tied publish times, not a duplicate post.'));
    info(dim('  Counted once here. It is why the admin table can show a post twice.'));
  }

  const dupes = findDuplicates(result.posts);
  info('');
  if (dupes.length === 0) {
    success('No duplicates. Every post is a distinct record with its own id.');
  } else {
    const extra = dupes.reduce((n, g) => n + g.length - 1, 0);
    failure(`${dupes.length} duplicate group(s), ${extra} extra post(s) to remove.`);
    info('');
    for (const group of dupes) {
      const first = group[0]!;
      info(`  ${bold(first.name)}`);
      info(dim(`  ${first.publishedAt ?? 'unscheduled'} in ${first.spaceName ?? 'unknown space'}`));
      for (const p of group) {
        info(`    id ${cyan(String(p.id))}${p.url ? dim(`  ${p.url}`) : ''}`);
      }
      info(dim('    Keep one. Delete the rest in Circle.'));
      info('');
    }
  }

  return 0;
}
