// Batch server-side proxy for Yahoo Finance v8 chart API, for the Dip Radar pages.
// Fans out to one chart call per symbol and returns a compact combined payload,
// so the browser loads the whole ~66-ticker universe in 4 requests.
// Allowlisted symbols only, so this can't be abused as an open proxy.
import { UNIVERSE, RANGES, INTERVALS, fetchOne } from "./_shared.mjs";

const MAX_BATCH = 20;

export const GET = async (req) => {
  const u = new URL(req.url, "http://localhost");
  const symbols = (u.searchParams.get("symbols") || "")
    .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!symbols.length || symbols.length > MAX_BATCH)
    return Response.json({ error: `1-${MAX_BATCH} symbols required` }, { status: 400 });
  const bad = symbols.filter((s) => !UNIVERSE.has(s));
  if (bad.length)
    return Response.json({ error: "symbol not allowed: " + bad.join(",") }, { status: 400 });
  const range = RANGES.has(u.searchParams.get("range")) ? u.searchParams.get("range") : "6mo";
  const interval = INTERVALS.has(u.searchParams.get("interval")) ? u.searchParams.get("interval") : "1d";

  const out = {};
  await Promise.all(symbols.map(async (s) => {
    try { out[s] = await fetchOne(s, range, interval); }
    catch (e) { out[s] = { error: String(e.message || e) }; }
  }));
  return Response.json(out, {
    headers: { "cache-control": "public, max-age=60" },
  });
};
