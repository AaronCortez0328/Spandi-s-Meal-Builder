const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxFwrrEVD5cq4KiZU4mAwC9vo5FxCH-5gygpbUQ-X8L1SubNzxE13zpRxVtzpJAT3G7/exec";

export default async function handler(req, res) {
  const { gid } = req.query;

  if (!gid) {
    return res.status(400).json({ error: "Missing gid parameter" });
  }

  try {
    const upstream = await fetch(`${APPS_SCRIPT_URL}?gid=${gid}`);
    if (!upstream.ok) {
      throw new Error(`Apps Script returned ${upstream.status}`);
    }
    const data = await upstream.json();

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(data);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
