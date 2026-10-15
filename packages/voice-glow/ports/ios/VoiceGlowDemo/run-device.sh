#!/bin/bash
# Build, install and launch the VoiceGlowKit demo on a connected iPhone.
#
#   ./run-device.sh                  # the first paired iPhone
#   ./run-device.sh "iPhone Jakub"   # a named one
#
# The phone must be paired with this Mac (USB once, then Wi-Fi works),
# unlocked, and in Developer Mode (Settings › Privacy & Security). Signing
# uses your Apple Development certificate; TEAM=XXXXXXXXXX overrides the
# team read from it. XCODE_APP picks the Xcode (it must know the phone's iOS).
set -euo pipefail

NAME="${1:-}"
BUNDLE_ID="com.jakubantalik.VoiceGlowDemo"
XCODE="${XCODE_APP:-$(dirname "$(dirname "$(xcode-select -p)")")}"
export DEVELOPER_DIR="$XCODE/Contents/Developer"

cd "$(dirname "$0")"

TEAM="${TEAM:-$(security find-certificate -c "Apple Development" -p 2>/dev/null \
  | openssl x509 -noout -subject 2>/dev/null | sed -n 's/.*OU *= *\([A-Z0-9]*\).*/\1/p')}"
if [ -z "$TEAM" ]; then
  echo "error: no Apple Development certificate found — sign in to Xcode (Settings › Accounts) or set TEAM=" >&2
  exit 1
fi

echo "▸ Generating project…"
xcodegen generate --quiet

echo "▸ Building for device (team $TEAM)…"
mkdir -p build
xcodebuild \
  -project VoiceGlowDemo.xcodeproj \
  -scheme VoiceGlowDemo \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -derivedDataPath build/device \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic \
  build > build/xcodebuild-device.log 2>&1 \
  || { grep -E "error:" build/xcodebuild-device.log | head -20; \
       echo "BUILD FAILED (full log: build/xcodebuild-device.log)"; exit 1; }

APP="build/device/Build/Products/Release-iphoneos/VoiceGlowDemo.app"

# Pick the phone: by name, or the first one listed.
DEVICES=$(xcrun devicectl list devices 2>/dev/null | tail -n +3)
if [ -n "$NAME" ]; then
  LINE=$(echo "$DEVICES" | grep -F "$NAME" | head -1)
else
  LINE=$(echo "$DEVICES" | grep -i iphone | head -1)
fi
ID=$(echo "$LINE" | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' | head -1)
if [ -z "$ID" ]; then
  echo "Built $APP, but no paired iPhone was found (xcrun devicectl list devices)." >&2
  exit 1
fi

echo "▸ Installing on $(echo "$LINE" | awk '{print $1, $2}')…"
xcrun devicectl device install app --device "$ID" "$APP" >/dev/null \
  || { echo "Install failed — is the phone unlocked, nearby and in Developer Mode?" >&2; exit 1; }
echo "▸ Launching…"
xcrun devicectl device process launch --device "$ID" "$BUNDLE_ID" >/dev/null \
  || echo "Installed. Launch it from the home screen (the first time, trust the developer in Settings › General › VPN & Device Management)."
echo "✓ Voice is on the phone"
