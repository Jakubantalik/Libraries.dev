#!/bin/sh
# Builds MagnetBridge.apk without Gradle: aapt2 + kotlinc + javac + d8 + apksigner.
# The model and the sensor code around it come straight from ../magnetkit
# (MagnetKit for Android), so the bridge always runs the same model as the apps.
# Needs JDK 17, Kotlin and the Android SDK (platform android-35, build-tools 35.0.0):
#   brew install openjdk@17 kotlin && brew install --cask android-commandlinetools
#   sdkmanager "platforms;android-35" "build-tools;35.0.0"
# Install on a phone with USB debugging:  adb install -r build/MagnetBridge.apk
set -e
cd "$(dirname "$0")"
JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
SDK="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
KOTLIN="${KOTLIN_HOME:-/opt/homebrew/opt/kotlin/libexec}"
BT="$SDK/build-tools/35.0.0"
JAR="$SDK/platforms/android-35/android.jar"
STDLIB="$KOTLIN/lib/kotlin-stdlib.jar"
KIT=../magnetkit/src/main
export JAVA_HOME PATH="$JAVA_HOME/bin:$PATH"

rm -rf build && mkdir -p build/classes build/dex build/assets
cp "$KIT/assets/Magnet.mfxl" build/assets/
"$BT/aapt2" link -o build/base.apk -I "$JAR" --manifest AndroidManifest.xml -A build/assets -0 mfxl
"$KOTLIN/bin/kotlinc" -nowarn -jvm-target 11 -no-reflect -no-stdlib \
  -classpath "$JAR:$STDLIB" -d build/classes \
  $(find "$KIT/kotlin" src -name '*.kt') $(find src -name '*.java')
"$JAVA_HOME/bin/javac" -source 11 -target 11 -Xlint:-options -encoding UTF-8 \
  -classpath "$JAR:$STDLIB:build/classes" -d build/classes $(find src -name '*.java')
"$BT/d8" --min-api 29 --lib "$JAR" --output build/dex $(find build/classes -name '*.class') "$STDLIB" 2>&1 \
  | grep -v -e "rewriting of Kotlin metadata" -e "Should never be called" -e "^\s*at " -e "^$" || true
cp build/base.apk build/unsigned.apk
(cd build/dex && zip -q -j ../unsigned.apk classes*.dex)
"$BT/zipalign" -f -p 4 build/unsigned.apk build/aligned.apk
[ -f debug.keystore ] || "$JAVA_HOME/bin/keytool" -genkeypair -keystore debug.keystore \
  -storepass android -keypass android -alias debug -keyalg RSA -keysize 2048 \
  -validity 10000 -dname "CN=Magnet Bridge Debug" >/dev/null 2>&1
"$BT/apksigner" sign --ks debug.keystore --ks-pass pass:android --key-pass pass:android \
  --out build/MagnetBridge.apk build/aligned.apk
echo "built build/MagnetBridge.apk ($(du -h build/MagnetBridge.apk | cut -f1))"
