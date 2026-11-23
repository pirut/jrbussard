// nest-export/v1: every creature table except auth (spec §9), with a SHA-256 checksum.
import type { QueryCtx } from '../_generated/server';
import { canonicalJson, sha256Hex } from '../engine/sha256';
import { SCHEMA_VERSION } from '../schema';

export const EXPORT_FORMAT = 'nest-export/v1';

/** Insert order matters: creature first, then rows that others point at. */
export const EXPORT_TABLES = [
  'creatures', 'settings', 'weather', 'nfcTags', 'regionState', 'acquaintances', 'interests', 'memories', 'trinkets',
  'happenings', 'beliefs', 'visits', 'messages', 'touches', 'journal',
] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];

export type ExportDoc = Record<string, unknown> & { _id: string };
export type ExportData = Record<ExportTable, ExportDoc[]>;
export type ExportFile = { format: typeof EXPORT_FORMAT; exportedAt: number; schemaVersion: number; checksum: string; data: ExportData };

/**
 * The tables a restore replaces. `nfcTags` is excluded on purpose: a restore must never resurrect a
 * tag the owner revoked or drop one made after the backup. Live tags stay exactly as they are
 * (a backup still carries them, so the file is a complete record, but they are never read back).
 */
export const RESTORE_TABLES = EXPORT_TABLES.filter((t) => t !== 'nfcTags');

const NO_CREATURE_REF: ExportTable[] = ['creatures', 'settings', 'weather', 'nfcTags'];

export function toExportDoc(doc: Record<string, unknown>): ExportDoc {
  const { _creationTime, ...rest } = doc;
  void _creationTime;
  return rest as ExportDoc;
}

export function checksumOf(data: ExportData): string {
  return sha256Hex(canonicalJson(data));
}

export function finalize(data: ExportData, now = Date.now()): ExportFile {
  return { format: EXPORT_FORMAT, exportedAt: now, schemaVersion: SCHEMA_VERSION, checksum: checksumOf(data), data };
}

export const EXPORT_PAGE_SIZE = 500;

/** One page of one table, as export rows. Shared by `backup:exportPage` and `mind:backupPage`. */
export async function readExportPage(ctx: QueryCtx, table: ExportTable, cursor: string | null) {
  const res = await ctx.db.query(table).paginate({ cursor, numItems: EXPORT_PAGE_SIZE });
  return { docs: res.page.map((d) => toExportDoc(d as unknown as Record<string, unknown>)), isDone: res.isDone, cursor: res.continueCursor };
}

/** Build the whole export inside one query (used by mind:backupSnapshot and small deployments). */
export async function buildExport(ctx: QueryCtx): Promise<ExportFile> {
  const data = {} as ExportData;
  for (const t of EXPORT_TABLES) data[t] = (await ctx.db.query(t).collect()).map((d) => toExportDoc(d as unknown as Record<string, unknown>));
  return finalize(data);
}

export type ValidationResult = { ok: true; file: ExportFile } | { ok: false; error: string };

/** Shape, version and checksum checks. Field-level checks happen in the dry run against the real schema. */
export function validateExport(raw: unknown): ValidationResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'Not a nest export.' };
  const f = raw as Partial<ExportFile>;
  if (f.format !== EXPORT_FORMAT) return { ok: false, error: `Unknown format ${String(f.format)}.` };
  if (typeof f.schemaVersion !== 'number' || f.schemaVersion > SCHEMA_VERSION || f.schemaVersion < 1) return { ok: false, error: `Unsupported schema version ${String(f.schemaVersion)}.` };
  if (typeof f.checksum !== 'string' || typeof f.data !== 'object' || f.data === null) return { ok: false, error: 'Missing checksum or data.' };
  for (const k of Object.keys(f.data)) if (!(EXPORT_TABLES as readonly string[]).includes(k)) return { ok: false, error: `Unknown table ${k}.` };
  for (const t of EXPORT_TABLES) {
    const rows = (f.data as Record<string, unknown>)[t];
    if (!Array.isArray(rows)) return { ok: false, error: `Table ${t} is missing.` };
    for (const r of rows) if (typeof r !== 'object' || r === null || typeof (r as ExportDoc)._id !== 'string') return { ok: false, error: `Bad row in ${t}.` };
  }
  if (f.data.creatures.length !== 1) return { ok: false, error: 'An export holds exactly one creature.' };
  if (f.data.settings.length > 1 || f.data.weather.length > 1) return { ok: false, error: 'Too many settings rows.' };
  if (checksumOf(f.data) !== f.checksum) return { ok: false, error: 'Checksum does not match. The file is damaged or was edited.' };
  return { ok: true, file: f as ExportFile };
}

/** First pass: the row as it can be inserted (references to rows not yet inserted are dropped). */
export function stripForInsert(table: ExportTable, doc: ExportDoc, creatureId: string | null): Record<string, unknown> {
  const { _id, ...d } = doc;
  void _id;
  const out: Record<string, unknown> = { ...d };
  if (!NO_CREATURE_REF.includes(table)) out.creatureId = creatureId;
  delete out.jobId;
  switch (table) {
    case 'creatures':
      out.marks = ((d.marks as Record<string, unknown>[]) ?? []).map(({ memoryId, ...m }) => (void memoryId, m));
      out.restoring = true;
      break;
    case 'trinkets':
    case 'happenings':
      delete out.memoryId;
      break;
    case 'memories':
      delete out.consolidatedInto;
      break;
    case 'beliefs':
      out.evidence = [];
      break;
    case 'visits':
      delete out.momentMessageId;
      break;
    case 'messages':
      delete out.visitId;
      // Jobs are not restored, so a pending message could never be filled. Settle it.
      if (out.pending === true) {
        out.pending = false;
        if (typeof out.text !== 'string' || !out.text.trim()) { out.text = '*is quiet for a moment*'; out.fallback = true; }
      }
      break;
    case 'journal':
      out.happeningIds = [];
      break;
  }
  return out;
}

/** Second pass: the references, remapped to new ids. Returns null if the row has none. */
export function remapRefs(table: ExportTable, doc: ExportDoc, map: Map<string, string>): Record<string, unknown> | null {
  const m = (x: unknown) => (typeof x === 'string' ? map.get(x) : undefined);
  const list = (xs: unknown) => (Array.isArray(xs) ? xs.map(m).filter((x): x is string => !!x) : []);
  switch (table) {
    case 'creatures':
      return {
        marks: ((doc.marks as Record<string, unknown>[]) ?? []).map(({ memoryId, ...k }) => {
          const id = m(memoryId);
          return id ? { ...k, memoryId: id } : k;
        }),
      };
    case 'trinkets':
    case 'happenings':
      return doc.memoryId ? { memoryId: m(doc.memoryId) } : null;
    case 'memories': {
      const sourceIds = Array.isArray(doc.sourceIds) ? (doc.sourceIds as string[]).map((s) => map.get(s) ?? s) : [];
      return { consolidatedInto: m(doc.consolidatedInto), sourceIds };
    }
    case 'beliefs':
      return { evidence: list(doc.evidence) };
    case 'visits':
      return doc.momentMessageId ? { momentMessageId: m(doc.momentMessageId) } : null;
    case 'messages':
      return doc.visitId ? { visitId: m(doc.visitId) } : null;
    case 'journal':
      return { happeningIds: list(doc.happeningIds) };
    default:
      return null;
  }
}
