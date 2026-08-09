# Building the Courvix .ipa

Two paths. Pick by what your AltServer computer is.

| Your computer | Use |
|---|---|
| Windows | **Path A** — GitHub builds it for you |
| Mac without Xcode | **Path A** (or install Xcode, ~7 GB, then Path B) |
| Mac with Xcode | **Path B** — faster, ~2 minutes |

Both produce the same unsigned `.ipa`. AltStore signs it with your Apple ID.

---

# Path A — GitHub builds it (no Mac needed)

Do all of this on the computer running AltServer.

## 1. Unzip the project

Unzip `courvix-network.zip`. You should see a `courvix-network` folder containing
`core.js`, `ios/`, `.github/`, and the rest.

> **macOS:** press `Cmd ⇧ .` in Finder to reveal the `.github` folder — it's hidden
> by default and the build will not run without it.
> **Windows:** File Explorer → View → tick **Hidden items**.

## 2. Create the repository

Go to [github.com/new](https://github.com/new).

- **Name:** `courvix`
- **Visibility:** **Public**

Leave everything else alone. Don't add a README.

> **Why public?** AltStore downloads the app without any credentials, so a private
> repo's release files are unreachable to it. Public also means unlimited free
> build minutes. There are no secrets in this code — nothing to protect.
>
> If you'd rather keep it private, that works too, but you must use the *file*
> method in step 6 instead of the source URL, and you get roughly 40 builds a
> month rather than unlimited.

## 3. Upload the files

On the empty repo page, click **uploading an existing file**.

Drag in **everything inside** `courvix-network` — the contents, not the folder
itself. Confirm `.github` is among them.

Click **Commit changes**.

> If `.github` refuses to upload, skip it and see *Troubleshooting* below.

## 4. Run the build

- **Actions** tab
- If asked, click **I understand my workflows, go ahead and enable them**
- Left sidebar → **Build iOS IPA**
- **Run workflow** ▸ → green **Run workflow** button

It takes about 5 minutes. A green tick means it worked.

## 5. Get your source URL

Click into the finished run. At the top is a **Summary** with your AltStore source
URL, which looks like:

```
https://raw.githubusercontent.com/YOUR-USERNAME/courvix/gh-pages/altstore-source.json
```

Copy it.

## 6. Install with AltStore

**Via the source (recommended — future updates become one tap):**

1. AltStore → **Browse** → **Sources** → **+**
2. Paste the URL → **Add Source**
3. Open **Courvix Network** → tap **FREE**

**Or via the file:**

1. In the run, scroll to **Artifacts** → download **Courvix-unsigned-ipa**
2. Unzip it — inside is `Courvix-unsigned.ipa`
3. Get it onto your iPhone (AirDrop, or iCloud Drive)
4. AltStore → **My Apps** → **+** → pick the file

Enter your Apple ID when prompted. That's AltStore signing it locally — the
credentials go to Apple, not to me or GitHub.

---

# Path B — build it on your Mac

```bash
# once
brew install xcodegen

# every build
cd courvix-network/ios
bash build-local.sh
```

Output: `ios/Courvix-unsigned.ipa`.

Drag it onto AltServer, or AltStore → My Apps → + → pick it.

To run straight to a plugged-in iPhone with no .ipa at all:

```bash
cd courvix-network/ios
bash sync-web.sh && xcodegen generate && open Courvix.xcodeproj
```

In Xcode: select your iPhone as the destination, then **Signing & Capabilities** →
Team → your Apple ID → press ▶.

---

# Updating later

Change anything in the web app, then:

```bash
bash ios/sync-web.sh
```

Bump `CFBundleShortVersionString` in `ios/Courvix/Info.plist` (e.g. `4.0.0` → `4.1.0`),
commit, push. The workflow publishes a new release and refreshes the source
manifest. If you added the source, AltStore shows it as an update.

---

# Troubleshooting

**Actions tab is empty, or no workflow listed**
`.github` didn't upload. Fix it in the browser: **Actions** → *set up a workflow
yourself* → delete the sample → paste the contents of
`.github/workflows/ios.yml` → name the file `ios.yml` → commit.

**Build fails at "Run the test suites"**
Something in the JS broke before iOS is even involved. The log names the failing
assertion — send it to me.

**Build fails at "Build (unsigned)"**
A Swift compile error. This is the step that has never run in my environment, so
it's the likeliest to need a fix. Copy the red lines from the log and send them —
it'll be a one-pass fix.

**AltStore: "Could not download app"**
The repo is private. Either make it public (Settings → General → bottom → Change
visibility) or use the file method.

**AltStore: "Maximum number of apps reached"**
A free Apple ID allows 3 sideloaded apps and AltStore itself uses one slot.
Remove something else.

**App opens to a blank navy screen**
The web bundle didn't make it into the app. The workflow checks for this and
fails, so it shouldn't reach you — but if it does, tell me and I'll look at the
scheme handler.

**App stops opening after a week**
Normal. A free Apple ID signature lasts 7 days. Open AltStore with AltServer
running on the same WiFi and hit refresh. Your data isn't affected.

---

# What to expect the first time

The Swift in this project has never been compiled — there's no iOS SDK on Linux,
so I could verify the plist, the icons, the asset catalog, the workflow and the
AltStore manifest, but not the compile itself. 79 automated checks cover
everything else.

The build is written to fail loudly rather than hand you a broken app: it runs the
test suites first, checks that a `.app` was actually produced, and verifies the
web bundle is inside it before packaging. If step 4 goes red, the log will say
exactly where, and that's a quick fix.
