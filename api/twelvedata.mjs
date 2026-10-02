// Twelve Data quote fallback (free tier: XAU/USD gold spot works).
// Key stays server-side in the TWELVEDATA_KEY environment variable.
// 60s cache keeps usage well inside the 800-credits/day free quota.
const ALLOWED = new Set(["XAU/USD"]);

export default async function handler(req, res) {
  const key = process.env.TWELVEDATA_KEY;
  if (!key) { res.status(503).json({ error: "TWELVEDATA_KEY not configured" }); return; }
  const symbol = String(req.query?.symbol || "");
  if (!ALLOWED.has(symbol)) { res.status(400).json({ error: "symbol not allowed" }); return; }

  const r = await fetch(
    `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${key}`
  );
  if (!r.ok) { res.status(502).json({ error: "upstream " + r.status }); return; }
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "public, max-age=60");
  res.status(200).send(await r.text());
}
