(function () {
const itemTypes = {
    goldenPollen: { emoji: "🎇", name: "Золотая пыльца" },
    inkSaboteur: { emoji: "🫧", name: "Клякса-диверсант" },
    magicWand: { emoji: "🎆", name: "Волшебная палочка" },
    magnifier: { emoji: "🔎", name: "Лупа" }
};

const inkChallengeOptions = [
    "Пройти пятнашки: даже если они уже выпадали в раунде. Если справишься — получишь кодовое слово и билетик, иначе пропуск хода.",
    "В твоей работе должно быть минимум 60% БЛЯСКУЧЕСТИ! Да, твори!",
    "Возлюби пиксель-арт. Ожидаем красивую пиксельную картинку.",
    "Таймер сдачи работы: с этого момента у тебя всего 24 часа на сдачу работы."
];

function renderInventory() {
    const row = document.getElementById('inventory-row');
    if (!row) return;

    const chips = [];
    if ((myInventory.goldenPollen || 0) > 0) chips.push(`<span class="inv-chip">🎇 Золотая пыльца ×${myInventory.goldenPollen}</span>`);
    if ((myInventory.inkSaboteur || 0) > 0) chips.push(`<span class="inv-chip">🫧 Клякса-диверсант ×${myInventory.inkSaboteur}</span>`);
    if ((myInventory.magnifier || 0) > 0) chips.push(`<span class="inv-chip">🔎 Лупа ×${myInventory.magnifier}</span>`);

    row.innerHTML = chips.length ? chips.join('') : '<span class="inv-chip">Пусто</span>';
}

async function addInventoryItem(itemKey, amount = 1) {
    const invRef = db.ref(`whitelist/${currentUserId}/inventory/${itemKey}`);
    await invRef.transaction(v => (v || 0) + amount);
}

async function consumeInventoryItem(itemKey, amount = 1) {
    const invRef = db.ref(`whitelist/${currentUserId}/inventory/${itemKey}`);
    await invRef.transaction(v => Math.max((v || 0) - amount, 0));
}

function isRegularCellForMagnifier(cellIdx, roundData, boardObj) {
    if (boardObj[cellIdx]) return false;
    const itemCells = roundData?.itemCells || {};
    if (roundData?.magicCell === cellIdx) return false;
    if (roundData?.miniGameCell === cellIdx) return false;
    if (roundData?.wordSketchCell === cellIdx) return false;
    if (roundData?.magnetCell === cellIdx) return false;
    if (itemCells[cellIdx]) return false;
    if (roundData?.traps && roundData.traps.includes(cellIdx)) return false;
    return true;
}

async function showMagnifierChoiceDialog(taskText) {
    return new Promise(resolve => {
        const existing = document.getElementById('magnifier-choice-dialog');
        if (existing) existing.remove();

        const dialog = document.createElement('div');
        dialog.id = 'magnifier-choice-dialog';
        dialog.style.position = 'fixed';
        dialog.style.inset = '0';
        dialog.style.background = 'rgba(0,0,0,0.45)';
        dialog.style.display = 'flex';
        dialog.style.alignItems = 'center';
        dialog.style.justifyContent = 'center';
        dialog.style.zIndex = '2300';
        dialog.innerHTML = `
            <div style="width:min(92vw, 430px); background:#fff; border-radius:14px; padding:14px; text-align:left; box-shadow:0 8px 28px rgba(0,0,0,0.22);">
                <div style="font-weight:bold; color:#4a148c; margin-bottom:8px;">🔎 Лупа показала задание</div>
                <div style="font-size:14px; color:#333; line-height:1.45; max-height:38vh; overflow:auto; white-space:pre-wrap;">${taskText}</div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:12px;">
                    <button id="magnifier-take" style="border:1px solid #2e7d32; background:#e8f5e9; color:#1b5e20; border-radius:10px; padding:10px; font-weight:bold;">✅ Беру</button>
                    <button id="magnifier-skip" style="border:1px solid #8d6e63; background:#efebe9; color:#4e342e; border-radius:10px; padding:10px; font-weight:bold;">↩️ Не беру</button>
                </div>
            </div>
        `;

        const finish = (result) => {
            dialog.remove();
            resolve(result);
        };
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) finish(false);
        });
        document.body.appendChild(dialog);
        document.getElementById('magnifier-take').onclick = () => finish(true);
        document.getElementById('magnifier-skip').onclick = () => finish(false);
    });
}

async function activateMagnifier(sourceCellIdx) {
    if ((myInventory.magnifier || 0) <= 0) return alert('В рюкзаке нет Лупы.');

    const userStateSnap = await db.ref(`whitelist/${currentUserId}`).once('value');
    const userState = userStateSnap.val() || {};
    if ((userState.magnifier_used_round || 0) === currentRoundNum) {
        return alert('В этом раунде Лупа уже использована.');
    }

    const srcSnap = await db.ref(`board/${sourceCellIdx}`).once('value');
    const sourceCell = srcSnap.val();
    if (!sourceCell || sourceCell.userId !== currentUserId) return alert('Лупу можно применить только в своей клетке.');
    if (sourceCell.excluded) return alert('Нельзя применить Лупу в сданной клетке.');
    if (sourceCell.isTrap || sourceCell.isMagic || sourceCell.isMiniGame || sourceCell.isWordSketch || sourceCell.isInkChallenge || sourceCell.isWandBlessing || sourceCell.isMagnet) {
        return alert('Лупа работает только для обычных заданий.');
    }

    const [boardSnap, roundSnap, userTasksSnap] = await Promise.all([
        db.ref('board').once('value'),
        db.ref('current_round').once('value'),
        db.ref(`whitelist/${currentUserId}/used_tasks`).once('value')
    ]);
    const board = boardSnap.val() || {};
    const rData = roundSnap.val() || {};
    const used = userTasksSnap.val() || [];
    const availTasks = tasks.map((_, i) => i).filter(i => !used.includes(i) && i !== sourceCell.taskIdx);
    if (!availTasks.length) return alert('Нет доступных новых заданий для Лупы.');

    const candidates = [];
    for (let i = 0; i < 50; i++) if (isRegularCellForMagnifier(i, rData, board)) candidates.push(i);
    if (!candidates.length) return alert('Нет свободных обычных клеток для просмотра через Лупу.');

    const answer = prompt(`🔎 Выбери номер свободной обычной клетки для просмотра:
${candidates.map(v => v + 1).join(', ')}`);
    const targetCellIdx = Number(answer) - 1;
    if (!Number.isInteger(targetCellIdx) || !candidates.includes(targetCellIdx)) {
        return alert('Нужно ввести корректный номер свободной обычной клетки.');
    }

    const previewTaskIdx = availTasks[Math.floor(Math.random() * availTasks.length)];
    const previewText = tasks[previewTaskIdx]?.text || 'Обычное задание';
    const takeCell = await showMagnifierChoiceDialog(previewText);

    await consumeInventoryItem('magnifier', 1);
    await db.ref(`whitelist/${currentUserId}/magnifier_used_round`).set(currentRoundNum);

    if (!takeCell) {
        await postNews(`🔎 ${players[myIndex].n} использовал(а) Лупу и отказался(ась) от просмотренной клетки.`);
        alert('Лупа сгорела. Ты остаёшься на своей текущей клетке.');
        return;
    }

    const nextCell = {
        ...sourceCell,
        taskIdx: previewTaskIdx,
        itemType: null,
        inkPendingTicket: '',
        inkUsed: false,
        isGold: false,
        isTrap: false,
        isMagic: false,
        isMiniGame: false,
        isWordSketch: false,
        isInkChallenge: false,
        isWandBlessing: false,
        isMagnet: false,
        trapText: '',
        magicLinkId: null,
        miniGameTiles: null,
        miniGameWon: false,
        miniGameFailed: false,
        miniGameCodeWord: '',
        wordSketchAnswer: '',
        wordSketchGuess: '',
        wordSketchAttempts: [],
        wordSketchAttemptCount: 0,
        wordSketchGuessed: false,
        wordSketchFailed: false,
        wandOptionLabel: ''
    };

    const updates = {};
    updates[`board/${targetCellIdx}`] = nextCell;
    updates[`board/${sourceCellIdx}`] = null;
    updates[`whitelist/${currentUserId}/used_tasks`] = [...used, previewTaskIdx];
    await db.ref().update(updates);

    await postNews(`🔎 ${players[myIndex].n} применил(а) Лупу и пересел(а) на клетку №${targetCellIdx + 1}.`);
    alert('Отлично! Ты забрал(а) новое задание через Лупу. Старая клетка освобождена.');
    showCell(targetCellIdx, nextCell);
}

function getEligibleSabotageTargets(whitelistObj) {
    return Object.entries(whitelistObj || {})
        .map(([uid, value]) => ({ userId: Number(uid), ...value }))
        .filter(p => p.userId !== currentUserId)
        .filter(p => Number.isInteger(p.charIndex) && players[p.charIndex])
        .filter(p => p.last_round !== currentRoundNum);
}

async function sendInkChallengeImmediately(sourceCellIdx = null) {
    const whiteSnap = await db.ref('whitelist').once('value');
    const white = whiteSnap.val() || {};
    const targets = getEligibleSabotageTargets(white);
    if (!targets.length) {
        alert('Нет игроков, которым можно отправить кляксу в этом раунде (все уже сходили).');
        return false;
    }

    const menu = targets.map((t, idx) => `${idx + 1}) ${players[t.charIndex].n}`).join('\n');
    const answer = prompt(`Выбери игрока для подлянки (введи номер):\n${menu}`);
    const chosen = Number(answer) - 1;
    if (!Number.isInteger(chosen) || !targets[chosen]) {
        alert('Клякса не отправлена: нужно выбрать корректный номер игрока.');
        return false;
    }

    const target = targets[chosen];
    const boardSnap = await db.ref('board').once('value');
    const board = boardSnap.val() || {};
    const free = [];
    for (let i = 0; i < 50; i++) if (!board[i]) free.push(i);
    if (!free.length) {
        alert('Нет свободных клеток, чтобы отправить кляксу.');
        return false;
    }

    const targetCellIdx = free[Math.floor(Math.random() * free.length)];
    const awarded = await claimSequentialTickets(1);
    const pendingTicket = awarded?.[0] || '';
    if (!pendingTicket) return alert(`Лимит билетиков (${MAX_TICKETS}) уже достигнут в этой игре.`);

    const challengeData = {
        type: 'inkSabotage',
        round: currentRoundNum,
        fromUserId: currentUserId,
        fromName: players[myIndex]?.n || 'Неизвестный',
        selectedOption: null,
        optionDeadline: null,
        pendingTicket,
        isResolved: false,
        cellIdx: targetCellIdx
    };

    await db.ref(`whitelist/${target.userId}/ink_challenge`).set(challengeData);
    await db.ref(`whitelist/${target.userId}/last_round`).set(currentRoundNum);
    await db.ref('board/' + targetCellIdx).set({
        owner: target.charIndex,
        userId: target.userId,
        taskIdx: -1,
        ticket: '',
        isGold: false,
        isTrap: false,
        isMagic: false,
        isMiniGame: false,
        isInkChallenge: true,
        miniGameTiles: createShuffledMiniGameTiles(5),
        miniGameWon: false,
        miniGameFailed: false,
        miniGameCodeWord: '',
        magicLinkId: null,
        trapText: '',
        round: currentRoundNum,
        excluded: false
    });

    await postNews(`🫧 ${players[myIndex].n} отправил(а) кляксу игроку ${players[target.charIndex].n}.`);

    if (Number.isInteger(sourceCellIdx)) {
        const srcRef = db.ref(`board/${sourceCellIdx}`);
        const srcSnap = await srcRef.once('value');
        const srcCell = srcSnap.val() || {};
        if (srcCell.userId === currentUserId) {
            await srcRef.update({
                ticket: srcCell.inkPendingTicket || '',
                inkPendingTicket: '',
                inkUsed: true,
                itemType: null
            });
        }
    }

    alert(`Клякса отправлена игроку ${players[target.charIndex].n}!`);
    alert('Сделал гадось - сердцу радость! Кодовое слово "Клякса", нарисовать можешь что хочешь, злючка!');
    return true;
}

async function sendWandBlessingImmediately() {
    alert('Кто-то обронил волшебную палочку ✨. Скорее, помоги же кому-нибудь упростить жизнь!');
    const whiteSnap = await db.ref('whitelist').once('value');
    const white = whiteSnap.val() || {};
    const targets = getEligibleSabotageTargets(white);
    if (!targets.length) {
        alert('Нет игроков, которым можно передать волшебство в этом раунде (все уже сходили).');
        return;
    }

    const menu = targets.map((t, idx) => `${idx + 1}) ${players[t.charIndex].n}`).join('\n');
    const answer = prompt(`Выбери игрока, которому упростишь задание (введи номер):\n${menu}`);
    const chosen = Number(answer) - 1;
    if (!Number.isInteger(chosen) || !targets[chosen]) {
        alert('Волшебная палочка не применена: нужно выбрать корректный номер игрока.');
        return;
    }

    const target = targets[chosen];
    const boardSnap = await db.ref('board').once('value');
    const board = boardSnap.val() || {};
    const free = [];
    for (let i = 0; i < 50; i++) if (!board[i]) free.push(i);
    if (!free.length) return alert('Нет свободных клеток, чтобы передать волшебство.');

    const targetCellIdx = free[Math.floor(Math.random() * free.length)];
    const awarded = await claimSequentialTickets(1);
    const pendingTicket = awarded?.[0] || '';
    if (!pendingTicket) return alert(`Лимит билетиков (${MAX_TICKETS}) уже достигнут в этой игре.`);

    const blessingData = {
        type: 'magicWand',
        round: currentRoundNum,
        fromUserId: currentUserId,
        fromName: players[myIndex]?.n || 'Неизвестный',
        selectedOption: null,
        pendingTicket,
        isResolved: false,
        cellIdx: targetCellIdx
    };

    await db.ref(`whitelist/${target.userId}/wand_blessing`).set(blessingData);
    await db.ref(`whitelist/${target.userId}/last_round`).set(currentRoundNum);
    await db.ref('board/' + targetCellIdx).set({
        owner: target.charIndex,
        userId: target.userId,
        taskIdx: -1,
        ticket: '',
        isGold: false,
        isTrap: false,
        isMagic: false,
        isMiniGame: false,
        isInkChallenge: false,
        isWandBlessing: true,
        wandOptionLabel: '',
        itemType: null,
        miniGameTiles: null,
        miniGameWon: false,
        miniGameFailed: false,
        miniGameCodeWord: '',
        magicLinkId: null,
        trapText: '',
        round: currentRoundNum,
        excluded: false
    });

    await postNews(`🎆 ${players[myIndex].n} передал(а) волшебную палочку игроку ${players[target.charIndex].n}.`);
    alert('Ты просто прелесть! Твоё кодовое слово "Фея", рисуй что дорого твоему добродушному сердцу!');
}

async function activateGoldenPollen(cellIdx) {
    if ((myInventory.goldenPollen || 0) <= 0) return alert('В рюкзаке нет Золотой пыльцы.');
    const cellSnap = await db.ref(`board/${cellIdx}`).once('value');
    const cell = cellSnap.val();
    if (!cell || cell.userId !== currentUserId) return alert('Можно менять только своё задание.');
    if (cell.isTrap || cell.isMagic || cell.isMiniGame || cell.isWordSketch || cell.isGold || cell.isInkChallenge) return alert('Для этой клетки переброс недоступен.');

    const userSnap = await db.ref(`whitelist/${currentUserId}/used_tasks`).once('value');
    const used = userSnap.val() || [];
    const avail = tasks.map((_, i) => i).filter(i => !used.includes(i) && i !== cell.taskIdx);
    if (!avail.length) return alert('Нет доступных новых заданий для переброса.');

    const nextTaskIdx = avail[Math.floor(Math.random() * avail.length)];
    used.push(nextTaskIdx);
    await db.ref(`board/${cellIdx}/taskIdx`).set(nextTaskIdx);
    await db.ref(`whitelist/${currentUserId}/used_tasks`).set(used);
    await consumeInventoryItem('goldenPollen', 1);
    await postNews(`🎇 ${players[myIndex].n} применил(а) Золотую пыльцу и перебросил(а) задание.`);
    alert('🎇 Золотая пыльца сработала! Получено новое случайное задание на той же клетке.');
}

async function activateInkSaboteur(cellIdx) {
    const cellSnap = await db.ref(`board/${cellIdx}`).once('value');
    const cell = cellSnap.val();
    if (!cell || cell.userId !== currentUserId) return alert('Можно использовать только свою кляксу.');
    if (cell.itemType !== 'inkSaboteur' || cell.inkUsed) return alert('Клякса уже использована.');

    const ok = await sendInkChallengeImmediately(cellIdx);
    if (ok) {
        const updated = await db.ref(`board/${cellIdx}`).once('value');
        showCell(cellIdx, updated.val());
    }
}

    window.itemTypes = itemTypes;
    window.inkChallengeOptions = inkChallengeOptions;
    window.renderInventory = renderInventory;
    window.addInventoryItem = addInventoryItem;
    window.consumeInventoryItem = consumeInventoryItem;
    window.isRegularCellForMagnifier = isRegularCellForMagnifier;
    window.showMagnifierChoiceDialog = showMagnifierChoiceDialog;
    window.activateMagnifier = activateMagnifier;
    window.getEligibleSabotageTargets = getEligibleSabotageTargets;
    window.sendInkChallengeImmediately = sendInkChallengeImmediately;
    window.sendWandBlessingImmediately = sendWandBlessingImmediately;
    window.activateGoldenPollen = activateGoldenPollen;
    window.activateInkSaboteur = activateInkSaboteur;
})();

