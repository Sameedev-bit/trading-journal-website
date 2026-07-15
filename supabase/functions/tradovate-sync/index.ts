// TradeHarbor — Tradovate API proxy (Supabase Edge Function, Deno runtime).
//
// Why a proxy: the browser can't talk to Tradovate directly (CORS), and broker
// credentials should never live in frontend storage. This function is a
// STATELESS pass-through: it forwards the user's credentials to Tradovate,
// returns the short-lived access token to the client (kept in sessionStorage),
// and never stores or logs anything.
//
// Deploy (after creating your Supabase project — see SETUP-CLOUD.md):
//   supabase functions deploy tradovate-sync --no-verify-jwt
//
// User requirements on Tradovate's side: live funded account ($1,000+) with
// the API Access add-on, and an API key (cid + secret) generated in their
// Tradovate settings. Demo environment works for testing.

const BASE: Record<string, string> = {
  live: "https://live.tradovateapi.com/v1",
  demo: "https://demo.tradovateapi.com/v1",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function tv(env: string, path: string, token?: string, body?: unknown) {
  const base = BASE[env] ?? BASE.demo;
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (data && (data.errorText || data.error)) || `Tradovate HTTP ${res.status}`,
    );
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const env = body.env === "live" ? "live" : "demo";

  try {
    switch (body.action) {
      case "auth": {
        const { username, password, cid, sec } = body;
        if (!username || !password || !cid || !sec) {
          return json({ error: "username, password, cid and sec are required" }, 400);
        }
        const auth = await tv(env, "/auth/accesstokenrequest", undefined, {
          name: username,
          password,
          appId: "TradeHarbor",
          appVersion: "1.0",
          cid: Number(cid),
          sec,
          deviceId: body.deviceId || crypto.randomUUID(),
        });
        if (auth["p-ticket"]) {
          return json({ error: "Tradovate is rate-limiting sign-ins — wait a minute and try again." }, 429);
        }
        if (!auth.accessToken) {
          return json({ error: auth.errorText || "Sign-in rejected by Tradovate" }, 401);
        }
        return json({
          accessToken: auth.accessToken,
          expirationTime: auth.expirationTime,
          userId: auth.userId,
        });
      }

      case "accounts": {
        if (!body.token) return json({ error: "token required" }, 400);
        const accounts = await tv(env, "/account/list", body.token);
        return json({
          accounts: (accounts || []).map((a: any) => ({
            id: a.id,
            name: a.name,
            nickname: a.nickname ?? null,
            archived: !!a.archived,
          })),
        });
      }

      case "fills": {
        if (!body.token) return json({ error: "token required" }, 400);
        const fills = await tv(env, "/fill/list", body.token);
        const since = body.since ? Date.parse(body.since) : 0;
        const wanted = (fills || []).filter((f: any) =>
          (!body.accountId || f.accountId === body.accountId) &&
          (!since || Date.parse(f.timestamp) >= since)
        );
        // join contract names so the client can normalize symbols
        const contractIds = [...new Set(wanted.map((f: any) => f.contractId))];
        const names: Record<number, string> = {};
        for (let i = 0; i < contractIds.length; i += 50) {
          const chunk = contractIds.slice(i, i + 50);
          if (!chunk.length) break;
          const contracts = await tv(
            env,
            `/contract/items?ids=${chunk.join(",")}`,
            body.token,
          );
          for (const c of contracts || []) names[c.id] = c.name;
        }
        return json({
          fills: wanted.map((f: any) => ({
            symbol: names[f.contractId] || String(f.contractId),
            ts: f.timestamp,
            side: f.action === "Sell" ? "sell" : "buy",
            qty: f.qty,
            price: f.price,
            execId: String(f.id),
            accountId: f.accountId,
          })),
        });
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    return json({ error: (err as Error).message || "Tradovate request failed" }, 502);
  }
});
