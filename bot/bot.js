#!/usr/bin/env node
/* Courvix Discord bot — HTTP Interactions endpoint. Zero dependencies.
 *
 *   DISCORD_PUBLIC_KEY=...  node bot/bot.js
 *
 * Point your application's "Interactions Endpoint URL" at http(s)://host:PORT/interactions
 * Discord requires a public HTTPS URL — see bot/README.md for the free options.
 */
"use strict";
const http = require("http");
const crypto = require("crypto");
const C = require("../core.js");
const { handleCommand } = require("./commands.js");

const PORT = Number(process.env.PORT || 8787);
const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY || "";
const APP_ID = process.env.DISCORD_APP_ID || "";

/* ── Ed25519 verification (Node built-in, no tweetnacl) ── */
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function publicKeyFromHex(hex) {
  const raw = Buffer.from(hex, "hex");
  if (raw.length !== 32) throw new Error("public key must be 32 bytes of hex");
  return crypto.createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, raw]), format: "der", type: "spki"
  });
}

function verify(rawBody, signatureHex, timestamp, publicKeyHex) {
  try {
    if (!signatureHex || !timestamp || !publicKeyHex) return false;
    const sig = Buffer.from(signatureHex, "hex");
    if (sig.length !== 64) return false;
    return crypto.verify(
      null,
      Buffer.concat([Buffer.from(timestamp, "utf8"), Buffer.from(rawBody)]),
      publicKeyFromHex(publicKeyHex),
      sig
    );
  } catch (e) { return false; }
}

/* ── interaction routing ── */
const PING = 1, APPLICATION_COMMAND = 2;
const PONG = 1, CHANNEL_MESSAGE = 4, DEFERRED = 5;

function makeClient(sport) {
  return C.makeClientFor(sport === "nfl" ? "nfl" : "mlb",
    { fetch: (...a) => fetch(...a), season: sport === "nfl" ? undefined : new Date().getFullYear() });
}
const clientFor = (s) => makeClient(s);

/** Pure routing so tests can drive it without a socket. */
async function route(interaction, client) {
  if (interaction.type === PING) return { type: PONG };
  if (interaction.type !== APPLICATION_COMMAND) return { type: PONG };
  const name = (interaction.data || {}).name;
  const payload = await handleCommand(name, interaction.data || {}, client, clientFor);
  return { type: CHANNEL_MESSAGE, data: payload };
}

/** Commands that hit the network get deferred so we never blow Discord's 3s budget. */
const SLOW = new Set(["player", "prop", "slate"]);

async function followUp(token, payload) {
  if (!APP_ID) return;
  const url = `https://discord.com/api/v10/webhooks/${APP_ID}/${token}/messages/@original`;
  await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, done = false;
    req.on("data", (c) => {
      if (done) return;
      size += c.length;
      if (size > 1e6) { done = true; reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
    res.end(body);
  };

  if (req.method === "GET" && req.url === "/health") return send(200, { ok: true, service: "courvix-bot" });
  if (req.method !== "POST" || !req.url.startsWith("/interactions")) return send(404, { error: "not found" });

  let raw;
  try { raw = await readBody(req); }
  catch (e) {
    // the socket may already be gone — only answer if it can still hear us
    if (!res.writableEnded && !res.destroyed) { try { send(413, { error: "body too large" }); } catch (_) {} }
    return;
  }

  if (!verify(raw, req.headers["x-signature-ed25519"], req.headers["x-signature-timestamp"], PUBLIC_KEY)) {
    res.writeHead(401, { "content-type": "text/plain" });
    return res.end("invalid request signature");
  }

  let interaction;
  try { interaction = JSON.parse(raw.toString("utf8")); }
  catch (e) { return send(400, { error: "bad json" }); }

  if (interaction.type === PING) return send(200, { type: PONG });

  const name = (interaction.data || {}).name;
  if (SLOW.has(name) && interaction.token) {
    send(200, { type: DEFERRED });                       // ack inside 3s
    try {
      const out = await handleCommand(name, interaction.data, null, clientFor);
      await followUp(interaction.token, out);
    } catch (e) {
      await followUp(interaction.token, { content: `Failed: ${e.message}` });
    }
    return;
  }

  const out = await route(interaction, makeClient());
  send(200, out);
});

if (require.main === module) {
  if (!PUBLIC_KEY) {
    console.error("DISCORD_PUBLIC_KEY is not set — every request will be rejected.");
    console.error("Get it from the Discord developer portal → General Information → Public Key.");
  }
  server.listen(PORT, () => console.log(`Courvix bot listening on :${PORT}/interactions`));
}

module.exports = { server, verify, route, publicKeyFromHex, readBody, makeClient };
