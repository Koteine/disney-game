// Вынесенный планировщик раундов

const isAdminUser = (...args) => (window.isAdminUser ? window.isAdminUser(...args) : false);
const formatMoscowDateTime = (...args) => (window.formatMoscowDateTime ? window.formatMoscowDateTime(...args) : new Date(args[0] || Date.now()).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }));

          let roundSchedules = [];
          let roundSchedulesRef = null;
          const ROUND_SCHEDULES_STORAGE_KEY = 'disney_round_schedules_backup_v1';
          const ROUND_SCHEDULE_ACTIVATION_GRACE_MS = 30000;

          function getRoundActivationNotBefore(item) {
            const direct = Number(item?.activationNotBefore || 0);
            if (Number.isFinite(direct) && direct > 0) return direct;
            const createdAt = Number(item?.createdAt || 0);
            if (Number.isFinite(createdAt) && createdAt > 0) return createdAt + ROUND_SCHEDULE_ACTIVATION_GRACE_MS;
            return 0;
          }

          function sanitizeRoundSchedulesForBackup(items) {
            return (Array.isArray(items) ? items : [])
              .map((item) => {
                if (!item || typeof item !== 'object' || !item.key) return null;
                return {
                  key: item.key,
                  status: item.status || 'scheduled',
                  startAt: Number(item.startAt || 0),
                  durationMs: Number(item.durationMs || 0),
                  createdAt: Number(item.createdAt || 0),
                  activationNotBefore: Number(item.activationNotBefore || 0),
                  createdBy: item.createdBy || null,
                  cancelledAt: Number(item.cancelledAt || 0) || null,
                  cancelledBy: item.cancelledBy || null,
                  startedAt: Number(item.startedAt || 0) || null,
                  completedAt: Number(item.completedAt || 0) || null,
                  launchedRound: item.launchedRound ?? null
                };
              })
              .filter(Boolean)
              .sort((a, b) => (a.startAt || 0) - (b.startAt || 0));
          }

          function persistRoundSchedulesBackup(items) {
            try {
              localStorage.setItem(ROUND_SCHEDULES_STORAGE_KEY, JSON.stringify(sanitizeRoundSchedulesForBackup(items)));
            } catch (e) {
              console.warn('Не удалось сохранить резерв расписания раундов:', e);
            }
          }

          function restoreRoundSchedulesBackup() {
            try {
              const raw = localStorage.getItem(ROUND_SCHEDULES_STORAGE_KEY);
              if (!raw) return [];
              const parsed = JSON.parse(raw);
              return sanitizeRoundSchedulesForBackup(parsed);
            } catch (e) {
              console.warn('Не удалось прочитать резерв расписания раундов:', e);
              return [];
            }
          }

          function renderRoundSchedules() {
            const statusEl = document.getElementById('admin-round-status');
            const scheduled = roundSchedules.filter(r => String(r.status || 'scheduled') === 'scheduled');
            const recentProcessed = roundSchedules
              .filter(r => r.status === 'completed' || r.status === 'starting' || r.status === 'cancelled')
              .sort((a, b) => (b.startAt || 0) - (a.startAt || 0))
              .slice(0, 5);

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

            if (!statusEl) return;

            const processedContent = recentProcessed.length
              ? recentProcessed.map((r, i) => {
                  const start = formatMoscowDateTime(r.startAt || 0);
                  const statusText = r.status === 'completed'
                    ? `запущен (Раунд №${r.launchedRound || '—'})`
                    : (r.status === 'cancelled' ? 'отменён' : 'в запуске');
                  return `<div style="margin-bottom:4px; color:#6a1b9a;">${i + 1}) ${start} — ${statusText}</div>`;
                }).join('')
              : 'Нет.';

            statusEl.innerHTML = `Запланировано (${scheduled.length}):<br>${content}<br><br>Последние изменения расписания:<br>${processedContent}`;
          }


          async function maybeActivateScheduledRound() {
            if (!hasRoundSchedulesSynced) return;
            const now = getAdminNow();
            const due = roundSchedules

              .filter(r => String(r.status || 'scheduled') === 'scheduled'
                && now >= Number(r.startAt || 0)
                && getRoundActivationNotBefore(r) <= now)

              .sort((a, b) => (a.startAt || 0) - (b.startAt || 0))[0];
            if (!due?.key) return;

            const tx = await db.ref(`round_schedules/${due.key}`).transaction(v => {
              const txNow = getAdminNow();
              if (!v || v.status !== 'scheduled') return v;

              if (txNow < (v.startAt || 0)) return v;
              if (txNow < getRoundActivationNotBefore(v)) return v;

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

          async function adminStartRound(roundId, durationMs) {
            const normalizedDurationMs = Number(durationMs) || 0;
            if (!normalizedDurationMs || normalizedDurationMs <= 0) return null;
            const roundNum = await runRoundStart(normalizedDurationMs);
            if (!roundId) return roundNum;
            await db.ref(`round_schedules/${roundId}`).update({
              status: 'completed',
              completedAt: Date.now(),
              launchedRound: roundNum || null
            });
            return roundNum;
          }

         async function checkScheduledRounds() {
  try {
    if (!db) return;

    if (!Array.isArray(roundSchedules) || !roundSchedules.length) {
      const schedulesSnap = await db.ref('round_schedules').once('value');
      const items = [];
      schedulesSnap.forEach(s => items.push({ key: s.key, status: 'scheduled', ...(s.val() || {}) }));
      roundSchedules = items.sort((a, b) => (a.startAt || 0) - (b.startAt || 0));
      hasRoundSchedulesSynced = true;
      persistRoundSchedulesBackup(roundSchedules);
      renderRoundSchedules();
    }

    const now = getAdminNow();
    const due = (Array.isArray(roundSchedules) ? roundSchedules : [])
      .filter(r =>
        String(r.status || 'scheduled') === 'scheduled' &&
        now >= Number(r.startAt || 0) &&
        getRoundActivationNotBefore(r) <= now
      )
      .sort((a, b) => (a.startAt || 0) - (b.startAt || 0))[0];

    if (!due?.key) return;

    const tx = await db.ref(`round_schedules/${due.key}`).transaction(v => {
      const txNow = getAdminNow();
      if (!v || v.status !== 'scheduled') return v;
      if (txNow < (v.startAt || 0)) return v;
      if (txNow < getRoundActivationNotBefore(v)) return v;
      return { ...v, status: 'starting', startedAt: Date.now() };
    });

    if (!tx.committed) return;

    await adminStartRound(due.key, due.durationMs || 0);

    roundSchedules = (Array.isArray(roundSchedules) ? roundSchedules : []).map(item =>
      item.key === due.key
        ? { ...item, status: 'completed', completedAt: Date.now() }
        : item
    );

    persistRoundSchedulesBackup(roundSchedules);
    renderRoundSchedules();
  } catch (e) {
    console.error('checkScheduledRounds failed:', e);
  }
}


function syncRoundSchedules() {
  if (!db) return;
  if (roundSchedulesRef) roundSchedulesRef.off();
  roundSchedulesRef = db.ref('round_schedules');
  roundSchedulesRef.on('value', snap => {
    const items = [];
    snap.forEach(s => items.push({ key: s.key, status: 'scheduled', ...(s.val() || {}) }));
    roundSchedules = items.sort((a, b) => (a.startAt || 0) - (b.startAt || 0));
    hasRoundSchedulesSynced = true;
    persistRoundSchedulesBackup(roundSchedules);
    renderRoundSchedules();
  });
}
