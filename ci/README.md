# CI pipelines

GitHub only reads workflows from `.github/workflows/`. The token used to push
this repository does not have the `workflow` scope, so the files live here and
are copied into place by hand (or by a token that has `workflow`).

| File | Goes to | What it does |
| --- | --- | --- |
| `ci/build.yml` | `.github/workflows/build.yml` | syntax check, unit tests, offline demo build |
| `ci/release.yml` | `.github/workflows/release.yml` | signs and packages macOS + Windows + Android, publishes a GitHub Release |
| `ci/android.yml` | `.github/workflows/android.yml` | debug APK on every push/PR that touches `android/` |

## Install the workflows

**Web UI (no extra scopes):** GitHub → the `ive` repo → *Add file → Create new
file* → type `.github/workflows/release.yml` → paste the contents of
`ci/release.yml` → commit. Repeat for the other two.

**Or with a token that has `workflow`:**

```bash
mkdir -p .github/workflows
cp ci/build.yml ci/release.yml ci/android.yml .github/workflows/
git add .github/workflows && git commit -m "ci: enable workflows" && git push
```

## Cut a release

```bash
git tag v1.0.0
git push origin v1.0.0
```

The `release` workflow builds, signs (when secrets exist), and uploads
everything to a **draft** release. Check the artifacts, then hit *Publish* —
or re-run the workflow with `draft=false`.

Secrets are listed at the top of `ci/release.yml`. Nothing is required to get
unsigned builds; each secret you add upgrades a platform:

| Secret | Effect |
| --- | --- |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | Developer ID signs the macOS app |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | notarizes it (also flip `mac.notarize` to `true`) |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Authenticode-signs the Windows installers |
| `ANDROID_KEYSTORE_B64` + 3 friends | signs the APK/AAB with your upload key |

`ci/build.yml` is safe on forks and PRs: it only needs a Node toolchain.
