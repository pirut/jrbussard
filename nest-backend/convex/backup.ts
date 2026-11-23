// Export, restore and daily backups (spec §9).
import { ConvexError, v } from 'convex/values';
import { action, internalAction, internalMutation, internalQuery, mutation, query, type ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Id, TableNames } from './_generated/dataModel';
import { DAY } from './engine/time';
import { rebaseActivity } from './engine/sim';
import { RESTORE_LOCK_STALE_MS, audit, fail, requireOwner } from './lib/core';
import {
  EXPORT_TABLES, RESTORE_TABLES, finalize, readExportPage, remapRefs, stripForInsert, validateExport, type ExportData, type ExportDoc, type ExportFile, type ExportTable,
} from './lib/exporter';

const vTable = v.union(...EXPORT_TABLES.map((t) => v.literal(t)));
const CHUNK = 250;
const DRY_RUN_OK = 'dry_run_ok';
export { RESTORE_LOCK_STALE_MS };

export const exportPage = internalQuery({
  args: { table: vTable, cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, a) => await readExportPage(ctx, a.table, a.cursor),
});

async function collectExport(ctx: ActionCtx): Promise<ExportFile> {
  const data = {} as ExportData;
  for (const t of EXPORT_TABLES) {
    const rows: ExportDoc[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page: { docs: ExportDoc[]; isDone: boolean; cursor: string } = await ctx.runQuery(internal.backup.exportPage, { table: t, cursor });
      rows.push(...page.docs);
      if (page.isDone) break;
      cursor = page.cursor;
    }
    data[t] = rows;
  }
  return finalize(data);
}

export const recordBackup = internalMutation({
  args: { storageId: v.id('_storage'), sizeBytes: v.number(), reason: v.union(v.literal('daily'), v.literal('pre-restore'), v.literal('manual')), checksum: v.string() },
  handler: async (ctx, a) => await ctx.db.insert('backups', { at: Date.now(), ...a }),
});

async function storeBackup(ctx: ActionCtx, reason: 'daily' | 'pre-restore' | 'manual') {
  const file = await collectExport(ctx);
  const text = JSON.stringify(file);
  const storageId = await ctx.storage.store(new Blob([text], { type: 'application/json' }));
  const backupId: Id<'backups'> = await ctx.runMutation(internal.backup.recordBackup, { storageId, sizeBytes: text.length, reason, checksum: file.checksum });
  return { backupId, storageId, sizeBytes: text.length, checksum: file.checksum, text };
}

/** Download a fresh export from settings: stores a manual backup and returns a URL. */
export const exportNow = action({
  args: { sessionToken: v.string() },
  handler: async (ctx, a): Promise<{ backupId: Id<'backups'>; url: string | null; sizeBytes: number; checksum: string }> => {
    if (!(await ctx.runQuery(internal.auth.checkSession, { sessionToken: a.sessionToken }))) fail('Please sign in.', 'unauthenticated');
    const b = await storeBackup(ctx, 'manual');
    await ctx.runMutation(internal.backup.prune, {});
    return { backupId: b.backupId, url: await ctx.storage.getUrl(b.storageId), sizeBytes: b.sizeBytes, checksum: b.checksum };
  },
});

export const list = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx, a.sessionToken);
    const rows = await ctx.db.query('backups').order('desc').take(60);
    return await Promise.all(rows.map(async (b) => ({ id: b._id, at: b.at, reason: b.reason, sizeBytes: b.sizeBytes, checksum: b.checksum, url: await ctx.storage.getUrl(b.storageId) })));
  },
});

/** Upload URL for restoring from a file. */
export const generateUploadUrl = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx, a.sessionToken);
    return await ctx.storage.generateUploadUrl();
  },
});

export const daily = internalAction({
  args: {},
  handler: async (ctx) => {
    await storeBackup(ctx, 'daily');
    await ctx.runMutation(internal.backup.prune, {});
  },
});

/** Keep 14 daily + one per month for 6 months, and the last 10 manual / pre-restore. */
export const prune = internalMutation({
  args: {},
  handler: async (ctx) => {
    const daily = await ctx.db.query('backups').withIndex('by_reason_and_at', (q) => q.eq('reason', 'daily')).order('desc').take(400);
    const keep = new Set(daily.slice(0, 14).map((b) => b._id));
    const months = new Set<string>();
    for (const b of daily.slice(14)) {
      const m = new Date(b.at).toISOString().slice(0, 7);
      if (months.size < 6 && !months.has(m) && Date.now() - b.at < 200 * DAY) { months.add(m); keep.add(b._id); }
    }
    let removed = 0;
    for (const b of daily) if (!keep.has(b._id)) { await ctx.storage.delete(b.storageId); await ctx.db.delete(b._id); removed++; }
    for (const reason of ['manual', 'pre-restore'] as const) {
      const rows = await ctx.db.query('backups').withIndex('by_reason_and_at', (q) => q.eq('reason', reason)).order('desc').take(100);
      for (const b of rows.slice(10)) { await ctx.storage.delete(b.storageId); await ctx.db.delete(b._id); removed++; }
    }
    return { removed };
  },
});

// ── Restore ──

/** Insert a creature and a chunk of rows against the real schema, then roll everything back. */
export const dryRun = internalMutation({
  args: { creature: v.any(), table: vTable, docs: v.array(v.any()) },
  handler: async (ctx, a) => {
    const cid = await ctx.db.insert('creatures', stripForInsert('creatures', a.creature, null) as never);
    if (a.table !== 'creatures') for (const d of a.docs) await ctx.db.insert(a.table, stripForInsert(a.table, d, cid) as never);
    throw new ConvexError({ code: DRY_RUN_OK }); // Rolls everything back; the caller recognises it by `data.code`.
  },
});

export const wipeChunk = internalMutation({
  args: { table: v.union(vTable, v.literal('jobs')) },
  handler: async (ctx, a) => {
    const rows = await ctx.db.query(a.table as TableNames).take(400);
    for (const r of rows) await ctx.db.delete(r._id);
    return rows.length;
  },
});

/**
 * Claim the one restore lock (atomic: a mutation). Refuses while another restore holds it, unless that
 * hold is stale. On success the creature is marked `restoring`, so ticks and touches wait.
 */
export const markRestoring = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, a) => {
    const now = Date.now();
    const lock = await ctx.db.query('locks').withIndex('by_name', (q) => q.eq('name', 'restore')).unique();
    if (lock && now - lock.heldAt < RESTORE_LOCK_STALE_MS) return false;
    if (lock) await ctx.db.patch(lock._id, { token: a.token, heldAt: now });
    else await ctx.db.insert('locks', { name: 'restore', token: a.token, heldAt: now });
    const c = await ctx.db.query('creatures').first();
    if (c) await ctx.db.patch(c._id, { restoring: true });
    return true;
  },
});

/** Let go of the restore lock (only if this token still holds it) and let the nest run again. */
export const releaseRestore = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, a) => {
    const lock = await ctx.db.query('locks').withIndex('by_name', (q) => q.eq('name', 'restore')).unique();
    if (!lock || lock.token !== a.token) return;
    await ctx.db.delete(lock._id);
    for (const c of await ctx.db.query('creatures').take(5)) if (c.restoring) await ctx.db.patch(c._id, { restoring: undefined });
  },
});

export const insertChunk = internalMutation({
  args: { table: vTable, docs: v.array(v.any()), creatureId: v.union(v.id('creatures'), v.null()) },
  handler: async (ctx, a) => {
    const ids: string[] = [];
    for (const d of a.docs) ids.push(await ctx.db.insert(a.table, stripForInsert(a.table, d, a.creatureId) as never));
    return ids;
  },
});

export const patchChunk = internalMutation({
  args: { table: vTable, patches: v.array(v.object({ id: v.string(), patch: v.any() })) },
  handler: async (ctx, a) => {
    for (const p of a.patches) {
      const id = ctx.db.normalizeId(a.table, p.id);
      if (id) await ctx.db.patch(id, p.patch);
    }
  },
});

/**
 * Add back the backup's tags that have no live row (matched by `tagId`). Existing rows are never changed: a revoked tag
 * stays revoked and a tag made after the backup stays. This is what lets a restore onto a fresh deployment accept the
 * physical sticker again.
 */
export const restoreTags = internalMutation({
  args: { docs: v.array(v.any()) },
  handler: async (ctx, a) => {
    let added = 0;
    for (const d of a.docs as ExportDoc[]) {
      if (typeof d.tagId !== 'string') continue;
      const live = await ctx.db.query('nfcTags').withIndex('by_tagId', (q) => q.eq('tagId', d.tagId as string)).first();
      if (live) continue;
      await ctx.db.insert('nfcTags', stripForInsert('nfcTags', d, null) as never);
      added++;
    }
    return added;
  },
});

export const finishRestore = internalMutation({
  args: { creatureId: v.id('creatures'), checksum: v.string(), rolledBack: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const c = (await ctx.db.get(a.creatureId))!;
    const lastTickAt = Math.min(c.lastTickAt, Date.now());
    // The clock may move back (a backup taken from a sim that ran ahead). Re-plan the activity against the new clock
    // so a restored creature does not stay in one activity until a time days away.
    await ctx.db.patch(a.creatureId, { restoring: undefined, lastTickAt, activity: rebaseActivity(c.activity, c.lastTickAt, lastTickAt) });
    await audit(ctx, a.rolledBack ? 'restore.rolled_back' : 'restore.done', a.checksum.slice(0, 16));
  },
});

const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

type RestoreResult = { ok: true; counts: Record<string, number>; preRestoreBackupId: Id<'backups'> };

const isDryRunOk = (e: unknown) => e instanceof ConvexError && (e.data as { code?: string } | undefined)?.code === DRY_RUN_OK;

/** Wipe the creature's tables and insert `data` (the replace step; it never merges). Live tags are left alone; missing ones are added back. */
async function replaceAll(ctx: ActionCtx, data: ExportData, checksum: string, rolledBack = false): Promise<Record<string, number>> {
  const creature = data.creatures[0];
  for (const t of [...RESTORE_TABLES.filter((x) => x !== 'creatures'), 'jobs' as const, 'creatures' as const]) {
    while ((await ctx.runMutation(internal.backup.wipeChunk, { table: t })) > 0);
  }
  const map = new Map<string, string>();
  const [newCreatureId] = await ctx.runMutation(internal.backup.insertChunk, { table: 'creatures', docs: [creature], creatureId: null });
  map.set(creature._id, newCreatureId);
  const counts: Record<string, number> = { creatures: 1 };
  for (const t of RESTORE_TABLES.filter((x) => x !== 'creatures')) {
    counts[t] = data[t].length;
    for (const chunk of chunks(data[t], CHUNK)) {
      const ids: string[] = await ctx.runMutation(internal.backup.insertChunk, { table: t, docs: chunk, creatureId: newCreatureId as Id<'creatures'> });
      chunk.forEach((d, i) => map.set(d._id, ids[i]));
    }
  }
  for (const t of RESTORE_TABLES) {
    const patches = data[t].map((d) => ({ id: map.get(d._id)!, patch: remapRefs(t as ExportTable, d, map) })).filter((p) => p.patch);
    for (const chunk of chunks(patches, CHUNK)) await ctx.runMutation(internal.backup.patchChunk, { table: t, patches: chunk as { id: string; patch: Record<string, unknown> }[] });
  }
  for (const chunk of chunks(data.nfcTags, CHUNK)) await ctx.runMutation(internal.backup.restoreTags, { docs: chunk });
  await ctx.runMutation(internal.backup.finishRestore, { creatureId: newCreatureId as Id<'creatures'>, checksum, rolledBack });
  return counts;
}

export async function restoreFromText(ctx: ActionCtx, text: string): Promise<RestoreResult> {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { fail('That file is not valid JSON.', 'invalid'); }
  const checked = validateExport(raw);
  if (!checked.ok) fail(checked.error, 'invalid');
  const { data, checksum } = checked.file;
  const creature = data.creatures[0];

  // 0. One restore at a time. A second tap (or a second device) is refused, not interleaved.
  const token = crypto.randomUUID();
  if (!(await ctx.runMutation(internal.backup.markRestoring, { token }))) fail('A restore is already running. Give it a few minutes.', 'busy');
  let pre: Awaited<ReturnType<typeof storeBackup>> | null = null;
  let replacing = false;
  try {
    // 1. Dry run every table against the real schema (rolled back each time).
    for (const t of RESTORE_TABLES) {
      for (const chunk of t === 'creatures' ? [[]] : chunks(data[t], CHUNK)) {
        try {
          await ctx.runMutation(internal.backup.dryRun, { creature, table: t, docs: chunk });
        } catch (e) {
          if (isDryRunOk(e)) continue;
          fail(`The backup does not fit this version (table ${t}): ${String((e as Error).message ?? e).slice(0, 200)}`, 'invalid');
        }
      }
    }
    // 2. Automatic pre-restore backup. Never merges, never loses the current state.
    pre = await storeBackup(ctx, 'pre-restore');
    // 3. Replace.
    replacing = true;
    const counts = await replaceAll(ctx, data, checksum);
    return { ok: true, counts, preRestoreBackupId: pre.backupId };
  } catch (e) {
    if (!replacing || !pre) throw e; // Nothing was touched yet.
    // Something broke after the wipe. Put the nest back the way it was.
    let rolledBack = false;
    try {
      const before = (JSON.parse(pre.text) as ExportFile);
      await replaceAll(ctx, before.data, before.checksum, true);
      rolledBack = true;
    } catch { /* reported below */ }
    fail(rolledBack
      ? 'Your nest was put back as it was just before the restore.'
      : 'The restore failed halfway and could not be undone automatically. Restore the latest "pre-restore" backup from settings.', 'restore_failed');
  } finally {
    await ctx.runMutation(internal.backup.releaseRestore, { token });
  }
}

/** Restore from an uploaded export file (storage id from generateUploadUrl). */
export const restore = action({
  args: { sessionToken: v.string(), storageId: v.id('_storage') },
  handler: async (ctx, a): Promise<RestoreResult> => {
    if (!(await ctx.runQuery(internal.auth.checkSession, { sessionToken: a.sessionToken }))) fail('Please sign in.', 'unauthenticated');
    const blob = await ctx.storage.get(a.storageId);
    if (!blob) fail('Upload not found.', 'not_found');
    if (blob.size > 50_000_000) fail('That file is too large.', 'invalid');
    return await restoreFromText(ctx, await blob.text());
  },
});

export const getBackupStorage = internalQuery({
  args: { backupId: v.id('backups') },
  handler: async (ctx, a) => (await ctx.db.get(a.backupId))?.storageId ?? null,
});

/** Restore from one of the stored backups. */
export const restoreBackup = action({
  args: { sessionToken: v.string(), backupId: v.id('backups') },
  handler: async (ctx, a): Promise<RestoreResult> => {
    if (!(await ctx.runQuery(internal.auth.checkSession, { sessionToken: a.sessionToken }))) fail('Please sign in.', 'unauthenticated');
    const storageId = await ctx.runQuery(internal.backup.getBackupStorage, { backupId: a.backupId });
    const blob = storageId && (await ctx.storage.get(storageId));
    if (!blob) fail('Backup not found.', 'not_found');
    return await restoreFromText(ctx, await blob.text());
  },
});
