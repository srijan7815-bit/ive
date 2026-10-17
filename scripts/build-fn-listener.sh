#!/usr/bin/env bash
# Build the IVE fn gesture helper (macOS only).
#
#   npm run build:fn            # universal (arm64 + x86_64)
#   IVE_FN_ARCH=host npm run build:fn   # just this machine, faster
#
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="native/fn-listener/main.swift"
OUT_DIR="native/fn-listener/.build"
OUT="$OUT_DIR/fn-listener"
DEPLOY_TARGET="11.0"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "⚠️  fn-listener is macOS-only (running on $(uname -s)). Skipping."
  exit 0
fi

if ! command -v swiftc >/dev/null 2>&1; then
  echo "swiftc not found. Install Xcode Command Line Tools:  xcode-select --install"
  exit 1
fi

mkdir -p "$OUT_DIR"

sign() {
  # Ad-hoc signature keeps the Accessibility grant stable between launches.
  codesign --force --sign - "$1" >/dev/null 2>&1 || true
}

if [[ "${IVE_FN_ARCH:-universal}" == "host" ]]; then
  echo "Building $OUT (host arch)…"
  swiftc -O -target "$(uname -m)-apple-macos${DEPLOY_TARGET}" -o "$OUT" "$SRC" \
    -framework Cocoa -framework CoreGraphics
  sign "$OUT"
else
  echo "Building $OUT (universal: arm64 + x86_64)…"
  swiftc -O -target "arm64-apple-macos${DEPLOY_TARGET}" -o "$OUT.arm64" "$SRC" \
    -framework Cocoa -framework CoreGraphics
  swiftc -O -target "x86_64-apple-macos${DEPLOY_TARGET}" -o "$OUT.x64" "$SRC" \
    -framework Cocoa -framework CoreGraphics
  lipo -create -output "$OUT" "$OUT.arm64" "$OUT.x64"
  rm -f "$OUT.arm64" "$OUT.x64"
  sign "$OUT"
  echo "   archs: $(lipo -archs "$OUT")"
fi

echo "✅ Built $OUT"
echo "   First run: System Settings → Privacy & Security → Accessibility + Input Monitoring → enable IVE."
