import { type Commitment, type Ledger } from './types.js';
import { ageInDays } from './ledger.js';

export interface ReportOptions {
  /** An open item older than this is treated as slipping. */
  staleDays?: number;
  /** How far ahead "due soon" looks. */
  soonDays?: number;
  now?: Date;
}

export interface OwedByPerson {
  owner: string;
  items: Commitment[];
  oldestDays: number;
}

export interface Report {
  generatedAt: string;
  /** Past an explicit deadline, or open well past the meeting. */
  overdue: Commitment[];
  /** An explicit deadline landing within `soonDays`. */
  dueSoon: Commitment[];
  /** Everything else still open and owed by Deepak. */
  open: Commitment[];
  /** Outstanding work owed *to* Deepak, grouped by person. */
  waitingOn: OwedByPerson[];
  /** Closed in the last week — evidence the system is working. */
  recentlyClosed: Commitment[];
  totals: {
    mineLive: number;
    theirsLive: number;
    closedAllTime: number;
    meetings: number;
    oldestOpenDays: number;
  };
}

const byUrgency = (now: Date) => (a: Commitment, b: Commitment) => {
  if (a.dueAt && b.dueAt && a.dueAt !== b.dueAt) return a.dueAt.localeCompare(b.dueAt);
  if (a.dueAt && !b.dueAt) return -1;
  if (!a.dueAt && b.dueAt) return 1;
  return ageInDays(b.meeting.date, now) - ageInDays(a.meeting.date, now);
};

export function buildReport(ledger: Ledger, opts: ReportOptions = {}): Report {
  const now = opts.now ?? new Date();
  const staleDays = opts.staleDays ?? 7;
  const soonDays = opts.soonDays ?? 3;
  const today = now.toISOString().slice(0, 10);
  const soonCutoff = new Date(now.getTime() + soonDays * 864e5).toISOString().slice(0, 10);

  const mineOpen = ledger.commitments.filter((c) => c.side === 'mine' && c.status === 'open');

  const overdue = mineOpen.filter(
    (c) => (c.dueAt && c.dueAt < today) || (!c.dueAt && ageInDays(c.meeting.date, now) > staleDays),
  );
  const dueSoon = mineOpen.filter(
    (c) => !overdue.includes(c) && c.dueAt !== null && c.dueAt <= soonCutoff,
  );
  const open = mineOpen.filter((c) => !overdue.includes(c) && !dueSoon.includes(c));

  const waiting = ledger.commitments.filter((c) => c.side === 'theirs' && c.status === 'waiting');
  const grouped = new Map<string, Commitment[]>();
  for (const c of waiting) {
    const list = grouped.get(c.owner);
    if (list) list.push(c);
    else grouped.set(c.owner, [c]);
  }
  const waitingOn: OwedByPerson[] = [...grouped.entries()]
    .map(([owner, items]) => ({
      owner,
      items: items.sort(byUrgency(now)),
      oldestDays: Math.max(...items.map((i) => ageInDays(i.meeting.date, now))),
    }))
    .sort((a, b) => b.oldestDays - a.oldestDays || b.items.length - a.items.length);

  const weekAgo = new Date(now.getTime() - 7 * 864e5).toISOString();
  const recentlyClosed = ledger.commitments
    .filter((c) => c.status === 'done' && c.closedAt !== null && c.closedAt >= weekAgo)
    .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''));

  return {
    generatedAt: now.toISOString(),
    overdue: overdue.sort(byUrgency(now)),
    dueSoon: dueSoon.sort(byUrgency(now)),
    open: open.sort(byUrgency(now)),
    waitingOn,
    recentlyClosed,
    totals: {
      mineLive: mineOpen.length,
      theirsLive: waiting.length,
      closedAllTime: ledger.commitments.filter((c) => c.status === 'done').length,
      meetings: new Set(ledger.commitments.map((c) => c.meeting.recordingId)).size,
      oldestOpenDays: mineOpen.length
        ? Math.max(...mineOpen.map((c) => ageInDays(c.meeting.date, now)))
        : 0,
    },
  };
}
