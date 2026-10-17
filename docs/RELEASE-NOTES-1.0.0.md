# IVE 1.0.0

The first release that ships **three apps from one repository**.

## macOS 13+ · `.dmg` (Apple silicon + Intel)

- The notch: a 216×34 pill at the top of the screen that breathes on hover,
  holds a clock, and shows a live audio meter while music plays.
- **`fn` + right-drag** anywhere opens the liquid-glass composer; `↵` sends it
  and the glass dissolves back into the notch. Your app never loses focus.
- Permission and choice cards grow out of the notch with buttons; answer and it
  folds away silently.
- 24 tools, one denylist, one write fence, one approval matrix.
- Apple Music and Spotify in the music tab, with a real scrubber and queue.
- Updates arrive through the notch (`Settings → Updates`), never a dialog.

## Windows 10/11 · `.exe` (x64, ARM64)

- Same app, native window behaviour: top-centred 660×760 transparent overlay
  per monitor, tray icon, no taskbar entry.
- **`Ctrl`+`Alt` + right-drag** is the gesture (a low-level PowerShell mouse hook
  — no driver, no service, no admin).
- Automation runs through PowerShell instead of AppleScript; the same tools,
  the same rails.

## Android 10+ · `.apk` / `.aab`

A native Kotlin + Compose rewrite of the same idea, because a phone has no menu
bar:

- A floating pill at the top of the screen, drawn over other apps.
- Long-press → the pill morphs into a composer; send → it folds back and the
  work happens in the background.
- When IVE needs a decision the pill expands into a card with real buttons.
- Music card driven by the system's own media sessions; clock; settings.
- Tools are fenced to the app's storage and `Downloads`; app launches and
  clipboard access always ask.
- API key is AES/GCM-encrypted with a hardware-backed Android Keystore key.

## Under the hood

- `src/main/platform/` — one capability contract, three implementations.
- `electron-updater` with a lazy, packaged-only load.
- Universal `fn-listener` binary (arm64 + x86_64) built on CI.
- 5 headless test suites (`npm test`), plus browser interaction tests for the
  offline demo.
- Release pipeline builds all three platforms and attaches checksums.

## Known limits

- Windows and Android have had far less real-world use than macOS. Report
  anything that smells.
- The Mac App Store is not supported (Accessibility + Apple Events + global
  gestures are sandbox-incompatible). Use the DMG.
- Google Play requires declarations for draw-over-apps, notification access and
  `QUERY_ALL_PACKAGES`; the AAB is ready, the listings are yours to write.
