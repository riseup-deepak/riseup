import { readFileSync } from 'node:fs';
import { CircleApiError, CircleClient } from '../circle/client.js';
import { listPosts, updatePublishedAt, type CirclePost } from '../circle/posts.js';
import { loadConfig, requireToken } from '../config.js';
import { ask, bold, cyan, dim, failure, field, heading, info, success, warn } from '../ui.js';

export interface RescheduleOptions {
  file?: string;
  limit?: number;
  skipPublished: boolean;
  yes: boolean;
  dryRun: boolean;
  verbose: boolean;
}

interface Move {
  id: number;
  publishedAt: string;
  label: string;
  note: string;
}

/**
 * Read a plan of id,published_at pairs. A header row is optional, and any
 * further columns are treated as notes for the preview only.
 */
function readPlan(path: string): Move[] {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const moves: Move[] = [];
  for (const [i, line] of lines.entries()) {
    const cells = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const id = Number(cells[0]);
    if (!Number.isFinite(id)) {
      if (i === 0) continue; // header
      throw new Error(`${path} line ${i + 1}: "${cells[0]}" is not a post id.`);
    }
    const publishedAt = cells[1] ?? '';
    const when = new Date(publishedAt);
    if (Number.isNaN(when.getTime())) {
      throw new Error(
        `${path} line ${i + 1}: "${publishedAt}" is not a readable time. ` +
          'Use ISO-8601, e.g. 2026-09-07T07:00:00.000Z',
      );
    }
    moves.push({
      id,
      publishedAt: when.toISOString(),
      label: cells[2] ?? '',
      note: cells[3] ?? '',
    });
  }

  const seen = new Set<number>();
  for (const m of moves) {
    if (seen.has(m.id)) throw new Error(`${path}: post ${m.id} appears more than once.`);
    seen.add(m.id);
  }
  if (moves.length === 0) throw new Error(`${path} has no rows.`);
  return moves;
}

/**
 * Move scheduled posts to new times from a plan file.
 *
 * Every id in the plan is checked against Circle before anything is written, so
 * a wrong id or an already published post stops the run at the start rather
 * than halfway through.
 */
export async function reschedule(opts: RescheduleOptions): Promise<number> {
  const config = loadConfig();
  if (!opts.file) {
    failure('Nothing to do. Pass --file <plan.csv> with id,published_at rows.');
    return 1;
  }

  let moves = readPlan(opts.file);
  if (opts.limit !== undefined) moves = moves.slice(0, opts.limit);

  const token = opts.dryRun ? (process.env.CIRCLE_API_TOKEN ?? 'dry-run') : requireToken();
  const client = new CircleClient({ config, token, dryRun: opts.dryRun, verbose: opts.verbose });

  // Look the posts up first. Read only, and it catches the expensive mistakes.
  let current = new Map<number, CirclePost>();
  if (!opts.dryRun) {
    const live = await listPosts(client, { status: 'all' });
    current = new Map(live.posts.map((p) => [p.id, p]));

    const missing = moves.filter((m) => !current.has(m.id));
    if (missing.length) {
      failure(`${missing.length} post(s) in the plan do not exist in Circle:`);
      for (const m of missing) info(`  ${m.id}  ${m.label}`);
      info('');
      info(dim('Nothing was changed. Fix the plan and run again.'));
      return 1;
    }

    const notScheduled = moves.filter((m) => current.get(m.id)!.status !== 'scheduled');
    if (notScheduled.length && !opts.skipPublished) {
      failure(`${notScheduled.length} post(s) are not scheduled, so moving them makes no sense:`);
      for (const m of notScheduled) {
        info(`  ${m.id}  ${current.get(m.id)!.status.padEnd(10)} ${m.label}`);
      }
      info('');
      info(dim('Nothing was changed. Remove those rows from the plan,'));
      info(dim('or pass --skip-published to leave them where they are and move the rest.'));
      return 1;
    }
    if (notScheduled.length) {
      warn(`Skipping ${notScheduled.length} post(s) that are no longer scheduled:`);
      for (const m of notScheduled) {
        info(`  ${m.id}  ${current.get(m.id)!.status.padEnd(10)} ${m.label}`);
      }
      info('');
      const skip = new Set(notScheduled.map((m) => m.id));
      moves = moves.filter((m) => !skip.has(m.id));
      if (moves.length === 0) {
        failure('That leaves nothing to move.');
        return 1;
      }
    }
  }

  heading(`About to move ${moves.length} scheduled post(s)`);
  field('community', config.community);
  field('plan', opts.file);
  info('');
  for (const m of moves) {
    const from = current.get(m.id)?.publishedAt;
    const arrow = from ? `${dim(from.slice(0, 16).replace('T', ' '))} ${dim('to')} ` : '';
    info(`  ${dim(String(m.id))}  ${arrow}${m.label || m.publishedAt}  ${m.note}`);
  }

  if (!opts.yes && !opts.dryRun) {
    const answer = await ask(
      `\nConfirm — ${bold('move all ' + moves.length)} to these times? [${cyan('y')}/${cyan('N')}]`,
      { y: 'yes', yes: 'yes', n: 'no', no: 'no', '': 'no' },
    );
    if (answer === null) {
      failure('Not an interactive terminal — pass --yes to confirm non-interactively.');
      return 1;
    }
    if (answer !== 'yes') {
      info(dim('Cancelled. Nothing was changed.'));
      return 130;
    }
  }

  const done: Move[] = [];
  for (const m of moves) {
    try {
      await updatePublishedAt(client, m.id, m.publishedAt);
      done.push(m);
      if (!opts.dryRun) success(`${done.length}/${moves.length}  ${m.id}  ${m.label}`);
    } catch (err) {
      failure(`Stopped at post ${m.id}`);
      if (err instanceof CircleApiError) {
        failure(err.message);
        if (err.hint) info(`\n${err.hint}`);
      } else {
        failure((err as Error).message);
      }
      info('');
      info(`${done.length} post(s) were moved before this failure. The rest are unchanged.`);
      if (done.length) {
        info(dim('  Already moved: ' + done.map((d) => d.id).join(', ')));
        info(dim('  Remove those rows from the plan before retrying.'));
      }
      return 1;
    }
  }

  info('');
  success(
    opts.dryRun
      ? `Dry run complete — ${moves.length} move(s) checked, nothing was sent.`
      : `Done. ${moves.length} post(s) moved.`,
  );
  if (!opts.dryRun) {
    info(dim('Check with: circle posts --status scheduled'));
  }
  return 0;
}
