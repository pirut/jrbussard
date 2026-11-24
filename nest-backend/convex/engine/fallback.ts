// Deterministic, in-voice fallbacks. Used when no model is available. Honest by design:
// they only mention real happenings and real memories, and never pretend to recall.
import { STARTER_WORDS } from './growth';
import { makeRng, type Rng } from './rng';
import type { ConsolidateOutput, ConstellationOutput, JournalOutput, NameReactionOutput, ReplyOutput } from './schemas';
import type { JobEvent, PromptContext, PromptHappening, PromptMemory } from './prompt';
import type { CreatureAction, Emotion, MomentKind, Vitals } from './types';
import { DAY, localTime } from './time';

export function moodEmotion(v: Vitals): Emotion {
  if (v.energy < 0.2) return 'sleepy';
  if (v.longing > 0.6) return 'affectionate';
  if (v.valence > 0.35) return 'joy';
  if (v.curiosity > 0.7) return 'curious';
  if (v.valence < -0.3) return 'grumpy';
  return 'calm';
}

// ---------------------------------------------------------------------------------------------
// Composition. A message is a list of segments: actions (third-person clauses with no subject,
// shown in *asterisks*) and speech. Consecutive actions merge into one sentence with a varied
// joiner, and every action block ends with punctuation, so nothing reads as glued fragments.
// Speech at language levels 1–2 uses only starter words (and learned ones), so the language
// filter never has to drop anything; level 1 says at most two words, level 2 at most five.
// ---------------------------------------------------------------------------------------------

type Seg = { act: string } | { say: string };
type Lvl = 0 | 1 | 2 | 3 | 4;
/** Pools by language level. Each level has its own pool: the word caps differ (level 1: two words, level 2: five). */
type ByLevel = Record<Lvl, string[]>;

const END = /[.!?…]$/;
const endWith = (s: string) => (END.test(s.trim()) ? s.trim() : `${s.trim()}.`);
const JOINERS = [', then ', '. After a moment it ', ', and then ', '. Then it ', '. A bit later it '];

/** Normalised for comparing phrasings: no asterisks, no punctuation, single spaces, lower case. */
export function plain(text: string): string {
  return text.toLowerCase().replace(/[*.,!?…—-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function render(segs: Seg[], rng: Rng): string {
  const out: string[] = [];
  let acts: string[] = [];
  const flush = () => {
    if (!acts.length) return;
    let text = acts[0].trim();
    for (const next of acts.slice(1)) text = `${text.replace(/[.!?…]+$/, '')}${rng.pick(JOINERS)}${next.trim()}`;
    out.push(`*${endWith(text)}*`);
    acts = [];
  };
  for (const s of segs) {
    if ('act' in s) { if (s.act.trim()) acts.push(s.act); continue; }
    flush();
    if (s.say.trim()) out.push(endWith(s.say));
  }
  flush();
  return out.join(' ');
}

/** A speech line that may start with an action: "*stretches.* sun!" → [{act}, {say}]. */
function parse(line: string): Seg[] {
  const segs: Seg[] = [];
  for (const part of line.split(/(\*[^*]+\*)/g)) {
    const p = part.trim();
    if (!p) continue;
    if (/^\*[^*]+\*$/.test(p)) segs.push({ act: p.slice(1, -1).replace(/[.!?…]+$/, '') });
    else segs.push({ say: p });
  }
  return segs;
}

const lvlOf = (n: number): Lvl => (n <= 0 ? 0 : n >= 4 ? 4 : (n as Lvl));

/** Pick from a pool, preferring lines whose words were not used in the last few creature messages. */
function pickFresh(rng: Rng, pool: string[], recent: string[]): string {
  const usable = pool.filter(Boolean);
  const fresh = usable.filter((p) => { const k = plain(p); return !recent.some((r) => r.includes(k)); });
  if (fresh.length) return rng.pick(fresh);
  const notLast = usable.filter((p) => !(recent[0] ?? '').includes(plain(p)));
  return rng.pick(notLast.length ? notLast : usable);
}

const fill = (pool: string[], vars: Record<string, string | undefined>) =>
  pool
    .filter((p) => !/\{(\w+)\}/.test(p) || [...p.matchAll(/\{(\w+)\}/g)].every((m) => !!vars[m[1]]))
    .map((p) => p.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? ''));

// --- Sounds and moods (level 0 actions, and the opener for ordinary hellos) ---

const SOUNDS: Record<Emotion, string[]> = {
  joy: ['chirrups and bounces', 'trills, very pleased with everything', 'spins once, delighted', 'does a small hop on the spot'],
  calm: ['blinks slowly at you', 'hums a small hum', 'settles down beside you', 'tucks its paws under and watches you'],
  curious: ['tilts its head', 'sniffs at you, whiskers going', 'peers closer', 'leans in to look at your fingers'],
  sleepy: ['yawns enormously', 'blinks, very slowly', 'mumbles and curls up', 'rests its chin on your thumb'],
  grumpy: ['huffs', 'turns its back, then peeks over its shoulder', 'grumbles low', 'flattens its ears at nothing in particular'],
  shy: ['hides behind its tail', 'peeks out', 'shuffles half a step closer'],
  mischievous: ['wiggles, plotting something', 'pokes you and pretends it did not', 'creeps up on your finger'],
  sad: ['leans against you quietly', 'makes a small, soft sound', 'presses close and goes still'],
  surprised: ['squeaks', 'jumps', 'goes all round-eyed'],
  affectionate: ['nuzzles your thumb', 'presses its whole head into your hand', 'purrs', 'wraps its tail around your finger'],
};
const ACTION_FOR: Record<Emotion, CreatureAction> = {
  joy: 'bounce', calm: 'none', curious: 'tilt', sleepy: 'yawn', grumpy: 'stare', shy: 'hide', mischievous: 'wiggle', sad: 'none', surprised: 'bounce', affectionate: 'nuzzle',
};

const HELLO: ByLevel = {
  0: [],
  1: ['hi!', 'you!', 'hi you.', 'you. hi!'],
  2: ['hi you! play?', 'you! look! look.', 'hi. stay?', 'you! happy.', 'hi! more you.', 'you. me. play?'],
  3: ['You came! I was being busy.', 'Oh. Hello you.', 'You smell like outside.', 'Hi! I was just sitting.', 'Oh good, it is you.'],
  4: ['There you are.', 'Oh, hello. I was just thinking.', 'You again. Good.', 'Hm. Hello.', 'Hello, you. I was hoping.', 'Oh! I did not hear you come in.'],
};

function hello(rng: Rng, ctx: PromptContext, emotion: Emotion, recent: string[]): Seg[] {
  const lvl = lvlOf(ctx.creature.languageLevel);
  const segs: Seg[] = [{ act: pickFresh(rng, SOUNDS[emotion], recent) }];
  if (lvl === 0) return segs;
  const name = ctx.creature.ownerName;
  const pool = [...HELLO[lvl]];
  if (lvl === 1 && name && ctx.creature.vocabulary.map((w) => w.toLowerCase()).includes(name.toLowerCase())) pool.push(`${name}!`);
  return [...segs, { say: pickFresh(rng, pool, recent) }];
}

// --- Telling one real thing from time away ---

// Neutral tellings fit any happening. Outing tellings ("the door", "out") only fit one that really was an outing.
const TELL_LOW = [
  'waves its paws about something that happened while you were away',
  'mimes something very big, then something very small, and looks at you hopefully',
  'tries very hard to tell you something with its paws',
  'bounces on the spot, as if it has news',
];
const TELL_LOW_OUT = ['pats the floor and points at the door, very serious', 'acts out a long walk, with lots of sniffing'];
const TELL_TWO = ['big! look.', 'look! pretty!', 'look. big!', 'pretty! you.'];
const TELL_TWO_OUT = ['out. look!', 'out! big.', 'go out. look.', 'out. pretty!'];
/** Did this happening take it out of the nest? True with a region, or for an exploring or visiting kind. */
const wentOut = (h: PromptHappening) => !!h.regionId || /^(explor|visit)/.test(h.kind);
const TELL_OPEN = ['Oh! ', 'Guess what. ', 'Also, ', 'Listen. ', 'While you were away, ', ''];

function tell(h: PromptHappening, lvl: Lvl, rng: Rng, recent: string[]): Seg[] {
  const trinket = h.data?.trinket ? String(h.data.trinket) : null;
  const species = h.data?.species ? String(h.data.species) : null;
  const out = wentOut(h);
  if (lvl <= 1) {
    if (trinket) return [{ act: pickFresh(rng, [`shows you the ${trinket}`, `holds up the ${trinket} for you to see`, `sets the ${trinket} in front of you, very carefully`], recent) }];
    if (h.kind === 'met_acquaintance' && species) return [{ act: pickFresh(rng, [`acts out meeting a ${species}`, `pretends to be a ${species}, quite badly`], recent) }];
    return [{ act: pickFresh(rng, out ? [...TELL_LOW, ...TELL_LOW_OUT] : TELL_LOW, recent) }];
  }
  if (lvl === 2) {
    if (trinket) return [{ act: `holds up the ${trinket}` }, { say: rng.pick(['look! shiny.', 'shiny! look.', 'look. pretty!']) }];
    if (h.kind === 'met_acquaintance') return [{ act: rng.pick(['wriggles', 'bounces']) }, { say: rng.pick(['friend! look.', 'friend! happy.', 'look! friend.']) }];
    return [{ act: pickFresh(rng, out ? ['points at the door', 'wriggles', 'waves its paws'] : ['wriggles', 'waves its paws', 'bounces'], recent) }, { say: pickFresh(rng, out ? [...TELL_TWO, ...TELL_TWO_OUT] : TELL_TWO, recent) }];
  }
  const text = h.memoryText.trim();
  const open = pickFresh(rng, TELL_OPEN, recent);
  // "While you were away, I met…" keeps "I" and names; common first words join the sentence in lower case.
  const joined = !open || /[.!?]\s$/.test(open) ? text : midSentence(text);
  return [{ say: `${open}${joined}` }];
}

// --- Moments ---

const L = (zero: string[], one: string[], two: string[], three: string[], four: string[]): ByLevel => ({ 0: zero, 1: one, 2: two, 3: three, 4: four });

const MOMENTS: Partial<Record<MomentKind, ByLevel>> = {
  morning: L(
    ['stretches all the way to its toes and squeaks a morning squeak', 'blinks at the light, then rolls over to face you', 'shakes the sleep out of its fur and chirps', 'yawns and stretches one leg, then the other'],
    ['*stretches.* sun!', '*blinks at the light.* hi!', '*yawns.* warm.', '*stretches.* hi you.'],
    ['*stretches.* sun! hi you.', '*yawns big.* sun. happy.', '*rubs its eyes.* hi! more sleep?', '*shakes its fur.* sun! play?'],
    ['Morning! I was waiting for the light.', 'Oh, you are up too! The light is all yellow.', 'Morning. My fur is still sleepy.', 'You came with the sun!'],
    ['Good morning. I was hoping it would be you.', 'Morning. The light came in sideways and woke me, and then you did.', 'There you are. I have been awake for ages. Well, a little while.', 'Morning! I saved you the warm spot.'],
  ),
  late_night_wake: L(
    ['opens one eye, then the other, and grumbles', 'burrows deeper into the nest and makes a small cross noise', 'lifts its head, blinks at you very slowly and sneezes', 'curls tighter, then peeks out from under its tail'],
    ['*yawns.* sleep?', '*blinks.* tired…', '*grumbles.* moon…', '*curls up.* sleep.'],
    ['*yawns.* sleep… you?', '*rubs its eyes.* moon. sleep.', '*grumbles.* tired. stay?', '*peeks out.* you? sleep.'],
    ['Mm? Is it the night still?', 'The moon is up and so are you. Why?', 'I was in the middle of a dream. *yawns*', 'Hm? It is so dark. Hello?'],
    ['It is the middle of the night, you know. Hello anyway.', 'Mm. I was dreaming about something. It is gone now.', 'You woke me. I do not mind. Much.', 'Is something wrong? No? Then sit with me while I wake up.'],
  ),
  homecoming_long_absence: L(
    ['runs in circles, then presses its whole body against your hand', 'freezes, stares, then bolts straight to you', 'chirps over and over and will not stop touching your fingers'],
    ['*runs to you.* you! home.', '*presses into your hand.* you!', '*squeaks.* stay!'],
    ['*runs to you.* you! home. stay?', '*clings to your thumb.* you! stay.', '*bounces.* you! happy. home!'],
    ['You came back! I waited by the door. Some days.', 'Where did you go? I checked the door lots.', 'You are back! I kept your spot warm.'],
    ['You were gone a long time. I waited by the door some days. I am glad you are back.', 'There you are. I had started to wonder. Come here.', 'You came back. I knew you would. Mostly.'],
  ),
  returned_from_region: L(
    ['tumbles in through the door, out of breath', 'skids in through the door with a leaf stuck to its ear', 'hurries in, shakes itself off and plops down beside you'],
    ['*runs in.* home!', '*puffs.* out. home.', '*skids in.* hi!'],
    ['*runs in.* out! home. hi!', '*puffs and puffs.* go out. home!', '*skids in.* home! you!'],
    ['I heard you and I came running all the way!', 'I was out in {region}, but I heard you!', 'I ran the whole way home. Hi!'],
    ['I heard you from outside and came running. Give me a moment, I am all puffed.', 'I was in {region} when I heard you. I came straight home.', 'I came back as fast as I could. My paws are still muddy.'],
  ),
  knock_again: L(
    ['jumps, then stares at you', 'pokes your finger right back', 'squints at you, very suspicious', 'hides its face, then peeks out'],
    ['*pokes back.* again?', '*stares.* again!', '*squints.* you!'],
    ['*pokes back.* again? you!', 'again! *pokes your finger.* play?', '*squints.* you. again?'],
    ['Again? You are tapping me again!', 'Hello again. And again!', 'I am still here! Look.'],
    ['Again already? I am right here, you know.', 'You just did that. I am not going anywhere.', 'Hello again. Did you forget something?'],
  ),
  gift: L(
    ['pushes something toward you with its nose', 'rolls a small thing to your hand and waits', 'drops something at your fingers and looks very proud'],
    ['*holds out a thing.* you!', '*pushes something to you.* shiny!', '*drops it by your hand.* look!'],
    ['*holds out a thing.* you! shiny.', '*pushes it over.* you. look!', '*drops it by your hand.* shiny! you.'],
    ['I kept this for you! It is {gift}.', 'Look! I found {gift} and I kept it for you.', 'This is for you. Do not lose it.'],
    ['I found something and I kept it for you. It is {gift}.', 'Here. {Gift}. I thought of you when I found it.', 'I have been saving this for you. Go on, take it.'],
  ),
  anniversary: L(
    ['is extra bouncy today', 'spins in a circle, then spins the other way', 'keeps bumping its head against your hand, very pleased'],
    ['*bounces.* happy!', '*spins.* happy.', '*hops about.* you! happy.'],
    ['*bounces.* happy. big happy!', '*spins.* happy! you. me.', '*hops about.* you! play. happy.'],
    ['Today feels like a special day. I do not know why!', 'Something about today is shiny. Is it you?', 'I feel all fizzy today. Do you?'],
    ['Today feels special somehow. Like the day I came out of my egg.', 'I woke up feeling like today was ours. Is that silly?', 'There is something about today. I keep wanting to stand close to you.'],
  ),
  quiet_visit: L(
    ['shuffles closer and leans on you', 'sits by your hand and hums', 'settles against your fingers and closes its eyes'],
    ['*leans on you.* stay.', '*hums.* warm.', '*settles in.* you. stay.'],
    ['*leans on you.* stay. warm.', '*settles in.* you. me. stay.', '*hums.* warm. you. stay.'],
    ['Shh. Just sit with me.', 'It is nice and quiet. Stay?', 'Let us just be here.'],
    ['*settles against you.* We do not have to talk.', 'Sit with me a while. The nest is quiet right now.', 'I like it when you just sit here.'],
  ),
};

const ONE_OFF: Partial<Record<MomentKind, string[]>> = {
  first_touch: ['the egg rocks, very slightly, toward your hand', 'something inside the egg taps back, once', 'the egg goes a little warmer under your fingers'],
  hatch: [
    'crack… crack… a damp little face pushes out of the shell and blinks at you',
    'the shell splits down the middle and a small wet creature tumbles out, staring up at you',
    'one tiny paw breaks through, then a nose, then two huge eyes, all looking at you',
  ],
};

function giftName(detail?: string): string | undefined {
  const m = detail ? /the present is ([^:]+)/.exec(detail) : null;
  return m ? m[1].trim() : undefined;
}
function regionName(detail?: string): string | undefined {
  const m = detail ? /you were in (.+)$/.exec(detail) : null;
  return m ? m[1].trim() : undefined;
}

function momentSegs(m: MomentKind, ctx: PromptContext, rng: Rng, recent: string[], detail?: string): Seg[] {
  const lvl = lvlOf(ctx.creature.languageLevel);
  const once = ONE_OFF[m];
  if (once) return [{ act: pickFresh(rng, once, recent) }];
  const pools = MOMENTS[m];
  if (!pools) return hello(rng, ctx, moodEmotion(ctx.creature.vitals), recent);
  const gift = giftName(detail);
  const pool = fill(pools[lvl], { gift, Gift: gift && gift.charAt(0).toUpperCase() + gift.slice(1), region: regionName(detail) });
  const line = pickFresh(rng, pool, recent);
  return lvl === 0 ? [{ act: line }] : parse(line);
}

const NOTE: ByLevel = {
  0: ['sniffs your note all over, then sits on it', 'carries your note around the nest and tucks it under its tail', 'turns your note over and over, then curls up on it'],
  1: ['*holds up your note.* you!', '*hugs your note.* you.', '*sniffs your note.* yes!'],
  2: ['*holds up your note.* you. yes. happy.', '*hugs your note.* you! happy.', '*sniffs your note.* you! more?'],
  3: ['I found your note! I read it twice.', 'Your note was waiting for me! I read it lots.', 'I got your note. I kept it under my pillow.'],
  4: ['I found your note when I got home. I read it twice.', 'Your note was here when I came in. I liked finding it.', 'I read your note. Then I read it again, slower.'],
};
const FOG: Record<3 | 4, string[]> = {
  3: ['Hm. My head is all fog right now. Ask me later?', 'My thinking is foggy. Ask again soon?', 'All fog in here today. Later?'],
  4: ['My thoughts are slow and foggy just now. Ask me again in a bit?', 'There is fog in my head at the moment. Try me again later?', 'I cannot see that one through the fog right now. Ask me later?'],
};

/** The last few things it said, newest first, normalised. */
function recentSaid(ctx: PromptContext, n = 6): string[] {
  return ctx.messages.filter((m) => m.role === 'creature' && m.text).slice(-n).reverse().map((m) => plain(m.text));
}

function compose(ctx: PromptContext, event: JobEvent, rng: Rng, recent: string[]): { say: string; emotion: Emotion; shared: string[] } {
  const v = ctx.creature.vitals;
  let emotion = moodEmotion(v);
  const lvl = lvlOf(ctx.creature.languageLevel);
  const shared: string[] = [];
  const segs: Seg[] = [];
  const asleep = ctx.creature.activity.kind === 'sleep';

  if (event.kind === 'moment') {
    emotion = momentEmotion(event.momentKind, emotion);
    segs.push(...momentSegs(event.momentKind, ctx, rng, recent, event.detail));
  } else if (event.kind === 'note_reply') {
    const line = pickFresh(rng, NOTE[lvl], recent);
    segs.push(...(lvl === 0 ? [{ act: line }] : parse(line)));
  } else if (event.kind === 'reply') {
    const question = /\?\s*$/.test(event.ownerText);
    // A question it cannot think through gets a sound and an honest "fog", not a greeting and a story on top.
    if (question && lvl >= 3) segs.push({ act: pickFresh(rng, SOUNDS[emotion], recent) }, { say: pickFresh(rng, FOG[lvl as 3 | 4], recent) });
    else segs.push(...hello(rng, ctx, emotion, recent));
  } else {
    segs.push(...hello(rng, ctx, emotion, recent));
  }
  const oneOff = event.kind === 'moment' && !!ONE_OFF[event.momentKind];
  // The trinket it is handing over in this very moment is not also "something it found while you were away".
  const gift = event.kind === 'moment' && event.momentKind === 'gift' ? giftName(event.detail)?.toLowerCase() : undefined;
  const tellable = gift ? ctx.happenings.filter((x) => String(x.data?.trinket ?? '').toLowerCase() !== gift) : ctx.happenings;
  if (!asleep && !oneOff && tellable.length && event.kind !== 'reply') {
    const h = [...tellable].sort((a, b) => b.at - a.at)[0];
    segs.push(...tell(h, lvl, rng, recent));
    shared.push(h.id);
  } else if (!asleep && tellable.length && event.kind === 'reply' && !(/\?\s*$/.test(event.ownerText) && lvl >= 3) && rng.chance(0.5)) {
    const h = tellable[0];
    segs.push(...tell(h, lvl, rng, recent));
    shared.push(h.id);
  }
  return { say: render(segs, rng).slice(0, 600), emotion, shared };
}

export function fallbackReply(ctx: PromptContext, event: JobEvent, seedKey: string): ReplyOutput {
  const recent = recentSaid(ctx);
  const last = new Set(recent.slice(0, 3));
  let out = compose(ctx, event, makeRng(seedKey, 'fallback'), recent);
  // Never say the same thing word for word as one of the last few messages.
  for (let i = 1; i < 8 && last.has(plain(out.say)); i++) out = compose(ctx, event, makeRng(seedKey, 'fallback', i), recent);
  return {
    say: out.say,
    emotion: out.emotion,
    action: ACTION_FOR[out.emotion],
    remember: [],
    ownerFacts: [],
    learnedWords: [],
    interests: [],
    sharedHappeningIds: out.shared,
  };
}

function momentEmotion(m: MomentKind, e: Emotion): Emotion {
  switch (m) {
    case 'first_touch': return 'surprised';
    case 'hatch': return 'surprised';
    case 'late_night_wake': return 'sleepy';
    case 'homecoming_long_absence': return 'affectionate';
    case 'knock_again': return 'mischievous';
    case 'returned_from_region': return 'joy';
    case 'gift': return 'joy';
    case 'anniversary': return 'joy';
    case 'quiet_visit': return 'calm';
    default: return e;
  }
}

/** Words the creature can say at levels 1–2 (used by tests to check nothing gets filtered out). */
export function knownWords(ctx: PromptContext): Set<string> {
  return new Set([...STARTER_WORDS, ...ctx.creature.vocabulary].map((w) => w.toLowerCase()));
}

// --- Journal ---

const PART_OPEN: Record<'night' | 'morning' | 'afternoon' | 'evening', string[]> = {
  night: ['In the night, ', 'Very late, ', 'While it was dark, ', 'Long after dark, ', 'Under the moon, ', 'In the small hours, '],
  morning: ['In the morning, ', 'Early on, ', 'First thing, ', 'As the day began, ', 'Before noon, ', 'With the morning light, '],
  afternoon: ['In the afternoon, ', 'Around midday, ', 'After lunch, ', 'As the day went on, ', 'Somewhere past noon, ', 'In the long middle of the day, '],
  evening: ['In the evening, ', 'As it got dark, ', 'Towards bedtime, ', 'As the light went, ', 'When the lantern was lit, ', 'At the end of the day, '],
};
const NEXT = ['Later, ', 'After that, ', 'Then ', '', 'A bit later, '];
const TIMES = ['', '', 'twice', 'three times', 'four times', 'five times'];

const partOf = (hour: number) => (hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening');
/** A sentence carried on after a lead-in or "that": common first words go lower case, names keep their capital. */
const COMMON_START = /^(It|Its|It's|Something|Someone|Somebody|The|A|An|Some|One|There|My|Me|This|That)\b/;
export function midSentence(sentence: string): string {
  return COMMON_START.test(sentence) ? sentence.charAt(0).toLowerCase() + sentence.slice(1) : sentence;
}
/** "It found…" can take a lead-in ("Later, it found…"); a sentence that starts with a name keeps its capital. */
const lead = (open: string, sentence: string) => (!open ? sentence : `${open}${midSentence(sentence)}`);

/**
 * Plain facts from the day, grouped by part of the day (at most six entries). The same happening text
 * is written once, with a count, instead of once per occurrence. No invention. `recent` holds the
 * newest journal entries; an entry that would repeat one word for word is phrased differently.
 */
export function fallbackJournal(ctx: PromptContext, happenings: PromptHappening[], seedKey = 'journal', recent: string[] = []): JournalOutput {
  const sorted = [...happenings].sort((a, b) => a.at - b.at);
  type Item = { summary: string; ids: string[]; at: number };
  const unique: Item[] = [];
  const bySummary = new Map<string, Item>();
  for (const h of sorted) {
    const key = plain(h.summary);
    const seen = bySummary.get(key);
    if (seen) { seen.ids.push(h.id); continue; }
    const item = { summary: h.summary.trim(), ids: [h.id], at: h.at };
    bySummary.set(key, item);
    unique.push(item);
  }
  const groups: { part: ReturnType<typeof partOf>; items: Item[] }[] = [];
  for (const it of unique) {
    const part = partOf(localTime(it.at, ctx.timezone).hour);
    const last = groups[groups.length - 1];
    if (last && (last.part === part || groups.length >= 6) && last.items.length < 4) last.items.push(it);
    else if (groups.length < 6) groups.push({ part, items: [it] });
    else last.items.push(it);
  }
  const old = new Set(recent.map(plain));
  const write = (g: (typeof groups)[number], rng: Rng) =>
    g.items.map((it, i) => {
      const n = it.ids.length;
      const times = n > 1 ? ` ${rng.pick(['That happened', 'It happened'])} ${TIMES[Math.min(n, 5)]}${n > 5 ? ' or more' : ''} in all.` : '';
      return lead(i === 0 ? rng.pick(PART_OPEN[g.part]) : rng.pick(NEXT), endWith(it.summary)) + times;
    }).join(' ').slice(0, 900);
  const entries = groups.map((g, gi) => {
    let text = write(g, makeRng(seedKey, 'journal', gi));
    for (let k = 1; k < 8 && old.has(plain(text)); k++) text = write(g, makeRng(seedKey, 'journal', gi, k));
    old.add(plain(text));
    return { happeningIds: g.items.flatMap((it) => it.ids), text };
  });
  return { entries };
}

export function fallbackConsolidate(now: number, episodes: PromptMemory[], seedKey: string): ConsolidateOutput {
  const rng = makeRng(seedKey, 'dream');
  const archive = episodes
    .filter((m) => m.kind === 'episode' && !m.pinned && m.salience < 0.3 && (m.recallCount ?? 0) === 0 && now - m.at > 7 * DAY)
    .slice(0, 40)
    .map((m) => m.id);
  const strong = episodes.filter((m) => m.salience >= 0.45);
  let dream: ConsolidateOutput['dream'] = null;
  // Two different memories make a dream; two tellings of the same thing ("I hatched." / "I hatched, and…") do not.
  const pair = (() => {
    const order = rng.shuffle(strong);
    for (const x of order) for (const y of order) if (x !== y && overlap(x.text, y.text) < 0.5) return [x, y];
    return null;
  })();
  if (pair) {
    const [a, b] = pair;
    dream = { text: `I dreamed that ${shorten(a.text).replace(/[.!?…]+$/, '')}, and then somehow ${shorten(b.text).replace(/[.!?…]*$/, '.')} It was all mixed up together.`, fromMemoryIds: [a.id, b.id] };
  } else if (strong.length >= 1) {
    dream = { text: `I dreamed about it again: ${shorten(strong[0].text)}`, fromMemoryIds: [strong[0].id] };
  }
  return { summaries: [], archiveMemoryIds: archive, beliefs: [], interests: [], dream, opinionShifts: [] };
}

/** Share of the shorter text's words that the other text also has. */
function overlap(a: string, b: string): number {
  const wa = new Set(plain(a).split(' ')), wb = new Set(plain(b).split(' '));
  const [small, big] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  let n = 0;
  for (const w of small) if (big.has(w)) n++;
  return small.size ? n / small.size : 1;
}

function shorten(text: string): string {
  const t = text.replace(/^I /, 'I ').replace(/\s+/g, ' ').trim();
  const first = t.split(/(?<=[.!?])\s/)[0] ?? t;
  return first.length > 160 ? first.slice(0, 157) + '…' : midSentence(first);
}

export function fallbackNameReaction(ctx: PromptContext, name: string): NameReactionOutput {
  const lvl = ctx.creature.languageLevel;
  const syl = (name.match(/^[^aeiouy]*[aeiouy]+/i)?.[0] ?? name.slice(0, 2)).toLowerCase();
  // Below level 3 the name is not a word it knows yet, so it lives inside the action, where the language filter keeps it.
  const say = lvl === 0 ? `*tries to copy the sound, "${syl}… ${syl}!", then chirrups, very pleased.*` : lvl <= 2 ? `*says it over and over, "${name.toLowerCase()}… ${name.toLowerCase()}?", and points at itself.* me!` : lvl === 3 ? `${name}? ${name}! That is me now.` : `${name}. Yes. I think that is who I am.`;
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
