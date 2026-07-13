// Vercel serverless function (Web handler). Canonical copy going forward;
// netlify/functions/ holds the legacy Netlify twin.
// Finnhub real-time quote fallback (free tier covers US stocks/ETFs).
// Key stays server-side in the FINNHUB_KEY environment variable.
const ALLOWED = new Set(["SPY", "QQQ", "DIA", "GLD", "SLV"]);

export const GET = async (req) => {
  const key = process.env.FINNHUB_KEY;
  if (!key) return Response.json({ error: "FINNHUB_KEY not configured" }, { status: 503 });
  const symbol = new URL(req.url, "http://localhost").searchParams.get("symbol") || "";
  if (!ALLOWED.has(symbol))
    return Response.json({ error: "symbol not allowed" }, { status: 400 });

  const r = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`
  );
  if (!r.ok) return Response.json({ error: "upstream " + r.status }, { status: 502 });
  return new Response(await r.text(), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=15" },
  });
};

