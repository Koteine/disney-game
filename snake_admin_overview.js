(function () {
  const SNAKE_OVERVIEW_COLLAPSED_KEY = 'admin_snake_overview_collapsed_v1';
  const CELL_LABELS = {
    normal: 'Обычная клетка',
    snake: 'Змея',
    vine: 'Лиана',
    maelstrom: 'Вихрь',
    treasury: 'Сокровищница',
    sphinx: 'Сфинкс',
    kaa: 'Каа',
    forbiddenFruit: 'Запретный плод',
    shedding: 'Сброс кожи'
  };
  const CELL_ICONS = {
    normal: '▫️',
    snake: '🐍',
    vine: '🌿',
    maelstrom: '🌀',
    treasury: '💎',
    sphinx: '🗿',
    kaa: '👁️',
    forbiddenFruit: '🍎',
    shedding: '🧬'
  };

  let cachedOverviewData = null;
  let selectedCellValue = '';

  function getSnakeOverviewCollapsed() {
    try {
      const raw = window.localStorage?.getItem(SNAKE_OVERVIEW_COLLAPSED_KEY);
      if (raw === null) return true;
      return raw !== '0';
    } catch (_) {
      return true;
    }
  }

  function setSnakeOverviewCollapsed(collapsed) {
    try {
      window.localStorage?.setItem(SNAKE_OVERVIEW_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch (_) {}
  }

  function syncSnakeOverviewUi(collapsed) {
    const content = document.getElementById('admin-snake-overview-content');
    const toggleBtn = document.getElementById('admin-snake-overview-toggle-btn');
    if (content) content.style.display = collapsed ? 'none' : 'block';
    if (toggleBtn) toggleBtn.innerText = collapsed ? 'Развернуть' : 'Свернуть';
  }

  function ensureSnakeOverviewToggleBound() {
    const toggleBtn = document.getElementById('admin-snake-overview-toggle-btn');
    if (!toggleBtn || toggleBtn.dataset.bound === '1') return;
    toggleBtn.dataset.bound = '1';
    toggleBtn.onclick = () => {
      const next = !getSnakeOverviewCollapsed();
      setSnakeOverviewCollapsed(next);
      syncSnakeOverviewUi(next);
    };
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

  function getSnakeCellMeta(pos, cfg) {
    const effect = window.snakeRound?.resolveCellEffect
      ? window.snakeRound.resolveCellEffect(pos, cfg || {})
      : { type: 'normal', to: pos, text: '' };
    const typeKey = String(effect?.type || 'normal');
    if (typeKey === 'snake' || typeKey === 'vine') {
      return {
        typeKey,
        label: `${CELL_ICONS[typeKey] || CELL_ICONS.normal} ${CELL_LABELS[typeKey] || CELL_LABELS.normal}`,
        effects: [`Переход: ${pos} → ${Number(effect?.to || pos)}`]
      };
    }
    return {
      typeKey,
      label: `${CELL_ICONS[typeKey] || CELL_ICONS.normal} ${CELL_LABELS[typeKey] || CELL_LABELS.normal}`,
      effects: [String(effect?.text || '').trim() || 'Спец-эффектов нет']
    };
  }

  function collectPlayersOnCell(whitelist, players, pos, roundId, safetyWindowMs) {
    return Object.entries(whitelist || {})
      .map(([uid, row]) => ({ uid: String(uid || '').trim(), row: row || {} }))
      .filter(({ row }) => !!row && !row.isEliminated && Number(row?.snakeState?.position || 0) === pos)
      .map(({ uid, row }) => {
        const nick = players[Number(row?.charIndex)]?.n || row?.nickname || `ID ${uid}`;
        const status = buildSnakePlayerAdminStatus(row, roundId, safetyWindowMs);
        return {
          uid,
          nick,
          cell: status.cell,
          statuses: status.statuses,
          taskText: status.taskText,
          roundOk: status.roundOk
        };
      })
      .sort((a, b) => a.nick.localeCompare(b.nick, 'ru', { sensitivity: 'base' }));
  }

  function collectAssignmentsForCell(assignmentsByUser, players, whitelist, pos) {
    const rows = [];
    Object.entries(assignmentsByUser || {}).forEach(([uid, userAssignments]) => {
      Object.values(userAssignments || {}).forEach((assignment) => {
        if (!assignment) return;
        if (Number(assignment.cell || 0) !== pos) return;
        const status = String(assignment.status || 'assigned');
        if (status !== 'assigned' && status !== 'pending' && status !== 'in_progress') return;
        const userRow = whitelist?.[uid] || {};
        const nick = players[Number(userRow?.charIndex)]?.n || userRow?.nickname || `ID ${uid}`;
        rows.push({
          uid: String(uid || '').trim(),
          nick,
          status,
          taskLabel: String(assignment.taskLabel || assignment.taskLabelSnapshot || `taskIdx ${Number(assignment.taskIdx ?? assignment.taskId ?? -1)}`),
          assignmentId: String(assignment.assignmentId || '')
        });
      });
    });
    return rows.sort((a, b) => a.nick.localeCompare(b.nick, 'ru', { sensitivity: 'base' }));
  }

  function collectCellEffects(pos, snapshot) {
    const effects = [];
    const trapRow = snapshot?.traps?.[pos] || null;
    if (trapRow?.armed && Number(trapRow.expiresAt || 0) > Date.now()) {
      effects.push(`🕳️ Ловушка активна${trapRow.trapType ? ` (${String(trapRow.trapType)})` : ''}`);
    }

    const activeClashes = Object.values(snapshot?.clashes?.[pos] || {})
      .filter((row) => row && ['active', 'resolved'].includes(String(row.status || '')))
      .map((row) => {
        const pair = Array.isArray(row.players) ? row.players.join(' vs ') : 'пара';
        return `⚔️ Стычка: ${pair}`;
      });
    effects.push(...activeClashes);

    const activeSynergy = Object.values(snapshot?.synergy?.[pos] || {})
      .filter((row) => row && String(row.status || '') === 'active')
      .map((row) => {
        const pair = Array.isArray(row.players) ? row.players.join(' + ') : 'пара';
        return `🤝 Синергия: ${pair}`;
      });
    effects.push(...activeSynergy);

    return effects;
  }

  function bindCellInspectorInput() {
    const input = document.getElementById('admin-snake-cell-input');
    if (!input || input.dataset.bound === '1') return;
    input.dataset.bound = '1';
    input.addEventListener('input', () => {
      selectedCellValue = String(input.value || '').trim();
      renderSelectedCellInspector();
    });
  }

  function renderSelectedCellInspector() {
    const result = document.getElementById('admin-snake-cell-result');
    const input = document.getElementById('admin-snake-cell-input');
    if (!result || !input) return;
    if (!cachedOverviewData) {
      result.innerHTML = '<div class="snake-admin-card">Нет данных snake-карты.</div>';
      return;
    }

    const rawValue = String(selectedCellValue || input.value || '').trim();
    if (!rawValue) {
      result.innerHTML = '<div class="snake-admin-card"><h4>Инспектор клетки</h4><div>Введите номер клетки от 1 до 100.</div></div>';
      return;
    }

    const pos = Number(rawValue);
    if (!Number.isInteger(pos) || pos < 1 || pos > 100) {
      result.innerHTML = '<div class="snake-admin-card"><h4>Инспектор клетки</h4><div>Введите корректный номер клетки от 1 до 100.</div></div>';
      return;
    }

    const meta = getSnakeCellMeta(pos, cachedOverviewData.cfg);
    const playersOnCell = collectPlayersOnCell(
      cachedOverviewData.whitelist,
      cachedOverviewData.players,
      pos,
      cachedOverviewData.roundId,
      cachedOverviewData.safetyWindowMs
    );
    const assignments = collectAssignmentsForCell(
      cachedOverviewData.assignments,
      cachedOverviewData.players,
      cachedOverviewData.whitelist,
      pos
    );
    const dynamicEffects = collectCellEffects(pos, cachedOverviewData);
    const effects = [...meta.effects, ...dynamicEffects];
    const escape = typeof window.escapeHtml === 'function'
      ? window.escapeHtml
      : (value) => String(value ?? '');
    const safeMetaLabel = escape(meta.label);

    result.innerHTML = `
      <div class="snake-admin-card">
        <h4>Клетка №${pos}</h4>
        <div class="snake-admin-inspector-grid">
          <div>
            <div class="snake-admin-kv"><span>Тип клетки</span><b>${safeMetaLabel}</b></div>
            <div class="snake-admin-kv"><span>Активные эффекты</span><div>${effects.length ? effects.map((item) => `<div>• ${escape(item)}</div>`).join('') : '—'}</div></div>
          </div>
          <div>
            <div class="snake-admin-kv"><span>Игроков на клетке</span><b>${playersOnCell.length}</b></div>
            <div class="snake-admin-kv"><span>Активные задания</span><b>${assignments.length}</b></div>
          </div>
        </div>
      </div>
      <div class="snake-admin-card">
        <h4>Игроки</h4>
        ${playersOnCell.length
          ? `<div class="snake-admin-list">${playersOnCell.map((row) => `
              <div class="snake-admin-list-item">
                <b>${escape(row.nick)}</b>
                <div>ID ${escape(row.uid)}</div>
                <div>Статус: ${escape(row.statuses.join(', '))}</div>
                <div>Задание: ${escape(row.taskText)}${row.roundOk ? '' : ' · ⚠️ другой раунд'}</div>
              </div>
            `).join('')}</div>`
          : '<div>На клетке никого нет.</div>'}
      </div>
      <div class="snake-admin-card">
        <h4>Активные назначения</h4>
        ${assignments.length
          ? `<div class="snake-admin-list">${assignments.map((row) => `
              <div class="snake-admin-list-item">
                <b>${escape(row.nick)}</b>
                <div>ID ${escape(row.uid)}</div>
                <div>Статус: ${escape(row.status)}</div>
                <div>${escape(row.taskLabel)}</div>
              </div>
            `).join('')}</div>`
          : '<div>На клетке нет активных назначений.</div>'}
      </div>
    `;
  }

  function renderInspectorShell(roundId) {
    const body = document.getElementById('admin-snake-overview-body');
    if (!body) return;
    body.innerHTML = `
      <div class="snake-admin-card">
        <h4>Инспектор snake-клетки · раунд #${roundId}</h4>
        <div class="snake-admin-inspector-toolbar">
          <label for="admin-snake-cell-input">Введите номер клетки</label>
          <input id="admin-snake-cell-input" class="admin-input snake-admin-cell-input" type="number" min="1" max="100" placeholder="Например, 37" value="${selectedCellValue}">
        </div>
      </div>
      <div id="admin-snake-cell-result" class="snake-admin-overview"></div>
    `;
    bindCellInspectorInput();
    renderSelectedCellInspector();
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

    ensureSnakeOverviewToggleBound();
    syncSnakeOverviewUi(getSnakeOverviewCollapsed());

    const nextState = { ...(cacheState || {}) };

    if (Number(currentUserId) !== Number(adminId)) {
      wrap.style.display = 'none';
      body.innerHTML = '';
      cachedOverviewData = null;
      syncSnakeOverviewUi(true);
      return { fetchedAt: Date.now(), fetching: false, round: 0, mode: '' };
    }

    if (activeTabId !== 'tab-admin') return nextState;
    if (nextState.fetching) return nextState;

    const now = Date.now();
    if (!force && (now - Number(nextState.fetchedAt || 0) < 7000)) {
      renderSelectedCellInspector();
      return nextState;
    }

    nextState.fetching = true;
    try {
      const roundSnap = await db.ref('current_round').once('value');
      const round = roundSnap.val() || {};
      const mode = String(round.fieldMode || 'cells');

      wrap.style.display = 'block';
      if (mode !== 'snake') {
        cachedOverviewData = null;
        body.innerHTML = `<div class="snake-admin-card"><h4>Текущий режим поля</h4><div>Сейчас активен режим: <b>${mode === 'cells' ? 'Клетки' : mode}</b>. Snake-инспектор недоступен.</div></div>`;
        return { fetchedAt: now, fetching: false, round: Number(round.number || 0), mode };
      }

      const roundId = Number(round.number || 0);
      const [whitelistSnap, assignmentsSnap, clashSnap, synergySnap, trapsSnap] = await Promise.all([
        db.ref('whitelist').once('value'),
        db.ref(`rounds/${roundId}/snake/assignments`).once('value'),
        db.ref(`snake_clashes/${roundId}`).once('value'),
        db.ref(`snake_synergy/${roundId}`).once('value'),
        db.ref(`snake_traps/${roundId}`).once('value')
      ]);

      cachedOverviewData = {
        roundId,
        cfg: round.snakeConfig || {},
        whitelist: whitelistSnap.val() || {},
        assignments: assignmentsSnap.val() || {},
        clashes: clashSnap.val() || {},
        synergy: synergySnap.val() || {},
        traps: trapsSnap.val() || {},
        players,
        safetyWindowMs: Number(window.snakeRound?.SAFETY_WINDOW_MS || 3600000)
      };

      renderInspectorShell(roundId);
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
