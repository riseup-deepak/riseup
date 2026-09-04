---
name: circle-post
description: Publish a post or note to the RISEUP@work Circle community at riseupatwork.circle.so, usually starting from a Google Doc. Use whenever Deepak wants to push something to Circle - "post this to Circle", "put this in the community", "publish this doc to Circle", "turn this Google Doc into a Circle post", "push a note to the community" - or hands over a Google Docs link and asks for it to go up. Also use when he wants to see what spaces exist in the community, or check that Circle publishing is working.
---

# Publishing to Circle

Deepak's community is **riseupatwork.circle.so**. The publishing tool lives in
this repo: a Node CLI at `src/cli.ts`, run with `npm run circle -- <command>`.

The division of labour matters: **you** fetch and shape the content (you have the
Google Drive connector; the CLI does not), and **the CLI** talks to Circle.

## Before anything else

If this is the first Circle push in a while, run:

```bash
npm run circle -- doctor
```

It checks the token, the config and the connection, and prints exactly what is
missing. If it reports no token or no space aliases, fix that first — do not try
to push through a broken setup.

## The flow

### 1. Get the content

**From a Google Doc** (the usual case). Take the doc ID out of the URL
(`https://docs.google.com/document/d/<DOC_ID>/edit`) and read it with the Google
Drive tools — `read_file_content` for the text. If Deepak gave a title instead of
a link, use `search_files` to find it and confirm which doc he means before
pulling it.

**From the chat.** If the content was drafted in conversation (often by the
`substack-notes`, `substack-articles` or `riseup-post` skills), use that directly.

### 2. Shape it into a post file

Write it to `content/YYYY-MM-DD-slug.md` with frontmatter:

```markdown
---
title: The post title
space: <alias from circle.config.json>
comments: true
source: https://docs.google.com/document/d/<DOC_ID>
---

Body in markdown.
```

Rules for the conversion:

- **Keep `source`.** It is the provenance trail back to the Google Doc. Always
  set it when the content came from Drive.
- **Do not repeat the title as an `# H1`** at the top of the body — Circle renders
  the title separately. The CLI strips a leading H1 that matches, but cleaner not
  to write one.
- **Use `##` for section headings**, not `#`.
- **Strip Google Docs cruft**: comment markers, "Draft 3" headers, tracked-change
  leftovers, stray page numbers.
- **Preserve Deepak's voice exactly.** You are converting a format, not rewriting
  the piece. If the doc needs editorial work, say so and ask — do not quietly
  improve it on the way through.
- Markdown supported: headings, **bold**, *italic*, lists, > blockquotes, links,
  code, images, horizontal rules.

### 3. Dry-run it

Always, before any real push:

```bash
npm run circle -- push --file content/2026-09-04-your-slug.md --dry-run
```

This prints the exact JSON that would go to Circle and sends nothing. Check the
title, the space and the body render. Show Deepak the preview.

### 4. Push it

```bash
npm run circle -- push --file content/2026-09-04-your-slug.md
```

The CLI shows a preview and asks two questions: publish-or-draft, then a
confirmation. **Let Deepak answer them.** That prompt is the whole safety model —
it is the last checkpoint before something is visible to the community.

Never pass `--yes` unless Deepak has explicitly said to publish without
confirming, in that turn. Never pass `--publish --yes` on your own initiative.

If he has said "just publish it", `--publish --yes` is fine. If he has said
"stick it in as a draft", `--draft --yes` is fine.

## Spaces

Space aliases live in `circle.config.json`. To list what exists in the community
and record the aliases:

```bash
npm run circle -- spaces --save
```

Run this when a space is missing, newly created, or renamed. If Deepak names a
space that has no alias yet, run `spaces` first rather than guessing an id.

## Posts vs notes

Circle treats both as posts — the difference is length and shape, not mechanism.
A "note" is short (a few paragraphs, one idea, often a question at the end); a
"post" is the longer piece. Both go through the same command. If Deepak asks for
a note and hands over a long doc, ask whether he wants it cut down first.

## When Circle rejects the post

A 422 means the payload shape is wrong. The request body is built in exactly one
place — `buildCreatePostPayload()` in `src/circle/posts.ts` — and the field names
there were written without access to Circle's live API spec. Circle's error
message names the offending field. Fix it there, re-run with `--dry-run`, then
push. Do not work around it by hand-rolling a curl call.

A 401/403 means the token type and `apiVersion` disagree (an Admin V1 token
against the v2 API, or the reverse). `doctor` explains this.
