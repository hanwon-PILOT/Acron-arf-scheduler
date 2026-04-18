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

/** Daily buckets use the calendar date in this IANA zone (EST/EDT). */
const DAY_COUNT_TIMEZONE = "America/New_York";

function keyTotal(appId) {
  return `dl:${appId}:pdf:total`;
}

/** Per-day total; `ymd` is YYYY-MM-DD in America/New_York. */
function keyDay(appId, ymd) {
  return `dl:${appId}:pdf:day:${ymd}`;
}

function ymdCalendarPartsInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year").value);
  const month = Number(parts.find((p) => p.type === "month").value);
  const day = Number(parts.find((p) => p.type === "day").value);
  return { year, month, day };
}

function formatUtcCivilYmd(dt) {
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Gregorian calendar date in `timeZone`, `dayOffset` days before “today” there (0 = today). */
function ymdDaysAgoInZone(dayOffset, timeZone) {
  const { year, month, day } = ymdCalendarPartsInZone(new Date(), timeZone);
  const dt = new Date(Date.UTC(year, month - 1, day - dayOffset));
  return formatUtcCivilYmd(dt);
}

async function bump(kv, key) {
  const curRaw = await kv.get(key);
  const cur = curRaw ? Number(curRaw) : 0;
  const next = Number.isFinite(cur) ? cur + 1 : 1;
  await kv.put(key, String(next));
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return withCors(req, new Response(null, { status: 204 }));
    }

    if (url.pathname === "/track" && req.method === "POST") {
      const appId = String(env.APP_ID || "arf-scheduler");
      const ymd = ymdDaysAgoInZone(0, DAY_COUNT_TIMEZONE);
      await Promise.all([bump(env.COUNTERS, keyTotal(appId)), bump(env.COUNTERS, keyDay(appId, ymd))]);
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

      let n = parseInt(url.searchParams.get("days") || "30", 10);
      if (!Number.isFinite(n) || n < 1) n = 30;
      if (n > 90) n = 90;

      const by_day = [];
      for (let i = 0; i < n; i++) {
        const date = ymdDaysAgoInZone(i, DAY_COUNT_TIMEZONE);
        const raw = await env.COUNTERS.get(keyDay(appId, date));
        const c = raw ? Number(raw) : 0;
        by_day.push({ date, count: Number.isFinite(c) ? c : 0 });
      }

      return withCors(
        req,
        json({
          ok: true,
          app: appId,
          pdf_total: total,
          by_day,
          by_day_timezone: DAY_COUNT_TIMEZONE,
          by_day_note: `Calendar days in ${DAY_COUNT_TIMEZONE} (US Eastern), newest first; last ${n} days (?days=1–90)`,
        }),
      );
    }

    return withCors(req, json({ ok: false, error: "not_found" }, { status: 404 }));
  },
};
