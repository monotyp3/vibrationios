#!/usr/bin/env bash
# Builds an UNSIGNED .ipa for sideloading. Sideloadly / AltStore sign it with
# your Apple ID when they install it. Must run on macOS with Xcode installed
# (your own Mac, or the GitHub Actions macOS runner).
set -euo pipefail

cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"

echo "==> Installing npm packages"
npm install

echo "==> Adding iOS platform (first run only)"
if [ ! -d ios ]; then
  npx cap add ios
fi

echo "==> Syncing web code and plugins into the iOS project"
npx cap sync ios

echo "==> Patching Info.plist"
PLIST="ios/App/App/Info.plist"
PB=/usr/libexec/PlistBuddy
# Allow ws:// to a computer on your home Wi-Fi while testing (wss:// works everywhere).
$PB -c "Delete :NSAppTransportSecurity" "$PLIST" 2>/dev/null || true
$PB -c "Add :NSAppTransportSecurity dict" "$PLIST"
$PB -c "Add :NSAppTransportSecurity:NSAllowsLocalNetworking bool true" "$PLIST"
$PB -c "Delete :NSLocalNetworkUsageDescription" "$PLIST" 2>/dev/null || true
$PB -c "Add :NSLocalNetworkUsageDescription string 'Connects to a Haptic Link server on your local network.'" "$PLIST"
# Portrait only on iPhone.
$PB -c "Delete :UISupportedInterfaceOrientations" "$PLIST" 2>/dev/null || true
$PB -c "Add :UISupportedInterfaceOrientations array" "$PLIST"
$PB -c "Add :UISupportedInterfaceOrientations:0 string UIInterfaceOrientationPortrait" "$PLIST"

echo "==> Building (unsigned, Release)"
# Capacitor 8 uses Swift Package Manager (App.xcodeproj). Older CocoaPods
# projects have App.xcworkspace instead, so support both.
if [ -d ios/App/App.xcworkspace ]; then
  PROJECT_ARGS=(-workspace ios/App/App.xcworkspace)
else
  PROJECT_ARGS=(-project ios/App/App.xcodeproj)
fi

rm -rf build
xcodebuild "${PROJECT_ARGS[@]}" \
  -scheme App \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath build \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  build

echo "==> Packaging .ipa"
APP_PATH="build/Build/Products/Release-iphoneos/App.app"
if [ ! -d "$APP_PATH" ]; then
  echo "Build output not found at $APP_PATH" >&2
  exit 1
fi
rm -rf dist && mkdir -p dist/Payload
cp -R "$APP_PATH" dist/Payload/
(cd dist && zip -qry HapticLink.ipa Payload && rm -rf Payload)

echo ""
echo "Done: $APP_DIR/dist/HapticLink.ipa"
echo "Open it in Sideloadly (or AltStore) to install on your iPhone."
