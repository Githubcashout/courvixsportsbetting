/* Courvix app shell — DOM only. All maths lives in core.js. */
"use strict";
const C = window.CourvixCore;
const $ = (s) => document.querySelector(s);
const el = (t, c) => { const n = document.createElement(t); if (c) n.className = c; return n; };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (m) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

const SEASON = new Date().getFullYear();
const diag = [];
let client = null;

/* ── instrumented fetch so the System tab can show what happened ── */
function tracedFetch(label) {
  return async (url, opts) => {
    const t0 = performance.now();
    try {
      const r = await fetch(url, opts);
      diag.push({ label, ok: r.ok, ms: Math.round(performance.now() - t0), err: r.ok ? null : "HTTP " + r.status });
      setStatus(r.ok); renderDiag(); return r;
    } catch (e) {
      diag.push({ label, ok: false, ms: Math.round(performance.now() - t0), err: e.message });
      setStatus(false); renderDiag(); throw e;
    }
  };
}
let SPORT = "mlb";
const adapter = () => C.SPORT_ADAPTERS[SPORT];
function api(label) {
  const opts = { fetch: tracedFetch(label) };
  if (SPORT === "mlb") opts.season = SEASON;      // NFL derives its own season year
  return C.makeClientFor(SPORT, opts);
}
function activeSeason() { return SPORT === "nfl" ? C.nflSeasonFor() : SEASON; }

function setStatus(ok) {
  const d = $("#statusDot"), t = $("#statusTxt");
  d.className = "dot " + (ok ? "on" : "err");
  t.textContent = ok ? "live" : "blocked";
}
function renderDiag() {
  const box = $("#diag"); if (!box) return;
  box.innerHTML = "";
  if (!diag.length) { box.innerHTML = '<div class="note">No requests yet.</div>'; return; }
  diag.slice(-10).reverse().forEach((d) => {
    const r = el("div", "kv");
    r.innerHTML = `<span class="k">${esc(d.label)}</span><span class="${d.ok ? "good" : "bad"}">${d.ok ? d.ms + "ms" : "failed"}</span>`;
    box.appendChild(r);
    if (!d.ok) {
      const n = el("div", "note"); n.style.padding = "5px 0 3px";
      n.innerHTML = `<code>${esc(d.err)}</code> — if this reads <code>Failed to fetch</code>, your browser blocked it (offline, or CORS).`;
      box.appendChild(n);
    }
  });
}

/* ── store ── */
const store = {
  get(k, dflt) { try { return JSON.parse(localStorage.getItem("cvx_" + k)) ?? dflt; } catch (e) { return dflt; } },
  set(k, v) { try { localStorage.setItem("cvx_" + k, JSON.stringify(v)); } catch (e) {} }
};
let PARLAY = store.get("parlay", []);
let VIEWS = store.get("views", {});      // propKey|playerName -> count  (your own trending)

/* ── sports ── */
const SPORTS = [
  { k: "mlb", n: "MLB", live: true },
  { k: "nfl", n: "NFL", live: true, start: C.nflWeekOneApprox(SEASON) },
  { k: "nba", n: "NBA", live: false, start: new Date(SEASON, 9, 20) },
  { k: "nhl", n: "NHL", live: false, start: new Date(SEASON, 9, 7) },
  { k: "soccer", n: "Soccer", live: false }
];
const daysTo = (d) => (d ? Math.max(0, Math.ceil((d - new Date()) / 864e5)) : null);

(function initSports() {
  const box = $("#sports");
  SPORTS.forEach((s) => {
    const b = el("button", "sport");
    b.dataset.sport = s.k;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(s.k === SPORT));
    const d = daysTo(s.start);
    b.innerHTML = s.live ? s.n : `${s.n}${d != null ? `<small>${d}d</small>` : "<small>soon</small>"}`;
    if (!s.live) b.disabled = true;
    else b.onclick = () => switchSport(s.k);
    box.appendChild(b);
  });
  const nba = daysTo(SPORTS[2].start);
  if ($("#nbaEta")) $("#nbaEta").textContent = nba + " days";
})();

function switchSport(k) {
  if (k === SPORT) return;
  SPORT = k;
  document.querySelectorAll(".sport").forEach((x) =>
    x.setAttribute("aria-selected", String(x.dataset.sport === k)));
  // research state belongs to the old sport
  CUR = null; $("#player").innerHTML = ""; $("#results").innerHTML = ""; $("#q").value = "";
  boardLoaded = false; TODAY_GAMES = []; TODAY_TEAMS = new Set();
  loadBoard();
}

/* ── nav ── */
document.querySelectorAll(".nb button").forEach((b) => b.onclick = () => {
  document.querySelectorAll(".nb button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("on", v.id === "v-" + b.dataset.v));
  window.scrollTo(0, 0);
  if (b.dataset.v === "board") { if (!boardLoaded) loadBoard(); else renderYourTrending(); }
  if (b.dataset.v === "parlay") renderParlay();
});
function goto(v) { const b = document.querySelector(`.nb button[data-v="${v}"]`); if (b) b.click(); }

/* ══════════════ BOARD ══════════════ */
let boardLoaded = false, TODAY_TEAMS = new Set(), TODAY_GAMES = [];

async function loadBoard() {
  boardLoaded = true;
  const gbox = $("#games"), pbox = $("#topProps");
  gbox.innerHTML = '<div class="spin"></div>';
  pbox.innerHTML = '<div class="spin"></div>';

  // ESPN's scoreboard with no date returns the current NFL week; MLB is per-day
  const dstr = SPORT === "nfl" ? "" : new Date().toISOString().slice(0, 10);
  try {
    TODAY_GAMES = await api(`${adapter().label} schedule`).schedule(dstr);
  } catch (e) {
    gbox.innerHTML = `<div class="empty">Schedule unavailable.<br><code>${esc(e.message)}</code></div>`;
    TODAY_GAMES = [];
  }
  TODAY_TEAMS = new Set();
  TODAY_GAMES.forEach((g) => { if (g.away.id) TODAY_TEAMS.add(g.away.id); if (g.home.id) TODAY_TEAMS.add(g.home.id); });
  backfillGameIds();   // legs added before the schedule resolved have gameId null
  renderGames(gbox);
  renderSeasonNotice();
  renderCatalog();
  renderYourTrending();
  await renderHeadliners(pbox);
}

function renderSeasonNotice() {
  const box = $("#seasonNotice");
  if (!box) return;
  if (SPORT === "nfl" && !C.nflSeasonHasStarted()) {
    const d = daysTo(C.nflWeekOneApprox(SEASON));
    box.innerHTML = `<div class="notice">Showing the <b>${C.nflSeasonFor()}</b> season — Week 1 of ${SEASON} is
      <b>${d} day${d === 1 ? "" : "s"}</b> away. Hit rates below are last season's, which is what a
      preseason number is priced off anyway.</div>`;
    box.style.display = "";
  } else { box.innerHTML = ""; box.style.display = "none"; }
}

function renderGames(box) {
  const weekly = SPORT === "nfl";
  $("#gamesTitle").textContent = weekly ? "This week's games" : "Today's games";
  $("#gamesSub").textContent = weekly
    ? (TODAY_GAMES.length && TODAY_GAMES[0].week ? "Week " + TODAY_GAMES[0].week : adapter().label)
    : new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (!TODAY_GAMES.length) {
    box.innerHTML = `<div class="empty">No ${adapter().label} games ${weekly ? "this week" : "scheduled today"}.</div>`;
    return;
  }
  box.innerHTML = "";
  TODAY_GAMES.forEach((g) => {
    const live = g.state !== "Preview";
    const time = new Date(g.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const row = el("div", "game");
    const last = (n) => (n ? n.split(" ").slice(-1)[0] : "");
    row.innerHTML = `
      <div class="tm"><div class="t">${esc(g.away.name)}</div><div class="p">${g.away.pitcher ? "↳ " + esc(last(g.away.pitcher)) : ""}</div></div>
      ${live ? `<div class="sc mono">${g.away.score ?? "–"}</div>` : ""}
      <div class="st">${live ? esc(g.detail) : time}</div>
      ${live ? `<div class="sc mono">${g.home.score ?? "–"}</div>` : ""}
      <div class="tm" style="text-align:right"><div class="t">${esc(g.home.name)}</div><div class="p">${g.home.pitcher ? "↳ " + esc(last(g.home.pitcher)) : ""}</div></div>`;
    box.appendChild(row);
  });
}

function renderCatalog() {
  const box = $("#catalog"); box.innerHTML = "";
  SPORTS.forEach((s) => {
    const cat = C.PROP_CATALOG[s.k]; if (!cat) return;
    const all = [].concat(cat.batting || [], cat.pitching || []);
    const row = el("div", "catrow");
    row.innerHTML = `<div class="cathead"><b>${esc(cat.label)}</b>${s.live ? '<span class="tag live">live</span>' : '<span class="tag">catalog</span>'}</div>
      <div class="chips">${all.map((p) => `<span class="chip">${esc(p.n)} <em>${p.d}</em></span>`).join("")}</div>`;
    box.appendChild(row);
  });
}

function renderYourTrending() {
  const box = $("#yours");
  const rows = Object.entries(VIEWS).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!rows.length) {
    box.innerHTML = '<div class="note">Nothing yet. Every prop you open gets counted here — this is the only "trending" number in the app that is actually measured rather than guessed.</div>';
    return;
  }
  box.innerHTML = "";
  rows.forEach(([k, v]) => {
    const [name, prop] = k.split("|");
    const r = el("div", "kv");
    r.innerHTML = `<span class="k">${esc(name)} · ${esc(prop)}</span><span class="mono">${v}×</span>`;
    box.appendChild(r);
  });
}

async function renderHeadliners(box) {
  const cats = adapter().leaderCategories.map((c) => ({
    key: c.key, prop: c.prop, group: c.group === "pitching" ? "pitching" : "hitting"
  }));
  const agg = new Map();
  for (const c of cats) {
    let list = [];
    try { list = await api(`Leaders · ${c.key}`).leaders(c.key, 15); } catch (e) { continue; }
    list.forEach((p) => {
      if (!p.id) return;
      const cur = agg.get(p.id) || { ...p, cats: 0, bestRank: 99, prop: c.prop, group: c.group, isPitcher: false };
      cur.cats++;
      if (c.group === "pitching") cur.isPitcher = true;
      // A pitcher must never be offered a hitting prop, even if they appear on a hitting
      // leaderboard. Pitching categories always win the headline slot.
      const better = (p.rank || 99) < cur.bestRank;
      const upgradeToPitching = c.group === "pitching" && cur.group !== "pitching";
      if (upgradeToPitching || (better && !(cur.group === "pitching" && c.group !== "pitching"))) {
        cur.bestRank = Math.min(cur.bestRank, p.rank || 99);
        cur.prop = c.prop; cur.group = c.group;
      }
      agg.set(p.id, cur);
    });
  }
  const ranked = [...agg.values()]
    .map((p) => ({ ...p, playing: TODAY_TEAMS.has(p.teamId),
                   score: C.interestScore({ leaderRank: p.bestRank, categories: p.cats, playingToday: TODAY_TEAMS.has(p.teamId) }) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  if (!ranked.length) { box.innerHTML = '<div class="empty">Leaderboards unavailable right now.</div>'; return; }
  box.innerHTML = "";
  const playingLabel = SPORT === "nfl" ? "this week" : "today";
  const th = document.getElementById("headlineTitle");
  if (th) th.textContent = SPORT === "nfl" ? "Headline players this week" : "Headline players today";
  const hn = document.getElementById("headlineNote");
  if (hn) hn.innerHTML = `<b>How this is ranked:</b> league leaders in the four most-offered prop categories,
    weighted by leaderboard rank, how many categories they lead, and whether they play ${playingLabel}.
    It is a disclosed proxy for prop popularity — <b>not</b> betting handle. Real public-money
    percentages are a paid product; anything free that claims to have them is making them up.`;
  ranked.forEach((p) => {
    const player = {
      id: p.id, name: p.name, team: p.team, teamId: p.teamId,
      pos: p.pos || (p.group === "pitching" ? "P" : ""),
      pitcher: p.group === "pitching"
    };
    const set = C.propsForPlayer(SPORT, player);
    if (!set.length) return;                       // no market for this position
    const prop = set.find((x) => x.k === p.prop) || set[0];
    const b = el("button", "res");
    b.innerHTML = `<div><div class="nm">${esc(p.name)}${p.playing ? `<span class="tag live" style="margin-left:7px">${playingLabel}</span>` : ""}</div>
      <div class="mt">${esc(p.team)}${player.pos ? " · " + esc(player.pos) : ""} · ${esc(prop.n)} ${prop.d} · #${p.bestRank} in ${p.cats > 1 ? p.cats + " categories" : "league"}</div></div>
      <span class="pos">open</span>`;
    b.onclick = () => openPlayer(player, prop.k);
    box.appendChild(b);
  });
}

/* ══════════════ RESEARCH ══════════════ */
const ROSTERS = {};
let CUR = null;

async function roster() {
  const sport = SPORT;
  if (ROSTERS[sport]) return ROSTERS[sport];
  const key = `cvx_roster_${sport}_${activeSeason()}`;
  const cached = sessionStorage.getItem(key);
  if (cached) { ROSTERS[sport] = JSON.parse(cached); return ROSTERS[sport]; }
  const list = await api(`${adapter().label} player index`).players();
  ROSTERS[sport] = list;
  try { sessionStorage.setItem(key, JSON.stringify(list)); } catch (e) {}
  return list;
}

const debounce = (f, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };

$("#q").addEventListener("input", debounce(async (e) => {
  const term = e.target.value.trim().toLowerCase();
  const box = $("#results");
  if (term.length < 2) { box.innerHTML = ""; return; }
  box.innerHTML = '<div class="spin"></div>';
  let list;
  try { list = await roster(); }
  catch (err) {
    box.innerHTML = `<div class="card"><div class="empty">Couldn't load the ${esc(adapter().label)} player index.<br><code>${esc(err.message)}</code><br><br>Check the System tab.</div></div>`;
    return;
  }
  const hits = list.filter((p) => p.name.toLowerCase().includes(term)).slice(0, 8);
  box.innerHTML = "";
  if (!hits.length) { box.innerHTML = '<div class="card"><div class="empty">No player matches that.</div></div>'; return; }
  const w = el("div", "results");
  hits.forEach((p) => {
    const b = el("button", "res");
    b.innerHTML = `<div><div class="nm">${esc(p.name)}</div><div class="mt">${esc(p.team || "—")}</div></div><span class="pos">${esc(p.pos)}</span>`;
    b.onclick = () => { $("#results").innerHTML = ""; $("#q").value = p.name; $("#q").blur(); openPlayer(p); };
    w.appendChild(b);
  });
  box.appendChild(w);
}, 220));

async function openPlayer(p, presetProp) {
  goto("research");
  $("#q").value = p.name; $("#results").innerHTML = "";
  CUR = { p, log: null, sel: presetProp || null, line: null };
  const host = $("#player");
  host.innerHTML = `<div class="card"><div class="card-h"><h2>${esc(p.name)}</h2><span class="sub">${esc(p.team || "")}</span></div><div class="spin"></div></div>`;
  const group = adapter().logGroupFor(p);
  let log;
  try { log = await api(`Game log · ${p.name}`).gameLog(p.id, group); }
  catch (e) { host.innerHTML = `<div class="card"><div class="empty">Game log unavailable.<br><code>${esc(e.message)}</code></div></div>`; return; }
  CUR.log = log;
  if (!log.length) {
    host.innerHTML = `<div class="card"><div class="card-h"><h2>${esc(p.name)}</h2></div><div class="empty">No ${activeSeason()} games logged yet.</div></div>`;
    return;
  }
  renderPlayer();
}

function renderPlayer() {
  const { p, log } = CUR, host = $("#player");
  const set = C.propsForPlayer(SPORT, p);
  host.innerHTML = "";
  if (!set.length) {
    host.innerHTML = `<div class="card"><div class="card-h"><h2>${esc(p.name)}</h2><span class="sub">${esc(p.pos || "")}</span></div>
      <div class="empty">No prop markets are offered for this position.</div></div>`;
    return;
  }

  const bar = el("div", "propbar");
  const sel = el("select");
  set.forEach((x) => { const o = el("option"); o.value = x.k; o.textContent = x.n; sel.appendChild(o); });
  sel.value = set.some((x) => x.k === CUR.sel) ? CUR.sel : set[0].k;
  const inp = el("input"); inp.type = "text"; inp.inputMode = "decimal";
  inp.value = CUR.line != null ? CUR.line : set.find((x) => x.k === sel.value).d;
  bar.append(sel, inp); host.appendChild(bar);

  const card = el("div", "card");
  card.innerHTML = `<div class="card-h"><h2>${esc(p.name)}</h2><span class="sub">${esc(p.team || "")}${p.pos ? " · " + esc(p.pos) : ""}</span></div>`;
  const body = el("div", "card-b"); card.appendChild(body); host.appendChild(card);

  function draw() {
    const prop = set.find((x) => x.k === sel.value);
    const line = parseFloat(inp.value);
    CUR.sel = sel.value; CUR.line = inp.value; CUR.prop = prop;
    const rows = log.map((s) => ({ v: prop.f(s.stat), date: s.date, opp: C.shortTeam({ name: s.opp }), home: s.home }));
    const vals = rows.map((r) => r.v);
    body.innerHTML = "";
    if (!isFinite(line)) { body.innerHTML = '<div class="empty">Enter a line.</div>'; return; }

    const tiles = el("div", "tiles");
    [["L5", 5], ["L10", 10], ["L20", 20], ["Season", 0]].forEach(([k, n]) => {
      const r = C.hitRate(vals, line, n);
      const col = r.n < 3 || !isFinite(r.rate) ? "var(--ink-3)" : r.rate >= 0.6 ? "var(--good)" : r.rate <= 0.4 ? "var(--bad)" : "var(--ink)";
      const d = el("div", "tile");
      d.innerHTML = `<div class="k">${k}</div><div class="v mono" style="color:${col}">${isFinite(r.rate) ? C.pct(r.rate) : "—"}</div>
        <div class="n mono">${r.over}/${r.over + r.under}${r.push ? " · " + r.push + "p" : ""}</div>`;
      tiles.appendChild(d);
    });
    body.appendChild(tiles);

    const season = C.hitRate(vals, line, 0);
    if (isFinite(season.rate)) {
      const ci = el("div", "cinote");
      ci.innerHTML = `Season ${C.pct(season.rate)} — but the 95% interval runs <b>${C.pct(season.ci[0])} to ${C.pct(season.ci[1])}</b>.
        Break-even at −110 is 52.4%. ${season.ci[0] > 0.524 ? "The whole interval clears it." : "The interval includes break-even, so this isn't evidence of an edge."}`;
      body.appendChild(ci);
    }

    body.appendChild(chart(rows.slice(0, 20).reverse(), line, prop));

    const lg = el("div", "legend");
    lg.innerHTML = `<span><i style="background:var(--good)"></i>Over</span>
      <span><i style="background:var(--bad);opacity:.62"></i>Under</span>
      <span><i class="dash"></i>${esc(prop.n)} ${line}</span>`;
    body.appendChild(lg);

    const add = el("div", "addrow");
    ["Over", "Under"].forEach((side) => {
      const b = el("button", "btn" + (side === "Over" ? " primary" : ""));
      b.textContent = `Add ${side} ${line}`;
      b.onclick = () => {
        const over = side === "Over";
        // carry the Wilson interval, not just the point estimate — the parlay screen
        // needs the uncertainty or it will print a confident number it hasn't earned
        const lo = over ? season.ci[0] : (isFinite(season.ci[1]) ? 1 - season.ci[1] : NaN);
        const hi = over ? season.ci[1] : (isFinite(season.ci[0]) ? 1 - season.ci[0] : NaN);
        addLeg({
          playerId: p.id, playerName: p.name, teamId: p.teamId || null,
          gameId: gameIdForTeam(p.teamId),
          propKey: prop.k, propName: prop.n, group: adapter().groupFor(p),
          sport: SPORT, line, side: side.toLowerCase(), american: -110,
          modelProb: over ? season.rate : (isFinite(season.rate) ? 1 - season.rate : NaN),
          ciLow: lo, ciHigh: hi, games: season.over + season.under
        });
      };
      add.appendChild(b);
    });
    body.appendChild(add);

    const note = el("div", "note"); note.style.marginTop = "12px";
    note.innerHTML = vals.length < 25
      ? `<b>${vals.length} games.</b> A hit rate on this few games is mostly noise — a hot-looking L10 shows up constantly by chance alone. Research starting point, not a signal.`
      : `<b>${vals.length} games.</b> Hit rate describes what happened, not what's priced. Clearing this line 65% of the time is only a bet if the book pays worse than 65%.`;
    body.appendChild(note);

    const tv = el("details", "tv");
    tv.innerHTML = `<summary>Table view</summary><table><thead><tr><th>Date</th><th>Opp</th><th>${esc(prop.n)}</th><th>Result</th></tr></thead><tbody>${
      rows.slice(0, 20).map((d) => `<tr><td class="mono">${esc(d.date.slice(5))}</td><td>${d.home ? "vs" : "@"} ${esc(d.opp)}</td><td class="mono">${d.v}</td><td class="${d.v > line ? "good" : d.v < line ? "bad" : ""}">${d.v > line ? "Over" : d.v < line ? "Under" : "Push"}</td></tr>`).join("")}</tbody></table>`;
    body.appendChild(tv);
  }
  // Count a research view once per player+market, NOT on every keystroke in the
  // line field — otherwise the "most-researched" board just counts typing.
  function countView() {
    const prop = set.find((x) => x.k === sel.value);
    if (!prop) return;
    const key = `${p.name}|${prop.n}`;
    VIEWS[key] = (VIEWS[key] || 0) + 1;
    store.set("views", VIEWS);
  }
  sel.onchange = () => { inp.value = set.find((x) => x.k === sel.value).d; draw(); countView(); };
  inp.oninput = draw;
  draw();
  countView();
}

/** Legs added before the schedule loaded carry gameId null, which silently
 *  disables same-game correlation detection. Fill them in once we know. */
function backfillGameIds() {
  let changed = false;
  PARLAY.forEach((l) => {
    if (l.gameId == null && l.teamId) {
      const id = gameIdForTeam(l.teamId);
      if (id != null) { l.gameId = id; changed = true; }
    }
  });
  if (changed) { store.set("parlay", PARLAY); renderParlay(); }
}

/** Which of today's games is this team in? Needed for same-game correlation. */
function gameIdForTeam(teamId) {
  if (!teamId) return null;
  const g = TODAY_GAMES.find((x) => x.away.id === teamId || x.home.id === teamId);
  return g ? g.gamePk : null;
}

function chart(show, line, prop) {
  const W = 600, H = 190, PL = 26, PR = 8, PT = 12, PB = 22;
  const peak = Math.max(line, ...show.map((x) => x.v), 1);
  const step = peak <= 4 ? 1 : peak <= 9 ? 2 : peak <= 20 ? 5 : 10;
  const max = Math.max(step, Math.ceil((peak * 1.1) / step) * step);
  const iw = (W - PL - PR) / Math.max(1, show.length), bw = Math.max(6, iw - 2.5);
  const y = (v) => PT + (H - PT - PB) * (1 - v / max);
  let g = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Game-by-game ${esc(prop.n)} versus a line of ${line}">`;
  for (let gv = 0; gv <= max; gv += step)
    g += `<line x1="${PL}" x2="${W - PR}" y1="${y(gv)}" y2="${y(gv)}" stroke="#16223a" stroke-width="1"/>
          <text class="axl" x="${PL - 6}" y="${y(gv) + 3}" text-anchor="end">${gv}</text>`;
  show.forEach((d, i) => {
    const x = PL + i * iw + (iw - bw) / 2, over = d.v > line;
    const h = Math.max(0, (H - PT - PB) - (y(d.v) - PT));
    g += `<rect class="bar" data-i="${i}" x="${x}" y="${y(d.v)}" width="${bw}" height="${h}" rx="4"
            fill="${over ? "var(--good)" : "var(--bad)"}" opacity="${over ? 1 : 0.62}"/>`;
  });
  g += `<line x1="${PL}" x2="${W - PR}" y1="${y(line)}" y2="${y(line)}" stroke="var(--accent)" stroke-width="2" stroke-dasharray="5 4"/>
        <text class="axl" x="${PL}" y="${H - 6}">older</text>
        <text class="axl" x="${W - PR}" y="${H - 6}" text-anchor="end">recent</text></svg>`;
  const ch = el("div", "chart"); ch.innerHTML = g;
  const tip = $("#tip");
  ch.querySelectorAll(".bar").forEach((r) => {
    const d = show[+r.dataset.i];
    const on = (e) => {
      const pt = e.touches ? e.touches[0] : e;
      tip.innerHTML = `<b>${d.v} ${esc(prop.n.toLowerCase())}</b> · ${d.v > line ? '<span style="color:var(--good)">over</span>' : d.v < line ? '<span style="color:var(--bad)">under</span>' : "push"}
        <div class="m">${esc(d.date)} ${d.home ? "vs" : "@"} ${esc(d.opp)}</div>`;
      tip.classList.add("on");
      tip.style.left = Math.min(innerWidth - 210, Math.max(8, pt.clientX - 90)) + "px";
      tip.style.top = Math.max(8, pt.clientY - 72) + "px";
    };
    r.addEventListener("pointerenter", on); r.addEventListener("pointermove", on);
    r.addEventListener("pointerleave", () => tip.classList.remove("on"));
    r.addEventListener("touchstart", on, { passive: true });
    r.addEventListener("touchend", () => setTimeout(() => tip.classList.remove("on"), 1400));
  });
  return ch;
}

/* ══════════════ PARLAY ══════════════ */
function addLeg(leg) {
  PARLAY.push(leg); store.set("parlay", PARLAY);
  toast(`Added ${leg.playerName} ${leg.side} ${leg.line}`);
  const badge = $("#parlayBadge");
  badge.textContent = PARLAY.length; badge.style.display = "inline-block";
}
function removeLeg(i) { PARLAY.splice(i, 1); store.set("parlay", PARLAY); renderParlay(); }

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("on"), 1900);
}

function renderParlay() {
  const badge = $("#parlayBadge");
  badge.textContent = PARLAY.length;
  badge.style.display = PARLAY.length ? "inline-block" : "none";

  const box = $("#legs"), sum = $("#parlaySummary");
  if (!PARLAY.length) {
    box.innerHTML = '<div class="empty">No legs yet.<br>Open a player in Research and tap <b>Add Over</b> or <b>Add Under</b>.</div>';
    sum.innerHTML = "";
    return;
  }
  box.innerHTML = "";
  PARLAY.forEach((l, i) => {
    const row = el("div", "leg");
    row.innerHTML = `
      <div class="leginfo">
        <div class="nm">${esc(l.playerName)}</div>
        <div class="mt">${esc(l.propName)} ${l.side === "over" ? "o" : "u"}${l.line}${isFinite(l.modelProb) ? ` · hit ${C.pct(l.modelProb)}` : ""}</div>
      </div>
      <input class="price mono" inputmode="text" autocomplete="off" value="${l.american}" aria-label="American price for leg ${i + 1}">
      <button class="x" aria-label="remove leg">✕</button>`;
    const priceEl = row.querySelector(".price");
    priceEl.oninput = (e) => {
      const txt = e.target.value.trim();
      if (txt === "" || txt === "-" || txt === "+") { priceEl.classList.add("invalid"); return; }
      const v = parseInt(txt, 10);
      // American odds don't exist between -100 and +100; reject rather than
      // silently computing a +19000 payout from a typo.
      if (!C.isValidAmerican(v)) { priceEl.classList.add("invalid"); return; }
      priceEl.classList.remove("invalid");
      PARLAY[i].american = v; store.set("parlay", PARLAY); calc();
    };
    priceEl.onblur = () => {
      if (!C.isValidAmerican(parseInt(priceEl.value, 10))) {
        priceEl.value = PARLAY[i].american; priceEl.classList.remove("invalid");
      }
    };
    row.querySelector(".x").onclick = () => removeLeg(i);
    box.appendChild(row);
  });
  calc();

  function calc() {
    const p = C.parlay(PARLAY.map((l) => ({ american: l.american })));
    const useModel = PARLAY.every((l) => isFinite(l.modelProb));
    const modelProb = useModel ? PARLAY.reduce((a, l) => a * l.modelProb, 1) : NaN;
    const modelEv = useModel ? modelProb * p.decimal - 1 : NaN;
    const issues = C.correlationIssues(PARLAY);

    let h = `<div class="hero">
      <div class="heroval mono">${C.formatAmerican(p.american)}</div>
      <div class="herosub">$100 returns <b class="mono">$${(100 + p.payoutPer100).toFixed(2)}</b> · ${PARLAY.length} legs</div>
    </div>
    <div class="kv"><span class="k">Book's implied chance</span><span class="mono">${C.pct(p.bookProb, 1)}</span></div>
    <div class="kv"><span class="k">Fair chance (vig removed)</span><span class="mono">${C.pct(p.fairProb, 1)}</span></div>
    <div class="kv"><span class="k">Book's hold on this ticket</span><span class="mono bad">${C.pct(p.hold, 1)}</span></div>
    <div class="kv"><span class="k">Expected value per $100</span><span class="mono bad">${(p.ev * 100).toFixed(2)}</span></div>`;

    if (useModel) {
      const haveCI = PARLAY.every((l) => isFinite(l.ciLow) && isFinite(l.ciHigh));
      const pLow = haveCI ? PARLAY.reduce((a, l) => a * l.ciLow, 1) : NaN;
      const pHigh = haveCI ? PARLAY.reduce((a, l) => a * l.ciHigh, 1) : NaN;
      const evLow = haveCI ? pLow * p.decimal - 1 : NaN;
      const evHigh = haveCI ? pHigh * p.decimal - 1 : NaN;
      const minGames = Math.min(...PARLAY.map((l) => l.games || 0));
      h += `<div class="kv"><span class="k">Your hit-rate estimate</span><span class="mono">${C.pct(modelProb, 1)}</span></div>`;
      if (haveCI) {
        const straddles = evLow < 0 && evHigh > 0;
        h += `<div class="kv"><span class="k">Same estimate, 95% interval</span><span class="mono">${C.pct(pLow, 1)} – ${C.pct(pHigh, 1)}</span></div>
              <div class="kv"><span class="k">EV per $100 across that range</span>
                <span class="mono ${evHigh < 0 ? "bad" : evLow > 0 ? "good" : ""}">${(evLow * 100).toFixed(2)} to ${(evHigh * 100).toFixed(2)}</span></div>
              <div class="note" style="margin-top:9px">${
                evHigh < 0
                  ? "Even the optimistic end of the interval loses money."
                  : evLow > 0
                    ? "The whole interval is positive — worth a closer look, though hit rate still isn't a calibrated model."
                    : `The interval straddles zero, so this ticket is <b>not</b> shown to be +EV. On ${minGames} games of history that's the expected result, not a surprise.`
              }</div>`;
      } else {
        h += `<div class="kv"><span class="k">EV per $100 on that estimate</span><span class="mono ${modelEv > 0 ? "good" : "bad"}">${(modelEv * 100).toFixed(2)}</span></div>`;
      }
    }

    h += `<div class="holdbar" role="img" aria-label="Book hold ${C.pct(p.hold, 1)} of the ticket">
            <div class="holdfill" style="width:${Math.min(100, Math.max(0, p.hold * 100)).toFixed(1)}%"></div>
          </div>
          <div class="note" style="margin-top:8px">A single −110 bet gives the book <b>4.5%</b>. This ticket gives it <b>${C.pct(p.hold, 1)}</b>. That gap is the entire reason parlays are promoted.</div>`;

    if (issues.length) {
      h += '<div class="issues">' + issues.map((i) =>
        `<div class="issue ${i.level}"><b>${i.level === "block" ? "Blocked" : i.level === "warn" ? "Correlated" : "Note"}</b> ${esc(i.message)}</div>`).join("") + "</div>";
    }
    if (useModel) {
      h += `<div class="note" style="margin-top:10px">The hit-rate estimate is a raw historical frequency, not a calibrated model. It ignores opponent, park, and lineup, and it assumes legs are independent — which the warnings above may already contradict.</div>`;
    } else {
      h += `<div class="note" style="margin-top:10px">Add legs from Research to get a hit-rate estimate alongside the book's number.</div>`;
    }
    h += `<div class="addrow" style="margin-top:12px"><button class="btn" id="clearParlay">Clear all legs</button></div>`;
    sum.innerHTML = h;
    $("#clearParlay").onclick = () => { PARLAY = []; store.set("parlay", PARLAY); renderParlay(); };
  }
}

/* ══════════════ CLV ══════════════ */
(function initCLV() {
  const log = store.get("clv", []);
  const m = C.meanCLV(log);
  $("#clvN").textContent = log.length + " logged";
  if (!log.length) {
    $("#clvBody").innerHTML = `<div class="hero">
      <div class="heroval mono" style="color:var(--ink-3)">—</div>
      <div class="herosub">mean CLV · 0 bets · about 200 needed</div></div>`;
  } else {
    $("#clvBody").innerHTML = `<div class="hero">
      <div class="heroval mono" style="color:${m.mean > 0 ? "var(--good)" : "var(--bad)"}">${C.signedPct(m.mean, 2)}</div>
      <div class="herosub">mean CLV · ${m.n} bets · t = ${isFinite(m.tStat) ? m.tStat.toFixed(2) : "—"}</div></div>`;
  }
})();

/* ══════════════ ENDPOINT PROBE ══════════════
   These feeds are public but undocumented. Rather than assume the shapes are
   right, the app can check them on a real device and report exactly what came
   back — which is the only place that can be verified. */
let PROBE_TEXT = "";

async function runProbe() {
  const out = $("#probeOut"), btn = $("#runProbe");
  btn.disabled = true; btn.textContent = "Running…";
  out.innerHTML = '<div class="spin"></div>';
  const lines = [];
  const rows = [];

  const checks = [
    { name: "MLB schedule", sport: "mlb", run: (c) => c.schedule(new Date().toISOString().slice(0, 10)),
      shape: (v) => `${v.length} games` + (v[0] ? ` · first: ${v[0].away.name} @ ${v[0].home.name}` : "") },
    { name: "MLB player index", sport: "mlb", run: (c) => c.players(),
      shape: (v) => `${v.length} players` + (v[0] ? ` · e.g. ${v[0].name} (${v[0].pos})` : "") },
    { name: "MLB leaders", sport: "mlb", run: (c) => c.leaders("homeRuns", 5),
      shape: (v) => `${v.length} rows` + (v[0] ? ` · #1 ${v[0].name} ${v[0].value}` : "") },
    { name: "NFL scoreboard", sport: "nfl", run: (c) => c.schedule(""),
      shape: (v) => `${v.length} games` + (v[0] ? ` · wk ${v[0].week} · ${v[0].away.name} @ ${v[0].home.name}` : "") },
    { name: "NFL teams", sport: "nfl", run: (c) => c.teams(),
      shape: (v) => `${v.length} teams` + (v[0] ? ` · e.g. ${v[0].name}` : "") },
    { name: "NFL leaders", sport: "nfl", run: (c) => c.leaders("passingYards", 5),
      shape: (v) => `${v.length} rows` + (v[0] ? ` · #1 ${v[0].name} ${v[0].value}` : "") }
  ];

  for (const chk of checks) {
    const t0 = performance.now();
    try {
      const cl = C.makeClientFor(chk.sport, { fetch: (...x) => fetch(...x) });
      const v = await chk.run(cl);
      const ms = Math.round(performance.now() - t0);
      const detail = Array.isArray(v) ? chk.shape(v) : typeof v;
      const empty = Array.isArray(v) && v.length === 0;
      rows.push({ name: chk.name, ok: !empty, warn: empty, detail, ms });
      lines.push(`${empty ? "EMPTY" : "OK"}  ${chk.name} (${ms}ms) — ${detail}`);
    } catch (e) {
      rows.push({ name: chk.name, ok: false, detail: e.message, ms: Math.round(performance.now() - t0) });
      lines.push(`FAIL  ${chk.name} — ${e.message}`);
    }
  }

  // one real game log per sport proves the hardest parser
  for (const sport of ["mlb", "nfl"]) {
    try {
      const cl = C.makeClientFor(sport, { fetch: (...x) => fetch(...x) });
      const ps = await cl.players();
      const p = ps.find((x) => (sport === "nfl" ? x.pos === "QB" : !x.pitcher)) || ps[0];
      if (!p) throw new Error("no players returned");
      const log = await cl.gameLog(p.id, sport === "mlb" ? "hitting" : "batting");
      const keys = log[0] ? Object.keys(log[0].stat).slice(0, 8).join(", ") : "(none)";
      const okShape = log.length > 0 && !!log[0] && Object.keys(log[0].stat).length > 0;
      rows.push({ name: `${sport.toUpperCase()} game log · ${p.name}`, ok: okShape, warn: !okShape,
                  detail: `${log.length} games · stat keys: ${keys}` });
      lines.push(`${okShape ? "OK" : "EMPTY"}  ${sport} gamelog ${p.name} — ${log.length} games — keys: ${keys}`);
    } catch (e) {
      rows.push({ name: `${sport.toUpperCase()} game log`, ok: false, detail: e.message });
      lines.push(`FAIL  ${sport} gamelog — ${e.message}`);
    }
  }

  PROBE_TEXT = lines.join("\n");
  const bad = rows.filter((r) => !r.ok).length;
  $("#probeSub").textContent = bad ? `${bad} of ${rows.length} need attention` : `all ${rows.length} OK`;
  const box = el("div", "probe");
  rows.forEach((r) => {
    const d = el("div", "row");
    d.innerHTML = `<div class="nm"><b>${esc(r.name)}</b><span>${esc(r.detail)}</span></div>
      <div class="st ${r.ok ? "good" : r.warn ? "" : "bad"}" ${r.warn ? 'style="color:var(--warn)"' : ""}>${
        r.ok ? "OK" : r.warn ? "EMPTY" : "FAIL"}${r.ms != null ? " · " + r.ms + "ms" : ""}</div>`;
    box.appendChild(d);
  });
  out.innerHTML = ""; out.appendChild(box);
  btn.disabled = false; btn.textContent = "Run probe again";
}

if ($("#runProbe")) $("#runProbe").onclick = runProbe;
if ($("#copyProbe")) $("#copyProbe").onclick = async () => {
  if (!PROBE_TEXT) { toast("Run the probe first"); return; }
  try { await navigator.clipboard.writeText(PROBE_TEXT); toast("Probe result copied"); }
  catch (e) { toast("Copy blocked — select the text instead"); }
};

renderDiag();
renderParlay();
loadBoard();               // Board is the default view — load it on start, not only on tab click
roster().catch(() => {});
