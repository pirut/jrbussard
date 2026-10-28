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
import type { MutationCtx, QueryCtx } from "./_generated/server";
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
} from "./field";

/*
 * Everything here is server-authoritative: the client asks, the server
 * decides. The world is endless, so every query is scoped to what one player
 * can actually see.
 */

const MOVE_COOLDOWN_MS = 120;
/* How early a step may come. Steps sent at a steady pace can bunch up on
   the way here; this lets one arrive a step early instead of being dropped,
   while the average stays at one per MOVE_COOLDOWN_MS. */
const MOVE_SLACK_MS = 120;
/* Gathering, crafting and fuelling a fire. Building and taking down have
   their own, shorter beat (BUILD_COOLDOWN_MS in src/lib/building.js). */
const ACTION_COOLDOWN_MS = 600;
const IDLE_MS = 45_000;
const CHAT_LIMIT = 50;
const MAX_NAME = 18;
const MAX_CHAT = 160;
const BUBBLE_MS = 7000;
/* Breathing room after arriving or reviving. */
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
  await ctx.db.patch("world", world._id, {
    ticking: true,
    lastTick: Date.now(),
  });
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

async function groundAt(ctx: MutationCtx | QueryCtx, x: number, y: number) {
  return await ctx.db
    .query("ground")
    .withIndex("by_x_and_y", (q) => q.eq("x", x).eq("y", y))
    .unique();
}

/* Somebody alive, or a creature, standing on the tile. */
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
  const standing = await ctx.db
    .query("players")
    .withIndex("by_lastSeen", (q) => q.gt("lastSeen", now - IDLE_MS))
    .take(200);
  return standing.some((p) => p.hp > 0 && p.x === x && p.y === y);
}

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

/* Solid means generated terrain, or a block someone put there. */
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
      const spec = MONSTERS[target.kind];
      const swing =
        3 +
        player.level * 2 +
        (player.tools?.weapon || 0) * 4 +
        Math.floor(Math.random() * 4);
      const left = target.hp - swing;

      if (left > 0) {
        await ctx.db.patch("monsters", target._id, { hp: left });
        await ctx.db.patch("players", player._id, {
          lastMove: due,
          lastSeen: now,
        });
        return here;
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
        ...inventoryPatch(player, {
          meat: 1 + (target.kind === "wolf" ? 1 : 0),
        }),
        kills: player.kills + 1,
        potions: Math.random() < 0.18 ? player.potions + 1 : player.potions,
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
    const standing = await ctx.db
      .query("players")
      .withIndex("by_pos", (q) => q.eq("x", nx).eq("y", ny))
      .take(8);
    if (
      standing.some(
        (other) =>
          other._id !== player._id &&
          other.hp > 0 &&
          other.lastSeen > now - IDLE_MS,
      )
    ) {
      return here;
    }

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

/* Chop a tree or mine a rock next to you. Both grow back. */
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
      milestones: [...new Set([...(player.milestones || []), resource])],
      lastBuild: now,
      lastSeen: now,
    });
    await ensureTicking(ctx);
    return `+${gain} ${resource === "ore" ? "iron ore" : resource} · +3 xp`;
  },
});

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
    const shovel = Math.min(player.tools?.shovel || 0, SHOVEL_COOLDOWN_MS.length - 1);
    if (shovel > 0 && now - player.lastBuild < SHOVEL_COOLDOWN_MS[shovel])
      return "wait";
    if (!withinReach(player, args.x, args.y)) return "too far";

    const cell = await cellAt(ctx, args.x, args.y);
    if (cell && cell.regrowAt === 0) return "something is built there";
    const monsters = await ctx.db.query("monsters").take(100);
    if (monsters.some((m) => m.x === args.x && m.y === args.y))
      return "occupied";
    const standing = await ctx.db
      .query("players")
      .withIndex("by_lastSeen", (q) => q.gt("lastSeen", now - IDLE_MS))
      .take(200);
    if (standing.some((p) => p.hp > 0 && p.x === args.x && p.y === args.y))
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
      cleared: Boolean(cell),
      shovel,
      bag: inventoryOf(player),
    });
    if (plan.error !== undefined) return plan.error;

    if (ground)
      await ctx.db.patch("ground", ground._id, {
        edit: plan.edit,
        by: player.name,
        at: now,
      });
    else
      await ctx.db.insert("ground", {
        x: args.x,
        y: args.y,
        chunk: chunkKey(args.x, args.y),
        edit: plan.edit,
        by: player.name,
        at: now,
      });
    /* A stump or rubble is dug out with the ground, so nothing grows back. */
    if (cell) await ctx.db.delete("cells", cell._id);

    await ctx.db.patch("players", player._id, {
      ...inventoryPatch(player, { [plan.item]: plan.change }),
      ...experience(player, 1),
      milestones: [...new Set([...(player.milestones || []), "dig"])],
      lastBuild: now,
      lastSeen: now,
    });
    await ensureTicking(ctx);
    return plan.message;
  },
});

/* You can only take down your own work. Fresh work comes back whole. */
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
        const standing = await ctx.db
          .query("players")
          .withIndex("by_lastSeen", (q) =>
            q.gt("lastSeen", Date.now() - IDLE_MS),
          )
          .take(200);
        if (
          standing.some((p) => p.hp > 0 && p.x === args.x && p.y === args.y)
        ) {
          return "someone is in the doorway";
        }
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
        appearance: appearanceValidator,
        inventory: v.record(v.string(), v.number()),
        tools: v.record(v.string(), v.number()),
        hunger: v.number(),
        warmth: v.number(),
        gathered: v.number(),
        milestones: v.array(v.string()),
        home: v.union(v.object({ x: v.number(), y: v.number() }), v.null()),
        stations: v.array(v.string()),
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
      lastBuild: now,
      lastSeen: now,
    });
    return `crafted ${recipe.name.toLowerCase()}${recipe.tool ? " · equipped" : ""} · +5 xp`;
  },
});

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

/* Chests are deliberately communal. Each transfer is one atomic transaction. */
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
