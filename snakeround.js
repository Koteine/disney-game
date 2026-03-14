(function () {
  const MODE_SNAKE = 'snake';
  const MODE_CLASSIC = 'cells';
  const TOTAL_CELLS = 100;
  const SAFETY_WINDOW_MS = 60 * 60 * 1000;

  const FIXED_SNAKES = [
    { from: 98, to: 79 },
    { from: 92, to: 71 },
    { from: 73, to: 52 },
    { from: 61, to: 39 },
    { from: 44, to: 23 }
  ];

  const FIXED_VINES = [
    { from: 3, to: 19 },
    { from: 11, to: 33 },
    { from: 27, to: 48 },
    { from: 42, to: 66 },
    { from: 58, to: 84 }
  ];


  const SPECIAL_MARKERS = {
    snakes: '🐍',
    vines: '🌿',
    maelstrom: '🌀',
    treasury: '💎',
    sphinx: '🗿',
    kaa: '👁️',
    forbiddenFruit: '🍎',
    shedding: '🧬'
  };

  const DANGEROUS_CELL_TYPES = ['snakes', 'maelstrom', 'sphinx', 'kaa', 'shedding'];

  function pickUniqueCells(count, blocked = new Set()) {
    const picked = [];
    while (picked.length < count) {
      const value = 2 + Math.floor(Math.random() * (TOTAL_CELLS - 2));
      if (blocked.has(value)) continue;
      blocked.add(value);
      picked.push(value);
    }
    return picked;
  }

  function buildSnakeConfig() {
    const blocked = new Set([1, TOTAL_CELLS]);
    FIXED_SNAKES.forEach((r) => { blocked.add(r.from); blocked.add(r.to); });
    FIXED_VINES.forEach((r) => { blocked.add(r.from); blocked.add(r.to); });

    return {
      snakes: FIXED_SNAKES,
      vines: FIXED_VINES,
      maelstrom: pickUniqueCells(3, blocked),
      treasury: pickUniqueCells(3, blocked),
      sphinx: pickUniqueCells(2, blocked),
      kaa: pickUniqueCells(2, blocked),
      forbiddenFruit: pickUniqueCells(2, blocked),
      shedding: pickUniqueCells(2, blocked)
    };
  }

  function buildPairKey(userA, userB) {
    return [String(userA || '').trim(), String(userB || '').trim()]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'ru'))
      .join('__');
  }

  function isSafetyWindowExpired(enteredAt, nowTs = Date.now()) {
    const ts = Number(enteredAt || 0);
    if (!Number.isFinite(ts) || ts <= 0) return false;
    return (nowTs - ts) > SAFETY_WINDOW_MS;
  }

  function parseCellPresence(rawPresence) {
    const map = rawPresence && typeof rawPresence === 'object' ? rawPresence : {};
    return Object.entries(map)
      .map(([userId, row]) => ({
        userId: String(userId || '').trim(),
        enteredAt: Number(row?.enteredAt || 0),
        lastSeenAt: Number(row?.lastSeenAt || 0),
        owner: Number(row?.owner)
      }))
      .filter((row) => !!row.userId);
  }

  function evaluateEncounterRights({
    currentUserId,
    currentEnteredAt,
    otherUserId,
    otherEnteredAt,
    duelHistoryRow,
    nowTs = Date.now()
  }) {
    const currentImmune = isSafetyWindowExpired(currentEnteredAt, nowTs);
    const otherImmune = isSafetyWindowExpired(otherEnteredAt, nowTs);
    const completedOnCell = String(duelHistoryRow?.status || '') === 'completed';
    const blockedReason = completedOnCell
      ? 'already_completed_on_this_cell'
      : (otherImmune ? 'other_player_safety_immunity' : '');

    return {
      pairKey: buildPairKey(currentUserId, otherUserId),
      currentImmune,
      otherImmune,
      completedOnCell,
      canStartClash: !blockedReason,
      blockedReason,
      safetyWindowMs: SAFETY_WINDOW_MS
    };
  }

  function isSnakeRound(roundData) {
    return String(roundData?.fieldMode || MODE_CLASSIC) === MODE_SNAKE;
  }

  async function getUserSnakeState(db, userId) {
    const snap = await db.ref(`whitelist/${userId}/snakeState`).once('value');
    return snap.val() || {};
  }

  function evaluateMove(position, rollValue, invertNextRoll) {
    const direction = invertNextRoll ? -1 : 1;
    let next = position + (rollValue * direction);
    if (next < 1) next = 1;
    if (next > TOTAL_CELLS) next = TOTAL_CELLS;
    return next;
  }

  function resolveCellEffect(position, config) {
    const snake = (config?.snakes || []).find((x) => Number(x.from) === Number(position));
    if (snake) return { type: 'snake', to: Number(snake.to), text: '🐍 Змейка отбросила назад.' };
    const vine = (config?.vines || []).find((x) => Number(x.from) === Number(position));
    if (vine) return { type: 'vine', to: Number(vine.to), text: '🌿 Лиана ускорила путь.' };
    if ((config?.maelstrom || []).includes(position)) return { type: 'maelstrom', to: Math.max(1, position - (2 + Math.floor(Math.random() * 4))), text: '🌀 Вихрь Малефисенты отбросил тебя.' };
    if ((config?.treasury || []).includes(position)) return { type: 'treasury', to: position, karmaDelta: 5, text: '💎 Сокровищница: +5 кармы.' };
    if ((config?.sphinx || []).includes(position)) return { type: 'sphinx', to: position, lockSphinx: true, text: '🗿 Испытание Сфинкса блокирует бросок.' };
    if ((config?.kaa || []).includes(position)) return { type: 'kaa', to: position, invertNextRoll: true, text: '👁️ Гипноз Каа: следующий бросок инвертирован.' };
    if ((config?.forbiddenFruit || []).includes(position)) return { type: 'forbiddenFruit', to: position, askFruit: true, text: '🍎 Запретный плод: выбери награду.' };
    if ((config?.shedding || []).includes(position)) return { type: 'shedding', to: position, lockUntil: Date.now() + 3600000, text: '🧬 Сброс кожи: заплати 5 кармы или жди 1 час.' };
    return { type: 'normal', to: position, text: '' };
  }


  function getSpecialMarks(config) {
    const marks = {};
    Object.keys(SPECIAL_MARKERS).forEach((type) => {
      const marker = SPECIAL_MARKERS[type];
      const rows = config?.[type] || [];
      rows.forEach((row) => {
        const pos = type === 'snakes' || type === 'vines' ? Number(row?.from) : Number(row);
        if (!Number.isFinite(pos) || pos < 1 || pos > TOTAL_CELLS) return;
        marks[pos] = marker;
      });
    });
    return marks;
  }

  function getDangerPositions(config, dangerousTypes = DANGEROUS_CELL_TYPES) {
    const set = new Set();
    (dangerousTypes || []).forEach((type) => {
      const rows = config?.[type] || [];
      rows.forEach((row) => {
        const pos = type === 'snakes' ? Number(row?.from) : Number(row);
        if (!Number.isFinite(pos) || pos < 1 || pos > TOTAL_CELLS) return;
        set.add(pos);
      });
    });
    return Array.from(set);
  }

  function buildSnakeBoardHtml(boardData, currentRound, charColors, players, options = {}) {
    const occupantsByCell = {};
    Object.values(boardData || {}).forEach((cell) => {
      if (!cell || String(cell.mode || '') !== MODE_SNAKE) return;
      const idx = Number(cell.pathPos || 0);
      if (!idx) return;
      if (!occupantsByCell[idx]) occupantsByCell[idx] = [];
      occupantsByCell[idx].push(cell);
    });

    const config = currentRound?.snakeConfig || {};
    const specialMarks = getSpecialMarks(config);
    const visionDangerPositions = Array.isArray(options?.dangerPositions)
      ? options.dangerPositions
      : getDangerPositions(config);
    const highlightedDangerSet = options?.masterTrapVisionEnabled ? new Set(visionDangerPositions.map((x) => Number(x))) : null;

    const rows = 10;
    const cols = 10;
    const cells = [];
    for (let row = rows - 1; row >= 0; row -= 1) {
      const leftToRight = ((rows - 1 - row) % 2) === 0;
      for (let col = 0; col < cols; col += 1) {
        const realCol = leftToRight ? col : (cols - 1 - col);
        const value = (row * cols) + realCol + 1;
        cells.push(value);
      }
    }

    return cells.map((value) => {
      const occupants = occupantsByCell[value] || [];
      const occ = occupants[0];
      const color = (typeof occ?.owner === 'number' && charColors[occ.owner]) ? charColors[occ.owner] : '#ddd';
      const ownerName = (typeof occ?.owner === 'number' && players[occ.owner]?.n) ? players[occ.owner].n : '';
      const marker = specialMarks[value] || '•';
      const dangerClass = highlightedDangerSet?.has(Number(value)) ? ' snake-cell-danger' : '';
      return `<button class="snake-cell${dangerClass}" data-snake-pos="${value}" style="border-color:${color};"><b>${value}</b><span>${marker}</span>${ownerName ? `<small>${ownerName}</small>` : '<small>→</small>'}</button>`;
    }).join('');
  }

  window.snakeRound = {
    MODE_SNAKE,
    MODE_CLASSIC,
    TOTAL_CELLS,
    SAFETY_WINDOW_MS,
    buildSnakeConfig,
    buildPairKey,
    isSafetyWindowExpired,
    parseCellPresence,
    evaluateEncounterRights,
    isSnakeRound,
    getUserSnakeState,
    evaluateMove,
    resolveCellEffect,
    getSpecialMarks,
    getDangerPositions,
    DANGEROUS_CELL_TYPES,
    buildSnakeBoardHtml
  };
})();
