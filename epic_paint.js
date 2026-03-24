// Epic Paint event module (single active source)
(function () {
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
            if (!INVENTORY_ITEM_KEYS.includes(itemType) || !itemTypes?.[itemType]) return;
            await db.ref(`whitelist/${uid}/inventory/${itemType}`).transaction(v => (Number(v) || 0) + count);
        }

        function setupEpicPaintCanvas() {
            const canvas = document.getElementById('epic-paint-canvas');
            if (!canvas || canvas.dataset.ready === '1') return;
            canvas.dataset.ready = '1';
            const isAdminUser = () => Number(currentUserId) === Number(ADMIN_ID);
          window.isAdminUser = isAdminUser;
          if (typeof formatMoscowDateTime === 'function') window.formatMoscowDateTime = formatMoscowDateTime;
          if (typeof parseMoscowDateTimeLocalInput === 'function') window.parseMoscowDateTimeLocalInput = parseMoscowDateTimeLocalInput;
          if (typeof toMoscowDateTimeLocalInput === 'function') window.toMoscowDateTimeLocalInput = toMoscowDateTimeLocalInput;

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
                if (isAdminUser()) return;
                evt.preventDefault();
                const team = await joinCurrentEventTeam();
                if (!team) return;
                await prepareEpicPaintRealtimeContext();
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

            const end = () => {
                epicPaintDrawState.drawing = false;
                flushEpicPaintStrokes(true).catch(err => console.warn('Failed to flush epic paint strokes on end', err));
            };

            canvas.addEventListener('mousedown', begin);
            canvas.addEventListener('mousemove', move);
            canvas.addEventListener('mouseup', end);
            canvas.addEventListener('mouseleave', end);
            canvas.addEventListener('touchstart', begin, { passive: false });
            canvas.addEventListener('touchmove', move, { passive: false });
            canvas.addEventListener('touchend', end);
            canvas.addEventListener('touchcancel', end);
        }

        async function prepareEpicPaintRealtimeContext() {
            if (!currentGameEventKey || !currentGameEvent || ![EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID].includes(currentGameEvent.id)) return null;
            const uid = currentUserId;
            if (!uid || Number(uid) === Number(ADMIN_ID)) return null;
            if (epicPaintRealtimeContext.preparedForEventKey === currentGameEventKey) return epicPaintRealtimeContext;
            const teamInfo = ((await db.ref(`game_events/${currentGameEventKey}/teams/${uid}`).once('value')).val() || {});
            const team = teamInfo.team || 'red';
            const color = currentGameEvent.id === WALL_BATTLE_EVENT_ID ? getWallBattleTeamColor(team) : getPlayerColorByUid(uid);
            epicPaintRealtimeContext = { team, color, preparedForEventKey: currentGameEventKey, touched: false };
            return epicPaintRealtimeContext;
        }

        async function flushEpicPaintStrokes(force = false) {
            if (!epicPaintPendingStrokes.length || !currentGameEventKey) return;
            if (!force && Number(currentUserId) === Number(ADMIN_ID)) return;
            const pending = epicPaintPendingStrokes;
            epicPaintPendingStrokes = [];
            if (epicPaintFlushTimer) {
                clearTimeout(epicPaintFlushTimer);
                epicPaintFlushTimer = null;
            }

            const context = await prepareEpicPaintRealtimeContext();
            if (!context) return;
            const uid = currentUserId;
            const now = Date.now();
            const updates = {};
            pending.forEach(stroke => {
                const strokeKey = db.ref('epic_paint/strokes').push().key;
                updates[`epic_paint/strokes/${strokeKey}`] = {
                    ...stroke,
                    color: context.color,
                    uid,
                    team: context.team,
                    eventKey: currentGameEventKey,
                    eventId: currentGameEvent?.id || EPIC_PAINT_EVENT_ID,
                    at: now
                };
            });
            if (!context.touched) {
                updates[`epic_paint/participants/${uid}`] = { uid, color: context.color, team: context.team, updatedAt: now };
                context.touched = true;
            } else {
                updates[`epic_paint/participants/${uid}/updatedAt`] = now;
            }
            updates[`epic_paint/participants_by_event/${currentGameEventKey}/${uid}`] = {
                uid,
                color: context.color,
                team: context.team,
                eventId: currentGameEvent?.id || EPIC_PAINT_EVENT_ID,
                updatedAt: now
            };
            await db.ref().update(updates);
        }

        function queueEpicPaintFlush() {
            if (epicPaintFlushTimer) return;
            epicPaintFlushTimer = setTimeout(() => {
                flushEpicPaintStrokes(false).catch(err => console.warn('Failed to flush epic paint strokes', err));
            }, 120);
        }

        function drawEpicPaintStroke(ctx, stroke) {
            if (!ctx || !stroke) return;
            ctx.beginPath();
            ctx.lineWidth = 16;
            ctx.lineCap = 'round';
            ctx.strokeStyle = stroke.color || '#ff007f';
            ctx.moveTo(stroke.x1 || 0, stroke.y1 || 0);
            ctx.lineTo(stroke.x2 || 0, stroke.y2 || 0);
            ctx.stroke();
        }

        async function pushEpicPaintStroke(x1, y1, x2, y2) {
            if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) return;
            if (Number(currentUserId) === Number(ADMIN_ID)) return;
            const context = await prepareEpicPaintRealtimeContext();
            if (!context) return;

            const stroke = { x1, y1, x2, y2, color: context.color, uid: currentUserId, team: context.team, at: Date.now() };
            const canvas = document.getElementById('epic-paint-canvas');
            const ctx = canvas?.getContext('2d');
            drawEpicPaintStroke(ctx, stroke);

            epicPaintStrokes.push(stroke);
            epicPaintCoverageCache.strokesCount = -1;
            if (!epicPaintRenderQueued) {
                epicPaintRenderQueued = true;
                requestAnimationFrame(() => {
                    epicPaintRenderQueued = false;
                    drawEpicPaint();
                });
            }

            epicPaintPendingStrokes.push({ x1, y1, x2, y2 });
            queueEpicPaintFlush();
        }

        function drawEpicPaint() {
            const canvas = document.getElementById('epic-paint-canvas');
            const progressEl = document.getElementById('epic-paint-progress');
            if (!canvas || !progressEl) return;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            (epicPaintStrokes || []).forEach(stroke => drawEpicPaintStroke(ctx, stroke));

            const coverage = calculateEpicPaintCoverage(canvas);
            const redCoverage = calculateTeamCoverage(epicPaintStrokes, 'red');
            const blueCoverage = calculateTeamCoverage(epicPaintStrokes, 'blue');
            if (currentGameEvent?.id === WALL_BATTLE_EVENT_ID) {
                progressEl.innerText = `Общий закрас: ${coverage.toFixed(1)}% · красные: ${redCoverage.toFixed(1)}% · синие: ${blueCoverage.toFixed(1)}%`;
                maybeFinalizeWallBattleSuccess(coverage, redCoverage, blueCoverage);
            } else {
                progressEl.innerText = `Закрашено: ${coverage.toFixed(1)}% · цель ${EPIC_PAINT_COVERAGE_TARGET}%`;
                maybeFinalizeEpicPaintSuccess(coverage);
            }
        }

        function calculateEpicPaintCoverage(canvas, { force = false } = {}) {
            const strokesCount = Array.isArray(epicPaintStrokes) ? epicPaintStrokes.length : 0;
            if (!force && epicPaintCoverageCache.strokesCount === strokesCount && (Date.now() - epicPaintCoverageCache.computedAt) < 250) {
                return Number(epicPaintCoverageCache.value) || 0;
            }
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            const sample = 8;
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let painted = 0;
            let total = 0;
            for (let y = 0; y < canvas.height; y += sample) {
                for (let x = 0; x < canvas.width; x += sample) {
                    const idx = (y * canvas.width + x) * 4;
                    const r = img[idx], g = img[idx + 1], b = img[idx + 2];
                    total += 1;
                    if (!(r > 246 && g > 246 && b > 246)) painted += 1;
                }
            }
            const value = total ? (painted / total) * 100 : 0;
            epicPaintCoverageCache = { value, computedAt: Date.now(), strokesCount };
            return value;
        }


        function calculateTeamCoverage(strokes, team) {
            const total = (strokes || []).length || 1;
            const own = (strokes || []).filter(s => (s.team || 'red') === team).length;
            return (own / total) * 100;
        }

        function formatDurationMinutesRu(totalMinutes) {
            const mins = Math.max(1, Math.round(Number(totalMinutes) || 0));
            const hours = Math.floor(mins / 60);
            const remMins = mins % 60;
            if (!hours) return `${mins} мин`;
            return remMins ? `${hours} ч ${remMins} мин` : `${hours} ч`;
        }

        function formatCountdownMs(ms) {
            const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;
            if (hours > 0) return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }

        function resizeEpicPaintCanvasForPhone() {
            const canvas = document.getElementById('epic-paint-canvas');
            if (!canvas) return;
            const controlsReserve = 290;
            const availableHeight = Math.max(220, window.innerHeight - controlsReserve);
            canvas.style.width = '100%';
            canvas.style.height = `${availableHeight}px`;
        }

        function updateEpicPaintTimerDisplay() {
            const timerEl = document.getElementById('epic-paint-timer');
            if (!timerEl) return;
            const isActive = currentGameEvent && currentGameEvent.status === 'active' && [EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID].includes(currentGameEvent.id);
            if (!isActive) {
                timerEl.textContent = '⏳ До конца: —';
                return;
            }
            const leftMs = Number(currentGameEvent.endAt || 0) - Date.now();
            timerEl.textContent = `⏳ До конца: ${formatCountdownMs(leftMs)}`;
        }

        async function postEpicEventSummary(eventData, isSuccess, rewardedPlayersCount) {
            if (!eventData?.key) return;
            const flagPath = `game_events/${eventData.key}/summaryPosted`;
            const summaryTx = await db.ref(flagPath).transaction(v => v || { at: Date.now(), status: isSuccess ? 'completed' : 'failed' });
            if (!summaryTx.committed) return;
            if (eventData.id !== EPIC_PAINT_EVENT_ID) {
                const statusText = isSuccess ? 'успешно завершено' : 'завершено без выполнения цели';
                await postNews(`🎨 Прошло событие «${eventData.name || eventData.id}» (${statusText}).`, { uniqueParts: { type: 'event_summary', eventId: eventData.id || 'unknown', sourceId: eventData.key, actionId: `summary_${isSuccess ? 'ok' : 'fail'}` }, eventType: 'event_summary', sourceId: eventData.key });
                return;
            }
            const startAt = eventData.activatedAt || eventData.startAt || Date.now();
            const endAt = eventData.completedAt || eventData.failedAt || Date.now();
            const startText = new Date(startAt).toLocaleString('ru-RU');
            const endText = new Date(endAt).toLocaleString('ru-RU');
            const statusText = isSuccess ? 'успешно завершено' : 'завершено без выполнения цели';
            const rewardsText = isSuccess
                ? `Награды получили: ${Number(rewardedPlayersCount) || 0}.`
                : 'Награды не выдавались.';
            await postNews(`🎨 Прошло событие «Эпичный раскрас» (${statusText}). Начало: ${startText}. Завершение: ${endText}. ${rewardsText}`, { uniqueParts: { type: 'event_summary', eventId: EPIC_PAINT_EVENT_ID, sourceId: eventData.key, actionId: `summary_${isSuccess ? 'ok' : 'fail'}` }, eventType: 'event_summary', sourceId: eventData.key });
        }

        async function maybeFinalizeEpicPaintSuccess(coverage) {
            if (!currentGameEvent || currentGameEvent.id !== EPIC_PAINT_EVENT_ID || currentGameEvent.status !== 'active') return;
            if (!currentGameEventKey) return;
            if (coverage < EPIC_PAINT_COVERAGE_TARGET) return;

            await flushEpicPaintStrokes(true);
            const strokesSnap = await db.ref('epic_paint/strokes').once('value');
            const strokesForEvent = [];
            strokesSnap.forEach((row) => {
                const stroke = row.val() || {};
                const strokeEventKey = String(stroke.eventKey || '').trim();
                if (!strokeEventKey || strokeEventKey === currentGameEventKey) strokesForEvent.push(stroke);
            });

            const canvas = document.createElement('canvas');
            canvas.width = 1000;
            canvas.height = 2000;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            strokesForEvent.forEach(stroke => drawEpicPaintStroke(ctx, stroke));
            const syncedCoverage = calculateEpicPaintCoverage(canvas, { force: true });
            if (syncedCoverage < EPIC_PAINT_COVERAGE_TARGET) return;

            const eventRef = db.ref(`game_events/${currentGameEventKey}`);
            const tx = await eventRef.transaction(ev => {
                if (!ev || ev.id !== EPIC_PAINT_EVENT_ID || ev.status !== 'active') return ev;
                return {
                    ...ev,
                    status: 'completed',
                    completedAt: Date.now(),
                    resultText: 'Игроки успели закрасить поле на 95%+',
                    completionPosted: ev.completionPosted || null,
                    rewardsPosted: ev.rewardsPosted || null,
                    notifyPosted: ev.notifyPosted || null
                };
            });
            if (!tx.committed) return;

            const finalizedEvent = { ...(tx.snapshot.val() || {}), key: currentGameEventKey, completedAt: Date.now(), activatedAt: currentGameEvent?.activatedAt || currentGameEvent?.startAt };
            const rewardResult = await grantEpicPaintRewards(finalizedEvent);
            await postEpicEventSummary(finalizedEvent, true, Number(rewardResult?.rewardedCount || 0));
        }

        async function maybeShowEpicPaintSuccessNotification(eventData = null) {
            const src = eventData || currentGameEvent;
            const eventKey = String(src?.key || currentGameEventKey || '');
            if (!eventKey || !src) return;
            if (src.id !== EPIC_PAINT_EVENT_ID || src.status !== 'completed') return;
            const ackPath = `game_events/${eventKey}/successAcknowledged/${currentUserId}`;
            const ackSnap = await db.ref(ackPath).once('value');
            if (ackSnap.exists()) return;

            const text = '🎨 «Эпичный раскрас» завершён успешно! Цель 95% достигнута!✨';
            const ok = confirm(text);
            if (!ok) return;
            await db.ref(ackPath).set({ at: Date.now() });
        }

        async function grantEpicPaintRewards(eventData = null) {
            const eventKey = String(eventData?.key || currentGameEventKey || '').trim();
            if (!eventKey) return { rewardedCount: 0, rewardedUids: [], failedUids: [] };

            const [participantsByEventSnap, participantsSnap, strokesSnap, whitelistSnap] = await Promise.all([
                db.ref(`epic_paint/participants_by_event/${eventKey}`).once('value'),
                db.ref('epic_paint/participants').once('value'),
                db.ref('epic_paint/strokes').once('value'),
                db.ref('whitelist').once('value')
            ]);

            const whitelist = whitelistSnap.val() || {};
            const participantUidSet = new Set();

            participantsByEventSnap.forEach(p => participantUidSet.add(String(p.key)));
            if (!participantUidSet.size) {
                participantsSnap.forEach(p => participantUidSet.add(String(p.key)));
                strokesSnap.forEach(strokeSnap => {
                    const stroke = strokeSnap.val() || {};
                    const strokeEventKey = String(stroke.eventKey || '').trim();
                    if (strokeEventKey && strokeEventKey !== eventKey) return;
                    if (stroke.uid !== undefined && stroke.uid !== null) participantUidSet.add(String(stroke.uid));
                });
            }

            const participantUids = Array.from(participantUidSet).filter(uid => /^\d+$/.test(uid));
            console.info('[epic_paint] reward finalize participants collected', { eventKey, participants: participantUids.length });
            if (!participantUids.length) return { rewardedCount: 0, rewardedUids: [], failedUids: [] };

            let rewardedCount = 0;
            const rewardedUids = [];
            const failedUids = [];
            for (const uidKey of participantUids) {
                const lockTx = await db.ref(`epic_paint/rewarded/${eventKey}/${uidKey}`).transaction(v => v || { at: Date.now() });
                if (!lockTx.committed) continue;

                const uid = Number(uidKey);
                const user = whitelist[uidKey] || whitelist[uid] || {};
                const parsedOwner = Number(user?.charIndex);
                const owner = Number.isInteger(parsedOwner) ? parsedOwner : -1;

                const awarded = await claimSequentialTickets(1);
                if (!Array.isArray(awarded) || !awarded[0]) {
                    console.warn('[epic_paint] skipped reward: ticket pool exhausted or unavailable', { eventKey, uid: uidKey });
                    await db.ref(`epic_paint/rewarded/${eventKey}/${uidKey}`).remove();
                    failedUids.push(uidKey);
                    continue;
                }
                rewardedCount += 1;
                console.info('[epic_paint] reward ticket granted', { eventKey, uid: uidKey, ticket: awarded[0] });
                const ticketNum = String(awarded[0]);
                const nowTs = Date.now();
                const ticketPayload = {
                    num: Number(ticketNum),
                    ticketNum: Number(ticketNum),
                    ticket: ticketNum,
                    userId: String(uidKey),
                    owner,
                    round: Number(currentRoundNum || 0),
                    cell: 0,
                    cellIdx: -1,
                    taskIdx: -1,
                    source: 'epic_paint',
                    ticketSource: 'EPIC_PAINT',
                    taskLabel: 'Награда за событие «Эпичный раскрас»',
                    createdAt: nowTs
                };
                const archiveKey = db.ref('tickets_archive').push().key;
                const updates = {};
                updates[`tickets/${ticketNum}`] = ticketPayload;
                updates[`users/${uidKey}/tickets/${ticketNum}`] = ticketPayload;
                updates[`tickets_archive/${archiveKey}`] = {
                    owner,
                    userId: String(uidKey),
                    ticket: ticketNum,
                    taskIdx: -1,
                    round: Number(currentRoundNum || 0),
                    cell: 0,
                    cellIdx: -1,
                    isEventReward: true,
                    eventId: EPIC_PAINT_EVENT_ID,
                    source: 'epic_paint',
                    ticketSource: 'EPIC_PAINT',
                    ticketSourceLabel: 'Билет события',
                    taskLabel: 'Награда за событие «Эпичный раскрас»',
                    archivedAt: nowTs,
                    excluded: false
                };
                await db.ref().update(updates);
                rewardedUids.push(uidKey);
            }

            await db.ref(`game_events/${eventKey}/rewardsPosted`).transaction(v => v || { at: Date.now(), rewardedCount });
            console.info('[epic_paint] reward finalize completed', { eventKey, rewardedCount });

            const notifyText = '🎨 «Эпичный закрас» завершён! Полотно закрашено на 95%+. Награда: 1 билет каждому участнику, кто оставил хотя бы один штрих.';
            const notifyMap = {};
            const notifyRecipients = window.RewardDeliveryUtils?.pickEpicPaintNotifiedUids
                ? window.RewardDeliveryUtils.pickEpicPaintNotifiedUids(rewardedUids)
                : rewardedUids;
            notifyRecipients.forEach(uid => {
                notifyMap[uid] = { text: notifyText, type: 'event_epic_paint_completed', eventKey, createdAt: Date.now() };
            });
            const notifyTx = await db.ref(`game_events/${eventKey}/notifyPosted`).transaction(v => v || { at: Date.now(), type: 'event_epic_paint_completed' });
            if (notifyTx.committed && Object.keys(notifyMap).length) {
                const updates = {};
                Object.entries(notifyMap).forEach(([uid, payload]) => {
                    const key = db.ref(`system_notifications/${uid}`).push().key;
                    updates[`system_notifications/${uid}/${key}`] = payload;
                });
                await db.ref().update(updates);
            }

            return { rewardedCount, rewardedUids, failedUids };
        }

        async function maybeFinalizeWallBattleSuccess(coverage, redCoverage, blueCoverage) {
            if (!currentGameEvent || currentGameEvent.id !== WALL_BATTLE_EVENT_ID || currentGameEvent.status !== 'active') return;
            if (!currentGameEventKey) return;
            if (coverage < EPIC_PAINT_COVERAGE_TARGET && redCoverage < 75 && blueCoverage < 75) return;

            const winnerTeam = redCoverage >= blueCoverage ? 'red' : 'blue';
            const eventRef = db.ref(`game_events/${currentGameEventKey}`);
            const tx = await eventRef.transaction(ev => {
                if (!ev || ev.id !== WALL_BATTLE_EVENT_ID || ev.status !== 'active') return ev;
                return { ...ev, status: 'completed', completedAt: Date.now(), winnerTeam, resultText: `Победила команда ${winnerTeam}` };
            });
            if (!tx.committed) return;

            const rewardedPlayersCount = await grantWallBattleRewards(winnerTeam);
            await postNews(`🏁 «Стенка на стенку» завершена: победила ${winnerTeam === 'red' ? 'красная' : 'синяя'} команда. Победители получили награды.`, { uniqueParts: { type: 'wall_battle_result', eventId: WALL_BATTLE_EVENT_ID, sourceId: currentGameEventKey, actionId: 'completed' }, eventType: 'wall_battle_result', sourceId: currentGameEventKey });
            await postEpicEventSummary({ ...(tx.snapshot.val() || {}), key: currentGameEventKey, completedAt: Date.now(), activatedAt: currentGameEvent?.activatedAt || currentGameEvent?.startAt }, true, rewardedPlayersCount);
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
                const parsedOwner = Number(user?.charIndex);
                const owner = Number.isInteger(parsedOwner) ? parsedOwner : null;
                if (!Number.isInteger(owner) || !players[owner]) continue;
                const awarded = await claimSequentialTickets(1);
                if (!awarded?.length) continue;
                await addInventoryItemForUser(uid, 'magnifier', 1);
                await db.ref('tickets_archive').push({ owner, userId: uid, ticket: awarded[0], taskIdx: -1, round: currentRoundNum, cell: 0, cellIdx: -1, isEventReward: true, eventId: WALL_BATTLE_EVENT_ID, source: 'wall_battle', ticketSource: 'WALL_BATTLE', taskLabel: 'Награда за победу команды в событии «Стенка на стенку»', archivedAt: Date.now(), excluded: false });
                await db.ref(`epic_paint/rewarded/${currentGameEventKey}/${uidKey}`).set(true);
                rewardedCount += 1;
            }
            return rewardedCount;
        }

        async function ensureCompletedEventArtifacts(eventData) {
            if (!eventData?.key) return;
            if (eventData.id === EPIC_PAINT_EVENT_ID) {
                const rewardResult = await grantEpicPaintRewards(eventData);
                await postEpicEventSummary(eventData, true, Number(rewardResult?.rewardedCount || 0));
                return;
            }
            if (eventData.id === WALL_BATTLE_EVENT_ID) {
                const rewardedPlayersCount = await grantWallBattleRewards(eventData.winnerTeam || 'red');
                await postEpicEventSummary(eventData, true, rewardedPlayersCount);
            }
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
            const isActive = currentGameEvent && currentGameEvent.status === 'active' && [EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID].includes(currentGameEvent.id);

            if (navEventBtn) navEventBtn.style.display = isActive ? 'flex' : 'none';
            if (eventTitle) eventTitle.innerText = isActive ? `${currentGameEvent.name || currentGameEvent.id}` : 'Событие не активно';
            updateEpicPaintTimerDisplay();
            resizeEpicPaintCanvasForPhone();

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
                    <button class="event-join-btn" onclick="dismissEpicPaintStartAlert()">✨ В событие</button>
                    <button class="event-join-btn" style="margin-top:7px; background:linear-gradient(135deg,#26a69a,#42a5f5);" onclick="chooseRoundInsteadOfEvent()">🎲 Остаться на поле</button>
                `;
            } else {
                startAlert.style.display = 'none';
                startAlert.classList.remove('epic');
            }

            const latestCompleted = queuedGameEvents.filter(ev => [EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID].includes(ev.id) && ev.status === 'completed').sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))[0];
            const latestFailed = queuedGameEvents.filter(ev => [EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID].includes(ev.id) && ev.status === 'failed').sort((a, b) => (b.failedAt || 0) - (a.failedAt || 0))[0];

            const latestCompletedEndedAt = Number(latestCompleted?.completedAt || latestCompleted?.endedAt || 0);
            const showSuccess = Boolean(latestCompleted && latestCompleted.key !== lastCompletedEpicEventKeyShown && isRecentRoundResult(latestCompletedEndedAt) && checkLastRoundResult(`success-${latestCompleted.key}`));
            successAlert.style.display = showSuccess ? 'block' : 'none';
            if (showSuccess) {
                successAlert.innerHTML = latestCompleted.id === WALL_BATTLE_EVENT_ID
                    ? '🏁 Командная битва завершена! Победители получили по 1 билету и Лупе.'
                    : '🎆 Событие прошло круто! Все участники получили по 1 билетику.';
                launchCelebrationFireworks();
                playFireworksSound();
                lastCompletedEpicEventKeyShown = latestCompleted.key;
                setTimeout(() => { if (successAlert) successAlert.style.display = 'none'; }, 12000);
            }

            const latestFailedEndedAt = Number(latestFailed?.failedAt || latestFailed?.endedAt || 0);
            const showFail = Boolean(latestFailed && latestFailed.key !== lastFailedEpicEventKeyShown && isRecentRoundResult(latestFailedEndedAt) && checkLastRoundResult(`failed-${latestFailed.key}`));
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
            if (![EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID, MUSHU_EVENT_ID].includes(eventType)) return alert('Неизвестный тип события.');
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
                name: eventType === WALL_BATTLE_EVENT_ID ? 'Раскрас «Стенка на стенку»' : (eventType === MUSHU_EVENT_ID ? '🐉 Кормление Мушу' : 'Эпичный закрас'),
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

            const now = Date.now();
            const due = queuedGameEvents
                .filter(ev => ev.status === 'scheduled' && (ev.startAt || 0) <= now)
                .sort((a, b) => (a.startAt || 0) - (b.startAt || 0))[0];
            if (!due?.key) return;

            const tx = await db.ref(`game_events/${due.key}`).transaction(ev => {
                if (!ev || ev.status !== 'scheduled') return ev;
                if (Date.now() < (ev.startAt || 0)) return ev;
                return { ...ev, status: 'active', activatedAt: Date.now(), nextTeam: 'red', teams: null };
            });

            if (tx.committed) {
                await postNews(`Запущено событие: ${due.name || due.id}`, { uniqueParts: { type: 'event_started', eventId: due.id || 'unknown', sourceId: due.key || due.id, actionId: 'started' }, eventType: 'event_started', sourceId: due.key || due.id });
                if (due.id === MUSHU_EVENT_ID) {
                    const target = [20, 25, 30, 35, 40][Math.floor(Math.random() * 5)];
                    const usersSnap = await db.ref('users').once('value');
                    const participantIds = [];
                    usersSnap.forEach((row) => {
                        const id = String(row.key || '').trim();
                        if (id) participantIds.push(id);
                    });
                    const luckyCupcakeUid = participantIds.length ? participantIds[Math.floor(Math.random() * participantIds.length)] : null;
                    const personalFruits = {};
                    participantIds.forEach((id) => {
                        if (id === luckyCupcakeUid) {
                            personalFruits[id] = { id: 'golden_cupcake', pickedAt: Date.now() };
                            return;
                        }
                        const base = ['apple', 'cherry', 'pear', 'peach'][Math.floor(Math.random() * 4)];
                        personalFruits[id] = { id: base };
                    });
                    await db.ref('mushu_event').set({
                        status: 'active',
                        current_satiety: 0,
                        target,
                        participants: {},
                        fed_users: {},
                        personal_fruits: personalFruits,
                        lucky_cupcake_uid: luckyCupcakeUid,
                        rewards: {},
                        rewarded_users: {},
                        feed_log: {},
                        combo_bonus: {},
                        startedAt: Date.now(),
                        endAt: Number(due.endAt || 0),
                        durationMs: Math.max(60000, Number(due.endAt || 0) - Date.now())
                    });
                } else {
                    epicPaintHasDismissedStart = false;
                    epicPaintCoverageCache = { value: 0, computedAt: 0, strokesCount: -1 };
                    epicPaintPendingStrokes = [];
                    if (epicPaintFlushTimer) {
                        clearTimeout(epicPaintFlushTimer);
                        epicPaintFlushTimer = null;
                    }
                    epicPaintRealtimeContext = { team: 'red', color: '#ff007f', preparedForEventKey: null, touched: false };
                    await db.ref('epic_paint').set({ strokes: null, participants: null, participants_by_event: null, rewarded: null });
                }
            }
        }

        async function failExpiredEventIfNeeded() {
            const nowMs = typeof getServerNowMs === 'function' ? getServerNowMs() : Date.now();
            const active = queuedGameEvents.find(ev => ev.status === 'active' && [EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID, MUSHU_EVENT_ID].includes(ev.id));
            if (!active?.key) return;
            if (nowMs < (active.endAt || 0)) return;

            const eventRuntimeId = String(active.activatedAt || active.startAt || active.key);
            const feedOncePath = `game_events/${active.key}/feed_result_posted/${eventRuntimeId}`;

            if ([EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID].includes(active.id)) {
                const canvas = document.getElementById('epic-paint-canvas');
                if (canvas) {
                    const coverage = calculateEpicPaintCoverage(canvas);
                    const redCoverage = calculateTeamCoverage(epicPaintStrokes, 'red');
                    const blueCoverage = calculateTeamCoverage(epicPaintStrokes, 'blue');
                    if (active.id === WALL_BATTLE_EVENT_ID) {
                        await maybeFinalizeWallBattleSuccess(coverage, redCoverage, blueCoverage);
                    } else {
                        await maybeFinalizeEpicPaintSuccess(coverage);
                    }
                    const stillActiveSnap = await db.ref(`game_events/${active.key}/status`).once('value');
                    if (stillActiveSnap.val() !== 'active') return;
                }
            }

            const tx = await db.ref(`game_events/${active.key}`).transaction(ev => {
                if (!ev || ![EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID, MUSHU_EVENT_ID].includes(ev.id) || ev.status !== 'active') return ev;
                if (nowMs < (ev.endAt || 0)) return ev;
                return { ...ev, status: 'failed', failedAt: nowMs, resultText: '🚫 Время вышло. Мушу остался голодным и ушел ворчать в свой храм... 🥟' };
            });
            if (tx.committed) {
                const txValue = tx.snapshot?.val() || {};
                const txStatus = String(txValue.status || '');
                if (txStatus === 'completed' && [EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID].includes(active.id)) {
                    await ensureCompletedEventArtifacts({
                        ...txValue,
                        key: active.key,
                        completedAt: Number(txValue.completedAt || nowMs),
                        activatedAt: txValue.activatedAt || active.activatedAt || active.startAt
                    });
                    return;
                }
                if (txStatus !== 'failed') return;

                if (active.id === MUSHU_EVENT_ID) {
                    const failedAt = nowMs;
                    await db.ref('mushu_event').update({ status: 'failed', failedAt, resultText: '🚫 Время вышло. Мушу остался голодным и ушел ворчать в свой храм... 🥟' });
                    const failedEventId = eventRuntimeId;
                    const failedLogTx = await db.ref(`mushu_event/feed_result_posted/${failedEventId}`).transaction((v) => v || { at: failedAt, eventId: failedEventId, status: 'failed' });
                    if (failedLogTx.committed) await postNews('🚫 Время вышло. Мушу остался голодным и ушел ворчать в свой храм... 🥟', { uniqueParts: { type: 'mushu_failed', eventId: 'mushu_event', sourceId: eventRuntimeId, actionId: 'failed' }, eventType: 'mushu_failed', sourceId: eventRuntimeId });
                } else {
                    const summaryLogTx = await db.ref(feedOncePath).transaction((v) => v || { at: nowMs, eventId: eventRuntimeId, status: 'failed' });
                    if (summaryLogTx.committed) {
                        await postEpicEventSummary({ ...(tx.snapshot.val() || {}), key: active.key, failedAt: nowMs, activatedAt: active.activatedAt || active.startAt }, false, 0);
                    }
                }
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
                currentGameEvent = active;
                currentGameEventKey = active?.key || null;
                if (!currentGameEvent || ![EPIC_PAINT_EVENT_ID, WALL_BATTLE_EVENT_ID].includes(currentGameEvent.id) || currentGameEvent.status !== 'active') {
                    epicPaintHasDismissedStart = false;
                }

                const latestCompletedEpic = queuedGameEvents
                    .filter(ev => ev.id === EPIC_PAINT_EVENT_ID && ev.status === 'completed')
                    .sort((a, b) => Number(b.completedAt || 0) - Number(a.completedAt || 0))[0];
                if (latestCompletedEpic?.key) {
                    maybeShowEpicPaintSuccessNotification(latestCompletedEpic)
                        .catch((err) => console.error('epic paint success notification failed', err));
                }

                updateEventUiState();
                updateAdminEventStatus();
                activateScheduledEventIfNeeded();
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

    window.getPlayerColorByUid = getPlayerColorByUid;
    window.getWallBattleTeamColor = getWallBattleTeamColor;
    window.joinCurrentEventTeam = joinCurrentEventTeam;
    window.setupEpicPaintCanvas = setupEpicPaintCanvas;
    window.resizeEpicPaintCanvasForPhone = resizeEpicPaintCanvasForPhone;
    window.updateEpicPaintTimerDisplay = updateEpicPaintTimerDisplay;
    window.maybeFinalizeEpicPaintSuccess = maybeFinalizeEpicPaintSuccess;
    window.grantEpicPaintRewards = grantEpicPaintRewards;
    window.maybeShowEpicPaintSuccessNotification = maybeShowEpicPaintSuccessNotification;
    window.openEventSpace = openEventSpace;
    window.backToGameFromEvent = backToGameFromEvent;
    window.updateEventUiState = updateEventUiState;
    window.dismissEpicPaintStartAlert = dismissEpicPaintStartAlert;
    window.chooseRoundInsteadOfEvent = chooseRoundInsteadOfEvent;
    window.adminScheduleEvent = adminScheduleEvent;
    window.adminCancelScheduledEvent = adminCancelScheduledEvent;
    window.activateScheduledEventIfNeeded = activateScheduledEventIfNeeded;
    window.failExpiredEventIfNeeded = failExpiredEventIfNeeded;
    window.syncGameEvents = syncGameEvents;
    window.updateAdminEventStatus = updateAdminEventStatus;
})();
