#!/bin/bash
# Build and launch the BotAvatarsKit demo in the iOS Simulator.
#
#   ./run.sh                 # default device (iPhone 16 Pro)
#   ./run.sh "iPhone 16e"    # pick another simulator
#
# Requires: Xcode, xcodegen (brew install xcodegen), an installed iOS runtime.
# Extra arguments after the device go to the app, e.g.
#   ./run.sh "iPhone 16 Pro" -renderGrid YES     # writes Documents/grid.png (the reference grid at 2×)
#   ./run.sh "iPhone 16 Pro" -screen grid        # open on a screen: grid | controls | reference
set -euo pipefail

DEVICE="${1:-iPhone 16 Pro}"
shift || true
BUNDLE_ID="com.jakubantalik.BotAvatarsDemo"
XCODE="${XCODE_APP:-/Applications/Xcode.app}"
export DEVELOPER_DIR="$XCODE/Contents/Developer"
CONFIG="${CONFIGURATION:-Release}"

cd "$(dirname "$0")"
command -v xcodegen >/dev/null || { echo "error: xcodegen not found — run: brew install xcodegen" >&2; exit 1; }

echo "▸ Generating project…"
xcodegen generate --quiet
# the device's UDID: the booted one of that name if any, else the first
# (a bare name resolves to the newest runtime, which may not carry it)
UDID=$(xcrun simctl list devices available | grep -F "$DEVICE (" | grep -F "(Booted)" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/' || true)
[ -n "$UDID" ] || UDID=$(xcrun simctl list devices available | grep -F "$DEVICE (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/' || true)
[ -n "$UDID" ] || { echo "error: no simulator named '$DEVICE'" >&2; exit 1; }
echo "▸ Booting $DEVICE ($UDID)…"
xcrun simctl boot "$UDID" 2>/dev/null || true
open -a "$XCODE/Contents/Developer/Applications/Simulator.app"
echo "▸ Building ($CONFIG)…"
xcodebuild -project BotAvatarsDemo.xcodeproj -scheme BotAvatarsDemo -configuration "$CONFIG" \
  -destination "platform=iOS Simulator,id=$UDID" -derivedDataPath build \
  build > /tmp/bot-avatars-demo-build.log 2>&1 \
  || { grep -E "error:" /tmp/bot-avatars-demo-build.log | head -20; echo "BUILD FAILED (full log: /tmp/bot-avatars-demo-build.log)"; exit 1; }
APP="build/Build/Products/$CONFIG-iphonesimulator/BotAvatarsDemo.app"
echo "▸ Installing and launching…"
xcrun simctl install "$UDID" "$APP"
xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true
xcrun simctl launch "$UDID" "$BUNDLE_ID" "$@"
echo "✓ Running on $DEVICE"
