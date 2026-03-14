(function () {
  /************************************************************************************************************
   *                                    СИСТЕМА СЕЗОННОЙ КАРМЫ И РАНГОВ                                     *
   * Этот блок инкапсулирован в IIFE, чтобы не засорять глобальную область видимости лишними переменными.   *
   * Здесь находятся: путь в БД, расчет ранга, создание/обновление сезонного профиля и начисление кармы.   *
   ************************************************************************************************************/
  const SEASON_PATH = 'player_season_status';

  function getKarmaRank(points) {
    const p = Number(points) || 0;
    if (p <= 20) return 'Зритель из Первого Ряда';
    if (p <= 40) return 'Ценитель';
    if (p <= 60) return 'Золотая Кисть';
    if (p <= 85) return 'Творец Миров';
    return 'Бессмертный Мастер';
  }

  async function ensureSeasonProfile(db, userId, nickname, isAdmin) {
    if (!db || !userId || isAdmin) return;
    const ref = db.ref(`${SEASON_PATH}/${userId}`);
    const safeNickname = String(nickname || '').trim() || 'Путешественник';
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user || {};
    const avatarUrl = Number(tgUser.id) === Number(userId) ? String(tgUser.photo_url || '').trim() : '';
    await ref.transaction((row) => {
      if (row && typeof row === 'object') {
        if (!row.nickname && safeNickname) row.nickname = safeNickname;
        if (typeof row.karma_points !== 'number') row.karma_points = Number(row.karma_points) || 0;
        if (!row.avatar_url && avatarUrl) row.avatar_url = avatarUrl;
        return row;
      }
      return {
        userId: String(userId),
        nickname: safeNickname,
        karma_points: 0,
        avatar_url: avatarUrl || '',
        updatedAt: Date.now()
      };
    });
  }

  async function addKarmaPoints(db, userId, delta, adminId) {
    if (!db || !userId) return 0;
    if (Number(userId) === Number(adminId)) return 0;
    const value = Number(delta) || 0;
    if (!value) {
      const snap = await db.ref(`${SEASON_PATH}/${userId}/karma_points`).once('value');
      return Number(snap.val()) || 0;
    }
    await db.ref(`${SEASON_PATH}/${userId}`).update({
      karma_points: firebase.database.ServerValue.increment(value),
      updatedAt: Date.now()
    });
    const snap = await db.ref(`${SEASON_PATH}/${userId}/karma_points`).once('value');
    const nextValue = Number(snap.val()) || 0;
    if (Number(adminId)) {
      console.info(`[KARMA][ADMIN] userId=${userId}, delta=${value}, total=${nextValue}`);
    }
    return nextValue;
  }

  window.karmaSystem = {
    SEASON_PATH,
    getKarmaRank,
    ensureSeasonProfile,
    addKarmaPoints
  };
})();

/************************************************************************************************************
 *                                   БАЗОВАЯ ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ                                       *
 * Подключение Firebase, Telegram WebApp, определение роли пользователя (админ/игрок) и базовые утилиты.   *
 ************************************************************************************************************/
const JSON_URL = 'tasks.json';
        const firebaseConfig = { databaseURL: "https://disneyquest-acaa0-default-rtdb.firebaseio.com/" };
        firebase.initializeApp(firebaseConfig);
        const db = firebase.database();
        const tg = window.Telegram.WebApp;
        const ADMIN_ID = 341995937;
        window.db = db;
        window.ADMIN_ID = ADMIN_ID;
        let currentUserId = 0;
        let currentUserPathId = '';
        let currentUserRole = 'player';
        let telegramUser = {};

        function refreshTelegramContext() {
            telegramUser = tg.initDataUnsafe?.user || {};
            currentUserId = Number(telegramUser.id) || 0;
            currentUserPathId = String(telegramUser.id || '').trim();
            currentUserRole = Number(currentUserId) === Number(ADMIN_ID) ? 'admin' : 'player';
            window.currentUserId = currentUserId;
            window.currentUserPathId = currentUserPathId;
            window.currentUserRole = currentUserRole;
        }
        const onValue = (ref, handler) => ref.on('value', handler);
        function adminUpdate(path, patch) {
            return db.ref(path).update(patch);
        }

        function getTelegramDisplayName() {
            const first = String(telegramUser.first_name || '').trim();
            if (first) return first;
            const username = String(telegramUser.username || '').trim();
            if (username) return username.startsWith('@') ? username : `@${username}`;
            return 'Путешественник';
        }


        function escapeHtml(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        async function initializeTelegramSeasonUser() {
            const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user || {};
            const userId = String(tgUser.id || currentUserPathId || currentUserId || '').trim();
            if (!userId || Number(userId) === Number(ADMIN_ID)) return;
            const profileRef = db.ref(`player_season_status/${userId}`);
            const telegramNickname = String(tgUser.first_name || '').trim();
            const telegramPhoto = String(tgUser.photo_url || '').trim();
            await profileRef.transaction((row) => {
                const safeNickname = String(row?.nickname || '').trim();
                const shouldReplacePlaceholder = safeNickname === 'Путешественник' && telegramNickname;
                if (row && typeof row === 'object') {
                    return {
                        ...row,
                        userId,
                        nickname: shouldReplacePlaceholder ? telegramNickname : (safeNickname || telegramNickname || 'Путешественник'),
                        photo_url: String(row.photo_url || telegramPhoto || ''),
                        avatar_url: String(row.avatar_url || row.photo_url || telegramPhoto || ''),
                        karma_points: typeof row.karma_points === 'number' ? row.karma_points : (Number(row.karma_points) || 0),
                        updatedAt: Date.now()
                    };
                }
                return {
                    userId,
                    nickname: telegramNickname || 'Путешественник',
                    photo_url: telegramPhoto,
                    avatar_url: telegramPhoto,
                    karma_points: 0,
                    updatedAt: Date.now()
                };
            });
        }

        /************************************************************************************************************
         *                                   ГЛОБАЛЬНЫЕ ИГРОВЫЕ ДАННЫЕ И СОСТОЯНИЕ                                  *
         * Ниже идут крупные наборы констант и переменных состояния: игроки, ссылки на ветки Firebase,            *
         * текущие события, инвентарь, мини-игры, дуэли, розыгрыши и служебные флаги интерфейса.                   *
         ************************************************************************************************************/
        const players = [{n:"Ван Гог"},{n:"Пикассо"},{n:"Мокрая кисть"},{n:"Мадам Акварель"},{n:"Острый Карандашик"},{n:"Маркерный Маг"},{n:"Маляр-Виртуоз"},{n:"Бешеная Кисточка"},{n:"Клякса"},{n:"Ультрамариновый Ниндзя"},{n:"Королева Фуксия"},{n:"Неоновый Пиксель"},{n:"Солнечная Охра"},{n:"Изумрудный Штрих"},{n:"Алый Контур"},{n:"Великий Скетчер"},{n:"Белоснежка и 7 Слоёв"},{n:"Арт-Хаос"},{n:"Холст-На-Вынос"},{n:"Цветной Енот"},{n:"Бликовая Истерика"},{n:"Арт-Террорист"},{n:"Опасный Пигмент"},{n:"Брызги Фантазии"},{n:"Кислотный Эскиз"},{n:"Гроза Бумаги"},{n:"Тонировщик 3000"},{n:"Ночной Дожор Скетчей"},{n:"Чернильная Фея"},{n:"Пикассо из пригорода"},{n:"Спящий Набросок"},{n:"Злодейский Подтон"},{n:"Охотник за Референсом"},{n:"Блик на Носу"},{n:"Святой Фотошоп"},{n:"Светлячок-Арт"},{n:"Ванильный Холст"},{n:"Сломанный Грифель"},{n:"Фоновый Гном"},{n:"Эстет"},{n:"Ворчащий Мольберт"},{n:"Звездная Пыльца"},{n:"Сечение"},{n:"Призрачный Эскиз"},{n:"Дыхание Акварели"},{n:"Пончик-Колорист"},{n:"Медовый Мазок"},{n:"Слой №137"},{n:"Хранитель Кривых Рук"},{n:"Слеза Перфекциониста"},{n:"Слой-Невидимка"},{n:"Ластик-Мститель"},{n:"Пиксельный Барон"},{n:"Святая Posca"},{n:"Мышиный Самурай"},{n:"Повелитель Заливки"},{n:"Муза в Запое"},{n:"Минималист Поневоле"},{n:"Белоснежка и 7 Дедлайнов"},{n:"Джинн из Тюбика"},{n:"Мирный Тюбик"},{n:"Великий Нехочуха"},{n:"Бумажный Дух"},{n:"Критик из Интернета"},{n:"Теневой Кардинал"},{n:"Pinterest дива"},{n:"Минималист от Лени"},{n:"Чеширский Слой"}];

        function generateBrightColors(count) {
            const palette = [];
            for (let i = 0; i < count; i++) {
                const hue = Math.round((i * 360) / Math.max(1, count));
                palette.push(`hsl(${hue}, 85%, 42%)`);
            }
            return palette;
        }

        const charColors = generateBrightColors(players.length);

        let tasks = [], myIndex = -1, currentRoundNum = 0, roundEndTime = 0, currentRoundStartedAt = 0, currentRoundDurationMs = 0, allTicketsData = [];
        let currentRoundData = null;
        let currentFieldMode = 'cells';
        let archivedTicketsData = [];
        let liveBoardTicketsData = [];
        let shownMagicLinks = {};
        let magicLinksRef = null;
        let newsRef = null;
        let submissionsRef = null;
        let legacyWorksRef = null;
        let inventoryRef = null;
        let challengeRef = null;
        let wandBlessingRef = null;
        let gameEventsRef = null;
        let epicPaintStrokesRef = null;
        let winnerHistoryRef = null;
        let drawScheduleRef = null;
        const INVENTORY_ITEM_KEYS = ['goldenPollen', 'inkSaboteur', 'magnifier', 'cloak'];
        let myInventory = { goldenPollen: 0, inkSaboteur: 0, magnifier: 0, cloak: 0 };
        let myInkChallenge = null;
        let myWandBlessing = null;
        let allSubmissions = [];
        let worksAdminSelectedUserId = '';
        let worksAdminPlayersRef = null;
        let currentGameEvent = null;
        let currentGameEventKey = null;
        let queuedGameEvents = [];
        let lastCompletedEpicEventKeyShown = null;
        let lastFailedEpicEventKeyShown = null;
        let epicPaintStrokes = [];
        let epicPaintHasDismissedStart = false;
        let epicPaintViewMode = 'event';
        let myRoundHasMove = false;
        let epicPaintDrawState = { drawing: false, lastX: 0, lastY: 0 };
        let epicPaintFlushTimer = null;
        let epicPaintPendingStrokes = [];
        let epicPaintRealtimeContext = { team: 'red', color: '#ff007f', preparedForEventKey: null, touched: false };
        let epicPaintCoverageCache = { value: 0, computedAt: 0, strokesCount: -1 };
        let epicPaintRenderQueued = false;
        let currentWheelRotation = 0;
        let wheelSpinInterval = null;
        let wheelSystemInterval = null;
        let winnerHistoryItems = [];
        let newsFeedItems = [];
        let lastRoundEndNewsRound = 0;
        let currentDrawSchedule = null;
        let magicDrawAnimationState = null;
        let activeMagicDrawId = null;
        let pendingMagicLinkCleanupRound = null;
        let magicStarFieldState = null;
        let raffleServerOffsetMs = 0;
        let seasonProfilesRef = null;
        let seasonProfilesByUserId = {};
        let lastMagicLinksRound = null;
        let duelsRef = null;
        let systemNotificationsRef = null;
        let snakeClashesRef = null;
        let activeDuels = [];
        let adminSnakeOverviewState = { fetchedAt: 0, fetching: false, round: 0, mode: '' };


        /************************************************************************************************************
         *                                      МЕХАНИКА: ЭПИЧЕСКАЯ КАРТИНА                                           *
         * Глобальный идентификатор кооперативного события, где игроки совместно закрашивают общее полотно.        *
         ************************************************************************************************************/
        const EPIC_PAINT_EVENT_ID = 'epic_paint';
        /************************************************************************************************************
         *                                      МЕХАНИКА: БИТВА СТЕН                                                     *
         * Идентификатор соревновательного события «битва стен» (внутренняя маршрутизация по id события).          *
         ************************************************************************************************************/
        const WALL_BATTLE_EVENT_ID = 'wall_battle';
        /************************************************************************************************************
         *                                      МЕХАНИКА: ПИР МУШУ                                                       *
         * Идентификатор события «пир мушу» для логики событий, наград и UI-оповещений.                              *
         ************************************************************************************************************/
        const MUSHU_EVENT_ID = 'mushu_feast';
        const EPIC_PAINT_COVERAGE_TARGET = 95;
        const MAX_SCHEDULED_EVENTS = 10;
        const MAX_TICKETS = 2000;
        const MAGIC_LINK_WAIT_WINDOW_MS = 2 * 60 * 60 * 1000;
        // Предметы описаны во встроенном модуле items.js ниже в этом же файле (window.itemTypes).

        /************************************************************************************************************
         *                            МЕХАНИКА: ВОЛШЕБНАЯ ПАЛОЧКА (УПРОЩЕНИЯ ЗАДАНИЙ)                                  *
         * Список готовых послаблений, которые может получить игрок при срабатывании механики волшебной палочки.   *
         ************************************************************************************************************/
        const wandBlessingTasks = [
            "Не успеваю! — ты можешь сдать только 70% работы, остальное доделаешь и покажешь нам потом.",
            "Меньше — не значит хуже — ты можешь выбрать работу формата менее А4.",
            "Золотая пыльца — игроку выдают предмет \"золотая пыльца\", он кладется в рюкзачок и его можно использовать на протяжении всей игры, но только один раз, после чего предмет исчезнет."
        ];
        // Опции кляксы описаны во встроенном модуле items.js ниже в этом же файле (window.inkChallengeOptions).

        /************************************************************************************************************
         *                             МЕХАНИКА: КАЛЛИГРАФИЯ / ДУЭЛЬНЫЕ СИМВОЛЫ                                        *
         * Базовый набор символов для заданий и дуэлей каллиграфии (символ + человекочитаемое название).            *
         ************************************************************************************************************/
        const CALLIGRAPHY_SYMBOLS = [
            { char: '人', title: 'Человек' },
            { char: '大', title: 'Большой' },
            { char: '木', title: 'Дерево' },
            { char: '山', title: 'Гора' },
            { char: '水', title: 'Вода' },
            { char: '火', title: 'Огонь' },
            { char: '月', title: 'Луна' },
            { char: '日', title: 'Солнце' },
            { char: '友', title: 'Друг' },
            { char: '永', title: 'Вечность' }
        ];
        /************************************************************************************************************
         *                                МЕХАНИКА: ИМПУЛЬС (КУЛДАУН АКТИВАЦИИ)                                         *
         * Пауза между повторными активациями импульса, чтобы ограничить частоту использования.                        *
         ************************************************************************************************************/
        const IMPULSE_COOLDOWN_MS = 12 * 60 * 60 * 1000;
        const DUEL_INVITE_TTL_MS = 15 * 60 * 1000;
        /************************************************************************************************************
         *                                  МЕХАНИКА: ДУЭЛИ КАЛЛИГРАФИИ                                                  *
         * Путь хранения дуэлей в Firebase Realtime Database.                                                           *
         ************************************************************************************************************/
        const DUEL_PATH = 'calligraphy_duels';
        /************************************************************************************************************
         *                                МЕХАНИКА: НАГРАДЫ ЗА ДУЭЛИ (ПРЕДМЕТЫ)                                          *
         * Белый список предметов, которые могут выдаваться участникам/победителям дуэлей.                             *
         ************************************************************************************************************/
        const DUEL_REWARD_ITEMS = ['goldenPollen', 'magnifier', 'cloak'];

        /************************************************************************************************************
         *                                  МЕХАНИКА: МАГИЧЕСКАЯ СВЯЗЬ (ПАРНЫЕ ЗАДАНИЯ)                                 *
         * Темы кооперативных заданий для пары игроков, связанных механикой «магическая связь».                      *
         ************************************************************************************************************/
        const magicBondTasks = [
            "Тема «Время и Эволюция»: один человек рисует персонажа в детстве, другой — в зрелости/старости.",
            "Тема «День и Ночь» (контраст стилей): персонажи меняют не возраст, а состояние или облик.",
            "Тема «Добро и Зло» (зеркальное отражение): персонаж один, но характер на рисунке должен быть разным.",
            "Оригинал против Киберпанка: один человек рисует персонажа в классическом стиле, а второй — в стиле далекого будущего."
        ];

        /************************************************************************************************************
         *                                  МЕХАНИКА: КОДОВЫЕ ФРАЗЫ МИНИ-ИГР                                             *
         * Набор коротких кодовых фраз/реплик, используемых в мини-игровых сценариях и проверках.                   *
         ************************************************************************************************************/
        const miniGameCodeWords = [
            "Вау!",
            "Это был бонус!",
            "Я справилась!",
            "Пятнашки? Легко!"
        ];

        /************************************************************************************************************
         *                                  МЕХАНИКА: WORD SKETCH (СЛОВАРЬ СЛОВ)                                        *
         * Словарь слов для режима угадывания; нормализуется в нижний регистр для единообразных сравнений.          *
         ************************************************************************************************************/
        const wordSketchWords = [
            "кисть", "холст", "гуашь", "масло", "уголь", "линер", "пенал", "эскиз", "образ", "мазок",
            "штрих", "линия", "пятно", "стиль", "бемби", "плуто", "алиса", "валик", "глина", "лампа",
            "грунт", "лепка", "набор", "смесь", "блеск", "мулан", "ститч", "замок", "принц", "моана",
            "акрил", "сепия", "губка", "лента", "скотч"
        ].map(w => w.toLowerCase());

        const WORD_SKETCH_MAX_ATTEMPTS = 3;

        /************************************************************************************************************
         *                                   ЛОГИКА МИНИ-ИГРЫ WORD SKETCH                                           *
         * Нормализация пользовательского ввода, выбор случайного слова и проверка букв (аналог Wordle-механики). *
         ************************************************************************************************************/
        function normalizeWordSketchInput(value) {
            return (value || '').trim().toLowerCase().replace(/ё/g, 'е');
        }

        function pickRandomWordSketchWord() {
            return wordSketchWords[Math.floor(Math.random() * wordSketchWords.length)];
        }

        function evaluateWordSketchGuess(guess, answer) {
            return [...guess].map((char, idx) => {
                if (char === answer[idx]) return 'correct';
                if (answer.includes(char)) return 'present';
                return 'absent';
            });
        }

        function buildWordSketchHintMarkup(answer) {
            if (!answer) return '';
            const first = answer[0]?.toUpperCase() || '';
            const hidden = Math.max(answer.length - 1, 0);
            return `
                <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
                    <div style="width:34px; height:34px; border-radius:8px; border:1px solid #6d4c41; background:#dcedc8; color:#33691e; display:flex; align-items:center; justify-content:center; font-weight:bold;">${first}</div>
                    ${Array.from({length: hidden}).map(() => `<div style="width:34px; height:34px; border-radius:8px; border:1px dashed #a1887f; background:#fff;"></div>`).join('')}
                </div>`;
        }

        function buildWordSketchAttemptRow(attempt) {
            const guess = normalizeWordSketchInput(attempt?.guess || '');
            const marks = Array.isArray(attempt?.marks) ? attempt.marks : [];
            if (!guess) return '';

            return `
                <div style="display:flex; gap:6px; margin-top:6px; flex-wrap:wrap;">
                    ${[...guess].map((ch, idx) => {
                        const mark = marks[idx] || 'absent';
                        const color = mark === 'correct' ? '#2e7d32' : (mark === 'present' ? '#ef6c00' : '#90a4ae');
                        const bg = mark === 'correct' ? '#e8f5e9' : (mark === 'present' ? '#fff3e0' : '#eceff1');
                        return `<div style="width:34px; height:34px; border-radius:8px; border:1px solid ${color}; background:${bg}; color:${color}; display:flex; align-items:center; justify-content:center; font-weight:bold;">${ch.toUpperCase()}</div>`;
                    }).join('')}
                </div>`;
        }

        async function submitWordSketchGuess(cellIdx) {
            const input = document.getElementById(`word-sketch-input-${cellIdx}`);
            if (!input) return;

            const guess = normalizeWordSketchInput(input.value);
            const cellRef = db.ref('board/' + cellIdx);
            const snap = await cellRef.once('value');
            const cell = snap.val();
            if (!cell?.isWordSketch) return;

            const isOwner = cell.userId === currentUserId;
            if (!isOwner) return alert('Угадывать слово может только владелец клетки.');
            if (cell.wordSketchGuessed || cell.wordSketchFailed) return alert('Для этой клетки попытки уже завершены.');

            const targetWord = normalizeWordSketchInput(cell.wordSketchAnswer || '');
            if (!targetWord) return alert('Слово для этой клетки ещё не подготовлено.');
            if (guess.length !== targetWord.length) return alert(`Нужно ввести слово из ${targetWord.length} букв.`);

            const marks = evaluateWordSketchGuess(guess, targetWord);
            const attempts = Array.isArray(cell.wordSketchAttempts) ? [...cell.wordSketchAttempts] : [];
            attempts.push({ guess, marks, ts: Date.now() });
            const attemptsUsed = attempts.length;
            const attemptsLeft = Math.max(WORD_SKETCH_MAX_ATTEMPTS - attemptsUsed, 0);
            const isCorrect = guess === targetWord;
            const isFailed = !isCorrect && attemptsUsed >= WORD_SKETCH_MAX_ATTEMPTS;

            const updates = {
                wordSketchGuess: guess,
                wordSketchAttempts: attempts,
                wordSketchAttemptCount: attemptsUsed,
                wordSketchGuessed: isCorrect,
                wordSketchFailed: isFailed
            };

            if (isCorrect) {
                const awarded = await claimSequentialTickets(1);
                const ticket = awarded?.[0] || '';
                if (!ticket) return alert(`Лимит билетиков (${MAX_TICKETS}) уже достигнут в этой игре.`);
                updates.ticket = ticket;
                await postNews(`🧩 ${players[cell.owner].n} угадал(а) слово в игре «Словесный скетч» и получил(а) билет №${ticket}!`);
                alert('Ого! Самый мозговитый на этом холсте! Кодовое слово "Скетч". Рисуй картинку и получай билет!');
            } else if (isFailed) {
                updates.ticket = '';
                await postNews(`🧩 ${players[cell.owner].n} не угадал(а) слово в игре «Словесный скетч» и пропускает раунд.`);
                alert('Увы, попытки закончились. В этом раунде билет не начисляется, ход пропущен.');
            } else {
                alert(`Неверно. Осталось попыток: ${attemptsLeft}. Подсказка по буквам обновлена в карточке.`);
            }

            await cellRef.update(updates);
            const updated = await cellRef.once('value');
            showCell(cellIdx, updated.val());
        }

        function buildWordSketchMarkup(cellIdx, cell, isOwner) {
            const attempts = Array.isArray(cell.wordSketchAttempts) ? cell.wordSketchAttempts : [];
            const attemptsUsed = attempts.length;
            const isResolved = !!(cell.wordSketchGuessed || cell.wordSketchFailed);
            const canGuess = isOwner && !isResolved;
            const answer = normalizeWordSketchInput(cell.wordSketchAnswer || '');
            const attemptsLeft = Math.max(WORD_SKETCH_MAX_ATTEMPTS - attemptsUsed, 0);

            let statusText = `<div style="font-size:12px; color:#5d4037; margin-top:8px;">Угадай слово. Есть ${WORD_SKETCH_MAX_ATTEMPTS} попытки. Подсказка: первая буква открыта.</div>`;
            if (cell.wordSketchGuessed) {
                statusText = `<div style="font-size:13px; color:#2e7d32; font-weight:bold; margin-top:8px;">Ого! Самый мозговитый на этом холсте! Кодовое слово "Скетч". Рисуй картинку и получай билет.</div><div style="font-size:12px; margin-top:4px; color:#33691e;">🎟 Билет: <b>${cell.ticket || '—'}</b></div>`;
            } else if (cell.wordSketchFailed) {
                statusText = `<div style="font-size:13px; color:#c62828; font-weight:bold; margin-top:8px;">Слово не угадано за ${WORD_SKETCH_MAX_ATTEMPTS} попытки. Билет не начисляется, этот раунд пропускается.</div>`;
            } else {
                statusText += `<div style="font-size:12px; color:#6d4c41; margin-top:4px;">Попыток осталось: <b>${attemptsLeft}</b></div>`;
            }

            const attemptsMarkup = attempts.length
                ? `<div style="margin-top:8px;"><div style="font-size:12px; color:#5d4037;">История попыток:</div>${attempts.map(buildWordSketchAttemptRow).join('')}</div>`
                : '';

            return `
                <div style="margin-top:12px; padding:12px; border:2px solid #8d6e63; border-radius:10px; background:#efebe9; text-align:left;">
                    <div style="font-weight:bold; color:#4e342e; margin-bottom:8px;">🧩 Мини-игра: Словесный скетч</div>
                    <div style="font-size:12px; color:#5d4037;">Первая буква известна сразу. Цвета в попытках: 🟩 буква и место верные, 🟧 буква есть в слове, но место другое.</div>
                    ${buildWordSketchHintMarkup(answer)}
                    ${canGuess ? `<div style="display:flex; gap:6px; margin-top:8px;"><input id="word-sketch-input-${cellIdx}" maxlength="${answer.length || 5}" placeholder="Введи слово" style="flex:1; border:1px solid #bcaaa4; border-radius:8px; padding:8px; text-transform:lowercase;"><button onclick="submitWordSketchGuess(${cellIdx})" style="border:1px solid #6d4c41; background:#fff; color:#4e342e; border-radius:8px; padding:8px 10px;">Проверить</button></div>` : ''}
                    ${attemptsMarkup}
                    ${statusText}
                </div>`;
        }

        function buildSolvedMiniGameTiles(size = 5) {
            return [...Array(size * size - 1).keys()].map(i => i + 1).concat(0);
        }

        function isMiniGameSolved(tiles, size = 5) {
            const solved = buildSolvedMiniGameTiles(size);
            return tiles.length === solved.length && tiles.every((v, idx) => v === solved[idx]);
        }

        function miniGameIsSolvable(tiles, size = 5) {
            const nums = tiles.filter(v => v !== 0);
            let inversions = 0;
            for (let i = 0; i < nums.length; i++) {
                for (let j = i + 1; j < nums.length; j++) {
                    if (nums[i] > nums[j]) inversions++;
                }
            }

            if (size % 2 === 1) return inversions % 2 === 0;

            const blankRowFromBottom = size - Math.floor(tiles.indexOf(0) / size);
            return (blankRowFromBottom % 2 === 0) ? (inversions % 2 === 1) : (inversions % 2 === 0);
        }

        function createShuffledMiniGameTiles(size = 5) {
            const tiles = buildSolvedMiniGameTiles(size);
            do {
                for (let i = tiles.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
                }
            } while (!miniGameIsSolvable(tiles, size) || isMiniGameSolved(tiles, size));
            return tiles;
        }

        function canMoveMiniGameTile(emptyIdx, tileIdx, size = 5) {
            if (tileIdx < 0 || emptyIdx < 0) return false;
            const er = Math.floor(emptyIdx / size), ec = emptyIdx % size;
            const tr = Math.floor(tileIdx / size), tc = tileIdx % size;
            return Math.abs(er - tr) + Math.abs(ec - tc) === 1;
        }

        function pickRandomMiniGameCodeWord() {
            return miniGameCodeWords[Math.floor(Math.random() * miniGameCodeWords.length)];
        }

        async function moveMiniGameTile(cellIdx, tileIdx) {
            const cellRef = db.ref('board/' + cellIdx);
            const snap = await cellRef.once('value');
            const cell = snap.val();
            const isInkMiniGame = !!(cell?.isInkChallenge && myInkChallenge?.selectedOption === 1);
            if (!cell || (!cell.isMiniGame && !isInkMiniGame)) return;

            const isOwner = cell.userId === currentUserId;
            if (!isOwner) return alert('Передвигать плитки может только владелец клетки.');
            if (cell.miniGameWon) return alert('Мини-игра уже собрана!');
            if (cell.miniGameFailed || (cell.isMiniGame && cell.round === currentRoundNum && Date.now() >= roundEndTime)) return alert('Раунд завершён — билет за пятнашки уже недоступен.');

            const tiles = Array.isArray(cell.miniGameTiles) && cell.miniGameTiles.length === 25
                ? [...cell.miniGameTiles]
                : createShuffledMiniGameTiles(5);

            const emptyIdx = tiles.indexOf(0);
            if (!canMoveMiniGameTile(emptyIdx, tileIdx, 5)) return;

            [tiles[emptyIdx], tiles[tileIdx]] = [tiles[tileIdx], tiles[emptyIdx]];

            const updates = { miniGameTiles: tiles };
            if (isMiniGameSolved(tiles, 5)) {
                const codeWord = pickRandomMiniGameCodeWord();
                let ticket = '';
                if (cell.isInkChallenge && myInkChallenge?.selectedOption === 1) {
                    ticket = myInkChallenge.pendingTicket || '';
                    await db.ref(`whitelist/${currentUserId}/ink_challenge`).update({ isResolved: true, selectedOptionLabel: inkChallengeOptions[0] });
                } else {
                    const awarded = await claimSequentialTickets(1);
                    ticket = awarded?.[0] || '';
                    if (!ticket) return alert(`Лимит билетиков (${MAX_TICKETS}) уже достигнут в этой игре.`);
                }
                updates.miniGameWon = true;
                updates.miniGameCodeWord = codeWord;
                updates.ticket = ticket;
                await postNews(`🎮 ${players[cell.owner].n} собрал(а) пятнашки 5×5 и получил(а) билет №${ticket || '—'}!`);
            }

            await cellRef.update(updates);
            const updated = await cellRef.once('value');
            showCell(cellIdx, updated.val());
        }

        function buildMiniGameMarkup(cellIdx, cell, isOwner) {
            const tiles = Array.isArray(cell.miniGameTiles) && cell.miniGameTiles.length === 25
                ? cell.miniGameTiles
                : createShuffledMiniGameTiles(5);

            const tileButtons = tiles.map((value, idx) => {
                if (value === 0) {
                    return `<div style="aspect-ratio:1/1; border:1px dashed #80deea; border-radius:8px; background:#b2ebf2;"></div>`;
                }

                const emptyIdx = tiles.indexOf(0);
                const movable = canMoveMiniGameTile(emptyIdx, idx, 5);
                const commonStyle = `aspect-ratio:1/1; border-radius:8px; font-weight:bold; font-size:15px;`;
                if (!isOwner || cell.miniGameWon || cell.miniGameFailed || !movable) {
                    return `<div style="${commonStyle} display:flex; align-items:center; justify-content:center; border:1px solid #4dd0e1; background:#e0f7fa; color:#006064;">${value}</div>`;
                }

                return `<button onclick="moveMiniGameTile(${cellIdx}, ${idx})" style="${commonStyle} border:1px solid #00acc1; background:white; color:#006064;">${value}</button>`;
            }).join('');

            const winText = cell.miniGameWon
                ? `<div style="font-size:14px; font-weight:bold; color:#2e7d32; margin-top:10px;">Вау! А ты не промах! Вот кодовое слово: <span style="background:#fff; border:1px solid #80cbc4; border-radius:8px; padding:3px 8px;">${cell.miniGameCodeWord || pickRandomMiniGameCodeWord()}</span></div><div style="font-size:12px; color:#006064; margin-top:6px;">🎟 Билет: <b>${cell.ticket || '—'}</b></div>`
                : (cell.miniGameFailed
                    ? `<div style="font-size:13px; color:#c62828; font-weight:bold; margin-top:10px;">Ой, кажется, кому то надо чаще играть в пятнашки!</div><div style="font-size:12px; color:#607d8b; margin-top:6px;">Раунд завершён. Теперь можно закрыть окошко и ждать следующий раунд, чтобы снова бросить кубик.</div>`
                    : `<div style="font-size:12px; color:#006064; margin-top:10px;">Собери пятнашки 5×5: расставь числа от 1 до 24 по порядку. Билет выдаётся только за успешную сборку до конца раунда.</div>`);

            return `
                <div style="margin-top:12px; padding:12px; border:2px solid #00acc1; border-radius:10px; background:#e0f7fa; text-align:left;">
                    <div style="font-weight:bold; color:#006064; margin-bottom:8px;">🎮 Мини-игра: пятнашки 5×5</div>
                    <div style="display:grid; grid-template-columns:repeat(5, 1fr); gap:6px;">${tileButtons}</div>
                    ${winText}
                </div>`;
        }

        async function init() {
            try {
                refreshTelegramContext();
                const res = await fetch(JSON_URL);
                tasks = await res.json();
                await initializeTelegramSeasonUser();
                if (typeof syncSeasonProfile === 'function') syncSeasonProfile();
                window.setupEpicPaintCanvas?.();
                window.resizeEpicPaintCanvasForPhone?.();
                window.addEventListener('resize', () => window.resizeEpicPaintCanvasForPhone?.());
                window.addEventListener('orientationchange', () => window.resizeEpicPaintCanvasForPhone?.());
                document.getElementById('work-task-select')?.addEventListener('change', refreshUploadStateForSelectedTask);
                checkAccess();
                syncData();
                window.syncGameEvents?.();
                syncWheelSystems();
                window.initMushuEventSystem?.();
                window.subscribeToCalligraphyDuelInvites?.();
                document.getElementById('duel-close-btn')?.addEventListener('click', () => window.closeCalligraphyDuelUI?.());
                db.ref('.info/serverTimeOffset').on('value', snap => {
                    galleryServerOffsetMs = Number(snap.val()) || 0;
                });
                startGalleryRotationCountdown();
                if (typeof window.syncRoundSchedules === 'function') window.syncRoundSchedules();
                setInterval(() => { checkScheduledRounds(); }, 20000);
            } catch(e) { console.error(e); }
        }

        function checkScheduledRounds() {
            if (typeof window.checkScheduledRounds === 'function') {
                return window.checkScheduledRounds();
            }
            return Promise.resolve();
        }

        function playExplosion() {
            const audio = new Audio('https://www.soundjay.com/mechanical/explosion-01.mp3');
            audio.volume = 0.3;
            audio.play().catch(e => console.log("Sound blocked"));
        }

        function playFanfare() {
            const audio = new Audio('https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg');
            audio.volume = 0.35;
            audio.play().catch(e => console.log("Sound blocked"));
        }

        function playFireworksSound() {
            const audio = new Audio('https://actions.google.com/sounds/v1/fireworks/fireworks.ogg');
            audio.volume = 0.6;
            audio.play().catch(() => console.log('Sound blocked'));
        }

        function launchCelebrationFireworks() {
            const overlay = document.getElementById('event-celebration-overlay');
            if (!overlay) return;
            overlay.innerHTML = '';
            const colors = ['#ff1744', '#ffea00', '#00e5ff', '#7c4dff', '#69f0ae', '#ff9100', '#f50057'];

            for (let burst = 0; burst < 8; burst++) {
                const originX = Math.random() * window.innerWidth;
                const originY = 80 + Math.random() * (window.innerHeight * 0.45);
                for (let i = 0; i < 24; i++) {
                    const dot = document.createElement('div');
                    dot.className = 'firework-dot';
                    dot.style.left = `${originX}px`;
                    dot.style.top = `${originY}px`;
                    dot.style.background = colors[Math.floor(Math.random() * colors.length)];
                    const angle = (Math.PI * 2 * i) / 24;
                    const dist = 70 + Math.random() * 140;
                    dot.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
                    dot.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
                    overlay.appendChild(dot);
                }
            }

            setTimeout(() => {
                if (overlay) overlay.innerHTML = '';
            }, 1600);
        }

        function setAuthorizedView(isAuthorized) {
            const gameUi = document.getElementById('game-ui');
            const unauthorizedScreen = document.getElementById('unauthorized-screen');
            if (!gameUi || !unauthorizedScreen) return;
            gameUi.style.display = isAuthorized ? 'block' : 'none';
            unauthorizedScreen.style.display = isAuthorized ? 'none' : 'block';
        }


        // Механики предметов (инвентарь, активация и выдача эффектов) берутся из встроенного блока items.js в этом же файле.


        async function chooseInkChallengeOption(cellIdx, optionNumber) {
            const challengeSnap = await db.ref(`whitelist/${currentUserId}/ink_challenge`).once('value');
            const challenge = challengeSnap.val();
            if (!challenge || challenge.round !== currentRoundNum || challenge.isResolved) return alert('Клякса для текущего раунда не активна.');
            if (![1,2,3,4].includes(optionNumber)) return;
            if (challenge.selectedOption) return alert('Усложнение уже выбрано.');

            const optionLabel = inkChallengeOptions[optionNumber - 1] || '';
            await db.ref(`whitelist/${currentUserId}/ink_challenge`).update({
                draftOption: optionNumber,
                draftOptionLabel: optionLabel,
                draftUpdatedAt: Date.now()
            });
            alert(`Вариант №${optionNumber} выбран. Теперь нажми «Утвердить выбор».`);
            const updated = await db.ref(`board/${cellIdx}`).once('value');
            showCell(cellIdx, updated.val());
        }

        async function confirmInkChallengeOption(cellIdx) {
            const challengeSnap = await db.ref(`whitelist/${currentUserId}/ink_challenge`).once('value');
            const challenge = challengeSnap.val();
            if (!challenge || challenge.round !== currentRoundNum || challenge.isResolved) return alert('Клякса для текущего раунда не активна.');
            if (challenge.selectedOption) return alert('Усложнение уже утверждено.');
            const optionNumber = Number(challenge.draftOption);
            if (![1,2,3,4].includes(optionNumber)) return alert('Сначала выбери вариант из списка.');

            const patch = {
                selectedOption: optionNumber,
                selectedOptionLabel: inkChallengeOptions[optionNumber - 1],
                selectedAt: Date.now(),
                updatedAt: Date.now(),
                draftOption: null,
                draftOptionLabel: null
            };
            if (optionNumber === 4) patch.optionDeadline = Date.now() + 24 * 60 * 60 * 1000;
            await db.ref(`whitelist/${currentUserId}/ink_challenge`).update(patch);
            await db.ref(`board/${cellIdx}/inkOption`).set(optionNumber);
            await db.ref(`board/${cellIdx}/inkOptionLabel`).set(inkChallengeOptions[optionNumber - 1]);

            if (optionNumber === 2 || optionNumber === 3) {
                await db.ref(`board/${cellIdx}/ticket`).set(challenge.pendingTicket || '');
                await db.ref(`whitelist/${currentUserId}/ink_challenge/isResolved`).set(true);
            }

            alert(optionNumber === 4 ? 'Выбор утверждён. Таймер на 24 часа запущен во вкладке сдачи работ.' : 'Выбор утверждён. Усложнение закреплено.');
            const updated = await db.ref(`board/${cellIdx}`).once('value');
            showCell(cellIdx, updated.val());
        }

        async function checkInkDeadline() {
            if (!myInkChallenge || myInkChallenge.round !== currentRoundNum) return;
            if (myInkChallenge.selectedOption !== 4 || myInkChallenge.isResolved) return;
            if ((myInkChallenge.optionDeadline || 0) > Date.now()) return;

            await db.ref(`whitelist/${currentUserId}/ink_challenge`).update({
                isResolved: true,
                failed: true,
                failedReason: 'deadline'
            });
            if (Number.isInteger(myInkChallenge.cellIdx)) {
                await db.ref(`board/${myInkChallenge.cellIdx}/ticket`).set('');
            }
            alert('⏰ 24 часа на кляксу истекли. Билетик за это задание не начислен.');
        }


        
        
        
        
        
        
        
        
        

        function getLatestSubmissionForCell(roundNum, cellIdx, userId = currentUserId) {
            const filtered = allSubmissions
                .filter(item => String(item.userId || '') === String(userId || '')
                    && Number(item.round) === Number(roundNum)
                    && Number(item.cellIdx) === Number(cellIdx))
                .sort((a, b) => (Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0)));
            return filtered[0] || null;
        }

        function refreshUploadStateForSelectedTask() {
            const select = document.getElementById('work-task-select');
            const submitBtn = document.getElementById('work-submit-btn');
            const statusEl = document.getElementById('work-upload-status');
            const beforeInput = document.getElementById('work-image-before-input');
            const afterInput = document.getElementById('work-image-after-input');
            const beforeLabel = document.getElementById('work-before-label');
            const afterLabel = document.getElementById('work-after-label');
            if (!select || !submitBtn || !statusEl) return;

            const setUploadVisibility = (visible) => {
                [beforeInput, afterInput, beforeLabel, afterLabel, submitBtn].forEach(el => {
                    if (!el) return;
                    el.style.display = visible ? '' : 'none';
                });
            };

            if (select.disabled || !select.value) {
                submitBtn.disabled = true;
                setUploadVisibility(true);
                statusEl.innerText = 'Сначала выбери клетку с заданием.';
                statusEl.style.color = '#6a1b9a';
                return;
            }

            const cellIdx = Number(select.value);
            const myCell = allTicketsData.find(t => Number(t.cellIdx) === cellIdx && (Number(t.userId) === Number(currentUserId) || Number(t.owner) === Number(myIndex)));
            const latest = getLatestSubmissionForCell(myCell?.round, cellIdx);

            if (!latest) {
                submitBtn.disabled = false;
                setUploadVisibility(true);
                statusEl.innerText = 'Можно загрузить работу по выбранной клетке.';
                statusEl.style.color = '#2e7d32';
                return;
            }

            if (latest.status === 'pending') {
                submitBtn.disabled = true;
                setUploadVisibility(false);
                statusEl.innerText = 'Работа на проверке';
                statusEl.style.color = '#6a1b9a';
                return;
            }

            if (latest.status === 'accepted') {
                submitBtn.disabled = true;
                setUploadVisibility(false);
                statusEl.innerText = '✅ Принято';
                statusEl.style.color = '#2e7d32';
                return;
            }

            if (latest.status === 'rejected') {
                submitBtn.disabled = false;
                setUploadVisibility(true);
                const reason = latest.reviewComment || latest.rejectReason || latest.adminComment || latest.reviewNote || '';
                statusEl.innerText = reason ? `❌ Не принято: ${reason}` : '❌ Не принято. Можно загрузить заново.';
                statusEl.style.color = '#b71c1c';
                return;
            }

            submitBtn.disabled = false;
            setUploadVisibility(true);
            statusEl.innerText = 'Можно загрузить работу по выбранной клетке.';
            statusEl.style.color = '#2e7d32';
        }

        
        
        
        
        
        
        
        async function chooseWandBlessingOption(cellIdx, optionNum) {
            if (![1,2,3].includes(optionNum)) return;
            const blessingSnap = await db.ref(`whitelist/${currentUserId}/wand_blessing`).once('value');
            const blessing = blessingSnap.val();
            if (!blessing || blessing.round !== currentRoundNum || blessing.isResolved) return alert('Эта магия уже недоступна.');
            if (blessing.selectedOption) return alert('Вариант уже утверждён.');

            const optionLabel = wandBlessingTasks[optionNum - 1] || '';
            await db.ref(`whitelist/${currentUserId}/wand_blessing`).update({
                draftOption: optionNum,
                draftOptionLabel: optionLabel,
                draftUpdatedAt: Date.now()
            });
            alert(`Вариант №${optionNum} выбран. Теперь нажми «Утвердить выбор».`);
            const updated = await db.ref(`board/${cellIdx}`).once('value');
            showCell(cellIdx, updated.val());
        }

        async function confirmWandBlessingOption(cellIdx) {
            const blessingSnap = await db.ref(`whitelist/${currentUserId}/wand_blessing`).once('value');
            const blessing = blessingSnap.val();
            if (!blessing || blessing.round !== currentRoundNum || blessing.isResolved) return alert('Эта магия уже недоступна.');
            if (blessing.selectedOption) return alert('Вариант уже утверждён.');
            const optionNum = Number(blessing.draftOption);
            if (![1,2,3].includes(optionNum)) return alert('Сначала выбери вариант из списка.');

            const updates = {
                selectedOption: optionNum,
                selectedOptionLabel: wandBlessingTasks[optionNum - 1],
                selectedAt: Date.now(),
                isResolved: true,
                draftOption: null,
                draftOptionLabel: null
            };
            await db.ref(`whitelist/${currentUserId}/wand_blessing`).update(updates);
            await db.ref(`board/${cellIdx}`).update({
                ticket: blessing.pendingTicket || '',
                wandOptionLabel: wandBlessingTasks[optionNum - 1]
            });

            if (optionNum === 3) {
                await addInventoryItem('goldenPollen', 1);
                alert('🎇 Ты получил(а) предмет "Золотая пыльца" в рюкзачок. Использовать можно один раз за игру.');
            }
            alert('Выбор утверждён! Добрая фея помогла тебе: теперь рисуй и загружай работу.');
            const updated = await db.ref(`board/${cellIdx}`).once('value');
            showCell(cellIdx, updated.val());
        }

        async function surrenderCell(cellIdx) {
            const cellSnap = await db.ref(`board/${cellIdx}`).once('value');
            const cell = cellSnap.val();
            if (!cell || cell.userId !== currentUserId) return alert('Сдаться можно только в своём задании.');
            if (cell.excluded) return alert('Ты уже сдался(ась) в этой клетке.');

            const roundSnap = await db.ref('current_round').once('value');
            const roundData = roundSnap.val() || {};
            const totalRounds = Math.max(1, Number(roundData.totalRounds || roundData.plannedRounds || roundData.number || currentRoundNum || 1));
            const surrenderLimit = Math.max(1, Math.floor(totalRounds / 3));

            const boardSnap = await db.ref('board').once('value');
            const board = boardSnap.val() || {};
            const usedSurrenders = Object.values(board)
                .filter(Boolean)
                .filter(c => c.userId === currentUserId && c.excluded)
                .length;

            if (usedSurrenders >= surrenderLimit) {
                const confirmedExit = await askForcedSurrenderExit();
                if (!confirmedExit) return;

                await db.ref(`board/${cellIdx}`).update({ excluded: true, ticket: '' });
                await db.ref(`whitelist/${currentUserId}`).update({
                    isEliminated: true,
                    eliminatedAtRound: currentRoundNum,
                    eliminatedAt: Date.now(),
                    eliminationReason: 'forced_surrender'
                });
                if (cell.isInkChallenge) {
                    await db.ref(`whitelist/${currentUserId}/ink_challenge`).update({ isResolved: true, surrendered: true });
                }
                if (cell.isWandBlessing) {
                    await db.ref(`whitelist/${currentUserId}/wand_blessing`).update({ isResolved: true, surrendered: true });
                }

                await postNews(`${players[myIndex].n} выбыл(а) из игры`);
                alert('Ты покидаешь игру. Билет за текущий раунд не начислен, но ранее полученные билетики сохранены.');
                const updated = await db.ref(`board/${cellIdx}`).once('value');
                showCell(cellIdx, updated.val());
                return;
            }

            if (!confirm('Сдаёшься в этом задании?')) return;
            if (!confirm('Точно-точно?')) return;

            await db.ref(`board/${cellIdx}`).update({ excluded: true, ticket: '' });
            if (cell.isInkChallenge) {
                await db.ref(`whitelist/${currentUserId}/ink_challenge`).update({ isResolved: true, surrendered: true });
            }
            if (cell.isWandBlessing) {
                await db.ref(`whitelist/${currentUserId}/wand_blessing`).update({ isResolved: true, surrendered: true });
            }
            await postNews(`🏳️ ${players[myIndex].n} сдал(а) задание в клетке №${cellIdx + 1} и пропускает билетик за раунд.`);
            alert('Окей, в этом раунде билетик за это задание не засчитан. Жди следующий раунд!');
            const updated = await db.ref(`board/${cellIdx}`).once('value');
            showCell(cellIdx, updated.val());
        }

        async function activateCloak(cellIdx) {
            try {
                await waitForDbReady();
                const userPathId = String(currentUserPathId || currentUserId || '').trim();
                if (!userPathId) return alert('Сначала войдите в игру, затем попробуйте снова.');

                const cellSnap = await db.ref(`board/${cellIdx}`).once('value');
                const cell = cellSnap.val();
                if (!cell || String(cell.userId || '') !== userPathId) return alert('Плащ можно надеть только в своей карточке задания.');
                if (cell.excluded) return alert('Для сданной клетки плащ недоступен.');
                if (window.inventoryCount?.('cloak') <= 0) return alert('В рюкзаке нет Плаща-невидимки.');
                if (cell.isMagic || cell.isWordSketch || cell.isMagnet || cell.isGold || cell.isInkChallenge || cell.isWandBlessing) {
                    return alert('Плащ нельзя надеть на эту механику. Выберите другое задание.');
                }
                const debtSnap = await db.ref(`whitelist/${userPathId}/debt`).once('value');
                if (debtSnap.val()?.active) {
                    return alert('Плащ уже активирован: сначала закройте текущий долг по заданиям.');
                }

                const consumed = await window.consumeInventoryItem?.('cloak', 1);
                if (!consumed) return alert('Плащ уже израсходован.');

                const roundNum = Number(currentRoundNum) || 0;
                const debt = { cellIdx: Number(cellIdx), round: roundNum, dueRound: roundNum + 1, active: true, acceptedRounds: {} };
                const now = Date.now();
                await db.ref().update({
                    [`board/${cellIdx}/deferred`]: true,
                    [`board/${cellIdx}/deferredAt`]: now,
                    [`board/${cellIdx}/deferredRound`]: roundNum,
                    [`board/${cellIdx}/invisibleMode`]: true,
                    [`whitelist/${userPathId}/debt`]: debt
                });

                alert('🎭 Вы скрылись под плащом. Теперь вы обязаны сдать ЭТО задание и СЛЕДУЮЩЕЕ до конца следующего раунда, иначе сгорят оба билета');
                const playerName = players?.[myIndex]?.n || 'Игрок';
                try {
                    await postNews(`🎭 ${playerName} активировал(а) Плащ-невидимку и отложил(а) задание до следующего раунда.`);
                } catch (newsError) {
                    console.warn('activateCloak news publish failed', newsError);
                }
                try {
                    const updated = await db.ref(`board/${cellIdx}`).once('value');
                    showCell(cellIdx, updated.val());
                } catch (renderError) {
                    console.warn('activateCloak ui refresh failed', renderError);
                }
            } catch (e) {
                console.error('activateCloak failed', e);
                alert('Не удалось надеть плащ. Обновите страницу и попробуйте ещё раз.');
            }
        }

        function askForcedSurrenderExit() {
            return new Promise(resolve => {
                const existing = document.getElementById('forced-surrender-dialog');
                if (existing) existing.remove();

                const dialog = document.createElement('div');
                dialog.id = 'forced-surrender-dialog';
                dialog.style.position = 'fixed';
                dialog.style.inset = '0';
                dialog.style.background = 'rgba(0,0,0,0.45)';
                dialog.style.display = 'flex';
                dialog.style.alignItems = 'center';
                dialog.style.justifyContent = 'center';
                dialog.style.zIndex = '2200';
                dialog.innerHTML = `
                    <div style="width:90%; max-width:420px; background:#fff; border-radius:16px; padding:16px; box-shadow:0 8px 28px rgba(0,0,0,0.25); text-align:center;">
                        <div style="font-size:16px; font-weight:700; margin-bottom:12px; color:#212121;">Точно хочешь сдаться? После подтверждения ты покинешь игру</div>
                        <div style="display:flex; flex-direction:column; gap:8px;">
                            <button id="forced-surrender-yes" class="admin-btn" style="margin:0; background:#d32f2f;">Да, сдаюсь</button>
                            <button id="forced-surrender-no" class="admin-btn" style="margin:0; background:#757575;">Нет, останусь</button>
                        </div>
                    </div>
                `;

                const cleanup = result => {
                    dialog.remove();
                    resolve(result);
                };

                dialog.addEventListener('click', e => {
                    if (e.target === dialog) cleanup(false);
                });
                document.body.appendChild(dialog);
                document.getElementById('forced-surrender-yes').onclick = () => cleanup(true);
                document.getElementById('forced-surrender-no').onclick = () => cleanup(false);
            });
        }

       

        function toggleNewsPanel() {
            toggleExpandablePanel('news-list', 'news-toggle-btn');
        }


        function renderNewsFeed() {
            const preview = document.getElementById('news-preview');
            const list = document.getElementById('news-list');
            if (!preview || !list) return;
            if (!newsFeedItems.length) {
                preview.innerText = 'Пока новостей нет — откройте первую клетку! ✨';
                list.innerHTML = '';
                return;
            }
            const latest = newsFeedItems[0];
            preview.innerText = latest.text || 'Новость';
            list.innerHTML = newsFeedItems.slice(0, 40).map((item, idx) => `<div class="news-item">${idx + 1}. ${item.text || ''}</div>`).join('');
        }

        async function postNews(text) {
            const msg = String(text || '').trim();
            if (!msg) return;
            await db.ref('news_feed').push({ text: msg, createdAt: Date.now() });
        }
        window.postNews = postNews;

        function getKarmaVisualByPoints(points) {
            const p = Number(points) || 0;
            if (p <= 20) return { border: '#b0bec5', glow: 'rgba(176,190,197,0.55)' };
            if (p <= 40) return { border: '#4db6ac', glow: 'rgba(77,182,172,0.55)' };
            if (p <= 60) return { border: '#ab47bc', glow: 'rgba(171,71,188,0.55)' };
            if (p <= 85) return { border: '#5c6bc0', glow: 'rgba(92,107,192,0.6)' };
            return { border: '#fbc02d', glow: 'rgba(251,192,45,0.65)' };
        }

        function toggleAdminEmergencyActions() {
            if (!isAdminUser()) return;
            toggleExpandablePanel('admin-emergency-body', 'admin-emergency-toggle-btn');
        }

        function itemNameByKey(itemKey) {
            return itemTypes?.[itemKey]?.name || ({ cloak: 'Плащ-невидимка', magnifier: 'Лупа', goldenPollen: 'Золотая пыльца' }[itemKey] || itemKey);
        }

        async function adminSetPlayerItem(targetUserId, itemKey, addMode) {
            if (Number(currentUserId) !== Number(ADMIN_ID)) return alert('Только администратор может управлять предметами.');
            if (!targetUserId || !itemKey) return;
            if (!INVENTORY_ITEM_KEYS.includes(itemKey) || !itemTypes?.[itemKey]) return alert('Такого предмета не существует в игре.');
            const invRef = db.ref(`whitelist/${targetUserId}/inventory/${itemKey}`);
            if (addMode) {
                await invRef.transaction(v => (Number(v) || 0) + 1);
                alert(`Предмет ${itemNameByKey(itemKey)} успешно передан игроку ${targetUserId}`);
                await db.ref(`system_notifications/${targetUserId}`).push({
                    text: `✨ Волшебство! Админ передал вам предмет: ${itemNameByKey(itemKey)}`,
                    createdAt: Date.now(),
                    type: 'item_granted',
                    itemKey,
                    by: currentUserId
                });
            } else {
                await invRef.transaction(v => Math.max(0, (Number(v) || 0) - 1));
                alert(`Предмет ${itemNameByKey(itemKey)} изъят у игрока ${targetUserId}`);
            }
            await renderAdminItemsPlayersList();
        }

        function getAdminItemOptions() {
            return ['cloak', 'magnifier', 'goldenPollen', 'magicWand']
                .filter(k => itemTypes?.[k])
                .map(k => ({ key: k, label: `${itemTypes[k].emoji || '🎁'} ${itemTypes[k].name || k}` }));
        }

        function fillAdminItemsFormDefaults() {
            const select = document.getElementById('admin-items-item');
            if (!select) return;
            const options = getAdminItemOptions();
            select.innerHTML = options.map(o => `<option value="${o.key}">${o.label}</option>`).join('');
        }

        async function adminApplyItemAction() {
            if (Number(currentUserId) !== Number(ADMIN_ID)) return;
            const targetUserId = String(document.getElementById('admin-items-user-id')?.value || '').trim();
            const action = String(document.getElementById('admin-items-action')?.value || 'grant');
            const itemKey = String(document.getElementById('admin-items-item')?.value || '').trim();
            if (!/^\d+$/.test(targetUserId)) return alert('Укажи корректный айди игрока.');
            if (!itemKey) return alert('Выбери предмет.');
            await adminSetPlayerItem(targetUserId, itemKey, action === 'grant');
        }

        function renderInventoryIcons(inv = {}) {
            const keys = ['cloak', 'magnifier', 'goldenPollen'];
            const chips = keys.filter(k => Number(inv[k] || 0) > 0).map(k => `${itemTypes?.[k]?.emoji || '🎁'}x${Number(inv[k] || 0)}`);
            return chips.length ? chips.join(' ') : 'Пусто';
        }

        async function renderAdminItemsPlayersList() {
            if (Number(currentUserId) !== Number(ADMIN_ID)) return;
            const wrap = document.getElementById('admin-items-player-list');
            if (!wrap) return;
            const snap = await db.ref('whitelist').once('value');
            const rows = [];
            snap.forEach(s => {
                const v = s.val() || {};
                if (!v.charIndex && v.charIndex !== 0) return;
                rows.push({ uid: s.key, name: players[v.charIndex]?.n || `ID ${s.key}`, inv: v.inventory || {} });
            });
            rows.sort((a,b)=>a.name.localeCompare(b.name,'ru'));
            wrap.innerHTML = rows.map(r => `<div style="border:1px solid #e3f2fd; border-radius:10px; background:#fff; padding:8px; margin-bottom:6px;">
                <div><b>${r.name}</b> · ID: ${r.uid}</div>
                <div style="font-size:12px; color:#555; margin:5px 0;">Инвентарь: ${renderInventoryIcons(r.inv)}</div>
                <div style="display:flex; gap:6px;">
                    <button onclick="document.getElementById('admin-items-user-id').value='${r.uid}'; document.getElementById('admin-items-action').value='grant';" class="admin-btn" style="margin:0; flex:1; background:#00897b;">🎁 Выдать</button>
                    <button onclick="document.getElementById('admin-items-user-id').value='${r.uid}'; document.getElementById('admin-items-action').value='revoke';" class="admin-btn" style="margin:0; flex:1; background:#c62828;">🗑️ Изъять</button>
                </div>
            </div>`).join('') || '<div style="font-size:12px;color:#777;">Игроки не найдены.</div>';
        }

        function toggleEmergencySection(sectionName) {
            if (!isAdminUser()) return;
            const map = {
                grant: 'admin-emergency-grant-body',
                revoke: 'admin-emergency-revoke-body',
                rename: 'admin-emergency-rename-body',
                teleport: 'admin-emergency-teleport-body',
                items: 'admin-emergency-items-body',
                archive: 'admin-emergency-archive-body',
                karma: 'admin-emergency-karma-body',
                resetEvents: 'admin-emergency-reset-events-body'
            };
            const targetId = map[sectionName];
            if (!targetId) return;
            const body = document.getElementById(targetId);
            if (!body) return;
            body.classList.toggle('expanded');
            body.style.maxHeight = body.classList.contains('expanded') ? '65vh' : '0';
            body.style.overflowY = 'auto';
            if (sectionName === 'items' && body.classList.contains('expanded')) {
                fillAdminItemsFormDefaults?.();
                renderAdminItemsPlayersList?.().catch(() => {});
            }
            if (sectionName === 'karma' && body.classList.contains('expanded')) {
                adminRenderKarmaSearchResults?.();
            }
        }

        function toggleExpandablePanel(listId, btnId) {
            const list = document.getElementById(listId);
            const btn = document.getElementById(btnId);
            if (!list || !btn) return;
            const isExpanded = list.classList.toggle('expanded');
            if (listId === 'admin-emergency-body') {
                list.style.maxHeight = isExpanded ? '72vh' : '0';
                list.style.overflowY = 'auto';
            }
            btn.innerText = isExpanded ? 'Свернуть' : 'Развернуть';
        }

        
        

        // Epic Paint / Wall Battle runtime moved to epic_paint.js (single source of truth).


        // Механики билетов (выдача, хранение, таблица) вынесены в Tickets.js.

        async function handleMiniGameRoundFailure() {
            if (myIndex === -1) return;
            if (window.miniGameRoundFailChecked === currentRoundNum) return;

            const snap = await db.ref('board').once('value');
            const board = snap.val() || {};
            let failedCellIdx = -1;

            for (let i = 0; i < 50; i++) {
                const cell = board[i];
                if (!cell) continue;
                if (cell.userId !== currentUserId) continue;
                if (cell.round !== currentRoundNum) continue;
                if (!cell.isMiniGame) continue;
                if (cell.miniGameWon) continue;
                failedCellIdx = i;
                break;
            }

            if (failedCellIdx !== -1) {
                await db.ref(`board/${failedCellIdx}`).update({
                    miniGameFailed: true,
                    ticket: ''
                });
                alert('Ой, кажется, кому то надо чаще играть в пятнашки!');
            }

            window.miniGameRoundFailChecked = currentRoundNum;
        }


        function getMagnetSourceCandidates(boardData) {
            const cells = Object.values(boardData || {}).filter(Boolean);
            return cells.filter(c => !c.isMagic)
                .filter(c => c.userId !== currentUserId)
                .filter(c => {
                    const user = (window.cachedWhitelistData || {})[c.userId] || (window.cachedWhitelistData || {})[String(c.userId)] || {};
                    return !user.isEliminated && !user.isParticipationBlocked;
                })
                                .filter(c => {
                    if (c.isTrap || c.isGold || c.isMiniGame || c.isInkChallenge || c.isWandBlessing || c.isMagnet) return true;
                    if (c.itemType) return true;
                    return Number.isInteger(c.taskIdx) && c.taskIdx >= 0;
                });
        }

        function updateTimerDisplay() {
            if (window.timerInt) clearInterval(window.timerInt);
            const btn = document.getElementById('dice-btn');

            const renderDice = () => {
                const statusLabel = document.getElementById('duel-status-label');
                const rollBtn = document.getElementById('roll-button') || btn;
                const statusTextNode = document.getElementById('duel-status-text');
                const statusTimerNode = document.getElementById('duel-status-timer');
                const statusOkBtn = document.getElementById('duel-status-ok');
                const hasUndismissedOutgoingNotice = !!statusOkBtn && statusOkBtn.style.display !== 'none';
                const hasPendingOutgoingDuel = activeDuels.some((duel) => {
                    if (!duel || typeof duel !== 'object') return false;
                    return String(duel.challengerId || '') === String(currentUserId) && String(duel.status || '') === 'pending';
                });
                const pendingOutgoingDuel = activeDuels.find((duel) => {
                    if (!duel || typeof duel !== 'object') return false;
                    return String(duel.challengerId || '') === String(currentUserId) && String(duel.status || '') === 'pending';
                });
                if (hasPendingOutgoingDuel) {
                    const expiresAt = Number(pendingOutgoingDuel?.expiresAt || 0);
                    const msLeft = Math.max(0, expiresAt - getServerNowMs());
                    const mm = String(Math.floor(msLeft / 60000)).padStart(2, '0');
                    const ss = String(Math.floor((msLeft % 60000) / 1000)).padStart(2, '0');
                    if (!hasUndismissedOutgoingNotice) {
                        if (statusTextNode) statusTextNode.textContent = 'Вы бросили вызов! Ждём ответа соперника';
                        if (statusTimerNode) statusTimerNode.textContent = `⏳ ${mm}:${ss} до авто-отмены`;
                        if (statusOkBtn) statusOkBtn.style.display = 'none';
                    }
                    if (statusLabel) statusLabel.style.display = 'block';
                    if (rollBtn) rollBtn.disabled = true;
                    return true;
                }
                if (statusLabel) statusLabel.style.display = 'none';
                return false;
            };



            async function renderAdminSnakeOverview(force = false) {
                if (!window.snakeAdminOverview || typeof window.snakeAdminOverview.render !== 'function') return;
                adminSnakeOverviewState = await window.snakeAdminOverview.render({
                    db,
                    currentUserId,
                    adminId: ADMIN_ID,
                    players,
                    activeTabId: document.querySelector('.tab-content.tab-active')?.id || '',
                    cacheState: adminSnakeOverviewState,
                    force
                });
            }

            let snakeUiApi = null;

            function ensureSnakeUiApi() {
                if (snakeUiApi) return snakeUiApi;
                if (!window.snakeUi || typeof window.snakeUi.create !== 'function') return null;
                snakeUiApi = window.snakeUi.create({
                    db,
                    adminId: ADMIN_ID,
                    getCurrentUserId: () => currentUserId,
                    getCurrentFieldMode: () => currentFieldMode,
                    getCurrentRoundNum: () => currentRoundNum
                });
                return snakeUiApi;
            }

            function hideSnakeStatusBlock() {
                ensureSnakeUiApi()?.hideSnakeStatusBlock();
            }

            async function renderSnakeStatusBlock(userState) {
                return ensureSnakeUiApi()?.renderSnakeStatusBlock(userState);
            }

            window.timerInt = setInterval(async () => {
                const duelLockActive = renderDice();
                await checkInkDeadline();
                await window.activateScheduledEventIfNeeded?.();
                await window.failExpiredEventIfNeeded?.();
                await maybeActivateScheduledDraw();
                await maybeFinalizeScheduledDraw();
                if (!window.lastSubmissionDeadlineCheckAt || Date.now() - window.lastSubmissionDeadlineCheckAt > 60000) {
                    window.lastSubmissionDeadlineCheckAt = Date.now();
                    await checkSubmissionRoundDeadlines();
                }
                const diff = roundEndTime - Date.now();
                if (diff <= 0) {
                    document.getElementById('round-timer').innerText = "РАУНД ЗАВЕРШЕН";
                    btn.disabled = true;
                    btn.innerText = "⏳ Раунд завершен";
                    hideSnakeStatusBlock();
                    if (Number(currentRoundNum) > 0 && lastRoundEndNewsRound !== Number(currentRoundNum)) {
                        lastRoundEndNewsRound = Number(currentRoundNum);
                        await postNews(`Раунд #${currentRoundNum} завершён`);
                    }
                    await handleMiniGameRoundFailure();
                    return;
                }

                const d = Math.floor(diff / 86400000);
                const h = Math.floor((diff % 86400000) / 3600000);
                const m = Math.floor((diff % 3600000) / 60000);
                const s = Math.floor((diff % 60000) / 1000);
                document.getElementById('round-timer').innerText = `${d}д ${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;

                if (myIndex === -1) {
                    btn.disabled = true;
                    btn.innerText = "🔒 Нет доступа";
                    hideSnakeStatusBlock();
                    return;
                }

                if (Number(currentUserId) === Number(ADMIN_ID)) {
                    btn.disabled = true;
                    btn.innerText = "👀 Режим наблюдателя";
                    hideSnakeStatusBlock();
                    await renderAdminSnakeOverview();
                    window.updateEventUiState?.();
                    return;
                }

                const userStateSnap = await db.ref(`whitelist/${currentUserId}`).once('value');
                const userState = userStateSnap.val() || {};
                if (userState.isEliminated) {
                    myRoundHasMove = true;
                    btn.disabled = true;
                    btn.innerText = "🚫 Ты выбыл(а) из игры";
                    hideSnakeStatusBlock();
                    const adminOverview = document.getElementById('admin-snake-overview');
                    if (adminOverview) adminOverview.style.display = 'none';
                    window.updateEventUiState?.();
                    return;
                }

                myRoundHasMove = (userState.last_round === currentRoundNum);
                btn.disabled = myRoundHasMove;
                btn.innerText = btn.disabled ? "🎲 Ход сделан" : "🎲 Бросить кубик";
                if (String(currentFieldMode || 'cells') === 'snake') {
                    const snakeState = userState.snakeState || {};
                    if (snakeState.lockedBySphinx) {
                        btn.disabled = true;
                        btn.innerText = '🗿 Испытание Сфинкса: ожидается одобрение';
                    }
                    const sheddingActive = !!snakeState.sheddingActive && !snakeState.sheddingReleasedAt;
                    const endsAt = Number(snakeState.sheddingEndsAt || snakeState.sheddingLockUntil || 0);
                    if (sheddingActive && (!endsAt || endsAt > Date.now())) {
                        const leftMs = Math.max(0, endsAt - Date.now());
                        const leftMin = Math.ceil(leftMs / 60000);
                        btn.disabled = true;
                        btn.innerText = `🧬 Сброс кожи: ~${leftMin} мин`;
                    }
                }
                if (duelLockActive) {
                    btn.disabled = true;
                }
                await renderSnakeStatusBlock(userState);
                window.updateEventUiState?.();
            }, 1000);
        }

        async function expireStaleMagicLinksForRound(roundNum, reason = 'manual_check') {
            if (!Number.isInteger(roundNum) || roundNum <= 0) return;
            const linksSnap = await db.ref(`magic_links/${roundNum}`).once('value');
            if (!linksSnap.exists()) return;
            const boardSnap = await db.ref('board').once('value');
            const board = boardSnap.val() || {};
            const now = Date.now();
            const updates = {};
            const expiredNames = [];

            linksSnap.forEach(linkSnap => {
                const link = linkSnap.val() || {};
                if (link.status !== 'waiting_for_partner') return;
                const waitingSince = Number(link.waitingSince || link.createdAt || 0);
                if (!waitingSince || (now - waitingSince) < MAGIC_LINK_WAIT_WINDOW_MS) return;
                updates[`magic_links/${roundNum}/${linkSnap.key}/status`] = 'expired_single';
                updates[`magic_links/${roundNum}/${linkSnap.key}/expiredAt`] = now;
                updates[`magic_links/${roundNum}/${linkSnap.key}/resolvedBy`] = reason;
                updates[`magic_links/${roundNum}/${linkSnap.key}/timeoutHandledAt`] = now;
                updates[`magic_links/${roundNum}/${linkSnap.key}/soloFallbackNotice`] = 'Очень жаль, но мы не нашли тебе напарника';

                const boardEntry = Object.entries(board).find(([_, c]) => c && c.round === roundNum && c.isMagic && String(c.magicLinkId || '') === String(linkSnap.key));
                if (boardEntry) {
                    const [cellIdx, cell] = boardEntry;
                    const fallbackTaskIdx = Number.isInteger(cell.magicSoloTaskIdx) && cell.magicSoloTaskIdx >= 0
                        ? cell.magicSoloTaskIdx
                        : Math.floor(Math.random() * Math.max(1, tasks.length));
                    updates[`board/${cellIdx}/isMagicSolo`] = true;
                    updates[`board/${cellIdx}/taskIdx`] = fallbackTaskIdx;
                    updates[`board/${cellIdx}/magicExpiredAt`] = now;
                }
                if (link.playerA?.name) expiredNames.push(link.playerA.name);
            });

            if (!Object.keys(updates).length) return;
            await db.ref().update(updates);
            if (expiredNames.length) {
                await postNews(`🔮 Магическая связь не нашла пару вовремя: ${expiredNames.join(', ')} выполняет(ют) задание в одиночку.`);
            }
        }

        async function resolveMagicPartnerAfterRoll(roundNum, currentRollUserId, currentRollCharIndex) {
            if (!Number.isInteger(roundNum) || roundNum <= 0) return;
            const linksRef = db.ref(`magic_links/${roundNum}`);
            const linksSnap = await linksRef.once('value');
            if (!linksSnap.exists()) return;

            const waiting = [];
            const now = Date.now();
            linksSnap.forEach(linkSnap => {
                const link = linkSnap.val() || {};
                if (link.status !== 'waiting_for_partner') return;
                const waitingSince = Number(link.waitingSince || link.createdAt || 0);
                if (!waitingSince || (now - waitingSince) >= MAGIC_LINK_WAIT_WINDOW_MS) return;
                if (Number(link.playerA?.userId) === Number(currentRollUserId)) return;
                waiting.push({ key: linkSnap.key, ...link });
            });
            if (!waiting.length) return null;

            waiting.sort((a, b) => Number(a.waitingSince || 0) - Number(b.waitingSince || 0));
            const selected = waiting[0];
            const partnerName = players[currentRollCharIndex]?.n || 'Игрок';
            await linksRef.child(selected.key).update({
                status: 'paired',
                pairedAt: now,
                playerB: { userId: currentRollUserId, charIndex: currentRollCharIndex, name: partnerName },
                playerANotifiedAt: 0,
                playerBNotifiedAt: 0
            });
            const boardSnap = await db.ref('board').once('value');
            const board = boardSnap.val() || {};
            const playerACellEntry = Object.entries(board).find(([_, c]) => c && c.round === roundNum && c.isMagic && String(c.magicLinkId || '') === String(selected.key));
            if (playerACellEntry) {
                const [playerACellIdx] = playerACellEntry;
                await db.ref(`board/${playerACellIdx}`).update({
                    magicLinkActive: true,
                    magicLinkPartnerUserId: String(currentRollUserId),
                    magicLinkPartnerName: partnerName,
                    isMagicSolo: false
                });
            }
            await postNews(`🔮 ${selected.playerA?.name || 'Игрок'} нашёл(ла) магическую пару: ${partnerName}.`);
            return { key: selected.key, playerA: selected.playerA || null, playerB: { userId: currentRollUserId, charIndex: currentRollCharIndex, name: partnerName } };
        }

        let snakeClashApi = null;

        function ensureSnakeClashApi() {
            if (snakeClashApi) return snakeClashApi;
            if (!window.snakeClash || typeof window.snakeClash.create !== 'function') return null;
            snakeClashApi = window.snakeClash.create({
                db,
                tasks,
                players,
                updateKarma,
                postNews,
                getCurrentUserId: () => currentUserId
            });
            return snakeClashApi;
        }

        function getSnakeClashNotificationSeenKey(clashId) {
            return ensureSnakeClashApi()?.getSnakeClashNotificationSeenKey(clashId) || '';
        }

        function getSnakeClashNotificationOnceKey(notification) {
            return ensureSnakeClashApi()?.getSnakeClashNotificationOnceKey(notification) || '';
        }

        function wasSnakeClashNotificationSeen(clashIdOrOnceKey) {
            return !!ensureSnakeClashApi()?.wasSnakeClashNotificationSeen(clashIdOrOnceKey);
        }

        function markSnakeClashNotificationSeen(clashIdOrOnceKey) {
            ensureSnakeClashApi()?.markSnakeClashNotificationSeen(clashIdOrOnceKey);
        }

        async function settleSnakeClashMvp(clashPath, clashData) {
            return ensureSnakeClashApi()?.settleSnakeClashMvp(clashPath, clashData);
        }

        async function maybeStartSnakeClashFromEncounter(encounterState) {
            return ensureSnakeClashApi()?.maybeStartSnakeClashFromEncounter(encounterState);
        }

        function getSnakeRpsChoiceLabel(choice) {
            return ensureSnakeClashApi()?.getSnakeRpsChoiceLabel(choice) || '—';
        }

        function getSnakeRpsRoundResult(choiceA, choiceB) {
            return ensureSnakeClashApi()?.getSnakeRpsRoundResult(choiceA, choiceB) || { status: 'pending' };
        }

        function chooseSnakeClashGameType(roundId, cell, pairKey) {
            return ensureSnakeClashApi()?.chooseSnakeClashGameType(roundId, cell, pairKey) || 'snake_rps';
        }

        function buildSnakePoisonInit(playersPair, karmaByUid = {}) {
            return ensureSnakeClashApi()?.buildSnakePoisonInit(playersPair, karmaByUid) || { health: {}, karmaBonus: {}, turnIndex: 0, turnNo: 1, lastRolls: {}, log: [] };
        }

        function openSnakeRpsModal(clashPath, clash) {
            ensureSnakeClashApi()?.openSnakeRpsModal(clashPath, clash);
        }

        async function maybeResolveSnakeRpsClash(clashPath) {
            return ensureSnakeClashApi()?.maybeResolveSnakeRpsClash(clashPath);
        }

        async function submitSnakeRpsChoice(clashPath, choice) {
            return ensureSnakeClashApi()?.submitSnakeRpsChoice(clashPath, choice);
        }
        window.submitSnakeRpsChoice = submitSnakeRpsChoice;

        function openSnakePoisonDiceModal(clashPath, clash) {
            ensureSnakeClashApi()?.openSnakePoisonDiceModal(clashPath, clash);
        }

        async function maybeResolveSnakePoisonDiceClash(clashPath) {
            return ensureSnakeClashApi()?.maybeResolveSnakePoisonDiceClash(clashPath);
        }

        async function submitSnakePoisonDiceRoll(clashPath) {
            return ensureSnakeClashApi()?.submitSnakePoisonDiceRoll(clashPath);
        }
        window.submitSnakePoisonDiceRoll = submitSnakePoisonDiceRoll;

        function openSnakePuzzleModal(clashPath, clash) {
            ensureSnakeClashApi()?.openSnakePuzzleModal(clashPath, clash);
        }

        async function maybeResolveSnakePuzzleClash(clashPath) {
            return ensureSnakeClashApi()?.maybeResolveSnakePuzzleClash(clashPath);
        }

        async function submitSnakePuzzleMove(clashPath, tileValue) {
            return ensureSnakeClashApi()?.submitSnakePuzzleMove(clashPath, tileValue);
        }
        window.submitSnakePuzzleMove = submitSnakePuzzleMove;

        async function maybeCreateSnakeSynergyFromEncounter(encounterState) {
            return ensureSnakeClashApi()?.maybeCreateSnakeSynergyFromEncounter(encounterState);
        }

        async function consumeForbiddenFruitSkipIfPending(userId) {
            const uid = String(userId || '').trim();
            if (!uid) return { consumed: false, reason: 'no_uid' };
            const ref = db.ref(`whitelist/${uid}/snakeState`);
            let consumed = false;
            const tx = await ref.transaction((row) => {
                if (!row || typeof row !== 'object') return row;
                const pending = !!row.forbiddenFruitSkipPending || !!row.skipNextTurn;
                if (!pending) return row;
                consumed = true;
                return {
                    ...row,
                    forbiddenFruitSkipPending: false,
                    forbiddenFruitConsumedAt: Number(row.forbiddenFruitConsumedAt || Date.now()),
                    forbiddenFruitActive: false,
                    skipNextTurn: false
                };
            });
            if (!tx.committed || !consumed) return { consumed: false, reason: 'no_pending_skip' };
            return { consumed: true };
        }


        async function roll() {
            if (Number(currentUserId) === Number(ADMIN_ID)) {
                return alert('Админ не участвует в игре как игрок: можно только наблюдать за событиями и полем.');
            }
            const userStateSnap = await db.ref(`whitelist/${currentUserId}`).once('value');
            const userState = userStateSnap.val() || {};
            if (userState.isEliminated) return alert('Ты подтвердил(а) выход из игры и больше не участвуешь в следующих раундах.');

            const currentRoundSnap = await db.ref('current_round').once('value');
            const currentRound = currentRoundSnap.val() || {};
            if (window.snakeRound?.isSnakeRound?.(currentRound)) {
                await tryResolveSheddingLockByTimer(currentUserId, userState.snakeState || null);
                const snakeState = await window.snakeRound.getUserSnakeState(db, currentUserId);
                if (snakeState.awaitingApproval) return alert('Сначала дождись одобрения текущей работы админом.');
                if (snakeState.lockedBySphinx) return alert('Испытание Сфинкса ещё не завершено.');
                if (snakeState.sheddingActive && !snakeState.sheddingReleasedAt) {
                    const endsAt = Number(snakeState.sheddingEndsAt || snakeState.sheddingLockUntil || 0);
                    const leftMs = Math.max(0, endsAt - Date.now());
                    const leftMin = Math.ceil(leftMs / 60000);
                    const karmaNow = Number((await db.ref(`player_season_status/${currentUserId}/karma_points`).once('value')).val() || 0);
                    if (karmaNow >= 5) {
                        const payNow = confirm(`🧬 Сброс кожи активен. До авто-снятия ~${leftMin} мин. Потратить 5 кармы и снять эффект сейчас?`);
                        if (payNow) {
                            const paid = await tryResolveSheddingLockByKarma(currentUserId);
                            if (paid.released) {
                                alert('Сброс кожи снят за 5 кармы. Теперь можно бросать кубик.');
                            } else if (paid.reason === 'not_enough_karma') {
                                alert('Недостаточно кармы, чтобы снять «Сброс кожи» досрочно.');
                            }
                        }
                    }

                    const refreshSnakeState = await window.snakeRound.getUserSnakeState(db, currentUserId);
                    if (refreshSnakeState.sheddingActive && !refreshSnakeState.sheddingReleasedAt) {
                        const refreshEnds = Number(refreshSnakeState.sheddingEndsAt || refreshSnakeState.sheddingLockUntil || 0);
                        const refreshLeft = Math.max(0, refreshEnds - Date.now());
                        const refreshMin = Math.ceil(refreshLeft / 60000);
                        return alert(`Сброс кожи активен. До авто-снятия осталось ~${refreshMin} мин.`);
                    }
                }

                const fruitSkipState = await consumeForbiddenFruitSkipIfPending(currentUserId);
                if (fruitSkipState.consumed) {
                    return alert('🍎 Ход пропущен: сработал эффект «Запретного плода». Следующий бросок снова доступен.');
                }

                let playerKarma = Number((await db.ref(`player_season_status/${currentUserId}/karma_points`).once('value')).val() || 0);
                let dice = 1 + Math.floor(Math.random() * 6);
                let usedReroll = false;
                if (playerKarma >= 15) {
                    const doReroll = confirm(`Выпало ${dice}. Потратить 15 кармы на «Второе дыхание» и перебросить кубик?`);
                    if (doReroll) {
                        await updateKarma(currentUserId, -15);
                        playerKarma = Math.max(0, playerKarma - 15);
                        dice = 1 + Math.floor(Math.random() * 6);
                        usedReroll = true;
                        alert(`Второе дыхание сработало! Новый результат: ${dice}.`);
                    }
                }
                const position = Number(snakeState.position || 1);
                const baseNextPos = window.snakeRound.evaluateMove(position, dice, !!snakeState.invertNextRoll);
                let effect = window.snakeRound.resolveCellEffect(baseNextPos, currentRound.snakeConfig || {});
                let nextPos = Number(effect.to || baseNextPos);

                const rankName = window.karmaSystem?.getKarmaRank ? window.karmaSystem.getKarmaRank(playerKarma) : '';
                const isCreatorRank = String(rankName).includes('Творец Миров');
                const negativeTrapTypes = new Set(['snake', 'maelstrom', 'kaa', 'sphinx', 'shedding']);

                if (String(effect.type) === 'kaa' && isCreatorRank) {
                    effect = { ...effect, type: 'normal', to: baseNextPos, invertNextRoll: false, text: '🛡️ Твой ранг «Творец Миров» защитил от гипноза Каа.' };
                    nextPos = baseNextPos;
                    alert('Твой ранг «Творец Миров» защитил от гипноза Каа!');
                } else if (negativeTrapTypes.has(String(effect.type || '')) && playerKarma >= 30) {
                    const useAmulet = confirm(`Попадание на ловушку (${effect.text || effect.type}). Потратить 30 кармы на Защитный амулет и игнорировать эффект?`);
                    if (useAmulet) {
                        await updateKarma(currentUserId, -30);
                        playerKarma = Math.max(0, playerKarma - 30);
                        effect = { ...effect, type: 'normal', to: baseNextPos, invertNextRoll: false, lockSphinx: false, lockUntil: null, text: '🛡️ Защитный амулет нейтрализовал ловушку.' };
                        nextPos = baseNextPos;
                        alert('Защитный амулет сработал: негативный эффект отменён.');
                    }
                }

                const boardSnapSnake = await db.ref('board').once('value');
                const boardSnake = boardSnapSnake.val() || {};
                const prevEntry = Object.entries(boardSnake).find(([_, c]) => c && Number(c.userId) === Number(currentUserId) && Number(c.round) === Number(currentRound.number) && String(c.mode || '') === 'snake');
                const updates = {};
                if (prevEntry) updates[`board/${prevEntry[0]}`] = null;

                const nowTs = Date.now();
                const roundId = Number(currentRound.number || 0);
                const uid = String(currentUserId || '').trim();
                const previousCellPos = Number(snakeState.position || 0);
                const presencePath = `snake_presence/${roundId}/${nextPos}`;
                const presenceSnap = await db.ref(presencePath).once('value');
                const presenceList = window.snakeRound?.parseCellPresence
                    ? window.snakeRound.parseCellPresence(presenceSnap.val())
                    : [];
                const othersOnCell = presenceList.filter((row) => String(row.userId) !== uid);

                if (previousCellPos > 0 && previousCellPos !== nextPos) {
                    updates[`snake_presence/${roundId}/${previousCellPos}/${uid}`] = null;
                }

                const existingSelf = presenceList.find((row) => String(row.userId) === uid);
                updates[`snake_presence/${roundId}/${nextPos}/${uid}`] = {
                    userId: uid,
                    owner: myIndex,
                    enteredAt: Number(existingSelf?.enteredAt || nowTs),
                    lastSeenAt: nowTs
                };

                const used = Array.isArray(userState.used_tasks) ? userState.used_tasks : [];
                const avail = tasks.map((_, i) => i).filter(i => !used.includes(i));
                const taskIdx = avail.length ? avail[Math.floor(Math.random() * avail.length)] : Math.floor(Math.random() * Math.max(1, tasks.length));
                updates[`board/${nextPos - 1}`] = {
                    owner: myIndex,
                    userId: currentUserId,
                    taskIdx,
                    ticket: '',
                    round: currentRound.number,
                    mode: 'snake',
                    pathPos: nextPos,
                    effect: effect.type || 'normal',
                    effectText: effect.text || '',
                    createdAt: Date.now(),
                    excluded: false
                };

                const nextSnakeState = {
                    position: nextPos,
                    activeCell: nextPos,
                    activeTask: {
                        cell: nextPos,
                        taskIdx,
                        round: currentRound.number,
                        type: String(effect.type || '') === 'sphinx' ? 'snake_sphinx' : 'snake_standard',
                        isSphinxTrial: String(effect.type || '') === 'sphinx',
                        taskLabel: String(effect.type || '') === 'sphinx'
                            ? '🗿 Испытание Сфинкса: сложное супер-задание (бросок кубика заблокирован до одобрения)'
                            : ''
                    },
                    awaitingApproval: true,
                    invertNextRoll: !!effect.invertNextRoll,
                    lockedBySphinx: !!effect.lockSphinx,
                    sheddingLockUntil: effect.lockUntil || null,
                    sheddingActive: String(effect.type || '') === 'shedding',
                    sheddingStartedAt: String(effect.type || '') === 'shedding' ? Date.now() : null,
                    sheddingEndsAt: String(effect.type || '') === 'shedding' ? Number(effect.lockUntil || 0) : null,
                    sheddingReleasedAt: String(effect.type || '') === 'shedding' ? 0 : null,
                    sheddingResolvedBy: String(effect.type || '') === 'shedding' ? '' : null,
                    movedAt: Date.now(),
                    lastCellEnteredAt: Date.now(),
                    skipNextTurn: false,
                    forbiddenFruitActive: false,
                    forbiddenFruitAccepted: false,
                    forbiddenFruitGrantedAt: 0,
                    forbiddenFruitSkipPending: false,
                    forbiddenFruitConsumedAt: Number(snakeState.forbiddenFruitConsumedAt || 0),
                    rollMeta: {
                        usedReroll,
                        baseDice: usedReroll ? null : dice,
                        finalDice: dice,
                        spentOnReroll: usedReroll ? 15 : 0
                    },
                    masterTrapVisionEnabled: playerKarma >= 90,
                    masterTrapVisionSource: playerKarma >= 90 ? {
                        generatedAt: Date.now(),
                        negatives: {
                            snakes: (currentRound?.snakeConfig?.snakes || []).map((x) => Number(x.from)),
                            maelstrom: (currentRound?.snakeConfig?.maelstrom || []).map((x) => Number(x)),
                            sphinx: (currentRound?.snakeConfig?.sphinx || []).map((x) => Number(x)),
                            kaa: (currentRound?.snakeConfig?.kaa || []).map((x) => Number(x)),
                            shedding: (currentRound?.snakeConfig?.shedding || []).map((x) => Number(x))
                        }
                    } : null
                };

                for (const other of othersOnCell) {
                    const otherUserId = String(other.userId || '').trim();
                    if (!otherUserId) continue;
                    const pairKey = window.snakeRound?.buildPairKey
                        ? window.snakeRound.buildPairKey(uid, otherUserId)
                        : [uid, otherUserId].sort((a, b) => a.localeCompare(b, 'ru')).join('__');
                    const historyPath = `snake_duel_history/${roundId}/${nextPos}/${pairKey}`;
                    const historySnap = await db.ref(historyPath).once('value');
                    const rights = window.snakeRound?.evaluateEncounterRights
                        ? window.snakeRound.evaluateEncounterRights({
                            currentUserId: uid,
                            currentEnteredAt: nowTs,
                            otherUserId,
                            otherEnteredAt: Number(other.enteredAt || 0),
                            duelHistoryRow: historySnap.val() || null,
                            nowTs
                        })
                        : {
                            pairKey,
                            canStartClash: true,
                            blockedReason: '',
                            completedOnCell: false,
                            currentImmune: false,
                            otherImmune: false,
                            safetyWindowMs: 3600000
                        };

                    const encounterState = {
                        pairKey,
                        players: [uid, otherUserId].sort((a, b) => a.localeCompare(b, 'ru')),
                        metAt: nowTs,
                        metBy: uid,
                        round: roundId,
                        cell: nextPos,
                        canStartClash: !!rights.canStartClash,
                        blockedReason: String(rights.blockedReason || ''),
                        completedOnCell: !!rights.completedOnCell,
                        safetyWindowMs: Number(rights.safetyWindowMs || 0),
                        hostCellEntryAt: Number(other.enteredAt || 0),
                        hostSafetyImmune: !!rights.otherImmune,
                        challengerSafetyImmune: !!rights.currentImmune,
                        updatedAt: nowTs
                    };
                    updates[`snake_encounters/${roundId}/${nextPos}/${pairKey}`] = encounterState;

                    if (!historySnap.exists()) {
                        updates[historyPath] = {
                            pairKey,
                            players: encounterState.players,
                            round: roundId,
                            cell: nextPos,
                            status: 'pending',
                            createdAt: nowTs,
                            updatedAt: nowTs,
                            lastEncounterAt: nowTs
                        };
                    } else {
                        updates[`${historyPath}/updatedAt`] = nowTs;
                        updates[`${historyPath}/lastEncounterAt`] = nowTs;
                    }

                    if (!encounterState.canStartClash) {
                        const blockReason = String(encounterState.blockedReason || '');
                        let blockText = '';
                        if (blockReason === 'already_completed_on_this_cell') {
                            blockText = '⚖️ На этой клетке у вас с этим игроком стычка уже была завершена ранее, повтор недоступен.';
                        } else if (blockReason === 'other_player_safety_immunity') {
                            blockText = '🛡️ Стычка не началась: у второго игрока действует защитный час после входа в клетку.';
                        } else if (blockReason === 'friendly_synergy') {
                            blockText = '🤝 Вместо стычки активировалась синергия на этой клетке.';
                        }
                        if (blockText) {
                            updates[`system_notifications/${uid}/snake_encounter_blocked_${roundId}_${nextPos}_${pairKey}`] = {
                                text: blockText,
                                type: 'snake_encounter_blocked',
                                clashId: `${roundId}_${nextPos}_${pairKey}`,
                                onceKey: `encounter_blocked_${roundId}_${nextPos}_${pairKey}`,
                                createdAt: nowTs,
                                expiresAt: nowTs + (2 * 60 * 60 * 1000)
                            };
                        }
                    }

                    if (encounterState.canStartClash) {
                        maybeCreateSnakeSynergyFromEncounter(encounterState)
                            .then((result) => {
                                if (result?.created) return;
                                return maybeStartSnakeClashFromEncounter(encounterState);
                            })
                            .catch((err) => {
                                console.error('snake encounter flow failed', err);
                            });
                    }
                }

                if (String(effect.type) === 'forbiddenFruit') {
                    const accepted = confirm('🍎 Запретный плод: получить +20 кармы сейчас и пропустить следующий ход?');
                    nextSnakeState.forbiddenFruitActive = true;
                    nextSnakeState.forbiddenFruitAccepted = !!accepted;
                    if (accepted) {
                        await updateKarma(currentUserId, 20);
                        playerKarma += 20;
                        const grantedAt = Date.now();
                        nextSnakeState.forbiddenFruitGrantedAt = grantedAt;
                        nextSnakeState.forbiddenFruitSkipPending = true;
                        nextSnakeState.skipNextTurn = true;
                        nextSnakeState.forbiddenFruitConsumedAt = 0;
                    } else {
                        nextSnakeState.forbiddenFruitGrantedAt = 0;
                        nextSnakeState.forbiddenFruitSkipPending = false;
                        nextSnakeState.skipNextTurn = false;
                        nextSnakeState.forbiddenFruitConsumedAt = Date.now();
                    }
                }
                if (Number(effect.karmaDelta || 0) > 0) {
                    await updateKarma(currentUserId, Number(effect.karmaDelta));
                    playerKarma += Number(effect.karmaDelta);
                }

                updates[`whitelist/${currentUserId}/snakeState`] = nextSnakeState;
                updates[`whitelist/${currentUserId}/used_tasks`] = [...used.filter((n) => n !== taskIdx), taskIdx];
                updates[`whitelist/${currentUserId}/last_round`] = currentRound.number;
                if (String(effect.type || '') === 'sphinx') {
                    const sphinxNotifyKey = `snake_sphinx_trial_${currentRound.number}_${nextPos}`;
                    updates[`system_notifications/${currentUserId}/${sphinxNotifyKey}`] = {
                        text: '🗿 Испытание Сфинкса началось: кубик замер. Загрузи и дождись одобрения супер-задания, чтобы продолжить путь.',
                        type: 'snake_sphinx_trial_start',
                        onceKey: sphinxNotifyKey,
                        createdAt: Date.now(),
                        expiresAt: Date.now() + (24 * 60 * 60 * 1000)
                    };
                }
                await db.ref().update(updates);

                await postNews(`🐍 ${players[myIndex].n} бросил(а) ${dice} и теперь на клетке №${nextPos}. ${effect.text || ''}`);
                const actualCell = (await db.ref(`board/${nextPos - 1}`).once('value')).val();
                showCell(nextPos - 1, actualCell);
                return;
            }

            const boardSnap = await db.ref('board').once('value'), board = boardSnap.val() || {};
            const roundSnap = await db.ref('current_round').once('value'), rData = roundSnap.val();
            let free = []; for(let i=0; i<50; i++) if(!board[i]) free.push(i);
            const userSnap = await db.ref(`whitelist/${currentUserId}/used_tasks`).once('value');
            let used = userSnap.val() || [], avail = tasks.map((_, i) => i).filter(i => !used.includes(i));
            if (!avail.length || !free.length || (roundEndTime - Date.now() <= 0)) return alert("Мест нет!");

            const cellIdx = free[Math.floor(Math.random()*free.length)];
            let isMagic = rData?.magicCell === cellIdx;
            const isTrap = rData.traps && rData.traps.includes(cellIdx);
            const isMiniGame = rData?.miniGameCell === cellIdx;
            const isWordSketch = rData?.wordSketchCell === cellIdx;
            const isMagnet = rData?.magnetCell === cellIdx;
            const itemCells = rData?.itemCells || {};
            const itemType = itemCells[cellIdx] || null;
            const isGold = !isTrap && !isMagic && !isMiniGame && !isWordSketch && !isMagnet && !itemType && Math.random() < 0.05;

            if (isTrap || isMagic || isMiniGame || isWordSketch || isMagnet || isGold || itemType) {
                await postNews(`${players[myIndex].n} попал(а) на особую клетку`);
            }

            let tStr = '';
            if (!isMiniGame && !isWordSketch) {
                const awarded = await claimSequentialTickets(isGold ? 2 : 1);
                if (!awarded) return alert(`Лимит билетиков (${MAX_TICKETS}) уже достигнут в этой игре.`);
                tStr = awarded[0];
                if (isGold) tStr += " и " + awarded[1];
            }

            const pendingItemTicket = (itemType === 'inkSaboteur') ? tStr : '';
            if (itemType === 'inkSaboteur') tStr = '';

            const matchedMagicLink = await resolveMagicPartnerAfterRoll(currentRoundNum, currentUserId, myIndex);
            if (matchedMagicLink) isMagic = true;

            let taskIdx = -1;
            let trapText = "";
            let magicLinkId = null;
            let magicSoloTaskIdx = -1;
            let magicLinkPartnerUserId = '';
            let magicLinkPartnerName = '';
            let magicLinkActive = false;
            if (isMagic) {
                magicSoloTaskIdx = avail[Math.floor(Math.random()*avail.length)];
                if (matchedMagicLink) {
                    magicLinkId = matchedMagicLink.key;
                    magicLinkPartnerUserId = String(matchedMagicLink.playerA?.userId || '');
                    magicLinkPartnerName = matchedMagicLink.playerA?.name || 'Игрок';
                    magicLinkActive = true;
                } else {
                    const linkRef = db.ref(`magic_links/${currentRoundNum}`).push();
                    await linkRef.set({
                        createdAt: Date.now(),
                        waitingSince: Date.now(),
                        status: 'waiting_for_partner',
                        playerA: { userId: currentUserId, charIndex: myIndex, name: players[myIndex].n },
                        tasks: magicBondTasks
                    });
                    magicLinkId = linkRef.key;
                    await postNews(`🔮 ${players[myIndex].n} открыл(а) магическую клетку и ждёт пару до 2 часов.`);
                    alert('Вау! Это Магические узы! Ждём следующего игрока, который бросит кубик в течение 2 часов.');
                }
            } else if (isTrap) {
                const traps = [
                    "Детка, это ловушка Капитана Крюка! Чтобы освободиться, рисуй своей не ведущей рукой! Смотри не мухлюй, злой пират всё видит и порвет твой счастливый билетик у тебя на глазах!",
                    "Ха-ха! Как же тебе не повезло! Задача трудная - за тобой разворот. Рисуй скорее, а то счастливый билетик растворится как утренняя заря!"
                ];
                trapText = traps[Math.floor(Math.random()*traps.length)];
                await postNews(`💣 ${players[myIndex].n} открыл(а) клетку с бомбой!`);
            } else if (isMiniGame) {
                taskIdx = -1;
                await postNews(`🎮 ${players[myIndex].n} открыл(а) клетку с пятнашками.`);
                playFanfare();
            } else if (isWordSketch) {
                taskIdx = -1;
                await postNews(`🧩 ${players[myIndex].n} открыл(а) клетку «Словесный скетч».`);
                playFanfare();
            } else if (isMagnet) {
                const magnetCandidates = getMagnetSourceCandidates(board);
                if (!magnetCandidates.length) {
                    alert('Пока не с кого тянуть задание, поэтому тебе выпало обычное задание.');
                    taskIdx = avail[Math.floor(Math.random()*avail.length)];
                } else {
                    const source = magnetCandidates[Math.floor(Math.random() * magnetCandidates.length)];
                    const sourceName = players[source.owner]?.n || 'Неизвестный';
                    const sourceTaskLabel = getTaskLabelByCell(source);
                    trapText = sourceTaskLabel;
                    alert(`Я - это ты, ты - это я. Будь как ${sourceName}, рисуй то же самое`);
                    await postNews(`👯 ${players[myIndex].n} попал(а) на магнитную клетку и получил(а) задание игрока ${sourceName}.`);
                }
            } else if (itemType === 'magnifier' || itemType === 'cloak') {
                taskIdx = avail[Math.floor(Math.random()*avail.length)];
            } else if (itemType) {
                // В предметной клетке нет обычного задания: либо предмет, либо механика, либо задание.
            } else if (!isGold) {
                taskIdx = avail[Math.floor(Math.random()*avail.length)];
            }

            if (isGold) {
                await postNews(`👑 ${players[myIndex].n} нашёл(ла) золотую клетку и получил(а) 2 билетика!`);
            }

            if (itemType) {
                if (itemType !== 'magicWand' && itemType !== 'inkSaboteur') {
                    await addInventoryItem(itemType, 1);
                }
                if (itemType === 'cloak') {
                    alert('✨ Вы нашли Плащ-невидимку! Он позволит вам пройти одну клетку незамеченным');
                }
                await postNews(`${players[myIndex].n} наш(ла) предмет «${itemTypes[itemType]?.name || itemType}»`);
            }

            const cellData = { owner: myIndex, userId: currentUserId, taskIdx, ticket: (isMiniGame || isWordSketch) ? '' : tStr, isGold, isTrap, isMagic, isMiniGame, isWordSketch, isInkChallenge: false, isWandBlessing: false, wandOptionLabel: '', itemType, inkPendingTicket: pendingItemTicket, inkUsed: false, miniGameTiles: isMiniGame ? createShuffledMiniGameTiles(5) : null, miniGameWon: false, miniGameFailed: false, miniGameCodeWord: "", wordSketchAnswer: isWordSketch ? pickRandomWordSketchWord() : '', wordSketchGuess: '', wordSketchAttempts: [], wordSketchAttemptCount: 0, wordSketchGuessed: false, wordSketchFailed: false, magicLinkId, magicSoloTaskIdx, magicLinkPartnerUserId, magicLinkPartnerName, magicLinkActive, isMagicSolo: false, trapText, round: currentRoundNum, excluded: false };
            await db.ref('board/'+cellIdx).set(cellData);
            if (itemType === 'inkSaboteur') {
                await activateInkSaboteur(cellIdx, { autoPick: true });
                await postNews(`${players[myIndex].n} активировал(а) «Клякса-саботаж»`);
            }
            if(!isGold && !isTrap && !isMagic && !isMagnet && taskIdx >= 0) { used.push(taskIdx); await db.ref(`whitelist/${currentUserId}/used_tasks`).set(used); }
            await db.ref(`whitelist/${currentUserId}/last_round`).set(currentRoundNum);
            const actualCell = (await db.ref('board/'+cellIdx).once('value')).val() || cellData;
            showCell(cellIdx, actualCell);

            if (itemType === 'magicWand') {
                await postNews(`${players[myIndex].n} активировал(а) «Волшебная палочка»`);
                await sendWandBlessingImmediately();
            }
        }

        function showCell(i, cell) {
            if (!cell) return;

            const isAdmin = (currentUserId === ADMIN_ID);
            const isOwner = (cell.owner === myIndex);

            if (cell.isTrap && (isOwner || isAdmin)) {
                playExplosion();
                document.body.classList.add('apply-shake');
                setTimeout(() => document.body.classList.remove('apply-shake'), 500);
                if (window.navigator.vibrate) window.navigator.vibrate([100, 50, 100]);
            }

            document.getElementById('mTitle').innerText = cell.isTrap ? '💣 КЛЕТКА С ЛОВУШКОЙ' : (cell.isGold ? '👑 ЗОЛОТАЯ КЛЕТКА' : (cell.isMagic ? '🔮 МАГИЧЕСКАЯ СВЯЗЬ' : (cell.isMiniGame ? '🎮 КЛЕТКА-МИНИ-ИГРА' : (cell.isWordSketch ? '🧩 КЛЕТКА-МИНИ-ИГРА' : (cell.isMagnet ? '👯 ТЯНЕТ К ТЕБЕ КАК МАГНИТОМ' : (cell.isInkChallenge ? '🫧 КЛЯКСА-ДИВЕРСАНТ' : (cell.isWandBlessing ? '🎆 ВОЛШЕБНАЯ ПАЛОЧКА' : (cell.itemType ? '🎁 ПРЕДМЕТНАЯ КЛЕТКА' : ('КЛЕТКА №' + (i + 1))))))))));
            const userTgId = isAdmin ? `<br><small style="color:#888;">TG ID: ${cell.userId || '—'}</small>` : "";

            const ownerUserId = String(cell.userId || '').trim();
            const ownerSeason = seasonProfilesByUserId[ownerUserId] || {};
            const ownerKarma = Number(ownerSeason.karma_points) || 0;
            const karmaVisual = getKarmaVisualByPoints(ownerKarma);
            const karmaRank = window.karmaSystem?.getKarmaRank ? window.karmaSystem.getKarmaRank(ownerKarma) : 'Зритель из Первого Ряда 👩‍🎤';
            const ownerAvatar = players[cell.owner]?.n?.trim()?.charAt(0)?.toUpperCase() || '🎨';
            const ownerAvatarUrl = String(ownerSeason.avatar_url || ownerSeason.photo_url || '').trim();
            const ownerName = players[cell.owner]?.n || 'Игрок';
            const magicPartnerName = (() => {
                const directPartnerName = String(cell.magicLinkPartnerName || '').trim();
                if (directPartnerName) return directPartnerName;
                const partnerUserId = String(cell.magic_link?.partner_user_id || cell.magicLinkPartnerUserId || '').trim();
                if (!partnerUserId) return '';
                const p = Object.values(seasonProfilesByUserId || {}).find(v => String(v?.userId || '') === partnerUserId);
                if (p?.nickname) return p.nickname;
                const pCell = Object.values(gridState || {}).find(c => c && String(c.userId || '') === partnerUserId);
                return pCell ? (players[pCell.owner]?.n || 'Связанный игрок') : 'Связанный игрок';
            })();

            let h = `
                <div style="text-align:left; margin-bottom:15px; border:1px solid #ede7f6; border-radius:14px; background:linear-gradient(135deg,#fff,#f9f5ff); padding:10px;">
                    <div style="display:flex; gap:10px; align-items:center;">
                        <div style="width:56px; height:56px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:24px; color:#fff; background:linear-gradient(135deg,${charColors[cell.owner]},#ec407a); border:3px solid ${karmaVisual.border}; box-shadow:0 0 0 4px ${karmaVisual.glow}; overflow:hidden;">${ownerAvatarUrl ? `<img src="${ownerAvatarUrl}" alt="Аватар ${ownerName}" style="width:100%; height:100%; object-fit:cover;">` : ownerAvatar}</div>
                        <div style="flex:1; min-width:0;">
                            <div style="font-size:16px; font-weight:800; color:${charColors[cell.owner]}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${ownerName}${userTgId}</div>
                            <div style="display:inline-flex; margin-top:4px; font-size:12px; padding:3px 8px; border-radius:999px; background:#f3e5f5; color:#6a1b9a; border:1px solid #e1bee7;">${karmaRank}</div>
                        </div>
                    </div>
                </div>
                <div style="display:flex; justify-content:space-between; gap:8px; margin-bottom:8px; font-size:13px;"><span>📍 Клетка №${i + 1}</span><span>🎟 Билет: <b>${cell.ticket || '—'}</b></span></div>
                ${cell.itemType ? `<div style="font-size:12px; margin:0 0 8px; color:#6a1b9a;">${itemTypes[cell.itemType]?.emoji || '🎁'} Предмет: <b>${itemTypes[cell.itemType]?.name || cell.itemType}</b></div>` : ''}
                ${(cell.magic_link?.active || cell.magicLinkActive || (cell.isMagic && (cell.magicLinkId || cell.magic_link?.id))) ? `<div style="font-size:12px; margin:0 0 8px; color:#5e35b1;">🔗 Магическая связь: <b>${magicPartnerName || 'ожидается напарник'}</b></div>` : ''}
                ${(!isOwner && !isAdmin && ownerUserId) ? `<button onclick="sendCellImpulseToOwner(${i}, '${ownerUserId}', '${encodeURIComponent(ownerName)}')" class="admin-btn" style="margin:0 0 10px; width:100%; background:#8e24aa;">✨ Отправить импульс</button>` : ''}
                <hr style="border:0; border-top:1px solid #eee; margin:15px 0;">
            `;

            if (isOwner || isAdmin) {
                if (cell.isTrap) {
                    h += `<div style="padding:15px; border:2px dashed red; border-radius:10px; background:#fff0f0; color:#ff4444; font-weight:bold; text-align:center;">${cell.trapText}</div>`;
                } else if (cell.isMagic) {
                    if (cell.isMagicSolo && Number.isInteger(cell.taskIdx) && cell.taskIdx >= 0) {
                        const soloTask = tasks[cell.taskIdx];
                        h += `<div style="padding:15px; border:2px solid #7e57c2; border-radius:10px; background:#f5efff; text-align:left;">
                            <div style="font-weight:bold; color:#5e35b1; margin-bottom:8px;">Упс! Магическая связь не нашла пару, выполняй задание в одиночку.</div>
                            <div style="font-size:14px; color:#333; line-height:1.4;">${soloTask?.text || 'Обычное задание'}</div>
                        </div>`;
                    } else {
                        h += `
                    <div style="padding:15px; border:2px solid #7e57c2; border-radius:10px; background:#f5efff; text-align:left;">
                        <div style="font-weight:bold; color:#5e35b1; margin-bottom:8px;">Вау! Это Магические узы! Выберите одно совместное задание:</div>
                        <ol style="margin:0 0 10px 18px; padding:0; line-height:1.4; font-size:14px; color:#333;">
                            ${magicBondTasks.map(t => `<li style="margin-bottom:6px;">${t}</li>`).join('')}
                        </ol>
                        <div style="font-size:13px; color:#4a148c; background:#ede7f6; border-radius:8px; padding:8px;">
                            🎟 Если договорились и выполнили задание вместе — <b>по 3 билетика</b> каждому.<br>
                            🎫 Если не договорились, но выполнили свою часть задания — <b>по 1 билетику</b> каждому.
                        </div>
                    </div>`;
                    }
                } else if (cell.isGold) {
                    h += `<div style="padding:15px; border:2px solid #fbc02d; border-radius:10px; background:#fff9c4; text-align:center;">✨ Твое задание: Рисуй на любую свободную тему!</div>`;
                } else if (cell.itemType === 'inkSaboteur') {
                    h += `<div style="padding:12px; border:2px solid #ce93d8; border-radius:10px; background:#fff7ff; text-align:center; color:#6a1b9a; font-weight:bold;">Сделал гадось - сердцу радость! Кодовое слово "Клякса", нарисовать можешь что хочешь, злючка!</div>`;
                    h += `<div style="margin-top:8px; font-size:12px; color:#6a1b9a;">Пока не выберешь цель для кляксы, билетик за клетку не начислится.</div>`;
                    h += `<button onclick="activateInkSaboteur(${i})" class="admin-btn" style="margin-top:10px; width:100%; background:#8e24aa;">🫧 Выбрать игрока для кляксы</button>`;
                } else if (cell.itemType === 'magicWand') {
                    h += `<div style="padding:12px; border:2px solid #7e57c2; border-radius:10px; background:#f5efff; text-align:center; color:#5e35b1; font-weight:bold;">Ты просто прелесть! Твоё кодовое слово "Фея", рисуй что дорого твоему добродушному сердцу!</div>`;
                } else if (cell.itemType === 'cloak') {
                    h += `<div style="padding:12px; border:2px solid #8e24aa; border-radius:10px; background:#f8eaff; text-align:left; color:#4a148c; font-weight:600;">🎭 Ты нашёл(ла) Плащ-невидимку! Его можно надеть в любой карточке задания, чтобы отложить его на следующий раунд.</div>`;
                    const t = tasks[cell.taskIdx];
                    if (t) {
                        if (t.img) h += `<img src="${t.img}" style="width:100%; border-radius:10px; margin:10px 0; box-shadow:0 4px 10px rgba(0,0,0,0.1);">`;
                        h += `<p style="text-align:left; line-height:1.4; font-size:15px; color:#444;">${t.text}</p>`;
                    }
                } else if (cell.itemType === 'magnifier') {
                    h += `<div style="padding:12px; border:2px solid #3949ab; border-radius:10px; background:#eef2ff; text-align:left; color:#1a237e; font-weight:600;">🔎 Ты нашёл(ла) Лупу! Текущее задание на этой клетке уже открыто, а Лупа добавлена в рюкзак для другой клетки.</div>`;
                    const t = tasks[cell.taskIdx];
                    if (t) {
                        if (t.img) h += `<img src="${t.img}" style="width:100%; border-radius:10px; margin:10px 0; box-shadow:0 4px 10px rgba(0,0,0,0.1);">`;
                        h += `<p style="text-align:left; line-height:1.4; font-size:15px; color:#444;">${t.text}</p>`;
                    }
                    h += `<div style="margin-top:8px; font-size:12px; color:#283593;">На этой клетке Лупу использовать нельзя — выбери другую свою обычную клетку.</div>`;
                } else if (cell.isMagnet) {
                    h += `<div style="padding:12px; border:2px dashed #ec407a; border-radius:10px; background:#fff1f7; text-align:left;">
                        <div style="font-weight:bold; margin-bottom:8px; color:#ad1457;">Я - это ты, ты - это я. Повтори задание выбранного игрока:</div>
                        <div style="font-size:14px; color:#4a148c;">${cell.magnetTaskLabel || 'Задание будет показано после выбора системой.'}</div>
                    </div>`;
                } else if (cell.isInkChallenge) {
                    const challenge = (myInkChallenge && myInkChallenge.round === cell.round) ? myInkChallenge : null;
                    const picked = challenge?.selectedOption;
                    const draft = challenge?.draftOption;
                    h += `<div style="padding:12px; border:2px dashed #6a1b9a; border-radius:10px; background:#fdf3ff; text-align:left;">
                        <div style="font-weight:bold; margin-bottom:8px; color:#6a1b9a;">Хах! Кому-то ты не угодил! Твою работу покрыли кляксами! Вот твоё задание:</div>
                        <ol style="margin:0 0 8px 18px; padding:0; line-height:1.4;">${inkChallengeOptions.map(o => `<li>${o}</li>`).join('')}</ol>
                        ${picked ? `<div style="font-size:12px; color:#4a148c;"><b>Утверждено:</b> вариант №${picked}</div>` : `
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:8px;">${[1,2,3,4].map(n => `<button onclick="chooseInkChallengeOption(${i}, ${n})" style="border:1px solid #ce93d8; background:${draft === n ? '#f3e5f5' : '#fff'}; color:#6a1b9a; border-radius:8px; padding:8px;">${draft === n ? '✅ Выбрано' : 'Выбрать'} №${n}</button>`).join('')}</div>
                        ${draft ? `<div style="margin-top:8px; font-size:12px; color:#4a148c;">Текущий выбор: вариант №${draft}. Нажми ниже, чтобы зафиксировать без возможности перевыбора.</div><button onclick="confirmInkChallengeOption(${i})" class="admin-btn" style="margin-top:8px; width:100%; background:#6a1b9a;">🔒 Утвердить выбор</button>` : `<div style="margin-top:8px; font-size:12px; color:#7b1fa2;">Сначала выбери вариант из списка, затем утверди выбор.</div>`}`}
                        ${(challenge?.selectedOption === 4 && challenge?.optionDeadline) ? `<div style="margin-top:8px; font-size:12px; color:#d84315;">⏳ Дедлайн: ${new Date(challenge.optionDeadline).toLocaleString('ru-RU')}</div>` : ''}
                    </div>`;
                } else if (cell.isWandBlessing) {
                    const wand = (myWandBlessing && myWandBlessing.round === cell.round) ? myWandBlessing : null;
                    const picked = wand?.selectedOption;
                    const draft = wand?.draftOption;
                    h += `<div style="padding:12px; border:2px dashed #6a1b9a; border-radius:10px; background:#fff7ff; text-align:left;">
                        <div style="font-weight:bold; margin-bottom:8px; color:#6a1b9a;">Добрая фея выбрала тебя 🧚‍♀️. Твоё задание упрощается, выбирай:</div>
                        <ol style="margin:0 0 8px 18px; padding:0; line-height:1.4;">${wandBlessingTasks.map(o => `<li>${o}</li>`).join('')}</ol>
                        ${picked ? `<div style="font-size:12px; color:#4a148c;"><b>Утверждено:</b> вариант №${picked}</div>` : `
                        <div style="display:grid; grid-template-columns:1fr; gap:6px; margin-top:8px;">${[1,2,3].map(n => `<button onclick="chooseWandBlessingOption(${i}, ${n})" style="border:1px solid #ce93d8; background:${draft === n ? '#f3e5f5' : '#fff'}; color:#6a1b9a; border-radius:8px; padding:8px;">${draft === n ? '✅ Выбрано' : 'Выбрать'} №${n}</button>`).join('')}</div>
                        ${draft ? `<div style="margin-top:8px; font-size:12px; color:#4a148c;">Текущий выбор: вариант №${draft}. Нажми ниже, чтобы зафиксировать без возможности перевыбора.</div><button onclick="confirmWandBlessingOption(${i})" class="admin-btn" style="margin-top:8px; width:100%; background:#6a1b9a;">🔒 Утвердить выбор</button>` : `<div style="margin-top:8px; font-size:12px; color:#7b1fa2;">Сначала выбери вариант из списка, затем утверди выбор.</div>`}`}
                    </div>`;
                } else if (cell.isMiniGame || cell.isWordSketch) {
                    h += `<div style="padding:12px; border:1px dashed #80cbc4; border-radius:10px; background:#f1f8e9; text-align:center; color:#33691e;">В этой клетке только мини-игра. Дополнительных заданий и механик нет.</div>`;
                } else {
                    const t = tasks[cell.taskIdx];
                    if (t) {
                        if (t.img) h += `<img src="${t.img}" style="width:100%; border-radius:10px; margin-bottom:10px; box-shadow:0 4px 10px rgba(0,0,0,0.1);">`;
                        h += `<p style="text-align:left; line-height:1.4; font-size:15px; color:#444;">${t.text}</p>`;
                    }
                }

                if (!cell.isTrap && !cell.isMagic && !cell.isMiniGame && !cell.isWordSketch && !cell.isGold && !cell.isInkChallenge && !cell.isWandBlessing && !cell.isMagnet && isOwner && (myInventory.goldenPollen || 0) > 0) {
                    h += `<button onclick="activateGoldenPollen(${i})" class="admin-btn" style="margin-top:10px; width:100%; background:#8e24aa;">🎇 Использовать Золотую пыльцу (x${myInventory.goldenPollen})</button>`;
                }
                if (!cell.isTrap && !cell.isMagic && !cell.isMiniGame && !cell.isWordSketch && !cell.isGold && !cell.isInkChallenge && !cell.isWandBlessing && !cell.isMagnet && !cell.itemType && isOwner && (myInventory.magnifier || 0) > 0) {
                    h += `<button onclick="activateMagnifier(${i})" class="admin-btn" style="margin-top:10px; width:100%; background:#3949ab;">🔎 Использовать Лупу (x${myInventory.magnifier})</button>`;
                }

                if (isOwner && !cell.excluded) {
                    h += `<button onclick="surrenderCell(${i})" class="admin-btn" style="margin-top:10px; width:100%; background:#9e9e9e;">🏳️ Сдаться</button>`;
                    if ((myInventory.cloak || 0) > 0) {
                        h += `<button onclick="activateCloak(${i})" class="admin-btn" style="margin-top:8px; width:100%; background:#8e24aa;">🎭 Надеть плащ</button>`;
                    }
                }

                if (cell.isMiniGame || (cell.isInkChallenge && myInkChallenge?.selectedOption === 1)) {
                    h += buildMiniGameMarkup(i, cell, isOwner);
                }

                if (cell.isWordSketch) {
                    h += buildWordSketchMarkup(i, cell, isOwner);
                }
            } else {
                if (cell.itemType) {
                    h += `<div style="padding:12px; border:1px solid #e1bee7; border-radius:10px; background:#faf5ff; text-align:left;"><b>${players[cell.owner]?.n || 'Игрок'}</b> получил(а) предмет: ${itemTypes[cell.itemType]?.emoji || '🎁'} ${itemTypes[cell.itemType]?.name || cell.itemType}.<br><span style="font-size:12px; color:#777;">Описание задания скрыто для других игроков.</span></div>`;
                } else {
                    h += `<div style="padding:30px 10px; text-align:center; color:#999;"><span style="font-size:40px;">🔒</span><p>Описание задания скрыто.</p></div>`;
                }
            }

            document.getElementById('mText').innerHTML = h;
            document.getElementById('modal').style.display = 'block';
            document.getElementById('overlay').style.display = 'block';
        }

        // Источник активных билетиков для колеса вынесен в Tickets.js.

        function drawWheel() {
            const stage = document.getElementById('magic-cards-stage');
            const banner = document.getElementById('magic-winner-banner');
            if (!stage || !banner) return;
            banner.classList.remove('show');
            if (!stage.children.length) {
                renderIdleMagicSky().catch(err => console.error('renderIdleMagicSky failed:', err));
            }
        }

        function closeWinnerToast() {
            const toast = document.getElementById('winner-toast');
            if (toast) toast.style.display = 'none';
        }

        function showWinnerToast(text) {
            const toast = document.getElementById('winner-toast');
            const textEl = document.getElementById('winner-toast-text');
            if (!toast || !textEl) return;
            textEl.innerText = text;
            toast.style.display = 'block';
        }

        function getServerNowMs() {
            return Date.now() + (Number(raffleServerOffsetMs) || 0);
        }

        async function getTicketsFromFirebaseDrawPool() {
            const rows = window.expandTicketsRows ? window.expandTicketsRows(allTicketsData) : [];
            return rows
                .filter(t => !t.excluded && !t.ticketBurned && !t.isRevoked)
                .map(t => {
                    const ownerIndex = Number(t.owner);
                    const fallbackName = t.nickname || t.playerName || t.ownerName || t.name || t.userName || t.userId || 'Игрок';
                    return {
                        num: String(t.ticketNum),
                        owner: Number.isFinite(ownerIndex) ? ownerIndex : -1,
                        userId: String(t.userId || ''),
                        name: players[ownerIndex]?.n || fallbackName
                    };
                })
                .sort((a, b) => Number(a.num) - Number(b.num));
        }

        function createMagicCardMarkup(ticket, isWinner) {
            const card = document.createElement('div');
            card.className = 'magic-card';
            card.dataset.ticket = String(ticket.num);
            card.dataset.winner = isWinner ? '1' : '0';
            card.innerHTML = `
                <div class="magic-card-inner">
                    <div class="magic-card-face magic-card-back">✦</div>
                    <div class="magic-card-face magic-card-front"><div><small>Счастливый билет</small><b>№${ticket.num}</b><span>${ticket.name}</span></div></div>
                </div>`;
            return card;
        }

        function stopMagicStarField() {
            if (magicStarFieldState?.rafId) cancelAnimationFrame(magicStarFieldState.rafId);
            magicStarFieldState = null;
        }

        function animateDriftingStars(stars, stage) {
            stopMagicStarField();
            const rect = stage.getBoundingClientRect();
            const state = { stars, stage, rafId: 0 };
            magicStarFieldState = state;
            const tick = () => {
                if (!magicStarFieldState || magicStarFieldState !== state) return;
                const w = stage.clientWidth || rect.width || 620;
                const h = stage.clientHeight || rect.height || 420;
                stars.forEach((star) => {
                    star.x += star.vx;
                    star.y += star.vy;
                    if (star.x < -70) star.x = w + 30;
                    if (star.x > w + 70) star.x = -30;
                    if (star.y < -70) star.y = h + 30;
                    if (star.y > h + 70) star.y = -30;
                    star.el.style.transform = `translate(${star.x}px, ${star.y}px)`;
                });
                state.rafId = requestAnimationFrame(tick);
            };
            state.rafId = requestAnimationFrame(tick);
        }

        function buildStarNodesFromTickets(stage, tickets) {
            const width = stage.clientWidth || 620;
            const height = stage.clientHeight || 420;
            return tickets.map(ticket => {
                const el = document.createElement('span');
                const len = String(ticket.num).length;
                el.className = `magic-ticket-star size-${Math.min(len, 3)}`;
                const mark = document.createElement('span');
                mark.className = 'ticket-mark';
                mark.textContent = String(ticket.num);
                el.appendChild(mark);
                el.style.setProperty('--so', (0.68 + Math.random() * 0.28).toFixed(2));
                el.style.setProperty('--tw', `${5.5 + Math.random() * 5.5}s`);
                stage.appendChild(el);
                return {
                    el,
                    x: Math.random() * width,
                    y: Math.random() * height,
                    vx: (Math.random() - 0.5) * 0.2,
                    vy: (Math.random() - 0.5) * 0.18
                };
            });
        }

        async function renderIdleMagicSky() {
            const stage = document.getElementById('magic-cards-stage');
            if (!stage) return;
            const tickets = await getTicketsFromFirebaseDrawPool();
            stage.innerHTML = '';
            if (!tickets.length) {
                stage.innerHTML = '<div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:#f8e5a8; font-weight:700; text-align:center; padding:20px;">Нет активных билетов для звёздного неба</div>';
                return;
            }
            const stars = buildStarNodesFromTickets(stage, tickets);
            animateDriftingStars(stars, stage);
        }

        function stopMagicAnimationFrame() {
            if (magicDrawAnimationState?.rafId) cancelAnimationFrame(magicDrawAnimationState.rafId);
            magicDrawAnimationState = null;
        }

        function runSyncedRaffleAnimation(drawPayload) {
            const stage = document.getElementById('magic-cards-stage');
            const banner = document.getElementById('magic-winner-banner');
            if (!stage || !banner) return;
            const drawId = Number(drawPayload?.startTime || drawPayload?.createdAt || 0);
            if (!drawId || activeMagicDrawId === drawId) return;
            activeMagicDrawId = drawId;
            banner.classList.remove('show');

            const winnerTicket = String(drawPayload?.winnerId || '');
            if (!winnerTicket) return;

            getTicketsFromFirebaseDrawPool().then((tickets) => {
                if (!tickets.length) {
                    stage.innerHTML = '<div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:#f8e5a8; font-weight:700; text-align:center; padding:20px;">Нет билетов в Firebase /tickets</div>';
                    return;
                }

                const winner = tickets.find(t => String(t.num) === winnerTicket) || tickets[0];
                stage.innerHTML = '';
                stopMagicStarField();
                stopMagicAnimationFrame();

                const stars = buildStarNodesFromTickets(stage, tickets);
                const startServerMs = Number(drawPayload.startTime || 0);
                const totalMs = 60000;
                const gatherMs = 2000;
                const nowServer = getServerNowMs();
                const elapsed = Math.max(0, nowServer - startServerMs);

                const state = {
                    rafId: 0,
                    stars,
                    startServerMs,
                    totalMs,
                    gatherMs,
                    winner,
                    winnerShown: false,
                    cards: []
                };
                magicDrawAnimationState = state;

                const makeCards = () => {
                    if (state.cards.length) return;
                    stage.innerHTML = '';
                    state.cards = tickets.map(ticket => {
                        const card = createMagicCardMarkup(ticket, String(ticket.num) === String(winner.num));
                        card.dataset.baseRadius = String(50 + Math.random() * 70);
                        stage.appendChild(card);
                        requestAnimationFrame(() => card.classList.add('is-visible'));
                        return card;
                    });
                };

                const revealWinner = () => {
                    if (state.winnerShown) return;
                    state.winnerShown = true;
                    const winnerCard = state.cards.find(card => card.dataset.winner === '1');
                    state.cards.forEach(card => {
                        if (card !== winnerCard) {
                            const blastX = (Math.random() - 0.5) * 820;
                            const blastY = (Math.random() - 0.5) * 620;
                            card.classList.add('is-vanishing');
                            card.style.transform = `translate(calc(-50% + ${blastX}px), calc(-50% + ${blastY}px)) rotate(${(Math.random() - 0.5) * 360}deg) scale(0.18)`;
                        }
                    });
                    if (winnerCard) {
                        winnerCard.classList.add('is-focused');
                        winnerCard.style.left = '50%';
                        winnerCard.style.top = '50%';
                        winnerCard.style.transform = 'translate(-50%, -50%) scale(1.8) rotate(0deg)';
                        setTimeout(() => winnerCard.classList.add('is-revealed'), 500);
                    }
                    banner.classList.add('show');
                    document.getElementById('winner-display').innerHTML = `🏆 Билет №${winner.num}: <b>${winner.name}</b>`;
                    showWinnerToast(`✨ Победитель: ${winner.name} (билет №${winner.num})`);
                    launchCelebrationFireworks();
                    playFireworksSound();
                };

                const tick = () => {
                    if (!magicDrawAnimationState || magicDrawAnimationState !== state) return;
                    const serverNow = getServerNowMs();
                    const t = Math.max(0, serverNow - state.startServerMs);

                    if (t < state.gatherMs) {
                        const width = stage.clientWidth || 620;
                        const height = stage.clientHeight || 420;
                        const k = Math.min(1, t / state.gatherMs);
                        state.stars.forEach((star) => {
                            star.x += (width / 2 - star.x) * (0.04 + k * 0.12);
                            star.y += (height / 2 - star.y) * (0.04 + k * 0.12);
                            star.el.style.transform = `translate(${star.x}px, ${star.y}px)`;
                            star.el.style.opacity = String(1 - k * 0.2);
                        });
                    } else if (t < state.totalMs) {
                        makeCards();
                        const spinT = (t - state.gatherMs);
                        const whirl = (spinT / 1000) * 2.9;
                        state.cards.forEach((card, idx) => {
                            const base = card.dataset.baseRadius ? Number(card.dataset.baseRadius) : (58 + (idx % 8) * 10);
                            const radius = (base + Math.sin((spinT / 420) + idx) * 14) * 0.78;
                            const angle = whirl + idx * 0.8;
                            const tx = Math.cos(angle) * radius + Math.sin((spinT / 260) + idx) * 10;
                            const ty = Math.sin(angle * 1.22) * (radius * 0.62);
                            const rot = (angle * 180 / Math.PI);
                            const scale = 0.92 + (Math.sin(spinT / 330 + idx) + 1) * 0.07;
                            card.style.transform = `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) rotate(${rot}deg) scale(${scale})`;
                        });
                    } else {
                        makeCards();
                        revealWinner();
                        return;
                    }

                    state.rafId = requestAnimationFrame(tick);
                };

                if (elapsed >= totalMs) {
                    makeCards();
                    revealWinner();
                    return;
                }
                state.rafId = requestAnimationFrame(tick);
            }).catch((err) => {
                console.error('runSyncedRaffleAnimation failed:', err);
            });
        }

        async function adminPickWinnerNow() {
            if (currentUserId !== ADMIN_ID) return;
            const tickets = await getTicketsFromFirebaseDrawPool();
            if (!tickets.length) {
                alert('В папке /tickets Firebase нет активных билетов.');
                return;
            }
            const keys = Object.keys(tickets.reduce((acc, ticket) => {
                acc[String(ticket.num)] = true;
                return acc;
            }, {}));
            const randomIdx = Math.floor(Math.random() * keys.length);
            const winnerId = String(keys[randomIdx]);
            await db.ref('raffle_state').set({
                status: 'started',
                startTime: firebase.database.ServerValue.TIMESTAMP,
                winnerId,
                createdAt: firebase.database.ServerValue.TIMESTAMP,
                createdBy: currentUserId
            });
        }

        async function adminResetRaffleState() {
            if (currentUserId !== ADMIN_ID) return;
            await db.ref('raffle_state').set({
                status: 'ready',
                resetAt: firebase.database.ServerValue.TIMESTAMP,
                resetBy: currentUserId
            });
            activeMagicDrawId = null;
            stopMagicStarField();
            stopMagicAnimationFrame();
            closeWinnerToast();
            document.getElementById('winner-display').innerHTML = 'Готовы к магическому розыгрышу?';
            renderIdleMagicSky().catch(err => console.error('renderIdleMagicSky failed:', err));
        }

        function startContinuousWheelSpin() {}
        function stopContinuousWheelSpin() {
            stopMagicAnimationFrame();
            stopMagicStarField();
        }

        async function runWheelStopAnimationAndShowWinner(winnerTicket, winnerName, drawId) {
            runSyncedRaffleAnimation({ status: 'started', startTime: drawId, winnerId: winnerTicket, winnerName });
        }

        function renderWinnerHistory() {
            const preview = document.getElementById('winner-history-preview');
            const list = document.getElementById('winner-history-list');
            if (!preview || !list) return;
            if (!winnerHistoryItems.length) {
                preview.innerText = 'Пока победителей нет.';
                list.innerHTML = '';
                return;
            }
            const latest = winnerHistoryItems[0];
            preview.innerText = `${new Date(latest.createdAt || 0).toLocaleString('ru-RU')} · №${latest.ticket} · ${latest.winnerName}`;
            list.innerHTML = winnerHistoryItems.map((item, idx) => `<div class="news-item">${idx + 1}. ${new Date(item.createdAt || 0).toLocaleString('ru-RU')} · 🎟 ${item.ticket} · 👑 ${item.winnerName}</div>`).join('');
        }

        function toggleWinnerHistoryPanel() {
            toggleExpandablePanel('winner-history-list', 'winner-history-toggle-btn');
        }

        async function maybeActivateScheduledDraw() {}
        async function maybeFinalizeScheduledDraw() {}

        function updateAdminDrawStatus() {
            const el = document.getElementById('admin-draw-status');
            if (!el) return;
            const state = currentDrawSchedule?.status || 'ready';
            const start = currentDrawSchedule?.startTime ? new Date(currentDrawSchedule.startTime).toLocaleString('ru-RU') : '—';
            el.innerText = `Статус: ${state}. Синхронизация: raffle_state. Старт (сервер): ${start}.`;
        }

        async function adminScheduleDraw() {
            return alert('Запланированный запуск отключён. Используй кнопку «Начать магию» — запуск идёт через raffle_state для всех одновременно.');
        }

        async function adminAnnulDrawResults() {
            if (currentUserId !== ADMIN_ID) return;
            const ok = confirm('Точно сбросить розыгрыш и историю победителей?');
            if (!ok) return;
            await Promise.all([
                db.ref('raffle_state').set({ status: 'ready', resetAt: firebase.database.ServerValue.TIMESTAMP, resetBy: currentUserId }),
                db.ref('current_winner').set(null),
                db.ref('last_winner').set(null),
                db.ref('winners_history').set(null),
                db.ref('wheel_history').set(null)
            ]);
            winnerHistoryItems = [];
            renderWinnerHistory();
            activeMagicDrawId = null;
            stopContinuousWheelSpin();
            drawWheel();
            document.getElementById('winner-display').innerHTML = 'Результаты розыгрыша аннулированы.';
            closeWinnerToast();
            alert('Результаты розыгрыша аннулированы.');
        }

        function syncWheelSystems() {
            db.ref('.info/serverTimeOffset').on('value', snap => {
                raffleServerOffsetMs = Number(snap.val()) || 0;
            });

            if (winnerHistoryRef) winnerHistoryRef.off();
            winnerHistoryRef = db.ref('wheel_history').limitToLast(100);
            winnerHistoryRef.on('value', snap => {
                const items = [];
                snap.forEach(item => items.push(item.val() || {}));
                winnerHistoryItems = items.reverse();
                renderWinnerHistory();
            });

            if (drawScheduleRef) drawScheduleRef.off();
            drawScheduleRef = db.ref('raffle_state');
            drawScheduleRef.on('value', async (snap) => {
                currentDrawSchedule = snap.val() || { status: 'ready' };
                updateAdminDrawStatus();

                if (currentDrawSchedule.status === 'started' && currentDrawSchedule.startTime && currentDrawSchedule.winnerId) {
                    runSyncedRaffleAnimation(currentDrawSchedule);
                    const finishAt = Number(currentDrawSchedule.startTime) + 60000;
                    if (getServerNowMs() >= finishAt && !currentDrawSchedule.completedAt) {
                        const tx = await db.ref('raffle_state').transaction(v => {
                            if (!v || v.status !== 'started' || v.completedAt) return v;
                            return { ...v, status: 'completed', completedAt: firebase.database.ServerValue.TIMESTAMP };
                        });
                        if (tx.committed) {
                            const finalState = tx.snapshot.val() || {};
                            const tickets = await getTicketsFromFirebaseDrawPool();
                            const winnerTicket = String(finalState.winnerId || '');
                            const winner = tickets.find(t => String(t.num) === winnerTicket) || { num: winnerTicket, name: 'Игрок', userId: null };
                            const doneAt = Number(finalState.completedAt) || Date.now();
                            await db.ref('current_winner').set({ ticket: String(winner.num), winnerName: winner.name, userId: winner.userId || null, createdAt: doneAt, source: 'raffle_state_sync' });
                            await db.ref('last_winner').set({ ticket: String(winner.num), winnerName: winner.name, userId: winner.userId || null, createdAt: doneAt, source: 'raffle_state_sync' });
                            await db.ref('winners_history').push({ ticket: String(winner.num), winnerName: winner.name, userId: winner.userId || null, createdAt: doneAt, source: 'raffle_state_sync' });
                            await db.ref('wheel_history').push({
                                drawId: Number(finalState.startTime) || doneAt,
                                ticket: String(winner.num),
                                winnerName: winner.name,
                                createdAt: doneAt
                            });
                        }
                    }
                    return;
                }

                if (currentDrawSchedule.status === 'ready') {
                    activeMagicDrawId = null;
                    stopContinuousWheelSpin();
                    closeWinnerToast();
                    document.getElementById('winner-display').innerHTML = 'Готовы к магическому розыгрышу?';
                    renderIdleMagicSky().catch(err => console.error('renderIdleMagicSky failed:', err));
                }
            });
        }

        async function adminStartNewRound() {
	    const d = parseInt(document.getElementById('r-days').value) || 0;
	    const h = parseInt(document.getElementById('r-hours').value) || 0;
	    const m = parseInt(document.getElementById('r-mins').value) || 0;
	    const durationMs = (d * 86400000) + (h * 3600000) + (m * 60000);

	    if (durationMs <= 0) return alert("Укажите время раунда!");

	    const startAtRaw = String(document.getElementById('round-start-at')?.value || '').trim();
	    if (startAtRaw) {
	        const parser = (typeof window.parseMoscowDateTimeLocalInput === 'function')
	            ? window.parseMoscowDateTimeLocalInput
	            : (value) => new Date(value).getTime();
	        const parsedStartAt = Number(parser(startAtRaw));
	        const now = Number(window.getAdminNow?.() || Date.now());
	        if (Number.isFinite(parsedStartAt) && parsedStartAt > now) {
	            if (typeof window.adminScheduleRound === 'function') {
	                await window.adminScheduleRound();
	                return;
	            }
	        }
	    }

    await archiveAndClearBoard();
    let free = []; for(let i=0; i<50; i++) free.push(i);

    const magicCell = free.length ? free.splice(Math.floor(Math.random() * free.length), 1)[0] : null;
    const miniGameCell = free.length ? free.splice(Math.floor(Math.random() * free.length), 1)[0] : null;
    const wordSketchCell = free.length ? free.splice(Math.floor(Math.random() * free.length), 1)[0] : null;
    const magnetCell = free.length ? free.splice(Math.floor(Math.random() * free.length), 1)[0] : null;

    const itemCells = {};
    const itemPool = ['goldenPollen', 'magicWand', 'magnifier', 'cloak', 'inkSaboteur'];
    for (const itemType of itemPool) {
        if (!free.length) break;
        const idx = free.splice(Math.floor(Math.random() * free.length), 1)[0];
        itemCells[idx] = itemType;
    }

    let traps = [];
    // Ставим 2 ловушки на свободные клетки
    for(let j=0; j<2; j++) {
        if(free.length) {
            const randomIndex = Math.floor(Math.random() * free.length);
            traps.push(free.splice(randomIndex, 1)[0]);
        }
    }

    const s = await db.ref('current_round/number').once('value');
    const newRoundNum = (s.val() || 0) + 1;

    // Сохраняем в Firebase
    await db.ref('current_round').set({
        number: newRoundNum,
        startedAt: Date.now(),
        durationMs,
        endTime: Date.now() + durationMs,
        traps: traps,
        magicCell: magicCell,
        miniGameCell: miniGameCell,
        wordSketchCell: wordSketchCell,
        magnetCell: magnetCell,
        itemCells
    });

    await postNews(`Раунд #${newRoundNum} начался`);

	    alert(`Раунд №${newRoundNum} успешно запущен!\nДлительность: ${d}д ${h}ч ${m}м`);
	}

        function pickRandom(arr) {
            if (!arr.length) return null;
            return arr[Math.floor(Math.random() * arr.length)];
        }

        function shuffleArray(arr) {
            const copy = [...arr];
            for (let i = copy.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [copy[i], copy[j]] = [copy[j], copy[i]];
            }
            return copy;
        }

        async function getUsedCharIndexes() {
            const snap = await db.ref('whitelist').once('value');
            const used = new Set();
            snap.forEach(userSnap => {
                const idx = userSnap.val()?.charIndex;
                if (Number.isInteger(idx) && players[idx]) used.add(idx);
            });
            return used;
        }

        async function saveNewUserRandomly() {
            if (!isAdminUser()) return alert('Эта функция доступна только администратору.');
            const id = document.getElementById('new-user-id').value;
            if (!id) return;

            const existing = await db.ref('whitelist/' + id).once('value');
            if (existing.exists()) {
                alert('Этот Telegram ID уже есть в списке игроков.');
                return;
            }

            const used = await getUsedCharIndexes();
            const freeIndexes = players
                .map((_, idx) => idx)
                .filter(idx => !used.has(idx));

            if (!freeIndexes.length) {
                alert('Свободные никнеймы закончились. Удалите игрока или расширьте пул ников.');
                return;
            }

            const charIndex = pickRandom(freeIndexes);
            await db.ref('whitelist/' + id).set({
                charIndex,
                used_tasks: [],
                last_round: 0
            });
            document.getElementById('new-user-id').value = "";
        }

        async function adminReplaceAllNicknames() {
            if (currentUserId !== ADMIN_ID) return;
            if (!confirm('Заменить всем игрокам никнеймы на новые случайные из полного пула?')) return;

            const snap = await db.ref('whitelist').once('value');
            const users = [];
            snap.forEach(userSnap => {
                users.push({
                    userId: userSnap.key,
                    currentCharIndex: userSnap.val()?.charIndex
                });
            });

            if (!users.length) {
                alert('Список игроков пуст.');
                return;
            }

            if (users.length > players.length) {
                alert('Игроков больше, чем доступных никнеймов. Невозможно выдать уникальные имена всем.');
                return;
            }

            const shuffledNickIndexes = shuffleArray(players.map((_, idx) => idx)).slice(0, users.length);

            if (users.length > 1) {
                for (let i = 0; i < users.length; i++) {
                    if (shuffledNickIndexes[i] !== users[i].currentCharIndex) continue;

                    const swapIdx = shuffledNickIndexes.findIndex((nickIdx, j) => {
                        if (i === j) return false;
                        const myCurrent = users[i].currentCharIndex;
                        const otherCurrent = users[j].currentCharIndex;
                        return nickIdx !== myCurrent && shuffledNickIndexes[i] !== otherCurrent;
                    });

                    if (swapIdx !== -1) {
                        [shuffledNickIndexes[i], shuffledNickIndexes[swapIdx]] = [shuffledNickIndexes[swapIdx], shuffledNickIndexes[i]];
                    }
                }
            }

            const updates = {};
            users.forEach((user, i) => {
                updates[`whitelist/${user.userId}/charIndex`] = shuffledNickIndexes[i];
            });

            await db.ref().update(updates);
            alert('Никнеймы всех игроков успешно заменены (уникально и случайно).');
        }


        function fillAdminNickOptions() {
            const sel = document.getElementById('admin-rename-char-index');
            if (!sel) return;
            sel.innerHTML = players.map((p, idx) => `<option value="${idx}">${idx + 1}. ${p.n}</option>`).join('');
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
            if (Number(userId) === Number(ADMIN_ID)) return alert('Администратор не участвует в сезоне и не может получать билеты.');
            const count = Math.max(1, Number(document.getElementById('admin-grant-ticket-count')?.value || 1));
            const note = (document.getElementById('admin-grant-ticket-note')?.value || '').trim();
            if (!userId) return alert('Укажи Telegram ID игрока.');
            const userSnap = await db.ref(`whitelist/${userId}`).once('value');
            const user = userSnap.val();
            if (!user || !Number.isInteger(user.charIndex) || !players[user.charIndex]) return alert('Игрок не найден или у него не назначен никнейм.');

            const awarded = await claimSequentialTickets(count);
            if (!awarded?.length) return alert(`Лимит билетиков (${MAX_TICKETS}) уже достигнут в этой игре.`);
            const ticketValue = awarded.join(' и ');
            await db.ref('tickets_archive').push({
                owner: user.charIndex,
                userId: Number(userId),
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
            await postNews(`🎫 Администратор выдал(а) ${count} билет(ов) игроку ${players[user.charIndex].n}.${notePart}`);
            alert(`Готово! Выдано билетиков: ${count}. Номера: ${ticketValue}.${note ? `\nПометка: ${note}` : ''}`);
        }


        async function adminRevokeTicketsFromPlayer() {
            if (currentUserId !== ADMIN_ID) return;
            const userId = (document.getElementById('admin-revoke-ticket-user-id')?.value || '').trim();
            const count = Math.max(1, Number(document.getElementById('admin-revoke-ticket-count')?.value || 1));
            const note = (document.getElementById('admin-revoke-ticket-note')?.value || '').trim();
            if (!userId) return alert('Укажи Telegram ID игрока.');

            const userSnap = await db.ref(`whitelist/${userId}`).once('value');
            const user = userSnap.val();
            if (!user || !Number.isInteger(user.charIndex) || !players[user.charIndex]) return alert('Игрок не найден или у него не назначен никнейм.');

            const targetTickets = getActiveTicketsForWheel()
                .filter(t => Number(t.owner) === Number(user.charIndex))
                .map(t => String(t.num))
                .sort((a, b) => Number(b) - Number(a));
            if (!targetTickets.length) return alert('У этого игрока нет активных билетиков для изъятия.');

            const toRevoke = targetTickets.slice(0, count);
            const revokeSet = new Set(toRevoke);
            const updates = {};

            allTicketsData.forEach(t => {
                if (t.excluded) return;
                if (Number(t.owner) !== Number(user.charIndex) && Number(t.userId) !== Number(userId)) return;
                const nums = extractTicketNumbers(t.ticket);
                if (!nums.length) return;
                const left = nums.filter(n => !revokeSet.has(String(n)));
                if (left.length === nums.length) return;

                if (t.isArchived && t.archiveKey) {
                    updates[`tickets_archive/${t.archiveKey}/ticket`] = left.join(' и ');
                    updates[`tickets_archive/${t.archiveKey}/excluded`] = left.length === 0;
                } else if (Number.isInteger(t.cellIdx) && t.cellIdx >= 0) {
                    updates[`board/${t.cellIdx}/ticket`] = left.join(' и ');
                    updates[`board/${t.cellIdx}/excluded`] = left.length === 0;
                }
            });

            if (!Object.keys(updates).length) return alert('Не удалось найти подходящие билетики для изъятия. Попробуй обновить страницу.');
            const revokedText = toRevoke.join(' и ');
            const archiveKey = db.ref('tickets_archive').push().key;
            updates[`tickets_archive/${archiveKey}`] = {
                owner: user.charIndex,
                userId: Number(userId),
                ticket: revokedText,
                taskIdx: -1,
                round: currentRoundNum,
                cell: 0,
                cellIdx: -1,
                isManualRevoke: true,
                adminNote: note || null,
                taskLabel: note ? `Ручное изъятие: ${note}` : 'Ручное изъятие администратором',
                archivedAt: Date.now(),
                excluded: true
            };

            await db.ref().update(updates);
            const notePart = note ? ` Причина: ${note}` : '';
            await postNews(`🧾 Администратор отозвал(а) билет(ы) ${revokedText} у игрока ${players[user.charIndex].n}.${notePart}`);
            alert(`Готово! Отозвано билетиков: ${toRevoke.length}. Номера: ${revokedText}.${note ? `
Пометка: ${note}` : ''}`);
        }

        async function adminTeleportPlayerToStart() {
            if (currentUserId !== ADMIN_ID) return;
            const userId = (document.getElementById('admin-teleport-user-id')?.value || '').trim();
            if (!/^\d+$/.test(userId)) return alert('Укажи корректный ID игрока.');

            const [userSnap, boardSnap] = await Promise.all([
                db.ref(`whitelist/${userId}`).once('value'),
                db.ref('board').once('value')
            ]);
            const user = userSnap.val() || {};
            if (!userSnap.exists() || !Number.isInteger(user.charIndex) || !players[user.charIndex]) {
                return alert('Игрок не найден или у него не назначен никнейм.');
            }

            const board = boardSnap.val() || {};
            const updates = {};
            Object.entries(board).forEach(([idx, cell]) => {
                if (!cell) return;
                if (String(cell.userId) !== String(userId)) return;
                updates[`board/${idx}`] = null;
            });

            updates[`whitelist/${userId}/last_round`] = 0;
            updates[`whitelist/${userId}/used_tasks`] = [];
            await db.ref().update(updates);
            await postNews(`⏮️ Администратор переставил(а) игрока ${players[user.charIndex].n} на старт.`);
            alert('Готово! Игрок переставлен на старт.');
        }

        async function adminRestartPlayerCurrentCell() {
            if (currentUserId !== ADMIN_ID) return;
            const userId = (document.getElementById('admin-teleport-user-id')?.value || '').trim();
            if (!/^\d+$/.test(userId)) return alert('Укажи корректный ID игрока.');

            const [userSnap, boardSnap] = await Promise.all([
                db.ref(`whitelist/${userId}`).once('value'),
                db.ref('board').once('value')
            ]);
            const user = userSnap.val() || {};
            if (!userSnap.exists() || !Number.isInteger(user.charIndex) || !players[user.charIndex]) {
                return alert('Игрок не найден или у него не назначен никнейм.');
            }

            const board = boardSnap.val() || {};
            const candidateEntries = Object.entries(board)
                .filter(([_, cell]) => cell && String(cell.userId) === String(userId) && !cell.excluded)
                .sort((a, b) => Number(b[0]) - Number(a[0]));
            if (!candidateEntries.length) return alert('У игрока нет активной клетки для перезапуска.');

            const [cellIdx, cell] = candidateEntries[0];
            const updatedCell = { ...cell, restartedAt: Date.now(), restartedByAdmin: Number(currentUserId) };

            if (!String(updatedCell.ticket || '').trim() && !updatedCell.isMiniGame && !updatedCell.isWordSketch) {
                const awarded = await claimSequentialTickets(1);
                if (awarded?.length) updatedCell.ticket = awarded[0];
            }

            await db.ref(`board/${cellIdx}`).set(updatedCell);
            await postNews(`🔁 Администратор перезапустил(а) текущую клетку игрока ${players[user.charIndex].n} (№${Number(cellIdx) + 1}).`);
            alert(`Готово! Клетка №${Number(cellIdx) + 1} перезапущена.`);
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

      function syncAdminList() {
            if (!isAdminUser()) return;
            db.ref('whitelist').on('value', snap => {
                const users = [];
                snap.forEach(u => {
                    const userData = u.val() || {};
                    const rawCharIndex = userData.charIndex;
                    const parsedCharIndex = Number(rawCharIndex);
                    const charIndex = Number.isInteger(parsedCharIndex) ? parsedCharIndex : null;
                    const gameplayNickname = Number.isInteger(charIndex) && players[charIndex]?.n
                        ? String(players[charIndex].n || '').trim()
                        : '';
                    const telegramName = String(
                        userData.telegramFirstName
                        || userData.telegram_name
                        || userData.first_name
                        || userData.name
                        || userData.username
                        || ''
                    ).trim();
                    users.push({
                        userTgId: String(u.key),
                        charIndex,
                        gameplayNickname,
                        telegramName
                    });
                });

                users.sort((a, b) => {
                    const aIdx = Number.isInteger(a.charIndex) ? a.charIndex : 999;
                    const bIdx = Number.isInteger(b.charIndex) ? b.charIndex : 999;
                    if (aIdx !== bIdx) return aIdx - bIdx;
                    return String(a.userTgId).localeCompare(String(b.userTgId));
                });

                let h = `<b>Список игроков (${users.length}):</b><div style="max-height:55vh; overflow-y:auto; margin-top:6px;">`;
                users.forEach(({ userTgId, charIndex, gameplayNickname, telegramName }) => {
                    const nickname = gameplayNickname || telegramName || `Игрок ${userTgId}`;
                    const safeNickname = escapeHtml(nickname);
                    const safeTelegramName = escapeHtml(telegramName || '—');
                    const charColor = Number.isInteger(charIndex) ? (charColors[charIndex] || "#333") : "#333";

                    h += `
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; font-size:12px; padding:6px 0; border-bottom:1px solid #eee;">
                        <span style="text-align:left; word-break:break-word; line-height:1.4;">
                            <b style="color:${charColor}">${safeNickname}</b> | <code style="color:#666;">${escapeHtml(userTgId)}</code> | <span style="color:#666;">${safeTelegramName}</span>
                        </span>
                        <button onclick="kick('${userTgId}')" style="color:red; border:1px solid red; border-radius:5px; background:none; padding:2px 6px; font-size:10px; flex-shrink:0;">Удалить</button>
                    </div>`;
                });

                h += '</div>';
                if (!users.length) h += '<small style="color:#999;">Пока список пуст.</small>';
                document.getElementById('active-players').innerHTML = h;
            });
        }

        async function archiveAndClearBoard() {
            const boardSnap = await db.ref('board').once('value');
            const board = boardSnap.val() || {};
            const updates = {};

            Object.entries(board).forEach(([cellIdx, cell]) => {
                if (!cell) return;
                const archiveKey = db.ref('tickets_archive').push().key;
                updates[`tickets_archive/${archiveKey}`] = {
                    ...cell,
                    cell: Number(cellIdx) + 1,
                    cellIdx: Number(cellIdx),
                    archivedAt: Date.now()
                };
            });

            updates['board'] = {};
            await db.ref().update(updates);
        }

        function toggleAdminPlayersList() {
            if (!isAdminUser()) return;
            const wrap = document.getElementById('active-players-wrap');
            const btn = document.getElementById('admin-players-toggle-btn')
                || document.querySelector('#tab-admin #admin-players-section button[onclick="toggleAdminPlayersList()"]');
            if (!wrap || !btn) return;
            const expanded = getComputedStyle(wrap).display !== 'none';
            wrap.style.display = expanded ? 'none' : 'block';
            btn.innerText = expanded ? '👥 Список игроков: развернуть' : '👥 Список игроков: свернуть';
        }

        function kick(id) {
            if (!isAdminUser()) return;
            if(confirm("Удалить?")) db.ref('whitelist/'+id).remove();
        }
        async function adminResetGame() {
            if (!isAdminUser()) return alert('Эта функция доступна только администратору.');
            if (!confirm('Подтвердить сброс текущей сессии?')) return;
            if (!confirm('Это удалит players/ и игровые пулы. Карма сезона сохранится. Продолжить?')) return;

            const whitelistSnap = await db.ref('whitelist').once('value');
            const updates = {
                players: null,
                board: {},
                tickets_archive: null,
                submissions: null,
                game_event: null,
                game_events: null,
                epic_paint: null,
                ticket_counter: 0,
                wheel_event: null,
                wheel_draw: null,
                raffle_state: { status: 'ready' },
                wheel_history: null,
                current_winner: null,
                last_winner: null,
                winners_history: null,
                current_round: {
                    number: 0,
                    endTime: 0,
                    traps: [],
                    magicCell: null,
                    miniGameCell: null,
                    wordSketchCell: null,
                    magnetCell: null,
                    itemCells: {}
                }
            };

            whitelistSnap.forEach(userSnap => {
                const uid = userSnap.key;
                updates[`whitelist/${uid}/inventory`] = { goldenPollen: 0, inkSaboteur: 0, magnifier: 0, cloak: 0 };
                updates[`whitelist/${uid}/magnifier_used_round`] = 0;
                updates[`whitelist/${uid}/last_round`] = 0;
                updates[`whitelist/${uid}/used_tasks`] = [];
                updates[`whitelist/${uid}/isEliminated`] = false;
                updates[`whitelist/${uid}/eliminatedAt`] = null;
                updates[`whitelist/${uid}/eliminatedAtRound`] = null;
                updates[`whitelist/${uid}/eliminationReason`] = null;
                updates[`whitelist/${uid}/ink_challenge`] = null;
                updates[`whitelist/${uid}/wand_blessing`] = null;
            });

            await db.ref().update(updates);
            alert('Игра сброшена полностью: поле, раунды, билеты, предметы, лента событий и работы очищены. Нажми «Запустить раунд», чтобы начать заново.');
            location.reload();
        }
        async function adminFullReset() {
            if (!isAdminUser()) return alert('Эта функция доступна только администратору.');
            alert('player_season_status защищен от полного сброса. Очистка отключена.');
        }
        async function adminTriggerSpin() {
            if (!isAdminUser()) return;
            await adminPickWinnerNow();
        }

        function switchTab(id, el) {
            const isAdminTab = id === 'tab-admin';
            if (isAdminTab && !isAdminUser()) {
                const gameNavBtn = document.querySelector('.nav-item[onclick*="tab-game"]');
                id = 'tab-game';
                el = gameNavBtn || el;
            }

            const nextTab = document.getElementById(id);
            if (!nextTab) return;

            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('tab-active'));
            nextTab.classList.add('tab-active');
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            if (el) el.classList.add('active');

            const adminPlayersSection = document.getElementById('admin-players-section');
            const adminEmergencySection = document.getElementById('admin-emergency-section');
            const showAdminWindows = isAdminUser() && id === 'tab-admin';
            if (adminPlayersSection) adminPlayersSection.style.display = showAdminWindows ? '' : 'none';
            if (adminEmergencySection) adminEmergencySection.style.display = showAdminWindows ? '' : 'none';

            if (id === 'tab-wheel') drawWheel();
            if (id === 'tab-works') {
                fillSubmissionTaskOptions();
                renderSubmissions();
            }
            if (id === 'tab-gallery' && typeof renderGalleryTab === 'function') renderGalleryTab();
        }
        function closeModal() { document.getElementById('modal').style.display='none'; document.getElementById('overlay').style.display='none'; }
        function openRulesScroll() {
            const btn = document.querySelector('.nav-item[onclick*="tab-rules"]');
            switchTab('tab-rules', btn);
        }

        function switchRulesSubtab(tabName) {
            const tabs = ['items', 'events', 'cells'];
            tabs.forEach(name => {
                const btn = document.getElementById(`rules-tab-${name}-btn`);
                const panel = document.getElementById(`rules-panel-${name}`);
                const active = name === tabName;
                btn?.classList.toggle('active', active);
                panel?.classList.toggle('active', active);
                if (panel) panel.style.display = active ? 'block' : 'none';
            });
        }


        /* Inlined modules: items, tickets, events, admin, works */

                window.__itemsContext = {
            get db() { return db; },
            get waitForDbReady() { return waitForDbReady; },
            get currentUserId() { return currentUserId; },
            get currentUserPathId() { return currentUserPathId; },
            get currentRoundNum() { return currentRoundNum; },
            get myInventory() { return myInventory; },
            get tasks() { return tasks; },
            get players() { return players; },
            get myIndex() { return myIndex; },
            get ADMIN_ID() { return ADMIN_ID; },
            get charColors() { return charColors; },
            get postNews() { return postNews; },
            get showCell() { return showCell; },
            get itemTypes() { return window.itemTypes; },
            get inkChallengeOptions() { return window.inkChallengeOptions; },
            get fillAdminItemsFormDefaults() { return fillAdminItemsFormDefaults; },
            get renderAdminItemsPlayersList() { return renderAdminItemsPlayersList; }
        };

        window.__duelContext = {
            get db() { return db; },
            get firebase() { return firebase; },
            get currentUserId() { return currentUserId; },
            get currentRoundNum() { return currentRoundNum; },
            get players() { return players; },
            get myIndex() { return myIndex; },
            get CALLIGRAPHY_SYMBOLS() { return CALLIGRAPHY_SYMBOLS; },
            get IMPULSE_COOLDOWN_MS() { return IMPULSE_COOLDOWN_MS; },
            get DUEL_INVITE_TTL_MS() { return DUEL_INVITE_TTL_MS; },
            get DUEL_PATH() { return DUEL_PATH; },
            get DUEL_REWARD_ITEMS() { return DUEL_REWARD_ITEMS; },
            get itemTypes() { return window.itemTypes || {}; },
            getServerNowMs,
            postNews,
            claimSequentialTickets: (...args) => window.claimSequentialTickets?.(...args),
            launchCelebrationFireworks,
            showPlayerNotification,
            closePlayerNotification,
            isPlayerNotificationDismissed,
            resetMiniEventBadge,
            getPlayerNotificationBorderColor,
            decodeText(value) { return decodeURIComponent(String(value || '')); }
        };

// BEGIN items.js
        window.__initItemsModule?.(window.__itemsContext);
        // END items.js

        // BEGIN Tickets.js
        window.__initTicketsModule?.();
        // END Tickets.js

        

        // BEGIN mushu_event.js
        (function () {
          const EVENT_PATH = 'mushu_event';
          const GAME_EVENTS_PATH = 'game_events';
          const MUSHU_EVENT_ID = 'mushu_feast';
          const GOLDEN_CUPCAKE_GRACE_MS = 5 * 60 * 1000;
          const FRUITS = [
            { id: 'apple', emoji: '🍎', label: 'Яблоко', satiety: 1 },
            { id: 'cherry', emoji: '🍒', label: 'Вишня', satiety: 1 },
            { id: 'pear', emoji: '🍐', label: 'Груша', satiety: 1 },
            { id: 'peach', emoji: '🍑', label: 'Персик', satiety: 1 }
          ];
          const GOLDEN_CUPCAKE = { id: 'golden_cupcake', emoji: '🧁', label: 'Золотой кекс', satiety: 6 };
          const SUCCESS_TITLE = '✨ Мушу сыт и доволен!';
          const SUCCESS_TEXT = 'Р-р-рар! Игроки накормили дракончика, магия активирована! 🐲';
          const FAILED_TITLE = '🚫 Время вышло.';
          const FAILED_TEXT = 'Мушу остался голодным и ушел ворчать в свой храм... 🥟';

          let mushuRef = null;
          let mushuState = { status: 'idle', current_satiety: 0, target: 15, participants: {}, fed_users: {}, rewards: {} };
          let localFruit = null;
          let timerId = null;
          let dragState = null;
          let statusToastShown = '';
          let lastFeedResultLogged = '';
          let mushuServerOffsetMs = 0;
          let mushuOffsetRef = null;

          const $ = (id) => document.getElementById(id);
          const uid = () => String(window.currentUserId || currentUserId || '').trim();
          const getNow = () => Date.now() + (Number(mushuServerOffsetMs) || 0);
          const isActive = () => String(mushuState.status || '') === 'active';
          const isAdminUser = () => Number(window.currentUserId || currentUserId || 0) === Number(window.ADMIN_ID || ADMIN_ID);
          const isKnownFruitId = (id) => id === GOLDEN_CUPCAKE.id || FRUITS.some((fruit) => fruit.id === id);
          const resolveFruitIdFromEntry = (entry) => {
            if (!entry) return null;
            if (typeof entry === 'string') return isKnownFruitId(entry) ? entry : null;
            const id = entry.id || entry.fruitId || entry.fruit || null;
            return isKnownFruitId(id) ? id : null;
          };
          const ensureDb = async () => {
            if (window.db && typeof window.db.ref === 'function') return window.db;
            if (typeof window.waitForDbReady === 'function') return window.waitForDbReady();
            throw new Error('db not ready');
          };

          function randomGift() {
            const pool = [
              { id: 'ticket_1', label: '🎫 1 билет' },
              { id: 'ticket_2', label: '🎫 2 билета' },
              { id: 'magnifier', label: '🔎 Лупа' },
              { id: 'goldenPollen', label: '🎇 Золотая пыльца' }
            ];
            return pool[Math.floor(Math.random() * pool.length)];
          }

          function getMyPersonalFruit() {
            const me = uid();
            if (!me) return null;
            const personal = mushuState.personal_fruits?.[me] || mushuState.participants?.[me]?.item || null;
            const fruitId = resolveFruitIdFromEntry(personal);
            if (!fruitId) return null;
            if (fruitId === GOLDEN_CUPCAKE.id) {
              const pickedAt = Number(personal?.pickedAt || 0);
              const graceLeft = Math.max(0, GOLDEN_CUPCAKE_GRACE_MS - (getNow() - pickedAt));
              if (pickedAt > 0 && graceLeft === 0) return { ...FRUITS[Math.floor(Math.random() * FRUITS.length)] };
              return { ...GOLDEN_CUPCAKE, graceLeftMs: graceLeft };
            }
            const fallback = FRUITS.find((f) => f.id === fruitId) || FRUITS[0];
            return { ...fallback };
          }

          function buildFallbackFruitForUser(userId) {
            const normalizedUid = String(userId || '').trim();
            if (!normalizedUid) return null;
            const luckyUid = String(mushuState.lucky_cupcake_uid || '');
            if (luckyUid && luckyUid === normalizedUid) return { ...GOLDEN_CUPCAKE, graceLeftMs: GOLDEN_CUPCAKE_GRACE_MS };
            const salt = `${normalizedUid}:${String(mushuState.startedAt || mushuState.endAt || 0)}`;
            const hash = Array.from(salt).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
            return { ...FRUITS[hash % FRUITS.length] };
          }

          function getDragonMarkup() {
            return '<div id="mushu-container" class="mushu-container"><span class="smoke-particle left"></span><span class="smoke-particle right"></span></div>';
          }

          function ensureMushuUi() {
            if ($('mushu-overlay')) return;
            const overlay = document.createElement('div');
            overlay.id = 'mushu-overlay';
            overlay.className = 'mushu-overlay';
            overlay.innerHTML = `<div style="display:flex; align-items:center; justify-content:space-between; gap:8px;"><b>🐉 Покорми Мушу</b><button id="mushu-back-btn" class="event-back-btn">Вернуться на поле</button></div>
              <div style="margin-top:8px; text-align:left; font-size:13px;">Сытость: <b id="mushu-satiety-text">0 / 0</b></div>
              <div class="mushu-progress-bar"><div id="mushu-progress-fill" class="mushu-progress-fill"></div></div>
              <div id="mushu-combo-text" style="margin-top:6px; font-size:12px; color:#ffe082;"></div>
              <div id="mushu-fuse-timer" class="mushu-fuse-timer"><div style="font-size:12px; margin-bottom:6px;">Магический фитиль: <b id="mushu-time-left">--:--</b></div><div class="mushu-fuse-track"><div id="mushu-fuse-burn" class="mushu-fuse-burn"><span class="mushu-fuse-spark"></span></div></div></div>
              <div class="mushu-dragon-zone"><div id="mushu-dragon" class="mushu-dragon">${getDragonMarkup()}</div><div id="mushu-mouth-zone" class="mushu-mouth-zone"></div></div>
              <div id="mushu-fruit-panel" class="mushu-fruit-panel"></div>`;
            document.body.appendChild(overlay);
            $('mushu-back-btn')?.addEventListener('click', closeMushuOverlay);

            const invite = $('mushu-inline-invite');
            if (invite) {
              invite.addEventListener('click', (ev) => {
                const btn = ev.target.closest('.mushu-inline-btn');
                if (!btn) return;
                openMushuOverlay();
              });
            }
          }

          function updateInlineInvite() {
            const invite = $('mushu-inline-invite');
            if (!invite) return;
            if (!isActive()) {
              invite.style.display = 'none';
              const topNotification = $('event-notification');
              if (topNotification?.dataset?.eventType === MUSHU_EVENT_ID) {
                topNotification.style.display = 'none';
                topNotification.classList.remove('event-notification-pink');
                topNotification.innerHTML = '';
                delete topNotification.dataset.eventType;
              }
              return;
            }
            invite.style.display = 'block';
            const topNotification = $('event-notification');
            if (topNotification) {
              topNotification.style.display = 'block';
              topNotification.classList.add('event-notification-pink');
              topNotification.dataset.eventType = MUSHU_EVENT_ID;
              topNotification.innerHTML = '<div class="event-notification-text">🔥 Начался ивент: Покорми Мушу!</div><button id="btn-join-mushu-event" class="event-notification-join">Перейти</button>';
              const joinBtn = $('btn-join-mushu-event');
              if (joinBtn) joinBtn.onclick = () => openMushuOverlay();
            }
            if (isAdminUser()) {
              invite.innerHTML = `<div style="font-weight:800; font-size:14px;">🔥 Мушу проголодался!</div><div style="font-size:12px; margin-top:4px;">Режим наблюдателя</div><button class="mushu-inline-btn">Наблюдать</button>`;
              return;
            }
            invite.innerHTML = `<div style="font-weight:800; font-size:14px;">🔥 Мушу проголодался!</div><div style="font-size:12px; margin-top:4px;">Перетащи свой фрукт в пасть дракона и помоги команде.</div><button class="mushu-inline-btn">Помочь Мушу</button>`;
          }

          function openMushuOverlay() {
            const overlay = $('mushu-overlay');
            if (!overlay) return;
            overlay.style.display = 'flex';
            document.body.classList.add('event-mode');
            renderFruitPanel().catch((e) => console.error('renderFruitPanel failed', e));
          }

          function closeMushuOverlay() {
            clearFruitDragState();
            const overlay = $('mushu-overlay');
            if (overlay) overlay.style.display = 'none';
            document.body.classList.remove('event-mode');
          }

          async function ensureMyFruitAssigned() {
            const me = uid();
            if (!me || !isActive()) return getMyPersonalFruit();
            if (isAdminUser()) return null;

            const personalFruitId = resolveFruitIdFromEntry(mushuState.personal_fruits?.[me]);
            const participantFruitId = resolveFruitIdFromEntry(mushuState.participants?.[me]?.item);
            const existing = personalFruitId || participantFruitId;
            if (existing) {
              if (!personalFruitId && participantFruitId) {
                mushuState.personal_fruits = mushuState.personal_fruits || {};
                mushuState.personal_fruits[me] = { ...mushuState.participants[me].item };
              }
              return getMyPersonalFruit();
            }

            const db = await ensureDb();
            const luckyUid = String(mushuState.lucky_cupcake_uid || '');
            const fruitId = luckyUid && luckyUid === me
              ? GOLDEN_CUPCAKE.id
              : (FRUITS[Math.floor(Math.random() * FRUITS.length)] || FRUITS[0]).id;
            const fallbackAssigned = { id: fruitId, pickedAt: Date.now() };

            const tx = await db.ref(`${EVENT_PATH}/participants/${me}/item`).transaction((v) => {
              if (v?.id && isKnownFruitId(v.id)) return v;
              return fallbackAssigned;
            });
            const txAssigned = tx.snapshot?.val();
            const assigned = txAssigned?.id && isKnownFruitId(txAssigned.id) ? txAssigned : fallbackAssigned;
            await db.ref(`${EVENT_PATH}/personal_fruits/${me}`).transaction((v) => {
              if (v?.id && isKnownFruitId(v.id)) return v;
              return assigned;
            });

            mushuState.personal_fruits = mushuState.personal_fruits || {};
            mushuState.personal_fruits[me] = assigned;
            mushuState.participants = mushuState.participants || {};
            mushuState.participants[me] = mushuState.participants[me] || {};
            mushuState.participants[me].item = assigned;
            return getMyPersonalFruit();
          }

          async function renderFruitPanel() {
            const panel = $('mushu-fruit-panel');
            if (!panel) return;
            clearFruitDragState();
            const me = uid();
            if (isAdminUser()) {
              panel.innerHTML = '<div style="font-weight:700; color:#ffe082;">Ты в режиме наблюдателя: администратор не участвует в событии.</div>';
              return;
            }
            const alreadyFed = Boolean(mushuState.fed_users?.[me]);
            localFruit = getMyPersonalFruit();

            if (alreadyFed) {
              panel.innerHTML = '<div style="font-weight:700; color:#c8e6c9;">Твой шанс использован! Жди общий итог ивента.</div>';
              return;
            }

            if (!localFruit) {
              try {
                localFruit = await ensureMyFruitAssigned();
              } catch (err) {
                console.error('ensureMyFruitAssigned in renderFruitPanel failed', err);
              }
            }

            if (!localFruit) {
              localFruit = buildFallbackFruitForUser(me);
            }

            if (!localFruit) {
              panel.innerHTML = '<div style="font-size:13px; color:#ffe082;">Не удалось назначить фрукт. Попробуй открыть ивент снова.</div>';
              return;
            }

            const graceText = localFruit.id === GOLDEN_CUPCAKE.id && Number.isFinite(localFruit.graceLeftMs)
              ? `<div style="margin-top:6px; font-size:12px; color:#fff176;">Эксклюзив! Кекс действует еще ${Math.ceil(localFruit.graceLeftMs / 1000)} сек., потом станет обычным фруктом.</div>`
              : '';

            panel.innerHTML = `<div style="font-size:15px;">У тебя один шанс за ивент — перетащи фрукт в зону рта Мушу:</div>
              <div class="mushu-fruit-list"><div class="mushu-fruit-chip" aria-label="${localFruit.label}" title="${localFruit.label}" data-fruit="${localFruit.id}">${localFruit.emoji}</div></div>${graceText}`;
            panel.querySelectorAll('.mushu-fruit-chip').forEach((chip) => {
              if (window.PointerEvent) {
                chip.addEventListener('pointerdown', onFruitPointerDown);
                return;
              }
              chip.addEventListener('touchstart', onFruitTouchStart, { passive: false });
            });
          }


          function clearFruitDragState() {
            window.removeEventListener('pointermove', onFruitPointerMove);
            window.removeEventListener('touchmove', onFruitTouchMove);
            if (dragState?.chip) dragState.chip.classList.remove('dragging');
            if (dragState?.ghost?.isConnected) dragState.ghost.remove();
            dragState = null;
          }

          function getClientPoint(ev) {
            if (!ev) return { x: 0, y: 0 };
            if (Number.isFinite(ev.clientX) && Number.isFinite(ev.clientY)) return { x: ev.clientX, y: ev.clientY };
            const touch = ev.touches?.[0] || ev.changedTouches?.[0];
            return { x: Number(touch?.clientX) || 0, y: Number(touch?.clientY) || 0 };
          }

          function startFruitDrag(chip, x, y) {
            if (!localFruit) return;
            chip.classList.add('dragging');
            const ghost = document.createElement('div');
            ghost.className = 'mushu-fruit-ghost';
            ghost.textContent = localFruit.emoji;
            document.body.appendChild(ghost);
            dragState = { chip, ghost, fruit: { ...localFruit } };
            moveGhost(x, y);
          }

          function onFruitPointerDown(ev) {
            const chip = ev.currentTarget;
            if (!localFruit) return;
            ev.preventDefault();
            if (typeof chip.setPointerCapture === 'function' && Number.isFinite(ev.pointerId)) {
              chip.setPointerCapture(ev.pointerId);
            }
            const { x, y } = getClientPoint(ev);
            startFruitDrag(chip, x, y);
            window.addEventListener('pointermove', onFruitPointerMove);
            window.addEventListener('pointerup', onFruitPointerUp, { once: true });
            window.addEventListener('pointercancel', onFruitPointerCancel, { once: true });
          }

          function onFruitTouchStart(ev) {
            const chip = ev.currentTarget;
            if (!localFruit) return;
            ev.preventDefault();
            const { x, y } = getClientPoint(ev);
            startFruitDrag(chip, x, y);
            window.addEventListener('touchmove', onFruitTouchMove, { passive: false });
            window.addEventListener('touchend', onFruitTouchEnd, { once: true });
            window.addEventListener('touchcancel', onFruitTouchEnd, { once: true });
          }

          function moveGhost(x, y) {
            if (!dragState?.ghost) return;
            dragState.ghost.style.left = `${x}px`;
            dragState.ghost.style.top = `${y}px`;
          }

          function onFruitPointerMove(ev) {
            const { x, y } = getClientPoint(ev);
            moveGhost(x, y);
          }

          function onFruitTouchMove(ev) {
            ev.preventDefault();
            const { x, y } = getClientPoint(ev);
            moveGhost(x, y);
          }

          async function finishFruitDragByPoint(x, y) {
            const mouth = $('mushu-mouth-zone')?.getBoundingClientRect();
            const droppedInMouth = mouth && x >= mouth.left && x <= mouth.right && y >= mouth.top && y <= mouth.bottom;
            clearFruitDragState();
            if (droppedInMouth) await feedMushu();
          }

          async function onFruitPointerUp(ev) {
            window.removeEventListener('pointermove', onFruitPointerMove);
            window.removeEventListener('pointercancel', onFruitPointerCancel);
            const { x, y } = getClientPoint(ev);
            await finishFruitDragByPoint(x, y);
          }

          async function onFruitPointerCancel() {
            clearFruitDragState();
          }

          async function onFruitTouchEnd(ev) {
            window.removeEventListener('touchmove', onFruitTouchMove);
            const { x, y } = getClientPoint(ev);
            await finishFruitDragByPoint(x, y);
          }

          function startEventTimer() {
            if (timerId) clearInterval(timerId);
            timerId = setInterval(() => {
              const left = Math.max(0, Number(mushuState.endAt || 0) - getNow());
              const mm = String(Math.floor(left / 60000)).padStart(2, '0');
              const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
              const timeText = $('mushu-time-left');
              const burn = $('mushu-fuse-burn');
              const timer = $('mushu-fuse-timer');
              if (timeText) timeText.textContent = `${mm}:${ss}`;
              const total = Math.max(1, Number(mushuState.durationMs || (20 * 60000)));
              const pct = Math.max(0, Math.min(100, (left / total) * 100));
              if (burn) burn.style.width = `${pct}%`;
              if (timer) timer.classList.toggle('mushu-time-critical', left <= 60000);
              if (isActive() && localFruit?.id === GOLDEN_CUPCAKE.id) renderFruitPanel().catch((e) => console.error('renderFruitPanel failed', e));
              if (left === 0) ensureDb().then((db) => finalizeMushuByTimer(db)).catch((e) => console.error('finalizeMushuByTimer failed', e));
            }, 1000);
          }

          function updateProgressUi() {
            const current = Number(mushuState.current_satiety || 0);
            const target = Math.max(1, Number(mushuState.target || 1));
            const pct = Math.min(100, (current / target) * 100);
            if ($('mushu-satiety-text')) $('mushu-satiety-text').textContent = `${current} / ${target}`;
            if ($('mushu-progress-fill')) $('mushu-progress-fill').style.width = `${pct}%`;
            if ($('mushu-combo-text')) $('mushu-combo-text').textContent = `Комбо за 15 минут: 5 кормлений = +5, 20 кормлений = +10`;
          }

          function getMushuEventRuntimeId() {
            return String(mushuState.instanceId || mushuState.startedAt || mushuState.completedAt || mushuState.failedAt || 'mushu_ID_1');
          }

          async function pushMushuResultToFeed(db, status) {
            const eventId = getMushuEventRuntimeId();
            const logKey = `${status}:${eventId}`;
            if (lastFeedResultLogged === logKey) return;
            const logTx = await db.ref(`${EVENT_PATH}/feed_result_posted/${eventId}`).transaction((v) => v || { at: getNow(), eventId, status });
            if (!logTx.committed) {
              lastFeedResultLogged = logKey;
              return;
            }
            const payload = status === 'completed'
              ? { title: SUCCESS_TITLE, text: SUCCESS_TEXT }
              : { title: FAILED_TITLE, text: FAILED_TEXT };
            const feedText = `${payload.title} ${payload.text}`;
            await db.ref('news_feed').push({
              text: feedText,
              createdAt: getNow()
            });
            await db.ref('events/feed').push({
              type: MUSHU_EVENT_ID,
              eventId,
              status,
              title: payload.title,
              text: payload.text,
              createdAt: getNow()
            });
            lastFeedResultLogged = logKey;
          }

          async function showMushuResultIfNeeded() {
            const status = String(mushuState.status || '');
            if (!['completed', 'failed'].includes(status)) return;
            if (statusToastShown === status) return;
            const me = uid();
            if (!me) return;
            statusToastShown = status;
            closeMushuOverlay();
          }

          function spawnEatSpark() {
            const mouth = $('mushu-mouth-zone');
            if (!mouth) return;
            const rect = mouth.getBoundingClientRect();
            const spark = document.createElement('span');
            spark.className = 'mushu-spark';
            spark.style.left = `${rect.left + rect.width * 0.5}px`;
            spark.style.top = `${rect.top + rect.height * 0.5}px`;
            document.body.appendChild(spark);
            setTimeout(() => spark.remove(), 560);
          }

          async function applyComboBonus(db, now) {
            const feedSnap = await db.ref(`${EVENT_PATH}/feed_log`).once('value');
            const feeds = [];
            feedSnap.forEach((row) => {
              const v = row.val() || {};
              const at = Number(v.at || 0);
              if (at >= now - FEED_WINDOW_MS) feeds.push(v);
            });
            const count = feeds.length;
            const bonusRef = db.ref(`${EVENT_PATH}/combo_bonus`);
            const bonusTx = await bonusRef.transaction((v) => {
              const cur = v || {};
              const next = { ...cur };
              if (count >= 5 && !cur.bonus5AppliedAt) next.bonus5AppliedAt = now;
              if (count >= 20 && !cur.bonus20AppliedAt) next.bonus20AppliedAt = now;
              return next;
            });
            const row = bonusTx.snapshot?.val() || {};
            let add = 0;
            if (count >= 5 && row.bonus5AppliedAt === now) add += 5;
            if (count >= 20 && row.bonus20AppliedAt === now) add += 10;
            if (add > 0) await db.ref(`${EVENT_PATH}/current_satiety`).transaction(v => Number(v || 0) + add);
          }

          async function findActiveMushuGameEventKey(db) {
            const snap = await db.ref(GAME_EVENTS_PATH).once('value');
            let key = null;
            snap.forEach((child) => {
              const v = child.val() || {};
              if (!key && v.id === MUSHU_EVENT_ID && v.status === 'active') key = child.key;
            });
            return key;
          }

          async function feedMushu() {
            if (!isActive()) return;
            if (isAdminUser()) return;
            const me = uid();
            if (!me) return;
            const db = await ensureDb();
            const fruit = getMyPersonalFruit() || localFruit || buildFallbackFruitForUser(me);
            if (!fruit) return;
            const fedTx = await db.ref(`${EVENT_PATH}/fed_users/${me}`).transaction(v => v ? v : { at: Date.now(), fruit: fruit.id });
            if (!fedTx.committed) return;

            const dragon = $('mushu-dragon');
            dragon?.classList.add('mushu-chew');
            spawnEatSpark();
            setTimeout(() => dragon?.classList.remove('mushu-chew'), 1000);

            await db.ref(`${EVENT_PATH}/participants/${me}`).update({ joinedAt: Date.now(), fed: true, item: mushuState.participants?.[me]?.item || mushuState.personal_fruits?.[me] || { id: fruit.id } });
            const baseSatiety = Number(fruit.satiety || 1);
            const now = getNow();
            await db.ref(`${EVENT_PATH}/feed_log`).push({ uid: me, fruit: fruit.id, satiety: baseSatiety, at: now });
            await db.ref(`${EVENT_PATH}/current_satiety`).transaction(v => Number(v || 0) + baseSatiety);
            await applyComboBonus(db, now);
            await renderFruitPanel();
            await finalizeMushuByTimer(db);
          }


          async function finalizeMushuByTimer(db) {
            const evSnap = await db.ref(EVENT_PATH).once('value');
            const ev = evSnap.val() || {};
            if (String(ev.status || '') !== 'active') return;
            const left = Math.max(0, Number(ev.endAt || 0) - getNow());
            if (left > 0) return;

            const success = Number(ev.current_satiety || 0) >= Number(ev.target || 1);
            const nextStatus = success ? 'completed' : 'failed';
            const tx = await db.ref(`${EVENT_PATH}/status`).transaction((v) => v === 'active' ? nextStatus : v);
            if (!tx.committed) return;

            const now = getNow();
            if (success) {
              const participants = ev.participants || {};
              const rewards = {};
              Object.keys(participants).forEach((puid) => { rewards[puid] = randomGift(); });
              await db.ref(`${EVENT_PATH}/rewards`).set(rewards);
              await db.ref(`${EVENT_PATH}/completedAt`).set(now);
              await db.ref(`${EVENT_PATH}/resultText`).set(`${SUCCESS_TITLE} ${SUCCESS_TEXT}`);
            } else {
              await db.ref(`${EVENT_PATH}/failedAt`).set(now);
              await db.ref(`${EVENT_PATH}/resultText`).set(`${FAILED_TITLE} ${FAILED_TEXT}`);
            }
            await pushMushuResultToFeed(db, nextStatus);

            const activeKey = await findActiveMushuGameEventKey(db);
            if (activeKey) {
              await db.ref(`${GAME_EVENTS_PATH}/${activeKey}`).update({
                status: nextStatus,
                [success ? 'completedAt' : 'failedAt']: now,
                resultText: success ? SUCCESS_TEXT : FAILED_TEXT
              });
            }
          }

          async function applyMyRewardIfNeeded() {
            const me = uid();
            if (!me || String(mushuState.status || '') !== 'completed') return;
            const reward = mushuState.rewards?.[me];
            if (!reward?.id) return;
            const db = await ensureDb();
            const tx = await db.ref(`${EVENT_PATH}/rewarded_users/${me}`).transaction(v => v || { at: Date.now(), rewardId: reward.id });
            if (!tx.committed) return;

            if (reward.id === 'ticket_1') await window.claimSequentialTickets?.(1);
            if (reward.id === 'ticket_2') await window.claimSequentialTickets?.(2);
            if (reward.id === 'magnifier') await window.addInventoryItem?.('magnifier', 1);
            if (reward.id === 'goldenPollen') await window.addInventoryItem?.('goldenPollen', 1);

            const fx = document.createElement('div');
            fx.className = 'mushu-breath';
            document.body.appendChild(fx);
            setTimeout(() => fx.remove(), 1400);
            setTimeout(() => alert(`🐉 Магический выдох Мушу! Твой приз: ${reward.label || reward.id}`), 900);
          }

          async function attachMushuListeners() {
            ensureMushuUi();
            const db = await ensureDb();
            if (mushuOffsetRef) mushuOffsetRef.off();
            mushuOffsetRef = db.ref('.info/serverTimeOffset');
            mushuOffsetRef.on('value', (snap) => {
              mushuServerOffsetMs = Number(snap.val()) || 0;
            });
            if (mushuRef) mushuRef.off();
            mushuRef = db.ref(EVENT_PATH);
            mushuRef.on('value', async (snap) => {
              mushuState = snap.val() || { status: 'idle' };
              if (!['completed', 'failed'].includes(String(mushuState.status || ''))) statusToastShown = '';
              updateInlineInvite();
              updateProgressUi();
              startEventTimer();
              await ensureMyFruitAssigned().catch((e) => console.error('ensureMyFruitAssigned failed', e));
              await renderFruitPanel();
              await showMushuResultIfNeeded().catch((e) => console.error('showMushuResultIfNeeded failed', e));
              await applyMyRewardIfNeeded().catch((e) => console.error('applyMyRewardIfNeeded failed', e));
            });
          }

          window.initMushuEventSystem = () => attachMushuListeners().catch((e) => console.error('initMushuEventSystem failed', e));
        })();
        // END mushu_event.js

        // BEGIN adminpage.js
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

          window.waitForDbReady = waitForDbReady;

          const formatMoscowDateTime = window.formatMoscowDateTime || ((ts) => new Date(ts || Date.now()).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }));
          const parseMoscowDateTimeLocalInput = window.parseMoscowDateTimeLocalInput || ((value) => {
            const raw = String(value || '').trim().replace(/\s+/g, ' ');

            let y, mo, d, h, mi, ss = '0';

            // Нативный и квази-нативный формат datetime-local: YYYY-MM-DDTHH:mm(:ss) и YYYY-MM-DD HH:mm(:ss)
            let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
            if (match) {
              [, y, mo, d, h, mi, ss = '0'] = match;
            } else {
              // Фолбэк для строкового формата DD.MM.YYYY HH:mm(:(ss))
              match = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
              if (!match) return NaN;
              [, d, mo, y, h, mi, ss = '0'] = match;
            }

            const parsed = new Date(
              Number(y),
              Number(mo) - 1,
              Number(d),
              Number(h),
              Number(mi),
              Number(ss),
              0
            ).getTime();
            return Number.isFinite(parsed) ? parsed : NaN;
          });
          const toMoscowDateTimeLocalInput = window.toMoscowDateTimeLocalInput || ((ts) => {
            const dt = new Date(Number(ts) || Date.now());
            return new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
          });

          const isAdminUser = () => Number(currentUserId) === Number(ADMIN_ID);
          let isAdminScheduleCollapsed = false;
          function ensureDateTimeInputDefault(inputId, plusMs = 60000) {
            const input = document.getElementById(inputId);
            if (!input || input.value) return;
            input.value = toMoscowDateTimeLocalInput(Date.now() + plusMs);
          }

          function toggleAdminSchedulePanel(forceExpand) {
            const body = document.getElementById('admin-schedule-body');
            const btn = document.getElementById('admin-schedule-toggle-btn');
            if (!body || !btn) return;
            isAdminScheduleCollapsed = typeof forceExpand === 'boolean' ? !forceExpand : !isAdminScheduleCollapsed;
            body.style.display = isAdminScheduleCollapsed ? 'none' : 'block';
            btn.innerText = isAdminScheduleCollapsed ? '🗓️ Расписание: Развернуть' : '🗓️ Расписание: Свернуть';
          }

          function switchAdminInnerTab(tabName) {
            toggleAdminSchedulePanel(true);
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

          async function runRoundStart(durationMs, options = {}) {
            if (!durationMs || durationMs <= 0) return alert('Укажите время раунда!');
            await archiveAndClearBoard();
            let free = [];
            for (let i = 0; i < 50; i++) free.push(i);

            const magicCell = free.length ? free.splice(Math.floor(Math.random() * free.length), 1)[0] : null;
            const miniGameCell = free.length ? free.splice(Math.floor(Math.random() * free.length), 1)[0] : null;
            const wordSketchCell = free.length ? free.splice(Math.floor(Math.random() * free.length), 1)[0] : null;
            const magnetCell = free.length ? free.splice(Math.floor(Math.random() * free.length), 1)[0] : null;

            const itemCells = {};
            const itemPool = ['goldenPollen', 'magicWand', 'magnifier', 'cloak', 'inkSaboteur'];
            for (const itemType of itemPool) {
              if (!free.length) break;
              const idx = free.splice(Math.floor(Math.random() * free.length), 1)[0];
              itemCells[idx] = itemType;
            }

            const traps = [];
            for (let j = 0; j < 2; j++) {
              if (free.length) traps.push(free.splice(Math.floor(Math.random() * free.length), 1)[0]);
            }

            const fieldMode = String(options?.fieldMode || 'cells');
            const snakeConfig = (fieldMode === 'snake' && window.snakeRound?.buildSnakeConfig) ? window.snakeRound.buildSnakeConfig() : null;

            const s = await db.ref('current_round/number').once('value');
            const newRoundNum = (s.val() || 0) + 1;

            await db.ref('current_round').set({
              number: newRoundNum,
              startedAt: Date.now(),
              durationMs,
              endTime: Date.now() + durationMs,
              traps,
              magicCell,
              miniGameCell,
              wordSketchCell,
              magnetCell,
              itemCells,
              fieldMode,
              snakeConfig
            });

            await postNews(`Раунд #${newRoundNum} начался (${fieldMode === 'snake' ? 'режим Змейка' : 'режим Клетки'})`);
            return newRoundNum;
          }

          window.isAdminUser = isAdminUser;
          window.ensureDateTimeInputDefault = ensureDateTimeInputDefault;
          window.switchAdminInnerTab = switchAdminInnerTab;
          window.runRoundStart = runRoundStart;
          window.getAdminNow = () => Date.now();
	          window.parseMoscowDateTimeLocalInput = parseMoscowDateTimeLocalInput;
	          window.toMoscowDateTimeLocalInput = toMoscowDateTimeLocalInput;
	          window.toggleAdminSchedulePanel = toggleAdminSchedulePanel;
	          window.setWorksAdminPlayer = setWorksAdminPlayer;
	          window.toggleAdminEmergencyActions = toggleAdminEmergencyActions;
	          window.toggleEmergencySection = toggleEmergencySection;
	          window.adminGrantTicketsToPlayer = adminGrantTicketsToPlayer;
	          window.adminRevokeTicketsFromPlayer = adminRevokeTicketsFromPlayer;
	          window.adminForceRenamePlayer = adminForceRenamePlayer;
	          window.adminTeleportPlayerToStart = adminTeleportPlayerToStart;
	          window.adminRestartPlayerCurrentCell = adminRestartPlayerCurrentCell;
	          window.adminApplyItemAction = adminApplyItemAction;
	          window.adminReplaceAllNicknames = adminReplaceAllNicknames;
	          window.adminResetCurrentRound = adminResetCurrentRound;
	          window.toggleAdminPlayersList = toggleAdminPlayersList;
	          window.saveNewUserRandomly = saveNewUserRandomly;
	          window.adminResetGame = adminResetGame;
	          window.adminFullReset = adminFullReset;

	        })();
        // END adminpage.js

        // BEGIN works.js
        // Логика вкладки «Работы», вынесенная из index.html
        function updateWorksTabForRole(isAdmin) {
            const uploadCard = document.getElementById('works-upload-card');
            const title = document.getElementById('works-tab-title');
            const adminFilters = document.getElementById('works-admin-filters');
            if (uploadCard) uploadCard.style.display = isAdmin ? 'none' : 'block';
            if (adminFilters) adminFilters.style.display = isAdmin ? 'block' : 'none';
            if (title) title.innerText = isAdmin ? '🖼️ Работы игроков' : '📤 Сдача работ';
            if (!isAdmin) worksAdminSelectedUserId = '';
            if (isAdmin) syncWorksAdminPlayers();
        }

        function normalizeNicknameForFilter(name) {
            return String(name || '').trim().toLowerCase();
        }

        function getSubmissionPlayerNickname(item) {
            if (Number.isInteger(item?.owner) && players[item.owner]?.n) return String(players[item.owner].n);
            return '';
        }

        function syncWorksAdminPlayers() {
            const select = document.getElementById('works-admin-player-select');
            if (!select || !db) return;

            if (worksAdminPlayersRef) worksAdminPlayersRef.off();
            worksAdminPlayersRef = db.ref('whitelist');
            worksAdminPlayersRef.on('value', snap => {
                const playersForSelect = [];
                snap.forEach(userSnap => {
                    const userData = userSnap.val() || {};
                    const charIndex = Number(userData.charIndex);
                    const nickname = String(players[charIndex]?.n || '').trim();
                    playersForSelect.push({
                        userId: String(userSnap.key || '').trim(),
                        nickname
                    });
                });

                playersForSelect.sort((a, b) => {
                    const aName = a.nickname || `Игрок ${a.userId}`;
                    const bName = b.nickname || `Игрок ${b.userId}`;
                    const byName = aName.localeCompare(bName, 'ru', { sensitivity: 'base' });
                    if (byName !== 0) return byName;
                    return a.userId.localeCompare(b.userId, 'ru', { sensitivity: 'base' });
                });

                const hasSelected = worksAdminSelectedUserId
                    && playersForSelect.some(p => p.userId === worksAdminSelectedUserId);
                if (!hasSelected) worksAdminSelectedUserId = '';

                select.innerHTML = [
                    '<option value="">Выберите игрока</option>',
                    ...playersForSelect.map(item => {
                        const label = item.nickname || `Игрок ${item.userId}`;
                        return `<option value="${item.userId}">${label} · ID ${item.userId}</option>`;
                    })
                ].join('');
                select.value = worksAdminSelectedUserId;
                renderSubmissions();
            });
        }

        function setWorksAdminPlayer(rawUserId) {
            worksAdminSelectedUserId = String(rawUserId || '').trim();
            renderSubmissions();
        }

        function checkAccess() {
            const isAdmin = Number(currentUserId) === Number(ADMIN_ID);
            const navAdminBtn = document.getElementById('nav-admin-btn');
            const wheelAdminWrap = document.getElementById('wheel-admin-btn');

            if (isAdmin) {
                if (navAdminBtn) navAdminBtn.style.display = 'flex';
                document.getElementById('wheel-admin-btn').innerHTML = `<button onclick="adminPickWinnerNow()" class="admin-btn" style="background:#7b1fa2;">✨ Начать магию</button><button onclick="adminResetRaffleState()" class="admin-btn" style="background:#546e7a;">♻️ Сброс</button><button onclick="switchTab('tab-admin', document.getElementById('nav-admin-btn')); switchAdminInnerTab('draw');" class="admin-btn">⚙️ Настройки розыгрыша</button>`;
                syncAdminList();
                fillAdminNickOptions();
                ensureDateTimeInputDefault('event-start-at');
                ensureDateTimeInputDefault('draw-start-at');
                ensureDateTimeInputDefault('round-start-at');
                document.getElementById('player-identity').innerHTML = `Ты: <b>Администратор</b><br><small style="color:#666;">Telegram ID: ${currentUserId}</small>`;
                updateWorksTabForRole(true);
                setAuthorizedView(true);
            } else {
                if (navAdminBtn) navAdminBtn.style.display = 'none';
                if (wheelAdminWrap) wheelAdminWrap.innerHTML = '';
            }
            db.ref('whitelist/' + currentUserId).on('value', s => {
                const currentIsAdmin = Number(currentUserId) === Number(ADMIN_ID);
                if (s.exists()) {
                    myIndex = s.val().charIndex;
                    const playerName = players[myIndex]?.n || 'Игрок';
                    const playerColor = charColors[myIndex] || '#6a1b9a';
                    document.getElementById('player-identity').innerHTML = `Ты: <span style="color:${playerColor}">${escapeHtml(playerName)}</span><br><small style="color:#666;">Telegram ID: ${currentUserId}</small>`;
                    updateWorksTabForRole(currentIsAdmin);
                    setAuthorizedView(true);
                    return;
                }

                myIndex = -1;
                if (!currentIsAdmin) {
                    updateWorksTabForRole(false);
                    document.getElementById('welcome-user-id').innerHTML = `<b>Твой Telegram ID:</b> <code>${currentUserId || 'Не определён'}</code>`;
                    setAuthorizedView(false);
                }
            });
        }

        function syncData() {
            db.ref('current_round').on('value', snap => {
                if (!snap.exists()) return;

                currentRoundData = snap.val() || {};
                currentRoundNum = currentRoundData.number;
                roundEndTime = currentRoundData.endTime;
                currentRoundStartedAt = Number(currentRoundData.startedAt || 0);
                currentRoundDurationMs = Number(currentRoundData.durationMs || 0);
                currentFieldMode = String(currentRoundData.fieldMode || 'cells');
                document.getElementById('round-info').innerText = "Раунд №" + currentRoundNum;
                updateTimerDisplay();

                if (lastMagicLinksRound !== currentRoundNum) {
                    shownMagicLinks = {};
                    lastMagicLinksRound = currentRoundNum;
                }
                if (magicLinksRef) magicLinksRef.off();
                magicLinksRef = db.ref(`magic_links/${currentRoundNum}`);
                magicLinksRef.on('value', linksSnap => {
                    if (!linksSnap.exists()) return;

                    linksSnap.forEach(linkSnap => {
                        const link = linkSnap.val();
                        if (!link) return;

                        const meA = Number(link.playerA?.userId) === Number(currentUserId);
                        const meB = Number(link.playerB?.userId) === Number(currentUserId);
                        const related = meA || meB;
                        if (!related) return;

                        const shownKey = `${linkSnap.key}:${link.status || 'unknown'}`;
                        if (shownMagicLinks[shownKey]) return;

                        if (link.status === 'paired') {
                            const partner = meA ? link.playerB : link.playerA;
                            const partnerName = partner?.name || 'Неизвестный';
                            const notifyField = meA ? 'playerANotifiedAt' : 'playerBNotifiedAt';
                            if (!Number(link[notifyField] || 0)) {
                                shownMagicLinks[shownKey] = true;
                                db.ref(`magic_links/${currentRoundNum}/${linkSnap.key}/${notifyField}`).set(Date.now()).catch(() => null);
                                if (meA) {
                                    alert(`Магическая связь установлена с игроком "${partnerName}"`);
                                } else {
                                    alert(`У тебя появилась магическая связь с игроком "${partnerName}"`);
                                }
                            }
                        } else if (link.status === 'expired_single' && meA) {
                            if (!Number(link.timeoutNotifiedAt || 0)) {
                                shownMagicLinks[shownKey] = true;
                                db.ref(`magic_links/${currentRoundNum}/${linkSnap.key}/timeoutNotifiedAt`).set(Date.now()).catch(() => null);
                                alert('Очень жаль, но мы не нашли тебе напарника');
                            }
                        }
                    });
                });
            });

            syncTicketData();

            if (newsRef) newsRef.off();
            newsRef = db.ref('news_feed').limitToLast(60);
            newsRef.on('value', snap => {
                const items = [];
                snap.forEach(row => {
                    const value = row.val() || {};
                    items.push({ id: row.key, text: value.text || '', createdAt: Number(value.createdAt || 0) });
                });
                newsFeedItems = items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                renderNewsFeed();
            });

            if (inventoryRef) inventoryRef.off();
            inventoryRef = db.ref(`whitelist/${currentUserId}/inventory`);
            inventoryRef.on('value', snap => {
                const inventoryRaw = snap.val() || {};
                myInventory = normalizeInventory(inventoryRaw);
                renderInventory();
                cleanupUnsupportedInventoryKeys(currentUserId, inventoryRaw).catch((err) => console.error('inventory cleanup failed', err));
            });


            if (seasonProfilesRef) seasonProfilesRef.off();
            seasonProfilesRef = db.ref('player_season_status');
            seasonProfilesRef.on('value', snap => {
                seasonProfilesByUserId = snap.val() || {};
            });

            if (systemNotificationsRef) systemNotificationsRef.off();
            systemNotificationsRef = db.ref(`system_notifications/${currentUserId}`).limitToLast(30);
            systemNotificationsRef.on('child_added', snap => {
                const v = snap.val() || {};
                if (!v.text) return;
                if (v.type === 'calligraphy_duel_invite') return;
                if (v.expiresAt && Number(v.expiresAt) < Date.now() && String(v.type || '') !== 'calligraphy_duel_wait_notice') {
                    db.ref(`system_notifications/${currentUserId}/${snap.key}`).remove();
                    return;
                }
                if (v.type === 'calligraphy_duel_wait_notice' || v.type === 'calligraphy_duel_timeout' || v.type === 'calligraphy_duel_declined') {
                    window.showOutgoingDuelStatusNotification(snap.key, v);
                    return;
                }
                if (v.type === 'snake_clash_start' || v.type === 'snake_clash_result_win' || v.type === 'snake_clash_result_loss' || v.type === 'snake_synergy_start' || v.type === 'snake_synergy_bonus') {
                    const onceKey = getSnakeClashNotificationOnceKey(v);
                    if (onceKey && wasSnakeClashNotificationSeen(onceKey)) return;
                    if (onceKey) markSnakeClashNotificationSeen(onceKey);
                }
                showPlayerNotification({ id: `sys-${snap.key}`, text: v.text, borderColor: '#ffd54f' });
            });

            if (currentGameEvent?.id === EPIC_PAINT_EVENT_ID && currentGameEvent?.status === 'completed') {
                window.maybeShowEpicPaintSuccessNotification?.().catch((err) => console.error('epic paint success notification failed', err));
            }

            if (snakeClashesRef) snakeClashesRef.off();
            snakeClashesRef = db.ref(`snake_clashes/${currentRoundNum || 0}`);
            snakeClashesRef.on('value', snap => {
                const clashes = snap.val() || {};
                Object.entries(clashes).forEach(([cell, byPair]) => {
                    const pairMap = byPair && typeof byPair === 'object' ? byPair : {};
                    Object.entries(pairMap).forEach(([pairKey, clash]) => {
                        const row = clash || {};
                        const playersPair = Array.isArray(row.players) ? row.players.map((v) => String(v || '').trim()) : [];
                        if (!playersPair.includes(String(currentUserId || '').trim())) return;
                        const clashPath = `snake_clashes/${currentRoundNum || 0}/${cell}/${pairKey}`;
                        if (String(row.status || '') === 'active' && String(row.gameType || '') === 'snake_rps') {
                            openSnakeRpsModal(clashPath, row);
                        }
                        if (String(row.status || '') === 'active' && String(row.gameType || '') === 'snake_poison_dice') {
                            openSnakePoisonDiceModal(clashPath, row);
                        }
                        if (String(row.status || '') === 'active' && String(row.gameType || '') === 'snake_puzzle_5x5') {
                            openSnakePuzzleModal(clashPath, row);
                        }
                    });
                });
            });

            if (duelsRef) duelsRef.off();
            duelsRef = db.ref(DUEL_PATH).limitToLast(40);
            duelsRef.on('value', snap => {
                const items = [];
                snap.forEach(s => items.push({ key: s.key, ...(s.val() || {}) }));
                activeDuels = items;
                items.forEach((duel) => {
                    if (!duel?.key || duel.status !== 'active') return;
                    window.postCalligraphyDuelStartedNewsIfNeeded(duel.key, duel).catch((err) => console.error('duel started news failed', err));
                });
            });

            if (challengeRef) challengeRef.off();
            challengeRef = db.ref(`whitelist/${currentUserId}/ink_challenge`);
            challengeRef.on('value', snap => {
                myInkChallenge = snap.val() || null;
                updateInkDeadlineHint();
                if (!myInkChallenge || myInkChallenge.round !== currentRoundNum || myInkChallenge.isResolved) return;
                if (window.lastShownInkChallengeRound === currentRoundNum) return;
                window.lastShownInkChallengeRound = currentRoundNum;
                alert('Хах! Кому-то ты не угодил! Твою работу покрыли кляксами! Открой свою клетку, чтобы выбрать усложнение.');
            });

            if (wandBlessingRef) wandBlessingRef.off();
            wandBlessingRef = db.ref(`whitelist/${currentUserId}/wand_blessing`);
            wandBlessingRef.on('value', snap => {
                myWandBlessing = snap.val() || null;
                if (!myWandBlessing || myWandBlessing.round !== currentRoundNum || myWandBlessing.isResolved) return;
                if (window.lastShownWandBlessingRound === currentRoundNum) return;
                window.lastShownWandBlessingRound = currentRoundNum;
                alert('Добрая фея выбрала тебя 🧚‍♀️. Твоё задание упрощается, выбирай.');
            });

            
            const submissionsById = {};
            const extractSubmissionEntries = (parentKey, value) => {
                if (!value || typeof value !== 'object') return [];
                const hasDirectFields = value.beforeImageData || value.afterImageData || value.imageData || value.userId || value.owner !== undefined;
                if (hasDirectFields) return [{ key: parentKey, payload: value, dbPath: parentKey }];

                const nestedEntries = [];
                Object.entries(value).forEach(([childKey, childValue]) => {
                    if (!childValue || typeof childValue !== 'object') return;
                    const hasSubmissionFields = childValue.beforeImageData || childValue.afterImageData || childValue.imageData || childValue.userId || childValue.owner !== undefined;
                    if (!hasSubmissionFields) return;
                    nestedEntries.push({ key: `${parentKey}_${childKey}`, payload: childValue, dbPath: `${parentKey}/${childKey}` });
                });
                return nestedEntries;
            };

            const applySubmissionSnapshot = (snap, sourcePrefix) => {
                if (!snap) return;
                snap.forEach(s => {
                    const value = s.val() || {};
                    const entries = extractSubmissionEntries(s.key, value);
                    entries.forEach(({ key, payload, dbPath }) => {
                        submissionsById[`${sourcePrefix}:${key}`] = {
                            id: key,
                            sourcePrefix,
                            dbPath: dbPath || key,
                            ...payload
                        };
                    });
                });
                allSubmissions = Object.values(submissionsById).sort((a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0));
                renderSubmissions();
                fillSubmissionTaskOptions();
            };

            if (submissionsRef) submissionsRef.off();
            submissionsRef = db.ref('submissions');
            submissionsRef.on('value', snap => {
                Object.keys(submissionsById).forEach(key => {
                    if (key.startsWith('submissions:')) delete submissionsById[key];
                });
                applySubmissionSnapshot(snap, 'submissions');
            });

            if (legacyWorksRef) legacyWorksRef.off();
            legacyWorksRef = db.ref('works');
            legacyWorksRef.on('value', snap => {
                Object.keys(submissionsById).forEach(key => {
                    if (key.startsWith('works:')) delete submissionsById[key];
                });
                applySubmissionSnapshot(snap, 'works');
            });
        }

        function getTaskLabelByCell(cell) {
            if (!cell) return 'Неизвестное задание';
            if (String(cell.mode || '') === 'snake' && String(cell.effect || '') === 'sphinx') {
                return '🗿 Испытание Сфинкса: сложное супер-задание (бросок кубика заблокирован до одобрения)';
            }
            if (cell.isEventReward && cell.eventId === EPIC_PAINT_EVENT_ID) return '🎨 Награда за событие «Эпичный закрас»';
            if (cell.isTrap) return `💣 Ловушка: ${cell.trapText || 'особое усложненное задание'}`;
            if (cell.isMagic && cell.isMagicSolo && Number.isInteger(cell.taskIdx) && cell.taskIdx >= 0) return `🔮 Магическая связь: одиночное задание — ${tasks[cell.taskIdx]?.text || 'Обычное задание'}`;
            if (cell.isMagic) return '🔮 Магическая связь: совместное задание';
            if (cell.isMiniGame) return '🎮 Пятнашки 5×5: мини-игра без дополнительного задания';
            if (cell.isWordSketch) return '🧩 Словесный скетч: мини-игра без дополнительного задания';
            if (cell.isMagnet) return `👯 Тянет к тебе как магнитом: ${cell.magnetTaskLabel || 'повтори задание выбранного игрока'}`;
            if (cell.isInkChallenge) return `🫧 Клякса-диверсант: ${cell.inkOptionLabel || 'усложнение выбирается в карточке клетки'}`;
            if (cell.isWandBlessing) return `🎆 Волшебная палочка: ${cell.wandOptionLabel || 'выбери упрощение в карточке клетки'}`;
            if (cell.isGold) return '👑 Золотая клетка: свободная тема';
            const t = tasks[cell.taskIdx];
            return t?.text || 'Обычное задание';
        }

        function getSubmissionStatusInfo(status) {
            if (status === 'accepted') return { text: 'Принято', className: 'status-accepted' };
            if (status === 'rejected') return { text: 'Не принято', className: 'status-rejected' };
            return { text: 'На проверке', className: 'status-pending' };
        }


        function updateInkDeadlineHint() {
            const el = document.getElementById('ink-deadline-hint');
            if (!el) return;
            if (!myInkChallenge || myInkChallenge.selectedOption !== 4 || myInkChallenge.isResolved) {
                el.innerText = '';
                return;
            }
            const ms = (myInkChallenge.optionDeadline || 0) - Date.now();
            if (ms <= 0) {
                el.innerText = '⏰ Дедлайн по кляксе истёк.';
                return;
            }
            const h = Math.floor(ms / 3600000);
            const m = Math.floor((ms % 3600000) / 60000);
            el.innerText = `⏳ Клякса: до конца дедлайна ${h}ч ${m}м.`;
        }

        function fillSubmissionTaskOptions() {
            const select = document.getElementById('work-task-select');
            if (!select) return;

            const myCells = allTicketsData.filter(t => {
                const sameUserId = Number(t.userId) === Number(currentUserId);
                const sameOwner = Number.isInteger(myIndex) && myIndex >= 0 && Number(t.owner) === Number(myIndex);
                if (!sameUserId && !sameOwner) return false;
                if (!Number.isInteger(t.cellIdx) || t.cellIdx < 0) return false;
                if (t.excluded) return false;
                if (typeof hasRevokedTicket === 'function' && hasRevokedTicket(t.ticket)) return false;
                return true;
            });
            if (!myCells.length) {
                select.innerHTML = '<option value="">Сначала открой клетку с заданием</option>';
                select.disabled = true;
                return;
            }

            updateInkDeadlineHint();
            select.disabled = false;
            select.innerHTML = myCells.map(cell => {
                const shortTask = getTaskLabelByCell(cell).slice(0, 90);
                return `<option value="${cell.cellIdx}">Клетка №${cell.cell} · Билет ${cell.ticket} · ${shortTask}</option>`;
            }).join('');
        }

        function renderSubmissions() {
            const list = document.getElementById('works-list');
            if (!list) return;
            const isAdmin = Number(currentUserId) === Number(ADMIN_ID);
            if (isAdmin && !worksAdminSelectedUserId) {
                list.innerHTML = '<div class="works-card" style="text-align:center; color:#999;">Выберите игрока, чтобы посмотреть его работы.</div>';
                return;
            }
            const visible = allSubmissions.filter(item => {
                if (isAdmin) {
                    return String(item.userId || '') === worksAdminSelectedUserId;
                }
                const sameUserId = String(item.userId || '') === String(currentUserId || '');
                const sameOwner = Number.isInteger(myIndex) && myIndex >= 0 && Number(item.owner) === Number(myIndex);
                return sameUserId || sameOwner;
            });
            const filtered = visible;
            const pendingForReview = isAdmin
                ? allSubmissions
                    .filter(item => String(item.status || 'pending') === 'pending')
                    .sort((a, b) => (a.round || 0) - (b.round || 0) || (a.cellIdx || 0) - (b.cellIdx || 0))
                : [];

            if (!filtered.length) {
                if (isAdmin && pendingForReview.length) {
                    const pendingBodyId = 'works-pending-body';
                    list.innerHTML = `
                        <div class="works-card" style="margin-bottom:10px; border:1px dashed #fbc02d;">
                            <div class="collapse-head" onclick="toggleCollapse('${pendingBodyId}', this)">
                                <span>⏳ Требуют одобрения: ${pendingForReview.length}</span>
                                <button type="button" class="collapse-toggle">Развернуть</button>
                            </div>
                            <div id="${pendingBodyId}" class="collapse-body">
                                ${pendingForReview.map(item => {
                                    const pendingPlayer = getSubmissionPlayerNickname(item) || 'Без никнейма';
                                    return `<div style="font-size:12px; color:#444; margin-top:8px; padding-top:8px; border-top:1px solid #eee;">👤 <b style="color:${charColors[item.owner] || '#333'}">${pendingPlayer}</b> · Раунд ${item.round || '—'} · Клетка №${(item.cellIdx ?? -1) + 1}</div>`;
                                }).join('')}
                            </div>
                        </div>
                        <div class="works-card" style="text-align:center; color:#999;">Пока нет загруженных работ для выбранного игрока.</div>`;
                    return;
                }
                list.innerHTML = '<div class="works-card" style="text-align:center; color:#999;">Пока нет загруженных работ.</div>';
                return;
            }

            const pendingBodyId = 'works-pending-body';
            const pendingBlockHtml = isAdmin ? `
                <div class="works-card" style="margin-bottom:10px; border:1px dashed #fbc02d;">
                    <div class="collapse-head" onclick="toggleCollapse('${pendingBodyId}', this)">
                        <span>⏳ Требуют одобрения: ${pendingForReview.length}</span>
                        <button type="button" class="collapse-toggle">Развернуть</button>
                    </div>
                    <div id="${pendingBodyId}" class="collapse-body">
                        ${pendingForReview.length ? pendingForReview.map(item => {
                            const pendingPlayer = getSubmissionPlayerNickname(item) || 'Без никнейма';
                            const pendingTask = item.taskLabel || 'Описание задания отсутствует';
                            return `
                                <div style="margin-top:8px; padding:8px; border-radius:8px; background:#fff8e1;">
                                    <div style="font-size:12px; color:#444; line-height:1.4;">👤 <b style="color:${charColors[item.owner] || '#333'}">${pendingPlayer}</b> · Раунд ${item.round || '—'} · Клетка №${(item.cellIdx ?? -1) + 1}</div>
                                    <div style="font-size:12px; color:#555; margin-top:4px;">${pendingTask}</div>
                                    <div style="display:flex; gap:6px; margin-top:8px;">
                                        <button onclick="setSubmissionStatus('${item.id}','${item.sourcePrefix || 'submissions'}','${item.dbPath || item.id}','accepted')" style="flex:1; border:1px solid #4CAF50; color:#2e7d32; background:#f1fff1; border-radius:8px; padding:8px;">✅ Принять</button>
                                        <button onclick="setSubmissionStatus('${item.id}','${item.sourcePrefix || 'submissions'}','${item.dbPath || item.id}','rejected')" style="flex:1; border:1px solid #f44336; color:#b71c1c; background:#fff5f5; border-radius:8px; padding:8px;">❌ Отклонить</button>
                                    </div>
                                </div>`;
                        }).join('') : '<div style="font-size:12px; color:#777; margin-top:8px;">Нет работ со статусом «На проверке».</div>'}
                    </div>
                </div>` : '';

            list.innerHTML = pendingBlockHtml + filtered.map(item => {
                const status = getSubmissionStatusInfo(item.status);
                const playerName = getSubmissionPlayerNickname(item) || 'Без никнейма';
                const uploadedAt = Number(item.createdAt || item.updatedAt || 0);
                const uploadedAtText = uploadedAt ? new Date(uploadedAt).toLocaleString('ru-RU') : '—';
                const playerLine = isAdmin ? `<div style="font-size:12px; color:#666; margin-bottom:6px;">Игрок: <b style="color:${charColors[item.owner] || '#333'}">${playerName}</b> · TG ID: ${item.userId || '—'}</div>` : '';
                const reviewControls = isAdmin ? `
                    <div style="display:flex; gap:6px; margin-top:8px;">
                        <button onclick="setSubmissionStatus('${item.id}','${item.sourcePrefix || 'submissions'}','${item.dbPath || item.id}','accepted')" style="flex:1; border:1px solid #4CAF50; color:#2e7d32; background:#f1fff1; border-radius:8px; padding:8px;">✅ Принято</button>
                        <button onclick="setSubmissionStatus('${item.id}','${item.sourcePrefix || 'submissions'}','${item.dbPath || item.id}','rejected')" style="flex:1; border:1px solid #f44336; color:#b71c1c; background:#fff5f5; border-radius:8px; padding:8px;">❌ Не принято</button>
                    </div>` : '';
                const beforeBodyId = `sub-before-${item.id}`;
                const afterBodyId = `sub-after-${item.id}`;

                return `
                    <div class="works-card">
                        ${playerLine}
                        <div style="display:flex; justify-content:space-between; gap:8px; align-items:center;">
                            <div><b>Раунд ${item.round || '—'}, клетка №${(item.cellIdx ?? -1) + 1}</b></div>
                            <span class="status-chip ${status.className}">${status.text}</span>
                        </div>
                        <div style="font-size:12px; margin-top:6px; color:#555;">🎟 Билет: ${item.ticket || '—'}</div>
                        <div style="font-size:12px; margin-top:4px; color:#555;">🕒 Загружено: ${uploadedAtText}</div>
                        <div style="font-size:12px; margin-top:4px; color:#444; line-height:1.4;">${item.taskLabel || 'Описание задания отсутствует'}</div>
                        ${(item.status === 'rejected' && (item.reviewComment || item.rejectReason || item.adminComment || item.reviewNote)) ? `<div style="font-size:12px; margin-top:6px; color:#b71c1c;">Причина отказа: ${item.reviewComment || item.rejectReason || item.adminComment || item.reviewNote}</div>` : ''}

                        <div class="work-stage-block">
                            <div class="collapse-head" onclick="toggleCollapse('${beforeBodyId}', this)">
                                <span>🖼️ Фото «До»</span>
                                <button type="button" class="collapse-toggle">Развернуть</button>
                            </div>
                            <div id="${beforeBodyId}" class="collapse-body">
                                ${item.beforeImageData ? `<img src="${item.beforeImageData}" alt="Работа до" class="work-image">` : '<div style="font-size:12px; color:#999;">Фото «До» не загружено.</div>'}
                            </div>
                        </div>

                        <div class="work-stage-block">
                            <div class="collapse-head" onclick="toggleCollapse('${afterBodyId}', this)">
                                <span>🎨 Фото «После»</span>
                                <button type="button" class="collapse-toggle">Развернуть</button>
                            </div>
                            <div id="${afterBodyId}" class="collapse-body">
                                ${(item.afterImageData || item.imageData) ? `<img src="${item.afterImageData || item.imageData}" alt="Работа после" class="work-image">` : '<div style="font-size:12px; color:#999;">Фото «После» не загружено.</div>'}
                            </div>
                        </div>
                        ${reviewControls}
                    </div>
                `;
            }).join('');
        }

        function toggleCollapse(bodyId, headerEl) {
            const body = document.getElementById(bodyId);
            if (!body) return;
            const willExpand = !body.classList.contains('expanded');
            body.classList.toggle('expanded', willExpand);
            const btn = headerEl?.querySelector('.collapse-toggle');
            if (btn) btn.innerText = willExpand ? 'Свернуть' : 'Развернуть';
        }

        const PLAYER_NOTIFICATION_DISMISSED_STORAGE_KEY = 'player_notification_dismissed_ids';

        function getDismissedPlayerNotificationIds() {
            try {
                const raw = localStorage.getItem(PLAYER_NOTIFICATION_DISMISSED_STORAGE_KEY);
                const parsed = raw ? JSON.parse(raw) : [];
                return Array.isArray(parsed) ? parsed : [];
            } catch (e) {
                return [];
            }
        }

        function isPlayerNotificationDismissed(notifId) {
            if (!notifId) return false;
            return getDismissedPlayerNotificationIds().includes(String(notifId));
        }

        function rememberDismissedPlayerNotification(notifId) {
            if (!notifId) return;
            const current = getDismissedPlayerNotificationIds();
            const id = String(notifId);
            if (current.includes(id)) return;
            try {
                localStorage.setItem(PLAYER_NOTIFICATION_DISMISSED_STORAGE_KEY, JSON.stringify([...current, id].slice(-300)));
            } catch (e) {
                // ignore storage errors
            }
        }

        async function closePlayerNotification(notifId, shouldRemember = true) {
            const node = document.getElementById(notifId);
            if (node) node.remove();
            if (shouldRemember) rememberDismissedPlayerNotification(notifId);

            const notifIdStr = String(notifId || '');
            if (!notifIdStr.startsWith('sys-') || !currentUserId || !db) return;
            const notificationKey = notifIdStr.slice(4);
            if (!notificationKey) return;
            try {
                await db.ref(`system_notifications/${currentUserId}/${notificationKey}`).remove();
            } catch (err) {
                console.warn('Failed to remove player notification from DB', err);
            }
        }

        function showPlayerNotification({ id, text, borderColor = '#f48fb1' }) {
            if (!id || !text) return;
            if (isPlayerNotificationDismissed(id)) return;
            const wrap = document.getElementById('player-notification-wrap');
            if (!wrap) return;
            if (document.getElementById(id)) return;
            const card = document.createElement('div');
            card.id = id;
            card.className = 'player-notification';
            card.style.borderColor = borderColor;
            card.innerHTML = `<button class="player-notification-close" onclick="closePlayerNotification('${id}', true)">✕</button><div style="font-size:13px; line-height:1.4; color:#4a148c;">${text}</div>`;
            wrap.appendChild(card);
        }

        function resetMiniEventBadge() {
            const statusLabel = document.getElementById('duel-status-label');
            const statusText = document.getElementById('duel-status-text');
            const statusTimer = document.getElementById('duel-status-timer');
            const statusOkBtn = document.getElementById('duel-status-ok');
            if (statusText) statusText.textContent = '';
            if (statusTimer) statusTimer.textContent = '';
            if (statusOkBtn) statusOkBtn.style.display = 'none';
            if (statusLabel) statusLabel.style.display = 'none';
        }

        function getPlayerNotificationBorderColor(type) {
            if (type === 'calligraphy_duel_invite') return '#7e57c2';
            if (type === 'calligraphy_duel_declined') return '#ef5350';
            if (type === 'calligraphy_duel_wait_notice') return '#26a69a';
            if (type === 'calligraphy_duel_result') return '#f06292';
            return '#f48fb1';
        }

        function hasFullSubmissionForRound(roundNum, userId = currentUserId) {
            return allSubmissions.some(s => String(s.userId) === String(userId) && Number(s.round) === Number(roundNum) && s.beforeImageData && s.afterImageData);
        }

        function hasAcceptedSubmissionForRound(roundNum, userId = currentUserId) {
            return allSubmissions.some(s => String(s.userId) === String(userId) && Number(s.round) === Number(roundNum) && s.beforeImageData && s.afterImageData && String(s.status || '') === 'accepted');
        }

        async function burnUserTicketsAndEliminate(userId, reason = 'no_submission') {
            const boardSnap = await db.ref('board').once('value');
            const board = boardSnap.val() || {};
            const updates = {};

            Object.entries(board).forEach(([idx, cell]) => {
                if (!cell || Number(cell.userId) !== Number(userId)) return;
                updates[`board/${idx}/excluded`] = true;
                updates[`board/${idx}/ticketBurned`] = true;
            });

            const archiveSnap = await db.ref('tickets_archive').once('value');
            archiveSnap.forEach(item => {
                const v = item.val() || {};
                if (Number(v.userId) !== Number(userId)) return;
                updates[`tickets_archive/${item.key}/excluded`] = true;
                updates[`tickets_archive/${item.key}/ticketBurned`] = true;
            });

            updates[`whitelist/${userId}/isEliminated`] = true;
            updates[`whitelist/${userId}/isParticipationBlocked`] = true;
            updates[`whitelist/${userId}/eliminatedAt`] = Date.now();
            updates[`whitelist/${userId}/eliminatedAtRound`] = currentRoundNum;
            updates[`whitelist/${userId}/eliminationReason`] = reason;

            await db.ref().update(updates);
        }

        async function checkSubmissionRoundDeadlines() {
            if (!currentUserId || Number(currentUserId) === Number(ADMIN_ID) || myIndex === -1) return;
            if (!currentRoundNum || !roundEndTime) return;

            const boardSnap = await db.ref('board').once('value');
            const board = boardSnap.val() || {};

            const now = Date.now();
            const msLeft = roundEndTime - now;
            const isRoundActive = msLeft > 0;
            const currentRoundWorks = allSubmissions.filter(s => Number(s.round) === Number(currentRoundNum));
            const hasCurrentRoundWork = currentRoundWorks.some(s => String(s.userId) === String(currentUserId));
            if (isRoundActive && !hasCurrentRoundWork) {
                const remindKey = `workReminderShownRound${currentRoundNum}`;
                if (!window[remindKey]) {
                    window[remindKey] = true;
                    showPlayerNotification({
                        id: `work-reminder-${currentRoundNum}`,
                        text: 'Твоя муза застряла в проке? 🎨 Твой холст скучает без мазков. Поторопись, иначе магические чернила испарятся, а твоё место на поле займет другой художник!'
                    });
                }
            }

            const userStateSnap = await db.ref(`whitelist/${currentUserId}`).once('value');
            const userState = userStateSnap.val() || {};
            if (userState.isParticipationBlocked || userState.eliminationReason === 'no_submission') return;

            const debtSnap = await db.ref(`whitelist/${currentUserId}/debt`).once('value');
            const debt = debtSnap.val();
            if (debt?.active && Number(currentRoundNum) > Number(debt.dueRound || 0)) {
                const updates = {};
                [Number(debt.round), Number(debt.dueRound)].forEach(r => {
                    Object.entries(board).forEach(([idx, c]) => {
                        if (!c || Number(c.userId) !== Number(currentUserId) || Number(c.round) !== Number(r)) return;
                        updates[`board/${idx}/excluded`] = true;
                        updates[`board/${idx}/ticketBurned`] = true;
                        updates[`board/${idx}/invisibleMode`] = false;
                    });
                });
                updates[`whitelist/${currentUserId}/debt/active`] = false;
                updates[`whitelist/${currentUserId}/debt/failed`] = true;
                await db.ref().update(updates);
                await postNews(`🔥 ${players[myIndex].n} не закрыл(а) долг по Плащу-невидимке — оба билета сгорели.`);
                return;
            }

            const previousRound = currentRoundNum - 1;
            if (previousRound < 1) return;
            const hadPrevCell = Object.values(board).some(c => c && Number(c.userId) === Number(currentUserId) && c.round === previousRound);
            if (!hadPrevCell) return;

            if (hasAcceptedSubmissionForRound(previousRound)) return;

            const roundCells = Object.entries(board).filter(([_, c]) => c && Number(c.userId) === Number(currentUserId) && Number(c.round) === Number(previousRound));
            const updates = {};
            roundCells.forEach(([idx]) => {
                updates[`board/${idx}/excluded`] = true;
                updates[`board/${idx}/ticketBurned`] = true;
            });
            if (Object.keys(updates).length) {
                await db.ref().update(updates);
            }

            if (!hasFullSubmissionForRound(previousRound)) {
                await burnUserTicketsAndEliminate(currentUserId, 'no_submission');
                showPlayerNotification({
                    id: `work-eliminated-${previousRound}`,
                    text: 'Кажется, твоя работа так и не обнаружилась в загрузках. Печально, но твои билеты аннулированы, ты больше не принимаешь участие в игре.',
                    borderColor: '#ef5350'
                });
                await postNews(`${players[myIndex].n} выбыл(а) из игры`);
                return;
            }

            showPlayerNotification({
                id: `work-rejected-${previousRound}`,
                text: 'Работа за прошлый раунд не была принята. Билет по этому раунду исключён из участия.',
                borderColor: '#ef5350'
            });
        }

        function readImageAsDataURL(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
        }

        async function compressImage(dataUrl, maxSide = 1200, quality = 0.82) {
            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    const ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.round(img.width * ratio);
                    canvas.height = Math.round(img.height * ratio);
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/jpeg', quality));
                };
                img.src = dataUrl;
            });
        }

        async function submitWork() {
            if (Number(currentUserId) === Number(ADMIN_ID)) return alert('Режим администратора: сдача работ недоступна.');
            const select = document.getElementById('work-task-select');
            const beforeInput = document.getElementById('work-image-before-input');
            const afterInput = document.getElementById('work-image-after-input');
            if (!select || select.disabled) return alert('Нет доступных заданий для сдачи.');
            const chosenCellIdx = Number(select.value);
            if (!Number.isInteger(chosenCellIdx) || chosenCellIdx < 0) return alert('Выбери задание.');
            const beforeFile = beforeInput?.files?.[0];
            const afterFile = afterInput?.files?.[0];
            if (!beforeFile || !afterFile) return alert('Нужно добавить оба фото: «До» и «После».');

            const boardCellSnap = await db.ref(`board/${chosenCellIdx}`).once('value');
            const cell = boardCellSnap.val();
            if (!cell || cell.userId !== currentUserId) return alert('Можно отправлять только свою работу по своему заданию.');

            const debtSnap = await db.ref(`whitelist/${currentUserId}/debt`).once('value');
            const debt = debtSnap.val();
            if (debt?.active) {
                const mustRounds = [Number(debt.round), Number(debt.dueRound)].filter(n => Number.isInteger(n) && n > 0);
                const selectedRound = Number(cell.round);
                if (!mustRounds.includes(selectedRound)) {
                    return alert('При активном Плаще-невидимке можно сдавать только задания долга: за прошлый и текущий раунды.');
                }
            }
            if (cell.excluded) return alert('По этому заданию ты уже сдался(ась), билетик не начисляется.');
            if (typeof hasRevokedTicket === 'function' && hasRevokedTicket(cell.ticket)) {
                return alert('Этот билетик вычеркнут из игры, загрузка работы для него недоступна.');
            }

            const existing = getLatestSubmissionForCell(cell.round, chosenCellIdx);
            if (existing?.status === 'pending' || existing?.status === 'accepted') {
                refreshUploadStateForSelectedTask();
                return alert(existing.status === 'pending' ? 'Работа уже на проверке. Дождись модерации.' : 'Эта работа уже принята. Повторная загрузка заблокирована.');
            }

            const challengeSnap = await db.ref(`whitelist/${currentUserId}/ink_challenge`).once('value');
            const challenge = challengeSnap.val();
            if (cell.isWandBlessing) {
                const wandSnap = await db.ref(`whitelist/${currentUserId}/wand_blessing`).once('value');
                const wand = wandSnap.val();
                if (!wand || !wand.selectedOption) return alert('Сначала выбери упрощённое задание от волшебной палочки.');
            }

            if (cell.isInkChallenge && challenge?.selectedOption === 4) {
                if (!challenge.optionDeadline || Date.now() > challenge.optionDeadline) {
                    return alert('⏰ Срок 24 часа истёк, билетик за это задание не начисляется.');
                }
            }

            const beforeRaw = await readImageAsDataURL(beforeFile);
            const afterRaw = await readImageAsDataURL(afterFile);
            const beforeImageData = await compressImage(beforeRaw);
            const afterImageData = await compressImage(afterRaw);

            const payload = {
                userId: currentUserId,
                owner: myIndex,
                cellIdx: chosenCellIdx,
                round: cell.round,
                ticket: cell.ticket,
                taskLabel: getTaskLabelByCell(cell),
                beforeImageData,
                afterImageData,
                status: 'pending',
                createdAt: Date.now(),
                updatedAt: Date.now()
            };

            if (String(cell.mode || '') === 'snake') {
                const snakeStateSnap = await db.ref(`whitelist/${currentUserId}/snakeState`).once('value');
                const snakeState = snakeStateSnap.val() || {};
                const activeTask = snakeState.activeTask || {};
                if (Number(activeTask.cell || 0) === Number(chosenCellIdx) + 1) {
                    payload.snakeTaskType = String(activeTask.type || 'snake_standard');
                    payload.snakeTaskCell = Number(activeTask.cell || 0);
                    payload.snakeTaskRound = Number(activeTask.round || cell.round || 0);
                    payload.isSphinxTrial = !!activeTask.isSphinxTrial;
                    if (activeTask.taskLabel) payload.taskLabel = String(activeTask.taskLabel);
                }
            }
            await db.ref('submissions').push(payload);

            if (cell.deferred || cell.invisibleMode) {
                await db.ref(`board/${chosenCellIdx}`).update({ deferred: false });
            }

            if (cell.isInkChallenge && challenge?.selectedOption === 4 && !challenge.isResolved) {
                await db.ref(`board/${chosenCellIdx}/ticket`).set(challenge.pendingTicket || '');
                await db.ref(`whitelist/${currentUserId}/ink_challenge`).update({ isResolved: true, submittedInTime: true });
            }

            beforeInput.value = '';
            afterInput.value = '';
            alert('Работа загружена! Статус: На проверке.');
        }

        async function setSubmissionStatus(submissionId, sourcePrefix, dbPath, status) {

            if (Number(currentUserId) !== Number(ADMIN_ID)) return;
            if (!['accepted', 'rejected'].includes(status)) return;
            const refPath = sourcePrefix === 'works' ? `works/${dbPath || submissionId}` : `submissions/${dbPath || submissionId}`;
            const patch = {
                status,
                reviewedBy: currentUserId,
                updatedAt: Date.now()
            };
            if (status === 'rejected') {
                const reason = prompt('Укажи причину отказа (игрок увидит это сообщение):', '');
                if (reason === null) return;
                patch.reviewComment = reason.trim();
            }
            if (status === 'accepted') {
                patch.reviewComment = '';
            }
            await db.ref(refPath).update(patch);
            if (status === 'accepted') {
                const rowSnap = await db.ref(refPath).once('value');
                const row = rowSnap.val() || {};
                const uid = String(row.userId || '');
                const roundSnap = await db.ref('current_round').once('value');
                const roundData = roundSnap.val() || {};
                if (uid && window.snakeRound?.isSnakeRound?.(roundData)) {
                    const activeTaskSnap = await db.ref(`whitelist/${uid}/snakeState/activeTask`).once('value');
                    const activeTask = activeTaskSnap.val() || {};
                    const rowCell = Number(row.cellIdx) + 1;
                    const activeCell = Number(activeTask.cell || 0);
                    const isActiveCellMatch = activeCell > 0 && rowCell === activeCell;
                    const activeTaskType = String(activeTask.type || 'snake_standard');
                    const rowTaskType = String(row.snakeTaskType || 'snake_standard');
                    const isSphinxTask = !!activeTask.isSphinxTrial || activeTaskType === 'snake_sphinx';
                    const isTaskTypeMatch = rowTaskType === activeTaskType;
                    if (isActiveCellMatch && isTaskTypeMatch) {
                        const ticketCounterSnap = await db.ref('ticket_counter').once('value');
                        const nextTicket = (Number(ticketCounterSnap.val()) || 0) + 1;
                        const ticketPayload = {
                            num: nextTicket,
                            ticketNum: nextTicket,
                            ticket: String(nextTicket),
                            userId: uid,
                            owner: Number(row.owner),
                            round: Number(row.round || roundData.number || 0),
                            cell: Number(activeTask.cell || 0),
                            taskIdx: Number(activeTask.taskIdx ?? -1),
                            taskLabel: String(row.taskLabel || ''),
                            mode: 'snake',
                            createdAt: Date.now()
                        };
                        const updates = {};
                        updates.ticket_counter = nextTicket;
                        updates[`tickets/${nextTicket}`] = ticketPayload;
                        updates[`users/${uid}/tickets/${nextTicket}`] = ticketPayload;
                        updates[`whitelist/${uid}/snakeState/awaitingApproval`] = false;
                        updates[`whitelist/${uid}/snakeState/lockedBySphinx`] = isSphinxTask ? false : !!activeTask.lockedBySphinx;
                        updates[`whitelist/${uid}/snakeState/activeTask/isSphinxTrial`] = false;
                        updates[`system_notifications/${uid}/${Date.now()}_snake_ticket`] = {
                            text: `Твоя работа принята! Твой номер в розыгрыше: #${nextTicket}`,
                            type: 'snake_ticket',
                            createdAt: Date.now(),
                            expiresAt: Date.now() + (7 * 24 * 3600 * 1000)
                        };
                        if (isSphinxTask) {
                            const clearTs = Date.now();
                            updates[`system_notifications/${uid}/snake_sphinx_trial_done_${clearTs}`] = {
                                text: '🗿 Испытание Сфинкса пройдено. Путь снова открыт.',
                                type: 'snake_sphinx_trial_done',
                                onceKey: `snake_sphinx_trial_done_${Number(activeTask.round || 0)}_${activeCell}`,
                                createdAt: clearTs,
                                expiresAt: clearTs + (24 * 60 * 60 * 1000)
                            };
                        }
                        await db.ref().update(updates);
                        await updateKarma(uid, 5);

                        const synergyCell = Number(activeTask.cell || 0);
                        const synergyRound = Number(row.round || roundData.number || 0);
                        const synergySnap = await db.ref(`snake_synergy/${synergyRound}/${synergyCell}`).once('value');
                        for (const pairNode of Object.entries(synergySnap.val() || {})) {
                            const [pairKey, synergyRow] = pairNode;
                            const playersPair = Array.isArray(synergyRow?.players) ? synergyRow.players.map((v) => String(v || '').trim()) : [];
                            if (!playersPair.includes(uid)) continue;
                            if (String(synergyRow?.status || '') !== 'active') continue;
                            if (synergyRow?.appliedTo && synergyRow.appliedTo[uid]) continue;

                            await updateKarma(uid, 5);
                            const opponentId = playersPair.find((x) => String(x) !== uid) || '';
                            const clashId = `${synergyRound}_${synergyCell}_${pairKey}`;
                            const appliedMap = { ...(synergyRow.appliedTo || {}), [uid]: true };
                            const done = playersPair.every((id) => !!appliedMap[String(id)]);
                            const synergyUpdates = {};
                            synergyUpdates[`snake_synergy/${synergyRound}/${synergyCell}/${pairKey}/appliedTo`] = appliedMap;
                            synergyUpdates[`snake_synergy/${synergyRound}/${synergyCell}/${pairKey}/updatedAt`] = Date.now();
                            if (done) {
                                synergyUpdates[`snake_synergy/${synergyRound}/${synergyCell}/${pairKey}/status`] = 'completed';
                                synergyUpdates[`snake_synergy/${synergyRound}/${synergyCell}/${pairKey}/completedAt`] = Date.now();
                            }
                            synergyUpdates[`system_notifications/${uid}/snake_synergy_bonus_${clashId}_${uid}`] = {
                                text: 'Синергия сработала! Ты получил(а) +5 кармы.',
                                type: 'snake_synergy_bonus',
                                clashId,
                                onceKey: `synergy_bonus_${clashId}_${uid}`,
                                partnerId: opponentId,
                                createdAt: Date.now(),
                                expiresAt: Date.now() + (2 * 60 * 60 * 1000)
                            };
                            await db.ref().update(synergyUpdates);
                        }
                    }
                }
                if (uid) {
                    const debtSnap = await db.ref(`whitelist/${uid}/debt`).once('value');
                    const debt = debtSnap.val();
                    if (debt?.active) {
                        const acceptedMap = debt.acceptedRounds || {};
                        acceptedMap[String(row.round)] = true;
                        const mustA = String(debt.round);
                        const mustB = String(debt.dueRound);
                        const closed = !!acceptedMap[mustA] && !!acceptedMap[mustB];
                        const updates = { [`whitelist/${uid}/debt/acceptedRounds`]: acceptedMap };
                        if (closed) {
                            updates[`whitelist/${uid}/debt/active`] = false;
                            updates[`whitelist/${uid}/debt/closedAt`] = Date.now();
                            const boardSnap = await db.ref('board').once('value');
                            const board = boardSnap.val() || {};
                            Object.entries(board).forEach(([idx, c]) => {
                                if (!c || Number(c.userId) !== Number(uid)) return;
                                updates[`board/${idx}/invisibleMode`] = false;
                            });
                        }
                        await db.ref().update(updates);
                    }
                }
            }
        }

        window.isPlayerNotificationDismissed = isPlayerNotificationDismissed;

        let seasonProfileRef = null;
        let seasonKarmaRef = null;
        let seasonProfileData = { karma_points: 0, nickname: '', avatar_url: '' };
        let masterTrapVisionSyncState = null;

        const KARMA_LEVEL_STEP = 100;
        const MAX_RANK_KARMA = 100;
        const KARMA_VISUAL_LEVELS = [
            { min: 0, title: 'Зритель из Первого Ряда', icon: '', border: 'linear-gradient(135deg,#bdbdbd,#9e9e9e)' },
            { min: 21, title: 'Ценитель', icon: '', border: 'linear-gradient(135deg,#d7ccc8,#a1887f)' },
            { min: 41, title: 'Золотая Кисть', icon: '', border: 'linear-gradient(135deg,#90caf9,#5c6bc0)' },
            { min: 61, title: 'Творец Миров', icon: '', border: 'linear-gradient(135deg,#ce93d8,#7e57c2)' },
            { min: 86, title: 'Бессмертный Мастер', icon: '', border: 'linear-gradient(135deg,#ffe082,#ff7043)' }
        ];

        function getCurrentPlayerNickname() {
            const gameplayNickname = players[myIndex]?.n;
            if (String(gameplayNickname || '').trim()) return gameplayNickname;
            const seasonNickname = String(seasonProfileData.nickname || '').trim();
            if (seasonNickname) return seasonNickname;
            return 'Путешественник';
        }

        function getKarmaVisualMeta(points) {
            const karma = Math.max(0, Number(points) || 0);
            let found = KARMA_VISUAL_LEVELS[0];
            for (const level of KARMA_VISUAL_LEVELS) {
                if (karma >= level.min) found = level;
            }
            return found;
        }

        function renderProfileAvatar(nickname, avatarUrl, points) {
            const avatarEl = document.getElementById('profile-avatar');
            if (!avatarEl) return;
            const meta = getKarmaVisualMeta(points);
            avatarEl.style.boxShadow = `0 0 0 3px rgba(255,255,255,.9), 0 0 0 6px rgba(0,0,0,.05)`;
            avatarEl.style.border = '2px solid #fff';
            if (avatarUrl) {
                avatarEl.innerHTML = `<img src="${avatarUrl}" alt="Аватар" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
            } else {
                const initial = String(nickname || 'П').trim().charAt(0).toUpperCase() || 'П';
                avatarEl.textContent = initial;
                avatarEl.style.color = '#fff';
                avatarEl.style.fontWeight = '800';
            }
            avatarEl.style.background = meta.border;
        }

        function updateProfileUI() {
            const isAdmin = Number(currentUserId) === Number(ADMIN_ID);
            const profileMainTitleEl = document.getElementById('profile-main-title');
            const profileTicketsTitleEl = document.getElementById('profile-tickets-title');
            const playerBlockEl = document.getElementById('profile-player-block');
            const playerTicketsEl = document.getElementById('profile-player-tickets-block');
            const adminSubtabsEl = document.getElementById('admin-tickets-subtabs');
            const adminAllPanelEl = document.getElementById('admin-tickets-all-panel');
            const adminPlayerPanelEl = document.getElementById('admin-tickets-player-panel');
            if (isAdmin) {
                if (profileMainTitleEl) profileMainTitleEl.textContent = '👤 Профили игроков';
                if (profileTicketsTitleEl) profileTicketsTitleEl.style.display = 'none';
                if (playerBlockEl) playerBlockEl.style.display = 'none';
                if (playerTicketsEl) playerTicketsEl.style.display = 'none';
                if (adminSubtabsEl) adminSubtabsEl.style.display = 'flex';
                if (adminAllPanelEl) adminAllPanelEl.style.display = adminTicketsSubtab === 'all' ? 'block' : 'none';
                if (adminPlayerPanelEl) adminPlayerPanelEl.style.display = adminTicketsSubtab === 'all' ? 'none' : 'block';
                return;
            }
            if (profileMainTitleEl) profileMainTitleEl.textContent = '👤 Профиль';
            if (profileTicketsTitleEl) profileTicketsTitleEl.style.display = 'block';
            if (playerBlockEl) playerBlockEl.style.display = 'block';
            if (playerTicketsEl) playerTicketsEl.style.display = 'block';
            if (adminSubtabsEl) adminSubtabsEl.style.display = 'none';
            if (adminAllPanelEl) adminAllPanelEl.style.display = 'block';
            if (adminPlayerPanelEl) adminPlayerPanelEl.style.display = 'none';

            const nickname = getCurrentPlayerNickname();
            const karma = Math.max(0, Number(seasonProfileData.karma_points) || 0);
            const karmaText = document.getElementById('profile-karma-points');
            const karmaBar = document.getElementById('karma-progress');
            const karmaRank = document.getElementById('profile-karma-rank');
            const nickEl = document.getElementById('profile-nickname');
            const visual = getKarmaVisualMeta(karma);
            if (nickEl) nickEl.textContent = nickname;
            renderProfileAvatar(nickname, seasonProfileData.avatar_url || seasonProfileData.photo_url || '', karma);
            let progress = (karma / MAX_RANK_KARMA) * 100;
            progress = Math.max(0, Math.min(100, progress));
            if (karmaText) karmaText.textContent = `${karma} / ${MAX_RANK_KARMA}`;
            if (karmaBar) karmaBar.style.width = progress + '%';
            if (karmaRank) karmaRank.textContent = visual.icon ? `${visual.title} ${visual.icon}` : visual.title;
        }

        async function syncMasterTrapVisionState(userId, karmaPoints) {
            const uid = String(userId || '').trim();
            if (!uid || uid === String(ADMIN_ID)) return;
            const enabled = Number(karmaPoints || 0) >= 90;
            if (masterTrapVisionSyncState === enabled) return;
            masterTrapVisionSyncState = enabled;
            try {
                await db.ref(`whitelist/${uid}/snakeState`).update({
                    masterTrapVisionEnabled: enabled,
                    masterTrapVisionSource: enabled ? {
                        generatedAt: Date.now(),
                        reason: 'karma_threshold_sync'
                    } : null
                });
            } catch (err) {
                console.warn('syncMasterTrapVisionState failed', err);
                masterTrapVisionSyncState = null;
            }
        }

        async function syncSeasonProfile() {
            const userId = String(currentUserPathId || currentUserId || '').trim();
            if (!userId) return;
            if (String(userId) === String(ADMIN_ID)) {
                seasonProfileData = { karma_points: 0, nickname: 'Администратор', avatar_url: '' };
                masterTrapVisionSyncState = null;
                updateProfileUI();
                return;
            }
            const fallbackNickname = getTelegramDisplayName();
            const fallbackAvatarUrl = String(telegramUser.photo_url || '').trim();
            const profileRef = db.ref(`player_season_status/${userId}`);
            console.log("Current Player Path:", 'player_season_status/' + userId);
            await window.karmaSystem.ensureSeasonProfile(db, userId, fallbackNickname, false);

            if (seasonProfileRef) seasonProfileRef.off();
            seasonProfileRef = profileRef;
            onValue(seasonProfileRef, snap => {
                if (!snap.exists()) {
                    seasonProfileData = {
                        karma_points: 0,
                        nickname: fallbackNickname || 'Путешественник',
                        avatar_url: fallbackAvatarUrl || ''
                    };
                    updateProfileUI();
                    return;
                }
                const data = snap.val() || {};
                seasonProfileData = {
                    ...seasonProfileData,
                    ...data,
                    nickname: String(data.nickname || fallbackNickname || 'Путешественник'),
                    avatar_url: String(data.avatar_url || data.photo_url || fallbackAvatarUrl || '')
                };
                if (seasonProfileData.nickname === 'Путешественник' && fallbackNickname && fallbackNickname !== 'Путешественник') {
                    profileRef.update({ nickname: fallbackNickname, updatedAt: Date.now() });
                    seasonProfileData.nickname = fallbackNickname;
                }
                syncMasterTrapVisionState(userId, seasonProfileData.karma_points).catch((err) => console.warn('syncMasterTrapVisionState failed', err));
                updateProfileUI();
            });
        }

        function updateProfileTicketBalance(expandedRows) {
            const el = document.getElementById('profile-ticket-balance');
            if (!el) return;
            const rows = Array.isArray(expandedRows) ? expandedRows : (window.expandTicketsRows ? window.expandTicketsRows(allTicketsData) : []);
            const mine = rows.filter(t => !t.excluded && !t.isRevoked && (t.owner === myIndex || Number(t.userId) === Number(currentUserId)));
            el.textContent = String(mine.length);
        }

        function resolveSubmissionOwnerUserId(work) {
            const directUserId = String(work?.userId || '').trim();
            if (directUserId) return directUserId;
            const byOwnerTicket = allTicketsData.find(t => Number(t.owner) === Number(work?.owner) && t.userId);
            return String(byOwnerTicket?.userId || '').trim();
        }

        function getGalleryApprovedPool() {
            return (allSubmissions || []).filter(work => {
                if (!work || String(work.status || '') !== 'accepted') return false;
                if (!(work.afterImageData || work.imageData)) return false;

                const ownerUserId = resolveSubmissionOwnerUserId(work);
                if (!ownerUserId || ownerUserId === String(ADMIN_ID)) return false;

                const profile = seasonProfilesByUserId?.[ownerUserId];
                if (!profile || profile.deletedAt) return false;

                return true;
            });
        }

        function pickExhibitWorks(acceptedWorks, size = 1) {
            if (!acceptedWorks.length) return [];
            const safeSize = Math.max(1, Number(size) || 1);
            if (acceptedWorks.length <= safeSize) return [...acceptedWorks];

            const slot = getGallerySlot();
            let seed = (slot % 2147483647) || 1;
            const pool = [...acceptedWorks];
            for (let i = pool.length - 1; i > 0; i -= 1) {
                seed = (seed * 48271) % 2147483647;
                const j = seed % (i + 1);
                [pool[i], pool[j]] = [pool[j], pool[i]];
            }
            return pool.slice(0, safeSize);
        }

        async function spendTicketsTransaction(cost) {
            if (!cost) return true;
            const rows = (window.expandTicketsRows ? window.expandTicketsRows(allTicketsData) : []).filter(t => !t.excluded && !t.isRevoked && (t.owner === myIndex || Number(t.userId) === Number(currentUserId)));
            if (rows.length < cost) return false;
            const selected = rows.slice(0, cost);
            const committed = [];
            for (const row of selected) {
                const num = String(row.ticketNum || '').trim();
                const tx = await db.ref(`revoked_tickets/${num}`).transaction(v => v ? undefined : true);
                if (!tx.committed) {
                    await Promise.all(committed.map(n => db.ref(`revoked_tickets/${n}`).remove()));
                    return false;
                }
                committed.push(num);
            }
            return true;
        }

        const GALLERY_ROTATION_PERIOD_MS = 2 * 60 * 60 * 1000;
        let galleryServerOffsetMs = 0;
        let galleryRotationTimer = null;
        let selectedKarmaUserId = '';

        function getServerNow() {
            return Date.now() + (Number(galleryServerOffsetMs) || 0);
        }

        function getGallerySlot(timestamp = getServerNow()) {
            return Math.floor(timestamp / GALLERY_ROTATION_PERIOD_MS);
        }

        function startGalleryRotationCountdown() {
            if (galleryRotationTimer) clearInterval(galleryRotationTimer);
            const period = GALLERY_ROTATION_PERIOD_MS;
            const formatCountdown = (msLeft) => {
                const totalSec = Math.max(0, Math.floor(msLeft / 1000));
                const hh = String(Math.floor(totalSec / 3600)).padStart(2, '0');
                const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
                const ss = String(totalSec % 60).padStart(2, '0');
                return `${hh}:${mm}:${ss}`;
            };
            const updateCountdown = () => {
                const now = getServerNow();
                const nextRotationAt = (Math.floor(now / period) + 1) * period;
                const msLeft = Math.max(0, nextRotationAt - now);
                const timerEl = document.getElementById('gallery-rotation-countdown');
                if (timerEl) timerEl.textContent = formatCountdown(msLeft);
            };
            updateCountdown();
            galleryRotationTimer = setInterval(updateCountdown, 1000);
        }

        function sanitizeGalleryKeyPart(value) {
            return String(value || '').trim().replace(/[.#$\[\]/\:]/g, '_');
        }

        function getGalleryWorkReactionBinding(work) {
            const ownerUserId = resolveSubmissionOwnerUserId(work);
            const sourcePrefix = sanitizeGalleryKeyPart(work?.sourcePrefix || 'submissions');
            const dbPath = sanitizeGalleryKeyPart(work?.dbPath || work?.id || 'unknown');
            const stableWorkId = `${sourcePrefix}__${dbPath}`;
            const legacyPrefix = `${ownerUserId || 'unknown'}_${String(work?.id || '').trim()}_`;
            return { stableWorkId, legacyPrefix, ownerUserId };
        }

        async function getGalleryComplimentStats(exhibitId, legacyPrefix = '') {
            const counts = { clap: 0, heart: 0, sun: 0 };
            const id = String(exhibitId || '').trim();
            if (!id) return counts;

            const addCounts = (rawMap) => {
                Object.values(rawMap || {}).forEach((entry) => {
                    const type = String(entry?.type || '').trim();
                    if (Object.prototype.hasOwnProperty.call(counts, type)) counts[type] += 1;
                });
            };

            const snap = await db.ref(`gallery_compliments/${id}`).once('value');
            addCounts(snap.val() || {});

            const legacy = String(legacyPrefix || '').trim();
            if (legacy) {
                const allSnap = await db.ref('gallery_compliments').once('value');
                const all = allSnap.val() || {};
                Object.entries(all).forEach(([key, votes]) => {
                    if (String(key || '') === id) return;
                    if (!String(key || '').startsWith(legacy)) return;
                    addCounts(votes || {});
                });
            }

            return counts;
        }

        async function updateGalleryFeedbackLine(exhibitId, legacyPrefix = '') {
            const feedbackEl = document.getElementById('gallery-feedback-line');
            if (!feedbackEl) return;
            const expectedExhibitId = String(feedbackEl.dataset.exhibitId || '').trim();
            const requestedExhibitId = String(exhibitId || '').trim();
            if (!requestedExhibitId || expectedExhibitId !== requestedExhibitId) return;
            const effectiveLegacyPrefix = String(legacyPrefix || feedbackEl.dataset.legacyPrefix || '').trim();
            const stats = await getGalleryComplimentStats(requestedExhibitId, effectiveLegacyPrefix);
            if (String(feedbackEl.dataset.exhibitId || '').trim() !== requestedExhibitId) return;
            feedbackEl.textContent = `Отклик за всю историю: ${stats.clap} 👏 · ${stats.heart} ❤️ · ${stats.sun} ☀️.`;
        }

        function playGalleryChime() {
            try {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtx) return;
                const ctx = new AudioCtx();
                const now = ctx.currentTime;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, now);
                osc.frequency.exponentialRampToValueAtTime(1320, now + 0.22);
                gain.gain.setValueAtTime(0.0001, now);
                gain.gain.exponentialRampToValueAtTime(0.12, now + 0.03);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now);
                osc.stop(now + 0.5);
            } catch (e) {
                console.warn('chime error', e);
            }
        }

        function launchVoteConfetti() {
            if (typeof window.confetti !== 'function') return;
            const duration = 3000;
            const end = Date.now() + duration;
            const frame = () => {
                window.confetti({ particleCount: 40, startVelocity: 35, spread: 90, origin: { x: 0.5, y: 0.5 } });
                if (Date.now() < end) requestAnimationFrame(frame);
            };
            frame();
        }

        function isRecentRoundResult(endedAt) {
            return Number(endedAt || 0) > 0 && (Date.now() - Number(endedAt || 0)) < 60000;
        }

        function checkLastRoundResult(roundKey) {
            const key = String(roundKey || '').trim();
            if (!key) return false;
            const sessionKey = `round-result-shown-${key}`;
            if (sessionStorage.getItem(sessionKey) === '1') return false;
            sessionStorage.setItem(sessionKey, '1');
            return true;
        }


        async function updateKarma(targetUserId, amount) {
            const uid = String(targetUserId || '').trim();
            const delta = Number(amount) || 0;
            if (!uid) return 0;
            if (!window.karmaSystem || typeof window.karmaSystem.addKarmaPoints !== 'function') {
                await db.ref(`player_season_status/${uid}`).update({
                    karma_points: firebase.database.ServerValue.increment(delta),
                    updatedAt: Date.now()
                });
                const fallbackSnap = await db.ref(`player_season_status/${uid}/karma_points`).once('value');
                return Number(fallbackSnap.val()) || 0;
            }
            const fallbackNickname = getTelegramDisplayName();
            await window.karmaSystem.ensureSeasonProfile(db, uid, fallbackNickname, false);
            return window.karmaSystem.addKarmaPoints(db, uid, delta, ADMIN_ID);
        }

        async function sendGalleryCompliment(type, exhibitId, ownerUserId) {
            if (String(currentUserId) === String(ADMIN_ID)) return alert('Админ не может участвовать в голосовании');
            if (!currentUserId) return alert('Пользователь не определён.');
            const targetOwnerUserId = String(ownerUserId || '').trim();
            if (!targetOwnerUserId) return alert('Не удалось определить автора работы.');
            if (targetOwnerUserId === String(currentUserId)) return alert('Нельзя хвалить самого себя.');
            const map = { clap: { cost: 0, points: 1, emoji: '👏' }, heart: { cost: 1, points: 3, emoji: '❤️' }, sun: { cost: 2, points: 5, emoji: '🌞' } };
            const cfg = map[type];
            if (!cfg) return;

            const limitTx = await db.ref(`gallery_compliments/${exhibitId}/${currentUserId}`).transaction(v => v ? undefined : { type, at: Date.now(), points: cfg.points });
            if (!limitTx.committed) return alert('Ты уже отправлял(а) комплимент этой картине.');

            const paid = await spendTicketsTransaction(cfg.cost);
            if (!paid) {
                await db.ref(`gallery_compliments/${exhibitId}/${currentUserId}`).remove();
                return alert('Недостаточно билетиков для этого комплимента.');
            }

            const nextKarma = await updateKarma(currentUserId, cfg.points || 0);
            if (String(currentUserId) !== String(ADMIN_ID)) {
                seasonProfileData.karma_points = Math.max(0, Number(nextKarma) || 0);
                updateProfileUI();
            }
            await db.ref(`player_season_status/${currentUserId}`).update({
                updatedAt: Date.now(),
                lastGalleryComplimentAt: Date.now(),
                lastGalleryComplimentType: String(type || ''),
                lastGalleryComplimentExhibitId: String(exhibitId || '')
            });
            if (currentUserRole === 'admin') {
                console.info(`[KARMA][ADMIN] Комплимент ${cfg.emoji}: userId=${currentUserId}, delta=${cfg.points}, total=${nextKarma}`);
            }
            const fx = document.getElementById('gallery-fx');
            if (fx) {
                fx.textContent = cfg.emoji.repeat(6);
                fx.className = `gallery-fx active ${type}`;
                setTimeout(() => { fx.className = 'gallery-fx'; fx.textContent = ''; }, 1200);
            }
            playGalleryChime();
            launchVoteConfetti();
            alert('Комплимент отправлен!');
            updateProfileTicketBalance();
            renderGalleryTab();
        }

        function renderGalleryTab() {
            const wrap = document.getElementById('gallery-content');
            if (!wrap) return;
            const approvedPool = getGalleryApprovedPool();
            const picked = pickExhibitWorks(approvedPool, 1)[0] || null;
            if (!picked) {
                wrap.innerHTML = `<div class="gallery-pedestal empty"><div class="gallery-frame-empty"></div><p>Твое место в истории пустует... Будь первым, чью работу увидят все!</p><button class="admin-btn" onclick="switchTab('tab-works', document.querySelector('.nav-item[onclick*=\"tab-works\"]'))" style="margin:0; width:100%;">Перейти к заданиям</button></div>`;
                return;
            }
            const { stableWorkId: exhibitId, legacyPrefix, ownerUserId } = getGalleryWorkReactionBinding(picked);
            const img = picked.afterImageData || picked.imageData;
            wrap.innerHTML = `
                <div id="gallery-fx" class="gallery-fx"></div>
                <div class="gallery-pedestal">
                    <img src="${img}" class="gallery-image" alt="Выставленная работа">
                    <div id="gallery-feedback-line" data-exhibit-id="${exhibitId}" data-legacy-prefix="${legacyPrefix}" style="font-size:12px; margin-top:6px;">Отклик за всю историю: 0 👏 · 0 ❤️ · 0 ☀️.</div>
                    <div class="gallery-compliments" style="margin-top:8px;">
                        <div class="compliment-option">
                            <button class="admin-btn compliment-btn clap" style="margin:0; opacity:${currentUserRole === 'admin' ? '0.5' : '1'};" ${currentUserRole === 'admin' ? 'disabled' : ''} onclick="sendGalleryCompliment('clap','${exhibitId}','${ownerUserId}')">👏</button>
                            <small>Бесплатно (+1 Карма)</small>
                        </div>
                        <div class="compliment-option">
                            <button class="admin-btn compliment-btn heart" style="margin:0; opacity:${currentUserRole === 'admin' ? '0.5' : '1'};" ${currentUserRole === 'admin' ? 'disabled' : ''} onclick="sendGalleryCompliment('heart','${exhibitId}','${ownerUserId}')">❤️</button>
                            <small>1 Билет (+3 Карма)</small>
                        </div>
                        <div class="compliment-option">
                            <button class="admin-btn compliment-btn sun" style="margin:0; opacity:${currentUserRole === 'admin' ? '0.5' : '1'};" ${currentUserRole === 'admin' ? 'disabled' : ''} onclick="sendGalleryCompliment('sun','${exhibitId}','${ownerUserId}')">🌞</button>
                            <small>2 Билета (+5 Карма)</small>
                        </div>
                    </div>
                </div>`;
            updateGalleryFeedbackLine(exhibitId, legacyPrefix);
        }

        function adminRenderKarmaSearchResults() {
            if (currentUserRole !== 'admin') return;
            const q = String(document.getElementById('admin-karma-search')?.value || '').trim().toLowerCase();
            const wrap = document.getElementById('admin-karma-search-results');
            if (!wrap) return;
            const rows = Object.entries(window.cachedUsersData || {}).map(([uid, v]) => ({ uid, name: players[Number(v?.charIndex)]?.n || v?.name || `ID ${uid}` }));
            const filtered = rows.filter(r => !q || r.uid.includes(q) || r.name.toLowerCase().includes(q)).slice(0, 50);
            wrap.innerHTML = filtered.map(r => `<button class="admin-btn" style="margin:0 0 4px; width:100%; background:#ede7f6; color:#4a148c;" onclick="adminSelectKarmaUser('${r.uid}')">${r.name} · ID ${r.uid}</button>`).join('') || '<div style="font-size:12px; color:#777;">Ничего не найдено.</div>';
        }

        async function adminSelectKarmaUser(userId) {
            if (currentUserRole !== 'admin') return;
            selectedKarmaUserId = String(userId || '').trim();
            const snap = await db.ref(`player_season_status/${selectedKarmaUserId}/karma_points`).once('value');
            const karma = Number(snap.val()) || 0;
            const box = document.getElementById('admin-karma-selected');
            const pickedName = players[Number((window.cachedUsersData || {})[selectedKarmaUserId]?.charIndex)]?.n || `ID ${selectedKarmaUserId}`;
            if (box) box.innerHTML = `Выбран: <b>${pickedName}</b> (ID: ${selectedKarmaUserId})<br>Текущая карма: <b>${karma}</b>`;
        }

        async function adminAdjustKarma(direction) {
            if (currentUserRole !== 'admin') return;
            if (!selectedKarmaUserId) return alert('Сначала выбери игрока.');
            const amount = Math.max(1, Number(document.getElementById('admin-karma-amount')?.value || 0));
            const delta = (direction >= 0 ? 1 : -1) * amount;
            const fallbackNickname = players[Number((window.cachedUsersData || {})[selectedKarmaUserId]?.charIndex)]?.n || `ID ${selectedKarmaUserId}`;
            if (window.karmaSystem) {
                await window.karmaSystem.ensureSeasonProfile(db, selectedKarmaUserId, fallbackNickname, false);
            }
            await adminUpdate(`player_season_status/${selectedKarmaUserId}`, {
                karma_points: firebase.database.ServerValue.increment(delta),
                updatedAt: Date.now(),
                updatedByAdmin: String(currentUserId)
            });
            console.info(`[KARMA][ADMIN] manual_adjust path=player_season_status/${selectedKarmaUserId}/karma_points delta=${delta}`);
            await adminSelectKarmaUser(selectedKarmaUserId);
            alert(delta > 0 ? 'Карма начислена.' : 'Карма списана.');
        }

        window.adminRenderKarmaSearchResults = adminRenderKarmaSearchResults;
        window.adminSelectKarmaUser = adminSelectKarmaUser;
        window.adminAdjustKarma = adminAdjustKarma;
	        window.sendGalleryCompliment = sendGalleryCompliment;

        // END works.js

        window.Telegram.WebApp.ready();
        tg.expand();
        window.addEventListener('load', () => init());
        function normalizeInventory(rawInventory) {
            const source = (rawInventory && typeof rawInventory === 'object') ? rawInventory : {};
            return INVENTORY_ITEM_KEYS.reduce((acc, key) => {
                acc[key] = Number(source[key] || 0);
                return acc;
            }, {});
        }

        async function cleanupUnsupportedInventoryKeys(uid, rawInventory) {
            if (!uid || !rawInventory || typeof rawInventory !== 'object') return;
            const unknownKeys = Object.keys(rawInventory).filter((key) => !INVENTORY_ITEM_KEYS.includes(key));
            if (!unknownKeys.length) return;
            const updates = {};
            unknownKeys.forEach((key) => {
                updates[key] = null;
            });
            await db.ref(`whitelist/${uid}/inventory`).update(updates);
        }
