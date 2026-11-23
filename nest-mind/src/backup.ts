import fs from "node:fs/promises";
import path from "node:path";
import type { Backend } from "./backend/types.ts";
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

/**
 * The mind's local daily copy of `mind:backupSnapshot` (spec §9).
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

  const snapshot = await opts.backend.backupSnapshot();
  if (snapshot === null || snapshot === undefined) throw new Error("backupSnapshot returned nothing");
  const file = path.join(opts.dir, `${PREFIX}${today}-${String(now).padStart(13, "0")}.json`);
  await writeJsonAtomic(file, snapshot);

  const all = await listBackups(opts.dir);
  for (const old of all.slice(0, Math.max(0, all.length - keep))) {
    await fs.rm(path.join(opts.dir, old), { force: true });
  }
  return file;
}
