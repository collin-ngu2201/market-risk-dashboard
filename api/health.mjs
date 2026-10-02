// Health probe — the page uses this to detect "serverless mode" and which
// keyed fallbacks are armed. No secrets are exposed, only booleans.
export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  res.status(200).json({
    ok: true,
    finnhub: !!process.env.FINNHUB_KEY,
    twelvedata: !!process.env.TWELVEDATA_KEY,
  });
}
