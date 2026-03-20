(function () {
    let duelInvitesRef = null;
    let activeDuelRef = null;
    let activeDuelKey = null;
    let duelResultShownByKey = {};
    let duelRowListeners = {};
    let duelWaitNoticeInterval = null;
    let shownInviteKeys = {};

    const ctx = () => window.__duelContext || {};

    with (ctx()) {
        const TOTEM_MODES = ['jungle_rhythm', 'poison_cipher', 'shedding'];
        const TOTEM_REWARD_ITEMS = ['totemShard', 'jungleMask', 'pythonEye'];

        function pickTotemMode() {
            return TOTEM_MODES[Math.floor(Math.random() * TOTEM_MODES.length)];
        }

        function buildTotemChallenge() {
            const mode = pickTotemMode();
            const seed = Math.random().toString(36).slice(2, 10);
            const totems = ['head', 'tail', 'eye'];
            const len = 6 + Math.floor(Math.random() * 3);
            const pattern = Array.from({ length: len }, () => totems[Math.floor(Math.random() * totems.length)]);
            const base = {
                mode,
                seed,
                pattern,
                createdAt: getServerNowMs(),
                timeLimitMs: 20000
            };
            if (mode === 'jungle_rhythm') {
                base.rhythm = pattern.map(() => 350 + Math.floor(Math.random() * 350));
            } else if (mode === 'poison_cipher') {
                const symbols = '123456789ABCDEFGHIJKLMN'.split('');
                base.symbols = pattern.map(() => symbols[Math.floor(Math.random() * symbols.length)]);
                base.order = [...base.symbols].sort((a, b) => a.localeCompare(b, 'ru'));
                base.attackerShowMs = 2200;
                base.defenderShowMs = 1700;
            } else {
                base.swipes = pattern.map(() => ['up', 'down', 'left', 'right'][Math.floor(Math.random() * 4)]);
            }
            return base;
        }

        function totemName(id) {
            if (id === 'head') return 'Голова Змеи';
            if (id === 'tail') return 'Хвост Кобры';
            return 'Глаз Питона';
        }

        function normalizeSwipe(dx, dy) {
            if (Math.abs(dx) < 25 && Math.abs(dy) < 25) return '';
            if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
            return dy > 0 ? 'down' : 'up';
        }

        async function sendCellImpulseToOwner(cellIndex, cellOwnerUserId, ownerNameEncoded, __queued = false) {
            if (typeof window.canUseGameplayFeatures === 'function' && !window.canUseGameplayFeatures()) {
                return alert(window.getAdminGameplayBlockedLabel?.() || 'Недоступно в режиме администратора');
            }
            if (!__queued && window.enqueueSnakeAction) {
                return window.enqueueSnakeAction('totems_send_challenge', () => sendCellImpulseToOwner(cellIndex, cellOwnerUserId, ownerNameEncoded, true));
            }
            if (!cellOwnerUserId) return;
            if (Number(cellOwnerUserId) === Number(currentUserId)) return alert('Себе вызов не отправляется 🙂');
            const seasonRef = db.ref(`player_season_status/${currentUserId}`);
            const seasonSnap = await seasonRef.once('value');
            const season = seasonSnap.val() || {};
            const now = getServerNowMs();
            const lastImpulse = Number(season.last_impulse_time) || 0;
            const diff = now - lastImpulse;
            const cooldownMs = 24 * 60 * 60 * 1000;
            if (diff < cooldownMs) {
                const remain = cooldownMs - diff;
                const hh = String(Math.floor(remain / 3600000)).padStart(2, '0');
                const mm = String(Math.floor((remain % 3600000) / 60000)).padStart(2, '0');
                return alert(`Новый вызов доступен через ${hh}:${mm}`);
            }

            const duelKey = db.ref(DUEL_PATH).push().key;
            const ownerName = decodeURIComponent(String(ownerNameEncoded || '')) || 'Игрок';
            const challenge = buildTotemChallenge();
            const payload = {
                type: 'calligraphy_duel_invite',
                text: `Игрок "${players[myIndex]?.n || 'Игрок'}" приглашает тебя в игру «Тотемы»`,
                fromUserId: String(currentUserId),
                duelKey,
                cellIndex: Number(cellIndex),
                createdAt: now
            };
            await Promise.all([
                db.ref(`system_notifications/${cellOwnerUserId}`).push(payload),
                db.ref(`system_notifications/${currentUserId}`).push({
                    type: 'calligraphy_duel_wait_notice',
                    text: `Вызов «Тотемы» отправлен игроку "${ownerName}".`,
                    createdAt: now,
                    expiresAt: now + DUEL_INVITE_TTL_MS,
                    duelKey,
                    targetUserId: String(cellOwnerUserId),
                    acknowledged: false
                }),
                db.ref(`${DUEL_PATH}/${duelKey}`).set({
                    createdAt: now,
                    expiresAt: now + DUEL_INVITE_TTL_MS,
                    status: 'invited',
                    gameType: 'totems',
                    challenge,
                    challengerId: String(currentUserId),
                    opponentId: String(cellOwnerUserId),
                    players: {
                        [String(currentUserId)]: { accepted: true, nickname: players[myIndex]?.n || 'Игрок' },
                        [String(cellOwnerUserId)]: { accepted: false, nickname: ownerName }
                    },
                    attackerCompleted: false,
                    defenderCompleted: false,
                    rewardsGrantedAt: 0
                }),
                db.ref(`player_season_status/${currentUserId}`).update({ last_impulse_time: now, updatedAt: now })
            ]);

            const duelRow = (await db.ref(`${DUEL_PATH}/${duelKey}`).once('value')).val() || null;
            if (duelRow) await openCalligraphyDuelUI(duelKey, duelRow, 'attacker');
        }

        async function declineCalligraphyDuel(duelKey, __queued = false) {
            if (typeof window.canUseGameplayFeatures === 'function' && !window.canUseGameplayFeatures()) {
                return alert(window.getAdminGameplayBlockedLabel?.() || 'Недоступно в режиме администратора');
            }
            if (!__queued && window.enqueueSnakeAction) {
                return window.enqueueSnakeAction('totems_decline', () => declineCalligraphyDuel(duelKey, true));
            }
            if (!duelKey) return;
            const ref = db.ref(`${DUEL_PATH}/${duelKey}`);
            let challengerId = '';
            const tx = await ref.transaction((row) => {
                if (!row || ['resolved', 'declined', 'expired'].includes(String(row.status || ''))) return row;
                challengerId = String(row.challengerId || '');
                return { ...row, status: 'declined', declinedAt: getServerNowMs(), declinedBy: String(currentUserId) };
            });
            if (!tx.committed) return;
            if (challengerId) {
                await db.ref(`system_notifications/${challengerId}`).push({
                    type: 'calligraphy_duel_declined',
                    text: 'Соперник отклонил вызов «Тотемы».',
                    createdAt: getServerNowMs()
                });
            }
        }

        async function acceptCalligraphyDuel(duelKey, __queued = false) {
            if (typeof window.canUseGameplayFeatures === 'function' && !window.canUseGameplayFeatures()) {
                return { ok: false, reason: 'admin_observer' };
            }
            if (!__queued && window.enqueueSnakeAction) {
                return window.enqueueSnakeAction('totems_accept', () => acceptCalligraphyDuel(duelKey, true));
            }
            if (!duelKey) return { ok: false, reason: 'no_duel_key' };
            const ref = db.ref(`${DUEL_PATH}/${duelKey}`);
            const tx = await ref.transaction((row) => {
                if (!row || ['resolved', 'declined', 'expired'].includes(String(row.status || ''))) return row;
                const now = getServerNowMs();
                if (Number(row.expiresAt || 0) > 0 && Number(row.expiresAt || 0) <= now) {
                    return { ...row, status: 'expired', expiredAt: now };
                }
                row.players = row.players || {};
                row.players[String(currentUserId)] = {
                    ...(row.players[String(currentUserId)] || {}),
                    accepted: true
                };
                row.status = row.attackerCompleted ? 'defender_pending' : 'attacker_pending';
                row.acceptedAt = now;
                return row;
            });
            if (!tx.committed) return { ok: false, reason: 'not_committed' };
            const row = tx.snapshot.val() || {};
            if (String(row.status || '') === 'defender_pending') {
                await openCalligraphyDuelUI(duelKey, row, 'defender');
            }
            return { ok: true, reason: 'accepted' };
        }

        async function postCalligraphyDuelStartedNewsIfNeeded(duelKey, duelData = null) {
            if (!duelKey) return;
            const duelNow = duelData || (await db.ref(`${DUEL_PATH}/${duelKey}`).once('value')).val() || {};
            if (!['attacker_pending', 'defender_pending'].includes(String(duelNow.status || ''))) return;
            const startedFeedTx = await db.ref(`${DUEL_PATH}/${duelKey}/duelStartedNoticePosted`).transaction((posted) => {
                if (posted) return;
                return { at: getServerNowMs(), by: String(currentUserId || '') };
            });
            if (!startedFeedTx.committed) return;
            const a = duelNow.players?.[String(duelNow.challengerId)]?.nickname || 'Игрок';
            const b = duelNow.players?.[String(duelNow.opponentId)]?.nickname || 'Игрок';
            await postNews(`${a} и ${b} начали игру «Тотемы»`);
        }

        function compareTotemResults(attacker, defender) {
            const a = attacker || {};
            const d = defender || {};
            const aEff = Number(a.timeMs || 999999) + (Number(a.errors || 0) * 1200);
            const dEff = Number(d.timeMs || 999999) + (Number(d.errors || 0) * 1200);
            return dEff < aEff ? 'defender' : 'attacker';
        }

        async function grantTotemRewardsOnce(duelKey, duelRow) {
            const row = duelRow || {};
            const winnerId = String(row.winnerId || '');
            const loserId = String(row.loserId || '');
            if (!winnerId) return;
            const rewardTx = await db.ref(`${DUEL_PATH}/${duelKey}/rewardsGrantedAt`).transaction((v) => {
                if (Number(v) > 0) return;
                return getServerNowMs();
            });
            if (!rewardTx.committed) return;

            const rewardItemKey = TOTEM_REWARD_ITEMS[Math.floor(Math.random() * TOTEM_REWARD_ITEMS.length)];
            await db.ref(`whitelist/${winnerId}/inventory/${rewardItemKey}`).transaction((v) => (Number(v) || 0) + 1);
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
                        eventId: 'totems_duel',
                        taskLabel: 'Награда за победу в игре «Тотемы»',
                        archivedAt: getServerNowMs(),
                        excluded: false
                    });
                }
            }
            if (loserId) {
                await db.ref(`player_season_status/${loserId}`).update({
                    karma_points: firebase.database.ServerValue.increment(1),
                    updatedAt: getServerNowMs()
                });
            }
        }

        async function resolveTotemChallengeIfReady(duelKey) {
            if (!duelKey) return;
            const ref = db.ref(`${DUEL_PATH}/${duelKey}`);
            const lockTx = await ref.transaction((row) => {
                if (!row) return row;
                if (['resolved', 'declined', 'expired'].includes(String(row.status || ''))) return row;
                if (!row.attackerCompleted || !row.defenderCompleted) return row;
                if (String(row.status || '') === 'resolving') return row;
                return { ...row, status: 'resolving', resolvingAt: getServerNowMs(), resolvingBy: String(currentUserId || '') };
            });
            if (!lockTx.committed) return;
            const duel = lockTx.snapshot.val() || {};
            if (!duel.attackerResult || !duel.defenderResult) return;

            const winnerSide = compareTotemResults(duel.attackerResult, duel.defenderResult);
            const winnerId = winnerSide === 'defender' ? String(duel.opponentId || '') : String(duel.challengerId || '');
            const loserId = winnerSide === 'defender' ? String(duel.challengerId || '') : String(duel.opponentId || '');

            const resolveTx = await ref.transaction((row) => {
                if (!row || ['resolved', 'declined', 'expired'].includes(String(row.status || ''))) return row;
                if (String(row.status || '') !== 'resolving') return row;
                return {
                    ...row,
                    status: 'resolved',
                    finishedAt: getServerNowMs(),
                    winnerId,
                    loserId,
                    duelResolvedNoticePosted: false
                };
            });
            if (!resolveTx.committed) return;
            const resolved = resolveTx.snapshot.val() || {};

            await grantTotemRewardsOnce(duelKey, resolved);
            const winnerName = resolved.players?.[winnerId]?.nickname || 'Игрок';

            const notifTx = await db.ref(`${DUEL_PATH}/${duelKey}/notificationsPosted`).transaction((v) => v ? v : { at: getServerNowMs() });
            if (notifTx.committed) {
                if (winnerId) {
                    await db.ref(`system_notifications/${winnerId}`).push({
                        text: 'Победа в «Тотемах»! Тебе выданы 1 билет и редкий предмет.',
                        createdAt: getServerNowMs(),
                        type: 'calligraphy_duel_result'
                    });
                }
                if (loserId) {
                    await db.ref(`system_notifications/${loserId}`).push({
                        text: '«Тотемы» завершены: ты получаешь +1 кармы.',
                        createdAt: getServerNowMs(),
                        type: 'calligraphy_duel_result'
                    });
                }
            }

            const feedTx = await db.ref(`${DUEL_PATH}/${duelKey}/duelResolvedNoticePosted`).transaction((v) => v ? v : { at: getServerNowMs() });
            if (feedTx.committed && winnerName) {
                await postNews(`${winnerName} победил(а) в игре «Тотемы»`);
            }
        }

        async function runTotemMiniGame({ role, challenge, duelKey }) {
            const title = document.getElementById('duel-title');
            const subtitle = document.getElementById('duel-subtitle');
            const countdown = document.getElementById('duel-countdown');
            const timer = document.getElementById('duel-timer');
            const refNode = document.getElementById('duel-reference');
            const canvas = document.getElementById('duel-canvas');
            const closeBtn = document.getElementById('duel-close-btn');
            if (!title || !subtitle || !countdown || !timer || !refNode || !canvas || !closeBtn) {
                return { aborted: true, reason: 'ui_missing' };
            }
            canvas.style.display = 'none';
            closeBtn.style.display = 'none';
            title.textContent = `🐍 Тотемы · ${role === 'attacker' ? 'Печать' : 'Защита'}`;

            const totemNames = {
                head: '🐍 Голова Змеи',
                tail: '🦂 Хвост Кобры',
                eye: '👁️ Глаз Питона'
            };

            const mode = String(challenge?.mode || 'jungle_rhythm');
            let errors = 0;
            let progress = 0;
            let startedAt = getServerNowMs();
            const pattern = Array.isArray(challenge?.pattern) ? challenge.pattern : [];
            if (!pattern.length) return { aborted: true, reason: 'empty_pattern' };

            const overlayButtonsHtml = `<div style="display:grid;grid-template-columns:1fr;gap:6px;margin-top:8px;">
                <button class="admin-btn" data-totem="head" style="margin:0;">🐍 Голова Змеи</button>
                <button class="admin-btn" data-totem="tail" style="margin:0;">🦂 Хвост Кобры</button>
                <button class="admin-btn" data-totem="eye" style="margin:0;">👁️ Глаз Питона</button>
            </div>`;

            subtitle.textContent = mode === 'jungle_rhythm'
                ? 'Режим: Ритм Джунглей'
                : (mode === 'poison_cipher' ? 'Режим: Ядовитый Шифр' : 'Режим: Чешуя');
            countdown.textContent = `${pattern.length}`;
            timer.textContent = 'Подготовка...';

            if (mode === 'poison_cipher') {
                const showMs = role === 'defender' ? Number(challenge.defenderShowMs || 1700) : Number(challenge.attackerShowMs || 2200);
                refNode.innerHTML = `<div style="font-size:16px; margin-bottom:6px;">Запомни символы:</div><div style="font-size:28px; letter-spacing:8px;">${(challenge.symbols || []).join(' ')}</div>`;
                await new Promise((r) => setTimeout(r, showMs));
                refNode.innerHTML = `<div style="font-size:14px; margin-bottom:6px;">Нажимай тотемы по возрастанию букв/цифр</div><div style="font-size:12px; color:#666;">${(challenge.order || []).join(' → ')}</div>${overlayButtonsHtml}`;
            } else if (mode === 'shedding') {
                const swipes = Array.isArray(challenge.swipes) ? challenge.swipes : [];
                refNode.innerHTML = `<div style="font-size:14px; margin-bottom:6px;">Свайпай по направлению для каждого шага.</div><div style="font-size:12px; color:#666;">${swipes.join(' · ')}</div>${overlayButtonsHtml}`;
            } else {
                refNode.innerHTML = `<div style="font-size:14px; margin-bottom:6px;">Повтори ритм тотемов:</div><div style="font-size:12px; color:#666;">${pattern.map((p) => totemNames[p] || p).join(' → ')}</div>${overlayButtonsHtml}`;
            }

            const wrap = refNode;
            const buttons = Array.from(wrap.querySelectorAll('[data-totem]'));
            let swipeStart = null;
            let done = false;
            const limit = Number(challenge.timeLimitMs || 20000);

            const finishPromise = new Promise((resolve) => {
                const finish = (aborted = false) => {
                    if (done) return;
                    done = true;
                    buttons.forEach((btn) => btn.disabled = true);
                    wrap.removeEventListener('touchstart', onTouchStart);
                    wrap.removeEventListener('touchend', onTouchEnd);
                    const timeMs = Math.max(1, getServerNowMs() - startedAt);
                    const score = Math.max(0, 10000 - timeMs - (errors * 1200));
                    resolve({
                        aborted,
                        mode,
                        role,
                        timeMs,
                        errors,
                        completed: !aborted && progress >= pattern.length,
                        progress,
                        score,
                        finishedAt: getServerNowMs()
                    });
                };

                const onTotem = (totem) => {
                    if (done) return;
                    const expected = pattern[progress];
                    let ok = false;
                    if (mode === 'poison_cipher') {
                        const expectedSymbol = (challenge.order || [])[progress];
                        const expectedTotem = (challenge.symbols || []).findIndex((s) => s === expectedSymbol);
                        const expectedKey = pattern[Math.max(0, expectedTotem)] || expected;
                        ok = String(totem) === String(expectedKey);
                    } else {
                        ok = String(totem) === String(expected);
                    }
                    if (ok) {
                        progress += 1;
                        countdown.textContent = `${pattern.length - progress}`;
                    } else {
                        errors += 1;
                    }
                    if (progress >= pattern.length) finish(false);
                };

                const onTouchStart = (evt) => {
                    const t = evt.touches?.[0];
                    if (!t) return;
                    swipeStart = { x: t.clientX, y: t.clientY };
                };
                const onTouchEnd = (evt) => {
                    if (mode !== 'shedding') return;
                    const t = evt.changedTouches?.[0];
                    if (!t || !swipeStart) return;
                    const dir = normalizeSwipe(t.clientX - swipeStart.x, t.clientY - swipeStart.y);
                    swipeStart = null;
                    const expectedDir = (challenge.swipes || [])[progress] || '';
                    if (dir && dir === expectedDir) {
                        progress += 1;
                        countdown.textContent = `${pattern.length - progress}`;
                    } else {
                        errors += 1;
                    }
                    if (progress >= pattern.length) finish(false);
                };

                buttons.forEach((btn) => {
                    btn.addEventListener('click', () => onTotem(String(btn.getAttribute('data-totem') || '')));
                });
                wrap.addEventListener('touchstart', onTouchStart, { passive: true });
                wrap.addEventListener('touchend', onTouchEnd, { passive: true });

                const timerId = setInterval(() => {
                    if (done) {
                        clearInterval(timerId);
                        return;
                    }
                    const left = Math.max(0, limit - (getServerNowMs() - startedAt));
                    timer.textContent = `Осталось: ${(left / 1000).toFixed(1)} сек`;
                    if (left <= 0) {
                        clearInterval(timerId);
                        finish(false);
                    }
                }, 100);
            });

            const result = await finishPromise;
            return result;
        }

        async function openCalligraphyDuelUI(duelKey, duelData, forcedRole = '') {
            if (!duelKey || !duelData) return;
            const overlay = document.getElementById('duel-overlay');
            if (!overlay) return;
            window.setSnakeCriticalUiLock?.('totems_duel');
            overlay.style.display = 'flex';
            activeDuelKey = duelKey;

            const me = String(currentUserId || '');
            const role = forcedRole || (String(duelData.challengerId || '') === me ? 'attacker' : 'defender');
            if (role === 'attacker' && duelData.attackerCompleted) return;
            if (role === 'defender' && duelData.defenderCompleted) return;

            const result = await runTotemMiniGame({ role, challenge: duelData.challenge || {}, duelKey });
            if (result.aborted) {
                closeCalligraphyDuelUI();
                return;
            }

            const basePath = `${DUEL_PATH}/${duelKey}`;
            if (role === 'attacker') {
                await db.ref(basePath).update({
                    attackerResult: result,
                    attackerSeal: {
                        gameType: 'totems',
                        mode: result.mode,
                        seed: duelData.challenge?.seed || '',
                        pattern: duelData.challenge?.pattern || [],
                        timeMs: result.timeMs,
                        errors: result.errors,
                        score: result.score,
                        finishedAt: result.finishedAt
                    },
                    attackerCompleted: true,
                    status: (duelData.players?.[String(duelData.opponentId)]?.accepted ? 'defender_pending' : 'attacker_pending')
                });
            } else {
                await db.ref(basePath).update({
                    defenderResult: result,
                    defenderCompleted: true,
                    status: 'resolving'
                });
            }

            await resolveTotemChallengeIfReady(duelKey);
            closeCalligraphyDuelUI();
        }

        function closeCalligraphyDuelUI() {
            const overlay = document.getElementById('duel-overlay');
            const canvas = document.getElementById('duel-canvas');
            const closeBtn = document.getElementById('duel-close-btn');
            if (overlay) overlay.style.display = 'none';
            if (canvas) canvas.style.display = '';
            if (closeBtn) closeBtn.style.display = '';
            activeDuelKey = null;
            window.setSnakeCriticalUiLock?.('');
        }

        async function expirePendingCalligraphyDuel(duelKey) {
            if (!duelKey) return;
            const ref = db.ref(`${DUEL_PATH}/${duelKey}`);
            let challengerId = '';
            const tx = await ref.transaction((row) => {
                if (!row) return row;
                if (['resolved', 'declined', 'expired'].includes(String(row.status || ''))) return row;
                if (Number(row.expiresAt || 0) > getServerNowMs()) return row;
                challengerId = String(row.challengerId || '');
                return { ...row, status: 'expired', expiredAt: getServerNowMs() };
            });
            if (!tx.committed || !challengerId) return;
            await db.ref(`system_notifications/${challengerId}`).push({
                type: 'calligraphy_duel_timeout',
                text: 'Вызов «Тотемы» истёк: соперник не ответил вовремя.',
                createdAt: getServerNowMs(),
                duelKey,
                acknowledged: false
            });
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
                await notificationRef.update({ acknowledged: true, acknowledgedAt: getServerNowMs() });
                return;
            }
            await closePlayerNotification(`sys-${notificationKey}`, true);
        }

        async function acknowledgeCalligraphyDuelResult(duelKey) {
            if (!duelKey || !currentUserId || !db) return;
            const ackRef = db.ref(`${DUEL_PATH}/${duelKey}/resultAcknowledged/${currentUserId}`);
            await ackRef.transaction((current) => current || { at: getServerNowMs() });
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
            textNode.textContent = String(payload.text || 'Статус вызова обновлён');
            label.style.display = 'block';
            okBtn.style.display = isWaiting ? 'none' : 'inline-flex';
            timerNode.textContent = '';

            if (isWaiting) {
                const tick = () => {
                    const left = Math.max(0, Number(payload.expiresAt || 0) - getServerNowMs());
                    timerNode.textContent = `⏳ ${String(Math.floor(left / 60000)).padStart(2, '0')}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
                    if (left <= 0 && duelWaitNoticeInterval) {
                        clearInterval(duelWaitNoticeInterval);
                        duelWaitNoticeInterval = null;
                    }
                };
                tick();
                duelWaitNoticeInterval = setInterval(tick, 1000);
            }

            okBtn.onclick = async () => {
                label.style.display = 'none';
                await acknowledgeDuelNotification(notificationKey);
            };
        }

        function showCalligraphyInviteNotification(notificationKey, payload = {}) {
            if (!notificationKey || shownInviteKeys[notificationKey]) return;
            shownInviteKeys[notificationKey] = true;
            const duelKey = String(payload.duelKey || '').trim();
            if (!duelKey) return;
            const text = String(payload.text || 'Тебя пригласили в «Тотемы».');
            const cardId = `duel-invite-${duelKey}`;
            if (document.getElementById(cardId)) return;

            const wrap = document.getElementById('player-notification-wrap');
            if (!wrap) return;
            const card = document.createElement('div');
            card.id = cardId;
            card.className = 'player-notification';
            card.style.borderColor = '#7e57c2';
            card.innerHTML = `<button class="player-notification-close">✕</button><div style="font-size:13px; color:#4a148c;">${text}</div><div style="display:flex; gap:6px; margin-top:8px;"><button data-action="accept" class="admin-btn" style="margin:0; flex:1;">Принять</button><button data-action="decline" class="admin-btn" style="margin:0; flex:1; background:#ef5350;">Отказаться</button></div>`;
            const close = async () => {
                card.remove();
                await acknowledgeDuelNotification(notificationKey);
            };
            card.querySelector('.player-notification-close')?.addEventListener('click', close);
            card.querySelector('[data-action="accept"]')?.addEventListener('click', async () => {
                const res = await acceptCalligraphyDuel(duelKey);
                if (!res.ok) return;
                await close();
            });
            card.querySelector('[data-action="decline"]')?.addEventListener('click', async () => {
                await declineCalligraphyDuel(duelKey);
                await close();
            });
            wrap.appendChild(card);
        }

        function removeCalligraphyInviteCard(duelKey) {
            const cardId = `duel-invite-${String(duelKey || '').trim()}`;
            document.getElementById(cardId)?.remove();
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
                if (!row || row.gameType !== 'totems') return;
                const status = String(row.status || '');

                if (!['resolved', 'declined', 'expired'].includes(status)
                    && Number(row.expiresAt || 0) > 0
                    && Number(row.expiresAt || 0) <= getServerNowMs()) {
                    expirePendingCalligraphyDuel(duelSnap.key).catch((err) => console.error('totem timeout failed', err));
                    return;
                }

                if (['declined', 'expired', 'reset'].includes(status)) {
                    removeCalligraphyInviteCard(duelSnap.key);
                    if (activeDuelKey === duelSnap.key) closeCalligraphyDuelUI();
                    return;
                }

                if (status === 'defender_pending' && String(row.opponentId || '') === me && !row.defenderCompleted && activeDuelKey !== duelSnap.key) {
                    openCalligraphyDuelUI(duelSnap.key, row, 'defender').catch((err) => console.error('open defender totems failed', err));
                }

                if (status === 'resolved') {
                    removeCalligraphyInviteCard(duelSnap.key);
                    if (activeDuelKey === duelSnap.key) closeCalligraphyDuelUI();
                    if (row.resultAcknowledged?.[me]) {
                        duelResultShownByKey[duelSnap.key] = true;
                        return;
                    }
                    if (duelResultShownByKey[duelSnap.key]) return;
                    duelResultShownByKey[duelSnap.key] = true;
                    const winner = String(row.winnerId || '') === me;
                    if (winner) {
                        launchCelebrationFireworks();
                        alert('Победа в «Тотемах»!');
                    } else {
                        alert('Игра «Тотемы» завершена.');
                    }
                    acknowledgeCalligraphyDuelResult(duelSnap.key).catch((err) => console.error('totem result acknowledge failed', err));
                }
            };
            duelRef.on('value', handler);
            duelRowListeners[duelKey] = { ref: duelRef, handler };
        }

        function subscribeToCalligraphyDuelInvites() {
            if (!currentUserId) return;
            if (duelInvitesRef) duelInvitesRef.off();
            clearCalligraphyDuelRowListeners();
            duelInvitesRef = db.ref(`system_notifications/${currentUserId}`).limitToLast(40);
            duelInvitesRef.on('child_added', (snap) => {
                const v = snap.val() || {};
                if (v.type !== 'calligraphy_duel_invite') return;
                showCalligraphyInviteNotification(snap.key, v);
            });

            if (activeDuelRef) activeDuelRef.off();
            activeDuelRef = db.ref(DUEL_PATH).limitToLast(80);
            activeDuelRef.on('child_added', (snap) => {
                const duel = snap.val() || {};
                const me = String(currentUserId);
                if (![String(duel.challengerId || ''), String(duel.opponentId || '')].includes(me)) return;
                bindCalligraphyDuelRowListener(snap.key);
            });
            activeDuelRef.on('child_removed', (snap) => {
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
        window.closeTotemGameOverlay = closeCalligraphyDuelUI;
        window.subscribeToCalligraphyDuelInvites = subscribeToCalligraphyDuelInvites;
        window.postCalligraphyDuelStartedNewsIfNeeded = postCalligraphyDuelStartedNewsIfNeeded;
        window.showOutgoingDuelStatusNotification = showOutgoingDuelStatusNotification;
    }
})();
