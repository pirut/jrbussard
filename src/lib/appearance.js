/*
 * What a character looks like: the palettes and options a player may choose
 * from, and the ASCII portrait drawn from them.
 *
 * Responsibility: the closed set of allowed looks, defaults for players who
 * never customised, validation, and the portrait layout. It deliberately
 * stores nothing: the choice lives on the player row (`players.appearance`,
 * shaped by appearanceValidator in convex/schema.ts) and is written by
 * world:customize.
 *
 * Callers: convex/world.ts (appearanceValid on customize, appearanceOf when
 * building a snapshot); the browser's character editor and portrait
 * (src/arcade/CommonsCharacter.js), nametags and inspect panel, the 3D
 * figures (src/arcade/ascii3d/models.js), and the main site's citizens and
 * visitors (src/site3d/*); and the native app via apps/commons/src/shared.ts
 * (appearanceOf, playerColor, PALETTES; portraitRows is browser-only).
 *
 * Invariants:
 * - Imported by the Convex functions, the browser AND the native app, so it
 *   stays dependency-free plain JavaScript. Palette and option keys are
 *   stored in the database: renaming or removing one makes appearanceValid
 *   reject, and appearanceOf render with a missing colour for, existing
 *   players. Add new entries freely.
 * - The server is authoritative: appearanceValid is the gate, so only
 *   palette keys and listed options can ever be stored. Clients send keys,
 *   never colours or free text, and that keeps hostile strings (a sigil like
 *   "<script>") out of every other player's screen.
 */

/* Colour choices by category, as key -> hex. Players store the key
   ("chestnut"), never the hex, so a colour can be adjusted here without
   migrating stored data. */
export const PALETTES = {
  skin: {
    porcelain: "#efd0b1",
    sand: "#d7aa7e",
    bronze: "#b78056",
    umber: "#885638",
    ebony: "#583d30",
  },
  hair: {
    ink: "#55535a",
    ash: "#b9b7ac",
    chestnut: "#936344",
    copper: "#cd8251",
    gold: "#dcc586",
    moss: "#97ad84",
  },
  outfit: {
    fern: "#91ae81",
    tide: "#82b4bf",
    rust: "#d19875",
    plum: "#b799c6",
    ivory: "#e1d4b1",
    rose: "#d89d9e",
  },
  cloak: {
    pine: "#526e57",
    sea: "#476f80",
    wine: "#805364",
    dusk: "#666080",
    ochre: "#998151",
    charcoal: "#52585c",
  },
};
/* The non-colour choices. `sigil` is one character, shown beside the name in
   the character editor and labelled "World glyph" there. */
export const APPEARANCE_OPTIONS = {
  hairstyle: ["cropped", "long", "braids", "shaved"],
  headwear: ["none", "hood", "brim", "crown"],
  sigil: ["@", "&", "$", "Q"],
};
/* The look of anyone who has not customised, and the full list of keys a
   valid appearance must carry (appearanceValid walks these). */
export const DEFAULT_APPEARANCE = {
  skin: "sand",
  hair: "chestnut",
  outfit: "fern",
  cloak: "pine",
  hairstyle: "cropped",
  headwear: "none",
  sigil: "@",
};
/* A complete appearance for any player-shaped value: their saved choices
   over the defaults, so older rows and missing players still render. Does not
   validate; stored data is trusted because customize validated it. */
export function appearanceOf(player) {
  return { ...DEFAULT_APPEARANCE, ...player?.appearance };
}
/* Whether a candidate (from a client) names a known entry for every key. The
   server's gate on world:customize. Own-property check on the palettes so a
   key like "constructor" or "__proto__" cannot sneak through. */
export function appearanceValid(appearance) {
  return Object.entries(DEFAULT_APPEARANCE).every(
    ([key]) =>
      typeof appearance?.[key] === "string" &&
      (PALETTES[key]
        ? Object.hasOwn(PALETTES[key], appearance[key])
        : APPEARANCE_OPTIONS[key].includes(appearance[key])),
  );
}
/* The player's outfit colour as hex: their tint in nametags, the inspect
   panel and the native app's scene. */
export function playerColor(player) {
  const a = appearanceOf(player);
  return PALETTES.outfit[a.outfit] || PALETTES.outfit.fern;
}
/*
 * A paper doll: hair, skin, clothes, cloak, armor, and held equipment are
 * separate layers. Returns 9 rows of 9 cells, each { ch, color }, for the
 * character sheet. Each row below is written as [glyphs, roles]: `roles`
 * is a same-length string saying what each glyph is made of (s skin, h hair,
 * c cloak, o outfit, a armor, w weapon wood, b boots; a space falls back to
 * outfit). Armor tier 2 or more draws iron plate in iron grey, tier 1 the
 * woven coat. Browser-only (CommonsCharacter.js).
 */
export function portraitRows(player) {
  const a = appearanceOf(player),
    armor = player?.tools?.armor || 0;
  const colors = {
    s: PALETTES.skin[a.skin],
    h: PALETTES.hair[a.hair],
    c: PALETTES.cloak[a.cloak],
    o: PALETTES.outfit[a.outfit],
    a: armor >= 2 ? "#c8d2ce" : PALETTES.outfit[a.outfit],
    w: "#c6b58e",
    b: "#9b8772",
  };
  const hair = {
    cropped: "  .~~~.  ",
    long: "  /~~~\\  ",
    braids: "  {~~~}  ",
    shaved: "  .---.  ",
  }[a.hairstyle];
  const head = {
    none: "         ",
    hood: "  /^^^\\  ",
    brim: " _/___\\_ ",
    crown: "  \\|/|/  ",
  }[a.headwear];
  const rows = [
    [head, "ccccccccc"],
    [hair, "hhhhhhhhh"],
    [
      a.hairstyle === "braids"
        ? " { o o } "
        : a.hairstyle === "long"
          ? " | o o | "
          : "  |o o|  ",
      " hhssshh ",
    ],
    ["  \\_-_/  ", "  sssss  "],
    [
      armor >= 2 ? " /[===]\\ " : armor === 1 ? " /{+++}\\ " : " /|:::|\\ ",
      " c aaaa c",
    ],
    [
      armor >= 2 ? "| |[#]| |" : armor === 1 ? "| |+++| |" : "| |:::| |",
      "csoaaaosc",
    ],
    [player?.tools?.weapon ? "|/|___|/|" : "| |___| |", "cw ooo wc"],
    [" \\| | |/ ", " ccobobcc"],
    ["  /_|_\\  ", "  bbbbb  "],
  ];
  return rows.map(([line, roles]) =>
    Array.from(line).map((ch, i) => ({
      ch,
      color: colors[roles[i]] || colors.o,
    })),
  );
}
