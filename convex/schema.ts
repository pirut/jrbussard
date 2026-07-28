import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
    /* Singleton: tick state and weather. The terrain is generated from
       coordinates, so there is no map to store. */
    world: defineTable({
        key: v.string(),
        ticking: v.boolean(),
        lastTick: v.number(),
        weather: v.string(),
        weatherUntil: v.number(),
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
    })
        .index("by_session", ["session"])
        .index("by_lastSeen", ["lastSeen"]),

    monsters: defineTable({
        kind: v.string(),
        x: v.number(),
        y: v.number(),
        hp: v.number(),
        maxHp: v.number(),
        lastHit: v.optional(v.number()),
    }),

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
    })
        .index("by_pos", ["x", "y"])
        .index("by_chunk", ["chunk"])
        .index("by_regrow", ["regrowAt"]),

    chat: defineTable({
        name: v.string(),
        text: v.string(),
        kind: v.string(),
    }),
});
