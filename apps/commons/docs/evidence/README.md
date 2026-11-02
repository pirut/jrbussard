# Native run evidence, 2026-11-02

From commit `f58e517` on `commons-polish/app` (Android TV hold, Back
handling, figure disposal, shared pad layout). Mac with Xcode 27.2
(Build 27B52), Apple Swift 6.4.2. Run from `apps/commons/`.

## iOS simulator: built, ran, screenshots

```sh
CI=1 npx expo prebuild --clean --platform ios
xcodebuild -workspace ios/TheCommons.xcworkspace -scheme TheCommons \
  -configuration Debug -sdk iphonesimulator \
  -destination 'id=4ED9FB11-BC7E-4277-ACFC-93FE3F4FF516' \
  -derivedDataPath /tmp/commons-dd-ios build
CI=1 npx expo start --port 8081          # Metro, for the Debug build
```

The `.app` was installed on an iPhone 18 Pro simulator (iOS 27.0) and driven
through T3 Code's device tools (agent-device): launch, tap Play, tap II.

Log excerpt:

```
✔ Finished prebuild
✔ Installed CocoaPods
prebuild exit 0
CodeSign /tmp/commons-dd-ios/Build/Products/Debug-iphonesimulator/TheCommons.app (in target 'TheCommons' from project 'TheCommons')
Validate /tmp/commons-dd-ios/Build/Products/Debug-iphonesimulator/TheCommons.app (in target 'TheCommons' from project 'TheCommons')
** BUILD SUCCEEDED **
xcodebuild exit 0
Installed: com.jrbussard.commons
iOS Bundled 6769ms index.ts (835 modules)
```

| File | What it shows |
| --- | --- |
| `ios-iphone18pro-title.png` | Title menu (offline preview, no Convex URL set) |
| `ios-iphone18pro-world.png` | The three.js world through expo-gl: terrain, trees, rocks, structures, other players, HUD, touch stick, Gather/Dig/Wall |
| `ios-iphone18pro-pause.png` | Pause menu after a tap on II |

The taps were simulated touches from the device tool. Nobody touched a real
screen, and walking with the stick wasn't exercised.

## Apple TV simulator: build fails with this toolchain

```sh
EXPO_TV=1 CI=1 npx expo prebuild --clean --platform ios
xcodebuild -workspace ios/TheCommons.xcworkspace -scheme TheCommons \
  -configuration Debug -sdk appletvsimulator \
  -destination 'id=2D0BFAA9-9688-438A-9EC5-BB9F8D1BB2C6' \
  -derivedDataPath /tmp/commons-dd-tv build
```

Prebuild and `pod install` succeed. The build fails, twice in a row, because
the Swift compiler crashes while compiling Expo's `ExpoModulesCore` for
tvOS. The app's own code isn't reached. The same `ExpoModulesCore` source
compiles for the iPhone simulator with the same Xcode.

```
Please submit a bug report (https://swift.org/contributing/#reporting-bugs) and include the crash backtrace.
Stack dump:
1.	Apple Swift version 6.4.2 (swiftlang-6.4.2.1.9 clang-2100.4.1.1)
2.	Compiling with the current language version
3.	While evaluating request ASTLoweringRequest(Lowering AST to SIL for module ExpoModulesCore)
4.	While silgen visitDecl 'AsyncFunctionDefinition' (at <repo>/apps/commons/node_modules/expo/node_modules/expo-modules-core/ios/Core/Functions/AsyncFunctionDefinition.swift:25:8)
5.	While silgen emitFunction SIL function "@$s15ExpoModulesCore23AsyncFunctionDefinitionC5build10appContext0aB3JSI16JavaScriptObjectVAA03AppI0C_tKF".
Command SwiftCompile failed with a nonzero exit code
** BUILD FAILED **
xcodebuild exit 65
```

So there are no Apple TV screenshots in this run. Also, the device tools on
this Mac list only iPhone simulators, so the app couldn't have been driven on
an Apple TV simulator through them anyway.

## Not run

- Android, Android TV: no Android SDK command-line tools on this Mac.
- Real hardware of any kind: Apple TV, iPhone, Siri Remote, game controllers.
