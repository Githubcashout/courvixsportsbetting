/* Courvix Discord bot — Cloudflare Workers build (free tier, always on).
 *
 *   npx wrangler deploy
 *   npx wrangler secret put DISCORD_PUBLIC_KEY
 *
 * Uses WebCrypto rather than node:crypto, so it needs no Node runtime.
 * Command logic is shared with the Node bot via commands.js.
 */
import CoreNS from "../core.js";
import { handleCommand } from "./commands.js";

// Bundlers differ on CJS->ESM interop: the module object may arrive as the
// default export or as the namespace itself. Accept either.
const C = (CoreNS && CoreNS.makeClient) ? CoreNS : (CoreNS && CoreNS.default) ? CoreNS.default : CoreNS;
const PING = 1, APPLICATION_COMMAND = 2;
const PONG = 1, CHANNEL_MESSAGE = 4;

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

async function verify(body, sigHex, ts, pubHex) {
  try {
    if (!sigHex || !ts || !pubHex || sigHex.length !== 128 || pubHex.length !== 64) return false;
    const key = await crypto.subtle.importKey("raw", hexToBytes(pubHex), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, hexToBytes(sigHex), new TextEncoder().encode(ts + body));
  } catch (e) { return false; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health")
      return Response.json({ ok: true, service: "courvix-bot" });
    if (request.method !== "POST") return new Response("not found", { status: 404 });

    const body = await request.text();
    const good = await verify(body, request.headers.get("x-signature-ed25519"),
                              request.headers.get("x-signature-timestamp"), env.DISCORD_PUBLIC_KEY);
    if (!good) return new Response("invalid request signature", { status: 401 });

    const interaction = JSON.parse(body);
    if (interaction.type === PING) return Response.json({ type: PONG });
    if (interaction.type !== APPLICATION_COMMAND) return Response.json({ type: PONG });

    const clientFor = (s) => C.makeClientFor(s === "nfl" ? "nfl" : "mlb",
      { fetch: (...a) => fetch(...a), season: s === "nfl" ? undefined : new Date().getFullYear() });
    const payload = await handleCommand(interaction.data.name, interaction.data, null, clientFor);
    return Response.json({ type: CHANNEL_MESSAGE, data: payload });
  }
};
