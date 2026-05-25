import { getCategoryPrice, getPackagePrice, getTraySize } from "../data/pricing.js";
import { getDishCategory } from "../data/dishes.js";

export function createDefaultSelections(packageItem) {
  return packageItem.slots.reduce((selections, slot, index) => {
    selections[getSlotKey(packageItem.id, index)] = slot.defaultDish;
    return selections;
  }, {});
}

export function getSlotKey(packageId, slotIndex) {
  return `${packageId}::${slotIndex}`;
}

export function getSelectedDish(packageItem, selections, slotIndex) {
  const slot = packageItem.slots[slotIndex];
  return selections[getSlotKey(packageItem.id, slotIndex)] ?? slot.defaultDish;
}

export function getSlotQuantityCount(quantityStr) {
  const match = String(quantityStr).match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 1;
}

export function getDishPrice(dishName, traySize) {
  const category = getDishCategory(dishName);
  return getCategoryPrice(category, traySize);
}

export function calculateTotalPrice(packageItem, selections) {
  if (packageItem.fixedPrice) return getPackagePrice(packageItem.id, packageItem.price);

  return packageItem.slots.reduce((total, slot, index) => {
    const dish = getSelectedDish(packageItem, selections, index);
    const count = getSlotQuantityCount(slot.quantity);
    const traySize = getTraySize(slot.quantity);
    const unitPrice = getDishPrice(dish, traySize);
    return total + unitPrice * count;
  }, 0);
}

export function buildOrderLines(packageItem, selections) {
  return packageItem.slots.map((slot, index) => {
    const dish = getSelectedDish(packageItem, selections, index);
    const count = getSlotQuantityCount(slot.quantity);
    const traySize = getTraySize(slot.quantity);
    const unitPrice = getDishPrice(dish, traySize);

    return {
      quantity: slot.quantity,
      label: slot.label,
      dish,
      unitPrice,
      count,
      lineTotal: unitPrice * count
    };
  });
}

export function formatPeso(amount) {
  if (!amount) return "-";
  return `PHP ${Number(amount).toLocaleString("en-PH")}`;
}

export function buildOrderSummaryText(packageItem, selections) {
  const lines = buildOrderLines(packageItem, selections);
  const total = calculateTotalPrice(packageItem, selections);

  const menuText = lines
    .map((line, i) => {
      const priceNote = line.lineTotal ? ` - ${formatPeso(line.lineTotal)}` : "";
      return `${i + 1}. ${line.quantity} ${line.dish || line.label}${priceNote}`;
    })
    .join("\n");

  return `Spandi's Package Meal Builder

Package: ${packageItem.name}
Good for: ${packageItem.pax}
Package type: ${packageItem.trayType}
Estimated total: ${formatPeso(total)}

Selected Menu:
${menuText}`;
}

export function buildAlacarteSummaryText(items, traySizes) {
  const total = items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
  const lines = items.map((item, i) => {
    const sizeLabel = traySizes.find((s) => s.id === item.traySize)?.label ?? item.traySize;
    return `${i + 1}. ${item.qty}x ${sizeLabel} - ${item.dish} - ${formatPeso(item.unitPrice * item.qty)}`;
  });

  return `Spandi's Ala Carte Order

Order:
${lines.join("\n")}

Estimated Total: ${formatPeso(total)}`;
}
