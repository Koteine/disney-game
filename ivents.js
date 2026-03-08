(function () {
    const EVENT_PATH = 'current_event';
    const ACTIVE_STATUS = 'active';
    const IDLE_STATUS = 'idle';
    const COMPLETED_STATUS = 'completed';
    const EVENT_TYPE = 'paint';
    const EVENT_TITLE = 'Эпичный раскрас';
    const EVENT_SUCCESS = 'Ивент завершен успешно!';
    const EVENT_NO_PARTICIPANTS = 'Ивент завершен, никто не участвовал';
    const BRUSH_SIZE = 20;
    const TARGET_PROGRESS = 95;
    const PROGRESS_SYNC_MS = 5000;

    let eventRef = null;
    let strokesRef = null;
    let timerInterval = null;
    let progressInterval = null;

    let eventState = {
        type: EVENT_TYPE,
        status: IDLE_STATUS,
        end_timestamp: 0,
        progress: 0,
        active_participants: {}
    };

    let drawState = { drawing: false, x: 0, y: 0 };
    let strokeMap = {};
    let finishInProgress = false;
    let firstStrokeSaved = false;
    let localParticipants = [];
    let localParticipantsSet = new Set();

    window.participants = localParticipants;

    const $ = (id) => document.getElementById(id);
    const getDb = () => (window.db && typeof window.db.ref === 'function' ? window.db : null);
    const getUserId = () => String(window.currentUserId || '').trim();
    const getCanvas = () => $('event-canvas') || $('epic-paint-canvas');
    const getCtx = () => getCanvas()?.getContext('2d');

    function normalizeEventState(v) {
        const value = v || {};
        return {
            type: String(value.type || EVENT_TYPE),
            status: String(value.status || value.event_status || IDLE_STATUS),
            end_timestamp: Number(value.end_timestamp || 0),
            progress: Number(value.progress?.percent ?? value.progress ?? 0),
            active_participants: value.active_participants || {}
        };
    }

    function formatMMSS(ts) {
        const left = Math.max(0, Number(ts || 0) - Date.now());
        const sec = Math.floor(left / 1000);
        const mm = Math.floor(sec / 60);
        const ss = sec % 60;
        return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    }

    function resizeEventCanvas() {
        const canvas = getCanvas();
        const wrap = $('event-overlay') || canvas?.parentElement;
        if (!canvas || !wrap) return;

        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const rect = wrap.getBoundingClientRect();
        const header = $('event-timer')?.closest('.event-overlay-header');
        const footer = $('paint-progress')?.closest('.event-overlay-footer');
        const usedH = (header?.offsetHeight || 0) + (footer?.offsetHeight || 0) + 16;
        const cssWidth = Math.max(240, Math.floor(rect.width || window.innerWidth));
        const cssHeight = Math.max(320, Math.floor((rect.height || window.innerHeight) - usedH));

        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;

        const newWidth = Math.floor(cssWidth * dpr);
        const newHeight = Math.floor(cssHeight * dpr);
        if (canvas.width !== newWidth || canvas.height !== newHeight) {
            canvas.width = newWidth;
            canvas.height = newHeight;
            drawAllStrokes();
        }
    }

    function showNotification() {
        const box = $('event-notification') || $('event-start-alert');
        if (!box) return;
        if (eventState.status === ACTIVE_STATUS && eventState.type === EVENT_TYPE) {
            box.style.display = 'block';
            box.classList.add('event-notification-pink');
            box.innerHTML = `
                <div class="event-notification-text">🎨✨ ✨ Внимание! Начался ивент: Эпичный раскрас! Присоединяйся и получи билетики! 🎫</div>
                <button id="btn-join-event" class="event-notification-join">Присоединиться</button>
            `;
            const joinBtn = $('btn-join-event');
            if (joinBtn) joinBtn.onclick = () => window.openEventOverlay();
        } else {
            box.style.display = 'none';
            box.classList.remove('event-notification-pink');
            box.innerHTML = '';
        }
    }

    function updateOverlayUi() {
        const timerEl = $('event-timer') || $('event-space-timer');
        const progressEl = $('paint-progress') || $('epic-paint-progress');
        const titleEl = $('event-space-title');

        if (titleEl) titleEl.textContent = EVENT_TITLE;
        if (timerEl) timerEl.textContent = eventState.status === ACTIVE_STATUS ? formatMMSS(eventState.end_timestamp) : '00:00';
        if (progressEl) progressEl.textContent = `Закрашено: ${Number(eventState.progress || 0).toFixed(1)}%`;
    }

    function openEventOverlay() {
        const overlay = $('event-overlay');
        if (overlay) overlay.style.display = 'flex';
        document.body.classList.add('event-mode');
        resizeEventCanvas();
        drawAllStrokes();
    }

    function closeEventOverlay() {
        const overlay = $('event-overlay');
        if (overlay) overlay.style.display = 'none';
        document.body.classList.remove('event-mode');
    }

    function setupExitButton() {
        const btn = $('btn-exit-event');
        if (!btn || btn.dataset.ready === '1') return;
        btn.dataset.ready = '1';
        btn.onclick = () => closeEventOverlay();
    }

    async function registerFirstStrokeParticipant() {
        const db = getDb();
        const uid = getUserId();
        if (!db || !uid || firstStrokeSaved) return;

        firstStrokeSaved = true;
        if (!localParticipantsSet.has(uid)) {
            localParticipantsSet.add(uid);
            localParticipants.push(uid);
            window.participants = localParticipants;
        }
        await db.ref(`${EVENT_PATH}/active_participants/${uid}`).set(true);
    }

    async function startDrawing(evt) {
        if (eventState.status !== ACTIVE_STATUS) return;
        evt.preventDefault();
        const p = getPointer(evt);
        drawState = { drawing: true, x: p.x, y: p.y };
        await registerFirstStrokeParticipant();
        await pushStroke(p.x, p.y, p.x, p.y);
    }

    async function draw(evt) {
        if (!drawState.drawing || eventState.status !== ACTIVE_STATUS) return;
        evt.preventDefault();
        const p = getPointer(evt);
        await pushStroke(drawState.x, drawState.y, p.x, p.y);
        drawState.x = p.x;
        drawState.y = p.y;
    }

    function stopDrawing() {
        drawState.drawing = false;
    }

    function getPointer(evt) {
        const canvas = getCanvas();
        const rect = canvas.getBoundingClientRect();
        const t = evt.touches?.[0] || evt.changedTouches?.[0];
        const cx = t ? t.clientX : evt.clientX;
        const cy = t ? t.clientY : evt.clientY;
        return {
            x: ((cx - rect.left) / rect.width) * canvas.width,
            y: ((cy - rect.top) / rect.height) * canvas.height
        };
    }

    function bindCanvasInputs() {
        const canvas = getCanvas();
        if (!canvas || canvas.dataset.ready === '1') return;
        canvas.dataset.ready = '1';

        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDrawing);
        canvas.addEventListener('mouseleave', stopDrawing);
        canvas.addEventListener('touchstart', startDrawing, { passive: false });
        canvas.addEventListener('touchmove', draw, { passive: false });
        canvas.addEventListener('touchend', stopDrawing);
        canvas.addEventListener('touchcancel', stopDrawing);
    }

    async function pushStroke(x1, y1, x2, y2) {
        const db = getDb();
        if (!db || !strokesRef) return;
        await strokesRef.push({ x1, y1, x2, y2, size: BRUSH_SIZE, color: '#ff4fa3', at: Date.now(), uid: getUserId() });
    }

    function drawAllStrokes() {
        const canvas = getCanvas();
        const ctx = getCtx();
        if (!canvas || !ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(255,255,255,0)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

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

    function calculatePaintPercent() {
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

    async function syncProgressTask() {
        const db = getDb();
        if (!db || eventState.status !== ACTIVE_STATUS) return;

        const percent = Number(calculatePaintPercent().toFixed(2));
        await db.ref(`${EVENT_PATH}/progress`).set({ percent, updated_at: Date.now() });
        eventState.progress = percent;
        updateOverlayUi();

        if (percent >= TARGET_PROGRESS) {
            await finalizeEvent(true);
        }
    }

    async function finalizeEvent(successByCoverage) {
        if (finishInProgress) return;
        const db = getDb();
        if (!db) return;
        finishInProgress = true;

        try {
            const snap = await db.ref(EVENT_PATH).once('value');
            const value = snap.val() || {};
            const state = normalizeEventState(value);
            if (state.status !== ACTIVE_STATUS) return;

            const participantsMap = value.active_participants || {};
            const participantIds = Object.keys(participantsMap);

            if (successByCoverage && participantIds.length > 0) {
                for (const uid of participantIds) {
                    if (typeof window.createTicket === 'function') {
                        await window.createTicket(uid, 2, 'Победа: Эпичный раскрас');
                    }
                }
            }

            if (!participantIds.length || Number(state.progress || 0) <= 0) {
                if (typeof window.postNews === 'function') {
                    await window.postNews(EVENT_NO_PARTICIPANTS);
                }
            }

            await db.ref(`${EVENT_PATH}/active_participants`).remove();
            await db.ref(EVENT_PATH).update({
                status: COMPLETED_STATUS,
                completed_at: Date.now(),
                completed_message: successByCoverage ? EVENT_SUCCESS : EVENT_NO_PARTICIPANTS
            });
        } finally {
            finishInProgress = false;
        }
    }

    function attachFirebase() {
        const db = getDb();
        if (!db) return;

        if (eventRef) eventRef.off();
        if (strokesRef) strokesRef.off();

        eventRef = db.ref(EVENT_PATH);
        eventRef.on('value', (snap) => {
            const prevStatus = eventState.status;
            eventState = normalizeEventState(snap.val());

            if (prevStatus !== ACTIVE_STATUS && eventState.status === ACTIVE_STATUS) {
                firstStrokeSaved = false;
            }
            showNotification();
            updateOverlayUi();
        });

        strokesRef = db.ref(`${EVENT_PATH}/strokes`);
        strokesRef.on('value', (snap) => {
            strokeMap = snap.val() || {};
            drawAllStrokes();
        });
    }

    async function adminLaunchEpicPaintEvent(durationMins = 10) {
        const db = getDb();
        if (!db) return;
        if (Number(window.currentUserId) !== Number(window.ADMIN_ID)) return;

        const mins = Math.max(1, Number(durationMins) || 10);
        await db.ref(EVENT_PATH).set({
            type: EVENT_TYPE,
            status: ACTIVE_STATUS,
            end_timestamp: Date.now() + mins * 60000,
            progress: { percent: 0 },
            strokes: {},
            active_participants: {}
        });
    }

    function startBackgroundLoops() {
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(async () => {
            updateOverlayUi();
            if (eventState.status === ACTIVE_STATUS && Number(eventState.end_timestamp) > 0 && Date.now() >= Number(eventState.end_timestamp)) {
                await finalizeEvent(false);
                closeEventOverlay();
            }
        }, 1000);

        if (progressInterval) clearInterval(progressInterval);
        progressInterval = setInterval(() => {
            syncProgressTask();
        }, PROGRESS_SYNC_MS);
    }

    function initEventSystem() {
        setupExitButton();
        bindCanvasInputs();
        resizeEventCanvas();
        attachFirebase();
        startBackgroundLoops();

        window.addEventListener('resize', resizeEventCanvas);
        window.addEventListener('orientationchange', resizeEventCanvas);
    }

    // export
    window.initEventSystem = initEventSystem;
    window.syncGameEvents = initEventSystem;
    window.setupEpicPaintCanvas = bindCanvasInputs;
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
