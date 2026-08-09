"""Courvix UI test suite — Playwright, iPhone viewport, fully mocked MLB API.
Run:  python3 test/ui.test.py [--shots]
"""
import json, os, sys
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(ROOT, "dist", "courvix.html")
SHOTS = "--shots" in sys.argv

passed, failed, failures = 0, 0, []
def ok(name, cond, detail=""):
    global passed, failed
    if cond: passed += 1
    else:
        failed += 1
        failures.append(f"{name}" + (f"  → {detail}" if detail else ""))

# ── fixtures ────────────────────────────────────────────────────────────
OPPS = ["Boston Red Sox", "Tampa Bay Rays", "Houston Astros", "Seattle Mariners", "Toronto Blue Jays"]
def batting_log(n=24):
    out = []
    for i in range(n):
        h = (i * 7919) % 97
        out.append({"date": f"2026-0{5 + i // 12}-{(i % 28) + 1:02d}", "isHome": i % 2 == 0,
                    "opponent": {"name": OPPS[i % 5]},
                    "stat": {"hits": h % 3, "totalBases": (h % 3) + (h % 2), "rbi": h % 3,
                             "runs": h % 2, "homeRuns": 1 if h % 9 == 0 else 0,
                             "strikeOuts": h % 3, "baseOnBalls": h % 2, "stolenBases": 0}})
    return out
def pitching_log(n=12):
    out = []
    for i in range(n):
        h = (i * 613) % 41
        out.append({"date": f"2026-07-{(i % 28) + 1:02d}", "isHome": i % 2 == 0,
                    "opponent": {"name": OPPS[i % 5]},
                    "stat": {"strikeOuts": 4 + h % 8, "earnedRuns": h % 5, "hits": 3 + h % 6,
                             "baseOnBalls": h % 4, "inningsPitched": f"{5 + h % 3}.{h % 3}"}})
    return out

PLAYERS = {"people": [
    {"id": 592450, "fullName": "Aaron Judge", "primaryPosition": {"abbreviation": "RF", "code": "9"},
     "currentTeam": {"id": 147, "name": "New York Yankees"}},
    {"id": 694973, "fullName": "Paul Skenes", "primaryPosition": {"abbreviation": "P", "code": "1"},
     "currentTeam": {"id": 134, "name": "Pittsburgh Pirates"}},
    {"id": 665742, "fullName": "Juan Soto", "primaryPosition": {"abbreviation": "LF", "code": "7"},
     "currentTeam": {"id": 121, "name": "New York Mets"}},
    {"id": 646240, "fullName": "Rafael Devers", "primaryPosition": {"abbreviation": "3B", "code": "5"},
     "currentTeam": {"id": 111, "name": "Boston Red Sox"}}]}
SCHED = {"dates": [{"games": [
    {"gamePk": 1, "gameDate": "2026-08-08T23:05:00Z",
     "status": {"abstractGameState": "Preview", "detailedState": "Scheduled"},
     "teams": {"away": {"team": {"id": 111, "name": "Boston Red Sox", "clubName": "Red Sox"},
                        "probablePitcher": {"fullName": "Garrett Crochet"}},
               "home": {"team": {"id": 147, "name": "New York Yankees", "clubName": "Yankees"},
                        "probablePitcher": {"fullName": "Max Fried"}}}},
    {"gamePk": 2, "gameDate": "2026-08-08T20:10:00Z",
     "status": {"abstractGameState": "Live", "detailedState": "Top 6th"},
     "teams": {"away": {"team": {"id": 119, "name": "Los Angeles Dodgers", "clubName": "Dodgers"}, "score": 4},
               "home": {"team": {"id": 135, "name": "San Diego Padres", "clubName": "Padres"}, "score": 2}}}]}]}
BATTERS  = [(592450, "Aaron Judge", 147, "New York Yankees"),
            (665742, "Juan Soto", 121, "New York Mets")]
PITCHERS = [(694973, "Paul Skenes", 134, "Pittsburgh Pirates")]
def leaders(url):
    # strikeouts is the pitching leaderboard; the rest are hitting
    who = PITCHERS if "strikeouts" in url.lower() else BATTERS
    return {"leagueLeaders": [{"leaders": [
        {"rank": str(i + 1), "person": {"id": p[0], "fullName": p[1]},
         "team": {"id": p[2], "name": p[3]}, "value": str(40 - i * 3)} for i, p in enumerate(who)]}]}

# ── ESPN / NFL fixtures ─────────────────────────────────────────────────
NFL_TEAMS = {"sports": [{"leagues": [{"teams": [
    {"team": {"id": "12", "name": "Chiefs", "displayName": "Kansas City Chiefs",
              "shortDisplayName": "Chiefs", "abbreviation": "KC"}},
    {"team": {"id": "17", "name": "Ravens", "displayName": "Baltimore Ravens",
              "shortDisplayName": "Ravens", "abbreviation": "BAL"}}]}]}]}
NFL_ROSTERS = {
 "12": {"athletes": [{"position": "offense", "items": [
    {"id": "3139477", "fullName": "Patrick Mahomes", "position": {"abbreviation": "QB"}},
    {"id": "4241457", "fullName": "Rashee Rice", "position": {"abbreviation": "WR"}},
    {"id": "9001", "fullName": "Harrison Butker", "position": {"abbreviation": "K"}}]}]},
 "17": {"athletes": [{"position": "offense", "items": [
    {"id": "3916387", "fullName": "Lamar Jackson", "position": {"abbreviation": "QB"}},
    {"id": "4429795", "fullName": "Zay Flowers", "position": {"abbreviation": "WR"}}]}]}}
NFL_SCOREBOARD = {"events": [
    {"id": "401", "date": "2026-09-10T00:20Z", "week": {"number": 1},
     "status": {"type": {"state": "pre", "shortDetail": "Thu 8:20 PM"}},
     "competitions": [{"competitors": [
        {"homeAway": "home", "team": {"id": "12", "shortDisplayName": "Chiefs"}},
        {"homeAway": "away", "team": {"id": "17", "shortDisplayName": "Ravens"}}]}]},
    {"id": "402", "date": "2026-09-13T17:00Z", "week": {"number": 1},
     "status": {"type": {"state": "in", "shortDetail": "Q3 4:11"}},
     "competitions": [{"competitors": [
        {"homeAway": "home", "score": "17", "team": {"id": "21", "shortDisplayName": "Eagles"}},
        {"homeAway": "away", "score": "10", "team": {"id": "19", "shortDisplayName": "Giants"}}]}]}]}
NFL_LEADERS = {"leaders": [
    {"name": "passingYards", "leaders": [
       {"value": 4183, "athlete": {"id": "3139477", "displayName": "Patrick Mahomes",
        "position": {"abbreviation": "QB"}}, "team": {"id": "12", "shortDisplayName": "Chiefs"}},
       {"value": 3955, "athlete": {"id": "3916387", "displayName": "Lamar Jackson",
        "position": {"abbreviation": "QB"}}, "team": {"id": "17", "shortDisplayName": "Ravens"}}]},
    {"name": "receivingYards", "leaders": [
       {"value": 1263, "athlete": {"id": "4241457", "displayName": "Rashee Rice",
        "position": {"abbreviation": "WR"}}, "team": {"id": "12", "shortDisplayName": "Chiefs"}}]}]}

def nfl_gamelog(kind="qb", n=16):
    names = (["completions/passingAttempts", "passingYards", "passingTouchdowns", "interceptions"]
             if kind == "qb" else ["receptions", "receivingYards", "receivingTouchdowns"])
    events, rows = {}, []
    for i in range(n):
        h = (i * 331) % 53
        eid = f"E{i}"
        events[eid] = {"gameDate": f"2025-{9 + i // 5:02d}-{(i % 27) + 1:02d}", "week": i + 1,
                       "homeAway": "home" if i % 2 == 0 else "away",
                       "opponent": {"displayName": "Ravens" if i % 2 else "Bengals"}}
        stats = ([f"{18 + h % 7}/{28 + h % 9}", str(180 + h * 3), str(h % 4), str(h % 2)]
                 if kind == "qb" else [str(3 + h % 6), str(30 + h * 2), str(1 if h % 7 == 0 else 0)])
        rows.append({"eventId": eid, "stats": stats})
    return {"names": names, "events": events,
            "seasonTypes": [
              {"displayName": "2025 Preseason", "categories": [
                 {"type": "passing" if kind == "qb" else "receiving",
                  "events": [{"eventId": "PRE1", "stats": rows[0]["stats"]}]}]},
              {"displayName": "2025 Regular Season", "categories": [
                 {"type": "passing" if kind == "qb" else "receiving", "events": rows}]}]}

def espn_handler(route):
    u = route.request.url
    if "/teams/" in u and "/roster" in u:
        tid = u.split("/teams/")[1].split("/")[0]
        body = NFL_ROSTERS.get(tid, {"athletes": []})
    elif u.rstrip("/").endswith("/teams"):      body = NFL_TEAMS
    elif "/scoreboard" in u:                    body = NFL_SCOREBOARD
    elif "/leaders" in u:                       body = NFL_LEADERS
    elif "/gamelog" in u:
        body = nfl_gamelog("wr" if "/4241457/" in u or "/4429795/" in u else "qb")
    else:                                       body = {}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

def handler(route):
    u = route.request.url
    if "/sports/1/players" in u:      body = PLAYERS
    elif "/stats/leaders" in u:       body = leaders(u)
    elif "gameLog" in u and "group=pitching" in u: body = {"stats": [{"splits": pitching_log()}]}
    elif "gameLog" in u:              body = {"stats": [{"splits": batting_log()}]}
    elif "/schedule" in u:            body = SCHED
    else:                             body = {}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

# ── run ─────────────────────────────────────────────────────────────────
errors = []
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                        is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errors.append("PAGEERROR: " + str(e)))
    pg.route("**/statsapi.mlb.com/**", handler)
    pg.route("**/*.espn.com/**", espn_handler)
    pg.goto("file://" + TARGET)
    pg.wait_for_timeout(1400)

    # ── board ───────────────────────────────────────────
    ok("board is the default view", pg.is_visible("#v-board"))
    ok("games rendered", pg.locator(".game").count() == 2, str(pg.locator(".game").count()))
    ok("club names used, not city names", "Yankees" in pg.inner_text("#games") and "New York Yankees" not in pg.inner_text("#games"))
    ok("live game shows score", "4" in pg.inner_text("#games") and "Top 6th" in pg.inner_text("#games"))
    ok("scheduled game shows a time", ":" in pg.inner_text("#games"))
    ok("headline players ranked", pg.locator("#topProps .res").count() >= 3, str(pg.locator("#topProps .res").count()))
    ok("players in today's games flagged", "today" in pg.inner_text("#topProps").lower())
    ok("ranking method disclosed", "not" in pg.inner_text("#v-board").lower() and "handle" in pg.inner_text("#v-board").lower())
    _tp = pg.inner_text("#topProps")
    ok("pitcher on the board is not offered a hitting prop",
       not ("Skenes" in _tp and "Home runs" in _tp.split("Skenes")[1][:80]), _tp.replace("\n"," ")[:300])
    ok("catalog covers 5 sports", pg.locator("#catalog .catrow").count() == 5, str(pg.locator("#catalog .catrow").count()))
    ok("soccer props present", "Shots on target" in pg.inner_text("#catalog"))
    ok("nba props present", "Pts+Reb+Ast" in pg.inner_text("#catalog"))
    ok("trending starts empty and says so", "Nothing yet" in pg.inner_text("#yours"))
    if SHOTS: pg.screenshot(path=os.path.join(ROOT, "shot-board.png"))

    # ── research via board tap ──────────────────────────
    pg.locator("#topProps .res").first.click()
    pg.wait_for_timeout(900)
    ok("tapping a headline player opens research", pg.is_visible("#v-research"))
    ok("player card rendered", pg.locator("#player .card").count() >= 1)
    ok("four hit-rate tiles", pg.locator(".tile").count() == 4, str(pg.locator(".tile").count()))
    ok("20 bars charted", pg.locator(".bar").count() == 20, str(pg.locator(".bar").count()))
    ok("confidence interval shown", "95% interval" in pg.inner_text("#player").replace("\n", " ") or "interval runs" in pg.inner_text("#player"))
    ok("break-even referenced", "52.4" in pg.inner_text("#player"))
    ok("add buttons present", pg.locator("#player .addrow .btn").count() == 2)

    # y-axis must be integers for a counting stat
    axis = [ (t or "").strip() for t in pg.locator("#player .axl").all_text_contents() ]
    axis = [a for a in axis if a and a not in ("older", "recent")]
    ok("y-axis ticks are integers", all("." not in a for a in axis), str(axis))

    # ── prop switching ──────────────────────────────────
    pg.select_option("#player select, .propbar select", "homeRuns")
    pg.wait_for_timeout(500)
    ok("prop switch redraws chart", pg.locator(".bar").count() == 20)
    ok("line default updates with prop", pg.input_value(".propbar input") == "0.5")
    pg.fill(".propbar input", "1.5")
    pg.wait_for_timeout(400)
    ok("custom line accepted", pg.locator(".tile").count() == 4)
    pg.fill(".propbar input", "")
    pg.wait_for_timeout(300)
    ok("blank line handled gracefully", "Enter a line" in pg.inner_text("#player"))
    pg.fill(".propbar input", "0.5")
    pg.wait_for_timeout(400)

    # ── table view ──────────────────────────────────────
    pg.locator("details.tv summary").first.click()
    pg.wait_for_timeout(300)
    ok("table view has rows", pg.locator("details.tv tbody tr").count() == 20, str(pg.locator("details.tv tbody tr").count()))
    if SHOTS: pg.screenshot(path=os.path.join(ROOT, "shot-research.png"))

    # ── parlay: add legs ────────────────────────────────
    pg.select_option(".propbar select", "hits")
    pg.wait_for_timeout(400)
    pg.locator("#player .addrow .btn").first.click()   # Over
    pg.wait_for_timeout(350)
    ok("badge appears after first leg", pg.is_visible("#parlayBadge"))
    ok("badge counts 1", pg.inner_text("#parlayBadge") == "1")

    # second player, different game
    pg.fill("#q", "soto"); pg.wait_for_timeout(600)
    pg.locator("#results .res").first.click(); pg.wait_for_timeout(900)
    pg.locator("#player .addrow .btn").first.click(); pg.wait_for_timeout(350)
    ok("badge counts 2", pg.inner_text("#parlayBadge") == "2")

    pg.click('.nb button[data-v="parlay"]'); pg.wait_for_timeout(500)
    ok("two legs listed", pg.locator(".leg").count() == 2, str(pg.locator(".leg").count()))
    summary = pg.inner_text("#parlaySummary")
    ok("combined price shown", "+" in pg.inner_text(".heroval"))
    ok("payout shown", "$100 returns" in summary)
    ok("book hold shown", "hold on this ticket" in summary)
    ok("EV shown", "Expected value" in summary)
    ok("single-bet comparison stated", "4.5%" in summary)
    ok("hit-rate estimate shown", "hit-rate estimate" in summary)
    ok("uncertainty interval shown, not a bare point estimate", "95% interval" in summary, summary[:500])
    ok("EV given as a range", "EV per $100 across that range" in summary)
    ok("payout has a dollar sign", "$364.46" in summary, summary[:200])
    ok("hold bar rendered", pg.locator(".holdfill").count() == 1)

    # 2-leg -110 parlay: hold must read 8.9%
    ok("2-leg hold reads 8.9%", "8.9%" in summary, summary[:400])
    ok("2-leg price reads +264", "+264" in pg.inner_text(".heroval"), pg.inner_text(".heroval"))
    if SHOTS: pg.screenshot(path=os.path.join(ROOT, "shot-parlay.png"))

    # ── price editing ───────────────────────────────────
    pg.locator(".leg .price").first.fill("-200")
    pg.wait_for_timeout(400)
    ok("editing a price changes the payout", "+264" not in pg.inner_text(".heroval"), pg.inner_text(".heroval"))
    pg.locator(".leg .price").first.fill("-110")
    pg.wait_for_timeout(400)

    # ── invalid odds must be rejected, not silently computed ──
    _p0 = pg.inner_text(".heroval")
    for _bad in ("-1", "0", "99", "5", "-99"):
        pg.locator(".leg .price").first.fill(_bad); pg.wait_for_timeout(250)
        ok(f"price {_bad} does not change the payout", pg.inner_text(".heroval") == _p0, f"{_bad} -> {pg.inner_text('.heroval')}")
        ok(f"price {_bad} is marked invalid", pg.locator(".leg .price.invalid").count() >= 1, _bad)
    pg.locator(".leg .price").first.fill("-120"); pg.wait_for_timeout(300)
    ok("valid price -120 is accepted", pg.inner_text(".heroval") != _p0)
    ok("valid price clears the invalid mark", pg.locator(".leg .price.invalid").count() == 0)
    pg.locator(".leg .price").first.fill("7"); pg.wait_for_timeout(250)
    pg.locator(".leg .price").first.blur(); pg.wait_for_timeout(300)
    ok("blur restores the last valid price", pg.input_value(".leg .price") == "-120", pg.input_value(".leg .price"))
    pg.locator(".leg .price").first.fill("-110"); pg.wait_for_timeout(300)

    # iOS keypad: inputmode must allow a minus sign
    ok("price field does not use the minus-less numeric keypad",
       pg.get_attribute(".leg .price", "inputmode") == "text",
       str(pg.get_attribute(".leg .price", "inputmode")))

    # ── correlation warnings ────────────────────────────
    pg.click('.nb button[data-v="research"]'); pg.wait_for_timeout(300)
    pg.locator("#player .addrow .btn").nth(1).click()   # Under, same player as leg 2
    pg.wait_for_timeout(350)
    pg.click('.nb button[data-v="parlay"]'); pg.wait_for_timeout(500)
    ok("same-player leg is blocked", pg.locator(".issue.block").count() >= 1)
    _blk = pg.inner_text(".issue.block").lower()
    ok("block explains why", ("never win" in _blk) or ("correlated" in _blk), _blk[:160])
    ok("contradiction detected for over+under same prop", "never win" in _blk, _blk[:160])

    # ── same-game correlation (Judge = Yankees 147, Devers = Red Sox 111, same game) ──
    pg.click("#clearParlay"); pg.wait_for_timeout(300)
    pg.click('.nb button[data-v="research"]'); pg.wait_for_timeout(300)
    pg.fill("#q", "judge"); pg.wait_for_timeout(600)
    pg.locator("#results .res").first.click(); pg.wait_for_timeout(900)
    pg.locator("#player .addrow .btn").first.click(); pg.wait_for_timeout(300)
    pg.fill("#q", "devers"); pg.wait_for_timeout(600)
    pg.locator("#results .res").first.click(); pg.wait_for_timeout(900)
    pg.locator("#player .addrow .btn").first.click(); pg.wait_for_timeout(300)
    pg.click('.nb button[data-v="parlay"]'); pg.wait_for_timeout(500)
    _warn = pg.inner_text("#parlaySummary")
    ok("opponents in the same game are flagged as correlated", pg.locator(".issue.warn").count() >= 1, _warn[:300])
    ok("single-game note appears", "one game" in _warn.lower(), _warn[:300])
    ok("correlation warning names both players",
       "Judge" in pg.inner_text(".issue.warn") and "Devers" in pg.inner_text(".issue.warn"))

    # view counting must not inflate on keystrokes
    pg.evaluate("localStorage.removeItem('cvx_views')")
    pg.reload(); pg.wait_for_timeout(1300)
    pg.click('.nb button[data-v="research"]'); pg.wait_for_timeout(300)
    pg.fill("#q", "judge"); pg.wait_for_timeout(600)
    pg.locator("#results .res").first.click(); pg.wait_for_timeout(900)
    for _v in ("1.5", "2.5", "0.5", "1.5"):
        pg.fill(".propbar input", _v); pg.wait_for_timeout(160)
    _views = pg.evaluate("JSON.parse(localStorage.getItem('cvx_views')||'{}')")
    _max = max(_views.values()) if _views else 0
    ok("typing a line does not inflate the view counter", _max <= 2, str(_views))

    # ── clear ───────────────────────────────────────────
    pg.locator("#player .addrow .btn").first.click(); pg.wait_for_timeout(300)   # ensure a leg exists
    pg.click('.nb button[data-v="parlay"]'); pg.wait_for_timeout(500)
    ok("clear button available with legs present", pg.is_visible("#clearParlay"))
    pg.click("#clearParlay"); pg.wait_for_timeout(400)
    ok("clearing empties the ticket", pg.locator(".leg").count() == 0)
    ok("badge hidden when empty", not pg.is_visible("#parlayBadge"))
    ok("empty state explains how to add", "Add Over" in pg.inner_text("#legs"))

    # ── persistence ─────────────────────────────────────
    pg.click('.nb button[data-v="research"]'); pg.wait_for_timeout(300)
    pg.locator("#player .addrow .btn").first.click(); pg.wait_for_timeout(300)
    pg.reload(); pg.wait_for_timeout(1300)
    ok("parlay survives a reload", pg.inner_text("#parlayBadge") == "1", pg.inner_text("#parlayBadge"))
    ok("your-trending now has entries", "Nothing yet" not in pg.inner_text("#yours"))

    # ── Board refreshes without a reload ────────────────
    pg.evaluate("localStorage.removeItem('cvx_views')")
    pg.reload(); pg.wait_for_timeout(1400)          # in-memory VIEWS must reload too
    pg.click('.nb button[data-v="board"]'); pg.wait_for_timeout(500)
    ok("trending empty before any research", "Nothing yet" in pg.inner_text("#yours"), pg.inner_text("#yours")[:120])
    pg.click('.nb button[data-v="research"]'); pg.wait_for_timeout(300)
    pg.fill("#q", "soto"); pg.wait_for_timeout(600)
    pg.locator("#results .res").first.click(); pg.wait_for_timeout(900)
    pg.click('.nb button[data-v="board"]'); pg.wait_for_timeout(600)
    ok("trending refreshes on returning to Board, no reload needed",
       "Nothing yet" not in pg.inner_text("#yours"), pg.inner_text("#yours")[:160])
    ok("trending names the researched player", "Soto" in pg.inner_text("#yours"), pg.inner_text("#yours")[:160])

    # ── gameId backfill: legs added before the schedule resolves ──
    pg3 = ctx.new_page()
    pg3.on("pageerror", lambda e: errors.append("PAGEERROR: " + str(e)))
    _slow = {"n": 0}
    def slow_handler(route):
        u = route.request.url
        if "/schedule" in u:
            _slow["n"] += 1
            route.fulfill(status=200, content_type="application/json", body=json.dumps(SCHED))
        else:
            handler(route)
    pg3.route("**/statsapi.mlb.com/**", slow_handler)
    pg3.route("**/*.espn.com/**", espn_handler)
    pg3.add_init_script("localStorage.setItem('cvx_parlay', JSON.stringify([" 
        "{\"playerId\":592450,\"playerName\":\"Aaron Judge\",\"teamId\":147,\"gameId\":null,"
        "\"propKey\":\"hits\",\"propName\":\"Hits\",\"group\":\"batting\",\"line\":0.5,"
        "\"side\":\"over\",\"american\":-110,\"modelProb\":0.6,\"ciLow\":0.4,\"ciHigh\":0.8,\"games\":24},"
        "{\"playerId\":646240,\"playerName\":\"Rafael Devers\",\"teamId\":111,\"gameId\":null,"
        "\"propKey\":\"hits\",\"propName\":\"Hits\",\"group\":\"batting\",\"line\":0.5,"
        "\"side\":\"over\",\"american\":-110,\"modelProb\":0.6,\"ciLow\":0.4,\"ciHigh\":0.8,\"games\":24}]))")
    pg3.goto("file://" + TARGET); pg3.wait_for_timeout(1600)
    pg3.click('.nb button[data-v="parlay"]'); pg3.wait_for_timeout(600)
    _ids = pg3.evaluate("JSON.parse(localStorage.getItem('cvx_parlay')).map(l=>l.gameId)")
    ok("null gameIds are backfilled once the schedule loads", all(i is not None for i in _ids), str(_ids))
    ok("backfilled legs now trigger same-game correlation",
       pg3.locator(".issue.warn").count() >= 1, pg3.inner_text("#parlaySummary")[:250])
    pg3.close()

    # ── pitcher path ────────────────────────────────────
    pg.click('.nb button[data-v="research"]'); pg.wait_for_timeout(300)
    pg.fill("#q", "skenes"); pg.wait_for_timeout(600)
    pg.locator("#results .res").first.click(); pg.wait_for_timeout(900)
    opts = [ (t or "").strip() for t in pg.locator(".propbar select option").all_text_contents() ]
    ok("pitcher gets pitching props", "Outs recorded" in opts, str(opts))
    ok("pitcher does not get hitting-only props", "Stolen bases" not in opts)
    pg.select_option(".propbar select", "outs"); pg.wait_for_timeout(500)
    ok("outs prop renders bars", pg.locator(".bar").count() == 12, str(pg.locator(".bar").count()))
    axis2 = [ (t or "").strip() for t in pg.locator("#player .axl").all_text_contents() ]
    axis2 = [a for a in axis2 if a and a not in ("older", "recent")]
    ok("outs axis scales past 10", any(int(a) >= 15 for a in axis2 if a.isdigit()), str(axis2))

    # ── CLV + system ────────────────────────────────────
    pg.click('.nb button[data-v="clv"]'); pg.wait_for_timeout(300)
    ok("CLV honest empty state", "—" in pg.inner_text("#clvBody") and "200" in pg.inner_text("#clvBody"))
    pg.click('.nb button[data-v="sys"]'); pg.wait_for_timeout(300)
    sys_txt = pg.inner_text("#v-sys")
    ok("diagnostics list requests", pg.locator("#diag .kv").count() >= 3)
    ok("paid-only limits disclosed", "paid only" in sys_txt)
    ok("public betting % disclosed unavailable", "not available" in sys_txt)
    if SHOTS: pg.screenshot(path=os.path.join(ROOT, "shot-system.png"))

    # ══════════════ NFL ══════════════
    pg.click('.nb button[data-v="board"]'); pg.wait_for_timeout(400)
    ok("NFL tab is enabled, not a countdown", pg.locator('.sport[data-sport="nfl"]').is_enabled())
    ok("NBA tab still disabled", not pg.locator('.sport[data-sport="nba"]').is_enabled())
    pg.click('.sport[data-sport="nfl"]'); pg.wait_for_timeout(1800)

    ok("NFL tab becomes selected", pg.get_attribute('.sport[data-sport="nfl"]', "aria-selected") == "true")
    ok("MLB tab deselected", pg.get_attribute('.sport[data-sport="mlb"]', "aria-selected") == "false")
    ok("board switches to weekly framing", "This week" in pg.inner_text("#gamesTitle"), pg.inner_text("#gamesTitle"))
    ok("NFL games rendered", pg.locator(".game").count() == 2, str(pg.locator(".game").count()))
    ok("NFL matchup shown", "Chiefs" in pg.inner_text("#games") and "Ravens" in pg.inner_text("#games"))
    ok("live NFL game shows score", "17" in pg.inner_text("#games") and "Q3" in pg.inner_text("#games"))
    ok("week number shown", "Week 1" in pg.inner_text("#gamesSub"), pg.inner_text("#gamesSub"))
    ok("offseason notice shown before week 1", pg.locator("#seasonNotice .notice").count() == 1)
    ok("notice names the season being shown", "2025" in pg.inner_text("#seasonNotice"), pg.inner_text("#seasonNotice")[:160])
    ok("notice counts down to week 1", "day" in pg.inner_text("#seasonNotice"))
    ok("NFL headliners rendered", pg.locator("#topProps .res").count() >= 2, str(pg.locator("#topProps .res").count()))
    ok("NFL headliner shows a passing market", "Passing yards" in pg.inner_text("#topProps"), pg.inner_text("#topProps")[:250])
    ok("headline title says this week for NFL", "this week" in pg.inner_text("#headlineTitle").lower(), pg.inner_text("#headlineTitle"))
    ok("ranking note says this week for NFL", "play this week" in pg.inner_text("#headlineNote"), pg.inner_text("#headlineNote")[:200])
    ok("ranking disclosure survives the rewrite", "not" in pg.inner_text("#headlineNote").lower() and "handle" in pg.inner_text("#headlineNote"))
    if SHOTS: pg.screenshot(path=os.path.join(ROOT, "shot-nfl-board.png"))

    # QB research
    pg.locator("#topProps .res").first.click(); pg.wait_for_timeout(1200)
    _opts = [(t or "").strip() for t in pg.locator(".propbar select option").all_text_contents()]
    ok("QB offered passing yards", "Passing yards" in _opts, str(_opts))
    ok("QB not offered receptions", "Receptions" not in _opts, str(_opts))
    ok("NFL hit-rate tiles render", pg.locator(".tile").count() == 4)
    ok("NFL chart renders 16 games", pg.locator(".bar").count() == 16, str(pg.locator(".bar").count()))
    ok("preseason excluded from the log", pg.locator(".bar").count() == 16)
    _axis = [(t or "").strip() for t in pg.locator("#player .axl").all_text_contents()]
    _axis = [a for a in _axis if a and a not in ("older", "recent")]
    ok("passing-yard axis scales into the hundreds", any(a.isdigit() and int(a) >= 100 for a in _axis), str(_axis))
    if SHOTS: pg.screenshot(path=os.path.join(ROOT, "shot-nfl-research.png"))

    # WR research — position gating
    pg.fill("#q", "rice"); pg.wait_for_timeout(700)
    pg.locator("#results .res").first.click(); pg.wait_for_timeout(1200)
    _wr = [(t or "").strip() for t in pg.locator(".propbar select option").all_text_contents()]
    ok("WR offered receptions", "Receptions" in _wr, str(_wr))
    ok("WR not offered passing yards", "Passing yards" not in _wr, str(_wr))
    ok("kicker not in the searchable index", pg.evaluate(
        "(async()=>{const r=JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(k=>k.includes('roster_nfl'))));"
        "return r.some(p=>p.pos==='K')})()") is False)

    # NFL leg into the parlay, then a cross-sport ticket
    pg.locator("#player .addrow .btn").first.click(); pg.wait_for_timeout(350)
    pg.click('.nb button[data-v="parlay"]'); pg.wait_for_timeout(500)
    ok("NFL leg lands in the parlay", "Rashee Rice" in pg.inner_text("#legs"), pg.inner_text("#legs")[:200])

    # switching back to MLB keeps the parlay but resets research
    pg.click('.sport[data-sport="mlb"]'); pg.wait_for_timeout(1600)
    ok("switching sport clears the research pane", pg.inner_text("#player").strip() == "")
    ok("switching sport clears the search box", pg.input_value("#q") == "")
    ok("board returns to daily framing", "Today" in pg.inner_text("#gamesTitle"))
    ok("offseason notice hidden for MLB", pg.locator("#seasonNotice .notice").count() == 0)
    ok("MLB games reload", pg.locator(".game").count() == 2)
    ok("headline title returns to today for MLB", "today" in pg.inner_text("#headlineTitle").lower(), pg.inner_text("#headlineTitle"))
    ok("ranking note returns to today for MLB", "play today" in pg.inner_text("#headlineNote"), pg.inner_text("#headlineNote")[:200])
    pg.click('.nb button[data-v="parlay"]'); pg.wait_for_timeout(400)
    ok("parlay survives a sport switch", "Rashee Rice" in pg.inner_text("#legs"))
    pg.click("#clearParlay"); pg.wait_for_timeout(300)

    # ── endpoint probe ──────────────────────────────────
    pg.click('.nb button[data-v="sys"]'); pg.wait_for_timeout(300)
    ok("probe starts unrun", "not run" in pg.inner_text("#probeSub"))
    pg.click("#runProbe")
    pg.wait_for_selector(".probe .row", timeout=20000)
    pg.wait_for_timeout(2500)
    _rows = pg.locator(".probe .row").count()
    ok("probe checks every endpoint", _rows >= 8, str(_rows))
    ok("probe reports a summary", "OK" in pg.inner_text("#probeSub"), pg.inner_text("#probeSub"))
    _ptxt = pg.inner_text("#probeOut")
    ok("probe names the MLB schedule", "MLB schedule" in _ptxt)
    ok("probe names the NFL scoreboard", "NFL scoreboard" in _ptxt)
    ok("probe reports game-log stat keys", "stat keys" in _ptxt, _ptxt[:300])
    ok("probe surfaces NFL stat keys", "passYds" in _ptxt, _ptxt[:400])
    ok("probe shows no failures against the fixtures", "FAIL" not in _ptxt, _ptxt[:400])
    ok("NFL coverage marked live", "live · free" in pg.inner_text("#v-sys"))
    if SHOTS: pg.screenshot(path=os.path.join(ROOT, "shot-probe.png"))

    # ── layout & failure handling ───────────────────────
    ok("no horizontal overflow", not pg.evaluate("document.documentElement.scrollWidth>window.innerWidth+1"))
    for w in (320, 390, 430):
        pg.set_viewport_size({"width": w, "height": 844}); pg.wait_for_timeout(250)
        ok(f"no overflow at {w}px", not pg.evaluate("document.documentElement.scrollWidth>window.innerWidth+1"))
    pg.set_viewport_size({"width": 390, "height": 844})

    pg2 = ctx.new_page()
    pg2.route("**/statsapi.mlb.com/**", lambda r: r.abort())
    pg2.route("**/*.espn.com/**", lambda r: r.abort())
    pg2.goto("file://" + TARGET); pg2.wait_for_timeout(1500)
    ok("offline shows blocked status", pg2.inner_text("#statusTxt") == "blocked", pg2.inner_text("#statusTxt"))
    ok("offline board degrades gracefully", "unavailable" in pg2.inner_text("#v-board").lower())
    pg2.click('.nb button[data-v="sys"]'); pg2.wait_for_timeout(300)
    ok("offline diagnostics name the failure", "failed" in pg2.inner_text("#diag").lower())

    b.close()

ok("no console errors", len(errors) == 0, "; ".join(errors[:3]))

print(f"\n\033[1m{passed} passed, {failed} failed\033[0m")
if failed:
    print("\033[31mFAILURES:\033[0m")
    for f in failures: print("  ✗ " + f)
    sys.exit(1)
print("\033[32mAll UI tests pass.\033[0m")
