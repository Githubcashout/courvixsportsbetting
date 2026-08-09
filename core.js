/* ============================================================
   Courvix Core — shared pure logic
   Used by: the web app, the Node test suite, and the Discord bot.
   No DOM, no Node-only APIs. `fetch` is injectable for testing.
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CourvixCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
"use strict";

/* ---------- 1. odds conversion ---------- */

/** American odds are undefined between -100 and +100. Reject that domain at the
 *  root so no caller can produce a nonsense payout from a price like -1. */
function isValidAmerican(a) {
  a = Number(a);
  return isFinite(a) && Math.abs(a) >= 100;
}
function americanToDecimal(a) {
  a = Number(a);
  if (!isValidAmerican(a)) return NaN;
  return a > 0 ? a / 100 + 1 : 100 / -a + 1;
}
function decimalToAmerican(d) {
  d = Number(d);
  if (!isFinite(d) || d <= 1) return NaN;
  return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
}
function americanToImplied(a) {
  a = Number(a);
  if (!isValidAmerican(a)) return NaN;
  return a > 0 ? 100 / (a + 100) : -a / (-a + 100);
}
function impliedToDecimal(p) {
  if (!(p > 0 && p < 1)) return NaN;
  return 1 / p;
}
function impliedToAmerican(p) {
  return decimalToAmerican(impliedToDecimal(p));
}
function formatAmerican(a) {
  if (!isFinite(a)) return "—";
  return (a > 0 ? "+" : "") + Math.round(a);
}

/* ---------- 2. de-vigging ----------
   Two-way market. Proportional is the naive method and biases longshots.
   Power method solves sum(q_i^k)=1 and handles favorite-longshot bias better.  */

function devigProportional(impliedA, impliedB) {
  const s = impliedA + impliedB;
  if (!(s > 0)) return [NaN, NaN];
  return [impliedA / s, impliedB / s];
}

function devigPower(impliedA, impliedB) {
  const s = impliedA + impliedB;
  if (!(s > 0)) return [NaN, NaN];
  if (Math.abs(s - 1) < 1e-12) return [impliedA, impliedB];
  // solve for k: qA^k + qB^k = 1
  let lo = 0.0001, hi = 10;
  const f = (k) => Math.pow(impliedA, k) + Math.pow(impliedB, k) - 1;
  if (f(lo) * f(hi) > 0) return devigProportional(impliedA, impliedB);
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid;
  }
  const k = (lo + hi) / 2;
  return [Math.pow(impliedA, k), Math.pow(impliedB, k)];
}

/** Vig (hold) of a two-way market, as a fraction. -110/-110 => ~0.0454 */
function marketHold(americanA, americanB) {
  const s = americanToImplied(americanA) + americanToImplied(americanB);
  if (!isFinite(s) || s <= 0) return NaN;
  return 1 - 1 / s;
}

/** Fair probability of ONE side given both sides' American prices. */
function fairProbability(americanSide, americanOther, method) {
  const a = americanToImplied(americanSide), b = americanToImplied(americanOther);
  const [pa] = (method === "proportional" ? devigProportional : devigPower)(a, b);
  return pa;
}

/* ---------- 3. closing line value ---------- */

/** CLV in probability points. Positive = you got a better number than the close. */
function clv(betFairProb, closeFairProb) {
  if (!isFinite(betFairProb) || !isFinite(closeFairProb)) return NaN;
  return closeFairProb - betFairProb;
}

function meanCLV(entries) {
  const v = entries.map((e) => e.clv).filter((x) => isFinite(x));
  if (!v.length) return { n: 0, mean: NaN, stdErr: NaN, tStat: NaN };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  if (v.length < 2) return { n: v.length, mean, stdErr: NaN, tStat: NaN };
  const varc = v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1);
  const se = Math.sqrt(varc / v.length);
  return { n: v.length, mean, stdErr: se, tStat: se > 0 ? mean / se : NaN };
}

/* ---------- 4. hit rates ---------- */

/** values newest-first. Returns over/under/push counts vs a line. */
function hitRate(values, line, windowN) {
  const slice = (windowN && windowN > 0) ? values.slice(0, windowN) : values.slice();
  let over = 0, under = 0, push = 0;
  for (const v of slice) {
    if (!isFinite(v)) continue;
    if (v > line) over++; else if (v < line) under++; else push++;
  }
  const decided = over + under;
  return {
    n: slice.length, over, under, push,
    rate: decided ? over / decided : NaN,
    // Wilson 95% interval — a raw percentage on 10 games is meaningless without it
    ci: decided ? wilson(over, decided) : [NaN, NaN]
  };
}

function wilson(successes, n, z) {
  z = z || 1.96;
  if (!n) return [NaN, NaN];
  const p = successes / n, z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return [Math.max(0, (centre - margin) / denom), Math.min(1, (centre + margin) / denom)];
}

/* ---------- 5. parlay math ---------- */

/**
 * legs: [{ american, fairProb? }]
 * If fairProb is omitted it is derived assuming a symmetric two-way market
 * at the same price (the standard -110/-110 assumption).
 */
function parlay(legs) {
  if (!legs || !legs.length) {
    return { n: 0, decimal: NaN, american: NaN, bookProb: NaN, fairProb: NaN,
             hold: NaN, ev: NaN, payoutPer100: NaN };
  }
  let decimal = 1, fairProb = 1, ok = true;
  for (const leg of legs) {
    const d = americanToDecimal(leg.american);
    if (!isFinite(d)) { ok = false; break; }
    decimal *= d;
    const fp = isFinite(leg.fairProb) ? leg.fairProb
             : fairProbability(leg.american, leg.american); // symmetric assumption
    fairProb *= fp;
  }
  if (!ok) return { n: legs.length, decimal: NaN, american: NaN, bookProb: NaN,
                    fairProb: NaN, hold: NaN, ev: NaN, payoutPer100: NaN };
  const bookProb = 1 / decimal;
  const ev = fairProb * decimal - 1;      // per $1 staked
  return {
    n: legs.length,
    decimal,
    american: decimalToAmerican(decimal),
    bookProb,
    fairProb,
    hold: 1 - fairProb * decimal,          // the book's edge on this ticket
    ev,
    payoutPer100: (decimal - 1) * 100
  };
}

/* ---------- 6. correlation detection ---------- */

const NEGATIVE_PAIRS = [
  ["strikeOuts_pitching", "hits_batting"],
  ["strikeOuts_pitching", "totalBases_batting"],
  ["earnedRuns_pitching", "hits_batting"]
];

/**
 * legs: [{ playerId, playerName, gameId, teamId, propKey, side, group }]
 * Returns an array of {level, message}. level: 'block' | 'warn' | 'note'
 */
function correlationIssues(legs) {
  const out = [];
  if (!legs || legs.length < 2) return out;

  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const a = legs[i], b = legs[j];

      if (a.playerId && a.playerId === b.playerId) {
        if (a.propKey === b.propKey && a.side !== b.side) {
          out.push({ level: "block", message:
            `${a.playerName}: ${a.propKey} over and under in the same ticket — this can never win.` });
        } else {
          out.push({ level: "block", message:
            `Two legs on ${a.playerName}. Same-player props are heavily correlated; most books won't accept this, and the independence math below is wrong for it.` });
        }
        continue;
      }
      if (a.gameId && a.gameId === b.gameId) {
        const sameTeam = a.teamId && a.teamId === b.teamId;
        const neg = NEGATIVE_PAIRS.some(([x, y]) =>
          (keyOf(a) === x && keyOf(b) === y) || (keyOf(a) === y && keyOf(b) === x));
        if (neg) {
          out.push({ level: "warn", message:
            `${a.playerName} and ${b.playerName} are negatively correlated — one hitting makes the other less likely. This parlay is worse than the math shows.` });
        } else {
          out.push({ level: "warn", message:
            `${a.playerName} and ${b.playerName} are in the same game${sameTeam ? " on the same team" : ""}. Same-game legs are correlated, so the true probability isn't the product of the two.` });
        }
      }
    }
  }
  if (legs.length >= 2) {
    const games = new Set(legs.map((l) => l.gameId).filter(Boolean));
    if (games.size === 1 && legs.length >= 2) {
      out.push({ level: "note", message:
        "Every leg is in one game. Books price same-game parlays with correlation already built in, which is why their hold on SGPs is several times a straight bet." });
    }
  }
  return out;
}
function keyOf(l) { return `${l.propKey}_${l.group || "batting"}`; }

/* ---------- 7. global prop catalog ----------
   The categories books actually offer worldwide. `d` is the typical line. */

const PROP_CATALOG = {
  mlb: {
    label: "Baseball", live: true,
    batting: [
      { k: "hits",        n: "Hits",        d: 0.5, f: (s) => num(s.hits) },
      { k: "totalBases",  n: "Total bases", d: 1.5, f: (s) => num(s.totalBases) },
      { k: "rbi",         n: "RBIs",        d: 0.5, f: (s) => num(s.rbi) },
      { k: "runs",        n: "Runs",        d: 0.5, f: (s) => num(s.runs) },
      { k: "homeRuns",    n: "Home runs",   d: 0.5, f: (s) => num(s.homeRuns) },
      { k: "strikeOuts",  n: "Strikeouts",  d: 0.5, f: (s) => num(s.strikeOuts) },
      { k: "baseOnBalls", n: "Walks",       d: 0.5, f: (s) => num(s.baseOnBalls) },
      { k: "stolenBases", n: "Stolen bases",d: 0.5, f: (s) => num(s.stolenBases) },
      { k: "hrr",         n: "H+R+RBI",     d: 1.5, f: (s) => num(s.hits) + num(s.runs) + num(s.rbi) }
    ],
    pitching: [
      { k: "strikeOuts",  n: "Strikeouts",   d: 5.5,  f: (s) => num(s.strikeOuts) },
      { k: "earnedRuns",  n: "Earned runs",  d: 2.5,  f: (s) => num(s.earnedRuns) },
      { k: "hits",        n: "Hits allowed", d: 4.5,  f: (s) => num(s.hits) },
      { k: "baseOnBalls", n: "Walks",        d: 1.5,  f: (s) => num(s.baseOnBalls) },
      { k: "outs",        n: "Outs recorded",d: 16.5, f: (s) => inningsToOuts(s.inningsPitched) }
    ]
  },
  nfl: {
    label: "Football", live: true, startMonth: 8, startDay: 10,
    // `pos` gates which positions may be offered the market, so a receiver is
    // never shown passing yards (same class of bug as pitcher/home-runs).
    batting: [
      { k: "passYds",   n: "Passing yards",   d: 249.5, pos: ["QB"],                 f: (s) => num(s.passYds) },
      { k: "passTd",    n: "Passing TDs",     d: 1.5,   pos: ["QB"],                 f: (s) => num(s.passTd) },
      { k: "passAtt",   n: "Pass attempts",   d: 32.5,  pos: ["QB"],                 f: (s) => num(s.passAtt) },
      { k: "passCmp",   n: "Completions",     d: 21.5,  pos: ["QB"],                 f: (s) => num(s.passCmp) },
      { k: "int",       n: "Interceptions",   d: 0.5,   pos: ["QB"],                 f: (s) => num(s.int) },
      { k: "rushYds",   n: "Rushing yards",   d: 49.5,  pos: ["QB","RB","FB","WR"],  f: (s) => num(s.rushYds) },
      { k: "rushAtt",   n: "Rush attempts",   d: 12.5,  pos: ["RB","FB"],            f: (s) => num(s.rushAtt) },
      { k: "recYds",    n: "Receiving yards", d: 49.5,  pos: ["WR","TE","RB","FB"],  f: (s) => num(s.recYds) },
      { k: "rec",       n: "Receptions",      d: 4.5,   pos: ["WR","TE","RB","FB"],  f: (s) => num(s.rec) },
      { k: "rushRecYds",n: "Rush + rec yards",d: 69.5,  pos: ["RB","FB","WR","TE"],  f: (s) => num(s.rushYds) + num(s.recYds) },
      { k: "anytimeTd", n: "Anytime TD",      d: 0.5,   pos: ["RB","FB","WR","TE","QB"], f: (s) => num(s.rushTd) + num(s.recTd) }
    ], pitching: []
  },
  nba: {
    label: "Basketball", live: false, startMonth: 9, startDay: 20,
    batting: [
      { k: "pts",  n: "Points",          d: 19.5 },
      { k: "reb",  n: "Rebounds",        d: 7.5 },
      { k: "ast",  n: "Assists",         d: 5.5 },
      { k: "pra",  n: "Pts+Reb+Ast",     d: 29.5 },
      { k: "tpm",  n: "Three-pointers",  d: 2.5 },
      { k: "stlblk", n: "Steals+Blocks", d: 1.5 }
    ], pitching: []
  },
  nhl: {
    label: "Hockey", live: false, startMonth: 9, startDay: 7,
    batting: [
      { k: "sog",    n: "Shots on goal", d: 2.5 },
      { k: "points", n: "Points",        d: 0.5 },
      { k: "goals",  n: "Goals",         d: 0.5 },
      { k: "saves",  n: "Goalie saves",  d: 27.5 }
    ], pitching: []
  },
  soccer: {
    label: "Soccer", live: false,
    batting: [
      { k: "shots",   n: "Shots",           d: 1.5 },
      { k: "sot",     n: "Shots on target", d: 0.5 },
      { k: "goals",   n: "Anytime scorer",  d: 0.5 },
      { k: "assists", n: "Assists",         d: 0.5 },
      { k: "fouls",   n: "Fouls committed", d: 1.5 },
      { k: "cards",   n: "To be carded",    d: 0.5 }
    ], pitching: []
  }
};
function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

/** Baseball innings are base-3 in the decimal slot: "6.2" is 6 and 2/3, i.e. 20 outs. */
function inningsToOuts(ip) {
  if (ip == null || ip === "") return 0;
  const s = String(ip);
  const m = s.match(/^(\d+)(?:\.(\d))?$/);
  if (!m) { const n = Number(s); return isFinite(n) ? Math.round(n * 3) : 0; }
  const whole = Number(m[1]);
  const third = m[2] == null ? 0 : Math.min(2, Number(m[2]));
  return whole * 3 + third;
}

function propsFor(sport, group) {
  const s = PROP_CATALOG[sport];
  if (!s) return [];
  return (group === "pitching" ? s.pitching : s.batting) || [];
}

/** Markets a specific player may actually be offered. */
function propsForPlayer(sport, player) {
  player = player || {};
  if (sport === "mlb") return propsFor("mlb", player.pitcher ? "pitching" : "batting");
  const pos = String(player.pos || "").toUpperCase();
  const all = propsFor(sport, "batting");
  if (!pos) return all;
  const gated = all.filter((p) => !p.pos || p.pos.indexOf(pos) !== -1);
  // an unrecognised position (K, LB, …) gets nothing rather than nonsense
  return gated;
}

/* ---------- 8. interest score ----------
   Transparent, disclosed proxy for "which props get bet most".
   Rank in a headline category + playing today. No invented handle data. */

function interestScore({ leaderRank, categories, playingToday }) {
  const r = isFinite(leaderRank) ? Math.max(1, leaderRank) : 60;
  let s = 100 / r;                    // top of a leaderboard dominates prop menus
  s *= 1 + 0.35 * Math.max(0, (categories || 1) - 1); // leads several categories
  if (playingToday) s *= 2.5;         // only today's players are bettable today
  return s;
}

/* ---------- 8b. NFL stat normalisation ----------
   ESPN returns a parallel `names`/`stats` pair whose columns depend on the
   athlete's position, plus compound cells like "24/35". Normalise to one flat
   object so the prop extractors never see ESPN's shape.                      */

const NFL_ALIASES = {
  passingyards: "passYds", passingtouchdowns: "passTd", interceptions: "int",
  passingattempts: "passAtt", completions: "passCmp", passingcompletions: "passCmp",
  rushingyards: "rushYds", rushingtouchdowns: "rushTd", rushingattempts: "rushAtt",
  receivingyards: "recYds", receivingtouchdowns: "recTd", receptions: "rec",
  receivingtargets: "targets", targets: "targets", fumbleslost: "fumblesLost"
};

/* ESPN sometimes hands back short labels ("YDS", "TD") instead of full names.
   Those are ambiguous on their own — YDS is passing yards in the passing block
   and rushing yards in the rushing block — so they only resolve with a category. */
const NFL_LABELS_BY_CATEGORY = {
  passing:   { yds: "passYds", td: "passTd", int: "int", att: "passAtt", cmp: "passCmp", c: "passCmp" },
  rushing:   { yds: "rushYds", td: "rushTd", att: "rushAtt", car: "rushAtt" },
  receiving: { yds: "recYds", td: "recTd", rec: "rec", tgts: "targets", tgt: "targets" }
};

/** "24/35" -> {a:24,b:35}; anything else -> null. */
function splitCompound(v) {
  const s = String(v == null ? "" : v).trim();
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  return m ? { a: Number(m[1]), b: Number(m[2]) } : null;
}

const cleanKey = (x) => String(x || "").toLowerCase().replace(/[^a-z]/g, "");

function resolveNflKey(namePart, category) {
  const k = cleanKey(namePart);
  if (NFL_ALIASES[k]) return NFL_ALIASES[k];
  const table = NFL_LABELS_BY_CATEGORY[String(category || "").toLowerCase()];
  return (table && table[k]) || null;
}

/**
 * names: ESPN's column keys (full names preferred, short labels tolerated)
 * stats: the parallel value array
 * category: "passing" | "rushing" | "receiving" — required to resolve short labels
 */
function normalizeNflStats(names, stats, category) {
  const out = {};
  if (!Array.isArray(names) || !Array.isArray(stats)) return out;
  for (let i = 0; i < names.length; i++) {
    const raw = String(names[i] == null ? "" : names[i]);
    const val = stats[i];

    if (raw.indexOf("/") !== -1) {                       // compound cell, e.g. C/ATT
      const parts = raw.split("/");
      const c = splitCompound(val);
      if (c && parts.length === 2) {
        const k0 = resolveNflKey(parts[0], category || "passing");
        const k1 = resolveNflKey(parts[1], category || "passing");
        if (k0 && out[k0] == null) out[k0] = c.a;
        if (k1 && out[k1] == null) out[k1] = c.b;
        continue;
      }
    }
    const mapped = resolveNflKey(raw, category);
    if (mapped && out[mapped] == null) {
      const n = Number(String(val == null ? "" : val).replace(/,/g, ""));
      out[mapped] = isFinite(n) ? n : 0;
    }
  }
  return out;
}

/** Flatten ESPN's athlete gamelog into the same shape the MLB client returns. */
function parseEspnGameLog(json, opts) {
  opts = opts || {};
  const events = (json && json.events) || {};
  const topNames = (json && json.names) || [];
  const rows = [];
  const seasonTypes = (json && json.seasonTypes) || [];
  seasonTypes.forEach((st) => {
    // skip preseason unless explicitly requested
    const label = String((st && st.displayName) || "");
    if (!opts.includePreseason && /pre\s*season/i.test(label)) return;
    (st.categories || []).forEach((cat) => {
      const names = (cat && cat.names && cat.names.length) ? cat.names : topNames;
      (cat.events || []).forEach((ev) => {
        const meta = events[ev.eventId] || {};
        const stat = normalizeNflStats(names, ev.stats || [], cat && cat.type);
        const existing = rows.find((r) => r.gameId === ev.eventId);
        if (existing) { Object.assign(existing.stat, stat); return; }
        rows.push({
          gameId: ev.eventId,
          date: String(meta.gameDate || "").slice(0, 10),
          week: meta.week || null,
          home: String(meta.homeAway || meta.atVs || "").toLowerCase() === "home" ||
                String(meta.atVs || "") === "vs",
          opp: ((meta.opponent || {}).displayName) || ((meta.opponent || {}).abbreviation) || "",
          stat
        });
      });
    });
  });
  // newest first, matching the MLB client
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return rows;
}

/* ---------- 9. MLB data client (fetch injectable) ---------- */

const MLB_BASE = "https://statsapi.mlb.com/api/v1";

function makeClient(opts) {
  opts = opts || {};
  const f = opts.fetch || (typeof fetch !== "undefined" ? fetch : null);
  const base = opts.base || MLB_BASE;
  const season = opts.season || new Date().getFullYear();
  if (!f) throw new Error("no fetch available");

  async function get(path) {
    const r = await f(base + path, { mode: "cors" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  return {
    season,
    async schedule(dateStr) {
      const d = await get(`/schedule?sportId=1&date=${dateStr}&hydrate=probablePitcher,linescore,team`);
      return (((d.dates || [])[0] || {}).games || []).map(normalizeGame);
    },
    async players() {
      const d = await get(`/sports/1/players?season=${season}`);
      return (d.people || []).map((p) => ({
        id: p.id, name: p.fullName,
        pos: (p.primaryPosition || {}).abbreviation || "",
        team: (p.currentTeam || {}).name || "",
        teamId: (p.currentTeam || {}).id || null,
        pitcher: (p.primaryPosition || {}).code === "1"
      }));
    },
    async gameLog(playerId, group) {
      const d = await get(`/people/${playerId}/stats?stats=gameLog&season=${season}&group=${group || "hitting"}`);
      const splits = (((d.stats || [])[0] || {}).splits || []).slice().reverse(); // newest first
      return splits.map((s) => ({
        date: s.date,
        home: !!s.isHome,
        opp: ((s.opponent || {}).name) || "",
        gameId: ((s.game || {}).gamePk) || null,
        stat: s.stat || {}
      }));
    },
    async leaders(category, limit) {
      const d = await get(`/stats/leaders?leaderCategories=${category}&season=${season}&sportId=1&limit=${limit || 20}`);
      const grp = (d.leagueLeaders || [])[0] || {};
      return (grp.leaders || []).map((l) => ({
        rank: Number(l.rank) || null,
        id: (l.person || {}).id,
        name: (l.person || {}).fullName,
        team: (l.team || {}).name || "",
        teamId: (l.team || {}).id || null,
        value: Number(l.value)
      }));
    }
  };
}

function normalizeGame(g) {
  const t = g.teams || {};
  const side = (x) => ({
    name: shortTeam((x || {}).team || {}),
    full: (((x || {}).team) || {}).name || "",
    id: (((x || {}).team) || {}).id || null,
    score: (x || {}).score,
    pitcher: (((x || {}).probablePitcher) || {}).fullName || ""
  });
  return {
    gamePk: g.gamePk,
    start: g.gameDate,
    state: ((g.status || {}).abstractGameState) || "Preview",
    detail: ((g.status || {}).detailedState) || "",
    away: side(t.away), home: side(t.home)
  };
}

const CITY_RE = /^(Arizona|Atlanta|Baltimore|Boston|Chicago|Cincinnati|Cleveland|Colorado|Detroit|Houston|Kansas City|Los Angeles|Miami|Milwaukee|Minnesota|New York|Oakland|Philadelphia|Pittsburgh|Sacramento|San Diego|San Francisco|Seattle|St\. Louis|Tampa Bay|Texas|Toronto|Washington)\s+/;
function shortTeam(team) {
  return team.clubName || team.teamName || String(team.name || "").replace(CITY_RE, "") || "";
}

/* ---------- 9b. NFL data client (ESPN, free, no key) ----------
   These endpoints are public but undocumented, so every parse here is
   defensive and the app ships a probe to confirm the live shapes.          */

const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const ESPN_WEB  = "https://site.web.api.espn.com/apis/common/v3/sports/football/nfl";

/** The 2025 NFL season runs Sep 2025 - Feb 2026, so the season year is not the
 *  calendar year for eight months of the year. Week 1 is the Thu after Labor Day. */
function nflSeasonFor(date) {
  const d = date || new Date();
  // September or later => that calendar year's season; otherwise the previous one
  return d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
}
function nflWeekOneApprox(year) {
  // Labor Day = first Monday of September; Week 1 Thursday is three days later
  const sep1 = new Date(year, 8, 1);
  const labor = new Date(year, 8, 1 + ((8 - sep1.getDay()) % 7));
  return new Date(year, 8, labor.getDate() + 3);
}
function nflSeasonHasStarted(date) {
  const d = date || new Date();
  // Jan/Feb are still the previous season's playoffs; Mar-Aug is the offseason;
  // Sep onward counts only once Week 1 has actually arrived.
  if (d.getMonth() <= 1) return true;
  if (d.getMonth() < 8) return false;
  return d >= nflWeekOneApprox(d.getFullYear());
}

function normalizeEspnGame(ev) {
  const comp = ((ev && ev.competitions) || [])[0] || {};
  const cs = comp.competitors || [];
  const pick = (ha) => {
    const c = cs.find((x) => x && x.homeAway === ha) || {};
    const t = c.team || {};
    return {
      name: t.shortDisplayName || t.name || t.abbreviation || t.displayName || "",
      full: t.displayName || t.name || "",
      id: t.id != null ? String(t.id) : null,
      score: c.score != null ? Number(c.score) : undefined,
      pitcher: ""
    };
  };
  const st = ((ev && ev.status) || {}).type || {};
  const state = st.state === "pre" ? "Preview" : st.state === "post" ? "Final" : "Live";
  return {
    gamePk: ev && ev.id != null ? String(ev.id) : null,
    start: (ev && ev.date) || "",
    week: ((ev && ev.week) || {}).number || null,
    state,
    detail: st.shortDetail || st.detail || st.description || "",
    away: pick("away"), home: pick("home")
  };
}

function makeNflClient(opts) {
  opts = opts || {};
  const f = opts.fetch || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) throw new Error("no fetch available");
  const season = opts.season || nflSeasonFor();
  const site = opts.site || ESPN_SITE;
  const web = opts.web || ESPN_WEB;

  async function get(url) {
    const r = await f(url, { mode: "cors" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  return {
    sport: "nfl",
    season,
    seasonStarted: nflSeasonHasStarted(),

    async schedule(dateStr) {
      // ESPN wants YYYYMMDD; an empty scoreboard for one day is normal in the NFL
      const compact = String(dateStr || "").replace(/-/g, "");
      const d = await get(`${site}/scoreboard${compact ? "?dates=" + compact : ""}`);
      return ((d && d.events) || []).map(normalizeEspnGame);
    },

    /** Built from the 32 team rosters: deterministic, unlike the search endpoint. */
    async players() {
      const teams = await this.teams();
      const rosters = await Promise.all(teams.map(async (t) => {
        try {
          const d = await get(`${site}/teams/${t.id}/roster`);
          const groups = (d && d.athletes) || [];
          const flat = [];
          groups.forEach((g) => {
            const items = (g && g.items) || (Array.isArray(g) ? g : []);
            items.forEach((a) => {
              if (!a || a.id == null) return;
              flat.push({
                id: String(a.id),
                name: a.fullName || a.displayName || "",
                pos: (((a.position || {}).abbreviation) || "").toUpperCase(),
                team: t.name, teamId: t.id, pitcher: false
              });
            });
          });
          return flat;
        } catch (e) { return []; }
      }));
      const all = [].concat.apply([], rosters);
      // only positions that actually have prop markets
      const OFFENSE = { QB: 1, RB: 1, FB: 1, WR: 1, TE: 1 };
      return all.filter((p) => p.name && OFFENSE[p.pos]);
    },

    async teams() {
      const d = await get(`${site}/teams`);
      const groups = (((d || {}).sports || [])[0] || {}).leagues || [];
      const list = ((groups[0] || {}).teams) || (d && d.teams) || [];
      return list.map((x) => {
        const t = x.team || x;
        return { id: String(t.id), name: t.shortDisplayName || t.name || t.displayName || "",
                 full: t.displayName || "", abbr: t.abbreviation || "" };
      }).filter((t) => t.id);
    },

    async gameLog(playerId, _group) {
      const d = await get(`${web}/athletes/${playerId}/gamelog?season=${season}`);
      return parseEspnGameLog(d);
    },

    async leaders(category, limit) {
      const d = await get(`${site}/leaders?season=${season}&seasontype=2`);
      // shape differs across ESPN versions: sometimes `leaders`, sometimes `categories`
      const buckets = (d && (d.leaders || d.categories)) || [];
      const want = String(category || "").toLowerCase();
      const bucket = buckets.find((b) => String((b && (b.name || b.abbreviation)) || "").toLowerCase() === want)
                  || buckets[0] || {};
      const rows = (bucket.leaders || []) .slice(0, limit || 20);
      return rows.map((l, i) => {
        const a = l.athlete || {};
        const t = l.team || a.team || {};
        return {
          rank: i + 1,
          id: a.id != null ? String(a.id) : null,
          name: a.displayName || a.fullName || "",
          pos: (((a.position || {}).abbreviation) || "").toUpperCase(),
          team: t.shortDisplayName || t.displayName || t.name || "",
          teamId: t.id != null ? String(t.id) : null,
          value: Number(l.value)
        };
      }).filter((r) => r.id);
    }
  };
}

/* ---------- 9c. sport registry ---------- */

const SPORT_ADAPTERS = {
  mlb: {
    key: "mlb", label: "MLB", live: true,
    make: (o) => makeClient(o),
    leaderCategories: [
      { key: "homeRuns", prop: "homeRuns", group: "batting" },
      { key: "hits", prop: "hits", group: "batting" },
      { key: "runsBattedIn", prop: "rbi", group: "batting" },
      { key: "strikeouts", prop: "strikeOuts", group: "pitching" }
    ],
    groupFor: (p) => (p && p.pitcher ? "pitching" : "batting"),
    logGroupFor: (p) => (p && p.pitcher ? "pitching" : "hitting")
  },
  nfl: {
    key: "nfl", label: "NFL", live: true,
    make: (o) => makeNflClient(o),
    leaderCategories: [
      { key: "passingYards", prop: "passYds", group: "batting" },
      { key: "rushingYards", prop: "rushYds", group: "batting" },
      { key: "receivingYards", prop: "recYds", group: "batting" },
      { key: "receptions", prop: "rec", group: "batting" }
    ],
    groupFor: () => "batting",
    logGroupFor: () => "batting"
  }
};

function makeClientFor(sport, opts) {
  const a = SPORT_ADAPTERS[sport];
  if (!a) throw new Error("unsupported sport: " + sport);
  return a.make(opts || {});
}

/* ---------- 10. formatting helpers ---------- */

function pct(x, dp) { return isFinite(x) ? (x * 100).toFixed(dp == null ? 0 : dp) + "%" : "—"; }
function signedPct(x, dp) {
  if (!isFinite(x)) return "—";
  const s = (x * 100).toFixed(dp == null ? 1 : dp);
  return (x > 0 ? "+" : "") + s + "%";
}

return {
  isValidAmerican,
  americanToDecimal, decimalToAmerican, americanToImplied, impliedToDecimal,
  impliedToAmerican, formatAmerican,
  devigProportional, devigPower, marketHold, fairProbability,
  clv, meanCLV,
  hitRate, wilson,
  parlay, correlationIssues,
  PROP_CATALOG, propsFor, propsForPlayer, interestScore,
  normalizeNflStats, parseEspnGameLog, splitCompound, resolveNflKey,
  makeClient, makeNflClient, makeClientFor, SPORT_ADAPTERS,
  normalizeGame, normalizeEspnGame, shortTeam,
  nflSeasonFor, nflWeekOneApprox, nflSeasonHasStarted,
  pct, signedPct, inningsToOuts
};
});
