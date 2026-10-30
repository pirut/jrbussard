import { query, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { appearanceValidator } from "./schema";
import { appearanceOf, appearanceValid } from "../src/lib/appearance.js";
import {
  ITEMS,
  RECIPES,
  FOOD,
  inventoryOf,
  resourceAt,
  recipeBlocker,
} from "../src/lib/survival.js";
import {
  planTerraform,
  solidAt,
  SHOVEL_COOLDOWN_MS,
} from "../src/lib/ground.js";
import {
  planBuild,
  planDemolish,
  BUILDABLE,
  BUILD_COOLDOWN_MS,
} from "../src/lib/building.js";
import { inventoryPatch, experience, stationsNear } from "./survival";
import { bumpStats } from "../src/lib/game/stats.js";
import { lootFor, swingFor } from "../src/lib/game/creatures.js";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  MONSTERS,
  BLOCKS,
  REGROW_TREE_MS,
  REGROW_ROCK_MS,
  CHUNK,
  VIEW_W,
  VIEW_H,
  isSolid,
  withinReach,
  chunkKey,
  chunksInBox,
  arrivalSpot,
  phaseAt,
  regionName,
  xpForLevel,
  TICK_STALL_MS,
} from "./field";

/*
 * The Commons' public API: every query and mutation a player's client can
 * call, plus the small helpers they share. Everything here is
 * server-authoritative: the client asks, the server decides. The world is
 * endless, so every query is scoped to what one player can actually see.
 *
 * What lives here: joining and presence, walking and fighting, gathering,
 * building, shovelling, crafting, eating, chests, chat, and the one big
 * `state` snapshot the client renders from. What does not: the world's own
 * motion (monsters, weather, regrowth, hunger and warmth are all in tick.ts),
 * the quest chain and crossroads projects (game.ts), the main-site presence
 * (site.ts), and the rules themselves. Whether a build, a dig, a recipe or a
 * demolition is allowed is decided by the pure functions in
 * src/lib/{building,ground,survival}.js, which the browser and the native
 * app also run (alias @site/*) to draw ghosts and predict outcomes. This file
 * only gathers the facts those functions need (the tile, the ground overlay,
 * who is standing there), enforces cooldowns, and writes the outcome. Because
 * server and clients share that code, keep it dependency-free and
 * deterministic, and redeploy (npm run commons:deploy) after changing it.
 *
 * Callers: the browser names these functions in src/lib/convex.js (a test,
 * src/lib/convex.test.js, checks every public export here is listed there
 * and vice versa) and uses them from src/arcade/Commons.js; the native app
 * does the same through apps/commons/src/net/world.tsx. Tests call them
 * through `api.world.*`. tick.ts runs separately and shares the same tables.
 *
 * Conventions every mutation follows:
 *  - There are no accounts: `session` is a random id the browser keeps in
 *    localStorage and is the only credential. It is never sent to other
 *    clients (`state` sends owner names and a `mine` flag, not sessions).
 *  - A missing or dead player (hp <= 0) is refused, usually without throwing.
 *    Outcomes come back as short strings the HUD shows verbatim; failures are
 *    ordinary return values, not exceptions (`customize` is the exception).
 *  - Cooldowns are enforced here, not trusted from the client. Most actions
 *    share one clock, `players.lastBuild`; walking has its own, `lastMove`.
 *  - Mutations that change what the world should be doing call
 *    ensureTicking() so the tick loop is awake while anyone is acting.
 *  - Convex runs each mutation as one transaction, so check-then-write
 *    sequences below cannot interleave with another player's; two players
 *    racing for the same tile conflict and one retries.
 */

/* Minimum time between walking steps (see nextStepDue for the pacing). */
const MOVE_COOLDOWN_MS = 120;
/* How early a step may come. Steps sent at a steady pace can bunch up on
   the way here; this lets one arrive a step early instead of being dropped,
   while the average stays at one per MOVE_COOLDOWN_MS. */
const MOVE_SLACK_MS = 120;
/* Gathering, crafting and fuelling a fire. Building and taking down have
   their own, shorter beat (BUILD_COOLDOWN_MS in src/lib/building.js). */
const ACTION_COOLDOWN_MS = 600;
/* A player not heard from for this long is "gone": hidden from `state`,
   not counted online, not blocking tiles, not simulated by the tick. The
   client heartbeats every 15 seconds, so this tolerates two missed beats.
   tick.ts keeps its own copy of the same number; keep them equal. */
const IDLE_MS = 45_000;
/* Chat rows kept (the tick trims to the same number) and shown. */
const CHAT_LIMIT = 50;
const MAX_NAME = 18;
/* Longest chat line, and the same cap game.ts applies to its own posts. */
const MAX_CHAT = 160;
/* How long a speech bubble stays over a head. */
const BUBBLE_MS = 7000;
/* Breathing room after arriving or reviving: tick.ts holds off creature
   attacks until `graceUntil`. */
const GRACE_MS = 5000;

/*
 * Pacing for steps. `lastMove` holds when the next step is due (older rows
 * hold the time of the last step, which reads the same way). A step is let
 * through up to MOVE_SLACK_MS early, and a diagonal, which covers more
 * ground, costs more. Returns when the step after this one is due, or null
 * if this one comes too soon.
 */
function nextStepDue(
  lastMove: number,
  now: number,
  diagonal = false,
): number | null {
  if (now < lastMove - MOVE_SLACK_MS) return null;
  const cost = diagonal ? MOVE_COOLDOWN_MS * Math.SQRT2 : MOVE_COOLDOWN_MS;
  return Math.max(lastMove, now) + cost;
}

/* The singleton `world` row (tick state and weather), created on first use.
   Mutation-only because it may insert; `state` reads the row directly. */
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

/*
 * Start the tick loop if it is parked, or if it has gone quiet: a tick that
 * fails never schedules the next one, and would otherwise leave `ticking`
 * set for good. Restarting moves `loop` on, so if the old loop was only
 * running late it stands down rather than running alongside the new one.
 * Cheap in the common case: one indexed read of the singleton and no write
 * while the loop is healthy, so every mutation can call it freely. Callers
 * are the mutations that matter to the simulation (join, heartbeat, move,
 * harvest, build, terraform, respawn); heartbeat is what revives a loop for
 * a player who is only standing still.
 */
async function ensureTicking(ctx: MutationCtx) {
  const world = await getWorld(ctx);
  const now = Date.now();
  if (world.ticking && now - world.lastTick < TICK_STALL_MS) return;
  const loop = (world.loop ?? 0) + 1;
  await ctx.db.patch("world", world._id, {
    ticking: true,
    lastTick: now,
    loop,
  });
  await ctx.scheduler.runAfter(0, internal.tick.run, { loop });
}

/* The player owned by a session id, via by_session. `.unique()` throws if
   two rows ever shared a session, which join's check-then-insert prevents. */
async function getPlayer(ctx: MutationCtx | QueryCtx, session: string) {
  return await ctx.db
    .query("players")
    .withIndex("by_session", (q) => q.eq("session", session))
    .unique();
}

/* The one `cells` row on a tile (a built block, or a stump/rubble left by
   harvesting), via by_pos. At most one exists per tile: build deletes the
   old row before inserting, and harvest refuses a tile that has a row. */
async function cellAt(ctx: MutationCtx | QueryCtx, x: number, y: number) {
  return await ctx.db
    .query("cells")
    .withIndex("by_pos", (q) => q.eq("x", x).eq("y", y))
    .unique();
}

/* The shovel overlay row for a tile (see `ground` in schema.ts), or null
   if nobody has worked it. `edit` on it is terrace steps from generated. */
async function groundAt(ctx: MutationCtx | QueryCtx, x: number, y: number) {
  return await ctx.db
    .query("ground")
    .withIndex("by_x_and_y", (q) => q.eq("x", x).eq("y", y))
    .unique();
}

/*
 * Somebody alive and still around standing on the tile, other than `except`.
 * Characters stay where their owners left them, so only those seen recently
 * are read; however many have been left on a tile, they cost nothing here.
 * Uses by_x_and_y_and_lastSeen, so the read is the (usually zero or one)
 * rows on this one tile that are not yet idle, not a scan of all players.
 * That narrow read is also what keeps a step from contending with every
 * other player's step. "Alive" is checked on the row, not in the index.
 */
async function standingAt(
  ctx: MutationCtx,
  x: number,
  y: number,
  now: number,
  except?: Id<"players">,
): Promise<boolean> {
  const present = ctx.db
    .query("players")
    .withIndex("by_x_and_y_and_lastSeen", (q) =>
      q.eq("x", x).eq("y", y).gt("lastSeen", now - IDLE_MS),
    );
  for await (const other of present)
    if (other._id !== except && other.hp > 0) return true;
  return false;
}

/* Somebody alive, or a creature, standing on the tile (monsters via by_pos,
   first match only). Used by build to refuse placing under a body. */
async function occupiedAt(
  ctx: MutationCtx,
  x: number,
  y: number,
  now: number,
): Promise<boolean> {
  const monster = await ctx.db
    .query("monsters")
    .withIndex("by_pos", (q) => q.eq("x", x).eq("y", y))
    .first();
  if (monster) return true;
  return await standingAt(ctx, x, y, now);
}

/*
 * Append a line to the shared chat log and trim the log back to CHAT_LIMIT.
 * `kind` ("chat", "emote", "system", "kill", "level") lets the client style
 * it. Text is capped at MAX_CHAT here, so callers need not. Trimming reads
 * CHAT_LIMIT + 25 rows (newest first) and deletes whatever is past the
 * limit, so a burst can leave up to 25 extra rows for a moment; the tick
 * also trims. The log is one hot table every poster writes to, which is why
 * `say` is rate limited.
 */
async function post(
  ctx: MutationCtx,
  name: string,
  text: string,
  kind: string,
) {
  await ctx.db.insert("chat", { name, text: text.slice(0, MAX_CHAT), kind });
  const all = await ctx.db
    .query("chat")
    .order("desc")
    .take(CHAT_LIMIT + 25);
  for (const row of all.slice(CHAT_LIMIT)) {
    await ctx.db.delete("chat", row._id);
  }
}

/*
 * Can nobody walk onto this tile? Precedence: a `cells` row wins (a built
 * block, or a stump/rubble, which are not solid); otherwise the ground
 * overlay (src/lib/ground.js); otherwise the generated terrain. This mirrors
 * what tick.ts does for creatures (solidCell) and what the browser predicts
 * from the snapshot, so change them together. It does not look at people or
 * monsters; callers check those separately.
 * Solid means generated terrain, or a block someone put there.
 */
async function blocked(
  ctx: MutationCtx,
  x: number,
  y: number,
): Promise<boolean> {
  const cell = await cellAt(ctx, x, y);
  if (cell) {
    /* A door is only in the way while it is shut. */
    if (cell.kind === "door") return cell.open === false;
    return BLOCKS[cell.kind] ? BLOCKS[cell.kind].solid : false;
  }
  /* Dug or piled ground is walkable unless it has flooded. */
  const ground = await groundAt(ctx, x, y);
  return ground ? solidAt(x, y, ground.edit) : isSolid(x, y);
}

/*
 * Enter the world, or come back to it. Called by the client on load and again
 * from "try again" after a failed connection.
 * Args: `session` (the browser's id), `name` (trimmed, cut to MAX_NAME,
 * "wanderer" if empty).
 * Checks: nothing can fail; it is idempotent. A returning session keeps its
 * body, position and pack, but takes the name sent now, and its survival
 * clock restarts (`lastSurvival`) so time away is never charged as hunger.
 * A new session gets the starting kit below and an arrival spot near the
 * crossroads that no active player is on.
 * Reads: `world` singleton (by_key), the player (by_session), and for a
 * newcomer up to 200 active players (by_lastSeen, capped so a crowd cannot
 * blow the read budget; past 200 an arrival may stack on someone).
 * Writes: the player row (patch or insert), one "system" chat line for a
 * newcomer, and possibly the world row via ensureTicking.
 * Returns null. No cooldown.
 */
export const join = mutation({
  args: { session: v.string(), name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await getWorld(ctx);
    const now = Date.now();
    const name = args.name.trim().slice(0, MAX_NAME) || "wanderer";

    const existing = await getPlayer(ctx, args.session);
    if (existing) {
      await ctx.db.patch("players", existing._id, {
        name,
        lastSeen: now,
        lastSurvival: now,
      });
    } else {
      const others = await ctx.db
        .query("players")
        .withIndex("by_lastSeen", (q) => q.gt("lastSeen", Date.now() - IDLE_MS))
        .take(200);
      const spot = arrivalSpot(others);
      /* The starting kit: 36 hp (each level adds 8 and heals), a potion,
         a little wood and stone, and three berries so hunger is never the
         first problem. `lastMove`/`lastBuild` of 0 mean "no cooldown yet". */
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
        hunger: 100,
        warmth: 100,
        lastSurvival: now,
        inventory: { berries: 3 },
        tools: {},
        gathered: 0,
        milestones: [],
      });
      await post(ctx, name, `${name} walks onto the commons.`, "system");
    }

    await ensureTicking(ctx);
    return null;
  },
});

/*
 * "I am still here." Sent by the client every 15 seconds (see the interval
 * in src/arcade/Commons.js and apps/commons/src/net/world.tsx) so a player
 * who is only standing or reading stays visible (lastSeen within IDLE_MS)
 * and the tick loop stays alive for them.
 * Args: `session`. Checks: none; an unknown session is ignored.
 * Reads the player (by_session) and the world singleton; writes lastSeen,
 * and the world row only if the loop needs restarting. Returns null.
 * The 15-second beat is also the only rate limit: nothing here is costly.
 */
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

/*
 * One step, or one attack if a creature is on the target tile. The client
 * predicts the step locally and sends this; the returned position is the
 * truth it reconciles to.
 * Args: `dx`, `dy` are reduced to their sign, so only the eight neighbours
 * are reachable whatever the client sends (NaN/Infinity are refused).
 * Checks, in order: alive; pacing via nextStepDue (lastMove, with slack, a
 * diagonal costing sqrt(2) steps); a diagonal may not cut a corner (both
 * orthogonal tiles must be open); a creature on the target is fought instead
 * of walked into; the target must not be blocked() or hold a live player.
 * Every refusal returns the unchanged position and writes nothing, so a
 * client that outruns the limit just snaps back.
 * Combat: a swing (swingFor, from src/lib/game/creatures.js) takes off hp; at
 * zero the creature is deleted and the player gets xp, gold, loot, possibly
 * a potion, level-ups (+8 max hp and a full heal each) and chat lines. An
 * attack uses the same pacing slot as a step, so combat is as fast as
 * walking and no faster. Damage and loot use Math.random: the server is the
 * only roller, nothing here has to be reproducible on the client.
 * Reads: the player (by_session), `monsters` by_pos on the exact target,
 * the target tile (cell, ground) via blocked(), and standingAt() on that one
 * tile only, so walking never reads, and never contends with, everyone
 * else's every step. Writes the player row (position, lastMove, lastSeen,
 * `far`), plus the monster row when fighting. Walking calls ensureTicking.
 * Returns null if there is no live player, else the position afterwards.
 */
export const move = mutation({
  args: { session: v.string(), dx: v.number(), dy: v.number() },
  /* Where you stand afterwards, so the client can square its guess with
     the truth step by step instead of waiting for the next snapshot. */
  returns: v.union(v.null(), v.object({ x: v.number(), y: v.number() })),
  handler: async (ctx, args) => {
    const player = await getPlayer(ctx, args.session);
    if (!player || player.hp <= 0) return null;
    const here = { x: player.x, y: player.y };

    if (!Number.isFinite(args.dx) || !Number.isFinite(args.dy)) return here;
    const dx = Math.sign(args.dx);
    const dy = Math.sign(args.dy);
    if (dx === 0 && dy === 0) return here;
    const diagonal = dx !== 0 && dy !== 0;

    const now = Date.now();
    const due = nextStepDue(player.lastMove, now, diagonal);
    if (due === null) return here;

    const nx = player.x + dx;
    const ny = player.y + dy;

    /* A diagonal never cuts a corner: both tiles beside it must be open. */
    if (
      diagonal &&
      ((await blocked(ctx, player.x + dx, player.y)) ||
        (await blocked(ctx, player.x, player.y + dy)))
    )
      return here;

    /* Walking into a monster is an attack. */
    const target = await ctx.db
      .query("monsters")
      .withIndex("by_pos", (q) => q.eq("x", nx).eq("y", ny))
      .first();

    if (target) {
      const spec = MONSTERS[target.kind] || MONSTERS.rat;
      const left = target.hp - swingFor(player, Math.random);

      if (left > 0) {
        await ctx.db.patch("monsters", target._id, { hp: left });
        await ctx.db.patch("players", player._id, {
          lastMove: due,
          lastSeen: now,
        });
        return here;
      }

      await ctx.db.delete("monsters", target._id);
      const loot = lootFor(target.kind, Math.random);
      const drop = loot.gold;

      /* The same level-up rule as experience() in ./survival (kept inline
         here, but the two must stay in step): xp carries over, every level
         adds 8 max hp and heals to full. */
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
        ...inventoryPatch(player, loot.items),
        kills: player.kills + 1,
        stats: bumpStats(player.stats, {
          "kill:any": 1,
          [`kill:${target.kind}`]: 1,
        }),
        potions: loot.potion ? player.potions + 1 : player.potions,
        lastMove: due,
        lastSeen: now,
      });

      await post(
        ctx,
        player.name,
        `${player.name} killed a ${spec.name}. +${spec.xp} xp, +${drop} gold.`,
        "kill",
      );
      if (levelled) {
        await post(
          ctx,
          player.name,
          `${player.name} reached level ${level}.`,
          "level",
        );
      }
      return here;
    }

    if (await blocked(ctx, nx, ny)) return here;

    /* Only the tile you are stepping onto, so walking never reads (and
       never contends with) everyone else's every step. */
    if (await standingAt(ctx, nx, ny, now, player._id)) return here;

    /* Distance from the crossroads at (0,0), for the "furthest reached"
       record shown on the leaderboard. */
    const distance = Math.round(Math.hypot(nx, ny));
    await ctx.db.patch("players", player._id, {
      x: nx,
      y: ny,
      lastMove: due,
      lastSeen: now,
      far: Math.max(player.far || 0, distance),
    });
    await ensureTicking(ctx);
    return { x: nx, y: ny };
  },
});

/*
 * Gather whatever grows on a tile in reach: trees, rocks (stone, ore, coal,
 * crystal), berries, fibre, or a fish from the water. What a tile yields is
 * `resourceAt` in src/lib/survival.js, a pure function of coordinates, so the
 * client knows what it is aiming at.
 * Args: the target tile `x`, `y` (integers only; withinReach rejects others).
 * Checks, in order: alive; shared action cooldown (ACTION_COOLDOWN_MS on
 * `lastBuild`, "wait"); within REACH; the tile has no cells row (built on,
 * or a stump/rubble still regrowing) and no ground overlay row (worked
 * ground is bare earth); it has a resource; and the tool tier it needs
 * (ore/coal want pick >= 1, crystal pick >= 2, fish wants a rod and a 2.5s
 * gap since the last action, "wait for a bite").
 * Yield: wood is 3 x (1 + axe tier), stone 3 x (1 + pick tier), ore/coal/
 * crystal max(1, pick), fish 1, anything else 3. Awards 3 xp, bumps the
 * gather counters and records the resource as a milestone (see `stats`
 * and `milestones` in schema.ts).
 * Everything except fish leaves a `cells` row to mark the tile spent: a
 * "stump" for a tree (regrows after REGROW_TREE_MS) or "rubble" for any
 * other resource (REGROW_ROCK_MS); tick.ts deletes the row when `regrowAt`
 * passes, via the by_regrow index. Fish never run out, so no marker.
 * Reads: player, cells and ground on the one tile. Writes: that cells row
 * and the player. Returns a message string for the HUD ("+3 wood · +3 xp",
 * or the refusal reason).
 */
export const harvest = mutation({
  args: { session: v.string(), x: v.number(), y: v.number() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const player = await getPlayer(ctx, args.session);
    if (!player || player.hp <= 0) return "no";

    const now = Date.now();
    if (now - player.lastBuild < ACTION_COOLDOWN_MS) return "wait";
    if (!withinReach(player, args.x, args.y)) return "too far";

    const existing = await cellAt(ctx, args.x, args.y);
    if (existing) return "nothing to gather";
    /* Worked ground is bare earth: whatever grew there was dug out. */
    if (await groundAt(ctx, args.x, args.y)) return "nothing to gather";

    const resource = resourceAt(args.x, args.y);
    if (!resource) return "nothing to gather";
    const pick = player.tools?.pick || 0;
    if ((resource === "ore" || resource === "coal") && pick < 1)
      return "craft a stone pickaxe first";
    if (resource === "crystal" && pick < 2) return "an iron pickaxe is needed";
    if (resource === "fish" && !player.tools?.rod)
      return "craft a fishing rod first";
    if (resource === "fish" && now - player.lastBuild < 2500)
      return "wait for a bite";
    const isTree = resource === "wood";
    const gain =
      resource === "wood"
        ? 3 * (1 + (player.tools?.axe || 0))
        : resource === "stone"
          ? 3 * (1 + pick)
          : ["ore", "coal", "crystal"].includes(resource)
            ? Math.max(1, pick)
            : resource === "fish"
              ? 1
              : 3;
    if (resource !== "fish")
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
    await ctx.db.patch("players", player._id, {
      ...inventoryPatch(player, { [resource]: gain }),
      ...experience(player, 3),
      gathered: (player.gathered || 0) + 1,
      stats: bumpStats(player.stats, {
        "gather:any": 1,
        [`gather:${resource}`]: gain,
      }),
      milestones: [...new Set([...(player.milestones || []), resource])],
      lastBuild: now,
      lastSeen: now,
    });
    await ensureTicking(ctx);
    return `+${gain} ${resource === "ore" ? "iron ore" : resource} · +3 xp`;
  },
});

/*
 * Place a block (wall, door, campfire, chest, sign, bedroll...; the
 * BUILDABLE list, which is STRUCTURES in src/lib/survival.js).
 * Args: target `x`, `y`; `kind`; optional sign `text` (cut to 60 chars);
 * optional `facing` in quarter turns (only kept for pieces that care).
 * Checks: alive; known kind; BUILD_COOLDOWN_MS since `lastBuild` ("wait");
 * then everything else is planBuild() in src/lib/building.js: reach, not
 * on the crossroads, tree/rock cleared, height gap to the builder, nobody
 * standing there, and enough wood and stone. The same function drives the
 * client's placement ghost, so what the ghost allows, this allows.
 * Reads: the player, the target's cell and ground rows, the builder's own
 * ground row (for the height gap), and occupiedAt() on the target.
 * Writes: replaces a stump/rubble row if there was one (planBuild refuses
 * anything else), inserts the new cells row owned by this session (`regrowAt`
 * 0 marks it as permanent player work, as opposed to a regrowing stump), and
 * charges the player. Starting state per kind: doors begin open, campfires
 * burn for 3 minutes (fuelUntil; `use` adds more), chests start empty.
 * Returns "built a <label>", or the planBuild error text.
 */
export const build = mutation({
  args: {
    session: v.string(),
    x: v.number(),
    y: v.number(),
    kind: v.string(),
    text: v.optional(v.string()),
    facing: v.optional(v.number()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const player = await getPlayer(ctx, args.session);
    if (!player || player.hp <= 0) return "no";
    if (!BUILDABLE.includes(args.kind)) return "cannot build that";

    const now = Date.now();
    if (now - player.lastBuild < BUILD_COOLDOWN_MS) return "wait";

    /*
     * The rules live in src/lib/building.js, so the ghost in the browser and
     * the offline stand-in agree with this exactly. A stump or rubble on the
     * tile means it was cleared; tileAt() alone still reads it as a tree.
     */
    const existing = await cellAt(ctx, args.x, args.y);
    const ground = await groundAt(ctx, args.x, args.y);
    const underfoot = await groundAt(ctx, player.x, player.y);
    const plan = planBuild({
      kind: args.kind,
      x: args.x,
      y: args.y,
      from: player,
      fromEdit: underfoot?.edit,
      edit: ground?.edit,
      cell: existing,
      occupied: await occupiedAt(ctx, args.x, args.y, now),
      bag: inventoryOf(player),
      facing: args.facing,
    });
    if (plan.error !== undefined) return plan.error;

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
      open: args.kind === "door" ? true : undefined,
      fuelUntil: args.kind === "campfire" ? now + 180_000 : undefined,
      stock: args.kind === "chest" ? {} : undefined,
      facing: plan.facing,
    });

    await ctx.db.patch("players", player._id, {
      wood: player.wood - plan.cost.wood,
      stone: player.stone - plan.cost.stone,
      placed: player.placed + 1,
      stats: bumpStats(player.stats, {
        "build:any": 1,
        [`build:${args.kind}`]: 1,
      }),
      milestones: [...new Set([...(player.milestones || []), args.kind])],
      lastBuild: now,
      lastSeen: now,
    });

    await ensureTicking(ctx);
    return `built a ${BLOCKS[args.kind].label.toLowerCase()}`;
  },
});

/*
 * One swing of a shovel: dig the tile down a step, pile it up a step, or
 * bring it a step toward the height you are standing at. The rules live in
 * src/lib/ground.js so the offline stand-in plays by the same ones; this
 * only gathers what they need and writes down the outcome.
 *
 * Args: target `x`, `y`; `mode` "dig" | "raise" | "level".
 * Checks, here: alive; the shovel tier's own cooldown (SHOVEL_COOLDOWN_MS,
 * indexed by tier and read against `lastBuild`; a missing shovel has no
 * cooldown and is turned away by planTerraform instead); within REACH; no
 * built block on the tile (a stump/rubble row, which has regrowAt > 0, is
 * fine and is dug out); no creature on it; nobody standing on it. In
 * planTerraform: the roads and the ring around the crossroads are
 * protected, the depth limits (MAX_DIG, MAX_RAISE), no digging a tile that
 * is already under water, and having dirt or sand to fill with.
 * Reads: player, the target's cell and ground rows, the player's own ground
 * row (for "level"), up to 100 monsters (there are never more than
 * MAX_MONSTERS = 90 in tick.ts, so this sees them all), and standingAt().
 * Writes: the ground row (patched, or inserted with its chunk key), deletes
 * a stump/rubble row, and the player's pack, xp, milestone and stats. Only
 * earth taken from virgin ground earns xp; planTerraform decides that.
 * Returns the outcome message or the refusal reason.
 */
export const terraform = mutation({
  args: {
    session: v.string(),
    x: v.number(),
    y: v.number(),
    mode: v.union(v.literal("dig"), v.literal("raise"), v.literal("level")),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const player = await getPlayer(ctx, args.session);
    if (!player || player.hp <= 0) return "no";

    const now = Date.now();
    /* Clamp to the known tiers so a tool value beyond the table cannot index
       past it; tier 0 is Infinity there, hence the `shovel > 0` guard. */
    const shovel = Math.min(player.tools?.shovel || 0, SHOVEL_COOLDOWN_MS.length - 1);
    if (shovel > 0 && now - player.lastBuild < SHOVEL_COOLDOWN_MS[shovel])
      return "wait";
    if (!withinReach(player, args.x, args.y)) return "too far";

    const cell = await cellAt(ctx, args.x, args.y);
    if (cell && cell.regrowAt === 0) return "something is built there";
    const monsters = await ctx.db.query("monsters").take(100);
    if (monsters.some((m) => m.x === args.x && m.y === args.y))
      return "occupied";
    if (await standingAt(ctx, args.x, args.y, now))
      return "someone is standing there";

    const ground = await groundAt(ctx, args.x, args.y);
    const underfoot = await groundAt(ctx, player.x, player.y);
    const plan = planTerraform({
      mode: args.mode,
      x: args.x,
      y: args.y,
      from: player,
      fromEdit: underfoot?.edit,
      edit: ground?.edit,
      fill: ground?.fill,
      cleared: Boolean(cell),
      shovel,
      bag: inventoryOf(player),
    });
    if (plan.error !== undefined) return plan.error;

    if (ground)
      await ctx.db.patch("ground", ground._id, {
        edit: plan.edit,
        fill: plan.fill,
        by: player.name,
        at: now,
      });
    else
      await ctx.db.insert("ground", {
        x: args.x,
        y: args.y,
        chunk: chunkKey(args.x, args.y),
        edit: plan.edit,
        fill: plan.fill,
        by: player.name,
        at: now,
      });
    /* A stump or rubble is dug out with the ground, so nothing grows back. */
    if (cell) await ctx.db.delete("cells", cell._id);

    await ctx.db.patch("players", player._id, {
      ...inventoryPatch(player, { [plan.item]: plan.change }),
      ...experience(player, plan.xp),
      milestones: [...new Set([...(player.milestones || []), "dig"])],
      stats: bumpStats(player.stats, { dig: 1 }),
      lastBuild: now,
      lastSeen: now,
    });
    await ensureTicking(ctx);
    return plan.message;
  },
});

/*
 * Take down a block you built. Decided by planDemolish() in
 * src/lib/building.js: only the owner (matched on session), never a chest
 * that still holds stock, and the refund is the full cost within UNDO_MS of
 * placing it (judged from the row's _creationTime) and half after.
 * Args: target `x`, `y`. Checks: alive; BUILD_COOLDOWN_MS on `lastBuild`
 * ("wait"); within REACH ("out of reach"); the row is a player's block
 * (regrowAt === 0), not a stump or rubble, which cannot be demolished.
 * Reads: player, the one cell. Writes: deletes the cell, refunds wood and
 * stone, lowers the `placed` count (never below 0). Does not wake the tick
 * and does not touch stats or milestones. Returns the message or the error.
 */
export const demolish = mutation({
  args: { session: v.string(), x: v.number(), y: v.number() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const player = await getPlayer(ctx, args.session);
    if (!player || player.hp <= 0) return "no";

    const now = Date.now();
    if (now - player.lastBuild < BUILD_COOLDOWN_MS) return "wait";
    if (!withinReach(player, args.x, args.y)) return "out of reach";

    const cell = await cellAt(ctx, args.x, args.y);
    const plan = planDemolish({
      cell: cell && cell.regrowAt === 0 ? cell : null,
      owner: player.session,
      placedAt: cell?._creationTime,
      now,
    });
    if (plan.error !== undefined) return plan.error;
    await ctx.db.delete("cells", cell!._id);
    await ctx.db.patch("players", player._id, {
      wood: player.wood + plan.refund.wood,
      stone: player.stone + plan.refund.stone,
      placed: Math.max(0, player.placed - 1),
      lastBuild: now,
      lastSeen: now,
    });
    return plan.message;
  },
});

/*
 * The left-hand verb. Doors swing either way for anybody — they are for
 * getting through, not for owning — while taking one down still needs to be
 * yours. Signs read out whatever was written on them.
 *
 * Args: target `x`, `y`. Checks: alive; within REACH; a cells row exists
 * (otherwise returns "" and does nothing). By kind:
 *  - door: toggles `open`, but will not shut on a live player or a creature
 *    standing in it. No cooldown; only lastSeen is written.
 *  - campfire: costs 1 wood and adds 60s to `fuelUntil` (from now if it had
 *    burned out); ACTION_COOLDOWN_MS applies; refused once more than 9
 *    minutes are banked, so a fire holds at most about 10.
 *  - bedroll: sets the player's `home` if it is theirs; respawn wakes them
 *    beside it.
 *  - workbench, furnace, chest: only a hint to open the Craft or Pack panel;
 *    the work happens in `craft` and `transfer`.
 *  - sign: returns its text and author.
 * Reads: player, the one cell, and for a door standingAt() plus up to 100
 * monsters (a scan rather than an index, but the tick caps monsters at 90).
 * Returns the message to show, or "".
 */
export const use = mutation({
  args: { session: v.string(), x: v.number(), y: v.number() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const player = await getPlayer(ctx, args.session);
    if (!player || player.hp <= 0) return "no";
    if (!withinReach(player, args.x, args.y)) return "too far";

    const cell = await cellAt(ctx, args.x, args.y);
    if (!cell) return "";

    if (cell.kind === "door") {
      const shut = cell.open === false;
      /* Do not shut a door on somebody standing in the doorway. */
      if (!shut) {
        if (await standingAt(ctx, args.x, args.y, Date.now()))
          return "someone is in the doorway";
        const monsters = await ctx.db.query("monsters").take(100);
        if (monsters.some((m) => m.x === args.x && m.y === args.y)) {
          return "something is in the doorway";
        }
      }
      await ctx.db.patch("cells", cell._id, { open: shut });
      await ctx.db.patch("players", player._id, { lastSeen: Date.now() });
      return shut ? "opened the door" : "shut the door";
    }

    const now = Date.now();
    if (cell.kind === "campfire") {
      if (now - player.lastBuild < ACTION_COOLDOWN_MS) return "wait";
      if (player.wood < 1) return "need 1 wood to fuel the fire";
      if ((cell.fuelUntil || 0) > now + 540_000)
        return "the fire is fully fueled";
      await ctx.db.patch("cells", cell._id, {
        fuelUntil: Math.max(now, cell.fuelUntil || 0) + 60_000,
      });
      await ctx.db.patch("players", player._id, {
        wood: player.wood - 1,
        lastBuild: now,
      });
      return "added 1 wood · +60 seconds of warmth";
    }
    if (cell.kind === "bedroll") {
      if (cell.owner !== player.session)
        return "use your own bedroll to set camp";
      await ctx.db.patch("players", player._id, {
        home: { x: cell.x, y: cell.y },
        lastSeen: now,
      });
      return "camp set · you will wake near this bedroll";
    }
    if (cell.kind === "workbench" || cell.kind === "furnace")
      return `open Craft to use this ${cell.kind}`;
    if (cell.kind === "chest")
      return "open Pack to share supplies through this chest";
    if (cell.kind === "sign") {
      return cell.text ? `"${cell.text}" — ${cell.ownerName}` : "a blank sign";
    }

    return "";
  },
});

/*
 * Chat, and the slash commands (/me, /who, /where, /home, /help).
 * Args: `text`, trimmed and cut to MAX_CHAT. Needs an existing player
 * (anyone else gets ""); being dead does not stop you talking. Rate limit:
 * one line per second per player, judged on `saidAt`, which is stamped as
 * soon as the text is non-empty, so commands and unknown commands count too. Returns "give chat a moment"
 * when throttled, "unknown command" for a bad slash command, otherwise "".
 * Writes: a chat row via post() (which also trims the log), and on plain
 * chat the player's speech bubble (`saidText`, shown for BUBBLE_MS).
 * /who reads up to 200 active players by_lastSeen and posts the list as a
 * public "world" line, so it is the costliest path here; the 1s limit is
 * what keeps it affordable. The commands post as "world" lines for everyone
 * rather than replying privately, as there is no per-player inbox.
 */
export const say = mutation({
  args: { session: v.string(), text: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const player = await getPlayer(ctx, args.session);
    if (player && Date.now() - player.saidAt < 1000)
      return "give chat a moment";
    const raw = args.text.trim().slice(0, MAX_CHAT);
    if (!player || !raw) return "";
    const now = Date.now();
    await ctx.db.patch("players", player._id, { saidAt: now, lastSeen: now });

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
        const here = await ctx.db
          .query("players")
          .withIndex("by_lastSeen", (q) => q.gt("lastSeen", cutoff))
          .take(200);
        await post(
          ctx,
          "world",
          `On the commons: ${here
            .map((p) => `${p.name} (lv${p.level})`)
            .join(", ")}`,
          "system",
        );
        return "";
      }
      if (command === "where") {
        await post(
          ctx,
          "world",
          `${player.name} is at ${player.x},${player.y} — ${regionName(
            player.x,
            player.y,
          )}.`,
          "system",
        );
        return "";
      }
      if (command === "home") {
        await post(
          ctx,
          "world",
          `The crossroads is at 0,0. ${player.name} is ${Math.round(
            Math.hypot(player.x, player.y),
          )} paces out — follow either road back.`,
          "system",
        );
        return "";
      }
      if (command === "help") {
        await post(
          ctx,
          "world",
          "/me · /who · /where · /home · /help — wasd moves, click gathers, b builds, x removes, g digs",
          "system",
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

/*
 * Drink a potion: heal half of max hp (rounded down, capped at max).
 * Args: `session`. Does nothing, silently, if dead, out of potions or
 * already at full hp (so a potion is never wasted). No cooldown: potions
 * are the limit. Reads/writes the player only. Returns null.
 */
export const drink = mutation({
  args: { session: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const player = await getPlayer(ctx, args.session);
    if (
      !player ||
      player.hp <= 0 ||
      player.potions <= 0 ||
      player.hp >= player.maxHp
    )
      return null;
    const healed = Math.min(
      player.maxHp,
      player.hp + Math.floor(player.maxHp * 0.5),
    );
    await ctx.db.patch("players", player._id, {
      hp: healed,
      potions: player.potions - 1,
      lastSeen: Date.now(),
    });
    return null;
  },
});

/*
 * Get up after dying. Only acts when hp <= 0, so it cannot be used to
 * teleport while alive. Args: `session`. No cooldown.
 * Where: your own bedroll or a free tile beside it if `home` still points at
 * one you own (a bedroll someone took down, or was never yours, is ignored);
 * otherwise a free tile near the crossroads from arrivalSpot(). "Free"
 * is judged against up to 200 active players (by_lastSeen) and blocked().
 * Penalty: 10% of gold (rounded down); tools, pack and levels are kept.
 * Restores full hp, hunger 70 and warmth 80 (not full), restarts the
 * survival clock, clears `lastHurt` and grants GRACE_MS of protection from
 * creatures. If none of the five tiles at the bedroll is free it falls back
 * to the crossroads spot.
 * Returns null.
 */
export const respawn = mutation({
  args: { session: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const player = await getPlayer(ctx, args.session);
    if (!player || player.hp > 0) return null;
    const now = Date.now();
    const others = (
      await ctx.db
        .query("players")
        .withIndex("by_lastSeen", (q) => q.gt("lastSeen", now - IDLE_MS))
        .take(200)
    ).filter((o) => o._id !== player._id);
    let spot = arrivalSpot(others);
    if (player.home) {
      const bed = await cellAt(ctx, player.home.x, player.home.y);
      if (bed?.kind === "bedroll" && bed.owner === player.session) {
        const candidates = [
          { x: bed.x, y: bed.y },
          { x: bed.x + 1, y: bed.y },
          { x: bed.x - 1, y: bed.y },
          { x: bed.x, y: bed.y + 1 },
          { x: bed.x, y: bed.y - 1 },
        ];
        for (const at of candidates) {
          if (
            !(await blocked(ctx, at.x, at.y)) &&
            !others.some((p) => p.hp > 0 && p.x === at.x && p.y === at.y)
          ) {
            spot = at;
            break;
          }
        }
      }
    }
    await ctx.db.patch("players", player._id, {
      hp: player.maxHp,
      hunger: 70,
      warmth: 80,
      lastSurvival: now,
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

/*
 * Everything one player can see, and nothing else: the single reactive
 * query the client renders from. Args: `session` (an unknown session gets a
 * spectator view centred on the crossroads with `me: null`). It is read-only
 * and has no checks beyond the session id. It never reveals other players'
 * sessions (cells carry `mine` and an owner name) and shows a chest's
 * `stock` only within 4 tiles, to keep the payload small.
 *
 * The view is a VIEW_W x VIEW_H box centred on the player. Read budget, per
 * piece (all of it is bounded by the box, not by how much has been built):
 *  - players: up to 200 rows of by_lastSeen (everyone not idle), filtered
 *    to the box in memory. This index range is the broadest dependency, so
 *    any active player's lastSeen write re-runs every client's `state`;
 *    that is the price of a live `online` count and moving avatars.
 *  - cells: by_chunk for each 16x16 chunk the box touches, take(256)
 *    (one row per tile at most), filtered to the box.
 *  - ground: by_chunk over the box grown by half a chunk each side, whole
 *    chunks, take(CHUNK * CHUNK) each. The extra margin means the browser
 *    already has the next chunk's pits when it walks to the edge; the
 *    returned `groundChunks` lists what was sent so the client can replace
 *    exactly those chunks (see GroundMap in src/lib/ground.js).
 *  - monsters: by_pos restricted to the x-range, take(100), then filtered on
 *    y. An x-only range is all by_pos can express; it still excludes
 *    creatures elsewhere, so their movement does not invalidate this query.
 *  - chat: the newest CHAT_LIMIT rows, newest first.
 *  - stationsNear(): up to 9 narrow by_pos column reads (survival.ts).
 * Date.now() in a query is fixed when it runs, so a player who goes idle only
 * leaves `players`/`online` when something it read next changes.
 * Returns the snapshot described by the validator below; `xpNeeded` and
 * `phase` are derived so the client need not know the formulas.
 */
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
        appearance: appearanceValidator,
        inventory: v.record(v.string(), v.number()),
        tools: v.record(v.string(), v.number()),
        hunger: v.number(),
        warmth: v.number(),
        gathered: v.number(),
        milestones: v.array(v.string()),
        home: v.union(v.object({ x: v.number(), y: v.number() }), v.null()),
        stations: v.array(v.string()),
        stats: v.record(v.string(), v.number()),
        quest: v.number(),
      }),
      v.null(),
    ),
    players: v.array(
      v.object({
        name: v.string(),
        x: v.number(),
        y: v.number(),
        level: v.number(),
        hp: v.number(),
        id: v.string(),
        self: v.boolean(),
        appearance: appearanceValidator,
        tools: v.record(v.string(), v.number()),
        saidText: v.string(),
      }),
    ),
    monsters: v.array(
      v.object({
        /* So the client can follow each animal rather than guess. */
        id: v.string(),
        kind: v.string(),
        x: v.number(),
        y: v.number(),
        hp: v.number(),
        maxHp: v.number(),
      }),
    ),
    cells: v.array(
      v.object({
        x: v.number(),
        y: v.number(),
        kind: v.string(),
        ownerName: v.string(),
        text: v.string(),
        open: v.boolean(),
        mine: v.boolean(),
        fuelUntil: v.number(),
        stock: v.record(v.string(), v.number()),
        facing: v.optional(v.number()),
      }),
    ),
    /* Worked ground in every chunk the view touches, whole chunks at a
       time, listed in groundChunks so the browser knows what it now has. */
    ground: v.array(v.object({ x: v.number(), y: v.number(), edit: v.number() })),
    groundChunks: v.array(v.string()),
    chat: v.array(
      v.object({ name: v.string(), text: v.string(), kind: v.string() }),
    ),
  }),
  handler: async (ctx, args) => {
    const world = await ctx.db
      .query("world")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();

    const now = Date.now();
    const cutoff = now - IDLE_MS;
    const active = await ctx.db
      .query("players")
      .withIndex("by_lastSeen", (q) => q.gt("lastSeen", cutoff))
      .take(200);
    const me = await getPlayer(ctx, args.session);

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
        .take(256);
      for (const cell of chunk) {
        if (visible(cell.x, cell.y)) cells.push(cell);
      }
    }

    const groundChunks = chunksInBox(
      minX - CHUNK / 2,
      minY - CHUNK / 2,
      maxX + CHUNK / 2,
      maxY + CHUNK / 2,
    );
    const ground = [];
    for (const key of groundChunks) {
      const rows = await ctx.db
        .query("ground")
        .withIndex("by_chunk", (q) => q.eq("chunk", key))
        .take(CHUNK * CHUNK);
      for (const g of rows) ground.push({ x: g.x, y: g.y, edit: g.edit });
    }

    /* Only the band of the map in view, so creatures roaming elsewhere
       don't wake this query on every step they take. */
    const monsters = (
      await ctx.db
        .query("monsters")
        .withIndex("by_pos", (q) => q.gte("x", minX).lte("x", maxX))
        .take(100)
    ).filter((m) => visible(m.x, m.y));
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
            appearance: appearanceOf(me),
            inventory: me.inventory || {},
            tools: me.tools || {},
            hunger: me.hunger ?? 100,
            warmth: me.warmth ?? 100,
            gathered: me.gathered || 0,
            milestones: me.milestones || [],
            home: me.home || null,
            stations: await stationsNear(ctx, me, now),
            stats: me.stats || {},
            quest: me.quest || 0,
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
          id: p._id,
          self: p._id === me?._id,
          appearance: appearanceOf(p),
          tools: p.tools || {},
          saidText: now - p.saidAt < BUBBLE_MS ? p.saidText : "",
        })),
      monsters: monsters.map((m) => ({
        id: m._id,
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
        open: c.open !== false,
        mine: c.owner === args.session,
        fuelUntil: c.fuelUntil || 0,
        stock:
          me && Math.hypot(c.x - me.x, c.y - me.y) <= 4 ? c.stock || {} : {},
        facing: c.facing,
      })),
      ground,
      groundChunks,
      chat: chat.map((c) => ({ name: c.name, text: c.text, kind: c.kind })),
    };
  },
});

/*
 * The top eight characters, for the board in the HUD. No args, no checks.
 * Reads the by_level index (level, then kills) from the top, take(8), so the
 * cost is eight rows however many players exist; it ranks everyone who has
 * ever joined, idle or not. The sort afterwards repeats the index's own
 * order (level, then kills, both descending). Returns name, level, kills, blocks placed
 * and furthest distance from the crossroads.
 */
export const leaderboard = query({
  args: {},
  returns: v.array(
    v.object({
      name: v.string(),
      level: v.number(),
      kills: v.number(),
      placed: v.number(),
      far: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const players = await ctx.db
      .query("players")
      .withIndex("by_level")
      .order("desc")
      .take(8);
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

/*
 * Craft an item or tool from RECIPES (src/lib/survival.js).
 * Args: `recipe`, a recipe id. Checks: alive ("wake up first"); known id;
 * ACTION_COOLDOWN_MS on `lastBuild`; then recipeBlocker(), the same function
 * the Craft panel uses to grey a button out, covering: tool not already at
 * that tier, a required station (workbench, furnace, or a lit campfire)
 * within 4 tiles via stationsNear(), and enough supplies.
 * Effects: costs come out of the pack and outputs go in (one patch through
 * inventoryPatch); a tool recipe equips that tier at once, overwriting the
 * old one; +5 xp (can level up); the recipe id is recorded as a milestone;
 * `cook` counts meals made for the quest chain.
 * Reads: player and a few by_pos column reads for stations. Writes: player.
 * Returns "crafted <name> ... +5 xp" or the blocker text.
 */
export const craft = mutation({
  args: { session: v.string(), recipe: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const player = await getPlayer(ctx, args.session);
    if (!player || player.hp <= 0) return "wake up first";
    const recipe = RECIPES.find((r) => r.id === args.recipe);
    if (!recipe) return "unknown recipe";
    const now = Date.now();
    if (now - player.lastBuild < ACTION_COOLDOWN_MS) return "wait";
    const blocker = recipeBlocker(
      recipe,
      player,
      await stationsNear(ctx, player, now),
    );
    if (blocker) return blocker;
    const changes: Record<string, number> = {};
    for (const [key, n] of Object.entries(recipe.cost))
      if (n) changes[key] = -n;
    for (const [key, n] of Object.entries(recipe.output || {}))
      if (n) changes[key] = (changes[key] || 0) + n;
    await ctx.db.patch("players", player._id, {
      ...inventoryPatch(player, changes),
      ...experience(player, 5),
      tools: recipe.tool
        ? { ...player.tools, [recipe.tool]: recipe.tier! }
        : player.tools || {},
      milestones: [...new Set([...(player.milestones || []), recipe.id])],
      stats: bumpStats(player.stats, {
        [`craft:${recipe.id}`]: 1,
        cook: recipe.output?.meal || 0,
      }),
      lastBuild: now,
      lastSeen: now,
    });
    return `crafted ${recipe.name.toLowerCase()}${recipe.tool ? " · equipped" : ""} · +5 xp`;
  },
});

/*
 * Eat one item from the pack for hunger (and, for a cooked meal, hp).
 * Args: `item`, which must be a key of FOOD in src/lib/survival.js
 * (berries, meal); raw meat and the like must be cooked first at a campfire.
 * Checks: alive; edible; at least one in the pack; not wasted, i.e. refused
 * when hunger is already full and the food would not heal either. No
 * cooldown: the food supply is the limit. Hunger caps at 100, hp at maxHp.
 * Reads/writes the player only. Returns a message or the refusal reason.
 */
export const eat = mutation({
  args: { session: v.string(), item: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const player = await getPlayer(ctx, args.session);
    if (!player || player.hp <= 0) return "wake up first";
    const food = FOOD[args.item as keyof typeof FOOD];
    if (!food) return "cook raw food at a campfire first";
    const bag = inventoryOf(player) as Record<string, number>;
    if ((bag[args.item] || 0) < 1) return "nothing left to eat";
    if (
      (player.hunger ?? 100) >= 100 &&
      (food.hp === 0 || player.hp >= player.maxHp)
    )
      return "already full";
    await ctx.db.patch("players", player._id, {
      ...inventoryPatch(player, { [args.item]: -1 }),
      hunger: Math.min(100, (player.hunger ?? 100) + food.hunger),
      hp: Math.min(player.maxHp, player.hp + food.hp),
      lastSeen: Date.now(),
    });
    return `ate ${args.item === "meal" ? "a cooked meal" : "berries"} · +${food.hunger} hunger`;
  },
});

/*
 * Chests are deliberately communal: anyone in reach may put in or take out,
 * whoever built it. Each transfer is one atomic transaction, so two people
 * emptying a chest cannot both get the same items.
 * Args: the chest's tile `x`, `y`; `item` (must be an own key of ITEMS, which
 * also rejects names like "constructor"); `direction` "deposit" | "withdraw".
 * Checks: alive; within REACH; known item; the tile holds a chest; there is
 * something to move. Moves at most 10 of the item per call, which is also
 * the only rate limit (no cooldown). The chest has no capacity limit.
 * Reads: player, the one cell. Writes: the chest's `stock` and the player's
 * pack. Returns "stored/took N item" or the reason.
 */
export const transfer = mutation({
  args: {
    session: v.string(),
    x: v.number(),
    y: v.number(),
    item: v.string(),
    direction: v.union(v.literal("deposit"), v.literal("withdraw")),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const player = await getPlayer(ctx, args.session);
    if (!player || player.hp <= 0) return "wake up first";
    if (!withinReach(player, args.x, args.y)) return "move closer to the chest";
    if (!Object.hasOwn(ITEMS, args.item)) return "unknown supply";
    const chest = await cellAt(ctx, args.x, args.y);
    if (chest?.kind !== "chest") return "no chest here";
    const stock = { ...chest.stock };
    const bag = inventoryOf(player) as Record<string, number>;
    const deposit = args.direction === "deposit";
    const amount = Math.min(
      10,
      deposit ? bag[args.item] || 0 : stock[args.item] || 0,
    );
    if (amount <= 0) return "nothing to transfer";
    stock[args.item] = (stock[args.item] || 0) + (deposit ? amount : -amount);
    await ctx.db.patch("cells", chest._id, { stock });
    await ctx.db.patch("players", player._id, {
      ...inventoryPatch(player, { [args.item]: deposit ? -amount : amount }),
      lastSeen: Date.now(),
    });
    return `${deposit ? "stored" : "took"} ${amount} ${args.item}`;
  },
});

/*
 * Save the character creator's choices. Unlike the other mutations this one
 * throws on bad input, because the creator can only send it deliberately.
 * Args: `name` (trimmed, cut to MAX_NAME, must be non-empty) and
 * `appearance` (every field must be one of the options in
 * src/lib/appearance.js, checked by appearanceValid in addition to the
 * validator's shape check, so a hand-made request cannot invent a look).
 * Needs a joined player. No cooldown; reads and writes the player only.
 * Names are not unique. Returns "character saved".
 */
export const customize = mutation({
  args: {
    session: v.string(),
    name: v.string(),
    appearance: appearanceValidator,
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const player = await getPlayer(ctx, args.session);
    if (!player) throw new Error("Join the world first");
    if (!appearanceValid(args.appearance))
      throw new Error("Choose one of the available appearances");
    const name = args.name.trim().slice(0, MAX_NAME);
    if (!name) throw new Error("A name is required");
    await ctx.db.patch("players", player._id, {
      name,
      appearance: args.appearance,
      lastSeen: Date.now(),
    });
    return "character saved";
  },
});
