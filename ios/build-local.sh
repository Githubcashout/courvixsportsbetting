#!/usr/bin/env bash
# Build an UNSIGNED Courvix.ipa on a Mac with Xcode installed.
#   brew install xcodegen
#   ./build-local.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

./sync-web.sh
command -v xcodegen >/dev/null || { echo "xcodegen missing: brew install xcodegen"; exit 1; }
xcodegen generate

rm -rf build Payload Courvix-unsigned.ipa
xcodebuild \
  -project Courvix.xcodeproj \
  -scheme Courvix \
  -configuration Release \
  -sdk iphoneos \
  -derivedDataPath build \
  CODE_SIGN_IDENTITY="" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO \
  ONLY_ACTIVE_ARCH=NO \
  build

app="build/Build/Products/Release-iphoneos/Courvix.app"
[ -d "$app" ] || { echo "build produced no .app"; exit 1; }
mkdir -p Payload && cp -R "$app" Payload/
zip -qry Courvix-unsigned.ipa Payload
rm -rf Payload
echo
echo "Built: $(pwd)/Courvix-unsigned.ipa  ($(du -h Courvix-unsigned.ipa | cut -f1))"
echo "It is unsigned — sign it with your own Apple ID via Sideloadly or AltStore."
