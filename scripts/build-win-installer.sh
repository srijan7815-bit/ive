#!/usr/bin/env bash
# Build the IVE Windows installer with electron-builder's bundled makensis.
#
# Why not `electron-builder --win nsis`? Its NSIS target calls Wine to stamp the
# uninstaller, so it only works on macOS or a Linux box with Wine installed.
# `native/win/installer.nsi` compiles the same installer directly and needs
# nothing but makensis — which electron-builder already downloaded.
#
#   npm run dist:win:dir      # → release/win-unpacked
#   npm run dist:win:nsis     # → release/IVE-<version>-win-x64.exe
#
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="$(node -p "require('./package.json').version")"
OUT="release/IVE-${VERSION}-win-x64.exe"
SRC="release/win-unpacked"

if [[ ! -f "$SRC/IVE.exe" ]]; then
  echo "release/win-unpacked/IVE.exe is missing — run: npm run dist:win:dir"
  exit 1
fi

# Locate makensis: electron-builder's cache, then PATH.
MAKENSIS="$(find "$HOME/.cache/electron-builder" -type f -name makensis -path '*linux*' 2>/dev/null | head -1 || true)"
if [[ -z "$MAKENSIS" ]]; then
  MAKENSIS="$(command -v makensis || true)"
fi
if [[ -z "$MAKENSIS" ]]; then
  echo "makensis not found. Run 'npx electron-builder --win --dir' once to fetch it,"
  echo "or install NSIS (apt install nsis / brew install makensis)."
  exit 1
fi

echo "Building $OUT with $MAKENSIS"
"$MAKENSIS" -V2 \
  -DSRCDIR="$PWD/$SRC" \
  -DOUTFILE="$PWD/$OUT" \
  -DICONFILE="$PWD/build/icon.ico" \
  -DAPP_VERSION="$VERSION" \
  native/win/installer.nsi

echo "✅ $OUT ($(du -h "$OUT" | cut -f1))"
echo "   Per-user install (no UAC), Start-menu shortcut, Add/Remove Programs entry."
