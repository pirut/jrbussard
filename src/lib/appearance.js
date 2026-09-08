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
export const APPEARANCE_OPTIONS = {
  hairstyle: ["cropped", "long", "braids", "shaved"],
  headwear: ["none", "hood", "brim", "crown"],
  sigil: ["@", "&", "$", "Q"],
};
export const DEFAULT_APPEARANCE = {
  skin: "sand",
  hair: "chestnut",
  outfit: "fern",
  cloak: "pine",
  hairstyle: "cropped",
  headwear: "none",
  sigil: "@",
};
export function appearanceOf(player) {
  return { ...DEFAULT_APPEARANCE, ...player?.appearance };
}
export function appearanceValid(appearance) {
  return Object.entries(DEFAULT_APPEARANCE).every(
    ([key]) =>
      typeof appearance?.[key] === "string" &&
      (PALETTES[key]
        ? Object.hasOwn(PALETTES[key], appearance[key])
        : APPEARANCE_OPTIONS[key].includes(appearance[key])),
  );
}
export function playerColor(player) {
  const a = appearanceOf(player);
  return PALETTES.outfit[a.outfit] || PALETTES.outfit.fern;
}
/* A paper doll: hair, skin, clothes, cloak, armor, and held equipment are separate layers. */
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
