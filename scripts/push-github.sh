#!/usr/bin/env bash
# Push IVE to GitHub.
#   ./scripts/push-github.sh                 → uses `gh` to create the repo (private by default)
#   ./scripts/push-github.sh --public        → create a public repo instead
#   ./scripts/push-github.sh --repo owner/name --remote git@github.com:owner/name.git
set -euo pipefail
cd "$(dirname "$0")/.."

VISIBILITY="--private"
REPO=""
REMOTE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --public) VISIBILITY="--public"; shift ;;
    --private) VISIBILITY="--private"; shift ;;
    --repo) REPO="$2"; shift 2 ;;
    --remote) REMOTE="$2"; shift 2 ;;
    *) echo "unknown flag: $1"; exit 1 ;;
  esac
done

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  git init -b main
fi

git add -A
if ! git diff --cached --quiet; then
  git commit -m "IVE — a living notch for macOS"
else
  echo "nothing new to commit"
fi

if [[ -n "$REMOTE" ]]; then
  git remote remove origin 2>/dev/null || true
  git remote add origin "$REMOTE"
elif ! git remote get-url origin >/dev/null 2>&1; then
  if command -v gh >/dev/null 2>&1; then
    gh auth status >/dev/null 2>&1 || { echo "Run: gh auth login"; exit 1; }
    if [[ -z "$REPO" ]]; then
      USER=$(gh api user -q .login)
      REPO="$USER/ive"
    fi
    gh repo create "$REPO" "$VISIBILITY" --source . --remote origin --push
    echo "✅ https://github.com/$REPO"
    exit 0
  fi
  echo "No 'gh' CLI and no origin remote."
  echo "Create the repo on GitHub, then:"
  echo "  git remote add origin git@github.com:<you>/ive.git"
  echo "  git push -u origin main"
  exit 1
fi

git push -u origin "$(git rev-parse --abbrev-ref HEAD)"
echo "✅ pushed to $(git remote get-url origin)"
