/**
 * Name handling. Fathom transcribes the same person several ways across calls
 * ("Oluwole Egbesola" / "Oluwole Egbeshola"), so owners are folded onto a
 * canonical spelling before anything is grouped or chased.
 */

/** Spellings of Deepak in Fathom's action items. Anything matching is `mine`. */
const ME = [
  'dr. deepak bhootra',
  'deepak bhootra',
  'deepak',
  'dr deepak bhootra',
  'me',
];

const normalise = (name: string): string =>
  name.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

export function isMe(name: string): boolean {
  return ME.includes(normalise(name));
}

/** Edit distance, capped — we only care about "within 2". */
function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    prev = row;
  }
  return prev[b.length]!;
}

/**
 * Fold near-identical spellings onto one canonical name. The winner is the
 * spelling seen most often, so the majority transcription wins.
 */
export function buildAliasMap(names: string[]): Map<string, string> {
  const counts = new Map<string, { display: string; n: number }>();
  for (const raw of names) {
    const key = normalise(raw);
    if (!key) continue;
    const seen = counts.get(key);
    if (seen) seen.n += 1;
    else counts.set(key, { display: raw.trim(), n: 1 });
  }

  // Most frequent first, so clusters form around the dominant spelling.
  const ordered = [...counts.entries()].sort((a, b) => b[1].n - a[1].n);
  const canonical: { key: string; display: string }[] = [];
  const map = new Map<string, string>();

  for (const [key, { display }] of ordered) {
    // Near-identical spellings: "Oluwole Egbesola" / "Oluwole Egbeshola".
    const hit = canonical.find(
      (c) =>
        c.key === key ||
        (Math.min(c.key.length, key.length) >= 5 && editDistance(c.key, key) <= 2),
    );
    if (hit) map.set(key, hit.display);
    else {
      canonical.push({ key, display });
      map.set(key, display);
    }
  }

  // A bare first name ("Dennis") is the same person as the full name
  // ("Dennis Zebregs") — but only when exactly one full name could match,
  // otherwise two different Dennises would be merged into one chase list.
  for (const c of canonical) {
    if (c.key.includes(' ')) continue;
    const matches = canonical.filter(
      (o) => o !== c && o.key.split(' ')[0] === c.key,
    );
    if (matches.length === 1) map.set(c.key, matches[0]!.display);
  }
  return map;
}

export function canonicalName(raw: string, aliases: Map<string, string>): string {
  return aliases.get(normalise(raw)) ?? raw.trim();
}

/** Verbs that name their target next: "Email Hank ...", "Send Rumbi ...". */
const DIRECTED = new Set([
  'email', 'send', 'share', 'forward', 'reply', 'message', 'ping', 'call',
  'connect', 'ask', 'remind', 'nudge', 'introduce', 'invite', 'text',
]);

/** Words that sit between the verb and the name: "reply to X", "follow up with X". */
const FILLER = new Set(['to', 'with', 'back', 'up', 'a', 'the', 'an']);

const titleCase = (w: string): boolean => /^[A-Z][a-zA-Z'’-]+$/.test(w);

/**
 * Pull the person a commitment is aimed at out of its text — "Email Hank
 * reminder re: ..." gives "Hank". Used to match sent mail back to the item.
 *
 * `roster` is everyone known from the surrounding meetings, which is what
 * keeps "Send Rise Up At Work updates to Barnana" pointing at Barnana rather
 * than at the capitalised product name that happens to follow the verb.
 */
export function extractCounterparty(text: string, roster: string[]): string | null {
  const people = roster.filter((p) => p && !isMe(p));
  const lower = ` ${text.toLowerCase()} `;

  // 1. A known person named in full — longest name first, so "Orin Davis"
  //    is preferred over a bare "Orin".
  const byLength = [...people].sort((a, b) => b.length - a.length);
  const full = byLength.find((p) => lower.includes(` ${normalise(p)} `));
  if (full) return full;

  // 2. A known person by first name.
  const byFirst = byLength.find((p) => {
    const first = normalise(p).split(' ')[0];
    return first !== undefined && first.length >= 3 && new RegExp(`\\b${first}\\b`).test(lower);
  });
  if (byFirst) return byFirst;

  // 3. Nobody known — fall back to the word the verb points at.
  const words = text.trim().split(/\s+/);
  const verb = words[0]?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
  if (DIRECTED.has(verb)) {
    let i = 1;
    while (i < words.length && FILLER.has(words[i]!.toLowerCase())) i += 1;
    const first = words[i];
    if (first && titleCase(first) && !isMe(first)) {
      const second = words[i + 1];
      // Only take a second word as a surname; "Rise Up At Work" is not a name.
      const looksLikeSurname =
        second !== undefined && titleCase(second) && !titleCase(words[i + 2] ?? '');
      return looksLikeSurname ? `${first} ${second}` : first;
    }
  }

  // 4. "... to Sylvia", "... with Brenton".
  const trailing = text.match(/\b(?:to|with|for)\s+([A-Z][a-zA-Z'’-]+)\b/);
  if (trailing?.[1] && !isMe(trailing[1])) return trailing[1];
  return null;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parse an explicit deadline out of the text ("by Sep 7", "by Friday").
 * `reference` is the meeting date, so a bare weekday resolves forward from it.
 */
export function extractDueDate(text: string, reference: string): string | null {
  const ref = new Date(`${reference}T12:00:00Z`);
  if (Number.isNaN(ref.getTime())) return null;

  const byDate = text.match(
    /\bby\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i,
  );
  if (byDate) {
    const month = MONTHS[byDate[1]!.toLowerCase()]!;
    const day = Number(byDate[2]);
    // Deadlines are forward-looking: roll into next year if already past.
    let year = ref.getUTCFullYear();
    const due = new Date(Date.UTC(year, month, day, 12));
    if (due.getTime() < ref.getTime() - 14 * 864e5) year += 1;
    return new Date(Date.UTC(year, month, day, 12)).toISOString().slice(0, 10);
  }

  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const byDay = text.match(
    /\bby\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
  );
  if (byDay) {
    const target = days.indexOf(byDay[1]!.toLowerCase());
    const delta = (target - ref.getUTCDay() + 7) % 7 || 7;
    return new Date(ref.getTime() + delta * 864e5).toISOString().slice(0, 10);
  }

  if (/\bby\s+tomorrow\b/i.test(text)) {
    return new Date(ref.getTime() + 864e5).toISOString().slice(0, 10);
  }
  if (/\b(today|end of day|eod)\b/i.test(text)) return reference;
  return null;
}
