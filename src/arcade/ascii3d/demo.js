import { isSolid, tileAt, WATER, TREE, ROCK, inSafeZone, withinReach } from "../../lib/terrain";
import { STRUCTURES, resourceAt, ITEMS } from "../../lib/survival";
import { planTerraform, solidAt as groundSolid } from "../../lib/ground";
import { planBuild, planDemolish } from "../../lib/building";

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
/* A shortened day, so a visit sees it turn: seconds per phase. */
const DAY = [
    ["day", 150],
    ["dusk", 40],
    ["night", 100],
    ["dawn", 35],
];
const DAY_LENGTH = DAY.reduce((sum, [, s]) => sum + s, 0);
const PHASES = DAY.map(([name]) => name);
/* Mostly fair, sometimes not, as on the server. */
const WEATHERS = ["clear", "clear", "clear", "clear", "rain", "fog", "storm"];
const MONSTER_HP = { rat: 8, wolf: 18, kobold: 14, troll: 40 };
const MONSTER_XP = { rat: 4, wolf: 10, kobold: 8, troll: 30 };

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

export function createDemo({ phase: fixedPhase, weather: fixedWeather } = {}) {
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
        { id: "you", name: "wanderer", ...(isSolid(hx + 3, hy + 9) ? openNear(hx + 3, hy + 9) : { x: hx + 3, y: hy + 9 }), self: true, look: LOOKS[4], tools: { weapon: 1, shovel: 1 } },
        ...NAMES.map((name, i) => ({
            id: name,
            name,
            x: hx + 4 + i,
            y: hy + 6 + (i % 2),
            self: false,
            look: LOOKS[i],
            tools: { weapon: i % 3 === 0 ? 2 : 0, armor: i === 1 ? 1 : i === 3 ? 2 : 0 },
        })),
    ].map((p) => ({ ...p, level: p.self ? 1 : 1 + Math.floor(random() * 6), hp: 30, maxHp: 30, saidText: "", saidUntil: 0 }));
    const you = players[0];

    const monsters = [
        { kind: "wolf", x: camp.x + 12, y: camp.y - 3 },
        { kind: "rat", x: camp.x - 6, y: camp.y + 9 },
        { kind: "kobold", x: camp.x + 9, y: camp.y + 11 },
        { kind: "troll", x: camp.x - 9, y: camp.y - 6 },
        { kind: "wolf", x: camp.x - 4, y: camp.y + 16 },
        { kind: "rat", x: camp.x + 14, y: camp.y + 6 },
    ].map((m, i) => ({ ...m, ...(isSolid(m.x, m.y) ? openNear(m.x, m.y) : {}), id: `m${i}`, hp: MONSTER_HP[m.kind], maxHp: MONSTER_HP[m.kind] }));
    let monsterIds = monsters.length;
    const returning = [];
    const chat = [{ name: "", text: "You wake at the edge of a camp. Nothing here is saved.", kind: "system" }];
    const me = {
        level: 1,
        xp: 0,
        gold: 0,
        potions: 2,
        kills: 0,
        /* Enough to put up a hut and a fire straight away. */
        wood: 40,
        stone: 24,
        placed: 0,
        inventory: { dirt: 3 },
        hunger: 100,
        warmth: 100,
        gathered: 0,
        milestones: [],
        home: null,
    };
    const xpNeeded = (level) => 20 + level * 15;

    /* Dug and piled ground, "x,y" → steps, and the chunks it has touched. */
    const ground = new Map();
    const groundChunks = new Set();
    const editAt = (x, y) => ground.get(`${x},${y}`);
    /* What was shovelled into each tile, so digging it out returns the same. */
    const fills = new Map();
    const solidAt = (x, y) => {
        const c = cells.find((cell) => cell.x === x && cell.y === y);
        if (!c) return groundSolid(x, y, editAt(x, y));
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
    /* Nothing bites you until you have done something: the title screen
       circles the camp for a while, and stepping in to find yourself
       already dead is no welcome. */
    let engaged = false;
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    function tick(now) {
        if (now - last < 450) return false;
        last = now;
        clock += 1;
        if (now > you.saidUntil) you.saidText = "";
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
                say(p.name, p.saidText);
            }
            if (now > p.saidUntil) p.saidText = "";
        });
        monsters.forEach((m) => {
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
        monsters.slice().forEach((m) => {
            players.forEach((p) => {
                if (m.hp <= 0 || p.hp <= 0) return;
                if (Math.abs(p.x - m.x) + Math.abs(p.y - m.y) !== 1) return;
                if (!p.self && random() < 0.35) wound(m, 2 + Math.floor(random() * 3), null);
                if (p.self && !engaged) return;
                if (random() < 0.3) {
                    const bite = m.kind === "troll" ? 6 : m.kind === "rat" ? 2 : 3;
                    p.hp = p.self ? Math.max(0, p.hp - bite) : Math.max(12, p.hp - bite);
                }
            });
        });
        players.forEach((p) => {
            if (p.hp > 0 && p.hp < p.maxHp && random() < (p.self ? 0.12 : 0.3)) p.hp += 1;
        });
        /* The fallen come back, somewhere else, after a while. */
        while (returning.length && returning[0].at <= clock) {
            const { kind } = returning.shift();
            const spot = respawn({ x: you.x, y: you.y });
            monsters.push({ kind, ...spot, id: `m${(monsterIds += 1)}`, hp: MONSTER_HP[kind], maxHp: MONSTER_HP[kind] });
        }
        return true;
    }

    function wound(m, amount, by) {
        m.hp = Math.max(0, m.hp - amount);
        if (m.hp > 0) return;
        monsters.splice(monsters.indexOf(m), 1);
        returning.push({ kind: m.kind, at: clock + 25 });
        if (by === you) {
            me.kills += 1;
            me.xp += MONSTER_XP[m.kind];
            me.gold += 2 + Math.floor(random() * 6);
            if (m.kind === "wolf" || m.kind === "rat") me.inventory.meat = (me.inventory.meat || 0) + 1;
            while (me.xp >= xpNeeded(me.level)) {
                me.xp -= xpNeeded(me.level);
                me.level += 1;
                you.maxHp += 8;
                you.hp = you.maxHp;
                you.level = me.level;
            }
        }
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

    /* Start late in the afternoon, so dusk comes on during a first visit. */
    const started = Date.now() - 100 * 1000;
    function phaseAt(now) {
        if (PHASES.includes(fixedPhase)) return fixedPhase;
        let t = (((now - started) / 1000) % DAY_LENGTH + DAY_LENGTH) % DAY_LENGTH;
        for (const [name, length] of DAY) {
            if (t < length) return name;
            t -= length;
        }
        return "day";
    }
    let weather = WEATHERS.includes(fixedWeather) ? fixedWeather : "clear";
    let weatherUntil = Date.now() + 70000;
    function weatherAt(now) {
        if (WEATHERS.includes(fixedWeather)) return fixedWeather;
        if (now > weatherUntil) {
            weather = WEATHERS[Math.floor(random() * WEATHERS.length)];
            weatherUntil = now + 60000 + random() * 90000;
        }
        return weather;
    }

    function snapshot(now = Date.now()) {
        return {
            now,
            phase: phaseAt(now),
            weather: weatherAt(now),
            region: "the crossroads",
            view: { x: you.x - 30, y: you.y - 14, w: 61, h: 29 },
            online: players.length,
            me: {
                session: "offline",
                name: you.name,
                x: you.x,
                y: you.y,
                hp: you.hp,
                maxHp: you.maxHp,
                xpNeeded: xpNeeded(me.level),
                appearance: you.look,
                tools: you.tools,
                stations: [],
                far: 0,
                ...me,
                inventory: { ...me.inventory },
            },
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
            ground: [...ground].map(([k, edit]) => {
                const [x, y] = k.split(",").map(Number);
                return { x, y, edit };
            }),
            groundChunks: [...groundChunks],
            chat: chat.slice(-12).reverse(),
        };
    }

    function say(name, text, kind = "chat") {
        chat.push({ name, text, kind });
        if (chat.length > 40) chat.shift();
    }

    /*
     * The same calls the server takes, answered locally. Each returns the
     * line the server would, or null.
     */
    const calls = {
        /* Like the server: eight ways, no cutting corners, and the answer
           is where you stand afterwards. */
        move({ dx, dy }) {
            if (you.hp <= 0) return null;
            const here = () => ({ x: you.x, y: you.y });
            dx = Math.sign(dx);
            dy = Math.sign(dy);
            if (!dx && !dy) return here();
            if (dx && dy && (solidAt(you.x + dx, you.y) || solidAt(you.x, you.y + dy))) return here();
            const target = monsters.find((m) => m.x === you.x + dx && m.y === you.y + dy);
            if (target) {
                const swing = 3 + me.level * 2 + (you.tools.weapon || 0) * 4 + Math.floor(random() * 4);
                wound(target, swing, you);
                return here();
            }
            tryStep(you, dx, dy);
            return here();
        },
        harvest({ x, y }) {
            if (!withinReach(you, x, y)) return "out of reach";
            const item = resourceAt(x, y);
            const tile = tileAt(x, y);
            if (!item || item === "fish" || editAt(x, y) !== undefined || cells.some((c) => c.x === x && c.y === y)) return "nothing to gather there";
            if (item === "wood") me.wood += 1;
            else if (item === "stone") me.stone += 1;
            else me.inventory[item] = (me.inventory[item] || 0) + 1;
            me.gathered += 1;
            /* Now and then the tree comes down or the rock gives out. */
            if ((tile === TREE || tile === ROCK) && random() < 0.25) {
                put(x, y, tile === TREE ? "stump" : "rubble", { ownerName: "" });
                return `+1 ${ITEMS[item].name.toLowerCase()} · the ${tile === TREE ? "tree comes down" : "rock is spent"}`;
            }
            return `+1 ${ITEMS[item].name.toLowerCase()}`;
        },
        /* The same rules as the server's, from src/lib/building.js. */
        build({ x, y, kind, text, facing }) {
            if (you.hp <= 0) return "no";
            const existing = cells.find((c) => c.x === x && c.y === y);
            const plan = planBuild({
                kind,
                x,
                y,
                from: you,
                fromEdit: editAt(you.x, you.y),
                edit: editAt(x, y),
                cell: existing,
                occupied: occupied(x, y),
                bag: { wood: me.wood, stone: me.stone },
                facing,
            });
            if (plan.error !== undefined) return plan.error;
            if (existing) cells.splice(cells.indexOf(existing), 1);
            put(x, y, kind, {
                ownerName: you.name,
                mine: true,
                open: kind === "door",
                text: text || "",
                fuelUntil: kind === "campfire" ? Infinity : 0,
                facing: plan.facing,
                placedAt: Date.now(),
            });
            me.wood -= plan.cost.wood;
            me.stone -= plan.cost.stone;
            me.placed += 1;
            if (!me.milestones.includes(kind)) me.milestones.push(kind);
            return `built a ${STRUCTURES[kind].label.toLowerCase()}`;
        },
        /* The same rules as the server's, from src/lib/ground.js. */
        terraform({ x, y, mode }) {
            if (you.hp <= 0) return "no";
            const existing = cells.find((c) => c.x === x && c.y === y);
            const cleared = existing && (existing.kind === "stump" || existing.kind === "rubble");
            if (!withinReach(you, x, y)) return "too far";
            if (existing && !cleared) return "something is built there";
            if (occupied(x, y)) return "someone is standing there";
            const plan = planTerraform({
                mode,
                x,
                y,
                from: you,
                fromEdit: editAt(you.x, you.y),
                edit: editAt(x, y),
                fill: fills.get(`${x},${y}`),
                cleared: Boolean(cleared),
                shovel: you.tools.shovel || 0,
                bag: { ...me.inventory, wood: me.wood, stone: me.stone },
            });
            if (plan.error !== undefined) return plan.error;
            ground.set(`${x},${y}`, plan.edit);
            fills.set(`${x},${y}`, plan.fill);
            groundChunks.add(`${Math.floor(x / 16)}:${Math.floor(y / 16)}`);
            if (cleared) cells.splice(cells.indexOf(existing), 1);
            if (plan.item === "stone") me.stone += plan.change;
            else me.inventory[plan.item] = (me.inventory[plan.item] || 0) + plan.change;
            return plan.message;
        },
        demolish({ x, y }) {
            if (!withinReach(you, x, y)) return "out of reach";
            const c = cells.find((cell) => cell.x === x && cell.y === y);
            const plan = planDemolish({
                cell: c && { ...c, owner: c.mine ? "you" : c.ownerName },
                owner: "you",
                placedAt: c?.placedAt || 0,
                now: Date.now(),
            });
            if (plan.error !== undefined) return plan.error;
            cells.splice(cells.indexOf(c), 1);
            me.wood += plan.refund.wood;
            me.stone += plan.refund.stone;
            me.placed = Math.max(0, me.placed - 1);
            return plan.message;
        },
        use({ x, y }) {
            const c = cells.find((cell) => cell.x === x && cell.y === y);
            if (!c) return null;
            if (c.kind === "door") {
                if (occupied(x, y)) return "someone is in the doorway";
                c.open = !c.open;
                return null;
            }
            if (c.kind === "sign") return c.text ? `the sign reads: "${c.text}"` : "a blank sign";
            if (c.kind === "bedroll") {
                me.home = { x, y };
                return "camp set";
            }
            if (c.kind === "campfire") return "the fire crackles";
            return null;
        },
        say({ text }) {
            const line = String(text).slice(0, 160);
            you.saidText = line;
            you.saidUntil = Date.now() + 5000;
            say(you.name, line);
            return null;
        },
        drink() {
            if (me.potions <= 0) return "no potions left";
            me.potions -= 1;
            you.hp = you.maxHp;
            return "you feel restored";
        },
        eat({ item }) {
            const have = me.inventory[item] || 0;
            if (!have) return `no ${item === "meal" ? "meals" : item} to eat`;
            me.inventory[item] = have - 1;
            me.hunger = Math.min(100, me.hunger + (item === "meal" ? 45 : 12));
            you.hp = Math.min(you.maxHp, you.hp + (item === "meal" ? 8 : 2));
            return "that helps";
        },
        respawn() {
            const home = me.home || { x: hx + 2, y: hy + 6 };
            const spot = solidAt(home.x, home.y) || occupied(home.x, home.y) ? respawn(home) : home;
            you.x = spot.x;
            you.y = spot.y;
            you.hp = you.maxHp;
            me.gold = Math.floor(me.gold * 0.9);
            return "you wake, sore but alive";
        },
        customize({ name, appearance }) {
            if (name) you.name = String(name).slice(0, 16);
            if (appearance) you.look = { ...you.look, ...appearance };
            return null;
        },
        craft() {
            return "crafting needs the shared world";
        },
        transfer() {
            return "chests need the shared world";
        },
    };

    return {
        tick,
        snapshot,
        call(name, args = {}) {
            engaged = true;
            return calls[name] ? calls[name](args) : null;
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
