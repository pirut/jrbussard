import fs from "node:fs/promises";
import path from "node:path";
import type { Backend } from "./backend/types.ts";
import { canonicalJson, sha256Hex } from "./checksum.ts";
import { ensurePrivateDir, writeJsonAtomic } from "./secureFile.ts";

const PREFIX = "nest-backup-";

export function localDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function listBackups(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter((f) => f.startsWith(PREFIX) && f.endsWith(".json")).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

const FIRST_TABLE = "creatures";
const MAX_PAGES_PER_TABLE = 10_000;

/**
 * Build a `nest-export/v1` file from paged `mind:backupPage` reads (docs/nest-api.md).
 * The first reply names every table; each is read page by page until `isDone`.
 * The checksum is computed exactly as the backend does, over `data`.
 */
export async function buildExportFile(backend: Backend, now: number): Promise<Record<string, unknown>> {
  const first = await backend.backupPage(FIRST_TABLE, null);
  if (!first || !Array.isArray(first.docs) || !Array.isArray(first.tables)) throw new Error("backupPage returned nothing");
  const data: Record<string, unknown[]> = {};
  for (const table of first.tables) {
    const docs: unknown[] = [];
    let page = table === FIRST_TABLE ? first : await backend.backupPage(table, null);
    for (let n = 0; ; n++) {
      if (!page || !Array.isArray(page.docs)) throw new Error(`backupPage returned nothing for ${table}`);
      docs.push(...page.docs);
      if (page.isDone) break;
      if (n >= MAX_PAGES_PER_TABLE) throw new Error(`backupPage did not finish for ${table}`);
      page = await backend.backupPage(table, page.cursor);
    }
    data[table] = docs;
  }
  return { format: first.format, exportedAt: now, schemaVersion: first.schemaVersion, checksum: sha256Hex(canonicalJson(data)), data };
}

/**
 * The mind's local daily copy of the export, read with `mind:backupPage` (spec §9).
 * Files are `nest-backup-<local date>-<epoch ms>.json`, 0600; the newest
 * `keep` are kept. Returns the new file path, or undefined if today's
 * backup already exists.
 */
export async function runDailyBackup(opts: {
  backend: Backend;
  dir: string;
  now?: () => number;
  keep?: number;
  force?: boolean;
}): Promise<string | undefined> {
  const now = opts.now?.() ?? Date.now();
  const keep = opts.keep ?? 30;
  await ensurePrivateDir(opts.dir);
  const existing = await listBackups(opts.dir);
  const today = localDate(now);
  if (!opts.force && existing.some((f) => f.startsWith(`${PREFIX}${today}-`))) return undefined;

  const snapshot = await buildExportFile(opts.backend, now);
  const file = path.join(opts.dir, `${PREFIX}${today}-${String(now).padStart(13, "0")}.json`);
  await writeJsonAtomic(file, snapshot);

  const all = await listBackups(opts.dir);
  for (const old of all.slice(0, Math.max(0, all.length - keep))) {
    await fs.rm(path.join(opts.dir, old), { force: true });
  }
  return file;
}
