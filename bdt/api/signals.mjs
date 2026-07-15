// Read-only view of the signal engine state for the Dip Radar pages.
import { blobToken, readBlobJson } from "./_shared.mjs";

export const GET = async () => {
  if (!blobToken())
    return Response.json({ configured: false }, { headers: { "cache-control": "no-store" } });
  try {
    const s = await readBlobJson("dip-radar/state.json");
    if (!s)
      return Response.json({ configured: true, lastScan: 0, open: {}, closed: [], alerts: [] },
        { headers: { "cache-control": "no-store" } });
    return Response.json({ configured: true, lastScan: s.lastScan || 0,
      open: s.open || {}, closed: s.closed || [], alerts: s.alerts || [] },
      { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ configured: true, error: String(e.message || e) }, { status: 500 });
  }
};
