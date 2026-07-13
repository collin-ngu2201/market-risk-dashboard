// Vercel serverless function (Web handler). Canonical copy going forward;
// netlify/functions/ holds the legacy Netlify twin.
// Server-side proxy for Yahoo Finance v8 chart API (no CORS in browsers).
// Allowlisted symbols only, so this can't be abused as an open proxy.
const ALLOWED = new Set([
  "^GSPC", "^IXIC", "^DJI", "^VIX",
  "GC=F", "SI=F",
  "^TNX", "^TYX", "^FVX", "^IRX",
  "BTC-USD",
]);
const RANGES = new Set(["1d", "5d", "1mo", "3mo", "6mo", "1y"]);
const INTERVALS = new Set(["5m", "15m", "1h", "1d", "1wk"]);

export const GET = async (req) => {
  const u = new URL(req.url, "http://localhost");
  const symbol = u.searchParams.get("symbol") || "";
  if (!ALLOWED.has(symbol))
    return Response.json({ error: "symbol not allowed" }, { status: 400 });
  const range = RANGES.has(u.searchParams.get("range")) ? u.searchParams.get("range") : "3mo";
  const interval = INTERVALS.has(u.searchParams.get("interval")) ? u.searchParams.get("interval") : "1d";

  const upstream =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${range}&interval=${interval}`;
  const r = await fetch(upstream, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });
  if (!r.ok)
    return Response.json({ error: "upstream " + r.status }, { status: 502 });
  return new Response(await r.text(), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=30",
    },
  });
};

