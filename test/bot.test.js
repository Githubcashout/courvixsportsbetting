/* Courvix bot test suite — zero dependencies. node test/bot.test.js */
const crypto = require("crypto");
const http = require("http");
const C = require("../core.js");
const { DEFINITIONS, handleCommand, cmdParlay, cmdCatalog, findPlayer } = require("../bot/commands.js");
const { verify, route, publicKeyFromHex } = require("../bot/bot.js");

let pass = 0, fail = 0; const fails = [];
const ok = (n, c, d) => { if (c) pass++; else { fail++; fails.push(n + (d ? "  → " + d : "")); } };
const group = (t) => console.log("\n\x1b[1m" + t + "\x1b[0m");
const textOf = (r) => JSON.stringify(r);

/* ── mock MLB client ── */
const battingLog = (n = 24) => Array.from({ length: n }, (_, i) => {
  const h = (i * 7919) % 97;
  return { date: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`, home: i % 2 === 0, opp: "Tampa Bay Rays",
           stat: { hits: h % 3, totalBases: (h % 3) + (h % 2), rbi: h % 3, runs: h % 2,
                   homeRuns: h % 9 === 0 ? 1 : 0, strikeOuts: h % 3, baseOnBalls: h % 2, stolenBases: 0 } };
});
const pitchingLog = (n = 12) => Array.from({ length: n }, (_, i) => {
  const h = (i * 613) % 41;
  return { date: `2026-07-0${(i % 9) + 1}`, home: i % 2 === 0, opp: "Boston Red Sox",
           stat: { strikeOuts: 4 + h % 8, earnedRuns: h % 5, hits: 3 + h % 6,
                   baseOnBalls: h % 4, inningsPitched: `${5 + h % 3}.${h % 3}` } };
});
const mockClient = (over) => Object.assign({
  season: 2026,
  async players() {
    return [
      { id: 1, name: "Aaron Judge", pos: "RF", team: "New York Yankees", teamId: 147, pitcher: false },
      { id: 2, name: "Paul Skenes", pos: "P", team: "Pittsburgh Pirates", teamId: 134, pitcher: true },
      { id: 3, name: "Juan Soto", pos: "LF", team: "New York Mets", teamId: 121, pitcher: false },
      { id: 4, name: "Juan Sotolongo", pos: "CF", team: "Miami Marlins", teamId: 146, pitcher: false }
    ];
  },
  async gameLog(id, g) { return g === "pitching" ? pitchingLog() : battingLog(); },
  async schedule() {
    return [
      { gamePk: 1, start: "2026-08-08T23:05:00Z", state: "Preview", detail: "Scheduled",
        away: { name: "Red Sox", id: 111, pitcher: "Garrett Crochet" },
        home: { name: "Yankees", id: 147, pitcher: "Max Fried" } },
      { gamePk: 2, start: "2026-08-08T20:10:00Z", state: "Live", detail: "Top 6th",
        away: { name: "Dodgers", id: 119, score: 4, pitcher: "" },
        home: { name: "Padres", id: 135, score: 2, pitcher: "" } }
    ];
  },
  async leaders() { return []; }
}, over || {});

const D = (name, opts) => ({ name, options: Object.entries(opts || {}).map(([k, v]) => ({ name: k, value: v })) });

const nflLog = (n = 15) => Array.from({ length: n }, (_, i) => {
  const h = (i * 331) % 53;
  return { gameId: "G" + i, date: `2025-1${i % 2}-0${(i % 9) + 1}`, week: i + 1,
           home: i % 2 === 0, opp: "Ravens",
           stat: { passYds: 180 + h * 3, passTd: h % 4, int: h % 2, passAtt: 28 + (h % 9), passCmp: 18 + (h % 7),
                   rushYds: h % 20, rushTd: h % 5 === 0 ? 1 : 0, rec: 0, recYds: 0, recTd: 0 } };
});
const nflWrLog = (n = 15) => Array.from({ length: n }, (_, i) => {
  const h = (i * 617) % 47;
  return { gameId: "W" + i, date: `2025-1${i % 2}-0${(i % 9) + 1}`, week: i + 1,
           home: i % 2 === 1, opp: "Chiefs",
           stat: { rec: 3 + (h % 6), recYds: 30 + h * 2, recTd: h % 7 === 0 ? 1 : 0, rushYds: 0, rushTd: 0 } };
});
const nflClient = (over) => Object.assign({
  sport: "nfl", season: 2025,
  async players() {
    return [
      { id: "1", name: "Patrick Mahomes", pos: "QB", team: "Chiefs", teamId: "12", pitcher: false },
      { id: "2", name: "Rashee Rice", pos: "WR", team: "Chiefs", teamId: "12", pitcher: false },
      { id: "3", name: "Harrison Butker", pos: "K", team: "Chiefs", teamId: "12", pitcher: false }
    ];
  },
  async gameLog(id) { return id === "2" ? nflWrLog() : nflLog(); },
  async schedule() {
    return [{ gamePk: "401", start: "2026-09-10T00:20Z", week: 1, state: "Preview", detail: "Thu 8:20 PM",
              away: { name: "Ravens", id: "17", pitcher: "" }, home: { name: "Chiefs", id: "12", pitcher: "" } }];
  },
  async leaders() { return []; }
}, over || {});
const clientForFactory = (mlb, nfl) => (s) => (s === "nfl" ? nfl : mlb);

(async () => {

/* ── definitions ── */
group("command definitions");
ok("five commands defined", DEFINITIONS.length === 5, String(DEFINITIONS.length));
ok("all have name + description", DEFINITIONS.every((d) => d.name && d.description));
ok("names are lowercase and valid", DEFINITIONS.every((d) => /^[a-z][a-z0-9_-]{0,31}$/.test(d.name)));
ok("descriptions within 100 chars", DEFINITIONS.every((d) => d.description.length <= 100));
{
  const prop = DEFINITIONS.find((d) => d.name === "prop");
  ok("prop market choices exist", prop.options[1].choices.length > 0);
  ok("Discord's 25-choice cap respected", prop.options[1].choices.length <= 25,
     String(prop.options[1].choices.length));
  ok("choice values within 100 chars", prop.options[1].choices.every((c) => c.value.length <= 100));
  ok("required options precede optional ones",
     DEFINITIONS.every((d) => {
       const o = d.options || []; let seenOptional = false;
       return o.every((x) => { if (!x.required) seenOptional = true; return !(x.required && seenOptional); });
     }));
  ok("mlb pitching choices are namespaced", prop.options[1].choices.some((c) => c.value.startsWith("mlb:p:")));
  ok("mlb batting choices are namespaced", prop.options[1].choices.some((c) => c.value.startsWith("mlb:b:")));
  ok("every choice is sport:group:key", prop.options[1].choices.every((c) => /^(mlb|nfl):(b|p):[A-Za-z]+$/.test(c.value)));
}

/* ── player resolution ── */
group("player resolution");
{
  const cl = mockClient();
  ok("exact match wins", (await findPlayer(cl, "Juan Soto")).id === 3);
  ok("case insensitive", (await findPlayer(cl, "aaron judge")).id === 1);
  ok("partial prefers shortest name", (await findPlayer(cl, "soto")).id === 3);
  ok("unknown returns null", (await findPlayer(cl, "zzzz")) === null);
  ok("whitespace trimmed", (await findPlayer(cl, "  judge ")).id === 1);
}

/* ── /player ── */
group("/player");
{
  const r = await handleCommand("player", D("player", { name: "Judge" }), mockClient());
  const t = textOf(r);
  ok("returns an embed", !!r.embeds && r.embeds.length === 1);
  ok("titles the player", /Aaron Judge/.test(t));
  ok("shows the team", /Yankees/.test(t));
  ok("reports game count", /24 games/.test(t));
  ok("includes a Last 5 field", /Last 5/.test(t));
  ok("no field value is empty", r.embeds[0].fields.every((f) => f.value && f.value.length));
  ok("embed fields within Discord's 25 cap", r.embeds[0].fields.length <= 25);
}
{
  const r = await handleCommand("player", D("player", { name: "nobody" }), mockClient());
  ok("unknown player is a clean error", /No MLB player matches/.test(textOf(r)));
}
{
  const empty = mockClient({ async gameLog() { return []; } });
  const r = await handleCommand("player", D("player", { name: "Judge" }), empty);
  ok("no games logged handled", /No 2026 games/.test(textOf(r)));
}

/* ── /prop ── */
group("/prop");
{
  const r = await handleCommand("prop", D("prop", { name: "Judge", market: "b:hits", line: 0.5 }), mockClient());
  const t = textOf(r);
  ok("titles player and market", /Aaron Judge · Hits 0.5/.test(t));
  ok("shows L5 L10 L20 Season", /L5/.test(t) && /L10/.test(t) && /L20/.test(t) && /Season/.test(t));
  ok("shows the confidence interval", /95% interval/.test(t));
  ok("references break-even", /52\.4%/.test(t));
  ok("renders a progress bar", /█|░/.test(t));
}
{
  const r = await handleCommand("prop", D("prop", { name: "Judge", market: "b:hits" }), mockClient());
  ok("line defaults when omitted", /Hits 0.5/.test(textOf(r)));
}
{
  const r = await handleCommand("prop", D("prop", { name: "Skenes", market: "p:strikeOuts", line: 5.5 }), mockClient());
  ok("pitcher market works", /Paul Skenes · Strikeouts 5.5/.test(textOf(r)));
}
{
  const r = await handleCommand("prop", D("prop", { name: "Judge", market: "p:strikeOuts" }), mockClient());
  ok("hitter rejected from pitching market", /isn't a pitcher/.test(textOf(r)));
}
{
  const r = await handleCommand("prop", D("prop", { name: "Skenes", market: "b:hits" }), mockClient());
  ok("pitcher rejected from batting market", /is a pitcher/.test(textOf(r)));
}
{
  const r = await handleCommand("prop", D("prop", { name: "Judge", market: "b:nonsense" }), mockClient());
  ok("unknown market rejected", /Unknown market/.test(textOf(r)));
}
{
  const r = await handleCommand("prop", D("prop", { name: "Judge", market: "b:hits", line: NaN }), mockClient());
  ok("non-numeric line rejected", /isn't a number/.test(textOf(r)));
}

/* ── /slate ── */
group("/slate");
{
  const r = await handleCommand("slate", D("slate"), mockClient());
  const t = textOf(r);
  ok("lists both games", /Red Sox @ Yankees/.test(t) && /Dodgers @ Padres/.test(t));
  ok("live game shows score", /4–2/.test(t));
  ok("live game shows state", /Top 6th/.test(t));
  ok("scheduled game shows ET time", /ET/.test(t));
  ok("probable pitchers listed", /Garrett Crochet/.test(t));
  ok("description under Discord's 4096 limit", r.embeds[0].description.length <= 4096);
}
{
  const r = await handleCommand("slate", D("slate"), mockClient({ async schedule() { return []; } }));
  ok("empty slate handled", /No games scheduled/.test(textOf(r)));
}

/* ── /parlay ── */
group("/parlay");
{
  const r = cmdParlay(D("parlay", { odds: "-110,-110" }));
  const t = textOf(r);
  ok("2-leg price is +264", /\+264/.test(t), t.slice(0, 200));
  ok("payout stated", /\$364\.46/.test(t));
  ok("hold stated as 8.9%", /8\.9%/.test(t));
  ok("EV is negative", /-8\.88/.test(t));
  ok("compares against a single bet", /single −110 bet holds/.test(t));
  ok("states the multiple", /2\.0×/.test(t), t.slice(-300));
}
{
  const r = cmdParlay(D("parlay", { odds: "-110 -110 -110 -110" }));
  ok("space separated accepted", /4-leg/.test(textOf(r)));
  ok("4-leg hold is 17.0%", /17\.0%/.test(textOf(r)), textOf(r).slice(0, 300));
}
{
  ok("plus sign accepted", /3-leg/.test(textOf(cmdParlay(D("parlay", { odds: "+150,+200,-110" })))));
  ok("empty rejected", /Give me some odds/.test(textOf(cmdParlay(D("parlay", { odds: "" })))));
  ok("garbage rejected", /isn't valid American odds/.test(textOf(cmdParlay(D("parlay", { odds: "abc" })))));
  for (const bad of ["-50", "0", "99", "-99", "1", "abc", "--110", "+"]) {
    ok(`bot rejects ${bad}`, /isn't valid American odds|Give me some odds/.test(textOf(cmdParlay(D("parlay", { odds: bad })))), bad);
  }
  ok("+100 accepted", /1-leg/.test(textOf(cmdParlay(D("parlay", { odds: "+100" })))));
  ok("-100 accepted", /1-leg/.test(textOf(cmdParlay(D("parlay", { odds: "-100" })))));
  ok("too many legs rejected", /15 legs is the limit/.test(textOf(cmdParlay(D("parlay", { odds: Array(16).fill("-110").join(",") })))));
  ok("single leg works", /1-leg/.test(textOf(cmdParlay(D("parlay", { odds: "-110" })))));
}

/* ── /catalog ── */
group("/catalog");
{
  const r = cmdCatalog(D("catalog", { sport: "mlb" }));
  ok("mlb has batting and pitching", /Batting/.test(textOf(r)) && /Pitching/.test(textOf(r)));
  ok("mlb marked live", /Live data available/.test(textOf(r)));
  const s = cmdCatalog(D("catalog", { sport: "soccer" }));
  ok("soccer catalog renders", /Shots on target/.test(textOf(s)));
  ok("soccer marked catalog-only", /not wired/.test(textOf(s)));
  ok("unknown sport rejected", /Unknown sport/.test(textOf(cmdCatalog(D("catalog", { sport: "cricket" })))));
  for (const k of Object.keys(C.PROP_CATALOG)) {
    const e = cmdCatalog(D("catalog", { sport: k }));
    ok(`catalog renders for ${k}`, !!e.embeds[0].fields.length);
    ok(`catalog field for ${k} within 1024 chars`, e.embeds[0].fields.every((f) => f.value.length <= 1024));
  }
}

/* ── unknown command & failure handling ── */
group("robustness");
{
  ok("unknown command handled", /Unknown command/.test(textOf(await handleCommand("nope", D("nope"), mockClient()))));
  const broken = mockClient({ async players() { throw new Error("HTTP 503"); } });
  const r = await handleCommand("player", D("player", { name: "Judge" }), broken);
  ok("upstream failure becomes a clean message", /Data source failed/.test(textOf(r)));
  ok("failure names the cause", /503/.test(textOf(r)));
}

/* ── signature verification ── */
group("signature verification");
{
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const rawPub = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
  const body = JSON.stringify({ type: 1 });
  const ts = "1700000000";
  const sig = crypto.sign(null, Buffer.from(ts + body), privateKey).toString("hex");

  ok("valid signature accepted", verify(Buffer.from(body), sig, ts, rawPub));
  ok("tampered body rejected", !verify(Buffer.from(body + " "), sig, ts, rawPub));
  ok("wrong timestamp rejected", !verify(Buffer.from(body), sig, "1700000001", rawPub));
  ok("bad signature rejected", !verify(Buffer.from(body), "00".repeat(64), ts, rawPub));
  ok("missing signature rejected", !verify(Buffer.from(body), "", ts, rawPub));
  ok("missing key rejected", !verify(Buffer.from(body), sig, ts, ""));
  ok("malformed hex rejected", !verify(Buffer.from(body), "zz", ts, rawPub));
  ok("wrong-length key rejected", !verify(Buffer.from(body), sig, ts, "aabb"));

  const other = crypto.generateKeyPairSync("ed25519");
  const otherPub = other.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
  ok("signature from another key rejected", !verify(Buffer.from(body), sig, ts, otherPub));
  ok("key parser accepts 32-byte hex", !!publicKeyFromHex(rawPub));

  /* ── live server: unsigned request must 401 ── */
  const { server } = require("../bot/bot.js");
  await new Promise((res) => server.listen(0, res));
  const port = server.address().port;
  const post = (path, payload, headers) => new Promise((resolve) => {
    const data = Buffer.from(payload);
    const req = http.request({ port, path, method: "POST",
      headers: Object.assign({ "content-type": "application/json", "content-length": data.length }, headers || {}) },
      (r) => { let b = ""; r.on("data", (c) => b += c); r.on("end", () => resolve({ status: r.statusCode, body: b })); });
    req.end(data);
  });
  const get = (path) => new Promise((resolve) => {
    http.get({ port, path }, (r) => { let b = ""; r.on("data", (c) => b += c); r.on("end", () => resolve({ status: r.statusCode, body: b })); });
  });

  const unsigned = await post("/interactions", body);
  ok("unsigned interaction is 401", unsigned.status === 401, String(unsigned.status));
  const forged = await post("/interactions", body, { "x-signature-ed25519": "00".repeat(64), "x-signature-timestamp": ts });
  ok("forged signature is 401", forged.status === 401, String(forged.status));
  const health = await get("/health");
  ok("health endpoint responds", health.status === 200 && /courvix-bot/.test(health.body));
  const notfound = await post("/nope", body);
  ok("unknown path is 404", notfound.status === 404);
  await new Promise((res) => server.close(res));
}

/* ── NFL commands ── */
group("nfl commands");
{
  const cf = clientForFactory(mockClient(), nflClient());
  const r = await handleCommand("player", D("player", { name: "Mahomes", sport: "nfl" }), null, cf);
  const t = textOf(r);
  ok("nfl player resolves", /Patrick Mahomes/.test(t), t.slice(0, 200));
  ok("position shown", /\(QB\)/.test(t));
  ok("passing markets listed for a QB", /Passing yards/.test(t));
  ok("receptions not listed for a QB", !/"name":"Receptions"/.test(t));
  ok("season stated", /2025 season/.test(t));
}
{
  const cf = clientForFactory(mockClient(), nflClient());
  const r = await handleCommand("prop", D("prop", { name: "Mahomes", market: "nfl:b:passYds", line: 249.5, sport: "nfl" }), null, cf);
  const t = textOf(r);
  ok("nfl prop renders", /Patrick Mahomes · Passing yards 249.5/.test(t), t.slice(0, 200));
  ok("nfl prop shows the interval", /95% interval/.test(t));
  ok("nfl prop shows break-even", /52\.4%/.test(t));
}
{
  const cf = clientForFactory(mockClient(), nflClient());
  const r = await handleCommand("prop", D("prop", { name: "Rice", market: "nfl:b:passYds", sport: "nfl" }), null, cf);
  ok("WR rejected from a passing market", /isn't offered for that position/.test(textOf(r)), textOf(r).slice(0, 220));
  const ok2 = await handleCommand("prop", D("prop", { name: "Rice", market: "nfl:b:rec", sport: "nfl" }), null, cf);
  ok("WR accepted for receptions", /Rashee Rice · Receptions/.test(textOf(ok2)), textOf(ok2).slice(0, 160));
  const k = await handleCommand("prop", D("prop", { name: "Butker", market: "nfl:b:rec", sport: "nfl" }), null, cf);
  ok("kicker rejected from every market", /isn't offered for that position/.test(textOf(k)));
}
{
  const cf = clientForFactory(mockClient(), nflClient());
  const r = await handleCommand("prop", D("prop", { name: "Mahomes", market: "mlb:b:hits", sport: "nfl" }), null, cf);
  ok("cross-sport market mismatch is caught", /Set `sport` to match/.test(textOf(r)), textOf(r).slice(0, 220));
}
{
  const cf = clientForFactory(mockClient(), nflClient());
  const r = await handleCommand("slate", D("slate", { sport: "nfl" }), null, cf);
  const t = textOf(r);
  ok("nfl slate says this week", /This week's slate/.test(t), t.slice(0, 160));
  ok("nfl slate lists the game", /Ravens @ Chiefs/.test(t));
  const m = await handleCommand("slate", D("slate", {}), null, cf);
  ok("mlb slate still says today", /Today's slate/.test(textOf(m)));
}
{
  const cf = clientForFactory(mockClient(), nflClient());
  ok("no sport option defaults to MLB",
     /Aaron Judge/.test(textOf(await handleCommand("player", D("player", { name: "Judge" }), null, cf))));
  ok("legacy market format still works",
     /Aaron Judge · Hits/.test(textOf(await handleCommand("prop", D("prop", { name: "Judge", market: "b:hits" }), null, cf))));
  ok("namespaced mlb market works",
     /Aaron Judge · Hits/.test(textOf(await handleCommand("prop", D("prop", { name: "Judge", market: "mlb:b:hits" }), null, cf))));
}
{
  const nflCat = cmdCatalog(D("catalog", { sport: "nfl" }));
  ok("nfl catalog marked live", /Live data available/.test(textOf(nflCat)));
  ok("nfl catalog lists passing yards", /Passing yards/.test(textOf(nflCat)));
}
{
  const prop = DEFINITIONS.find((d) => d.name === "prop");
  ok("market choices still within the 25 cap", prop.options[1].choices.length <= 25,
     String(prop.options[1].choices.length));
  ok("nfl markets present in choices", prop.options[1].choices.some((c) => c.value.startsWith("nfl:")));
  ok("mlb markets present in choices", prop.options[1].choices.some((c) => c.value.startsWith("mlb:")));
  ok("choice values unique", new Set(prop.options[1].choices.map((c) => c.value)).size === prop.options[1].choices.length);
  ok("choice names within 100 chars", prop.options[1].choices.every((c) => c.name.length <= 100));
  const sportOpt = prop.options.find((o) => o.name === "sport");
  ok("sport option exists and is optional", sportOpt && !sportOpt.required);
  ok("player command has a sport option", DEFINITIONS.find((d) => d.name === "player").options.some((o) => o.name === "sport"));
  ok("slate command has a sport option", DEFINITIONS.find((d) => d.name === "slate").options.some((o) => o.name === "sport"));
  ok("required options still precede optional ones",
     DEFINITIONS.every((d) => { const o = d.options || []; let seen = false;
       return o.every((x) => { if (!x.required) seen = true; return !(x.required && seen); }); }));
}

/* ── worker build ── */
group("cloudflare worker build");
{
  const fs = require("fs"), path = require("path"), vm = require("vm");
  const src = fs.readFileSync(path.join(__dirname, "..", "bot", "worker.js"), "utf8");
  // strip module syntax so the body can be syntax-checked in a plain Script
  const body = src.replace(/^\s*import\s.*$/gm, "").replace(/export\s+default\s*/, "const __handler = ");
  let syntaxErr = null;
  try { new vm.Script("(function(){" + body + "})"); } catch (e) { syntaxErr = String(e); }
  ok("worker body is syntactically valid", syntaxErr === null, syntaxErr || "");
  ok("worker guards CJS/ESM interop", /CoreNS\.makeClient/.test(src) && /CoreNS\.default/.test(src));
  ok("worker verifies signatures", /crypto\.subtle\.verify/.test(src));
  ok("worker rejects wrong signature lengths", /sigHex\.length !== 128/.test(src));
  ok("worker rejects wrong key lengths", /pubHex\.length !== 64/.test(src));
  ok("worker shares handleCommand with the node bot", /handleCommand/.test(src) && /commands\.js/.test(src));
  ok("worker builds a client per sport", /clientFor/.test(src) && /makeClientFor/.test(src));
  ok("worker has a health route", /\/health/.test(src));
  ok("worker 401s unverified requests", /status:\s*401/.test(src));
}

/* ── routing ── */
group("interaction routing");
{
  ok("PING returns PONG", (await route({ type: 1 }, mockClient())).type === 1);
  const r = await route({ type: 2, data: D("parlay", { odds: "-110,-110" }) }, mockClient());
  ok("command returns type 4", r.type === 4);
  ok("command carries embeds", !!r.data.embeds);
  ok("unknown interaction type is safe", (await route({ type: 99 }, mockClient())).type === 1);
}

console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
if (fail) { console.log("\x1b[31mFAILURES:\x1b[0m"); fails.forEach((f) => console.log("  ✗ " + f)); process.exit(1); }
console.log("\x1b[32mAll bot tests pass.\x1b[0m");
})();
