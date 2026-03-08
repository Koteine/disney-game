(function () {
  const EVENT_PATH = 'current_event';
  const EVENT_TYPE = 'paint';
  const STATUS_ACTIVE = 'active';
  const STATUS_IDLE = 'idle';
  const TARGET_PERCENT = 95;
  const BRUSH_SIZE = 20;

  // Общий «канонический» холст одинакового размера для всех клиентов
  const WORLD_WIDTH = 900;
  const WORLD_HEIGHT = 1500;

  let eventRef = null;
  let strokesRef = null;
  let progressRef = null;
  let timerHandle = null;
  let progressHandle = null;
  let finishing = false;

  let state = {
    status: STATUS_IDLE,
    type: EVENT_TYPE,
    end_timestamp: 0,
    progress: 0,
    participants: {},
    colors: {}
  };

  let strokeMap = {};
  let drawing = false;
  let lastPoint = { x: 0, y: 0 };
  let myColor = null;
  let participantMarked = false;

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
      participants: e.participants || {},
      colors: e.colors || {}
    };
  }

  function formatTimer(ts) {
    const left = Math.max(0, Number(ts || 0) - Date.now());
    const sec = Math.floor(left / 1000);
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  }

  function randomColorForUser(uid) {
    const n = (uid || '').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const hue = (n * 57) % 360;
    return `hsl(${hue}, 85%, 55%)`;
  }

  async function ensureMyColor() {
    const uid = getUserId();
    if (!uid) return '#ff4fa3';
    if (myColor) return myColor;
    if (state.colors && state.colors[uid]) {
      myColor = state.colors[uid];
      return myColor;
    }

    const db = await getDbReady();
    const colorRef = db.ref(`${EVENT_PATH}/colors/${uid}`);
    const snap = await colorRef.once('value');
    if (snap.exists()) {
      myColor = String(snap.val());
      return myColor;
    }
    const generated = randomColorForUser(uid);
    await colorRef.set(generated);
    myColor = generated;
    return generated;
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
      const joinBtn = $('btn-join-event');
      if (joinBtn) joinBtn.onclick = () => openEventOverlay();
    } else {
      box.style.display = 'none';
      box.classList.remove('event-notification-pink');
      box.innerHTML = '';
    }
  }

  function clearEventUi() {
    state = {
      status: STATUS_IDLE,
      type: EVENT_TYPE,
      end_timestamp: 0,
      progress: 0,
      participants: {},
      colors: {}
    };
    participantMarked = false;
    showNotification();
    updateOverlayUi();
    closeEventOverlay();
  }

  function updateOverlayUi() {
    const timerEl = $('event-timer');
    const titleEl = $('event-space-title');
    const progressEl = $('paint-progress');

    if (titleEl) titleEl.textContent = 'Эпичный раскрас';
    if (timerEl) timerEl.textContent = state.status === STATUS_ACTIVE ? formatTimer(state.end_timestamp) : '00:00';
    if (progressEl) progressEl.textContent = `Закрашено: ${Number(state.progress || 0).toFixed(1)}%`;
  }

  function resizeCanvasToViewport() {
    const canvas = getCanvas();
    if (!canvas) return;

    const width = Math.max(320, window.innerWidth);
    const height = Math.max(420, window.innerHeight - 120);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    // внутренний размер фиксирован для всех клиентов => одинаковая геометрия/прогресс
    canvas.width = WORLD_WIDTH;
    canvas.height = WORLD_HEIGHT;
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

  function toWorldPoint(evt) {
    const canvas = getCanvas();
    const rect = canvas.getBoundingClientRect();
    const touch = evt.touches?.[0] || evt.changedTouches?.[0];
    const cx = touch ? touch.clientX : evt.clientX;
    const cy = touch ? touch.clientY : evt.clientY;
    return {
      x: ((cx - rect.left) / rect.width) * WORLD_WIDTH,
      y: ((cy - rect.top) / rect.height) * WORLD_HEIGHT
    };
  }

  async function registerParticipant() {
    const myId = localStorage.getItem('userId');
    if (!myId || participantMarked) return;
    participantMarked = true;
    const db = await getDbReady();
    await db.ref('current_event/participants/' + myId).set(true);
  }

  async function startDrawing(evt) {
    if (state.status !== STATUS_ACTIVE) return;
    evt.preventDefault();
    const p = toWorldPoint(evt);
    drawing = true;
    lastPoint = p;
    registerParticipant().catch(() => {});
    const color = await ensureMyColor();
    pushStroke(p.x, p.y, p.x, p.y, color).catch(() => {});
  }

  async function draw(evt) {
    if (!drawing || state.status !== STATUS_ACTIVE) return;
    evt.preventDefault();
    const p = toWorldPoint(evt);
    const from = lastPoint;
    lastPoint = p;
    const color = await ensureMyColor();
    pushStroke(from.x, from.y, p.x, p.y, color).catch(() => {});
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

  async function pushStroke(x1, y1, x2, y2, color) {
    if (!strokesRef) return;
    await strokesRef.push({ x1, y1, x2, y2, size: BRUSH_SIZE, color: color || '#ff4fa3', uid: getUserId(), at: Date.now() });
  }

  function redrawStrokes() {
    const canvas = getCanvas();
    const ctx = getCtx();
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    Object.values(strokeMap).forEach((s) => {
      ctx.beginPath();
      const x1 = Number(s.x1) || 0;
      const y1 = Number(s.y1) || 0;
      const x2 = Number(s.x2) || 0;
      const y2 = Number(s.y2) || 0;
      const size = Number(s.size) || BRUSH_SIZE;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = size;
      ctx.strokeStyle = s.color || '#ff4fa3';
      if (Math.abs(x1 - x2) < 0.001 && Math.abs(y1 - y2) < 0.001) {
        ctx.beginPath();
        ctx.fillStyle = s.color || '#ff4fa3';
        ctx.arc(x1, y1, size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    });
  }

  function computeProgressPercent() {
    const canvas = getCanvas();
    const ctx = getCtx();
    if (!canvas || !ctx) return 0;

    const step = 4;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let total = 0;
    let painted = 0;

    for (let y = 0; y < canvas.height; y += step) {
      for (let x = 0; x < canvas.width; x += step) {
        total += 1;
        const i = (y * canvas.width + x) * 4;
        if (img[i + 3] > 0) painted += 1;
      }
    }

    return total ? (painted / total) * 100 : 0;
  }

  async function rewardAllParticipants() {
    const db = await getDbReady();
    const snapshot = await db.ref('current_event/participants').once('value');
    const participants = snapshot.val();
    if (!participants) {
      console.log('Участников нет, награда не выдана');
      return;
    }

    for (const userId in participants) {
      console.log('Выдаю награду участнику:', userId);
      await window.createTicket(userId, 2, 'Победа в Эпичном раскрасе');
    }

    await db.ref('current_event').remove();
    clearEventUi();
    alert('Ивент завершен! Награды отправлены участникам.');
  }

  async function finalizeEventWithRewards() {
    if (finishing) return;
    finishing = true;
    try {
      await rewardAllParticipants();
    } catch (err) {
      console.error('Ошибка завершения ивента:', err);
    } finally {
      finishing = false;
    }
  }

  async function syncProgressAndCheckFinish() {
    if (state.status !== STATUS_ACTIVE || state.type !== EVENT_TYPE) return;
    try {
      const db = await getDbReady();
      const percent = Number(computeProgressPercent().toFixed(2));
      const visiblePercent = Number(percent.toFixed(1));
      state.progress = percent;
      updateOverlayUi();
      await db.ref(`${EVENT_PATH}/progress`).set({ percent, updated_at: Date.now() });

      if (visiblePercent >= TARGET_PERCENT) {
        await finalizeEventWithRewards();
      }
    } catch (err) {
      console.error('Ошибка синхронизации прогресса:', err);
    }
  }

  async function attachListeners() {
    const db = await getDbReady();

    if (eventRef) eventRef.off();
    if (strokesRef) strokesRef.off();
    if (progressRef) progressRef.off();

    eventRef = db.ref(EVENT_PATH);
    eventRef.on('value', (snap) => {
      const prevStatus = state.status;
      state = normalizeEvent(snap.val());
      if (!snap.exists()) {
        clearEventUi();
        return;
      }
      if (prevStatus !== STATUS_ACTIVE && state.status === STATUS_ACTIVE) {
        myColor = null;
        participantMarked = false;
      }
      showNotification();
      updateOverlayUi();
    });

    strokesRef = db.ref(`${EVENT_PATH}/strokes`);
    strokesRef.on('value', (snap) => {
      strokeMap = snap.val() || {};
      redrawStrokes();
    });

    progressRef = db.ref(`${EVENT_PATH}/progress/percent`);
    progressRef.on('value', (snap) => {
      const sharedPercent = Number(snap.val());
      if (Number.isFinite(sharedPercent)) {
        state.progress = sharedPercent;
        updateOverlayUi();
        const visiblePercent = Number(sharedPercent.toFixed(1));
        if (state.status === STATUS_ACTIVE && state.type === EVENT_TYPE && visiblePercent >= TARGET_PERCENT) {
          finalizeEventWithRewards();
        }
      }
    });
  }

  async function initEventSystem() {
    try {
      await getDbReady();
      bindCanvasEvents();
      resizeCanvasToViewport();
      await attachListeners();

      const exitBtn = $('btn-exit-event');
      if (exitBtn && exitBtn.dataset.bound !== '1') {
        exitBtn.dataset.bound = '1';
        exitBtn.onclick = () => closeEventOverlay();
      }

      if (timerHandle) clearInterval(timerHandle);
      timerHandle = setInterval(updateOverlayUi, 1000);

      if (progressHandle) clearInterval(progressHandle);
      progressHandle = setInterval(syncProgressAndCheckFinish, 5000);

      window.addEventListener('resize', resizeCanvasToViewport);
      window.addEventListener('orientationchange', resizeCanvasToViewport);
    } catch (err) {
      console.error('initEventSystem failed:', err);
    }
  }

  function resolveEpicPaintDurationMins(durationMins) {
    const fromArg = Number(durationMins);
    if (Number.isFinite(fromArg) && fromArg >= 1) return Math.max(1, Math.round(fromArg));
    const fromInput = Number(document.getElementById('event-duration-mins')?.value || 0);
    if (Number.isFinite(fromInput) && fromInput >= 1) return Math.max(1, Math.round(fromInput));
    return 10;
  }

  async function adminLaunchEpicPaintEvent(durationMins) {
    try {
      const db = await getDbReady();
      if (Number(window.currentUserId) !== Number(window.ADMIN_ID)) return;
      const mins = resolveEpicPaintDurationMins(durationMins);
      await db.ref(EVENT_PATH).set({
        type: EVENT_TYPE,
        status: STATUS_ACTIVE,
        end_timestamp: Date.now() + mins * 60000,
        participants: {},
        colors: {},
        strokes: {},
        progress: { percent: 0 }
      });
    } catch (err) {
      console.error('adminLaunchEpicPaintEvent failed:', err);
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

  // compatibility no-op
  window.activateScheduledEventIfNeeded = async function () {};
  window.maybeFinalizeCompletedEventByEndTime = async function () {};
  window.failExpiredEventIfNeeded = async function () {};
  window.dismissEpicPaintStartAlert = async function () { openEventOverlay(); };
  window.chooseRoundInsteadOfEvent = function () { closeEventOverlay(); };
})();
