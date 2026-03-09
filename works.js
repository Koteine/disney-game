// Логика вкладки «Работы», вынесенная из index.html
function updateWorksTabForRole(isAdmin) {
    const uploadCard = document.getElementById('works-upload-card');
    const title = document.getElementById('works-tab-title');
    if (uploadCard) uploadCard.style.display = isAdmin ? 'none' : 'block';
    if (title) title.innerText = isAdmin ? '🖼️ Работы игроков' : '📤 Сдача работ';
}

function checkAccess() {
    if (Number(currentUserId) === Number(ADMIN_ID)) {
        document.getElementById('nav-admin-btn').style.display='flex';
        document.getElementById('wheel-admin-btn').innerHTML = `<button onclick="switchTab('tab-admin', document.getElementById('nav-admin-btn')); switchAdminInnerTab('draw');" class="admin-btn">⚙️ Запланировать розыгрыш</button>`;
        syncAdminList();
        fillAdminNickOptions();
        ensureDateTimeInputDefault('event-start-at');
        ensureDateTimeInputDefault('draw-start-at');
        ensureDateTimeInputDefault('round-start-at');
        document.getElementById('player-identity').innerHTML = `Ты: <b>Администратор</b><br><small style="color:#666;">Telegram ID: ${currentUserId}</small>`;
        updateWorksTabForRole(true);
        setAuthorizedView(true);
    }
    db.ref('whitelist/' + currentUserId).on('value', s => {
        if (s.exists()) {
            myIndex = s.val().charIndex;
            document.getElementById('player-identity').innerHTML = `Ты: <span style="color:${charColors[myIndex]}">${players[myIndex].n}</span><br><small style="color:#666;">Telegram ID: ${currentUserId}</small>`;
            updateWorksTabForRole(false);
            setAuthorizedView(true);
            return;
        }

        myIndex = -1;
        if (currentUserId !== ADMIN_ID) {
            updateWorksTabForRole(false);
            document.getElementById('welcome-user-id').innerHTML = `<b>Твой Telegram ID:</b> <code>${currentUserId || 'Не определён'}</code>`;
            setAuthorizedView(false);
        }
    });
}

function syncData() {
    db.ref('current_round').on('value', snap => {
        if (!snap.exists()) return;

        currentRoundNum = snap.val().number;
        roundEndTime = snap.val().endTime;
        document.getElementById('round-info').innerText = "Раунд №" + currentRoundNum;
        updateTimerDisplay();

        if (magicLinksRef) magicLinksRef.off();
        shownMagicLinks = {};
        magicLinksRef = db.ref(`magic_links/${currentRoundNum}`);
        magicLinksRef.on('value', linksSnap => {
            if (!linksSnap.exists()) return;

            linksSnap.forEach(linkSnap => {
                const link = linkSnap.val();
                if (!link || shownMagicLinks[linkSnap.key]) return;

                const related = link.playerA?.userId === currentUserId || link.playerB?.userId === currentUserId;
                if (!related) return;

                shownMagicLinks[linkSnap.key] = true;
                const partner = (link.playerA?.userId === currentUserId) ? link.playerB : link.playerA;
                alert(`✨ Магическая связь активна!\nТвой напарник: ${partner?.name || 'Неизвестный'}\nВыберите 1 из 4 совместных заданий в карточке клетки 🔮`);
            });
        });
    });

    syncTicketData();

    if (inventoryRef) inventoryRef.off();
    inventoryRef = db.ref(`whitelist/${currentUserId}/inventory`);
    inventoryRef.on('value', snap => {
        myInventory = { goldenPollen: snap.val()?.goldenPollen || 0, inkSaboteur: snap.val()?.inkSaboteur || 0, magnifier: snap.val()?.magnifier || 0 };
        renderInventory();
    });

    if (challengeRef) challengeRef.off();
    challengeRef = db.ref(`whitelist/${currentUserId}/ink_challenge`);
    challengeRef.on('value', snap => {
        myInkChallenge = snap.val() || null;
        updateInkDeadlineHint();
        if (!myInkChallenge || myInkChallenge.round !== currentRoundNum || myInkChallenge.isResolved) return;
        if (window.lastShownInkChallengeRound === currentRoundNum) return;
        window.lastShownInkChallengeRound = currentRoundNum;
        alert('Хах! Кому-то ты не угодил! Твою работу покрыли кляксами! Открой свою клетку, чтобы выбрать усложнение.');
    });

    if (wandBlessingRef) wandBlessingRef.off();
    wandBlessingRef = db.ref(`whitelist/${currentUserId}/wand_blessing`);
    wandBlessingRef.on('value', snap => {
        myWandBlessing = snap.val() || null;
        if (!myWandBlessing || myWandBlessing.round !== currentRoundNum || myWandBlessing.isResolved) return;
        if (window.lastShownWandBlessingRound === currentRoundNum) return;
        window.lastShownWandBlessingRound = currentRoundNum;
        alert('Добрая фея выбрала тебя 🧚‍♀️. Твоё задание упрощается, выбирай.');
    });

    if (newsFeedRef) newsFeedRef.off();
    newsFeedRef = db.ref('news_feed').limitToLast(30);
    newsFeedRef.on('value', snap => {
        const items = [];
        snap.forEach(item => {
            const v = item.val();
            if (v?.text) items.push(v.text);
        });
        const ordered = items.length ? items.reverse() : ['Пока новостей нет — откройте первую клетку! ✨'];

        const preview = document.getElementById('news-preview');
        const list = document.getElementById('news-list');
        preview.innerText = ordered[0] || 'Пока новостей нет — откройте первую клетку! ✨';
        list.innerHTML = ordered.map((text, idx) => `<div class="news-item">${idx + 1}. ${text}</div>`).join('');
    });

    const submissionsById = {};

    const extractSubmissionEntries = (parentKey, value) => {
        if (!value || typeof value !== 'object') return [];
        const hasDirectFields = value.beforeImageData || value.afterImageData || value.imageData || value.userId || value.owner !== undefined;
        if (hasDirectFields) return [{ key: parentKey, payload: value, dbPath: parentKey }];

        const nestedEntries = [];
        Object.entries(value).forEach(([childKey, childValue]) => {
            if (!childValue || typeof childValue !== 'object') return;
            const hasSubmissionFields = childValue.beforeImageData || childValue.afterImageData || childValue.imageData || childValue.userId || childValue.owner !== undefined;
            if (!hasSubmissionFields) return;
            nestedEntries.push({ key: `${parentKey}_${childKey}`, payload: childValue, dbPath: `${parentKey}/${childKey}` });
        });
        return nestedEntries;
    };

    const applySubmissionSnapshot = (snap, sourcePrefix) => {
        if (!snap) return;
        snap.forEach(s => {
            const value = s.val() || {};
            const entries = extractSubmissionEntries(s.key, value);
            entries.forEach(({ key, payload, dbPath }) => {
                submissionsById[`${sourcePrefix}:${key}`] = {
                    id: key,
                    sourcePrefix,
                    dbPath: dbPath || key,
                    ...payload
                };
            });
        });
        allSubmissions = Object.values(submissionsById).sort((a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0));
        renderSubmissions();
        fillSubmissionTaskOptions();
    };

    if (submissionsRef) submissionsRef.off();
    submissionsRef = db.ref('submissions');
    submissionsRef.on('value', snap => {
        Object.keys(submissionsById).forEach(key => {
            if (key.startsWith('submissions:')) delete submissionsById[key];
        });
        applySubmissionSnapshot(snap, 'submissions');
    });

    if (legacyWorksRef) legacyWorksRef.off();
    legacyWorksRef = db.ref('works');
    legacyWorksRef.on('value', snap => {
        Object.keys(submissionsById).forEach(key => {
            if (key.startsWith('works:')) delete submissionsById[key];
        });
        applySubmissionSnapshot(snap, 'works');
    });
}

function getTaskLabelByCell(cell) {
    if (!cell) return 'Неизвестное задание';
    if (cell.isEventReward && cell.eventId === EPIC_PAINT_EVENT_ID) return '🎨 Награда за событие «Эпичный закрас»';
    if (cell.isTrap) return `💣 Ловушка: ${cell.trapText || 'особое усложненное задание'}`;
    if (cell.isMagic) return '🔮 Магическая связь: совместное задание';
    if (cell.isMiniGame) return '🎮 Пятнашки 5×5: мини-игра без дополнительного задания';
    if (cell.isWordSketch) return '🧩 Словесный скетч: мини-игра без дополнительного задания';
    if (cell.isMagnet) return `👯 Тянет к тебе как магнитом: ${cell.magnetTaskLabel || 'повтори задание выбранного игрока'}`;
    if (cell.isInkChallenge) return `🫧 Клякса-диверсант: ${cell.inkOptionLabel || 'усложнение выбирается в карточке клетки'}`;
    if (cell.isWandBlessing) return `🎆 Волшебная палочка: ${cell.wandOptionLabel || 'выбери упрощение в карточке клетки'}`;
    if (cell.isGold) return '👑 Золотая клетка: свободная тема';
    const t = tasks[cell.taskIdx];
    return t?.text || 'Обычное задание';
}

function getSubmissionStatusInfo(status) {
    if (status === 'accepted') return { text: 'Принято', className: 'status-accepted' };
    if (status === 'rejected') return { text: 'Не принято', className: 'status-rejected' };
    return { text: 'На проверке', className: 'status-pending' };
}


function updateInkDeadlineHint() {
    const el = document.getElementById('ink-deadline-hint');
    if (!el) return;
    if (!myInkChallenge || myInkChallenge.selectedOption !== 4 || myInkChallenge.isResolved) {
        el.innerText = '';
        return;
    }
    const ms = (myInkChallenge.optionDeadline || 0) - Date.now();
    if (ms <= 0) {
        el.innerText = '⏰ Дедлайн по кляксе истёк.';
        return;
    }
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    el.innerText = `⏳ Клякса: до конца дедлайна ${h}ч ${m}м.`;
}

function fillSubmissionTaskOptions() {
    const select = document.getElementById('work-task-select');
    if (!select) return;

    const myCells = allTicketsData.filter(t => {
        if (Number(t.userId) !== Number(currentUserId)) return false;
        if (t.excluded) return false;
        if (typeof hasRevokedTicket === 'function' && hasRevokedTicket(t.ticket)) return false;
        return true;
    });
    if (!myCells.length) {
        select.innerHTML = '<option value="">Сначала открой клетку с заданием</option>';
        select.disabled = true;
        return;
    }

    updateInkDeadlineHint();
    select.disabled = false;
    select.innerHTML = myCells.map(cell => {
        const shortTask = getTaskLabelByCell(cell).slice(0, 90);
        return `<option value="${cell.cell - 1}">Клетка №${cell.cell} · Билет ${cell.ticket} · ${shortTask}</option>`;
    }).join('');
}

function renderSubmissions() {
    const list = document.getElementById('works-list');
    if (!list) return;
    const isAdmin = Number(currentUserId) === Number(ADMIN_ID);
    const visible = allSubmissions.filter(item => {
        if (isAdmin) return true;
        const sameUserId = String(item.userId || '') === String(currentUserId || '');
        const sameOwner = Number.isInteger(myIndex) && myIndex >= 0 && Number(item.owner) === Number(myIndex);
        return sameUserId || sameOwner;
    });

    if (!visible.length) {
        list.innerHTML = '<div class="works-card" style="text-align:center; color:#999;">Пока нет загруженных работ.</div>';
        return;
    }

    list.innerHTML = visible.map(item => {
        const status = getSubmissionStatusInfo(item.status);
        const playerLine = isAdmin ? `<div style="font-size:12px; color:#666; margin-bottom:6px;">Игрок: <b style="color:${charColors[item.owner] || '#333'}">${players[item.owner]?.n || 'Неизвестный'}</b> · TG ID: ${item.userId || '—'}</div>` : '';
        const reviewControls = isAdmin ? `
            <div style="display:flex; gap:6px; margin-top:8px;">
                <button onclick="setSubmissionStatus('${item.id}','${item.sourcePrefix || 'submissions'}','${item.dbPath || item.id}','accepted')" style="flex:1; border:1px solid #4CAF50; color:#2e7d32; background:#f1fff1; border-radius:8px; padding:8px;">✅ Принято</button>
                <button onclick="setSubmissionStatus('${item.id}','${item.sourcePrefix || 'submissions'}','${item.dbPath || item.id}','rejected')" style="flex:1; border:1px solid #f44336; color:#b71c1c; background:#fff5f5; border-radius:8px; padding:8px;">❌ Не принято</button>
            </div>` : '';
        const beforeBodyId = `sub-before-${item.id}`;
        const afterBodyId = `sub-after-${item.id}`;

        return `
            <div class="works-card">
                ${playerLine}
                <div style="display:flex; justify-content:space-between; gap:8px; align-items:center;">
                    <div><b>Раунд ${item.round || '—'}, клетка №${(item.cellIdx ?? -1) + 1}</b></div>
                    <span class="status-chip ${status.className}">${status.text}</span>
                </div>
                <div style="font-size:12px; margin-top:6px; color:#555;">🎟 Билет: ${item.ticket || '—'}</div>
                <div style="font-size:12px; margin-top:4px; color:#444; line-height:1.4;">${item.taskLabel || 'Описание задания отсутствует'}</div>

                <div class="work-stage-block">
                    <div class="collapse-head" onclick="toggleCollapse('${beforeBodyId}', this)">
                        <span>🖼️ Фото «До»</span>
                        <button type="button" class="collapse-toggle">Развернуть</button>
                    </div>
                    <div id="${beforeBodyId}" class="collapse-body">
                        ${item.beforeImageData ? `<img src="${item.beforeImageData}" alt="Работа до" class="work-image">` : '<div style="font-size:12px; color:#999;">Фото «До» не загружено.</div>'}
                    </div>
                </div>

                <div class="work-stage-block">
                    <div class="collapse-head" onclick="toggleCollapse('${afterBodyId}', this)">
                        <span>🎨 Фото «После»</span>
                        <button type="button" class="collapse-toggle">Развернуть</button>
                    </div>
                    <div id="${afterBodyId}" class="collapse-body">
                        ${(item.afterImageData || item.imageData) ? `<img src="${item.afterImageData || item.imageData}" alt="Работа после" class="work-image">` : '<div style="font-size:12px; color:#999;">Фото «После» не загружено.</div>'}
                    </div>
                </div>
                ${reviewControls}
            </div>
        `;
    }).join('');
}

function toggleCollapse(bodyId, headerEl) {
    const body = document.getElementById(bodyId);
    if (!body) return;
    const willExpand = !body.classList.contains('expanded');
    body.classList.toggle('expanded', willExpand);
    const btn = headerEl?.querySelector('.collapse-toggle');
    if (btn) btn.innerText = willExpand ? 'Свернуть' : 'Развернуть';
}

const PLAYER_NOTIFICATION_DISMISSED_STORAGE_KEY = 'player_notification_dismissed_ids';

function getDismissedPlayerNotificationIds() {
    try {
        const raw = localStorage.getItem(PLAYER_NOTIFICATION_DISMISSED_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function isPlayerNotificationDismissed(notifId) {
    if (!notifId) return false;
    return getDismissedPlayerNotificationIds().includes(String(notifId));
}

function rememberDismissedPlayerNotification(notifId) {
    if (!notifId) return;
    const current = getDismissedPlayerNotificationIds();
    const id = String(notifId);
    if (current.includes(id)) return;
    try {
        localStorage.setItem(PLAYER_NOTIFICATION_DISMISSED_STORAGE_KEY, JSON.stringify([...current, id].slice(-300)));
    } catch (e) {
        // ignore storage errors
    }
}

function closePlayerNotification(notifId, shouldRemember = true) {
    const node = document.getElementById(notifId);
    if (node) node.remove();
    if (shouldRemember) rememberDismissedPlayerNotification(notifId);
}

function showPlayerNotification({ id, text, borderColor = '#f48fb1' }) {
    if (!id || !text) return;
    if (isPlayerNotificationDismissed(id)) return;
    const wrap = document.getElementById('player-notification-wrap');
    if (!wrap) return;
    if (document.getElementById(id)) return;
    const card = document.createElement('div');
    card.id = id;
    card.className = 'player-notification';
    card.style.borderColor = borderColor;
    card.innerHTML = `<button class="player-notification-close" onclick="closePlayerNotification('${id}', true)">✕</button><div style="font-size:13px; line-height:1.4; color:#4a148c;">${text}</div>`;
    wrap.appendChild(card);
}

function hasFullSubmissionForRound(roundNum, userId = currentUserId) {
    return allSubmissions.some(s => String(s.userId) === String(userId) && Number(s.round) === Number(roundNum) && s.beforeImageData && s.afterImageData);
}

async function burnUserTicketsAndEliminate(userId, reason = 'no_submission') {
    const boardSnap = await db.ref('board').once('value');
    const board = boardSnap.val() || {};
    const updates = {};

    Object.entries(board).forEach(([idx, cell]) => {
        if (!cell || Number(cell.userId) !== Number(userId)) return;
        updates[`board/${idx}/excluded`] = true;
        updates[`board/${idx}/ticketBurned`] = true;
    });

    const archiveSnap = await db.ref('tickets_archive').once('value');
    archiveSnap.forEach(item => {
        const v = item.val() || {};
        if (Number(v.userId) !== Number(userId)) return;
        updates[`tickets_archive/${item.key}/excluded`] = true;
        updates[`tickets_archive/${item.key}/ticketBurned`] = true;
    });

    updates[`whitelist/${userId}/isEliminated`] = true;
    updates[`whitelist/${userId}/isParticipationBlocked`] = true;
    updates[`whitelist/${userId}/eliminatedAt`] = Date.now();
    updates[`whitelist/${userId}/eliminatedAtRound`] = currentRoundNum;
    updates[`whitelist/${userId}/eliminationReason`] = reason;

    await db.ref().update(updates);
}

async function checkSubmissionRoundDeadlines() {
    if (!currentUserId || Number(currentUserId) === Number(ADMIN_ID) || myIndex === -1) return;
    if (!currentRoundNum || !roundEndTime) return;

    const boardSnap = await db.ref('board').once('value');
    const board = boardSnap.val() || {};
    const roundCell = Object.values(board).find(c => c && Number(c.userId) === Number(currentUserId) && c.round === currentRoundNum);

    const msLeft = roundEndTime - Date.now();
    if (roundCell && msLeft <= 10 * 3600000 && msLeft > 0 && !hasFullSubmissionForRound(currentRoundNum)) {
        const remindKey = `workReminderShownRound${currentRoundNum}`;
        if (!window[remindKey]) {
            window[remindKey] = true;
            showPlayerNotification({
                id: `work-reminder-${currentRoundNum}`,
                text: 'Твоя муза застряла в проке? 🎨 Твой холст скучает без мазков. Поторопись, иначе магические чернила испарятся, а твоё место на поле займет другой художник!'
            });
        }
    }

    const userStateSnap = await db.ref(`whitelist/${currentUserId}`).once('value');
    const userState = userStateSnap.val() || {};
    if (userState.isParticipationBlocked || userState.eliminationReason === 'no_submission') return;

    const previousRound = currentRoundNum - 1;
    if (previousRound < 1) return;
    const hadPrevCell = Object.values(board).some(c => c && Number(c.userId) === Number(currentUserId) && c.round === previousRound);
    if (!hadPrevCell || hasFullSubmissionForRound(previousRound)) return;

    await burnUserTicketsAndEliminate(currentUserId, 'no_submission');
    showPlayerNotification({
        id: `work-eliminated-${previousRound}`,
        text: 'Кажется, твоя работа так и не обнаружилась в загрузках. Печально, но твои билеты аннулированы, ты больше не принимаешь участие в игре.',
        borderColor: '#ef5350'
    });
    await postNews(`🚫 ${players[myIndex].n} пропустил(а) сдачу работы за раунд №${previousRound}. Билеты аннулированы, участие в игре остановлено.`);
}

function readImageAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function compressImage(dataUrl, maxSide = 1200, quality = 0.82) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * ratio);
            canvas.height = Math.round(img.height * ratio);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = dataUrl;
    });
}

async function submitWork() {
    const select = document.getElementById('work-task-select');
    const beforeInput = document.getElementById('work-image-before-input');
    const afterInput = document.getElementById('work-image-after-input');
    if (!select || select.disabled) return alert('Нет доступных заданий для сдачи.');
    const chosenCellIdx = Number(select.value);
    if (!Number.isInteger(chosenCellIdx) || chosenCellIdx < 0) return alert('Выбери задание.');
    const beforeFile = beforeInput?.files?.[0];
    const afterFile = afterInput?.files?.[0];
    if (!beforeFile || !afterFile) return alert('Нужно добавить оба фото: «До» и «После».');

    const boardCellSnap = await db.ref(`board/${chosenCellIdx}`).once('value');
    const cell = boardCellSnap.val();
    if (!cell || cell.userId !== currentUserId) return alert('Можно отправлять только свою работу по своему заданию.');
    if (cell.excluded) return alert('По этому заданию ты уже сдался(ась), билетик не начисляется.');
    if (typeof hasRevokedTicket === 'function' && hasRevokedTicket(cell.ticket)) {
        return alert('Этот билетик вычеркнут из игры, загрузка работы для него недоступна.');
    }

    const challengeSnap = await db.ref(`whitelist/${currentUserId}/ink_challenge`).once('value');
    const challenge = challengeSnap.val();
    if (cell.isWandBlessing) {
        const wandSnap = await db.ref(`whitelist/${currentUserId}/wand_blessing`).once('value');
        const wand = wandSnap.val();
        if (!wand || !wand.selectedOption) return alert('Сначала выбери упрощённое задание от волшебной палочки.');
    }

    if (cell.isInkChallenge && challenge?.selectedOption === 4) {
        if (!challenge.optionDeadline || Date.now() > challenge.optionDeadline) {
            return alert('⏰ Срок 24 часа истёк, билетик за это задание не начисляется.');
        }
    }

    const beforeRaw = await readImageAsDataURL(beforeFile);
    const afterRaw = await readImageAsDataURL(afterFile);
    const beforeImageData = await compressImage(beforeRaw);
    const afterImageData = await compressImage(afterRaw);

    const payload = {
        userId: currentUserId,
        owner: myIndex,
        cellIdx: chosenCellIdx,
        round: cell.round,
        ticket: cell.ticket,
        taskLabel: getTaskLabelByCell(cell),
        beforeImageData,
        afterImageData,
        status: 'pending',
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    await db.ref('submissions').push(payload);

    if (cell.isInkChallenge && challenge?.selectedOption === 4 && !challenge.isResolved) {
        await db.ref(`board/${chosenCellIdx}/ticket`).set(challenge.pendingTicket || '');
        await db.ref(`whitelist/${currentUserId}/ink_challenge`).update({ isResolved: true, submittedInTime: true });
    }

    beforeInput.value = '';
    afterInput.value = '';
    alert('Работа загружена! Статус: На проверке.');
}

async function setSubmissionStatus(submissionId, sourcePrefix, dbPath, status) {
    if (Number(currentUserId) !== Number(ADMIN_ID)) return;
    if (!['accepted', 'rejected'].includes(status)) return;
    const refPath = sourcePrefix === 'works' ? `works/${dbPath || submissionId}` : `submissions/${dbPath || submissionId}`;
    await db.ref(refPath).update({
        status,
        reviewedBy: currentUserId,
        updatedAt: Date.now()
    });
}

window.isPlayerNotificationDismissed = isPlayerNotificationDismissed;
