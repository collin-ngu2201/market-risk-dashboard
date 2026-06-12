export default async () =>
  Response.json(
    {
      ok: true,
      finnhub: !!process.env.FINNHUB_KEY,
      twelvedata: !!process.env.TWELVEDATA_KEY,
    },
    { headers: { "cache-control": "no-store" } }
  );

export const config = { path: "/api/health" };
