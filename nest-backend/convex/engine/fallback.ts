// Deterministic, in-voice fallbacks. Used when no model is available. Honest by design:
// they only mention real happenings and real memories, and never pretend to recall.
import { STARTER_WORDS } from './growth';
import { makeRng, type Rng } from './rng';
import type { ConsolidateOutput, ConstellationOutput, JournalOutput, NameReactionOutput, ReplyOutput } from './schemas';
import type { JobEvent, PromptContext, PromptHappening, PromptMemory } from './prompt';
import type { CreatureAction, Emotion, MomentKind, Vitals } from './types';
import { DAY } from './time';

export function moodEmotion(v: Vitals): Emotion {
  if (v.energy < 0.2) return 'sleepy';
  if (v.longing > 0.6) return 'affectionate';
  if (v.valence > 0.35) return 'joy';
  if (v.curiosity > 0.7) return 'curious';
  if (v.valence < -0.3) return 'grumpy';
  return 'calm';
}

const SOUNDS: Record<Emotion, string[]> = {
  joy: ['*chirrups and bounces*', '*trills, very pleased*', '*spins once, delighted*'],
  calm: ['*blinks slowly at you*', '*hums a small hum*', '*settles down beside you*'],
  curious: ['*tilts its head*', '*sniffs at you, whiskers going*', '*peers closer*'],
  sleepy: ['*yawns enormously*', '*blinks, very slowly*', '*mumbles and curls up*'],
  grumpy: ['*huffs*', '*turns its back, then peeks*', '*grumbles low*'],
  shy: ['*hides behind its tail*', '*peeks out*'],
  mischievous: ['*wiggles, plotting something*', '*pokes you and pretends it did not*'],
  sad: ['*leans against you quietly*', '*makes a small, soft sound*'],
  surprised: ['*squeaks!*', '*jumps*'],
  affectionate: ['*nuzzles your thumb*', '*presses its whole head into your hand*', '*purrs*'],
};
const ACTION_FOR: Record<Emotion, CreatureAction> = {
  joy: 'bounce', calm: 'none', curious: 'tilt', sleepy: 'yawn', grumpy: 'stare', shy: 'hide', mischievous: 'wiggle', sad: 'none', surprised: 'bounce', affectionate: 'nuzzle',
};

function knownWords(ctx: PromptContext): string[] {
  return [...new Set([...STARTER_WORDS, ...ctx.creature.vocabulary])];
}

function hello(rng: Rng, ctx: PromptContext, emotion: Emotion): string {
  const lvl = ctx.creature.languageLevel;
  const sound = rng.pick(SOUNDS[emotion]);
  const name = ctx.creature.ownerName;
  if (lvl === 0) return sound;
  if (lvl === 1) return `${sound} ${rng.pick(['hi!', 'you!', 'hi.', name && ctx.creature.vocabulary.includes(name.toLowerCase()) ? `${name}!` : 'you.'])}`;
  if (lvl === 2) return `${sound} ${rng.pick(['you here. happy.', 'hi you. more?', 'you! look look.', 'hi. stay?'])}`;
  if (lvl === 3) return `${sound} ${rng.pick(['You came! I was being busy.', 'Oh. Hello you.', 'You smell like outside.'])}`;
  return `${sound} ${rng.pick(['There you are.', 'Oh, hello. I was just thinking.', 'You again. Good.', 'Hm. Hello.'])}`;
}

/** Tell one real thing from time away, at the creature's language level. */
function tell(h: PromptHappening, lvl: number): string {
  if (lvl <= 1) {
    if (h.data?.trinket) return `*shows you the ${String(h.data.trinket)}*`;
    if (h.kind === 'met_acquaintance') return `*acts out meeting a ${String(h.data?.species ?? 'friend')}*`;
    return '*tries very hard to tell you something with its paws*';
  }
  if (lvl === 2) {
    if (h.data?.trinket) return `look! shiny. *holds up the ${String(h.data.trinket)}*`;
    return `*wriggles* ${h.kind === 'met_acquaintance' ? 'friend! new friend.' : 'out. big. look.'}`;
  }
  return h.memoryText;
}

export function fallbackReply(ctx: PromptContext, event: JobEvent, seedKey: string): ReplyOutput {
  const rng = makeRng(seedKey, 'fallback');
  const v = ctx.creature.vitals;
  let emotion = moodEmotion(v);
  const lvl = ctx.creature.languageLevel;
  const shared: string[] = [];
  const parts: string[] = [];
  const asleep = ctx.creature.activity.kind === 'sleep';

  if (event.kind === 'moment') {
    const m = event.momentKind;
    emotion = momentEmotion(m, emotion);
    parts.push(momentLine(m, lvl, rng, ctx, event.detail));
  } else if (event.kind === 'note_reply') {
    parts.push(lvl === 0 ? '*sniffs your note all over, then sits on it*' : lvl <= 2 ? '*holds up your note* you. yes.' : lvl === 3 ? 'I found your note! I read it twice.' : 'I found your note when I got home. I read it twice.');
  } else if (event.kind === 'reply') {
    const question = /\?\s*$/.test(event.ownerText);
    parts.push(hello(rng, ctx, emotion));
    if (question && lvl >= 3) parts.push(lvl === 3 ? 'Hm. My head is all fog right now. Ask me later?' : 'My thoughts are slow and foggy just now. Ask me again in a bit?');
  } else {
    parts.push(hello(rng, ctx, emotion));
  }
  if (!asleep && ctx.happenings.length && event.kind !== 'reply') {
    const h = [...ctx.happenings].sort((a, b) => b.at - a.at)[0];
    parts.push(tell(h, lvl));
    shared.push(h.id);
  } else if (!asleep && ctx.happenings.length && event.kind === 'reply' && rng.chance(0.5)) {
    const h = ctx.happenings[0];
    parts.push(lvl >= 3 ? `Oh! ${h.memoryText}` : tell(h, lvl));
    shared.push(h.id);
  }
  void knownWords;
  return {
    say: parts.filter(Boolean).join(' ').slice(0, 600),
    emotion,
    action: ACTION_FOR[emotion],
    remember: [],
    ownerFacts: [],
    learnedWords: [],
    interests: [],
    sharedHappeningIds: shared,
  };
}

function momentEmotion(m: MomentKind, e: Emotion): Emotion {
  switch (m) {
    case 'first_touch': return 'surprised';
    case 'hatch': return 'surprised';
    case 'late_night_wake': return 'sleepy';
    case 'homecoming_long_absence': return 'affectionate';
    case 'knock_again': return 'mischievous';
    case 'gift': return 'joy';
    case 'anniversary': return 'joy';
    case 'quiet_visit': return 'calm';
    default: return e;
  }
}

function momentLine(m: MomentKind, lvl: number, rng: Rng, ctx: PromptContext, detail?: string): string {
  const L = (zero: string, low: string, mid: string, full: string) => (lvl === 0 ? zero : lvl <= 2 ? low : lvl === 3 ? mid : full);
  switch (m) {
    case 'first_touch': return '*the egg rocks, very slightly, toward your hand*';
    case 'hatch': return '*crack… crack… a damp little face pushes out of the shell and blinks at you*';
    case 'morning': return L('*stretches and squeaks a morning squeak*', '*stretches* morning! sun.', 'Morning! I was waiting for the light.', 'Good morning. I was hoping it would be you.');
    case 'late_night_wake': return L('*opens one eye… then the other… grumbles*', '*yawns* sleep… you?', 'Mm? Is it the night still? *yawns*', '*blinks* It is the middle of the night, you know. …Hello.');
    case 'homecoming_long_absence': return L('*runs in circles, then presses against your hand*', '*runs to you* you! you. home.', 'You came back! I waited by the door. Some days.', 'You were gone a long time. I waited by the door some days. I am glad you are back.');
    case 'returned_from_region': return L('*tumbles in through the door, out of breath*', '*runs in* out! home. *puffs*', 'I heard you and I came running all the way!', 'I heard you from outside and came running. Give me a moment, I am all puffed.');
    case 'knock_again': return L('*jumps* *stares at you*', 'again? *pokes back*', 'Again? You are tapping me again!', 'Again already? I am right here, you know.');
    case 'gift': return L('*pushes something toward you with its nose*', `*holds out a thing* you. for you.`, `I kept this for you! ${detail ?? ''}`.trim(), `I found something and I kept it for you. ${detail ?? ''}`.trim());
    case 'anniversary': return L('*is extra bouncy today*', '*bounces* happy. today.', 'Today feels like a special day. I do not know why!', 'Today feels special somehow. Like the day I came out of my egg.');
    case 'quiet_visit': return L('*shuffles closer and leans on you*', '*leans* stay.', 'Shh. Just sit with me.', '*settles against you* We do not have to talk.');
    default: return hello(rng, ctx, moodEmotion(ctx.creature.vitals));
  }
}

export function fallbackJournal(ctx: PromptContext, happenings: PromptHappening[]): JournalOutput {
  // Plain facts from the day, grouped in at most six entries. No invention.
  const sorted = [...happenings].sort((a, b) => a.at - b.at);
  const groups: PromptHappening[][] = [];
  for (const h of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.length < 3 && groups.length >= 6) last.push(h);
    else if (groups.length < 6) groups.push([h]);
    else groups[groups.length - 1].push(h);
  }
  return { entries: groups.map((g) => ({ happeningIds: g.map((h) => h.id), text: g.map((h) => h.summary).join(' ').slice(0, 900) })) };
}

export function fallbackConsolidate(now: number, episodes: PromptMemory[], seedKey: string): ConsolidateOutput {
  const rng = makeRng(seedKey, 'dream');
  const archive = episodes
    .filter((m) => m.kind === 'episode' && !m.pinned && m.salience < 0.3 && (m.recallCount ?? 0) === 0 && now - m.at > 7 * DAY)
    .slice(0, 40)
    .map((m) => m.id);
  const strong = episodes.filter((m) => m.salience >= 0.45);
  let dream: ConsolidateOutput['dream'] = null;
  if (strong.length >= 2) {
    const [a, b] = rng.shuffle(strong).slice(0, 2);
    dream = { text: `I dreamed that ${shorten(a.text)} — and then somehow ${shorten(b.text)} It was all mixed up together.`, fromMemoryIds: [a.id, b.id] };
  } else if (strong.length === 1) {
    dream = { text: `I dreamed about it again: ${shorten(strong[0].text)}`, fromMemoryIds: [strong[0].id] };
  }
  return { summaries: [], archiveMemoryIds: archive, beliefs: [], interests: [], dream, opinionShifts: [] };
}

function shorten(text: string): string {
  const t = text.replace(/^I /, 'I ').replace(/\s+/g, ' ').trim();
  const first = t.split(/(?<=[.!?])\s/)[0] ?? t;
  return first.length > 160 ? first.slice(0, 157) + '…' : first.charAt(0).toLowerCase() === 'i' ? first : first.charAt(0).toLowerCase() + first.slice(1);
}

export function fallbackNameReaction(ctx: PromptContext, name: string): NameReactionOutput {
  const lvl = ctx.creature.languageLevel;
  const syl = (name.match(/^[^aeiouy]*[aeiouy]+/i)?.[0] ?? name.slice(0, 2)).toLowerCase();
  const say = lvl === 0 ? `*tries to copy the sound* ${syl}… ${syl}! *chirrups*` : lvl <= 2 ? `*repeats it* ${name.toLowerCase()}? ${name.toLowerCase()}. me!` : lvl === 3 ? `${name}? ${name}! That is me now.` : `${name}. Yes. I think that is who I am.`;
  return { say: say.slice(0, 600), emotion: 'joy', action: 'spin', nameFeeling: 'It feels like it fits.' };
}

const C_ADJ = ['Sleeping', 'Lost', 'Little', 'Upside-Down', 'Hungry', 'Patient', 'Brave', 'Crooked', 'Shy', 'Dancing'];
const C_NOUN = ['Kettle', 'Snail', 'Lantern', 'Boat', 'Moth', 'Teacup', 'Heron', 'Mitten', 'Door', 'Acorn'];

export function fallbackConstellation(ctx: PromptContext, stars: number, seedKey: string): ConstellationOutput {
  const rng = makeRng(seedKey, 'constellation');
  const name = `The ${rng.pick(C_ADJ)} ${rng.pick(C_NOUN)}`;
  const lvl = ctx.creature.languageLevel;
  const story = lvl === 0 ? `*points at the ${stars} stars, one by one, and chirps at each*` : lvl <= 2 ? `*points* ${name.toLowerCase().replace('the ', '')}! stars. pretty.` : `That one is ${name}. It has ${stars} stars and it only comes out when we look together.`;
  return { name, story, emotion: 'joy' };
}
