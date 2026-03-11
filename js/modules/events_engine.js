export function isAdmin() {
  return Number(window.currentUserId) === Number(window.ADMIN_ID);
}

export async function ensureDbReady() {
  if (typeof window.waitForDbReady === 'function') {
    return window.waitForDbReady();
  }
  if (window.db) return window.db;
  throw new Error('Database connection is not ready');
}

export function resolveEventLauncher() {
  return (
    window.adminScheduleEpicPaintEvent ||
    window.adminLaunchEpicPaintEvent ||
    window.adminScheduleEvent
  );
}

export function wireAdminEventButton() {
  const btn = document.getElementById('admin-schedule-event-btn');
  if (!btn || btn.dataset.eventButtonWired === '1') return;

  btn.disabled = false;
  btn.removeAttribute('disabled');
  btn.dataset.eventButtonWired = '1';

  btn.addEventListener('click', async (ev) => {
    ev?.preventDefault?.();

    if (!isAdmin()) return;

    try {
      await ensureDbReady();
      const run = resolveEventLauncher();
      if (typeof run !== 'function') {
        throw new Error('Event launcher is not available');
      }
      await run();
    } catch (err) {
      console.error('Failed to run admin event action:', err);
    }
  });
}

export function initEventsEngine() {
  if (typeof window.initEventSystem === 'function') {
    window.initEventSystem().catch((err) => console.error('initEventSystem failed:', err));
  }

  wireAdminEventButton();
}

export const EventsEngineModule = { init: initEventsEngine, wireAdminEventButton };
window.EventsEngineModule = EventsEngineModule;
