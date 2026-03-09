(function () {
  const EVENT_PATH = 'current_event';
  const EVENT_TYPE = 'paint';
  const ACTIVE_STATUS = 'active';
  const FINISHED_STATUS = 'finished';
  const BRUSH_SIZE = 20;
  const TARGET_PERCENT = 95;

  const WORLD_WIDTH = 900;
  const WORLD_HEIGHT = 1500;

  let eventRef = null;
  let timerHandle = null;
  let state = { status: 'idle', type: EVENT_TYPE, endTime: 0, progress: 0, participants: {} };
  let drawing = false;
  let lastPoint = { x: 0, y: 0 };
  let finishing = false;
  let myColor = null;

  const $ = (id) => document.getElementById(id);

  async function getDbReady() {
    if (window.db && typeof window.db.ref === 'function') return window.db;
    if (typeof window.waitForDbReady === 'function') return window.waitForDbReady();
    throw new Error('Firebase db not ready');
  }

  function getCanvas() { return $('event-canvas'); }
  function getCtx() { return getCanvas()?.getContext('2d'); }
  function getUserId() { return String(window.currentUserId || '').trim(); }

  function normalizeEvent(raw) {
    const e = raw || {};
    return {
      status: String(e.status || 'idle'),
      type: String(e.type || EVENT_TYPE),
      endTime: Number(e.endTime || 0),
      progress: Number(e.progress || 0),
      participants: e.participants || {},
      canvas_data: e.canvas_data || ''
    };
  }

  function formatLeft(ms) {
    const left = Math.max(0, Math.floor(ms / 1000));
    const mm = String(Math.floor(left / 60)).padStart(2, '0');
    const ss = String(left % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function updateTimer() {
    const timerEl = $('event-timer');
    if (!timerEl) return;
    if (state.status !== ACTIVE_STATUS || state.type !== EVENT_TYPE || !state.endTime) {
      timerEl.textContent = '00:00';
      return;
    }
    const leftMs = Number(state.endTime) - Date.now();
    timerEl.textContent = formatLeft(leftMs);
    if (leftMs <= 0) finalizeEventWithRewards().catch(() => {});
  }

  function updateOverlayUi() {
    const titleEl = $('event-space-title');
    const progressEl = $('paint-progress');
    if (titleEl) titleEl.textContent = 'Эпичный раскрас';
    updateTimer();
    if (progressEl) {
      progressEl.textContent = `Закрашено: ${Number(state.progress || 0).toFixed(1)}%`;
      progressEl.classList.toggle('paint-progress-win', Number(state.progress || 0) >= TARGET_PERCENT);
    }
  }

  function resizeCanvasToViewport() {
    const canvas = getCanvas();
    if (!canvas) return;
    canvas.style.width = `${Math.max(320, window.innerWidth)}px`;
    canvas.style.height = `${Math.max(420, window.innerHeight - 120)}px`;
    canvas.width = WORLD_WIDTH;
    canvas.height = WORLD_HEIGHT;
  }

  function openEventOverlay() {
    const overlay = $('event-overlay');
    if (overlay) overlay.style.display = 'flex';
    document.body.classList.add('event-mode');
    resizeCanvasToViewport();
  }

  function closeEventOverlay() {
    const overlay = $('event-overlay');
    if (overlay) overlay.style.display = 'none';
    document.body.classList.remove('event-mode');
  }

  function randomColorForUser(uid) {
    const n = (uid || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return `hsl(${(n * 57) % 360}, 85%, 55%)`;
  }

  async function ensureMyColor() {
    if (myColor) return myColor;
    const uid = getUserId();
    if (!uid) return '#ff4fa3';
    const db = await getDbReady();
    const ref = db.ref(`${EVENT_PATH}/colors/${uid}`);
    const snap = await ref.once('value');
    if (snap.exists()) {
      myColor = String(snap.val());
      return myColor;
    }
    const c = randomColorForUser(uid);
    await ref.set(c);
    myColor = c;
    return c;
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
    const uid = getUserId();
    if (!uid) return;
    const db = await getDbReady();
    await db.ref(`${EVENT_PATH}/participants/${uid}`).set(true);
  }

  async function persistCanvasState() {
    const canvas = getCanvas();
    if (!canvas) return;
    const db = await getDbReady();
    const data = canvas.toDataURL('image/png');
    await db.ref(`${EVENT_PATH}/canvas_data`).set(data);
  }

  function drawLine(x1, y1, x2, y2, color) {
    const ctx = getCtx();
    if (!ctx) return;
    ctx.beginPath();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = BRUSH_SIZE;
    ctx.strokeStyle = color || '#ff4fa3';
    if (Math.abs(x1 - x2) < 0.001 && Math.abs(y1 - y2) < 0.001) {
      ctx.fillStyle = color || '#ff4fa3';
      ctx.arc(x1, y1, BRUSH_SIZE / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
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

  async function syncProgressAndMaybeFinish() {
    if (state.status !== ACTIVE_STATUS || state.type !== EVENT_TYPE) return;
    const db = await getDbReady();
    const percent = Number(computeProgressPercent().toFixed(2));
    state.progress = percent;
    updateOverlayUi();
    await db.ref(`${EVENT_PATH}/progress`).set(percent);
    if (percent >= TARGET_PERCENT) await finalizeEventWithRewards();
  }

  async function startDrawing(evt) {
    if (state.status !== ACTIVE_STATUS || finishing) return;
    evt.preventDefault();
    drawing = true;
    lastPoint = toWorldPoint(evt);
    await registerParticipant();
    const color = await ensureMyColor();
    drawLine(lastPoint.x, lastPoint.y, lastPoint.x, lastPoint.y, color);
    await persistCanvasState();
    await syncProgressAndMaybeFinish();
  }

  async function draw(evt) {
    if (!drawing || state.status !== ACTIVE_STATUS || finishing) return;
    evt.preventDefault();
    const p = toWorldPoint(evt);
    const from = lastPoint;
    lastPoint = p;
    const color = await ensureMyColor();
    drawLine(from.x, from.y, p.x, p.y, color);
    await persistCanvasState();
    await syncProgressAndMaybeFinish();
  }

  function stopDrawing() { drawing = false; }

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

  function showNotification() {
    const box = $('event-notification');
    if (!box) return;
    if (state.status === ACTIVE_STATUS && state.type === EVENT_TYPE) {
      box.style.display = 'block';
      box.classList.add('event-notification-pink');
      box.innerHTML = '<div class="event-notification-text">✨🎨 Начался ивент: Эпичный раскрас!</div><button id="btn-join-event" class="event-notification-join">Присоединиться</button>';
      const btn = $('btn-join-event');
      if (btn) btn.onclick = () => openEventOverlay();
      return;
    }
    box.style.display = 'none';
    box.classList.remove('event-notification-pink');
    box.innerHTML = '';
  }

  async function rewardAllParticipants() {
    const db = await getDbReady();
    const tx = await db.ref(`${EVENT_PATH}/status`).transaction((v) => {
      if (String(v || '') === FINISHED_STATUS) return;
      return FINISHED_STATUS;
    });
    if (!tx.committed) return;

    const participantsSnap = await db.ref(`${EVENT_PATH}/participants`).once('value');
    const participants = participantsSnap.val() || {};
    for (const uid of Object.keys(participants)) {
      try {
        await window.createTicket(uid, 2, 'Ивент');
      } catch (e) {
        console.error('Ticket reward failed for user:', uid, e);
      }
    }
  }

  async function finalizeEventWithRewards() {
    if (finishing) return;
    finishing = true;
    try {
      await rewardAllParticipants();
    } finally {
      finishing = false;
    }
  }

  function applyCanvasData(dataUrl) {
    const canvas = getCanvas();
    const ctx = getCtx();
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!dataUrl) return;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = dataUrl;
  }

  async function attachListeners() {
    const db = await getDbReady();
    if (eventRef) eventRef.off();

    eventRef = db.ref(EVENT_PATH);
    eventRef.on('value', (snap) => {
      state = normalizeEvent(snap.val());
      showNotification();
      updateOverlayUi();
    });

    db.ref(`${EVENT_PATH}/canvas_data`).on('value', (snap) => {
      applyCanvasData(snap.val() || '');
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
      timerHandle = setInterval(() => {
        updateTimer();
      }, 1000);

      window.addEventListener('resize', resizeCanvasToViewport);
      window.addEventListener('orientationchange', resizeCanvasToViewport);
    } catch (err) {
      console.error('initEventSystem failed:', err);
    }
  }

  async function adminLaunchEpicPaintEvent() {
    try {
      const db = await getDbReady();
      if (Number(window.currentUserId) !== Number(window.ADMIN_ID)) return;
      await db.ref(EVENT_PATH).set({
        status: ACTIVE_STATUS,
        type: EVENT_TYPE,
        endTime: Date.now() + 600000
      });
    } catch (err) {
      console.error('adminLaunchEpicPaintEvent failed:', err);
    }
  }

  window.initEventSystem = initEventSystem;
  window.syncGameEvents = initEventSystem;
  window.initEvents = initEventSystem;
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
})();
