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
    game/GameScreen.tsx  walking, server steps, actions, HUD, pause
    world/scene.ts    three.js scene: terrain, trees, rocks, builds, people
    world/World3D.tsx GL surface and render loop
    input/            InputHub and its sources
    ui/Menu.tsx       focus-aware menu
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
and the app's typecheck needs it there. Running the app doesn't.

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

### Integrating the sibling work (`game-rules`, input action map)

Two shared modules are being written in parallel and aren't in this branch:

- **game-rules** (from `commons-polish/gameplay`). Once it merges into
  `commons-polish/integration`, re-export what the app needs from
  `src/shared.ts` (`export * from '@site/<path to game-rules>'`). If it lives
  outside `src/` (for example a top-level `shared/` folder), add that folder to
  `watchFolders` in `metro.config.js` and a matching alias in `tsconfig.json`.
  It has to stay dependency-free plain JS or TS, as the current shared modules
  are.
- **input action map** (from `commons-polish/ux`). `apps/commons/src/input/types.ts`
  defines a placeholder `Action` union (`up/down/left/right/confirm/back`,
  `gather/dig/build/run/pause`). When the shared map lands:
  1. replace `Action` with the shared module's action type;
  2. have each source (`keyboard.ts`, `gamepad.ts`, `tvRemote.ts`, the touch
     buttons) look up bindings in the shared map instead of its own table;
  3. leave `InputHub` and its readers (`GameScreen`, `Menu`) unchanged. They
     only see actions and an axis.

Merge `commons-polish/integration` into this branch after both land, then do
the steps above in one follow-up PR.

## Input

Each device reports into one `InputHub` (`src/input/hub.ts`) as a screen-space
move axis plus held and pressed actions. The game and menus read only from the
hub.

| Device | Source | Notes |
| --- | --- | --- |
| Keyboard (web) | `keyboard.ts` | WASD/arrows, Shift run, E gather, F dig, B wall, Esc pause, Enter confirm |
| Gamepad (web) | `gamepad.ts` | Gamepad API standard mapping. Left stick or d-pad walks; A gather/confirm, B dig, X wall, Start pause, RT/L3 run |
| Siri Remote, Android TV remote, controllers on TV | `tvRemote.ts` | react-native-tvos TV events with key-down/up. Select gather, play/pause dig, long select wall, menu pause. The menu key is claimed only during play, so it still exits from the title screen |
| Touch (phones, tablets) | `TouchStick.tsx` + buttons in `GameScreen` | Drag-anywhere thumbstick, Gather/Dig/Wall buttons, II pause |

Menus (`ui/Menu.tsx`): on TV every item is a native focusable, so the platform
focus engine handles the d-pad and select. On web and phones, items respond to
touch and click, and the hub moves the highlight for keyboards and gamepads.

## Running it

Requires Node 24. Run everything from `apps/commons/`.

```sh
npm ci                      # .npmrc sets legacy-peer-deps
npm run typecheck           # tsc; needs ../../convex/_generated (npx convex dev at root)
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

`ios/` and `android/` are generated (continuous native generation) and
gitignored. Configure native behaviour in `app.json` and config plugins.
Switching between phone and TV needs a fresh `prebuild --clean`.

### Installing

`react-native-tvos` publishes prerelease versions (`0.88.0-0`), which never
satisfy semver peer ranges such as `>=0.78`, so strict peer resolution rejects
almost every React Native library. `apps/commons/.npmrc` sets
`legacy-peer-deps=true`, the same switch the root uses for a different reason.

## Verified so far

See the PR for the exact run log. In short:

- `npm run typecheck` and `npx expo-doctor` (20/20) pass.
- `npm run build:web` exports. In Chromium the offline world renders in 3D
  (terrain, trees, rocks, structures, other players), walks with WASD, and the
  menu responds to the keyboard.
- iOS: `expo prebuild --platform ios` generates the Xcode project
  (`TheCommons.xcodeproj`). The simulator build did **not** complete: the
  build machine ran out of disk (ENOSPC during `pod install` and the first
  compile), so nothing native has run yet. First job on a machine with
  ~10 GB free: `npm run prebuild:mobile && npm run ios`.
- Root `npm run test:commons` (54 tests) and `npm run build:frontend` still pass.

## Known gaps and risks

- **Apple TV 3D.** `expo-gl` 58 declares only iOS in its podspec, not tvOS.
  The TV prebuild and the menus should work, but the GL view can't link on
  tvOS as is. Options, in order of preference: (1) a small config plugin or
  patch that adds `:tvos` to `ExpoGL.podspec`, if its OpenGL ES code compiles
  for tvOS (OpenGL ES still ships on tvOS, deprecated); (2) a Metal or WebGPU
  path through `react-native-wgpu` and three's WebGPU renderer, which also
  removes the deprecated-GL dependency on iOS; (3) React Native Skia, which
  supports tvOS, as a 2.5D fallback. Not tried yet.
- **Analog sticks on native.** On TV, controllers arrive as d-pad and button
  events through react-native-tvos, so walking is 8-way digital. Phones with a
  paired controller get nothing yet. Both need a native GameController
  (iOS/tvOS) and InputDevice (Android) module feeding `InputHub` as another
  source.
- **Renderer.** This is a plain lit 3D view, not the browser's ASCII pass. No
  nametags, chat, inventory, crafting, building menu, or day/night beyond light
  intensity. The HUD is minimal.
- **Identity.** Sessions are anonymous per install, as in the browser. Moving a
  character between devices needs accounts (Convex Auth, with Sign in with
  Apple required on iOS if any third-party login is offered).
- **No automated tests in the app yet.** The shared modules are tested at the
  root. The app needs Jest (`jest-expo`) for the input hub and the
  walker/server-step glue.

## Release prerequisites

Nothing has been uploaded. Before any store build:

- **Accounts.** Apple Developer Program (one membership covers iOS and tvOS),
  Google Play Console, and an Expo account for EAS.
- **Identifiers.** `com.jrbussard.commons` is set for iOS and Android in
  `app.json`. Register the bundle id in App Store Connect and create the Play
  app.
- **EAS.** Add `eas.json` with `development`, `preview` and `production`
  profiles plus `*_tv` variants that set `EXPO_TV=1`. tvOS needs its own
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

1. Apple TV GL (see above), then screenshots on tvOS and Android TV emulators.
2. Native controller module and analog movement.
3. Fold in the shared game-rules and input action map once they merge.
4. Port the HUD panels (inventory, crafting, build menu, chat) as native UI,
   with focus order designed for TV.
5. Accounts, then EAS profiles and a TestFlight internal build when asked.
