import type { ApiVersion } from '../config.js';
import type { TipTapDoc } from '../content/tiptap.js';
import type { CircleClient } from './client.js';

export type PostStatus = 'published' | 'draft';

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
  /** ISO-8601. Only meaningful for scheduled/published posts. */
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
