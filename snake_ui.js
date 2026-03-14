(function () {
  function create(deps = {}) {
    const {
      db,
      adminId,
      getCurrentUserId,
      getCurrentFieldMode,
      getCurrentRoundNum
    } = deps;

    if (!db) throw new Error('snakeUi.create requires db');

    let snakeStatusRuntime = {
      fetchedAt: 0,
      fetching: false,
      round: 0,
      cell: 0,
      userId: '',
      clashText: '',
      synergyText: '',
      encounterText: ''
    };

    function getEncounterBlockedReasonText(reason) {
      const normalized = String(reason || '').trim();
      if (normalized === 'already_completed_on_this_cell') {
        return '⚖️ На этой клетке вы с этим игроком уже завершили стычку — повтор недоступен.';
      }
      if (normalized === 'other_player_safety_immunity') {
        return '🛡️ Стычка не началась: у второго игрока действует защитный час после входа в клетку.';
      }
      if (normalized === 'friendly_synergy') {
        return '🤝 Вместо стычки активировалась синергия на этой клетке.';
      }
      return '';
    }

    function hideSnakeStatusBlock() {
      const block = document.getElementById('snake-status-block');
      const lines = document.getElementById('snake-status-lines');
      if (block) block.style.display = 'none';
      if (lines) lines.innerHTML = '';
    }

    function formatSnakeStatusLine(label, value) {
      return `<div class="snake-status-line"><strong>${label}:</strong> ${value}</div>`;
    }

    function formatSnakeMinutesLeft(ms) {
      const safe = Math.max(0, Number(ms || 0));
      return Math.ceil(safe / 60000);
    }

    async function refreshSnakeEngagementStatus(roundNum, cellPos, uid) {
      const now = Date.now();
      const sameContext = snakeStatusRuntime.round === roundNum
        && snakeStatusRuntime.cell === cellPos
        && snakeStatusRuntime.userId === uid;
      if (snakeStatusRuntime.fetching) return;
      if (sameContext && (now - Number(snakeStatusRuntime.fetchedAt || 0) < 5000)) return;
      snakeStatusRuntime.fetching = true;
      try {
        let clashText = '';
        let synergyText = '';
        let encounterText = '';
        const [clashSnap, synergySnap, encountersSnap] = await Promise.all([
          db.ref(`snake_clashes/${roundNum}`).once('value'),
          db.ref(`snake_synergy/${roundNum}/${cellPos}`).once('value'),
          db.ref(`snake_encounters/${roundNum}/${cellPos}`).once('value')
        ]);

        const clashesByCell = clashSnap.val() || {};
        const clashRows = Object.values(clashesByCell[String(cellPos)] || {});
        const activeClash = clashRows.find((row) => {
          const playersPair = Array.isArray(row?.players) ? row.players.map((x) => String(x || '').trim()) : [];
          return playersPair.includes(uid) && String(row?.status || '') === 'active';
        });
        if (activeClash) {
          const gt = String(activeClash.gameType || '');
          clashText = gt === 'snake_rps'
            ? '⚔️ Идёт стычка: мини-игра «Камень-Ножницы-Змея».'
            : (gt === 'snake_poison_dice'
              ? '☠️ Идёт стычка: мини-игра «Змеиные кости: Ядовитый бросок».'
              : (gt === 'snake_puzzle_5x5'
                ? '🧠 Идёт стычка: мини-игра «Дуэль умов: Пятнашки 5×5».'
                : '⚔️ Идёт стычка на текущей клетке.'));

        }

        const synergies = Object.values(synergySnap.val() || {});
        const activeSynergy = synergies.find((row) => {
          const playersPair = Array.isArray(row?.players) ? row.players.map((x) => String(x || '').trim()) : [];
          return playersPair.includes(uid) && String(row?.status || '') === 'active';
        });
        if (activeSynergy) {
          synergyText = '🤝 Активна синергия: следующая одобренная работа на клетке даст бонус.';
        }

        if (!activeClash && !activeSynergy) {
          const encounters = Object.values(encountersSnap.val() || {});
          const blockedEncounter = encounters.find((row) => {
            const playersPair = Array.isArray(row?.players) ? row.players.map((x) => String(x || '').trim()) : [];
            if (!playersPair.includes(uid)) return false;
            if (row?.canStartClash) return false;
            return !!getEncounterBlockedReasonText(row?.blockedReason);
          });
          if (blockedEncounter) {
            encounterText = getEncounterBlockedReasonText(blockedEncounter.blockedReason);
          }
        }

        snakeStatusRuntime = {
          fetchedAt: now,
          fetching: false,
          round: roundNum,
          cell: cellPos,
          userId: uid,
          clashText,
          synergyText,
          encounterText
        };
      } catch (err) {
        console.warn('refreshSnakeEngagementStatus failed', err);
        snakeStatusRuntime.fetching = false;
      }
    }

    async function renderSnakeStatusBlock(userState) {
      const block = document.getElementById('snake-status-block');
      const linesEl = document.getElementById('snake-status-lines');
      if (!block || !linesEl) return;

      const currentUserId = String(getCurrentUserId?.() || '').trim();
      const currentFieldMode = String(getCurrentFieldMode?.() || 'cells');
      const currentRoundNum = Number(getCurrentRoundNum?.() || 0);
      if (currentFieldMode !== 'snake' || Number(currentUserId) === Number(adminId)) {
        hideSnakeStatusBlock();
        return;
      }

      const snakeState = userState?.snakeState || {};
      const position = Number(snakeState.position || 1);
      const activeTask = snakeState.activeTask || {};
      const activeTaskType = String(activeTask.type || 'snake_standard');
      const isSphinxTrial = !!activeTask.isSphinxTrial || activeTaskType === 'snake_sphinx';
      const isAwaitingApproval = !!snakeState.awaitingApproval;
      const isSphinxLocked = !!snakeState.lockedBySphinx;
      const isHypnosis = !!snakeState.invertNextRoll;
      const now = Date.now();

      const statusRows = [];
      statusRows.push(formatSnakeStatusLine('Клетка', `№${position}`));

      const taskLabel = String(activeTask.taskLabel || '').trim();
      if (taskLabel) {
        statusRows.push(formatSnakeStatusLine('Задание', taskLabel));
      } else if (Number.isInteger(Number(activeTask.taskIdx)) && Number(activeTask.taskIdx) >= 0) {
        statusRows.push(formatSnakeStatusLine('Задание', `Активно (индекс: ${Number(activeTask.taskIdx)})`));
      } else {
        statusRows.push(formatSnakeStatusLine('Задание', 'Нет активного задания'));
      }

      if (isSphinxLocked && isAwaitingApproval) {
        statusRows.push(formatSnakeStatusLine('Статус', '🗿 Испытание Сфинкса: бросок заморожен до одобрения работы'));
      } else if (isSphinxLocked) {
        statusRows.push(formatSnakeStatusLine('Статус', '🗿 Испытание Сфинкса активно: бросок временно недоступен'));
      } else if (isAwaitingApproval) {
        statusRows.push(formatSnakeStatusLine('Статус', '⏳ Ожидается одобрение текущей работы'));
      } else {
        statusRows.push(formatSnakeStatusLine('Статус', '✅ Можно продолжать путь'));
      }

      if (isSphinxTrial) {
        statusRows.push(formatSnakeStatusLine('Испытание', 'Супер-задание Сфинкса назначено для текущей клетки'));
      }

      const sheddingActive = !!snakeState.sheddingActive && !snakeState.sheddingReleasedAt;
      const sheddingEndsAt = Number(snakeState.sheddingEndsAt || snakeState.sheddingLockUntil || 0);
      if (sheddingActive) {
        const leftMin = formatSnakeMinutesLeft(sheddingEndsAt - now);
        statusRows.push(formatSnakeStatusLine('Сброс кожи', leftMin > 0 ? `ещё ~${leftMin} мин` : 'активен, ожидается обновление'));
      }

      const forbiddenFruitAccepted = !!snakeState.forbiddenFruitAccepted;
      const forbiddenFruitPendingSkip = !!snakeState.forbiddenFruitSkipPending || !!snakeState.skipNextTurn;
      const forbiddenFruitGrantedAt = Number(snakeState.forbiddenFruitGrantedAt || 0);
      if (forbiddenFruitAccepted && forbiddenFruitPendingSkip) {
        statusRows.push(formatSnakeStatusLine('Запретный плод', '🍎 Бонус +20 кармы получен. Следующий бросок будет пропущен.'));
      } else if (forbiddenFruitAccepted && forbiddenFruitGrantedAt > 0) {
        statusRows.push(formatSnakeStatusLine('Запретный плод', '🍎 Эффект уже сработал: бонус получен, пропуск хода использован.'));
      }

      const enteredAt = Number(snakeState.lastCellEnteredAt || snakeState.movedAt || 0);
      const safetyWindowMs = Number(window.snakeRound?.SAFETY_WINDOW_MS || 3600000);
      if (enteredAt > 0) {
        const leftMs = safetyWindowMs - (now - enteredAt);
        if (leftMs > 0) {
          statusRows.push(formatSnakeStatusLine('Иммунитет клетки', `ещё ~${formatSnakeMinutesLeft(leftMs)} мин`));
        }
      }

      if (snakeState.masterTrapVisionEnabled) {
        statusRows.push(formatSnakeStatusLine('Особый статус', 'Режим Мастера: видны опасные клетки'));
      }

      if (currentUserId && currentRoundNum > 0 && position > 0) {
        await refreshSnakeEngagementStatus(currentRoundNum, position, currentUserId);
        if (snakeStatusRuntime.clashText) statusRows.push(formatSnakeStatusLine('Стычка', snakeStatusRuntime.clashText));
        if (snakeStatusRuntime.synergyText) statusRows.push(formatSnakeStatusLine('Синергия', snakeStatusRuntime.synergyText));
        if (snakeStatusRuntime.encounterText) statusRows.push(formatSnakeStatusLine('Встреча', snakeStatusRuntime.encounterText));
      }

      linesEl.innerHTML = statusRows.join('');
      block.style.display = 'block';
    }

    return {
      hideSnakeStatusBlock,
      renderSnakeStatusBlock
    };
  }

  window.snakeUi = { create };
})();
