import type { ApiVersion } from '../config.js';
import type { CircleClient } from './client.js';

export type PostStatus = 'published' | 'draft';

export interface CreatePostInput {
  spaceId: number;
  title: string;
  /** Post body as HTML. Circle stores rich text, not markdown. */
  html: string;
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
 * These were written without access to Circle's live OpenAPI spec (all
 * circle.so hosts are blocked from the environment this was authored in), so
 * treat them as a starting point verified by your first real run, not gospel.
 *
 * To check them before posting anything for real:
 *     npm run circle -- push --file content/example-post.md --dry-run
 * That prints the exact JSON below. Compare it against
 *     https://api.circle.so/apis/admin-api    (Posts -> Create)
 * and adjust here. Nothing else in the codebase needs to change.
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

  // v2 stores rich text as a TipTap document. Circle accepts an HTML string
  // under `tiptap_body.body` and converts it server-side.
  return {
    space_id: input.spaceId,
    name: input.title,
    tiptap_body: { body: input.html },
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
