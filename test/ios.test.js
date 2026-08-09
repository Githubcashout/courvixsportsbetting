/* Courvix iOS project checks — zero dependencies. node test/ios.test.js
   Verifies everything about the iOS build that can be verified without Xcode. */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const r = (...p) => path.join(ROOT, ...p);
const read = (...p) => fs.readFileSync(r(...p), "utf8");
const exists = (...p) => fs.existsSync(r(...p));

let pass = 0, fail = 0; const fails = [];
const ok = (n, c, d) => { if (c) pass++; else { fail++; fails.push(n + (d ? "  → " + d : "")); } };
const group = (t) => console.log("\n\x1b[1m" + t + "\x1b[0m");

group("bundled web app");
{
  const p = "ios/Courvix/Resources/web/index.html";
  ok("web bundle exists", exists(p));
  if (exists(p)) {
    const html = read(p);
    ok("bundle is substantial", html.length > 50000, String(html.length));
    ok("no external script tags", !/<script src=/.test(html));
    ok("core is inlined", html.includes("CourvixCore"));
    ok("nfl client inlined", html.includes("makeNflClient"));
    ok("probe inlined", html.includes("runProbe"));
    ok("matches dist build", exists("dist/courvix.html") && html === read("dist/courvix.html"));
  }
}

group("Info.plist");
{
  const p = read("ios/Courvix/Info.plist");
  ok("portrait only", p.includes("UIInterfaceOrientationPortrait") && !p.includes("LandscapeLeft"));
  ok("dark appearance", /<key>UIUserInterfaceStyle<\/key>\s*<string>Dark<\/string>/.test(p));
  ok("launch storyboard declared", p.includes("<string>LaunchScreen</string>"));
  ok("no ATS exceptions needed", !p.includes("NSAppTransportSecurity"));
  ok("no arbitrary loads", !p.includes("NSAllowsArbitraryLoads"));
  ok("export compliance declared", p.includes("ITSAppUsesNonExemptEncryption"));
  ok("uses build-setting substitution for identifiers", p.includes("$(PRODUCT_BUNDLE_IDENTIFIER)"));
}

group("entitlements (free-account sideloading)");
{
  const files = fs.readdirSync(r("ios/Courvix"));
  ok("no .entitlements file", !files.some((f) => f.endsWith(".entitlements")));
  const plist = read("ios/Courvix/Info.plist");
  for (const cap of ["aps-environment", "UIBackgroundModes", "com.apple.security.application-groups",
                     "NSHealthShareUsageDescription", "keychain-access-groups"]) {
    ok(`no ${cap}`, !plist.includes(cap));
  }
  const src = read("ios/altstore-source.json");
  ok("altstore manifest declares zero entitlements", JSON.parse(src).apps[0].appPermissions.entitlements.length === 0);
}

group("WebViewController");
{
  const s = read("ios/Courvix/WebViewController.swift");
  ok("uses a custom scheme, not file://", s.includes("setURLSchemeHandler") && !s.includes("loadFileURL"));
  ok("scheme handler implemented", s.includes("WKURLSchemeHandler"));
  ok("blocks path traversal", s.includes('contains("..")'));
  ok("serves correct MIME types", s.includes("text/html") && s.includes("text/javascript"));
  ok("sends Content-Length", s.includes("Content-Length"));
  ok("persists localStorage across launches", s.includes("websiteDataStore"));
  ok("disables scroll bounce", s.includes("bounces = false"));
  ok("opens external links in Safari", s.includes("UIApplication.shared.open"));
  ok("surfaces load failures", s.includes("showLoadFailure"));
  ok("handles both navigation failure callbacks",
     s.includes("didFail navigation") && s.includes("didFailProvisionalNavigation"));
}

group("icons");
{
  const dir = "ios/Courvix/Assets.xcassets/AppIcon.appiconset";
  const cat = JSON.parse(read(dir, "Contents.json"));
  ok("catalog has entries", cat.images.length >= 15, String(cat.images.length));
  const missing = cat.images.filter((i) => !exists(dir, i.filename));
  ok("every entry has a file", missing.length === 0, JSON.stringify(missing.map((m) => m.filename)));
  ok("1024 marketing icon declared", cat.images.some((i) => i.idiom === "ios-marketing" && i.size === "1024x1024"));
  // PNG header: width/height live at bytes 16-24 of IHDR
  const png = fs.readFileSync(r(dir, "icon-1024.png"));
  ok("1024 icon is really 1024x1024",
     png.readUInt32BE(16) === 1024 && png.readUInt32BE(20) === 1024,
     `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`);
  ok("1024 icon has no alpha channel", png[25] === 2, "colorType " + png[25]);
  const ls = JSON.parse(read("ios/Courvix/Assets.xcassets/LaunchIcon.imageset/Contents.json"));
  ok("launch mark has 1x 2x 3x", ls.images.length === 3);
}

group("XcodeGen spec");
{
  const y = read("ios/project.yml");
  ok("deployment target 15.0", /iOS:\s*"15\.0"/.test(y));
  ok("iPhone only", /TARGETED_DEVICE_FAMILY:\s*"1"/.test(y));
  ok("bundle id set", y.includes("network.courvix.app"));
  ok("app icon wired to the catalog", y.includes("ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon"));
  ok("web bundle added as a plain resource, not a folder reference",
     y.includes("Courvix/Resources/web/index.html") && !/type:\s*folder/.test(y),
     "folder references force the newest project format, which older Xcodes reject");
  ok("swift sources exclude Resources", y.includes('"Resources/**"'));
  ok("no .xcodeproj committed", !exists("ios/Courvix.xcodeproj"));
}

group("CI workflow");
{
  const w = read(".github/workflows/ios.yml");
  ok("runs on a macOS runner", /runs-on:\s*macos-\d+/.test(w));
  ok("runner image is macos-15 or newer", /runs-on:\s*macos-(1[5-9]|[2-9]\d)/.test(w),
     (w.match(/runs-on:\s*macos-\d+/) || [""])[0]);
  ok("selects the newest installed Xcode", w.includes("xcode-select -s"));
  ok("prints available Xcodes for diagnosis", w.includes("ls -d /Applications/Xcode*.app"));
  ok("verifies Xcode can read the project before building", w.includes("cannot read a format-"));
  ok("selects Xcode before generating the project",
     w.indexOf("Select the newest installed Xcode") < w.indexOf("Generate the Xcode project"));
  ok("reports the project objectVersion", w.includes("objectVersion"));
  ok("can be triggered manually", w.includes("workflow_dispatch"));
  ok("runs the test suites first", w.includes("node test/core.test.js") && w.includes("node test/bot.test.js"));
  ok("syncs the web bundle", w.includes("sync-web.sh"));
  ok("invokes scripts via bash, not the executable bit",
     !/run:\s*\.\/ios\//.test(w), "GitHub web uploads drop +x, so ./script would fail");
  ok("prints a raw.githubusercontent source url too", w.includes("raw.githubusercontent.com"));
  ok("installs xcodegen", w.includes("brew install xcodegen"));
  ok("builds unsigned", w.includes("CODE_SIGNING_ALLOWED=NO"));
  ok("fails if no .app was produced", w.includes("no .app was produced"));
  ok("fails if the web bundle is missing", w.includes("web bundle missing"));
  ok("packages a Payload directory", w.includes("mkdir -p Payload"));
  ok("uploads the ipa artifact", w.includes("upload-artifact"));
  ok("publishes a release", w.includes("action-gh-release"));
  ok("has write permission", /permissions:\s*\n\s*contents:\s*write/.test(w));
  ok("prints the AltStore source url", w.includes("altstore-source.json"));
  ok("has a build timeout", w.includes("timeout-minutes"));
}

group("AltStore source");
{
  const s = JSON.parse(read("ios/altstore-source.json"));
  const a = s.apps[0];
  ok("source has an identifier", !!s.identifier);
  ok("exactly one app", s.apps.length === 1);
  ok("bundle id matches the project", a.bundleIdentifier === "network.courvix.app");
  ok("legacy 1.x fields present", ["version", "versionDate", "downloadURL", "size"].every((k) => k in a));
  ok("2.x versions array present", Array.isArray(a.versions) && a.versions.length === 1);
  ok("versions agree with legacy fields", a.versions[0].version === a.version && a.versions[0].downloadURL === a.downloadURL);
  ok("minimum OS declared", a.versions[0].minOSVersion === "15.0");
  ok("tint colour has no leading hash", !/^#/.test(a.tintColor));
  ok("download points at a release asset", /releases\/download\/.+\.ipa$/.test(a.downloadURL), a.downloadURL);
  ok("description is honest about limits", /says so on screen|cannot know/.test(a.localizedDescription));
}

group("scripts");
{
  for (const f of ["ios/sync-web.sh", "ios/build-local.sh", "ios/make-altstore-source.js"]) {
    ok(`${path.basename(f)} exists`, exists(f));
    ok(`${path.basename(f)} is executable`, (fs.statSync(r(f)).mode & 0o111) !== 0);
  }
  ok("sync-web rebuilds before copying", read("ios/sync-web.sh").includes("build.js"));
  ok("build-local is strict", read("ios/build-local.sh").includes("set -euo pipefail"));
  ok("build-local checks for xcodegen", read("ios/build-local.sh").includes("xcodegen missing"));
}

group("setup scripts");
{
  for (const f of ["setup.sh", "setup.ps1"]) {
    ok(`${f} exists`, exists(f));
  }
  const sh = read("setup.sh"), ps = read("setup.ps1");
  ok("sh creates a public repo", sh.includes("--public"));
  ok("ps creates a public repo", ps.includes("--public"));
  ok("sh verifies .github survived the unzip", sh.includes(".github/workflows/ios.yml"));
  ok("ps verifies .github survived the unzip", ps.includes(".github/workflows/ios.yml"));
  ok("sh signs in via browser, not a token", sh.includes("gh auth login --web"));
  ok("ps signs in via browser, not a token", ps.includes("gh auth login --web"));
  ok("neither script mentions a password", !/password/i.test(sh) && !/password/i.test(ps));
  ok("neither script handles a token", !/token/i.test(sh) && !/token/i.test(ps));
  ok("sh warns when the repo is not public", sh.includes("AltStore will not be able"));
  ok("ps warns when the repo is not public", ps.includes("AltStore will not be able"));
  ok("sh gitignores build output", sh.includes("ios/build/") && sh.includes("ios/*.ipa"));
  ok("ps gitignores build output", ps.includes("ios/build/") && ps.includes("ios/*.ipa"));
  ok("sh surfaces the failure command", sh.includes("--log-failed"));
  ok("ps surfaces the failure command", ps.includes("--log-failed"));
  ok("sh is executable", (fs.statSync(r("setup.sh")).mode & 0o111) !== 0);
  ok("sh prints the AltStore source url", sh.includes("raw.githubusercontent.com"));
  ok("ps prints the AltStore source url", ps.includes("raw.githubusercontent.com"));
  ok("sh is re-runnable for updates", sh.includes("already exists"));
  ok("ps is re-runnable for updates", ps.includes("already exists"));
}

console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
if (fail) { console.log("\x1b[31mFAILURES:\x1b[0m"); fails.forEach((f) => console.log("  ✗ " + f)); process.exit(1); }
console.log("\x1b[32mAll iOS project checks pass.\x1b[0m");
