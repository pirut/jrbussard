import { isSolid, tileAt, WATER, inSafeZone } from "../../lib/terrain";
import { STRUCTURES } from "../../lib/survival";

/*
 * A pretend server, for when there is no real one.
 *
 * Builds without REACT_APP_CONVEX_URL (forks, previews, a fresh clone) used to
 * show a paragraph explaining what was missing. Now they show the field
 * anyway: a little camp at the crossroads, a few survivors pottering about and
 * some wildlife, all in the same snapshot shape the Convex query returns, so
 * the renderer cannot tell the difference. Nothing here is saved.
 */

const LOOKS = [
    { skin: "bronze", hair: "ink", outfit: "tide", cloak: "sea", hairstyle: "long", headwear: "none", sigil: "@" },
    { skin: "porcelain", hair: "copper", outfit: "rust", cloak: "wine", hairstyle: "braids", headwear: "hood", sigil: "&" },
    { skin: "umber", hair: "ash", outfit: "ivory", cloak: "ochre", hairstyle: "cropped", headwear: "brim", sigil: "$" },
    { skin: "sand", hair: "gold", outfit: "plum", cloak: "dusk", hairstyle: "shaved", headwear: "crown", sigil: "Q" },
    { skin: "ebony", hair: "moss", outfit: "fern", cloak: "pine", hairstyle: "cropped", headwear: "none", sigil: "@" },
];
const NAMES = ["salt_gull", "pale_ember", "low_kettle", "grey_wire"];
const LINES = ["anyone seen iron?", "fire's lit at camp", "watch the wolves past the ridge", "/me waves", "bridge is done"];
const PHASES = ["dusk", "night", "dawn", "day", "day"];

function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/* A clear rectangle near the crossroads to pitch the camp in. */
function findCamp() {
    for (let r = 7; r < 40; r += 1) {
        for (let a = 0; a < 16; a += 1) {
            const x0 = Math.round(Math.cos((a / 16) * Math.PI * 2) * r);
            const y0 = Math.round(Math.sin((a / 16) * Math.PI * 2) * r);
            let ok = true;
            for (let y = y0; y < y0 + 6 && ok; y += 1) {
                for (let x = x0; x < x0 + 7 && ok; x += 1) {
                    if (isSolid(x, y) || inSafeZone(x, y) || x === 0 || y === 0) ok = false;
                }
            }
            if (ok) return { x: x0, y: y0 };
        }
    }
    return { x: 8, y: 8 };
}

function nearestWater(fromX, fromY) {
    for (let r = 2; r < 40; r += 1) {
        for (let dy = -r; dy <= r; dy += 1) {
            for (let dx = -r; dx <= r; dx += 1) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                const x = fromX + dx;
                const y = fromY + dy;
                if (tileAt(x, y) === WATER) return { x, y };
            }
        }
    }
    return null;
}

export function createDemo({ phase: fixedPhase } = {}) {
    const random = rng(7);
    const camp = findCamp();
    const cells = [];
    const put = (x, y, kind, extra = {}) =>
        cells.push({ x, y, kind, ownerName: "pale_ember", text: "", open: false, mine: false, fuelUntil: 0, stock: {}, ...extra });

    /* A hut: four walls with a door on the south side. */
    const hx = camp.x + 1;
    const hy = camp.y + 1;
    for (let x = hx; x < hx + 4; x += 1) {
        put(x, hy, "wall");
        if (x === hx + 2) put(x, hy + 3, "door", { open: true });
        else put(x, hy + 3, "wall");
    }
    put(hx, hy + 1, "wall");
    put(hx, hy + 2, "wall");
    put(hx + 3, hy + 1, "wall");
    put(hx + 3, hy + 2, "wall");
    put(hx + 1, hy + 1, "bedroll");
    put(hx + 2, hy + 1, "chest");
    put(hx + 5, hy + 4, "campfire", { fuelUntil: Infinity });
    put(hx + 5, hy + 1, "workbench");
    put(hx + 5, hy + 2, "furnace");
    put(hx - 1, hy + 4, "torch");
    put(hx + 1, hy + 5, "sign", { text: "welcome, stranger" });

    /* A bridge stub out over the nearest water. */
    const water = nearestWater(camp.x, camp.y);
    if (water) {
        for (let i = 0; i < 4; i += 1) {
            const x = water.x + i;
            if (tileAt(x, water.y) === WATER) put(x, water.y, "floor");
        }
    }

    const players = [
        /* Start a few steps back, so the first view takes in the camp. */
        { id: "you", name: "you", ...(isSolid(hx + 3, hy + 9) ? openNear(hx + 3, hy + 9) : { x: hx + 3, y: hy + 9 }), self: true, look: LOOKS[4], tools: { weapon: 1 } },
        ...NAMES.map((name, i) => ({
            id: name,
            name,
            x: hx + 4 + i,
            y: hy + 6 + (i % 2),
            self: false,
            look: LOOKS[i],
            tools: { weapon: i % 3 === 0 ? 2 : 0, armor: i === 1 ? 1 : i === 3 ? 2 : 0 },
        })),
    ].map((p) => ({ ...p, level: 1 + Math.floor(random() * 6), hp: 30, saidText: "", saidUntil: 0 }));

    const monsters = [
        { kind: "wolf", x: camp.x + 12, y: camp.y - 3 },
        { kind: "rat", x: camp.x - 6, y: camp.y + 9 },
        { kind: "kobold", x: camp.x + 9, y: camp.y + 11 },
        { kind: "troll", x: camp.x - 9, y: camp.y - 6 },
    ].map((m) => ({ ...m, ...(isSolid(m.x, m.y) ? openNear(m.x, m.y) : {}), hp: 10, maxHp: 10 }));

    const solidAt = (x, y) => {
        const c = cells.find((cell) => cell.x === x && cell.y === y);
        if (!c) return isSolid(x, y);
        if (c.kind === "floor") return false;
        if (c.kind === "door") return !c.open;
        return Boolean(STRUCTURES[c.kind]?.solid);
    };
    const occupied = (x, y) => players.some((p) => p.x === x && p.y === y) || monsters.some((m) => m.x === x && m.y === y);

    function tryStep(entity, dx, dy) {
        const nx = entity.x + dx;
        const ny = entity.y + dy;
        if (solidAt(nx, ny) || occupied(nx, ny)) return false;
        entity.x = nx;
        entity.y = ny;
        return true;
    }

    let last = 0;
    let clock = 0;
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    function tick(now) {
        if (now - last < 450) return false;
        last = now;
        clock += 1;
        players.forEach((p) => {
            if (p.self) return;
            if (random() < 0.45) {
                /* Wander, but drift back toward camp. */
                const home = random() < 0.3;
                const [dx, dy] = home ? [Math.sign(hx + 3 - p.x), 0] : DIRS[Math.floor(random() * 4)];
                if (dx || dy) tryStep(p, dx, dy);
            }
            if (random() < 0.01 && now > p.saidUntil) {
                p.saidText = LINES[Math.floor(random() * LINES.length)];
                p.saidUntil = now + 4000;
            }
            if (now > p.saidUntil) p.saidText = "";
        });
        monsters.forEach((m) => {
            if (m.hp <= 0) {
                /* Lie there a moment, then turn up somewhere else. */
                m.deadFor = (m.deadFor || 0) + 1;
                if (m.deadFor > 5) Object.assign(m, respawn(m), { hp: m.maxHp, deadFor: 0 });
                return;
            }
            const prey = nearest(players, m, 7);
            if (prey && m.kind !== "rat" && random() < 0.5) {
                const dx = Math.sign(prey.x - m.x);
                const dy = Math.sign(prey.y - m.y);
                const [sx, sy] = Math.abs(prey.x - m.x) > Math.abs(prey.y - m.y) ? [dx, 0] : [0, dy];
                if (!inSafeZone(m.x + sx, m.y + sy)) tryStep(m, sx, sy);
            } else if (random() < 0.6) {
                const [dx, dy] = DIRS[Math.floor(random() * 4)];
                if (!inSafeZone(m.x + dx, m.y + dy)) tryStep(m, dx, dy);
            }
        });
        /* Scuffles: anyone next to a monster trades blows with it. */
        monsters.forEach((m) => {
            if (m.hp <= 0) return;
            players.forEach((p) => {
                if (Math.abs(p.x - m.x) + Math.abs(p.y - m.y) !== 1) return;
                if (!p.self && random() < 0.35) m.hp = Math.max(0, m.hp - 2 - Math.floor(random() * 3));
                if (random() < 0.3) p.hp = Math.max(12, p.hp - 3);
            });
        });
        players.forEach((p) => {
            if (p.hp < 30 && random() < 0.3) p.hp += 1;
        });
        return true;
    }

    function nearest(list, from, reach) {
        let best = null;
        let bestDistance = reach;
        list.forEach((e) => {
            const d = Math.abs(e.x - from.x) + Math.abs(e.y - from.y);
            if (d <= bestDistance) {
                best = e;
                bestDistance = d;
            }
        });
        return best;
    }

    function respawn(m) {
        for (let tries = 0; tries < 40; tries += 1) {
            const x = camp.x + Math.round((random() - 0.5) * 30);
            const y = camp.y + Math.round((random() - 0.5) * 30);
            if (Math.abs(x - m.x) + Math.abs(y - m.y) > 6 && !solidAt(x, y) && !occupied(x, y) && !inSafeZone(x, y)) return { x, y };
        }
        return { x: m.x, y: m.y };
    }

    const started = Date.now();
    function snapshot(now = Date.now()) {
        const phase = PHASES.includes(fixedPhase) ? fixedPhase : PHASES[Math.floor((now - started) / 24000) % PHASES.length];
        return {
            now,
            phase,
            weather: phase === "night" ? "storm" : clock % 400 > 300 ? "rain" : "clear",
            region: "the crossroads",
            view: { x: players[0].x - 30, y: players[0].y - 14, w: 61, h: 29 },
            online: players.length,
            me: null,
            players: players.map((p) => ({
                id: p.id,
                name: p.name,
                x: p.x,
                y: p.y,
                level: p.level,
                hp: p.hp,
                self: p.self,
                appearance: p.look,
                tools: p.tools,
                saidText: p.saidText,
            })),
            monsters: monsters.map((m) => ({ ...m })),
            cells: cells.map((c) => ({ ...c })),
            chat: [],
        };
    }

    return {
        tick,
        snapshot,
        step(dx, dy) {
            return tryStep(players[0], dx, dy);
        },
        /* Hit whatever is next to you. */
        strike() {
            const me = players[0];
            const m = monsters.find((c) => c.hp > 0 && Math.abs(c.x - me.x) + Math.abs(c.y - me.y) === 1);
            if (!m) return false;
            m.hp = Math.max(0, m.hp - 3);
            return { dx: m.x - me.x, dy: m.y - me.y };
        },
        toggleDoorNear() {
            const me = players[0];
            const door = cells.find((c) => c.kind === "door" && Math.abs(c.x - me.x) + Math.abs(c.y - me.y) <= 2);
            if (door) door.open = !door.open;
        },
    };
}

function openNear(x, y) {
    for (let r = 1; r < 10; r += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
            for (let dy = -r; dy <= r; dy += 1) {
                if (!isSolid(x + dx, y + dy)) return { x: x + dx, y: y + dy };
            }
        }
    }
    return { x, y };
}
