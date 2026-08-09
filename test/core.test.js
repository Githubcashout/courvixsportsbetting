/* Courvix core test suite — zero dependencies, run: node test/core.test.js */
const C = require("../core.js");

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; } else { fail++; fails.push(name + (detail ? "  → " + detail : "")); }
}
function near(name, got, want, tol) {
  tol = tol == null ? 1e-9 : tol;
  const good = isFinite(got) && Math.abs(got - want) <= tol;
  ok(name, good, `got ${got}, want ${want} (±${tol})`);
}
function group(t) { console.log("\n\x1b[1m" + t + "\x1b[0m"); }

/* ── 1. odds conversion ───────────────────────────────── */
group("odds conversion");
near("−110 → decimal 1.9091", C.americanToDecimal(-110), 1.9090909091, 1e-9);
near("+150 → decimal 2.50",   C.americanToDecimal(150), 2.5);
near("+100 → decimal 2.00",   C.americanToDecimal(100), 2);
near("−200 → decimal 1.50",   C.americanToDecimal(-200), 1.5);
near("decimal 2.5 → +150",    C.decimalToAmerican(2.5), 150);
near("decimal 1.5 → −200",    C.decimalToAmerican(1.5), -200);
near("decimal 2.0 → +100",    C.decimalToAmerican(2), 100);
near("−110 implied 52.38%",   C.americanToImplied(-110), 0.5238095238, 1e-9);
near("+150 implied 40%",      C.americanToImplied(150), 0.4);
near("+100 implied 50%",      C.americanToImplied(100), 0.5);

// round trips
for (const a of [-500, -250, -110, -105, 100, 120, 250, 900]) {
  near(`round trip ${a}`, C.decimalToAmerican(C.americanToDecimal(a)), a, 0.6);
}
ok("american 0 is invalid", !isFinite(C.americanToDecimal(0)));
// American odds are undefined strictly between -100 and +100
for (const bad of [0, 1, -1, 5, -5, 99, -99, 99.9, -99.9, NaN, Infinity, "abc", null, undefined]) {
  ok(`price ${String(bad)} rejected by americanToDecimal`, !isFinite(C.americanToDecimal(bad)));
  ok(`price ${String(bad)} rejected by americanToImplied`, !isFinite(C.americanToImplied(bad)));
  ok(`price ${String(bad)} rejected by isValidAmerican`, !C.isValidAmerican(bad));
}
for (const good of [100, -100, 105, -105, -110, 250, -2000]) {
  ok(`price ${good} accepted`, C.isValidAmerican(good) && isFinite(C.americanToDecimal(good)));
}
ok("a -1 price can no longer produce a payout", !isFinite(C.parlay([{ american: -1 }, { american: -110 }]).decimal));
ok("one invalid leg poisons the whole parlay", !isFinite(C.parlay([{ american: -110 }, { american: 50 }]).ev));
near("-100 and +100 are the same price", C.americanToDecimal(-100), C.americanToDecimal(100), 1e-12);
// decimalToAmerican must never emit a price inside the forbidden band
for (let d = 1.01; d < 12; d += 0.01) {
  const a = C.decimalToAmerican(d);
  if (isFinite(a) && Math.abs(a) < 100) { ok(`decimalToAmerican(${d.toFixed(2)}) stays outside the band`, false, String(a)); break; }
}
ok("decimalToAmerican never emits an invalid band price", true);
ok("decimal 1.0 is invalid", !isFinite(C.decimalToAmerican(1)));
ok("formatAmerican adds +", C.formatAmerican(150) === "+150");
ok("formatAmerican keeps −", C.formatAmerican(-110) === "-110");

/* ── 2. de-vig & hold ─────────────────────────────────── */
group("de-vig and hold");
near("−110/−110 hold ≈ 4.55%", C.marketHold(-110, -110), 0.0454545455, 1e-9);
near("−120/+100 hold",         C.marketHold(-120, 100), 1 - 1 / (0.5454545455 + 0.5), 1e-9);
{
  const [a, b] = C.devigProportional(0.5238095238, 0.5238095238);
  near("symmetric proportional → 50%", a, 0.5, 1e-9);
  near("proportional sums to 1", a + b, 1, 1e-12);
}
{
  const [a, b] = C.devigPower(0.5238095238, 0.5238095238);
  near("symmetric power → 50%", a, 0.5, 1e-6);
  near("power sums to 1", a + b, 1, 1e-6);
}
{
  // asymmetric: power should sum to 1 and stay between the naive and raw values
  const qa = C.americanToImplied(-300), qb = C.americanToImplied(240);
  const [pa, pb] = C.devigPower(qa, qb);
  near("asymmetric power sums to 1", pa + pb, 1, 1e-6);
  ok("power favourite below raw implied", pa < qa, `${pa} vs ${qa}`);
  ok("power favourite above 0.5", pa > 0.5);
  const [ra] = C.devigProportional(qa, qb);
  ok("power differs from proportional on skewed market", Math.abs(pa - ra) > 1e-6);
}
near("fairProbability symmetric −110", C.fairProbability(-110, -110), 0.5, 1e-6);
ok("no-vig market unchanged", Math.abs(C.devigPower(0.5, 0.5)[0] - 0.5) < 1e-9);

/* ── 3. hit rates ─────────────────────────────────────── */
group("hit rates");
{
  const v = [2, 0, 1, 3, 0, 1, 2, 0, 1, 1]; // newest first
  const r10 = C.hitRate(v, 0.5, 10);
  ok("L10 counts n", r10.n === 10);
  ok("L10 over count", r10.over === 7, `over=${r10.over}`);
  ok("L10 under count", r10.under === 3, `under=${r10.under}`);
  near("L10 rate 70%", r10.rate, 0.7, 1e-12);
  const r5 = C.hitRate(v, 0.5, 5);
  ok("L5 uses newest 5", r5.n === 5 && r5.over === 3, `over=${r5.over}`);
  const rAll = C.hitRate(v, 0.5);
  ok("no window = all games", rAll.n === 10);
}
{
  // pushes must be excluded from the denominator, not counted as losses
  const r = C.hitRate([2, 2, 1, 3], 2, 4);
  ok("push counted", r.push === 2, `push=${r.push}`);
  ok("push excluded from rate", r.over === 1 && r.under === 1);
  near("rate with pushes = 50%", r.rate, 0.5, 1e-12);
}
{
  const r = C.hitRate([], 0.5, 10);
  ok("empty series is safe", r.n === 0 && !isFinite(r.rate));
}
{
  const w = C.wilson(7, 10);
  ok("wilson lower < p", w[0] < 0.7);
  ok("wilson upper > p", w[1] > 0.7);
  ok("wilson inside [0,1]", w[0] >= 0 && w[1] <= 1);
  const wide = C.wilson(7, 10), tight = C.wilson(700, 1000);
  ok("wilson narrows with n", (tight[1] - tight[0]) < (wide[1] - wide[0]));
}
{
  const r = C.hitRate([1, NaN, 2, undefined, 0], 0.5);
  ok("non-numeric values skipped", r.over === 2 && r.under === 1, JSON.stringify(r));
}

/* ── 4. parlay math ───────────────────────────────────── */
group("parlay math");
{
  const p = C.parlay([{ american: -110 }, { american: -110 }]);
  near("2-leg −110 decimal", p.decimal, 1.9090909091 ** 2, 1e-9);
  near("2-leg fair prob 25%", p.fairProb, 0.25, 1e-6);
  near("2-leg payout +264", p.american, 264, 1);
  near("2-leg hold 8.9%", p.hold, 1 - 0.25 * 1.9090909091 ** 2, 1e-6);
  ok("2-leg hold exceeds single-leg hold", p.hold > C.marketHold(-110, -110));
}
{
  const p4 = C.parlay([-110, -110, -110, -110].map((a) => ({ american: a })));
  near("4-leg fair prob 6.25%", p4.fairProb, 0.0625, 1e-6);
  near("4-leg decimal", p4.decimal, 1.9090909091 ** 4, 1e-9);
  near("4-leg hold = 16.9793%", p4.hold, 0.16979305, 1e-6);
  ok("4-leg EV is negative", p4.ev < 0);
  near("EV equals negative hold", p4.ev, -p4.hold, 1e-12);
}
{
  // hold must grow monotonically with leg count at a fixed price
  let prev = -Infinity;
  for (let n = 1; n <= 8; n++) {
    const p = C.parlay(Array(n).fill({ american: -110 }));
    ok(`hold grows at ${n} legs`, p.hold > prev - 1e-12, `hold=${p.hold}`);
    prev = p.hold;
  }
}
{
  // a genuinely +EV set of legs must produce positive parlay EV
  const p = C.parlay([{ american: 120, fairProb: 0.5 }, { american: 120, fairProb: 0.5 }]);
  ok("+EV legs give +EV parlay", p.ev > 0, `ev=${p.ev}`);
  near("fair prob multiplies", p.fairProb, 0.25, 1e-12);
}
{
  const p = C.parlay([]);
  ok("empty parlay is safe", p.n === 0 && !isFinite(p.decimal));
  const bad = C.parlay([{ american: 0 }]);
  ok("invalid price is safe", !isFinite(bad.decimal));
}
{
  const p1 = C.parlay([{ american: -110 }]);
  near("1-leg hold = market hold", p1.hold, C.marketHold(-110, -110), 1e-6);
  near("1-leg payout per $100", p1.payoutPer100, 90.909090909, 1e-6);
}

/* ── 5. correlation ───────────────────────────────────── */
group("correlation detection");
{
  const legs = [
    { playerId: 1, playerName: "A", gameId: 10, teamId: 5, propKey: "hits", side: "over", group: "batting" },
    { playerId: 1, playerName: "A", gameId: 10, teamId: 5, propKey: "hits", side: "under", group: "batting" }
  ];
  const is = C.correlationIssues(legs);
  ok("over+under same prop blocked", is.some((i) => i.level === "block"));
  ok("contradiction message", is.some((i) => /never win/.test(i.message)));
}
{
  const legs = [
    { playerId: 1, playerName: "A", gameId: 10, teamId: 5, propKey: "hits", side: "over", group: "batting" },
    { playerId: 1, playerName: "A", gameId: 10, teamId: 5, propKey: "runs", side: "over", group: "batting" }
  ];
  ok("two legs same player blocked", C.correlationIssues(legs).some((i) => i.level === "block"));
}
{
  const legs = [
    { playerId: 1, playerName: "A", gameId: 10, teamId: 5, propKey: "hits", side: "over", group: "batting" },
    { playerId: 2, playerName: "B", gameId: 10, teamId: 6, propKey: "runs", side: "over", group: "batting" }
  ];
  const is = C.correlationIssues(legs);
  ok("same game warns", is.some((i) => i.level === "warn"));
  ok("single-game note present", is.some((i) => i.level === "note"));
}
{
  const legs = [
    { playerId: 3, playerName: "P", gameId: 11, teamId: 7, propKey: "strikeOuts", side: "over", group: "pitching" },
    { playerId: 4, playerName: "H", gameId: 11, teamId: 8, propKey: "hits", side: "over", group: "batting" }
  ];
  ok("pitcher K vs batter hits flagged negative",
     C.correlationIssues(legs).some((i) => /negatively correlated/.test(i.message)));
}
{
  const legs = [
    { playerId: 1, playerName: "A", gameId: 10, teamId: 5, propKey: "hits", side: "over", group: "batting" },
    { playerId: 2, playerName: "B", gameId: 20, teamId: 6, propKey: "runs", side: "over", group: "batting" }
  ];
  ok("different games are clean", C.correlationIssues(legs).length === 0);
}
ok("single leg has no issues", C.correlationIssues([{ playerId: 1, gameId: 1 }]).length === 0);
ok("empty legs safe", C.correlationIssues([]).length === 0);

/* ── 6. CLV ───────────────────────────────────────────── */
group("closing line value");
near("beat the close = positive", C.clv(0.50, 0.53), 0.03, 1e-12);
near("worse than close = negative", C.clv(0.55, 0.52), -0.03, 1e-12);
{
  const m = C.meanCLV([{ clv: 0.01 }, { clv: 0.03 }, { clv: -0.01 }, { clv: 0.02 }]);
  ok("meanCLV n", m.n === 4);
  near("meanCLV mean", m.mean, 0.0125, 1e-12);
  ok("stdErr positive", m.stdErr > 0);
  ok("tStat positive when mean positive", m.tStat > 0);
}
{
  const m = C.meanCLV([]);
  ok("empty CLV safe", m.n === 0 && !isFinite(m.mean));
  const one = C.meanCLV([{ clv: 0.02 }]);
  ok("single CLV entry safe", one.n === 1 && !isFinite(one.stdErr));
}

/* ── 7. catalog & interest ────────────────────────────── */
group("prop catalog");
ok("mlb batting props exist", C.propsFor("mlb", "batting").length >= 8);
ok("mlb pitching props exist", C.propsFor("mlb", "pitching").length >= 5);
ok("nba props exist", C.propsFor("nba", "batting").length >= 6);
ok("soccer props exist", C.propsFor("soccer", "batting").length >= 6);
ok("unknown sport safe", C.propsFor("cricket", "batting").length === 0);
{
  const bad = C.propsFor("mlb", "batting").filter((p) => !isFinite(p.d) || !p.n || !p.k);
  ok("every mlb prop has key, name, default line", bad.length === 0, JSON.stringify(bad));
  const halves = C.propsFor("mlb", "batting").filter((p) => (p.d * 2) % 2 === 0);
  ok("default lines avoid pushes (all .5)", halves.length === 0);
}
{
  const hits = C.propsFor("mlb", "batting").find((p) => p.k === "hits");
  ok("hits extractor works", hits.f({ hits: 3 }) === 3);
  ok("hits extractor handles missing", hits.f({}) === 0);
  const hrr = C.propsFor("mlb", "batting").find((p) => p.k === "hrr");
  ok("H+R+RBI sums", hrr.f({ hits: 1, runs: 2, rbi: 3 }) === 6);
  const outs = C.propsFor("mlb", "pitching").find((p) => p.k === "outs");
  ok("innings 6.2 → 20 outs", outs.f({ inningsPitched: "6.2" }) === 20, String(outs.f({ inningsPitched: "6.2" })));
  ok("innings 6.0 → 18 outs", outs.f({ inningsPitched: "6.0" }) === 18);
  ok("innings 6.1 → 19 outs", outs.f({ inningsPitched: "6.1" }) === 19);
  ok("innings 7 → 21 outs", outs.f({ inningsPitched: "7" }) === 21);
  ok("innings 0.1 → 1 out", outs.f({ inningsPitched: "0.1" }) === 1);
  ok("innings missing → 0", outs.f({}) === 0);
  ok("innings numeric 5.2 → 17", C.inningsToOuts(5.2) === 17, String(C.inningsToOuts(5.2)));
}
group("interest score");
ok("rank 1 beats rank 20",
   C.interestScore({ leaderRank: 1, categories: 1, playingToday: true }) >
   C.interestScore({ leaderRank: 20, categories: 1, playingToday: true }));
ok("playing today beats idle",
   C.interestScore({ leaderRank: 5, categories: 1, playingToday: true }) >
   C.interestScore({ leaderRank: 5, categories: 1, playingToday: false }));
ok("multi-category beats single",
   C.interestScore({ leaderRank: 5, categories: 3, playingToday: true }) >
   C.interestScore({ leaderRank: 5, categories: 1, playingToday: true }));
ok("missing rank is finite", isFinite(C.interestScore({})));

/* ── 7b. NFL props, stats and season logic ───────────── */
group("nfl props and position gating");
{
  const byPos = (p) => C.propsForPlayer("nfl", { pos: p }).map((x) => x.k);
  ok("QB gets passing markets", byPos("QB").includes("passYds") && byPos("QB").includes("passTd"));
  ok("QB does not get receptions", !byPos("QB").includes("rec"));
  ok("WR gets receiving markets", byPos("WR").includes("recYds") && byPos("WR").includes("rec"));
  ok("WR does not get passing yards", !byPos("WR").includes("passYds"));
  ok("TE does not get rush attempts", !byPos("TE").includes("rushAtt"));
  ok("RB gets rush and rec", byPos("RB").includes("rushYds") && byPos("RB").includes("rec"));
  ok("kicker gets nothing", byPos("K").length === 0);
  ok("lowercase position works", C.propsForPlayer("nfl", { pos: "qb" }).length === byPos("QB").length);
  ok("unknown position gets nothing", C.propsForPlayer("nfl", { pos: "LB" }).length === 0);
  ok("missing position falls back to all", C.propsForPlayer("nfl", {}).length === C.propsFor("nfl", "batting").length);
  ok("mlb routing still works", C.propsForPlayer("mlb", { pitcher: true }).some((p) => p.k === "outs"));
  ok("every nfl prop has an extractor", C.propsFor("nfl", "batting").every((p) => typeof p.f === "function"));
  ok("every nfl default line avoids pushes", C.propsFor("nfl", "batting").every((p) => (p.d * 2) % 2 !== 0));
}
group("nfl stat normalisation");
{
  const full = C.normalizeNflStats(
    ["completions/passingAttempts", "passingYards", "passingTouchdowns", "interceptions"],
    ["24/35", "280", "2", "1"]);
  ok("full names parse compound C/ATT", full.passCmp === 24 && full.passAtt === 35, JSON.stringify(full));
  ok("full names parse yards", full.passYds === 280);
  ok("full names parse ints", full.int === 1);

  const short = C.normalizeNflStats(["C/ATT", "YDS", "TD", "INT"], ["24/35", "280", "2", "1"], "passing");
  ok("short labels resolve with a passing category", short.passYds === 280 && short.passTd === 2, JSON.stringify(short));
  const rush = C.normalizeNflStats(["CAR", "YDS", "TD"], ["18", "96", "1"], "rushing");
  ok("same YDS label means rushing in a rushing block", rush.rushYds === 96 && rush.rushTd === 1, JSON.stringify(rush));
  const recv = C.normalizeNflStats(["REC", "YDS", "TD", "TGTS"], ["7", "112", "1", "10"], "receiving");
  ok("same YDS label means receiving in a receiving block", recv.recYds === 112 && recv.rec === 7, JSON.stringify(recv));
  ok("ambiguous label without a category is dropped, not guessed",
     C.normalizeNflStats(["YDS"], ["100"]).recYds === undefined &&
     C.normalizeNflStats(["YDS"], ["100"]).rushYds === undefined);
  ok("thousands separators parse", C.normalizeNflStats(["passingYards"], ["1,280"]).passYds === 1280);
  ok("non-numeric becomes 0", C.normalizeNflStats(["passingYards"], ["--"]).passYds === 0);
  ok("mismatched arrays are safe", Object.keys(C.normalizeNflStats(["a", "b"], [])).length === 0);
  ok("null input is safe", Object.keys(C.normalizeNflStats(null, null)).length === 0);
  ok("splitCompound rejects plain numbers", C.splitCompound("24") === null);
  ok("splitCompound reads 24/35", C.splitCompound("24/35").a === 24);
}
group("nfl prop extractors");
{
  const get = (k) => C.propsFor("nfl", "batting").find((p) => p.k === k);
  const stat = { passYds: 280, passTd: 2, rushYds: 30, rushTd: 1, recYds: 0, recTd: 0, rec: 0 };
  ok("passYds extractor", get("passYds").f(stat) === 280);
  ok("anytimeTd sums rush and rec TDs", get("anytimeTd").f({ rushTd: 1, recTd: 2 }) === 3);
  ok("anytimeTd ignores passing TDs", get("anytimeTd").f({ passTd: 4 }) === 0);
  ok("rushRecYds sums both", get("rushRecYds").f({ rushYds: 40, recYds: 25 }) === 65);
  ok("missing stats are 0 not NaN", get("recYds").f({}) === 0);
}
group("nfl season rollover");
{
  ok("August 2026 shows the 2025 season", C.nflSeasonFor(new Date(2026, 7, 8)) === 2025);
  ok("September 2026 shows the 2026 season", C.nflSeasonFor(new Date(2026, 8, 20)) === 2026);
  ok("January 2027 still shows the 2026 season", C.nflSeasonFor(new Date(2027, 0, 15)) === 2026);
  ok("February playoffs stay on the prior season", C.nflSeasonFor(new Date(2027, 1, 8)) === 2026);
  ok("week 1 2026 is Thu Sep 10", C.nflWeekOneApprox(2026).getMonth() === 8 && C.nflWeekOneApprox(2026).getDate() === 10,
     C.nflWeekOneApprox(2026).toDateString());
  ok("week 1 2025 is Thu Sep 4", C.nflWeekOneApprox(2025).getDate() === 4, C.nflWeekOneApprox(2025).toDateString());
  // the offseason runs March through the Wednesday before Week 1
  ok("August is offseason", C.nflSeasonHasStarted(new Date(2026, 7, 8)) === false);
  ok("March is offseason", C.nflSeasonHasStarted(new Date(2026, 2, 1)) === false);
  ok("June is offseason", C.nflSeasonHasStarted(new Date(2026, 5, 15)) === false);
  ok("Sep 9 2026 is still offseason", C.nflSeasonHasStarted(new Date(2026, 8, 9)) === false);
  ok("Sep 10 2026 is in season", C.nflSeasonHasStarted(new Date(2026, 8, 10)) === true);
  ok("November is in season", C.nflSeasonHasStarted(new Date(2026, 10, 1)) === true);
  ok("January is in season (playoffs)", C.nflSeasonHasStarted(new Date(2027, 0, 10)) === true);
  ok("February is in season (Super Bowl)", C.nflSeasonHasStarted(new Date(2027, 1, 7)) === true);
  for (const y of [2024, 2025, 2026, 2027, 2028]) {
    const d = C.nflWeekOneApprox(y);
    ok(`week 1 ${y} falls on a Thursday`, d.getDay() === 4, d.toDateString());
    ok(`week 1 ${y} is between Sep 4 and Sep 11`, d.getDate() >= 4 && d.getDate() <= 11, d.toDateString());
  }
}
group("espn game log parsing");
{
  const json = {
    names: ["completions/passingAttempts", "passingYards", "passingTouchdowns", "interceptions"],
    events: {
      "401A": { gameDate: "2025-09-07T17:00Z", week: 1, homeAway: "home", opponent: { displayName: "Ravens" } },
      "401B": { gameDate: "2025-09-14T17:00Z", week: 2, homeAway: "away", opponent: { displayName: "Bills" } }
    },
    seasonTypes: [
      { displayName: "2025 Preseason", categories: [{ type: "passing", events: [
        { eventId: "401Z", stats: ["5/8", "40", "0", "0"] }] }] },
      { displayName: "2025 Regular Season", categories: [{ type: "passing", events: [
        { eventId: "401A", stats: ["24/35", "280", "2", "1"] },
        { eventId: "401B", stats: ["19/30", "210", "1", "0"] }] }] }
    ]
  };
  const rows = C.parseEspnGameLog(json);
  ok("preseason excluded by default", rows.length === 2, String(rows.length));
  ok("newest game first", rows[0].date === "2025-09-14", rows[0].date);
  ok("stats normalised", rows[0].stat.passYds === 210);
  ok("home/away read", rows[1].home === true && rows[0].home === false);
  ok("opponent read", rows[0].opp === "Bills");
  ok("week carried", rows[1].week === 1);
  ok("gameId carried", rows[0].gameId === "401B");
  const withPre = C.parseEspnGameLog(json, { includePreseason: true });
  ok("preseason included on request", withPre.length === 3, String(withPre.length));

  // two categories for the same event must merge, not duplicate
  const rb = {
    events: { "500A": { gameDate: "2025-10-05T17:00Z", week: 5, homeAway: "home", opponent: { displayName: "Jets" } } },
    seasonTypes: [{ displayName: "2025 Regular Season", categories: [
      { type: "rushing",   names: ["CAR", "YDS", "TD"],  events: [{ eventId: "500A", stats: ["18", "96", "1"] }] },
      { type: "receiving", names: ["REC", "YDS", "TD"],  events: [{ eventId: "500A", stats: ["4", "31", "0"] }] }
    ] }]
  };
  const merged = C.parseEspnGameLog(rb);
  ok("one row per game across categories", merged.length === 1, String(merged.length));
  ok("rushing merged", merged[0].stat.rushYds === 96);
  ok("receiving merged without clobbering", merged[0].stat.recYds === 31, JSON.stringify(merged[0].stat));
  ok("combined prop reads both", C.propsFor("nfl", "batting").find((p) => p.k === "rushRecYds").f(merged[0].stat) === 127);

  ok("empty json is safe", C.parseEspnGameLog({}).length === 0);
  ok("null json is safe", C.parseEspnGameLog(null).length === 0);
  ok("missing events map is safe", C.parseEspnGameLog({ seasonTypes: [{ displayName: "2025 Regular Season",
      categories: [{ type: "passing", names: ["passingYards"], events: [{ eventId: "X", stats: ["10"] }] }] }] }).length === 1);
}
group("espn game normalisation");
{
  const g = C.normalizeEspnGame({
    id: "401", date: "2026-09-10T00:20Z", week: { number: 1 },
    status: { type: { state: "pre", shortDetail: "Thu 8:20 PM" } },
    competitions: [{ competitors: [
      { homeAway: "home", score: "0", team: { id: "12", shortDisplayName: "Chiefs", displayName: "Kansas City Chiefs" } },
      { homeAway: "away", score: "0", team: { id: "17", shortDisplayName: "Ravens", displayName: "Baltimore Ravens" } }] }]
  });
  ok("id read", g.gamePk === "401");
  ok("short names used", g.home.name === "Chiefs" && g.away.name === "Ravens");
  ok("team ids kept as strings", g.home.id === "12");
  ok("pre maps to Preview", g.state === "Preview");
  ok("week read", g.week === 1);
  const live = C.normalizeEspnGame({ id: "9", status: { type: { state: "in", shortDetail: "Q3 4:11" } },
    competitions: [{ competitors: [{ homeAway: "home", score: "17", team: { id: "1", name: "A" } },
                                   { homeAway: "away", score: "10", team: { id: "2", name: "B" } }] }] });
  ok("in maps to Live", live.state === "Live");
  ok("scores parsed as numbers", live.home.score === 17 && live.away.score === 10);
  const post = C.normalizeEspnGame({ id: "8", status: { type: { state: "post", shortDetail: "Final" } }, competitions: [{}] });
  ok("post maps to Final", post.state === "Final");
  ok("missing competitors are safe", post.home.name === "" && post.away.name === "");
  ok("garbage input is safe", !!C.normalizeEspnGame({}));
}
group("sport registry");
{
  ok("mlb and nfl registered", !!C.SPORT_ADAPTERS.mlb && !!C.SPORT_ADAPTERS.nfl);
  ok("both marked live", C.SPORT_ADAPTERS.mlb.live && C.SPORT_ADAPTERS.nfl.live);
  ok("each has leader categories", C.SPORT_ADAPTERS.mlb.leaderCategories.length === 4 &&
     C.SPORT_ADAPTERS.nfl.leaderCategories.length === 4);
  ok("nfl leader props exist in the catalog", C.SPORT_ADAPTERS.nfl.leaderCategories.every(
     (c) => C.propsFor("nfl", "batting").some((p) => p.k === c.prop)));
  ok("mlb leader props exist in the catalog", C.SPORT_ADAPTERS.mlb.leaderCategories.every(
     (c) => C.propsFor("mlb", c.group).some((p) => p.k === c.prop)));
  ok("makeClientFor builds mlb", C.makeClientFor("mlb", { fetch: async () => ({ ok: true, json: async () => ({}) }) }).season > 2000);
  ok("makeClientFor builds nfl", C.makeClientFor("nfl", { fetch: async () => ({ ok: true, json: async () => ({}) }) }).sport === "nfl");
  let threw = false;
  try { C.makeClientFor("cricket", {}); } catch (e) { threw = true; }
  ok("unknown sport throws", threw);
}

/* ── 8. client normalisation (mocked fetch) ───────────── */
group("data client");
{
  const routes = {
    "/schedule": { dates: [{ games: [{
      gamePk: 777, gameDate: "2026-08-08T23:05:00Z",
      status: { abstractGameState: "Preview", detailedState: "Scheduled" },
      teams: {
        away: { team: { id: 111, name: "Boston Red Sox", clubName: "Red Sox" }, probablePitcher: { fullName: "G Crochet" } },
        home: { team: { id: 147, name: "New York Yankees" }, score: 3 }
      } }] }] },
    "/sports/1/players": { people: [
      { id: 1, fullName: "A Judge", primaryPosition: { abbreviation: "RF", code: "9" }, currentTeam: { id: 147, name: "New York Yankees" } },
      { id: 2, fullName: "P Skenes", primaryPosition: { abbreviation: "P", code: "1" }, currentTeam: { id: 134, name: "Pittsburgh Pirates" } }
    ] },
    "/people/1/stats": { stats: [{ splits: [
      { date: "2026-08-01", isHome: true, opponent: { name: "Rays" }, stat: { hits: 1 } },
      { date: "2026-08-02", isHome: false, opponent: { name: "Rays" }, stat: { hits: 2 } }
    ] }] },
    "/stats/leaders": { leagueLeaders: [{ leaders: [
      { rank: "1", person: { id: 1, fullName: "A Judge" }, team: { id: 147, name: "New York Yankees" }, value: "41" }
    ] }] }
  };
  const fakeFetch = async (url) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    return { ok: !!key, status: key ? 200 : 404, json: async () => routes[key] || {} };
  };
  const cl = C.makeClient({ fetch: fakeFetch, season: 2026 });

  (async () => {
    const g = (await cl.schedule("2026-08-08"))[0];
    ok("gamePk parsed", g.gamePk === 777);
    ok("clubName preferred", g.away.name === "Red Sox", g.away.name);
    ok("city stripped when clubName absent", g.home.name === "Yankees", g.home.name);
    ok("team id kept", g.home.id === 147);
    ok("probable pitcher parsed", g.away.pitcher === "G Crochet");

    const ps = await cl.players();
    ok("player count", ps.length === 2);
    ok("pitcher flag from position code", ps[1].pitcher === true && ps[0].pitcher === false);

    const log = await cl.gameLog(1, "hitting");
    ok("game log reversed to newest-first", log[0].date === "2026-08-02", log[0].date);
    ok("game log stat preserved", log[0].stat.hits === 2);

    const ld = await cl.leaders("homeRuns", 5);
    ok("leader rank numeric", ld[0].rank === 1);
    ok("leader value numeric", ld[0].value === 41);

    // error propagation
    let threw = false;
    try { await C.makeClient({ fetch: async () => ({ ok: false, status: 503 }), season: 2026 }).players(); }
    catch (e) { threw = /503/.test(e.message); }
    ok("HTTP error propagates", threw);

    finish();
  })();
}

/* ── 8b. NFL client (mocked ESPN) ─────────────────────── */
async function nflClientTests() {
  group("nfl data client");
  const routes = {
    "/teams": { sports: [{ leagues: [{ teams: [
      { team: { id: "12", name: "Chiefs", displayName: "Kansas City Chiefs", shortDisplayName: "Chiefs", abbreviation: "KC" } },
      { team: { id: "17", name: "Ravens", displayName: "Baltimore Ravens", shortDisplayName: "Ravens", abbreviation: "BAL" } }
    ] }] }] },
    "/teams/12/roster": { athletes: [
      { position: "offense", items: [
        { id: "3139477", fullName: "Patrick Mahomes", position: { abbreviation: "QB" } },
        { id: "4241457", fullName: "Rashee Rice", position: { abbreviation: "WR" } },
        { id: "9999", fullName: "Harrison Butker", position: { abbreviation: "K" } }] },
      { position: "defense", items: [{ id: "8888", fullName: "Chris Jones", position: { abbreviation: "DT" } }] }] },
    "/teams/17/roster": { athletes: [{ position: "offense", items: [
      { id: "3916387", fullName: "Lamar Jackson", position: { abbreviation: "QB" } },
      { id: "4429795", fullName: "Zay Flowers", position: { abbreviation: "WR" } }] }] },
    "/scoreboard": { events: [
      { id: "401", date: "2026-09-10T00:20Z", week: { number: 1 },
        status: { type: { state: "pre", shortDetail: "Thu 8:20 PM" } },
        competitions: [{ competitors: [
          { homeAway: "home", team: { id: "12", shortDisplayName: "Chiefs" } },
          { homeAway: "away", team: { id: "17", shortDisplayName: "Ravens" } }] }] }] },
    "/leaders": { leaders: [
      { name: "passingYards", leaders: [
        { value: 4183, athlete: { id: "3139477", displayName: "Patrick Mahomes", position: { abbreviation: "QB" } },
          team: { id: "12", shortDisplayName: "Chiefs" } }] },
      { name: "rushingYards", leaders: [
        { value: 1921, athlete: { id: "4361529", displayName: "Saquon Barkley", position: { abbreviation: "RB" } },
          team: { id: "21", shortDisplayName: "Eagles" } }] }] },
    "/gamelog": { names: ["completions/passingAttempts", "passingYards", "passingTouchdowns", "interceptions"],
      events: { "A": { gameDate: "2025-09-07T17:00Z", week: 1, homeAway: "home", opponent: { displayName: "Ravens" } } },
      seasonTypes: [{ displayName: "2025 Regular Season", categories: [
        { type: "passing", events: [{ eventId: "A", stats: ["24/35", "291", "3", "0"] }] }] }] }
  };
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => url.includes(k));
    return { ok: !!key, status: key ? 200 : 404, json: async () => routes[key] || {} };
  };
  const cl = C.makeNflClient({ fetch: fakeFetch, season: 2025 });

  ok("client reports its sport", cl.sport === "nfl");
  ok("client uses the given season", cl.season === 2025);

  const teams = await cl.teams();
  ok("teams parsed from nested shape", teams.length === 2, String(teams.length));
  ok("team short name used", teams[0].name === "Chiefs");
  ok("team id is a string", typeof teams[0].id === "string");

  const games = await cl.schedule("");
  ok("scoreboard parsed", games.length === 1);
  ok("game matchup read", games[0].away.name === "Ravens" && games[0].home.name === "Chiefs");
  ok("no date param means current week", calls.some((u) => /\/scoreboard$/.test(u)));
  await cl.schedule("2026-09-10");
  ok("date is converted to YYYYMMDD", calls.some((u) => u.includes("dates=20260910")), calls.slice(-1)[0]);

  const players = await cl.players();
  ok("rosters flattened across teams", players.length === 4, String(players.length) + " " + players.map((p) => p.pos).join(","));
  ok("kickers filtered out", !players.some((p) => p.pos === "K"));
  ok("defenders filtered out", !players.some((p) => p.pos === "DT"));
  ok("positions upper-cased", players.every((p) => p.pos === p.pos.toUpperCase()));
  ok("team name attached", players[0].team === "Chiefs");
  ok("player ids are strings", typeof players[0].id === "string");

  const log = await cl.gameLog("3139477");
  ok("game log parsed", log.length === 1);
  ok("game log stats normalised", log[0].stat.passYds === 291, JSON.stringify(log[0].stat));
  ok("game log requests the season", calls.some((u) => u.includes("season=2025")));

  const pass = await cl.leaders("passingYards", 5);
  ok("leaders bucket selected by name", pass.length === 1 && pass[0].name === "Patrick Mahomes");
  ok("leader value numeric", pass[0].value === 4183);
  ok("leader position carried", pass[0].pos === "QB");
  ok("leader rank assigned", pass[0].rank === 1);
  const rush = await cl.leaders("rushingYards", 5);
  ok("a different bucket resolves", rush[0].name === "Saquon Barkley", rush[0] && rush[0].name);

  // a roster that 404s must not kill the whole index
  const flaky = C.makeNflClient({ fetch: async (url) => {
    if (url.includes("/teams/17/roster")) return { ok: false, status: 500 };
    return fakeFetch(url);
  }, season: 2025 });
  const partial = await flaky.players();
  ok("one failed roster degrades to partial, not empty", partial.length === 2, String(partial.length));

  // alternate leaders shape
  const alt = C.makeNflClient({ fetch: async () => ({ ok: true, json: async () => ({
    categories: [{ name: "passingYards", leaders: [{ value: 10, athlete: { id: "1", displayName: "X" }, team: {} }] }] }) }), season: 2025 });
  ok("categories shape also parses", (await alt.leaders("passingYards", 5)).length === 1);

  let threw = false;
  try { await C.makeNflClient({ fetch: async () => ({ ok: false, status: 503 }), season: 2025 }).teams(); }
  catch (e) { threw = /503/.test(e.message); }
  ok("HTTP errors propagate", threw);
}

/* ── 9. formatting ────────────────────────────────────── */
function finish() {
  nflClientTests().then(finish2, (e) => { console.error(e); process.exit(1); });
}
function finish2() {
  group("formatting");
  ok("pct rounds", C.pct(0.5238) === "52%");
  ok("pct with dp", C.pct(0.5238, 1) === "52.4%");
  ok("pct of NaN", C.pct(NaN) === "—");
  ok("signedPct positive", C.signedPct(0.012) === "+1.2%");
  ok("signedPct negative", C.signedPct(-0.012) === "-1.2%");
  ok("shortTeam clubName", C.shortTeam({ clubName: "Mets", name: "New York Mets" }) === "Mets");
  ok("shortTeam strip city", C.shortTeam({ name: "St. Louis Cardinals" }) === "Cardinals");
  ok("shortTeam single word", C.shortTeam({ name: "Athletics" }) === "Athletics");
  ok("shortTeam strips Sacramento", C.shortTeam({ name: "Sacramento Kings" }) === "Kings");

  console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
  if (fail) { console.log("\n\x1b[31mFAILURES:\x1b[0m"); fails.forEach((f) => console.log("  ✗ " + f)); process.exit(1); }
  console.log("\x1b[32mAll core tests pass.\x1b[0m");
}
