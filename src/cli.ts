#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { loadEnvFile } from './config.js';
import { doctor } from './commands/doctor.js';
import { spaces } from './commands/spaces.js';
import { push, type PushOptions } from './commands/push.js';
import { bold, dim, failure, info } from './ui.js';

const USAGE = `
${bold('circle')} — publish RISEUP@work posts and notes to Circle

${bold('Usage')}
  circle doctor                         Check token, config and connectivity
  circle spaces [--save] [--json]       List spaces; --save records aliases
  circle push --file <post.md> [opts]   Push a markdown post to Circle
  circle push --stdin [opts]            Read the post from stdin

${bold('Push options')}
  --space <alias|id>   Target space. Defaults to frontmatter, then defaultSpace.
  --publish            Publish live (skips the draft/publish question).
  --draft              Save as a draft.
  --yes                Skip the confirmation prompt. Requires --publish or --draft.
  --dry-run            Print the exact request that would be sent, send nothing.
  --verbose            Log each HTTP request.

${bold('Post format')}
  Markdown with YAML frontmatter:

    ---
    title: Your post title
    space: announcements
    comments: true
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
      space: { type: 'string', short: 's' },
      stdin: { type: 'boolean', default: false },
      publish: { type: 'boolean', default: false },
      draft: { type: 'boolean', default: false },
      yes: { type: 'boolean', short: 'y', default: false },
      'dry-run': { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
      save: { type: 'boolean', default: false },
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

    case 'push': {
      if (values.publish && values.draft) {
        failure('--publish and --draft are mutually exclusive.');
        return 1;
      }
      if (!values.file && !values.stdin) {
        failure('Nothing to push. Pass --file <post.md> or --stdin.');
        return 1;
      }
      if (values.file && values.stdin) {
        failure('--file and --stdin are mutually exclusive.');
        return 1;
      }
      if (values.yes && !values.publish && !values.draft) {
        failure('--yes needs an explicit --publish or --draft, so the status is never guessed.');
        return 1;
      }
      const opts: PushOptions = {
        file: values.file,
        stdin: values.stdin,
        space: values.space,
        status: values.publish ? 'published' : values.draft ? 'draft' : undefined,
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
