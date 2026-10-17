# IVE — architecture

IVE is one design, three implementations of the same idea. The macOS and
Windows apps are Electron and share ~95% of their code; Android is a native
Kotlin/Compose build (see [ANDROID.md](ANDROID.md)).

Everything that differs per OS lives behind `src/main/platform/`:

| capability | darwin | win32 | linux |
| --- | --- | --- | --- |
| open gesture | `fn` + right-drag (Swift tap) | `Ctrl+Alt` + right-drag (PowerShell hook) | `⌘⇧Space` only |
| notch geometry | menu-bar island, per display | 660×760 top overlay, per display | 660×760 top overlay |
| automation | AppleScript / `osascript` | PowerShell / Win32 UI Automation | `xdotool` if present |
| music | Music.app + Spotify via AppleScript | System media sessions (GSMTC) | MPRIS |
| updates | `electron-updater` | `electron-updater` | `electron-updater` |

If a capability is missing, the platform object says so (`platform.capabilities`)
and the renderer hides the affected control instead of failing at call time.

## macOS

Three small programs wearing one name:

```
┌─────────────────────────────────────────────────────────────────────┐
│ macOS                                                               │
│                                                                     │
│  fn-listener (Swift)        IVE.app (Electron)                      │
│  ┌────────────────┐   NDJSON  ┌───────────────────────────────────┐ │
│  │ CGEventTap     │──────────►│ main process                      │ │
│  │ fn + right     │           │  gesture router · agent loop      │ │
│  │ swallows menu  │           │  tools · safety · music · config  │ │
│  └────────────────┘           └───────┬───────────────┬───────────┘ │
│                                       │ IPC           │ IPC       │
│                             ┌─────────▼──────┐ ┌──────▼─────────┐  │
│                             │ notch window   │ │ overlay windows │  │
│                             │ (pill/panel/   │ │ (glass composer │  │
│                             │  alert)        │ │  per display)   │  │
│                             └────────────────┘ └────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## 1. The gesture layer — `native/fn-listener`

A 120-line Swift program creates a `CGEventTap` at `cgSessionEventTap` for four event kinds: `flagsChanged`, `rightMouseDown/Dragged/Up`.

- On `flagsChanged` it watches `maskSecondaryFn` and reports `{"t":"fn","down":…}`.
- Right-button events are **passed through unless fn is held**. While fn is held the events are swallowed (the callback returns `nil`), so the foreground app never sees a context menu.
- Everything is newline-delimited JSON on stdout. Electron spawns it and reads lines.

Why a separate binary and not a native Node module?

- No `node-gyp`, no ABI pinning to Electron.
- Runs at the same trust level as any helper; Accessibility can be granted to IVE.app and inherited by the child.
- It keeps working if the renderer restarts.

Build: `npm run build:fn` → `native/fn-listener/.build/fn-listener` (and copied into `IVE.app/Contents/Resources/bin` when packaged).

Fallbacks: if the helper is missing or denies permission, IVE registers `⌘⇧Space` (global shortcut) and the compose button in the notch still works.

## 2. Window layer — `src/main/windows.js`

| window | count | size | mouse | focus |
|---|---|---|---|---|
| notch | 1, primary display | 660 × 760 at top-centre | click-through except the pill / open panel (`setInteractive`) | only `focus()` when panel opens — and focus is restored to your previous app on close |
| overlay | one per display | display bounds | the OS does not hit-test click-through windows, so no stray clicks reach your app while drawing | `showInactive` for selection, `focus()` only when composing (you must type) |

Both are `transparent`, `frameless`, `alwaysOnTop` (`screen-saver` level for the notch so it floats over full-screen apps, `pop-up-menu` for overlays), `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`.

Because the user's previous app is tracked every 2.5 s (`frontmostApp`), `restoreFocus()` hands the frontmost role back after the composer closes — that's the "nothing changes on screen" feeling.

## 3. Gesture state machine

`src/main/main.js` keeps a single `S.gesture` while a draw is in flight and mirrors it into the overlay renderer:

```
fn helper ──right down──► show overlay at cursor, remember start point
        ──right drag───► selection:move   (overlay animates a rect + droplets)
        ──right up─────► selection:end    (overlay blooms into the composer card)
                                 │
                      composer submit / cancel
                                 ▼
                    hide overlays → restore previous app focus
```

The overlay's own renderer state (`src/renderer/overlay/app.js`):

```
idle → dragging → composing → sending → (idle)
           └────────┴─ closing (esc / click-away) ─┘
```

Motion is integrated per-frame (semi-implicit Euler spring, k=200…340, damping 24…34) rather than CSS-transitioned, so the rectangle carries momentum and overshoots slightly — the "liquid" part. A wobbling border-radius (`rotate`-free asymmetric radii) and three lagged droplet springs behind the cursor sell the fluidity. A dashed SVG thread connects the card back to the notch while composing.

Glass: the overlay window is transparent + `backdrop-filter: blur(26px) saturate(1.7)` — real backdrop-filter, not a screenshot — with a screenshot fallback layer (`captureGlass`) for displays where the compositor won't blur, plus tint, aurora conic gradient, caustic sheen and SVG grain.

## 4. Notch state machine — `src/renderer/notch/app.js`

```
collapsed ──hover──► hover ──click──► panel ⇄ alert
     ▲                  │               │       │
     └──────leave───────┘      esc/close└───────┘ answer / dismiss / 11s idle
```

- The island is one element; only `width`/`height`/`border-radius` change (0.52 s spring). A "morphing" class blooms two blurred blobs at the bottom edge during the transition, and a sheen sweeps once on open.
- Panels are absolutely positioned inside the island and only fade/slide; the island's size is driven by JS so each tab can have its own height.
- Alerts are **measured after the morph settles** (`offsetTop + scrollHeight`) so a permission card with a code detail block always fits.
- While an alert is pending and the panel is open, the same permission renders **inline** above the log; answering either place resolves the same promise.

## 5. Agent loop — `src/main/ai/agent.js`

```
ask() → queue → _drain()
  messages.append(user)
  loop up to maxSteps (24):
     provider.chat(system, messages, toolSchemas)
        ↳ tool calls?  executeTool() — may await requestChoice() (notch card)
                       messages.append(assistant.tool_calls) / tool results
        ↳ no tool calls → final one-line answer → 'done'
```

- Canonical message format is OpenAI's; Anthropic is adapted inside `providers.js` (tool_use / tool_result blocks, base64 images).
- `pendingImages` are attached to the next user turn if the provider supports vision (screenshots).
- Permission requests are promises stored in `S.pending`; the notch answers through IPC. Timeout (10 min) resolves to `timeout` and the tool reports denial.
- History persists to `electron-store` (`ive-history`), capped at 60 messages.

## 6. Tools & safety — `src/main/ai/tools.js`, `src/main/safety.js`

Each tool declares `risk`: `read | write | automation | network | shell`.
`autoApprove` in settings maps risk → allowed-without-asking. Shell commands matching a safe-command list run silently; everything else asks (unless explicitly enabled).

`checkCommand` is a **denylist that cannot be approved away**: sudo, `rm -rf /` and `rm -rf ~`, `mkfs`, `diskutil erase*`, `dd of=/dev/*`, fork bombs, shutdown/reboot, `curl … | sh`, permission sweeps on `/`, `launchctl` manipulation.

`checkWritePath` fences all file tools to `$HOME` + temp.

## 7. Music — `src/main/music.js`

Polls Music.app / Spotify with AppleScript every 3 s (cheap, no entitlements), normalises the track shape, and pushes only on change. Transport commands go straight to AppleScript. Artwork is a deterministic hue gradient from the track name — no network fetch, no flicker, and it always matches the aurora palette.

## 8. Persistence

| store | contents | file |
|---|---|---|
| `ive-config` | provider, model, autonomy, notch prefs | `~/Library/Application Support/IVE/ive-config.json` |
| `ive-log` | last 120 log entries | `…/ive-log.json` |
| `ive-history` | conversation (60 msgs) | `…/ive-history.json` |

The API key is stored as `enc:<base64>` using `safeStorage.encryptString` (Keychain) when available.

## Windows

`src/main/gesture-bridge.js` spawns `native/win/gesture-hook.ps1` — a
`RegisterHotKey`-free low-level mouse hook written in PowerShell (no native
module, no driver) that watches for `Ctrl+Alt` + right-button and emits the same
NDJSON as the Swift helper. Window geometry is identical (a 660×760 top-centred
transparent overlay per monitor); the tray icon is `assets/tray-win.png` and the
app runs without a taskbar button.

Automation goes through a small PowerShell surface: window enumeration
(`Get-Process | Where MainWindowHandle`), keystrokes (`SendKeys`), clipboard,
and `Start-Process` for app launches. The same risk matrix and denylist apply.

## Release

```bash
npm run icons && npm run build:fn
npm run dist:mac           # .dmg + .zip, arm64 + x64 → release/
npm run dist:win           # NSIS x64 + arm64            → release/
cd android && ./gradlew assembleRelease bundleRelease
```

CI (`.github/workflows/{build,release,android}.yml`, parked in `ci/`) builds all
three on a tag and publishes one GitHub Release. Signing, notarization, store
uploads and rollback are covered in [RELEASING.md](RELEASING.md).

## File map

```
src/main/          main.js · windows.js · gesture-bridge.js · music.js · updates.js
                   logger.js · safety.js · shell.js · config.js
src/main/platform/ index.js · darwin.js · win32.js · linux.js
src/main/ai/       agent.js · providers.js · tools.js
src/preload/       index.js            (the only bridge into the renderers)
src/renderer/notch  index.html · styles.css · app.js
src/renderer/overlay index.html · styles.css · app.js
native/fn-listener  main.swift          (macOS gesture tap)
native/win/        gesture-hook.ps1 · installer.nsi (Windows gesture hook + installer)
android/           Kotlin + Compose app: overlay, agent, tools, media
demo/              template.html · mock-*.js → demo/index.html (built)
scripts/           build-demo.mjs · screenshot.mjs · make-icons.py
                   build-fn-listener.sh · bump-version.mjs
ci/                build.yml · release.yml · android.yml (copy into .github/workflows)
```
