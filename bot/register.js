#!/usr/bin/env node
/* Register Courvix slash commands with Discord. Zero dependencies.
 *
 *   DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... node bot/register.js
 *
 * Optional: DISCORD_GUILD_ID=...  registers to one server (instant) instead of
 * globally (up to an hour to propagate). Use a guild while developing.
 */
"use strict";
const { DEFINITIONS } = require("./commands.js");

const APP_ID = process.env.DISCORD_APP_ID;
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD = process.env.DISCORD_GUILD_ID;

if (!APP_ID || !TOKEN) {
  console.error("Set DISCORD_APP_ID and DISCORD_BOT_TOKEN first.");
  console.error("Both are in the Discord developer portal for your application.");
  process.exit(1);
}

const url = GUILD
  ? `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD}/commands`
  : `https://discord.com/api/v10/applications/${APP_ID}/commands`;

(async () => {
  const res = await fetch(url, {
    method: "PUT",
    headers: { authorization: `Bot ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(DEFINITIONS)
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`Registration failed (HTTP ${res.status}):`);
    console.error(body);
    process.exit(1);
  }
  const list = JSON.parse(body);
  console.log(`Registered ${list.length} commands ${GUILD ? "to guild " + GUILD : "globally"}:`);
  list.forEach((c) => console.log(`  /${c.name} — ${c.description}`));
  if (!GUILD) console.log("\nGlobal commands can take up to an hour to appear.");
})().catch((e) => { console.error(e); process.exit(1); });
