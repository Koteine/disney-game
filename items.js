// Extracted items subsystem module
window.__initItemsModule = function initItemsModule(itemsContext) {
  if (!itemsContext) throw new Error('itemsContext is required');
  with (itemsContext) {
            /************************************************************************************************************
             *                                   МЕХАНИКА: СПРАВОЧНИК ПРЕДМЕТОВ                                         *
             * Централизованное описание всех предметов (иконка, название, описание) для UI и игровой логики.        *
             ************************************************************************************************************/
            const itemTypes = {
                /************************************************************************************************************
                 *                                   ПРЕДМЕТ: ЗОЛОТАЯ ПЫЛЬЦА                                                 *
                 * Расходник, который усиливает следующее получение билетов (+1 билет к ближайшей выдаче).             *
                 ************************************************************************************************************/
                goldenPollen: {
                    emoji: '🎇',
                    name: 'Золотая пыльца',
                    description: 'Даёт +1 билет к следующему получению билетов (одноразово).'
                },
                /************************************************************************************************************
                 *                                   ПРЕДМЕТ: КЛЯКСА-САБОТАЖ                                                 *
                 * Позволяет наложить усложнение на следующую работу выбранного игрока.                                   *
                 ************************************************************************************************************/
                inkSaboteur: {
                    emoji: '🫧',
                    name: 'Клякса-саботаж',
                    description: 'Позволяет выбрать игроку усложнение для следующей работы.'
                },
                /************************************************************************************************************
                 *                                   ПРЕДМЕТ: ВОЛШЕБНАЯ ПАЛОЧКА                                               *
                 * Выдаёт упрощение текущего задания (по правилам соответствующей механики).                              *
                 ************************************************************************************************************/
                magicWand: {
                    emoji: '🎆',
                    name: 'Волшебная палочка',
                    description: 'Даёт упрощение задания на текущий раунд.'
                },
                /************************************************************************************************************
                 *                                   ПРЕДМЕТ: ЛУПА                                                           *
                 * Вспомогательный предмет для доступных режимов/механик, где предусмотрено её применение.              *
                 ************************************************************************************************************/
                magnifier: {
                    emoji: '🔎',
                    name: 'Лупа',
                    description: 'Помогает в игровых механиках, где разрешено её использование.'
                },
                /************************************************************************************************************
                 *                                   ПРЕДМЕТ: ПЛАЩ-НЕВИДИМКА                                                 *
                 * Позволяет безопасно отложить текущее задание до следующего раунда.                                      *
                 ************************************************************************************************************/
                cloak: {
                    emoji: '🎭',
                    name: 'Плащ-невидимка',
                    description: 'Позволяет отложить текущее задание до следующего раунда.'
                },
                greatPythonScale: {
                    emoji: '🛡️',
                    name: 'Чешуя Великого Полоза',
                    description: 'Пассивно нейтрализует негативный эффект в «Змейке» и сгорает.'
                },
                fateBone: {
                    emoji: '🎯',
                    name: 'Кость Судьбы',
                    description: 'Позволяет выбрать число 1..6 вместо обычного броска в «Змейке».'
                },
                windBreath: {
                    emoji: '💨',
                    name: 'Дыхание Ветра',
                    description: 'Даёт двойной бросок и ход на сумму в «Змейке».'
                },
                rottenRadish: {
                    emoji: '🥕',
                    name: 'Гнилая редиска',
                    description: 'Ставит одноразовую ловушку пропуска хода в радиусе 10 клеток.'
                },
                doubleBurdenScroll: {
                    emoji: '📜',
                    name: 'Свиток «Двойное Бремя»',
                    description: 'Ставит ловушку второго задания в радиусе 10 клеток.'
                },
                thiefArcane: {
                    emoji: '🗡️',
                    name: 'Воровской Аркан',
                    description: 'Рискованный рывок: мини-игра на кражу 1 билета у snake-соперника.'
                }
            };

            /************************************************************************************************************
             *                               МЕХАНИКА: ОПЦИИ КЛЯКСЫ-САБОТАЖА (УСЛОЖНЕНИЯ)                                  *
             * Варианты ограничений, которые могут быть назначены цели после применения «Кляксы-саботажа».            *
             ************************************************************************************************************/
            const inkChallengeOptions = [
                'Отжимание: 10 приседаний + 10 прыжков',
                'Смена руки: рисуй нерабочей рукой',
                'Без контура: запрещено использовать чёрный/контур',
                '24 часа: работа должна быть сдана в течение 24 часов'
            ];

            function inventoryCount(itemKey) {
                return Number(myInventory?.[itemKey] || 0);
            }

            function isOwnRegularCell(cell) {
                return !!cell
                    && Number(cell.userId) === Number(currentUserId)
                    && !cell.excluded
                    && !cell.isTrap
                    && !cell.isMagic
                    && !cell.isMiniGame
                    && !cell.isWordSketch
                    && !cell.isGold
                    && !cell.isInkChallenge
                    && !cell.isWandBlessing
                    && !cell.isMagnet;
            }

            function pickRandomTaskIndex(excluded = []) {
                const blocked = new Set((excluded || []).filter(Number.isInteger));
                const pool = tasks
                    .map((_, i) => i)
                    .filter(i => !blocked.has(i));
                if (!pool.length) return -1;
                return pool[Math.floor(Math.random() * pool.length)];
            }

            async function addInventoryItem(itemKey, amount = 1) {
                if (!currentUserId || !itemTypes[itemKey]) return;
                if (itemKey === 'inkSaboteur') return;
                const addAmount = Math.max(0, Number(amount) || 0);
                if (!addAmount) return;

                await waitForDbReady();
                const ref = db.ref(`whitelist/${currentUserId}/inventory`);
                const snap = await ref.once('value');
                const current = snap.val() || {};
                const next = {
                    goldenPollen: Number(current.goldenPollen || 0),
                    inkSaboteur: Number(current.inkSaboteur || 0),
                    magnifier: Number(current.magnifier || 0),
                    cloak: Number(current.cloak || 0),
                    greatPythonScale: Number(current.greatPythonScale || 0),
                    fateBone: Number(current.fateBone || 0),
                    windBreath: Number(current.windBreath || 0),
                    rottenRadish: Number(current.rottenRadish || 0),
                    doubleBurdenScroll: Number(current.doubleBurdenScroll || 0),
                    thiefArcane: Number(current.thiefArcane || 0)
                };
                next[itemKey] = Math.max(0, next[itemKey] + addAmount);
                await ref.set(next);
            }

            async function consumeInventoryItem(itemKey, amount = 1) {
                const userPathId = String(currentUserPathId || currentUserId || '').trim();
                if (!userPathId || !itemTypes[itemKey]) return false;
                const minusAmount = Math.max(1, Number(amount) || 1);

                await waitForDbReady();
                const ref = db.ref(`whitelist/${userPathId}/inventory`);
                const result = await ref.transaction((current) => {
                    const next = {
                        goldenPollen: Number(current?.goldenPollen || 0),
                        inkSaboteur: Number(current?.inkSaboteur || 0),
                        magnifier: Number(current?.magnifier || 0),
                        cloak: Number(current?.cloak || 0),
                        greatPythonScale: Number(current?.greatPythonScale || 0),
                        fateBone: Number(current?.fateBone || 0),
                        windBreath: Number(current?.windBreath || 0),
                        rottenRadish: Number(current?.rottenRadish || 0),
                        doubleBurdenScroll: Number(current?.doubleBurdenScroll || 0),
                        thiefArcane: Number(current?.thiefArcane || 0)
                    };
                    if (next[itemKey] < minusAmount) return;
                    next[itemKey] -= minusAmount;
                    return next;
                });

                return !!result?.committed;
            }

            function renderInventory() {
                const row = document.getElementById('inventory-row');
                if (!row) return;
                if (typeof window.isObserverOnlyAdmin === 'function' && window.isObserverOnlyAdmin()) {
                    row.innerHTML = '<span class="inv-chip">Недоступно в режиме администратора</span>';
                    return;
                }

                const chips = Object.entries(itemTypes)
                    .map(([key, meta]) => ({ key, meta, count: inventoryCount(key) }))
                    .filter(x => x.count > 0)
                    .map(x => `<span class="inv-chip" title="${x.meta.description}">${x.meta.emoji} ${x.meta.name} ×${x.count}</span>`);

                row.innerHTML = chips.length ? chips.join('') : '<span class="inv-chip">Пусто</span>';
            }

            async function activateGoldenPollen(cellIdx) {
                if (typeof window.canUseGameplayFeatures === 'function' && !window.canUseGameplayFeatures()) {
                    return alert(window.getAdminGameplayBlockedLabel?.() || 'Недоступно в режиме администратора');
                }
                const cellSnap = await db.ref(`board/${cellIdx}`).once('value');
                const cell = cellSnap.val();
                if (!isOwnRegularCell(cell) || cell.itemType) return alert('Золотую пыльцу можно использовать только на своей обычной клетке без предмета.');
                if (inventoryCount('goldenPollen') <= 0) return alert('В рюкзаке нет Золотой пыльцы.');

                const usedSnap = await db.ref(`whitelist/${currentUserId}/used_tasks`).once('value');
                const used = Array.isArray(usedSnap.val()) ? usedSnap.val() : [];
                const nextTask = pickRandomTaskIndex([cell.taskIdx, ...used]);
                if (nextTask < 0) return alert('Не нашлось свободных заданий для переброса.');

                const consumed = await consumeInventoryItem('goldenPollen', 1);
                if (!consumed) return alert('Золотая пыльца уже закончилась.');

                const nextUsed = [...used, nextTask];
                await db.ref(`whitelist/${currentUserId}/used_tasks`).set(nextUsed);
                const rerollResult = await window.replaceBoardCellAssignment?.(cellIdx, nextTask, {
                    itemKey: 'goldenPollen',
                    reason: 'item_reroll'
                });
                await db.ref(`board/${cellIdx}`).update({ pollenUsedAt: Date.now() });
                await postNews(`🎇 ${players[myIndex].n} использовал(а) Золотую пыльцу и сменил(а) задание в клетке №${Number(cellIdx) + 1}: #${Number(rerollResult?.oldTaskIdx ?? cell.taskIdx)} → #${nextTask}.`);
                showCell(cellIdx, rerollResult?.cell || { ...cell, taskIdx: nextTask });
            }

            async function activateMagnifier(cellIdx) {
                if (typeof window.canUseGameplayFeatures === 'function' && !window.canUseGameplayFeatures()) {
                    return alert(window.getAdminGameplayBlockedLabel?.() || 'Недоступно в режиме администратора');
                }
                const cellSnap = await db.ref(`board/${cellIdx}`).once('value');
                const cell = cellSnap.val();
                if (!isOwnRegularCell(cell) || cell.itemType) return alert('Лупу можно применить только к своей обычной клетке без предмета.');
                if (inventoryCount('magnifier') <= 0) return alert('В рюкзаке нет Лупы.');

                const usedRoundSnap = await db.ref(`whitelist/${currentUserId}/magnifier_used_round`).once('value');
                if (Number(usedRoundSnap.val() || 0) === Number(currentRoundNum)) {
                    return alert('Лупа уже использована в этом раунде.');
                }

                const usedSnap = await db.ref(`whitelist/${currentUserId}/used_tasks`).once('value');
                const used = Array.isArray(usedSnap.val()) ? usedSnap.val() : [];
                const nextTask = pickRandomTaskIndex([cell.taskIdx, ...used]);
                if (nextTask < 0) return alert('Не нашлось свободных заданий для Лупы.');

                const consumed = await consumeInventoryItem('magnifier', 1);
                if (!consumed) return alert('Лупа уже закончилась.');

                await db.ref(`whitelist/${currentUserId}/used_tasks`).set([...used, nextTask]);
                await db.ref(`whitelist/${currentUserId}/magnifier_used_round`).set(currentRoundNum);
                const rerollResult = await window.replaceBoardCellAssignment?.(cellIdx, nextTask, {
                    itemKey: 'magnifier',
                    reason: 'item_reroll'
                });
                await db.ref(`board/${cellIdx}`).update({ magnifierUsedAt: Date.now() });
                await postNews(`🔎 ${players[myIndex].n} использовал(а) Лупу и сменил(а) задание в клетке №${Number(cellIdx) + 1}: #${Number(rerollResult?.oldTaskIdx ?? cell.taskIdx)} → #${nextTask}.`);
                showCell(cellIdx, rerollResult?.cell || { ...cell, taskIdx: nextTask });
            }

            async function activateInkSaboteur(cellIdx, options = {}) {
                if (typeof window.canUseGameplayFeatures === 'function' && !window.canUseGameplayFeatures()) {
                    return alert(window.getAdminGameplayBlockedLabel?.() || 'Недоступно в режиме администратора');
                }
                const autoPick = !!options.autoPick;
                const cellSnap = await db.ref(`board/${cellIdx}`).once('value');
                const cell = cellSnap.val();
                if (!cell || Number(cell.userId) !== Number(currentUserId) || cell.itemType !== 'inkSaboteur') {
                    if (!autoPick) return alert('Кляксу можно запускать только из своей предметной клетки 🫧.');
                    return;
                }
                if (cell.inkUsed || cell.isInkChallenge) {
                    if (!autoPick) return alert('Клякса для этой клетки уже использована.');
                    return;
                }

                const boardSnap = await db.ref('board').once('value');
                const board = boardSnap.val() || {};
                const targets = [];

                Object.entries(board).forEach(([idx, c]) => {
                    if (!c || Number(c.userId) === Number(currentUserId)) return;
                    if (c.excluded || c.round !== currentRoundNum) return;
                    if (c.isTrap || c.isMagic || c.isGold || c.isMiniGame || c.isWordSketch || c.isMagnet || c.isInkChallenge || c.isWandBlessing) return;
                    targets.push({ cellIdx: Number(idx), cell: c, name: players[c.owner]?.n || `Игрок ${c.userId}` });
                });

                if (!targets.length) {
                    if (!autoPick) return alert('Нет подходящих игроков для кляксы в текущем раунде.');
                    return;
                }

                let target = null;
                if (autoPick) {
                    target = targets[Math.floor(Math.random() * targets.length)];
                } else {
                    const optionsText = targets.map((t, i) => `${i + 1} — ${t.name} (клетка №${t.cellIdx + 1})`).join('\n');
                    const rawChoice = prompt(`Выбери цель для кляксы:
${optionsText}

Введи номер:`, '1');
                    if (rawChoice === null) return;
                    const pick = Number(rawChoice);
                    if (!Number.isInteger(pick) || pick < 1 || pick > targets.length) return alert('Некорректный номер цели.');
                    target = targets[pick - 1];
                }

                const targetPendingTicket = target.cell.ticket || '';
                const updates = {};
                updates[`board/${target.cellIdx}/isInkChallenge`] = true;
                updates[`board/${target.cellIdx}/inkOption`] = null;
                updates[`board/${target.cellIdx}/inkOptionLabel`] = '';
                updates[`board/${target.cellIdx}/ticket`] = '';

                updates[`whitelist/${target.cell.userId}/ink_challenge`] = {
                    fromUserId: currentUserId,
                    fromCellIdx: Number(cellIdx),
                    round: currentRoundNum,
                    cellIdx: target.cellIdx,
                    pendingTicket: targetPendingTicket,
                    selectedOption: null,
                    selectedOptionLabel: '',
                    draftOption: null,
                    draftOptionLabel: '',
                    isResolved: false,
                    createdAt: Date.now()
                };

                updates[`board/${cellIdx}/isInkChallenge`] = true;
                updates[`board/${cellIdx}/inkUsed`] = true;
                updates[`board/${cellIdx}/ticket`] = cell.inkPendingTicket || '';
                updates[`board/${cellIdx}/inkPendingTicket`] = '';
                updates[`board/${cellIdx}/itemType`] = null;

                await db.ref().update(updates);
                await postNews(`🫧 ${players[myIndex].n} запустил(а) кляксу: игрок ${target.name} получил(а) усложнение на клетке №${target.cellIdx + 1}.`);
                if (!autoPick) alert(`Клякса отправлена игроку ${target.name}. Теперь он(а) должен(на) выбрать усложнение.`);
                const updated = await db.ref(`board/${cellIdx}`).once('value');
                showCell(cellIdx, updated.val());
            }


            window.itemTypes = itemTypes;
            window.inkChallengeOptions = inkChallengeOptions;
            window.addInventoryItem = addInventoryItem;
            window.consumeInventoryItem = consumeInventoryItem;
            window.inventoryCount = inventoryCount;
            window.renderInventory = renderInventory;
            window.activateGoldenPollen = activateGoldenPollen;
            window.activateMagnifier = activateMagnifier;
            window.activateInkSaboteur = activateInkSaboteur;
            window.activateCloak = activateCloak;
            window.adminApplyItemAction = adminApplyItemAction;
            window.fillAdminItemsFormDefaults = fillAdminItemsFormDefaults;
            window.renderAdminItemsPlayersList = renderAdminItemsPlayersList;


  }
};
