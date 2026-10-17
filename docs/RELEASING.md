# Releasing IVE

IVE ships from one repository to three stores of truth:

| Platform | What you ship | Built by |
| --- | --- | --- |
| macOS 12+ | `IVE-<version>-mac-<arch>.dmg` (signed + notarized) | `electron-builder` on `macos-14` |
| Windows 10/11 | `IVE-<version>-win-<arch>.exe` (NSIS, per-user) | `electron-builder` on `windows-latest` |
| Android 10+ (API 29) | `IVE-<version>-android.apk` + `.aab` | Gradle on `ubuntu-latest` |

All three are attached to one GitHub Release by `ci/release.yml`.

## 1. Bump the version

Three files must agree — the app has three packaging systems, so there is no
single source of truth:

```bash
node scripts/bump-version.mjs 1.0.1     # package.json + android/app/build.gradle.kts + README badge
```

If you prefer to do it by hand: `version` in `package.json`,
`versionName`/`versionCode` in `android/app/build.gradle.kts` (bump
`versionCode` by one every upload), and `.ive-version` used by the demo build.

## 2. Local builds (no CI)

```bash
npm ci
npm run dist:mac            # → release/IVE-1.0.0-mac-arm64.dmg (+ zip), macOS only
npm run dist:win            # Windows host: NSIS + Authenticode
npm run dist:win:nsis       # any host with makensis, no Wine (see below)
cd android && ./gradlew assembleRelease bundleRelease
```

### Building the Windows installer on Linux or macOS

`electron-builder --win nsis` shells out to Wine to stamp its uninstaller, which
is why the plain `dist:win` script is Windows-only. IVE ships its own
`native/win/installer.nsi`, so the installer can be compiled straight from the
app directory:

```bash
npm run dist:win:dir        # electron-builder packages release/win-unpacked
npm run dist:win:nsis       # makensis (bundled with electron-builder) → .exe
```

No Wine, no Windows, no admin: the result is a per-user NSIS installer with a
Start-menu shortcut, an Add/Remove Programs entry and a working uninstaller.
The trade-off is that `IVE.exe` keeps Electron's stock icon and version
resource, because stamping those needs `rcedit` under Wine. Build on Windows
when you want the icon and Authenticode signature.

Unsigned builds are fine for testing. They will show Gatekeeper / SmartScreen
warnings on other people's machines — sign before you distribute.

## 3. CI release

```bash
git tag v1.0.1
git push origin v1.0.1
```

`release.yml` then:

1. builds the macOS app for **arm64 and x64**, plus a universal `fn-listener`
   binary (Swift, ad-hoc signed so the Accessibility grant survives upgrades);
2. builds the Windows installers for **x64 and arm64**;
3. builds the signed Android **APK** and **AAB**;
4. uploads everything to a **draft** GitHub Release and attaches `SHA256SUMS.txt`;
5. publishes the release once you flip the draft (or run the workflow with
   `draft=false`).

## 4. Signing

### macOS

1. Create a **Developer ID Application** certificate in the Apple Developer
   portal, export it as `.p12`.
2. `base64 -i cert.p12 | pbcopy` → repository secret `CSC_LINK`; password →
   `CSC_KEY_PASSWORD`.
3. Create an app-specific password at appleid.apple.com → secrets `APPLE_ID`,
   `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
4. Set `"notarize": true` in the `mac` block of `package.json`.

Hardened Runtime is already on, with `build/entitlements.mac.plist` granting
only what IVE actually uses: Apple Events (app automation), screen capture,
microphone, and JIT for Electron's renderer.

Verify locally:

```bash
codesign --verify --deep --strict --verbose=2 "release/mac-arm64/IVE.app"
spctl -a -vvv -t install "release/mac-arm64/IVE.app"     # → accepted, source=Notarized Developer ID
```

### Windows

Buy an OV/EV code-signing certificate (or use Azure Trusted Signing). Export to
`.pfx`, base64 it into `WIN_CSC_LINK`, password into `WIN_CSC_KEY_PASSWORD`.
electron-builder signs the `.exe` and the installer, and stamps the NSIS
uninstaller.

`requestedExecutionLevel` is `asInvoker`: IVE never asks for admin. Its gesture
hook is a user-level PowerShell process (`native/win/gesture-hook.ps1`), not a
service — nothing is installed system-wide.

### Android

Play Store uploads need an AAB signed with your **upload key**:

```bash
keytool -genkeypair -v -keystore android/release.keystore -alias ive \
  -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 android/release.keystore     # → ANDROID_KEYSTORE_B64
```

Add the four Android secrets, and CI signs automatically. Locally, create
`android/keystore.properties`:

```properties
storeFile=release.keystore
storePassword=…
keyAlias=ive
keyPassword=…
```

`android/keystore.properties` and `*.keystore` are git-ignored.

## 5. Store notes

**Mac App Store** — not supported. IVE uses Accessibility APIs, Apple Events,
and global gestures that the sandbox forbids. Ship the DMG.

**Microsoft Store** — possible later via `.msix` (`electron-builder --win msix`);
the NSIS installer is the supported path today.

**Google Play** — upload the `.aab`. IVE asks for `SYSTEM_ALERT_WINDOW`
(draw-over-apps), notification access, and `QUERY_ALL_PACKAGES` for the app
launcher tool. Play requires a short declaration for each; the in-app copy in
`MainActivity` explains every one before it is requested.

## 6. Update feeds

`electron-updater` reads `latest-mac.yml` / `latest.yml` from the GitHub
Release. Because IVE ships `LSUIElement` (no Dock icon), updates surface as a
quiet row in the notch → *Settings → Updates*, never a modal.

Android updates are manual (Play handles them once published): the Settings tab
links to the release page.

## 7. Rollback

Releases are immutable; to roll back, publish a new patch with the previous
commit:

```bash
git revert <bad-commit>
node scripts/bump-version.mjs 1.0.2
git tag v1.0.2 && git push origin v1.0.2
```

Desktop clients on the broken build will pull the new `latest.yml` on next
launch.
