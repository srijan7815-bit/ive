# CI

GitHub only accepts files under `.github/workflows/` from a token (or user) with the
**`workflow`** scope. This repo was pushed with a fine-grained token that lacks it, so the
pipeline is parked here.

## Enable it (30 seconds, no new token)

1. Open **Add file → Create new file** in the GitHub web UI.
2. Name it `.github/workflows/build.yml`.
3. Paste the contents of [`build.yml`](./build.yml), commit.

Or, from a terminal with a token that has `workflow` scope:

```bash
mkdir -p .github/workflows && git mv ci/build.yml .github/workflows/build.yml
git commit -m "ci: enable GitHub Actions" && git push
```

`build.yml` runs the unit suites, rebuilds the offline demo, and packages a
signed/unsigned macOS build on tags.
