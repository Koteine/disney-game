// Новая логика ивента «Эпичный раскрас»
const EVENT_PATH = 'current_event';
const EVENT_ACTIVE_STATUS = 'active';
const EVENT_IDLE_STATUS = 'idle';
const EVENT_TITLE = 'Эпичный раскрас';
const EVENT_SUCCESS_MESSAGE = 'Ивент завершен успешно!';
const EVENT_BRUSH_SIZE = 20;
const EVENT_TARGET_PERCENT = 95;

let epicPaintStrokesRef = null;
let epicPaintEventRef = null;
let epicPaintTimerInterval = null;
let epicPaintState = {
    event_status: EVENT_IDLE_STATUS,
    title: EVENT_TITLE,
    end_timestamp: 0,
    participants: {},
    progress: { percent: 0 }
};

let epicPaintDrawState = { drawing: false, x: 0, y: 0 };
let epicPaintStrokesMap = {};
let epicPaintRenderScheduled = false;
let localParticipants = [];
let localParticipantsSet = new Set();
let localFirstStrokeSent = false;
let localFinishInProgress = false;

window.participants = localParticipants;

function getEventCanvas() { return document.getElementById('epic-paint-canvas'); }
function getEventCtx() { return getEventCanvas()?.getContext('2d'); }
function getCurrentUserIdString() {
    return String(window.currentUserId || '').trim();
}

function formatEventTimeLeft(endTs) {
    const diff = Math.max(0, Number(endTs || 0) - Date.now());
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function showMainEventBanner() {
    const banner = document.getElementById('event-start-alert');
    if (!banner) return;
    if (epicPaintState.event_status === EVENT_ACTIVE_STATUS) {
        banner.style.display = 'block';
        banner.classList.add('epic');
        banner.innerHTML = `
            <div class="event-title">Начался ивент: ${EVENT_TITLE}!</div>
            <div class="event-sub">Общий прогресс: ${Number(epicPaintState?.progress?.percent || 0).toFixed(1)}%</div>
            <button class="event-join-btn" onclick="openEventSpace()">Присоединиться</button>
        `;
    } else {
        banner.style.display = 'none';
        banner.classList.remove('epic');
        banner.innerHTML = '';
    }
}

function updateEventHeader() {
    const titleEl = document.getElementById('event-space-title');
    const timerEl = document.getElementById('event-space-timer');
    const progressEl = document.getElementById('epic-paint-progress');
    const doneEl = document.getElementById('event-done-message');

    if (titleEl) titleEl.textContent = epicPaintState.title || EVENT_TITLE;
    if (timerEl) {
        if (epicPaintState.event_status === EVENT_ACTIVE_STATUS && Number(epicPaintState.end_timestamp) > 0) {
            timerEl.style.display = 'inline-block';
            timerEl.textContent = `До конца: ${formatEventTimeLeft(epicPaintState.end_timestamp)}`;
        } else {
            timerEl.style.display = 'none';
        }
    }
    if (progressEl) {
        const percent = Number(epicPaintState?.progress?.percent || 0);
        progressEl.textContent = `Закрашено: ${percent.toFixed(1)}%`;
    }
    if (doneEl) {
        const isDone = epicPaintState.event_status === 'completed';
        doneEl.style.display = isDone ? 'block' : 'none';
        doneEl.textContent = isDone ? EVENT_SUCCESS_MESSAGE : '';
    }
}

function openEventSpace() {
    document.getElementById('tab-game')?.classList.remove('tab-active');
    document.getElementById('tab-event')?.classList.add('tab-active');
    document.body.classList.add('event-mode');
    scheduleRenderFromState();
}

function backToGameFromEvent() {
    document.getElementById('tab-event')?.classList.remove('tab-active');
    document.getElementById('tab-game')?.classList.add('tab-active');
    document.body.classList.remove('event-mode');
}

function updateEventUiState() {
    showMainEventBanner();
    updateEventHeader();
}

function setupEpicPaintCanvas() {
    const canvas = getEventCanvas();
    if (!canvas || canvas.dataset.ready === '1') return;
    canvas.dataset.ready = '1';

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

    const startDraw = async (evt) => {
        if (epicPaintState.event_status !== EVENT_ACTIVE_STATUS) return;
        evt.preventDefault();
        const p = getPos(evt);
        epicPaintDrawState = { drawing: true, x: p.x, y: p.y };
        await pushStroke(p.x, p.y, p.x, p.y);
    };

    const moveDraw = async (evt) => {
        if (!epicPaintDrawState.drawing || epicPaintState.event_status !== EVENT_ACTIVE_STATUS) return;
        evt.preventDefault();
        const p = getPos(evt);
        await pushStroke(epicPaintDrawState.x, epicPaintDrawState.y, p.x, p.y);
        epicPaintDrawState.x = p.x;
        epicPaintDrawState.y = p.y;
    };

    const endDraw = () => { epicPaintDrawState.drawing = false; };

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', moveDraw);
    canvas.addEventListener('mouseup', endDraw);
    canvas.addEventListener('mouseleave', endDraw);
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', moveDraw, { passive: false });
    canvas.addEventListener('touchend', endDraw);
    canvas.addEventListener('touchcancel', endDraw);
}

async function pushStroke(x1, y1, x2, y2) {
    const uid = getCurrentUserIdString();
    if (!uid || !epicPaintStrokesRef) return;

    if (!localFirstStrokeSent) {
        localFirstStrokeSent = true;
        if (!localParticipantsSet.has(uid)) {
            localParticipantsSet.add(uid);
            localParticipants.push(uid);
            window.participants = localParticipants;
        }
        await window.db.ref(`${EVENT_PATH}/participants/${uid}`).set(true);
    }

    await epicPaintStrokesRef.push({
        uid,
        x1, y1, x2, y2,
        size: EVENT_BRUSH_SIZE,
        color: '#ff007f',
        at: Date.now()
    });
}

function drawStrokesToCanvas() {
    const canvas = getEventCanvas();
    const ctx = getEventCtx();
    if (!canvas || !ctx) return;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    Object.values(epicPaintStrokesMap).forEach((s) => {
        ctx.beginPath();
        ctx.lineCap = 'round';
        ctx.lineWidth = Number(s.size) || EVENT_BRUSH_SIZE;
        ctx.strokeStyle = s.color || '#ff007f';
        ctx.moveTo(Number(s.x1) || 0, Number(s.y1) || 0);
        ctx.lineTo(Number(s.x2) || 0, Number(s.y2) || 0);
        ctx.stroke();
    });
}

function calculateCanvasPaintPercent() {
    const canvas = getEventCanvas();
    const ctx = getEventCtx();
    if (!canvas || !ctx) return 0;

    const sampleStep = 4;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let total = 0;
    let painted = 0;

    for (let y = 0; y < canvas.height; y += sampleStep) {
        for (let x = 0; x < canvas.width; x += sampleStep) {
            total += 1;
            const idx = (y * canvas.width + x) * 4;
            const isWhite = img[idx] > 245 && img[idx + 1] > 245 && img[idx + 2] > 245;
            if (!isWhite) painted += 1;
        }
    }

    return total > 0 ? (painted / total) * 100 : 0;
}

async function syncProgressAndMaybeFinish() {
    const percent = calculateCanvasPaintPercent();
    await window.db.ref(`${EVENT_PATH}/progress`).set({ percent, updated_at: Date.now() });
    if (percent >= EVENT_TARGET_PERCENT) {
        await finalizeEpicPaintEvent();
    }
}

async function finalizeEpicPaintEvent() {
    if (localFinishInProgress) return;
    localFinishInProgress = true;
    try {
        const eventRef = window.db.ref(EVENT_PATH);
        const tx = await eventRef.transaction((eventData) => {
            if (!eventData || eventData.event_status !== EVENT_ACTIVE_STATUS) return eventData;
            return {
                ...eventData,
                event_status: 'completed',
                completed_at: Date.now(),
                completed_message: EVENT_SUCCESS_MESSAGE
            };
        });

        if (!tx.committed) return;

        const participantsMap = tx.snapshot.val()?.participants || {};
        const participantIds = Object.keys(participantsMap);
        for (const uid of participantIds) {
            if (typeof window.createTicket === 'function') {
                await window.createTicket(uid, 2, 'Победа: Эпичный раскрас');
            }
        }

        alert(EVENT_SUCCESS_MESSAGE);

        await eventRef.remove();
        await eventRef.set({ event_status: EVENT_IDLE_STATUS });
    } finally {
        localFinishInProgress = false;
    }
}

function scheduleRenderFromState() {
    if (epicPaintRenderScheduled) return;
    epicPaintRenderScheduled = true;
    requestAnimationFrame(async () => {
        epicPaintRenderScheduled = false;
        drawStrokesToCanvas();
        updateEventHeader();
        if (epicPaintState.event_status === EVENT_ACTIVE_STATUS) {
            await syncProgressAndMaybeFinish();
        }
    });
}

function syncGameEvents() {
    if (epicPaintEventRef) epicPaintEventRef.off();
    if (epicPaintStrokesRef) epicPaintStrokesRef.off();

    epicPaintEventRef = window.db.ref(EVENT_PATH);
    epicPaintEventRef.on('value', (snap) => {
        epicPaintState = snap.val() || { event_status: EVENT_IDLE_STATUS, title: EVENT_TITLE, progress: { percent: 0 } };
        if (!epicPaintState.title) epicPaintState.title = EVENT_TITLE;
        if (!epicPaintState.progress) epicPaintState.progress = { percent: 0 };
        if (epicPaintState.event_status !== EVENT_ACTIVE_STATUS) {
            localFirstStrokeSent = false;
        }
        updateEventUiState();
    });

    epicPaintStrokesRef = window.db.ref(`${EVENT_PATH}/strokes`);
    epicPaintStrokesRef.on('value', (snap) => {
        epicPaintStrokesMap = snap.val() || {};
        scheduleRenderFromState();
    });

    if (epicPaintTimerInterval) clearInterval(epicPaintTimerInterval);
    epicPaintTimerInterval = setInterval(updateEventHeader, 1000);
}

// Совместимость с существующим циклом таймера в index.html
async function activateScheduledEventIfNeeded() { return; }
async function maybeFinalizeCompletedEventByEndTime() { return; }
async function failExpiredEventIfNeeded() { return; }
async function dismissEpicPaintStartAlert() { openEventSpace(); }
function chooseRoundInsteadOfEvent() { backToGameFromEvent(); }
async function adminScheduleEvent() {
    if (Number(window.currentUserId) !== Number(window.ADMIN_ID)) return;
    const endTs = Date.now() + (30 * 60 * 1000);
    await window.db.ref(EVENT_PATH).set({
        event_status: EVENT_ACTIVE_STATUS,
        title: EVENT_TITLE,
        start_timestamp: Date.now(),
        end_timestamp: endTs,
        participants: {},
        strokes: {},
        progress: { percent: 0 }
    });
}
