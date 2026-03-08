(function () {
    function updateAllTicketsDataAndRender() {
        allTicketsData = [...archivedTicketsData, ...liveBoardTicketsData];
        updateTicketsTable();
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

        db.ref('tickets_archive').on('value', snap => {
            const archived = [];
            snap.forEach(item => {
                const v = item.val() || {};
                archived.push({ ...v, isArchived: true });
            });
            archivedTicketsData = archived;
            updateAllTicketsDataAndRender();
        });
    }

    function extractTicketNumbers(ticketValue) {
        return String(ticketValue || '')
            .split(' и ')
            .map(t => t.trim())
            .filter(t => /^\d+$/.test(t));
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
        const awarded = Array.from({ length: count }, (_, idx) => String(startFrom + idx));

        const revokeCleanup = {};
        awarded.forEach(num => {
            revokeCleanup[`revoked_tickets/${num}`] = null;
        });
        await db.ref().update(revokeCleanup);

        return awarded;
    }

    function updateTicketsTable() {
        const body = document.getElementById('tickets-body');
        const isAdmin = (currentUserId === ADMIN_ID);

        if (document.getElementById('th-user-name')) {
            document.getElementById('th-user-name').style.display = isAdmin ? 'table-cell' : 'none';
        }

        const sortedData = allTicketsData.sort((a, b) => b.round - a.round || b.ticket - a.ticket);

        body.innerHTML = sortedData.map(t => {
            if (!isAdmin && t.owner !== myIndex && Number(t.userId) !== Number(currentUserId)) return '';
            const statusClass = t.excluded ? 'row-excluded' : '';

            return `
                <tr class="${statusClass}">
                    <td>${t.round}</td>
                    <td>${t.cell}</td>
                    ${isAdmin ? `<td style="color:${charColors[t.owner]}; font-weight:bold;">${players[t.owner].n}</td>` : ''}
                    <td><b>${t.ticket}</b></td>
                    <td>
                        <div style="display:flex; gap:5px; justify-content:center;">
                            ${(Number.isInteger(t.cellIdx) && t.cellIdx >= 0) ? `<button onclick="viewTaskDetails(${t.cellIdx ?? (t.cell - 1)})" style="background:none; border:none; font-size:14px;">${isAdmin ? '👁️' : '📝'}</button>` : `<span style="font-size:14px; opacity:0.5;">—</span>`}
                            ${isAdmin && !t.isArchived ? `<button onclick="db.ref('board/${t.cellIdx}/excluded').set(!${t.excluded})" style="background:none; border:none; font-size:14px;">${t.excluded ? '❌' : '✅'}</button>` : ''}
                        </div>
                    </td>
                </tr>`;
        }).join('');
    }

    function viewTaskDetails(cellIdx) {
        db.ref('board/' + cellIdx).once('value', s => {
            if (s.exists()) showCell(cellIdx, s.val());
        });
    }

    function getActiveTicketsForWheel() {
        const tickets = [];
        allTicketsData.forEach(t => {
            if (t.excluded) return;
            extractTicketNumbers(t.ticket).forEach(n => {
                tickets.push({ num: String(n), owner: t.owner, name: players[t.owner]?.n || 'Неизвестный' });
            });
        });
        return tickets.sort((a, b) => Number(a.num) - Number(b.num));
    }

    window.syncTicketData = syncTicketData;
    window.extractTicketNumbers = extractTicketNumbers;
    window.claimSequentialTickets = claimSequentialTickets;
    window.updateTicketsTable = updateTicketsTable;
    window.viewTaskDetails = viewTaskDetails;
    window.getActiveTicketsForWheel = getActiveTicketsForWheel;
})();

