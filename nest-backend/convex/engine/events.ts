// The event table: what can happen when an activity ends. Facts only; words come later.
//
// Text patterns use {S}/{s} for the subject ("It"/"I", "it"/"I") and {P}/{p} for the
// possessive ("Its"/"My", "its"/"my"), {o} for the object ("it"/"me"). Write verbs in the past tense so they read the same either way;
// a present-tense verb takes both forms: {has|have}, {keeps|keep}, {is|am} (third person first).
import { REGIONS, WORLD_FACTS, makeAcquaintanceName, makeTrinket, titleCase } from './catalog';
import { clamp, round, type Rng } from './rng';
import type {
  ActivityKind, AffinityKey, HappeningBelief, MarkKind, RegionId, SimAcquaintance, SimHappening, SimTrinket, SimWorld, TraitKey, WeatherKind,
} from './types';

export type EventCtx = {
  world: SimWorld;
  rng: Rng;
  t: number;
  hour: number;
  weather: WeatherKind;
  moon: number;
  activity: ActivityKind;
  regionId: RegionId;
  /** Acquaintance the activity was about (visit). */
  acquaintance?: SimAcquaintance;
};

export type EventOutcome = {
  kind: string;
  text: string;
  salience: number;
  shareable: boolean;
  valence: number;
  tags: string[];
  data?: Record<string, string | number | boolean>;
  affinity?: Partial<Record<AffinityKey, number>>;
  traits?: Partial<Record<TraitKey, number>>;
  vitals?: { energy?: number; valence?: number; curiosity?: number; longing?: number };
  newAcquaintance?: SimAcquaintance;
  acquaintanceUpdate?: { key: string; disposition: number; note?: string };
  newTrinket?: SimTrinket;
  discoverRegion?: RegionId;
  mark?: { kind: MarkKind; label: string; hue: number; flag: string };
  belief?: HappeningBelief;
  interest?: string;
  flag?: string;
};

export type EventTemplate = {
  id: string;
  on: ActivityKind[] | 'any';
  weight: number;
  when?: (c: EventCtx) => boolean;
  make: (c: EventCtx) => EventOutcome | null;
};

const regionName = (id: RegionId) => REGIONS[id].name;
const at = (id: RegionId) => (id === 'nest' ? 'at home' : `in ${regionName(id)}`.replace('in the ', 'at the '));
const known = (c: EventCtx) => c.world.acquaintances.filter((a) => a.regionId === c.regionId);
const shelf = (c: EventCtx) => c.world.trinkets.filter((t) => t.place === 'shelf');
const hasFlag = (c: EventCtx, f: string) => c.world.creature.flags.includes(f);
const isNight = (h: number) => h >= 21 || h < 5;
const keyOf = (c: EventCtx, kind: string) => `${kind}-${c.world.creature.tickCount}-${Math.floor(c.rng.next() * 1e6).toString(36)}`;

function newTrinket(c: EventCtx, place: SimTrinket['place'] = 'shelf'): SimTrinket {
  const made = makeTrinket(c.rng, c.regionId);
  return { key: keyOf(c, 'tr'), ...made, regionId: c.regionId, foundAt: c.t, place };
}

function newAcquaintance(c: EventCtx): SimAcquaintance {
  const species = c.rng.pick(REGIONS[c.regionId].species);
  return {
    key: keyOf(c, 'aq'), name: makeAcquaintanceName(c.rng), species, regionId: c.regionId,
    disposition: round(c.rng.range(-0.2, 0.6), 3), metAt: c.t, encounters: 1, lastSeenAt: c.t, notes: [],
  };
}

const sight = (c: EventCtx) => c.rng.pick(REGIONS[c.regionId].sights);
const sound = (c: EventCtx) => c.rng.pick(REGIONS[c.regionId].sounds);
const W = (c: EventCtx, ...kinds: WeatherKind[]) => kinds.includes(c.weather);

export const EVENTS: EventTemplate[] = [
  // ── Exploring ──────────────────────────────────────────────────────────
  {
    id: 'explore.trinket', on: ['explore'], weight: 2.2,
    when: (c) => c.regionId !== 'nest',
    make: (c) => {
      const tr = newTrinket(c);
      return { kind: 'found_trinket', text: `{S} found ${article(tr.name)} ${at(c.regionId)}: ${tr.description}. {S} carried it home.`, salience: tr.rarity === 'rare' ? 0.8 : tr.rarity === 'uncommon' ? 0.6 : 0.45, shareable: true, valence: 0.3, tags: ['trinket', c.regionId], newTrinket: tr, data: { trinket: tr.name, rarity: tr.rarity }, traits: { curiosity: 0.002 } };
    },
  },
  {
    id: 'explore.discover', on: ['explore'], weight: 2.5,
    when: (c) => !!c.world.regions[c.regionId] && !c.world.regions[c.regionId]?.discoveredAt,
    make: (c) => ({
      kind: 'discovered_region', text: `{S} went further than ever before and found ${regionName(c.regionId)}: ${REGIONS[c.regionId].biome}. {S} saw ${sight(c)}.`, salience: 0.85, shareable: true, valence: 0.5, tags: ['discovery', c.regionId], discoverRegion: c.regionId, traits: { boldness: 0.004, curiosity: 0.003 }, data: { region: c.regionId },
      mark: c.regionId === 'mossy-hollow' && !hasFlag(c, 'mark:first-moss') ? { kind: 'leaf', label: 'Moss from the first trip out', hue: 104, flag: 'mark:first-moss' } : undefined,
    }),
  },
  {
    id: 'explore.meet', on: ['explore', 'forage'], weight: 1.6,
    when: (c) => c.regionId !== 'nest' && known(c).length < 3,
    make: (c) => {
      const a = newAcquaintance(c);
      const mood = a.disposition > 0.3 ? 'They got on well.' : a.disposition < 0 ? 'They did not quite get on.' : 'They sized each other up.';
      return { kind: 'met_acquaintance', text: `{S} met a ${a.species} called ${a.name} ${at(c.regionId)}. ${mood}`, salience: 0.7, shareable: true, valence: a.disposition * 0.5, tags: ['acquaintance', a.species, c.regionId], newAcquaintance: a, data: { name: a.name, species: a.species }, traits: { warmth: 0.002 } };
    },
  },
  {
    id: 'explore.remeet', on: ['explore', 'forage'], weight: 2.2,
    when: (c) => known(c).length > 0,
    make: (c) => {
      const a = c.rng.pick(known(c));
      const delta = round(c.rng.range(-0.08, 0.15) + c.world.creature.traits.warmth * 0.05, 3);
      const what = delta > 0.05 ? c.rng.pick(['shared a snack', 'sat together a while', 'showed each other something', 'played a guessing game']) : delta < 0 ? c.rng.pick(['argued about whose rock it was', 'got in each other’s way', 'had a short, prickly chat']) : c.rng.pick(['nodded hello', 'walked a little way together']);
      return { kind: 'saw_acquaintance', text: `{S} ran into ${a.name} the ${a.species} again ${at(c.regionId)} and they ${what}.`, salience: 0.35 + Math.abs(delta), shareable: Math.abs(delta) > 0.08, valence: delta * 2, tags: ['acquaintance', a.species], acquaintanceUpdate: { key: a.key, disposition: delta, note: what }, data: { name: a.name } };
    },
  },
  {
    id: 'explore.view', on: ['explore'], weight: 2,
    make: (c) => ({ kind: 'noticed', text: `{S} stopped ${at(c.regionId)} to look at ${sight(c)} for a long time.`, salience: 0.25, shareable: false, valence: 0.15, tags: ['quiet', c.regionId], traits: { calm: 0.002 } }),
  },
  {
    id: 'explore.lost', on: ['explore'], weight: 0.8,
    when: (c) => c.regionId !== 'nest',
    make: (c) => ({ kind: 'mishap', text: `{S} got a little lost ${at(c.regionId)}, followed ${sound(c)} and found the way home again.`, salience: 0.55, shareable: true, valence: -0.1, tags: ['mishap', c.regionId], vitals: { energy: -0.08 }, traits: { boldness: 0.003 } }),
  },
  {
    id: 'explore.fact', on: ['explore', 'visit'], weight: 1.2,
    when: (c) => (WORLD_FACTS[c.regionId] ?? []).some((f) => !hasFlag(c, `fact:${f.key}`)),
    make: (c) => {
      const fact = c.rng.pick((WORLD_FACTS[c.regionId] ?? []).filter((f) => !hasFlag(c, `fact:${f.key}`)));
      return { kind: 'learned_fact', text: `{S} worked something out ${at(c.regionId)}: ${lowerFirst(fact.statement)}`, salience: 0.6, shareable: true, valence: 0.2, tags: ['fact', c.regionId], belief: { subject: 'world', key: fact.key, statement: fact.statement, confidence: 0.7 }, flag: `fact:${fact.key}`, traits: { curiosity: 0.003 } };
    },
  },
  {
    id: 'explore.first-rain-tidepools', on: ['explore', 'play'], weight: 6,
    when: (c) => c.regionId === 'tidepools' && W(c, 'rain', 'storm') && !hasFlag(c, 'mark:first-rain-tidepools'),
    make: () => ({ kind: 'first_time', text: '{S} watched rain fall on the Tidepools for the first time. Every pool rang with rings.', salience: 0.9, shareable: true, valence: 0.6, tags: ['rain', 'tidepools', 'first'], mark: { kind: 'ripple', label: 'First rain at the Tidepools', hue: 196, flag: 'mark:first-rain-tidepools' }, affinity: { tide: 3 } }),
  },
  {
    id: 'explore.meteor', on: ['explore', 'watch-weather'], weight: 5,
    when: (c) => (c.regionId === 'starfield-ridge' || c.activity === 'watch-weather') && isNight(c.hour) && W(c, 'clear') && !hasFlag(c, 'mark:meteor'),
    make: (c) => ({ kind: 'first_time', text: `{S} saw a shooting star ${c.regionId === 'nest' ? 'from the round window' : 'from Starfield Ridge'}. It was so bright {s} squeaked.`, salience: 0.92, shareable: true, valence: 0.7, tags: ['stars', 'meteor', 'first'], mark: { kind: 'star', label: 'The night of the shooting star', hue: 50, flag: 'mark:meteor' }, affinity: { umbra: 3, lumen: 1 } }),
  },
  {
    id: 'explore.hum-note', on: ['explore'], weight: 3,
    when: (c) => c.regionId === 'the-hum',
    make: (c) => {
      const first = !hasFlag(c, 'mark:hum');
      return { kind: first ? 'first_time' : 'strange', text: first ? '{S} stood inside the Hum until the note went all the way through {p} body. Afterwards {s} could still feel it.' : `{S} listened to ${sound(c)} at the Hum and felt something like a word.`, salience: first ? 0.95 : 0.6, shareable: true, valence: 0.3, tags: ['hum', 'strange'], mark: first ? { kind: 'spiral', label: 'The note at the Hum', hue: 280, flag: 'mark:hum' } : undefined, affinity: { umbra: 1.5, lumen: 1.5 } };
    },
  },
  {
    id: 'explore.mud', on: ['explore', 'play', 'forage'], weight: 1,
    when: (c) => W(c, 'rain', 'storm') || c.regionId === 'mossy-hollow',
    make: (c) => ({ kind: 'mishap', text: `{S} slipped into a muddy patch ${at(c.regionId)} and came home spotted with it. {S} did not seem to mind.`, salience: 0.4, shareable: true, valence: 0.05, tags: ['mishap', 'mud'], traits: { mischief: 0.003 } }),
  },
  {
    id: 'explore.for-owner', on: ['explore', 'forage'], weight: 1.2,
    when: (c) => c.regionId !== 'nest' && c.world.creature.relationship.trust > 0.3 && !c.world.trinkets.some((t) => t.place === 'forOwner'),
    make: (c) => {
      const tr = newTrinket(c, 'forOwner');
      return { kind: 'kept_for_owner', text: `{S} found ${article(tr.name)} ${at(c.regionId)} and decided right away it was a present for {p} person.`, salience: 0.75, shareable: false, valence: 0.5, tags: ['gift', 'owner'], newTrinket: tr, data: { trinket: tr.name }, traits: { warmth: 0.004 } };
    },
  },
  {
    id: 'explore.echo', on: ['explore', 'forage', 'tinker'], weight: 0.9,
    when: (c) => c.world.trinkets.length > 0 || c.world.acquaintances.length > 0,
    make: (c) => {
      if (c.world.trinkets.length && (!c.world.acquaintances.length || c.rng.chance(0.5))) {
        const tr = c.rng.pick(c.world.trinkets);
        return { kind: 'remembered', text: `Something ${at(c.regionId)} reminded {o} of the ${tr.name} {s} found ${tr.regionId === c.regionId ? 'here' : at(tr.regionId)}.`, salience: 0.35, shareable: false, valence: 0.15, tags: ['memory', 'trinket'] };
      }
      const a = c.rng.pick(c.world.acquaintances);
      return { kind: 'remembered', text: `{S} thought about ${a.name} the ${a.species} for no reason at all.`, salience: 0.3, shareable: false, valence: a.disposition * 0.3, tags: ['memory', 'acquaintance'] };
    },
  },
  // ── Foraging ───────────────────────────────────────────────────────────
  {
    id: 'forage.snack', on: ['forage'], weight: 3,
    make: (c) => ({ kind: 'foraged', text: `{S} foraged ${c.rng.pick(REGIONS[c.regionId].forage)} ${at(c.regionId)} and ate until round.`, salience: 0.2, shareable: false, valence: 0.25, tags: ['food'], vitals: { energy: 0.12 }, traits: { vitality: 0.002 } }),
  },
  {
    id: 'forage.feast', on: ['forage'], weight: 0.8,
    when: (c) => known(c).length > 0,
    make: (c) => {
      const a = c.rng.pick(known(c));
      return { kind: 'shared_food', text: `{S} found a big patch of ${c.rng.pick(REGIONS[c.regionId].forage)} and shared it with ${a.name} the ${a.species}.`, salience: 0.5, shareable: true, valence: 0.4, tags: ['food', 'acquaintance'], acquaintanceUpdate: { key: a.key, disposition: 0.1, note: 'shared food' }, vitals: { energy: 0.1 }, traits: { warmth: 0.004 } };
    },
  },
  {
    id: 'forage.taste', on: ['forage'], weight: 1.4,
    when: (c) => c.regionId !== 'nest',
    make: (c) => {
      const food = c.rng.pick(REGIONS[c.regionId].forage);
      const key = `likes:${slug(food)}`;
      const dkey = `dislikes:${slug(food)}`;
      if (hasFlag(c, key) || hasFlag(c, dkey)) return null;
      const likes = c.rng.chance(0.6);
      return { kind: likes ? 'new_favorite' : 'new_dislike', text: likes ? `{S} tried ${food} for the first time and decided {s} loved it.` : `{S} tried ${food}, made a face and spat it out. Never again.`, salience: 0.55, shareable: true, valence: likes ? 0.3 : -0.2, tags: ['food', likes ? 'likes' : 'dislikes'], belief: { subject: 'self', key: likes ? key : dkey, statement: likes ? `I love ${food}.` : `I hate ${food}.`, confidence: 0.8 }, flag: likes ? key : dkey };
    },
  },
  // ── Tinkering ──────────────────────────────────────────────────────────
  {
    id: 'tinker.make', on: ['tinker'], weight: 1.4,
    when: (c) => shelf(c).filter((t) => !t.key.startsWith('mk-')).length >= 2,
    make: (c) => {
      const [a, b] = c.rng.shuffle(shelf(c).filter((t) => !t.key.startsWith('mk-'))).slice(0, 2);
      const thing = c.rng.pick(['a tiny mobile', 'a necklace far too big for it', 'a little house for a beetle', 'a boat', 'a rattle', 'a crown']);
      const tr: SimTrinket = { key: keyOf(c, 'mk'), name: titleCase(thing.replace(/^an? /, '')), description: `${thing} made from the ${a.name} and the ${b.name}`, regionId: 'nest', foundAt: c.t, rarity: 'uncommon', place: 'shelf' };
      return { kind: 'made_something', text: `{S} spent a long time making ${thing} out of the ${a.name} and the ${b.name}.`, salience: 0.65, shareable: true, valence: 0.45, tags: ['made', 'trinket'], newTrinket: tr, data: { made: thing }, traits: { curiosity: 0.002, calm: 0.002 }, affinity: { ember: 0.5 } };
    },
  },
  {
    id: 'tinker.arrange', on: ['tinker'], weight: 1.5,
    when: (c) => shelf(c).length >= 1,
    make: (c) => ({ kind: 'tidied', text: `{S} rearranged the shelf so the ${c.rng.pick(shelf(c)).name} was in the middle.`, salience: 0.2, shareable: false, valence: 0.15, tags: ['shelf'], traits: { calm: 0.002 } }),
  },
  {
    id: 'tinker.knock', on: ['tinker', 'play'], weight: 0.6,
    when: (c) => shelf(c).length >= 1,
    make: (c) => ({ kind: 'mishap', text: `{S} knocked the ${c.rng.pick(shelf(c)).name} off the shelf. It was fine. {S} put it back very carefully.`, salience: 0.35, shareable: true, valence: -0.05, tags: ['mishap', 'shelf'], traits: { mischief: 0.002 } }),
  },
  // ── Play ───────────────────────────────────────────────────────────────
  {
    id: 'play.leaves', on: ['play'], weight: 2,
    when: (c) => W(c, 'wind', 'cloudy', 'clear'),
    make: (c) => ({ kind: 'played', text: `{S} chased ${W(c, 'wind') ? 'leaves the wind kept stealing' : 'a beetle round and round'} ${at(c.regionId)}.`, salience: 0.3, shareable: false, valence: 0.35, tags: ['play'], affinity: W(c, 'wind') ? { gale: 1 } : {}, traits: { mischief: 0.002, vitality: 0.002 }, vitals: { energy: -0.05 } }),
  },
  {
    id: 'play.puddles', on: ['play'], weight: 3,
    when: (c) => W(c, 'rain', 'storm'),
    make: () => ({ kind: 'played', text: '{S} jumped in every puddle by the door, one after another, twice.', salience: 0.45, shareable: true, valence: 0.5, tags: ['play', 'rain'], affinity: { tide: 1.2 }, traits: { mischief: 0.003 } }),
  },
  {
    id: 'play.shadow', on: ['play'], weight: 1.5,
    when: (c) => W(c, 'clear') && c.hour > 8 && c.hour < 18,
    make: () => ({ kind: 'played', text: '{S} tried to catch {p} own shadow. The shadow won.', salience: 0.35, shareable: true, valence: 0.35, tags: ['play', 'sun'], affinity: { ember: 0.8 } }),
  },
  {
    id: 'play.snow', on: ['play', 'explore'], weight: 4,
    when: (c) => W(c, 'snow'),
    make: (c) => {
      const first = !hasFlag(c, 'first-snow');
      return { kind: first ? 'first_time' : 'played', text: first ? '{S} saw snow for the first time, caught some on {p} tongue and made a very small snow-thing.' : '{S} made a lumpy snow-thing by the door.', salience: first ? 0.85 : 0.35, shareable: true, valence: 0.5, tags: ['snow', 'play'], flag: first ? 'first-snow' : undefined, mark: first ? { kind: 'dot', label: 'The first snow', hue: 205, flag: 'mark:first-snow' } : undefined, affinity: { gale: 1, umbra: 0.5 } };
    },
  },
  {
    id: 'play.with-acq', on: ['play', 'visit'], weight: 1.2,
    when: (c) => c.world.acquaintances.some((a) => a.disposition > 0.1),
    make: (c) => {
      const a = c.rng.pick(c.world.acquaintances.filter((x) => x.disposition > 0.1));
      const game = c.rng.pick(['hide-and-seek', 'a racing game', 'who-can-be-stillest', 'a game with pebbles']);
      return { kind: 'played_with', text: `{S} played ${game} with ${a.name} the ${a.species}.`, salience: 0.45, shareable: true, valence: 0.45, tags: ['play', 'acquaintance'], acquaintanceUpdate: { key: a.key, disposition: 0.06, note: `played ${game}` }, traits: { warmth: 0.002, mischief: 0.002 } };
    },
  },
  // ── Watching the weather / resting ─────────────────────────────────────
  {
    id: 'watch.storm', on: ['watch-weather', 'rest'], weight: 4,
    when: (c) => W(c, 'storm'),
    make: () => ({ kind: 'weather', text: '{S} watched lightning from the round window and counted to the thunder.', salience: 0.55, shareable: true, valence: 0.1, tags: ['storm', 'weather'], affinity: { gale: 1.5, ember: 0.8 }, traits: { boldness: 0.002 } }),
  },
  {
    id: 'watch.fog', on: ['watch-weather', 'rest'], weight: 3,
    when: (c) => W(c, 'fog'),
    make: () => ({ kind: 'weather', text: '{S} sat in the doorway listening to the fog. Everything sounded close and far at once.', salience: 0.35, shareable: false, valence: 0.05, tags: ['fog', 'weather'], affinity: { umbra: 0.6, tide: 0.4 }, traits: { calm: 0.003 } }),
  },
  {
    id: 'watch.rain', on: ['watch-weather', 'rest'], weight: 3,
    when: (c) => W(c, 'rain'),
    make: (c) => ({ kind: 'weather', text: `{S} counted raindrops on the window and got to ${c.rng.int(14, 212)} before losing count.`, salience: 0.3, shareable: true, valence: 0.15, tags: ['rain', 'weather'], affinity: { tide: 0.8 }, traits: { calm: 0.002 } }),
  },
  {
    id: 'watch.stars', on: ['watch-weather'], weight: 3,
    when: (c) => isNight(c.hour) && W(c, 'clear'),
    make: (c) => ({ kind: 'weather', text: `{S} watched the stars from the round window. The ${moonName(c.moon)} was out.`, salience: 0.35, shareable: false, valence: 0.25, tags: ['stars', 'moon'], affinity: { umbra: 1.2 } }),
  },
  {
    id: 'watch.sunrise', on: ['watch-weather', 'rest'], weight: 2.5,
    when: (c) => c.hour >= 6 && c.hour < 9 && W(c, 'clear'),
    make: () => ({ kind: 'weather', text: '{S} watched the sun come up through the round window until {p} whiskers were warm.', salience: 0.35, shareable: false, valence: 0.35, tags: ['sun', 'morning'], affinity: { ember: 1, lumen: 0.5 } }),
  },
  {
    id: 'rest.nap-spot', on: ['rest'], weight: 1,
    when: (c) => !hasFlag(c, `nap:${c.world.creature.stage}`),
    make: (c) => ({ kind: 'nap_spot', text: `{S} found a new favourite nap spot: ${c.rng.pick(['on top of the shelf', 'in the warm corner by the lantern', 'inside the doormat', 'under the round window'])}.`, salience: 0.4, shareable: true, valence: 0.3, tags: ['home', 'sleep'], flag: `nap:${c.world.creature.stage}`, vitals: { energy: 0.05 } }),
  },
  // ── Visiting ───────────────────────────────────────────────────────────
  {
    id: 'visit.tea', on: ['visit'], weight: 3,
    make: (c) => {
      const a = c.acquaintance;
      if (!a) return null;
      return { kind: 'visited', text: `{S} visited ${a.name} the ${a.species} ${at(a.regionId)}. They ${c.rng.pick(['sat in the sun', 'traded news', 'watched clouds', 'shared seeds'])}.`, salience: 0.4, shareable: true, valence: 0.35, tags: ['visit', 'acquaintance'], acquaintanceUpdate: { key: a.key, disposition: 0.08, note: 'visited' }, traits: { warmth: 0.003 } };
    },
  },
  {
    id: 'visit.quarrel', on: ['visit'], weight: 0.8,
    make: (c) => {
      const a = c.acquaintance;
      if (!a) return null;
      const about = c.rng.pick(['whose turn it was', 'the best kind of rain', 'a shiny thing they both saw first', 'nothing much']);
      return { kind: 'quarrel', text: `{S} and ${a.name} the ${a.species} had a squabble about ${about}. {S} came home grumbling.`, salience: 0.55, shareable: true, valence: -0.3, tags: ['visit', 'quarrel'], acquaintanceUpdate: { key: a.key, disposition: -0.12, note: `squabbled about ${about}` }, traits: { boldness: 0.002, calm: -0.002 } };
    },
  },
  {
    id: 'visit.story', on: ['visit'], weight: 1.2,
    make: (c) => {
      const a = c.acquaintance;
      if (!a) return null;
      const topic = c.rng.pick(['the sea at night', 'a place past the ridge that hums', 'the oldest tree', 'where wind is born', 'a lantern that never goes out', 'the stars']);
      return { kind: 'heard_story', text: `${a.name} the ${a.species} told {o} a long story about ${topic}.`, salience: 0.55, shareable: true, valence: 0.25, tags: ['story', 'acquaintance'], interest: topic, acquaintanceUpdate: { key: a.key, disposition: 0.04, note: `told a story about ${topic}` }, traits: { curiosity: 0.003 } };
    },
  },
  {
    id: 'visit.gift', on: ['visit'], weight: 0.6,
    when: (c) => (c.acquaintance?.disposition ?? 0) > 0.4,
    make: (c) => {
      const a = c.acquaintance!;
      const tr = { ...newTrinket({ ...c, regionId: a.regionId }), description: `a present from ${a.name} the ${a.species}` };
      return { kind: 'got_gift', text: `${a.name} the ${a.species} gave {o} ${article(tr.name)} to keep.`, salience: 0.7, shareable: true, valence: 0.5, tags: ['gift', 'acquaintance'], newTrinket: tr, acquaintanceUpdate: { key: a.key, disposition: 0.05, note: 'gave a present' } };
    },
  },
  // ── Waiting ────────────────────────────────────────────────────────────
  {
    id: 'wait.door', on: ['wait-by-door'], weight: 3,
    make: () => ({ kind: 'waited', text: '{S} waited by the little door for a while, ears up, in case {p} person came.', salience: 0.5, shareable: false, valence: -0.1, tags: ['owner', 'waiting'], vitals: { longing: -0.1 } }),
  },
  {
    id: 'wait.peace', on: ['wait-by-door'], weight: 1.5,
    make: (c) => ({ kind: 'made_peace', text: `{S} waited by the door, then decided to ${c.rng.pick(['go and look for shiny things', 'have a nap instead', 'make something', 'visit a friend'])}. {S} would see {p} person another day.`, salience: 0.4, shareable: false, valence: 0.05, tags: ['owner', 'waiting'], vitals: { longing: -0.25 }, traits: { calm: 0.003 } }),
  },
  // ── Sleep ──────────────────────────────────────────────────────────────
  {
    id: 'sleep.restless', on: ['sleep'], weight: 0.6,
    when: (c) => W(c, 'storm', 'wind'),
    make: () => ({ kind: 'woke_at_night', text: '{S} woke in the night at a noise, listened, and curled up again.', salience: 0.25, shareable: false, valence: -0.05, tags: ['sleep', 'night'] }),
  },
  {
    id: 'sleep.deep', on: ['sleep'], weight: 1,
    make: () => ({ kind: 'slept', text: '{S} slept the whole night through, tail over nose.', salience: 0.1, shareable: false, valence: 0.1, tags: ['sleep'] }),
  },
  // ── Ambient (any step at home) ─────────────────────────────────────────
  {
    id: 'ambient.visitor', on: ['rest', 'tinker', 'watch-weather'], weight: 1,
    when: (c) => c.world.acquaintances.some((a) => a.disposition > 0.3),
    make: (c) => {
      const a = c.rng.pick(c.world.acquaintances.filter((x) => x.disposition > 0.3));
      return { kind: 'had_visitor', text: `${a.name} the ${a.species} came by the nest and knocked. {S} was delighted.`, salience: 0.55, shareable: true, valence: 0.45, tags: ['visitor', 'acquaintance'], acquaintanceUpdate: { key: a.key, disposition: 0.05, note: 'visited the nest' } };
    },
  },
  {
    id: 'ambient.lantern', on: ['rest', 'tinker'], weight: 0.8,
    make: () => ({ kind: 'noticed', text: '{S} watched the lantern flicker and made shadow shapes on the wall.', salience: 0.25, shareable: false, valence: 0.2, tags: ['lantern', 'home'], affinity: { lumen: 0.8 } }),
  },
  {
    id: 'ambient.moon', on: ['watch-weather', 'rest'], weight: 2,
    when: (c) => isNight(c.hour) && c.moon > 0.47 && c.moon < 0.53 && !W(c, 'cloudy', 'rain', 'storm', 'fog'),
    make: () => ({ kind: 'weather', text: '{S} stared at the full moon for a long time and the moon, {s} was sure, stared back.', salience: 0.5, shareable: true, valence: 0.3, tags: ['moon', 'night'], affinity: { umbra: 1, lumen: 1 } }),
  },
];

export const EVENT_CHANCE: Record<ActivityKind, number> = {
  explore: 0.95, forage: 0.7, tinker: 0.6, play: 0.7, visit: 1, 'wait-by-door': 1, 'watch-weather': 0.65, rest: 0.25, sleep: 0.5, dream: 0,
};

/** Pick and resolve one event for an ended activity. */
export function rollEvent(c: EventCtx): EventOutcome | null {
  if (!c.rng.chance(EVENT_CHANCE[c.activity])) return null;
  const candidates = EVENTS.filter((e) => (e.on === 'any' || e.on.includes(c.activity)) && (!e.when || e.when(c)));
  for (let attempt = 0; attempt < 3 && candidates.length; attempt++) {
    const tpl = c.rng.weighted(candidates, (e) => e.weight);
    if (!tpl) return null;
    const out = tpl.make(c);
    if (out) return { ...out, data: { ...(out.data ?? {}), event: tpl.id } };
    candidates.splice(candidates.indexOf(tpl), 1);
  }
  return null;
}

export function toHappening(c: EventCtx, o: EventOutcome): SimHappening {
  return {
    at: c.t,
    kind: o.kind,
    regionId: c.regionId === 'nest' ? undefined : c.regionId,
    summary: voice(o.text, 'third'),
    memoryText: voice(o.text, 'first'),
    data: o.data ?? {},
    salience: round(clamp(o.salience), 3),
    shareable: o.shareable,
    tags: o.tags.slice(0, 5),
    valence: round(clamp(o.valence, -1, 1), 3),
    acquaintanceKey: o.newAcquaintance?.key ?? o.acquaintanceUpdate?.key,
    trinketKey: o.newTrinket?.key,
    mark: o.mark ? { kind: o.mark.kind, label: o.mark.label, hue: o.mark.hue } : undefined,
    belief: o.belief,
    interest: o.interest,
  };
}

export function voice(pattern: string, person: 'first' | 'third'): string {
  const first = person === 'first';
  return pattern
    .replace(/\{S\}/g, first ? 'I' : 'It')
    .replace(/\{s\}/g, first ? 'I' : 'it')
    .replace(/\{P\}/g, first ? 'My' : 'Its')
    .replace(/\{p\}/g, first ? 'my' : 'its')
    .replace(/\{o\}/g, first ? 'me' : 'it')
    // Present-tense verbs agree with the speaker: {has|have} is the third person form, then the first person one.
    .replace(/\{([a-z]+)\|([a-z]+)\}/g, (_, third: string, firstForm: string) => (first ? firstForm : third));
}

function article(name: string) {
  return /^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`;
}
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);
function moonName(phase: number) {
  if (phase > 0.45 && phase < 0.55) return 'full moon';
  if (phase < 0.05 || phase > 0.95) return 'new moon, barely there,';
  return phase < 0.5 ? 'growing moon' : 'shrinking moon';
}
