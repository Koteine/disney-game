import { RulesTabModule } from './modules/rules_tab.js';
import { ItemsSystemModule } from './modules/items_system.js';
import { EventsEngineModule } from './modules/events_engine.js';
import { AdminPanelModule } from './modules/admin_panel.js';
import { WorksGalleryModule } from './modules/works_gallery.js';

function syncFirebaseGlobals() {
  if (window.__gameDbInstance) window.db = window.__gameDbInstance;
  if (typeof window.__gameAdminId !== 'undefined') window.ADMIN_ID = window.__gameAdminId;
  if (typeof window.__gameCurrentUserId !== 'undefined') window.currentUserId = window.__gameCurrentUserId;
}

export function initModules() {
  syncFirebaseGlobals();
  [
    RulesTabModule,
    ItemsSystemModule,
    EventsEngineModule,
    AdminPanelModule,
    WorksGalleryModule
  ].forEach((moduleApi) => {
    if (moduleApi && typeof moduleApi.init === 'function') {
      moduleApi.init();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initModules);
} else {
  initModules();
}

window.MainDispatcher = { initModules };
