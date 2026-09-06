import { CircleApiError, type CircleClient } from './client.js';

export interface CircleSpace {
  id: number;
  name: string;
  slug?: string;
  spaceGroup?: string;
}

/**
 * Circle has returned list payloads as a bare array, as `{records: []}` and as
 * `{data: []}` across API versions. Accept all three rather than guessing.
 */
function unwrapList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const key of ['records', 'data', 'spaces', 'results']) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
  }
  return [];
}

function toSpace(raw: unknown): CircleSpace | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const id = Number(obj.id);
  if (!Number.isFinite(id)) return null;
  const group = obj.space_group as Record<string, unknown> | undefined;
  return {
    id,
    name: String(obj.name ?? obj.slug ?? `space-${id}`),
    slug: obj.slug === undefined ? undefined : String(obj.slug),
    spaceGroup:
      group && typeof group === 'object' && group.name !== undefined
        ? String(group.name)
        : undefined,
  };
}

export async function listSpaces(client: CircleClient): Promise<CircleSpace[]> {
  let payload: unknown;
  try {
    payload = await client.request<unknown>('/spaces', { query: { per_page: 100 } });
  } catch (err) {
    // Checked against the Admin API V2 OpenAPI spec on 2026-09-05: under
    // /api/admin/v2/spaces only POST (Create Space) is defined. There is
    // Show / Update / Delete for a single space, but no list endpoint at all.
    // So a 404 here is a documented gap, not a wrong path — say so, rather
    // than letting it read as a broken URL.
    if (err instanceof CircleApiError && err.status === 404) {
      throw new Error(
        'Circle has no "list spaces" endpoint in the Admin API V2 — the V2 spec defines\n' +
          'only create / show / update / delete for spaces. Two ways round it:\n' +
          '  a) Use a V1 token and set "apiVersion": "v1" in circle.config.json. V1 does\n' +
          '     have GET /api/v1/spaces, and posting still works.\n' +
          '  b) Stay on V2 and fill in "spaces" by hand in circle.config.json. A space id\n' +
          '     is the number in the space\'s admin URL in Circle.\n' +
          'Pushing a post does not need this listing — only `doctor` and `spaces` do.',
      );
    }
    throw err;
  }
  return unwrapList(payload)
    .map(toSpace)
    .filter((s): s is CircleSpace => s !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Turn a space name into a stable, typo-resistant config alias. */
export function aliasFor(space: CircleSpace): string {
  const source = space.slug ?? space.name;
  return source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
