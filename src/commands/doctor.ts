import { existsSync } from 'node:fs';
import { CircleClient, CircleApiError, baseUrlFor } from '../circle/client.js';
import { listSpaces } from '../circle/spaces.js';
import { CONFIG_PATH, loadConfig, resolveSpaceId } from '../config.js';
import { bold, cyan, dim, failure, field, heading, info, success, warn } from '../ui.js';

/**
 * End-to-end check of everything a push depends on. Run this first — it is the
 * only command that talks to Circle without changing anything.
 */
export async function doctor(): Promise<number> {
  const config = loadConfig();

  heading('Configuration');
  field('community', config.community);
  field('api version', config.apiVersion);
  field('base url', baseUrlFor(config));
  field('config file', existsSync(CONFIG_PATH) ? CONFIG_PATH : dim('(defaults — no circle.config.json yet)'));
  field('aliases', Object.keys(config.spaces).length
    ? Object.keys(config.spaces).join(', ')
    : dim('(none — run `circle spaces --save`)'));

  heading('Token');
  const token = process.env.CIRCLE_API_TOKEN?.trim();
  if (!token) {
    failure('CIRCLE_API_TOKEN is not set.');
    info('');
    info(`  1. In Circle, go to ${cyan('Settings -> Developers -> Tokens')}`);
    info(`  2. Create a token of type ${bold(config.apiVersion === 'v1' ? 'Admin API V1' : 'Admin API V2')}`);
    info('  3. Copy .env.example to .env and paste it in as CIRCLE_API_TOKEN');
    return 1;
  }
  field('token', `${token.slice(0, 4)}...${token.slice(-4)} (${token.length} chars)`);

  heading('Connection');
  const client = new CircleClient({ config, token });
  let spaces;
  try {
    spaces = await listSpaces(client);
  } catch (err) {
    if (err instanceof CircleApiError) {
      failure(`${err.status} from ${baseUrlFor(config)}/spaces`);
      info(dim(err.body.slice(0, 400)));
      if (err.hint) info(`\n${err.hint}`);
    } else {
      failure((err as Error).message);
      info(
        dim(
          '\nIf this is a network/TLS error, confirm this machine can reach app.circle.so.',
        ),
      );
    }
    return 1;
  }

  success(`Authenticated. Found ${spaces.length} space${spaces.length === 1 ? '' : 's'}.`);

  heading('Default space');
  if (!config.defaultSpace) {
    warn('No defaultSpace set — every push will need --space.');
  } else {
    try {
      const id = resolveSpaceId(config, undefined);
      const match = spaces.find((s) => s.id === id);
      if (match) {
        success(`"${config.defaultSpace}" resolves to ${match.name} (id ${id}).`);
      } else {
        warn(`"${config.defaultSpace}" resolves to id ${id}, which is not in your space list.`);
      }
    } catch (err) {
      warn((err as Error).message);
    }
  }

  info('');
  info(dim('Next: `circle spaces --save` to record space aliases, then'));
  info(dim('      `circle push --file content/example-post.md --dry-run`.'));
  return 0;
}
