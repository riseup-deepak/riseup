/** Core model for the follow-up ledger. */

/** Who owes the commitment. */
export type Side = 'mine' | 'theirs';

/**
 * Lifecycle. `open` and `waiting` are the two live states — `open` is work
 * Deepak owes, `waiting` is work someone owed him. They are kept distinct so
 * the report can chase one and only flag the other.
 */
export type Status = 'open' | 'waiting' | 'done' | 'dropped';

/** How a commitment left the live states. Kept for trust in the auto-closer. */
export type ClosedBy = 'sent-mail' | 'dashboard' | 'manual' | 'fathom';

export interface Meeting {
  recordingId: number;
  title: string;
  /** ISO date (YYYY-MM-DD) the meeting was recorded. */
  date: string;
  url: string;
  /** Everyone on the calendar invite, used to resolve counterparties. */
  invitees: string[];
}

/** A sent email (or manual note) that proves a commitment was honoured. */
export interface Evidence {
  kind: 'gmail' | 'note';
  /** Gmail thread id, or empty for a note. */
  ref: string;
  subject: string;
  /** ISO timestamp. */
  at: string;
  recipients: string[];
  /** 0..1 — how confident the matcher was. */
  score: number;
}

export interface Commitment {
  /** Stable across re-ingests: hash of recording id + normalised text. */
  id: string;
  text: string;
  side: Side;
  /** Canonical owner name. 'me' for Deepak's own items. */
  owner: string;
  /** Who the commitment is directed at, when the text names someone. */
  counterparty: string | null;
  status: Status;
  meeting: Meeting;
  /** Deep link into the recording at the moment the commitment was made. */
  sourceUrl: string;
  /** ISO date parsed from an explicit deadline in the text ("by Sep 7"). */
  dueAt: string | null;
  /** ISO timestamp of first ingest. */
  firstSeen: string;
  /** ISO timestamp of the move out of a live state. */
  closedAt: string | null;
  closedBy: ClosedBy | null;
  evidence: Evidence[];
  /** Free-text note from the dashboard or CLI. */
  note: string | null;
}

export interface Ledger {
  version: 1;
  /** ISO timestamp of the last write. */
  updatedAt: string;
  commitments: Commitment[];
}

/** A status override coming back from the published dashboard. */
export interface Override {
  id: string;
  status: Status;
  note?: string | null;
  updatedAt: string;
}

export function emptyLedger(): Ledger {
  return { version: 1, updatedAt: new Date().toISOString(), commitments: [] };
}

/** The two states that still need attention. */
export function isLive(c: Commitment): boolean {
  return c.status === 'open' || c.status === 'waiting';
}
