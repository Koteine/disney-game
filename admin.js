// Вынесенные админские функции

const isAdminUser = (...args) => {
  if (typeof window.isAdminUser === 'function' && window.isAdminUser !== isAdminUser) {
    return window.isAdminUser(...args);
  }
  const fallbackUserId = Number(
    window.currentUserId
    || currentUserId
    || window.Telegram?.WebApp?.initDataUnsafe?.user?.id
    || 0
  );
  const fallbackAdminId = Number(window.ADMIN_ID || ADMIN_ID || 0);
  return fallbackUserId > 0 && fallbackUserId === fallbackAdminId;
};
async function waitForDbReadySafe() {
  if (typeof window.waitForDbReady === 'function') {
    return window.waitForDbReady();
  }
  if (window.db) return window.db;

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (window.db) {
        clearInterval(timer);
        resolve(window.db);
        return;
      }
      if (Date.now() - started > 10000) {
        clearInterval(timer);
        reject(new Error('db not ready'));
      }
    }, 100);
  });
}
const parseMoscowDateTimeLocalInput = (...args) => (
  typeof window.parseMoscowDateTimeLocalInput === 'function' && window.parseMoscowDateTimeLocalInput !== parseMoscowDateTimeLocalInput
    ? window.parseMoscowDateTimeLocalInput(...args)
    : NaN
);
const formatMoscowDateTime = (...args) => (
  typeof window.formatMoscowDateTime === 'function' && window.formatMoscowDateTime !== formatMoscowDateTime
    ? window.formatMoscowDateTime(...args)
    : new Date(args[0] || Date.now()).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
);

          async function adminStartNewRound() {
            const d = parseInt(document.getElementById('r-days')?.value || '0', 10) || 0;
            const h = parseInt(document.getElementById('r-hours')?.value || '0', 10) || 0;
            const m = parseInt(document.getElementById('r-mins')?.value || '0', 10) || 0;
            const durationMs = (d * 86400000) + (h * 3600000) + (m * 60000);
            const fieldMode = String(document.getElementById('round-field-mode')?.value || 'cells');

            const startRaw = String(document.getElementById('round-start-at')?.value || '').trim();
            if (startRaw) {
              const startAt = Number(parseMoscowDateTimeLocalInput(startRaw));
              const nowTs = Number(window.getAdminNow?.() || Date.now());
              if (Number.isFinite(startAt) && startAt > nowTs) {
                if (typeof window.adminScheduleRound === 'function') {
                  await window.adminScheduleRound();
                  return;
                }
              }
            }

            if (!confirm('Точно запустить раунд?')) return;
            const roundNum = await runRoundStart(durationMs, { fieldMode });
            if (roundNum) alert(`Раунд №${roundNum} успешно запущен!
Длительность: ${d}д ${h}ч ${m}м`);
          }


  async function adminScheduleRound() {
  if (typeof window.schedulerAdminScheduleRound === 'function' && window.schedulerAdminScheduleRound !== adminScheduleRound) {
    return window.schedulerAdminScheduleRound();
  }
  if (!isAdminUser()) return;

  const startRaw = document.getElementById('round-start-at')?.value;
  const d = parseInt(document.getElementById('r-days')?.value || '0', 10) || 0;
  const h = parseInt(document.getElementById('r-hours')?.value || '0', 10) || 0;
  const m = parseInt(document.getElementById('r-mins')?.value || '0', 10) || 0;
  const durationMs = (d * 86400000) + (h * 3600000) + (m * 60000);

  if (!startRaw) return alert('Выбери дату и время старта раунда.');
  if (!durationMs || durationMs < 60000) return alert('Минимальная длительность раунда — 1 минута.');

  const startAt = parseMoscowDateTimeLocalInput(startRaw);
  if (!Number.isFinite(startAt) || startAt <= getAdminNow() - 1000) {
    return alert('Время старта должно быть в будущем.');
  }

  const payload = {
    status: 'scheduled',
    startAt,
    durationMs,
    createdAt: Date.now(),
    activationNotBefore: Date.now() + ROUND_SCHEDULE_ACTIVATION_GRACE_MS,
    createdBy: currentUserId,
    fieldMode: String(document.getElementById('round-field-mode')?.value || 'cells')
  };

  const ref = db.ref('round_schedules').push();
  await ref.set(payload);

  roundSchedules = [...(Array.isArray(roundSchedules) ? roundSchedules : []), {
    key: ref.key,
    ...payload
  }].sort((a, b) => (a.startAt || 0) - (b.startAt || 0));

  hasRoundSchedulesSynced = true;
  persistRoundSchedulesBackup(roundSchedules);
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

          function syncEmergencyControlsState() {
            const emergencyBody = document.getElementById('admin-emergency-body');
            if (!emergencyBody) return;
            const controls = emergencyBody.querySelectorAll('input, button, select, textarea');
            controls.forEach((el) => {
              if (el.id === 'admin-reset-mini-events-btn' && el.dataset.loading === '1') {
                return;
              }
              el.disabled = false;
            });
          }

          async function executeEmergencyAction() {
            if (!isAdminUser()) return alert('Эта функция доступна только администратору.');
            const database = await waitForDbReadySafe().catch(() => null);
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
                const [ticketSnap, userSnap, boardSnap, archiveSnap, counterSnap] = await Promise.all([
                  database.ref(`tickets/${ticketNumber}`).once('value'),
                  database.ref(`users/${userId}`).once('value'),
                  database.ref('board').once('value'),
                  database.ref('tickets_archive').once('value'),
                  database.ref('ticket_counter').once('value')
                ]);

                if (ticketSnap.exists()) {
                  throw new Error(`Билетик №${ticketNumber} уже существует в tickets.`);
                }

                const hasTicketInRow = (row) => {
                  const nums = String(row?.ticket || '')
                    .split(' и ')
                    .map((n) => n.trim());
                  return nums.includes(String(ticketNumber));
                };

                let existsInGameData = false;
                boardSnap.forEach((row) => {
                  if (existsInGameData) return;
                  if (row.exists() && hasTicketInRow(row.val() || {})) existsInGameData = true;
                });
                archiveSnap.forEach((row) => {
                  if (existsInGameData) return;
                  if (row.exists() && hasTicketInRow(row.val() || {})) existsInGameData = true;
                });
                if (existsInGameData) {
                  throw new Error(`Билетик №${ticketNumber} уже есть в игре (board/tickets_archive).`);
                }

                const charIndex = Number(userSnap.val()?.charIndex);
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
                const currentCounter = Number(counterSnap.val()) || 0;
                if (ticketNumber > currentCounter) {
                  updates.ticket_counter = ticketNumber;
                }
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

          async function adminResetMiniEvents() {
            if (!isAdminUser()) return alert('Эта функция доступна только администратору.');
            const resetBtn = document.getElementById('admin-reset-mini-events-btn');
            if (resetBtn?.dataset.loading === '1') return;
            if (!confirm('Сбросить зависшие мини-ивенты и дуэли «Тотемы»?')) return;
            if (resetBtn) {
              resetBtn.dataset.loading = '1';
              resetBtn.setAttribute('aria-busy', 'true');
              resetBtn.textContent = '⏳ Сброс мини-ивентов...';
            }
            const database = await waitForDbReadySafe().catch(() => null);
            if (!database) {
              if (resetBtn) {
                resetBtn.removeAttribute('aria-busy');
                resetBtn.textContent = '🧹 Сброс мини-ивентов';
                delete resetBtn.dataset.loading;
              }
              return alert('База данных недоступна.');
            }

            try {
              const [duelsSnap, notificationsSnap, seasonSnap, usersSnap] = await Promise.all([
                database.ref('calligraphy_duels').once('value'),
                database.ref('system_notifications').once('value'),
                database.ref('player_season_status').once('value'),
                database.ref('users').once('value')
              ]);

              const updates = {};
              const now = Date.now();
              const duelNotificationTypes = new Set([
                'calligraphy_duel_invite',
                'calligraphy_duel_wait_notice',
                'calligraphy_duel_timeout',
                'calligraphy_duel_declined',
                'calligraphy_duel_result'
              ]);

              duelsSnap.forEach((snap) => {
                const duel = snap.val() || {};
                const status = String(duel.status || '');
                if (['resolved', 'declined', 'expired'].includes(status)) return;
                updates[`calligraphy_duels/${snap.key}/status`] = 'expired';
                updates[`calligraphy_duels/${snap.key}/expiresAt`] = 0;
                updates[`calligraphy_duels/${snap.key}/expiredAt`] = now;
                updates[`calligraphy_duels/${snap.key}/expiredByReset`] = true;
                updates[`calligraphy_duels/${snap.key}/resetAt`] = now;
                updates[`calligraphy_duels/${snap.key}/resetBy`] = String(currentUserId || '');
              });

              notificationsSnap.forEach((userSnap) => {
                userSnap.forEach((notifSnap) => {
                  const notif = notifSnap.val() || {};
                  if (!duelNotificationTypes.has(String(notif.type || ''))) return;
                  updates[`system_notifications/${userSnap.key}/${notifSnap.key}`] = null;
                });
              });

              seasonSnap.forEach((userSnap) => {
                updates[`player_season_status/${userSnap.key}/last_impulse_time`] = 0;
                updates[`player_season_status/${userSnap.key}/updatedAt`] = now;
              });

              usersSnap.forEach((userSnap) => {
                updates[`users/${userSnap.key}/last_impulse_time`] = 0;
              });

              await database.ref().update(updates);
              postNews('🧹 Администратор сбросил(а) мини-ивенты и дуэли «Тотемы».').catch((err) => {
                console.warn('Не удалось отправить новость о сбросе мини-ивентов', err);
              });
              window.resetMiniEventBadge?.();
              window.resetDuelWaitNoticeTimer?.();
              window.closeCalligraphyDuelUI?.();
              window.closeTotemGameOverlay?.();
              alert('Мини-ивенты и дуэли «Тотемы» успешно сброшены. Кулдауны обнулены.');
            } catch (error) {
              console.error('adminResetMiniEvents failed', error);
              alert(error?.message || 'Не удалось сбросить мини-ивенты. Попробуй ещё раз.');
            } finally {
              if (resetBtn) {
                resetBtn.removeAttribute('aria-busy');
                resetBtn.textContent = '🧹 Сброс мини-ивентов';
                delete resetBtn.dataset.loading;
              }
            }
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

          function resolveEpicPaintDurationMins(durationMins) {
            const fromArg = Number(durationMins);
            if (Number.isFinite(fromArg) && fromArg >= 1) return Math.max(1, Math.round(fromArg));
            const fromInput = Number(document.getElementById('event-duration-mins')?.value || 0);
            if (Number.isFinite(fromInput) && fromInput >= 1) return Math.max(1, Math.round(fromInput));
            return 10;
          }

          async function adminLaunchEpicPaintEvent() {
            const database = await waitForDbReadySafe();
            await database.ref('current_event').set({
              status: 'active',
              type: 'paint',
              endTime: Date.now() + 600000
            });
          }

          async function startEpicEvent() {
            return adminLaunchEpicPaintEvent();
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
            const database = await waitForDbReadySafe().catch(() => null);
            if (!database) return;

            const startRaw = String(document.getElementById('event-start-at')?.value || '').trim();
            const durationMins = Number(document.getElementById('event-duration-mins')?.value || 0);
            if (!startRaw) return alert('Укажи дату и время старта ивента.');
            if (!Number.isFinite(durationMins) || durationMins < 1) return alert('Укажи длительность (минуты).');

            const startAt = parseMoscowDateTimeLocalInput(startRaw);
            if (!Number.isFinite(startAt)) return alert('Некорректная дата/время.');
            if (startAt <= getAdminNow() - 1000) return alert('Время старта должно быть в будущем.');

            await database.ref(EVENT_SCHEDULES_PATH).push({
              type: String(document.getElementById('event-type')?.value || 'epic_paint'),
              status: 'scheduled',
              startAt,
              durationMins,
              createdAt: Date.now(),
              createdBy: currentUserId,
    fieldMode: String(document.getElementById('round-field-mode')?.value || 'cells')
            });

            alert('Событие добавлено в расписание.');
          }

          async function adminDeleteScheduledEvent(key) {
            if (!isAdminUser() || !key) return;
            const database = await waitForDbReadySafe().catch(() => null);
            if (!database) return;
            await database.ref(`${EVENT_SCHEDULES_PATH}/${key}`).transaction(v => {
              if (!v || v.status !== 'scheduled') return v;
              return { ...v, status: 'cancelled', cancelledAt: Date.now(), cancelledBy: currentUserId };
            });
          }

          async function maybeActivateScheduledEvent() {
            const database = await waitForDbReadySafe().catch(() => null);
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
            const evType = String(tx.snapshot.val()?.type || 'epic_paint');
            if (evType === 'mushu_feast') {
              const target = [20, 25, 30, 35, 40][Math.floor(Math.random() * 5)];
              await database.ref('mushu_event').set({ status: 'active', current_satiety: 0, target, participants: {}, fed_users: {}, rewards: {}, rewarded_users: {}, feed_log: {}, combo_bonus: {}, startedAt: Date.now(), endAt: Date.now() + (mins * 60 * 1000), durationMs: mins * 60 * 1000 });
            } else {
              await database.ref('current_event').set({
                type: 'paint',
                status: 'active',
                endTime: Date.now() + (mins * 60 * 1000),
                participants: {},
                strokes: {},
                progress: { percent: 0 }
              });
            }

            await database.ref(`${EVENT_SCHEDULES_PATH}/${due.key}`).update({
              status: 'completed',
              completedAt: Date.now()
            });
          }

          async function syncEventSchedules() {
            const database = await waitForDbReadySafe().catch(() => null);
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

          function isAdminSessionVisible() {
            const tgUserId = Number(window.Telegram?.WebApp?.initDataUnsafe?.user?.id || 0);
            const sessionUserId = Number(window.currentUserId || currentUserId || tgUserId || 0);
            const adminId = Number(window.ADMIN_ID || ADMIN_ID || 0);
            return sessionUserId === adminId;
          }

          function ensureAdminTabVisibility() {
            const navAdminBtn = document.getElementById('nav-admin-btn');
            const tabAdmin = document.getElementById('tab-admin');
            const wheelAdminBtn = document.getElementById('wheel-admin-btn');
            const playersSection = document.getElementById('admin-players-section');
            const emergencySection = document.getElementById('admin-emergency-section');
            const adminVisible = isAdminSessionVisible();
            const showAdminWindows = adminVisible && !!tabAdmin?.classList.contains('tab-active');

            if (navAdminBtn) navAdminBtn.style.display = adminVisible ? 'flex' : 'none';
            if (wheelAdminBtn && !adminVisible) wheelAdminBtn.innerHTML = '';
            if (playersSection) playersSection.style.display = showAdminWindows ? '' : 'none';
            if (emergencySection) emergencySection.style.display = showAdminWindows ? '' : 'none';

            if (tabAdmin) {
              tabAdmin.style.display = adminVisible ? '' : 'none';
              tabAdmin.setAttribute('aria-hidden', adminVisible ? 'false' : 'true');
              if (!adminVisible && tabAdmin.classList.contains('tab-active') && typeof switchTab === 'function') {
                const gameNavBtn = document.querySelector('.nav-item[onclick*="tab-game"]');
                switchTab('tab-game', gameNavBtn);
              }
            }
          }



          async function renderPlayerTicketsList() {
            const listEl = document.getElementById('admin-ticket-players-list');
            const database = await waitForDbReadySafe().catch(() => null);
            if (!database) {
              if (listEl) listEl.innerHTML = '<div style="color:#888; font-size:12px;">База данных недоступна.</div>';
              return [];
            }

            const usersSnap = await database.ref('users').once('value');
            const usersMap = usersSnap.val() || {};

            const users = Object.entries(usersMap)
              .map(([uid, row]) => {
                const ticketsMap = row?.tickets && typeof row.tickets === 'object' ? row.tickets : {};
                const ticketNums = Object.keys(ticketsMap)
                  .filter((n) => /^\d+$/.test(String(n || '').trim()))
                  .map((n) => Number(n))
                  .sort((a, b) => a - b);
                return {
                  userId: String(uid),
                  name: String(row?.name || row?.username || row?.displayName || `ID ${uid}`),
                  tickets: ticketNums
                };
              })
              .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

            window.cachedUsersData = usersMap;
            window.adminPlayersCache = users;

            if (listEl) {
              if (!users.length) {
                listEl.innerHTML = '<div style="color:#888; font-size:12px;">Игроков пока нет.</div>';
              } else {
                listEl.innerHTML = users.map((u, idx) => {
                  const nums = u.tickets.length ? u.tickets.join(', ') : 'нет билетов';
                  return `<div style="padding:8px; border:1px solid #f0d3e7; border-radius:8px; margin-bottom:6px; background:#fff;">${idx + 1}. <b>${u.name}</b> · ID: ${u.userId}<br><span style="font-size:12px; color:#555;">Билеты: ${nums}</span></div>`;
                }).join('');
              }
            }

            return users;
          }

          function exposeAdminActions() {

            window.ensureDateTimeInputDefault = ensureDateTimeInputDefault;
            window.switchAdminInnerTab = switchAdminInnerTab;
            window.adminStartNewRound = adminStartNewRound;
            window.adminStartRound = adminStartRound;
            window.adminScheduleRound = adminScheduleRound;
            window.adminCancelScheduledRound = adminCancelScheduledRound;
            if (typeof window.checkScheduledRounds !== 'function' && typeof window.schedulerCheckScheduledRounds === 'function') {
              window.checkScheduledRounds = window.schedulerCheckScheduledRounds;
            }
            window.adminForceRenamePlayer = adminForceRenamePlayer;
            window.executeEmergencyAction = executeEmergencyAction;
            window.adminUndoTicketRevoke = adminUndoTicketRevoke;
            window.adminResetCurrentRound = adminResetCurrentRound;
            window.adminResetMiniEvents = adminResetMiniEvents;
            window.resetAllInventories = resetAllInventories;
            window.adminLaunchEpicPaintEvent = adminLaunchEpicPaintEvent;
            window.startEpicEvent = startEpicEvent;
            window.adminScheduleEpicPaintEvent = adminScheduleEpicPaintEvent;
            window.adminDeleteScheduledEvent = adminDeleteScheduledEvent;
            window.renderPlayerTicketsList = renderPlayerTicketsList;
          }

          function bindAdminMiniEventResetButton() {
            const btn = document.getElementById('admin-reset-mini-events-btn');
            if (!btn || btn.dataset.bound === '1') return;
            btn.dataset.bound = '1';
            btn.type = 'button';
            btn.style.pointerEvents = 'auto';
            btn.onclick = null;
            if (btn.dataset.loading !== '1') {
              btn.removeAttribute('aria-busy');
            }
          }

          function ensureMiniResetButtonActive() {
            const btn = document.getElementById('admin-reset-mini-events-btn');
            if (!btn) return;
            btn.style.pointerEvents = 'auto';
            if (btn.dataset.loading === '1') return;
            btn.removeAttribute('aria-busy');
          }

          async function initAdminPage() {
            exposeAdminActions();
            bindAdminMiniEventResetButton();
            ensureAdminTabVisibility();

            if (!isAdminSessionVisible()) {
              if (window.adminRoundInterval) {
                clearInterval(window.adminRoundInterval);
                window.adminRoundInterval = null;
              }
              if (window.adminEventScheduleInterval) {
                clearInterval(window.adminEventScheduleInterval);
                window.adminEventScheduleInterval = null;
              }
              return;
            }

            const database = await waitForDbReadySafe().catch(() => null);
            if (!database) return;

            syncEmergencyControlsState();
            ensureMiniResetButtonActive();
            window.addEventListener('load', () => syncEmergencyControlsState(), { once: true });

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
            hasRoundSchedulesSynced = false;
            const cachedRoundSchedules = restoreRoundSchedulesBackup();
            if (cachedRoundSchedules.length) {
              roundSchedules = cachedRoundSchedules;
              renderRoundSchedules();
            }
            syncRoundSchedules();
            syncEventSchedules();
            maybeActivateScheduledEvent().catch(() => {});

            database.ref('users').on('value', (snap) => {
              window.cachedUsersData = snap.val() || {};
              if (isAdminUser() && typeof window.updateTicketsTable === 'function') window.updateTicketsTable();
            });
            renderPlayerTicketsList().catch(() => {});
            startGalleryRotationCountdown();

            renderAdminItemsPlayersList?.().catch(() => {});

            database.ref('.info/serverTimeOffset').on('value', snap => {
              adminServerOffsetMs = Number(snap.val()) || 0;
              galleryServerOffsetMs = adminServerOffsetMs;
            });

            if (window.adminRoundInterval) clearInterval(window.adminRoundInterval);
            window.adminRoundInterval = setInterval(async () => {
              ensureAdminTabVisibility();
              bindAdminMiniEventResetButton();
              syncEmergencyControlsState();
              ensureMiniResetButtonActive();
              await checkScheduledRounds();
            }, 1000);

            if (window.adminEventScheduleInterval) clearInterval(window.adminEventScheduleInterval);
            window.adminEventScheduleInterval = setInterval(async () => {
              await maybeActivateScheduledEvent();
            }, 1000);
          }

          exposeAdminActions();
          document.addEventListener('click', (event) => {
            const btn = event.target?.closest?.('#admin-reset-mini-events-btn');
            if (!btn) return;
            event.preventDefault();
            adminResetMiniEvents();
          });

          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initAdminPage);
          } else {
            initAdminPage();
          }
