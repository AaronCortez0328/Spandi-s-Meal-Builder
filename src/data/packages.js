let packageGroups = [];
let packages = [];

export function createPackageSlot({ quantity, label, categories, defaultDish }) {
  return { quantity, label, categories, defaultDish };
}

export function setPackageCatalog(nextPackages) {
  packages = nextPackages;
  packageGroups = buildGroups(nextPackages);
}

export function getPackages() {
  return packages;
}

export function getPackageGroups() {
  return packageGroups;
}

function buildGroups(packageList) {
  const groups = new Map();

  for (const packageItem of packageList) {
    if (!groups.has(packageItem.group)) {
      groups.set(packageItem.group, {
        id: packageItem.group,
        label: packageItem.groupLabel
      });
    }
  }

  return [...groups.values()];
}
