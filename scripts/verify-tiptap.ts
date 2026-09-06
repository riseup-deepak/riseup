/**
 * Structural check on the TipTap document the v2 payload carries.
 * Run: npx tsx scripts/verify-tiptap.ts [post.md ...]
 * Defaults to every markdown file in content/.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readDocument } from '../src/content/document.js';
import { buildCreatePostPayload } from '../src/circle/posts.js';
import type { TipTapNode } from '../src/content/tiptap.js';

const INLINE_ONLY = new Set(['text', 'hardBreak']);
const problems: string[] = [];

function walk(node: TipTapNode, path: string, inCode = false): void {
  if (!node || typeof node !== 'object') return problems.push(`${path}: not an object`) as void;
  if (typeof node.type !== 'string' || !node.type) problems.push(`${path}: missing "type"`);
  if (node.type === 'text') {
    if (typeof node.text !== 'string' || node.text === '') problems.push(`${path}: empty text node`);
    if (node.content) problems.push(`${path}: text node must not have "content"`);
    // Newlines are meaningful inside a code block and nowhere else — elsewhere
    // they would show up as stray line breaks in Circle's editor.
    if (!inCode && /\r|\n/.test(node.text ?? '')) {
      problems.push(`${path}: raw newline inside a text node`);
    }
  }
  for (const mark of node.marks ?? []) {
    if (typeof mark.type !== 'string' || !mark.type) problems.push(`${path}: mark without a type`);
    if (mark.type === 'link' && !mark.attrs?.href) problems.push(`${path}: link mark without href`);
  }
  if (node.content) {
    if (!Array.isArray(node.content)) return problems.push(`${path}: "content" is not an array`) as void;
    if (INLINE_ONLY.has(node.type)) problems.push(`${path}: ${node.type} cannot hold content`);
    node.content.forEach((child, i) =>
      walk(child, `${path}.content[${i}](${child?.type})`, inCode || node.type === 'codeBlock'),
    );
  }
}

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync('content').filter((f) => f.endsWith('.md')).map((f) => join('content', f));

for (const file of files) {
  const doc = readDocument(file);
  const payload = buildCreatePostPayload('v2', {
    spaceId: 1, title: doc.title, html: doc.html, tiptap: doc.tiptap,
    status: 'draft', commentsEnabled: true, likingEnabled: true,
  }) as Record<string, any>;

  const body = payload.tiptap_body?.body;
  if (body?.type !== 'doc') problems.push(`${file}: tiptap_body.body.type is "${body?.type}", expected "doc"`);
  if (!Array.isArray(body?.content) || body.content.length === 0) {
    problems.push(`${file}: tiptap_body.body.content must be a non-empty array`);
  }
  for (const key of ['space_id', 'name']) {
    if (payload[key] === undefined) problems.push(`${file}: required field "${key}" missing`);
  }
  walk(body, file);

  // Every word in the plain-text rendering should survive into the TipTap doc.
  const collect = (n: TipTapNode): string =>
    (n.text ?? '') + (n.content ?? []).map(collect).join(' ');
  // Compare on letters/digits only, so punctuation and entity decoding do not
  // cause false alarms. This catches content silently dropped by the converter.
  const flatten = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const inDoc = flatten(collect(body));
  for (const word of doc.text.split(/\s+/).filter((w) => /[a-z]{4,}/i.test(w)).slice(0, 400)) {
    const bare = flatten(word);
    if (bare && !inDoc.includes(bare)) {
      problems.push(`${file}: "${word}" is in the body but not in the TipTap doc`);
    }
  }
  console.log(`checked ${file} — ${body?.content?.length ?? 0} top-level nodes, ${doc.words} words`);
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\nOK — payload structure matches the Admin API V2 schema.');
