import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { survivalStep } from "../src/lib/survival.js";
import type { Doc } from "./_generated/dataModel";
import { nearbyCells, experience } from "./survival";
import { projectRows } from "./game";
import { worldEffects } from "../src/lib/game/projects.js";
import {
  creatureStep,
  biteFor,
  flees,
  sidesteps,
  pickSpawn,
} from "../src/lib/game/creatures.js";
import { bumpStats } from "../src/lib/game/stats.js";
import {
  isNight as nightPhase,
  phaseChange,
  survivorsOf,
  DAWN_XP,
} from "../src/lib/game/daycycle.js";
import { solidAt } from "../src/lib/ground.js";
import {
  MONSTERS,
  BLOCKS,
  WEATHERS,
  SIM_RADIUS,
  TICK_MS,
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
 *
 * Built and dug tiles pile up for good, so the tick never reads the country
 * around a player wholesale: it looks up only the tiles a creature is about
 * to step onto, and the few around them a torch could light. What one tick
 * reads is then bounded by the creatures and players in it, not by how much
 * anyone has built.
 */

const IDLE_MS = 45_000;
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
/* Survival checks run every 15 seconds per player; when a crowd is due at
   once, the rest wait a tick or two. */
const SURVIVAL_PER_TICK = 25;
/* The furthest any block's light holds creatures off. */
const LIGHT_REACH = Math.max(
  ...Object.values(BLOCKS).map((block) => block.light * 0.5),
);

const solidCell = (cell: Doc<"cells">) =>
  /* A shut door keeps things out, which is the point of building one. */
  cell.kind === "door"
    ? cell.open === false
    : Boolean(BLOCKS[cell.kind] && BLOCKS[cell.kind].solid);

export const run = internalMutation({
  /* Absent on loops started before restarts were tracked. */
  args: { loop: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const world = await ctx.db
      .query("world")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    if (!world) return null;
    /* A newer loop has taken over (see ensureTicking): this one stops. */
    const loop = world.loop ?? 0;
    if ((args.loop ?? 0) !== loop) return null;

    const now = Date.now();
    const cutoff = now - IDLE_MS;

    const active = await ctx.db
      .query("players")
      .withIndex("by_lastSeen", (q) => q.gt("lastSeen", cutoff))
      .take(200);

    if (active.length === 0) {
      await ctx.db.patch("world", world._id, { ticking: false, lastTick: now });
      return null;
    }

    const { phase } = phaseAt(now);
    const isNight = nightPhase(phase);
    /* What the crossroads projects have done for everyone. */
    const effects = worldEffects(
      Object.values(await projectRows(ctx))
        .filter((row) => row.done)
        .map((row) => row.key),
    );

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
        await ctx.db.insert("chat", {
          name: "world",
          text: line,
          kind: "weather",
        });
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
    let monsters = await ctx.db.query("monsters").take(100);

    /* Dusk and dawn, once each: shades come with the dark and burn away
       with the light, and whoever is still out in the wild has lived
       through the night. */
    const turn = phaseChange(world.phase, phase);
    if (world.phase !== phase)
      await ctx.db.patch("world", world._id, { phase });
    if (turn.line)
      await ctx.db.insert("chat", { name: "world", text: turn.line, kind: "weather" });
    if (turn.event === "dawn") {
      for (const m of monsters)
        if (MONSTERS[m.kind]?.night) await ctx.db.delete("monsters", m._id);
      monsters = monsters.filter((m) => !MONSTERS[m.kind]?.night);
      for (const player of survivorsOf(alive, inSafeZone)) {
        const next = {
          ...experience(player, DAWN_XP),
          stats: bumpStats(player.stats, { nights: 1 }),
        };
        await ctx.db.patch("players", player._id, next);
        Object.assign(player, next);
      }
    }

    let survivals = 0;
    for (const player of alive) {
      if (
        now - (player.lastSurvival || 0) >= 15_000 &&
        survivals < SURVIVAL_PER_TICK
      ) {
        survivals += 1;
        const camp = await nearbyCells(ctx, player.x, player.y, 4);
        const fire = camp.some(
          (c) => c.kind === "campfire" && (c.fuelUntil || 0) > now,
        );
        const next = survivalStep(player, {
          fire,
          safe: inSafeZone(player.x, player.y),
          cold:
            isNight || world.weather === "storm" || world.weather === "rain",
        });
        await ctx.db.patch("players", player._id, {
          ...next,
          lastSurvival: now,
        });
        Object.assign(player, next);
      }
      if (
        player.hp <= 0 ||
        player.hp >= player.maxHp ||
        (player.hunger ?? 100) < 25 ||
        (player.warmth ?? 100) <= 0
      )
        continue;
      if (now - Math.max(player.lastMove, player.lastHurt || 0) < REGEN_MS)
        continue;
      const threatened = monsters.some(
        (m) => Math.hypot(m.x - player.x, m.y - player.y) <= REGEN_SAFE_RANGE,
      );
      if (threatened && !inSafeZone(player.x, player.y)) continue;
      const healed = Math.min(
        player.maxHp,
        player.hp + 1 + effects.regen + Math.floor(player.level / 3),
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
        .concat(monsters.map((m) => `${m.x},${m.y}`)),
    );

    /* At most one monster lands a blow on a given player per tick. */
    const struck = new Set<string>();

    /* What stands on a tile, looked up once per tile per tick. */
    const cellCache = new Map<string, Doc<"cells"> | null>();
    const cellAt = async (x: number, y: number) => {
      const key = `${x},${y}`;
      if (!cellCache.has(key))
        cellCache.set(
          key,
          await ctx.db
            .query("cells")
            .withIndex("by_pos", (q) => q.eq("x", x).eq("y", y))
            .first(),
        );
      return cellCache.get(key)!;
    };
    /* Dug and piled ground; a flooded pit is water like any other. */
    const groundCache = new Map<string, boolean>();
    const solidGround = async (x: number, y: number) => {
      const key = `${x},${y}`;
      if (!groundCache.has(key)) {
        const ground = await ctx.db
          .query("ground")
          .withIndex("by_x_and_y", (q) => q.eq("x", x).eq("y", y))
          .first();
        groundCache.set(key, solidAt(x, y, ground?.edit));
      }
      return groundCache.get(key)!;
    };
    /* Torches keep monsters at arm's length — a lit camp actually works. */
    const lightCache = new Map<string, boolean>();
    const nearLight = async (x: number, y: number) => {
      const key = `${x},${y}`;
      if (!lightCache.has(key)) {
        const around = await nearbyCells(ctx, x, y, LIGHT_REACH);
        lightCache.set(
          key,
          around.some(
            (c) =>
              BLOCKS[c.kind] &&
              BLOCKS[c.kind].light > 0 &&
              (c.kind !== "campfire" || (c.fuelUntil || 0) > now) &&
              Math.hypot(c.x - x, c.y - y) <= BLOCKS[c.kind].light * 0.5,
          ),
        );
      }
      return lightCache.get(key)!;
    };

    /* Whether a creature may step onto a tile. */
    const canEnter = async (x: number, y: number) => {
      if (occupied.has(`${x},${y}`)) return false;
      /* The crossroads is a truce, and torchlight holds them off. */
      if (inSafeZone(x, y)) return false;
      /* Something built there decides; otherwise the ground does. */
      const overlay = await cellAt(x, y);
      if (overlay ? solidCell(overlay) : await solidGround(x, y)) return false;
      return !(await nearLight(x, y));
    };

    let population = 0;

    for (const monster of monsters) {
      const spec = MONSTERS[monster.kind];
      if (!spec) continue;

      /* Forget anything nobody is around to see, and any shade that
         outlived the night while the loop was parked. */
      if (!nearAnyone(monster.x, monster.y) || (spec.night && !isNight)) {
        await ctx.db.delete("monsters", monster._id);
        continue;
      }
      population += 1;

      let nearest = null;
      let nearestDistance = Infinity;
      for (const player of alive) {
        if (player.hp <= 0) continue;
        const distance = Math.hypot(player.x - monster.x, player.y - monster.y);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = player;
        }
      }

      if (
        nearest &&
        nearestDistance <= 1 &&
        !inSafeZone(nearest.x, nearest.y) &&
        !flees(monster)
      ) {
        const ready = now - (monster.lastHit || 0) >= SWING_MS;
        const exposed = now - (nearest.lastHurt || 0) >= HURT_COOLDOWN_MS;
        const settling = now < (nearest.graceUntil || 0);
        if (!ready || !exposed || settling || struck.has(nearest._id)) continue;
        struck.add(nearest._id);
        await ctx.db.patch("monsters", monster._id, { lastHit: now });

        /* Night bites harder; the first couple of levels bite less,
                   so arriving on the commons is not an instant death. */
        const bite = biteFor(monster.kind, nearest, {
          night: isNight,
          soften: effects.nightBite,
        });
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

      /* What it wants is up to its temper (src/lib/game/creatures.js);
         whether it can have it is up to the ground. */
      const { dx, dy } = creatureStep({
        kind: monster.kind,
        hp: monster.hp,
        maxHp: monster.maxHp,
        x: monster.x,
        y: monster.y,
        target: nearest
          ? {
              x: nearest.x,
              y: nearest.y,
              lantern: (nearest.tools?.lantern || 0) > 0,
            }
          : null,
        distance: nearestDistance,
        night: isNight,
        rng: Math.random,
      });

      if (dx === 0 && dy === 0) continue;
      /* Something running for it tries either side if the way straight
         back is blocked. */
      const options = [
        { dx, dy },
        ...(flees(monster) ? sidesteps({ dx, dy }, Math.random) : []),
      ];
      for (const step of options) {
        const nx = monster.x + step.dx;
        const ny = monster.y + step.dy;
        if (!(await canEnter(nx, ny))) continue;
        occupied.delete(`${monster.x},${monster.y}`);
        occupied.add(`${nx},${ny}`);
        await ctx.db.patch("monsters", monster._id, { x: nx, y: ny });
        break;
      }
    }

    /* Restock around each player rather than across the whole map. */
    const target = Math.min(
      MAX_MONSTERS,
      active.length *
        (PER_PLAYER +
          (isNight ? effects.nightSpawn : 0) +
          (world.weather === "storm" ? 3 : 0)),
    );

    if (population < target) {
      const missing = Math.min(4, target - population);
      for (let i = 0; i < missing; i += 1) {
        const anchor = active[Math.floor(Math.random() * active.length)];
        const kind = pickSpawn({
          level: anchor.level,
          night: isNight,
          rng: Math.random,
        });
        const spec = MONSTERS[kind];
        const spot = openSpotNear(anchor.x, anchor.y, 14, 30, Math.random);
        if (!spot || occupied.has(`${spot.x},${spot.y}`)) continue;
        const overlay = await cellAt(spot.x, spot.y);
        if (
          (await solidGround(spot.x, spot.y)) ||
          (overlay && solidCell(overlay)) ||
          (await nearLight(spot.x, spot.y))
        )
          continue;
        occupied.add(`${spot.x},${spot.y}`);
        await ctx.db.insert("monsters", {
          kind,
          x: spot.x,
          y: spot.y,
          hp: spec.hp,
          maxHp: spec.hp,
        });
      }
    }

    // Characters and camps persist when their owners leave.
    const oldChat = await ctx.db.query("chat").order("desc").take(75);
    for (const row of oldChat.slice(50)) await ctx.db.delete("chat", row._id);

    await ctx.db.patch("world", world._id, { lastTick: now });
    await ctx.scheduler.runAfter(TICK_MS, internal.tick.run, { loop });
    return null;
  },
});
