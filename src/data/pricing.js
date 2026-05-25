export const TRAY_SIZES = [
  { id: "family", label: "Family (1kg)", pax: "4-6 pax" },
  { id: "feast", label: "Feast (2kg)", pax: "10-12 pax" },
  { id: "xxxl", label: "XXXL (5kg)", pax: "20-25 pax" }
];

let categoryPrices = {};
let packagePrices = {};

export function resetPrices() {
  categoryPrices = {};
  packagePrices = {};
}

export function updateCategoryPrices(prices) {
  for (const [categoryId, sizes] of Object.entries(prices)) {
    categoryPrices[categoryId] = {
      ...(categoryPrices[categoryId] ?? {}),
      ...sizes
    };
  }
}

export function updatePackagePrices(prices) {
  Object.assign(packagePrices, prices);
}

export function getPackagePrice(packageId, fallback = 0) {
  return packagePrices[packageId] ?? fallback;
}

export function getTraySize(quantityStr) {
  const q = String(quantityStr).toUpperCase();
  if (q.includes("XXXL")) return "xxxl";
  if (q.includes("FEAST")) return "feast";
  if (q.includes("FAMILY")) return "family";
  return "feast";
}

export function getCategoryPrice(categoryId, traySize) {
  return categoryPrices[categoryId]?.[traySize] ?? 0;
}
