# Contributing to IVE

## Setup

```bash
npm install
npm run icons
npm run build:fn   # macOS only; skipped elsewhere
npm start
```

`npm run dev` opens DevTools on the notch. `IVE_DEMO=1` swaps the agent for a canned responder so you can work on UI without a key.

## The UI harness

The whole interface is testable without Electron:

```bash
npm run demo:build     # rebuilds demo/index.html and captures demo/frames/*.png
```

`scripts/screenshot.mjs` drives the real renderers in headless Chromium and writes the frames used in the README. If you change motion or layout, run it and look at the frames before opening a PR.

## Ground rules for the notch

- **Never steal focus silently.** If a change makes the notch or overlay take key window while you're typing elsewhere, it's a bug.
- **Springs over tweens.** Motion uses `cubic-bezier(.22,1.24,.36,1)` or the per-frame spring in `overlay/app.js`. No linear easings, no bounce libraries.
- **Two surfaces only.** The pill and the panel share one body; don't add a second window for UI.
- **Sizes are measured, not guessed.** Panel heights live in `PANEL_H`; alert height is measured after the morph.
- **One accent family.** Mint → blue → violet. Artwork hues are derived, not fetched.

## Tools & safety

Any new tool must declare a `risk` and go through `executeTool()`. Do not add capabilities that bypass `checkCommand` / `checkWritePath`. Commands that brick a machine belong in `safety.js`, not in a prompt.

## Commits

Conventional-ish: `notch: …`, `composer: …`, `agent: …`, `fn: …`, `docs: …`. Keep PRs focused.
