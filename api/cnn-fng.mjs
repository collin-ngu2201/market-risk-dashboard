// CNN Fear & Greed Index (stock-market sentiment). CNN's dataviz endpoint
// rejects non-browser requests ("I'm a teapot"), so we spoof browser headers
// server-side. No API key required.
export default async function handler(req, res) {
  const r = await fetch("https://production.dataviz.cnn.io/index/fearandgreed/graphdata", {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://edition.cnn.com/markets/fear-and-greed",
      Origin: "https://edition.cnn.com",
    },
  });
  if (!r.ok) { res.status(502).json({ error: "upstream " + r.status }); return; }
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "public, max-age=300");
  res.status(200).send(await r.text());
}
