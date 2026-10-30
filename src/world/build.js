/*
 * Builds the site overworld: the portfolio's tile city.
 *
 * Responsibility: turn the hand-authored data in rooms.js (rooms, roads,
 * lakes, spawn) plus the vocabulary in tiles.js into flat grids, and invent
 * the ground between the rooms (grass, lakes, the packed tenement blocks and
 * their alleys). It returns a plain "world" object of grids and lookups.
 *
 * It does not draw (render.js and site3d/ do), does not move anything
 * (motion.js does, using `world.isSolid`), and knows nothing about the
 * Commons or the server. Walls and solidity here are enforced only by the
 * browser's own walking code; convex/site.ts merely relays positions and
 * never sees this map. The Commons' terrain (src/lib/terrain.js) is a
 * separate, unrelated system shared with the server.
 *
 * Called from pages/World.js (once, in a useMemo) and the tests. The result
 * is read by render.js, navigation.js, components/Minimap.js and the 3D
 * scene (site3d/SiteScene.js, citizens.js).
 *
 * Invariants:
 * - Deterministic: fixed seeds and no Math.random or clock, so every visit,
 *   and every visitor, gets the identical city. Because one seeded generator
 *   feeds several steps, adding or removing a single rng() call re-rolls
 *   everything drawn after it; keep the order of draws stable unless you
 *   mean to change the look.
 * - Every grid is indexed `y * w + x`.
 * - The spawn is reachable from every room and every interactive prop is
 *   approachable (build.test.js checks this), which is why step 7 exists;
 *   lanes.test.js also keeps the atrium crossing clear.
 */
import {
    KIND,
    GLYPH,
    SOLID,
    INTERACTIVE,
    AUTHOR_CHARS,
    wallGlyph,
} from "./tiles";
import { ROOMS, ROADS, LAKES, SPAWN, WORLD_W, WORLD_H } from "./rooms";
import { fbm } from "../lib/noise";

/* Deterministic noise so the forest looks the same on every visit.
   mulberry32 is a small public-domain seeded PRNG: returns a function that
   yields floats in [0, 1) and the same sequence for the same seed. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/* Glyphs scattered over open ground. Repeats weight the pick: mostly plain
   commas, an occasional tuft or blank. */
const GRASS_CHARS = [",", ",", ",", "'", '"', "`", " "];
/* Worn ground: mostly nothing, so clearings breathe. */
const BARE_CHARS = [" ", " ", " ", " ", ".", ",", "`"];

/* Night outside; each room sets its own level in rooms.js. */
const OUTDOOR_AMBIENT = 0.26;

/* Whether tile (x, y) lies inside any {x, y, w, h} rect grown by `pad` tiles
   on every side. */
function rectsOverlap(x, y, rects, pad) {
    return rects.some(
        (r) =>
            x >= r.x - pad &&
            x < r.x + r.w + pad &&
            y >= r.y - pad &&
            y < r.y + r.h + pad
    );
}

/* Each road as a rect covering its three-wide strip, so it can be fed to
   rectsOverlap. Only valid for axis-aligned roads, which is all rooms.js
   allows: the strip is `from`..`to` long and one tile either side wide. */
function roadRects() {
    return ROADS.map(({ from, to }) => {
        const x = Math.min(from.x, to.x);
        const y = Math.min(from.y, to.y);
        return {
            x: from.y === to.y ? x : x - 1,
            y: from.x === to.x ? y : y - 1,
            w: from.y === to.y ? Math.abs(to.x - from.x) + 1 : 3,
            h: from.x === to.x ? Math.abs(to.y - from.y) + 1 : 3,
        };
    });
}

/*
 * Generate the world. Takes no arguments and returns a fresh object each
 * call (about 23k cells, several passes); callers build it once and keep it.
 *
 * Returned fields:
 * - w, h: size in tiles.
 * - kinds: Uint8Array of KIND per cell (what it is; drives solidity).
 * - chars: array of display characters per cell (what it looks like).
 * - zones: Uint8Array, 0 = outdoors, n = rooms[n - 1] (walls included).
 * - zoneTints, zoneAmbient: per-zone look, indexed by zone number.
 * - markers: every interactive prop, in reading order, each with its
 *   per-room, per-kind `index`; markerLookup maps cell index to marker.
 * - torches: {x, y} of every torch, for lighting.
 * - spawn, rooms: copies of / references to the rooms.js data.
 * - isSolid, kindAt, markerAt, regionAt: bounds-safe lookups.
 */
export function buildWorld() {
    const w = WORLD_W;
    const h = WORLD_H;
    const size = w * h;
    const kinds = new Uint8Array(size);
    const chars = new Array(size).fill(" ");
    /* 0 means "outdoors"; anything else indexes into `rooms` + 1. */
    const zones = new Uint8Array(size);
    /* Any fixed number works; this one reads as a date. Changing it re-rolls
       every grass glyph, mountain edge and lake shore. */
    const rng = mulberry32(20260727);
    const markers = [];

    const at = (x, y) => y * w + x;
    const inBounds = (x, y) => x >= 0 && y >= 0 && x < w && y < h;

    /* The only way cells are written, so out-of-range writes (a road end or
       a door at the very edge) are ignored instead of wrapping to the next
       row. `ch` overrides the kind's default glyph. */
    function set(x, y, kind, ch) {
        if (!inBounds(x, y)) return;
        const i = at(x, y);
        kinds[i] = kind;
        chars[i] = ch !== undefined ? ch : GLYPH[kind];
    }

    /* 1. Ground cover, with the world fading into void at the edges.
       `edge` is the distance to the nearest map border: the outer two tiles
       are void with a few stars, then a three-tile mountain rim whose
       chance falls 0.86, 0.64, 0.42 inward so it frays rather than ending
       in a line. Later passes build only from tile 5 inward, so nothing
       lands on the rim. */
    for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
            const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
            if (edge < 2) {
                set(x, y, rng() < 0.06 ? KIND.STAR : KIND.VOID);
            } else if (edge < 5 && rng() < 0.86 - (edge - 2) * 0.22) {
                set(x, y, KIND.MOUNTAIN);
            } else {
                /* Ground cover thins where the land is bare, so a clearing
                   looks like open ground rather than more of the same. */
                const lush = fbm(x, y, 0.055, 7);
                const sparse = lush < 0.42;
                /* Local list; it shadows the grid's `chars` in this block. */
                const chars = sparse ? BARE_CHARS : GRASS_CHARS;
                set(x, y, KIND.GRASS, chars[(rng() * chars.length) | 0]);
            }
        }
    }

    const roomRects = ROOMS.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
    const roads = roadRects();
    const blocked = roomRects.concat(roads);

    /* 2. Lakes, kept clear of the built world. Inside each ellipse `d` runs
       from 0 at the centre to 1 at the rim, and a cell is skipped with
       probability d * 0.35, so the shore is ragged (about a third of the
       rim cells stay land) while the middle is solid water. Cells within
       three tiles of a room or road are never flooded, so a lake cannot cut
       a door off. Lakes only replace grass. */
    LAKES.forEach((lake) => {
        for (let y = lake.y - lake.ry; y <= lake.y + lake.ry; y += 1) {
            for (let x = lake.x - lake.rx; x <= lake.x + lake.rx; x += 1) {
                if (!inBounds(x, y) || kinds[at(x, y)] !== KIND.GRASS) continue;
                const dx = (x - lake.x) / lake.rx;
                const dy = (y - lake.y) / lake.ry;
                const d = dx * dx + dy * dy;
                if (d > 1 || rng() < d * 0.35) continue;
                if (rectsOverlap(x, y, blocked, 3)) continue;
                set(x, y, KIND.WATER);
            }
        }
    });

    /*
     * 3. The city. Everything outdoors that is not a room, a road or water
     * is packed with tenements, cut by a warren of narrow alleys the way
     * the Walled City was: two-tile north-south lanes every eight tiles, and
     * between each pair of them east-west lanes at their own staggered rows, so
     * every block is reachable and no two crossings line up. A two-tile
     * apron stays open round every room, so each compound has a street.
     *
     * The lattice is pure arithmetic on (x, y), not drawn from `rng`, so it
     * does not shift if the ground-cover draws above change.
     */
    /* Spacing of the north-south lanes, in tiles. */
    const LANE = 8;
    /* Spacing of the east-west lanes within one band, in tiles. */
    const ROW = 7;
    /* Each eight-wide band gets its own east-west phase, from a tiny PRNG
       seeded per band (9100 is arbitrary), so rows do not line up across
       neighbouring bands. */
    const laneOffset = (band) => Math.floor(mulberry32(9100 + band)() * ROW);
    /* True where the lattice leaves a lane: the first two columns of every
       band, or the first two rows of a band's staggered cycle. The +3 slides
       the lattice's phase against the map edge. */
    const isAlley = (x, y) => {
        if ((x + 3) % LANE < 2) return true;
        const band = Math.floor((x + 3) / LANE);
        return (y + laneOffset(band)) % ROW < 2;
    };
    /* Behind every room, across its street, a precinct of solid lots with
       no lanes through it: the ground its landmark stands on. A strip six
       tiles deep that starts eight above the room, so the two rows next to
       the room's top wall stay street. */
    const precincts = roomRects.map((r) => ({ x: r.x - 1, y: r.y - 8, w: r.w + 2, h: 6 }));
    /* True if water touches (x, y), counting diagonals: the city keeps one
       tile back from shores so lakes have a bank. */
    const nearWater = (x, y) =>
        [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => inBounds(x + dx, y + dy) && kinds[at(x + dx, y + dy)] === KIND.WATER));
    /* Only untouched grass is built on, inside the five-tile rim; rooms are
       skipped with their two-tile apron, roads exactly. */
    for (let y = 5; y < h - 5; y += 1) {
        for (let x = 5; x < w - 5; x += 1) {
            if (kinds[at(x, y)] !== KIND.GRASS) continue;
            if (rectsOverlap(x, y, roomRects, 2) || rectsOverlap(x, y, roads, 0)) continue;
            if (nearWater(x, y)) continue;
            if (isAlley(x, y) && !rectsOverlap(x, y, precincts, 0)) continue;
            set(x, y, KIND.BLOCK);
        }
    }

    /* 4. Roads: stone floor three wide, painted from `from` to `to`. They run
       before the rooms so a room's walls cut across a road's end. */
    ROADS.forEach(({ from, to }) => {
        const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
        const sx = Math.sign(to.x - from.x);
        const sy = Math.sign(to.y - from.y);
        for (let s = 0; s <= steps; s += 1) {
            const x = from.x + sx * s;
            const y = from.y + sy * s;
            for (let o = -1; o <= 1; o += 1) {
                set(x + (sy !== 0 ? o : 0), y + (sx !== 0 ? o : 0), KIND.FLOOR);
            }
        }
    });

    /* 5. Rooms: shell, then interior, then authored content. The zone number
       is stamped over the whole rectangle, walls included, so a wall cell
       belongs to its room for lighting and tint. */
    ROOMS.forEach((room, roomIndex) => {
        for (let ry = 0; ry < room.h; ry += 1) {
            for (let rx = 0; rx < room.w; rx += 1) {
                const border =
                    rx === 0 || ry === 0 || rx === room.w - 1 || ry === room.h - 1;
                set(room.x + rx, room.y + ry, border ? KIND.WALL : KIND.FLOOR);
                zones[at(room.x + rx, room.y + ry)] = roomIndex + 1;
            }
        }

        /* A door is a three-tile gap of floor cut into the wall, centred on
           `at`. */
        (room.doors || []).forEach((door) => {
            for (let o = -1; o <= 1; o += 1) {
                if (door.side === "left") set(room.x, room.y + door.at + o, KIND.FLOOR);
                if (door.side === "right")
                    set(room.x + room.w - 1, room.y + door.at + o, KIND.FLOOR);
                if (door.side === "top") set(room.x + door.at + o, room.y, KIND.FLOOR);
                if (door.side === "bottom")
                    set(room.x + door.at + o, room.y + room.h - 1, KIND.FLOOR);
            }
        });

        /* Content is painted in listed order, so later items overwrite
           earlier ones. `text` becomes walkable LABEL cells; spaces are
           skipped so they leave what is underneath untouched. */
        (room.content || []).forEach((item) => {
            if (item.text !== undefined) {
                Array.from(item.text).forEach((ch, i) => {
                    if (ch === " ") return;
                    set(room.x + item.x + i, room.y + item.y, KIND.LABEL, ch);
                });
                return;
            }

            /* Art: characters in the AUTHOR_CHARS legend become that kind (and
               an interactive kind also records a marker); any other character
               is kept as a walkable label glyph. */
            (item.art || []).forEach((line, ly) => {
                Array.from(line).forEach((ch, lx) => {
                    if (ch === " ") return;
                    const kind = AUTHOR_CHARS[ch];
                    if (kind === undefined) {
                        set(room.x + item.x + lx, room.y + item.y + ly, KIND.LABEL, ch);
                        return;
                    }
                    const x = room.x + item.x + lx;
                    const y = room.y + item.y + ly;
                    set(x, y, kind);
                    if (INTERACTIVE[kind]) markers.push({ kind, x, y, room: room.id });
                });
            });
        });
    });

    /* 6. Auto-tile every wall from its neighbours. The mask bits (north 1,
       south 2, west 4, east 8) are the ones tiles.js wallGlyph expects. Done
       after all rooms are painted so abutting walls join up. */
    for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
            if (kinds[at(x, y)] !== KIND.WALL) continue;
            const isWall = (px, py) =>
                inBounds(px, py) && kinds[at(px, py)] === KIND.WALL ? 1 : 0;
            const mask =
                isWall(x, y - 1) * 1 +
                isWall(x, y + 1) * 2 +
                isWall(x - 1, y) * 4 +
                isWall(x + 1, y) * 8;
            chars[at(x, y)] = wallGlyph(mask);
        }
    }

    /* 7. Any scrap of lane the warren sealed off is built over, so every
       alley you can see leads somewhere. Flood fill (4-way, over anything not
       solid) from the spawn marks what a walker can reach; outdoor grass that
       was left unreached becomes a block. Room interiors are excluded via
       `zones`, and so are shore tiles, matching step 3. */
    const reached = new Uint8Array(size);
    const stack = [at(SPAWN.x, SPAWN.y)];
    reached[stack[0]] = 1;
    while (stack.length) {
        const i = stack.pop();
        const x = i % w;
        const y = (i / w) | 0;
        [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
        ].forEach(([dx, dy]) => {
            const j = at(x + dx, y + dy);
            if (!inBounds(x + dx, y + dy) || reached[j] || SOLID.has(kinds[j])) return;
            reached[j] = 1;
            stack.push(j);
        });
    }
    for (let y = 5; y < h - 5; y += 1) {
        for (let x = 5; x < w - 5; x += 1) {
            const i = at(x, y);
            if (!reached[i] && !zones[i] && kinds[i] === KIND.GRASS && !nearWater(x, y)) set(x, y, KIND.BLOCK);
        }
    }

    /* Markers are numbered per room and per kind, in reading order, so the
       first bookshelf slot in the library holds the newest note. `index` is
       the slot into the matching content list (notes, repos, projects,
       cabinets in pages/World.js); a slot past the end of that list is
       drawn unlit by render.js. */
    markers.sort((a, b) => a.y - b.y || a.x - b.x);
    const counters = new Map();
    markers.forEach((marker) => {
        const key = `${marker.room}:${marker.kind}`;
        const next = counters.get(key) || 0;
        marker.index = next;
        counters.set(key, next + 1);
    });

    /* Cell index -> marker, for per-frame lookups in render.js. */
    const markerLookup = new Map();
    markers.forEach((marker) => markerLookup.set(marker.y * w + marker.x, marker));

    /* Torches are plain tiles; collecting them once lets the renderers light
       them without rescanning the grid. */
    const torches = [];
    for (let i = 0; i < size; i += 1) {
        if (kinds[i] === KIND.TORCH) torches.push({ x: i % w, y: (i / w) | 0 });
    }

    /* Per-zone look, indexed to match `zones`. Slot 0 is the outdoors. */
    const zoneTints = [null].concat(ROOMS.map((room) => room.tint || null));
    const zoneAmbient = [OUTDOOR_AMBIENT].concat(
        ROOMS.map((room) =>
            room.ambient === undefined ? OUTDOOR_AMBIENT : room.ambient
        )
    );

    return {
        w,
        h,
        kinds,
        chars,
        zones,
        zoneTints,
        zoneAmbient,
        markers,
        markerLookup,
        torches,
        spawn: { ...SPAWN },
        rooms: ROOMS,
        /* Solidity for movement: anything outside the map counts as solid.
           This is the `isSolid` callback motion.js is given. */
        isSolid(x, y) {
            if (!inBounds(x, y)) return true;
            return SOLID.has(kinds[at(x, y)]);
        },
        /* Kind at a tile; VOID outside the map. */
        kindAt(x, y) {
            return inBounds(x, y) ? kinds[at(x, y)] : KIND.VOID;
        },
        /* The interactive prop on exactly this tile, or null. A linear scan,
           fine for the occasional action press; per-frame code should use
           markerLookup. */
        markerAt(x, y) {
            return markers.find((m) => m.x === x && m.y === y) || null;
        },
        /* Name of the room whose rectangle (walls included) contains the
           tile, or "THE CITY" for roads, alleys and open ground. */
        regionAt(x, y) {
            const room = ROOMS.find(
                (r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
            );
            return room ? room.name : "THE CITY";
        },
    };
}
