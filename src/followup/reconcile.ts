import { type Commitment, type Evidence, type Ledger } from './types.js';
import { setStatus } from './ledger.js';

/** A sent message, as pulled from Gmail. */
export interface SentMail {
  threadId: string;
  subject: string;
  to: string[];
  /** ISO timestamp. */
  date: string;
  snippet?: string;
}

export interface ReconcileOptions {
  /** Share of a commitment's distinctive words the mail must contain. */
  minScore?: number;
  /** Write the closures, rather than only reporting them. */
  apply?: boolean;
  /** Ignore mail sent more than this many days after the meeting. */
  windowDays?: number;
}

export interface Match {
  commitment: Commitment;
  mail: SentMail;
  score: number;
  reasons: string[];
}

/**
 * Verbs whose completion a sent email can actually prove. "Schedule a call"
 * or "Cancel the admin seat" leave no trace in Sent mail, so they are never
 * auto-closed — a wrong close is worse than a missed one, because it removes
 * the item from the list silently.
 */
const MAIL_EVIDENCED = new Set([
  'email', 'send', 'share', 'forward', 'reply', 'introduce', 'invite', 'circulate',
]);

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'then', 'plus', 'via',
  'his', 'her', 'their', 'about', 'into', 'over', 'after', 'before', 'once',
  're', 'w', 'cc', 'per', 'them', 'they', 'him', 'she', 'need', 'needs',
]);

const tokens = (s: string): string[] =>
  s.toLowerCase().match(/[a-z0-9]{3,}/g)?.filter((t) => !STOPWORDS.has(t)) ?? [];

export function canBeProvenByMail(text: string): boolean {
  const verb = text.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
  return MAIL_EVIDENCED.has(verb);
}

/** Does the counterparty appear among the recipients (or in the subject)? */
function addressesCounterparty(c: Commitment, mail: SentMail): boolean {
  if (!c.counterparty) return false;
  const parts = c.counterparty.toLowerCase().split(/\s+/).filter((p) => p.length >= 3);
  if (parts.length === 0) return false;
  const haystack = `${mail.to.join(' ')} ${mail.subject}`.toLowerCase();
  // First name is enough for an address match; it is the discriminating part.
  return parts.some((p) => haystack.includes(p));
}

/**
 * How well a sent email evidences a commitment.
 *
 * Being addressed to the right person is a *gate*, not a score: Deepak mails
 * Dennis and Oluwole constantly, so "it went to Dennis" says almost nothing on
 * its own. The score is topic overlap alone, measured over the words that are
 * left once the verb and the counterparty's own name are removed — those are
 * already accounted for by the gate.
 */
function score(c: Commitment, mail: SentMail): { score: number; reasons: string[] } {
  const reasons: string[] = [];

  // Gate 1 — when we know who it was for, the mail must have gone to them.
  const addressed = addressesCounterparty(c, mail);
  if (c.counterparty && !addressed) return { score: 0, reasons: [] };
  if (addressed) reasons.push(`addressed to ${c.counterparty}`);

  const want = new Set(tokens(c.text));
  const verb = c.text.trim().split(/\s+/)[0]?.toLowerCase();
  if (verb) want.delete(verb);
  // The counterparty's name proves nothing beyond the gate.
  for (const part of (c.counterparty ?? '').toLowerCase().split(/\s+/)) want.delete(part);
  // Neither do the names of everyone else who was on the call.
  for (const invitee of c.meeting.invitees) {
    for (const part of invitee.toLowerCase().split(/\s+/)) want.delete(part);
  }

  // Gate 2 — nothing distinctive left to match on.
  if (want.size === 0) return { score: 0, reasons: [] };

  const have = new Set(tokens(`${mail.subject} ${mail.snippet ?? ''}`));
  const hits = [...want].filter((t) => have.has(t));

  // Gate 3 — a single shared word is a coincidence, not evidence.
  if (hits.length < 2) return { score: 0, reasons: [] };

  reasons.push(`${hits.length}/${want.size} topic words (${hits.slice(0, 5).join(', ')})`);
  return { score: Number((hits.length / want.size).toFixed(3)), reasons };
}

/**
 * Match sent mail against open commitments. Each mail can close at most one
 * commitment, and each commitment is closed by its single best match.
 */
export function reconcile(
  ledger: Ledger,
  sent: SentMail[],
  opts: ReconcileOptions = {},
): Match[] {
  const minScore = opts.minScore ?? 0.5;
  const windowDays = opts.windowDays ?? 45;

  const candidates = ledger.commitments.filter(
    (c) => c.status === 'open' && c.side === 'mine' && canBeProvenByMail(c.text),
  );

  const matches: Match[] = [];
  for (const c of candidates) {
    const meetingTime = new Date(`${c.meeting.date}T00:00:00Z`).getTime();
    let best: Match | null = null;

    for (const mail of sent) {
      const sentTime = new Date(mail.date).getTime();
      if (!Number.isFinite(sentTime)) continue;
      // The promise has to precede the proof.
      if (sentTime < meetingTime) continue;
      if (sentTime > meetingTime + windowDays * 864e5) continue;

      const { score: s, reasons } = score(c, mail);
      if (s >= minScore && (!best || s > best.score)) {
        best = { commitment: c, mail, score: s, reasons };
      }
    }
    if (best) matches.push(best);
  }

  // Highest confidence first, and never let one email close two commitments.
  matches.sort((a, b) => b.score - a.score);
  const usedMail = new Set<string>();
  const kept = matches.filter((m) => {
    if (usedMail.has(m.mail.threadId)) return false;
    usedMail.add(m.mail.threadId);
    return true;
  });

  if (opts.apply) {
    for (const m of kept) {
      const evidence: Evidence = {
        kind: 'gmail',
        ref: m.mail.threadId,
        subject: m.mail.subject,
        at: m.mail.date,
        recipients: m.mail.to,
        score: m.score,
      };
      m.commitment.evidence.push(evidence);
      setStatus(m.commitment, 'done', 'sent-mail');
    }
  }
  return kept;
}
