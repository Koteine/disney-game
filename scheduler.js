// Вынесенный планировщик раундов

function schedulerIsAdminUser(...args) {
  return typeof window.isAdminUser === 'function' ? window.isAdminUser(...args) : false;
}

function schedulerFormatMoscowDateTime(...args) {
  if (typeof window.formatMoscowDateTime === 'function') return window.formatMoscowDateTime(...args);
  return new Date(args[0] || Date.now()).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
}

function schedulerGetNow() {
  return typeof window.getAdminNow === 'function' ? window.getAdminNow() : Date.now();
}

function parseSchedulerDateTimeInput(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return NaN;

  const normalized = raw.replace(' ', 'T');
  const localMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (localMatch) {
    const [, y, mo, d, h, mi, ss = '0'] = localMatch;
    const date = new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(ss),
      0
    );
    if (
      date.getFullYear() !== Number(y)
      || date.getMonth() !== Number(mo) - 1
      || date.getDate() !== Number(d)
      || date.getHours() !== Number(h)
      || date.getMinutes() !== Number(mi)
      || date.getSeconds() !== Number(ss)
    ) {
      return NaN;
    }
    return date.getTime();
  }

  const moscowLikeMatch = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!moscowLikeMatch) return NaN;
  const [, d, mo, y, h, mi, ss = '0'] = moscowLikeMatch;
  return parseSchedulerDateTimeInput(`${y}-${mo}-${d}T${h}:${mi}:${ss}`);
}

if (typeof window.formatMoscowDateTime !== 'function') {
  window.formatMoscowDateTime = (ts) => new Date(ts || Date.now()).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
}

          let roundSchedules = [];
          let roundSchedulesRef = null;
          let hasRoundSchedulesSynced = false;
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
            console.info('[scheduler] renderRoundSchedules: before render');
            const statusEl = document.getElementById('admin-round-status');
            const scheduled = roundSchedules.filter(r => String(r.status || 'scheduled') === 'scheduled');
            const recentProcessed = roundSchedules
              .filter(r => r.status === 'completed' || r.status === 'starting' || r.status === 'cancelled')
              .sort((a, b) => (b.startAt || 0) - (a.startAt || 0))
              .slice(0, 5);

            const content = scheduled.length
              ? scheduled.map((r, i) => {
                  const start = schedulerFormatMoscowDateTime(r.startAt || 0);
                  const mins = Math.max(1, Math.round((r.durationMs || 0) / 60000));
                  const cancelBtn = schedulerIsAdminUser()
                    ? ` <button onclick="adminCancelScheduledRound('${r.key}')" style="border:1px solid #ef5350; color:#c62828; background:#fff5f5; border-radius:8px; padding:2px 6px; font-size:11px;">Отменить</button>`
                    : '';
                  return `<div style="margin-bottom:6px;">${i + 1}) Старт ${start}, длительность ${mins} мин.${cancelBtn}</div>`;
                }).join('')
              : 'Запланированных раундов нет.';

            if (!statusEl) return;

            const processedContent = recentProcessed.length
              ? recentProcessed.map((r, i) => {
                  const start = schedulerFormatMoscowDateTime(r.startAt || 0);
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
            const now = schedulerGetNow();
            const due = roundSchedules

              .filter(r => String(r.status || 'scheduled') === 'scheduled'
                && now >= Number(r.startAt || 0)
                && getRoundActivationNotBefore(r) <= now)

              .sort((a, b) => (a.startAt || 0) - (b.startAt || 0))[0];
            if (!due?.key) return;

            const tx = await db.ref(`round_schedules/${due.key}`).transaction(v => {
              const txNow = schedulerGetNow();
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

    const now = schedulerGetNow();
    const due = (Array.isArray(roundSchedules) ? roundSchedules : [])
      .filter(r =>
        String(r.status || 'scheduled') === 'scheduled' &&
        now >= Number(r.startAt || 0) &&
        getRoundActivationNotBefore(r) <= now
      )
      .sort((a, b) => (a.startAt || 0) - (b.startAt || 0))[0];

    if (!due?.key) return;

    const tx = await db.ref(`round_schedules/${due.key}`).transaction(v => {
      const txNow = schedulerGetNow();
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

async function adminScheduleRound() {
  try {
    console.info('[scheduler] adminScheduleRound: click');
    if (!schedulerIsAdminUser()) return;
    if (!db) return alert('База данных пока недоступна. Попробуйте чуть позже.');
    if (typeof window.waitForDbReady === 'function') {
      await window.waitForDbReady().catch(() => null);
    }

    const startAtInput = document.getElementById('round-start-at');
    const startAtValue = String(startAtInput?.value || '').trim();
    const startAtInputType = String(startAtInput?.type || '').toLowerCase();
    console.log(startAtValue);
    const days = parseInt(document.getElementById('r-days')?.value || '0', 10) || 0;
    const hours = parseInt(document.getElementById('r-hours')?.value || '0', 10) || 0;
    const mins = parseInt(document.getElementById('r-mins')?.value || '0', 10) || 0;
    const durationMs = (days * 86400000) + (hours * 3600000) + (mins * 60000);
    console.info('[scheduler] adminScheduleRound: validation input', { startAtValue, days, hours, mins, durationMs });
    if (!startAtValue) return alert('Выберите дату и время старта раунда.');
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs < 60000) {
      return alert('Укажите длительность раунда. Минимум — 1 минута.');
    }

    const fallbackParser = (rawValue) => parseSchedulerDateTimeInput(rawValue);
    const parser = (typeof window.parseMoscowDateTimeLocalInput === 'function')
      ? (rawValue) => {
        const externalParsed = Number(window.parseMoscowDateTimeLocalInput(rawValue));
        if (Number.isFinite(externalParsed)) return externalParsed;
        return fallbackParser(rawValue);
      }
      : fallbackParser;
    if (startAtInputType === 'datetime-local' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(startAtValue)) {
      console.warn('[scheduler] #round-start-at type=datetime-local but value is not ISO local datetime:', startAtValue);
    }
    const startAt = Number(parser(startAtValue));
    const nowTs = Number(schedulerGetNow()) || Date.now();
    if (!Number.isFinite(startAt) || startAt <= nowTs - 1000) {
      return alert('Время старта должно быть в будущем.');
    }

    const now = Date.now();
    const payload = {
      status: 'scheduled',
      startAt,
      durationMs,
      createdAt: now,
      activationNotBefore: now + ROUND_SCHEDULE_ACTIVATION_GRACE_MS,
      createdBy: String(window.currentUserId || '') || null
    };

    console.info('[scheduler] adminScheduleRound: before db write', payload);
    const newRef = db.ref('round_schedules').push();
    await newRef.set(payload);
    console.info('[scheduler] adminScheduleRound: db write success', { key: newRef.key });

    if (!Array.isArray(roundSchedules)) roundSchedules = [];
    if (!roundSchedules.some(item => item?.key === newRef.key)) {
      roundSchedules = [...roundSchedules, { key: newRef.key, ...payload }]
        .sort((a, b) => (a.startAt || 0) - (b.startAt || 0));
      hasRoundSchedulesSynced = true;
      persistRoundSchedulesBackup(roundSchedules);
      renderRoundSchedules();
    }

    await checkScheduledRounds();
    if (typeof syncRoundSchedules === 'function') syncRoundSchedules();
  } catch (e) {
    console.error('[scheduler] adminScheduleRound failed:', e);
    alert('Не удалось запланировать раунд. Проверьте консоль.');
  }
}

async function adminCancelScheduledRound(roundKey) {
  if (!schedulerIsAdminUser() || !roundKey || !db) return;
  if (!confirm('Отменить этот запланированный раунд?')) return;
  await db.ref(`round_schedules/${roundKey}`).transaction(v => {
    if (!v || v.status !== 'scheduled') return v;
    return { ...v, status: 'cancelled', cancelledAt: Date.now(), cancelledBy: String(window.currentUserId || '') || null };
  });
}

window.syncRoundSchedules = syncRoundSchedules;
window.checkScheduledRounds = checkScheduledRounds;
window.schedulerCheckScheduledRounds = checkScheduledRounds;
window.adminScheduleRound = adminScheduleRound;
window.schedulerAdminScheduleRound = adminScheduleRound;
window.adminCancelScheduledRound = adminCancelScheduledRound;
