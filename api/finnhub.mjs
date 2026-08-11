// Finnhub real-time quote fallback (free tier covers US stocks/ETFs).
// Key stays server-side in the FINNHUB_KEY environment variable.
const ALLOWED = new Set(["SPY", "QQQ", "DIA", "GLD", "SLV"]);

export default async function handler(req, res) {
  const key = process.env.FINNHUB_KEY;
  if (!key) { res.status(503).json({ error: "FINNHUB_KEY not configured" }); return; }
  const symbol = String(req.query?.symbol || "");
  if (!ALLOWED.has(symbol)) { res.status(400).json({ error: "symbol not allowed" }); return; }

  const r = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`
  );
  if (!r.ok) { res.status(502).json({ error: "upstream " + r.status }); return; }
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "public, max-age=15");
  res.status(200).send(await r.text());
}
