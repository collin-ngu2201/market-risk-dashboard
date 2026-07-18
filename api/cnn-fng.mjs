// Vercel serverless function (Web handler). Canonical copy going forward;
// netlify/functions/ holds the legacy Netlify twin.
// CNN Fear & Greed Index (stock-market sentiment). CNN's dataviz endpoint
// rejects non-browser requests ("I'm a teapot"), so we spoof browser headers
// server-side. No API key required.
export const GET = async () => {
  const upstream =
    "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";
  const r = await fetch(upstream, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://edition.cnn.com/markets/fear-and-greed",
      Origin: "https://edition.cnn.com",
    },
  });
  if (!r.ok) return Response.json({ error: "upstream " + r.status }, { status: 502 });
  return new Response(await r.text(), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
    },
  });
};

