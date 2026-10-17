# IVE for Android

The desktop app lives in a menu-bar notch. A phone has no menu bar — so IVE
moves to the one place every app already respects: **the top of the screen**.

```
┌──────────────────────────────┐
│  ●  09:41        ▮▮▮        │   ← collapsed notch, 34 dp, always on top
└──────────────────────────────┘
```

Long-press the pill and it morphs into a composer. Type a thought, hit send,
and put the phone down: the request runs in the background while the notch
quietly pulses mint. When IVE needs a decision, the pill expands into a card
with buttons — tap and it folds away.

## What it can actually do

| Tool | Risk | Notes |
| --- | --- | --- |
| `device_info` | read | model, Android version, battery |
| `list_files` / `read_file` | read | fenced to IVE storage + Downloads |
| `write_file` / `delete_path` | write | same fence, canonical-path checked |
| `list_apps` / `open_app` | automation | always asks first |
| `open_url` | network | http(s) only |
| `clipboard` | automation | read/write, asks first |
| `notifications` | read | recent notifications, requires access |
| `media` | read | status / play / pause / next / previous |
| `notify` | read | quiet notification |
| `ask_user` | read | 2–4 buttons, opens the notch alert |
| `web_fetch` | network | text extraction, 20k chars |

Android is a stricter machine than macOS, and IVE is deliberately smaller here
than on the desktop: no shell, no arbitrary filesystem, no silent app launches.
Anything outside the fence returns `Refused: …` to the model, which is told to
respect it.

## Architecture

```
IveApp ─┬─ Config      (SharedPreferences + Keystore AES/GCM for the key)
        ├─ History     (last 60 turns, internal storage)
        └─ IveRuntime ─┬─ Agent  (loop, 12 steps, streaming-free)
                       ├─ Tools  (11 tools, risk-tagged)
                       ├─ MediaHub  ← notification access → MediaController
                       └─ NotifHub  ← NotificationListenerService → ring buffer
NotchService ── WindowManager overlay + ComposeView (WRAP_CONTENT)
MainActivity ── onboarding, permissions, model config
QsTileService ── quick-settings tile
BootReceiver ── brings the notch back after reboot
```

### The overlay

One `TYPE_APPLICATION_OVERLAY` window with `WRAP_CONTENT` bounds. Compose
animates the surface's own width/height with springs, so the **window** grows
and shrinks with the notch — no second window, no per-frame `updateViewLayout`,
and the pixels around it stay touch-through.

The window is created `FLAG_NOT_FOCUSABLE` (so it never steals the keyboard).
Touching a text field flips the flag, focuses the window, and raises the IME;
blur restores it. `FLAG_WATCH_OUTSIDE_TOUCH` folds the panel when you tap
anywhere else in whatever app you were using.

Because the app ships `ComposeView` inside a `Service`, it carries its own
lifecycle, ViewModelStore and SavedState registry (`overlay/Owners.java`
attaches them — the setters are JVM-public but Kotlin-hidden in lifecycle 2.8).

### Music

`MediaSessionManager.getActiveSessions()` requires notification access, which
is exactly the grant needed to show a music card at all. IVE picks the session
that is actually playing, mirrors its metadata, and drives it through
`MediaController.TransportControls`. No audio is captured; nothing is proxied.

## Permissions, and why each one exists

| Permission | Why |
| --- | --- |
| Draw over other apps | the notch is an overlay; without it there is no product |
| Notification access | media sessions + "what did I miss" |
| Post notifications | the foreground service that keeps the notch alive |
| Battery unrestricted | stops Android from killing the overlay overnight |
| Query all packages | the `open_app` tool needs to resolve launcher activities |

Every one is requested from a short in-app explanation row, never at cold
start, and the app keeps working (minus the affected tool) if you decline.

## Build

```bash
cd android
./gradlew assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease        # unsigned until keystore.properties exists
./gradlew bundleRelease          # Play upload bundle
```

Toolchain: JDK 17, Android SDK 34, Gradle 8.7 (wrapper committed), AGP 8.5.2,
Kotlin 2.0.21, Compose BOM 2024.09.03, minSdk 29.

`gradle.properties` is tuned for 1 GB containers (`-Xmx560m`, one worker,
in-process Kotlin). On a normal laptop you can raise it for faster builds.

## Testing on a device

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n ai.ive.app.debug/ai.ive.app.MainActivity
adb logcat -s IVE:V AndroidRuntime:E
```

Then: grant draw-over-apps → *Turn on the notch* → long-press the pill. If the
composer does not appear, check that the overlay permission was granted **and**
that no other app is drawing a "screen overlay detected" block.
