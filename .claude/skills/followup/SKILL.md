---
name: followup
description: Run Deepak's meeting follow-up cycle - pull new Fathom action items, close what his sent mail already proves, fold in anything he ticked off on the dashboard, and republish it. Use for the twice-daily brief, and whenever he asks what he owes people, what he has not followed up on, what is overdue, or what someone owes him.
---

# Meeting follow-up cycle

Deepak runs back-to-back calls. Fathom already captures what he agreed to; the
gap is that nothing carries those agreements forward. This skill closes that
gap: every commitment from a recorded call lands in a ledger under version
control, and stays there until it is demonstrably done.

**The dashboard:** https://claude.ai/code/artifact/86301e57-9a68-4023-96b2-40a8ba5b64a7

Always republish to that URL (pass it as `url`). Publishing without it creates a
second dashboard and splits his attention across two lists.

## Ground rules

- **Never send anything on his behalf.** Not follow-up mail, not chase-ups. He
  reviews and sends in his own words. This skill reports and tracks only.
- **A wrong close is worse than a missed one.** An item wrongly marked done
  disappears silently; an item wrongly left open costs one tick. Keep the
  reconciler conservative and never lower `--min-score` to close more.
- **Items owed by other people are flagged, never chased.** They appear under
  "Waiting on others" so he can nudge in his own voice.

## Setup

The ledger lives at `data/commitments.json`. Work on the branch that contains
it — the default branch once this work is merged, otherwise
`claude/fathom-notes-followup-0448s9`.

Build the CLI. `npm install` is the normal path; where the registry is blocked,
`tsconfig.followup.json` builds just this CLI, which has no third-party
dependencies:

```bash
npm install && npm run build:followup   # or: tsc -p tsconfig.followup.json
FU="node dist/followup-cli.js"
```

## The cycle

### 1. Pull new action items from Fathom

Use `list_meetings` with `include_action_items: true`, `created_after` set a few
days before the ledger's `updatedAt` (overlap is free — ingest is idempotent),
and `max_pages: 5`. The output is large; when the tool saves it to a file, pass
that file straight to the CLI rather than reading it into context:

```bash
$FU ingest --file <saved-fathom-output>
```

It parses the connector's text listing and JSON alike, folds spelling variants
of a person onto one name, and never resurrects an item already closed.

### 2. Close what his sent mail already proves

Search Gmail for `in:sent newer_than:30d -in:draft`, page through the results,
and reshape them into `{"sent": [{threadId, subject, to, date, snippet}]}`.
Then look before you write:

```bash
$FU reconcile --file sent.json          # dry run — read every proposed close
$FU reconcile --file sent.json --apply  # only once they look right
```

Only mail-shaped commitments ("email X", "send Y") are ever auto-closed —
"schedule a call" or "cancel the seat" leave no trace in Sent mail, so they
stay open until he ticks them off.

### 3. Fold in what he ticked off on the dashboard

Read the artifact's `overrides` collection with `read_db`, reshape to
`{"overrides": [{id, status, updatedAt}]}` and apply:

```bash
$FU overrides --file overrides.json
```

### 4. Republish and commit

```bash
$FU dashboard --out data/dashboard.html
$FU status
```

Publish `data/dashboard.html` to the URL above, then commit
`data/commitments.json` with a message naming the numbers
(`followup: +12 new, 4 closed, 94 overdue`) and push.

## What to say back

Lead with what changed since the last run, not the whole list: new commitments
from the calls just held, anything now overdue, and the oldest thing still
open. Name the person and the promise — "Hank is still waiting on the
four-session proposal you agreed to by Sep 7, 8 days ago" — and link the
dashboard. Keep it to what he can act on between calls.

If nothing changed and nothing is newly overdue, say so in one line.
