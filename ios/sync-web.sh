#!/usr/bin/env bash
# Rebuild the web app and copy it into the iOS bundle.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(dirname "$here")"
node "$root/build.js"
mkdir -p "$here/Courvix/Resources/web"
cp "$root/dist/courvix.html" "$here/Courvix/Resources/web/index.html"
echo "synced $(wc -c < "$here/Courvix/Resources/web/index.html") bytes -> Courvix/Resources/web/index.html"
