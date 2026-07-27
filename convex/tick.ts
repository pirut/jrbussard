import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
    MONSTERS,
    MONSTER_ORDER,
    BLOCKS,
    WEATHERS,
    SIM_RADIUS,
    isSolid,
    inSafeZone,
    openSpotNear,
    phaseAt,
} from "./field";

/*
 * The world's heartbeat: monsters, weather, and regrowth.
 *
 * The map is endless, so population is managed relative to the people playing
 * rather than globally — things spawn in a ring around each player and are
 * forgotten once everyone has walked away. The loop reschedules itself while
 * anybody is on the field and parks when the last player goes idle, so an
 * empty world costs nothing to keep open.
 */

const TICK_MS = 500;
const IDLE_MS = 45_000;
const CHASE_RANGE = 5;
/* How often a single monster can swing, and the hard floor on how often any
   one player can be hurt. Without the second one, a pack of three still
   deletes a new arrival before they can react. */
const SWING_MS = 1200;
const HURT_COOLDOWN_MS = 1100;
/* Out-of-combat healing, so a bad fight is not a dead end. */
const REGEN_MS = 2500;
const REGEN_SAFE_RANGE = 3;
/* Monsters kept alive near each player. */
const PER_PLAYER = 12;
const MAX_MONSTERS = 90;

export const run = internalMutation({
    args: {},
    returns: v.null(),
    handler: async (ctx) => {
        const world = await ctx.db
            .query("world")
            .withIndex("by_key", (q) => q.eq("key", "singleton"))
            .unique();
        if (!world) return null;

        const now = Date.now();
        const cutoff = now - IDLE_MS;

        const everyone = await ctx.db.query("players").collect();
        const active = everyone.filter((p) => p.lastSeen > cutoff);

        if (active.length === 0) {
            await ctx.db.patch("world", world._id, { ticking: false, lastTick: now });
            return null;
        }

        const { phase } = phaseAt(now);
        const isNight = phase === "night" || phase === "dusk";

        /* Weather turns over every couple of minutes. */
        if (now > world.weatherUntil) {
            const next = WEATHERS[Math.floor(Math.random() * WEATHERS.length)];
            await ctx.db.patch("world", world._id, {
                weather: next,
                weatherUntil: now + 90_000 + Math.floor(Math.random() * 120_000),
            });
            if (next !== world.weather) {
                const line =
                    next === "rain"
                        ? "Rain moves in over the commons."
                        : next === "fog"
                        ? "Fog rolls across the field."
                        : next === "storm"
                        ? "A storm breaks. Something is stirring."
                        : "The sky clears.";
                await ctx.db.insert("chat", { name: "world", text: line, kind: "weather" });
            }
        }

        /* Harvested terrain grows back. */
        const regrown = await ctx.db
            .query("cells")
            .withIndex("by_regrow", (q) => q.gt("regrowAt", 0).lte("regrowAt", now))
            .take(12);
        for (const cell of regrown) {
            await ctx.db.delete("cells", cell._id);
        }

        const alive = active.filter((p) => p.hp > 0);
        const monsters = await ctx.db.query("monsters").collect();

        /* Anyone who has broken away from a fight knits back together. */
        for (const player of alive) {
            if (player.hp >= player.maxHp) continue;
            if (now - player.lastMove < REGEN_MS) continue;
            const threatened = monsters.some(
                (m) => Math.hypot(m.x - player.x, m.y - player.y) <= REGEN_SAFE_RANGE
            );
            if (threatened && !inSafeZone(player.x, player.y)) continue;
            const healed = Math.min(
                player.maxHp,
                player.hp + 1 + Math.floor(player.level / 3)
            );
            await ctx.db.patch("players", player._id, { hp: healed });
            player.hp = healed;
        }

        /* Only simulate what somebody is near. */
        const nearAnyone = (x: number, y: number) =>
            active.some((p) => Math.hypot(p.x - x, p.y - y) <= SIM_RADIUS);

        const occupied = new Set(
            alive
                .map((p) => `${p.x},${p.y}`)
                .concat(monsters.map((m) => `${m.x},${m.y}`))
        );

        /* At most one monster lands a blow on a given player per tick. */
        const struck = new Set<string>();

        /* Torches keep monsters at arm's length — a lit camp actually works. */
        const built = await ctx.db
            .query("cells")
            .withIndex("by_regrow", (q) => q.eq("regrowAt", 0))
            .take(400);
        const lit = built.filter((c) => BLOCKS[c.kind] && BLOCKS[c.kind].light > 0);
        const nearLight = (x: number, y: number) =>
            lit.some((t) => Math.hypot(t.x - x, t.y - y) <= BLOCKS[t.kind].light * 0.5);
        const solidBuilt = new Set(
            built
                .filter((c) => BLOCKS[c.kind] && BLOCKS[c.kind].solid)
                .map((c) => `${c.x},${c.y}`)
        );

        let population = 0;

        for (const monster of monsters) {
            const spec = MONSTERS[monster.kind];
            if (!spec) continue;

            /* Forget anything nobody is around to see. */
            if (!nearAnyone(monster.x, monster.y)) {
                await ctx.db.delete("monsters", monster._id);
                continue;
            }
            population += 1;

            let nearest = null;
            let nearestDistance = Infinity;
            for (const player of alive) {
                const distance = Math.hypot(player.x - monster.x, player.y - monster.y);
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearest = player;
                }
            }

            if (nearest && nearestDistance <= 1 && !inSafeZone(nearest.x, nearest.y)) {
                const ready = now - (monster.lastHit || 0) >= SWING_MS;
                const exposed = now - (nearest.lastHurt || 0) >= HURT_COOLDOWN_MS;
                const settling = now < (nearest.graceUntil || 0);
                if (!ready || !exposed || settling || struck.has(nearest._id)) continue;
                struck.add(nearest._id);
                await ctx.db.patch("monsters", monster._id, { lastHit: now });

                /* Night bites harder; the first couple of levels bite less,
                   so arriving on the commons is not an instant death. */
                const newcomer = nearest.level < 3 ? 0.5 : 1;
                const bite = Math.max(
                    1,
                    Math.round(
                        (spec.damage - Math.floor(nearest.level / 2)) *
                            (isNight ? 1.15 : 1) *
                            newcomer
                    )
                );
                const hp = nearest.hp - bite;
                if (hp <= 0) {
                    await ctx.db.patch("players", nearest._id, { hp: 0 });
                    await ctx.db.insert("chat", {
                        name: nearest.name,
                        text: `${nearest.name} was killed by a ${spec.name}.`,
                        kind: "death",
                    });
                } else {
                    await ctx.db.patch("players", nearest._id, { hp, lastHurt: now });
                }
                nearest.lastHurt = now;
                nearest.hp = Math.max(hp, 0);
                continue;
            }

            let dx = 0;
            let dy = 0;
            const chaseRange = isNight ? CHASE_RANGE + 3 : CHASE_RANGE;
            if (nearest && nearestDistance < chaseRange) {
                dx = Math.sign(nearest.x - monster.x);
                dy = Math.sign(nearest.y - monster.y);
                if (Math.random() < 0.5) dx = 0;
                else dy = 0;
            } else if (Math.random() < 0.35) {
                dx = Math.round(Math.random() * 2 - 1);
                dy = dx === 0 ? Math.round(Math.random() * 2 - 1) : 0;
            }

            if (dx === 0 && dy === 0) continue;
            const nx = monster.x + dx;
            const ny = monster.y + dy;
            if (isSolid(nx, ny)) continue;
            if (solidBuilt.has(`${nx},${ny}`)) continue;
            if (occupied.has(`${nx},${ny}`)) continue;
            /* The crossroads is a truce, and torchlight holds them off. */
            if (inSafeZone(nx, ny)) continue;
            if (!isNight && nearLight(nx, ny)) continue;

            occupied.delete(`${monster.x},${monster.y}`);
            occupied.add(`${nx},${ny}`);
            await ctx.db.patch("monsters", monster._id, { x: nx, y: ny });
        }

        /* Restock around each player rather than across the whole map. */
        const target = Math.min(
            MAX_MONSTERS,
            active.length *
                (PER_PLAYER + (isNight ? 5 : 0) + (world.weather === "storm" ? 3 : 0))
        );

        if (population < target) {
            const missing = Math.min(4, target - population);
            for (let i = 0; i < missing; i += 1) {
                const anchor = active[Math.floor(Math.random() * active.length)];
                const ceiling = Math.min(
                    MONSTER_ORDER.length,
                    1 + Math.floor(anchor.level / 2.5)
                );
                const kind = MONSTER_ORDER[Math.floor(Math.random() * ceiling)];
                const spec = MONSTERS[kind];
                const spot = openSpotNear(anchor.x, anchor.y, 14, 30, Math.random);
                if (!spot) continue;
                await ctx.db.insert("monsters", {
                    kind,
                    x: spot.x,
                    y: spot.y,
                    hp: spec.hp,
                    maxHp: spec.hp,
                });
            }
        }

        /* Forget players who have been gone a long time. Their buildings stay. */
        for (const player of everyone) {
            if (player.lastSeen < now - IDLE_MS * 20) {
                await ctx.db.delete("players", player._id);
            }
        }

        await ctx.db.patch("world", world._id, { lastTick: now });
        await ctx.scheduler.runAfter(TICK_MS, internal.tick.run, {});
        return null;
    },
});
