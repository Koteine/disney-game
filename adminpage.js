(function () {
  const formatMoscowDateTime = window.formatMoscowDateTime || ((ts) => new Date(ts || Date.now()).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }));
  const parseMoscowDateTimeLocalInput = window.parseMoscowDateTimeLocalInput || ((value) => {
    const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!m) return NaN;
    const [, y, mon, d, h, min] = m.map(Number);
    return Date.UTC(y, mon - 1, d, h - 3, min, 0, 0);
  });
  const toMoscowDateTimeLocalInput = window.toMoscowDateTimeLocalInput || ((ts) => {
    const date = new Date((Number(ts) || Date.now()) + (3 * 60 * 60000));
    return date.toISOString().slice(0, 16);
  });

  function ensureDateTimeInputDefault(inputId, plusMs = 60000) {
    const input = document.getElementById(inputId);
    if (!input || input.value) return;
    input.value = toMoscowDateTimeLocalInput(Date.now() + plusMs);
  }

  function switchAdminInnerTab(tabName) {
    const roundsBtn = document.getElementById('admin-inner-rounds-btn');
    const eventsBtn = document.getElementById('admin-inner-events-btn');
    const drawBtn = document.getElementById('admin-inner-draw-btn');
    const roundsPanel = document.getElementById('admin-rounds-panel');
    const eventsPanel = document.getElementById('admin-events-panel');
    const drawPanel = document.getElementById('admin-draw-panel');
    const isRounds = tabName === 'rounds';
    const isEvents = tabName === 'events';
    const isDraw = tabName === 'draw';
    roundsBtn?.classList.toggle('active', isRounds);
    eventsBtn?.classList.toggle('active', isEvents);
    drawBtn?.classList.toggle('active', isDraw);
    roundsPanel?.classList.toggle('active', isRounds);
    eventsPanel?.classList.toggle('active', isEvents);
    drawPanel?.classList.toggle('active', isDraw);
  }

  async function runRoundStart(durationMs) {
    if (!durationMs || durationMs <= 0) return alert('Укажите время раунда!');
    await archiveAndClearBoard();
    let free = [];
    for (let i = 0; i < 50; i++) free.push(i);

    const magicCell = free.length ? free.splice(Math.floor(Math.random() * free.length), 1)[0] : null;
    const miniGameCell = free.length ? free.splice(Math.floor(Math.random() * free.length), 1)[0] : null;
    const wordSketchCell = free.length ? free.splice(Math.floor(Math.random() * free.length), 1)[0] : null;
    const magnetCell = free.length ? free.splice(Math.floor(Math.random() * free.length), 1)[0] : null;

    const itemCells = {};
    const itemPool = ['goldenPollen', 'inkSaboteur', 'magicWand', 'magnifier'];
    for (const itemType of itemPool) {
      if (!free.length) break;
      const idx = free.splice(Math.floor(Math.random() * free.length), 1)[0];
      itemCells[idx] = itemType;
    }

    const traps = [];
    for (let j = 0; j < 2; j++) {
      if (free.length) traps.push(free.splice(Math.floor(Math.random() * free.length), 1)[0]);
    }

    const s = await db.ref('current_round/number').once('value');
    const newRoundNum = (s.val() || 0) + 1;

    await db.ref('current_round').set({
      number: newRoundNum,
      endTime: Date.now() + durationMs,
      traps,
      magicCell,
      miniGameCell,
      wordSketchCell,
      magnetCell,
      itemCells
    });

    await postNews(`🚀 Стартовал раунд №${newRoundNum}. На поле появились ловушки, 1 магическая клетка, 2 клетки с мини-играми (пятнашки и «Словесный скетч», без дополнительных механик), 1 магнитная клетка и 4 клетки с предметами.`);
    return newRoundNum;
  }

  async function adminStartNewRound() {
    const d = parseInt(document.getElementById('r-days')?.value || '0', 10) || 0;
    const h = parseInt(document.getElementById('r-hours')?.value || '0', 10) || 0;
    const m = parseInt(document.getElementById('r-mins')?.value || '0', 10) || 0;
    const durationMs = (d * 86400000) + (h * 3600000) + (m * 60000);
    const roundNum = await runRoundStart(durationMs);
    if (roundNum) alert(`Раунд №${roundNum} успешно запущен!\nДлительность: ${d}д ${h}ч ${m}м`);
  }

  async function adminScheduleRound() {
    if (currentUserId !== ADMIN_ID) return;
    const startRaw = document.getElementById('round-start-at')?.value;
    const d = parseInt(document.getElementById('r-days')?.value || '0', 10) || 0;
    const h = parseInt(document.getElementById('r-hours')?.value || '0', 10) || 0;
    const m = parseInt(document.getElementById('r-mins')?.value || '0', 10) || 0;
    const durationMs = (d * 86400000) + (h * 3600000) + (m * 60000);
    if (!startRaw) return alert('Выбери дату и время старта раунда.');
    if (!durationMs || durationMs < 60000) return alert('Минимальная длительность раунда — 1 минута.');
    const startAt = parseMoscowDateTimeLocalInput(startRaw);
    if (!Number.isFinite(startAt) || startAt <= Date.now() - 1000) return alert('Время старта должно быть в будущем.');

    const payload = {
      status: 'scheduled',
      startAt,
      durationMs,
      createdAt: Date.now(),
      createdBy: currentUserId
    };
    const pushedRef = await db.ref('round_schedules').push(payload);
    roundSchedules = [...roundSchedules, { key: pushedRef.key, ...payload }].sort((a, b) => (a.startAt || 0) - (b.startAt || 0));
    renderRoundSchedules();
    alert('Раунд запланирован.');
  }

  async function adminCancelScheduledRound(scheduleId) {
    if (!scheduleId || currentUserId !== ADMIN_ID) return;
    if (!confirm('Отменить этот запланированный раунд?')) return;
    await db.ref(`round_schedules/${scheduleId}`).transaction(v => {
      if (!v || v.status !== 'scheduled') return v;
      return { ...v, status: 'cancelled', cancelledAt: Date.now(), cancelledBy: currentUserId };
    });
  }

  async function adminForceRenamePlayer() {
    if (currentUserId !== ADMIN_ID) return;
    const userId = (document.getElementById('admin-rename-user-id')?.value || '').trim();
    const charIndex = Number(document.getElementById('admin-rename-char-index')?.value);
    if (!userId) return alert('Укажи Telegram ID игрока.');
    if (!Number.isInteger(charIndex) || !players[charIndex]) return alert('Выбери корректный никнейм.');

    const userSnap = await db.ref(`whitelist/${userId}`).once('value');
    if (!userSnap.exists()) return alert('Игрок с таким ID не найден в whitelist.');
    await db.ref(`whitelist/${userId}/charIndex`).set(charIndex);
    alert('Никнейм обновлён. Изменение сразу видно всем игрокам.');
  }

  async function adminGrantTicketsToPlayer() {
    if (currentUserId !== ADMIN_ID) return;
    const userId = (document.getElementById('admin-grant-ticket-user-id')?.value || '').trim();
    const count = Math.max(1, Math.floor(Number(document.getElementById('admin-grant-ticket-count')?.value || 1) || 1));
    const note = (document.getElementById('admin-grant-ticket-note')?.value || '').trim();
    if (!userId) return alert('Укажи Telegram ID игрока.');

    const userSnap = await db.ref(`whitelist/${userId}`).once('value');
    const user = userSnap.val();
    const charIndex = Number(user?.charIndex);
    if (!user || !Number.isInteger(charIndex) || !players[charIndex]) return alert('Игрок не найден или у него не назначен никнейм.');

    const awarded = await claimSequentialTickets(count);
    if (!awarded?.length) return alert(`Лимит билетиков (${MAX_TICKETS}) уже достигнут в этой игре.`);

    const ticketValue = awarded.join(' и ');
    await db.ref('tickets_archive').push({
      owner: charIndex,
      userId,
      ticket: ticketValue,
      taskIdx: -1,
      round: currentRoundNum,
      cell: 0,
      cellIdx: -1,
      isManualReward: true,
      archivedAt: Date.now(),
      excluded: false,
      adminNote: note || null,
      taskLabel: note ? `Ручная выдача: ${note}` : 'Ручная выдача администратором'
    });

    const notePart = note ? ` Причина: ${note}` : '';
    await postNews(`🎫 Администратор выдал(а) ${awarded.length} билет(ов) игроку ${players[charIndex].n}.${notePart}`);
    alert(`Готово! Выдано билетиков: ${awarded.length}. Номера: ${ticketValue}.${note ? `\nПометка: ${note}` : ''}`);
  }

  async function adminRevokeTicketsFromPlayer() {
    if (currentUserId !== ADMIN_ID) return;
    const userId = (document.getElementById('admin-revoke-ticket-user-id')?.value || '').trim();
    const ticketNum = String(document.getElementById('admin-revoke-ticket-number')?.value || '').trim();
    const note = (document.getElementById('admin-revoke-ticket-note')?.value || '').trim();
    if (!userId) return alert('Укажи Telegram ID игрока.');
    if (!/^\d+$/.test(ticketNum) || Number(ticketNum) < 1) return alert('Укажи корректный номер билетика для изъятия.');

    const userSnap = await db.ref(`whitelist/${userId}`).once('value');
    const user = userSnap.val();
    const charIndex = Number(user?.charIndex);
    if (!user || !Number.isInteger(charIndex) || !players[charIndex]) return alert('Игрок не найден или у него не назначен никнейм.');

    const [boardSnap, archiveSnap, revokedSnap] = await Promise.all([
      db.ref('board').once('value'),
      db.ref('tickets_archive').once('value'),
      db.ref('revoked_tickets').once('value')
    ]);

    const revokedMap = revokedSnap.val() || {};
    const rows = [];
    const boardData = boardSnap.val() || {};
    Object.entries(boardData).forEach(([cellIdx, cell]) => {
      if (!cell) return;
      rows.push({ ...cell, isArchived: false, cellIdx: Number(cellIdx) });
    });

    archiveSnap.forEach(item => {
      rows.push({ ...(item.val() || {}), isArchived: true, archiveKey: item.key });
    });

    const updates = {};
    let foundInPlayerActive = false;

    rows.forEach(t => {
      if (t.excluded) return;
      if (Number(t.owner) !== Number(charIndex) && String(t.userId || '') !== String(userId)) return;
      const nums = extractTicketNumbers(t.ticket);
      if (!nums.length) return;
      const hasTarget = nums.some(n => String(n) === ticketNum && !revokedMap[String(n)]);
      if (!hasTarget) return;

      foundInPlayerActive = true;
      const left = nums.filter(n => String(n) !== ticketNum);
      if (t.isArchived && t.archiveKey) {
        updates[`tickets_archive/${t.archiveKey}/ticket`] = left.join(' и ');
        updates[`tickets_archive/${t.archiveKey}/excluded`] = left.length === 0;
      } else if (Number.isInteger(t.cellIdx) && t.cellIdx >= 0) {
        updates[`board/${t.cellIdx}/ticket`] = left.join(' и ');
        updates[`board/${t.cellIdx}/excluded`] = left.length === 0;
      }
    });

    if (!foundInPlayerActive) return alert(`У игрока нет активного билетика №${ticketNum}.`);
    if (!Object.keys(updates).length) return alert('Не удалось найти подходящие билетики для изъятия. Попробуй обновить страницу.');

    const archiveKey = db.ref('tickets_archive').push().key;
    updates[`tickets_archive/${archiveKey}`] = {
      owner: charIndex,
      userId,
      ticket: ticketNum,
      taskIdx: -1,
      round: currentRoundNum,
      cell: 0,
      cellIdx: -1,
      isManualRevoke: true,
      adminNote: note || null,
      taskLabel: note ? `Ручное изъятие: ${note}` : 'Ручное изъятие администратором',
      archivedAt: Date.now(),
      excluded: true,
      revokeCancelledAt: null
    };

    await db.ref().update(updates);
    const notePart = note ? ` Причина: ${note}` : '';
    await postNews(`🧾 Администратор отозвал(а) билетик №${ticketNum} у игрока ${players[charIndex].n}.${notePart}`);
    alert(`Готово! Отозван билетик №${ticketNum}.${note ? `\nПометка: ${note}` : ''}`);
  }

  async function adminUndoTicketRevoke(archiveKey) {
    if (currentUserId !== ADMIN_ID) return;
    if (!archiveKey) return;

    const revokeSnap = await db.ref(`tickets_archive/${archiveKey}`).once('value');
    const revokeRow = revokeSnap.val() || {};
    if (!revokeSnap.exists() || !revokeRow.isManualRevoke) return alert('Запись об изъятии не найдена.');
    if (revokeRow.revokeCancelledAt) return alert('Это изъятие уже отменено ранее.');

    const ticketNum = extractTicketNumbers(revokeRow.ticket)[0];
    if (!ticketNum) return alert('Не удалось определить номер билетика для восстановления.');
    const owner = Number(revokeRow.owner);
    const ownerName = players[owner]?.n || 'игрока';

    const [boardSnap, archiveSnap, revokedSnap] = await Promise.all([
      db.ref('board').once('value'),
      db.ref('tickets_archive').once('value'),
      db.ref('revoked_tickets').once('value')
    ]);

    const revokedMap = revokedSnap.val() || {};
    let alreadyActive = false;

    Object.values(boardSnap.val() || {}).forEach(cell => {
      if (alreadyActive || !cell || cell.excluded) return;
      const nums = extractTicketNumbers(cell.ticket);
      if (nums.some(n => String(n) === String(ticketNum) && !revokedMap[String(n)])) alreadyActive = true;
    });

    if (!alreadyActive) {
      archiveSnap.forEach(item => {
        if (alreadyActive) return;
        const row = item.val() || {};
        if (row.excluded) return;
        const nums = extractTicketNumbers(row.ticket);
        if (nums.some(n => String(n) === String(ticketNum) && !revokedMap[String(n)])) alreadyActive = true;
      });
    }

    if (alreadyActive) return alert(`Билетик №${ticketNum} уже участвует в игре. Отмена изъятия не требуется.`);
    if (!confirm(`Отменить изъятие билетика №${ticketNum} и вернуть его ${ownerName}?`)) return;

    const restoreKey = db.ref('tickets_archive').push().key;
    const note = revokeRow.adminNote ? `Возврат после изъятия: ${revokeRow.adminNote}` : 'Возврат после ручного изъятия администратором';
    const updates = {
      [`tickets_archive/${restoreKey}`]: {
        owner,
        userId: String(revokeRow.userId || ''),
        ticket: String(ticketNum),
        taskIdx: -1,
        round: currentRoundNum,
        cell: 0,
        cellIdx: -1,
        isManualReward: true,
        archivedAt: Date.now(),
        excluded: false,
        adminNote: note,
        taskLabel: note,
        restoredFromRevokeKey: archiveKey
      },
      [`tickets_archive/${archiveKey}/revokeCancelledAt`]: Date.now(),
      [`tickets_archive/${archiveKey}/revokeCancelledBy`]: currentUserId
    };

    await db.ref().update(updates);
    await postNews(`↩️ Администратор отменил(а) изъятие билетика №${ticketNum} для игрока ${ownerName}.`);
    alert(`Готово! Билетик №${ticketNum} снова участвует в игре.`);
  }

  async function adminRevokeTicketRange() {
    if (currentUserId !== ADMIN_ID) return;

    const from = Number(document.getElementById('admin-revoke-ticket-from')?.value || 0);
    const to = Number(document.getElementById('admin-revoke-ticket-to')?.value || 0);
    const note = (document.getElementById('admin-revoke-ticket-range-note')?.value || '').trim();

    if (!Number.isInteger(from) || from < 1) return alert('Укажи корректный начальный номер билетика (от 1).');
    if (!Number.isInteger(to) || to < 1) return alert('Укажи корректный конечный номер билетика (от 1).');
    if (from > to) return alert('Начальный номер не может быть больше конечного.');
    if (to > MAX_TICKETS) return alert(`Конечный номер не может быть больше лимита (${MAX_TICKETS}).`);

    const amount = to - from + 1;
    if (!confirm(`Вычеркнуть из игры билетики №${from}...№${to} (всего ${amount})?`)) return;

    const updates = {};
    for (let n = from; n <= to; n += 1) {
      updates[`revoked_tickets/${n}`] = true;
    }
    await db.ref().update(updates);

    const [boardSnap, archiveSnap, revokedSnap] = await Promise.all([
      db.ref('board').once('value'),
      db.ref('tickets_archive').once('value'),
      db.ref('revoked_tickets').once('value')
    ]);
    const boardData = boardSnap.val() || {};
    const archiveData = archiveSnap.val() || {};
    const revokedMap = revokedSnap.val() || {};
    let maxActiveTicket = 0;

    const includeTicketNum = num => {
      const n = Number(num);
      if (!Number.isInteger(n) || n < 1) return;
      if (revokedMap[String(n)]) return;
      if (n > maxActiveTicket) maxActiveTicket = n;
    };

    Object.values(boardData).forEach(cell => {
      if (!cell || cell.excluded) return;
      extractTicketNumbers(cell.ticket).forEach(includeTicketNum);
    });

    Object.values(archiveData).forEach(row => {
      if (!row) return;
      if (row.excluded && !row.isManualRevoke) return;
      extractTicketNumbers(row.ticket).forEach(includeTicketNum);
    });

    await db.ref('ticket_counter').set(maxActiveTicket);

    const notePart = note ? ` Причина: ${note}` : '';
    await postNews(`✂️ Администратор вычеркнул(а) из игры билетики №${from}...№${to}.${notePart}`);
    alert(`Готово! Вычеркнуто билетиков: ${amount} (№${from}...№${to}).`);
  }

  async function adminResetCurrentRound() {
    if (currentUserId !== ADMIN_ID) return;
    if (!confirm('Сбросить текущий раунд? Поле очистится, прогресс раунда будет остановлен.')) return;

    await db.ref('board').set({});
    await db.ref('current_round').update({
      endTime: 0,
      traps: [],
      magicCell: null,
      miniGameCell: null,
      wordSketchCell: null,
      magnetCell: null,
      itemCells: {}
    });
    await postNews('🔄 Администратор сбросил(а) текущий раунд.');
    alert('Текущий раунд сброшен. Теперь можно запустить новый раунд вручную.');
  }

  let roundSchedules = [];
  let roundSchedulesRef = null;

  function renderRoundSchedules() {
    const statusEl = document.getElementById('admin-round-status');
    const scheduled = roundSchedules.filter(r => r.status === 'scheduled');

    const content = scheduled.length
      ? scheduled.map((r, i) => {
          const start = formatMoscowDateTime(r.startAt || 0);
          const mins = Math.max(1, Math.round((r.durationMs || 0) / 60000));
          const cancelBtn = currentUserId === ADMIN_ID
            ? ` <button onclick="adminCancelScheduledRound('${r.key}')" style="border:1px solid #ef5350; color:#c62828; background:#fff5f5; border-radius:8px; padding:2px 6px; font-size:11px;">Отменить</button>`
            : '';
          return `<div style="margin-bottom:6px;">${i + 1}) Старт ${start}, длительность ${mins} мин.${cancelBtn}</div>`;
        }).join('')
      : 'Запланированных раундов нет.';

    if (statusEl) {
      statusEl.innerHTML = `Запланировано (${scheduled.length}):<br>${content}`;
    }
  }


  async function maybeActivateScheduledRound() {
    const due = roundSchedules
      .filter(r => r.status === 'scheduled' && (r.startAt || 0) <= Date.now())
      .sort((a, b) => (a.startAt || 0) - (b.startAt || 0))[0];
    if (!due?.key) return;

    const tx = await db.ref(`round_schedules/${due.key}`).transaction(v => {
      if (!v || v.status !== 'scheduled') return v;
      if (Date.now() < (v.startAt || 0)) return v;
      return { ...v, status: 'starting', startedAt: Date.now() };
    });
    if (!tx.committed) return;

    const roundNum = await runRoundStart(due.durationMs || 0);
    await db.ref(`round_schedules/${due.key}`).update({
      status: 'completed',
      completedAt: Date.now(),
      launchedRound: roundNum || null
    });
  }

  function syncRoundSchedules() {
    if (roundSchedulesRef) roundSchedulesRef.off();
    roundSchedulesRef = db.ref('round_schedules');
    roundSchedulesRef.on('value', snap => {
      const items = [];
      snap.forEach(s => items.push({ key: s.key, ...(s.val() || {}) }));
      roundSchedules = items.sort((a, b) => (a.startAt || 0) - (b.startAt || 0));
      renderRoundSchedules();
    });
  }

  function initAdminPage() {
    window.ensureDateTimeInputDefault = ensureDateTimeInputDefault;
    window.switchAdminInnerTab = switchAdminInnerTab;
    window.adminStartNewRound = adminStartNewRound;
    window.adminScheduleRound = adminScheduleRound;
    window.adminCancelScheduledRound = adminCancelScheduledRound;
    window.adminForceRenamePlayer = adminForceRenamePlayer;
    window.adminGrantTicketsToPlayer = adminGrantTicketsToPlayer;
    window.adminRevokeTicketsFromPlayer = adminRevokeTicketsFromPlayer;
    window.adminUndoTicketRevoke = adminUndoTicketRevoke;
    window.adminRevokeTicketRange = adminRevokeTicketRange;
    window.adminResetCurrentRound = adminResetCurrentRound;

    ensureDateTimeInputDefault('round-start-at');
    syncRoundSchedules();

    if (window.adminRoundInterval) clearInterval(window.adminRoundInterval);
    window.adminRoundInterval = setInterval(async () => {
      await maybeActivateScheduledRound();
    }, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdminPage);
  } else {
    initAdminPage();
  }
})();
