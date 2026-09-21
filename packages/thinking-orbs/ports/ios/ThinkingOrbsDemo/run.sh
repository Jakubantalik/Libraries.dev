#!/usr/bin/env bash
# Generate, build, install and launch the demo on a booted simulator.
# One step, mirroring border-beam's BorderBeamDemo/run.sh.
set -euo pipefail
cd "$(dirname "$0")"

DEVICE="${1:-booted}"

# The three-argument form of awk's match() is a GNU extension, and macOS
# ships BSD awk -- which is every machine this script runs on, so the old
# inline awk printed nothing and xcodebuild got an empty destination id.
device_udid() {
  uuid='[0-9A-F]{8}-([0-9A-F]{4}-){3}[0-9A-F]{12}'
  if [ "$1" = "booted" ]; then
    xcrun simctl list devices | grep '(Booted)' | grep -Eo "$uuid" | head -1
  else
    xcrun simctl list devices | grep "$1" | grep -Eo "$uuid" | head -1
  fi
}

echo "==> generating project"
xcodegen generate >/dev/null

echo "==> building"
xcodebuild -project ThinkingOrbsDemo.xcodeproj \
  -scheme ThinkingOrbsDemo \
  -sdk iphonesimulator \
  -destination "id=$(device_udid "$DEVICE")" \
  -derivedDataPath ./build build | grep -E "error:|BUILD" || true

APP="./build/Build/Products/Debug-iphonesimulator/ThinkingOrbsDemo.app"
echo "==> installing $APP"
xcrun simctl install "$DEVICE" "$APP"
xcrun simctl launch "$DEVICE" com.jakubantalik.ThinkingOrbsDemo
echo "==> launched"
