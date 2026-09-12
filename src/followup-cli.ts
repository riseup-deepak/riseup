#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { ingest } from './followup/ingest.js';
import { reconcile, type SentMail } from './followup/reconcile.js';
import { buildReport } from './followup/report.js';
import { renderDashboard } from './followup/dashboard.js';
import {
  DEFAULT_LEDGER_PATH,
  ageInDays,
  applyOverrides,
  loadLedger,
  merge,
  saveLedger,
  setStatus,
} from './followup/ledger.js';
import { type Override, type Status } from './followup/types.js';
import { bold, cyan, dim, failure, green, info, red, success, yellow } from './ui.js';

const USAGE = `
${bold('followup')} — turn Fathom action items into a tracked follow-up ledger

${bold('Usage')}
  followup ingest [--file <f>]       Add Fathom action items (JSON or text; stdin by default)
  followup reconcile [--file <f>]    Match sent mail against open items (--apply to close them)
  followup overrides [--file <f>]    Apply status changes made on the dashboard
  followup status [--json]           What you owe, what you are owed
  followup dashboard --out <f>       Write the standalone HTML dashboard
  followup export                    Print the ledger as dashboard JSON
  followup done <id> [--note <t>]    Mark an item done
  followup drop <id> [--note <t>]    Abandon an item, with a reason
  followup reopen <id>               Put an item back on the list

${bold('Options')}
  --file <f>        Read input from a file instead of stdin
  --apply           reconcile: actually close the matched items
  --min-score <n>   reconcile: topic-word overlap needed to close (default 0.5)
  --stale-days <n>  status: age at which an open item counts as slipping (default 7)
  --ledger <f>      Ledger path (default ${DEFAULT_LEDGER_PATH})
  --json            Machine-readable output

${dim('The ledger is a JSON file under version control, so state survives between runs.')}
`;

async function readInput(file?: string): Promise<string> {
  if (file) return readFileSync(file, 'utf8');
  if (process.stdin.isTTY) {
    throw new Error('Nothing on stdin. Pass --file <f>, or pipe the payload in.');
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const label = (c: { id: string; text: string }) => `${dim(c.id)} ${c.text}`;

function printStatus(report: ReturnType<typeof buildReport>): void {
  const { totals } = report;
  info(
    `\n${bold('Follow-up status')}  ${dim(
      `${totals.meetings} meetings · ${totals.closedAllTime} closed`,
    )}`,
  );

  const section = (title: string, colour: (s: string) => string, items: typeof report.overdue) => {
    if (items.length === 0) return;
    info(`\n${colour(bold(`${title} (${items.length})`))}`);
    for (const c of items) {
      const age = ageInDays(c.meeting.date);
      const due = c.dueAt ? ` ${red(`due ${c.dueAt}`)}` : '';
      info(`  ${label(c)}${due}`);
      info(`    ${dim(`${age}d · ${c.meeting.title.slice(0, 52)} · ${c.sourceUrl}`)}`);
    }
  };

  section('Overdue', red, report.overdue);
  section('Due soon', yellow, report.dueSoon);
  section('Open', cyan, report.open);

  if (report.waitingOn.length > 0) {
    const count = report.waitingOn.reduce((n, g) => n + g.items.length, 0);
    info(`\n${bold(`Waiting on others (${count})`)}`);
    for (const g of report.waitingOn.slice(0, 10)) {
      info(`  ${bold(g.owner)} ${dim(`— ${g.items.length} item(s), oldest ${g.oldestDays}d`)}`);
      for (const c of g.items.slice(0, 3)) info(`    ${dim('·')} ${c.text.slice(0, 76)}`);
    }
  }

  if (report.recentlyClosed.length > 0) {
    info(`\n${green(bold(`Closed this week (${report.recentlyClosed.length})`))}`);
    for (const c of report.recentlyClosed.slice(0, 8)) {
      info(`  ${green('✓')} ${c.text.slice(0, 70)} ${dim(`(${c.closedBy})`)}`);
    }
  }
  info('');
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      file: { type: 'string', short: 'f' },
      out: { type: 'string', short: 'o' },
      ledger: { type: 'string' },
      note: { type: 'string' },
      apply: { type: 'boolean', default: false },
      'min-score': { type: 'string' },
      'stale-days': { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  const command = positionals[0];
  if (values.help || !command || command === 'help') {
    info(USAGE);
    return command || values.help ? 0 : 1;
  }

  const path = values.ledger ?? DEFAULT_LEDGER_PATH;
  const ledger = loadLedger(path);

  switch (command) {
    case 'ingest': {
      const result = merge(ledger, ingest(await readInput(values.file)));
      saveLedger(ledger, path);
      success(
        `Ingested: ${result.added} new, ${result.revised} reworded, ${result.unchanged} already tracked.`,
      );
      return 0;
    }

    case 'reconcile': {
      const raw = JSON.parse(await readInput(values.file)) as { sent: SentMail[] } | SentMail[];
      const sent = Array.isArray(raw) ? raw : raw.sent;
      const matches = reconcile(ledger, sent, {
        apply: values.apply,
        minScore: values['min-score'] ? Number(values['min-score']) : undefined,
      });

      if (values.json) {
        info(
          JSON.stringify(
            matches.map((m) => ({
              id: m.commitment.id,
              text: m.commitment.text,
              subject: m.mail.subject,
              score: m.score,
              reasons: m.reasons,
            })),
            null,
            2,
          ),
        );
      } else if (matches.length === 0) {
        info('No sent mail matched an open commitment.');
      } else {
        info(`\n${bold(values.apply ? 'Closed' : 'Would close')} ${matches.length} item(s):\n`);
        for (const m of matches) {
          info(`  ${green('✓')} ${m.commitment.text.slice(0, 68)}`);
          info(`    ${dim(`${m.score} · "${m.mail.subject.slice(0, 52)}" · ${m.reasons.join('; ')}`)}`);
        }
        if (!values.apply) info(`\n${dim('Re-run with --apply to close these.')}`);
        info('');
      }
      if (values.apply) saveLedger(ledger, path);
      return 0;
    }

    case 'overrides': {
      const raw = JSON.parse(await readInput(values.file)) as
        | { overrides: Override[] }
        | Override[];
      const list = Array.isArray(raw) ? raw : raw.overrides;
      const applied = applyOverrides(ledger, list);
      saveLedger(ledger, path);
      success(`Applied ${applied} dashboard change(s).`);
      return 0;
    }

    case 'status': {
      const report = buildReport(ledger, {
        staleDays: values['stale-days'] ? Number(values['stale-days']) : undefined,
      });
      if (values.json) info(JSON.stringify(report, null, 2));
      else printStatus(report);
      return 0;
    }

    case 'dashboard': {
      if (!values.out) {
        failure('dashboard needs --out <file>.');
        return 1;
      }
      const report = buildReport(ledger, {
        staleDays: values['stale-days'] ? Number(values['stale-days']) : undefined,
      });
      writeFileSync(values.out, renderDashboard(report));
      success(`Dashboard written to ${values.out}.`);
      return 0;
    }

    case 'export': {
      info(JSON.stringify(buildReport(ledger), null, 2));
      return 0;
    }

    case 'done':
    case 'drop':
    case 'reopen': {
      const id = positionals[1];
      if (!id) {
        failure(`${command} needs a commitment id. Run "followup status" to see them.`);
        return 1;
      }
      const c = ledger.commitments.find((x) => x.id === id || x.id.startsWith(id));
      if (!c) {
        failure(`No commitment matching "${id}".`);
        return 1;
      }
      const next: Status =
        command === 'done' ? 'done' : command === 'drop' ? 'dropped' : c.side === 'mine' ? 'open' : 'waiting';
      setStatus(c, next, 'manual', values.note ?? null);
      saveLedger(ledger, path);
      success(`${c.id} → ${next}`);
      return 0;
    }

    default:
      failure(`Unknown command "${command}".`);
      info(USAGE);
      return 1;
  }
}

// Set exitCode rather than calling process.exit(): exit() tears the process
// down before a large piped stdout write has flushed, which truncates
// `status --json` and `export` into invalid JSON.
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    failure((err as Error).message);
    if (process.env.FOLLOWUP_DEBUG) console.error(err);
    process.exitCode = 1;
  });
