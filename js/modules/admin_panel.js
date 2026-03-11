export function initAdminPanel() {
  if (window.EventsEngineModule && typeof window.EventsEngineModule.wireAdminEventButton === 'function') {
    window.EventsEngineModule.wireAdminEventButton();
  }

  if (typeof window.fillAdminItemsFormDefaults === 'function') {
    window.fillAdminItemsFormDefaults();
  }
}

export const AdminPanelModule = { init: initAdminPanel };
window.AdminPanelModule = AdminPanelModule;
