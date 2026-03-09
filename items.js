(function () {
    const itemTypes = {
        goldenPollen: {
            emoji: '🎇',
            name: 'Золотая пыльца',
            description: 'Даёт +1 билет к следующему получению билетов (одноразово).'
        },
        inkSaboteur: {
            emoji: '🫧',
            name: 'Клякса-саботаж',
            description: 'Позволяет выбрать игроку усложнение для следующей работы.'
        },
        magicWand: {
            emoji: '🎆',
            name: 'Волшебная палочка',
            description: 'Даёт упрощение задания на текущий раунд.'
        },
        magnifier: {
            emoji: '🔎',
            name: 'Лупа',
            description: 'Помогает в игровых механиках, где разрешено её использование.'
        }
    };

    const inkChallengeOptions = [
        'Отжимание: 10 приседаний + 10 прыжков',
        'Смена руки: рисуй нерабочей рукой',
        'Без контура: запрещено использовать чёрный/контур',
        '24 часа: работа должна быть сдана в течение 24 часов'
    ];

    function normalizeInventory(raw = {}) {
        return {
            goldenPollen: Number(raw.goldenPollen || 0),
            inkSaboteur: Number(raw.inkSaboteur || 0),
            magicWand: Number(raw.magicWand || 0),
            magnifier: Number(raw.magnifier || 0)
        };
    }

    function inventoryCount(itemKey) {
        return Number(myInventory?.[itemKey] || 0);
    }

    function isOwnRegularCell(cell) {
        return !!cell
            && Number(cell.userId) === Number(currentUserId)
            && !cell.excluded
            && !cell.isTrap
            && !cell.isMagic
            && !cell.isMiniGame
            && !cell.isWordSketch
            && !cell.isGold
            && !cell.isInkChallenge
            && !cell.isWandBlessing
            && !cell.isMagnet;
    }

    function pickRandomTaskIndex(excluded = []) {
        const blocked = new Set((excluded || []).filter(Number.isInteger));
        const pool = tasks
            .map((_, i) => i)
            .filter(i => !blocked.has(i));
        if (!pool.length) return -1;
        return pool[Math.floor(Math.random() * pool.length)];
    }

    async function addInventoryItem(itemKey, amount = 1) {
        if (!currentUserId || !itemTypes[itemKey]) return;
        const addAmount = Math.max(0, Number(amount) || 0);
        if (!addAmount) return;

        await waitForDbReady();
        const ref = db.ref(`whitelist/${currentUserId}/inventory`);
        const snap = await ref.once('value');
        const current = snap.val() || {};
        const next = normalizeInventory(current);
        next[itemKey] = Math.max(0, next[itemKey] + addAmount);
        await ref.set(next);
    }

    async function consumeInventoryItem(itemKey, amount = 1) {
        if (!currentUserId || !itemTypes[itemKey]) return false;
        const minusAmount = Math.max(1, Number(amount) || 1);

        await waitForDbReady();
        const ref = db.ref(`whitelist/${currentUserId}/inventory`);
        const snap = await ref.once('value');
        const current = snap.val() || {};
        const next = normalizeInventory(current);
        if (next[itemKey] < minusAmount) return false;
        next[itemKey] -= minusAmount;
        await ref.set(next);
        return true;
    }

    function renderInventory() {
        const row = document.getElementById('inventory-row');
        if (!row) return;

        const chips = Object.entries(itemTypes)
            .map(([key, meta]) => ({ key, meta, count: inventoryCount(key) }))
            .filter(x => x.count > 0)
            .map(x => `<span class="inv-chip" title="${x.meta.description}">${x.meta.emoji} ${x.meta.name} ×${x.count}</span>`);

        row.innerHTML = chips.length ? chips.join('') : '<span class="inv-chip">Пусто</span>';
    }

    async function activateGoldenPollen(cellIdx) {
        const cellSnap = await db.ref(`board/${cellIdx}`).once('value');
        const cell = cellSnap.val();
        if (!isOwnRegularCell(cell) || cell.itemType) return alert('Золотую пыльцу можно использовать только на своей обычной клетке без предмета.');
        if (inventoryCount('goldenPollen') <= 0) return alert('В рюкзаке нет Золотой пыльцы.');

        const usedSnap = await db.ref(`whitelist/${currentUserId}/used_tasks`).once('value');
        const used = Array.isArray(usedSnap.val()) ? usedSnap.val() : [];
        const nextTask = pickRandomTaskIndex([cell.taskIdx, ...used]);
        if (nextTask < 0) return alert('Не нашлось свободных заданий для переброса.');

        const consumed = await consumeInventoryItem('goldenPollen', 1);
        if (!consumed) return alert('Золотая пыльца уже закончилась.');

        const nextUsed = [...used, nextTask];
        await db.ref(`whitelist/${currentUserId}/used_tasks`).set(nextUsed);
        await db.ref(`board/${cellIdx}`).update({ taskIdx: nextTask, pollenUsedAt: Date.now() });
        await postNews(`🎇 ${players[myIndex].n} использовал(а) Золотую пыльцу и перебросил(а) задание в клетке №${Number(cellIdx) + 1}.`);
        const updated = await db.ref(`board/${cellIdx}`).once('value');
        showCell(cellIdx, updated.val());
    }

    async function activateMagnifier(cellIdx) {
        const cellSnap = await db.ref(`board/${cellIdx}`).once('value');
        const cell = cellSnap.val();
        if (!isOwnRegularCell(cell) || cell.itemType) return alert('Лупу можно применить только к своей обычной клетке без предмета.');
        if (inventoryCount('magnifier') <= 0) return alert('В рюкзаке нет Лупы.');

        const usedRoundSnap = await db.ref(`whitelist/${currentUserId}/magnifier_used_round`).once('value');
        if (Number(usedRoundSnap.val() || 0) === Number(currentRoundNum)) {
            return alert('Лупа уже использована в этом раунде.');
        }

        const usedSnap = await db.ref(`whitelist/${currentUserId}/used_tasks`).once('value');
        const used = Array.isArray(usedSnap.val()) ? usedSnap.val() : [];
        const nextTask = pickRandomTaskIndex([cell.taskIdx, ...used]);
        if (nextTask < 0) return alert('Не нашлось свободных заданий для Лупы.');

        const consumed = await consumeInventoryItem('magnifier', 1);
        if (!consumed) return alert('Лупа уже закончилась.');

        await db.ref(`whitelist/${currentUserId}/used_tasks`).set([...used, nextTask]);
        await db.ref(`whitelist/${currentUserId}/magnifier_used_round`).set(currentRoundNum);
        await db.ref(`board/${cellIdx}`).update({ taskIdx: nextTask, magnifierUsedAt: Date.now() });
        await postNews(`🔎 ${players[myIndex].n} использовал(а) Лупу и обновил(а) задание в клетке №${Number(cellIdx) + 1}.`);
        const updated = await db.ref(`board/${cellIdx}`).once('value');
        showCell(cellIdx, updated.val());
    }

    async function activateInkSaboteur(cellIdx) {
        const cellSnap = await db.ref(`board/${cellIdx}`).once('value');
        const cell = cellSnap.val();
        if (!cell || Number(cell.userId) !== Number(currentUserId) || cell.itemType !== 'inkSaboteur') {
            return alert('Кляксу можно запускать только из своей предметной клетки 🫧.');
        }
        if (cell.inkUsed || cell.isInkChallenge) return alert('Клякса для этой клетки уже использована.');

        const boardSnap = await db.ref('board').once('value');
        const board = boardSnap.val() || {};
        const targets = [];

        Object.entries(board).forEach(([idx, c]) => {
            if (!c || Number(c.userId) === Number(currentUserId)) return;
            if (c.excluded || c.round !== currentRoundNum) return;
            if (c.isTrap || c.isMagic || c.isGold || c.isMiniGame || c.isWordSketch || c.isMagnet || c.isInkChallenge || c.isWandBlessing) return;
            targets.push({ cellIdx: Number(idx), cell: c, name: players[c.owner]?.n || `Игрок ${c.userId}` });
        });

        if (!targets.length) return alert('Нет подходящих игроков для кляксы в текущем раунде.');

        const optionsText = targets.map((t, i) => `${i + 1} — ${t.name} (клетка №${t.cellIdx + 1})`).join('\n');
        const rawChoice = prompt(`Выбери цель для кляксы:\n${optionsText}\n\nВведи номер:`, '1');
        if (rawChoice === null) return;
        const pick = Number(rawChoice);
        if (!Number.isInteger(pick) || pick < 1 || pick > targets.length) return alert('Некорректный номер цели.');
        const target = targets[pick - 1];

        const targetPendingTicket = target.cell.ticket || '';
        const updates = {};
        updates[`board/${target.cellIdx}/isInkChallenge`] = true;
        updates[`board/${target.cellIdx}/inkOption`] = null;
        updates[`board/${target.cellIdx}/inkOptionLabel`] = '';
        updates[`board/${target.cellIdx}/ticket`] = '';

        updates[`whitelist/${target.cell.userId}/ink_challenge`] = {
            fromUserId: currentUserId,
            fromCellIdx: Number(cellIdx),
            round: currentRoundNum,
            cellIdx: target.cellIdx,
            pendingTicket: targetPendingTicket,
            selectedOption: null,
            selectedOptionLabel: '',
            draftOption: null,
            draftOptionLabel: '',
            isResolved: false,
            createdAt: Date.now()
        };

        updates[`board/${cellIdx}/isInkChallenge`] = true;
        updates[`board/${cellIdx}/inkUsed`] = true;
        updates[`board/${cellIdx}/ticket`] = cell.inkPendingTicket || '';
        updates[`board/${cellIdx}/inkPendingTicket`] = '';

        await db.ref().update(updates);
        await postNews(`🫧 ${players[myIndex].n} запустил(а) кляксу: игрок ${target.name} получил(а) усложнение на клетке №${target.cellIdx + 1}.`);
        alert(`Клякса отправлена игроку ${target.name}. Теперь он(а) должен(на) выбрать усложнение.`);
        const updated = await db.ref(`board/${cellIdx}`).once('value');
        showCell(cellIdx, updated.val());
    }

    window.itemTypes = itemTypes;
    window.inkChallengeOptions = inkChallengeOptions;
    window.addInventoryItem = addInventoryItem;
    window.renderInventory = renderInventory;
    window.activateGoldenPollen = activateGoldenPollen;
    window.activateMagnifier = activateMagnifier;
    window.activateInkSaboteur = activateInkSaboteur;
})();
