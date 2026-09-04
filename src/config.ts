import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root, resolved relative to this file so the CLI works from any cwd. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export type ApiVersion = 'v1' | 'v2';

export interface CircleConfig {
  /** Your community host, e.g. "riseupatwork.circle.so". Informational. */
  community: string;
  /** Which Admin API to talk to. v2 is the one Circle actively develops. */
  apiVersion: ApiVersion;
  /** Overrides the derived API base URL. Only needed if Circle moves hosts. */
  baseUrl?: string;
  /** Space alias used when --space is omitted. */
  defaultSpace?: string | null;
  /** Friendly alias -> numeric Circle space id. Populate with `circle spaces`. */
  spaces: Record<string, number>;
  defaults: {
    commentsEnabled: boolean;
    likingEnabled: boolean;
  };
}

const DEFAULT_CONFIG: CircleConfig = {
  community: 'riseupatwork.circle.so',
  apiVersion: 'v2',
  defaultSpace: null,
  spaces: {},
  defaults: { commentsEnabled: true, likingEnabled: true },
};

export const CONFIG_PATH = resolve(REPO_ROOT, 'circle.config.json');

export function loadConfig(): CircleConfig {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    throw new Error(
      `circle.config.json is not valid JSON: ${(err as Error).message}`,
    );
  }
  const raw = parsed as Partial<CircleConfig>;
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    spaces: { ...DEFAULT_CONFIG.spaces, ...(raw.spaces ?? {}) },
    defaults: { ...DEFAULT_CONFIG.defaults, ...(raw.defaults ?? {}) },
  };
}

/**
 * Minimal .env reader so the token never has to live in shell history.
 * Real environment variables win over the file.
 */
export function loadEnvFile(): void {
  const envPath = resolve(REPO_ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function requireToken(): string {
  const token = process.env.CIRCLE_API_TOKEN?.trim();
  if (!token) {
    throw new Error(
      'CIRCLE_API_TOKEN is not set.\n' +
        '  1. In Circle: Settings -> Developers -> Tokens -> new token (type: Admin API V2)\n' +
        '  2. Copy .env.example to .env and paste the token in.\n' +
        '  3. Re-run `npm run circle -- doctor`.',
    );
  }
  return token;
}

/** Resolve a space alias or a raw numeric id to a numeric Circle space id. */
export function resolveSpaceId(
  config: CircleConfig,
  space: string | undefined,
): number {
  const alias = space ?? config.defaultSpace ?? undefined;
  if (!alias) {
    throw new Error(
      'No space given. Pass --space <alias-or-id>, or set "defaultSpace" in circle.config.json.\n' +
        'Run `circle spaces` to list the spaces in your community.',
    );
  }
  if (/^\d+$/.test(alias)) return Number(alias);
  const id = config.spaces[alias];
  if (id === undefined) {
    const known = Object.keys(config.spaces);
    throw new Error(
      `Unknown space alias "${alias}".` +
        (known.length
          ? ` Known aliases: ${known.join(', ')}`
          : ' No aliases configured yet — run `circle spaces --save` to populate circle.config.json.'),
    );
  }
  return id;
}
