// Vercel serverless function (Web handler). Canonical copy going forward;
// netlify/functions/ holds the legacy Netlify twin.
// Twelve Data quote fallback (free tier: XAU/USD gold spot works).
// Key stays server-side in the TWELVEDATA_KEY environment variable.
// 60s cache keeps usage well inside the 800-credits/day free quota.
const ALLOWED = new Set(["XAU/USD"]);

export default async (req) => {
  const key = process.env.TWELVEDATA_KEY;
  if (!key) return Response.json({ error: "TWELVEDATA_KEY not configured" }, { status: 503 });
  const symbol = new URL(req.url).searchParams.get("symbol") || "";
  if (!ALLOWED.has(symbol))
    return Response.json({ error: "symbol not allowed" }, { status: 400 });

  const r = await fetch(
    `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${key}`
  );
  if (!r.ok) return Response.json({ error: "upstream " + r.status }, { status: 502 });
  return new Response(await r.text(), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
  });
};

