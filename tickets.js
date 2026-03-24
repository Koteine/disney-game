window.__initTicketsModule = function __initTicketsModule() {
        (function () {
            function updateAllTicketsDataAndRender() {
                const snakeRows = Object.values(snakeTicketsByNum || {});
                allTicketsData = [...archivedTicketsData, ...liveBoardTicketsData, ...snakeRows];
                updateTicketsTable();
            }

            let archiveRefs = [];
            let archiveByKey = {};
            let revokedTicketsMap = {};
            let adminTicketsSubtab = 'player';
            let selectedAdminTicketUserId = null;
            let adminProfileLogRequestId = 0;
            let boardRenderVersion = 0;
            let snakeTicketsByNum = {};
            const ticketSourceUtils = window.TicketSourceUtils || {};

            function clearArchiveSubscriptions() {
                archiveRefs.forEach(ref => ref.off());
                archiveRefs = [];
            }

            function syncArchiveMapToList() {
                archivedTicketsData = Object.values(archiveByKey);
                updateAllTicketsDataAndRender();
            }

            function attachArchiveRef(ref) {
                archiveRefs.push(ref);
                ref.on('child_added', snap => {
                    archiveByKey[snap.key] = { ...(snap.val() || {}), isArchived: true, archiveKey: snap.key };
                    syncArchiveMapToList();
                });
                ref.on('child_changed', snap => {
                    archiveByKey[snap.key] = { ...(snap.val() || {}), isArchived: true, archiveKey: snap.key };
                    syncArchiveMapToList();
                });
                ref.on('child_removed', snap => {
                    delete archiveByKey[snap.key];
                    syncArchiveMapToList();
                });
            }

            function subscribeArchiveTickets() {
                clearArchiveSubscriptions();
                archiveByKey = {};
                archivedTicketsData = [];
                updateAllTicketsDataAndRender();

                const archiveRef = db.ref('tickets_archive');
                archiveRefs.push(archiveRef);
                archiveRef.on('value', snap => {
                    const archived = [];
                    snap.forEach(item => {
                        const v = item.val() || {};
                        archived.push({ ...v, isArchived: true, archiveKey: item.key });
                    });
                    archivedTicketsData = archived;
                    updateAllTicketsDataAndRender();
                });
            }

            function subscribeSnakeTickets() {
                const ref = db.ref('tickets');
                ref.on('value', snap => {
                    const next = {};
                    snap.forEach((item) => {
                        const row = item.val() || {};
                        const mode = String(row.mode || '');
                        const source = String(row.source || '');
                        if (mode !== 'snake' && !source.startsWith('snake_')) return;
                        const num = String(row.ticketNum || row.num || item.key || '').trim();
                        if (!/^\d+$/.test(num)) return;
                        next[num] = {
                            ...row,
                            ticket: String(row.ticket || row.ticketNum || row.num || num),
                            ticketNum: Number(row.ticketNum || row.num || num),
                            isArchived: false,
                            isSnakeTicket: true,
                            excluded: Boolean(row.excluded),
                            cellIdx: Number(row.cell || 0) > 0 ? Number(row.cell) - 1 : -1
                        };
                    });
                    snakeTicketsByNum = next;
                    updateAllTicketsDataAndRender();
                });
            }

            function syncTicketData() {
                subscribeSnakeTickets();
                db.ref('board').on('value', async snap => {
                    const renderVersion = ++boardRenderVersion;
                    const data = snap.val() || {};
                    const roundSnap = await db.ref('current_round').once('value');
                    if (renderVersion !== boardRenderVersion) return;
                    const currentRound = roundSnap.val() || {};
                    const grid = document.getElementById('grid');
                    if (grid) grid.innerHTML = "";
                    liveBoardTicketsData = [];

                    if (window.snakeRound?.isSnakeRound?.(currentRound)) {
                        const snakeState = currentUserId ? ((await db.ref(`whitelist/${currentUserId}/snakeState`).once('value')).val() || {}) : {};
                        if (renderVersion !== boardRenderVersion) return;
                        const masterTrapVisionEnabled = !!snakeState.masterTrapVisionEnabled;
                        const dangerPositions = window.snakeRound?.getDangerPositions
                            ? window.snakeRound.getDangerPositions(currentRound?.snakeConfig || {})
                            : [];
                        const snakeRoundNum = Number(currentRound?.number || 0);
                        const trapSnap = snakeRoundNum > 0 ? await db.ref(`snake_traps/${snakeRoundNum}`).once('value') : null;
                        const trapRows = trapSnap?.val() || {};
                        const trapShadows = {};
                        Object.entries(trapRows).forEach(([cellPos, trap]) => {
                            if (!trap || !trap.armed) return;
                            if (Number(trap.expiresAt || 0) <= Date.now()) return;
                            const pos = Number(cellPos || 0);
                            if (!pos) return;
                            if (String(trap.ownerId || '') === String(currentUserId || '')) {
                                trapShadows[pos] = true;
                                return;
                            }
                            if (masterTrapVisionEnabled) trapShadows[pos] = true;
                        });
                        if (grid) {
                            grid.classList.add('snake-grid');
                            grid.innerHTML = window.snakeRound.buildSnakeBoardHtml(data, currentRound, charColors, players, {
                                masterTrapVisionEnabled,
                                dangerPositions,
                                trapShadows
                            });
                            grid.querySelectorAll('[data-snake-pos]').forEach((btn) => {
                                const pos = Number(btn.getAttribute('data-snake-pos'));
                                btn.onclick = () => window.showSnakeCellInfo?.(pos);
                            });
                        }
                        Object.entries(data).forEach(([idx, cell]) => {
                            if (!cell) return;
                            liveBoardTicketsData.push({ ...cell, cell: Number(idx) + 1, cellIdx: Number(idx), isArchived: false });
                        });
                        updateAllTicketsDataAndRender();
                        return;
                    }

                    if (grid) grid.classList.remove('snake-grid');
                    for (let i = 0; i < 50; i++) {
                        const cell = data[i];
                        const d = document.createElement('div');
                        d.className = 'cell'
                            + (cell?.isGold ? ' gold' : '')
                            + (cell?.isMagic ? ' magic' : '')
                            + (cell?.isMiniGame ? ' minigame' : '')
                            + (cell?.isWordSketch ? ' minigame' : '')
                            + (cell?.isMagnet ? ' magnet' : '')
                            + (cell?.itemType ? ' item' : '')
                            + (cell?.isWandBlessing ? ' item' : '')
                            + (cell && cell.excluded ? ' excluded' : '');

                        if (cell) {
                            const c = charColors[cell.owner];
                            d.style.background = c + "22";
                            d.style.borderColor = c;
                            const mark = cell.isTrap ? '💣'
                                : cell.isMagic ? '🔮'
                                : cell.isMiniGame ? '🎮'
                                : cell.isWordSketch ? '🧩'
                                : cell.isMagnet ? '👯'
                                : cell.isWandBlessing ? '🎆'
                                : cell.itemType === 'goldenPollen' ? '🎇'
                                : cell.itemType === 'inkSaboteur' ? '🫧'
                                : cell.itemType === 'magicWand' ? '🎆'
                                : cell.itemType === 'magnifier' ? '🔎'
                                : cell.itemType === 'cloak' ? '🎭'
                                : (i + 1);
                            d.innerHTML = `${mark}<span>🎟${cell.ticket}</span>`;
                            d.style.opacity = cell.invisibleMode ? '0.5' : '1';
                            liveBoardTicketsData.push({ ...cell, cell: i + 1, cellIdx: i, isArchived: false });
                        } else {
                            d.innerHTML = (i + 1);
                        }

                        d.onclick = () => showCell(i, cell);
                        if (grid) grid.appendChild(d);
                    }

                    updateAllTicketsDataAndRender();
                });

                db.ref('revoked_tickets').on('value', snap => {
                    revokedTicketsMap = snap.val() || {};
                    updateAllTicketsDataAndRender();
                });

                subscribeArchiveTickets();
                db.ref(`whitelist/${currentUserId}/charIndex`).on('value', () => {
                    if (currentUserId === ADMIN_ID) return;
                    subscribeArchiveTickets();
                });
            }

            function extractTicketNumbers(ticketValue) {
                return String(ticketValue || '')
                    .split(' и ')
                    .map(t => t.trim())
                    .filter(t => /^\d+$/.test(t));
            }

            function isTicketRevoked(ticketNum) {
                return !!revokedTicketsMap[String(ticketNum)];
            }

            function getTicketSourceLabel(t) {
                if (typeof ticketSourceUtils.getTicketSourceLabel === 'function') {
                    return ticketSourceUtils.getTicketSourceLabel(t);
                }
                if (t.isEventReward) return '🎉 Событие';
                if (t.isManualReward) return '🎫 Админ';
                if (t.isManualRevoke) return '🧾 Изъят админом';
                if (Number.isInteger(t.round) && t.round > 0) return `Раунд ${t.round}`;
                return 'Иной источник';
            }

            function getTicketTaskLabel(t) {
                const resolvedSource = typeof ticketSourceUtils.resolveTicketSource === 'function'
                    ? ticketSourceUtils.resolveTicketSource(t)
                    : '';
                if (resolvedSource === 'TOTEMS') return 'Награда за победу в игре «Тотемы»';
                if (resolvedSource === 'EPIC_PAINT') return 'Награда за событие «Эпичный раскрас»';
                if (resolvedSource === 'WALL_BATTLE') return 'Награда за событие «Стенка на стенку»';
                if (!t.isArchived && Number.isInteger(Number(t.cellIdx)) && Number(t.cellIdx) >= 0) return getTaskLabelByCell(t);
                if (t?.taskSnapshot?.imageUrl && !String(t?.taskSnapshot?.text || '').trim()) return 'Задание-картинка';
                if (typeof t.taskLabel === 'string' && t.taskLabel.trim()) return t.taskLabel;
                if (Number.isInteger(t.taskIdx) && t.taskIdx >= 0 && Array.isArray(tasks) && tasks[t.taskIdx]) {
                    return tasks[t.taskIdx].text || 'Обычное задание';
                }
                if (t.isManualReward) return t.adminNote ? `Ручная выдача: ${t.adminNote}` : 'Ручная выдача администратором';
                if (t.isManualRevoke) return t.adminNote ? `Изъятие: ${t.adminNote}` : 'Изъято администратором';
                return '—';
            }

            function expandTicketsRows(rows) {
                const expandedByNum = new Map();
                rows.forEach(t => {
                    extractTicketNumbers(t.ticket).forEach(ticketNum => {
                        const normalizedTicketNum = String(ticketNum);
                        const candidate = {
                            ...t,
                            ticketNum: normalizedTicketNum,
                            isRevoked: isTicketRevoked(ticketNum),
                            sourceLabel: getTicketSourceLabel(t),
                            taskLabel: getTicketTaskLabel(t)
                        };

                        const prev = expandedByNum.get(normalizedTicketNum);
                        if (!prev) {
                            expandedByNum.set(normalizedTicketNum, candidate);
                            return;
                        }

                        const prevPriority = Number(!prev.isArchived) * 10 + Number(!prev.excluded);
                        const nextPriority = Number(!candidate.isArchived) * 10 + Number(!candidate.excluded);
                        const prevTs = Number(prev.updatedAt || prev.archivedAt || prev.createdAt || prev.ts || 0);
                        const nextTs = Number(candidate.updatedAt || candidate.archivedAt || candidate.createdAt || candidate.ts || 0);

                        if (nextPriority > prevPriority || (nextPriority === prevPriority && nextTs >= prevTs)) {
                            expandedByNum.set(normalizedTicketNum, candidate);
                        }
                    });
                });
                return Array.from(expandedByNum.values());
            }

            async function toggleTicketRevocation(ticketNum, shouldRevoke) {
                if (currentUserId !== ADMIN_ID) return;
                const num = String(ticketNum || '').trim();
                if (!/^\d+$/.test(num)) return;
                if (shouldRevoke) {
                    await db.ref(`revoked_tickets/${num}`).set(true);
                    return;
                }
                await db.ref(`revoked_tickets/${num}`).remove();
            }

            async function claimSequentialTickets(count = 1) {
                let startFrom = null;
                const tx = await db.ref('ticket_counter').transaction(c => {
                    const current = Number(c) || 0;
                    if (current + count > MAX_TICKETS) return;
                    startFrom = current + 1;
                    return current + count;
                });
                if (!tx.committed || !Number.isInteger(startFrom)) return null;
                return Array.from({ length: count }, (_, idx) => String(startFrom + idx));
            }

            function switchAdminTicketsSubtab(tabName) {
                const isAdmin = Number(currentUserId) === Number(ADMIN_ID);
                if (!isAdmin) {
                    adminTicketsSubtab = 'all';
                    const allPanel = document.getElementById('admin-tickets-all-panel');
                    const playerPanel = document.getElementById('admin-tickets-player-panel');
                    if (allPanel) allPanel.style.display = 'block';
                    if (playerPanel) playerPanel.style.display = 'none';
                    return;
                }
                adminTicketsSubtab = tabName === 'player' ? 'player' : 'all';
                const allBtn = document.getElementById('admin-tickets-all-btn');
                const playerBtn = document.getElementById('admin-tickets-player-btn');
                const allPanel = document.getElementById('admin-tickets-all-panel');
                const playerPanel = document.getElementById('admin-tickets-player-panel');
                const isAll = adminTicketsSubtab === 'all';

                allBtn?.classList.toggle('active', isAll);
                playerBtn?.classList.toggle('active', !isAll);
                allPanel?.classList.toggle('active', isAll);
                playerPanel?.classList.toggle('active', !isAll);
                if (allPanel) allPanel.style.display = isAll ? 'block' : 'none';
                if (playerPanel) playerPanel.style.display = isAll ? 'none' : 'block';
            }

            function pickFirstNonEmptyString(...values) {
                for (const value of values) {
                    const normalized = String(value || '').trim();
                    if (normalized) return normalized;
                }
                return '';
            }

            function escapeHtml(value) {
                return String(value || '')
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#39;');
            }

            function resolveAdminPlayerIdentity(uid, whitelistRow, seasonProfile) {
                const charIndex = Number(whitelistRow?.charIndex);
                const rosterName = Number.isInteger(charIndex) && players[charIndex] ? String(players[charIndex].n || '').trim() : '';
                const gameNickname = pickFirstNonEmptyString(
                    rosterName,
                    seasonProfile?.nickname,
                    seasonProfile?.gameName,
                    seasonProfile?.profile?.nickname,
                    seasonProfile?.profile?.name
                );
                const reserveName = pickFirstNonEmptyString(
                    whitelistRow?.nickname,
                    rosterName
                );
                const displayName = gameNickname || reserveName || `Игрок ${uid}`;
                const avatarUrl = pickFirstNonEmptyString(
                    seasonProfile?.avatar_url,
                    seasonProfile?.photo_url,
                    seasonProfile?.avatarUrl,
                    seasonProfile?.telegram_photo_url,
                    whitelistRow?.avatar_url,
                    whitelistRow?.photo_url,
                    whitelistRow?.avatarUrl,
                    whitelistRow?.telegram_photo_url
                );

                return {
                    userId: uid,
                    charIndex: Number.isInteger(charIndex) ? charIndex : null,
                    gameNickname,
                    reserveName,
                    displayName,
                    avatarUrl,
                    isFallbackName: !gameNickname && !reserveName
                };
            }

            function getAdminPlayersAlphabetically() {
                const whitelist = window.cachedWhitelistData || {};
                const usersById = new Map();

                Object.entries(whitelist).forEach(([userId, data]) => {
                    const uid = String(userId || '').trim();
                    if (!uid) return;
                    const seasonProfile = seasonProfilesByUserId?.[uid] || {};
                    const identity = resolveAdminPlayerIdentity(uid, data, seasonProfile);
                    const deleted = Boolean(data?.deletedAt || seasonProfile?.deletedAt);
                    usersById.set(uid, {
                        ...identity,
                        name: identity.displayName,
                        deleted,
                        isFallbackName: identity.isFallbackName
                    });
                });

                Object.entries(seasonProfilesByUserId || {}).forEach(([userId, profile]) => {
                    const uid = String(userId || '').trim();
                    if (!uid || usersById.has(uid)) return;
                    const identity = resolveAdminPlayerIdentity(uid, null, profile || {});
                    usersById.set(uid, {
                        ...identity,
                        name: identity.displayName,
                        deleted: Boolean(profile?.deletedAt),
                        isFallbackName: identity.isFallbackName
                    });
                });

                const users = Array.from(usersById.values()).filter(u => !u.deleted);

                users.sort((a, b) => {
                    const nameCompare = a.displayName.localeCompare(b.displayName, 'ru');
                    if (nameCompare !== 0) return nameCompare;
                    return String(a.userId).localeCompare(String(b.userId), 'ru');
                });
                return users;
            }

            function formatAdminProfileLogTime(ts) {
                const value = Number(ts || 0);
                if (!value) return '';
                return new Date(value).toLocaleString('ru-RU');
            }

            async function buildAdminPlayerActionLog(selectedUser) {
                if (!selectedUser?.userId) return [];
                const uid = String(selectedUser.userId);
                const ownerIndex = Number(selectedUser.charIndex);
                const events = [];

                const userTicketRows = expandTicketsRows(allTicketsData)
                    .filter(t => String(t.userId) === uid || (Number.isInteger(ownerIndex) && Number(t.owner) === ownerIndex));

                userTicketRows.forEach(t => {
                    const taskPart = t.taskLabel || t.sourceLabel || 'без задания';
                    const itemPart = t.itemType ? ` · предмет: ${window.itemTypes?.[t.itemType]?.name || t.itemType}` : '';
                    events.push({
                        ts: Number(t.createdAt || t.archivedAt || t.updatedAt || t.ts || 0),
                        round: Number(t.round) || null,
                        text: `Получил(а) билет №${t.ticketNum}${t.round ? ` (раунд ${t.round})` : ''}${t.cell ? `, клетка №${t.cell}` : ''} · ${taskPart}${itemPart}`
                    });
                });

                allSubmissions
                    .filter(s => String(resolveSubmissionOwnerUserId(s)) === uid)
                    .forEach(s => {
                        events.push({
                            ts: Number(s.createdAt || s.updatedAt || 0),
                            round: Number(s.round) || null,
                            text: `Сдал(а) работу${s.round ? ` за раунд ${s.round}` : ''}${Number.isInteger(s.cellIdx) ? ` (клетка №${s.cellIdx + 1})` : ''}`
                        });
                    });

                const [boardSnap, duelsSnap, newsSnap, gallerySnap, mushuFeedSnap, activityLogSnap] = await Promise.all([
                    db.ref('board').once('value'),
                    db.ref(DUEL_PATH).limitToLast(300).once('value'),
                    db.ref('news_feed').limitToLast(300).once('value'),
                    db.ref('gallery_compliments').once('value'),
                    db.ref('current_event/feed_log').limitToLast(500).once('value'),
                    db.ref(`player_activity_log/${uid}`).limitToLast(200).once('value')
                ]);

                const board = boardSnap.val() || {};
                Object.entries(board).forEach(([cellIdx, cell]) => {
                    if (!cell) return;
                    if (String(cell.userId || '') !== uid && (!Number.isInteger(ownerIndex) || Number(cell.owner) !== ownerIndex)) return;
                    const itemPart = cell.itemType ? ` · предмет: ${window.itemTypes?.[cell.itemType]?.name || cell.itemType}` : '';
                    events.push({
                        ts: Number(cell.updatedAt || cell.createdAt || 0),
                        round: Number(cell.round) || null,
                        text: `Открыл(а) клетку №${Number(cellIdx) + 1}${cell.round ? ` (раунд ${cell.round})` : ''} · ${getTaskLabelByCell(cell)}${itemPart}`
                    });
                });

                (activityLogSnap.val() ? Object.values(activityLogSnap.val()) : []).forEach((entry) => {
                    if (!entry || String(entry.type || '') !== 'assignment_reroll') return;
                    const oldTaskIdx = Number(entry.oldTaskIdx);
                    const newTaskIdx = Number(entry.newTaskIdx);
                    const oldTaskLabel = String(entry.oldTaskLabel || '').trim() || (Number.isInteger(oldTaskIdx) && tasks[oldTaskIdx] ? String(tasks[oldTaskIdx].text || '') : '');
                    const newTaskLabel = String(entry.newTaskLabel || '').trim() || (Number.isInteger(newTaskIdx) && tasks[newTaskIdx] ? String(tasks[newTaskIdx].text || '') : '');
                    const itemName = window.itemTypes?.[String(entry.itemKey || '').trim()]?.name || 'предмет';
                    events.push({
                        ts: Number(entry.createdAt || entry.updatedAt || 0),
                        round: Number(entry.round) || null,
                        text: `Игрок сменил задание с помощью предмета (${itemName})${Number(entry.cell || 0) > 0 ? ` · клетка №${Number(entry.cell)}` : ''} · было: #${oldTaskIdx} ${oldTaskLabel || '—'} · стало: #${newTaskIdx} ${newTaskLabel || '—'}`
                    });
                });

                const duels = duelsSnap.val() || {};
                Object.values(duels).forEach(duel => {
                    if (!duel) return;
                    const isParticipant = String(duel.challengerId || '') === uid || String(duel.opponentId || '') === uid;
                    if (!isParticipant) return;
                    const opponentId = String(duel.challengerId || '') === uid ? String(duel.opponentId || '') : String(duel.challengerId || '');
                    const opponentName = seasonProfilesByUserId?.[opponentId]?.nickname || (window.cachedWhitelistData?.[opponentId]?.charIndex >= 0 ? players[window.cachedWhitelistData[opponentId].charIndex]?.n : '') || `ID ${opponentId}`;
                    events.push({ ts: Number(duel.createdAt || duel.startedAt || 0), round: null, text: `Участвовал(а) в дуэли каллиграфии против «${opponentName}»` });
                    if (duel.status === 'finished' || duel.finishedAt) {
                        events.push({ ts: Number(duel.finishedAt || 0), round: null, text: `Дуэль завершена${duel.winnerId ? (String(duel.winnerId) === uid ? ' (победа)' : ' (поражение)') : ''}` });
                    }
                });

                const candidateNames = [selectedUser.gameNickname, selectedUser.reserveName, selectedUser.displayName].map(v => String(v || '').trim()).filter(Boolean);
                (newsSnap.val() ? Object.values(newsSnap.val()) : []).forEach(row => {
                    const rowText = String(row?.text || '').trim();
                    if (!rowText || !candidateNames.some(name => rowText.includes(name))) return;
                    events.push({ ts: Number(row.createdAt || 0), round: null, text: `Лента событий: ${rowText}` });
                });

                const gallery = gallerySnap.val() || {};
                Object.entries(gallery).forEach(([workId, byUser]) => {
                    if (!byUser || typeof byUser !== 'object') return;
                    const reaction = byUser[uid];
                    if (!reaction) return;
                    const ownerSubmission = allSubmissions.find(s => String(s.id || s.key || '') === String(workId));
                    const targetOwnerId = ownerSubmission ? resolveSubmissionOwnerUserId(ownerSubmission) : '';
                    let targetName = 'неизвестной работы';
                    if (targetOwnerId) {
                        const targetProfile = seasonProfilesByUserId?.[targetOwnerId] || {};
                        const targetWhitelist = window.cachedWhitelistData?.[targetOwnerId] || {};
                        targetName = resolveAdminPlayerIdentity(String(targetOwnerId), targetWhitelist, targetProfile).displayName;
                    }
                    const reactionEmoji = reaction.type === 'heart' ? '❤️' : reaction.type === 'sun' ? '🌞' : '👏';
                    events.push({ ts: Number(reaction.at || 0), round: ownerSubmission?.round || null, text: `Голосовал(а) в галерее за работу игрока «${targetName}» реакцией ${reactionEmoji}` });
                });

                const mushuLog = mushuFeedSnap.val() || {};
                Object.values(mushuLog).forEach(entry => {
                    if (String(entry?.uid || '') !== uid) return;
                    events.push({ ts: Number(entry.at || 0), round: null, text: `Участвовал(а) в событии «Покорми Мушу» (фрукт: ${entry.fruit || '—'}, сытость +${Number(entry.satiety || 0)})` });
                });

                return events
                    .filter(ev => String(ev.text || '').trim())
                    .sort((a, b) => {
                        const ta = Number(a.ts || 0);
                        const tb = Number(b.ts || 0);
                        if (ta && tb) return tb - ta;
                        if (ta) return -1;
                        if (tb) return 1;
                        return Number(b.round || 0) - Number(a.round || 0);
                    })
                    .slice(0, 80);
            }

            function renderAdminPlayerTickets(expandedRows) {
                const selectEl = document.getElementById('admin-player-select');
                const summaryEl = document.getElementById('admin-player-summary');
                if (!selectEl || !summaryEl) return;
                const users = getAdminPlayersAlphabetically();
                if (!users.length) {
                    selectEl.innerHTML = '<option value="">Игроков пока нет</option>';
                    summaryEl.innerHTML = '<div style="color:#888; font-size:12px;">Нет доступных игроков.</div>';
                    return;
                }
                if (!selectedAdminTicketUserId || !users.some(u => u.userId === String(selectedAdminTicketUserId))) selectedAdminTicketUserId = '';
                const previousValue = String(selectEl.value || selectedAdminTicketUserId || '');
                selectEl.innerHTML = ['<option value="">Выберите игрока</option>'].concat(users.map(u => `<option value="${u.userId}">${escapeHtml(u.gameNickname || u.displayName)}</option>`)).join('');
                const selectedFromOptions = users.some(u => String(u.userId) === previousValue) ? previousValue : String(selectedAdminTicketUserId || '');
                selectEl.value = selectedFromOptions;
                selectedAdminTicketUserId = selectEl.value;
                const selectedUser = users.find(u => String(u.userId) === String(selectedAdminTicketUserId));
                if (!selectedUser) {
                    summaryEl.innerHTML = '<div style="font-size:12px; color:#666;">Выберите игрока, чтобы посмотреть подробную информацию</div>';
                    return;
                }

                const filtered = expandedRows.filter(t => String(t.userId) === String(selectedAdminTicketUserId) || String(t.owner) === String(selectedUser?.charIndex)).sort((a, b) => Number(a.ticketNum) - Number(b.ticketNum));
                const season = seasonProfilesByUserId?.[selectedUser.userId] || {};
                const karmaPoints = Math.max(0, Number(season.karma_points) || 0);
                const karmaMeta = getKarmaVisualMeta(karmaPoints);
                const inv = (window.cachedWhitelistData?.[selectedUser.userId]?.inventory && typeof window.cachedWhitelistData[selectedUser.userId].inventory === 'object') ? window.cachedWhitelistData[selectedUser.userId].inventory : {};
                const inventoryRows = INVENTORY_ITEM_KEYS
                    .filter(k => Number(inv[k] || 0) > 0 && window.itemTypes?.[k])
                    .sort((a, b) => (window.itemTypes?.[a]?.name || a).localeCompare(window.itemTypes?.[b]?.name || b, 'ru'));
                const inventoryHtml = inventoryRows.length ? inventoryRows.map(key => `<div>${window.itemTypes?.[key]?.emoji || '🎁'} ${window.itemTypes?.[key]?.name || key}: <b>${Number(inv[key])}</b></div>`).join('') : '<div style="color:#888;">Рюкзак пуст.</div>';
                const ticketsHtml = filtered.length ? filtered.map(t => `<div style="padding:6px 0; border-bottom:1px dashed #eee;"><div><b>Билет №${t.ticketNum}</b></div><div style="font-size:11px; color:#777;">Раунд: ${t.round || '—'} · Клетка: ${t.cell || '—'}</div><div style="color:#555; font-size:12px; margin-top:3px;">${escapeHtml(t.taskLabel || t.sourceLabel || 'Описание задания отсутствует')}</div></div>`).join('') : '<div style="color:#888;">У игрока нет билетов.</div>';

                const requestId = ++adminProfileLogRequestId;
                const cardName = selectedUser.displayName || `Игрок ${selectedUser.userId}`;
                const safeCardName = escapeHtml(cardName);
                const safeUserId = escapeHtml(selectedUser.userId);
                const safeAvatarUrl = String(selectedUser.avatarUrl || '').trim();
                const avatarHtml = safeAvatarUrl ? `<img src="${escapeHtml(safeAvatarUrl)}" alt="Аватар ${safeCardName}" style="width:56px; height:56px; border-radius:50%; object-fit:cover; border:1px solid #ddd;" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-flex';">
<div style="display:none; width:56px; height:56px; border-radius:50%; background:#f0f0f0; color:#777; align-items:center; justify-content:center; font-weight:700;">👤</div>` : '<div style="width:56px; height:56px; border-radius:50%; background:#f0f0f0; color:#777; display:inline-flex; align-items:center; justify-content:center; font-weight:700;">👤</div>';
                summaryEl.innerHTML = `
                    <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px; padding:8px; border:1px solid #eee; border-radius:10px; background:#fafafa;">
                        <div style="flex:0 0 auto;">${avatarHtml}</div>
                        <div style="min-width:0;"><div style="font-size:14px; font-weight:700;">${safeCardName}</div><div style="font-size:12px; color:#666;">ID игрока: <b>${safeUserId}</b></div></div>
                    </div>
                    <div style="font-size:12px; margin-bottom:10px;"><b>Состояние кармы</b><div style="margin-top:4px;">${karmaPoints} / ${MAX_RANK_KARMA}</div><div style="color:#6a1b9a;">${escapeHtml(karmaMeta.title)}</div></div>
                    <div style="font-size:12px; margin-bottom:10px;"><b>Рюкзачок</b><div style="margin-top:4px;">${inventoryHtml}</div></div>
                    <div style="font-size:12px; margin-bottom:10px;"><b>Общее количество билетов:</b> ${filtered.length}</div>
                    <details open style="font-size:12px; margin-bottom:10px;"><summary style="cursor:pointer;"><b>Билеты и задания (${filtered.length})</b></summary><div style="margin-top:6px;">${ticketsHtml}</div></details>
                    <details open style="font-size:12px;"><summary style="cursor:pointer;"><b>Лог по игроку</b></summary><div id="admin-player-action-log" style="margin-top:6px; color:#666;">Собираю данные…</div></details>
                `;

                buildAdminPlayerActionLog(selectedUser).then((events) => {
                    if (requestId !== adminProfileLogRequestId) return;
                    const logEl = document.getElementById('admin-player-action-log');
                    if (!logEl) return;
                    if (!events.length) {
                        logEl.innerHTML = 'Нет доступных данных для лога по игроку.';
                        return;
                    }
                    logEl.innerHTML = events.map(ev => {
                        const timeLabel = formatAdminProfileLogTime(ev.ts);
                        const prefix = timeLabel ? `${timeLabel} · ` : '';
                        return `<div style="padding:4px 0; border-bottom:1px dashed #eee;">${prefix}${escapeHtml(ev.text)}</div>`;
                    }).join('');
                }).catch(() => {
                    if (requestId !== adminProfileLogRequestId) return;
                    const logEl = document.getElementById('admin-player-action-log');
                    if (logEl) logEl.innerHTML = 'Не удалось собрать лог действий.';
                });
            }

            function renderAdminTicketArchive() {
                const grid = document.getElementById('admin-ticket-archive-grid');
                if (grid) grid.innerHTML = '';
            }

            function showTicketArchiveTooltip(ticketNum) {
                if (currentUserId !== ADMIN_ID) return;
                const el = document.querySelector(`#admin-ticket-archive-grid [data-ticket-num="${String(ticketNum)}"]`);
                if (!el) return;
                const tooltip = String(el.getAttribute('data-tooltip') || '');
                if (!tooltip) return;
                const old = document.getElementById('admin-ticket-archive-tooltip');
                if (old) old.remove();
                const bubble = document.createElement('div');
                bubble.id = 'admin-ticket-archive-tooltip';
                bubble.textContent = tooltip;
                bubble.style.position = 'fixed';
                bubble.style.maxWidth = '80vw';
                bubble.style.background = '#2d2d2d';
                bubble.style.color = '#fff';
                bubble.style.padding = '6px 8px';
                bubble.style.borderRadius = '8px';
                bubble.style.fontSize = '11px';
                bubble.style.lineHeight = '1.3';
                bubble.style.boxShadow = '0 4px 14px rgba(0,0,0,0.25)';
                bubble.style.zIndex = '2500';
                const r = el.getBoundingClientRect();
                bubble.style.left = `${Math.max(8, Math.min(window.innerWidth - 260, r.left))}px`;
                bubble.style.top = `${Math.max(8, r.top - 42)}px`;
                document.body.appendChild(bubble);
                setTimeout(() => bubble.remove(), 2200);
            }


            function formatTicketArchiveHistoryDate(ts) {
                const value = Number(ts || 0);
                if (!value) return '—';
                return new Date(value).toLocaleString('ru-RU');
            }

            function runAdminTicketArchiveSearch() {
                if (currentUserId !== ADMIN_ID) return;
                const input = String(document.getElementById('admin-ticket-search-input')?.value || '').trim();
                const resultEl = document.getElementById('admin-ticket-archive-search-result');
                if (!resultEl) return;
                if (!/^\d+$/.test(input)) {
                    resultEl.innerHTML = '<div style="font-size:12px; color:#666;">Введите корректный номер билета (только цифры).</div>';
                    return;
                }

                const row = expandTicketsRows(allTicketsData).find(t => String(t.ticketNum) === input);
                if (!row) {
                    resultEl.innerHTML = `<div style="font-size:12px; color:#888;">Билет №${input} не найден в архиве текущей сессии.</div>`;
                    return;
                }

                const ownerName = players[row.owner]?.n || 'Неизвестный игрок';
                const ownerId = String(row.userId || '—');
                const status = (row.excluded || row.isRevoked) ? 'Вычеркнут' : 'Активен';
                const grantedAt = Number(row.createdAt || row.ts || row.archivedAt || 0);
                const updatedAt = Number(row.updatedAt || row.revokedAt || 0);
                const archivedAt = Number(row.archivedAt || 0);
                const reason = row.isManualRevoke ? 'Изъят администратором' : ((row.excluded || row.isRevoked) ? 'Потрачен/переведён в архив' : 'В игре');
                const historyLines = [
                    `Создан билет: ${formatTicketArchiveHistoryDate(grantedAt)} (${row.taskLabel || row.sourceLabel || 'без задания'})`,
                    archivedAt ? `Перемещён в архив: ${formatTicketArchiveHistoryDate(archivedAt)}` : '',
                    (row.excluded || row.isRevoked) ? `Изменение статуса: ${formatTicketArchiveHistoryDate(updatedAt || archivedAt)} (${reason})` : 'Статус не менялся, билет активен'
                ].filter(Boolean);

                resultEl.innerHTML = `
                    <div style="border:1px solid #e1bee7; border-radius:12px; padding:10px; background:#faf7ff; text-align:left;">
                        <div style="font-size:13px; margin-bottom:6px;"><b>🎟 Билет №${row.ticketNum}</b></div>
                        <div style="font-size:12px; margin-bottom:4px;"><b>Статус:</b> ${status}</div>
                        <div style="font-size:12px; margin-bottom:6px;"><b>Владелец:</b> ${ownerName} (ID: ${ownerId})</div>
                        <div style="font-size:12px;"><b>История перемещений:</b></div>
                        <ul style="margin:4px 0 0 16px; padding:0; font-size:12px; line-height:1.4;">
                            ${historyLines.map(line => `<li>${line}</li>`).join('')}
                        </ul>
                    </div>
                `;
            }

            function selectAdminTicketUser(userId) {
                selectedAdminTicketUserId = String(userId || '');
                updateTicketsTable();
            }

            function updateTicketsTable() {
                const body = document.getElementById('tickets-body');
                if (!body) return;
                const canUseAdminTickets = Number(currentUserId) === Number(ADMIN_ID);
                const adminSubtabs = document.getElementById('admin-tickets-subtabs');

                if (adminSubtabs) adminSubtabs.style.display = canUseAdminTickets ? 'flex' : 'none';
                if (document.getElementById('th-user-name')) document.getElementById('th-user-name').style.display = canUseAdminTickets ? 'table-cell' : 'none';

                const visibleData = canUseAdminTickets ? allTicketsData : allTicketsData.filter(t => t.owner === myIndex || Number(t.userId) === Number(currentUserId));
                const expandedRows = expandTicketsRows(visibleData).sort((a, b) => Number(a.ticketNum) - Number(b.ticketNum));

                body.innerHTML = expandedRows.map(t => {
                    const statusClass = t.excluded || t.isRevoked ? 'row-excluded' : '';
                    const ownerIdentity = resolveAdminPlayerIdentity(String(t.userId || ''), window.cachedWhitelistData?.[String(t.userId || '')], seasonProfilesByUserId?.[String(t.userId || '')] || {});
                    return `
                        <tr class="${statusClass}">
                            <td>${t.round || '—'}</td>
                            <td>${t.cell || '—'}</td>
                            ${canUseAdminTickets ? `<td style="font-weight:bold;">${escapeHtml(ownerIdentity.gameNickname || ownerIdentity.displayName || 'Неизвестный')}</td>` : ''}
                            <td><b style="text-decoration:${t.isRevoked ? 'line-through' : 'none'};">${t.ticketNum}</b></td>
                            <td><div style="font-size:11px;">${escapeHtml(t.sourceLabel || '—')}</div><button onclick="openTicketTaskDetails('${t.ticketNum}')" style="margin-top:4px; border:1px solid #ddd; background:#fff; border-radius:8px; padding:2px 8px; font-size:14px;">👀</button>${t.adminNote ? `<div style="font-size:10px; color:#666;">${escapeHtml(t.adminNote)}</div>` : ''}</td>
                        </tr>`;
                }).join('');

                if (canUseAdminTickets) {
                    switchAdminTicketsSubtab(adminTicketsSubtab || 'player');
                    renderAdminPlayerTickets(expandedRows);
                    renderAdminTicketArchive(expandedRows);
                } else if (typeof updateProfileTicketBalance === 'function') {
                    updateProfileTicketBalance(expandedRows);
                }
            }

            function openTicketTaskDetails(ticketNum) {
                const row = expandTicketsRows(allTicketsData).find(t => String(t.ticketNum) === String(ticketNum));
                if (!row) return alert('Данные по билету не найдены.');
                const isAdmin = Number(currentUserId) === Number(ADMIN_ID);
                const isOwner = String(row.userId || '') === String(currentUserId || '') || Number(row.owner) === Number(myIndex);
                if (!isAdmin && !isOwner) return alert('Просмотр задания этого билета недоступен.');
                const details = typeof ticketSourceUtils.resolveTaskDetails === 'function'
                    ? ticketSourceUtils.resolveTaskDetails(row, tasks)
                    : {
                        type: Number.isInteger(row.taskIdx) && row.taskIdx >= 0 && tasks[row.taskIdx]?.img ? 'image' : 'text',
                        text: String(row.taskLabel || ''),
                        imageUrl: Number.isInteger(row.taskIdx) && row.taskIdx >= 0 ? String(tasks[row.taskIdx]?.img || '') : ''
                    };
                const itemLine = row.itemType ? `<div style="margin-top:8px; font-size:13px; color:#6a1b9a;">${window.itemTypes?.[row.itemType]?.emoji || '🎁'} Предмет в клетке: <b>${window.itemTypes?.[row.itemType]?.name || row.itemType}</b></div>` : '';
                const sourceLine = `<div style="margin-top:4px; font-size:12px; color:#666;">Источник: ${escapeHtml(getTicketSourceLabel(row) || '—')}</div>`;
                const textLine = details?.text
                    ? `<div style="margin-top:8px; font-size:14px;">${escapeHtml(details.text)}</div>`
                    : '<div style="margin-top:8px; font-size:14px; color:#777;">Описание задания отсутствует</div>';
                let body = `<div style="text-align:left;"><div style="font-size:12px; color:#666;">🎟 Билет #${row.ticketNum}</div>${sourceLine}${textLine}${itemLine}`;
                if (details?.imageUrl) body += `<img src="${escapeHtml(details.imageUrl)}" style="width:100%; border-radius:10px; margin-top:10px; border:1px solid #eee;">`;
                body += '</div>';
                document.getElementById('mTitle').innerText = 'Задание билета';
                document.getElementById('mText').innerHTML = body;
                document.getElementById('overlay').style.display = 'block';
                document.getElementById('modal').style.display = 'block';
            }

            function viewTaskDetails(cellIdx) {
                db.ref('board/' + cellIdx).once('value', s => {
                    if (s.exists()) showCell(cellIdx, s.val());
                });
            }

            function getActiveTicketsForWheel() {
                return expandTicketsRows(allTicketsData)
                    .filter(t => !t.excluded && !t.isRevoked)
                    .map(t => ({ num: String(t.ticketNum), owner: t.owner, name: players[t.owner]?.n || 'Неизвестный' }))
                    .sort((a, b) => Number(a.num) - Number(b.num));
            }

            window.syncTicketData = syncTicketData;
            window.extractTicketNumbers = extractTicketNumbers;
            window.expandTicketsRows = expandTicketsRows;
            window.claimSequentialTickets = claimSequentialTickets;
            window.updateTicketsTable = updateTicketsTable;
            window.viewTaskDetails = viewTaskDetails;
            window.getActiveTicketsForWheel = getActiveTicketsForWheel;
            window.toggleTicketRevocation = toggleTicketRevocation;
            window.switchAdminTicketsSubtab = switchAdminTicketsSubtab;
            window.selectAdminTicketUser = selectAdminTicketUser;
            window.openTicketTaskDetails = openTicketTaskDetails;
            window.showTicketArchiveTooltip = showTicketArchiveTooltip;
            window.runAdminTicketArchiveSearch = runAdminTicketArchiveSearch;
        })();
};
