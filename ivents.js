// Логика игровых событий, вынесенная из index.html
function getPlayerColorByUid(uid) {
    const entry = Object.entries(window.cachedWhitelistData || {}).find(([id]) => Number(id) === Number(uid));
    const charIndex = entry?.[1]?.charIndex;
    if (Number.isInteger(charIndex)) return charColors[charIndex] || '#ff007f';
    if (Number(uid) === currentUserId && Number.isInteger(myIndex)) return charColors[myIndex] || '#ff007f';
    return '#ff007f';
}

function getWallBattleTeamColor(team) { return team === 'blue' ? '#1e88e5' : '#e53935'; }

async function joinCurrentEventTeam() {
    if (!currentGameEventKey || !currentGameEvent || currentGameEvent.status !== 'active') return null;
    const existing = (await db.ref(`game_events/${currentGameEventKey}/teams/${currentUserId}`).once('value')).val();
    if (existing?.team) return existing.team;
    let assigned = null;
    await db.ref(`game_events/${currentGameEventKey}`).transaction(ev => {
        if (!ev || ev.status !== 'active') return ev;
        const teams = ev.teams || {};
        if (teams[currentUserId]?.team) { assigned = teams[currentUserId].team; return ev; }
        const nextTeam = ev.nextTeam === 'blue' ? 'blue' : 'red';
        assigned = nextTeam;
        return { ...ev, teams: { ...teams, [currentUserId]: { team: nextTeam, joinedAt: Date.now() } }, nextTeam: nextTeam === 'red' ? 'blue' : 'red' };
    });
    return assigned;
}

async function addInventoryItemForUser(uid, itemType, count = 1) {
    if (!uid || !itemType || !count) return;
    await db.ref(`whitelist/${uid}/inventory/${itemType}`).transaction(v => (Number(v) || 0) + count);
}

function getNowByServerClock() {
    return Date.now() + (Number(window.serverTimeOffsetMs) || 0);
}

function setupEpicPaintCanvas() {
    const canvas = document.getElementById('epic-paint-canvas');
    if (!canvas || canvas.dataset.ready === '1') return;
    canvas.dataset.ready = '1';

    const getPos = evt => {
        const rect = canvas.getBoundingClientRect();
        const touch = evt.touches?.[0] || evt.changedTouches?.[0];
        const cx = touch ? touch.clientX : evt.clientX;
        const cy = touch ? touch.clientY : evt.clientY;
        return {
            x: ((cx - rect.left) / rect.width) * canvas.width,
            y: ((cy - rect.top) / rect.height) * canvas.height
        };
    };

    const begin = async evt => {
        if (!currentGameEvent || currentGameEvent.status !== 'active' || ![EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID].includes(currentGameEvent.id)) return;
        evt.preventDefault();
        const team = await joinCurrentEventTeam();
        if (!team) return;
        const { x, y } = getPos(evt);
        epicPaintDrawState.drawing = true;
        epicPaintDrawState.lastX = x;
        epicPaintDrawState.lastY = y;
        pushEpicPaintStroke(x, y, x, y);
    };

    const move = evt => {
        if (!epicPaintDrawState.drawing) return;
        evt.preventDefault();
        const { x, y } = getPos(evt);
        pushEpicPaintStroke(epicPaintDrawState.lastX, epicPaintDrawState.lastY, x, y);
        epicPaintDrawState.lastX = x;
        epicPaintDrawState.lastY = y;
    };

    const end = () => { epicPaintDrawState.drawing = false; };

    canvas.addEventListener('mousedown', begin);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', end);
    canvas.addEventListener('touchstart', begin, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);
    canvas.addEventListener('touchcancel', end);
}

async function pushEpicPaintStroke(x1, y1, x2, y2) {
    if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) return;
    const uid = currentUserId;
    const teamInfo = currentGameEventKey ? ((await db.ref(`game_events/${currentGameEventKey}/teams/${uid}`).once('value')).val() || {}) : {};
    const team = teamInfo.team || 'red';
    const color = currentGameEvent?.id === WALL_BATTLE_EVENT_ID ? getWallBattleTeamColor(team) : getPlayerColorByUid(uid);
    await db.ref(`epic_paint/participants/${uid}`).update({ uid, color, team, updatedAt: Date.now() });
    await db.ref('epic_paint/strokes').push({ x1, y1, x2, y2, color, uid, team, at: Date.now() });
}

function drawEpicPaint() {
    const canvas = document.getElementById('epic-paint-canvas');
    const progressEl = document.getElementById('epic-paint-progress');
    if (!canvas || !progressEl) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    (epicPaintStrokes || []).forEach(stroke => {
        ctx.beginPath();
        ctx.lineWidth = 16;
        ctx.lineCap = 'round';
        ctx.strokeStyle = stroke.color || '#ff007f';
        ctx.moveTo(stroke.x1 || 0, stroke.y1 || 0);
        ctx.lineTo(stroke.x2 || 0, stroke.y2 || 0);
        ctx.stroke();
    });

    const { coverage, redCoverage, blueCoverage } = calculateEpicPaintCoverageStats(canvas);
    if (currentGameEvent?.id === WALL_BATTLE_EVENT_ID) {
        progressEl.innerText = `Цель команды: 70% холста · красные: ${redCoverage.toFixed(1)}% · синие: ${blueCoverage.toFixed(1)}%`;
        maybeFinalizeWallBattleSuccess(coverage, redCoverage, blueCoverage);
    } else {
        progressEl.innerText = `Закрашено: ${coverage.toFixed(1)}% · цель ${EPIC_PAINT_COVERAGE_TARGET}%`;
        maybeFinalizeEpicPaintSuccess(coverage);
    }
}

function calculateEpicPaintCoverageStats(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const sample = 6;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    let redPainted = 0;
    let bluePainted = 0;
    let total = 0;
    const red = { r: 229, g: 57, b: 53 };
    const blue = { r: 30, g: 136, b: 229 };

    const colorDistance = (r, g, b, target) => {
        const dr = r - target.r;
        const dg = g - target.g;
        const db = b - target.b;
        return (dr * dr) + (dg * dg) + (db * db);
    };

    for (let y = 0; y < canvas.height; y += sample) {
        for (let x = 0; x < canvas.width; x += sample) {
            const idx = (y * canvas.width + x) * 4;
            const r = img[idx], g = img[idx + 1], b = img[idx + 2];
            total += 1;
            const isWhite = r > 246 && g > 246 && b > 246;
            if (!isWhite) {
                painted += 1;
                const redDist = colorDistance(r, g, b, red);
                const blueDist = colorDistance(r, g, b, blue);
                if (redDist <= blueDist) redPainted += 1;
                else bluePainted += 1;
            }
        }
    }

    return {
        coverage: total ? (painted / total) * 100 : 0,
        redCoverage: total ? (redPainted / total) * 100 : 0,
        blueCoverage: total ? (bluePainted / total) * 100 : 0
    };
}

function formatDurationMinutesRu(totalMinutes) {
    const mins = Math.max(1, Math.round(Number(totalMinutes) || 0));
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (!hours) return `${mins} мин`;
    return remMins ? `${hours} ч ${remMins} мин` : `${hours} ч`;
}

async function postEpicEventSummary(eventData, isSuccess, rewardedPlayersCount) {
    if (!eventData) return;
    const startAt = eventData.activatedAt || eventData.startAt || Date.now();
    const endAt = eventData.completedAt || eventData.failedAt || Date.now();
    const durationMinutes = Math.max(1, Math.round((endAt - startAt) / 60000));
    const startText = new Date(startAt).toLocaleString('ru-RU');
    const statusText = isSuccess ? 'успешно завершено' : 'завершено без выполнения цели';
    await postNews(`🎨 Прошло событие «${eventData.name || eventData.id}» (${statusText}). Начало: ${startText}. Длительность: ${formatDurationMinutesRu(durationMinutes)}. ${rewardedPlayersCount} игроков получили свои призы.`);
}

async function maybeFinalizeEpicPaintSuccess(coverage) {
    if (!currentGameEvent || currentGameEvent.id !== EPIC_PAINT_EVENT_ID || currentGameEvent.status !== 'active') return;
    if (!currentGameEventKey) return;
    if (coverage < EPIC_PAINT_COVERAGE_TARGET) return;

    const eventRef = db.ref(`game_events/${currentGameEventKey}`);
    const tx = await eventRef.transaction(ev => {
        if (!ev || ![EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID].includes(ev.id) || ev.status !== 'active') return ev;
        return {
            ...ev,
            status: 'completed',
            completedAt: Date.now(),
            resultText: 'Игроки успели закрасить поле на 95%+' 
        };
    });
    if (!tx.committed) return;

    const rewardedPlayersCount = await grantEpicPaintRewards();
    await postEpicEventSummary({ ...(tx.snapshot.val() || {}), completedAt: Date.now(), activatedAt: currentGameEvent?.activatedAt || currentGameEvent?.startAt }, true, rewardedPlayersCount);
}

async function grantEpicPaintRewards() {
    if (!currentGameEventKey) return 0;
    const [participantsSnap, strokesSnap, whitelistSnap, rewardedSnap] = await Promise.all([
        db.ref('epic_paint/participants').once('value'),
        db.ref('epic_paint/strokes').once('value'),
        db.ref('whitelist').once('value'),
        db.ref(`epic_paint/rewarded/${currentGameEventKey}`).once('value')
    ]);

    const whitelist = whitelistSnap.val() || {};
    const alreadyRewarded = rewardedSnap.val() || {};
    const participantUidSet = new Set();

    participantsSnap.forEach(p => participantUidSet.add(String(p.key)));
    strokesSnap.forEach(strokeSnap => {
        const stroke = strokeSnap.val() || {};
        if (stroke.uid !== undefined && stroke.uid !== null) participantUidSet.add(String(stroke.uid));
    });

    const participantUids = Array.from(participantUidSet).filter(uid => /^\d+$/.test(uid));
    if (!participantUids.length) return 0;

    let rewardedCount = 0;
    for (const uidKey of participantUids) {
        if (alreadyRewarded[uidKey]) continue;
        const uid = Number(uidKey);
        const user = whitelist[uidKey] || whitelist[uid] || {};
        const owner = Number.isInteger(user.charIndex) ? user.charIndex : null;

        const awarded = await claimSequentialTickets(2);
        if (!awarded) continue;
        rewardedCount += 1;
        const ticketValue = `${awarded[0]} и ${awarded[1]}`;
        await db.ref('tickets_archive').push({
            owner,
            userId: uid,
            ticket: ticketValue,
            taskIdx: -1,
            round: currentRoundNum,
            cell: 0,
            cellIdx: -1,
            isEventReward: true,
            eventId: EPIC_PAINT_EVENT_ID,
            ticketSourceLabel: 'Билет события',
            archivedAt: Date.now(),
            excluded: false
        });
        await db.ref(`epic_paint/rewarded/${currentGameEventKey}/${uidKey}`).set(true);
    }

    return rewardedCount;
}

async function maybeFinalizeWallBattleSuccess(coverage, redCoverage, blueCoverage) {
    if (!currentGameEvent || currentGameEvent.id !== WALL_BATTLE_EVENT_ID || currentGameEvent.status !== 'active') return;
    if (!currentGameEventKey) return;
    if (redCoverage < 70 && blueCoverage < 70) return;

    const winnerTeam = redCoverage >= blueCoverage ? 'red' : 'blue';
    const eventRef = db.ref(`game_events/${currentGameEventKey}`);
    const tx = await eventRef.transaction(ev => {
        if (!ev || ev.id !== WALL_BATTLE_EVENT_ID || ev.status !== 'active') return ev;
        return { ...ev, status: 'completed', completedAt: Date.now(), winnerTeam, resultText: `Победила команда ${winnerTeam}` };
    });
    if (!tx.committed) return;

    const rewardedPlayersCount = await grantWallBattleRewards(winnerTeam);
    await postNews('Кажется, в другой команде перевесил Ван Гог. В следующий раз удача точно будет на твоей стороне!');
    await postEpicEventSummary({ ...(tx.snapshot.val() || {}), completedAt: Date.now(), activatedAt: currentGameEvent?.activatedAt || currentGameEvent?.startAt }, true, rewardedPlayersCount);
}

async function maybeFinalizeCompletedEventByEndTime() {
    const active = queuedGameEvents.find(ev => ev.status === 'active' && ev.id === EPIC_PAINT_EVENT_ID);
    if (!active?.key) return;
    if (getNowByServerClock() < (active.endAt || 0)) return;

    const eventRef = db.ref(`game_events/${active.key}`);
    const tx = await eventRef.transaction(ev => {
        if (!ev || ev.id !== EPIC_PAINT_EVENT_ID || ev.status !== 'active') return ev;
        if (getNowByServerClock() < (ev.endAt || 0)) return ev;
        return {
            ...ev,
            status: 'completed',
            completedAt: Date.now(),
            celebrationUntil: Date.now() + 30000,
            resultText: 'Событие завершено. Награды выданы участникам.'
        };
    });
    if (!tx.committed) return;

    const snapshotEvent = tx.snapshot.val() || {};
    const rewardedPlayersCount = await grantEpicPaintRewards();

    await postEpicEventSummary({ ...snapshotEvent, completedAt: Date.now(), activatedAt: snapshotEvent.activatedAt || snapshotEvent.startAt }, true, rewardedPlayersCount);
}

async function grantWallBattleRewards(winnerTeam) {
    if (!currentGameEventKey) return 0;
    const [teamsSnap, whitelistSnap, rewardedSnap] = await Promise.all([
        db.ref(`game_events/${currentGameEventKey}/teams`).once('value'),
        db.ref('whitelist').once('value'),
        db.ref(`epic_paint/rewarded/${currentGameEventKey}`).once('value')
    ]);
    const teams = teamsSnap.val() || {};
    const whitelist = whitelistSnap.val() || {};
    const alreadyRewarded = rewardedSnap.val() || {};
    let rewardedCount = 0;

    for (const [uidKey, teamInfo] of Object.entries(teams)) {
        if (teamInfo?.team !== winnerTeam) continue;
        if (alreadyRewarded[uidKey]) continue;
        const uid = Number(uidKey);
        const user = whitelist[uidKey] || whitelist[uid] || {};
        const owner = Number.isInteger(user.charIndex) ? user.charIndex : null;
        if (!Number.isInteger(owner) || !players[owner]) continue;
        const awarded = await claimSequentialTickets(1);
        if (!awarded?.length) continue;
        await addInventoryItemForUser(uid, 'magnifier', 1);
        await db.ref('tickets_archive').push({ owner, userId: uid, ticket: awarded[0], taskIdx: -1, round: currentRoundNum, cell: 0, cellIdx: -1, isEventReward: true, eventId: WALL_BATTLE_EVENT_ID, taskLabel: 'Награда за победу команды в событии «Стенка на стенку»', archivedAt: Date.now(), excluded: false });
        await db.ref(`epic_paint/rewarded/${currentGameEventKey}/${uidKey}`).set(true);
        rewardedCount += 1;
    }
    return rewardedCount;
}

function openEventSpace() {
    const navBtn = document.getElementById('nav-event-btn');
    if (navBtn) switchTab('tab-event', navBtn);
}

function backToGameFromEvent() {
    const gameBtn = document.querySelector(".nav-item[onclick*=\"tab-game\"]");
    if (gameBtn) switchTab('tab-game', gameBtn);
}

function updateEventUiState() {
    const startAlert = document.getElementById('event-start-alert');
    const successAlert = document.getElementById('event-success-alert');
    const failAlert = document.getElementById('event-fail-alert');
    const eventTitle = document.getElementById('event-space-title');
    const navEventBtn = document.getElementById('nav-event-btn');
    const isEventType = currentGameEvent && [EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID].includes(currentGameEvent.id);
    const isActive = isEventType && currentGameEvent.status === 'active';
    const isCelebration = isEventType && currentGameEvent.status === 'completed' && (currentGameEvent.celebrationUntil || 0) > getNowByServerClock();

    if (navEventBtn) navEventBtn.style.display = (isActive || isCelebration) ? 'flex' : 'none';
    if (eventTitle) eventTitle.innerText = (isActive || isCelebration) ? `${currentGameEvent.name || currentGameEvent.id}` : 'Событие не активно';

    if (isActive) {
        startAlert.style.display = 'block';
        startAlert.classList.add('epic');
        const extra = currentGameEvent.id === WALL_BATTLE_EVENT_ID
            ? '<div class="event-sub">Команды распределяются по очереди: красные, затем синие.</div>'
            : '';
        startAlert.innerHTML = `
            <div class="event-title">🎨 ${currentGameEvent.name || 'Событие'} уже в разгаре!</div>
            <div class="event-sub">Перейди в отдельное пространство события.</div>
            ${extra}
            <button class="event-join-btn" onclick="dismissEpicPaintStartAlert()">✅ Принять участие в событии</button>
            <button class="event-join-btn" style="margin-top:7px; background:linear-gradient(135deg,#26a69a,#42a5f5);" onclick="chooseRoundInsteadOfEvent()">🎲 Остаться на поле</button>
        `;
    } else {
        startAlert.style.display = 'none';
        startAlert.classList.remove('epic');
    }

    if (isCelebration) {
        const secondsLeft = Math.max(0, Math.ceil(((currentGameEvent.celebrationUntil || 0) - getNowByServerClock()) / 1000));
        successAlert.style.display = 'block';
        successAlert.innerHTML = `
            <div class="event-title">🏆 Событие «${currentGameEvent.name || 'Эпичный закрас'}» успешно завершено!</div>
            <div class="event-sub">Награды выданы. Фанфары и салютики идут ещё ${secondsLeft} сек.</div>
            <div class="event-sub" style="margin-top:6px;">Когда будешь готов(а), нажми кнопку ниже.</div>
            <button class="event-join-btn" style="margin-top:8px; background:linear-gradient(135deg,#5e35b1,#3949ab);" onclick="backToGameFromEvent()">⬅️ Вернуться на главное поле</button>
        `;
    }

    const latestCompleted = queuedGameEvents.filter(ev => [EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID].includes(ev.id) && ev.status === 'completed').sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))[0];
    const latestFailed = queuedGameEvents.filter(ev => [EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID].includes(ev.id) && ev.status === 'failed').sort((a, b) => (b.failedAt || 0) - (a.failedAt || 0))[0];

    const showSuccess = Boolean(!isCelebration && latestCompleted && latestCompleted.key !== lastCompletedEpicEventKeyShown);
    successAlert.style.display = showSuccess ? 'block' : 'none';
    if (showSuccess) {
        successAlert.innerHTML = latestCompleted.id === WALL_BATTLE_EVENT_ID
            ? '🏁 Командная битва завершена! Победители получили по 1 билету и Лупе.'
            : '🎆 Событие прошло круто! Все участники получили по 2 билетика.';
        launchCelebrationFireworks(30000);
        playFireworksSound();
        setTimeout(() => playFireworksSound(), 9000);
        setTimeout(() => playFireworksSound(), 18000);
        lastCompletedEpicEventKeyShown = latestCompleted.key;
        setTimeout(() => { if (successAlert && !isCelebration) successAlert.style.display = 'none'; }, 30000);
    }

    const showFail = Boolean(latestFailed && latestFailed.key !== lastFailedEpicEventKeyShown);
    failAlert.style.display = showFail ? 'block' : 'none';
    if (showFail) {
        failAlert.innerText = 'Событие завершилось без выполнения цели.';
        lastFailedEpicEventKeyShown = latestFailed.key;
        setTimeout(() => { if (failAlert) failAlert.style.display = 'none'; }, 10000);
    }
}

async function dismissEpicPaintStartAlert() {
    epicPaintHasDismissedStart = true;
    await joinCurrentEventTeam();
    openEventSpace();
}

function chooseRoundInsteadOfEvent() {
    epicPaintHasDismissedStart = true;
    backToGameFromEvent();
}

async function adminScheduleEvent() {
    if (currentUserId !== ADMIN_ID) return;
    const eventType = document.getElementById('event-type').value;
    const startAtValue = document.getElementById('event-start-at').value;
    const durationMins = Number(document.getElementById('event-duration-mins').value || 0);
    if (![EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID].includes(eventType)) return alert('Неизвестный тип события.');
    if (!startAtValue) return alert('Выбери дату и время старта события.');
    if (!durationMins || durationMins < 1) return alert('Укажи длительность события в минутах.');

    const startAt = new Date(startAtValue).getTime();
    if (!Number.isFinite(startAt) || startAt <= Date.now() - 1000) return alert('Время старта должно быть в будущем.');
    const endAt = startAt + durationMins * 60000;

    const eventsSnap = await db.ref('game_events').once('value');
    let scheduledCount = 0;
    eventsSnap.forEach(ev => {
        const v = ev.val() || {};
        if (v.status === 'scheduled') scheduledCount += 1;
    });
    if (scheduledCount >= MAX_SCHEDULED_EVENTS) {
        return alert(`Можно запланировать не более ${MAX_SCHEDULED_EVENTS} событий.`);
    }

    await db.ref('game_events').push({
        id: eventType,
        name: eventType === WALL_BATTLE_EVENT_ID ? 'Раскрас «Стенка на стенку»' : 'Эпичный закрас',
        status: 'scheduled',
        createdAt: Date.now(),
        startAt,
        endAt,
        durationMins,
        nextTeam: 'red',
        teams: null,
        createdBy: currentUserId
    });
}

async function adminCancelScheduledEvent(eventKey) {
    if (currentUserId !== ADMIN_ID) return;
    if (!eventKey) return;
    if (!confirm('Отменить это запланированное событие?')) return;
    await db.ref(`game_events/${eventKey}`).transaction(ev => {
        if (!ev || ev.status !== 'scheduled') return ev;
        return { ...ev, status: 'cancelled', cancelledAt: Date.now(), cancelledBy: currentUserId };
    });
}

async function activateScheduledEventIfNeeded() {
    const active = queuedGameEvents.find(ev => ev.status === 'active');
    if (active) return;

    const now = getNowByServerClock();
    const due = queuedGameEvents
        .filter(ev => ev.status === 'scheduled' && (ev.startAt || 0) <= now)
        .sort((a, b) => (a.startAt || 0) - (b.startAt || 0))[0];
    if (!due?.key) return;

    const tx = await db.ref(`game_events/${due.key}`).transaction(ev => {
        if (!ev || ev.status !== 'scheduled') return ev;
        if (getNowByServerClock() < (ev.startAt || 0)) return ev;
        return { ...ev, status: 'active', activatedAt: Date.now(), nextTeam: 'red', teams: null };
    });

    if (tx.committed) {
        epicPaintHasDismissedStart = false;
        await db.ref('epic_paint').set({ strokes: null, participants: null, rewarded: null });
    }
}

async function failExpiredEventIfNeeded() {
    const active = queuedGameEvents.find(ev => ev.status === 'active' && [EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID].includes(ev.id));
    if (!active?.key) return;
    if (getNowByServerClock() < (active.endAt || 0)) return;

    const tx = await db.ref(`game_events/${active.key}`).transaction(ev => {
        if (!ev || ![EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID].includes(ev.id) || ev.status !== 'active') return ev;
        if (getNowByServerClock() < (ev.endAt || 0)) return ev;
        return { ...ev, status: 'failed', failedAt: Date.now(), resultText: 'Игроки не успели выполнить цель события' };
    });
    if (tx.committed) {
        await postEpicEventSummary({ ...(tx.snapshot.val() || {}), failedAt: Date.now(), activatedAt: active.activatedAt || active.startAt }, false, 0);
    }
}

function syncGameEvents() {
    if (gameEventsRef) gameEventsRef.off();
    gameEventsRef = db.ref('game_events');
    gameEventsRef.on('value', snap => {
        const events = [];
        snap.forEach(item => {
            const value = item.val() || {};
            events.push({ key: item.key, ...value });
        });
        queuedGameEvents = events.sort((a, b) => (a.startAt || 0) - (b.startAt || 0));

        const active = queuedGameEvents.find(ev => ev.status === 'active') || null;
        const celebration = queuedGameEvents
            .filter(ev => [EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID].includes(ev.id) && ev.status === 'completed' && (ev.celebrationUntil || 0) > getNowByServerClock())
            .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))[0] || null;

        currentGameEvent = active || celebration;
        currentGameEventKey = (active || celebration)?.key || null;
        if (!currentGameEvent || ![EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID].includes(currentGameEvent.id) || currentGameEvent.status !== 'active') {
            epicPaintHasDismissedStart = false;
        }

        updateEventUiState();
        updateAdminEventStatus();
        activateScheduledEventIfNeeded();
        maybeFinalizeCompletedEventByEndTime();
        failExpiredEventIfNeeded();
    });

    if (epicPaintStrokesRef) epicPaintStrokesRef.off();
    epicPaintStrokesRef = db.ref('epic_paint/strokes');
    epicPaintStrokesRef.on('value', snap => {
        const strokes = [];
        snap.forEach(s => {
            const v = s.val();
            if (v) strokes.push(v);
        });
        epicPaintStrokes = strokes;
        drawEpicPaint();
    });

    db.ref('whitelist').on('value', snap => {
        window.cachedWhitelistData = snap.val() || {};
    });
}

function updateAdminEventStatus() {
    const el = document.getElementById('admin-event-status');
    if (!el) return;

    const active = queuedGameEvents.find(ev => ev.status === 'active');
    const scheduled = queuedGameEvents.filter(ev => ev.status === 'scheduled').slice(0, MAX_SCHEDULED_EVENTS);

    const activeLine = active
        ? `Активно: ${active.name || active.id} · до ${new Date(active.endAt || 0).toLocaleString('ru-RU')}`
        : 'Активного события сейчас нет.';

    const scheduledLines = scheduled.length
        ? scheduled.map((ev, idx) => {
            const start = new Date(ev.startAt || 0).toLocaleString('ru-RU');
            const duration = ev.durationMins || 0;
            return `${idx + 1}) ${ev.name || ev.id} · старт ${start} · ${duration} мин <button onclick="adminCancelScheduledEvent('${ev.key}')" style="margin-left:6px; border:1px solid #ef5350; color:#c62828; background:#fff5f5; border-radius:8px; padding:2px 6px; font-size:11px;">Отменить</button>`;
        }).join('<br>')
        : 'Запланированных событий нет.';

    el.innerHTML = `${activeLine}<br><br><b>Запланировано (${scheduled.length}/${MAX_SCHEDULED_EVENTS}):</b><br>${scheduledLines}`;
}
