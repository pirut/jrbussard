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
 * The world's heartbeat: monsters, weather, regrowth, survival and the day
 * cycle. It is the only place monsters are created, moved or allowed to bite;
 * world.ts only damages and removes them when a player attacks. Everything a
 * player does happens in world.ts and game.ts. Its one entry point, `run`,
 * is internal: it is scheduled by ensureTicking (world.ts), never called by a
 * client, and it is the server's authority over the world while nobody acts.
 *
 * The self-rescheduling loop. Convex has no process to keep alive, so the
 * "loop" is a chain of scheduled mutations: each `run` does one beat of
 * work and, as its very last step, schedules the next `run` TICK_MS (500 ms,
 * field.ts) later. The chain is started from outside by ensureTicking, which
 * join, heartbeat and most player actions call, and which schedules `run` for
 * immediately whenever the world is not `ticking`.
 *
 * Why it parks. A `run` that finds nobody present (no player with lastSeen
 * inside IDLE_MS) writes `ticking: false` and returns WITHOUT scheduling a
 * successor, so the chain simply ends. An empty world then costs nothing:
 * no function calls, no writes, and no queries invalidated every half
 * second. The next player to join or send a heartbeat restarts it. Mutations
 * are serialised, so a player arriving as the loop parks cannot be missed:
 * either the tick sees their fresh lastSeen and keeps going, or ensureTicking
 * sees `ticking: false` and starts a new chain.
 *
 * Why it can also be restarted while "running". A `run` that throws (for
 * instance by exceeding a per-mutation read or write limit) rolls back
 * everything it did, including the `lastTick` write, and never reaches the
 * reschedule line, so `ticking` would stay true forever. ensureTicking treats
 * `lastTick` older than TICK_STALL_MS as a dead loop and starts a fresh one.
 * Each start bumps `world.loop`, and each `run` carries the number it was
 * scheduled with and stands down if it no longer matches, so an old loop that
 * was merely running late can never tick alongside the new one. A loop
 * scheduled before `loop` existed carries no number and counts as 0.
 *
 * Population is managed relative to the people playing rather than globally:
 * things spawn in a ring around each player and are forgotten once nobody is
 * near. Creatures are simulated only within SIM_RADIUS of a present player.
 *
 * Read budget. Built and dug tiles pile up for good, so the tick never reads
 * the country around a player wholesale: it looks up only the tiles a
 * creature is about to step onto (by_pos / by_x_and_y), and the few around
 * them a torch could light. What one tick reads is then bounded by the
 * creatures (at most 100 read, MAX_MONSTERS 90 kept) and players (at most
 * 200) in it, not by how much anyone has built. The rules themselves (creature
 * behaviour, survival, day cycle, project effects) are shared plain JS in
 * src/lib/ and src/lib/game/; this file only gathers what they need, applies
 * what they decide, and persists it.
 *
 * Randomness: ticks use Math.random freely (weather, spawns, creature
 * moves). Unlike terrain, none of it is replayed on the client, which only
 * ever sees the resulting rows through world.state.
 */

/* A player counts as present, and keeps the loop alive, while lastSeen is
   this recent. Must match IDLE_MS in world.ts or the tick and the state
   query would disagree about who is on the field. The client heartbeat
   (every 15 s) keeps a standing player inside it. */
const IDLE_MS = 45_000;
/* How often a single monster can swing, and the hard floor on how often any
   one player can be hurt. Without the second one, a pack of three still
   deletes a new arrival before they can react. */
const SWING_MS = 1200;
const HURT_COOLDOWN_MS = 1100;
/* Out-of-combat healing, so a bad fight is not a dead end: a player who has
   neither moved nor been hurt for REGEN_MS heals a point per tick, unless a
   monster is within REGEN_SAFE_RANGE tiles (the crossroads is exempt). */
const REGEN_MS = 2500;
const REGEN_SAFE_RANGE = 3;
/* Monsters kept alive near each player. MAX_MONSTERS stays under the
   take(100) used to read them all, so the whole herd fits in one read. */
const PER_PLAYER = 12;
const MAX_MONSTERS = 90;
/* Survival checks run every 15 seconds per player; when a crowd is due at
   once, the rest wait a tick or two. Each check reads up to nine columns
   of cells, so this caps that cost per tick. */
const SURVIVAL_PER_TICK = 25;
/* The furthest any block's light holds creatures off: half a block's
   `light` value in tiles (a campfire's 9 gives 4.5), the same factor
   nearLight applies per block. */
const LIGHT_REACH = Math.max(
  ...Object.values(BLOCKS).map((block) => block.light * 0.5),
);

/* Whether a built cell blocks a creature; mirrors world.ts's idea of solid
   so a monster never stands where a player could not. */
const solidCell = (cell: Doc<"cells">) =>
  /* A shut door keeps things out, which is the point of building one. */
  cell.kind === "door"
    ? cell.open === false
    : Boolean(BLOCKS[cell.kind] && BLOCKS[cell.kind].solid);

/*
 * One beat of the world. Internal: scheduled only by ensureTicking
 * (world.ts, with delay 0) and by itself at the end of the beat.
 *
 * args.loop: the generation this run was scheduled for (see the header). It
 * is passed through unchanged to the successor, so a chain stays one chain.
 *
 * Returns null. Order of work: stand down if superseded; park if nobody is
 * present; weather; regrowth; dusk/dawn; per-player survival and healing;
 * creature attacks and moves; restocking; chat trimming; reschedule.
 *
 * Reads: world singleton, up to 200 present players (by_lastSeen), the
 * project rows (one by_key lookup per project), at most 12 regrown cells
 * (by_regrow), up to 100 monsters, per-tile cells/ground lookups that are
 * cached for the beat, and the newest 75 chat rows.
 * Writes: world, players (survival, healing, damage, dawn reward), monsters,
 * cells (regrowth deletes), chat (announcements and trimming).
 */
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

    /* Nobody is here: park. Not rescheduling is what ends the loop, and
       ticking: false is what lets ensureTicking start it again. Monsters are
       left as they are; the first beat after waking forgets any that nobody
       is near. */
    if (active.length === 0) {
      await ctx.db.patch("world", world._id, { ticking: false, lastTick: now });
      return null;
    }

    /* The sky is a pure function of the wall clock (field.ts phaseAt), so
       the day needs no stored clock; world.state sends the same phase to
       clients. world.phase only remembers which phase the tick last saw. */
    const { phase } = phaseAt(now);
    const isNight = nightPhase(phase);
    /* What the crossroads projects have done for everyone. */
    const effects = worldEffects(
      Object.values(await projectRows(ctx))
        .filter((row) => row.done)
        .map((row) => row.key),
    );

    /* Weather turns over every 1.5 to 3.5 minutes (90 s plus up to 120 s).
       The pick is uniform over WEATHERS, whose repeated "clear" entries are
       what weight it towards fair weather; picking the current weather again
       just extends it without a chat line. */
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

    /* Harvested terrain grows back: stumps and rubble past their regrowAt
       are deleted, which lets the generated tree or rock show through again.
       by_regrow's lower bound of 0 skips built blocks; the take(12) paces a
       backlog (say after a long park) over several beats. */
    const regrown = await ctx.db
      .query("cells")
      .withIndex("by_regrow", (q) => q.gt("regrowAt", 0).lte("regrowAt", now))
      .take(12);
    for (const cell of regrown) {
      await ctx.db.delete("cells", cell._id);
    }

    /* Dead players stay in `active` (they still keep the loop alive and the
       world simulated around them) but are not hurt, healed or targeted. */
    const alive = active.filter((p) => p.hp > 0);
    let monsters = await ctx.db.query("monsters").take(100);

    /* Dusk and dawn, once each: shades come with the dark and burn away
       with the light, and whoever is still out in the wild has lived
       through the night. world.phase remembers the last sky seen, so this
       fires on a change; a world that was parked through a dawn never sees
       it (the shade sweep in the monster loop below covers that case). */
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

    /* Per present player: the 15 s hunger and warmth step, then healing.
       Local copies of the rows are updated alongside each patch
       (Object.assign) so later steps in this beat see the new values. */
    let survivals = 0;
    for (const player of alive) {
      if (
        now - (player.lastSurvival || 0) >= 15_000 &&
        survivals < SURVIVAL_PER_TICK
      ) {
        survivals += 1;
        /* A fire within 4 tiles that still has fuel warms them. */
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
      /* No healing when full, starving (under 25 hunger) or freezing. */
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

    /* Only simulate what somebody is near (SIM_RADIUS, field.ts: wider than
       the 61 x 29 view, so things are already moving before they appear). */
    const nearAnyone = (x: number, y: number) =>
      active.some((p) => Math.hypot(p.x - x, p.y - y) <= SIM_RADIUS);

    /* "x,y" of every tile a living player or monster stands on, kept current
       as monsters move and spawn so two never share a tile. */
    const occupied = new Set(
      alive
        .map((p) => `${p.x},${p.y}`)
        .concat(monsters.map((m) => `${m.x},${m.y}`)),
    );

    /* At most one monster lands a blow on a given player per tick. */
    const struck = new Set<string>();

    /* What stands on a tile, looked up once per tile per tick. The caches
       below are the read-budget guard: a pack crowding the same tiles costs
       one lookup per tile, not one per creature. */
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
    /* Torches keep monsters at arm's length — a lit camp actually works.
       Reads only the cells within LIGHT_REACH of the tile, then applies each
       block's own radius (light * 0.5 tiles); an unfuelled campfire is dark. */
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

    /* Monsters kept this beat, counted to decide how many to restock. */
    let population = 0;

    for (const monster of monsters) {
      const spec = MONSTERS[monster.kind];
      if (!spec) continue;

      /* Forget anything nobody is around to see, and any shade that
         outlived the night while the loop was parked. Deleting is how the
         herd follows the players around an endless map. */
      if (!nearAnyone(monster.x, monster.y) || (spec.night && !isNight)) {
        await ctx.db.delete("monsters", monster._id);
        continue;
      }
      population += 1;

      /* Monsters chase the nearest living player; only that one can be bitten. */
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
        /* A monster next to its target either bites or waits; it does not
           also move. Four gates hold a bite back: the monster's own swing
           cooldown, the player's hurt cooldown (so a pack cannot chain
           bites), the grace window after arriving or reviving, and at most
           one blow per player per beat (`struck`). */
        const ready = now - (monster.lastHit || 0) >= SWING_MS;
        const exposed = now - (nearest.lastHurt || 0) >= HURT_COOLDOWN_MS;
        const settling = now < (nearest.graceUntil || 0);
        if (!ready || !exposed || settling || struck.has(nearest._id)) continue;
        struck.add(nearest._id);
        await ctx.db.patch("monsters", monster._id, { lastHit: now });

        /* Night bites harder; the first couple of levels bite less,
                   so arriving on the commons is not an instant death.
                   `soften` is the beacon project's discount (0.75, else 1;
                   see worldEffects). */
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

    /* Restock around each player rather than across the whole map. The
       target scales with how many are present, rises at night (a finished
       watchtower trims the bonus) and by 3 per player in a storm, and is
       capped at MAX_MONSTERS. */
    const target = Math.min(
      MAX_MONSTERS,
      active.length *
        (PER_PLAYER +
          (isNight ? effects.nightSpawn : 0) +
          (world.weather === "storm" ? 3 : 0)),
    );

    if (population < target) {
      /* At most 4 arrive per beat, so a crowd fills in over a few seconds
         instead of appearing at once. */
      const missing = Math.min(4, target - population);
      for (let i = 0; i < missing; i += 1) {
        const anchor = active[Math.floor(Math.random() * active.length)];
        const kind = pickSpawn({
          level: anchor.level,
          night: isNight,
          rng: Math.random,
        });
        const spec = MONSTERS[kind];
        /* 14 to 30 tiles out: the view is 61 x 29 (half-height 14, half-width
           30), so they come from the edge of sight or beyond, never on top
           of the player. */
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

    /* Keep the log short: the newest 50 chat rows survive. world.ts trims
       the same way after each message; this catches the announcements the
       tick and game.ts add. Characters and camps are never swept here, they
       persist when their owners leave. */
    const oldChat = await ctx.db.query("chat").order("desc").take(75);
    for (const row of oldChat.slice(50)) await ctx.db.delete("chat", row._id);

    /* Heartbeat stamp, then the self-reschedule that keeps the loop alive.
       Reaching this line is what proves the beat succeeded: if anything above
       threw, neither write happened and ensureTicking will see a stale
       lastTick. TICK_MS is the gap between beats, not between starts, so a
       slow beat only makes the world tick slower. */
    await ctx.db.patch("world", world._id, { lastTick: now });
    await ctx.scheduler.runAfter(TICK_MS, internal.tick.run, { loop });
    return null;
  },
});
