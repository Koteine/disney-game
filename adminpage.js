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
