const LEGACY_SHEET_BASE =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vS1vOAy2hIBIN3ZCnb-2zJckLaFW6aO7DUL-YaBSEHHNw3dHoDSZetv7rD9HCsWockCukhkDG4wDn8n/pub?output=csv";

const SPANDIS_PRICING_BASE =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRUnkKyVllU1lzPeu-5KrdQAjhVoRJu4GHHoNeleFvX5FjmjwML-UV4XiB3gQvEgw/pub?single=true&output=csv";

export const SHEET_URLS = {
  catering:    `${LEGACY_SHEET_BASE}&gid=1757087702`,
  partyTrays:  `${LEGACY_SHEET_BASE}&gid=1572449210`,
  packedMeals: `${LEGACY_SHEET_BASE}&gid=941320019`,
};

export const PRICING_SHEET_URLS = {
  dishes:           `${SPANDIS_PRICING_BASE}&gid=613557580`,
  partyTrayPrices:  `${SPANDIS_PRICING_BASE}&gid=2048645906`,
  dishPrices:       `${SPANDIS_PRICING_BASE}&gid=1612660170`,
  packages:         `${SPANDIS_PRICING_BASE}&gid=734407384`,
  packageItems:     `${SPANDIS_PRICING_BASE}&gid=2009717545`,
  replacementRules: `${SPANDIS_PRICING_BASE}&gid=656143830`,
  settings:         `${SPANDIS_PRICING_BASE}&gid=927691456`,
};

export async function fetchSheetRows(url) {
  // Append timestamp to bust browser + CDN caches; use no-store to skip browser cache entirely
  const bustUrl = `${url}&_cb=${Date.now()}`;
  const res = await fetch(bustUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`Sheet fetch failed: HTTP ${res.status}`);
  const text = await res.text();
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
