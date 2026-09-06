# Handoff: finishing the Circle publishing setup

**Status:** code is written and pushed. Setup is not done. Three tasks remain,
all of which need access to Circle — which is why this moved out of the Claude
Code web sandbox.

## Context

Deepak wants to push posts and notes to the RISEUP@work Circle community at
**riseupatwork.circle.so**, usually starting from a Google Doc.

A CLI to do that already exists in this repo, on branch
`claude/riseup-circle-post-publishing-njzn3y`:

- `npm run circle -- doctor` — checks token, config, connectivity. Read-only.
- `npm run circle -- spaces --save` — lists community spaces, records aliases.
- `npm run circle -- push --file <post.md>` — publishes a post.

Posts are markdown with YAML frontmatter, kept in `content/`. There is also a
`circle-post` skill in `.claude/skills/` that converts a Google Doc into a post
file and runs the push.

**Why it was handed off:** the authoring environment (Claude Code on the web)
has `circle.so` blocked by network policy, so nothing could be verified against
the live API and the token step was impossible there.

**2026-09-05:** the Cowork cloud container is blocked the same way — the egress
proxy refuses CONNECT to both `app.circle.so` and `api.circle.so`. So the CLI
cannot reach Circle from there either, and tasks 1, 2 and 4 have to run on a
machine that can (Deepak's laptop). Task 3 needed no network and is done; the
API spec was read through a browser.

## Task 1 — Get an API token

In Circle: **Settings → Developers → Tokens** (Deepak has
`https://riseupatwork.circle.so/settings/developers` open). Create a token named
`riseup-publishing`, type **Admin API V2**.

If only **Admin API V1** is offered, take it and set `"apiVersion": "v1"` in
`circle.config.json` — both versions are already supported.

Circle shows the token once. Put it in `.env` (gitignored):

```bash
cp .env.example .env
# then set CIRCLE_API_TOKEN=<token>
```

Then:

```bash
npm install
npm run circle -- doctor
```

`doctor` should report an authenticated connection and a space count.

## Task 2 — Record the spaces

**Note:** on V2 this now works through the posts-derived fallback described
above. Deepak's chosen default and test space is **From Dr. Deepak's desk**
(slug `from-dr-deepak-s-desk`).

```bash
npm run circle -- spaces --save
```

This writes an alias for every space into `circle.config.json`. Ask Deepak which
space he posts to most and set it as `"defaultSpace"`, so `--space` can be
omitted from routine pushes.

## Task 3 — Verify the create-post payload  ← DONE (2026-09-05)

Verified against the Admin API V2 OpenAPI spec, read from
`https://api-headless.circle.so/api/admin/v2/swagger.yaml` (the spec behind
Circle's Swagger UI; the docs page itself renders client-side and reads empty).

**One field was wrong.** `tiptap_body.body` is a TipTap *document object*, not
an HTML string:

```yaml
tiptap_body:
  properties:
    body:
      type: object
      properties: { type: string, content: array }
      required: [type, content]
```

Fixed: `src/content/tiptap.ts` converts the post markdown into a TipTap document
and `buildCreatePostPayload()` sends it. `scripts/verify-tiptap.ts` checks the
result structurally (`npx tsx scripts/verify-tiptap.ts`).

Everything else in the payload checked out: path `/api/admin/v2/posts`, host
`app.circle.so`, required fields `space_id` and `name`, and `status`,
`is_comments_enabled`, `is_liking_enabled`, `published_at` all real properties.
`status` also accepts `scheduled`. Auth stays `Bearer` — Circle's quick start
says `Bearer` for both V1 and V2 tokens (the spec's securityScheme says
`Token`, which looks stale; if a 401 appears, that is the first thing to flip).

**Verified live on 2026-09-06.** A draft was created in From Dr. Deepak's Desk
from `content/example-post.md` and checked in Circle's editor. Headings, the
bullet list with bold lead-ins, the block quote and the closing paragraphs all
render correctly, and the markdown soft wraps collapse to clean sentences
instead of stray line breaks. Circle accepted the payload with no 422.

### Circle's V2 spec is incomplete about spaces

The published V2 spec has `POST /spaces`, and show / update / delete on
`/spaces/{id}`, but no list endpoint, so `GET /spaces` looked like it would
404. **It does not.** The first live run returned 25 spaces normally: the
endpoint exists, Circle just left it out of the spec. The fallback below is
kept as a safety net but is not the path actually taken. `listSpaces()` now explains this instead
of failing blankly. Options: use a V1 token with `"apiVersion": "v1"`, or stay
on V2 and write space ids into `circle.config.json` by hand. Pushing a post
does not need the listing.

**Resolved (Deepak chose to stay on V2).** `GET /posts` is documented in V2 and
returns `space_id` and `space_name` on every record, so `doctor` and `spaces`
now fall back to deriving spaces from recent posts
(`discoverSpacesFromPosts()` in `src/circle/spaces.ts`). Both commands say when
the list came from that fallback. A space you have never posted to will not
appear and still needs its id by hand.

## Task 3 (original notes)

**The request body for creating a post was written without access to Circle's
API spec.** Field names are a best reconstruction, not verified.

Check it before posting anything real:

```bash
npm run circle -- push --file content/example-post.md --space <alias> --draft --dry-run
```

That prints the exact JSON and sends nothing. Compare it against Posts → Create
in Circle's Admin API docs (https://api.circle.so/apis/admin-api). The payload
is built in exactly one function — `buildCreatePostPayload()` in
`src/circle/posts.ts` — so any correction is a single-function edit. A `422`
from Circle names the offending field.

Currently sent for v2:

```json
{
  "space_id": 123,
  "name": "Title",
  "tiptap_body": { "body": "<p>HTML body</p>" },
  "status": "draft",
  "is_comments_enabled": true,
  "is_liking_enabled": true
}
```

Then do one real end-to-end test: push `content/example-post.md` as a **draft**
to a low-traffic space, confirm it appears correctly in Circle, and delete it.

## Running the live steps (tasks 1, 2, 4)

These have to run on a machine that can reach `app.circle.so`. Neither Claude
Code on the web nor the Cowork cloud container can. On your laptop:

```bash
git clone https://github.com/riseup-deepak/riseup.git
cd riseup
git checkout claude/riseup-circle-post-publishing-njzn3y
git am /path/to/circle-payload-fix.patch   # the two commits from 2026-09-05
npm install
cp .env.example .env
```

1. **Token.** In Circle: Settings -> Developers -> Tokens (`/settings/api`) ->
   New token, name `riseup-publishing`, type **Admin v2**. Circle shows it once.
   Paste it into `.env` as `CIRCLE_API_TOKEN=`. It never needs to go anywhere
   else — not into a chat, a commit, or a screenshot.

   There are already three Admin v2 tokens in that community
   (`headless-admin-staging`, `RISEUP automation`, `Zapier`). A separate one for
   this tool is still worth having, so it can be revoked on its own.

2. **Check it.**

   ```bash
   npm run circle -- doctor
   ```

   Expect: token recognised, and a space count derived from your recent posts.

3. **Record the spaces.**

   ```bash
   npm run circle -- spaces --save
   ```

   Then set `"defaultSpace": "from-dr-deepak-s-desk"` (or whatever alias that
   space gets) in `circle.config.json`.

4. **Draft test.** Do this before anything real:

   ```bash
   npm run circle -- push --file content/example-post.md --draft
   ```

   Answer the confirmation prompt. Then open Circle, check the draft renders —
   headings, the bullet list, the bold runs, the block quote — and delete it.
   That render is the real test of the TipTap conversion. If a node type comes
   out wrong, the case for it in `src/content/tiptap.ts` is the only thing to
   change.

   A 422 names the field it rejected. `buildCreatePostPayload()` is still the
   only place the payload is built.

Note: the community is at 3,025 of 5,000 Admin API requests for this billing
cycle. `doctor` and `spaces` page through posts, so they cost a handful of
requests each. Worth watching if you run them often.

## Guardrails

- **Never publish live without Deepak confirming.** `push` asks
  publish-or-draft and then confirms; that prompt is the safety model. Do not
  pass `--yes` unless he has said so in that turn.
- **Don't work around a failing API call with a hand-rolled curl.** Fix
  `buildCreatePostPayload()` so the fix sticks.
- **The token is a password for the community.** It belongs in `.env`, never in
  a commit, a chat message, or a screenshot.

## Done looks like

`doctor` green, space aliases saved, one draft successfully created and deleted
in Circle, and any payload corrections committed to this branch.
