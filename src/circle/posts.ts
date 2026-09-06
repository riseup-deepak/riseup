import type { ApiVersion } from '../config.js';
import type { TipTapDoc } from '../content/tiptap.js';
import type { CircleClient } from './client.js';

export type PostStatus = 'published' | 'draft' | 'scheduled';

export interface CreatePostInput {
  spaceId: number;
  title: string;
  /** Post body as HTML. Used by the v1 API, and for previews. */
  html: string;
  /** Post body as a TipTap document. This is what the v2 API stores. */
  tiptap: TipTapDoc;
  status: PostStatus;
  commentsEnabled: boolean;
  likingEnabled: boolean;
  /**
   * ISO-8601 with an explicit offset, e.g. 2026-09-08T09:00:00-05:00.
   * Required when status is 'scheduled'. Circle publishes at this instant.
   */
  publishedAt?: string;
}

export interface CreatedPost {
  id?: number;
  url?: string;
  status?: string;
  raw: unknown;
}

/**
 * ---------------------------------------------------------------------------
 * PAYLOAD SHAPES — the one place to edit if Circle rejects a create.
 * ---------------------------------------------------------------------------
 * Verified 2026-09-05 against the Admin API V2 OpenAPI spec
 * (https://api-headless.circle.so/api/admin/v2/swagger.yaml, POST
 * /api/admin/v2/posts). Required properties are `space_id` and `name`; the
 * rest below are all in the documented schema.
 *
 * The one correction from the original blind reconstruction: `tiptap_body.body`
 * is a TipTap *document object* (`{type, content}`, both required), not an HTML
 * string. HTML there is what a 422 would have named.
 *
 * To re-check before posting anything for real:
 *     npm run circle -- push --file content/example-post.md --dry-run
 * That prints the exact JSON below and sends nothing.
 */
export function buildCreatePostPayload(
  version: ApiVersion,
  input: CreatePostInput,
): Record<string, unknown> {
  if (version === 'v1') {
    return {
      space_id: input.spaceId,
      name: input.title,
      body: input.html,
      status: input.status,
      is_comments_enabled: input.commentsEnabled,
      is_liking_enabled: input.likingEnabled,
      ...(input.publishedAt ? { published_at: input.publishedAt } : {}),
    };
  }

  // v2 stores rich text as a TipTap document under `tiptap_body.body`.
  return {
    space_id: input.spaceId,
    name: input.title,
    tiptap_body: { body: input.tiptap },
    status: input.status,
    is_comments_enabled: input.commentsEnabled,
    is_liking_enabled: input.likingEnabled,
    ...(input.publishedAt ? { published_at: input.publishedAt } : {}),
  };
}

function readCreated(payload: unknown): CreatedPost {
  const obj =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : {};
  // v2 has wrapped single records under `post` or `data` in places.
  const inner =
    (obj.post as Record<string, unknown> | undefined) ??
    (obj.data as Record<string, unknown> | undefined) ??
    obj;
  const id = Number(inner.id);
  return {
    id: Number.isFinite(id) ? id : undefined,
    url: typeof inner.url === 'string' ? inner.url : undefined,
    status: typeof inner.status === 'string' ? inner.status : undefined,
    raw: payload,
  };
}

export async function createPost(
  client: CircleClient,
  version: ApiVersion,
  input: CreatePostInput,
): Promise<CreatedPost> {
  const payload = await client.request<unknown>('/posts', {
    method: 'POST',
    body: buildCreatePostPayload(version, input),
  });
  return readCreated(payload);
}

export interface CirclePost {
  id: number;
  name: string;
  status: string;
  spaceId?: number;
  spaceName?: string;
  publishedAt?: string;
  url?: string;
  likes?: number;
  comments?: number;
}

export interface ListPostsResult {
  posts: CirclePost[];
  /** Rows the API handed back, before de-duplicating by id. */
  rowsReturned: number;
  /** `count` as reported by Circle, when it sends one. */
  apiCount?: number;
  pagesFetched: number;
  /** Ids Circle returned on more than one page. See the note in listPosts. */
  repeatedIds: number[];
}

function toPost(raw: unknown): CirclePost | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = Number(o.id);
  if (!Number.isFinite(id)) return null;
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
  return {
    id,
    name: String(o.name ?? o.slug ?? `post-${id}`),
    status: String(o.status ?? 'unknown'),
    spaceId: num(o.space_id),
    spaceName: o.space_name === undefined ? undefined : String(o.space_name),
    publishedAt: o.published_at === undefined || o.published_at === null
      ? undefined
      : String(o.published_at),
    url: typeof o.url === 'string' ? o.url : undefined,
    likes: num(o.likes_count),
    comments: num(o.comments_count),
  };
}

/**
 * List posts, de-duplicated by id.
 *
 * Why this exists: Circle's admin web table pages by offset over a sort on
 * published_at, and a space that posts on a fixed timetable has many rows
 * sharing the exact same published_at. With ties, an offset page boundary can
 * hand back the same record at the end of one page and the start of the next,
 * which makes one post look like two. Reading that table is therefore not a
 * safe way to count anything.
 *
 * Ids settle it. Two records mean two different ids. One record served twice
 * means the same id twice, and that id lands in `repeatedIds`.
 */
export async function listPosts(
  client: CircleClient,
  opts: { spaceId?: number; status?: string; perPage?: number; maxPages?: number } = {},
): Promise<ListPostsResult> {
  const perPage = opts.perPage ?? 100;
  const maxPages = opts.maxPages ?? 50;
  const byId = new Map<number, CirclePost>();
  const seen = new Set<number>();
  const repeated = new Set<number>();
  let rowsReturned = 0;
  let apiCount: number | undefined;
  let pagesFetched = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await client.request<unknown>('/posts', {
      query: {
        page,
        per_page: perPage,
        status: opts.status ?? 'all',
        space_id: opts.spaceId,
      },
    });
    pagesFetched += 1;

    const obj = payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : {};
    if (apiCount === undefined && Number.isFinite(Number(obj.count))) {
      apiCount = Number(obj.count);
    }

    const records = Array.isArray(payload)
      ? payload
      : Array.isArray(obj.records)
        ? (obj.records as unknown[])
        : Array.isArray(obj.data)
          ? (obj.data as unknown[])
          : [];

    rowsReturned += records.length;
    for (const raw of records) {
      const post = toPost(raw);
      if (!post) continue;
      if (seen.has(post.id)) repeated.add(post.id);
      seen.add(post.id);
      byId.set(post.id, post);
    }

    if (obj.has_next_page !== true || records.length === 0) break;
  }

  const posts = [...byId.values()].sort((a, b) => {
    const at = a.publishedAt ?? '';
    const bt = b.publishedAt ?? '';
    return at === bt ? a.id - b.id : at.localeCompare(bt);
  });

  return { posts, rowsReturned, apiCount, pagesFetched, repeatedIds: [...repeated] };
}

/** Posts that share a space, a publish time and a title, but are separate records. */
export function findDuplicates(posts: CirclePost[]): CirclePost[][] {
  const groups = new Map<string, CirclePost[]>();
  for (const p of posts) {
    const key = `${p.spaceId ?? '?'}|${p.publishedAt ?? '?'}|${p.name}`;
    const list = groups.get(key);
    if (list) list.push(p);
    else groups.set(key, [p]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/**
 * Change when a scheduled post publishes.
 *
 * The V2 Update Basic Post endpoint accepts `published_at` but not `status` and
 * not `space_id`, so this moves the time and cannot move a post between spaces
 * or change whether it is a draft. That is deliberate: rescheduling should not
 * be able to publish something by accident.
 */
export async function updatePublishedAt(
  client: CircleClient,
  id: number,
  publishedAt: string,
): Promise<CreatedPost> {
  const payload = await client.request<unknown>(`/posts/${id}`, {
    method: 'PUT',
    body: { published_at: publishedAt },
  });
  return readCreated(payload);
}
