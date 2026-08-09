# Courvix for iOS

A native iPhone app wrapping the Courvix web bundle. No frameworks, no CocoaPods,
no npm — one Swift file, a WKWebView, and the HTML compiled into the app.

**You do not need a Mac.** GitHub's free macOS runners build the `.ipa` for you.

---

## Getting the .ipa

1. Push this repo to GitHub.
2. **Actions → Build iOS IPA → Run workflow.**
3. Wait ~5 minutes.

The run produces two things:

- **`Courvix-unsigned-ipa`** in Artifacts — the file itself.
- An **AltStore source URL**, printed in the run summary.

Use the source URL. It means every future build shows up in AltStore as an update
you tap, instead of repeating this whole process.

```
https://<your-user>.github.io/<your-repo>/altstore-source.json
```

To make that URL live, enable **Settings → Pages → Source: deploy from branch →
`gh-pages`** once. The workflow pushes the manifest there on every build.

---

## Installing with AltStore

**Add the source (recommended)**

1. AltStore → **Browse** → **Sources** → **+**
2. Paste the source URL above.
3. Courvix appears under that source. Tap **FREE** to install.

**Or install the file directly**

1. Download `Courvix-unsigned.ipa` from the Actions artifact.
2. AltStore → **My Apps** → **+** → pick the file.

Either way AltStore signs it with *your* Apple ID on your machine. The build is
unsigned on purpose — a signature from anyone else would just have to be stripped.

---

## What a free Apple ID actually gets you

Worth knowing before you start, because these limits surprise people:

| | Free Apple ID | Paid Developer ($99/yr) |
|---|---|---|
| Signature lifetime | **7 days** | 1 year |
| Apps installed at once | **3** — and AltStore itself uses one, so 2 left | 10 |
| New App IDs | 10 per 7 days | 10 per 7 days |
| Refresh | AltServer on the same WiFi | same |

The 7-day expiry is the one that matters day to day. Keep AltServer running on
your computer and AltStore refreshes over WiFi in the background when both are on
the same network. If it lapses, the app stops opening until you refresh it — your
data is untouched, since everything lives in the app's own storage.

**Courvix requests no entitlements at all** — no push notifications, no keychain
sharing, no app groups, no background modes. That is deliberate: entitlements are
exactly what breaks free-account sideloading, and this app needs none of them.

---

## What's in here

```
Courvix/AppDelegate.swift        window, portrait lock, theme colour
Courvix/WebViewController.swift  the WKWebView and the bundle scheme handler
Courvix/Info.plist               dark mode, portrait, no ATS exceptions needed
Courvix/LaunchScreen.storyboard  navy screen with the mark
Courvix/Assets.xcassets          15 icon sizes + launch mark, generated
Courvix/Resources/web/           index.html — the built app, copied by sync-web.sh
project.yml                      XcodeGen spec (no .xcodeproj in git)
sync-web.sh                      rebuild the web bundle into the app
build-local.sh                   full unsigned build, if you do have a Mac
make-altstore-source.js          writes the AltStore manifest in CI
```

### Why a custom URL scheme instead of file://

The app serves its own bundle over `courvix://app/index.html` rather than loading
it from `file://`. This is not cosmetic. A `file://` page has a **null origin**, so
every request to `statsapi.mlb.com` or `site.api.espn.com` counts as cross-origin
from a null origin and gets blocked no matter what CORS headers those servers
send. A custom scheme gives the page a real origin, so their permissive
`Access-Control-Allow-Origin` is honoured and the data actually loads.

`BundleSchemeHandler` serves files from the bundle with correct MIME types and
refuses any path containing `..`.

---

## Building on a Mac instead

```bash
brew install xcodegen
cd ios
./build-local.sh          # → ios/Courvix-unsigned.ipa
```

Or open it in Xcode after `xcodegen generate`, set your team under Signing, and
run straight to a connected iPhone.

## Updating the app

Change the web app, then:

```bash
./ios/sync-web.sh         # rebuilds dist/courvix.html into the bundle
```

Bump `CFBundleShortVersionString` in `Info.plist`, push, and the workflow
publishes a new release plus an updated source manifest. AltStore picks it up as
an available update.

---

## Known limits

- The `.ipa` is unsigned; it will not install without AltStore, Sideloadly or Xcode.
- Portrait only, iPhone only, iOS 15.0+.
- The web bundle is compiled in, so the UI works offline — but the stats feeds
  obviously need a connection.
- Nothing here has been compiled or run on a device from the environment it was
  authored in. The first CI run is the real test, and it fails loudly rather than
  producing a broken artifact: it runs the test suites first, checks a `.app` was
  produced, and verifies the web bundle is actually inside it before packaging.
