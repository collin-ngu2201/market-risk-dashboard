// Read-only view of the signal engine state for the Dip Radar pages.
import { list } from "@vercel/blob";

export const GET = async () => {
  if (!process.env.BLOB_READ_WRITE_TOKEN)
    return Response.json({ configured: false }, { headers: { "cache-control": "no-store" } });
  try {
    const { blobs } = await list({ prefix: "dip-radar/state.json", limit: 1 });
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
