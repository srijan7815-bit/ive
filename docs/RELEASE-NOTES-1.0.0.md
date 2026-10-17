# IVE 1.0.0

The first release that ships **three apps from one repository**.

## Download

| Platform | Asset | State |
| --- | --- | --- |
| Windows 10/11 (x64) | `IVE-1.0.0-win-x64.exe` | ready, unsigned |
| Android 10+ (API 29) | `IVE-1.0.0-android.apk` | ready, signed |
| Android — Play upload | `IVE-1.0.0-android.aab` | ready, signed with the IVE upload key |
| macOS 13+ (arm64 + Intel) | built by `ci/release.yml` | needs a Mac or one workflow file |

`SHA256SUMS.txt` covers everything above.

**macOS:** the DMG is produced by the `release` workflow because the `fn`
helper has to be compiled with `swiftc` and the app has to be signed and
notarized on a Mac. Copy `ci/release.yml` into `.github/workflows/` (GitHub →
*Add file → Create new file*), then push a tag — details in
[docs/RELEASING.md](RELEASING.md).

**Windows:** the installer is not Authenticode-signed yet, so SmartScreen will
say "unrecognised app" → *More info → Run anyway*. It installs per-user, never
asks for admin, and leaves `%APPDATA%\IVE` alone on uninstall.

## Windows 10/11 · `.exe` (x64)

- Same app as macOS, native window behaviour: a 660×760 top-centred transparent
  overlay per monitor, tray icon, no taskbar entry.
- **`Ctrl`+`Alt` + right-drag** opens the glass composer (low-level PowerShell
  mouse hook — no driver, no service, no admin).
- Automation runs through PowerShell instead of AppleScript; same tools, same
  rails: 24 tools, a denylist, a write fence, an approval matrix.
- Per-user NSIS installer: Start-menu shortcut, Add/Remove Programs entry,
  clean uninstall, launch-after-install.

## Android 10+ · `.apk` / `.aab`

A native Kotlin + Compose rewrite of the same idea, because a phone has no
menu bar:

- A floating pill at the top of the screen, drawn over other apps.
- Long-press → the pill morphs into a composer; send → it folds back and the
  work happens in the background.
- When IVE needs a decision the pill expands into a card with real buttons.
- Music card driven by the system's own media sessions; clock; settings.
- Tools are fenced to the app's storage and `Downloads`; app launches and
  clipboard access always ask.
- API key is AES/GCM-encrypted with a hardware-backed Android Keystore key.
- 2.35 MB download (R8, resource shrinking), minSdk 29, targetSdk 34.

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

## Under the hood

- `src/main/platform/` — one capability contract, three implementations.
- `electron-updater`, lazily loaded and only inside a packaged app.
- Universal `fn-listener` binary (arm64 + x86_64) built on CI.
- 5 headless test suites (`npm test`) plus browser interaction tests for the
  offline demo.
- `npm run dist:win:nsis` compiles the Windows installer with the bundled
  makensis — no Wine, so Linux and macOS can produce it too.

## Known limits

- Windows and Android have had far less real-world use than macOS. Report
  anything that smells.
- The Mac App Store is not supported (Accessibility + Apple Events + global
  gestures are sandbox-incompatible). Use the DMG.
- Google Play requires declarations for draw-over-apps, notification access and
  `QUERY_ALL_PACKAGES`; the AAB is ready, the listing is yours to write.
- Windows build in this release is unsigned; add `WIN_CSC_LINK` /
  `WIN_CSC_KEY_PASSWORD` to have CI sign the next one.
