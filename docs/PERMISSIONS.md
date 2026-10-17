# IVE — macOS permissions

IVE is a small app with sharp tools. macOS will ask you for a few keys; here is exactly what each one unlocks and what breaks without it.

| Permission | Where | Needed for | If missing |
|---|---|---|---|
| **Accessibility** | Privacy & Security → Accessibility | `fn` + right-drag tap that swallows the context menu; `type_text`, `press_key`, `mouse_click`; window list | The `fn` gesture doesn't fire (use `⌘⇧Space`). Typing/clicking tools report an error. |
| **Input Monitoring** | Privacy & Security → Input Monitoring | Observing the `fn` key press itself | fn is never seen; gesture unavailable. |
| **Screen Recording** | Privacy & Security → Screen Recording | The true blur behind the glass composer; `screenshot` tool | Composer still looks fine (tint + screenshot fallback); screenshots fail. |
| **Automation** | prompts on first use | AppleScript control of Music, Spotify, Finder, apps, `trash_path` | Music panel can't read/control the player; app automation tools fail; the OS prompt may reappear per app. |
| **Notifications** | System Settings → Notifications | Optional native notifications (off by default — IVE prefers the notch) | Notifications are silently skipped. |

## Granting

1. Launch IVE.
2. Click the notch → **Settings → Permissions** and press **Open** next to each row; the matching System Settings pane opens.
3. Toggle **IVE** on (add it with `+` if needed).
4. Quit IVE completely (`⌘Q`, or Settings → Quit IVE) and relaunch — TCC grants only apply to a fresh process tree, and the `fn-listener` child must inherit it.

In development, run `npm start` and look for the helper status line in Settings → Permissions (`listening` = the tap is live).

## Resetting a stuck grant

Ad-hoc signed dev builds get a new code signature whenever the helper is rebuilt, so macOS may consider it a different program:

```bash
tccutil reset Accessibility ai.ive.app
tccutil reset ListenEvent ai.ive.app
tccutil reset ScreenCapture ai.ive.app
```

Then remove IVE from the lists with the `−` button, relaunch, and grant again. `npm run build:fn` re-signs the helper ad-hoc after every build, which keeps the grant stable in normal use.

## Notes on stealth

- The helper only **swallows** right-click events while `fn` is physically held. A normal right-click is untouched.
- IVE never takes keyboard focus for the composer until the card is open, and it hands focus back to your previous app when the card closes (`restoreFocus()`).
- The notch window is click-through except over the pill and an open panel, so it can't get in the way of menu-bar items next to it.
