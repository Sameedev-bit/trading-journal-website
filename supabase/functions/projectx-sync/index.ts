// TradeHarbor — TopstepX / ProjectX API proxy (Supabase Edge Function, Deno).
//
// ProjectX (api.topstepx.com) is the platform API behind Topstep — built for
// prop accounts, unlike retail broker APIs. Auth is username + an API key the
// user generates in TopstepX settings; it returns a 24-hour JWT.
//
// This function is a STATELESS pass-through: credentials go straight to
// TopstepX over HTTPS, the session token goes back to the client (kept in
// sessionStorage), and nothing is stored or logged here.
//
// Deploy (after creating your Supabase project — see SETUP-CLOUD.md):
//   supabase functions deploy projectx-sync --no-verify-jwt

const BASE = "https://api.topstepx.com";

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

async function px(path: string, payload: unknown, token?: string) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (data && (data.errorMessage || data.message)) || `TopstepX HTTP ${res.status}`,
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

  try {
    switch (body.action) {
      case "auth": {
        const { username, apiKey } = body;
        if (!username || !apiKey) {
          return json({ error: "username and apiKey are required" }, 400);
        }
        const auth = await px("/api/Auth/loginKey", {
          userName: username,
          apiKey,
        });
        if (!auth?.success || !auth?.token) {
          return json(
            { error: auth?.errorMessage || "TopstepX rejected the sign-in — check the username and API key." },
            401,
          );
        }
        return json({ token: auth.token }); // JWT, valid ~24h
      }

      case "accounts": {
        if (!body.token) return json({ error: "token required" }, 400);
        const res = await px(
          "/api/Account/search",
          { onlyActiveAccounts: true },
          body.token,
        );
        return json({
          accounts: (res?.accounts || []).map((a: any) => ({
            id: a.id,
            name: a.name,
            balance: a.balance ?? null,
          })),
        });
      }

      case "trades": {
        if (!body.token) return json({ error: "token required" }, 400);
        if (!body.accountId) return json({ error: "accountId required" }, 400);
        const res = await px(
          "/api/Trade/search",
          {
            accountId: body.accountId,
            startTimestamp: body.since || new Date(Date.now() - 30 * 86400000).toISOString(),
            endTimestamp: body.until || new Date().toISOString(),
          },
          body.token,
        );
        // half-turn executions; the client pairs them into round-trip trades
        return json({
          fills: (res?.trades || []).map((t: any) => ({
            symbol: t.contractName || t.contractId || "",
            ts: t.creationTimestamp,
            side: t.side === 1 ? "sell" : "buy",
            qty: t.size,
            price: t.price,
            commission: Math.abs(t.fees || 0),
            execId: String(t.id),
            accountId: t.accountId,
          })),
        });
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    return json({ error: (err as Error).message || "TopstepX request failed" }, 502);
  }
});
