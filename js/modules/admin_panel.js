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

export async function initAdminPanel(dbInstance) {
  await ensureDbReady(dbInstance);

  if (window.EventsEngineModule && typeof window.EventsEngineModule.wireAdminEventButton === 'function') {
    window.EventsEngineModule.wireAdminEventButton();
  }

  if (typeof window.fillAdminItemsFormDefaults === 'function') {
    window.fillAdminItemsFormDefaults();
  }
}

export const AdminPanelModule = { init: initAdminPanel };
window.AdminPanelModule = AdminPanelModule;
