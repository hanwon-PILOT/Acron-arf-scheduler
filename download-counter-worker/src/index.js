function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  });
}

function withCors(req, res) {
  const origin = req.headers.get("Origin") || "*";
  const h = new Headers(res.headers);
  h.set("Access-Control-Allow-Origin", origin);
  h.set("Vary", "Origin");
  h.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type, X-Admin-Token");
  return new Response(res.body, { status: res.status, headers: h });
}

function keyTotal(appId) {
  return `dl:${appId}:pdf:total`;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return withCors(req, new Response(null, { status: 204 }));
    }

    if (url.pathname === "/track" && req.method === "POST") {
      const appId = String(env.APP_ID || "arf-scheduler");
      const k = keyTotal(appId);
      const curRaw = await env.COUNTERS.get(k);
      const cur = curRaw ? Number(curRaw) : 0;
      const next = Number.isFinite(cur) ? cur + 1 : 1;
      await env.COUNTERS.put(k, String(next));
      return withCors(req, json({ ok: true }));
    }

    if (url.pathname === "/admin" && req.method === "GET") {
      const token = req.headers.get("X-Admin-Token") || "";
      if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
        return withCors(req, json({ ok: false, error: "unauthorized" }, { status: 401 }));
      }
      const appId = String(env.APP_ID || "arf-scheduler");
      const k = keyTotal(appId);
      const curRaw = await env.COUNTERS.get(k);
      const total = curRaw ? Number(curRaw) : 0;
      return withCors(req, json({ ok: true, app: appId, pdf_total: total }));
    }

    return withCors(req, json({ ok: false, error: "not_found" }, { status: 404 }));
  },
};

