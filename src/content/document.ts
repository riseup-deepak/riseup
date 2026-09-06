import { readFileSync } from 'node:fs';
import matter from 'gray-matter';
import type { PostStatus } from '../circle/posts.js';
import { renderMarkdown, htmlToText, wordCount } from './markdown.js';
import { markdownToTipTap, type TipTapDoc } from './tiptap.js';

export interface PostDocument {
  title: string;
  space?: string;
  status?: PostStatus;
  commentsEnabled?: boolean;
  likingEnabled?: boolean;
  publishAt?: string;
  /** Provenance: the Google Doc / Substack URL this was pulled from. */
  source?: string;
  html: string;
  /** The same body as a TipTap document — what the v2 API actually stores. */
  tiptap: TipTapDoc;
  text: string;
  words: number;
  /** Non-fatal problems worth showing before publishing. */
  warnings: string[];
}

function asBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/^(true|yes|on)$/i.test(value)) return true;
    if (/^(false|no|off)$/i.test(value)) return false;
  }
  return undefined;
}

function asStatus(value: unknown, warnings: string[]): PostStatus | undefined {
  if (value === undefined || value === null) return undefined;
  const str = String(value).toLowerCase();
  if (str === 'published' || str === 'publish' || str === 'live') return 'published';
  if (str === 'draft') return 'draft';
  warnings.push(`Ignoring unrecognised status "${value}" in frontmatter.`);
  return undefined;
}

export function parseDocument(markdown: string, label: string): PostDocument {
  const warnings: string[] = [];
  const { data, content } = matter(markdown);
  const front = data as Record<string, unknown>;

  let body = content.trim();
  let title = front.title === undefined ? '' : String(front.title).trim();

  // Fall back to a leading "# Heading", and drop it from the body so the title
  // is not repeated inside the post.
  const heading = body.match(/^#\s+(.+?)\s*$/m);
  if (!title && heading?.[1] && body.startsWith('#')) {
    title = heading[1].trim();
    body = body.slice(heading[0].length).trim();
  } else if (title && heading?.[1] && body.startsWith('#') && heading[1].trim() === title) {
    body = body.slice(heading[0].length).trim();
  }

  if (!title) {
    throw new Error(
      `${label}: no title. Add "title: ..." to the frontmatter, or start the file with "# Your title".`,
    );
  }
  if (!body) {
    throw new Error(`${label}: the post body is empty.`);
  }

  const html = renderMarkdown(body);
  const tiptap = markdownToTipTap(body);
  const text = htmlToText(html);

  if (title.length > 120) {
    warnings.push(`Title is ${title.length} characters — Circle may truncate it in listings.`);
  }
  if (/\{\{|\bTK\b|\bTODO\b|\bLOREM\b/i.test(text)) {
    warnings.push('Body still contains a placeholder (TK / TODO / template token).');
  }

  return {
    title,
    space: front.space === undefined ? undefined : String(front.space),
    status: asStatus(front.status, warnings),
    commentsEnabled: asBool(front.comments),
    likingEnabled: asBool(front.liking),
    publishAt: front.publish_at === undefined ? undefined : String(front.publish_at),
    source: front.source === undefined ? undefined : String(front.source),
    html,
    tiptap,
    text,
    words: wordCount(text),
    warnings,
  };
}

export function readDocument(path: string): PostDocument {
  return parseDocument(readFileSync(path, 'utf8'), path);
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
