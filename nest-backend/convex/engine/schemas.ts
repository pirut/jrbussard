// Output contracts for AI jobs: the strict JSON schema sent to the model, and the
// server-side validator that is the only door from model text into creature state.
import { ACTIONS, EMOTIONS, type CreatureAction, type Emotion } from './types';

export const JOB_KINDS = ['reply', 'moment', 'note_reply', 'journal', 'consolidate', 'name_reaction', 'constellation'] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const MAX_OUTPUT_CHARS = 16_000;

export type ReplyOutput = {
  say: string;
  emotion: Emotion;
  action: CreatureAction;
  remember: { text: string; salience: number; tags: string[] }[];
  ownerFacts: { key: string; statement: string; confidence: number }[];
  learnedWords: string[];
  interests: string[];
  sharedHappeningIds: string[];
};
export type JournalOutput = { entries: { happeningIds: string[]; text: string }[] };
export type ConsolidateOutput = {
  summaries: { text: string; salience: number; tags: string[]; fromMemoryIds: string[] }[];
  archiveMemoryIds: string[];
  beliefs: { subject: 'owner' | 'self' | 'world'; key: string; statement: string; confidence: number; evidence: string[] }[];
  interests: string[];
  dream: { text: string; fromMemoryIds: string[] } | null;
  opinionShifts: { key: string; statement: string; confidence: number }[];
};
export type NameReactionOutput = { say: string; emotion: Emotion; action: CreatureAction; nameFeeling: string };
export type ConstellationOutput = { name: string; story: string; emotion: Emotion };
export type JobOutput = ReplyOutput | JournalOutput | ConsolidateOutput | NameReactionOutput | ConstellationOutput;

// ─── JSON schemas (OpenAI strict structured outputs: every key required, no extras) ──

const str = { type: 'string' } as const;
const num = (min: number, max: number) => ({ type: 'number', minimum: min, maximum: max });
const arr = (items: unknown, maxItems: number) => ({ type: 'array', items, maxItems });
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const emotion = { type: 'string', enum: [...EMOTIONS] };
const action = { type: 'string', enum: [...ACTIONS] };

const replySchema = obj({
  say: str, emotion, action,
  remember: arr(obj({ text: str, salience: num(0, 1), tags: arr(str, 5) }), 3),
  ownerFacts: arr(obj({ key: str, statement: str, confidence: num(0, 1) }), 3),
  learnedWords: arr(str, 5),
  interests: arr(str, 2),
  sharedHappeningIds: arr(str, 3),
});

export const JSON_SCHEMAS: Record<JobKind, { name: string; schema: Record<string, unknown> }> = {
  reply: { name: 'nest_reply_v1', schema: replySchema },
  moment: { name: 'nest_moment_v1', schema: replySchema },
  note_reply: { name: 'nest_note_reply_v1', schema: replySchema },
  journal: { name: 'nest_journal_v1', schema: obj({ entries: arr(obj({ happeningIds: arr(str, 20), text: str }), 6) }) },
  consolidate: {
    name: 'nest_consolidate_v1',
    schema: obj({
      summaries: arr(obj({ text: str, salience: num(0, 1), tags: arr(str, 5), fromMemoryIds: arr(str, 40) }), 6),
      archiveMemoryIds: arr(str, 40),
      beliefs: arr(obj({ subject: { type: 'string', enum: ['owner', 'self', 'world'] }, key: str, statement: str, confidence: num(0, 1), evidence: arr(str, 8) }), 8),
      interests: arr(str, 4),
      dream: { anyOf: [obj({ text: str, fromMemoryIds: arr(str, 8) }), { type: 'null' }] },
      opinionShifts: arr(obj({ key: str, statement: str, confidence: num(0, 1) }), 3),
    }),
  },
  name_reaction: { name: 'nest_name_reaction_v1', schema: obj({ say: str, emotion, action, nameFeeling: str }) },
  constellation: { name: 'nest_constellation_v1', schema: obj({ name: str, story: str, emotion }) },
};

// ─── Validation ──────────────────────────────────────────────────────────

export type ValidationContext = {
  /** Ids the model may reference (happenings shown, memories shown). Anything else is rejected. */
  happeningIds: string[];
  memoryIds: string[];
  /** Owner text for this job; learned words must appear in it. */
  ownerText: string;
};

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

class Invalid extends Error {}
const bad = (msg: string): never => { throw new Invalid(msg); };

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
function only(o: Record<string, unknown>, keys: string[], where: string) {
  for (const k of Object.keys(o)) if (!keys.includes(k)) bad(`unknown field ${where}.${k}`);
}
function s(x: unknown, max: number, where: string, required = true): string {
  if (x === undefined || x === null) return required ? bad(`missing ${where}`) : '';
  if (typeof x !== 'string') return bad(`${where} must be a string`);
  // Strip control characters except newline; cap length.
  // eslint-disable-next-line no-control-regex
  return x.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim().slice(0, max);
}
function n(x: unknown, where: string, min = 0, max = 1): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) return bad(`${where} must be a number`);
  return Math.min(max, Math.max(min, x));
}
function list<T>(x: unknown, max: number, where: string, item: (v: unknown, i: number) => T): T[] {
  if (x === undefined || x === null) return [];
  if (!Array.isArray(x)) return bad(`${where} must be an array`);
  return x.slice(0, max).map(item);
}
function oneOf<T extends string>(x: unknown, values: readonly T[], where: string): T {
  if (typeof x !== 'string' || !(values as readonly string[]).includes(x)) return bad(`${where} must be one of ${values.join(', ')}`);
  return x as T;
}
const tag = (x: unknown, i: number) => s(x, 32, `tags[${i}]`).toLowerCase().replace(/[^a-z0-9:_-]+/g, '-').slice(0, 32);
const factKey = (x: unknown, where: string) => {
  const k = s(x, 60, where).toLowerCase().replace(/[^a-z0-9:_-]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 48);
  return k || bad(`${where} is empty`);
};
/**
 * Ids the model cites. An id we never showed it is dropped, not fatal: one stray id must not throw away
 * an otherwise good answer (the validator's job is to keep invented ids out of state, and this does).
 */
const refs = (allowed: Set<string>, where: string) => (xs: unknown, max: number): string[] =>
  [...new Set(list(xs, max, where, (x) => s(x, 64, where)).filter((id) => allowed.has(id)))];

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}][\p{L}'’-]*/gu) ?? []).map((w) => w.replace(/[’']/g, "'"));
}

function validateReply(o: Record<string, unknown>, ctx: ValidationContext): ReplyOutput {
  only(o, ['say', 'emotion', 'action', 'remember', 'ownerFacts', 'learnedWords', 'interests', 'sharedHappeningIds'], 'output');
  const happenings = new Set(ctx.happeningIds);
  const ownerWords = new Set(tokenize(ctx.ownerText));
  const say = s(o.say, 600, 'say');
  return {
    say,
    emotion: oneOf(o.emotion, EMOTIONS, 'emotion'),
    action: oneOf(o.action, ACTIONS, 'action'),
    remember: list(o.remember, 3, 'remember', (r, i) => {
      if (!isObj(r)) return bad(`remember[${i}] must be an object`);
      only(r, ['text', 'salience', 'tags'], `remember[${i}]`);
      return { text: s(r.text, 280, `remember[${i}].text`), salience: n(r.salience, `remember[${i}].salience`), tags: list(r.tags, 5, 'tags', tag).filter(Boolean) };
    }).filter((r) => r.text.length > 0),
    ownerFacts: list(o.ownerFacts, 3, 'ownerFacts', (r, i) => {
      if (!isObj(r)) return bad(`ownerFacts[${i}] must be an object`);
      only(r, ['key', 'statement', 'confidence'], `ownerFacts[${i}]`);
      return { key: factKey(r.key, `ownerFacts[${i}].key`), statement: s(r.statement, 200, `ownerFacts[${i}].statement`), confidence: n(r.confidence, `ownerFacts[${i}].confidence`) };
    }).filter((r) => r.statement.length > 0),
    // Words are learned only if the owner actually said them in this exchange.
    learnedWords: [...new Set(list(o.learnedWords, 5, 'learnedWords', (w, i) => s(w, 24, `learnedWords[${i}]`).toLowerCase()))].filter((w) => ownerWords.has(w)),
    interests: list(o.interests, 2, 'interests', (x, i) => s(x, 60, `interests[${i}]`).toLowerCase()).filter(Boolean),
    sharedHappeningIds: refs(happenings, 'sharedHappeningIds')(o.sharedHappeningIds, 3),
  };
}

export function validateOutput(kind: JobKind, text: string, ctx: ValidationContext): Validated<JobOutput> {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'empty output' };
  if (text.length > MAX_OUTPUT_CHARS) return { ok: false, error: `output too large (${text.length} chars)` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    return { ok: false, error: 'output is not valid JSON' };
  }
  try {
    if (!isObj(parsed)) bad('output must be a JSON object');
    const o = parsed as Record<string, unknown>;
    const memories = new Set(ctx.memoryIds);
    const happenings = new Set(ctx.happeningIds);
    switch (kind) {
      case 'reply':
      case 'moment':
      case 'note_reply':
        return { ok: true, value: validateReply(o, ctx) };
      case 'journal': {
        only(o, ['entries'], 'output');
        const entries = list(o.entries, 6, 'entries', (e, i) => {
          if (!isObj(e)) return bad(`entries[${i}] must be an object`);
          only(e, ['happeningIds', 'text'], `entries[${i}]`);
          return { happeningIds: refs(happenings, `entries[${i}].happeningIds`)(e.happeningIds, 20), text: s(e.text, 900, `entries[${i}].text`) };
        }).filter((e) => e.text);
        return { ok: true, value: { entries } };
      }
      case 'consolidate': {
        only(o, ['summaries', 'archiveMemoryIds', 'beliefs', 'interests', 'dream', 'opinionShifts'], 'output');
        const memRefs = refs(memories, 'memory');
        const summaries = list(o.summaries, 6, 'summaries', (x, i) => {
          if (!isObj(x)) return bad(`summaries[${i}] must be an object`);
          only(x, ['text', 'salience', 'tags', 'fromMemoryIds'], `summaries[${i}]`);
          const cited = Array.isArray(x.fromMemoryIds) ? x.fromMemoryIds.length : 0;
          const fromMemoryIds = memRefs(x.fromMemoryIds, 40);
          // A summary that cites sources, none of them real, is made up: drop it.
          return { text: cited > 0 && !fromMemoryIds.length ? '' : s(x.text, 600, `summaries[${i}].text`), salience: n(x.salience, 'salience'), tags: list(x.tags, 5, 'tags', tag), fromMemoryIds };
        }).filter((x) => x.text);
        const beliefs = list(o.beliefs, 8, 'beliefs', (x, i) => {
          if (!isObj(x)) return bad(`beliefs[${i}] must be an object`);
          only(x, ['subject', 'key', 'statement', 'confidence', 'evidence'], `beliefs[${i}]`);
          return { subject: oneOf(x.subject, ['owner', 'self', 'world'] as const, 'subject'), key: factKey(x.key, 'key'), statement: s(x.statement, 200, 'statement'), confidence: n(x.confidence, 'confidence'), evidence: memRefs(x.evidence, 8) };
        }).filter((x) => x.statement);
        let dream: ConsolidateOutput['dream'] = null;
        if (o.dream !== null && o.dream !== undefined) {
          if (!isObj(o.dream)) bad('dream must be an object or null');
          const d = o.dream as Record<string, unknown>;
          only(d, ['text', 'fromMemoryIds'], 'dream');
          const from = memRefs(d.fromMemoryIds, 8);
          // A dream is kept only if it comes from at least one real memory.
          if (from.length) dream = { text: s(d.text, 900, 'dream.text'), fromMemoryIds: from };
        }
        return {
          ok: true,
          value: {
            summaries,
            archiveMemoryIds: memRefs(o.archiveMemoryIds, 40),
            beliefs,
            interests: list(o.interests, 4, 'interests', (x, i) => s(x, 60, `interests[${i}]`).toLowerCase()).filter(Boolean),
            dream: dream && dream.text ? dream : null,
            opinionShifts: list(o.opinionShifts, 3, 'opinionShifts', (x, i) => {
              if (!isObj(x)) return bad(`opinionShifts[${i}] must be an object`);
              only(x, ['key', 'statement', 'confidence'], `opinionShifts[${i}]`);
              return { key: factKey(x.key, 'key'), statement: s(x.statement, 200, 'statement'), confidence: n(x.confidence, 'confidence') };
            }).filter((x) => x.statement),
          },
        };
      }
      case 'name_reaction':
        only(o, ['say', 'emotion', 'action', 'nameFeeling'], 'output');
        return { ok: true, value: { say: s(o.say, 600, 'say'), emotion: oneOf(o.emotion, EMOTIONS, 'emotion'), action: oneOf(o.action, ACTIONS, 'action'), nameFeeling: s(o.nameFeeling, 200, 'nameFeeling', false) } };
      case 'constellation':
        only(o, ['name', 'story', 'emotion'], 'output');
        return { ok: true, value: { name: s(o.name, 40, 'name') || bad('name is empty'), story: s(o.story, 400, 'story'), emotion: oneOf(o.emotion, EMOTIONS, 'emotion') } };
      default:
        return { ok: false, error: `unknown job kind ${String(kind)}` };
    }
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    throw e;
  }
}

/** Accept a bare JSON object, or one wrapped in a ```json fence (text-mode fallback). */
export function extractJson(text: string): string {
  const t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fence ? fence[1] : t;
}

/**
 * Keep speech honest to the creature's language level: at level 0 only sounds in *asterisks*;
 * at 1–2 only known words outside asterisks. Returns '' if nothing is left.
 */
export function enforceLanguage(say: string, level: number, known: Set<string>): string {
  if (level >= 3) return say;
  const parts = say.split(/(\*[^*]{1,160}\*)/g);
  const out: string[] = [];
  const maxWords = level === 1 ? 2 : 5;
  let words = 0;
  for (const p of parts) {
    if (!p) continue;
    if (/^\*[^*]+\*$/.test(p)) { out.push(p); continue; }
    if (level === 0) continue;
    const kept = (p.match(/[\p{L}'’-]+|[.!?…]+/gu) ?? []).filter((w) => {
      if (/^[.!?…]+$/.test(w)) return true;
      if (words >= maxWords || !known.has(w.toLowerCase().replace(/[’]/g, "'"))) return false;
      words++;
      return true;
    });
    const joined = kept.join(' ').replace(/\s+([.!?…])/g, '$1').replace(/^[.!?…\s]+$/, '');
    if (joined) out.push(joined);
  }
  return out.join(' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * The mind streams raw partial JSON. Pull out the `say` string typed so far (tolerates an
 * unterminated string and a half-written escape), so the frontend shows clean typing text.
 */
export function extractPartialSay(partial: string): string | null {
  const m = /"say"\s*:\s*"/.exec(partial);
  if (!m) return null;
  let out = '';
  for (let i = m.index + m[0].length; i < partial.length; i++) {
    const ch = partial[i];
    if (ch === '"') break;
    if (ch !== '\\') { out += ch; continue; }
    const next = partial[i + 1];
    if (next === undefined) break;
    i++;
    if (next === 'n') out += '\n';
    else if (next === 't') out += '\t';
    else if (next === 'u') {
      const hex = partial.slice(i + 1, i + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 4;
    } else out += next; // \" \\ \/ and anything else literal
  }
  return out.slice(0, 600);
}
