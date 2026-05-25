import { buildComboTrayPackages } from "./combo-trays.js";
import { resetPrices, updateCategoryPrices, updatePackagePrices } from "./pricing.js";
import { setPackageCatalog } from "./packages.js";

const SHEET_ID = "1_5e2panBTC7Vn4q6-m35lpc9T6B6iVkUG7r7Ws0ZPtQ";
const LIVE_SHEET_NAMES = ["PartyTrays", "Catering", "PackedMeals"];

const SHEET_CATEGORY_MAP = {
  "Chicken": "chicken",
  "Fish/Seafood": "seafood",
  "Seafood": "seafood",
  "Pork": "pork",
  "Beef": "beef",
  "Veggies/Salad": "side",
  "Soup": "soup",
  "Dessert": "dessert",
  "Pasta": "pasta",
  "Drinks": "drinks",
  "Rice": "rice"
};

const CATEGORY_LABELS = {
  beef: "Beef",
  seafood: "Seafood",
  pork: "Pork",
  chicken: "Chicken",
  pasta: "Pasta",
  dessert: "Dessert",
  side: "Veggie Dish or Salad",
  soup: "Soup",
  rice: "Rice",
  drinks: "Drinks"
};

let categories = {};
let partyTrayCategories = [];
let packedMealPackTypes = [];

export async function loadDishCategories() {
  resetPrices();

  try {
    const sheetRows = await Promise.all(LIVE_SHEET_NAMES.map(fetchSheetRows));
    const catalog = parseCatalogRows(sheetRows.flat());

    categories = catalog.categories;
    partyTrayCategories = catalog.partyTrayCategories;
    packedMealPackTypes = catalog.packedMealPackTypes;

    setPackageCatalog(catalog.comboPackages);
    updateCategoryPrices(catalog.categoryPrices);
    updatePackagePrices(catalog.packagePrices);
  } catch (err) {
    console.error("Failed to load live Google Sheet data:", err);
    categories = {};
    partyTrayCategories = [];
    packedMealPackTypes = [];
    setPackageCatalog([]);
  }
}

async function fetchSheetRows(sheetName) {
  if (typeof document !== "undefined" && typeof window !== "undefined") {
    return fetchSheetRowsJsonp(sheetName);
  }

  const response = await fetch(getSheetCsvUrl(sheetName), { cache: "no-store" });
  if (!response.ok) throw new Error(`${sheetName} returned HTTP ${response.status}`);

  const text = await response.text();
  return parseRows(text).map((row) => ({ ...row, _sheetName: sheetName }));
}

function fetchSheetRowsJsonp(sheetName) {
  return new Promise((resolve, reject) => {
    const callbackName = `__spandisSheet_${sheetName}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`${sheetName} timed out`));
    }, 15000);

    window[callbackName] = (payload) => {
      cleanup();

      if (payload.status !== "ok") {
        reject(new Error(`${sheetName} returned ${payload.status}`));
        return;
      }

      resolve(parseGoogleTable(payload.table).map((row) => ({ ...row, _sheetName: sheetName })));
    };

    script.onerror = () => {
      cleanup();
      reject(new Error(`${sheetName} script failed`));
    };

    script.src = getSheetJsonpUrl(sheetName, callbackName);
    document.head.append(script);

    function cleanup() {
      window.clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }
  });
}

function getSheetCsvUrl(sheetName) {
  const params = new URLSearchParams({
    tqx: "out:csv",
    sheet: sheetName,
    _: String(Date.now())
  });

  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?${params}`;
}

function getSheetJsonpUrl(sheetName, callbackName) {
  const params = new URLSearchParams({
    tqx: `out:json;responseHandler:${callbackName}`,
    sheet: sheetName,
    _: String(Date.now())
  });

  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?${params}`;
}

function parseGoogleTable(table) {
  const headers = table.cols.map((col) => col.label);

  return table.rows.map((row) => {
    const values = row.c ?? [];
    return Object.fromEntries(headers.map((header, index) => {
      const cell = values[index];
      const value = cell?.f ?? cell?.v ?? "";
      return [header, String(value).trim()];
    }));
  });
}

function parseCatalogRows(rows) {
  const activeRows = rows.filter(isActiveRow);
  const nextCategories = {};
  const partyTrayCategoryMap = new Map();
  const categoryPrices = {};
  const packagePrices = {};
  const sheetComboPackages = [];
  const packTypesById = new Map();
  const packMenusById = new Map();
  const packTiersById = new Map();

  for (const row of activeRows) {
    if (row.service === "PartyTrays") {
      if (row.record_type === "CategoryPrice") {
        addCategoryPrice(categoryPrices, partyTrayCategoryMap, row);
      } else if (row.record_type === "MenuItem") {
        addMenuItem(nextCategories, row);
        addPartyTrayDish(partyTrayCategoryMap, row);
      } else if (row.record_type === "ComboPackage") {
        const item = createSheetComboPackage(row);
        sheetComboPackages.push(item);
        packagePrices[item.id] = item.price;
      }
    } else if (row.service === "Catering") {
      if (row.record_type === "MenuItem") {
        addMenuItem(nextCategories, row);
      }
    } else if (row.service === "PackedMeals") {
      if (row.record_type === "PackType") {
        packTypesById.set(row.sku_id, createPackType(row));
      } else if (row.record_type === "PricingTier") {
        addPackedMealTier(packTiersById, row);
      } else if (row.record_type === "MenuItem") {
        addPackedMealMenu(packMenusById, row);
      }
    }
  }

  ensureRiceCategory(nextCategories);

  const comboPackages = buildComboTrayPackages(sheetComboPackages);
  for (const packageItem of comboPackages) {
    packagePrices[packageItem.id] = packageItem.price;
  }

  return {
    categories: nextCategories,
    partyTrayCategories: buildPartyTrayCategories(partyTrayCategoryMap),
    packedMealPackTypes: buildPackedMealPackTypes(packTypesById, packMenusById, packTiersById),
    comboPackages,
    categoryPrices,
    packagePrices
  };
}

function parseRows(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map((header) => header.trim());

  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, (values[index] ?? "").trim()]));
  });
}

function isActiveRow(row) {
  const active = String(row.is_active ?? "").trim().toUpperCase();
  return active === "TRUE" || active === "1" || active === "YES";
}

function addMenuItem(nextCategories, row) {
  const categoryId = getCategoryId(row.category);
  if (!categoryId || !row.item_name) return;

  if (!nextCategories[categoryId]) {
    nextCategories[categoryId] = {
      label: CATEGORY_LABELS[categoryId] ?? row.category,
      dishes: []
    };
  }

  if (!nextCategories[categoryId].dishes.includes(row.item_name)) {
    nextCategories[categoryId].dishes.push(row.item_name);
  }
}

function addCategoryPrice(categoryPrices, partyTrayCategoryMap, row) {
  const categoryId = getCategoryId(row.category);
  const sizeId = getTraySizeId(row);
  const price = parseNumber(row.price);

  if (!categoryId || !sizeId || !price) return;

  if (!categoryPrices[categoryId]) categoryPrices[categoryId] = {};
  categoryPrices[categoryId][sizeId] = price;

  const category = ensurePartyTrayCategory(partyTrayCategoryMap, categoryId, row.category);
  category.prices[sizeId] = {
    id: sizeId,
    label: getTraySizeLabel(row, sizeId),
    unitSize: row.unit_size,
    pax: row.pax_coverage,
    price
  };
}

function addPartyTrayDish(partyTrayCategoryMap, row) {
  const categoryId = getCategoryId(row.category);
  if (!categoryId || !row.item_name) return;

  const category = ensurePartyTrayCategory(partyTrayCategoryMap, categoryId, row.category);
  if (!category.dishes.some((dish) => dish.name === row.item_name)) {
    category.dishes.push({
      id: row.sku_id,
      name: row.item_name,
      description: row.item_description
    });
  }
}

function ensurePartyTrayCategory(partyTrayCategoryMap, categoryId, sourceLabel) {
  if (!partyTrayCategoryMap.has(categoryId)) {
    partyTrayCategoryMap.set(categoryId, {
      id: categoryId,
      label: CATEGORY_LABELS[categoryId] ?? sourceLabel,
      dishes: [],
      prices: {}
    });
  }

  return partyTrayCategoryMap.get(categoryId);
}

function createSheetComboPackage(row) {
  const price = parseNumber(row.price);
  return {
    id: row.sku_id,
    name: row.item_name,
    price,
    pax: row.pax_coverage,
    notes: row.notes
  };
}

function createPackType(row) {
  return {
    id: row.sku_id,
    name: row.item_name,
    description: row.item_description
  };
}

function addPackedMealMenu(packMenusById, row) {
  if (!row.parent_sku_id || !row.item_name) return;

  if (!packMenusById.has(row.parent_sku_id)) {
    packMenusById.set(row.parent_sku_id, []);
  }

  packMenusById.get(row.parent_sku_id).push({
    id: row.sku_id,
    category: row.category,
    name: row.item_name,
    description: row.item_description
  });
}

function addPackedMealTier(packTiersById, row) {
  if (!row.parent_sku_id) return;

  if (!packTiersById.has(row.parent_sku_id)) {
    packTiersById.set(row.parent_sku_id, []);
  }

  packTiersById.get(row.parent_sku_id).push({
    id: row.sku_id,
    name: row.item_name,
    unitSize: row.unit_size,
    minOrderQty: parseNumber(row.min_order_qty),
    price: parseNumber(row.price)
  });
}

function buildPartyTrayCategories(categoryMap) {
  const order = ["beef", "seafood", "pork", "chicken", "pasta", "dessert", "rice", "side"];
  return [...categoryMap.values()].sort((a, b) => {
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

function buildPackedMealPackTypes(packTypesById, packMenusById, packTiersById) {
  return [...packTypesById.values()].map((packType) => ({
    ...packType,
    menuItems: packMenusById.get(packType.id) ?? [],
    tiers: (packTiersById.get(packType.id) ?? []).sort((a, b) => b.minOrderQty - a.minOrderQty)
  }));
}

function ensureRiceCategory(nextCategories) {
  if (!nextCategories.rice) {
    nextCategories.rice = {
      label: "Rice",
      dishes: ["Steamed Rice"]
    };
  }
}

function getCategoryId(categoryName) {
  return SHEET_CATEGORY_MAP[categoryName] ?? normalizeId(categoryName);
}

function getTraySizeId(row) {
  const value = `${row.sku_id} ${row.item_name} ${row.unit_size} ${row.pax_coverage}`.toLowerCase();

  if (value.includes("xxxl") || value.includes("party") || value.includes("5kg")) return "xxxl";
  if (value.includes("feast") || value.includes("2kg")) return "feast";
  if (value.includes("family") || value.includes("1kg")) return "family";

  return "";
}

function getTraySizeLabel(row, sizeId) {
  if (sizeId === "xxxl") return `XXXL (${row.unit_size || "5kg"})`;
  if (sizeId === "feast") return `Feast (${row.unit_size || "2kg"})`;
  return `Family (${row.unit_size || "1kg"})`;
}

function parseNumber(value) {
  const number = Number(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function normalizeId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        current += "\"";
        i++;
      } else {
        inQuotes = !inQuotes;
      }
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

export function getCategoryLabel(categoryId) {
  return categories[categoryId]?.label ?? CATEGORY_LABELS[categoryId] ?? categoryId;
}

export function getDishOptions(categoryIds) {
  return categoryIds.flatMap((id) => categories[id]?.dishes ?? []);
}

export function getDishCategory(dishName) {
  for (const [categoryId, { dishes }] of Object.entries(categories)) {
    if (dishes.includes(dishName)) return categoryId;
  }
  return null;
}

export function getPartyTrayCategories() {
  return partyTrayCategories;
}

export function getPackedMealPackTypes() {
  return packedMealPackTypes;
}
