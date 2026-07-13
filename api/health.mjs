// Vercel serverless function (Web handler). Canonical copy going forward;
// netlify/functions/ holds the legacy Netlify twin.
export default async () =>
  Response.json(
    {
      ok: true,
      finnhub: !!process.env.FINNHUB_KEY,
      twelvedata: !!process.env.TWELVEDATA_KEY,
    },
    { headers: { "cache-control": "no-store" } }
  );

