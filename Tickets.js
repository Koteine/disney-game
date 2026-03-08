(function () {
    const isAdminUser = () => Number(currentUserId) === Number(ADMIN_ID);
    let lastTicketCounterRepairAt = 0;
    let ticketCounterRepairInFlight = null;

    function updateAllTicketsDataAndRender() {
        allTicketsData = [...archivedTicketsData, ...liveBoardTicketsData];
        updateTicketsTable();
    }

    let archiveRefs = [];
    let archiveByKey = {};
    let revokedTicketsMap = {};
    let adminTicketsSubtab = 'all';
    let selectedAdminTicketUserId = null;

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

        if (isAdminUser()) {
            const adminRef = db.ref('tickets_archive');
            archiveRefs.push(adminRef);
            adminRef.on('value', snap => {
                const archived = [];
                snap.forEach(item => {
                    const v = item.val() || {};
                    archived.push({ ...v, isArchived: true, archiveKey: item.key });
                });
                archivedTicketsData = archived;
                updateAllTicketsDataAndRender();
            });
            return;
        }

        attachArchiveRef(db.ref('tickets_archive').orderByChild('userId').equalTo(Number(currentUserId)));
        attachArchiveRef(db.ref('tickets_archive').orderByChild('userId').equalTo(String(currentUserId)));
        if (Number.isInteger(myIndex)) {
            attachArchiveRef(db.ref('tickets_archive').orderByChild('owner').equalTo(myIndex));
        }
    }

    function syncTicketData() {
        db.ref('board').on('value', snap => {
            const data = snap.val() || {};
            const grid = document.getElementById('grid');
            if (grid) grid.innerHTML = "";
            liveBoardTicketsData = [];

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
                    d.innerHTML = (cell.isTrap ? '💣' : (cell.isMagic ? '🔮' : (cell.isMiniGame ? '🎮' : (cell.isWordSketch ? '🧩' : (cell.isMagnet ? '👯' : (cell.isWandBlessing ? '🎆' : (cell.itemType === 'goldenPollen' ? '🎇' : (cell.itemType === 'inkSaboteur' ? '🫧' : (cell.itemType === 'magicWand' ? '🎆' : (cell.itemType === 'magnifier' ? '🔎' : (i + 1)))) ))))))) + `<span>🎟${cell.ticket}</span>`;
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
            if (isAdminUser()) return;
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

    function hasRevokedTicket(ticketValue) {
        return extractTicketNumbers(ticketValue).some(n => isTicketRevoked(n));
    }

    function getTicketSourceLabel(t) {
        if (t.isEventReward) return '🎨 Событие';
        if (t.isManualReward) return '🎫 Ручная выдача';
        if (t.isManualRevoke) return '🧾 Изъят админом';
        if (Number.isInteger(t.round) && t.round > 0) return `Раунд ${t.round}`;
        return 'Иной источник';
    }

    function getTicketTaskLabel(t) {
        if (t.isEventReward) return t.eventId === 'wall_battle' ? 'Награда за событие «Стенка на стенку»' : 'Награда за событие «Эпичный закрас»';
        if (typeof t.taskLabel === 'string' && t.taskLabel.trim()) return t.taskLabel;
        if (Number.isInteger(t.taskIdx) && t.taskIdx >= 0 && Array.isArray(tasks) && tasks[t.taskIdx]) {
            return tasks[t.taskIdx].text || 'Обычное задание';
        }
        if (t.isManualReward) return t.adminNote ? `Ручная выдача: ${t.adminNote}` : 'Ручная выдача администратором';
        if (t.isManualRevoke) return t.adminNote ? `Изъятие: ${t.adminNote}` : 'Изъято администратором';
        return '—';
    }

    function expandTicketsRows(rows) {
        const expanded = [];
        rows.forEach(t => {
            extractTicketNumbers(t.ticket).forEach(ticketNum => {
                expanded.push({
                    ...t,
                    ticketNum: String(ticketNum),
                    isRevoked: isTicketRevoked(ticketNum),
                    canUndoRevoke: !!(t.isManualRevoke && !t.revokeCancelledAt && t.archiveKey),
                    sourceLabel: getTicketSourceLabel(t),
                    taskLabel: getTicketTaskLabel(t)
                });
            });
        });
        return expanded.filter(t => !t.isRevoked && (!t.excluded || t.isManualRevoke));
    }

    async function toggleTicketRevocation(ticketNum, shouldRevoke) {
        if (!isAdminUser()) return;
        const num = String(ticketNum || '').trim();
        if (!/^\d+$/.test(num)) return;
        if (shouldRevoke) {
            await db.ref(`revoked_tickets/${num}`).set(true);
            return;
        }
        await db.ref(`revoked_tickets/${num}`).remove();
    }

    async function claimSequentialTickets(count = 1) {
        const needed = Math.max(1, Math.floor(Number(count) || 1));
        const awarded = [];

        await maybeRepairTicketCounterDrift();

        while (awarded.length < needed) {
            let rangeStart = null;
            let rangeEnd = null;
            const tx = await db.ref('ticket_counter').transaction(c => {
                const current = Number(c) || 0;
                if (current >= MAX_TICKETS) return;
                const remain = MAX_TICKETS - current;
                const reserve = Math.min(50, remain, Math.max(needed - awarded.length, 1));
                rangeStart = current + 1;
                rangeEnd = current + reserve;
                return current + reserve;
            });

            if (!tx.committed || !Number.isInteger(rangeStart) || !Number.isInteger(rangeEnd)) break;

            for (let n = rangeStart; n <= rangeEnd; n += 1) {
                awarded.push(String(n));
                if (awarded.length >= needed) break;
            }
        }

        return awarded.length ? awarded : null;
    }

    async function maybeRepairTicketCounterDrift() {
        const now = Date.now();
        if (ticketCounterRepairInFlight) return ticketCounterRepairInFlight;
        if (now - lastTicketCounterRepairAt < 30000) return;

        ticketCounterRepairInFlight = (async () => {
            const [counterSnap, boardSnap, archiveSnap, revokedSnap] = await Promise.all([
                db.ref('ticket_counter').once('value'),
                db.ref('board').once('value'),
                db.ref('tickets_archive').once('value'),
                db.ref('revoked_tickets').once('value')
            ]);

            const counter = Number(counterSnap.val()) || 0;
            const revokedMap = revokedSnap.val() || {};
            let maxActiveTicket = 0;

            const includeTicket = (ticketValue) => {
                extractTicketNumbers(ticketValue).forEach(num => {
                    const n = Number(num);
                    if (!Number.isInteger(n) || n < 1) return;
                    if (revokedMap[String(n)]) return;
                    if (n > maxActiveTicket) maxActiveTicket = n;
                });
            };

            Object.values(boardSnap.val() || {}).forEach(cell => {
                if (!cell || cell.excluded) return;
                includeTicket(cell.ticket);
            });

            archiveSnap.forEach(item => {
                const row = item.val() || {};
                if (row.excluded && !row.isManualRevoke) return;
                includeTicket(row.ticket);
            });

            const drift = counter - maxActiveTicket;
            if (counter < maxActiveTicket || drift > 200) {
                await db.ref('ticket_counter').set(maxActiveTicket);
            }

            lastTicketCounterRepairAt = Date.now();
        })();

        try {
            await ticketCounterRepairInFlight;
        } finally {
            ticketCounterRepairInFlight = null;
        }
    }

    function switchAdminTicketsSubtab(tabName) {
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

    function getAdminPlayersAlphabetically() {
        const whitelist = window.cachedWhitelistData || {};
        const users = Object.entries(whitelist)
            .map(([userId, data]) => ({ userId: String(userId), charIndex: data?.charIndex }))
            .filter(p => Number.isInteger(p.charIndex) && players[p.charIndex])
            .map(p => ({ ...p, name: players[p.charIndex].n }));

        users.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
        return users;
    }

    function renderAdminPlayerTickets(expandedRows) {
        const playersListEl = document.getElementById('admin-ticket-players-list');
        const ticketsListEl = document.getElementById('admin-player-tickets-list');
        const titleEl = document.getElementById('admin-player-tickets-title');
        const isAdmin = isAdminUser();
        if (!playersListEl || !ticketsListEl || !titleEl) return;

        const users = getAdminPlayersAlphabetically();
        if (!users.length) {
            playersListEl.innerHTML = '<div style="color:#888; font-size:12px;">Игроков пока нет.</div>';
            titleEl.innerText = 'Выбери игрока, чтобы увидеть его билетики';
            ticketsListEl.innerHTML = '';
            return;
        }

        if (!selectedAdminTicketUserId || !users.some(u => u.userId === String(selectedAdminTicketUserId))) {
            selectedAdminTicketUserId = users[0].userId;
        }

        playersListEl.innerHTML = users.map(u => {
            const active = String(selectedAdminTicketUserId) === String(u.userId);
            return `<button onclick="selectAdminTicketUser('${u.userId}')" style="text-align:left; border:1px solid ${active ? '#f48fb1' : '#eee'}; background:${active ? '#fff0f6' : '#fff'}; border-radius:8px; padding:8px;">${u.name}</button>`;
        }).join('');

        const selectedUser = users.find(u => String(u.userId) === String(selectedAdminTicketUserId));
        const filtered = expandedRows
            .filter(t => String(t.userId) === String(selectedAdminTicketUserId) || String(t.owner) === String(selectedUser?.charIndex))
            .sort((a, b) => Number(a.ticketNum) - Number(b.ticketNum));

        titleEl.innerText = selectedUser ? `Билетики игрока: ${selectedUser.name}` : 'Билетики игрока';
        if (!filtered.length) {
            ticketsListEl.innerHTML = '<div style="font-size:12px; color:#888;">У игрока пока нет билетиков.</div>';
            return;
        }

        ticketsListEl.innerHTML = filtered.map(t => `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 0; border-bottom:1px dashed #eee;">
                <div style="text-align:left;">
                    <div style="font-weight:700; color:#222;">🎟 ${t.ticketNum}</div>
                    <div style="font-size:11px; color:#666;">${t.sourceLabel}</div>
                </div>
                <div style="display:flex; align-items:center; gap:6px;">
                    <button onclick="openTicketTask('${t.ticketNum}')" title="Посмотреть задание" style="background:none; border:1px solid #90caf9; color:#1565c0; border-radius:8px; font-size:12px; padding:5px 8px;">👀</button>
                </div>
            </div>
        `).join('');
    }

    function selectAdminTicketUser(userId) {
        selectedAdminTicketUserId = String(userId || '');
        updateTicketsTable();
    }

    function updateTicketsTable() {
        const body = document.getElementById('tickets-body');
        const isAdmin = isAdminUser();
        const adminSubtabs = document.getElementById('admin-tickets-subtabs');

        if (adminSubtabs) adminSubtabs.style.display = isAdmin ? 'flex' : 'none';
        if (document.getElementById('th-user-name')) {
            document.getElementById('th-user-name').style.display = isAdmin ? 'table-cell' : 'none';
        }

        if (isAdmin) {
            switchAdminTicketsSubtab(adminTicketsSubtab);
        }

        const visibleData = isAdmin
            ? allTicketsData
            : allTicketsData.filter(t => t.owner === myIndex || String(t.userId) === String(currentUserId) || Number(t.userId) === Number(currentUserId));

        const expandedRows = expandTicketsRows(visibleData)
            .sort((a, b) => Number(a.ticketNum) - Number(b.ticketNum));

        body.innerHTML = expandedRows.map(t => {
            const statusClass = t.excluded ? 'row-excluded' : '';
            return `
                <tr class="${statusClass}">
                    <td>${t.round || '—'}</td>
                    <td>${t.cell || '—'}</td>
                    ${isAdmin ? `<td style="color:${charColors[t.owner]}; font-weight:bold;">${players[t.owner]?.n || 'Неизвестный'}</td>` : ''}
                    <td><b>${t.ticketNum}</b></td>
                    <td>
                        <div style="font-size:11px;">${t.sourceLabel}</div>
                        ${t.adminNote ? `<div style="font-size:10px; color:#666;">${t.adminNote}</div>` : ''}
                        ${t.isManualRevoke && t.revokeCancelledAt ? `<div style="font-size:10px; color:#2e7d32; margin-top:3px;">Изъятие отменено</div>` : ''}
                        <button onclick="openTicketTask('${t.ticketNum}')" title="Посмотреть задание" style="margin-top:4px; background:none; border:1px solid #90caf9; color:#1565c0; border-radius:8px; font-size:10px; padding:3px 6px;">👀</button>
                        ${t.canUndoRevoke ? `<button onclick="adminUndoTicketRevoke('${t.archiveKey}')" title="Отменить изъятие" style="margin-top:4px; margin-left:4px; background:#fff8e1; border:1px solid #ffcc80; color:#ef6c00; border-radius:8px; font-size:10px; padding:3px 6px;">↩️ Отменить</button>` : ''}
                    </td>
                </tr>`;
        }).join('');

        if (isAdmin) {
            renderAdminPlayerTickets(expandedRows);
        }
    }

    function viewTaskDetails(cellIdx) {
        db.ref('board/' + cellIdx).once('value', s => {
            if (s.exists()) showCell(cellIdx, s.val());
        });
    }



    function openTicketTask(ticketNum) {
        const num = String(ticketNum || '').trim();
        if (!/^\d+$/.test(num)) return;
        const isAdmin = isAdminUser();
        const entry = allTicketsData.find(t => {
            const owns = Number(t.userId) === Number(currentUserId) || t.owner === myIndex;
            return extractTicketNumbers(t.ticket).includes(num) && (isAdmin || owns);
        });
        if (!entry) {
            alert('Не удалось найти задание для этого билетика.');
            return;
        }
        const taskText = getTicketTaskLabel(entry);
        alert(`🎫 Билет ${num}

${taskText}`);
    }

    function getActiveTicketsForWheel() {
        const tickets = [];
        allTicketsData.forEach(t => {
            if (t.excluded) return;
            extractTicketNumbers(t.ticket).forEach(n => {
                if (isTicketRevoked(n)) return;
                tickets.push({ num: String(n), owner: t.owner, name: players[t.owner]?.n || 'Неизвестный' });
            });
        });
        return tickets.sort((a, b) => Number(a.num) - Number(b.num));
    }

    window.syncTicketData = syncTicketData;
    window.extractTicketNumbers = extractTicketNumbers;
    window.hasRevokedTicket = hasRevokedTicket;
    window.claimSequentialTickets = claimSequentialTickets;
    window.updateTicketsTable = updateTicketsTable;
    window.viewTaskDetails = viewTaskDetails;
    window.getActiveTicketsForWheel = getActiveTicketsForWheel;
    window.toggleTicketRevocation = toggleTicketRevocation;
    window.switchAdminTicketsSubtab = switchAdminTicketsSubtab;
    window.selectAdminTicketUser = selectAdminTicketUser;
    window.openTicketTask = openTicketTask;
})();
