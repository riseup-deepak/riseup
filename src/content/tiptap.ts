import { marked, type Token, type Tokens } from 'marked';

/**
 * ---------------------------------------------------------------------------
 * Markdown -> TipTap document
 * ---------------------------------------------------------------------------
 * Circle's Admin API V2 takes a post body as a TipTap (ProseMirror) JSON
 * document under `tiptap_body.body`, NOT as an HTML string. From the V2
 * OpenAPI spec (https://api-headless.circle.so/api/admin/v2/swagger.yaml,
 * POST /api/admin/v2/posts):
 *
 *     tiptap_body:
 *       type: object
 *       properties:
 *         body:
 *           type: object
 *           properties:
 *             type:     { type: string }
 *             content:  { type: array, items: { type, text, marks, attrs } }
 *           required: [type, content]
 *
 * So `body` is a document node — `{ "type": "doc", "content": [...] }` — and
 * both of its keys are required. Passing HTML here is what a 422 would name.
 *
 * Node and mark names below are the TipTap/ProseMirror defaults that Circle's
 * editor uses. If Circle rejects a specific node, that node's case here is the
 * only thing to change.
 */

export interface TipTapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

export interface TipTapDoc extends TipTapNode {
  type: 'doc';
  content: TipTapNode[];
}

type Mark = { type: string; attrs?: Record<string, unknown> };

/**
 * Markdown soft-wraps a paragraph across source lines. In HTML those newlines
 * collapse to a space; inside a TipTap text node they would survive as literal
 * line breaks, so collapse them here. Code blocks do not go through this.
 */
function normalizeInline(text: string): string {
  return text.replace(/[ \t]*\r?\n[ \t]*/g, ' ');
}

function textNode(raw: string, marks: Mark[]): TipTapNode | null {
  const text = normalizeInline(raw);
  if (!text) return null;
  const node: TipTapNode = { type: 'text', text };
  if (marks.length) node.marks = marks.map((m) => ({ ...m }));
  return node;
}

/** Marked leaves entities in inline text; TipTap wants the real characters. */
function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

function inline(tokens: Token[] | undefined, marks: Mark[] = []): TipTapNode[] {
  const out: TipTapNode[] = [];
  for (const token of tokens ?? []) {
    switch (token.type) {
      case 'text':
      case 'escape': {
        const t = token as Tokens.Text;
        // Nested inline tokens (marked produces these inside list items).
        if (t.tokens?.length) out.push(...inline(t.tokens, marks));
        else {
          const node = textNode(decodeEntities(t.text), marks);
          if (node) out.push(node);
        }
        break;
      }
      case 'strong':
        out.push(...inline((token as Tokens.Strong).tokens, [...marks, { type: 'bold' }]));
        break;
      case 'em':
        out.push(...inline((token as Tokens.Em).tokens, [...marks, { type: 'italic' }]));
        break;
      case 'del':
        out.push(...inline((token as Tokens.Del).tokens, [...marks, { type: 'strike' }]));
        break;
      case 'codespan': {
        const node = textNode(decodeEntities((token as Tokens.Codespan).text), [
          ...marks,
          { type: 'code' },
        ]);
        if (node) out.push(node);
        break;
      }
      case 'link': {
        const link = token as Tokens.Link;
        out.push(
          ...inline(link.tokens, [
            ...marks,
            { type: 'link', attrs: { href: link.href, target: '_blank' } },
          ]),
        );
        break;
      }
      case 'br':
        out.push({ type: 'hardBreak' });
        break;
      case 'image': {
        // Inline images are rare in these posts; keep the alt text rather than
        // silently dropping content.
        const img = token as Tokens.Image;
        const node = textNode(decodeEntities(img.text || img.href), marks);
        if (node) out.push(node);
        break;
      }
      case 'html':
        break; // Raw HTML has no TipTap equivalent; drop it.
      default: {
        const raw = (token as { text?: string }).text;
        if (typeof raw === 'string') {
          const node = textNode(decodeEntities(raw), marks);
          if (node) out.push(node);
        }
      }
    }
  }
  return out;
}

function paragraph(content: TipTapNode[]): TipTapNode {
  // TipTap allows an empty paragraph, but never an absent `content` key on a
  // node that is meant to hold inline content.
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
}

function listItem(item: Tokens.ListItem): TipTapNode {
  const blocks = block(item.tokens ?? []);
  return {
    type: 'listItem',
    content: blocks.length ? blocks : [paragraph([])],
  };
}

function block(tokens: Token[]): TipTapNode[] {
  const out: TipTapNode[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case 'space':
        break;

      case 'paragraph': {
        const p = token as Tokens.Paragraph;
        // A paragraph holding nothing but an image becomes an image node.
        const only = p.tokens?.length === 1 ? p.tokens[0] : undefined;
        if (only?.type === 'image') {
          const img = only as Tokens.Image;
          out.push({
            type: 'image',
            attrs: { src: img.href, alt: img.text || null, title: img.title || null },
          });
          break;
        }
        out.push(paragraph(inline(p.tokens)));
        break;
      }

      case 'heading': {
        const h = token as Tokens.Heading;
        out.push({
          type: 'heading',
          attrs: { level: Math.min(Math.max(h.depth, 1), 6) },
          content: inline(h.tokens),
        });
        break;
      }

      case 'list': {
        const list = token as Tokens.List;
        const node: TipTapNode = {
          type: list.ordered ? 'orderedList' : 'bulletList',
          content: list.items.map(listItem),
        };
        if (list.ordered) {
          const start = Number(list.start);
          node.attrs = { start: Number.isFinite(start) && start > 0 ? start : 1 };
        }
        out.push(node);
        break;
      }

      case 'blockquote': {
        const quote = token as Tokens.Blockquote;
        const inner = block(quote.tokens ?? []);
        out.push({ type: 'blockquote', content: inner.length ? inner : [paragraph([])] });
        break;
      }

      case 'code': {
        const code = token as Tokens.Code;
        out.push({
          type: 'codeBlock',
          attrs: { language: code.lang || null },
          content: code.text ? [{ type: 'text', text: code.text }] : [],
        });
        break;
      }

      case 'hr':
        out.push({ type: 'horizontalRule' });
        break;

      case 'html':
        break; // Dropped: no TipTap equivalent, and Circle strips it anyway.

      case 'table': {
        // Rendered as plain paragraphs rather than dropped. Circle's table node
        // shape is not in the V2 spec, so this stays conservative.
        const table = token as Tokens.Table;
        const rows = [
          table.header.map((cell) => cell.text).join(' | '),
          ...table.rows.map((row) => row.map((cell) => cell.text).join(' | ')),
        ];
        for (const row of rows) {
          const node = textNode(decodeEntities(row), []);
          out.push(paragraph(node ? [node] : []));
        }
        break;
      }

      default: {
        const t = token as { tokens?: Token[]; text?: string };
        if (t.tokens?.length) out.push(paragraph(inline(t.tokens)));
        else if (t.text) {
          const node = textNode(decodeEntities(t.text), []);
          out.push(paragraph(node ? [node] : []));
        }
      }
    }
  }
  return out;
}

/** Convert post markdown into the TipTap document Circle's V2 API expects. */
export function markdownToTipTap(markdown: string): TipTapDoc {
  const tokens = marked.lexer(markdown, { gfm: true, breaks: false });
  const content = block(tokens);
  return {
    type: 'doc',
    // `content` is required by the spec, and an empty doc is not a valid post.
    content: content.length ? content : [paragraph([])],
  };
}
