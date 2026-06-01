// ── Vercel API proxy → Apps Script (avoids browser CORS on script.google.com) ─
const APPS_SCRIPT_URL = "/api/sheet";

// ── Legacy CSV base (still used by packed-meals fallback) ─────────────────────
const LEGACY_SHEET_BASE =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vS1vOAy2hIBIN3ZCnb-2zJckLaFW6aO7DUL-YaBSEHHNw3dHoDSZetv7rD9HCsWockCukhkDG4wDn8n/pub?output=csv";

export const SHEET_URLS = {
  catering:    `${LEGACY_SHEET_BASE}&gid=1757087702`,
  partyTrays:  `${LEGACY_SHEET_BASE}&gid=1572449210`,
  packedMeals: `${LEGACY_SHEET_BASE}&gid=941320019`,
};

// All pricing URLs now route through Apps Script for real-time, cache-free data
export const PRICING_SHEET_URLS = {
  dishes:           `${APPS_SCRIPT_URL}?gid=613557580`,
  partyTrayPrices:  `${APPS_SCRIPT_URL}?gid=2048645906`,
  dishPrices:       `${APPS_SCRIPT_URL}?gid=1612660170`,
  packages:         `${APPS_SCRIPT_URL}?gid=734407384`,
  packageItems:     `${APPS_SCRIPT_URL}?gid=2009717545`,
  replacementRules: `${APPS_SCRIPT_URL}?gid=656143830`,
  settings:         `${APPS_SCRIPT_URL}?gid=927691456`,
};

export async function fetchSheetRows(url) {
  // _cb timestamp busts browser/CDN cache without adding headers that trigger CORS preflight
  const bustUrl = `${url}&_cb=${Date.now()}`;
  const res = await fetch(bustUrl);
  if (!res.ok) throw new Error(`Sheet fetch failed: HTTP ${res.status}`);
  const text = await res.text();
  // Apps Script returns JSON — try that first, fall back to CSV for legacy URLs
  try {
    const json = JSON.parse(text);
    if (Array.isArray(json)) return json;
  } catch {
    // not JSON — fall through to CSV parser
  }
  return parseCSV(text);
}

function parseCSV(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row = Object.fromEntries(headers.map((h, j) => [h, (values[j] ?? "").trim()]));
    const activeValue = row.active ?? row.is_active;
    if (!activeValue || activeValue.toUpperCase() === "TRUE") rows.push(row);
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}
