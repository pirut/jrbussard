import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const appearanceValidator = v.object({
  skin: v.string(),
  hair: v.string(),
  outfit: v.string(),
  cloak: v.string(),
  hairstyle: v.string(),
  headwear: v.string(),
  sigil: v.string(),
});
export default defineSchema({
  /* Singleton: tick state and weather. The terrain is generated from
       coordinates, so there is no map to store. */
  world: defineTable({
    key: v.string(),
    ticking: v.boolean(),
    lastTick: v.number(),
    weather: v.string(),
    weatherUntil: v.number(),
    /* Which run of the tick loop is the live one. A restart bumps it, so a
       loop that was given up on stands down instead of running twice. */
    loop: v.optional(v.number()),
  }).index("by_key", ["key"]),

  players: defineTable({
    session: v.string(),
    name: v.string(),
    x: v.number(),
    y: v.number(),
    level: v.number(),
    xp: v.number(),
    hp: v.number(),
    maxHp: v.number(),
    gold: v.number(),
    potions: v.number(),
    kills: v.number(),
    wood: v.number(),
    stone: v.number(),
    placed: v.number(),
    /* Last thing said, for the speech bubble over their head. */
    saidText: v.string(),
    saidAt: v.number(),
    lastSeen: v.number(),
    lastMove: v.number(),
    lastBuild: v.number(),
    /* Incoming-damage throttle, and the grace window after arriving. */
    lastHurt: v.optional(v.number()),
    graceUntil: v.optional(v.number()),
    /* Furthest distance from the origin ever reached. */
    far: v.optional(v.number()),
    appearance: v.optional(appearanceValidator),
    inventory: v.optional(v.record(v.string(), v.number())),
    tools: v.optional(v.record(v.string(), v.number())),
    hunger: v.optional(v.number()),
    warmth: v.optional(v.number()),
    lastSurvival: v.optional(v.number()),
    gathered: v.optional(v.number()),
    milestones: v.optional(v.array(v.string())),
    home: v.optional(v.object({ x: v.number(), y: v.number() })),
  })
    .index("by_session", ["session"])
    .index("by_lastSeen", ["lastSeen"])
    .index("by_level", ["level", "kills"])
    .index("by_pos", ["x", "y"])
    /* Lets a step check the one tile it lands on instead of every player,
       reading only who is still around: characters stay where they were
       left, so a busy tile collects them. */
    .index("by_x_and_y_and_lastSeen", ["x", "y", "lastSeen"]),

  monsters: defineTable({
    kind: v.string(),
    x: v.number(),
    y: v.number(),
    hp: v.number(),
    maxHp: v.number(),
    lastHit: v.optional(v.number()),
  }).index("by_pos", ["x", "y"]),

  /*
   * Everything players have changed about the world: blocks they built and
   * stumps where they harvested. Keyed by chunk so looking at one corner of
   * an endless world never scans the rest of it.
   */
  cells: defineTable({
    x: v.number(),
    y: v.number(),
    chunk: v.string(),
    kind: v.string(),
    owner: v.string(),
    ownerName: v.string(),
    text: v.string(),
    regrowAt: v.number(),
    /* Doors only. Absent means open, so existing doors stay passable. */
    open: v.optional(v.boolean()),
    fuelUntil: v.optional(v.number()),
    stock: v.optional(v.record(v.string(), v.number())),
    /* Quarter turns for doors, signs and the like. Absent: it faces
       whichever way its walls run (see src/lib/building.js). */
    facing: v.optional(v.number()),
  })
    .index("by_pos", ["x", "y"])
    .index("by_chunk", ["chunk"])
    .index("by_regrow", ["regrowAt"]),

  /*
   * Ground players have dug or piled up: how many terrace steps each worked
   * tile sits above or below the generated landscape (see src/lib/ground.js).
   * One row per tile, looked up by chunk like `cells`, so a viewport reads
   * only the handful of chunks it touches. `fill` is what was shovelled into
   * the tile, bottom step first, so digging it out hands the same back; it
   * never holds more than MAX_DIG + MAX_RAISE entries.
   */
  ground: defineTable({
    x: v.number(),
    y: v.number(),
    chunk: v.string(),
    edit: v.number(),
    fill: v.optional(v.array(v.union(v.literal("dirt"), v.literal("sand")))),
    by: v.string(),
    at: v.number(),
  })
    .index("by_x_and_y", ["x", "y"])
    .index("by_chunk", ["chunk"]),

  chat: defineTable({
    name: v.string(),
    text: v.string(),
    kind: v.string(),
  }),
});
