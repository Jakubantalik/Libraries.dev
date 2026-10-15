#!/bin/bash
# Build and launch the MetalFxKit demo in the iOS Simulator.
#
#   ./run.sh                 # default device (iPhone 16 Pro)
#   ./run.sh "iPhone 16e"    # pick another simulator
#
# Requires: Xcode, xcodegen (brew install xcodegen), an installed iOS runtime.
set -euo pipefail

DEVICE="${1:-iPhone 16 Pro}"
BUNDLE_ID="com.jakubantalik.MetalFxDemo"
XCODE="${XCODE_APP:-/Applications/Xcode.app}"
export DEVELOPER_DIR="$XCODE/Contents/Developer"

cd "$(dirname "$0")"
command -v xcodegen >/dev/null || { echo "error: xcodegen not found — run: brew install xcodegen" >&2; exit 1; }

echo "▸ Generating project…"
xcodegen generate --quiet
echo "▸ Booting $DEVICE…"
xcrun simctl boot "$DEVICE" 2>/dev/null || true
open -a "$XCODE/Contents/Developer/Applications/Simulator.app"
echo "▸ Building…"
xcodebuild -project MetalFxDemo.xcodeproj -scheme MetalFxDemo \
  -destination "platform=iOS Simulator,name=$DEVICE" -derivedDataPath build \
  build > /tmp/metalfx-demo-build.log 2>&1 \
  || { grep -E "error:" /tmp/metalfx-demo-build.log | head -20; echo "BUILD FAILED (full log: /tmp/metalfx-demo-build.log)"; exit 1; }
APP="build/Build/Products/Debug-iphonesimulator/MetalFxDemo.app"
echo "▸ Installing and launching…"
xcrun simctl install "$DEVICE" "$APP"
xcrun simctl launch "$DEVICE" "$BUNDLE_ID"
echo "✓ Running on $DEVICE"
