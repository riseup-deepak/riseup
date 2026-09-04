import { createInterface } from 'node:readline/promises';

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const wrap = (code: string) => (s: string) =>
  useColor ? `\x1b[${code}m${s}\x1b[0m` : s;

export const bold = wrap('1');
export const dim = wrap('2');
export const red = wrap('31');
export const green = wrap('32');
export const yellow = wrap('33');
export const cyan = wrap('36');

export function heading(text: string): void {
  process.stdout.write(`\n${bold(text)}\n`);
}

export function field(label: string, value: string): void {
  process.stdout.write(`  ${dim(label.padEnd(12))} ${value}\n`);
}

export function warn(text: string): void {
  process.stdout.write(`  ${yellow('!')} ${text}\n`);
}

export function info(text: string): void {
  process.stdout.write(`${text}\n`);
}

export function success(text: string): void {
  process.stdout.write(`${green('OK')} ${text}\n`);
}

export function failure(text: string): void {
  process.stderr.write(`${red('ERROR')} ${text}\n`);
}

/** Indented, truncated body excerpt for the pre-flight preview. */
export function excerpt(text: string, maxLines = 14): string {
  const lines = text.split('\n');
  const shown = lines.slice(0, maxLines).map((l) => `  ${dim('|')} ${l}`);
  if (lines.length > maxLines) {
    shown.push(`  ${dim('|')} ${dim(`... ${lines.length - maxLines} more lines`)}`);
  }
  return shown.join('\n');
}

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * Ask a single-key question. `choices` maps an accepted key to a return value.
 * Returns null if the session is not interactive.
 */
export async function ask(
  question: string,
  choices: Record<string, string>,
): Promise<string | null> {
  if (!isInteractive()) return null;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const answer = (await rl.question(`${question} `)).trim().toLowerCase();
      const match = choices[answer];
      if (match) return match;
      process.stdout.write(
        dim(`  Please answer with one of: ${Object.keys(choices).join(', ')}\n`),
      );
    }
  } finally {
    rl.close();
  }
}
