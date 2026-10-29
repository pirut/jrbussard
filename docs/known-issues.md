# Known issues

Found while documenting the code (the comment pass), by reading it. None has
been reproduced or fixed unless noted; each is a lead, not a verdict. Line
numbers drift, so search for the named function.

## Gameplay and server

- `convex/world.ts` `eat`: no own-key guard on `FOOD[args.item]`, so inherited
  names like `"constructor"` get past the food check (`transfer` does guard with
  `Object.hasOwn`). Probably fails later on validation; close it anyway.
- `convex/world.ts` `harvest`: berries and fibre leave "rubble" with the rock
  regrow time (5 min). May not be intended.
- `convex/world.ts` `use` / `terraform` read `monsters.take(100)` and filter,
  instead of the `by_pos` index `move` uses. Correct only while `tick.ts` caps
  monsters at 90 (`MAX_MONSTERS`, not exported).
- `IDLE_MS` is defined in both `world.ts` and `tick.ts`; the level-up loop is in
  both `move` and `survival.ts` `experience()`. Keep in step or merge.
- `convex/site.ts`: `here` cuts `session` to 64 chars but `leave` and the
  `visitors` self-filter use the raw string.
- `convex/schema.ts` `players.by_pos` is not queried anywhere.
- `src/lib/game/creatures.js` `creatureStep`: a chaser lined up on one axis zeroes
  that axis half the time and stalls (only the fleeing case is guarded).
- `src/lib/convex.test.js` whitelists `world:spawnNear`, which doesn't exist.
- Doc drift in `docs/commons-gameplay.md`: shades are not the longest-range
  hunters (wolf 11 tiles at night vs shade 10), and the Cost section's claim that
  players are written only on phase change is wrong.

## Client

- Navigation vs server on doors: `arcade/ascii3d/navigation.js` treats a door as
  walkable only if `cell.open` is truthy; the server treats it as shut only if
  `cell.open === false`.
- `arcade/commons/input/settings.js`: master volume / music / effects are saved
  but nothing reads them, so the sliders do nothing (`sound.js` uses fixed gains).
- `arcade/commons/input/useGamepad.js` + `Commons.js` `mouseRef`: releases are
  not passed on while a menu is open, so "act" held as a menu opens can leave
  the swing stuck on until a mouse-up.
- `CharacterSheet.js` closes on a hard-coded `k`; `HelpOverlay.js` and
  `DigControl.js` hard-code default key names in text, wrong after a remap.
  `SettingsPanel.js` says a displaced action "now has no key" though `rebind`
  leaves its other keys.
- `sound.js`: `bird()` applies only the last random pan; `hiss()` can outlast
  its non-looping noise buffer.
- `Commons.js` keydown handler calls `event.key.toLowerCase()`, which throws on
  autofill events with no `key`.
- Dead code: `arcade/commons/Objective.js`, `WorldCharacter` in
  `CommonsCharacter.js`, `shade.js` (`shadeColor`, `mixToward`, `toHex`),
  `building.js` (`facingOf`, `shortfall`, `UNDO_MS`), `ground.js`
  (`TERRAFORM_MODES`), `field.ts` (`MONSTER_ORDER`).

## Renderer

- `AsciiWorld.js` `updateLighting`: `flash` only decays during a storm, so
  leaving a storm (or toggling reduced motion) within ~0.2 s of a strike leaves
  the sky lightning-tinted.
- GPU leaks: `AsciiWorld.js` `dispose` skips `water`, `cursor`, `sparks`,
  `splashes`, `embers` and `sun.shadow.map`; `models.js` `buildCursor`'s material
  isn't flagged `userData.own`; a torch ghost (`ghost.js` + `models.js`) leaks two
  materials per rebuild.
- `AsciiField.js` `DENSITIES`: "normal" (`[4, 7]`) has smaller cells than "fine"
  (`[5, 8]`). Looks inverted.
- `figureKit.js` `channels()` mis-parses 3-digit hex colours (none in use).
- `demo.js`: a hard-coded `16` must equal `CHUNK` in `lib/terrain.js`; a bite
  sets hp with `Math.max(12, hp - bite)`, which can *raise* low hp.
- `asciiPass.js`: the pick shader's stroke thresholds aren't covered by
  `strokeFor` or its tests; glyph shapes are measured once in whatever font is
  loaded at construction.

## The site

- `site3d/warren.js` window cages always go on the same side (the `-0.24 : 0.24`
  branch sits inside `if (extra < 0.05)`).
- `site3d/SiteScene.js` `updateSky` and torch flames keep animating under
  reduced motion, contradicting the README.
- `world/parallax.js`: the near-foliage clear zone is centred on the viewport,
  not the player, so near the map edge foliage can cover JR.
- The site's walls are enforced only in the browser (`convex/site.ts` just clamps
  positions to ±4096); it is presence, not a game rule.
