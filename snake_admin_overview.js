(function () {
  function formatSnakeConfigLine(label, values, isPairs = false) {
    if (!Array.isArray(values) || !values.length) return `<div><b>${label}:</b> —</div>`;
    const text = isPairs
      ? values.map((row) => `${Number(row?.from || 0)}→${Number(row?.to || 0)}`).join(', ')
      : values.map((v) => Number(v || 0)).join(', ');
    return `<div><b>${label}:</b> ${text}</div>`;
  }

  function buildSnakePlayerAdminStatus(userRow, roundId, safetyWindowMs) {
    const snakeState = userRow?.snakeState || {};
    const statuses = [];
    if (snakeState.awaitingApproval) statuses.push('ждёт одобрения');
    if (snakeState.lockedBySphinx) statuses.push('Сфинкс-lock');
    if (snakeState.sheddingActive && !snakeState.sheddingReleasedAt) statuses.push('сброс кожи');
    if (snakeState.invertNextRoll) statuses.push('гипноз Каа');
    if (snakeState.forbiddenFruitSkipPending || snakeState.skipNextTurn) statuses.push('ожидается пропуск хода (плод)');

    const enteredAt = Number(snakeState.lastCellEnteredAt || snakeState.movedAt || 0);
    const leftMs = Number(safetyWindowMs || 3600000) - (Date.now() - enteredAt);
    if (enteredAt > 0 && leftMs > 0) statuses.push(`иммунитет ~${Math.ceil(leftMs / 60000)} мин`);
    if (!statuses.length) statuses.push('свободен');

    const task = snakeState.activeTask || {};
    const taskText = task?.taskLabel
      ? String(task.taskLabel)
      : (Number.isInteger(Number(task.taskIdx)) ? `taskIdx ${Number(task.taskIdx)}` : '—');

    return {
      statuses,
      taskText,
      cell: Number(snakeState.position || 1),
      roundOk: Number(task.round || roundId || 0) === Number(roundId || 0)
    };
  }

  async function render(opts = {}) {
    const {
      db,
      currentUserId,
      adminId,
      players = [],
      activeTabId = '',
      cacheState = { fetchedAt: 0, fetching: false, round: 0, mode: '' },
      force = false
    } = opts;

    const wrap = document.getElementById('admin-snake-overview');
    const body = document.getElementById('admin-snake-overview-body');
    if (!wrap || !body || !db) return cacheState;

    const nextState = { ...(cacheState || {}) };

    if (Number(currentUserId) !== Number(adminId)) {
      wrap.style.display = 'none';
      body.innerHTML = '';
      return { fetchedAt: Date.now(), fetching: false, round: 0, mode: '' };
    }

    if (activeTabId !== 'tab-admin') return nextState;
    if (nextState.fetching) return nextState;

    const now = Date.now();
    if (!force && (now - Number(nextState.fetchedAt || 0) < 7000)) return nextState;

    nextState.fetching = true;
    try {
      const roundSnap = await db.ref('current_round').once('value');
      const round = roundSnap.val() || {};
      const mode = String(round.fieldMode || 'cells');

      wrap.style.display = 'block';
      if (mode !== 'snake') {
        body.innerHTML = `<div class="snake-admin-card"><h4>Текущий режим поля</h4><div>Сейчас активен режим: <b>${mode === 'cells' ? 'Клетки' : mode}</b>. Snake-обзор недоступен.</div></div>`;
        return { fetchedAt: now, fetching: false, round: Number(round.number || 0), mode };
      }

      const roundId = Number(round.number || 0);
      const [whitelistSnap, clashSnap, synergySnap] = await Promise.all([
        db.ref('whitelist').once('value'),
        db.ref(`snake_clashes/${roundId}`).once('value'),
        db.ref(`snake_synergy/${roundId}`).once('value')
      ]);

      const whitelist = whitelistSnap.val() || {};
      const clashes = clashSnap.val() || {};
      const synergy = synergySnap.val() || {};
      const cfg = round.snakeConfig || {};
      const safetyWindowMs = Number(window.snakeRound?.SAFETY_WINDOW_MS || 3600000);

      const configHtml = `
        <div class="snake-admin-card">
          <h4>Конфиг карты раунда #${roundId}</h4>
          ${formatSnakeConfigLine('Змеи', cfg.snakes || [], true)}
          ${formatSnakeConfigLine('Лианы', cfg.vines || [], true)}
          ${formatSnakeConfigLine('Вихри', cfg.maelstrom || [])}
          ${formatSnakeConfigLine('Сокровищницы', cfg.treasury || [])}
          ${formatSnakeConfigLine('Сфинкс', cfg.sphinx || [])}
          ${formatSnakeConfigLine('Каа', cfg.kaa || [])}
          ${formatSnakeConfigLine('Запретный плод', cfg.forbiddenFruit || [])}
          ${formatSnakeConfigLine('Сброс кожи', cfg.shedding || [])}
        </div>
      `;

      const playersRows = Object.entries(whitelist)
        .map(([uid, row]) => ({ uid: String(uid || '').trim(), row: row || {} }))
        .filter(({ row }) => !!row && !row.isEliminated && row.snakeState && Number(row.snakeState.position || 0) > 0)
        .sort((a, b) => Number(a.row?.snakeState?.position || 0) - Number(b.row?.snakeState?.position || 0));

      const playersHtml = playersRows.length
        ? `<div class="snake-admin-card"><h4>Игроки на карте</h4><div class="snake-admin-list">${playersRows.map(({ uid, row }) => {
            const nick = players[Number(row?.charIndex)]?.n || row?.nickname || `ID ${uid}`;
            const st = buildSnakePlayerAdminStatus(row, roundId, safetyWindowMs);
            const consistencyHint = st.roundOk
              ? ''
              : '<br><span style="color:#c62828;">⚠️ Задание привязано к другому раунду (проверь состояние игрока).</span>';
            return `<div>• <b>${nick}</b> (ID ${uid}) · клетка <b>${st.cell}</b><br><span style="color:#6a1b9a;">Статус:</span> ${st.statuses.join(', ')}<br><span style="color:#6a1b9a;">Задание:</span> ${st.taskText}${consistencyHint}</div>`;
          }).join('')}</div></div>`
        : '<div class="snake-admin-card"><h4>Игроки на карте</h4><div>Нет активных snake-игроков.</div></div>';

      const activeClashes = [];
      Object.entries(clashes || {}).forEach(([cell, byPair]) => {
        Object.entries(byPair || {}).forEach(([pairKey, row]) => {
          if (!row) return;
          const status = String(row.status || '');
          if (status !== 'active' && status !== 'resolved') return;
          const pair = Array.isArray(row.players) ? row.players.join(' vs ') : pairKey;
          activeClashes.push(`• клетка ${cell} · ${pair} · ${String(row.gameType || '—')} · статус: ${status}${row.winner ? ` · winner: ${row.winner}` : ''}`);
        });
      });

      const activeSynergy = [];
      Object.entries(synergy || {}).forEach(([cell, byPair]) => {
        Object.entries(byPair || {}).forEach(([pairKey, row]) => {
          if (!row) return;
          const status = String(row.status || '');
          if (status !== 'active') return;
          const pair = Array.isArray(row.players) ? row.players.join(' + ') : pairKey;
          activeSynergy.push(`• клетка ${cell} · ${pair} · статус: ${status}`);
        });
      });

      const interactionsHtml = `
        <div class="snake-admin-card">
          <h4>Активные взаимодействия</h4>
          <div><b>Стычки:</b><br>${activeClashes.length ? activeClashes.join('<br>') : '—'}</div>
          <div style="margin-top:6px;"><b>Синергии:</b><br>${activeSynergy.length ? activeSynergy.join('<br>') : '—'}</div>
        </div>
      `;

      body.innerHTML = configHtml + playersHtml + interactionsHtml;
      return { fetchedAt: now, fetching: false, round: roundId, mode };
    } catch (err) {
      console.warn('snakeAdminOverview render failed', err);
      return { ...nextState, fetching: false };
    }
  }

  window.snakeAdminOverview = {
    render
  };
})();
