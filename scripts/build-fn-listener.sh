#!/usr/bin/env bash
# Build the IVE fn gesture helper (macOS only).
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="native/fn-listener/main.swift"
OUT_DIR="native/fn-listener/.build"
OUT="$OUT_DIR/fn-listener"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "⚠️  fn-listener is macOS-only (running on $(uname -s)). Skipping."
  exit 0
fi

if ! command -v swiftc >/dev/null 2>&1; then
  echo "swiftc not found. Install Xcode Command Line Tools:  xcode-select --install"
  exit 1
fi

mkdir -p "$OUT_DIR"
echo "Building $OUT …"
swiftc -O -o "$OUT" "$SRC" -framework Cocoa -framework CoreGraphics

# Ad-hoc signature keeps the Accessibility grant stable between launches.
codesign --force --sign - "$OUT" >/dev/null 2>&1 || true

echo "✅ Built $OUT"
echo "   First run: System Settings → Privacy & Security → Accessibility + Input Monitoring → enable IVE."
