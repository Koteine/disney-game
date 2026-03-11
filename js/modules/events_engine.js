export function isAdmin() {
  return Number(window.currentUserId) === Number(window.ADMIN_ID);
}

export async function ensureDbReady(dbInstance) {
  if (dbInstance) {
    window.db = dbInstance;
    return dbInstance;
  }
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

let schedulerStarted = false;
let tickHandle = null;
let serverOffsetRef = null;
let eventSchedulesRef = null;
let legacyEventSchedulesRef = null;
let plannedEvents = [];
let serverOffsetMs = 0;
let activeDb = null;

const EVENT_SCHEDULES_PATH = 'event_schedules';
const LEGACY_EVENT_SCHEDULES_PATH = 'scheduled_events';

function getNowMs() {
  const firebaseAlignedMs = Date.now() + (Number(serverOffsetMs) || 0);
  return new Date(firebaseAlignedMs).getTime();
}

function toEventTimeMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();

  if (typeof value === 'string') {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber;

    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }

  return 0;
}

function normalizePlannedEvent(row, key) {
  const event = row && typeof row === 'object' ? row : {};
  return {
    key,
    type: String(event.type || event.id || 'epic_paint'),
    startAt: toEventTimeMs(event.startAt),
    durationMins: Math.max(1, Number(event.durationMins) || 10),
    status: String(event.status || 'scheduled')
  };
}

function syncPlannedEventsCache(items) {
  plannedEvents = items
    .filter((event) => event && event.key)
    .sort((a, b) => (a.startAt || 0) - (b.startAt || 0));
}

async function activatePlannedEventIfDue(db) {
  if (!db || !plannedEvents.length) return;

  const dueEvent = plannedEvents
    .filter((event) => event.status === 'scheduled' && (event.startAt || 0) <= getNowMs())
    .sort((a, b) => (a.startAt || 0) - (b.startAt || 0))[0];

  if (!dueEvent?.key) return;

  const tx = await db.ref(`${EVENT_SCHEDULES_PATH}/${dueEvent.key}`).transaction((event) => {
    if (!event || event.status !== 'scheduled') return event;
    if (Number(event.startAt || 0) > getNowMs()) return event;
    return {
      ...event,
      status: 'active',
      activatedAt: Date.now()
    };
  });

  if (!tx.committed) return;

  try {
    if (dueEvent.type === 'mushu_feast') {
      const durationMs = dueEvent.durationMins * 60 * 1000;
      await db.ref('mushu_event').update({
        status: 'active',
        startedAt: Date.now(),
        endAt: Date.now() + durationMs,
        durationMs
      });
    } else if (typeof window.adminLaunchEpicPaintEvent === 'function') {
      await window.adminLaunchEpicPaintEvent(dueEvent.durationMins);
    }

    await db.ref(`${EVENT_SCHEDULES_PATH}/${dueEvent.key}`).update({
      status: 'completed',
      completedAt: Date.now()
    });
  } catch (err) {
    console.error('Failed to activate planned event:', err);
    await db.ref(`${EVENT_SCHEDULES_PATH}/${dueEvent.key}`).update({
      status: 'scheduled',
      startError: String(err?.message || err || 'unknown_error'),
      startErrorAt: Date.now()
    });
  }
}

async function runEventTickOnce(dbInstance) {
  const db = await ensureDbReady(dbInstance || activeDb || window.db);

  if (!db || !plannedEvents.length) return;

  let hasDueEvents = true;
  while (hasDueEvents) {
    const dueEvent = plannedEvents
      .filter((event) => event.status === 'scheduled' && (event.startAt || 0) <= getNowMs())
      .sort((a, b) => (a.startAt || 0) - (b.startAt || 0))[0];

    if (!dueEvent) {
      hasDueEvents = false;
      break;
    }

    await activatePlannedEventIfDue(db);
  }
}

function startTickLoop(db) {
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = setInterval(() => {
    runEventTickOnce(db).catch((err) => {
      console.error('Planned event tick failed:', err);
    });
  }, 15000);
}

function subscribePlannedEvents(db) {
  const primary = new Map();
  const legacy = new Map();

  const rebuildCache = () => {
    syncPlannedEventsCache([...primary.values(), ...legacy.values()]);
  };

  const syncSnapshot = (snap, targetMap) => {
    targetMap.clear();
    snap.forEach((row) => {
      targetMap.set(row.key, normalizePlannedEvent(row.val(), row.key));
    });
    rebuildCache();
  };

  if (eventSchedulesRef) eventSchedulesRef.off();
  if (legacyEventSchedulesRef) legacyEventSchedulesRef.off();

  eventSchedulesRef = db.ref(EVENT_SCHEDULES_PATH);
  eventSchedulesRef.on('value', (snap) => syncSnapshot(snap, primary));

  legacyEventSchedulesRef = db.ref(LEGACY_EVENT_SCHEDULES_PATH);
  legacyEventSchedulesRef.on('value', (snap) => syncSnapshot(snap, legacy));
}

function subscribeServerTimeOffset(db) {
  if (serverOffsetRef) serverOffsetRef.off();
  serverOffsetRef = db.ref('.info/serverTimeOffset');
  serverOffsetRef.on('value', (snap) => {
    serverOffsetMs = Number(snap.val()) || 0;
  });
}

async function adminDeleteScheduledEvent(eventKey, dbInstance) {
  if (!isAdmin() || !eventKey) return;
  const db = await ensureDbReady(dbInstance || activeDb || window.db);

  const cancelInPath = async (path) => {
    const result = await db.ref(`${path}/${eventKey}`).transaction((event) => {
      if (!event || event.status !== 'scheduled') return event;
      return {
        ...event,
        status: 'cancelled',
        cancelledAt: Date.now(),
        cancelledBy: window.currentUserId
      };
    });
    return result?.committed;
  };

  const committedPrimary = await cancelInPath(EVENT_SCHEDULES_PATH);
  if (!committedPrimary) {
    await cancelInPath(LEGACY_EVENT_SCHEDULES_PATH);
  }
}

function wireDeleteQueueButtons() {
  if (window.__eventsEngineDeleteQueueBound) return;
  window.__eventsEngineDeleteQueueBound = true;

  window.adminDeleteScheduledEvent = adminDeleteScheduledEvent;

  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-delete-scheduled-event]');
    if (!button) return;
    const eventKey = String(button.dataset.deleteScheduledEvent || '').trim();
    if (!eventKey) return;
    adminDeleteScheduledEvent(eventKey).catch((err) => {
      console.error('Failed to delete scheduled event:', err);
    });
  });
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
      await ensureDbReady(window.db);
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

export async function initEventsEngine(dbInstance) {
  console.log('DEBUG: Module EventsEngine received DB object:', !!dbInstance);
  const db = await ensureDbReady(dbInstance);
  activeDb = db;
  const resolvedCurrentUserId = window.__gameCurrentUserId ?? window.currentUserId ?? null;
  window.currentUserId = resolvedCurrentUserId;
  console.log('DEBUG: EventsEngine currentUserId:', resolvedCurrentUserId);

  if (typeof window.initEventSystem === 'function') {
    await window.initEventSystem();
  }

  wireAdminEventButton();
  wireDeleteQueueButtons();

  if (!schedulerStarted) {
    subscribeServerTimeOffset(db);
    subscribePlannedEvents(db);
    startTickLoop(db);
    schedulerStarted = true;
  }

  await runEventTickOnce(db);
}

export const EventsEngineModule = {
  init: initEventsEngine,
  wireAdminEventButton,
  deleteScheduledEvent: adminDeleteScheduledEvent,
  tickDueEvents: runEventTickOnce
};
window.EventsEngineModule = EventsEngineModule;
