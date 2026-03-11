import { RulesTabModule } from './modules/rules_tab.js';
import { ItemsSystemModule } from './modules/items_system.js';
import { EventsEngineModule } from './modules/events_engine.js';
import { AdminPanelModule } from './modules/admin_panel.js';
import { WorksGalleryModule } from './modules/works_gallery.js';

const REGISTERED_MODULES = [
  RulesTabModule,
  ItemsSystemModule,
  EventsEngineModule,
  AdminPanelModule,
  WorksGalleryModule
];

function syncFirebaseGlobals(dbInstance) {
  const database = dbInstance || window.__gameDbInstance || window.db;
  if (database) {
    window.__gameDbInstance = database;
    window.db = database;
  }
  if (typeof window.__gameAdminId !== 'undefined') window.ADMIN_ID = window.__gameAdminId;
  if (typeof window.__gameCurrentUserId !== 'undefined') window.currentUserId = window.__gameCurrentUserId;
}

async function resolveDbInstance() {
  if (typeof window.waitForDbReady === 'function') {
    return window.waitForDbReady();
  }

  syncFirebaseGlobals();
  if (window.db) return window.db;

  if (window.firebase?.apps?.length) {
    const database = window.firebase.database();
    window.__gameDbInstance = database;
    window.db = database;
    return database;
  }

  throw new Error('Firebase database instance is not available');
}

export async function initModules() {
  console.log('DEBUG: MainDispatcher.initModules() started');
  const db = await resolveDbInstance();
  syncFirebaseGlobals(db);
  const currentUserId = window.__gameCurrentUserId ?? window.currentUserId ?? null;
  console.log('DEBUG: Firebase ready, starting modules with ID:', currentUserId);

  for (const moduleApi of REGISTERED_MODULES) {
    if (moduleApi && typeof moduleApi.init === 'function') {
      console.log(`DEBUG: Initializing module ${moduleApi.init.name || 'anonymous'}`);
      await moduleApi.init(db);
    }
  }

  console.log('DEBUG: MainDispatcher.initModules() completed');
}

function bootstrapModules() {
  initModules().catch((err) => {
    console.error('MainDispatcher: failed to initialize modules:', err);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapModules, { once: true });
} else {
  bootstrapModules();
}

window.MainDispatcher = { initModules };
