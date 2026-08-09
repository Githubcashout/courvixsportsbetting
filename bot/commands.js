/* Courvix Discord — command definitions and handlers.
   Zero dependencies. Shares core.js with the app, so the bot and the
   app can never disagree about a number.                               */
"use strict";
const C = require("../core.js");

const NAVY = 0x4d8bff, GREEN = 0x31c48d, RED = 0xf2617a, GREY = 0x7e93b4;

/* ── slash command definitions (posted to Discord by register.js) ── */
const SPORT_CHOICE = { name: "sport", description: "League (defaults to MLB)", type: 3, required: false,
  choices: [{ name: "MLB", value: "mlb" }, { name: "NFL", value: "nfl" }] };

/* Discord caps a command at 25 choices, so markets are namespaced
   sport:group:key and the whole list is asserted under the cap by the tests. */
const MARKET_CHOICES = [].concat(
  C.propsFor("mlb", "batting").map((p) => ({ name: "MLB " + p.n, value: "mlb:b:" + p.k })),
  C.propsFor("mlb", "pitching").map((p) => ({ name: "MLB P " + p.n, value: "mlb:p:" + p.k })),
  C.propsFor("nfl", "batting").map((p) => ({ name: "NFL " + p.n, value: "nfl:b:" + p.k }))
).slice(0, 25);

const DEFINITIONS = [
  {
    name: "player",
    description: "Season game log summary for a player",
    options: [{ name: "name", description: "Player name", type: 3, required: true }, SPORT_CHOICE]
  },
  {
    name: "prop",
    description: "Hit rate for a player prop, with the confidence interval",
    options: [
      { name: "name", description: "Player name", type: 3, required: true },
      { name: "market", description: "Prop category", type: 3, required: true, choices: MARKET_CHOICES },
      { name: "line", description: "The line, e.g. 0.5", type: 10, required: false },
      SPORT_CHOICE
    ]
  },
  { name: "slate", description: "Today's games — this week's slate for NFL",
    options: [SPORT_CHOICE] },
  {
    name: "parlay",
    description: "True odds, hold and EV for a parlay",
    options: [{ name: "odds", description: "Comma-separated American odds, e.g. -110,-110,+150", type: 3, required: true }]
  },
  {
    name: "catalog",
    description: "The prop categories books offer for a sport",
    options: [{ name: "sport", description: "Sport", type: 3, required: true, choices:
      Object.keys(C.PROP_CATALOG).map((k) => ({ name: C.PROP_CATALOG[k].label, value: k })) }]
  }
];

/* ── helpers ── */
const opt = (data, name) => ((data.options || []).find((o) => o.name === name) || {}).value;
const sportOf = (data) => (opt(data, "sport") === "nfl" ? "nfl" : "mlb");
const bar = (r) => {
  if (!isFinite(r)) return "";
  const filled = Math.round(r * 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
};

function embed(title, description, color, fields, footer) {
  const e = { title, color: color == null ? NAVY : color };
  if (description) e.description = description;
  if (fields && fields.length) e.fields = fields;
  if (footer) e.footer = { text: footer };
  return { embeds: [e] };
}
const errEmbed = (msg) => embed("Couldn't do that", msg, RED);

async function findPlayer(client, name) {
  const all = await client.players();
  const term = String(name).toLowerCase().trim();
  const exact = all.find((p) => p.name.toLowerCase() === term);
  if (exact) return exact;
  const hits = all.filter((p) => p.name.toLowerCase().includes(term));
  if (!hits.length) return null;
  if (hits.length > 1) {
    // prefer the shortest name — "Soto" should not resolve to a longer partial match
    hits.sort((a, b) => a.name.length - b.name.length);
  }
  return hits[0];
}

/* ── handlers ── */

async function cmdPlayer(client, data) {
  const sport = client.sport === "nfl" ? "nfl" : "mlb";
  const p = await findPlayer(client, opt(data, "name"));
  if (!p) return errEmbed(`No ${sport.toUpperCase()} player matches **${opt(data, "name")}**.`);
  const adapter = C.SPORT_ADAPTERS[sport];
  const log = await client.gameLog(p.id, adapter.logGroupFor(p));
  if (!log.length) return embed(p.name, `No ${client.season} games logged yet.`, GREY);

  const set = C.propsForPlayer(sport, p);
  if (!set.length) return embed(p.name, `No prop markets are offered for ${p.pos || "this position"}.`, GREY);
  const fields = set.slice(0, 5).map((prop) => {
    const vals = log.map((g) => prop.f(g.stat));
    const r = C.hitRate(vals, prop.d, 0);
    const total = vals.reduce((a, b) => a + b, 0);
    return {
      name: prop.n,
      value: `${total} total · o${prop.d} in ${C.pct(r.rate)} of ${r.over + r.under}`,
      inline: true
    };
  });
  const recent = log.slice(0, 5).map((g) =>
    `\`${g.date.slice(5)}\` ${g.home ? "vs" : "@"} ${C.shortTeam({ name: g.opp })}`).join("\n");
  fields.push({ name: "Last 5", value: recent || "—", inline: false });

  return embed(`${p.name}${p.team ? " · " + p.team : ""}${p.pos ? " (" + p.pos + ")" : ""}`,
    `${log.length} games logged in the ${client.season} season.`, NAVY, fields,
    "Season totals and hit rates at the default line. Use /prop for a specific number.");
}

async function cmdProp(client, data) {
  const raw = String(opt(data, "market") || "");
  const bits = raw.split(":");
  // accept "mlb:b:hits", legacy "b:hits", and a bare key
  const mSport = bits.length === 3 ? bits[0] : (client.sport === "nfl" ? "nfl" : "mlb");
  const g = bits.length === 3 ? bits[1] : (bits.length === 2 ? bits[0] : "b");
  const key = bits[bits.length - 1];
  const group = g === "p" ? "pitching" : "batting";
  const prop = C.propsFor(mSport, group).find((x) => x.k === key);
  if (!prop) return errEmbed("Unknown market.");

  const sport = client.sport === "nfl" ? "nfl" : "mlb";
  if (mSport !== sport) {
    return errEmbed(`That's a ${mSport.toUpperCase()} market but you asked for ${sport.toUpperCase()}. Set \`sport\` to match.`);
  }

  const p = await findPlayer(client, opt(data, "name"));
  if (!p) return errEmbed(`No ${sport.toUpperCase()} player matches **${opt(data, "name")}**.`);

  if (sport === "mlb") {
    if (group === "pitching" && !p.pitcher) return errEmbed(`${p.name} isn't a pitcher — pick a hitting market.`);
    if (group === "batting" && p.pitcher) return errEmbed(`${p.name} is a pitcher — pick a **P** market.`);
  } else if (!C.propsForPlayer("nfl", p).some((x) => x.k === prop.k)) {
    return errEmbed(`${p.name} is a ${p.pos || "non-skill"} — **${prop.n}** isn't offered for that position.`);
  }

  const line = opt(data, "line") != null ? Number(opt(data, "line")) : prop.d;
  if (!isFinite(line)) return errEmbed("That line isn't a number.");

  const log = await client.gameLog(p.id, C.SPORT_ADAPTERS[sport].logGroupFor(p));
  if (!log.length) return embed(p.name, `No ${client.season} games logged yet.`, GREY);
  const vals = log.map((s) => prop.f(s.stat));

  const rows = [["L5", 5], ["L10", 10], ["L20", 20], ["Season", 0]].map(([lab, n]) => {
    const r = C.hitRate(vals, line, n);
    return { name: lab, value: isFinite(r.rate) ? `**${C.pct(r.rate)}**\n${r.over}/${r.over + r.under}` : "—", inline: true };
  });

  const s = C.hitRate(vals, line, 0);
  const clears = s.ci[0] > 0.524;
  const desc =
    `\`${bar(s.rate)}\`  **${C.pct(s.rate)}** over ${line}\n` +
    `95% interval **${C.pct(s.ci[0])} – ${C.pct(s.ci[1])}** on ${s.over + s.under} games`;

  rows.push({
    name: "Versus break-even",
    value: clears
      ? `The whole interval clears the 52.4% break-even at −110.`
      : `The interval includes 52.4% break-even, so this is **not** evidence of an edge.`,
    inline: false
  });

  return embed(`${p.name} · ${prop.n} ${line}`, desc, clears ? GREEN : GREY, rows,
    "Hit rate is history, not a price. It's only a bet if the book pays worse than the true rate.");
}

async function cmdSlate(client) {
  const nfl = client.sport === "nfl";
  const d = nfl ? "" : new Date().toISOString().slice(0, 10);   // ESPN with no date = current week
  const games = await client.schedule(d);
  const title = nfl ? "This week's slate" : "Today's slate";
  if (!games.length) return embed(title, "No games scheduled.", GREY);
  const lines = games.map((g) => {
    const live = g.state !== "Preview";
    const when = live ? g.detail
      : new Date(g.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";
    const score = live ? `  **${g.away.score ?? 0}–${g.home.score ?? 0}**` : "";
    const pitchers = (g.away.pitcher || g.home.pitcher)
      ? `\n   ${g.away.pitcher || "TBD"} vs ${g.home.pitcher || "TBD"}` : "";
    return `**${g.away.name} @ ${g.home.name}**${score} · ${when}${pitchers}`;
  });
  return embed(`${title} · ${games.length} games`, lines.join("\n\n").slice(0, 4000), NAVY);
}

function cmdParlay(data) {
  const raw = String(opt(data, "odds") || "");
  const parts = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return errEmbed("Give me some odds, e.g. `-110,-110,+150`.");
  if (parts.length > 15) return errEmbed("15 legs is the limit.");

  const legs = [];
  for (const s of parts) {
    const v = parseInt(s.replace(/^\+/, ""), 10);
    if (!isFinite(v) || v === 0 || Math.abs(v) < 100) return errEmbed(`\`${s}\` isn't valid American odds.`);
    legs.push({ american: v });
  }
  const p = C.parlay(legs);
  const single = C.marketHold(-110, -110);

  return embed(
    `${legs.length}-leg parlay · ${C.formatAmerican(p.american)}`,
    `$100 returns **$${(100 + p.payoutPer100).toFixed(2)}**`,
    RED,
    [
      { name: "Book's implied chance", value: C.pct(p.bookProb, 1), inline: true },
      { name: "Fair chance", value: C.pct(p.fairProb, 1), inline: true },
      { name: "Book's hold", value: `**${C.pct(p.hold, 1)}**`, inline: true },
      { name: "Expected value", value: `**${(p.ev * 100).toFixed(2)}** per $100 staked`, inline: false },
      { name: "For comparison", value:
        `A single −110 bet holds ${C.pct(single, 1)}. This ticket holds ${C.pct(p.hold, 1)} — ` +
        `${(p.hold / single).toFixed(1)}× as much. That multiple is why parlays get promoted.`, inline: false }
    ],
    "Assumes independent legs. Same-game legs are correlated and the real hold is higher still."
  );
}

function cmdCatalog(data) {
  const sport = opt(data, "sport");
  const cat = C.PROP_CATALOG[sport];
  if (!cat) return errEmbed("Unknown sport.");
  const fields = [];
  if ((cat.batting || []).length)
    fields.push({ name: sport === "mlb" ? "Batting" : "Player props",
      value: cat.batting.map((p) => `• ${p.n} — typical line **${p.d}**`).join("\n"), inline: false });
  if ((cat.pitching || []).length)
    fields.push({ name: "Pitching",
      value: cat.pitching.map((p) => `• ${p.n} — typical line **${p.d}**`).join("\n"), inline: false });
  return embed(`${cat.label} prop catalog`,
    cat.live ? "Live data available." : "Catalog only — live data not wired for this sport yet.",
    cat.live ? GREEN : GREY, fields,
    "Typical lines, not live prices. Live prop pricing requires a paid odds feed.");
}

/** Route an interaction's data object to a response payload.
 *  `clientFor(sport)` lets the caller build the right data client lazily. */
async function handleCommand(name, data, client, clientFor) {
  try {
    const want = sportOf(data || {});
    let cl = client;
    if (clientFor && (!cl || cl.sport !== want)) cl = clientFor(want);
    if (cl && !cl.sport) cl.sport = "mlb";
    switch (name) {
      case "player":  return await cmdPlayer(cl, data);
      case "prop":    return await cmdProp(cl, data);
      case "slate":   return await cmdSlate(cl);
      case "parlay":  return cmdParlay(data);
      case "catalog": return cmdCatalog(data);
      default:        return errEmbed(`Unknown command \`${name}\`.`);
    }
  } catch (e) {
    return errEmbed(`Data source failed: \`${e.message}\``);
  }
}

module.exports = { DEFINITIONS, MARKET_CHOICES, handleCommand, cmdParlay, cmdCatalog, findPlayer, sportOf };
