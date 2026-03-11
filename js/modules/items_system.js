async function ensureDbReady(dbInstance) {
  if (dbInstance) {
    window.db = dbInstance;
    return dbInstance;
  }
  if (typeof window.waitForDbReady === 'function') {
    return window.waitForDbReady();
  }
  return window.db || null;
}

export async function initItemsSystem(dbInstance) {
  console.log('DEBUG: Module ItemsSystem received DB object:', !!dbInstance);
  await ensureDbReady(dbInstance);
  const resolvedCurrentUserId = window.__gameCurrentUserId ?? window.currentUserId ?? null;
  window.currentUserId = resolvedCurrentUserId;
  console.log('DEBUG: ItemsSystem currentUserId:', resolvedCurrentUserId);

  if (typeof window.renderInventory === 'function') window.renderInventory();
  if (typeof window.fillAdminItemsFormDefaults === 'function') window.fillAdminItemsFormDefaults();
}

export const ItemsSystemModule = { init: initItemsSystem };
window.ItemsSystemModule = ItemsSystemModule;
