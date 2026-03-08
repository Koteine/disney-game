(function () {
  const EVENT_PATH = 'current_event';
  const EVENT_TYPE = 'paint';
  const STATUS_ACTIVE = 'active';
  const STATUS_IDLE = 'idle';
  const TARGET_PERCENT = 95;
  const BRUSH_SIZE = 20;

  let eventRef = null;
  let strokesRef = null;
  let timerHandle = null;
  let progressHandle = null;
  let isFinishing = false;
  let firstStrokeSent = false;

  let state = { status: STATUS_IDLE, type: EVENT_TYPE, end_timestamp: 0, progress: 0, participants: {} };
  let strokeMap = {};
  let drawing = false;
  let lastPoint = { x: 0, y: 0 };

  const $ = (id) => document.getElementById(id);

  async function getDbReady() {
    if (window.db && typeof window.db.ref === 'function') return window.db;
    if (typeof window.waitForDbReady === 'function') return window.waitForDbReady();
    throw new Error('Firebase db not ready');
  }

  function getCanvas() { return $('event-canvas'); }
  function getCtx() { return getCanvas()?.getContext('2d'); }
  function getUserId() { return String(window.currentUserId || '').trim(); }

  function normalizeEvent(v) {
    const e = v || {};
    return {
      status: String(e.status || e.event_status || STATUS_IDLE),
      type: String(e.type || EVENT_TYPE),
      end_timestamp: Number(e.end_timestamp || 0),
      progress: Number(e.progress?.percent ?? e.progress ?? 0),
      participants: e.participants || {}
    };
  }

  function formatTimer(ts) {
    const left = Math.max(0, Number(ts || 0) - Date.now());
    const sec = Math.floor(left / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function showNotification() {
    const box = $('event-notification');
    if (!box) return;

    if (state.status === STATUS_ACTIVE && state.type === EVENT_TYPE) {
      box.style.display = 'block';
      box.classList.add('event-notification-pink');
      box.innerHTML = `
        <div class="event-notification-text">✨🎨 ✨ Внимание! Начался ивент: Эпичный раскрас! Присоединяйся и получи билетики! 🎫</div>
        <button id="btn-join-event" class="event-notification-join">Присоединиться</button>
      `;
      const join = $('btn-join-event');
      if (join) join.onclick = () => openEventOverlay();
    } else {
      box.style.display = 'none';
      box.classList.remove('event-notification-pink');
      box.innerHTML = '';
    }
  }

  function updateOverlayUi() {
    const timer = $('event-timer');
    const title = $('event-space-title');
    const progress = $('paint-progress');

    if (title) title.textContent = 'Эпичный раскрас';
    if (timer) timer.textContent = state.status === STATUS_ACTIVE ? formatTimer(state.end_timestamp) : '00:00';
    if (progress) progress.textContent = `Закрашено: ${Number(state.progress || 0).toFixed(1)}%`;
  }

  function resizeCanvasToViewport() {
    const canvas = getCanvas();
    if (!canvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(320, window.innerWidth);
    const height = Math.max(420, window.innerHeight - 120);

    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    redrawStrokes();
  }

  function openEventOverlay() {
    const overlay = $('event-overlay');
    if (overlay) overlay.style.display = 'flex';
    document.body.classList.add('event-mode');
    resizeCanvasToViewport();
    redrawStrokes();
  }

  function closeEventOverlay() {
    const overlay = $('event-overlay');
    if (overlay) overlay.style.display = 'none';
    document.body.classList.remove('event-mode');
  }

  function getPointerPos(evt) {
    const canvas = getCanvas();
    const rect = canvas.getBoundingClientRect();
    const touch = evt.touches?.[0] || evt.changedTouches?.[0];
    const cx = touch ? touch.clientX : evt.clientX;
    const cy = touch ? touch.clientY : evt.clientY;
    return {
      x: ((cx - rect.left) / rect.width) * canvas.width,
      y: ((cy - rect.top) / rect.height) * canvas.height
    };
  }

  async function registerParticipantOnFirstDraw() {
    const uid = getUserId();
    if (!uid || firstStrokeSent) return;
    firstStrokeSent = true;

    try {
      const db = await getDbReady();
      await db.ref(`${EVENT_PATH}/participants/${uid}`).set(true);
    } catch (e) {
      console.error('Не удалось записать участника:', e);
    }
  }

  async function startDrawing(evt) {
    if (state.status !== STATUS_ACTIVE) return;
    evt.preventDefault();
    const p = getPointerPos(evt);
    drawing = true;
    lastPoint = p;
    await registerParticipantOnFirstDraw();
    await pushStroke(p.x, p.y, p.x, p.y);
  }

  async function draw(evt) {
    if (!drawing || state.status !== STATUS_ACTIVE) return;
    evt.preventDefault();
    const p = getPointerPos(evt);
    await pushStroke(lastPoint.x, lastPoint.y, p.x, p.y);
    lastPoint = p;
  }

  function stopDrawing() {
    drawing = false;
  }

  function bindCanvasEvents() {
    const canvas = getCanvas();
    if (!canvas || canvas.dataset.bound === '1') return;
    canvas.dataset.bound = '1';

    canvas.addEventListener('touchstart', startDrawing, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDrawing);
    canvas.addEventListener('touchcancel', stopDrawing);

    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseleave', stopDrawing);
  }

  async function pushStroke(x1, y1, x2, y2) {
    if (!strokesRef) return;
    await strokesRef.push({ x1, y1, x2, y2, size: BRUSH_SIZE, color: '#ff4fa3', at: Date.now(), uid: getUserId() });
  }

  function redrawStrokes() {
    const canvas = getCanvas();
    const ctx = getCtx();
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    Object.values(strokeMap).forEach((s) => {
      ctx.beginPath();
      ctx.lineCap = 'round';
      ctx.lineWidth = Number(s.size) || BRUSH_SIZE;
      ctx.strokeStyle = s.color || '#ff4fa3';
      ctx.moveTo(Number(s.x1) || 0, Number(s.y1) || 0);
      ctx.lineTo(Number(s.x2) || 0, Number(s.y2) || 0);
      ctx.stroke();
    });
  }

  function calculateProgressPercent() {
    const canvas = getCanvas();
    const ctx = getCtx();
    if (!canvas || !ctx) return 0;

    const step = 5;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let total = 0;
    let painted = 0;

    for (let y = 0; y < canvas.height; y += step) {
      for (let x = 0; x < canvas.width; x += step) {
        total += 1;
        const i = (y * canvas.width + x) * 4;
        const alpha = img[i + 3];
        if (alpha > 0) painted += 1;
      }
    }

    return total ? (painted / total) * 100 : 0;
  }

  async function finalizeRewardsAndCleanup() {
    if (isFinishing) return;
    isFinishing = true;
    try {
      const db = await getDbReady();
      const snap = await db.ref(EVENT_PATH).once('value');
      const eventData = snap.val() || {};
      const participants = Object.keys(eventData.participants || {});

      for (const uid of participants) {
        if (typeof window.createTicket === 'function') {
          await window.createTicket(uid, 2, 'Ивент: Эпичный раскрас');
        }
      }

      await db.ref(EVENT_PATH).remove();

      if (!participants.length && typeof window.postNews === 'function') {
        await window.postNews('Ивент завершен, никто не участвовал');
      }
    } catch (e) {
      console.error('Ошибка завершения ивента:', e);
    } finally {
      isFinishing = false;
    }
  }

  async function syncProgressLoop() {
    if (state.status !== STATUS_ACTIVE) return;
    try {
      const db = await getDbReady();
      const percent = Number(calculateProgressPercent().toFixed(2));
      state.progress = percent;
      updateOverlayUi();
      await db.ref(`${EVENT_PATH}/progress`).set({ percent, updated_at: Date.now() });
      if (percent >= TARGET_PERCENT) {
        await finalizeRewardsAndCleanup();
      }
    } catch (e) {
      console.error('Ошибка синхронизации прогресса:', e);
    }
  }

  async function attachRealtimeListeners() {
    const db = await getDbReady();

    if (eventRef) eventRef.off();
    if (strokesRef) strokesRef.off();

    eventRef = db.ref(EVENT_PATH);
    eventRef.on('value', (snap) => {
      const prev = state.status;
      state = normalizeEvent(snap.val());
      if (prev !== STATUS_ACTIVE && state.status === STATUS_ACTIVE) firstStrokeSent = false;
      showNotification();
      updateOverlayUi();
    });

    strokesRef = db.ref(`${EVENT_PATH}/strokes`);
    strokesRef.on('value', (snap) => {
      strokeMap = snap.val() || {};
      redrawStrokes();
    });
  }

  async function initEventSystem() {
    try {
      await getDbReady();
      bindCanvasEvents();
      resizeCanvasToViewport();
      await attachRealtimeListeners();

      const exit = $('btn-exit-event');
      if (exit && exit.dataset.bound !== '1') {
        exit.dataset.bound = '1';
        exit.onclick = () => closeEventOverlay();
      }

      if (timerHandle) clearInterval(timerHandle);
      timerHandle = setInterval(() => {
        updateOverlayUi();
      }, 1000);

      if (progressHandle) clearInterval(progressHandle);
      progressHandle = setInterval(syncProgressLoop, 5000);

      window.addEventListener('resize', resizeCanvasToViewport);
      window.addEventListener('orientationchange', resizeCanvasToViewport);
    } catch (e) {
      console.error('initEventSystem failed:', e);
    }
  }

  async function adminLaunchEpicPaintEvent(durationMins = 10) {
    try {
      const db = await getDbReady();
      if (Number(window.currentUserId) !== Number(window.ADMIN_ID)) return;
      const mins = Math.max(1, Number(durationMins) || 10);
      await db.ref(EVENT_PATH).set({
        type: EVENT_TYPE,
        status: STATUS_ACTIVE,
        end_timestamp: Date.now() + mins * 60000,
        participants: {},
        strokes: {},
        progress: { percent: 0 }
      });
    } catch (e) {
      console.error('adminLaunchEpicPaintEvent failed:', e);
    }
  }

  // exports / compatibility
  window.initEventSystem = initEventSystem;
  window.syncGameEvents = initEventSystem;
  window.setupEpicPaintCanvas = bindCanvasEvents;
  window.openEventOverlay = openEventOverlay;
  window.closeEventOverlay = closeEventOverlay;
  window.openEventSpace = openEventOverlay;
  window.backToGameFromEvent = closeEventOverlay;
  window.startDrawing = startDrawing;
  window.draw = draw;
  window.stopDrawing = stopDrawing;
  window.adminLaunchEpicPaintEvent = adminLaunchEpicPaintEvent;
  window.adminScheduleEvent = adminLaunchEpicPaintEvent;

  window.activateScheduledEventIfNeeded = async function () {};
  window.maybeFinalizeCompletedEventByEndTime = async function () {};
  window.failExpiredEventIfNeeded = async function () {};
  window.dismissEpicPaintStartAlert = async function () { openEventOverlay(); };
  window.chooseRoundInsteadOfEvent = function () { closeEventOverlay(); };
})();
