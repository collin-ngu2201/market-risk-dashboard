// Dip Radar signal engine — throttled scan, kicked by page visits.
// State (open trades, closed log, alerts) lives in one JSON file on
// Vercel Blob; without a connected Blob store this reports "not configured"
// and the UI degrades gracefully.
import { put, list } from "@vercel/blob";
import {
  UNIVERSE, fetchOne, dailyDip, bracketFor, evalEngine,
  isMarketOpen, etDay, r4, blobToken,
} from "./_shared.mjs";

export const maxDuration = 60;

const STATE_PATH = "dip-radar/state.json";
const SCAN_INTERVAL_MS = 25 * 60 * 1000;   // manual says every 30 min; 25 keeps drift down
const MAX_ALERTS = 200;
const MAX_CLOSED = 500;
const emptyState = () => ({ v: 1, lastScan: 0, open: {}, closed: [], alerts: [] });

async function loadState() {
  const { blobs } = await list({ prefix: STATE_PATH, limit: 1, token: blobToken() });
  if (!blobs.length) return emptyState();
  const r = await fetch(blobs[0].url + "?ts=" + Date.now(), { cache: "no-store" });
  if (!r.ok) return emptyState();
  try { return await r.json(); } catch { return emptyState(); }
}
async function saveState(s) {
  await put(STATE_PATH, JSON.stringify(s), {
    access: "public", addRandomSuffix: false, allowOverwrite: true,
    contentType: "application/json", cacheControlMaxAge: 60, token: blobToken(),
  });
}
const alert = (s, a) => { s.alerts.unshift({ ts: Date.now(), ...a }); s.alerts.length = Math.min(s.alerts.length, MAX_ALERTS); };

const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

export const GET = async (req) => {
  if (!blobToken())
    return Response.json({ ok: false, configured: false,
      error: "Blob store not connected — create one in Vercel → project → Storage" }, { status: 503 });

  const force = new URL(req.url, "http://localhost").searchParams.get("force") === "1";
  const state = await loadState();
  const now = Date.now();
  const open = isMarketOpen();

  if (!force && now - state.lastScan < SCAN_INTERVAL_MS)
    return Response.json({ ok: true, configured: true, skipped: "recent", lastScan: state.lastScan });
  // Nothing moves while the market is closed; skip once positions are settled
  // against the final prints of the last session.
  if (!force && !open && state.settledAt && state.settledAt > state.lastSessionEnd)
    return Response.json({ ok: true, configured: true, skipped: "market closed", lastScan: state.lastScan });

  state.lastScan = now;

  // 1) daily pass over the whole universe (4 parallel batches of 17)
  const daily = {};
  await Promise.all(chunk([...UNIVERSE], 17).map(async (batch) => {
    await Promise.all(batch.map(async (sym) => {
      try { daily[sym] = await fetchOne(sym, "6mo", "1d"); } catch (e) {}
    }));
  }));

  // 2) settle open trades against 30-min bars since entry (stop wins ties)
  const fired = [], closedNow = [];
  const bars30 = {};
  const need30 = new Set(Object.keys(state.open));
  // candidates: in the dip zone, no open trade, not already closed today
  const today = etDay();
  const candidates = [];
  for (const sym of UNIVERSE) {
    if (state.open[sym]) continue;
    const dip = dailyDip(daily[sym]);
    if (!dip || dip.d < 1.75) continue;
    if (state.closed.some((c) => c.sym === sym && etDay(new Date(c.closedAt)) === today)) continue;
    candidates.push({ sym, dip });
    need30.add(sym);
  }
  await Promise.all(chunk([...need30], 10).map(async (batch) => {
    await Promise.all(batch.map(async (sym) => {
      try { bars30[sym] = await fetchOne(sym, "5d", "30m"); } catch (e) {}
    }));
  }));

  for (const [sym, tr] of Object.entries(state.open)) {
    const b = bars30[sym];
    const px = daily[sym]?.price ?? b?.price;
    if (b?.t?.length) {
      for (let i = 0; i < b.t.length; i++) {
        if (b.t[i] * 1000 <= tr.firedAt) continue;
        if (b.l[i] <= tr.sl) {          // conservative: stop first
          closedNow.push({ ...tr, closedAt: now, exit: tr.sl, result: "loss",
            pct: r4((tr.sl / tr.entry - 1) * 100) });
          break;
        }
        if (b.h[i] >= tr.tp) {
          closedNow.push({ ...tr, closedAt: now, exit: tr.tp, result: "win",
            pct: r4((tr.tp / tr.entry - 1) * 100) });
          break;
        }
      }
    }
    if (!closedNow.some((c) => c.sym === sym) && px != null) tr.cur = r4(px);
  }
  for (const c of closedNow) {
    delete state.open[c.sym];
    state.closed.unshift(c);
    alert(state, { sym: c.sym, type: c.result, price: c.exit, pct: c.pct,
      msg: c.result === "win"
        ? `Hit target — closed ${c.pct >= 0 ? "+" : ""}${c.pct.toFixed(1)}%. Nice one.`
        : `Stopped out — closed ${c.pct.toFixed(1)}%. Capital protected.` });
  }
  state.closed.length = Math.min(state.closed.length, MAX_CLOSED);

  // 3) fire new signals (only while the market is open — a signal needs a
  //    live entry price, matching "setup alerts fire once, same-day")
  if (open) {
    for (const { sym, dip } of candidates) {
      const ev = evalEngine(bars30[sym], dip, true);
      if (!ev?.all) continue;
      const entry = r4(daily[sym]?.price ?? ev.barClose);
      const { tp, sl } = bracketFor(entry, dip.vol20);
      const tr = { sym, entry, cur: entry, tp, sl, firedAt: now, vol20: r4(dip.vol20) };
      state.open[sym] = tr;
      fired.push(sym);
      alert(state, { sym, type: "entry", price: entry,
        msg: `Dip signal fired — all 4 engine conditions confirmed. Entered at $${entry}.` });
    }
  }

  if (!open) { state.settledAt = now; state.lastSessionEnd = state.lastSessionEnd || 0; }
  else state.lastSessionEnd = now;

  await saveState(state);
  return Response.json({
    ok: true, configured: true, scanned: Object.keys(daily).length,
    marketOpen: open, fired, closed: closedNow.map((c) => c.sym),
    openCount: Object.keys(state.open).length, lastScan: state.lastScan,
  }, { headers: { "cache-control": "no-store" } });
};
