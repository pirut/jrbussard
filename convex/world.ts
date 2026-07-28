import { query, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
    MONSTERS,
    BLOCKS,
    BUILDABLE,
    REGROW_TREE_MS,
    REGROW_ROCK_MS,
    TREE,
    ROCK,
    VIEW_W,
    VIEW_H,
    tileAt,
    isSolid,
    inSafeZone,
    withinReach,
    chunkKey,
    chunksInBox,
    arrivalSpot,
    phaseAt,
    regionName,
    xpForLevel,
} from "./field";

/*
 * Everything here is server-authoritative: the client asks, the server
 * decides. The world is endless, so every query is scoped to what one player
 * can actually see.
 */

const MOVE_COOLDOWN_MS = 90;
const BUILD_COOLDOWN_MS = 140;
const IDLE_MS = 45_000;
const CHAT_LIMIT = 50;
const MAX_NAME = 18;
const MAX_CHAT = 160;
const BUBBLE_MS = 7000;
/* Breathing room after arriving or reviving. */
const GRACE_MS = 5000;

async function getWorld(ctx: MutationCtx) {
    const existing = await ctx.db
        .query("world")
        .withIndex("by_key", (q) => q.eq("key", "singleton"))
        .unique();
    if (existing) return existing;

    const id = await ctx.db.insert("world", {
        key: "singleton",
        ticking: false,
        lastTick: Date.now(),
        weather: "clear",
        weatherUntil: Date.now() + 120_000,
    });
    return (await ctx.db.get("world", id))!;
}

async function ensureTicking(ctx: MutationCtx) {
    const world = await getWorld(ctx);
    if (world.ticking) return;
    await ctx.db.patch("world", world._id, { ticking: true, lastTick: Date.now() });
    await ctx.scheduler.runAfter(0, internal.tick.run, {});
}

async function getPlayer(ctx: MutationCtx | QueryCtx, session: string) {
    return await ctx.db
        .query("players")
        .withIndex("by_session", (q) => q.eq("session", session))
        .unique();
}

async function cellAt(ctx: MutationCtx | QueryCtx, x: number, y: number) {
    return await ctx.db
        .query("cells")
        .withIndex("by_pos", (q) => q.eq("x", x).eq("y", y))
        .unique();
}

async function post(ctx: MutationCtx, name: string, text: string, kind: string) {
    await ctx.db.insert("chat", { name, text: text.slice(0, MAX_CHAT), kind });
    const all = await ctx.db.query("chat").order("desc").take(CHAT_LIMIT + 25);
    for (const row of all.slice(CHAT_LIMIT)) {
        await ctx.db.delete("chat", row._id);
    }
}

/* Solid means generated terrain, or a block someone put there. */
async function blocked(ctx: MutationCtx, x: number, y: number): Promise<boolean> {
    const cell = await cellAt(ctx, x, y);
    if (cell) return BLOCKS[cell.kind] ? BLOCKS[cell.kind].solid : false;
    return isSolid(x, y);
}

export const join = mutation({
    args: { session: v.string(), name: v.string() },
    returns: v.null(),
    handler: async (ctx, args) => {
        await getWorld(ctx);
        const now = Date.now();
        const name = args.name.trim().slice(0, MAX_NAME) || "wanderer";

        const existing = await getPlayer(ctx, args.session);
        if (existing) {
            await ctx.db.patch("players", existing._id, { name, lastSeen: now });
        } else {
            const others = await ctx.db.query("players").collect();
            const spot = arrivalSpot(others);
            await ctx.db.insert("players", {
                session: args.session,
                name,
                x: spot.x,
                y: spot.y,
                level: 1,
                xp: 0,
                hp: 36,
                maxHp: 36,
                gold: 0,
                potions: 1,
                kills: 0,
                wood: 4,
                stone: 2,
                placed: 0,
                saidText: "",
                saidAt: 0,
                lastSeen: now,
                lastMove: 0,
                lastBuild: 0,
                lastHurt: 0,
                graceUntil: now + GRACE_MS,
                far: 0,
            });
            await post(ctx, name, `${name} walks onto the commons.`, "system");
        }

        await ensureTicking(ctx);
        return null;
    },
});

export const heartbeat = mutation({
    args: { session: v.string() },
    returns: v.null(),
    handler: async (ctx, args) => {
        const player = await getPlayer(ctx, args.session);
        if (!player) return null;
        await ctx.db.patch("players", player._id, { lastSeen: Date.now() });
        await ensureTicking(ctx);
        return null;
    },
});

export const move = mutation({
    args: { session: v.string(), dx: v.number(), dy: v.number() },
    returns: v.null(),
    handler: async (ctx, args) => {
        const player = await getPlayer(ctx, args.session);
        if (!player || player.hp <= 0) return null;

        const now = Date.now();
        if (now - player.lastMove < MOVE_COOLDOWN_MS) return null;

        const dx = Math.sign(args.dx);
        const dy = Math.sign(args.dy);
        if ((dx === 0 && dy === 0) || (dx !== 0 && dy !== 0)) return null;

        const nx = player.x + dx;
        const ny = player.y + dy;

        /* Walking into a monster is an attack. */
        const monsters = await ctx.db.query("monsters").collect();
        const target = monsters.find((m) => m.x === nx && m.y === ny);

        if (target) {
            const spec = MONSTERS[target.kind];
            const swing = 3 + player.level * 2 + Math.floor(Math.random() * 4);
            const left = target.hp - swing;

            if (left > 0) {
                await ctx.db.patch("monsters", target._id, { hp: left });
                await ctx.db.patch("players", player._id, {
                    lastMove: now,
                    lastSeen: now,
                });
                return null;
            }

            await ctx.db.delete("monsters", target._id);
            const drop = spec.gold + Math.floor(Math.random() * spec.gold);

            let { level, xp, maxHp, hp } = player;
            xp += spec.xp;
            let levelled = false;
            while (xp >= xpForLevel(level)) {
                xp -= xpForLevel(level);
                level += 1;
                maxHp += 8;
                hp = maxHp;
                levelled = true;
            }

            await ctx.db.patch("players", player._id, {
                level,
                xp,
                hp,
                maxHp,
                gold: player.gold + drop,
                kills: player.kills + 1,
                potions: Math.random() < 0.18 ? player.potions + 1 : player.potions,
                lastMove: now,
                lastSeen: now,
            });

            await post(
                ctx,
                player.name,
                `${player.name} killed a ${spec.name}. +${spec.xp} xp, +${drop} gold.`,
                "kill"
            );
            if (levelled) {
                await post(ctx, player.name, `${player.name} reached level ${level}.`, "level");
            }
            return null;
        }

        if (await blocked(ctx, nx, ny)) return null;

        const others = await ctx.db.query("players").collect();
        if (
            others.some(
                (other) =>
                    other._id !== player._id &&
                    other.hp > 0 &&
                    other.x === nx &&
                    other.y === ny
            )
        ) {
            return null;
        }

        const distance = Math.round(Math.hypot(nx, ny));
        await ctx.db.patch("players", player._id, {
            x: nx,
            y: ny,
            lastMove: now,
            lastSeen: now,
            far: Math.max(player.far || 0, distance),
        });
        await ensureTicking(ctx);
        return null;
    },
});

/* Chop a tree or mine a rock next to you. Both grow back. */
export const harvest = mutation({
    args: { session: v.string(), x: v.number(), y: v.number() },
    returns: v.string(),
    handler: async (ctx, args) => {
        const player = await getPlayer(ctx, args.session);
        if (!player || player.hp <= 0) return "no";

        const now = Date.now();
        if (now - player.lastBuild < BUILD_COOLDOWN_MS) return "wait";
        if (!withinReach(player, args.x, args.y)) return "too far";

        const existing = await cellAt(ctx, args.x, args.y);
        if (existing) return "nothing to gather";

        const tile = tileAt(args.x, args.y);
        if (tile !== TREE && tile !== ROCK) return "nothing to gather";

        const isTree = tile === TREE;
        await ctx.db.insert("cells", {
            x: args.x,
            y: args.y,
            chunk: chunkKey(args.x, args.y),
            kind: isTree ? "stump" : "rubble",
            owner: "",
            ownerName: "",
            text: "",
            regrowAt: now + (isTree ? REGROW_TREE_MS : REGROW_ROCK_MS),
        });

        const gain = 2 + Math.floor(Math.random() * 2);
        await ctx.db.patch("players", player._id, {
            wood: player.wood + (isTree ? gain : 0),
            stone: player.stone + (isTree ? 0 : gain),
            lastBuild: now,
            lastSeen: now,
        });

        await ensureTicking(ctx);
        return isTree ? `+${gain} wood` : `+${gain} stone`;
    },
});

export const build = mutation({
    args: {
        session: v.string(),
        x: v.number(),
        y: v.number(),
        kind: v.string(),
        text: v.optional(v.string()),
    },
    returns: v.string(),
    handler: async (ctx, args) => {
        const player = await getPlayer(ctx, args.session);
        if (!player || player.hp <= 0) return "no";
        if (!BUILDABLE.includes(args.kind)) return "cannot build that";

        const now = Date.now();
        if (now - player.lastBuild < BUILD_COOLDOWN_MS) return "wait";
        if (!withinReach(player, args.x, args.y)) return "too far";
        if (inSafeZone(args.x, args.y)) return "not at the crossroads";

        const existing = await cellAt(ctx, args.x, args.y);
        if (existing && existing.regrowAt === 0) return "something is there";

        /*
         * tileAt() describes the generated landscape, which never changes —
         * a chopped tree still reads as TREE forever. What you actually did
         * to it lives in the overlay, so a stump or rubble here means the
         * ground is clear and yours to build on. Without this, harvesting a
         * tile made it permanently unbuildable, which is backwards.
         */
        const cleared =
            existing && (existing.kind === "stump" || existing.kind === "rubble");
        const tile = tileAt(args.x, args.y);
        if ((tile === ROCK || tile === TREE) && !cleared) return "clear it first";

        const monsters = await ctx.db.query("monsters").collect();
        if (monsters.some((m) => m.x === args.x && m.y === args.y)) return "occupied";
        const standing = await ctx.db.query("players").collect();
        if (standing.some((p) => p.hp > 0 && p.x === args.x && p.y === args.y)) {
            return "someone is standing there";
        }

        const spec = BLOCKS[args.kind];
        if (player.wood < spec.wood || player.stone < spec.stone) {
            return `need ${spec.wood} wood, ${spec.stone} stone`;
        }

        if (existing) await ctx.db.delete("cells", existing._id);
        await ctx.db.insert("cells", {
            x: args.x,
            y: args.y,
            chunk: chunkKey(args.x, args.y),
            kind: args.kind,
            owner: player.session,
            ownerName: player.name,
            text: (args.text || "").slice(0, 60),
            regrowAt: 0,
        });

        await ctx.db.patch("players", player._id, {
            wood: player.wood - spec.wood,
            stone: player.stone - spec.stone,
            placed: player.placed + 1,
            lastBuild: now,
            lastSeen: now,
        });

        await ensureTicking(ctx);
        return `built a ${spec.label}`;
    },
});

/* You can only take down your own work. */
export const demolish = mutation({
    args: { session: v.string(), x: v.number(), y: v.number() },
    returns: v.string(),
    handler: async (ctx, args) => {
        const player = await getPlayer(ctx, args.session);
        if (!player) return "no";

        const now = Date.now();
        if (now - player.lastBuild < BUILD_COOLDOWN_MS) return "wait";
        if (!withinReach(player, args.x, args.y)) return "too far";

        const cell = await cellAt(ctx, args.x, args.y);
        if (!cell || cell.regrowAt !== 0) return "nothing built here";
        if (cell.owner !== player.session) return `${cell.ownerName} built that`;

        const spec = BLOCKS[cell.kind];
        await ctx.db.delete("cells", cell._id);
        await ctx.db.patch("players", player._id, {
            wood: player.wood + Math.floor(spec.wood / 2),
            stone: player.stone + Math.floor(spec.stone / 2),
            placed: Math.max(0, player.placed - 1),
            lastBuild: now,
            lastSeen: now,
        });
        return "taken down";
    },
});

export const say = mutation({
    args: { session: v.string(), text: v.string() },
    returns: v.string(),
    handler: async (ctx, args) => {
        const player = await getPlayer(ctx, args.session);
        const raw = args.text.trim().slice(0, MAX_CHAT);
        if (!player || !raw) return "";
        const now = Date.now();

        if (raw.startsWith("/")) {
            const [command, ...rest] = raw.slice(1).split(" ");
            const body = rest.join(" ").trim();

            if (command === "me" && body) {
                await post(ctx, player.name, `${player.name} ${body}`, "emote");
                await ctx.db.patch("players", player._id, { lastSeen: now });
                return "";
            }
            if (command === "who") {
                const cutoff = now - IDLE_MS;
                const here = (await ctx.db.query("players").collect()).filter(
                    (p) => p.lastSeen > cutoff
                );
                await post(
                    ctx,
                    "world",
                    `On the commons: ${here
                        .map((p) => `${p.name} (lv${p.level})`)
                        .join(", ")}`,
                    "system"
                );
                return "";
            }
            if (command === "where") {
                await post(
                    ctx,
                    "world",
                    `${player.name} is at ${player.x},${player.y} — ${regionName(
                        player.x,
                        player.y
                    )}.`,
                    "system"
                );
                return "";
            }
            if (command === "home") {
                await post(
                    ctx,
                    "world",
                    `The crossroads is at 0,0. ${player.name} is ${Math.round(
                        Math.hypot(player.x, player.y)
                    )} paces out — follow either road back.`,
                    "system"
                );
                return "";
            }
            if (command === "help") {
                await post(
                    ctx,
                    "world",
                    "/me · /who · /where · /home · /help — wasd moves, g gathers, b builds, x removes",
                    "system"
                );
                return "";
            }
            return "unknown command";
        }

        await post(ctx, player.name, raw, "chat");
        await ctx.db.patch("players", player._id, {
            saidText: raw,
            saidAt: now,
            lastSeen: now,
        });
        return "";
    },
});

export const drink = mutation({
    args: { session: v.string() },
    returns: v.null(),
    handler: async (ctx, args) => {
        const player = await getPlayer(ctx, args.session);
        if (!player || player.potions <= 0 || player.hp >= player.maxHp) return null;
        const healed = Math.min(player.maxHp, player.hp + Math.floor(player.maxHp * 0.5));
        await ctx.db.patch("players", player._id, {
            hp: healed,
            potions: player.potions - 1,
            lastSeen: Date.now(),
        });
        return null;
    },
});

export const respawn = mutation({
    args: { session: v.string() },
    returns: v.null(),
    handler: async (ctx, args) => {
        const player = await getPlayer(ctx, args.session);
        if (!player || player.hp > 0) return null;
        const now = Date.now();
        const others = (await ctx.db.query("players").collect()).filter(
            (o) => o._id !== player._id
        );
        const spot = arrivalSpot(others);
        await ctx.db.patch("players", player._id, {
            hp: player.maxHp,
            gold: Math.floor(player.gold * 0.9),
            x: spot.x,
            y: spot.y,
            lastSeen: now,
            lastHurt: 0,
            graceUntil: now + GRACE_MS,
        });
        await ensureTicking(ctx);
        return null;
    },
});

/* Everything one player can see, and nothing else. */
export const state = query({
    args: { session: v.string() },
    returns: v.object({
        now: v.number(),
        phase: v.string(),
        weather: v.string(),
        region: v.string(),
        view: v.object({
            x: v.number(),
            y: v.number(),
            w: v.number(),
            h: v.number(),
        }),
        online: v.number(),
        me: v.union(
            v.object({
                session: v.string(),
                name: v.string(),
                x: v.number(),
                y: v.number(),
                level: v.number(),
                xp: v.number(),
                xpNeeded: v.number(),
                hp: v.number(),
                maxHp: v.number(),
                gold: v.number(),
                potions: v.number(),
                kills: v.number(),
                wood: v.number(),
                stone: v.number(),
                placed: v.number(),
                far: v.number(),
            }),
            v.null()
        ),
        players: v.array(
            v.object({
                name: v.string(),
                x: v.number(),
                y: v.number(),
                level: v.number(),
                hp: v.number(),
                session: v.string(),
                saidText: v.string(),
            })
        ),
        monsters: v.array(
            v.object({
                kind: v.string(),
                x: v.number(),
                y: v.number(),
                hp: v.number(),
                maxHp: v.number(),
            })
        ),
        cells: v.array(
            v.object({
                x: v.number(),
                y: v.number(),
                kind: v.string(),
                ownerName: v.string(),
                text: v.string(),
            })
        ),
        chat: v.array(
            v.object({ name: v.string(), text: v.string(), kind: v.string() })
        ),
    }),
    handler: async (ctx, args) => {
        const world = await ctx.db
            .query("world")
            .withIndex("by_key", (q) => q.eq("key", "singleton"))
            .unique();

        const now = Date.now();
        const cutoff = now - IDLE_MS;
        const everyone = await ctx.db.query("players").collect();
        const active = everyone.filter((p) => p.lastSeen > cutoff);
        const me = everyone.find((p) => p.session === args.session) || null;

        const centreX = me ? me.x : 0;
        const centreY = me ? me.y : 0;
        const halfW = Math.floor(VIEW_W / 2);
        const halfH = Math.floor(VIEW_H / 2);
        const minX = centreX - halfW;
        const maxX = centreX + halfW;
        const minY = centreY - halfH;
        const maxY = centreY + halfH;
        const visible = (x: number, y: number) =>
            x >= minX && x <= maxX && y >= minY && y <= maxY;

        /* Blocks come from the chunks the viewport touches, never the whole
           world — this is what keeps an endless map queryable. */
        const cells = [];
        for (const key of chunksInBox(minX, minY, maxX, maxY)) {
            const chunk = await ctx.db
                .query("cells")
                .withIndex("by_chunk", (q) => q.eq("chunk", key))
                .collect();
            for (const cell of chunk) {
                if (visible(cell.x, cell.y)) cells.push(cell);
            }
        }

        const monsters = (await ctx.db.query("monsters").collect()).filter((m) =>
            visible(m.x, m.y)
        );
        const chat = await ctx.db.query("chat").order("desc").take(CHAT_LIMIT);

        return {
            now,
            phase: phaseAt(now).phase,
            weather: world ? world.weather : "clear",
            region: regionName(centreX, centreY),
            view: { x: minX, y: minY, w: VIEW_W, h: VIEW_H },
            online: active.length,
            me: me
                ? {
                      session: me.session,
                      name: me.name,
                      x: me.x,
                      y: me.y,
                      level: me.level,
                      xp: me.xp,
                      xpNeeded: xpForLevel(me.level),
                      hp: me.hp,
                      maxHp: me.maxHp,
                      gold: me.gold,
                      potions: me.potions,
                      kills: me.kills,
                      wood: me.wood,
                      stone: me.stone,
                      placed: me.placed,
                      far: me.far || 0,
                  }
                : null,
            players: active
                .filter((p) => visible(p.x, p.y))
                .map((p) => ({
                    name: p.name,
                    x: p.x,
                    y: p.y,
                    level: p.level,
                    hp: p.hp,
                    session: p.session,
                    saidText: now - p.saidAt < BUBBLE_MS ? p.saidText : "",
                })),
            monsters: monsters.map((m) => ({
                kind: m.kind,
                x: m.x,
                y: m.y,
                hp: m.hp,
                maxHp: m.maxHp,
            })),
            cells: cells.map((c) => ({
                x: c.x,
                y: c.y,
                kind: c.kind,
                ownerName: c.ownerName,
                text: c.text,
            })),
            chat: chat.map((c) => ({ name: c.name, text: c.text, kind: c.kind })),
        };
    },
});

export const leaderboard = query({
    args: {},
    returns: v.array(
        v.object({
            name: v.string(),
            level: v.number(),
            kills: v.number(),
            placed: v.number(),
            far: v.number(),
        })
    ),
    handler: async (ctx) => {
        const players = await ctx.db.query("players").collect();
        return players
            .sort((a, b) => b.level - a.level || b.kills - a.kills)
            .slice(0, 8)
            .map((p) => ({
                name: p.name,
                level: p.level,
                kills: p.kills,
                placed: p.placed,
                far: p.far || 0,
            }));
    },
});
