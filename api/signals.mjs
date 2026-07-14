// Read-only view of the signal engine state for the Dip Radar pages.
import { list } from "@vercel/blob";
import { blobToken } from "./_shared.mjs";

export const GET = async () => {
  const token = blobToken();
  if (!token)
    return Response.json({ configured: false }, { headers: { "cache-control": "no-store" } });
  try {
    const { blobs } = await list({ prefix: "dip-radar/state.json", limit: 1, token });
    if (!blobs.length)
      return Response.json({ configured: true, lastScan: 0, open: {}, closed: [], alerts: [] },
        { headers: { "cache-control": "no-store" } });
    const r = await fetch(blobs[0].url + "?ts=" + Date.now(), { cache: "no-store" });
    const s = await r.json();
    return Response.json({ configured: true, lastScan: s.lastScan || 0,
      open: s.open || {}, closed: s.closed || [], alerts: s.alerts || [] },
      { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ configured: true, error: String(e.message || e) }, { status: 500 });
  }
};
