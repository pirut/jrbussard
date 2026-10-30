import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/*
 * Every table the Commons and the main site's presence layer use. Only
 * convex/*.ts reads or writes these; the browser and the native app go
 * through the queries and mutations in world.ts, game.ts and site.ts.
 *
 * Where each row comes from:
 *   world     created lazily by world.ts (getWorld), kept by tick.ts
 *   players   world.join, then nearly every world.ts mutation
 *   monsters  tick.ts only (spawn, move, forget); world.move/attack damage them
 *   cells     world.build / harvest, cleared by tick.ts (regrowth)
 *   ground    world.terraform
 *   projects  game.contribute
 *   visitors  site.here / site.leave
 *   chat      world.ts post() and tick.ts and game.ts announcements
 *
 * Index rule of thumb: the world is endless and cells and ground only ever
 * grow, so reads are bounded by an index (a tile, a chunk, a recent
 * lastSeen) rather than by how much has been built. Each index below exists
 * to bound one specific read. The (x, y) indexes are not declared unique;
 * one row per tile holds because the mutations look before they insert.
 */

/* A character's look: palette names and style ids, validated against the
   options in src/lib/appearance.js. Shared by `players` and `visitors` so the
   main site shows a Commons character in its own clothes. */
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
  /* Singleton (key "singleton"): the tick loop's bookkeeping and the weather.
     The terrain is generated from coordinates, so there is no map to store.
     `ticking` and `lastTick` are how ensureTicking (world.ts) decides whether
     the heartbeat in tick.ts needs starting; see the header of tick.ts.
     `weather` is one of WEATHERS in field.ts and `weatherUntil` the time it
     next changes. by_key is the singleton lookup (world.ts getWorld,
     tick.ts run). */
  world: defineTable({
    key: v.string(),
    ticking: v.boolean(),
    lastTick: v.number(),
    weather: v.string(),
    weatherUntil: v.number(),
    /* Which run of the tick loop is the live one. A restart bumps it, so a
       loop that was given up on stands down instead of running twice. */
    loop: v.optional(v.number()),
    /* The sky as the tick last saw it, so dusk and dawn happen once. */
    phase: v.optional(v.string()),
  }).index("by_key", ["key"]),

  /* One row per character, kept for good: a character stays where it was
     left and is simply not "present" once lastSeen is older than the idle
     window (45 s, IDLE_MS in world.ts and tick.ts). Position and combat
     state are server-authoritative; clients only ever send intentions. */
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
    /* Presence: bumped by most actions and by the heartbeat mutation. */
    lastSeen: v.number(),
    /* When the next step is due (see the pacing note in world.ts), not
       strictly when the last one happened. Also holds off out-of-combat
       regeneration in tick.ts. */
    lastMove: v.number(),
    /* Cooldown clock for build, harvest and demolish. */
    lastBuild: v.number(),
    /* Incoming-damage throttle, and the grace window after arriving. */
    lastHurt: v.optional(v.number()),
    graceUntil: v.optional(v.number()),
    /* Furthest distance from the origin ever reached. */
    far: v.optional(v.number()),
    appearance: v.optional(appearanceValidator),
    /* Everything in the pack except wood and stone, which have their own
       columns above. Read it through inventoryOf and write it through
       inventoryPatch (survival.ts), which keep the two halves consistent. */
    inventory: v.optional(v.record(v.string(), v.number())),
    /* Owned tools by id (e.g. lantern), as a count. */
    tools: v.optional(v.record(v.string(), v.number())),
    /* 0 to 100; stepped about every 15 s by survivalStep (src/lib/
       survival.js) from tick.ts. Absent on older rows, read as full (100). */
    hunger: v.optional(v.number()),
    warmth: v.optional(v.number()),
    /* When the tick last ran this player's survival step. */
    lastSurvival: v.optional(v.number()),
    /* Count of things gathered, and the resources and blocks the player has
       done at least once (the "what to try next" hints in src/lib/
       survival.js read it). */
    gathered: v.optional(v.number()),
    milestones: v.optional(v.array(v.string())),
    /* Where to wake after dying: set by using your own bedroll (world.use). */
    home: v.optional(v.object({ x: v.number(), y: v.number() })),
    /* Counters for the quest chain ("gather:wood", "kill:wolf", "nights"),
       and the index of the task in hand. See src/lib/game/. */
    stats: v.optional(v.record(v.string(), v.number())),
    quest: v.optional(v.number()),
  })
    /* Who is acting: every mutation resolves its caller from the browser's
       session id. Unique per character. */
    .index("by_session", ["session"])
    /* "Who is around": the tick's active set, join's arrival spot, /who and
       the state query's player list all range over lastSeen > now - 45 s and
       take(200), so cost follows players online, not players ever created. */
    .index("by_lastSeen", ["lastSeen"])
    /* The leaderboard: highest level first, ties broken by kills. */
    .index("by_level", ["level", "kills"])
    /* Not used by any query in convex/ at present (monsters and cells have
       their own by_pos); kept as the natural "who is on this tile" lookup. */
    .index("by_pos", ["x", "y"])
    /* Lets a step check the one tile it lands on instead of every player,
       reading only who is still around: characters stay where they were
       left, so a busy tile collects them. */
    .index("by_x_and_y_and_lastSeen", ["x", "y", "lastSeen"]),

  /* Live creatures, managed relative to players: tick.ts spawns them in a
     ring around someone, moves them each beat and deletes any with nobody
     nearby, so the table stays small (the tick reads at most 100). `kind`
     is a key of MONSTERS in field.ts (src/lib/game/creatures.js). by_pos
     answers "is a monster on this tile" for movement and attacks, and the
     x-range scan for the ones in a player's view (world.state). */
  monsters: defineTable({
    kind: v.string(),
    x: v.number(),
    y: v.number(),
    hp: v.number(),
    maxHp: v.number(),
    /* When it last swung at someone (SWING_MS cooldown in tick.ts). */
    lastHit: v.optional(v.number()),
  }).index("by_pos", ["x", "y"]),

  /*
   * Everything players have changed about the world: blocks they built and
   * stumps where they harvested. Keyed by chunk so looking at one corner of
   * an endless world never scans the rest of it. Rows with regrowAt === 0 are
   * permanent (built); rows with regrowAt > 0 are stumps and rubble that
   * tick.ts deletes once the time passes, which is how trees and rocks come
   * back.
   */
  cells: defineTable({
    x: v.number(),
    y: v.number(),
    /* chunkKey(x, y) from src/lib/terrain.js; the by_chunk index key. */
    chunk: v.string(),
    /* A key of BLOCKS in field.ts, or "stump" / "rubble". */
    kind: v.string(),
    /* The builder's session id and display name; empty for stumps. */
    owner: v.string(),
    ownerName: v.string(),
    /* Sign text (cut to 60 characters when written). */
    text: v.string(),
    /* 0 for something built; otherwise when a stump or rubble goes away. */
    regrowAt: v.number(),
    /* Doors only. Absent means open, so existing doors stay passable. */
    open: v.optional(v.boolean()),
    /* Campfires only: when the fire burns out. A cold fire gives no light
       and no crafting station. */
    fuelUntil: v.optional(v.number()),
    /* Chests only: what is inside, by item id. */
    stock: v.optional(v.record(v.string(), v.number())),
    /* Quarter turns for doors, signs and the like. Absent: it faces
       whichever way its walls run (see src/lib/building.js). */
    facing: v.optional(v.number()),
  })
    /* "What stands on this tile": collision, building, harvesting, and the
       column-by-column reads in nearbyCells (survival.ts). */
    .index("by_pos", ["x", "y"])
    /* A viewport: world.state reads only the chunks it overlaps. */
    .index("by_chunk", ["chunk"])
    /* Regrowth: the tick takes the few rows with 0 < regrowAt <= now. The
       range excludes built blocks (regrowAt 0) without reading them. */
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
    /* Signed terrace steps: negative is dug down, positive is piled up. */
    edit: v.number(),
    fill: v.optional(v.array(v.union(v.literal("dirt"), v.literal("sand")))),
    /* Display name of whoever last worked the tile, and when. */
    by: v.string(),
    at: v.number(),
  })
    /* One tile: terraform, movement checks, and the tick's solidGround
       lookup for the tile a creature is about to step onto. */
    .index("by_x_and_y", ["x", "y"])
    /* A viewport, as for `cells`. */
    .index("by_chunk", ["chunk"]),

  /*
   * Who is walking around the main site right now. Nothing here is a game:
   * a row is a position, a heading and a name, written a few times a second
   * while someone walks and dropped from view once they stop checking in.
   */
  visitors: defineTable({
    session: v.string(),
    name: v.string(),
    x: v.number(),
    y: v.number(),
    facing: v.number(),
    running: v.boolean(),
    /* Copied from their Commons character, if they have one. */
    appearance: v.optional(appearanceValidator),
    lastSeen: v.number(),
  })
    /* A visitor's own row, for the write throttle and for leaving. */
    .index("by_session", ["session"])
    /* Who is still around (last 20 s), newest first, and the sweep that
       deletes rows older than ten minutes. */
    .index("by_lastSeen", ["lastSeen"]),

  /*
   * Shared work at the crossroads (src/lib/game/projects.js): one row per
   * project, holding what has been given so far. There are only ever a
   * handful. by_key looks a project up by its key in PROJECTS (game.ts), one
   * point read each; `progress` is supplies given so far by item and
   * `contributors` counts distinct players who have given to it.
   */
  projects: defineTable({
    key: v.string(),
    progress: v.record(v.string(), v.number()),
    done: v.boolean(),
    doneAt: v.optional(v.number()),
    contributors: v.number(),
  }).index("by_key", ["key"]),

  /* The shared log: speech, deaths, weather, quests, level-ups and project
     news. `kind` labels the line (chat, system, weather, death, quest, level,
     project). Deliberately unindexed:
     it is only ever read newest-first (the default _creationTime order) with
     a small take(), and trimmed to about 50 rows on each write (world.ts) and
     each tick. */
  chat: defineTable({
    name: v.string(),
    text: v.string(),
    kind: v.string(),
  }),
});
