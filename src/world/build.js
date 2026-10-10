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

/* Deterministic noise so the forest looks the same on every visit. */
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

const GRASS_CHARS = [",", ",", ",", "'", '"', "`", " "];
/* Worn ground: mostly nothing, so clearings breathe. */
const BARE_CHARS = [" ", " ", " ", " ", ".", ",", "`"];

/* Night outside; each room sets its own level in rooms.js. */
const OUTDOOR_AMBIENT = 0.26;

function rectsOverlap(x, y, rects, pad) {
    return rects.some(
        (r) =>
            x >= r.x - pad &&
            x < r.x + r.w + pad &&
            y >= r.y - pad &&
            y < r.y + r.h + pad
    );
}

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

export function buildWorld() {
    const w = WORLD_W;
    const h = WORLD_H;
    const size = w * h;
    const kinds = new Uint8Array(size);
    const chars = new Array(size).fill(" ");
    /* 0 means "outdoors"; anything else indexes into `rooms` + 1. */
    const zones = new Uint8Array(size);
    const rng = mulberry32(20260727);
    const markers = [];

    const at = (x, y) => y * w + x;
    const inBounds = (x, y) => x >= 0 && y >= 0 && x < w && y < h;

    function set(x, y, kind, ch) {
        if (!inBounds(x, y)) return;
        const i = at(x, y);
        kinds[i] = kind;
        chars[i] = ch !== undefined ? ch : GLYPH[kind];
    }

    /* 1. Ground cover, with the world fading into void at the edges. */
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
                const chars = sparse ? BARE_CHARS : GRASS_CHARS;
                set(x, y, KIND.GRASS, chars[(rng() * chars.length) | 0]);
            }
        }
    }

    const roomRects = ROOMS.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
    const roads = roadRects();
    const blocked = roomRects.concat(roads);

    /* 2. Lakes, kept clear of the built world. */
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
     * is packed with tenements, cut by a warren of one-tile alleys the way
     * the Walled City was: north-south lanes every seven tiles, and between
     * each pair of them east-west lanes at their own staggered rows, so
     * every block is reachable and no two crossings line up. A two-tile
     * apron stays open round every room, so each compound has a street.
     */
    const LANE = 7;
    const ROW = 6;
    const laneOffset = (band) => Math.floor(mulberry32(9100 + band)() * ROW);
    const isAlley = (x, y) => {
        if ((x + 3) % LANE === 0) return true;
        const band = Math.floor((x + 3) / LANE);
        return (y + laneOffset(band)) % ROW === 0;
    };
    /* Behind every room, across its street, a precinct of solid lots with
       no lanes through it: the ground its landmark stands on. */
    const precincts = roomRects.map((r) => ({ x: r.x - 1, y: r.y - 8, w: r.w + 2, h: 6 }));
    const nearWater = (x, y) =>
        [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => inBounds(x + dx, y + dy) && kinds[at(x + dx, y + dy)] === KIND.WATER));
    for (let y = 5; y < h - 5; y += 1) {
        for (let x = 5; x < w - 5; x += 1) {
            if (kinds[at(x, y)] !== KIND.GRASS) continue;
            if (rectsOverlap(x, y, roomRects, 2) || rectsOverlap(x, y, roads, 0)) continue;
            if (nearWater(x, y)) continue;
            if (isAlley(x, y) && !rectsOverlap(x, y, precincts, 0)) continue;
            set(x, y, KIND.BLOCK);
        }
    }

    /* 4. Roads. */
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

    /* 5. Rooms: shell, then interior, then authored content. */
    ROOMS.forEach((room, roomIndex) => {
        for (let ry = 0; ry < room.h; ry += 1) {
            for (let rx = 0; rx < room.w; rx += 1) {
                const border =
                    rx === 0 || ry === 0 || rx === room.w - 1 || ry === room.h - 1;
                set(room.x + rx, room.y + ry, border ? KIND.WALL : KIND.FLOOR);
                zones[at(room.x + rx, room.y + ry)] = roomIndex + 1;
            }
        }

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

        (room.content || []).forEach((item) => {
            if (item.text !== undefined) {
                Array.from(item.text).forEach((ch, i) => {
                    if (ch === " ") return;
                    set(room.x + item.x + i, room.y + item.y, KIND.LABEL, ch);
                });
                return;
            }

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

    /* 6. Auto-tile every wall from its neighbours. */
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
       alley you can see leads somewhere. */
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
       first bookshelf slot in the library holds the newest note. */
    markers.sort((a, b) => a.y - b.y || a.x - b.x);
    const counters = new Map();
    markers.forEach((marker) => {
        const key = `${marker.room}:${marker.kind}`;
        const next = counters.get(key) || 0;
        marker.index = next;
        counters.set(key, next + 1);
    });

    const markerLookup = new Map();
    markers.forEach((marker) => markerLookup.set(marker.y * w + marker.x, marker));

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
        isSolid(x, y) {
            if (!inBounds(x, y)) return true;
            return SOLID.has(kinds[at(x, y)]);
        },
        kindAt(x, y) {
            return inBounds(x, y) ? kinds[at(x, y)] : KIND.VOID;
        },
        markerAt(x, y) {
            return markers.find((m) => m.x === x && m.y === y) || null;
        },
        regionAt(x, y) {
            const room = ROOMS.find(
                (r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
            );
            return room ? room.name : "THE CITY";
        },
    };
}
