#!/usr/bin/env node
/* Generate an AltStore source manifest.
 * Emits both the legacy top-level version fields (AltStore 1.x) and the
 * `versions` array (AltStore 2.x / SideStore), so either client can read it. */
"use strict";
const fs = require("fs");
const path = require("path");

const repo    = process.env.REPO    || "USER/REPO";
const version = process.env.VERSION || "4.0.0";
const build   = process.env.BUILD   || "1";
const size     = Number(process.env.SIZE || 0);
const sha256  = process.env.SHA     || "";
const date    = process.env.DATE    || new Date().toISOString().slice(0, 10);
const runTag  = process.env.GITHUB_RUN_NUMBER || "1";

const [user, name] = repo.split("/");
const pages = `https://${user}.github.io/${name}`;
const download = `https://github.com/${repo}/releases/download/v${version}-${runTag}/Courvix-unsigned.ipa`;

const notes = [
  "MLB and NFL player research on free public data.",
  "Hit rates with 95% confidence intervals, not bare percentages.",
  "Parlay analyser that shows the book's real hold and expected value.",
  "Correlated and contradictory legs are flagged or blocked.",
  "Endpoint probe for verifying the live data feeds."
].join("\n• ");

const versionEntry = {
  version,
  buildVersion: build,
  date,
  localizedDescription: "• " + notes,
  downloadURL: download,
  size,
  sha256,
  minOSVersion: "15.0"
};

const app = {
  name: "Courvix",
  bundleIdentifier: "network.courvix.app",
  developerName: "Courvix Network",
  subtitle: "Honest sports prop research",
  localizedDescription:
    "Courvix is a sports research tool for MLB and NFL player props.\n\n" +
    "It reports hit rates with their confidence intervals rather than bare percentages, " +
    "compares every number to the 52.4% break-even at -110, and its parlay analyser shows " +
    "the book's actual hold on your ticket next to a single bet's 4.5%.\n\n" +
    "Runs entirely on free public data. Anything it cannot know — live prop pricing, " +
    "Pinnacle lines, public betting percentages — it says so on screen instead of inventing it.",
  iconURL: `${pages}/icon.png`,
  tintColor: "4D8BFF",
  category: "utilities",
  screenshotURLs: [],
  // AltStore 1.x fields
  version,
  versionDate: date,
  versionDescription: "• " + notes,
  downloadURL: download,
  size,
  // AltStore 2.x / SideStore
  versions: [versionEntry],
  appPermissions: { entitlements: [], privacy: {} }
};

const source = {
  name: "Courvix Network",
  identifier: "network.courvix.source",
  subtitle: "Sports research that shows its working",
  description: "Builds of Courvix, published straight from CI.",
  iconURL: `${pages}/icon.png`,
  headerURL: `${pages}/icon.png`,
  website: `https://github.com/${repo}`,
  tintColor: "4D8BFF",
  apps: [app],
  news: []
};

const out = path.join(__dirname, "altstore-source.json");
fs.writeFileSync(out, JSON.stringify(source, null, 2));
console.log(`wrote ${out}`);
console.log(`  app      ${app.name} ${version} (build ${build})`);
console.log(`  download ${download}`);
console.log(`  source   ${pages}/altstore-source.json`);
