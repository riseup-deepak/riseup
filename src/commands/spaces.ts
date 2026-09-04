import { writeFileSync } from 'node:fs';
import { CircleClient } from '../circle/client.js';
import { aliasFor, listSpaces } from '../circle/spaces.js';
import { CONFIG_PATH, loadConfig, requireToken } from '../config.js';
import { bold, dim, heading, info, success } from '../ui.js';

export async function spaces(opts: { save: boolean; json: boolean }): Promise<number> {
  const config = loadConfig();
  const client = new CircleClient({ config, token: requireToken() });
  const found = await listSpaces(client);

  if (opts.json) {
    info(JSON.stringify(found, null, 2));
    return 0;
  }

  if (found.length === 0) {
    info('No spaces returned. Check that the token has admin access to the community.');
    return 1;
  }

  heading(`Spaces in ${config.community}`);
  const width = Math.max(...found.map((s) => aliasFor(s).length));
  for (const space of found) {
    const group = space.spaceGroup ? dim(`  (${space.spaceGroup})`) : '';
    info(`  ${bold(aliasFor(space).padEnd(width))}  ${String(space.id).padStart(7)}  ${space.name}${group}`);
  }

  if (opts.save) {
    const merged = { ...config.spaces };
    for (const space of found) merged[aliasFor(space)] = space.id;
    const next = { ...config, spaces: merged };
    writeFileSync(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    info('');
    success(`Wrote ${Object.keys(merged).length} aliases to circle.config.json`);
    info(dim('Set "defaultSpace" to one of them to skip --space on every push.'));
  } else {
    info('');
    info(dim('Re-run with --save to write these aliases into circle.config.json.'));
  }
  return 0;
}
