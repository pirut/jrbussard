# The Commons app

`apps/commons/` is the start of a native Commons for iPhone, iPad, Android
phones, Apple TV and Android TV, with a browser build from the same code. It
plays in the same shared world as the browser Commons at `/commons`, which stays
as it is.

Stack: Expo SDK 58, React Native through the TV fork
[`react-native-tvos`](https://github.com/react-native-tvos/react-native-tvos)
0.88, three.js 0.169 drawn through `expo-gl`, and the Convex React client.

## Layout

```
apps/commons/
  app.json            Expo config: bundle ids, TV config plugin
  metro.config.js     lets Metro read ../../src and ../../convex
  tsconfig.json       @site/* and @convex/* path aliases
  .npmrc              legacy-peer-deps (see "Installing")
  .env.example        EXPO_PUBLIC_CONVEX_URL
  src/
    App.tsx           title / controls / play screens
    shared.ts         every import from the browser game, in one place
    net/convex.ts     Convex client, typed api, per-install session id
    net/world.tsx     "the world": live Convex or the offline stand-in
    game/GameScreen.tsx  connects the pieces to the screen; decides what a press means now
    game/walking.ts   body, walker and server steps (no React: unit tested)
    game/actions.ts   action -> server request (no React: unit tested)
    hud/model.ts      what the HUD says, from a snapshot (no React: unit tested)
    hud/              Vitals, QuestCard, Panels (craft / pack / journal), ChatBox
    world/scene.ts    three.js scene: terrain, trees, rocks, builds, people
    world/World3D.tsx GL surface and render loop
    input/            InputHub and its sources (keyboard, gamepad, TV remote, touch)
    ui/               Menu, useListNav, theme (sizes scale for TV), controlsText
```

The app has its own `package.json` and `node_modules`. The root build ignores it:
CRA only compiles `src/`, vitest only collects `tests/**/*.test.ts`, Vercel
runs the root `npm run build`, and Convex only bundles `convex/`. Root
`npm ci`, `npm run build:frontend` and `npm run test:commons` don't change.

## How it talks to the server

Same backend and same protocol as `src/arcade/Commons.js`:

- `world:state({ session })` is a live `useQuery`. Each snapshot updates the
  scene and squares the walker with the server.
- `world:join({ session, name })` runs once and `world:heartbeat` every 15 s.
- Moves are one-tile `world:move({ session, dx, dy })` steps. The body moves
  smoothly with `src/world/motion.js`. Each tile it crosses is sent at the
  browser's 150 ms beat, and `src/arcade/ascii3d/prediction.js` keeps the
  shown position matched to the server's answers.
- Gather is `world:harvest`, dig is `world:terraform` with `mode: "dig"`, and
  build is `world:build` with `kind: "wall"`. Each targets the tile you face.
  `world:respawn` runs after you die.

Function references are built by name at runtime (`anyApi`). Their types come
from `convex/_generated/api.d.ts`, so a renamed argument in `convex/world.ts`
fails the app's typecheck. Only types are imported from `_generated`, so the
bundle never needs it.

`convex/_generated` is gitignored. `npx convex dev` at the repo root writes it,
and the app's typecheck needs it there. Running the app doesn't. Without a
deployment, `npm run types:convex` (in `apps/commons/`) runs the root's
`scripts/stub-convex-generated.cjs`, which writes a stand-in from the files in
`convex/`: `api` and `internal` from the function modules, the data model from
`schema.ts`, and the components `convex.config.ts` installs, typed the way
codegen types npm components. It never overwrites real codegen output. CI
uses it too.

### Configuration

Copy `apps/commons/.env.example` to `apps/commons/.env.local` and set
`EXPO_PUBLIC_CONVEX_URL` to the Commons deployment URL, the same value as
`REACT_APP_CONVEX_URL` in the root `.env.local`. It's a public client URL, not a
secret. No keys are needed or committed. With the URL unset, the app runs the
browser's offline stand-in world (`src/arcade/ascii3d/demo.js`), so it always
has something to show.

The session is a random id kept in AsyncStorage, the app's version of the
browser's localStorage id. Accounts are future work (see below).

## Sharing code with the browser game

`src/shared.ts` re-exports the plain-JS modules that the server and browser
already share: `lib/terrain`, `lib/ground`, `lib/survival`, `lib/appearance`,
`world/motion`, and `arcade/ascii3d/{navigation,prediction,controls,demo}`.
They're imported through the `@site/*` alias, which maps to `../../src/*`.
Expo's Metro honours tsconfig `paths`, and `metro.config.js` watches
`src/` and `convex/`. Any package a shared file imports is resolved from the
app's `node_modules`, never the root's React 18 install.

Rule: never copy game logic into the app. If the app needs a rule, it imports it
from the shared module, or the rule moves into one.

### The shared input map and game rules

Both landed (`commons-polish/gameplay` and `commons-polish/ux`) and the app
uses them:

- **Action names, default keys and the controller layout** come from
  `src/arcade/commons/input/actions.js` and `gamepad.js` via `shared.ts`. The
  keyboard source looks keys up in the browser's `DEFAULT_KEYS`; the gamepad
  source runs the browser's `createPadReader` and `PAD_LAYOUT`. A new default
  key or a remapped button in the browser reaches the app with no app change.
- `input/types.ts` spells the action names out so the compiler can check them.
  `input/actions.test.ts` fails if the browser adds or renames one, so the app
  is updated on purpose instead of silently ignoring a button.
  `input/gamepad.test.ts` presses every button in every layer and checks the
  app hears what `PAD_LAYOUT` says.
- **Quests, recipes, items and the day cycle** (`lib/game`, `lib/survival`) feed
  the HUD through `hud/model.ts`. The app has no rules of its own.

What is still the app's own: `run` (hold Shift / long Play-Pause) and the menu
steps (`navUp`…), which the browser handles with DOM focus instead. Some of
the browser's actions do nothing in the app yet (the camera, map, character
sheet, first person, full screen, raw render, sound).

## Input

Each device reports into one `InputHub` (`src/input/hub.ts`) as a screen-space
move axis plus held and pressed actions. The game and menus read only from the
hub.

| Device | Source | Notes |
| --- | --- | --- |
| Keyboard (web) | `keyboard.ts` | The browser's key table: WASD/arrows walk, Space act, E eat, G dig, B wall, Tab/C craft, I pack, J journal, L claim a finished task, Enter/T talk, Esc menu, Backspace back. Shift runs. Ignored while the chat box has focus |
| Gamepad (web) | `gamepad.ts` | The browser's controller layout (`PAD_LAYOUT`), by layer: walking, building, dead, menu. In the world: left stick walks, A or RT acts, LT digs, X builds a wall, Y crafts, d-pad eat/drink/journal/help, Start or B opens the pause menu (in the browser B only closes an open window; the app has none open in the world). In a menu: d-pad or stick steps, A confirms, B or Start backs out, the bumpers switch panels. With several pads, the first one touched is used until it is unplugged |
| Siri Remote, Android TV remote, controllers on TV | `tvRemote.ts` + `tvEvents.ts` | react-native-tvos TV events. Select acts, Play/Pause digs, a held Select builds a wall, Menu (Back on Android TV) pauses; the pause menu opens Craft, Pack and Journal. Running: a held Play/Pause on Apple TV, a held direction on Android TV |
| Touch (phones, tablets) | `TouchStick.tsx` + buttons in `GameScreen` | Drag-anywhere thumbstick; Act, Dig, Wall, Eat on the right; Craft, Pack, II along the top; Talk opens chat |

With the fork's default settings both TVs send TV events the same way, and
`tvEvents.ts` reads them (`tvRemote.test.ts` replays the real sequences; the
Android ones go through a port of the fork's Android key handling, fed raw
key-down, repeat and key-up events):

- **Short presses** send one key-up and no key-down. On tvOS they come from
  tap recognizers. On Android TV, `ReactAndroidHWInputDeviceHelper` sends
  key-downs only when the native flag `ReactFeatureFlags.enableKeyDownEvents`
  is on; it's off by default and the app leaves it off. A lone key-up counts
  as a whole tap: an arrow is held for 250 ms (about one tile), and a button
  presses once.
- **Holds** arrive as the fork's long events (`longUp`, `longSelect`, …): one
  key-down when the hold is recognised, one key-up on release, held in
  between. On tvOS a long-press recognizer starts them after 0.5 s. On
  Android TV the fork's detector starts them at the first key repeat more
  than 300 ms after the key went down, which in practice is Android's first
  auto-repeat (its key-repeat timeout, 400 ms by default on current Android,
  500 ms on older versions). Until then a held key sends nothing.
- **Play/Pause hold** exists only on tvOS (`longPlayPause`), where it runs.
  The fork's Android detector covers only Select and the d-pad, so a held
  Play/Pause on Android TV sends a single key-up on release, the same as a
  tap, and digs. On Android TV a held direction runs instead (`holdRuns`).
- **Swipes** on the Siri Remote touch surface carry no key action and count as
  taps.
- **Select** on tvOS only reaches JS from a focused view, so during play the game
  screen keeps one full-screen focusable.

Menus (`ui/Menu.tsx`) and the HUD panels share `ui/useListNav.ts`: on TV
every item is a native focusable, so the platform focus engine handles the
d-pad and select. On web and phones, items respond to touch and click, and
the hub moves the highlight for keyboards and gamepads. The hub's context is
`menu` on the title and Controls screens and whenever anything is open over
the world (`padContext` in `game/press.ts`), so a controller uses its menu
layout there.

Back (`input/back.ts`) goes up one level and leaves the app only from the
title screen:

| Where | Apple TV Menu, Android Back, Esc or Backspace, pad B/Start |
| --- | --- |
| Title | leaves the app (nothing claims it) |
| Controls | back to the title |
| In the world | opens the pause menu (`game/press.ts`) |
| Pause menu | resumes |
| Controls, from the pause menu | back to the pause menu |
| Craft, Pack or Journal | closes it |

On Apple TV, the Menu button only reaches the app while claimed
(`claimMenuKey`, counted so the pause menu letting go doesn't release the
world's claim). Android's Back reaches JS only through `BackHandler`, newest
listener first. A menu or list that handles a press consumes it
(`hub.onPress` returning true), so the press that closes the pause menu
doesn't also reach the world and reopen it, and Esc that closes a panel
doesn't then open the pause menu. For the same reason Menu on a TV remote
sends `pause` alone.

## Running it

Requires Node 24. Run everything from `apps/commons/`.

```sh
npm ci                      # .npmrc sets legacy-peer-deps; postinstall applies patches/
npm test                    # vitest: input, walking, actions, HUD data, render loop
npm run typecheck           # tsc; needs ../../convex/_generated (npx convex dev at root,
                            # or npm run types:convex offline)
npx expo-doctor

# Browser
npm run web                 # dev server
npm run build:web           # static export to dist/

# iPhone / iPad / Android phone (development build, not Expo Go)
npm run prebuild:mobile     # expo prebuild --clean
npm run ios                 # expo run:ios  (simulator or --device)
npm run android             # expo run:android

# Apple TV / Android TV
npm run prebuild:tv         # EXPO_TV=1 expo prebuild --clean
EXPO_TV=1 npx expo run:ios --device "Apple TV"
EXPO_TV=1 npx expo run:android   # with an Android TV emulator running
```

On a simulator with no remote or keyboard attached, start Metro with
`EXPO_PUBLIC_AUTOPLAY=1` (development builds only) to skip the title screen.
`commons://play` opens the world too, but iOS and tvOS first ask "Open in
The Commons?", which needs a press.

CI (`.github/workflows/validate.yml`, job `commons-app`) installs the root
and the app, writes the `convex/_generated` stand-in
(`scripts/stub-convex-generated.cjs`, as `npm run types:convex` does), then
runs `npm run typecheck`, `npm test` and the web export. A second job,
`backend`, uses the same stand-in to typecheck `convex/` and run the root
Convex tests. No secrets, no deployment.

`ios/` and `android/` are generated (continuous native generation) and
gitignored. Configure native behaviour in `app.json` and config plugins.
Switching between phone and TV needs a fresh `prebuild --clean`.

### The expo-gl patch (Apple TV)

`expo-gl` 58 declares only iOS, so CocoaPods won't install it into a tvOS
target. Its renderer only uses OpenGL ES 3 and EAGL. tvOS still ships both,
though deprecated. `patches/expo-gl+58.0.3.patch` (applied by
`patch-package` on install) does two things:

- adds `:tvos => '16.4'` to `ExpoGL.podspec`;
- compiles out the camera-texture feature on tvOS, because `AVCapture` session
  properties and video orientation don't exist there. On tvOS,
  `createCameraTextureAsync` now rejects. The game never uses camera textures.

When `expo-gl` is upgraded, `patch-package` fails loudly if the patch no longer
applies. Re-create it, or drop it if upstream adds tvOS.

Risk: Apple deprecated OpenGL ES in 2018 and could remove it from a future
tvOS or iOS SDK. Moving off GL entirely would mean three's `WebGPURenderer`
through `react-native-wgpu` (Metal on Apple, Vulkan on Android). That keeps
`world/scene.ts` and the shared modules, and replaces `World3D.tsx`'s context
setup. It's a larger change, with less mature tvOS support in
`react-native-wgpu`, and isn't needed while GL ships.

### Installing

`react-native-tvos` publishes prerelease versions (`0.88.0-0`), which never
satisfy semver peer ranges such as `>=0.78`, so strict peer resolution rejects
almost every React Native library. `apps/commons/.npmrc` sets
`legacy-peer-deps=true`, the same switch the root uses for a different reason.

## Verified so far

Evidence for the native runs (commands, log excerpts, screenshots) is in
`apps/commons/docs/evidence/`. Anything not listed there wasn't run.

- **This branch (2026-11-02), after merging `main`'s app work (native HUD,
  shared input map, walking/actions modules) with this branch's input and Back
  fixes:** `npm test` (117 tests: TV event sequences for tvOS and, through a
  port of the fork's Android key handling, Android TV; Back on Apple TV,
  Android and keyboard through the real Menu; every controller button in
  every layer against the shared layout; controller B and Start pausing the
  world through the press router; controller choice and disconnect; walking,
  actions and the HUD model; GPU resources freed as figures leave and on
  teardown; render loop resize and context restore), `npm run typecheck`
  against the offline `convex/_generated`, and the web export pass. CI runs
  all three. Nothing else was run on this state: the HUD, the panels and chat
  have not been looked at in a browser, on a simulator or on a device.
- **iOS (2026-11-02, Xcode 27.2), from commit `f58e517`, before the merge
  above:** phone prebuild and an `iphonesimulator` Debug build succeed. On an
  iPhone 18 Pro simulator (iOS 27.0), the title menu shows, a tap on Play
  opens the three.js world through expo-gl (the earlier HUD, touch stick,
  Gather/Dig/Wall), and a tap on II opens the pause menu. The taps were
  simulated touches; walking with the stick wasn't exercised. Three
  screenshots are in the evidence folder.
- **Apple TV: not built.** With Xcode 27.2 (Swift 6.4.2) the
  `appletvsimulator` build fails twice in a row: the Swift compiler crashes
  compiling Expo's `ExpoModulesCore` for tvOS, before any app code (log in the
  evidence folder). No Apple TV build has succeeded with a kept log, so
  whether the app builds and renders on tvOS is unconfirmed. Remote input on
  tvOS is covered only by the event-replay tests.
- **Android and Android TV:** not run (no Android SDK on the build Mac).
  Android TV remote handling and Back are covered only by tests: the remote
  through a port of the fork's Android key handling, Back through a mocked
  `BackHandler`.
- **Hardware:** nothing has run on a real device, remote or controller.
- Root `npm run test:commons` (229 tests), `CI=true npm test` (169), and
  `CI=true npm run build:frontend` pass.

## Known gaps and risks

- **Apple TV builds.** Xcode 27.2's Swift compiler crashes on Expo's
  `ExpoModulesCore` for tvOS (see Verified so far). Until Expo or Xcode fixes
  it, building for Apple TV needs an older Xcode. Nothing has been tested on
  a real Apple TV: frame rate, the Siri Remote, a paired controller.
- **Analog sticks on native.** On TV, controllers arrive as d-pad and button
  events through react-native-tvos, so walking is 8-way digital. Phones with a
  paired controller get nothing yet. Both need a native GameController
  (iOS/tvOS) and InputDevice (Android) module feeding `InputHub` as another
  source.
- **Renderer.** A plain lit 3D view, not the browser's ASCII pass. The HUD now
  has vitals, the quest tracker, craft / pack / journal, and chat, but no
  nametags, minimap, build ghost, character creator or the rest of the
  browser's sheets. Building is a single wall in front of you.
- **Chat on TV.** TVs can read chat but not type. Canned phrases or voice would
  fix that.
- **Identity.** Sessions are anonymous per install, as in the browser. Moving a
  character between devices needs accounts (Convex Auth, with Sign in with
  Apple required on iOS if any third-party login is offered).
- **Tests.** Vitest covers the input sources, Back through the real Menu,
  press routing, walking, action dispatch and the HUD model (117 tests). The
  other React components and `GameScreen`'s wiring have no tests, and nothing
  here has been exercised on a real device.
- **Not seen running since the HUD work.** The web export builds and the code
  typechecks, but the HUD and panels were not looked at in a browser or on a
  simulator when they were written (the dev host lacked the libraries a
  headless browser needs), nor since this branch merged them with its input
  and Back fixes. Do that first.

## Release prerequisites

Nothing has been uploaded. Before any store build:

- **Accounts.** Apple Developer Program (one membership covers iOS and tvOS),
  Google Play Console, and an Expo account for EAS.
- **Identifiers.** `com.jrbussard.commons` is set for iOS and Android in
  `app.json`. Register the bundle id in App Store Connect and create the Play
  app.
- **EAS.** `eas.json` has `development`, `preview` and `production` profiles
  plus `*_tv` variants that set `EXPO_TV=1`; nothing has been built with it.
  tvOS needs its own
  provisioning profile created by hand in the Apple portal, because EAS doesn't
  create one. Use local credentials for tvOS if iOS credentials are in EAS.
- **Assets.** App icons and splash, plus the Apple TV layered icons and
  top-shelf images (`@react-native-tvos/config-tv` `appleTVImages`), and the
  Android TV banner (`androidTVBanner`). The current icons are Expo
  placeholders.
- **Store listings.** Privacy policy URL, App Privacy answers (an anonymous
  session id and chat text are stored on Convex), age rating (user chat means
  user-generated content, which needs report and block tools for App Review
  guideline 1.2), screenshots per device class including Apple TV, and the
  Play data safety form.
- **Controllers.** Apple TV games must be playable with the Siri Remote alone
  unless they declare a controller requirement. Keep remote play working.
  `GCSupportsControllerUserInteraction` is already set.
- **Encryption.** `ITSAppUsesNonExemptEncryption` is false (HTTPS only).

## What comes next

1. Look at it: web, an iOS simulator, an Android emulator, then a real Apple TV
   with the Siri Remote and a controller. Fix whatever the new HUD gets wrong.
2. Native controller module and analog movement.
3. The rest of the browser's panels as native UI, with focus order designed for
   TV: nametags, minimap, character creator, build menu with a ghost, projects.
4. Accounts, then `eas build --profile preview` (and `preview_tv`) for a
   TestFlight / internal build when asked. `eas.json` is written; nothing has
   been built or uploaded.
