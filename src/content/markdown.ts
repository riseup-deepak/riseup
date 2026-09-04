import { marked } from 'marked';

/** Tags Circle's editor will not keep, and that we should never forward. */
const UNSAFE_BLOCK = /<(script|style|iframe|object|embed|form)\b[\s\S]*?<\/\1>/gi;
const UNSAFE_SELF_CLOSING = /<(script|style|iframe|object|embed|form|input)\b[^>]*\/?>/gi;
const EVENT_HANDLER = /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;

export function renderMarkdown(markdown: string): string {
  const html = marked.parse(markdown, { async: false, gfm: true, breaks: false });
  return sanitize(typeof html === 'string' ? html : String(html));
}

export function sanitize(html: string): string {
  return html
    .replace(UNSAFE_BLOCK, '')
    .replace(UNSAFE_SELF_CLOSING, '')
    .replace(EVENT_HANDLER, '')
    .replace(/javascript:/gi, '')
    .trim();
}

/** Readable plain text for the confirmation preview. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '  - ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
