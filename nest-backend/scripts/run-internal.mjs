// Shared helper: run an internal Convex function with the CLI (needs deploy credentials).
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

export function runInternal(fn, args, { prod = false } = {}) {
  const cli = ['convex', 'run', ...(prod ? ['--prod'] : []), fn, JSON.stringify(args)];
  const text = execFileSync('npx', cli, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const start = text.indexOf('{');
  return JSON.parse(text.slice(start));
}
