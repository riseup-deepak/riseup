import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  type Commitment,
  type Ledger,
  type Override,
  type Status,
  emptyLedger,
  isLive,
} from './types.js';

export const DEFAULT_LEDGER_PATH = 'data/commitments.json';

/**
 * Stable id for a commitment. Derived from the recording plus the normalised
 * text so the same item re-ingested from the same call lands on the same row,
 * even if Fathom re-words the surrounding punctuation.
 */
export function commitmentId(recordingId: number, text: string): string {
  const key = `${recordingId}:${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
  return createHash('sha1').update(key).digest('hex').slice(0, 12);
}

export function loadLedger(path = DEFAULT_LEDGER_PATH): Ledger {
  if (!existsSync(path)) return emptyLedger();
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Ledger;
  if (raw.version !== 1) {
    throw new Error(`Unsupported ledger version ${raw.version} in ${path}.`);
  }
  return raw;
}

export function saveLedger(ledger: Ledger, path = DEFAULT_LEDGER_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  ledger.updatedAt = new Date().toISOString();
  // Newest meeting first — keeps the committed diff readable.
  ledger.commitments.sort(
    (a, b) => b.meeting.date.localeCompare(a.meeting.date) || a.id.localeCompare(b.id),
  );
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
}

export interface MergeResult {
  added: number;
  unchanged: number;
  /** Items whose text Fathom revised after we had already recorded them. */
  revised: number;
}

/**
 * Fold freshly ingested commitments into the ledger.
 *
 * Existing rows keep their status, evidence and notes — an item you have
 * already marked done must never come back to life because the same meeting
 * was ingested twice. Only the wording and the parsed due date are refreshed.
 */
export function merge(ledger: Ledger, incoming: Commitment[]): MergeResult {
  const byId = new Map(ledger.commitments.map((c) => [c.id, c]));
  const result: MergeResult = { added: 0, unchanged: 0, revised: 0 };

  for (const next of incoming) {
    const existing = byId.get(next.id);
    if (!existing) {
      ledger.commitments.push(next);
      byId.set(next.id, next);
      result.added += 1;
      continue;
    }
    if (existing.text !== next.text) {
      existing.text = next.text;
      existing.dueAt = next.dueAt;
      result.revised += 1;
    } else {
      result.unchanged += 1;
    }
  }
  return result;
}

/** Move a commitment out of (or back into) a live state. */
export function setStatus(
  c: Commitment,
  status: Status,
  by: Commitment['closedBy'],
  note?: string | null,
): void {
  c.status = status;
  c.closedAt = isLive(c) ? null : new Date().toISOString();
  c.closedBy = isLive(c) ? null : by;
  if (note !== undefined) c.note = note;
}

/**
 * Apply status changes made on the published dashboard. The dashboard is the
 * more recent signal for anything a human touched there, so it wins over the
 * ledger's current state — but only for ids we already know.
 */
export function applyOverrides(ledger: Ledger, overrides: Override[]): number {
  const byId = new Map(ledger.commitments.map((c) => [c.id, c]));
  let applied = 0;
  for (const o of overrides) {
    const c = byId.get(o.id);
    if (!c || c.status === o.status) continue;
    setStatus(c, o.status, 'dashboard', o.note ?? c.note);
    applied += 1;
  }
  return applied;
}

/** Whole days elapsed since an ISO date, relative to `now`. */
export function ageInDays(isoDate: string, now = new Date()): number {
  const then = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`).getTime();
  return Math.max(0, Math.floor((now.getTime() - then) / 864e5));
}
