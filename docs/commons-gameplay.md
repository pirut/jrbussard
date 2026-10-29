# Commons gameplay loop

The Commons already had the parts of a survival game: gathering, a craft tree
with tool tiers, hunger and cold, creatures, campfires and bedrolls, shared
chests. What it lacked was a reason to do one thing after another, a reason
for night to matter, and a reason for strangers to play together. This pass
adds three things on top of what is there and keeps everything else.

## 1. The road: a quest chain with rewards

A single "next goal" card becomes a chain of thirteen tasks in four chapters.
Each task has one to three objectives with visible progress ("Wood 7/12") and a
reward you claim (experience, gold, potions, supplies). Claiming is a server
mutation that checks the objectives itself, so the client only ever asks.

| Chapter | Tasks |
| --- | --- |
| I. First light | gather wood and stone · make an axe and a pick · build a campfire and cook · greet a dawn out in the wild |
| II. Hunter | kill six creatures · set a bedroll, raise walls and a door · smelt iron |
| III. Settler | give to a crossroads project · kill wolves · iron weapon and armor |
| IV. Warden | mine crystal · kill shades over three nights · kill a moss troll |

Objectives read per-player counters (`stats`), written by the mutations that
already exist: `gather:wood`, `kill:wolf`, `craft:smelt`, `build:campfire`,
`cook`, `nights`, `contribute`. Some read state the player already has (tool
tiers, a home, lifetime kills), so a veteran is credited for what they did
before this shipped.

## 2. Night: shades, dusk and dawn

Night was colder and a little busier. Now it changes the game:

- **Dusk** is announced in chat. From dusk until dawn, **shades** spawn: a
  night-only creature that hunts from further away than anything else. Like
  everything else, they will not step into torchlight.
- **Dawn** burns every shade away. Anyone alive and outside the crossroads
  when it breaks has survived the night: a counter for the quest chain and a
  little experience.
- Shades drop **shadow essence**, the one ingredient for the **warden's
  lantern**, a late tool: shades stop chasing you and bite for half.

Creature behaviour now lives in one pure function (`creatureStep`) with a
temper per kind:

| Creature | Temper | Behaviour |
| --- | --- | --- |
| field rat | skittish | flees once badly hurt |
| kobold | chaser | the old behaviour |
| grey wolf | pack | notices you from further off |
| moss troll | brute | slow: moves on about half the ticks |
| shade | stalker | night only, longest reach, held off by a lantern |

## 3. The crossroads: shared projects

Three community projects are built in order at the crossroads, by anyone,
from what they carry there (up to ten of one supply per hand-in). Each one, once
finished, changes the world for everybody:

| Project | Needs | Effect for everyone |
| --- | --- | --- |
| Crossroads well | 150 wood · 100 stone · 30 fiber | +1 health regenerated per beat |
| Watchtower | 250 stone · 120 wood · 12 iron ingots | fewer creatures at night |
| The beacon | 300 wood · 300 stone · 30 ingots · 12 crystal | night bites 25% softer |

Progress is stored in a `projects` table (one row per project, three rows in
all). Completion is announced in chat.

Once all three are finished, the **crossroads stores** stay open. They take
wood, stone and fiber (up to ten per hand-in), change nothing in the world
and pay no experience, but each hand-in counts toward the `contribute`
stat. That keeps "For the commons" (30 supplies given) finishable for
anyone who arrives after the last project is done. Nothing is stored for
them beyond the player's stat.

## Where the rules live

All rules are pure JavaScript in `src/lib/game/`, with no React, three.js or
Convex imports, so the server, the browser and a future native client can
share them:

- `stats.js`: the counters and how they are bumped
- `quests.js`: the chain, progress, and rewards
- `creatures.js`: creature specs, tempers, movement, spawning, loot
- `projects.js`: projects, contributions, and world effects
- `daycycle.js`: phase changes (dusk, dawn) and who survived the night

They are `// @ts-check`ed, so `npx tsc -p convex` type-checks them, and unit-tested in
`tests/game-rules.test.ts`. Convex functions (`convex/game.ts` and hooks in
`world.ts`/`tick.ts`) only read the documents a rule needs, call the rule and
write the result.

## Cost

- Quest claims and contributions are single-document mutations on the
  player (plus one project row), each behind a per-player limit from the
  `@convex-dev/rate-limiter` component (`convex/convex.config.ts`): one
  hand-in per 600 ms and one claim per 2 s, refused attempts included.
- The tick reads at most three project rows per beat and writes to players
  only when the phase changes (twice per twelve-minute day).
- `game:projects` is its own query, so the three rows that rarely change are not
  re-sent with every step.

## Schema

All additions are optional fields or a new table, so existing documents stay
valid: `players.stats`, `players.quest`, `world.phase`, `projects`.

## Left for later

Gold has no sink yet (a crossroads trader is the obvious one), and there are no
boss events or seasons. Both would fit on the same stats and projects.
