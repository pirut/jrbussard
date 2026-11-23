// Static world catalog: regions, who lives there, what can be found there.
import type { AffinityKey, RegionId, Stage, WeatherKind } from './types';
import type { Rng } from './rng';

export type Region = {
  id: RegionId;
  name: string;            // "the Tidepools"
  biome: string;
  minStage: Stage;
  /** Extra unlock rule beyond stage (explorations so far, trust). */
  minExplorations: number;
  minTrust: number;
  affinity: Partial<Record<AffinityKey, number>>;
  /** Small concrete things to notice (nouns). */
  sights: string[];
  sounds: string[];
  trinketNouns: string[];
  trinketMaterials: string[];
  species: string[];
  forage: string[];
  /** Weather it is especially good in. */
  loves: WeatherKind[];
};

export const REGIONS: Record<RegionId, Region> = {
  nest: {
    id: 'nest', name: 'the Nest', biome: 'a lantern-lit burrow', minStage: 'hatchling', minExplorations: 0, minTrust: 0,
    affinity: { lumen: 0.2, ember: 0.1 },
    sights: ['the lantern', 'the round window', 'the shelf', 'the key on its hook', 'the little door'],
    sounds: ['the lantern ticking', 'rain on the roof', 'the door creaking'],
    trinketNouns: [], trinketMaterials: [], species: [], forage: ['seeds from the doorstep'], loves: ['rain', 'storm'],
  },
  'mossy-hollow': {
    id: 'mossy-hollow', name: 'Mossy Hollow', biome: 'a damp green dell under old roots', minStage: 'hatchling', minExplorations: 0, minTrust: 0,
    affinity: { moss: 1, umbra: 0.25 },
    sights: ['a ring of toadstools', 'a root shaped like a hand', 'dew on the moss', 'a hollow log'],
    sounds: ['dripping', 'a slow creak in the roots', 'beetles ticking'],
    trinketNouns: ['acorn cap', 'seed pod', 'button', 'twig whistle', 'snail shell'],
    trinketMaterials: ['mossy', 'speckled', 'curled', 'velvet', 'hollow'],
    species: ['snail', 'beetle', 'mole', 'toad'], forage: ['mushroom crumbs', 'clover', 'sweet roots'], loves: ['rain', 'fog'],
  },
  tidepools: {
    id: 'tidepools', name: 'the Tidepools', biome: 'rock pools by a cold, bright sea', minStage: 'fledgling', minExplorations: 2, minTrust: 0,
    affinity: { tide: 1, lumen: 0.3 },
    sights: ['a pool with a tiny whirl in it', 'barnacles like little volcanoes', 'a gull feather', 'sea glass'],
    sounds: ['waves sucking at the rocks', 'gulls', 'bubbles popping in the weed'],
    trinketNouns: ['sea glass', 'shell', 'pebble', 'crab claw', 'knot of rope'],
    trinketMaterials: ['salt-white', 'blue', 'smooth', 'striped', 'wave-worn'],
    species: ['crab', 'heron', 'hermit crab', 'otter'], forage: ['sea grapes', 'kelp crisps'], loves: ['wind', 'clear'],
  },
  'lantern-wood': {
    id: 'lantern-wood', name: 'Lantern Wood', biome: 'a dim wood where fungus glows', minStage: 'fledgling', minExplorations: 3, minTrust: 0,
    affinity: { lumen: 1, ember: 0.35 },
    sights: ['glowing caps on a stump', 'a moth as big as a leaf', 'a spiderweb full of light', 'a lantern someone forgot'],
    sounds: ['a hush', 'wings', 'an owl asking something'],
    trinketNouns: ['glowcap', 'wing scale', 'wick', 'amber bead', 'firefly lamp'],
    trinketMaterials: ['glowing', 'amber', 'dusty', 'gold-flecked', 'warm'],
    species: ['moth', 'owl', 'firefly', 'dormouse'], forage: ['glowberries', 'honeydew'], loves: ['fog', 'cloudy'],
  },
  'old-wall': {
    id: 'old-wall', name: 'the Old Wall', biome: 'a crumbling stone wall in the sun', minStage: 'juvenile', minExplorations: 6, minTrust: 0.1,
    affinity: { ember: 0.7, gale: 0.5, moss: 0.25 },
    sights: ['a carved letter nobody can read', 'a lizard sunning', 'ivy pulling at a stone', 'a gap with a view'],
    sounds: ['wind whistling through the gaps', 'stones clicking as they warm'],
    trinketNouns: ['chip of tile', 'key', 'nail', 'carved stone', 'thimble'],
    trinketMaterials: ['rusty', 'sun-warm', 'chalky', 'red', 'ancient'],
    species: ['lizard', 'wren', 'field mouse', 'snail'], forage: ['wild thyme', 'sun-dried seeds'], loves: ['clear', 'wind'],
  },
  'starfield-ridge': {
    id: 'starfield-ridge', name: 'Starfield Ridge', biome: 'a high bare ridge close to the sky', minStage: 'juvenile', minExplorations: 10, minTrust: 0.2,
    affinity: { umbra: 1, gale: 0.6 },
    sights: ['the whole sky', 'a cairn of stones', 'frost on the grass', 'the valley lights far below'],
    sounds: ['wind', 'nothing at all', 'a fox barking far off'],
    trinketNouns: ['star-stone', 'ice crystal', 'feather', 'flint', 'meteor crumb'],
    trinketMaterials: ['black', 'silver', 'cold', 'glittering', 'night-blue'],
    species: ['fox', 'mountain goat', 'nightjar', 'hare'], forage: ['frosted berries', 'pine nuts'], loves: ['clear', 'snow'],
  },
  'the-hum': {
    id: 'the-hum', name: 'the Hum', biome: 'a place past the ridge where the air hums', minStage: 'adult', minExplorations: 25, minTrust: 0.45,
    affinity: { umbra: 0.5, lumen: 0.5, tide: 0.3 },
    sights: ['stones that lean toward each other', 'light with no source', 'a pond that does not ripple', 'its own footprints, already there'],
    sounds: ['a low hum', 'a note it could almost name', 'its own name, maybe'],
    trinketNouns: ['humming stone', 'spiral shell', 'glass seed', 'quiet bell'],
    trinketMaterials: ['strange', 'humming', 'impossible', 'pale'],
    species: ['hum-thing', 'listening heron'], forage: ['nothing it knows'], loves: ['fog', 'storm'],
  },
};

export const EXPLORABLE: RegionId[] = ['mossy-hollow', 'tidepools', 'lantern-wood', 'old-wall', 'starfield-ridge', 'the-hum'];

export const AFFINITY_HUES: Record<AffinityKey, number> = { tide: 196, ember: 18, moss: 104, gale: 168, lumen: 46, umbra: 258 };

export const AFFINITY_WORDS: Record<AffinityKey, string> = {
  tide: 'water and the sea', ember: 'warmth and fire', moss: 'growing green things',
  gale: 'wind and high places', lumen: 'light and glowing things', umbra: 'night and the stars',
};

const SYL_A = ['Bram', 'Tull', 'Pim', 'Odo', 'Wren', 'Saffi', 'Kip', 'Mosk', 'Juni', 'Fen', 'Rook', 'Tilly', 'Bex', 'Lom', 'Nib', 'Quill', 'Sorrel', 'Hap', 'Ivo', 'Marl'];
const SYL_B = ['', 'le', 'wick', 'o', 'ny', 'by', 'ett', 'kin', 'ka', 'som'];
const EPITHET = ['the Patient', 'Who Counts', 'of the Long Shell', 'the Loud', 'Half-Asleep', 'the Collector', 'the Elder', 'Two-Feathers', 'the Grumbler', 'Who Hums'];

export function makeAcquaintanceName(rng: Rng): string {
  const base = rng.pick(SYL_A) + rng.pick(SYL_B);
  return rng.chance(0.3) ? `${base} ${rng.pick(EPITHET)}` : base;
}

const TRINKET_PREFIX = ['Tidelace', 'Moonbutton', 'Hushstone', 'Emberling', 'Driftknot', 'Glimmer', 'Thimblewick', 'Dewdrop', 'Owlpenny', 'Sundot', 'Fogbell', 'Rootcurl', 'Starcrumb', 'Wishbone', 'Puddlecoin'];

export function makeTrinket(rng: Rng, regionId: RegionId): { name: string; description: string; rarity: 'common' | 'uncommon' | 'rare' } {
  const region = REGIONS[regionId];
  const noun = rng.pick(region.trinketNouns.length ? region.trinketNouns : ['pebble']);
  const material = rng.pick(region.trinketMaterials.length ? region.trinketMaterials : ['small']);
  const roll = rng.next();
  const rarity = roll < 0.08 ? 'rare' : roll < 0.3 ? 'uncommon' : 'common';
  const quirks = ['that is warm in the hand', 'with a hole right through it', 'that smells faintly of rain', 'that rattles when shaken', 'shaped almost like a heart', 'that catches the lantern light', 'with a tiny scratch like a letter', 'that is heavier than it looks'];
  const name = rarity === 'common' ? `${material} ${noun}` : `${rng.pick(TRINKET_PREFIX)} ${titleCase(noun)}`;
  return { name, description: `a ${material} ${noun} ${rng.pick(quirks)}`, rarity };
}

export const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** Facts it can learn about the world, per region. Factual within the pocket world. */
export const WORLD_FACTS: Partial<Record<RegionId, Array<{ key: string; statement: string }>>> = {
  'mossy-hollow': [
    { key: 'snails-and-rain', statement: 'Snails in Mossy Hollow come out after rain.' },
    { key: 'moss-warm', statement: 'Moss stays warm underneath even on cold mornings.' },
    { key: 'toadstool-ring', statement: 'The toadstool ring in Mossy Hollow grows back after it is kicked over.' },
  ],
  tidepools: [
    { key: 'crabs-clouds', statement: 'Crabs at the Tidepools hide when a cloud passes over.' },
    { key: 'tide-twice', statement: 'The sea comes up and goes away twice a day.' },
    { key: 'sea-glass', statement: 'Sea glass starts as something sharp and the waves make it soft.' },
  ],
  'lantern-wood': [
    { key: 'glowcaps-dark', statement: 'Glowcaps in Lantern Wood shine brighter the darker it gets.' },
    { key: 'moths-lanterns', statement: 'Moths in Lantern Wood follow anything that glows.' },
  ],
  'old-wall': [
    { key: 'wall-warm', statement: 'The stones of the Old Wall stay warm long after the sun goes.' },
    { key: 'wall-letters', statement: 'There are letters carved in the Old Wall that nobody can read.' },
  ],
  'starfield-ridge': [
    { key: 'stars-move', statement: 'The stars turn slowly around one still star.' },
    { key: 'ridge-cold', statement: 'It is always colder on Starfield Ridge than at home.' },
  ],
  'the-hum': [
    { key: 'hum-pitch', statement: 'The Hum changes its note when you are sad.' },
  ],
};
