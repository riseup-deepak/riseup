#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { loadEnvFile } from './config.js';
import { doctor } from './commands/doctor.js';
import { spaces } from './commands/spaces.js';
import { posts as postsCommand } from './commands/posts.js';
import { reschedule } from './commands/reschedule.js';
import { push, type PushOptions } from './commands/push.js';
import { bold, dim, failure, info } from './ui.js';

const USAGE = `
${bold('circle')} — publish RISEUP@work posts and notes to Circle

${bold('Usage')}
  circle doctor                         Check token, config and connectivity
  circle spaces [--save] [--json]       List spaces; --save records aliases
  circle posts [--space <a>] [--status]  List posts by id and flag duplicates
  circle reschedule --file <plan.csv>   Move scheduled posts to new times
  circle push --file <post.md> [opts]   Push a markdown post to Circle
  circle push --dir <folder> [opts]     Push every .md in a folder, in date order
  circle push --stdin [opts]            Read the post from stdin

${bold('Posts options')}
  --space <alias|id>   Only this space. Omit for every space.
  --status <s>         all (default), draft, published or scheduled.
  --json               Print the raw result.

${bold('Reschedule options')}
  --file <plan.csv>    Rows of id,published_at[,label[,note]]. Header optional.
  --limit <n>          Only the first n rows. Use it to test on one post.
  --skip-published     Leave rows that already published alone, move the rest.
  --dry-run            Print what would change, send nothing.
  --yes                Skip the confirmation prompt.

${bold('Push options')}
  --space <alias|id>   Target space. Defaults to frontmatter, then defaultSpace.
  --publish            Publish live (skips the draft/publish question).
  --draft              Save as a draft.
  --schedule           Schedule for the frontmatter publish_at time.
  --yes                Skip the confirmation prompt. Requires --publish or --draft.
  --dry-run            Print the exact request that would be sent, send nothing.
  --verbose            Log each HTTP request.

${bold('Post format')}
  Markdown with YAML frontmatter:

    ---
    title: Your post title
    space: from-dr-deepak-s-desk
    comments: true
    publish_at: 2026-09-08T09:00:00-05:00
    source: https://docs.google.com/document/d/...
    ---

    Body in **markdown**.

${dim('Config lives in circle.config.json; the token in .env (CIRCLE_API_TOKEN).')}
`;

async function main(): Promise<number> {
  loadEnvFile();

  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      file: { type: 'string', short: 'f' },
      dir: { type: 'string', short: 'd' },
      space: { type: 'string', short: 's' },
      stdin: { type: 'boolean', default: false },
      publish: { type: 'boolean', default: false },
      draft: { type: 'boolean', default: false },
      schedule: { type: 'boolean', default: false },
      yes: { type: 'boolean', short: 'y', default: false },
      'dry-run': { type: 'boolean', default: false },
      'skip-published': { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
      save: { type: 'boolean', default: false },
      status: { type: 'string' },
      limit: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  const command = positionals[0];

  if (values.help || !command || command === 'help') {
    info(USAGE);
    return command || values.help ? 0 : 1;
  }

  switch (command) {
    case 'doctor':
      return doctor();

    case 'spaces':
      return spaces({ save: values.save, json: values.json });

    case 'posts':
      return postsCommand({
        space: values.space,
        status: values.status,
        json: values.json,
        verbose: values.verbose,
      });

    case 'reschedule': {
      let limit: number | undefined;
      if (values.limit !== undefined) {
        limit = Number(values.limit);
        if (!Number.isInteger(limit) || limit < 1) {
          failure('--limit needs a whole number of 1 or more.');
          return 1;
        }
      }
      return reschedule({
        file: values.file,
        limit,
        skipPublished: values['skip-published'],
        yes: values.yes,
        dryRun: values['dry-run'],
        verbose: values.verbose,
      });
    }

    case 'push': {
      const chosen = [values.publish, values.draft, values.schedule].filter(Boolean).length;
      if (chosen > 1) {
        failure('--publish, --draft and --schedule are mutually exclusive.');
        return 1;
      }
      const sources = [values.file, values.dir, values.stdin].filter(Boolean).length;
      if (sources === 0) {
        failure('Nothing to push. Pass --file <post.md>, --dir <folder>, or --stdin.');
        return 1;
      }
      if (sources > 1) {
        failure('--file, --dir and --stdin are mutually exclusive.');
        return 1;
      }
      if (values.yes && chosen === 0) {
        failure('--yes needs an explicit --publish, --draft or --schedule, so the status is never guessed.');
        return 1;
      }
      const opts: PushOptions = {
        file: values.file,
        dir: values.dir,
        stdin: values.stdin,
        space: values.space,
        status: values.publish
          ? 'published'
          : values.draft
            ? 'draft'
            : values.schedule
              ? 'scheduled'
              : undefined,
        yes: values.yes,
        dryRun: values['dry-run'],
        verbose: values.verbose,
      };
      return push(opts);
    }

    default:
      failure(`Unknown command "${command}".`);
      info(USAGE);
      return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    failure((err as Error).message);
    if (process.env.CIRCLE_DEBUG) console.error(err);
    process.exit(1);
  });
