(function () {
  function getDbInstance() {
    if (typeof db !== 'undefined' && db && typeof db.ref === 'function') return db;
    if (window.db && typeof window.db.ref === 'function') return window.db;
    return null;
  }

  async function waitForDbReady(timeoutMs = 10000) {
    const readyDb = getDbInstance();
    if (readyDb) return readyDb;

    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        const instance = getDbInstance();
        if (instance) {
          clearInterval(timer);
          resolve(instance);
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer);
          reject(new Error('Firebase db не инициализирован.'));
        }
      }, 100);
    });
  }

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

  const isAdminUser = () => Number(currentUserId) === Number(ADMIN_ID);
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
    if (!isAdminUser()) return;
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
    if (!scheduleId || !isAdminUser()) return;
    if (!confirm('Отменить этот запланированный раунд?')) return;
    await db.ref(`round_schedules/${scheduleId}`).transaction(v => {
      if (!v || v.status !== 'scheduled') return v;
      return { ...v, status: 'cancelled', cancelledAt: Date.now(), cancelledBy: currentUserId };
    });
  }

  async function adminForceRenamePlayer() {
    if (!isAdminUser()) return;
    const userId = (document.getElementById('admin-rename-user-id')?.value || '').trim();
    const charIndex = Number(document.getElementById('admin-rename-char-index')?.value);
    if (!userId) return alert('Укажи Telegram ID игрока.');
    if (!Number.isInteger(charIndex) || !players[charIndex]) return alert('Выбери корректный никнейм.');

    const userSnap = await db.ref(`whitelist/${userId}`).once('value');
    if (!userSnap.exists()) return alert('Игрок с таким ID не найден в whitelist.');
    await db.ref(`whitelist/${userId}/charIndex`).set(charIndex);
    alert('Никнейм обновлён. Изменение сразу видно всем игрокам.');
  }

  async function executeEmergencyAction() {
    if (!isAdminUser()) return alert('Эта функция доступна только администратору.');
    const database = await waitForDbReady().catch(() => null);
    if (!database) return alert('База данных недоступна.');

    const action = String(document.getElementById('emergency-action-type')?.value || '').trim();
    const userId = String(document.getElementById('emergency-user-id')?.value || '').trim();
    const amountOrTicket = String(document.getElementById('emergency-amount-or-ticket')?.value || '').trim();
    const reason = String(document.getElementById('emergency-reason')?.value || '').trim();

    if (!/^\d+$/.test(userId)) return alert('Укажи корректный ID игрока.');
    if (!/^\d+$/.test(amountOrTicket)) return alert('Укажи корректный номер билетика.');

    const executeBtn = document.getElementById('btn-execute-emergency');
    if (executeBtn) executeBtn.disabled = true;

    try {
      if (action === 'issue') {
        const ticketNumber = Number.parseInt(amountOrTicket, 10);
        if (!Number.isInteger(ticketNumber) || ticketNumber < 1) {
          throw new Error('Номер билетика должен быть целым положительным числом.');
        }
        const [ticketSnap, userSnap, whiteSnap] = await Promise.all([
          database.ref(`tickets/${ticketNumber}`).once('value'),
          database.ref(`users/${userId}`).once('value'),
          database.ref(`whitelist/${userId}`).once('value')
        ]);

        if (ticketSnap.exists()) {
          throw new Error(`Билетик №${ticketNumber} уже существует в tickets.`);
        }

        const charIndex = Number(whiteSnap.val()?.charIndex);
        const payload = {
          num: ticketNumber,
          ticketNum: ticketNumber,
          ticket: String(ticketNumber),
          userId: String(userId),
          owner: Number.isInteger(charIndex) ? charIndex : -1,
          name: String(userSnap.val()?.name || userSnap.val()?.username || whiteSnap.val()?.name || `ID ${userId}`),
          reason: reason || 'Ручная выдача администратором',
          isManualReward: true,
          issuedByAdmin: true,
          createdAt: Date.now(),
          timestamp: Date.now()
        };

        const archiveKey = database.ref('tickets_archive').push().key;
        const updates = {};
        updates[`tickets/${ticketNumber}`] = payload;
        updates[`users/${userId}/tickets/${ticketNumber}`] = payload;
        updates[`tickets_archive/${archiveKey}`] = {
          ...payload,
          ticket: String(ticketNumber),
          round: currentRoundNum || 0,
          cell: 0,
          cellIdx: -1,
          archivedAt: Date.now(),
          excluded: false,
          adminNote: reason || null
        };
        updates[`revoked_tickets/${ticketNumber}`] = null;
        await database.ref().update(updates);
        alert(`Готово: выдан билетик №${ticketNumber}.`);
      } else if (action === 'revoke') {
        const ticketId = Number(amountOrTicket);
        await window.revokeTicket(ticketId, reason);
        await database.ref(`tickets/${ticketId}`).remove();
        alert(`Готово: билет #${ticketId} вычеркнут.`);
      } else {
        alert('Неизвестный тип экстренного действия.');
      }
    } catch (error) {
      console.error(error);
      alert(error?.message || 'Не удалось выполнить экстренное действие.');
    } finally {
      if (executeBtn) executeBtn.disabled = !isAdminUser();
    }
  }

  async function adminUndoTicketRevoke(archiveKey) {
    if (!isAdminUser()) return alert('Эта функция доступна только администратору.');
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


  async function adminResetCurrentRound() {
    if (!isAdminUser()) return alert('Эта функция доступна только администратору.');
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

  async function resetAllInventories() {
    if (!isAdminUser()) return alert('Эта функция доступна только администратору.');
    if (!confirm('Обнулить рюкзаки всех игроков?')) return;

    const usersSnap = await db.ref('users').once('value');
    const removes = [];
    usersSnap.forEach((userSnap) => {
      removes.push(db.ref(`users/${userSnap.key}/inventory`).remove());
    });

    if (!removes.length) return alert('Список игроков пуст.');

    await Promise.all(removes);
    await postNews('🧹 Администратор обнулил(а) рюкзаки всех игроков.');
    alert('Рюкзаки всех игроков обнулены.');
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
          const cancelBtn = isAdminUser()
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


  function resolveEpicPaintDurationMins(durationMins) {
    const fromArg = Number(durationMins);
    if (Number.isFinite(fromArg) && fromArg >= 1) return Math.max(1, Math.round(fromArg));
    const fromInput = Number(document.getElementById('event-duration-mins')?.value || 0);
    if (Number.isFinite(fromInput) && fromInput >= 1) return Math.max(1, Math.round(fromInput));
    return 10;
  }

  async function adminLaunchEpicPaintEvent(durationMins) {
    if (!isAdminUser()) return alert('Эта функция доступна только администратору.');
    const database = await waitForDbReady().catch(() => null);
    if (!database) return alert('База данных недоступна.');
    const mins = resolveEpicPaintDurationMins(durationMins);
    await database.ref('current_event').set({
      type: 'paint',
      status: 'active',
      end_timestamp: Date.now() + (mins * 60 * 1000),
      participants: {},
      strokes: {},
      progress: { percent: 0 }
    });
    alert('Эпичный раскрас запущен.');
  }

  async function startEpicEvent(durationMins) {
    return adminLaunchEpicPaintEvent(durationMins);
  }

  const EVENT_SCHEDULES_PATH = 'event_schedule';
  let eventSchedules = [];
  let eventSchedulesRef = null;
  let adminServerOffsetMs = 0;

  function getAdminNow() {
    return Date.now() + (Number(adminServerOffsetMs) || 0);
  }

  function renderEventSchedules() {
    const listEl = document.getElementById('admin-event-queue-list');
    if (!listEl) return;
    const scheduled = eventSchedules.filter(ev => ev.status === 'scheduled');
    if (!scheduled.length) {
      listEl.innerHTML = 'Нет запланированных ивентов.';
      return;
    }

    listEl.innerHTML = scheduled.map((ev, idx) => {
      const start = formatMoscowDateTime(ev.startAt || 0);
      const mins = Number(ev.durationMins) || 10;
      return `<div style="padding:6px; border:1px solid #f2d3e4; border-radius:8px; margin-bottom:6px; background:#fff;">${idx + 1}) ${start} · ${mins} мин <button onclick="adminDeleteScheduledEvent('${ev.key}')" style="border:1px solid #ef5350; color:#c62828; background:#fff5f5; border-radius:8px; padding:2px 6px; font-size:11px;">Удалить из очереди</button></div>`;
    }).join('');
  }

  async function adminScheduleEpicPaintEvent() {
    if (!isAdminUser()) return alert('Эта функция доступна только администратору.');
    const database = await waitForDbReady().catch(() => null);
    if (!database) return;

    const startRaw = String(document.getElementById('event-start-at')?.value || '').trim();
    const durationMins = Number(document.getElementById('event-duration-mins')?.value || 0);
    if (!startRaw) return alert('Укажи дату и время старта ивента.');
    if (!Number.isFinite(durationMins) || durationMins < 1) return alert('Укажи длительность (минуты).');

    const startAt = parseMoscowDateTimeLocalInput(startRaw);
    if (!Number.isFinite(startAt)) return alert('Некорректная дата/время.');
    if (startAt <= getAdminNow() - 1000) return alert('Время старта должно быть в будущем.');

    await database.ref(EVENT_SCHEDULES_PATH).push({
      type: 'paint',
      status: 'scheduled',
      startAt,
      durationMins,
      createdAt: Date.now(),
      createdBy: currentUserId
    });

    alert('Событие добавлено в расписание.');
  }

  async function adminDeleteScheduledEvent(key) {
    if (!isAdminUser() || !key) return;
    const database = await waitForDbReady().catch(() => null);
    if (!database) return;
    await database.ref(`${EVENT_SCHEDULES_PATH}/${key}`).transaction(v => {
      if (!v || v.status !== 'scheduled') return v;
      return { ...v, status: 'cancelled', cancelledAt: Date.now(), cancelledBy: currentUserId };
    });
  }

  async function maybeActivateScheduledEvent() {
    const database = await waitForDbReady().catch(() => null);
    if (!database) return;

    const due = eventSchedules
      .filter(ev => ev.status === 'scheduled' && Number(ev.startAt || 0) <= getAdminNow())
      .sort((a, b) => (a.startAt || 0) - (b.startAt || 0))[0];
    if (!due?.key) return;

    const currentStatusSnap = await database.ref('current_event/status').once('value').catch(() => null);
    if (String(currentStatusSnap?.val() || '') === 'active') return;

    const tx = await database.ref(`${EVENT_SCHEDULES_PATH}/${due.key}`).transaction(v => {
      if (!v || v.status !== 'scheduled') return v;
      if (Number(v.startAt || 0) > getAdminNow()) return v;
      return { ...v, status: 'starting', startedAt: Date.now() };
    });
    if (!tx.committed) return;

    const mins = Math.max(1, Number(tx.snapshot.val()?.durationMins) || 10);
    await database.ref('current_event').set({
      type: 'paint',
      status: 'active',
      end_timestamp: getAdminNow() + (mins * 60 * 1000),
      participants: {},
      strokes: {},
      progress: { percent: 0 }
    });

    await database.ref(`${EVENT_SCHEDULES_PATH}/${due.key}`).update({
      status: 'completed',
      completedAt: Date.now()
    });
  }

  async function syncEventSchedules() {
    const database = await waitForDbReady().catch(() => null);
    if (!database) return;
    if (eventSchedulesRef) eventSchedulesRef.off();
    eventSchedulesRef = database.ref(EVENT_SCHEDULES_PATH);
    eventSchedulesRef.on('value', snap => {
      const list = [];
      snap.forEach(item => list.push({ key: item.key, ...(item.val() || {}) }));
      eventSchedules = list.sort((a, b) => (a.startAt || 0) - (b.startAt || 0));
      renderEventSchedules();
    });
  }

  function ensureAdminTabVisibility() {
    const navAdminBtn = document.getElementById('nav-admin-btn');
    const tabAdmin = document.getElementById('tab-admin');
    const adminVisible = Number(currentUserId) === Number(ADMIN_ID);
    if (navAdminBtn) navAdminBtn.style.display = adminVisible ? 'flex' : 'none';
    if (tabAdmin) tabAdmin.style.display = adminVisible ? '' : tabAdmin.style.display;
  }



  async function renderPlayerTicketsList() {
    const listEl = document.getElementById('admin-ticket-players-list');
    const database = await waitForDbReady().catch(() => null);
    if (!database) {
      if (listEl) listEl.innerHTML = '<div style="color:#888; font-size:12px;">База данных недоступна.</div>';
      return [];
    }

    const [usersSnap, whitelistSnap] = await Promise.all([
      database.ref('users').once('value'),
      database.ref('whitelist').once('value')
    ]);

    const usersMap = usersSnap.val() || {};
    const whitelistMap = whitelistSnap.val() || {};
    const merged = new Map();

    Object.entries(usersMap).forEach(([uid, row]) => {
      merged.set(String(uid), {
        userId: String(uid),
        name: String(row?.name || row?.username || row?.displayName || ''),
        charIndex: Number(whitelistMap?.[uid]?.charIndex)
      });
    });

    Object.entries(whitelistMap).forEach(([uid, row]) => {
      const key = String(uid);
      const prev = merged.get(key) || { userId: key, name: '' };
      merged.set(key, {
        userId: key,
        name: prev.name || String(row?.name || row?.username || row?.displayName || ''),
        charIndex: Number(row?.charIndex)
      });
    });

    const users = Array.from(merged.values())
      .map((row) => ({
        userId: String(row.userId),
        charIndex: Number.isFinite(Number(row.charIndex)) ? Number(row.charIndex) : null,
        name: String(row.name || `ID ${row.userId}`)
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

    window.cachedUsersData = usersMap;
    window.cachedWhitelistData = whitelistMap;
    window.adminPlayersCache = users;

    if (listEl && !users.length) {
      listEl.innerHTML = '<div style="color:#888; font-size:12px;">Игроков пока нет.</div>';
    }

    return users;
  }

  function exposeAdminActions() {

    window.ensureDateTimeInputDefault = ensureDateTimeInputDefault;
    window.switchAdminInnerTab = switchAdminInnerTab;
    window.adminStartNewRound = adminStartNewRound;
    window.adminScheduleRound = adminScheduleRound;
    window.adminCancelScheduledRound = adminCancelScheduledRound;
    window.adminForceRenamePlayer = adminForceRenamePlayer;
    window.executeEmergencyAction = executeEmergencyAction;
    window.adminUndoTicketRevoke = adminUndoTicketRevoke;
    window.adminResetCurrentRound = adminResetCurrentRound;
    window.resetAllInventories = resetAllInventories;
    window.adminLaunchEpicPaintEvent = adminLaunchEpicPaintEvent;
    window.startEpicEvent = startEpicEvent;
    window.adminScheduleEpicPaintEvent = adminScheduleEpicPaintEvent;
    window.adminDeleteScheduledEvent = adminDeleteScheduledEvent;
    window.renderPlayerTicketsList = renderPlayerTicketsList;
  }

  async function initAdminPage() {
    window.waitForDbReady = window.waitForDbReady || waitForDbReady;
    exposeAdminActions();
    ensureAdminTabVisibility();

    const database = await waitForDbReady().catch(() => null);
    if (!database) return;

    const emergencyBody = document.getElementById('admin-emergency-body');
    if (emergencyBody) {
      const controls = emergencyBody.querySelectorAll('input, button, select, textarea');
      controls.forEach(el => {
        el.disabled = !isAdminUser();
      });
    }

    const executeBtn = document.getElementById('btn-execute-emergency');
    if (executeBtn) executeBtn.onclick = executeEmergencyAction;

    const launchEventBtn = document.getElementById('btn-launch-epic-paint');
    if (launchEventBtn) {
      launchEventBtn.disabled = false;
      launchEventBtn.removeAttribute('disabled');
      launchEventBtn.onclick = null;
      launchEventBtn.addEventListener('click', () => {
        if (!isAdminUser()) return;
        window.startEpicEvent?.().catch((err) => console.error('startEpicEvent failed:', err));
      });
    }

    ensureDateTimeInputDefault('round-start-at');
    ensureDateTimeInputDefault('event-start-at');
    syncRoundSchedules();
    syncEventSchedules();

    database.ref('users').on('value', (snap) => {
      window.cachedUsersData = snap.val() || {};
      if (isAdminUser() && typeof window.updateTicketsTable === 'function') window.updateTicketsTable();
    });

    database.ref('whitelist').on('value', (snap) => {
      window.cachedWhitelistData = snap.val() || {};
      if (isAdminUser() && typeof window.updateTicketsTable === 'function') window.updateTicketsTable();
    });

    renderPlayerTicketsList().catch(() => {});

    database.ref('.info/serverTimeOffset').on('value', snap => {
      adminServerOffsetMs = Number(snap.val()) || 0;
    });

    if (window.adminRoundInterval) clearInterval(window.adminRoundInterval);
    window.adminRoundInterval = setInterval(async () => {
      ensureAdminTabVisibility();
      await maybeActivateScheduledRound();
    }, 1000);

    if (window.adminEventScheduleInterval) clearInterval(window.adminEventScheduleInterval);
    window.adminEventScheduleInterval = setInterval(async () => {
      await maybeActivateScheduledEvent();
    }, 60000);
  }

  exposeAdminActions();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdminPage);
  } else {
    initAdminPage();
  }
})();
