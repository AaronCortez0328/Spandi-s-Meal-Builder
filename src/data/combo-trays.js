const COMBO_GROUPS = [
  {
    parentSku: "TRAY-COMBO-15PAX-A",
    price: 10000,
    pax: "15 pax",
    combos: [
      combo("family-combo-1", "Family Combo 1", "family", [
        slot(1, "family", "Beef", "beef", "Garlic Beef Tips and Mushroom"),
        slot(1, "family", "Chicken", "chicken", "Chicken Parmigiana"),
        slot(1, "family", "Seafood", "seafood", "Lemon Fish Fillet"),
        slot(1, "family", "Veggie or Side", "side", "Baked Vegetables"),
        slot(1, "family", "Dessert", "dessert", "Mango Graham"),
        slot(2, "family", "Rice", "rice", "Steamed Rice")
      ]),
      combo("family-combo-2", "Family Combo 2", "family", [
        slot(1, "family", "Pork", "pork", "Lumpiang Shanghai"),
        slot(1, "family", "Pork", "pork", "Grilled Pork Belly"),
        slot(1, "family", "Chicken", "chicken", "Chicken Rosemary"),
        slot(1, "family", "Veggie or Side", "side", "Laing"),
        slot(1, "family", "Dessert", "dessert", "Leche Flan"),
        slot(2, "family", "Rice", "rice", "Steamed Rice")
      ]),
      combo("family-combo-3", "Family Combo 3", "family", [
        slot(1, "family", "Pork", "pork", "Korean Roast Pork Belly"),
        slot(1, "family", "Chicken", "chicken", "Soy Garlic Chicken Wings"),
        slot(1, "family", "Pasta", "pasta", "Charlie Chan Pasta"),
        slot(1, "family", "Veggie or Side", "side", "Buttered Corn"),
        slot(1, "family", "Dessert", "dessert", "Tiramisu"),
        slot(2, "family", "Rice", "rice", "Steamed Rice")
      ])
    ]
  },
  {
    parentSku: "TRAY-COMBO-15PAX-B",
    price: 12000,
    pax: "15 pax",
    combos: [
      combo("feast-combo-1", "Feast Combo 1", "feast", [
        slot(1, "feast", "Pork", "pork", "Korean Blueberry Roast Pork"),
        slot(1, "feast", "Seafood", "seafood", "Lemon Fish Fillet"),
        slot(1, "feast", "Chicken", "chicken", "Chicken Parmigiana"),
        slot(1, "feast", "Pasta", "pasta", "Bacon Aglio Olio"),
        slot(2, "feast", "Rice", "rice", "Blue Ternate Rice"),
        slot(1, "feast", "Dessert", "dessert", "Mango Graham")
      ]),
      combo("feast-combo-2", "Feast Combo 2", "feast", [
        slot(1, "feast", "Beef", "beef", "Dry Rub Roast Beef"),
        slot(1, "feast", "Seafood", "seafood", "Mango Salsa Sole Fish"),
        slot(1, "feast", "Chicken", "chicken", "Citrus Chicken Confit"),
        slot(1, "feast", "Pasta", "pasta", "Eggplant Parmigiana Pasta"),
        slot(2, "feast", "Rice", "rice", "Blue Ternate Rice"),
        slot(1, "feast", "Dessert", "dessert", "Leche Flan")
      ]),
      combo("feast-combo-3", "Feast Combo 3", "feast", [
        slot(1, "feast", "Pork", "pork", "Baby Back Ribs"),
        slot(1, "feast", "Seafood", "seafood", "Cajun Shrimp and Mussels"),
        slot(1, "feast", "Chicken", "chicken", "Cordon Bleu"),
        slot(1, "feast", "Pasta", "pasta", "Baked Macaroni"),
        slot(2, "feast", "Rice", "rice", "Blue Ternate Rice"),
        slot(1, "feast", "Dessert", "dessert", "Tiramisu")
      ])
    ]
  },
  {
    parentSku: "TRAY-COMBO-15PAX-C",
    price: 15000,
    pax: "15 pax",
    combos: [
      combo("feast-combo-4", "Feast Combo 4", "feast", [
        slot(1, "feast", "Seafood", "seafood", "Baked Mussels"),
        slot(1, "feast", "Seafood", "seafood", "Baked Shrimp"),
        slot(1, "feast", "Seafood", "seafood", "Baked Salmon"),
        slot(2, "feast", "Rice", "rice", "Garlic Java Rice"),
        slot(1, "feast", "Dessert", "dessert", "Mango Graham")
      ]),
      combo("feast-combo-5", "Feast Combo 5", "feast", [
        slot(1, "feast", "Beef", "beef", "Tenderloin Salpicao"),
        slot(1, "feast", "Seafood", "seafood", "Salmon Teriyaki Melt"),
        slot(1, "feast", "Chicken", "chicken", "Chicken Rosemary"),
        slot(2, "feast", "Rice", "rice", "Garlic Java Rice"),
        slot(1, "feast", "Dessert", "dessert", "Leche Flan")
      ]),
      combo("feast-combo-6", "Feast Combo 6", "feast", [
        slot(1, "feast", "Beef", "beef", "Beef Pares with Shiitake and Potato Balls"),
        slot(1, "feast", "Chicken", "chicken", "Chicken Alexander"),
        slot(1, "feast", "Seafood", "seafood", "Squid Salpicao"),
        slot(2, "feast", "Rice", "rice", "Garlic Java Rice"),
        slot(1, "feast", "Dessert", "dessert", "Tiramisu")
      ])
    ]
  },
  {
    parentSku: "TRAY-COMBO-15PAX-D",
    price: 20000,
    pax: "15 pax",
    combos: [
      combo("premium-combo-15", "Premium Combo", "feast", [
        slot(1, "feast", "Beef", "beef", "Dry Rub Roast Beef"),
        slot(1, "feast", "Seafood", "seafood", "Baked Salmon"),
        slot(1, "feast", "Chicken", "chicken", "Chicken Alexander"),
        slot(1, "feast", "Pork", "pork", "Korean Blueberry Roast Pork"),
        slot(1, "feast", "Pasta", "pasta", "Pesto Cajun Shrimp Pasta"),
        slot(1, "feast", "Pasta", "pasta", "Creamy Truffle Pasta"),
        slot(1, "feast", "Side or Salad", "side", "Asian Salad"),
        slot(2, "feast", "Rice", "rice", "Blue Ternate Rice"),
        slot(1, "feast", "Dessert", "dessert", "Leche Flan")
      ])
    ]
  },
  {
    parentSku: "TRAY-COMBO-25PAX-A",
    price: 15000,
    pax: "25 pax",
    combos: [
      cloneCombo("feast-combo-7", "Feast Combo 7", "feast", "family-combo-1"),
      cloneCombo("feast-combo-8", "Feast Combo 8", "feast", "family-combo-2"),
      cloneCombo("feast-combo-9", "Feast Combo 9", "feast", "family-combo-3")
    ]
  },
  {
    parentSku: "TRAY-COMBO-25PAX-B",
    price: 17000,
    pax: "25 pax",
    combos: [
      cloneCombo("xxxl-combo-1", "XXXL Combo 1", "xxxl", "feast-combo-1"),
      cloneCombo("xxxl-combo-2", "XXXL Combo 2", "xxxl", "feast-combo-2"),
      cloneCombo("xxxl-combo-3", "XXXL Combo 3", "xxxl", "feast-combo-3")
    ]
  },
  {
    parentSku: "TRAY-COMBO-25PAX-C",
    price: 19000,
    pax: "25 pax",
    combos: [
      cloneCombo("xxxl-combo-4", "XXXL Combo 4", "xxxl", "feast-combo-4"),
      cloneCombo("xxxl-combo-5", "XXXL Combo 5", "xxxl", "feast-combo-5"),
      cloneCombo("xxxl-combo-6", "XXXL Combo 6", "xxxl", "feast-combo-6")
    ]
  },
  {
    parentSku: "TRAY-COMBO-25PAX-D",
    price: 27000,
    pax: "25 pax",
    combos: [cloneCombo("xxxl-premium-combo", "XXXL Premium Combo", "xxxl", "premium-combo-15")]
  },
  {
    parentSku: "TRAY-COMBO-45PAX-A",
    price: 25000,
    pax: "45 pax",
    combos: [
      cloneCombo("xxxl-combo-7", "XXXL Combo 7", "xxxl", "family-combo-1"),
      cloneCombo("xxxl-combo-8", "XXXL Combo 8", "xxxl", "family-combo-2"),
      cloneCombo("xxxl-combo-9", "XXXL Combo 9", "xxxl", "family-combo-3")
    ]
  },
  {
    parentSku: "TRAY-COMBO-50PAX-B",
    price: 30600,
    pax: "50-70 pax",
    combos: [
      cloneCombo("2-xxxl-combo-1", "2 XXXL Combo 1", "xxxl", "feast-combo-1", 2),
      cloneCombo("2-xxxl-combo-2", "2 XXXL Combo 2", "xxxl", "feast-combo-2", 2),
      cloneCombo("2-xxxl-combo-3", "2 XXXL Combo 3", "xxxl", "feast-combo-3", 2)
    ]
  },
  {
    parentSku: "TRAY-COMBO-50PAX-C",
    price: 42000,
    pax: "50-70 pax",
    combos: [
      cloneCombo("2-xxxl-combo-4", "2 XXXL Combo 4", "xxxl", "feast-combo-4", 2),
      cloneCombo("2-xxxl-combo-5", "2 XXXL Combo 5", "xxxl", "feast-combo-5", 2),
      cloneCombo("2-xxxl-combo-6", "2 XXXL Combo 6", "xxxl", "feast-combo-6", 2)
    ]
  },
  {
    parentSku: "TRAY-COMBO-50PAX-D",
    price: 54000,
    pax: "50-70 pax",
    combos: [cloneCombo("2-xxxl-premium-combo", "2 XXXL Premium Combo", "xxxl", "premium-combo-15", 2)]
  },
  {
    parentSku: "",
    price: 19000,
    pax: "50 pax",
    combos: [
      combo("mary-rose-50", "Mary Rose Package", "xxxl", [
        slot(1, "xxxl", "Beef", "beef", "Roast Beef Pink Mash"),
        slot(1, "xxxl", "Chicken", "chicken", "Chicken Parmigiana"),
        slot(1, "xxxl", "Chicken", "chicken", "Chicken Rosemary"),
        slot(1, "xxxl", "Seafood", "seafood", "Lemon Fish Fillet"),
        slot(1, "xxxl", "Pasta", "pasta", "Baked Macaroni"),
        slot(1, "xxxl", "Rice", "rice", "Java Rice"),
        slot(1, "xxxl", "Rice", "rice", "Blue Rice"),
        slot(1, "xxxl", "Dessert", "dessert", "S'more's Fudge Brownies")
      ])
    ]
  },
  {
    parentSku: "",
    price: 35000,
    pax: "100 pax",
    combos: [
      combo("xxxl-100", "XXXL Trays for 100 pax", "xxxl", [
        slot(2, "xxxl", "Beef", "beef", "Roast Beef with Pink Mashed Potatoes"),
        slot(2, "xxxl", "Seafood", "seafood", "Lemon Fish Fillet"),
        slot(2, "xxxl", "Pasta", "pasta", "Baked Macaroni"),
        slot(2, "xxxl", "Chicken", "chicken", "Chicken Parmigiana"),
        slot(2, "xxxl", "Chicken", "chicken", "Chicken Rosemary"),
        slot(2, "xxxl", "Rice", "rice", "Java Rice"),
        slot(1, "xxxl", "Rice", "rice", "Blue Rice"),
        slot(2, "xxxl", "Dessert", "dessert", "S'more's Fudge Brownies")
      ])
    ]
  }
];

const comboLookup = new Map();
for (const group of COMBO_GROUPS) {
  for (const item of group.combos) {
    comboLookup.set(item.id, item);
  }
}

export function buildComboTrayPackages(sheetPackages = []) {
  const sheetById = new Map(sheetPackages.map((item) => [item.id, item]));

  return COMBO_GROUPS.flatMap((group) => {
    const source = sheetById.get(group.parentSku);
    const price = source?.price || group.price;
    const pax = source?.pax || group.pax;

    return group.combos.map((item) => {
      const resolved = resolveCombo(item);

      return {
      id: item.id,
      parentSku: group.parentSku,
      service: "combo-trays",
      group: normalizeGroup(pax),
      groupLabel: pax,
      name: item.name,
      price,
      pax,
      trayType: "Combo party trays",
      fixedPrice: true,
      slots: resolved.slots,
      sourceName: source?.name || "",
      sourceNotes: source?.notes || ""
      };
    });
  });
}

function combo(id, name, traySize, slots) {
  return { id, name, traySize, slots };
}

function slot(count, traySize, label, category, defaultDish) {
  return {
    quantity: `${count} ${traySize.toUpperCase()}`,
    label,
    categories: [category],
    defaultDish,
    traySize,
    count
  };
}

function cloneCombo(id, name, traySize, sourceId, multiplier = 1) {
  return { id, name, traySize, cloneOf: sourceId, multiplier };
}

function resolveCombo(item) {
  if (item.slots) return item;

  const source = comboLookup.get(item.cloneOf);
  if (!source) {
    return { ...item, slots: [] };
  }

  const resolvedSource = resolveCombo(source);
  const multiplier = item.multiplier ?? 1;
  const slots = resolvedSource.slots.map((slot) => ({
    ...slot,
    quantity: `${slot.count * multiplier} ${item.traySize.toUpperCase()}`,
    traySize: item.traySize,
    count: slot.count * multiplier
  }));

  return {
    ...item,
    slots
  };
}

function normalizeGroup(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
