# riseup-circle

Publishing pipeline for pushing RISEUP@work posts and notes to
[riseupatwork.circle.so](https://riseupatwork.circle.so).

Content is drafted in Google Docs (or in Claude), lands here as markdown with
frontmatter, and goes up to Circle through a CLI that always shows you what it
is about to do and asks before it does it.

## Setup

```bash
npm install
cp .env.example .env
```

Get an API token from Circle: **Settings → Developers → Tokens → New token**,
type **Admin API V2**. Paste it into `.env` as `CIRCLE_API_TOKEN`.

Then check everything works and record your space aliases:

```bash
npm run circle -- doctor
npm run circle -- spaces --save
```

`spaces --save` writes a friendly alias for every space in your community into
`circle.config.json`. Set `defaultSpace` to whichever one you post to most, and
you can drop `--space` from most pushes.

## Publishing

```bash
# See exactly what would be sent, without sending it
npm run circle -- push --file content/my-post.md --dry-run

# Push for real — asks publish-or-draft, then confirms
npm run circle -- push --file content/my-post.md

# Straight to a draft in a named space, no questions
npm run circle -- push --file content/my-post.md --space announcements --draft --yes
```

By default `push` asks two questions before anything reaches Circle: whether to
publish live or save as a draft, and a final confirmation. `--publish` / `--draft`
answer the first; `--yes` skips the second. `--yes` requires an explicit
`--publish` or `--draft`, so the status is never guessed on your behalf.

You can also pipe content in:

```bash
cat draft.md | npm run circle -- push --stdin --space announcements --draft
```

## Post format

Markdown with YAML frontmatter:

```markdown
---
title: What we mean by a career that compounds
space: announcements
comments: true
liking: true
source: https://docs.google.com/document/d/1AbC.../edit
---

Body in **markdown** — headings, lists, > quotes, links, images.
```

| Field | Required | Notes |
|---|---|---|
| `title` | yes | Or start the body with `# Your title` and it will be lifted out |
| `space` | — | Alias or numeric id. Overridden by `--space`, falls back to `defaultSpace` |
| `status` | — | `draft` or `published`. Overridden by `--draft` / `--publish` |
| `comments` | — | Defaults to `defaults.commentsEnabled` in config |
| `liking` | — | Defaults to `defaults.likingEnabled` in config |
| `publish_at` | — | ISO-8601 timestamp for a scheduled post |
| `source` | — | Provenance — the Google Doc or Substack URL this came from |

Posted files live in `content/` and are committed, so you have a version history
of everything that went to the community.

## From a Google Doc

The CLI does not talk to Google — your Claude session does. The `circle-post`
skill (`.claude/skills/circle-post/SKILL.md`) handles the round trip: give Claude
the doc link, it reads the doc with the Drive connector, converts it to a post
file in `content/`, dry-runs it, and hands the confirmation prompt back to you.

In practice: *"push this to Circle: https://docs.google.com/document/d/..."*

## Commands

| Command | What it does |
|---|---|
| `doctor` | Checks token, config, connectivity. Changes nothing. Run this first |
| `spaces [--save] [--json]` | Lists spaces; `--save` records aliases in the config |
| `push --file <f>` / `--stdin` | Publishes a post |

Global flags: `--dry-run` (print the request, send nothing), `--verbose` (log
each HTTP call), `--help`.

## A note on the API payload

Circle's Admin API v2 is the target (`https://app.circle.so/api/admin/v2`).
The request body for creating a post is built in exactly one function —
`buildCreatePostPayload()` in `src/circle/posts.ts` — and it was written without
access to Circle's live OpenAPI spec, so **verify it on your first real run**:

```bash
npm run circle -- push --file content/example-post.md --dry-run
```

Compare the printed JSON against the Posts → Create section of
[Circle's Admin API docs](https://api.circle.so/apis/admin-api). If a field name
is off, Circle returns a 422 naming it, and that one function is the only thing
that needs editing. `apiVersion: "v1"` in `circle.config.json` switches to the
older API (and the `Token` auth scheme) if you ever need it.

## Layout

```
src/
  cli.ts               argument parsing, command dispatch
  config.ts            circle.config.json + .env loading, space alias resolution
  ui.ts                terminal output, preview rendering, prompts
  circle/
    client.ts          HTTP, auth schemes, error messages, dry-run
    spaces.ts          list spaces, derive aliases
    posts.ts           create post + the v1/v2 payload shapes
  content/
    document.ts        frontmatter parsing, validation, warnings
    markdown.ts        markdown -> sanitised HTML, HTML -> preview text
  commands/
    doctor.ts  spaces.ts  push.ts
content/               posts, committed as a publishing history
```
