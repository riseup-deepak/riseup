import { type Commitment, type Meeting } from './types.js';
import { commitmentId } from './ledger.js';
import {
  buildAliasMap,
  canonicalName,
  extractCounterparty,
  extractDueDate,
  isMe,
} from './identity.js';

/** A raw action item before owners are canonicalised. */
interface RawItem {
  text: string;
  assignee: string;
  sourceUrl: string;
  done: boolean;
  meeting: Meeting;
}

/** JSON shape accepted by `followup ingest`, mirroring the Fathom tool output. */
interface JsonPayload {
  meetings: {
    recordingId?: number;
    recording_id?: number;
    title: string;
    date: string;
    url: string;
    invitees?: string[];
    calendar_invitees?: string[];
    actionItems?: JsonItem[];
    action_items?: JsonItem[];
  }[];
}

interface JsonItem {
  text: string;
  assignee?: string;
  assigned_to?: string;
  sourceUrl?: string;
  timestamp_url?: string;
  completed?: boolean;
}

/** "Prokop, Hank" is how Fathom lists calendar invitees. Flip it. */
function tidyName(raw: string): string {
  const name = raw.trim();
  const swapped = name.match(/^([A-Za-z'’-]+),\s*([A-Za-z'’ -]+)$/);
  return swapped ? `${swapped[2]!.trim()} ${swapped[1]!.trim()}` : name;
}

const MEETING_LINE =
  /^-\s+(.*?)\s+\|\s+(\d{4}-\d{2}-\d{2})\s+\|\s+id:\s*(\d+)\s+\|\s+url:\s*(\S+)(.*)$/;
const ITEM_LINE = /^\s*•\s*\[([ xX])\]\s*(.*?)\s*—\s*assigned to\s+(.*?)\s*(?:\((\S+)\))?\s*$/;

/**
 * Parse the plain-text listing that the Fathom connector returns, e.g.
 *
 *   - Title | 2026-09-04 | id: 180237655 | url: https://... | recorded by X | Prokop, Hank
 *     Action items:
 *       • [ ] Email Hank ... — assigned to Dr. Deepak Bhootra (https://...?timestamp=550)
 */
function parseText(input: string): RawItem[] {
  const items: RawItem[] = [];
  let meeting: Meeting | null = null;

  for (const line of input.split('\n')) {
    const m = MEETING_LINE.exec(line);
    if (m) {
      // Trailing segments are "recorded by <name>" followed by invitees.
      const invitees = m[5]!
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => tidyName(s.replace(/^recorded by\s+/i, '')));
      meeting = {
        recordingId: Number(m[3]),
        title: m[1]!.trim(),
        date: m[2]!,
        url: m[4]!,
        invitees,
      };
      continue;
    }

    const item = ITEM_LINE.exec(line);
    if (item && meeting) {
      items.push({
        text: item[2]!.trim(),
        assignee: item[3]!.trim(),
        sourceUrl: item[4] ?? meeting.url,
        done: item[1]!.toLowerCase() === 'x',
        meeting,
      });
    }
  }
  return items;
}

function parseJson(payload: JsonPayload): RawItem[] {
  const items: RawItem[] = [];
  for (const m of payload.meetings ?? []) {
    const meeting: Meeting = {
      recordingId: Number(m.recordingId ?? m.recording_id),
      title: m.title,
      date: m.date.slice(0, 10),
      url: m.url,
      invitees: (m.invitees ?? m.calendar_invitees ?? []).map(tidyName),
    };
    for (const it of m.actionItems ?? m.action_items ?? []) {
      items.push({
        text: it.text.trim(),
        assignee: (it.assignee ?? it.assigned_to ?? '').trim(),
        sourceUrl: it.sourceUrl ?? it.timestamp_url ?? meeting.url,
        done: Boolean(it.completed),
        meeting,
      });
    }
  }
  return items;
}

/**
 * Turn a Fathom payload — JSON or the connector's text listing — into
 * commitments. Owner spellings are folded across the whole batch, so one
 * person never ends up split across two chase lists.
 */
export function ingest(input: string, now = new Date()): Commitment[] {
  const trimmed = input.trim();
  const raw = trimmed.startsWith('{')
    ? parseJson(JSON.parse(trimmed) as JsonPayload)
    : parseText(trimmed);

  const aliases = buildAliasMap(
    raw.filter((r) => r.assignee && !isMe(r.assignee)).map((r) => r.assignee),
  );
  // Everyone Fathom has seen owning work in this batch. Used to recognise who
  // an item of Deepak's is aimed at, even when that person owns nothing.
  const roster = [
    ...new Set(
      raw
        .filter((r) => r.assignee && !isMe(r.assignee))
        .map((r) => canonicalName(r.assignee, aliases)),
    ),
  ];
  const seen = new Set<string>();
  const out: Commitment[] = [];

  for (const r of raw) {
    if (!r.text || !Number.isFinite(r.meeting.recordingId)) continue;
    const id = commitmentId(r.meeting.recordingId, r.text);
    if (seen.has(id)) continue; // same item twice in one payload
    seen.add(id);

    const mine = isMe(r.assignee);
    out.push({
      id,
      text: r.text,
      side: mine ? 'mine' : 'theirs',
      owner: mine ? 'me' : canonicalName(r.assignee || 'Unassigned', aliases),
      counterparty: mine
        ? extractCounterparty(r.text, [...r.meeting.invitees, ...roster])
        : null,
      status: r.done ? 'done' : mine ? 'open' : 'waiting',
      meeting: r.meeting,
      sourceUrl: r.sourceUrl,
      dueAt: extractDueDate(r.text, r.meeting.date),
      firstSeen: now.toISOString(),
      closedAt: r.done ? now.toISOString() : null,
      closedBy: r.done ? 'fathom' : null,
      evidence: [],
      note: null,
    });
  }
  return out;
}
