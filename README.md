# Courvix Network

A sports research tool and Discord bot. One shared maths core, so the app and the
bot can never disagree about a number.

Everything here runs on free data. The things that are not free are named in the
app rather than hidden.

---

## What's in the box

```
core.js              all the maths — odds, de-vig, hit rates, parlay, correlation
app.js               the web app's DOM layer (no maths)
index.html           app shell + dark blue design system
build.js             inlines core+app into one self-contained file
dist/courvix.html    ← the deliverable. Open this.

bot/commands.js      slash command definitions and handlers
bot/bot.js           Node HTTP interactions server (zero dependencies)
bot/worker.js        Cloudflare Workers build of the same bot
bot/register.js      registers the slash commands with Discord

ios/                 native iPhone app (WKWebView, no frameworks) + CI build
.github/workflows/   free macOS runner that produces the .ipa

test/core.test.js    299 tests — maths, odds domain, NFL parsing, season rollover
test/bot.test.js     140 tests — commands, Discord limits, Ed25519, worker build
test/ios.test.js      77 tests — plist, entitlements, icons, CI, AltStore manifest
test/ui.test.py      135 tests — Playwright, iPhone viewport, sport switch, offline
```

Run everything:

```bash
node test/core.test.js && node test/bot.test.js && node build.js && python3 test/ui.test.py
```

---

## The app

`dist/courvix.html` is one file with no dependencies and no backend. It fetches
MLB data directly from the browser.

**Sports** — MLB and NFL are both live. Tap the pill to switch; Board, Research
and Parlay all follow. Outside the NFL season the app shows the last completed
season and says so, rather than showing empty screens.

**Board** — today's games (this week's, for NFL), plus headline players ranked by
a disclosed interest score (leaderboard rank × categories led × playing today).
The global prop catalog across five sports. Your own most-researched props, which
is the only "trending" number in the app that is actually measured.

**Research** — search a player, choose a market, set a line. Markets are gated by
position: a receiver is never offered passing yards, and a kicker is offered
nothing. Hit rates for L5,
L10, L20 and season, each with the Wilson 95% interval and a comparison to the
52.4% break-even at −110. Game-by-game chart, tooltips, table view.

**Parlay** — add legs from Research. Shows combined price, payout, the book's
implied chance, the fair chance with vig removed, the book's hold on that
specific ticket, and expected value. Your hit-rate estimate is reported as an
interval, not a point, because a point estimate on 24 games is not a number
anyone should bet on. Correlated and contradictory legs are flagged or blocked.

**CLV** — empty until there's real data. Schema is in place.

**System** — every API call with latency, an honest coverage table, and an
**endpoint probe**: one tap hits every feed and reports what actually came back,
including the parsed stat keys. ESPN's endpoints are public but undocumented, so
this is how you confirm a shape hasn't drifted.

### Install to your phone

**As a real app (AltStore).** Push to GitHub, run the **Build iOS IPA** workflow,
and add the AltStore source URL it prints. Full details in [`ios/README.md`](ios/README.md).
No Mac required — GitHub's macOS runners do the build.

**As a PWA.** Host the single file anywhere free — Netlify Drop, Cloudflare Pages,
GitHub Pages — then Safari → Share → Add to Home Screen.

---

## The Discord bot

Five commands, all sharing `core.js` with the app:

| Command | What it does |
|---|---|
| `/player name: sport:` | Season summary and recent form |
| `/prop name: market: line: sport:` | Hit rates with the confidence interval and break-even comparison |
| `/slate sport:` | Today's games — this week's slate for NFL |
| `/parlay odds:` | True price, hold and EV for any set of American odds |
| `/catalog sport:` | The prop categories books offer, per sport |

### Setup

1. **Create the application** at discord.com/developers/applications. Copy the
   **Application ID** and **Public Key** from General Information, and a **Bot
   Token** from the Bot tab.

2. **Register the commands:**

   ```bash
   DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... node bot/register.js
   ```

   Pass `DISCORD_GUILD_ID` while testing — guild commands appear instantly,
   global ones take up to an hour.

3. **Run the bot.** Discord requires a public HTTPS endpoint.

   *Cloudflare Workers (free, always on — recommended):*
   ```bash
   npx wrangler deploy
   npx wrangler secret put DISCORD_PUBLIC_KEY
   ```

   *Or Node anywhere:*
   ```bash
   DISCORD_PUBLIC_KEY=... DISCORD_APP_ID=... node bot/bot.js
   ```

4. **Point Discord at it.** In General Information, set **Interactions Endpoint
   URL** to `https://your-host/interactions`. Discord sends a signed PING and
   will refuse to save the URL unless verification passes — the bot handles this.

5. **Invite the bot** with the `applications.commands` scope.

### Security

Every request is Ed25519-verified against your public key before anything is
parsed. Unsigned and forged requests get a 401. This is required — without it,
anyone who finds your URL can post fake interactions. Both builds implement it,
Node via `crypto.verify` and Workers via WebCrypto, and there are 12 tests
covering tampered bodies, wrong timestamps, and signatures from other keys.

---

## What is free, and what is not

**Free and unlimited:** all MLB stats via the official MLB Stats API, and all NFL
stats via ESPN's public endpoints. No key, no cap. ESPN's are undocumented, which
is why the probe exists — if a shape drifts, the probe names it.

**Free but thin:** live odds. SharpAPI gives ~17,280 requests/month on two
sportsbooks; The Odds API gives 500 credits/month. Neither includes props or
Pinnacle.

**Not free anywhere:** Pinnacle lines, player prop pricing, historical odds
archives. Roughly $99/month.

**Not available at all:** public betting percentages. Books don't publish handle.
Any free product claiming to show you "what everyone is betting" is inventing it.
Courvix substitutes a disclosed leaderboard-based interest score and says so on
the screen.

---

## Known limits

- Live prop pricing, Pinnacle and historical odds are paid-only, so the CLV
  screen stays empty until a key is supplied.
- `/slate` renders times in US Eastern.
- Same-game correlation depends on today's schedule; legs added before it
  resolves are backfilled once it does.
- NBA, NHL and soccer are catalog-only; NFL and MLB are live.
- NFL data comes from ESPN's undocumented public endpoints. They are stable in
  practice but carry no guarantee — run the probe if something looks wrong.
- The NFL player index is built from all 32 team rosters, so the first NFL search
  of a session takes a moment. It is cached for the rest of the session.

## Design notes

The chart palette is validated, not chosen by eye — six categorical hues checked
against the navy surface for lightness band, chroma floor, colourblind separation
(protan/deutan/tritan), normal-vision separation and contrast. All six checks
pass.

Numbers that flatter the user are shown with their uncertainty attached. The
parlay screen states the book's hold next to a single bet's 4.5% and explains the
multiple. That is a deliberate product decision: for an audience of one, a tool
that tells you what you want to hear is worth less than nothing.
