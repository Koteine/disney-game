export function initItemsSystem() {
  if (typeof window.renderInventory === 'function') window.renderInventory();
  if (typeof window.fillAdminItemsFormDefaults === 'function') window.fillAdminItemsFormDefaults();
}

export const ItemsSystemModule = { init: initItemsSystem };
window.ItemsSystemModule = ItemsSystemModule;
