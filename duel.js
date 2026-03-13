(function () {
    let duelInvitesRef = null;
    let activeDuelRef = null;
    let activeDuelKey = null;
    let duelLocalPoints = [];
    let duelDrawingState = { drawing: false, enabled: false, ended: false };
    let duelTimerInterval = null;
    let duelCountdownInterval = null;
    let duelWaitNoticeInterval = null;
    let duelResultShownByKey = {};
    let duelRowListeners = {};

    const ctx = () => window.__duelContext || {};

    with (ctx()) {
async function sendCellImpulseToOwner(cellIndex, cellOwnerUserId, ownerNameEncoded) {
            if (!cellOwnerUserId) return;
            if (Number(cellOwnerUserId) === Number(currentUserId)) return alert('Себе импульс не отправляется 🙂');
            const seasonRef = db.ref(`player_season_status/${currentUserId}`);
            const seasonSnap = await seasonRef.once('value');
            const season = seasonSnap.val() || {};
            const now = Date.now();
            const lastImpulse = Number(season.last_impulse_time) || 0;
            const diff = now - lastImpulse;
            if (diff < IMPULSE_COOLDOWN_MS) {
                const remain = IMPULSE_COOLDOWN_MS - diff;
                const hh = String(Math.floor(remain / 3600000)).padStart(2, '0');
                const mm = String(Math.floor((remain % 3600000) / 60000)).padStart(2, '0');
                return alert(`Твоя кисть еще сохнет. Жди ${hh}:${mm}`);
            }

            const symbol = CALLIGRAPHY_SYMBOLS[Math.floor(Math.random() * CALLIGRAPHY_SYMBOLS.length)];
            const duelKey = db.ref(DUEL_PATH).push().key;
            const ownerName = decodeURIComponent(String(ownerNameEncoded || '')) || 'Игрок';
            const payload = {
                type: 'calligraphy_duel_invite',
                text: `Игрок "${players[myIndex]?.n || 'Игрок'}" приглашает тебя на дуэль каллиграфов`,
                fromUserId: String(currentUserId),
                duelKey,
                symbol,
                cellIndex: Number(cellIndex),
                createdAt: now
            };
            await Promise.all([
                db.ref(`system_notifications/${cellOwnerUserId}`).push(payload),
                db.ref(`system_notifications/${currentUserId}`).push({
                    type: 'calligraphy_duel_wait_notice',
                    text: `Ты бросил вызов игроку "${ownerName}" на дуэль. Ждём схватку!`,
                    createdAt: now,
                    expiresAt: now + DUEL_INVITE_TTL_MS,
                    duelKey,
                    targetUserId: String(cellOwnerUserId),
                    acknowledged: false
                }),
                db.ref(`${DUEL_PATH}/${duelKey}`).set({
                    createdAt: now,
                    expiresAt: now + DUEL_INVITE_TTL_MS,
                    status: 'pending',
                    symbol,
                    challengerId: String(currentUserId),
                    opponentId: String(cellOwnerUserId),
                    players: {
                        [String(currentUserId)]: { accepted: true, nickname: players[myIndex]?.n || 'Игрок' },
                        [String(cellOwnerUserId)]: { accepted: false, nickname: ownerName }
                    }
                })
            ]);
        }

        async function declineCalligraphyDuel(duelKey) {
            if (!duelKey) return;
            const ref = db.ref(`${DUEL_PATH}/${duelKey}`);
            let challengerId = '';
            const tx = await ref.transaction((row) => {
                if (!row || row.status !== 'pending') return row;
                challengerId = String(row.challengerId || '');
                return {
                    ...row,
                    status: 'declined',
                    declinedAt: Date.now(),
                    declinedBy: String(currentUserId)
                };
            });
            if (!tx.committed) return;
            if (challengerId) {
                await db.ref(`system_notifications/${challengerId}`).push({
                    type: 'calligraphy_duel_declined',
                    text: 'Соперник уклонился от дуэли. Можно отправить новый импульс.',
                    createdAt: Date.now()
                });
            }
        }

        async function postCalligraphyDuelStartedNewsIfNeeded(duelKey, duelData = null) {
            if (!duelKey) return;
            const duelNow = duelData || (await db.ref(`${DUEL_PATH}/${duelKey}`).once('value')).val() || {};
            if (duelNow.status !== 'active') return;
            const startedFeedTx = await db.ref(`${DUEL_PATH}/${duelKey}/duelStartedNoticePosted`).transaction((posted) => {
                if (posted) return;
                return { at: getServerNowMs(), by: String(currentUserId || '') };
            });
            if (!startedFeedTx.committed) return;
            const a = duelNow.players?.[String(duelNow.challengerId)]?.nickname || 'Игрок';
            const b = duelNow.players?.[String(duelNow.opponentId)]?.nickname || 'Игрок';
            await postNews(`${a} и ${b} сошлись в дуэли каллиграфов`);
        }

        async function acceptCalligraphyDuel(duelKey) {
            if (!duelKey) return;
            const ref = db.ref(`${DUEL_PATH}/${duelKey}`);
            await ref.transaction(row => {
                if (!row || row.status !== 'pending') return row;
                row.players = row.players || {};
                const me = String(currentUserId);
                if (!row.players[me]) row.players[me] = {};
                row.players[me].accepted = true;
                row.players[me].nickname = row.players[me].nickname || players[myIndex]?.n || 'Игрок';
                const challengerAccepted = !!row.players[String(row.challengerId)]?.accepted;
                const opponentAccepted = !!row.players[String(row.opponentId)]?.accepted;
                if (challengerAccepted && opponentAccepted) {
                    const now = getServerNowMs();
                    row.status = 'active';
                    row.startedAt = now;
                    row.countdownFrom = 5;
                    row.duelStartAt = now + 5000;
                    row.drawDurationMs = 7000;
                    row.duelStartedNoticePosted = false;
                }
                return row;
            });
            const duelNow = (await ref.once('value')).val() || {};
            if (duelNow.status === 'active') {
                await postCalligraphyDuelStartedNewsIfNeeded(duelKey, duelNow);
                const now = getServerNowMs();
                await db.ref().update({
                    [`player_season_status/${duelNow.challengerId}/last_impulse_time`]: now,
                    [`player_season_status/${duelNow.challengerId}/updatedAt`]: now,
                    [`${DUEL_PATH}/${duelKey}/cooldownStartedAt`]: now
                });
            }
        }

        function setupDuelCanvasHandlers() {
            const canvas = document.getElementById('duel-canvas');
            if (!canvas || canvas.dataset.ready === '1') return;
            canvas.dataset.ready = '1';
            const ctx = canvas.getContext('2d');
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.lineWidth = 9;
            ctx.strokeStyle = '#311b92';

            const getPos = (evt) => {
                const rect = canvas.getBoundingClientRect();
                const t = evt.touches?.[0] || evt.changedTouches?.[0];
                const cx = t ? t.clientX : evt.clientX;
                const cy = t ? t.clientY : evt.clientY;
                return {
                    x: ((cx - rect.left) / rect.width) * canvas.width,
                    y: ((cy - rect.top) / rect.height) * canvas.height
                };
            };

            const begin = (evt) => {
                if (!duelDrawingState.enabled || duelDrawingState.ended) return;
                evt.preventDefault();
                duelDrawingState.drawing = true;
                const p = getPos(evt);
                duelLocalPoints.push({ x: p.x, y: p.y, t: Date.now() });
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
            };
            const move = (evt) => {
                if (!duelDrawingState.drawing || duelDrawingState.ended) return;
                evt.preventDefault();
                const p = getPos(evt);
                duelLocalPoints.push({ x: p.x, y: p.y, t: Date.now() });
                ctx.lineTo(p.x, p.y);
                ctx.stroke();
            };
            const end = () => {
                duelDrawingState.drawing = false;
            };

            canvas.addEventListener('mousedown', begin);
            canvas.addEventListener('mousemove', move);
            canvas.addEventListener('mouseup', end);
            canvas.addEventListener('mouseleave', end);
            canvas.addEventListener('touchstart', begin, { passive: false });
            canvas.addEventListener('touchmove', move, { passive: false });
            canvas.addEventListener('touchend', end);
        }

        function scoreCalligraphy(referencePoints = [], playerPoints = []) {
            if (!referencePoints.length || !playerPoints.length) return 0;
            const threshold = 34;
            let hits = 0;
            for (const p of playerPoints) {
                let best = Infinity;
                for (const r of referencePoints) {
                    const dx = p.x - r.x;
                    const dy = p.y - r.y;
                    const d = Math.sqrt(dx * dx + dy * dy);
                    if (d < best) best = d;
                    if (best <= threshold) break;
                }
                if (best <= threshold) hits++;
            }
            return Math.round((hits / Math.max(1, playerPoints.length)) * 100);
        }

        function createReferencePointsFromSymbol(symbolChar) {
            const canvas = document.createElement('canvas');
            canvas.width = 600;
            canvas.height = 600;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#000';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = '520px serif';
            ctx.fillText(symbolChar || '永', canvas.width / 2, canvas.height / 2 + 20);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            const pts = [];
            for (let y = 0; y < canvas.height; y += 10) {
                for (let x = 0; x < canvas.width; x += 10) {
                    const a = img[(y * canvas.width + x) * 4 + 3];
                    if (a > 40) pts.push({ x, y });
                }
            }
            return pts;
        }

        async function finishCalligraphyDuel(duelKey) {
            if (!duelKey) return;
            const ref = db.ref(`${DUEL_PATH}/${duelKey}`);
            const lockTx = await ref.transaction(row => {
                if (!row) return;
                const now = Date.now();
                const lockAge = now - Number(row.resolvingAt || 0);
                const canTakeOverStaleLock = row.status === 'resolving' && lockAge > 30000;
                if (row.status !== 'active' && !canTakeOverStaleLock) return;
                row.status = 'resolving';
                row.resolvingAt = now;
                row.resolvingBy = String(currentUserId || 'system');
                return row;
            });
            if (!lockTx.committed) return;

            const duel = lockTx.snapshot.val();
            if (!duel) return;
            const symbolChar = duel.symbol?.char || '永';
            const reference = createReferencePointsFromSymbol(symbolChar);
            const participants = Object.keys(duel.players || {});
            const scores = {};
            participants.forEach(uid => {
                scores[uid] = scoreCalligraphy(reference, duel.players?.[uid]?.points || []);
            });
            let winnerId = participants[0] || '';
            participants.forEach(uid => {
                if ((scores[uid] || 0) > (scores[winnerId] || 0)) winnerId = uid;
            });
            const loserId = participants.find(uid => String(uid) !== String(winnerId)) || '';
            const winnerName = duel.players?.[winnerId]?.nickname || 'Игрок';

            const resolveTx = await ref.transaction((row) => {
                if (!row) return;
                if (row.status === 'done' || row.notificationsPosted) return;
                if (row.status !== 'resolving') return;
                return {
                    ...row,
                    status: 'done',
                    finishedAt: Date.now(),
                    scores,
                    winnerId,
                    loserId,
                    notificationsPosted: false,
                    duelResolvedNoticePosted: false,
                    rewardsGrantedAt: row.rewardsGrantedAt || 0
                };
            });
            if (!resolveTx.committed) return;

            if (winnerId) {
                const rewardItemKey = DUEL_REWARD_ITEMS[Math.floor(Math.random() * DUEL_REWARD_ITEMS.length)];
                const rewardMeta = window.itemTypes?.[rewardItemKey] || { emoji: '🎁', name: 'Случайный предмет' };
                const rewardTx = await db.ref(`${DUEL_PATH}/${duelKey}/rewardsGrantedAt`).transaction((v) => {
                    if (Number(v) > 0) return;
                    return Date.now();
                });
                if (rewardTx.committed) {
                    await db.ref(`whitelist/${winnerId}/inventory/${rewardItemKey}`).transaction(v => (Number(v) || 0) + 1);
                    const ticket = await claimSequentialTickets(1);
                    if (ticket?.length) {
                        const winnerStateSnap = await db.ref(`whitelist/${winnerId}`).once('value');
                        const owner = Number(winnerStateSnap.val()?.charIndex);
                        if (Number.isInteger(owner)) {
                            await db.ref('tickets_archive').push({
                                owner,
                                userId: Number(winnerId),
                                ticket: String(ticket[0]),
                                taskIdx: -1,
                                round: currentRoundNum,
                                cell: 0,
                                cellIdx: -1,
                                isEventReward: true,
                                eventId: 'calligraphy_duel',
                                taskLabel: 'Награда за победу в дуэли каллиграфов',
                                archivedAt: Date.now(),
                                excluded: false
                            });
                        }
                    }
                }
            }

            const notificationsTx = await db.ref(`${DUEL_PATH}/${duelKey}/notificationsPosted`).transaction((v) => {
                if (v) return;
                return { at: Date.now(), by: String(currentUserId || '') };
            });
            if (notificationsTx.committed) {
                if (winnerId) {
                    await db.ref(`system_notifications/${winnerId}`).push({
                        text: 'Вот это точность! Молодец! Заслуженные награды уже зачислены',
                        createdAt: Date.now(),
                        type: 'calligraphy_duel_result'
                    });
                }
                if (loserId) {
                    await db.ref(`player_season_status/${loserId}`).update({
                        karma_points: firebase.database.ServerValue.increment(1),
                        updatedAt: Date.now()
                    });
                    await db.ref(`system_notifications/${loserId}`).push({
                        text: 'Увы! У соперника более точное перо! Но зато ты получаешь +1 в карму',
                        createdAt: Date.now(),
                        type: 'calligraphy_duel_result'
                    });
                }
            }

            const resolvedFeedTx = await db.ref(`${DUEL_PATH}/${duelKey}/duelResolvedNoticePosted`).transaction((posted) => {
                if (posted) return;
                return { at: Date.now(), by: String(currentUserId || '') };
            });
            if (resolvedFeedTx.committed && winnerName) {
                await postNews(`${winnerName} победил(а) в дуэли`);
            }
        }

        async function openCalligraphyDuelUI(duelKey, duelData) {
            if (!duelKey || !duelData) return;
            activeDuelKey = duelKey;
            const overlay = document.getElementById('duel-overlay');
            const subtitle = document.getElementById('duel-subtitle');
            const countdown = document.getElementById('duel-countdown');
            const timer = document.getElementById('duel-timer');
            const refNode = document.getElementById('duel-reference');
            const canvas = document.getElementById('duel-canvas');
            if (!overlay || !canvas) return;
            setupDuelCanvasHandlers();
            canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
            duelLocalPoints = [];
            duelDrawingState = { drawing: false, enabled: false, ended: false };
            refNode.textContent = duelData.symbol?.char || '永';
            subtitle.textContent = `Символ: ${duelData.symbol?.char || '永'} (${duelData.symbol?.title || 'Вечность'})`;
            const countdownFrom = Number(duelData.countdownFrom || 5);
            const drawDurationMs = Number(duelData.drawDurationMs || 7000);
            const duelStartAt = Number(duelData.duelStartAt || (Number(duelData.startedAt || 0) + (countdownFrom * 1000)));
            timer.textContent = `Время рисования: ${Math.ceil(drawDurationMs / 1000)} сек`;
            countdown.textContent = String(Math.max(1, countdownFrom));
            overlay.style.display = 'flex';

            clearInterval(duelCountdownInterval);
            let drawStarted = false;
            duelCountdownInterval = setInterval(() => {
                const serverNow = getServerNowMs();
                const msToStart = duelStartAt - serverNow;
                if (msToStart > 0) {
                    countdown.textContent = String(Math.max(1, Math.ceil(msToStart / 1000)));
                    return;
                }
                if (!drawStarted) {
                    drawStarted = true;
                    clearInterval(duelCountdownInterval);
                    countdown.textContent = 'Рисуй!';
                    duelDrawingState.enabled = true;
                    const startedAt = duelStartAt;
                    clearInterval(duelTimerInterval);
                    duelTimerInterval = setInterval(() => {
                        const left = Math.max(0, drawDurationMs - (getServerNowMs() - startedAt));
                        timer.textContent = `Время рисования: ${Math.ceil(left / 1000)} сек`;
                        if (left <= 0) {
                            clearInterval(duelTimerInterval);
                            duelDrawingState.enabled = false;
                            duelDrawingState.ended = true;
                            countdown.textContent = 'Готово';
                            db.ref(`${DUEL_PATH}/${duelKey}/players/${currentUserId}`).update({
                                points: duelLocalPoints,
                                finishedAt: getServerNowMs()
                            });
                        }
                    }, 180);
                }
            }, 150);
        }

        function closeCalligraphyDuelUI() {
            const overlay = document.getElementById('duel-overlay');
            if (overlay) overlay.style.display = 'none';
            clearInterval(duelCountdownInterval);
            clearInterval(duelTimerInterval);
            duelDrawingState.enabled = false;
            activeDuelKey = null;
        }

        async function expirePendingCalligraphyDuel(duelKey) {
            if (!duelKey) return;
            const ref = db.ref(`${DUEL_PATH}/${duelKey}`);
            let challengerId = '';
            const tx = await ref.transaction((row) => {
                if (!row || row.status !== 'pending') return row;
                if (Number(row.expiresAt || 0) > getServerNowMs()) return row;
                challengerId = String(row.challengerId || '');
                return {
                    ...row,
                    status: 'expired',
                    expiredAt: getServerNowMs()
                };
            });
            if (!tx.committed || !challengerId) return;
            await db.ref(`system_notifications/${challengerId}`).push({
                type: 'calligraphy_duel_timeout',
                text: 'Соперник не принял дуэль. Можно кинуть дуэль другому игроку',
                createdAt: Date.now(),
                duelKey,
                acknowledged: false
            });
        }

        function formatDuelWaitCountdown(ms) {
            const safe = Math.max(0, Number(ms) || 0);
            const mm = String(Math.floor(safe / 60000)).padStart(2, '0');
            const ss = String(Math.floor((safe % 60000) / 1000)).padStart(2, '0');
            return `${mm}:${ss}`;
        }

        async function acknowledgeDuelNotification(notificationKey) {
            if (!notificationKey || !currentUserId || !db) return;
            const notificationRef = db.ref(`system_notifications/${currentUserId}/${notificationKey}`);
            const snap = await notificationRef.once('value');
            const payload = snap.val() || {};
            const type = String(payload.type || '');
            const isDuelStatusNotice = [
                'calligraphy_duel_wait_notice',
                'calligraphy_duel_timeout',
                'calligraphy_duel_declined'
            ].includes(type);

            if (isDuelStatusNotice) {
                await notificationRef.update({
                    acknowledged: true,
                    acknowledgedAt: getServerNowMs()
                });
                return;
            }

            await closePlayerNotification(`sys-${notificationKey}`, true);
        }

        async function acknowledgeCalligraphyDuelResult(duelKey) {
            if (!duelKey || !currentUserId || !db) return;
            const ackRef = db.ref(`${DUEL_PATH}/${duelKey}/resultAcknowledged/${currentUserId}`);
            await ackRef.transaction((current) => {
                if (current) return current;
                return { at: Date.now() };
            });
        }

        function showOutgoingDuelStatusNotification(notificationKey, payload = {}) {
            const label = document.getElementById('duel-status-label');
            const textNode = document.getElementById('duel-status-text');
            const timerNode = document.getElementById('duel-status-timer');
            const okBtn = document.getElementById('duel-status-ok');
            if (!label || !textNode || !timerNode || !okBtn || !notificationKey) return;
            if (duelWaitNoticeInterval) {
                clearInterval(duelWaitNoticeInterval);
                duelWaitNoticeInterval = null;
            }

            const type = String(payload.type || '');
            const isWaiting = type === 'calligraphy_duel_wait_notice';
            const notifId = `sys-${notificationKey}`;
            if (payload?.acknowledged) return;
            if (isPlayerNotificationDismissed(notifId)) return;

            if (isWaiting) {
                textNode.textContent = String(payload.text || 'Ты бросил вызов на дуэль. Ждём схватку!');
                okBtn.style.display = 'inline-block';
                const updateTimer = () => {
                    const left = Math.max(0, Number(payload.expiresAt || 0) - getServerNowMs());
                    timerNode.textContent = `⏳ ${formatDuelWaitCountdown(left)} до авто-отмены`;
                    if (left <= 0) {
                        clearInterval(duelWaitNoticeInterval);
                        duelWaitNoticeInterval = null;
                    }
                };
                updateTimer();
                duelWaitNoticeInterval = setInterval(updateTimer, 1000);
            } else {
                textNode.textContent = String(payload.text || 'Соперник не принял дуэль. Можно кинуть дуэль другому игроку');
                timerNode.textContent = '';
                okBtn.style.display = 'inline-block';
            }

            okBtn.onclick = async () => {
                if (duelWaitNoticeInterval) {
                    clearInterval(duelWaitNoticeInterval);
                    duelWaitNoticeInterval = null;
                }
                label.style.display = 'none';
                await acknowledgeDuelNotification(notificationKey);
            };
            label.style.display = 'block';
        }

        function showCalligraphyInviteNotification(notificationKey, payload) {
            const wrap = document.getElementById('player-notification-wrap');
            if (!wrap || !notificationKey) return;
            if (!payload?.duelKey) return;
            const id = `duel-invite-${notificationKey}`;
            if (document.getElementById(id)) return;
            const card = document.createElement('div');
            card.id = id;
            card.className = 'player-notification';
            card.style.borderColor = '#ffd54f';
            card.style.pointerEvents = 'auto';
            const text = String(payload?.text || 'Игрок приглашает тебя на дуэль каллиграфов');
            card.innerHTML = `
                <div style="font-size:13px; line-height:1.4; color:#4a148c; margin-bottom:8px;">${text}</div>
                <div style="display:flex; gap:8px;">
                    <button class="admin-btn" style="margin:0; flex:1; background:#2e7d32;" data-action="accept">Согласиться</button>
                    <button class="admin-btn" style="margin:0; flex:1; background:#6d4c41;" data-action="decline">Уклониться</button>
                </div>`;
            const closeAndDropNotification = async () => {
                card.remove();
                await db.ref(`system_notifications/${currentUserId}/${notificationKey}`).remove();
            };
            let processing = false;
            const handleInviteAction = async (action) => {
                if (processing) return;
                processing = true;
                card.querySelectorAll('button').forEach((btn) => {
                    btn.disabled = true;
                    btn.style.opacity = '0.75';
                });
                try {
                    if (action === 'accept') {
                        await acceptCalligraphyDuel(payload.duelKey);
                    } else {
                        await declineCalligraphyDuel(payload.duelKey);
                    }
                    await closeAndDropNotification();
                } finally {
                    processing = false;
                }
            };
            card.querySelector('[data-action="accept"]')?.addEventListener('click', (evt) => {
                evt.stopPropagation();
                handleInviteAction('accept');
            });
            card.querySelector('[data-action="decline"]')?.addEventListener('click', (evt) => {
                evt.stopPropagation();
                handleInviteAction('decline');
            });
            wrap.appendChild(card);
        }

        function clearCalligraphyDuelRowListeners() {
            Object.values(duelRowListeners).forEach((entry) => {
                if (!entry?.ref || !entry?.handler) return;
                entry.ref.off('value', entry.handler);
            });
            duelRowListeners = {};
        }

        function bindCalligraphyDuelRowListener(duelKey) {
            if (!duelKey || duelRowListeners[duelKey]) return;
            const duelRef = db.ref(`${DUEL_PATH}/${duelKey}`);
            const handler = (duelSnap) => {
                const row = duelSnap.val() || {};
                const me = String(currentUserId);
                const startedAt = Number(row.startedAt || row.createdAt || 0);
                const isStaleActive = row.status === 'active' && startedAt > 0 && (Date.now() - startedAt) > (20 * 60 * 1000);

                if (isStaleActive) {
                    db.ref(`${DUEL_PATH}/${duelSnap.key}`).transaction((current) => {
                        if (!current || current.status !== 'active') return current;
                        const currentStartedAt = Number(current.startedAt || current.createdAt || 0);
                        if (!currentStartedAt || (Date.now() - currentStartedAt) <= (20 * 60 * 1000)) return current;
                        return { ...current, status: 'done', finishedAt: Date.now(), expiredByTimeout: true, winnerId: '', loserId: '' };
                    }).catch((err) => console.error('stale duel cleanup failed', err));
                    return;
                }

                if (row.status === 'pending' && Number(row.expiresAt || 0) > 0 && Number(row.expiresAt || 0) <= getServerNowMs()) {
                    expirePendingCalligraphyDuel(duelSnap.key).catch((err) => console.error('pending duel timeout failed', err));
                    return;
                }

                if (row.status === 'active' && activeDuelKey !== duelSnap.key) {
                    openCalligraphyDuelUI(duelSnap.key, row);
                }
                const allFinished = Object.values(row.players || {}).length >= 2 && Object.values(row.players || {}).every(p => Array.isArray(p.points) && p.points.length > 0);
                if (row.status === 'active' && allFinished) {
                    finishCalligraphyDuel(duelSnap.key).catch(err => console.error('finish duel failed', err));
                }
                if (row.status === 'done') {
                    if (activeDuelKey === duelSnap.key) closeCalligraphyDuelUI();
                    if (row.resultAcknowledged?.[me]) {
                        duelResultShownByKey[duelSnap.key] = true;
                        return;
                    }
                    if (duelResultShownByKey[duelSnap.key]) return;
                    duelResultShownByKey[duelSnap.key] = true;
                    const myScore = Number(row.scores?.[me] || 0);
                    const winner = String(row.winnerId || '') === me;
                    if (winner) {
                        launchCelebrationFireworks();
                        alert(`Победа в дуэли! Точность: ${myScore}%`);
                    } else if (!row.expiredByTimeout) {
                        alert(`Дуэль завершена. Твоя точность: ${myScore}%.`);
                    }
                    acknowledgeCalligraphyDuelResult(duelSnap.key).catch((err) => console.error('duel result acknowledge failed', err));
                }
            };
            duelRef.on('value', handler);
            duelRowListeners[duelKey] = { ref: duelRef, handler };
        }

        function subscribeToCalligraphyDuelInvites() {
            if (!currentUserId) return;
            if (duelInvitesRef) duelInvitesRef.off();
            clearCalligraphyDuelRowListeners();
            duelInvitesRef = db.ref(`system_notifications/${currentUserId}`).limitToLast(30);
            duelInvitesRef.on('child_added', snap => {
                const v = snap.val() || {};
                if (v.type !== 'calligraphy_duel_invite') return;
                showCalligraphyInviteNotification(snap.key, v);
            });

            if (activeDuelRef) activeDuelRef.off();
            activeDuelRef = db.ref(DUEL_PATH).limitToLast(40);
            activeDuelRef.on('child_added', snap => {
                const duel = snap.val() || {};
                const me = String(currentUserId);
                if (![String(duel.challengerId), String(duel.opponentId)].includes(me)) return;
                bindCalligraphyDuelRowListener(snap.key);
            });
            activeDuelRef.on('child_removed', snap => {
                const entry = duelRowListeners[snap.key];
                if (!entry?.ref || !entry?.handler) return;
                entry.ref.off('value', entry.handler);
                delete duelRowListeners[snap.key];
            });
        }

        
        window.sendCellImpulseToOwner = sendCellImpulseToOwner;
        window.declineCalligraphyDuel = declineCalligraphyDuel;
        window.acceptCalligraphyDuel = acceptCalligraphyDuel;
        window.openCalligraphyDuelUI = openCalligraphyDuelUI;
        window.closeCalligraphyDuelUI = closeCalligraphyDuelUI;
        window.subscribeToCalligraphyDuelInvites = subscribeToCalligraphyDuelInvites;
        window.postCalligraphyDuelStartedNewsIfNeeded = postCalligraphyDuelStartedNewsIfNeeded;
        window.showOutgoingDuelStatusNotification = showOutgoingDuelStatusNotification;
    }
})();
