// One-time (idempotent) historical seed for the signal engine. Runs the
// daily-bar backtest across the whole universe and writes the resulting
// completed trades into the Blob state's closed log (tagged bt:1) so tiers,
// win rates and the Performance page have data from day one.
//   GET /api/backtest                       seed only if not already seeded
//   GET /api/backtest?reset=1               clear old backtest trades and re-seed
//   GET /api/backtest?reset=1&since=DATE    re-seed keeping only trades ENTERED
//                                           on/after DATE (YYYY-MM-DD)
// The stats window starts at BACKTEST_SINCE; a full year of bars is still
// fetched because the indicators (vol20, RSI) need warm-up history before
// the window opens.
import { put } from "@vercel/blob";
import { UNIVERSE, fetchOne, backtestDaily, blobToken, readBlobJson, BLOB_ACCESS } from "./_shared.mjs";

export const maxDuration = 60;

const STATE_PATH = "dip-radar/state.json";
const MAX_CLOSED = 800;
const BACKTEST_SINCE = "2026-07-01";       // default stats window start (ET-agnostic, UTC midnight)
const emptyState = () => ({ v: 1, lastScan: 0, open: {}, closed: [], alerts: [] });
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

export const GET = async (req) => {
  if (!blobToken())
    return Response.json({ ok: false, configured: false, error: "Blob store not connected" }, { status: 503 });

  const params = new URL(req.url, "http://localhost").searchParams;
  const reset = params.get("reset") === "1";
  const sinceStr = /^\d{4}-\d{2}-\d{2}$/.test(params.get("since") || "") ? params.get("since") : BACKTEST_SINCE;
  const sinceMs = Date.parse(sinceStr + "T00:00:00Z");
  const state = (await readBlobJson(STATE_PATH)) || emptyState();

  const alreadySeeded = (state.closed || []).some((c) => c.bt);
  if (alreadySeeded && !reset)
    return Response.json({ ok: true, seeded: false, reason: "already seeded",
      backtestTrades: state.closed.filter((c) => c.bt).length });

  // fetch ~1y of daily bars for the whole universe (4 parallel batches of 17)
  const daily = {};
  await Promise.all(chunk([...UNIVERSE], 17).map(async (batch) => {
    await Promise.all(batch.map(async (sym) => {
      try { daily[sym] = await fetchOne(sym, "1y", "1d"); } catch (e) {}
    }));
  }));

  let seed = [];
  for (const sym of UNIVERSE) {
    const q = daily[sym];
    if (q && !q.error) seed = seed.concat(backtestDaily(q, sym).filter((t) => t.firedAt >= sinceMs));
  }
  seed.sort((a, b) => a.closedAt - b.closedAt);

  // keep live (non-bt) trades, replace the backtest set
  const live = (state.closed || []).filter((c) => !c.bt);
  state.closed = [...seed, ...live].sort((a, b) => b.closedAt - a.closedAt).slice(0, MAX_CLOSED);
  state.backtestedAt = Date.now();
  state.backtestSince = sinceStr;

  await put(STATE_PATH, JSON.stringify(state), {
    access: BLOB_ACCESS, addRandomSuffix: false, allowOverwrite: true,
    contentType: "application/json", cacheControlMaxAge: 60, token: blobToken(),
  });

  const wins = seed.filter((t) => t.result === "win").length;
  return Response.json({
    ok: true, seeded: true, since: sinceStr, tickers: Object.keys(daily).length,
    backtestTrades: seed.length, wins, losses: seed.length - wins,
    winRate: seed.length ? Math.round((wins / seed.length) * 100) : 0,
  }, { headers: { "cache-control": "no-store" } });
};
