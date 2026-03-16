(function () {
  function create(deps) {
    const { db, tasks, players, updateKarma, postNews, getCurrentUserId } = deps || {};
    if (!db) throw new Error('snakeClash.create requires db');

function getSnakeClashNotificationSeenKey(clashId) {
    return `snake_clash_seen_${String(clashId || '').trim()}`;
}

function getSnakeClashNotificationOnceKey(notification) {
    if (!notification || typeof notification !== 'object') return '';
    const direct = String(notification.onceKey || '').trim();
    if (direct) return direct;
    const type = String(notification.type || '').trim();
    const clashId = String(notification.clashId || '').trim();
    if (!type || !clashId) return '';
    return `${type}_${clashId}`;
}

function wasSnakeClashNotificationSeen(clashIdOrOnceKey) {
    const normalized = String(clashIdOrOnceKey || '').trim();
    if (!normalized) return false;
    const key = getSnakeClashNotificationSeenKey(normalized);
    if (!key || key === 'snake_clash_seen_') return false;
    try {
        return localStorage.getItem(key) === '1';
    } catch (e) {
        return false;
    }
}

function markSnakeClashNotificationSeen(clashIdOrOnceKey) {
    const normalized = String(clashIdOrOnceKey || '').trim();
    if (!normalized) return;
    const key = getSnakeClashNotificationSeenKey(normalized);
    if (!key || key === 'snake_clash_seen_') return;
    try {
        localStorage.setItem(key, '1');
    } catch (e) {
        // ignore localStorage errors
    }
}

async function settleSnakeClashMvp(clashPath, clashData) {
    const applyTx = await db.ref(clashPath).transaction((row) => {
        if (!row || row.status !== 'resolved') return row;
        if (row.effectsAppliedAt) return row;
        return { ...row, effectsAppliedAt: Date.now() };
    });
    if (!applyTx.committed) return false;

    const roundId = Number(clashData?.round || 0);
    const cell = Number(clashData?.cell || 0);
    const playersPair = Array.isArray(clashData?.players) ? clashData.players.map((v) => String(v || '').trim()).filter(Boolean) : [];
    if (playersPair.length < 2 || !roundId || !cell) return false;

    const winner = String(clashData?.winner || playersPair[0] || '');
    const loser = String(clashData?.loser || playersPair.find((id) => id !== winner) || playersPair[0] || '');
    if (!winner || !loser || winner === loser) return false;

    const [loserUserSnap, loserStateSnap, loserUsedTasksSnap, boardSnap, presenceRoundSnap, winnerCharSnap] = await Promise.all([
        db.ref(`whitelist/${loser}`).once('value'),
        db.ref(`whitelist/${loser}/snakeState`).once('value'),
        db.ref(`whitelist/${loser}/used_tasks`).once('value'),
        db.ref('board').once('value'),
        db.ref(`snake_presence/${roundId}`).once('value'),
        db.ref(`whitelist/${winner}/charIndex`).once('value')
    ]);
    const loserState = loserStateSnap.val() || {};
    const fromPos = Number(loserState.position || cell);
    const toPos = Math.max(1, fromPos - 1);
    const usedTasks = Array.isArray(loserUsedTasksSnap.val()) ? loserUsedTasksSnap.val() : [];
    const avail = tasks.map((_, i) => i).filter(i => !usedTasks.includes(i));
    const taskIdx = avail.length ? avail[Math.floor(Math.random() * avail.length)] : Math.floor(Math.random() * Math.max(1, tasks.length));
    const loserCharIndex = Number(loserUserSnap.val()?.charIndex);
    const board = boardSnap.val() || {};
    const roundPresence = presenceRoundSnap.val() || {};

    const updates = {};
    Object.entries(board).forEach(([idx, c]) => {
        if (!c) return;
        if (Number(c.round) !== roundId) return;
        if (String(c.mode || '') !== 'snake') return;
        if (String(c.userId || '') !== String(loser)) return;
        updates[`board/${idx}`] = null;
    });

    updates[`board/${toPos - 1}`] = {
        owner: Number.isInteger(loserCharIndex) ? loserCharIndex : -1,
        userId: loser,
        taskIdx,
        ticket: '',
        round: roundId,
        mode: 'snake',
        pathPos: toPos,
        effect: 'snakeClashRollback',
        effectText: 'Проигрыш в стычке: откат на 1 клетку назад.',
        createdAt: Date.now(),
        excluded: false
    };

    updates[`whitelist/${loser}/snakeState`] = {
        ...loserState,
        position: toPos,
        activeCell: toPos,
        activeTask: { cell: toPos, taskIdx, round: roundId },
        awaitingApproval: true,
        movedAt: Date.now(),
        lastCellEnteredAt: Date.now()
    };
    updates[`whitelist/${loser}/used_tasks`] = [...usedTasks.filter((n) => n !== taskIdx), taskIdx];

    Object.entries(roundPresence).forEach(([cellIdx, row]) => {
        if (!row || typeof row !== 'object') return;
        if (row[String(loser)] || row[loser]) {
            updates[`snake_presence/${roundId}/${cellIdx}/${loser}`] = null;
        }
    });
    updates[`snake_presence/${roundId}/${toPos}/${loser}`] = {
        userId: loser,
        owner: Number.isInteger(loserCharIndex) ? loserCharIndex : -1,
        enteredAt: Date.now(),
        lastSeenAt: Date.now()
    };

    const pairKey = String(clashData.pairKey || '');
    const historyPath = `snake_duel_history/${roundId}/${cell}/${pairKey}`;
    updates[`${historyPath}/status`] = 'completed';
    updates[`${historyPath}/winner`] = winner;
    updates[`${historyPath}/loser`] = loser;
    updates[`${historyPath}/completedAt`] = Date.now();
    updates[`${historyPath}/updatedAt`] = Date.now();

    updates[`snake_encounters/${roundId}/${cell}/${pairKey}/canStartClash`] = false;
    updates[`snake_encounters/${roundId}/${cell}/${pairKey}/blockedReason`] = 'already_completed_on_this_cell';
    updates[`snake_encounters/${roundId}/${cell}/${pairKey}/completedOnCell`] = true;
    updates[`snake_encounters/${roundId}/${cell}/${pairKey}/resolvedAt`] = Date.now();

    const clashId = `${roundId}_${cell}_${pairKey}`;
    const winnerNotifyKey = `snake_clash_result_win_${clashId}`;
    const loserNotifyKey = `snake_clash_result_loss_${clashId}`;
    updates[`system_notifications/${winner}/${winnerNotifyKey}`] = {
        text: 'Ты выиграл(а) стычку на клетке!',
        type: 'snake_clash_result_win',
        clashId,
        onceKey: `result_win_${clashId}`,
        createdAt: Date.now(),
        expiresAt: Date.now() + (2 * 60 * 60 * 1000)
    };
    updates[`system_notifications/${loser}/${loserNotifyKey}`] = {
        text: 'Ты проиграл(а) стычку и отступил(а) на 1 клетку назад.',
        type: 'snake_clash_result_loss',
        clashId,
        onceKey: `result_loss_${clashId}`,
        createdAt: Date.now(),
        expiresAt: Date.now() + (2 * 60 * 60 * 1000)
    };

    await db.ref().update(updates);
    if (String(clashData?.resultType || '') === 'snake_poison_dice') {
        await updateKarma(winner, 5);
        await updateKarma(loser, 1);
    }

    const winnerName = players[Number(winnerCharSnap.val())]?.n || `ID ${winner}`;
    const loserName = players[Number(loserCharIndex)]?.n || `ID ${loser}`;
    await postNews(`🐍 Стычка на клетке №${cell}: ${winnerName} победил(а), ${loserName} откатился(ась) на 1 клетку.`);
    return true;
}

async function maybeStartSnakeClashFromEncounter(encounterState) {
    if (!encounterState?.canStartClash) return false;
    const roundId = Number(encounterState.round || 0);
    const cell = Number(encounterState.cell || 0);
    const pairKey = String(encounterState.pairKey || '').trim();
    if (!roundId || !cell || !pairKey) return false;

    const clashPath = `snake_clashes/${roundId}/${cell}/${pairKey}`;
    const nowTs = Date.now();
    const playersPair = Array.isArray(encounterState.players) ? encounterState.players.map((v) => String(v || '').trim()).filter(Boolean) : [];
    const gameType = chooseSnakeClashGameType(roundId, cell, pairKey);
    const karmaSnaps = await Promise.all(playersPair.map((uid) => db.ref(`player_season_status/${uid}/karma_points`).once('value')));
    const karmaByUid = {};
    playersPair.forEach((uid, idx) => { karmaByUid[uid] = Number(karmaSnaps[idx]?.val() || 0); });
    const poisonInit = buildSnakePoisonInit(playersPair, karmaByUid);
    const tx = await db.ref(clashPath).transaction((row) => {
        if (row && (row.status === 'active' || row.status === 'resolved')) return row;
        return {
            round: roundId,
            cell,
            pairKey,
            players: playersPair,
            status: 'active',
            gameType,
            gameState: gameType === 'snake_poison_dice' ? 'waiting_for_turn' : (gameType === 'snake_puzzle_5x5' ? 'puzzle_in_progress' : 'waiting_for_choices'),
            choices: {},
            replayCount: 0,
            poison: gameType === 'snake_poison_dice' ? poisonInit : null,
            puzzle: gameType === 'snake_puzzle_5x5' ? buildSnakePuzzleInit(playersPair, 5) : null,
            createdAt: nowTs,
            startedAt: nowTs,
            resolvedAt: 0,
            winner: '',
            loser: '',
            sourceEncounter: `snake_encounters/${roundId}/${cell}/${pairKey}`,
            historyKey: `snake_duel_history/${roundId}/${cell}/${pairKey}`,
            createdBy: String(getCurrentUserId() || ''),
            notifiedAt: 0
        };
    });
    let clash = tx.snapshot.val() || {};
    if (!tx.committed) {
        const existingSnap = await db.ref(clashPath).once('value');
        clash = existingSnap.val() || {};
        if (String(clash.status || '') !== 'active') return false;
    }

    if (String(clash.status || '') === 'active' && !Number(clash.notifiedAt || 0)) {
        const updates = {};
        const playersPair = Array.isArray(clash.players) ? clash.players : [];
        playersPair.forEach((uid) => {
            const userId = String(uid || '').trim();
            if (!userId) return;
            const opponentId = playersPair.find((x) => String(x) !== userId) || '';
            const clashId = `${roundId}_${cell}_${pairKey}`;
            const gt = String(clash.gameType || '');
            const gameLabel = gt === 'snake_poison_dice'
                ? '«Змеиные кости: Ядовитый бросок»'
                : (gt === 'snake_puzzle_5x5'
                    ? '«Дуэль умов: Пятнашки 5×5»'
                    : '«Камень-Ножницы-Змея»');
            updates[`system_notifications/${userId}/snake_clash_start_${clashId}`] = {
                text: `На этой клетке началась стычка с игроком ${opponentId || 'соперник'}. Игра: ${gameLabel}.`,
                type: 'snake_clash_start',
                clashId,
                onceKey: `start_${clashId}`,
                createdAt: Date.now(),
                expiresAt: Date.now() + (2 * 60 * 60 * 1000)
            };
        });
        updates[`${clashPath}/notifiedAt`] = Date.now();
        await db.ref().update(updates);
    }
    return true;
}

function getSnakeRpsChoiceLabel(choice) {
    if (choice === 'mongoose') return 'Мангуст';
    if (choice === 'snake') return 'Змея';
    if (choice === 'egg') return 'Яйцо';
    return '—';
}

function getSnakeRpsRoundResult(choiceA, choiceB) {
    const beats = {
        mongoose: 'snake',
        snake: 'egg',
        egg: 'mongoose'
    };
    if (!choiceA || !choiceB) return { status: 'pending' };
    if (choiceA === choiceB) return { status: 'draw' };
    if (beats[choiceA] === choiceB) return { status: 'win_a' };
    if (beats[choiceB] === choiceA) return { status: 'win_b' };
    return { status: 'draw' };
}

function chooseSnakeClashGameType(roundId, cell, pairKey) {
    const seed = `${Number(roundId || 0)}_${Number(cell || 0)}_${String(pairKey || '')}`;
    const hash = seed.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const gameTypes = ['snake_rps', 'snake_poison_dice', 'snake_puzzle_5x5'];
    return gameTypes[Math.abs(hash) % gameTypes.length] || 'snake_rps';
}

function buildSnakePoisonInit(playersPair, karmaByUid = {}) {
    const safePlayers = Array.isArray(playersPair) ? playersPair.map((v) => String(v || '').trim()).filter(Boolean) : [];
    const health = {};
    const karmaBonus = {};
    safePlayers.forEach((uid) => {
        health[uid] = 100;
        karmaBonus[uid] = 0;
    });
    if (safePlayers.length >= 2) {
        const a = safePlayers[0];
        const b = safePlayers[1];
        const karmaA = Number(karmaByUid[a] || 0);
        const karmaB = Number(karmaByUid[b] || 0);
        if (karmaA > karmaB) karmaBonus[a] = 2;
        if (karmaB > karmaA) karmaBonus[b] = 2;
    }
    return {
        health,
        karmaBonus,
        turnIndex: 0,
        turnNo: 1,
        lastRolls: {},
        log: []
    };
}


function buildSnakePuzzleSolvedBoard(size = 5) {
    const total = Math.max(4, Number(size || 5) * Number(size || 5));
    const board = [];
    for (let i = 1; i < total; i += 1) board.push(i);
    board.push(0);
    return board;
}

function isSnakePuzzleSolved(board, size = 5) {
    const target = buildSnakePuzzleSolvedBoard(size);
    if (!Array.isArray(board) || board.length !== target.length) return false;
    for (let i = 0; i < target.length; i += 1) {
        if (Number(board[i]) !== Number(target[i])) return false;
    }
    return true;
}

function canSnakePuzzleMove(board, tileValue, size = 5) {
    const safe = Array.isArray(board) ? board.slice() : [];
    const tile = Number(tileValue || 0);
    if (!tile || !safe.includes(0)) return false;
    const tileIdx = safe.indexOf(tile);
    const blankIdx = safe.indexOf(0);
    if (tileIdx < 0 || blankIdx < 0) return false;
    const rowA = Math.floor(tileIdx / size);
    const colA = tileIdx % size;
    const rowB = Math.floor(blankIdx / size);
    const colB = blankIdx % size;
    const manhattan = Math.abs(rowA - rowB) + Math.abs(colA - colB);
    return manhattan === 1;
}

function applySnakePuzzleMove(board, tileValue) {
    const safe = Array.isArray(board) ? board.slice() : [];
    const tile = Number(tileValue || 0);
    const tileIdx = safe.indexOf(tile);
    const blankIdx = safe.indexOf(0);
    if (tileIdx < 0 || blankIdx < 0) return safe;
    [safe[tileIdx], safe[blankIdx]] = [safe[blankIdx], safe[tileIdx]];
    return safe;
}

function buildSnakePuzzleInit(playersPair, size = 5) {
    const safePlayers = Array.isArray(playersPair) ? playersPair.map((v) => String(v || '').trim()).filter(Boolean) : [];
    const total = size * size;
    let board = buildSnakePuzzleSolvedBoard(size);
    let blankIdx = board.indexOf(0);
    let prevBlank = -1;
    const shuffleSteps = 180;
    for (let step = 0; step < shuffleSteps; step += 1) {
        const row = Math.floor(blankIdx / size);
        const col = blankIdx % size;
        const candidates = [];
        if (row > 0) candidates.push(blankIdx - size);
        if (row < size - 1) candidates.push(blankIdx + size);
        if (col > 0) candidates.push(blankIdx - 1);
        if (col < size - 1) candidates.push(blankIdx + 1);
        const usable = candidates.filter((idx) => idx !== prevBlank);
        const nextBlank = (usable.length ? usable : candidates)[Math.floor(Math.random() * Math.max(1, (usable.length ? usable : candidates).length))];
        [board[blankIdx], board[nextBlank]] = [board[nextBlank], board[blankIdx]];
        prevBlank = blankIdx;
        blankIdx = nextBlank;
    }
    if (isSnakePuzzleSolved(board, size)) {
        [board[total - 2], board[total - 1]] = [board[total - 1], board[total - 2]];
        [board[total - 3], board[total - 2]] = [board[total - 2], board[total - 3]];
    }

    const boards = {};
    const moves = {};
    const finishedAt = {};
    safePlayers.forEach((uid) => {
        boards[uid] = board.slice();
        moves[uid] = 0;
        finishedAt[uid] = 0;
    });

    return {
        size,
        initialBoard: board,
        boards,
        moves,
        finishedAt,
        startedAt: Date.now(),
        solvedBoard: buildSnakePuzzleSolvedBoard(size)
    };
}

function renderSnakePuzzleBoardHtml(board, size = 5, clashPath = '') {
    const safe = Array.isArray(board) ? board : [];
    return safe.map((value, idx) => {
        const tile = Number(value || 0);
        const blank = tile === 0;
        if (blank) {
            return `<button class="snake-puzzle-tile snake-puzzle-blank" disabled aria-label="blank"></button>`;
        }
        const movable = canSnakePuzzleMove(safe, tile, size);
        return `<button class="snake-puzzle-tile${movable ? ' snake-puzzle-movable' : ''}" ${movable ? `onclick="submitSnakePuzzleMove('${clashPath}',${tile})"` : 'disabled'}>${tile}</button>`;
    }).join('');
}


function openSnakeRpsModal(clashPath, clash) {
    const me = String(getCurrentUserId() || '');
    const playersPair = Array.isArray(clash?.players) ? clash.players.map((v) => String(v || '').trim()) : [];
    if (!playersPair.includes(me)) return;
    if (String(clash?.status || '') !== 'active') return;
    if (String(clash?.gameType || '') !== 'snake_rps') return;

    const opponent = playersPair.find((v) => v !== me) || '';
    const myChoice = String((clash?.choices || {})[me] || '');
    const opponentChoiceExists = !!String((clash?.choices || {})[opponent] || '');
    const titleEl = document.getElementById('mTitle');
    const textEl = document.getElementById('mText');
    const modalEl = document.getElementById('modal');
    const overlayEl = document.getElementById('overlay');
    if (!titleEl || !textEl || !modalEl || !overlayEl) return;

    titleEl.innerText = '🐍 Камень-Ножницы-Змея';
    if (myChoice) {
        textEl.innerHTML = `
            <div style="font-size:13px; color:#5e35b1; text-align:left;">Твой выбор: <b>${getSnakeRpsChoiceLabel(myChoice)}</b>.</div>
            <div style="font-size:13px; margin-top:8px; color:#666;">${opponentChoiceExists ? 'Соперник выбрал. Подводим итог...' : 'Ожидаем выбор соперника...'}</div>
        `;
    } else {
        textEl.innerHTML = `
            <div style="font-size:13px; margin-bottom:8px; text-align:left; color:#5e35b1;">Выберите символ:</div>
            <div style="display:grid; grid-template-columns:1fr; gap:8px;">
                <button class="admin-btn" style="margin:0; background:#6a1b9a;" onclick="submitSnakeRpsChoice('${clashPath}','mongoose')">🦦 Мангуст</button>
                <button class="admin-btn" style="margin:0; background:#8e24aa;" onclick="submitSnakeRpsChoice('${clashPath}','snake')">🐍 Змея</button>
                <button class="admin-btn" style="margin:0; background:#ab47bc;" onclick="submitSnakeRpsChoice('${clashPath}','egg')">🥚 Яйцо</button>
            </div>
        `;
    }

    modalEl.style.display = 'block';
    overlayEl.style.display = 'block';
}

async function maybeResolveSnakeRpsClash(clashPath) {
    const tx = await db.ref(clashPath).transaction((row) => {
        if (!row || row.status !== 'active') return row;
        if (String(row.gameType || '') !== 'snake_rps') return row;
        const playersPair = Array.isArray(row.players) ? row.players.map((v) => String(v || '').trim()).filter(Boolean) : [];
        if (playersPair.length < 2) return row;
        const a = playersPair[0];
        const b = playersPair[1];
        const choices = row.choices || {};
        const choiceA = String(choices[a] || '');
        const choiceB = String(choices[b] || '');
        if (!choiceA || !choiceB) return row;

        const result = getSnakeRpsRoundResult(choiceA, choiceB);
        if (result.status === 'draw') {
            return {
                ...row,
                replayCount: Number(row.replayCount || 0) + 1,
                choices: {},
                gameState: 'waiting_for_choices',
                lastDrawAt: Date.now(),
                updatedAt: Date.now()
            };
        }
        const winner = result.status === 'win_a' ? a : b;
        const loser = winner === a ? b : a;
        return {
            ...row,
            status: 'resolved',
            gameState: 'resolved',
            winner,
            loser,
            resolvedAt: Date.now(),
            resultType: 'snake_rps'
        };
    });

    if (!tx.committed) return false;
    const row = tx.snapshot.val() || {};
    if (String(row.status || '') === 'resolved') {
        return settleSnakeClashMvp(clashPath, row);
    }
    if (String(row.status || '') === 'active' && String(row.gameType || '') === 'snake_rps' && Number(row.lastDrawAt || 0)) {
        const playersPair = Array.isArray(row.players) ? row.players.map((v) => String(v || '').trim()) : [];
        const clashPathParts = clashPath.split('/');
        const roundId = clashPathParts[1] || '';
        const cell = clashPathParts[2] || '';
        const pairKey = clashPathParts[3] || '';
        const clashId = `${roundId}_${cell}_${pairKey}`;
        const updates = {};
        playersPair.forEach((uid) => {
            if (!uid) return;
            updates[`system_notifications/${uid}/snake_clash_draw_${clashId}_${Date.now()}`] = {
                text: 'Ничья в «Камень-Ножницы-Змея»! Выберите символ ещё раз.',
                type: 'snake_clash_draw',
                clashId,
                onceKey: '',
                createdAt: Date.now(),
                expiresAt: Date.now() + (30 * 60 * 1000)
            };
        });
        await db.ref().update(updates);
    }
    return true;
}

async function submitSnakeRpsChoice(clashPath, choice) {
    const normalized = String(choice || '').trim();
    if (!['mongoose', 'snake', 'egg'].includes(normalized)) return;
    const uid = String(getCurrentUserId() || '').trim();
    if (!uid || !clashPath) return;
    const choicePath = `${clashPath}/choices/${uid}`;
    const tx = await db.ref(choicePath).transaction((row) => {
        if (row) return row;
        return normalized;
    });
    if (!tx.committed) return;
    await maybeResolveSnakeRpsClash(clashPath);
}

function openSnakePoisonDiceModal(clashPath, clash) {
    const me = String(getCurrentUserId() || '').trim();
    const playersPair = Array.isArray(clash?.players) ? clash.players.map((v) => String(v || '').trim()) : [];
    if (!playersPair.includes(me)) return;
    if (String(clash?.status || '') !== 'active') return;
    if (String(clash?.gameType || '') !== 'snake_poison_dice') return;

    const poison = clash?.poison || {};
    const opponent = playersPair.find((v) => v !== me) || '';
    const myHp = Math.max(0, Number(poison?.health?.[me] || 100));
    const enemyHp = Math.max(0, Number(poison?.health?.[opponent] || 100));
    const turnIndex = Number(poison?.turnIndex || 0);
    const turnPlayer = playersPair[turnIndex] || playersPair[0] || '';
    const myTurn = String(turnPlayer) === me;
    const myRoll = poison?.lastRolls?.[me] || null;
    const logRows = Array.isArray(poison?.log) ? poison.log.slice(-4) : [];
    const logHtml = logRows.length
        ? `<div style="margin-top:8px; display:flex; flex-direction:column; gap:4px;">${logRows.map((row) => `<div style="font-size:12px; color:#5d4037;">• ${String(row?.text || '')}</div>`).join('')}</div>`
        : '<div style="margin-top:8px; font-size:12px; color:#8d6e63;">История бросков появится после первых ходов.</div>';

    const titleEl = document.getElementById('mTitle');
    const textEl = document.getElementById('mText');
    const modalEl = document.getElementById('modal');
    const overlayEl = document.getElementById('overlay');
    if (!titleEl || !textEl || !modalEl || !overlayEl) return;

    const actionHtml = myTurn && !myRoll
        ? `<button class="admin-btn" style="margin:8px 0 0; background:#8e24aa;" onclick="submitSnakePoisonDiceRoll('${clashPath}')">🎲 Бросить змеиные кости</button>`
        : `<div style="margin-top:8px; font-size:12px; color:#6d4c41;">${myTurn ? 'Ты уже бросил(а) в этом раунде. Ждём соперника.' : 'Сейчас ход соперника.'}</div>`;

    titleEl.innerText = '☠️ Змеиные кости: Ядовитый бросок';
    textEl.innerHTML = `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:6px;">
            <div style="padding:8px; border-radius:10px; background:#f3e5f5; font-size:13px;">Твоё здоровье: <b>${myHp}%</b></div>
            <div style="padding:8px; border-radius:10px; background:#fff3e0; font-size:13px;">Здоровье соперника: <b>${enemyHp}%</b></div>
        </div>
        <div style="margin-top:8px; font-size:12px; color:#4e342e;">Раунд бросков: <b>${Number(poison?.turnNo || 1)}</b></div>
        <div style="margin-top:4px; font-size:12px; color:#4e342e;">${myTurn ? 'Твой ход' : 'Ход соперника'}</div>
        ${actionHtml}
        ${logHtml}
    `;
    modalEl.style.display = 'block';
    overlayEl.style.display = 'block';
}

async function maybeResolveSnakePoisonDiceClash(clashPath) {
    const tx = await db.ref(clashPath).transaction((row) => {
        if (!row || row.status !== 'active') return row;
        if (String(row.gameType || '') !== 'snake_poison_dice') return row;
        const playersPair = Array.isArray(row.players) ? row.players.map((v) => String(v || '').trim()).filter(Boolean) : [];
        if (playersPair.length < 2) return row;
        const a = playersPair[0];
        const b = playersPair[1];
        const poison = row.poison || {};
        const lastRolls = poison.lastRolls || {};
        const rollA = lastRolls[a] || null;
        const rollB = lastRolls[b] || null;
        if (!rollA || !rollB) return row;

        const hp = {
            [a]: Math.max(0, Number(poison?.health?.[a] || 100)),
            [b]: Math.max(0, Number(poison?.health?.[b] || 100))
        };
        const logs = Array.isArray(poison.log) ? poison.log.slice(-6) : [];
        const bonusA = Number(poison?.karmaBonus?.[a] || 0);
        const bonusB = Number(poison?.karmaBonus?.[b] || 0);
        const rawA = Number(rollA.raw || 0);
        const rawB = Number(rollB.raw || 0);
        const effA = Number(rollA.effective || rawA);
        const effB = Number(rollB.effective || rawB);

        logs.push({
            at: Date.now(),
            text: `Раунд ${Number(poison.turnNo || 1)}: A=${rawA}${bonusA ? `(+${bonusA})` : ''}, B=${rawB}${bonusB ? `(+${bonusB})` : ''}`
        });

        if (rawA === rawB) {
            hp[a] = Math.max(0, hp[a] - 10);
            hp[b] = Math.max(0, hp[b] - 10);
            logs.push({ at: Date.now(), text: 'Сплетение: выпали одинаковые числа, оба получают -10%.' });
        } else {
            const dmgAtoB = rawA === 6 ? 25 : Math.max(1, effA);
            const dmgBtoA = rawB === 6 ? 25 : Math.max(1, effB);
            hp[b] = Math.max(0, hp[b] - dmgAtoB);
            hp[a] = Math.max(0, hp[a] - dmgBtoA);
            logs.push({ at: Date.now(), text: `Урон: ${a}→${b} -${dmgAtoB}%, ${b}→${a} -${dmgBtoA}%` });
        }

        const nextPoison = {
            ...poison,
            health: hp,
            lastRolls: {},
            turnNo: Number(poison.turnNo || 1) + 1,
            log: logs.slice(-8),
            turnIndex: Number(poison.turnIndex || 0)
        };

        const hpA = Number(hp[a] || 0);
        const hpB = Number(hp[b] || 0);
        if (hpA <= 0 || hpB <= 0) {
            let winner = '';
            let loser = '';
            if (hpA > hpB) { winner = a; loser = b; }
            else if (hpB > hpA) { winner = b; loser = a; }
            else {
                const ka = Number(poison?.karmaBonus?.[a] || 0);
                const kb = Number(poison?.karmaBonus?.[b] || 0);
                if (ka > kb) { winner = a; loser = b; }
                else if (kb > ka) { winner = b; loser = a; }
                else { winner = a; loser = b; }
            }
            return {
                ...row,
                status: 'resolved',
                gameState: 'resolved',
                poison: nextPoison,
                winner,
                loser,
                resolvedAt: Date.now(),
                resultType: 'snake_poison_dice'
            };
        }

        return {
            ...row,
            poison: {
                ...nextPoison,
                turnIndex: Number(poison.turnIndex || 0)
            },
            updatedAt: Date.now()
        };
    });
    if (!tx.committed) return false;
    const row = tx.snapshot.val() || {};
    if (String(row.status || '') === 'resolved') {
        return settleSnakeClashMvp(clashPath, row);
    }
    return true;
}

async function submitSnakePoisonDiceRoll(clashPath) {
    const uid = String(getCurrentUserId() || '').trim();
    if (!uid || !clashPath) return;
    const rawRoll = 1 + Math.floor(Math.random() * 10);
    const tx = await db.ref(clashPath).transaction((row) => {
        if (!row || row.status !== 'active') return row;
        if (String(row.gameType || '') !== 'snake_poison_dice') return row;
        const playersPair = Array.isArray(row.players) ? row.players.map((v) => String(v || '').trim()).filter(Boolean) : [];
        if (!playersPair.includes(uid)) return row;
        const poison = row.poison || {};
        const turnIndex = Number(poison.turnIndex || 0);
        const turnUid = playersPair[turnIndex] || playersPair[0] || '';
        if (String(turnUid) !== uid) return row;
        const lastRolls = poison.lastRolls && typeof poison.lastRolls === 'object' ? { ...poison.lastRolls } : {};
        if (lastRolls[uid]) return row;
        const bonus = Number(poison?.karmaBonus?.[uid] || 0);
        const effective = rawRoll === 6 ? 6 : Math.min(10, rawRoll + bonus);
        lastRolls[uid] = {
            raw: rawRoll,
            effective,
            bonusApplied: rawRoll === 6 ? 0 : bonus,
            at: Date.now()
        };
        return {
            ...row,
            poison: {
                ...poison,
                lastRolls,
                turnIndex: (turnIndex + 1) % Math.max(1, playersPair.length)
            },
            updatedAt: Date.now()
        };
    });
    if (!tx.committed) return;
    await maybeResolveSnakePoisonDiceClash(clashPath);
}


function openSnakePuzzleModal(clashPath, clash) {
    const me = String(getCurrentUserId() || '').trim();
    const playersPair = Array.isArray(clash?.players) ? clash.players.map((v) => String(v || '').trim()) : [];
    if (!playersPair.includes(me)) return;
    if (String(clash?.status || '') !== 'active') return;
    if (String(clash?.gameType || '') !== 'snake_puzzle_5x5') return;

    const puzzle = clash?.puzzle || {};
    const size = Number(puzzle.size || 5);
    const myBoard = Array.isArray(puzzle?.boards?.[me]) ? puzzle.boards[me] : (Array.isArray(puzzle.initialBoard) ? puzzle.initialBoard : buildSnakePuzzleSolvedBoard(size));
    const myFinishedAt = Number(puzzle?.finishedAt?.[me] || 0);
    const opponent = playersPair.find((v) => v !== me) || '';
    const enemyFinishedAt = Number(puzzle?.finishedAt?.[opponent] || 0);
    const moves = Number(puzzle?.moves?.[me] || 0);

    const titleEl = document.getElementById('mTitle');
    const textEl = document.getElementById('mText');
    const modalEl = document.getElementById('modal');
    const overlayEl = document.getElementById('overlay');
    if (!titleEl || !textEl || !modalEl || !overlayEl) return;

    const stateLine = myFinishedAt
        ? `✅ Ты уже собрал(а) пазл. ${enemyFinishedAt ? 'Сравниваем результат...' : 'Ожидаем фиксацию результата.'}`
        : '🧠 Собери пятнашки 5×5 быстрее соперника.';

    titleEl.innerText = '🧠 Дуэль умов: Пятнашки 5×5';
    textEl.innerHTML = `
        <div style="font-size:12px; color:#5e35b1; margin-bottom:8px;">${stateLine}</div>
        <div style="display:flex; justify-content:space-between; gap:8px; margin-bottom:8px; font-size:12px; color:#4a148c;">
            <span>Твои ходы: <b>${moves}</b></span>
            <span>${myFinishedAt ? 'Статус: <b>собрано</b>' : 'Статус: <b>игра идёт</b>'}</span>
        </div>
        <div class="snake-puzzle-grid" style="grid-template-columns:repeat(${size}, 1fr);">
            ${renderSnakePuzzleBoardHtml(myBoard, size, clashPath)}
        </div>
        <div style="font-size:11px; color:#6a1b9a; margin-top:8px;">Можно двигать только плитки рядом с пустой ячейкой.</div>
    `;

    modalEl.style.display = 'block';
    overlayEl.style.display = 'block';
}

async function maybeResolveSnakePuzzleClash(clashPath) {
    const tx = await db.ref(clashPath).transaction((row) => {
        if (!row || row.status !== 'active') return row;
        if (String(row.gameType || '') !== 'snake_puzzle_5x5') return row;
        const playersPair = Array.isArray(row.players) ? row.players.map((v) => String(v || '').trim()).filter(Boolean) : [];
        if (playersPair.length < 2) return row;
        const puzzle = row.puzzle || {};
        const finishedAt = puzzle.finishedAt || {};
        const donePlayers = playersPair.filter((uid) => Number(finishedAt[uid] || 0) > 0);
        if (!donePlayers.length) return row;

        let winner = donePlayers[0];
        let bestTs = Number(finishedAt[winner] || 0);
        donePlayers.forEach((uid) => {
            const ts = Number(finishedAt[uid] || 0);
            if (!bestTs || (ts && ts < bestTs)) {
                winner = uid;
                bestTs = ts;
            }
        });
        const loser = playersPair.find((uid) => uid !== winner) || playersPair[0] || '';
        if (!winner || !loser || winner === loser) return row;

        return {
            ...row,
            status: 'resolved',
            gameState: 'resolved',
            winner,
            loser,
            resolvedAt: Date.now(),
            resultType: 'snake_puzzle_5x5'
        };
    });

    if (!tx.committed) return false;
    const row = tx.snapshot.val() || {};
    if (String(row.status || '') === 'resolved') {
        return settleSnakeClashMvp(clashPath, row);
    }
    return true;
}

async function submitSnakePuzzleMove(clashPath, tileValue) {
    const uid = String(getCurrentUserId() || '').trim();
    if (!uid || !clashPath) return;
    const tile = Number(tileValue || 0);
    if (!tile) return;

    const tx = await db.ref(clashPath).transaction((row) => {
        if (!row || row.status !== 'active') return row;
        if (String(row.gameType || '') !== 'snake_puzzle_5x5') return row;
        const playersPair = Array.isArray(row.players) ? row.players.map((v) => String(v || '').trim()).filter(Boolean) : [];
        if (!playersPair.includes(uid)) return row;

        const puzzle = row.puzzle || {};
        const size = Number(puzzle.size || 5);
        const boards = puzzle.boards && typeof puzzle.boards === 'object' ? { ...puzzle.boards } : {};
        const moves = puzzle.moves && typeof puzzle.moves === 'object' ? { ...puzzle.moves } : {};
        const finishedAt = puzzle.finishedAt && typeof puzzle.finishedAt === 'object' ? { ...puzzle.finishedAt } : {};
        if (Number(finishedAt[uid] || 0) > 0) return row;

        const board = Array.isArray(boards[uid]) ? boards[uid].slice() : (Array.isArray(puzzle.initialBoard) ? puzzle.initialBoard.slice() : buildSnakePuzzleSolvedBoard(size));
        if (!canSnakePuzzleMove(board, tile, size)) return row;

        const nextBoard = applySnakePuzzleMove(board, tile);
        boards[uid] = nextBoard;
        moves[uid] = Number(moves[uid] || 0) + 1;
        const solved = isSnakePuzzleSolved(nextBoard, size);
        if (solved) finishedAt[uid] = Number(finishedAt[uid] || Date.now());

        return {
            ...row,
            puzzle: {
                ...puzzle,
                boards,
                moves,
                finishedAt,
                updatedAt: Date.now()
            },
            gameState: solved ? 'puzzle_completed_by_player' : 'puzzle_in_progress',
            updatedAt: Date.now()
        };
    });

    if (!tx.committed) return;
    await maybeResolveSnakePuzzleClash(clashPath);
}

async function tryResolveSheddingLockByTimer(userId, snakeState) {
    const uid = String(userId || '').trim();
    if (!uid) return false;
    const active = !!snakeState?.sheddingActive;
    const releasedAt = Number(snakeState?.sheddingReleasedAt || 0);
    const endsAt = Number(snakeState?.sheddingEndsAt || snakeState?.sheddingLockUntil || 0);
    if (!active || releasedAt || !endsAt || Date.now() < endsAt) return false;

    const tx = await db.ref(`whitelist/${uid}/snakeState`).transaction((row) => {
        if (!row || !row.sheddingActive) return row;
        if (row.sheddingReleasedAt) return row;
        const effectiveEnds = Number(row.sheddingEndsAt || row.sheddingLockUntil || 0);
        if (!effectiveEnds || Date.now() < effectiveEnds) return row;
        return {
            ...row,
            sheddingActive: false,
            sheddingReleasedAt: Date.now(),
            sheddingResolvedBy: row.sheddingResolvedBy || 'timer'
        };
    });
    return !!tx.committed;
}

async function tryResolveSheddingLockByKarma(userId) {
    const uid = String(userId || '').trim();
    if (!uid) return { released: false, reason: 'no_uid' };
    const karmaSnap = await db.ref(`player_season_status/${uid}/karma_points`).once('value');
    const karma = Number(karmaSnap.val()) || 0;
    if (karma < 5) return { released: false, reason: 'not_enough_karma' };

    const tx = await db.ref(`whitelist/${uid}/snakeState`).transaction((row) => {
        if (!row || !row.sheddingActive) return row;
        if (row.sheddingReleasedAt) return row;
        return {
            ...row,
            sheddingActive: false,
            sheddingReleasedAt: Date.now(),
            sheddingResolvedBy: 'karma',
            sheddingSpent: 5
        };
    });
    if (!tx.committed) return { released: false, reason: 'already_resolved' };

    await updateKarma(uid, -5);
    return { released: true, reason: 'karma' };
}

async function maybeCreateSnakeSynergyFromEncounter(encounterState) {
    if (!encounterState?.canStartClash) return { created: false, reason: 'clash_not_allowed' };
    const roundId = Number(encounterState.round || 0);
    const cell = Number(encounterState.cell || 0);
    const pairKey = String(encounterState.pairKey || '').trim();
    const playersPair = Array.isArray(encounterState.players) ? encounterState.players.map((v) => String(v || '').trim()).filter(Boolean) : [];
    if (!roundId || !cell || !pairKey || playersPair.length < 2) return { created: false, reason: 'invalid_payload' };

    const [karmaA, karmaB] = await Promise.all([
        db.ref(`player_season_status/${playersPair[0]}/karma_points`).once('value'),
        db.ref(`player_season_status/${playersPair[1]}/karma_points`).once('value')
    ]);
    const a = Number(karmaA.val()) || 0;
    const b = Number(karmaB.val()) || 0;
    const friendly = a >= 70 && a <= 100 && b >= 70 && b <= 100;
    if (!friendly) return { created: false, reason: 'karma_not_eligible' };

    const synergyPath = `snake_synergy/${roundId}/${cell}/${pairKey}`;
    const tx = await db.ref(synergyPath).transaction((row) => {
        if (row && String(row.status || '') === 'completed') return row;
        if (row && String(row.status || '') === 'active') return row;
        return {
            round: roundId,
            cell,
            pairKey,
            players: playersPair,
            createdAt: Date.now(),
            status: 'active',
            appliedTo: {},
            completedAt: 0,
            sourceEncounter: `snake_encounters/${roundId}/${cell}/${pairKey}`,
            historyKey: `snake_duel_history/${roundId}/${cell}/${pairKey}`,
            notifiedAt: 0
        };
    });

    const synergy = tx.snapshot.val() || {};
    const clashId = `${roundId}_${cell}_${pairKey}`;
    const updates = {};
    updates[`snake_encounters/${roundId}/${cell}/${pairKey}/isFriendlySynergy`] = true;
    updates[`snake_encounters/${roundId}/${cell}/${pairKey}/canStartClash`] = false;
    updates[`snake_encounters/${roundId}/${cell}/${pairKey}/blockedReason`] = 'friendly_synergy';
    updates[`snake_duel_history/${roundId}/${cell}/${pairKey}/status`] = 'friendly_synergy';
    updates[`snake_duel_history/${roundId}/${cell}/${pairKey}/updatedAt`] = Date.now();

    if (String(synergy.status || '') === 'active' && !Number(synergy.notifiedAt || 0)) {
        playersPair.forEach((uid) => {
            const userId = String(uid || '').trim();
            if (!userId) return;
            const opponentId = playersPair.find((x) => String(x) !== userId) || '';
            updates[`system_notifications/${userId}/snake_synergy_start_${clashId}`] = {
                text: `На этой чешуйке у вас с игроком ${opponentId || 'соперник'} возникла синергия! Следующая одобренная работа на этой клетке даст +5 кармы.`,
                type: 'snake_synergy_start',
                clashId,
                onceKey: `synergy_start_${clashId}`,
                createdAt: Date.now(),
                expiresAt: Date.now() + (2 * 60 * 60 * 1000)
            };
        });
        updates[`${synergyPath}/notifiedAt`] = Date.now();
    }

    await db.ref().update(updates);
    return { created: true, reason: 'friendly_synergy', players: playersPair };
}


    return {
      getSnakeClashNotificationSeenKey,
      getSnakeClashNotificationOnceKey,
      wasSnakeClashNotificationSeen,
      markSnakeClashNotificationSeen,
      settleSnakeClashMvp,
      maybeStartSnakeClashFromEncounter,
      getSnakeRpsChoiceLabel,
      getSnakeRpsRoundResult,
      chooseSnakeClashGameType,
      buildSnakePoisonInit,
      openSnakeRpsModal,
      maybeResolveSnakeRpsClash,
      submitSnakeRpsChoice,
      openSnakePoisonDiceModal,
      maybeResolveSnakePoisonDiceClash,
      submitSnakePoisonDiceRoll,
      openSnakePuzzleModal,
      maybeResolveSnakePuzzleClash,
      submitSnakePuzzleMove,
      tryResolveSheddingLockByTimer,
      tryResolveSheddingLockByKarma,
      maybeCreateSnakeSynergyFromEncounter
    };
  }

  window.snakeClash = { create };
})();
