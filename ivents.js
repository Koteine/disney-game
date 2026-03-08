// Логика игровых событий, вынесенная из index.html
let epicPaintStrokeMap = {};
let epicPaintRenderRaf = null;
let lastParticipantUpdateByUid = {};
let isCompletedEventRewardSyncInProgress = false;
const WALL_BATTLE_COVERAGE_TARGET = 75;

function scheduleEpicPaintRender() {
    if (epicPaintRenderRaf) return;
    epicPaintRenderRaf = requestAnimationFrame(() => {
        epicPaintRenderRaf = null;
        drawEpicPaint();
    });
}

function getPlayerColorByUid(uid) {
    const entry = Object.entries(window.cachedWhitelistData || {}).find(([id]) => Number(id) === Number(uid));
    const charIndex = entry?.[1]?.charIndex;
    if (Number.isInteger(charIndex)) return charColors[charIndex] || '#ff007f';
    if (Number(uid) === currentUserId && Number.isInteger(myIndex)) return charColors[myIndex] || '#ff007f';
    return '#ff007f';
}

function getWallBattleTeamColor(team) { return team === 'blue' ? '#1e88e5' : '#e53935'; }

function getActivePaintEvent() {
    return queuedGameEvents.find(ev => ev.status === 'active' && [EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID].includes(ev.id)) || null;
}

async function joinCurrentEventTeam() {
    const activeEvent = getActivePaintEvent();
    const eventKey = activeEvent?.key || currentGameEventKey;
    if (!eventKey || !activeEvent || activeEvent.status !== 'active') return null;

    currentGameEvent = activeEvent;
    currentGameEventKey = eventKey;

    const existing = (await db.ref(`game_events/${eventKey}/teams/${currentUserId}`).once('value')).val();
    if (existing?.team) return existing.team;
    let assigned = null;
    await db.ref(`game_events/${eventKey}`).transaction(ev => {
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
        const activeEvent = getActivePaintEvent();
        if (!activeEvent) return;
        currentGameEvent = activeEvent;
        currentGameEventKey = activeEvent.key;
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
    const activeEvent = getActivePaintEvent();
    if (!activeEvent?.key) return;

    const uid = currentUserId;
    currentGameEvent = activeEvent;
    currentGameEventKey = activeEvent.key;
    const teamInfo = ((await db.ref(`game_events/${activeEvent.key}/teams/${uid}`).once('value')).val() || {});
    const team = teamInfo.team || 'red';
    const color = activeEvent.id === WALL_BATTLE_EVENT_ID ? getWallBattleTeamColor(team) : getPlayerColorByUid(uid);
    const now = Date.now();
    if (!lastParticipantUpdateByUid[uid] || now - lastParticipantUpdateByUid[uid] > 4000) {
        await db.ref(`epic_paint/participants/${uid}`).update({ uid, color, team, updatedAt: now });
        lastParticipantUpdateByUid[uid] = now;
    }
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
        progressEl.innerText = `Цель команды: ${WALL_BATTLE_COVERAGE_TARGET}% холста · красные: ${redCoverage.toFixed(1)}% · синие: ${blueCoverage.toFixed(1)}%`;
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
        if (!ev || ev.id !== EPIC_PAINT_EVENT_ID || ev.status !== 'active') return ev;
        return {
            ...ev,
            status: 'completed',
            completedAt: Date.now(),
            resultText: 'Игроки успели закрасить поле на 95%+' 
        };
    });
    if (!tx.committed) return;

    const rewardedPlayersCount = await grantEpicPaintRewards();
    await eventRef.child('rewardState').set({ status: 'done', finishedAt: Date.now(), rewardedPlayersCount, workerUid: currentUserId || null });
    await postEpicEventSummary({ ...(tx.snapshot.val() || {}), completedAt: Date.now(), activatedAt: currentGameEvent?.activatedAt || currentGameEvent?.startAt }, true, rewardedPlayersCount);
}

async function grantEpicPaintRewards(eventKey = currentGameEventKey) {
    if (!eventKey) return 0;
    const [teamsSnap, whitelistSnap, rewardedSnap] = await Promise.all([
        db.ref(`game_events/${eventKey}/teams`).once('value'),
        db.ref('whitelist').once('value'),
        db.ref(`epic_paint/rewarded/${eventKey}`).once('value')
    ]);

    const teams = teamsSnap.val() || {};
    const whitelist = whitelistSnap.val() || {};
    const alreadyRewarded = rewardedSnap.val() || {};
    const participantUids = Object.keys(teams).filter(uid => /^\d+$/.test(uid));
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
        await db.ref(`epic_paint/rewarded/${eventKey}/${uidKey}`).set(true);
    }

    return rewardedCount;
}

async function maybeFinalizeWallBattleSuccess(coverage, redCoverage, blueCoverage) {
    if (!currentGameEvent || currentGameEvent.id !== WALL_BATTLE_EVENT_ID || currentGameEvent.status !== 'active') return;
    if (!currentGameEventKey) return;
    if (redCoverage < WALL_BATTLE_COVERAGE_TARGET && blueCoverage < WALL_BATTLE_COVERAGE_TARGET) return;

    const winnerTeam = redCoverage >= blueCoverage ? 'red' : 'blue';
    const eventRef = db.ref(`game_events/${currentGameEventKey}`);
    const tx = await eventRef.transaction(ev => {
        if (!ev || ev.id !== WALL_BATTLE_EVENT_ID || ev.status !== 'active') return ev;
        return { ...ev, status: 'completed', completedAt: Date.now(), winnerTeam, resultText: `Победила команда ${winnerTeam}` };
    });
    if (!tx.committed) return;

    const rewardedPlayersCount = await grantWallBattleRewards(winnerTeam, currentGameEventKey);
    await eventRef.child('rewardState').set({ status: 'done', finishedAt: Date.now(), rewardedPlayersCount, workerUid: currentUserId || null });
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
    const rewardedPlayersCount = await grantEpicPaintRewards(active.key);
    await eventRef.child('rewardState').set({ status: 'done', finishedAt: Date.now(), rewardedPlayersCount, workerUid: currentUserId || null });

    await postEpicEventSummary({ ...snapshotEvent, completedAt: Date.now(), activatedAt: snapshotEvent.activatedAt || snapshotEvent.startAt }, true, rewardedPlayersCount);
}

async function grantWallBattleRewards(winnerTeam, eventKey = currentGameEventKey) {
    if (!eventKey) return 0;
    const [teamsSnap, whitelistSnap, rewardedSnap] = await Promise.all([
        db.ref(`game_events/${eventKey}/teams`).once('value'),
        db.ref('whitelist').once('value'),
        db.ref(`epic_paint/rewarded/${eventKey}`).once('value')
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
        const awarded = await claimSequentialTickets(1);
        if (!awarded?.length) continue;
        await addInventoryItemForUser(uid, 'magnifier', 1);
        await db.ref('tickets_archive').push({ owner, userId: uid, ticket: awarded[0], taskIdx: -1, round: currentRoundNum, cell: 0, cellIdx: -1, isEventReward: true, eventId: WALL_BATTLE_EVENT_ID, taskLabel: 'Награда за победу команды в событии «Стенка на стенку»', archivedAt: Date.now(), excluded: false });
        await db.ref(`epic_paint/rewarded/${eventKey}/${uidKey}`).set(true);
        rewardedCount += 1;
    }
    return rewardedCount;
}

function maybeNotifyWallBattleOutcome(eventData) {
    if (!eventData || eventData.id !== WALL_BATTLE_EVENT_ID || !eventData.key || !eventData.winnerTeam) return;
    if (!Number(currentUserId)) return;
    const key = `wall_battle_outcome_notified_${eventData.key}`;
    if (window[key]) return;
    db.ref(`game_events/${eventData.key}/teams/${currentUserId}`).once('value').then(snap => {
        const myTeam = snap.val()?.team;
        if (!myTeam) return;
        window[key] = true;
        if (typeof showPlayerNotification === 'function') {
            showPlayerNotification({
                id: `wall-battle-outcome-${eventData.key}`,
                text: myTeam === eventData.winnerTeam
                    ? '🏆 Ваша команда победила в событии «Стенка на стенку»! Вы получили 1 билет и 1 Лупу.'
                    : '😿 В этот раз победила другая команда. Спасибо за участие в событии «Стенка на стенку»!'
            });
        }
    }).catch(() => {});
}

function openEventSpace() {
    const navBtn = document.getElementById('nav-event-btn');
    if (navBtn) switchTab('tab-event', navBtn);
}

function backToGameFromEvent() {
    const gameBtn = document.querySelector(".nav-item[onclick*=\"tab-game\"]");
    if (gameBtn) switchTab('tab-game', gameBtn);
}



function showEventRewardNotification(text, idSuffix = 'generic') {
    if (typeof showPlayerNotification === 'function') {
        showPlayerNotification({ id: `event-reward-${idSuffix}`, text });
    } else {
        alert(text);
    }
}

async function claimManualEventReward(eventKey) {
    if (!eventKey || !Number(currentUserId)) return;
    const eventSnap = await db.ref(`game_events/${eventKey}`).once('value');
    const eventData = eventSnap.val() || {};
    if (!eventData || ![EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID].includes(eventData.id) || eventData.status !== 'completed') {
        showEventRewardNotification('Событие уже недоступно для получения награды.', `${eventKey}-unavailable`);
        return;
    }

    const uidKey = String(currentUserId);
    const rewardedRef = db.ref(`epic_paint/rewarded/${eventKey}/${uidKey}`);
    const alreadyRewarded = (await rewardedRef.once('value')).val();
    if (alreadyRewarded) {
        showEventRewardNotification('Награда уже была получена ранее.', `${eventKey}-already`);
        return;
    }

    const [whitelistSnap, teamsSnap] = await Promise.all([
        db.ref(`whitelist/${uidKey}`).once('value'),
        db.ref(`game_events/${eventKey}/teams/${uidKey}`).once('value')
    ]);

    const user = whitelistSnap.val() || {};
    const owner = Number.isInteger(user.charIndex) ? user.charIndex : null;

    if (eventData.id === WALL_BATTLE_EVENT_ID) {
        const myTeam = teamsSnap.val()?.team;
        if (!myTeam || myTeam !== eventData.winnerTeam) {
            showEventRewardNotification('Эта награда доступна только игрокам победившей команды.', `${eventKey}-not-winner`);
            return;
        }
        const awarded = await claimSequentialTickets(1);
        if (!awarded?.length) {
            showEventRewardNotification(`Лимит билетиков (${MAX_TICKETS}) уже достигнут в этой игре.`, `${eventKey}-no-tickets`);
            return;
        }
        await addInventoryItemForUser(Number(currentUserId), 'magnifier', 1);
        await db.ref('tickets_archive').push({
            owner,
            userId: Number(currentUserId),
            ticket: awarded[0],
            taskIdx: -1,
            round: currentRoundNum,
            cell: 0,
            cellIdx: -1,
            isEventReward: true,
            eventId: WALL_BATTLE_EVENT_ID,
            taskLabel: 'Награда за победу команды в событии «Стенка на стенку»',
            archivedAt: Date.now(),
            excluded: false
        });
        await rewardedRef.set(true);
        showEventRewardNotification('Награда получена: 1 билет и 1 Лупа зачислены.', `${eventKey}-claimed`);
        return;
    }

    const hasParticipation = Boolean(teamsSnap.val()?.team);
    if (!hasParticipation) {
        showEventRewardNotification('Награда доступна только участникам события.', `${eventKey}-no-participation`);
        return;
    }

    const awarded = await claimSequentialTickets(2);
    if (!awarded?.length || awarded.length < 2) {
        showEventRewardNotification(`Лимит билетиков (${MAX_TICKETS}) уже достигнут в этой игре.`, `${eventKey}-no-tickets`);
        return;
    }
    await db.ref('tickets_archive').push({
        owner,
        userId: Number(currentUserId),
        ticket: `${awarded[0]} и ${awarded[1]}`,
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
    await rewardedRef.set(true);
    showEventRewardNotification('Награда получена: 2 билета зачислены.', `${eventKey}-claimed`);
}

window.claimManualEventReward = claimManualEventReward;
function updateEventUiState() {
    const startAlert = document.getElementById('event-start-alert');
    const successAlert = document.getElementById('event-success-alert');
    const failAlert = document.getElementById('event-fail-alert');
    const eventTitle = document.getElementById('event-space-title');
    const navEventBtn = document.getElementById('nav-event-btn');
    const eventTimerEl = document.getElementById('event-space-timer');
    const activeEvent = getActivePaintEvent();
    const celebrationEvent = queuedGameEvents
        .filter(ev => [EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID].includes(ev.id) && ev.status === 'completed' && (ev.celebrationUntil || 0) > getNowByServerClock())
        .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))[0] || null;
    const visibleEvent = activeEvent || celebrationEvent;

    const isEventType = visibleEvent && [EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID].includes(visibleEvent.id);
    const isActive = Boolean(activeEvent);
    const isCelebration = isEventType && visibleEvent.status === 'completed' && (visibleEvent.celebrationUntil || 0) > getNowByServerClock();

    if (visibleEvent) {
        currentGameEvent = visibleEvent;
        currentGameEventKey = visibleEvent.key;
    }

    if (navEventBtn) navEventBtn.style.display = (isActive || isCelebration) ? 'flex' : 'none';
    if (eventTitle) {
        if (isActive) {
            eventTitle.innerText = `Активно событие: ${activeEvent.name || activeEvent.id}`;
        } else if (isCelebration) {
            eventTitle.innerText = `Событие завершено: ${visibleEvent.name || visibleEvent.id}`;
        } else {
            eventTitle.innerText = 'Событие не активно';
        }
    }

    if (eventTimerEl) {
        if (isActive) {
            const leftMs = Math.max(0, (activeEvent.endAt || 0) - getNowByServerClock());
            const mins = Math.floor(leftMs / 60000);
            const secs = Math.floor((leftMs % 60000) / 1000);
            eventTimerEl.innerText = `До конца: ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
            eventTimerEl.style.display = 'block';
        } else {
            eventTimerEl.style.display = 'none';
        }
    }

    if (isActive) {
        startAlert.style.display = 'block';
        startAlert.classList.add('epic');
        const extra = activeEvent.id === WALL_BATTLE_EVENT_ID
            ? '<div class="event-sub">Команды распределяются по очереди: красные, затем синие.</div>'
            : '';
        startAlert.innerHTML = `
            <div class="event-title">🎨 ${activeEvent.name || 'Событие'} уже в разгаре!</div>
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
        const rewardBtn = latestCompleted?.key
            ? `<button class="event-join-btn" style="margin-top:8px; background:linear-gradient(135deg,#2e7d32,#66bb6a);" onclick="claimManualEventReward('${latestCompleted.key}')">🎁 Получить заслуженную награду</button>`
            : '';
        successAlert.innerHTML = latestCompleted.id === WALL_BATTLE_EVENT_ID
            ? `🏁 Командная битва завершена! Победители получают 1 билет и 1 Лупу.${rewardBtn}`
            : `🎆 Событие прошло круто! Участники получают по 2 билетика.${rewardBtn}`;
        launchCelebrationFireworks(30000);
        playFireworksSound();
        setTimeout(() => playFireworksSound(), 9000);
        setTimeout(() => playFireworksSound(), 18000);
        lastCompletedEpicEventKeyShown = latestCompleted.key;
        setTimeout(() => { if (successAlert && !isCelebration) successAlert.style.display = 'none'; }, 30000);
        maybeNotifyWallBattleOutcome(latestCompleted);
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
        epicPaintStrokeMap = {};
        epicPaintStrokes = [];
        lastParticipantUpdateByUid = {};
        await db.ref('epic_paint').set({ strokes: null, participants: null, rewarded: null });
    }
}


async function maybeGrantCompletedEventRewardsIfMissing() {
    if (isCompletedEventRewardSyncInProgress) return;
    isCompletedEventRewardSyncInProgress = true;

    try {
        const completedEvents = queuedGameEvents
            .filter(ev => [EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID].includes(ev.id) && ev.status === 'completed' && ev.key)
            .sort((a, b) => (a.completedAt || 0) - (b.completedAt || 0));

        for (const eventData of completedEvents) {
            const eventRef = db.ref(`game_events/${eventData.key}`);
            const now = Date.now();
            const tx = await eventRef.transaction(ev => {
            if (!ev || ![EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID].includes(ev.id) || ev.status !== 'completed') return ev;
            const rewardState = ev.rewardState || {};
            if (rewardState.status === 'done') return ev;
            if (rewardState.status === 'processing' && (now - (Number(rewardState.startedAt) || 0)) < 20000) return ev;
            return {
                ...ev,
                rewardState: {
                    status: 'processing',
                    startedAt: now,
                    workerUid: currentUserId || null
                }
            };
            });

            if (!tx.committed) continue;

            try {
            let rewardedPlayersCount = 0;
            if (eventData.id === WALL_BATTLE_EVENT_ID) {
                const latest = (await eventRef.once('value')).val() || {};
                const winnerTeam = latest.winnerTeam || eventData.winnerTeam;
                if (winnerTeam) rewardedPlayersCount = await grantWallBattleRewards(winnerTeam, eventData.key);
            } else {
                rewardedPlayersCount = await grantEpicPaintRewards(eventData.key);
            }

            await eventRef.child('rewardState').set({
                status: 'done',
                finishedAt: Date.now(),
                rewardedPlayersCount,
                workerUid: currentUserId || null
            });
            } catch (err) {
                await eventRef.child('rewardState').set({
                    status: 'failed',
                    failedAt: Date.now(),
                    error: String(err?.message || err || 'unknown'),
                    workerUid: currentUserId || null
                });
            }
        }
    } finally {
        isCompletedEventRewardSyncInProgress = false;
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
        const latestWallBattleCompleted = queuedGameEvents
            .filter(ev => ev.id === WALL_BATTLE_EVENT_ID && ev.status === 'completed')
            .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))[0] || null;
        maybeNotifyWallBattleOutcome(latestWallBattleCompleted);
        if (!currentGameEvent || ![EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID].includes(currentGameEvent.id) || currentGameEvent.status !== 'active') {
            epicPaintHasDismissedStart = false;
        }

        updateEventUiState();
        updateAdminEventStatus();
        activateScheduledEventIfNeeded();
        maybeFinalizeCompletedEventByEndTime();
        failExpiredEventIfNeeded();
        maybeGrantCompletedEventRewardsIfMissing();
    });

    if (epicPaintStrokesRef) epicPaintStrokesRef.off();
    epicPaintStrokeMap = {};
    epicPaintStrokes = [];
    epicPaintStrokesRef = db.ref('epic_paint/strokes');
    epicPaintStrokesRef.on('child_added', snap => {
        const v = snap.val();
        if (!v) return;
        epicPaintStrokeMap[snap.key] = v;
        epicPaintStrokes.push(v);
        scheduleEpicPaintRender();
    });
    epicPaintStrokesRef.on('child_changed', snap => {
        const v = snap.val();
        if (!v) return;
        epicPaintStrokeMap[snap.key] = v;
        epicPaintStrokes = Object.values(epicPaintStrokeMap);
        scheduleEpicPaintRender();
    });
    epicPaintStrokesRef.on('child_removed', snap => {
        delete epicPaintStrokeMap[snap.key];
        epicPaintStrokes = Object.values(epicPaintStrokeMap);
        scheduleEpicPaintRender();
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
