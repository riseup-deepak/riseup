import type { CircleClient } from './client.js';

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
  const payload = await client.request<unknown>('/spaces', {
    query: { per_page: 100 },
  });
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
