import { type Commitment } from './types.js';
import { type Report } from './report.js';
import { ageInDays } from './ledger.js';

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Safe to drop straight into a <script> block. */
const json = (v: unknown): string =>
  JSON.stringify(v).replace(/</g, '\\u003c').replace(/-->/g, '--\\u003e');

/** Fathom lowercases some invitee names; present them as names. */
const displayName = (n: string): string =>
  n === n.toLowerCase() ? n.replace(/\b[a-z]/g, (m) => m.toUpperCase()) : n;

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const shortDate = (iso: string): string =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

function row(c: Commitment, now: Date, opts: { closed?: boolean } = {}): string {
  const age = ageInDays(c.meeting.date, now);
  const who = c.side === 'mine' ? c.counterparty : c.owner;
  const due = c.dueAt
    ? `<span class="due ${c.dueAt < now.toISOString().slice(0, 10) ? 'due-past' : ''}">due ${esc(
        shortDate(c.dueAt),
      )}</span>`
    : '';
  return `<li class="item${opts.closed ? ' is-closed' : ''}" data-id="${esc(c.id)}" data-status="${esc(
    c.status,
  )}">
  <button class="tick" type="button" aria-pressed="${opts.closed ? 'true' : 'false'}" aria-label="Mark &quot;${esc(
    c.text.slice(0, 60),
  )}&quot; done"></button>
  <div class="body">
    <p class="text">${esc(c.text)}</p>
    <p class="meta">
      ${who ? `<span class="who">${esc(displayName(who))}</span>` : ''}
      <a class="src" href="${esc(c.sourceUrl)}" target="_blank" rel="noopener">${esc(
        clip(c.meeting.title, 46),
      )}</a>
      <span class="age" title="Agreed ${esc(shortDate(c.meeting.date))}">${age}d</span>
      ${due}
    </p>
  </div>
</li>`;
}

function section(
  id: string,
  title: string,
  blurb: string,
  items: Commitment[],
  now: Date,
  opts: { closed?: boolean } = {},
): string {
  if (items.length === 0) return '';
  return `<section class="sec sec-${id}" id="sec-${id}">
  <header class="sec-head">
    <h2>${esc(title)} <span class="count">${items.length}</span></h2>
    <p class="blurb">${esc(blurb)}</p>
  </header>
  <ul class="items">${items.map((c) => row(c, now, opts)).join('\n')}</ul>
</section>`;
}

/**
 * Render the standalone dashboard. Commitment state is inlined at build time;
 * anything ticked off in the browser is written to the artifact's store and
 * folded back into the ledger on the next scheduled run.
 */
export function renderDashboard(report: Report): string {
  const now = new Date(report.generatedAt);
  const t = report.totals;

  const waiting = report.waitingOn
    .map(
      (g) => `<div class="person">
  <h3>${esc(displayName(g.owner))} <span class="count">${g.items.length}</span>
    <span class="oldest">oldest ${g.oldestDays}d</span></h3>
  <ul class="items">${g.items.map((c) => row(c, now)).join('\n')}</ul>
</div>`,
    )
    .join('\n');

  const stamp = now.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  });

  return `<title>Follow-Up Ledger</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Source+Sans+3:wght@400;600&display=swap">
<style>
:root {
  --ground: #f4f6f7;
  --surface: #ffffff;
  --line: #dfe4e9;
  --ink: #131820;
  --muted: #5e6672;
  --faint: #858d99;
  --accent: #2f5d7c;
  --accent-soft: #e8eff4;
  --overdue: #a33028;
  --soon: #8a6212;
  --waiting: #565f6e;
  --done: #2c6b4d;
  --display: 'Archivo', 'Helvetica Neue', Arial, sans-serif;
  --body: 'Source Sans 3', system-ui, -apple-system, sans-serif;
  --mono: 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground: #0f1217; --surface: #171b22; --line: #262c36;
    --ink: #e6eaef; --muted: #9aa3af; --faint: #737c88;
    --accent: #7fb0d0; --accent-soft: #1b2833;
    --overdue: #e07a6f; --soon: #d9ab5e; --waiting: #99a3b1; --done: #6fbf95;
  }
}
:root[data-theme="dark"] {
  --ground: #0f1217; --surface: #171b22; --line: #262c36;
  --ink: #e6eaef; --muted: #9aa3af; --faint: #737c88;
  --accent: #7fb0d0; --accent-soft: #1b2833;
  --overdue: #e07a6f; --soon: #d9ab5e; --waiting: #99a3b1; --done: #6fbf95;
}

* { box-sizing: border-box; }
body {
  background: var(--ground);
  color: var(--ink);
  font-family: var(--body);
  font-size: 16px;
  line-height: 1.5;
  padding-inline: 20px;
  padding-block: 32px 64px;
}
.wrap { max-width: 940px; margin: 0 auto; display: flex; flex-direction: column; gap: 28px; }

.masthead { display: flex; flex-direction: column; gap: 6px; }
.masthead h1 {
  font-family: var(--display); font-weight: 700; font-size: clamp(26px, 4.2vw, 36px);
  letter-spacing: -0.02em; margin: 0; text-wrap: balance;
}
.stamp { font-family: var(--mono); font-size: 12.5px; color: var(--faint); margin: 0; }

.tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.tile {
  background: var(--surface); border: 1px solid var(--line); border-radius: 8px;
  padding: 14px 16px; display: flex; flex-direction: column; gap: 2px;
}
.tile .n {
  font-family: var(--display); font-weight: 700; font-size: 30px; line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.tile .l {
  font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.07em;
  color: var(--muted); font-weight: 600;
}
.tile-overdue .n { color: var(--overdue); }
.tile-done .n { color: var(--done); }

.toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
#filter {
  flex: 1 1 240px; min-width: 0; font-family: var(--body); font-size: 15px;
  padding: 9px 12px; border: 1px solid var(--line); border-radius: 7px;
  background: var(--surface); color: var(--ink);
}
#filter::placeholder { color: var(--faint); }
.hint { font-size: 13px; color: var(--faint); }

.sec { display: flex; flex-direction: column; gap: 10px; }
.sec-head { display: flex; flex-direction: column; gap: 1px; }
.sec-head h2 {
  font-family: var(--display); font-weight: 600; font-size: 15px;
  text-transform: uppercase; letter-spacing: 0.08em; margin: 0;
  display: flex; align-items: center; gap: 8px;
}
.count {
  font-family: var(--mono); font-size: 12px; font-weight: 500;
  background: var(--accent-soft); color: var(--accent);
  padding: 1px 7px; border-radius: 20px; letter-spacing: 0;
}
.blurb { margin: 0; font-size: 13.5px; color: var(--muted); }
.sec-overdue h2 { color: var(--overdue); }
.sec-overdue .count { background: color-mix(in srgb, var(--overdue) 12%, transparent); color: var(--overdue); }
.sec-soon h2 { color: var(--soon); }
.sec-soon .count { background: color-mix(in srgb, var(--soon) 14%, transparent); color: var(--soon); }

.items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
.item {
  display: flex; gap: 12px; align-items: flex-start;
  background: var(--surface); border: 1px solid var(--line);
  border-left: 3px solid var(--accent);
  padding: 11px 14px 11px 12px;
}
.items .item:first-child { border-radius: 7px 7px 0 0; }
.items .item:last-child { border-radius: 0 0 7px 7px; }
.items .item:only-child { border-radius: 7px; }
.sec-overdue .item { border-left-color: var(--overdue); }
.sec-soon .item { border-left-color: var(--soon); }
.sec-waiting .item { border-left-color: var(--waiting); }
.sec-closed .item { border-left-color: var(--done); }

.tick {
  flex: none; width: 19px; height: 19px; margin-top: 2px; padding: 0;
  border: 1.5px solid var(--faint); border-radius: 4px;
  background: transparent; cursor: pointer; position: relative;
}
.tick:hover { border-color: var(--done); }
.tick::after {
  content: ''; position: absolute; inset: 0; margin: auto;
  width: 5px; height: 9px; border: solid var(--surface);
  border-width: 0 2px 2px 0; transform: rotate(45deg) translate(-1px, -1px);
  opacity: 0;
}
.tick[aria-pressed="true"] { background: var(--done); border-color: var(--done); }
.tick[aria-pressed="true"]::after { opacity: 1; }
.tick:focus-visible, a:focus-visible, #filter:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
.is-readonly .tick { cursor: default; opacity: 0.45; }

.body { min-width: 0; flex: 1; }
.text { margin: 0; font-size: 15.5px; line-height: 1.4; overflow-wrap: anywhere; }
.is-closed .text { text-decoration: line-through; color: var(--muted); }
.meta {
  margin: 3px 0 0; display: flex; flex-wrap: wrap; gap: 4px 10px;
  font-size: 12.5px; color: var(--faint); align-items: baseline;
}
.who { color: var(--accent); font-weight: 600; }
.src { color: var(--muted); text-decoration: none; border-bottom: 1px solid var(--line); }
.src:hover { color: var(--accent); border-color: var(--accent); }
.age { font-family: var(--mono); font-variant-numeric: tabular-nums; }
.due {
  font-family: var(--mono); font-size: 11.5px; padding: 0 6px;
  border: 1px solid var(--line); border-radius: 3px; color: var(--muted);
}
.due-past { color: var(--overdue); border-color: var(--overdue); }

.person { margin-bottom: 14px; }
.person h3 {
  font-family: var(--display); font-size: 14.5px; font-weight: 600; margin: 0 0 6px;
  display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
}
.oldest { font-family: var(--mono); font-size: 11.5px; color: var(--faint); font-weight: 400; }

details.sec-closed summary {
  font-family: var(--display); font-weight: 600; font-size: 15px;
  text-transform: uppercase; letter-spacing: 0.08em; color: var(--done);
  cursor: pointer; margin-bottom: 10px;
}
.empty {
  background: var(--surface); border: 1px dashed var(--line); border-radius: 8px;
  padding: 28px; text-align: center; color: var(--muted);
}
.item[hidden] { display: none; }

@media (max-width: 640px) {
  .tiles { grid-template-columns: repeat(2, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}
</style>

<div class="wrap">
  <header class="masthead">
    <h1>What you said you would do</h1>
    <p class="stamp">${esc(stamp)} UTC · ${t.meetings} meetings tracked · oldest open item ${
      t.oldestOpenDays
    }d</p>
  </header>

  <div class="tiles">
    <div class="tile tile-overdue"><span class="n">${report.overdue.length}</span><span class="l">Overdue</span></div>
    <div class="tile"><span class="n">${t.mineLive}</span><span class="l">You owe</span></div>
    <div class="tile"><span class="n">${t.theirsLive}</span><span class="l">Owed to you</span></div>
    <div class="tile tile-done"><span class="n">${t.closedAllTime}</span><span class="l">Closed</span></div>
  </div>

  <div class="toolbar">
    <input id="filter" type="search" placeholder="Filter by person, topic or meeting…" autocomplete="off">
    <span class="hint" id="sync-hint">Tick an item to close it</span>
  </div>

  ${section('overdue', 'Overdue', 'Past a deadline you set, or still open well after the call.', report.overdue, now, {})}
  ${section('soon', 'Due soon', 'You named a date on the call and it is coming up.', report.dueSoon, now, {})}
  ${section('open', 'Open', 'Agreed recently and still within a reasonable window.', report.open, now, {})}

  ${
    waiting
      ? `<section class="sec sec-waiting" id="sec-waiting">
    <header class="sec-head">
      <h2>Waiting on others <span class="count">${t.theirsLive}</span></h2>
      <p class="blurb">Work other people committed to on your calls. Nothing is sent automatically — chase in your own words.</p>
    </header>
    ${waiting}
  </section>`
      : ''
  }

  ${
    report.recentlyClosed.length
      ? `<details class="sec sec-closed" id="sec-closed">
    <summary>Closed this week (${report.recentlyClosed.length})</summary>
    <ul class="items">${report.recentlyClosed.map((c) => row(c, now, { closed: true })).join('\n')}</ul>
  </details>`
      : ''
  }

  ${
    t.mineLive === 0
      ? '<p class="empty">Nothing outstanding. Every commitment from your recorded calls is closed.</p>'
      : ''
  }
</div>

<script>
(function () {
  var GENERATED_AT = ${json(report.generatedAt)};
  var items = Array.prototype.slice.call(document.querySelectorAll('.item'));
  var byId = {};
  items.forEach(function (el) { byId[el.dataset.id] = el; });
  var hint = document.getElementById('sync-hint');
  var store = null;

  function paint(el, done) {
    el.classList.toggle('is-closed', done);
    el.querySelector('.tick').setAttribute('aria-pressed', done ? 'true' : 'false');
  }

  function recount() {
    var live = items.filter(function (el) {
      return !el.classList.contains('is-closed') && !el.closest('.sec-waiting') && !el.closest('.sec-closed');
    }).length;
    var overdue = items.filter(function (el) {
      return !el.classList.contains('is-closed') && el.closest('.sec-overdue');
    }).length;
    var tiles = document.querySelectorAll('.tile .n');
    if (tiles[0]) tiles[0].textContent = String(overdue);
    if (tiles[1]) tiles[1].textContent = String(live);
  }

  // Filter across the text, the person and the meeting title.
  var filter = document.getElementById('filter');
  filter.addEventListener('input', function () {
    var q = filter.value.trim().toLowerCase();
    items.forEach(function (el) {
      el.hidden = q !== '' && el.textContent.toLowerCase().indexOf(q) === -1;
    });
  });

  items.forEach(function (el) {
    el.querySelector('.tick').addEventListener('click', function () {
      if (!store) return;
      var done = !el.classList.contains('is-closed');
      paint(el, done);
      recount();
      store.doc('overrides/' + el.dataset.id)
        .set({
          id: el.dataset.id,
          status: done ? 'done' : (el.closest('.sec-waiting') ? 'waiting' : 'open'),
          updatedAt: new Date().toISOString(),
          seenAt: GENERATED_AT
        })
        .catch(function () {
          paint(el, !done);
          recount();
          hint.textContent = 'Could not save that — try again.';
        });
    });
  });

  function readOnly(message) {
    document.body.classList.add('is-readonly');
    hint.textContent = message;
  }

  if (!window.claude || !window.claude.use) {
    readOnly('Read-only preview');
    return;
  }
  window.claude.use('db').then(function (db) {
    if (!db) { readOnly('Read-only — changes cannot be saved here'); return; }
    store = db;
    hint.textContent = 'Tick an item to close it — saved for your next brief';
    db.collection('overrides').onSnapshot(function (snap) {
      snap.docs.forEach(function (doc) {
        var d = doc.data() || {};
        var el = byId[doc.id];
        if (el) paint(el, d.status === 'done' || d.status === 'dropped');
      });
      recount();
    }, function () {
      hint.textContent = 'Live sync interrupted — your ticks are still saved';
    });
  });
})();
</script>`;
}
