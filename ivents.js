(function () {
    const EVENT_PATH = 'current_event';
    const ACTIVE_STATUS = 'active';
    const IDLE_STATUS = 'idle';
    const COMPLETED_STATUS = 'completed';
    const EVENT_TITLE = 'Эпичный закрас';
    const SUCCESS_TEXT = 'Ивент завершен успешно!';
    const BRUSH_SIZE = 20;
    const TARGET_PERCENT = 95;
    const PROGRESS_STEP = 5;

    let eventState = { status: IDLE_STATUS, type: 'paint', progress: 0, participants: {} };
    let eventRef = null;
    let strokesRef = null;
    let timerInterval = null;

    let drawing = false;
    let lastPoint = { x: 0, y: 0 };
    let strokeMap = {};
    let participantsLocal = [];
    let participantsSet = new Set();
    let firstStrokeSent = false;
    let finishInProgress = false;
    let renderScheduled = false;
    let lastSyncedProgressBucket = -1;

    window.participants = participantsLocal;

    function getEl(id) { return document.getElementById(id); }
    function getCanvas() { return getEl('event-canvas') || getEl('epic-paint-canvas'); }
    function getCanvasCtx() { return getCanvas()?.getContext('2d'); }
    function getUserId() { return String(window.currentUserId || '').trim(); }
    function getDb() { return window.db && typeof window.db.ref === 'function' ? window.db : null; }

    function normalizeState(value) {
        const v = value || {};
        return {
            type: String(v.type || 'paint'),
            status: String(v.status || v.event_status || IDLE_STATUS),
            end_timestamp: Number(v.end_timestamp || 0),
            progress: Number(v.progress?.percent ?? v.progress ?? 0),
            participants: v.participants || {},
            completed_message: String(v.completed_message || '')
        };
    }

    function formatMMSS(endTimestamp) {
        const leftMs = Math.max(0, Number(endTimestamp || 0) - Date.now());
        const totalSec = Math.floor(leftMs / 1000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function renderBanner() {
        const banner = getEl('event-notification') || getEl('event-start-alert');
        if (!banner) return;
        if (eventState.status === ACTIVE_STATUS && eventState.type === 'paint') {
            banner.style.display = 'block';
            banner.innerHTML = `
                <div class="event-title">Начался ивент: Эпичный закрас!</div>
                <div class="event-sub">Прогресс: ${eventState.progress.toFixed(1)}%</div>
                <button id="btn-join-event" class="event-join-btn">Присоединиться</button>
            `;
            const joinBtn = getEl('btn-join-event');
            if (joinBtn) joinBtn.onclick = () => window.openEventOverlay();
        } else {
            banner.style.display = 'none';
            banner.innerHTML = '';
        }
    }

    function renderOverlayHeader() {
        const title = getEl('event-space-title');
        const timer = getEl('event-timer') || getEl('event-space-timer');
        const progress = getEl('paint-progress') || getEl('epic-paint-progress');
        const done = getEl('event-done-message');

        if (title) title.textContent = EVENT_TITLE;
        if (timer) {
            if (eventState.status === ACTIVE_STATUS && eventState.end_timestamp) {
                timer.textContent = formatMMSS(eventState.end_timestamp);
            } else {
                timer.textContent = '00:00';
            }
        }
        if (progress) progress.textContent = `Закрашено: ${eventState.progress.toFixed(1)}%`;
        if (done) {
            const visible = eventState.status === COMPLETED_STATUS;
            done.style.display = visible ? 'block' : 'none';
            done.textContent = visible ? (eventState.completed_message || SUCCESS_TEXT) : '';
        }
    }

    function openEventOverlay() {
        const overlay = getEl('event-overlay');
        if (overlay) overlay.style.display = 'flex';
        document.body.classList.add('event-mode');
        scheduleRender();
    }

    function closeEventOverlay() {
        const overlay = getEl('event-overlay');
        if (overlay) overlay.style.display = 'none';
        document.body.classList.remove('event-mode');
    }

    function setupOverlayButtons() {
        const exitBtn = getEl('btn-exit-event');
        if (exitBtn && !exitBtn.dataset.bound) {
            exitBtn.dataset.bound = '1';
            exitBtn.onclick = () => window.closeEventOverlay();
        }
    }

    function setupCanvasInput() {
        const canvas = getCanvas();
        if (!canvas || canvas.dataset.bound === '1') return;
        canvas.dataset.bound = '1';

        const getPos = (evt) => {
            const rect = canvas.getBoundingClientRect();
            const touch = evt.touches?.[0] || evt.changedTouches?.[0];
            const cx = touch ? touch.clientX : evt.clientX;
            const cy = touch ? touch.clientY : evt.clientY;
            return {
                x: ((cx - rect.left) / rect.width) * canvas.width,
                y: ((cy - rect.top) / rect.height) * canvas.height
            };
        };

        const start = async (evt) => {
            if (eventState.status !== ACTIVE_STATUS) return;
            evt.preventDefault();
            const p = getPos(evt);
            drawing = true;
            lastPoint = p;
            await pushStroke(p.x, p.y, p.x, p.y);
        };

        const move = async (evt) => {
            if (!drawing || eventState.status !== ACTIVE_STATUS) return;
            evt.preventDefault();
            const p = getPos(evt);
            await pushStroke(lastPoint.x, lastPoint.y, p.x, p.y);
            lastPoint = p;
        };

        const end = () => { drawing = false; };

        canvas.addEventListener('mousedown', start);
        canvas.addEventListener('mousemove', move);
        canvas.addEventListener('mouseup', end);
        canvas.addEventListener('mouseleave', end);
        canvas.addEventListener('touchstart', start, { passive: false });
        canvas.addEventListener('touchmove', move, { passive: false });
        canvas.addEventListener('touchend', end);
        canvas.addEventListener('touchcancel', end);
    }

    async function pushStroke(x1, y1, x2, y2) {
        if (!Number.isFinite(x1 + y1 + x2 + y2)) return;
        const db = getDb();
        const uid = getUserId();
        if (!db || !uid || !strokesRef) return;

        if (!firstStrokeSent) {
            firstStrokeSent = true;
            if (!participantsSet.has(uid)) {
                participantsSet.add(uid);
                participantsLocal.push(uid);
                window.participants = participantsLocal;
            }
            await db.ref(`${EVENT_PATH}/participants/${uid}`).set(true);
        }

        await strokesRef.push({ uid, x1, y1, x2, y2, size: BRUSH_SIZE, color: '#ff007f', at: Date.now() });
    }

    function drawStrokes() {
        const canvas = getCanvas();
        const ctx = getCanvasCtx();
        if (!canvas || !ctx) return;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        Object.values(strokeMap).forEach((s) => {
            ctx.beginPath();
            ctx.lineCap = 'round';
            ctx.lineWidth = Number(s.size) || BRUSH_SIZE;
            ctx.strokeStyle = s.color || '#ff007f';
            ctx.moveTo(Number(s.x1) || 0, Number(s.y1) || 0);
            ctx.lineTo(Number(s.x2) || 0, Number(s.y2) || 0);
            ctx.stroke();
        });
    }

    function calcPaintPercent() {
        const canvas = getCanvas();
        const ctx = getCanvasCtx();
        if (!canvas || !ctx) return 0;
        const step = 4;
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let total = 0;
        let painted = 0;

        for (let y = 0; y < canvas.height; y += step) {
            for (let x = 0; x < canvas.width; x += step) {
                total += 1;
                const i = (y * canvas.width + x) * 4;
                const white = data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245;
                if (!white) painted += 1;
            }
        }
        return total ? (painted / total) * 100 : 0;
    }

    async function syncProgressIfNeeded() {
        const db = getDb();
        if (!db || eventState.status !== ACTIVE_STATUS) return;
        const percent = calcPaintPercent();
        const bucket = Math.floor(percent / PROGRESS_STEP);
        if (bucket > lastSyncedProgressBucket) {
            lastSyncedProgressBucket = bucket;
            await db.ref(`${EVENT_PATH}/progress`).set({ percent, updated_at: Date.now() });
        }
        if (percent >= TARGET_PERCENT) await finalizeEvent();
    }

    async function finalizeEvent() {
        if (finishInProgress) return;
        const db = getDb();
        if (!db) return;
        finishInProgress = true;
        try {
            const ref = db.ref(EVENT_PATH);
            const tx = await ref.transaction((eventData) => {
                const st = normalizeState(eventData);
                if (st.status !== ACTIVE_STATUS || st.type !== 'paint') return eventData;
                return {
                    ...(eventData || {}),
                    type: 'paint',
                    status: COMPLETED_STATUS,
                    completed_message: SUCCESS_TEXT,
                    completed_at: Date.now()
                };
            });
            if (!tx.committed) return;

            const snapshot = tx.snapshot.val() || {};
            const participantIds = Object.keys(snapshot.participants || {});
            for (const uid of participantIds) {
                if (typeof window.createTicket === 'function') {
                    await window.createTicket(uid, 2, 'Победа: Эпичный закрас');
                }
            }

            setTimeout(async () => {
                const doneRef = db.ref(EVENT_PATH);
                await doneRef.remove();
                await doneRef.set({ type: 'paint', status: IDLE_STATUS, progress: { percent: 0 } });
                window.closeEventOverlay();
            }, 2000);
        } finally {
            finishInProgress = false;
        }
    }

    function scheduleRender() {
        if (renderScheduled) return;
        renderScheduled = true;
        requestAnimationFrame(async () => {
            renderScheduled = false;
            drawStrokes();
            renderBanner();
            renderOverlayHeader();
            await syncProgressIfNeeded();
        });
    }

    function attachFirebaseListeners() {
        const db = getDb();
        if (!db) return;

        if (eventRef) eventRef.off();
        if (strokesRef) strokesRef.off();

        eventRef = db.ref(EVENT_PATH);
        eventRef.on('value', (snap) => {
            eventState = normalizeState(snap.val());
            if (eventState.status !== ACTIVE_STATUS) {
                firstStrokeSent = false;
                lastSyncedProgressBucket = -1;
            }
            renderBanner();
            renderOverlayHeader();
        });

        strokesRef = db.ref(`${EVENT_PATH}/strokes`);
        strokesRef.on('value', (snap) => {
            strokeMap = snap.val() || {};
            scheduleRender();
        });
    }

    function initEventSystem() {
        setupOverlayButtons();
        setupCanvasInput();
        attachFirebaseListeners();

        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            renderOverlayHeader();
            if (eventState.status === ACTIVE_STATUS && Date.now() > Number(eventState.end_timestamp || 0)) {
                window.closeEventOverlay();
            }
        }, 1000);
    }

    async function adminLaunchEpicPaintEvent() {
        const db = getDb();
        if (!db) return;
        if (Number(window.currentUserId) !== Number(window.ADMIN_ID)) return;
        await db.ref(EVENT_PATH).set({
            type: 'paint',
            status: ACTIVE_STATUS,
            end_timestamp: Date.now() + (10 * 60 * 1000),
            participants: {},
            strokes: {},
            progress: { percent: 0 }
        });
    }

    // Глобальные функции для совместимости с существующим кодом
    window.initEventSystem = initEventSystem;
    window.syncGameEvents = initEventSystem;
    window.setupEpicPaintCanvas = setupCanvasInput;
    window.openEventOverlay = openEventOverlay;
    window.closeEventOverlay = closeEventOverlay;
    window.openEventSpace = openEventOverlay;
    window.backToGameFromEvent = closeEventOverlay;
    window.updateEventUiState = function updateEventUiState() {
        renderBanner();
        renderOverlayHeader();
    };
    window.adminLaunchEpicPaintEvent = adminLaunchEpicPaintEvent;
    window.adminScheduleEvent = adminLaunchEpicPaintEvent;

    // Нейтрализация старых вызовов, чтобы интерфейс не падал
    window.activateScheduledEventIfNeeded = async function () {};
    window.maybeFinalizeCompletedEventByEndTime = async function () {};
    window.failExpiredEventIfNeeded = async function () {};
    window.dismissEpicPaintStartAlert = async function () { openEventOverlay(); };
    window.chooseRoundInsteadOfEvent = function () { closeEventOverlay(); };
})();
