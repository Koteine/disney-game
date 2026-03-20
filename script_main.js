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
        const firebaseConfig = { databaseURL: "https://disneyquest-acaa0-default-rtdb.firebaseio.com/", projectId: "disneyquest-acaa0" };
        firebase.initializeApp(firebaseConfig);
        const db = firebase.database();
        const fs = firebase.firestore ? firebase.firestore() : null;
        const functionsApi = firebase.functions ? firebase.functions() : null;
        const tg = window.Telegram.WebApp;
        const ADMIN_ID = 341995937;
        window.db = db;
        window.ADMIN_ID = ADMIN_ID;
        let currentUserId = 0;
        let currentUserPathId = '';
        let currentUserRole = 'player';
        let telegramUser = {};

        function isAdminUser() {
            return Number(currentUserId) === Number(ADMIN_ID);
        }

        function isAdminPlayer() {
            return isAdminUser() && Number.isInteger(myIndex) && myIndex >= 0;
        }

        function isObserverOnlyAdmin() {
            return isAdminUser() && !isAdminPlayer();
        }

        function canUseGameplayFeatures() {
            return !isObserverOnlyAdmin();
        }

        function getAdminGameplayBlockedLabel() {
            return 'Недоступно в режиме администратора';
        }

        function refreshTelegramContext() {
            telegramUser = tg.initDataUnsafe?.user || {};
            currentUserId = Number(telegramUser.id) || 0;
            currentUserPathId = String(telegramUser.id || '').trim();
            currentUserRole = isAdminUser() ? 'admin' : 'player';
            window.currentUserId = currentUserId;
            window.currentUserPathId = currentUserPathId;
            window.currentUserRole = currentUserRole;
            window.isAdminUser = isAdminUser;
            window.isAdminPlayer = isAdminPlayer;
            window.isObserverOnlyAdmin = isObserverOnlyAdmin;
            window.canUseGameplayFeatures = canUseGameplayFeatures;
            window.getAdminGameplayBlockedLabel = getAdminGameplayBlockedLabel;
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
        const INVENTORY_ITEM_KEYS = ['goldenPollen', 'inkSaboteur', 'magnifier', 'cloak', 'greatPythonScale', 'fateBone', 'windBreath', 'rottenRadish', 'doubleBurdenScroll', 'thiefArcane'];
        let myInventory = { goldenPollen: 0, inkSaboteur: 0, magnifier: 0, cloak: 0, greatPythonScale: 0, fateBone: 0, windBreath: 0, rottenRadish: 0, doubleBurdenScroll: 0, thiefArcane: 0 };
        let myInkChallenge = null;
        let myWandBlessing = null;
        let allSubmissions = [];
        let worksAdminSelectedUserId = '';
        let worksAdminView = 'pending';
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
        let submissionsAutoApproveInFlight = false;

        const SNAKE_SHOP_ITEMS = {
            greatPythonScale: { emoji: '🛡️', name: 'Чешуя Великого Полоза', price: 10, desc: 'Автоматически нейтрализует негативный snake-эффект и сгорает.' },
            fateBone: { emoji: '🎯', name: 'Кость Судьбы', price: 30, desc: 'Позволяет выбрать результат броска от 1 до 6.' },
            windBreath: { emoji: '💨', name: 'Дыхание Ветра', price: 45, desc: 'Даёт 2 последовательных броска и ход на их сумму (до 12).' },
            rottenRadish: { emoji: '🥕', name: 'Гнилая редиска', price: 15, desc: 'Ловушка пропуска следующего хода для первого наступившего.' },
            doubleBurdenScroll: { emoji: '📜', name: 'Свиток «Двойное Бремя»', price: 20, desc: 'Ловушка: добавляет бонусное snake-задание до двойного одобрения.' },
            thiefArcane: { emoji: '🗡️', name: 'Воровской Аркан', price: 65, desc: 'Ставка 1 своего билета и попытка украсть 1 билет у snake-жертвы.' }
        };
        const SNAKE_TRAP_ITEMS = [
            { itemKey: 'rottenRadish', trapType: 'rotten_radish', emoji: '🥕', name: 'Гнилая редиска' },
            { itemKey: 'doubleBurdenScroll', trapType: 'double_burden', emoji: '📜', name: 'Свиток «Двойное Бремя»' }
        ];
        const SNAKE_SHOP_OPENINGS_UTC = [9, 15, 21];
        const SNAKE_SHOP_WINDOW_MS = 30 * 60 * 1000;
        const USER_GLOBAL_USED_TASKS_PATH_SUFFIX = 'used_tasks_global';
        const SUBMISSION_AUTO_APPROVE_MS = 3 * 60 * 60 * 1000;
        let snakeActionQueueTail = Promise.resolve();
        let snakeUiEventQueue = [];
        let snakeUiEventActive = null;
        let snakeUiCriticalLock = '';
        let snakeUiActiveDone = null;
        let snakePendingStealApplyInFlight = false;

        function enqueueSnakeAction(actionName, fn) {
            const uid = String(currentUserId || '').trim();
            if (!uid || typeof fn !== 'function') return Promise.resolve(null);
            const run = async () => fn();
            const next = snakeActionQueueTail.then(run, run);
            snakeActionQueueTail = next.catch(() => {});
            return next;
        }

        function setSnakeCriticalUiLock(lockName = '') {
            snakeUiCriticalLock = String(lockName || '').trim();
            if (!snakeUiCriticalLock) {
                setTimeout(() => processNextSnakeUiEvent(), 1000);
            }
        }

        function getSnakeUiPendingCount() {
            return Number(snakeUiEventQueue.length || 0) + (snakeUiEventActive ? 1 : 0);
        }

        function updateSnakePendingIndicator(extraCount = 0) {
            const el = document.getElementById('snake-pending-indicator');
            if (!el) return;
            const count = Math.max(0, Number(extraCount || 0) + getSnakeUiPendingCount());
            if (!count) {
                el.style.display = 'none';
                return;
            }
            el.style.display = 'inline-flex';
            el.textContent = `📩 ${count}`;
            el.title = 'Есть отложенные дела в змейке';
        }

        function processNextSnakeUiEvent() {
            if (snakeUiEventActive || snakeUiCriticalLock) return;
            if (!snakeUiEventQueue.length) {
                updateSnakePendingIndicator(0);
                return;
            }
            snakeUiEventQueue.sort((a, b) => Number(a.rank || 3) - Number(b.rank || 3) || Number(a.createdAt || 0) - Number(b.createdAt || 0));
            const next = snakeUiEventQueue.shift();
            if (!next || typeof next.show !== 'function') return;
            snakeUiEventActive = next;
            const done = () => {
                snakeUiActiveDone = null;
                snakeUiEventActive = null;
                updateSnakePendingIndicator(0);
                setTimeout(() => processNextSnakeUiEvent(), 1000);
            };
            snakeUiActiveDone = done;
            Promise.resolve(next.show(done)).catch(() => done());
            updateSnakePendingIndicator(0);
        }

        function enqueueSnakeUiEvent(event) {
            const row = {
                key: String(event?.key || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
                rank: Number(event?.rank || 3),
                createdAt: Date.now(),
                show: event?.show
            };
            if (typeof row.show !== 'function') return;
            if (!snakeUiEventQueue.find((x) => x.key === row.key) && (!snakeUiEventActive || snakeUiEventActive.key !== row.key)) {
                snakeUiEventQueue.push(row);
            }
            updateSnakePendingIndicator(0);
            processNextSnakeUiEvent();
        }

        function getCurrentPowerWindowCycleIndex(nowTs = Date.now()) {
            const p = getCurrentPowerWindowMsk(nowTs);
            const map = { morning: 0, day: 1, evening: 2 };
            const idx = Number.isInteger(map[p.activeWindowId]) ? map[p.activeWindowId] : -1;
            const cycleBase = Number(p.dayKey.replace(/-/g, '')) * 3;
            return idx < 0 ? -1 : cycleBase + idx;
        }

        function getForbiddenFruitCyclesRemaining(snakeState, nowTs = Date.now()) {
            const state = (snakeState && typeof snakeState === 'object') ? snakeState : {};
            const target = Number(state.forbiddenFruitBlockUntilCycle || 0);
            if (!target) return 0;
            const current = getCurrentPowerWindowCycleIndex(nowTs);
            if (current < 0) return Math.max(0, target - Number(state.forbiddenFruitBlockStartCycle || 0));
            return Math.max(0, target - current);
        }

        function isNegativeSnakeEffectType(effectType) {
            const t = String(effectType || '').trim();
            return [
                'snake', 'maelstrom', 'sphinx', 'kaa', 'shedding',
                'trap_rotten_radish', 'trap_double_burden',
                'skip', 'skip_turn', 'lock', 'lock_sphinx', 'lock_shedding'
            ].includes(t);
        }

        window.enqueueSnakeAction = enqueueSnakeAction;
        window.enqueueSnakeUiEvent = enqueueSnakeUiEvent;
        window.setSnakeCriticalUiLock = setSnakeCriticalUiLock;
        window.getCurrentPowerWindowCycleIndex = getCurrentPowerWindowCycleIndex;



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
            if (!canUseGameplayFeatures()) return alert(getAdminGameplayBlockedLabel());
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
            if (!canUseGameplayFeatures()) return alert(getAdminGameplayBlockedLabel());
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
                setRulesSectionState(null);
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
            if (!canUseGameplayFeatures()) return alert(getAdminGameplayBlockedLabel());
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
            if (!canUseGameplayFeatures()) return alert(getAdminGameplayBlockedLabel());
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

        function isAcceptedLikeStatus(status) {
            const normalized = String(status || '').trim().toLowerCase();
            return ['accepted', 'approved', 'approvedbymod', 'done', 'принято'].includes(normalized);
        }

        function isSnakeAssignmentClosedStatus(status) {
            const normalized = String(status || '').trim().toLowerCase();
            return ['approved', 'reward_granted', 'done', 'completed', 'accepted', 'принято'].includes(normalized);
        }

        async function getActiveSnakeSubmitCandidate() {
            const roundSnap = await db.ref('current_round').once('value');
            const roundData = roundSnap.val() || {};
            if (!window.snakeRound?.isSnakeRound?.(roundData)) return null;

            const snakeStateSnap = await db.ref(`whitelist/${currentUserId}/snakeState`).once('value');
            const snakeState = snakeStateSnap.val() || {};
            const activeTask = snakeState.activeTask || {};
            const activeCell = Number(activeTask.cell || 0);
            if (!activeCell) return null;

            const assignmentRound = Number(activeTask.round || roundData.number || currentRoundNum || 0);
            const assignmentId = String(activeTask.assignmentId || snakeState.currentAssignmentId || '').trim();
            if (!assignmentId || assignmentRound <= 0) return null;

            const assignmentPath = `rounds/${assignmentRound}/snake/assignments/${currentUserId}/${assignmentId}`;
            const assignmentSnap = await db.ref(assignmentPath).once('value');
            const assignment = assignmentSnap.val() || null;
            if (!assignment) return null;
            if (Number(assignment.cell || 0) !== activeCell) return null;
            if (!!assignment.rewardGranted || isSnakeAssignmentClosedStatus(assignment.status)) return null;

            const cellIdx = activeCell - 1;
            const latest = getLatestSubmissionForCell(assignmentRound, cellIdx);
            if (latest && isAcceptedLikeStatus(latest.status)) return null;

            const baseTask = Number.isInteger(Number(activeTask.taskIdx)) && Number(activeTask.taskIdx) >= 0
                ? tasks[Number(activeTask.taskIdx)]
                : null;
            return {
                cell: activeCell,
                cellIdx,
                round: assignmentRound,
                mode: 'snake',
                ticket: '',
                userId: currentUserId,
                owner: myIndex,
                virtualSnakeActive: true,
                snakeAssignmentId: assignmentId,
                taskLabel: String(activeTask.taskLabel || assignment.taskLabel || baseTask?.text || 'Активное задание змейки')
            };
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

            if (isObserverOnlyAdmin()) {
                if (select) select.disabled = true;
                if (submitBtn) submitBtn.disabled = true;
                setUploadVisibility(false);
                statusEl.innerText = getAdminGameplayBlockedLabel();
                statusEl.style.color = '#b71c1c';
                return;
            }

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

            if (isAcceptedLikeStatus(latest.status)) {
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
            if (!canUseGameplayFeatures()) return alert(getAdminGameplayBlockedLabel());
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
            if (!canUseGameplayFeatures()) return alert(getAdminGameplayBlockedLabel());
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
            if (!canUseGameplayFeatures()) return alert(getAdminGameplayBlockedLabel());
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

        async function postNewsOnce(oncePath, text, meta = {}) {
            const path = String(oncePath || '').trim();
            if (!path) return;
            const tx = await db.ref(path).transaction((row) => {
                if (row) return row;
                return { at: Date.now(), ...meta };
            });
            if (!tx.committed) return;
            await postNews(text);
        }

        async function postRoundEndNewsIfNeeded(roundNum) {
            const normalizedRound = Number(roundNum || 0);
            if (!Number.isFinite(normalizedRound) || normalizedRound <= 0) return;
            const flagTx = await db.ref('current_round/endNewsPosted').transaction((row) => {
                if (row && Number(row.round) === normalizedRound) return row;
                return { round: normalizedRound, at: Date.now() };
            });
            if (!flagTx.committed) return;
            await postNews(`Раунд #${normalizedRound} завершён`);
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
            return ['cloak', 'magnifier', 'goldenPollen', 'magicWand', 'greatPythonScale', 'fateBone', 'windBreath', 'rottenRadish', 'doubleBurdenScroll', 'thiefArcane']
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
            const keys = ['cloak', 'magnifier', 'goldenPollen', 'greatPythonScale', 'fateBone', 'windBreath', 'rottenRadish', 'doubleBurdenScroll', 'thiefArcane'];
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

        function resolveRoundFieldMode(roundData) {
            const explicitMode = String(roundData?.fieldMode || roundData?.mode || '').trim();
            if (explicitMode === 'snake' || explicitMode === 'cells') return explicitMode;
            if (window.snakeRound?.isSnakeRound?.(roundData || {})) return 'snake';
            return 'cells';
        }

        function getSnakeRollDisabledReason({ userState, duelLockActive, isRoundActive }) {
            if (!isRoundActive) return { disabled: true, text: '⏳ Раунд завершен', reason: 'round_inactive' };
            const snakeState = userState?.snakeState || {};
            if (snakeState.awaitingApproval) return { disabled: true, text: '⏳ Сначала дождись одобрения текущей работы', reason: 'awaiting_approval' };
            if (snakeState.lockedBySphinx) return { disabled: true, text: '🗿 Испытание Сфинкса: ожидается одобрение', reason: 'sphinx_lock' };
            const fruitCyclesLeft = getForbiddenFruitCyclesRemaining(snakeState, Date.now());
            if (fruitCyclesLeft > 0) {
                return { disabled: true, text: `🍎 Запретный плод: осталось циклов окон: ${fruitCyclesLeft}`, reason: 'forbidden_fruit_wait' };
            }
            const sheddingActive = !!snakeState.sheddingActive && !snakeState.sheddingReleasedAt;
            const endsAt = Number(snakeState.sheddingEndsAt || snakeState.sheddingLockUntil || 0);
            if (sheddingActive && (!endsAt || endsAt > Date.now())) {
                const leftMs = Math.max(0, endsAt - Date.now());
                const leftMin = Math.ceil(leftMs / 60000);
                return { disabled: true, text: `🧬 Сброс кожи: ~${leftMin} мин`, reason: 'shedding_lock' };
            }
            const powerWindowState = canRollInCurrentPowerWindow(snakeState);
            if (!powerWindowState.ok) return { disabled: true, text: powerWindowState.text, reason: powerWindowState.reason };
            if (duelLockActive) return { disabled: true, text: '🎯 Сначала завершите дуэль', reason: 'duel_lock' };
            if (snakeRollInFlight) return { disabled: true, text: '🎲 Бросок обрабатывается...', reason: 'roll_in_flight' };
            return { disabled: false, text: '🎲 Бросить кубик', reason: '' };
        }


        function getMskNowParts(nowTs = Date.now()) {
            const mskTs = Number(nowTs) + (3 * 60 * 60 * 1000);
            const d = new Date(mskTs);
            const year = d.getUTCFullYear();
            const month = String(d.getUTCMonth() + 1).padStart(2, '0');
            const day = String(d.getUTCDate()).padStart(2, '0');
            const hour = d.getUTCHours();
            const minute = d.getUTCMinutes();
            return { mskTs, dayKey: `${year}-${month}-${day}`, hour, minute, totalMinutes: hour * 60 + minute };
        }

        function getCurrentPowerWindowMsk(nowTs = Date.now()) {
            const p = getMskNowParts(nowTs);
            const windows = [
                { id: 'morning', startMin: 11 * 60, endMin: 12 * 60, title: 'утреннее' },
                { id: 'day', startMin: 16 * 60, endMin: 17 * 60, title: 'дневное' },
                { id: 'evening', startMin: 20 * 60, endMin: 21 * 60, title: 'вечернее' }
            ];
            const active = windows.find((w) => p.totalMinutes >= w.startMin && p.totalMinutes < w.endMin) || null;
            return { ...p, windows, activeWindowId: active?.id || '', activeWindowTitle: active?.title || '' };
        }

        function getSnakeShopWindowState(nowTs = Date.now()) {
            const p = getMskNowParts(nowTs);
            const windows = [
                { id: 'morning', startMin: (10 * 60) + 50, endMin: (11 * 60) + 20 },
                { id: 'day', startMin: (15 * 60) + 50, endMin: (16 * 60) + 20 },
                { id: 'evening', startMin: (19 * 60) + 50, endMin: (20 * 60) + 20 }
            ];
            const active = windows.find((w) => p.totalMinutes >= w.startMin && p.totalMinutes < w.endMin) || null;
            const next = windows.find((w) => p.totalMinutes < w.startMin) || windows[0];
            const nextHour = Math.floor(next.startMin / 60);
            const nextMinute = String(next.startMin % 60).padStart(2, '0');
            return {
                isOpen: !!active,
                activeStart: active ? active.startMin : 0,
                activeEnd: active ? active.endMin : 0,
                nextStartLabel: `${String(nextHour).padStart(2, '0')}:${nextMinute}`,
                windowId: active?.id || ''
            };
        }

        function canRollInCurrentPowerWindow(snakeState, nowTs = Date.now()) {
            const power = getCurrentPowerWindowMsk(nowTs);
            if (!power.activeWindowId) return { ok: false, reason: 'outside_power_window', text: '🕒 Бросок доступен только в Окна Силы (11-12, 16-17, 20-21 МСК)' };
            const state = (snakeState && typeof snakeState === 'object') ? snakeState : {};
            const selectedDay = String(state.powerWindowDayMsk || '');
            const selectedId = String(state.selectedPowerWindowId || '');
            if (selectedDay === power.dayKey && selectedId && selectedId !== power.activeWindowId) {
                const label = selectedId === 'morning' ? 'утреннее' : (selectedId === 'day' ? 'дневное' : 'вечернее');
                return { ok: false, reason: 'power_window_already_selected', text: `🕒 Сегодня уже выбрано ${label} окно` };
            }
            return { ok: true, power };
        }

        function getSnakeInventorySummary(inv = myInventory) {
            return ['greatPythonScale', 'fateBone', 'windBreath', 'rottenRadish', 'doubleBurdenScroll', 'thiefArcane']
                .filter((key) => Number(inv[key] || 0) > 0)
                .map((key) => `${SNAKE_SHOP_ITEMS[key]?.emoji || '🎁'} ${SNAKE_SHOP_ITEMS[key]?.name || key} ×${Number(inv[key] || 0)}`)
                .join('<br>') || 'Пусто';
        }

        function renderSnakeShopControls() {
            const wrap = document.getElementById('snake-shop-controls');
            const statusEl = document.getElementById('snake-shop-status');
            const previewEl = document.getElementById('snake-backpack-preview');
            const shopBtn = document.getElementById('snake-shop-open-btn');
            const backpackBtn = document.getElementById('snake-backpack-open-btn');
            const isSnakeMode = resolveRoundFieldMode(currentRoundData) === 'snake';
            const isPlayer = myIndex !== -1 && canUseGameplayFeatures();
            if (!wrap) return;
            if (!isSnakeMode) {
                wrap.style.display = 'none';
                return;
            }
            wrap.style.display = 'flex';
            if (!isPlayer) {
                if (shopBtn) {
                    shopBtn.style.display = 'block';
                    shopBtn.disabled = true;
                    shopBtn.textContent = getAdminGameplayBlockedLabel();
                }
                if (backpackBtn) {
                    backpackBtn.style.display = 'block';
                    backpackBtn.disabled = true;
                    backpackBtn.textContent = getAdminGameplayBlockedLabel();
                }
                if (statusEl) statusEl.textContent = getAdminGameplayBlockedLabel();
                if (previewEl) previewEl.textContent = getAdminGameplayBlockedLabel();
                return;
            }
            const state = getSnakeShopWindowState();
            if (shopBtn) shopBtn.style.display = state.isOpen ? 'block' : 'none';
            if (shopBtn) {
                shopBtn.disabled = false;
                shopBtn.textContent = '🐍 Лавка «Шепот Клыка»';
            }
            if (backpackBtn) {
                backpackBtn.style.display = 'block';
                backpackBtn.disabled = false;
                backpackBtn.textContent = '🎒 Рюкзак змейки';
            }
            if (statusEl) {
                statusEl.textContent = state.isOpen
                    ? `Лавка открыта в окне ${state.windowId || ''} (МСК)`
                    : `Лавка закрыта. Следующее открытие: ${state.nextStartLabel} МСК`;
            }
            if (previewEl) previewEl.innerHTML = getSnakeInventorySummary();
        }

        async function refreshSnakePendingIndicator() {
            if (resolveRoundFieldMode(currentRoundData) !== 'snake' || !currentUserId || !canUseGameplayFeatures()) {
                updateSnakePendingIndicator(0);
                return;
            }
            const [pendingStealSnap, notifSnap] = await Promise.all([
                db.ref(`whitelist/${currentUserId}/pendingStealResolutions`).once('value'),
                db.ref(`system_notifications/${currentUserId}`).limitToLast(40).once('value')
            ]);
            const pendingStealCount = Object.values(pendingStealSnap.val() || {}).filter((r) => r && String(r.status || '') === 'pending').length;
            const inviteCount = Object.values(notifSnap.val() || {}).filter((r) => r && String(r.type || '') === 'calligraphy_duel_invite' && !r.acknowledged).length;
            updateSnakePendingIndicator(pendingStealCount + inviteCount);
        }

        async function snakePurchaseItem(itemKey, viaSmuggler = false) {
            return enqueueSnakeAction(`snake_purchase_${itemKey}`, async () => {
                try {
                    if (!canUseGameplayFeatures()) return alert(getAdminGameplayBlockedLabel());
                    const item = SNAKE_SHOP_ITEMS[itemKey];
                    if (!item) return alert('Неизвестный предмет.');
                    if (!getSnakeShopWindowState().isOpen && !viaSmuggler) return alert('Лавка сейчас закрыта.');
                    if (viaSmuggler) {
                        const smug = (await db.ref('snake_smuggler/current').once('value')).val() || {};
                        const allowed = Number(smug.expiresAt || 0) > Date.now() && !!smug?.eligible?.[String(currentUserId || '')];
                        if (!allowed) return alert('Контрабандист сейчас недоступен для тебя.');
                    }
                    const uid = String(currentUserId || '').trim();
                    if (!uid) return alert('Пользователь не определён.');
                    const invRef = db.ref(`whitelist/${uid}/inventory`);
                    const invTx = await invRef.transaction((row) => {
                        const next = (row && typeof row === 'object') ? { ...row } : {};
                        const count = Number(next[itemKey] || 0);
                        if (count >= 3) return;
                        next[itemKey] = count + 1;
                        return next;
                    });
                    if (!invTx.committed) return alert('Лимит этого предмета уже достигнут (макс. 3).');
                    const karmaRef = db.ref(`player_season_status/${uid}/karma_points`);
                    const karmaTx = await karmaRef.transaction((value) => {
                        const current = Number(value || 0);
                        const price = calcSnakeShopPrice(itemKey, !!viaSmuggler);
                        if (current < price) return;
                        return current - price;
                    });
                    if (!karmaTx.committed) {
                        await invRef.transaction((row) => {
                            const next = (row && typeof row === 'object') ? { ...row } : {};
                            next[itemKey] = Math.max(0, Number(next[itemKey] || 0) - 1);
                            return next;
                        });
                        return alert('Недостаточно кармы для покупки.');
                    }
                    await db.ref(`player_season_status/${uid}/updatedAt`).set(Date.now());
                    const buyerName = players[myIndex]?.n || getTelegramDisplayName() || `ID ${uid}`;
                    await postNews(`🐍 ${buyerName} купил(а) в «Шепоте Клыка»: ${item.emoji} ${item.name}.`);
                    alert(`Покупка успешна: ${item.name}`);
                } catch (err) {
                    console.error('[SNAKE SHOP][ERROR] purchase failed', err);
                    alert(`Покупка не выполнена: ${err?.message || 'неизвестная ошибка'}`);
                }
            });
        }

        async function openSnakeShopModal() {
            if (!canUseGameplayFeatures()) return alert(getAdminGameplayBlockedLabel());
            if (resolveRoundFieldMode(currentRoundData) !== 'snake') return alert('Лавка доступна только в режиме «Змейка».');
            const state = getSnakeShopWindowState();
            const smugRow = (await db.ref('snake_smuggler/current').once('value')).val() || {};
            const smugEligible = Number(smugRow.expiresAt || 0) > Date.now() && !!smugRow?.eligible?.[String(currentUserId || '')];
            const cards = Object.entries(SNAKE_SHOP_ITEMS).map(([key, item]) => {
                const count = Number(myInventory[key] || 0);
                const disabled = (!state.isOpen && !smugEligible) || count >= 3;
                const price = calcSnakeShopPrice(key, smugEligible);
                return `<div class="snake-shop-card"><div class="snake-shop-card-title">${item.emoji} ${item.name}</div><div class="snake-shop-card-desc">${item.desc}</div><div class="snake-shop-card-meta">Цена: ${price} кармы${smugEligible ? ' (Слизняк -20%)' : ''} · В рюкзаке: ${count}/3</div><button class="admin-btn" style="margin:0; width:100%;" ${disabled ? 'disabled' : ''} onclick="snakePurchaseItem('${key}', ${smugEligible ? 'true' : 'false'})">Купить</button></div>`;
            }).join('');
            enqueueSnakeUiEvent({
                key: 'snake_shop_modal',
                rank: 2,
                show: (done) => {
                    document.getElementById('mTitle').textContent = '🐍 Лавка «Шепот Клыка»';
                    document.getElementById('mText').innerHTML = `<div style="font-size:12px; color:#555;">${state.isOpen ? 'Лавка открыта (30 минут).' : 'Лавка закрыта. Приходи в одно из 3 открытий в сутки.'}</div><div class="snake-shop-grid">${cards}</div>`;
                    document.getElementById('modal').style.display = 'block';
                    document.getElementById('overlay').style.display = 'block';
                }
            });
        }

        function openSnakeBackpackModal() {
            if (!canUseGameplayFeatures()) return alert(getAdminGameplayBlockedLabel());
            const visibleItems = Object.entries(myInventory || {})
                .map(([key, count]) => ({ key, count: Number(count || 0) }))
                .filter(({ count }) => count > 0)
                .sort((a, b) => String(a.key).localeCompare(String(b.key)));
            const body = visibleItems.length
                ? visibleItems.map(({ key, count }) => {
                    const meta = itemTypes?.[key] || SNAKE_SHOP_ITEMS[key] || {};
                    return `<div class="snake-shop-card"><div class="snake-shop-card-title">${meta.emoji || '🎁'} ${meta.name || key}</div><div class="snake-shop-card-meta">Количество: ${count}</div></div>`;
                }).join('')
                : '<div class="snake-shop-card"><div class="snake-shop-card-meta">Рюкзак пуст.</div></div>';
            enqueueSnakeUiEvent({
                key: 'snake_backpack_modal',
                rank: 2,
                show: (done) => {
                    document.getElementById('mTitle').textContent = '🎒 Рюкзак змейки';
                    document.getElementById('mText').innerHTML = `${body}${renderSnakeTrapActionsInBackpack()}`;
                    document.getElementById('modal').style.display = 'block';
                    document.getElementById('overlay').style.display = 'block';
                }
            });
        }

        async function tryConsumeSnakeInventoryItem(itemKey) {
            const uid = String(currentUserId || '').trim();
            if (!uid) return false;
            const ref = db.ref(`whitelist/${uid}/inventory`);
            const tx = await ref.transaction((row) => {
                const next = (row && typeof row === 'object') ? { ...row } : {};
                const count = Number(next[itemKey] || 0);
                if (count <= 0) return;
                next[itemKey] = count - 1;
                return next;
            });
            return !!tx.committed;
        }


        async function getCurrentSnakeRoundNumSafe() {
            const roundSnap = await db.ref('current_round').once('value');
            const round = roundSnap.val() || {};
            if (resolveRoundFieldMode(round) !== 'snake') return 0;
            return Number(round.number || 0);
        }

        function getAvailableSnakeTrapItems(inv = myInventory) {
            return SNAKE_TRAP_ITEMS.filter((item) => Number(inv[item.itemKey] || 0) > 0);
        }

        async function placeSnakeTrapOnCell(trapType, cellPos) {
            return enqueueSnakeAction(`snake_trap_${trapType}`, async () => {
                const uid = String(currentUserId || '').trim();
                if (!uid) return;
                const roundNum = await getCurrentSnakeRoundNumSafe();
                if (!roundNum) return alert('Ловушки доступны только в snake-раунде.');
                const trapMeta = SNAKE_TRAP_ITEMS.find((item) => item.trapType === trapType);
                if (!trapMeta) return alert('Неизвестный тип ловушки.');
                const confirmed = confirm(`Оставить ловушку «${trapMeta.name}» на клетке №${Number(cellPos || 0)}?`);
                if (!confirmed) return;

                const snakeState = (await db.ref(`whitelist/${uid}/snakeState`).once('value')).val() || {};
                const position = Number(snakeState.position || 1);
                const cell = Number(cellPos || 0);
                if (!Number.isInteger(cell) || cell < 2 || cell > 99) return alert('Можно ставить только на клетки 2..99.');
                if (Math.abs(cell - position) > 10) return alert('Клетка должна быть в радиусе 10 от твоей позиции.');

                const trapPath = `snake_traps/${roundNum}/${cell}`;
                const trapRef = db.ref(trapPath);
                const tx = await trapRef.transaction((row) => {
                    const now = Date.now();
                    if (row && Number(row.expiresAt || 0) > now && row.armed) return;
                    return {
                        type: trapType,
                        ownerId: uid,
                        round: roundNum,
                        cell,
                        createdAt: Date.now(),
                        armed: true,
                        triggeredBy: '',
                        triggeredAt: 0,
                        expiresAt: Date.now() + (24 * 60 * 60 * 1000)
                    };
                });
                if (!tx.committed) return alert('На этой клетке уже есть ловушка.');

                const consumed = await tryConsumeSnakeInventoryItem(trapMeta.itemKey);
                if (!consumed) {
                    await trapRef.remove();
                    return alert('Предмет уже закончился в рюкзаке.');
                }
                await postNews(`🕳️ ${players[myIndex].n} установил(а) ловушку в джунглях.`);
                alert('Ловушка установлена.');
                closeModal();
            });
        }

        function renderSnakeTrapActionsInBackpack() {
            const arcane = Number(myInventory.thiefArcane || 0);
            const trapAvailable = SNAKE_TRAP_ITEMS.some((item) => Number(myInventory[item.itemKey] || 0) > 0);
            const trapHint = trapAvailable
                ? '<div class="snake-shop-card"><div class="snake-shop-card-title">🕳️ Ловушки</div><div class="snake-shop-card-meta">Ставятся с поля: нажмите на клетку в радиусе 10 и выберите «Оставить ловушку».</div></div>'
                : '';
            const arcaneCard = arcane > 0
                ? `<div class="snake-shop-card"><div class="snake-shop-card-title">🗡️ Воровской Аркан</div><div class="snake-shop-card-meta">В рюкзаке: ${arcane}</div><button class="admin-btn" style="margin:0; width:100%;" onclick="startThiefArcaneFromBackpack()">Запустить взлом</button></div>`
                : '';
            if (!trapHint && !arcaneCard) return '';
            return `<div class="snake-shop-grid">${trapHint}${arcaneCard}</div>`;
        }


        function buildArcaneArrowSequence() {
            const arrows = ['↑', '↓', '←', '→'];
            const len = 6 + Math.floor(Math.random() * 3);
            return Array.from({ length: len }, () => arrows[Math.floor(Math.random() * arrows.length)]);
        }

        function normalizeArrowKey(key) {
            const map = {
                ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
                w: '↑', W: '↑', s: '↓', S: '↓', a: '←', A: '←', d: '→', D: '→'
            };
            return map[String(key || '')] || '';
        }

        async function getSnakeActiveTicketRowsByUserId(userId) {
            const uid = String(userId || '').trim();
            if (!uid) return [];
            const ticketsSnap = await db.ref('tickets').once('value');
            const revokedSnap = await db.ref('revoked_tickets').once('value');
            const revoked = revokedSnap.val() || {};
            const rows = [];
            ticketsSnap.forEach((item) => {
                const row = item.val() || {};
                const num = String(row.ticketNum || row.num || item.key || '').trim();
                if (!/^\d+$/.test(num)) return;
                if (String(row.userId || '') !== uid) return;
                if (revoked[num]) return;
                const mode = String(row.mode || '');
                const source = String(row.source || '');
                if (mode !== 'snake' && !source.startsWith('snake_')) return;
                rows.push({ key: item.key, num, row });
            });
            rows.sort((a,b)=>Number(a.num)-Number(b.num));
            return rows;
        }


        async function getSnakeVictimArcaneState(victimUid) {
            const uid = String(victimUid || '').trim();
            if (!uid) return null;
            const [userSnap, roundSnap, presenceSnap] = await Promise.all([
                db.ref(`whitelist/${uid}`).once('value'),
                db.ref('current_round').once('value'),
                db.ref('snake_presence').once('value')
            ]);
            const user = userSnap.val() || {};
            const snakeState = user.snakeState || {};
            const position = Number(snakeState.position || 0);
            const round = Number(roundSnap.val()?.number || 0);
            const turnLock = snakeState.turnLock || {};
            const isInFlight = !!turnLock.inFlight;
            let lastSeenAt = 0;
            const byRound = presenceSnap.val() || {};
            const roundMap = byRound[round] || {};
            const cellMap = roundMap[position] || {};
            const row = cellMap[uid] || cellMap[String(uid)] || null;
            lastSeenAt = Number(row?.lastSeenAt || 0);
            const isOnline = !!lastSeenAt && (Date.now() - lastSeenAt) <= 60000;
            const cellKey = `${round}_${position}`;
            return { uid, snakeState, position, round, cellKey, isInFlight, isOnline };
        }

        async function markSnakeIncident(userId, payload) {
            const uid = String(userId || '').trim();
            if (!uid) return;
            const key = db.ref(`whitelist/${uid}/incidentLog`).push().key;
            await db.ref(`whitelist/${uid}/incidentLog/${key}`).set({
                ...(payload || {}),
                createdAt: Date.now(),
                readAt: 0
            });
        }

        async function applyPendingStealResolutionsForCurrentUser() {
            if (snakePendingStealApplyInFlight) return;
            snakePendingStealApplyInFlight = true;
            try {
                return await enqueueSnakeAction('snake_apply_pending_steal', async () => {
                    const uid = String(currentUserId || '').trim();
                    if (!uid) return;
                    const pendingSnap = await db.ref(`whitelist/${uid}/pendingStealResolutions`).once('value');
                    const pending = pendingSnap.val() || {};
                    for (const [rid, row] of Object.entries(pending)) {
                        if (!row || String(row.status || '') !== 'pending') continue;
                        const ticketRows = await getSnakeActiveTicketRowsByUserId(uid);
                        const ticket = ticketRows[0] || null;
                        if (!ticket) {
                            await db.ref(`whitelist/${uid}/pendingStealResolutions/${rid}/status`).set('skipped_no_ticket');
                            continue;
                        }
                        const burnTx = await db.ref(`revoked_tickets/${ticket.num}`).transaction((v) => v ? v : true);
                        if (!burnTx.committed) continue;
                        await db.ref().update({
                            [`whitelist/${uid}/pendingStealResolutions/${rid}/status`]: 'applied',
                            [`whitelist/${uid}/pendingStealResolutions/${rid}/appliedAt`]: Date.now(),
                            [`whitelist/${uid}/pendingStealResolutions/${rid}/burnedTicketNum`]: String(ticket.num)
                        });
                        await markSnakeIncident(uid, { type: 'arcane_deferred_loss', text: `Пока ты был(а) оффлайн, с тебя списан билет №${ticket.num} из-за Воровского Аркана.` });
                    }
                });
            } finally {
                snakePendingStealApplyInFlight = false;
            }
        }

        async function startThiefArcaneFromBackpack() {
            return enqueueSnakeAction('snake_thief_arcane_start', async () => {
            if (resolveRoundFieldMode(currentRoundData) !== 'snake') return alert('Аркан доступен только в режиме «Змейка».');
            const myArcane = Number(myInventory.thiefArcane || 0);
            if (myArcane <= 0) return alert('В рюкзаке нет Воровского Аркана.');

            const myUid = String(currentUserId || '').trim();
            const roundNum = Number(currentRoundData?.number || 0);
            if (!myUid || roundNum <= 0) return;

            const myTickets = await getSnakeActiveTicketRowsByUserId(myUid);
            if (!myTickets.length) return alert('Для Аркана нужен минимум 1 активный snake-билет для ставки.');

            const whitelistSnap = await db.ref('whitelist').once('value');
            const victims = [];
            const checks = [];
            whitelistSnap.forEach((snap) => {
                const uid = String(snap.key || '').trim();
                const row = snap.val() || {};
                if (!uid || uid === myUid) return;
                const pos = Number(row?.snakeState?.position || 0);
                if (pos <= 0) return;
                checks.push((async () => {
                    const t = await getSnakeActiveTicketRowsByUserId(uid);
                    if (!t.length) return;
                    const vState = await getSnakeVictimArcaneState(uid);
                    if (!vState || Number(vState.position || 0) <= 0) return;
                    const name = players[Number(row?.charIndex)]?.n || row?.nickname || `ID ${uid}`;
                    victims.push({ uid, name, ticketCount: t.length, sampleTicket: t[0].num, victimState: vState });
                })());
            });
            await Promise.all(checks);
            victims.sort((a,b)=>a.name.localeCompare(b.name,'ru'));
            if (!victims.length) return alert('Нет доступных жертв с snake-билетами.');

            const optionsText = victims.map((v, i) => `${i + 1} — ${v.name} (билеты: ${v.ticketCount})`).join('\n');
            const pickRaw = prompt(`Выбери жертву для Аркана:
${optionsText}

Введи номер:`, '1');
            if (pickRaw === null) return;
            const pick = Number(pickRaw);
            if (!Number.isInteger(pick) || pick < 1 || pick > victims.length) return alert('Некорректный выбор жертвы.');
            const victim = victims[pick - 1];
            const victimState = victim.victimState || await getSnakeVictimArcaneState(victim.uid);
            if (!victimState) return alert('Жертва недоступна.');
            if (victimState.isInFlight) return alert('Нельзя грабить игрока во время активного хода.');
            if (!victimState.isOnline) {
                const pendingSnap = await db.ref(`whitelist/${victim.uid}/pendingStealResolutions`).once('value');
                const hasPending = Object.values(pendingSnap.val() || {}).some((row) => row && String(row.status || '') === 'pending');
                if (hasPending) return alert('Этого оффлайн-игрока уже ожидает одно оффлайн-ограбление. Больше нельзя до его входа.');
            }
            const guardPath = `snake_robbery_cell_guard/${victimState.round}/${victimState.position}/${victim.uid}`;
            const guardTx = await db.ref(guardPath).transaction((v) => v ? undefined : { by: myUid, at: Date.now() });
            if (!guardTx.committed) return alert('На этой клетке этого игрока уже пытались ограбить.');

            const consumed = await tryConsumeSnakeInventoryItem('thiefArcane');
            if (!consumed) return alert('Аркан уже закончился в рюкзаке.');

            const stake = myTickets[0];
            const sessionRef = db.ref('snake_arcane_sessions').push();
            const sessionId = String(sessionRef.key || '').trim();
            const sequence = buildArcaneArrowSequence();
            const sessionPayload = {
                sessionId,
                status: 'pending',
                createdAt: Date.now(),
                round: roundNum,
                attackerId: myUid,
                victimId: victim.uid,
                victimCellKey: victimState.cellKey,
                victimCellPos: Number(victimState.position || 0),
                victimRound: Number(victimState.round || 0),
                victimWasOnline: !!victimState.isOnline,
                stakeTicketNum: String(stake.num),
                sequence,
                timeLimitMs: 5000,
                result: '',
                finalizedAt: 0,
                finalizedBy: '',
                finalizedRequestId: '',
                transferTicketNum: '',
                burnedTicketNum: ''
            };
            await sessionRef.set(sessionPayload);
            await openSnakeArcaneHackModal(sessionPayload, victim);
            });
        }

        async function finalizeSnakeArcaneSession(sessionId, success) {
            return enqueueSnakeAction('snake_finalize_arcane', async () => {
            const sid = String(sessionId || '').trim();
            if (!sid) return;
            const myUid = String(currentUserId || '').trim();
            const requestId = `${myUid}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
            const sessionRef = db.ref(`snake_arcane_sessions/${sid}`);
            let sessionRow = null;
            const lockTx = await sessionRef.transaction((row) => {
                if (!row || String(row.status || '') !== 'pending') return row;
                if (String(row.attackerId || '') !== myUid) return row;
                return { ...row, status: 'finalizing', finalizedBy: myUid, finalizedRequestId: requestId, finalizedAt: Date.now(), result: success ? 'success' : 'fail' };
            });
            if (!lockTx.committed) return alert('Сессия уже завершена или недоступна.');
            sessionRow = lockTx.snapshot?.val?.() || {};

            const attackerId = String(sessionRow.attackerId || '');
            const victimId = String(sessionRow.victimId || '');
            const stakeNum = String(sessionRow.stakeTicketNum || '');
            let transferTicketNum = '';
            let burnedTicketNum = '';
            let resolvedSuccess = !!success;

            if (success && !!sessionRow.victimWasOnline) {
                const victimTickets = await getSnakeActiveTicketRowsByUserId(victimId);
                const victimCandidate = victimTickets[0] || null;
                if (!victimCandidate) {
                    resolvedSuccess = false;
                } else {
                    const victimTicketRef = db.ref(`tickets/${victimCandidate.num}`);
                    const tx = await victimTicketRef.transaction((row) => {
                        if (!row || String(row.userId || '') !== victimId) return;
                        const next = { ...row, userId: attackerId, owner: Number(myIndex), transferredByArcaneSession: sid, updatedAt: Date.now() };
                        return next;
                    });
                    if (tx.committed) {
                        transferTicketNum = String(victimCandidate.num);
                        const moved = tx.snapshot?.val?.() || {};
                        const updates = {};
                        updates[`users/${victimId}/tickets/${transferTicketNum}`] = null;
                        updates[`users/${attackerId}/tickets/${transferTicketNum}`] = moved;
                        await db.ref().update(updates);
                    } else {
                        resolvedSuccess = false;
                    }
                }
            }

            if (success && !sessionRow.victimWasOnline) {
                const pendingRef = db.ref(`whitelist/${victimId}/pendingStealResolutions`);
                const pendingSnap = await pendingRef.once('value');
                const hasPending = Object.values(pendingSnap.val() || {}).some((row) => row && String(row.status || '') === 'pending');
                if (hasPending) {
                    resolvedSuccess = false;
                } else {
                    await db.ref(`whitelist/${victimId}/pendingStealResolutions/${sid}`).set({ status: 'pending', fromUserId: attackerId, createdAt: Date.now(), reason: 'arcane_offline_deferred' });
                    await markSnakeIncident(victimId, { type: 'arcane_attempt_offline', text: 'Пока ты был(а) оффлайн, против тебя применили Воровской Аркан.' });
                }
            }

            if (!resolvedSuccess) {
                const burnTx = await db.ref(`revoked_tickets/${stakeNum}`).transaction((v) => v ? v : true);
                if (burnTx.committed) burnedTicketNum = stakeNum;
            }

            await sessionRef.update({
                status: 'resolved',
                result: resolvedSuccess ? 'success' : 'fail',
                transferTicketNum,
                burnedTicketNum,
                resolvedAt: Date.now(),
                finalizedRequestId: requestId,
                sideEffectsApplied: true
            });

            if (resolvedSuccess) {
                await postNews(`🗡️ ${players[myIndex].n} успешно применил(а) Воровской Аркан и украл(а) билет №${transferTicketNum}.`);
                await markSnakeIncident(attackerId, { type: 'arcane_win', text: `Успех Аркана: получен билет №${transferTicketNum}.` });
                await markSnakeIncident(victimId, { type: 'arcane_lost', text: sessionRow.victimWasOnline ? 'Кто-то ограбил тебя через Воровской Аркан.' : 'Кто-то пытался ограбить тебя (оффлайн-режим Аркана).' });
                alert(`Успех! Ты сохранил(а) ставку и получил(а) билет №${transferTicketNum}.`);
            } else {
                await postNews(`🗡️ ${players[myIndex].n} провалил(а) Воровской Аркан. Сгорел билет №${burnedTicketNum || stakeNum}.`);
                await markSnakeIncident(attackerId, { type: 'arcane_fail', text: `Провал Аркана: сгорел билет №${burnedTicketNum || stakeNum}.` });
                await markSnakeIncident(victimId, { type: 'arcane_defended', text: 'Кто-то пытался тебя ограбить, но ты отбился.' });
                alert(`Провал. Сгорел твой билет №${burnedTicketNum || stakeNum}.`);
            }
            });
        }

        async function openSnakeArcaneHackModal(sessionRow, victim) {
            const sequence = Array.isArray(sessionRow?.sequence) ? sessionRow.sequence : buildArcaneArrowSequence();
            const timeLimitMs = Number(sessionRow?.timeLimitMs || 5000);
            const sid = String(sessionRow?.sessionId || '');
            const victimName = victim?.name || 'Жертва';
            let progress = [];
            let finished = false;

            const finish = async (ok) => {
                if (finished) return;
                finished = true;
                window.__snakeArcaneOnKeyDown && window.removeEventListener('keydown', window.__snakeArcaneOnKeyDown);
                window.__snakeArcaneOnKeyDown = null;
                await finalizeSnakeArcaneSession(sid, !!ok);
                closeModal();
            };

            document.getElementById('mTitle').textContent = `🗡️ Змеиный взлом · ${victimName}`;
            document.getElementById('mText').innerHTML = `<div style="font-size:12px; color:#555;">Повтори последовательность за 5 секунд.</div>
            <div id="arcane-seq" style="margin-top:8px; font-size:24px; letter-spacing:6px; text-align:center;">${sequence.join(' ')}</div>
            <div id="arcane-progress" style="margin-top:8px; font-size:20px; text-align:center; color:#6a1b9a;">—</div>
            <div id="arcane-timer" style="margin-top:8px; font-size:13px; text-align:center;">⏳ 5.0s</div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:10px;">
              <button class="admin-btn" style="margin:0;" onclick="window.__snakeArcaneInput('↑')">↑</button>
              <button class="admin-btn" style="margin:0;" onclick="window.__snakeArcaneInput('→')">→</button>
              <button class="admin-btn" style="margin:0;" onclick="window.__snakeArcaneInput('←')">←</button>
              <button class="admin-btn" style="margin:0;" onclick="window.__snakeArcaneInput('↓')">↓</button>
            </div>`;
            document.getElementById('modal').style.display = 'block';
            document.getElementById('overlay').style.display = 'block';
            setSnakeCriticalUiLock('snake_arcane');

            const startedAt = Date.now();
            const timerId = setInterval(() => {
                if (finished) {
                    clearInterval(timerId);
                    return;
                }
                const left = Math.max(0, timeLimitMs - (Date.now() - startedAt));
                const timerEl = document.getElementById('arcane-timer');
                if (timerEl) timerEl.textContent = `⏳ ${(left / 1000).toFixed(1)}s`;
                if (left <= 0) {
                    clearInterval(timerId);
                    finish(false);
                }
            }, 100);

            const pushInput = (arrow) => {
                if (finished) return;
                const expected = sequence[progress.length];
                if (arrow !== expected) {
                    finish(false);
                    return;
                }
                progress.push(arrow);
                const progressEl = document.getElementById('arcane-progress');
                if (progressEl) progressEl.textContent = progress.join(' ');
                if (progress.length >= sequence.length) {
                    finish(true);
                }
            };

            window.__snakeArcaneInput = pushInput;
            window.__snakeArcaneOnKeyDown = (ev) => {
                const arrow = normalizeArrowKey(ev.key);
                if (!arrow) return;
                ev.preventDefault();
                pushInput(arrow);
            };
            window.addEventListener('keydown', window.__snakeArcaneOnKeyDown);
        }

        async function refreshSnakeSmugglerPresence(userState = null) {
            const isSnakeMode = resolveRoundFieldMode(currentRoundData) === 'snake';
            if (!isSnakeMode || !currentUserId || !canUseGameplayFeatures()) return;
            const shop = getSnakeShopWindowState();
            const ref = db.ref('snake_smuggler/current');
            if (!shop.isOpen) {
                const existing = (await ref.once('value')).val() || null;
                if (existing) await ref.remove();
                return;
            }
            const now = Date.now();
            const row = (await ref.once('value')).val() || null;
            let current = row;
            if (!row || String(row.windowId || '') !== String(shop.windowId || '') || String(row.dayKey || '') !== String(getMskNowParts().dayKey || '')) {
                const roundNum = Number(currentRoundData?.number || 0);
                const pos = 2 + Math.floor(Math.random() * 98);
                const boardSnap = await db.ref('board').once('value');
                const board = boardSnap.val() || {};
                const eligible = {};
                Object.values(board).forEach((c) => {
                    if (!c || String(c.mode || '') !== 'snake') return;
                    if (Number(c.pathPos || 0) !== pos) return;
                    if (c.userId) eligible[String(c.userId)] = true;
                });
                current = {
                    position: pos,
                    spawnedAt: now,
                    expiresAt: now + (30 * 60 * 1000),
                    discountPercent: 20,
                    eligible,
                    round: roundNum,
                    windowId: String(shop.windowId || ''),
                    dayKey: getMskNowParts().dayKey
                };
                await ref.set(current);
            }
            const userPos = Number((userState?.snakeState?.position) || (await db.ref(`whitelist/${currentUserId}/snakeState/position`).once('value')).val() || 0);
            if (userPos === Number(current.position || 0) && !current?.eligible?.[String(currentUserId)]) {
                await db.ref(`snake_smuggler/current/eligible/${currentUserId}`).set(true);
            }
        }

        function calcSnakeShopPrice(itemKey, useSmugglerDiscount = false) {
            const base = Number(SNAKE_SHOP_ITEMS[itemKey]?.price || 0);
            if (!useSmugglerDiscount) return base;
            return Math.ceil(base * 0.8);
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
                    charColors,
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
                    renderSnakeShopControls();
                    await postRoundEndNewsIfNeeded(currentRoundNum);
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
                    renderSnakeShopControls();
                    return;
                }

                if (isObserverOnlyAdmin()) {
                    btn.disabled = true;
                    btn.innerText = getAdminGameplayBlockedLabel();
                    hideSnakeStatusBlock();
                    await renderAdminSnakeOverview();
                    window.updateEventUiState?.();
                    return;
                }

                const userStateSnap = await db.ref(`whitelist/${currentUserId}`).once('value');
                const userState = userStateSnap.val() || {};
                applyPendingStealResolutionsForCurrentUser().catch(() => {});
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

                const isSnakeMode = resolveRoundFieldMode(currentRoundData) === 'snake';
                myRoundHasMove = isSnakeMode ? false : (userState.last_round === currentRoundNum);
                btn.disabled = myRoundHasMove;
                btn.innerText = btn.disabled ? "🎲 Ход сделан" : "🎲 Бросить кубик";
                if (isSnakeMode) {
                    showIncidentSummaryOnPowerWindowEntry().catch(() => {});
                    const snakeRollState = getSnakeRollDisabledReason({
                        userState,
                        duelLockActive,
                        isRoundActive: diff > 0
                    });
                    btn.disabled = snakeRollState.disabled;
                    btn.innerText = snakeRollState.text;
                } else if (duelLockActive) {
                    btn.disabled = true;
                }
                await renderSnakeStatusBlock(userState);
                refreshSnakeSmugglerPresence(userState).catch(() => {});
                renderSnakeShopControls();
                refreshSnakePendingIndicator().catch(() => {});
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

        async function tryOpenSnakeClashFromId(clashId) {
            const raw = String(clashId || '').trim();
            if (!raw) return false;
            const parts = raw.split('_');
            if (parts.length < 3) return false;
            const roundId = Number(parts[0] || 0);
            const cell = Number(parts[1] || 0);
            const pairKey = parts.slice(2).join('_');
            if (!roundId || !cell || !pairKey) return false;
            const clashPath = `snake_clashes/${roundId}/${cell}/${pairKey}`;
            const snap = await db.ref(clashPath).once('value');
            const clash = snap.val() || {};
            if (String(clash.status || '') !== 'active') return false;
            if (String(clash.gameType || '') === 'snake_rps') openSnakeRpsModal(clashPath, clash);
            if (String(clash.gameType || '') === 'snake_poison_dice') openSnakePoisonDiceModal(clashPath, clash);
            if (String(clash.gameType || '') === 'snake_puzzle_5x5') openSnakePuzzleModal(clashPath, clash);
            return true;
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

        async function tryResolveSheddingLockByTimer(userId, snakeState) {
            return ensureSnakeClashApi()?.tryResolveSheddingLockByTimer(userId, snakeState) || false;
        }

        async function tryResolveSheddingLockByKarma(userId) {
            const result = await ensureSnakeClashApi()?.tryResolveSheddingLockByKarma(userId);
            return result || { released: false, reason: 'api_unavailable' };
        }

        let snakeRollInFlight = false;
        let snakeDuelInviteInFlight = false;

        function hasActiveOrPendingDuelBetween(userA, userB) {
            const a = String(userA || '').trim();
            const b = String(userB || '').trim();
            if (!a || !b) return false;
            return (activeDuels || []).some((duel) => {
                if (!duel || typeof duel !== 'object') return false;
                const challengerId = String(duel.challengerId || '').trim();
                const opponentId = String(duel.opponentId || '').trim();
                const duelStatus = String(duel.status || '').trim();
                if (!['pending', 'active'].includes(duelStatus)) return false;
                const pairMatch = (challengerId === a && opponentId === b) || (challengerId === b && opponentId === a);
                return pairMatch;
            });
        }

        function isSnakeDuelPairOnSameActiveCell(currentRow, targetRow, cellPos, roundNum) {
            const currentState = currentRow?.snakeState || {};
            const targetState = targetRow?.snakeState || {};
            const currentPos = Number(currentState.position || 0);
            const targetPos = Number(targetState.position || 0);
            if (currentPos <= 0 || targetPos <= 0) return false;
            if (currentPos !== targetPos || currentPos !== Number(cellPos || 0)) return false;

            const currentTaskRound = Number(currentState.activeTask?.round || roundNum || 0);
            const targetTaskRound = Number(targetState.activeTask?.round || roundNum || 0);
            if (currentTaskRound > 0 && Number(roundNum || 0) > 0 && currentTaskRound !== Number(roundNum || 0)) return false;
            if (targetTaskRound > 0 && Number(roundNum || 0) > 0 && targetTaskRound !== Number(roundNum || 0)) return false;

            return true;
        }

        async function challengeSnakeCellPlayer(targetUserId, cellPos) {
            if (!canUseGameplayFeatures()) return alert(getAdminGameplayBlockedLabel());
            const targetUid = String(targetUserId || '').trim();
            const currentUid = String(currentUserId || '').trim();
            const pos = Number(cellPos || 0);
            if (!targetUid || !currentUid || !pos) return;
            if (targetUid === currentUid) return;
            if (snakeDuelInviteInFlight) return;
            if (Number(currentUid) === Number(ADMIN_ID)) return;

            snakeDuelInviteInFlight = true;
            try {
                if (hasActiveOrPendingDuelBetween(currentUid, targetUid)) {
                    return alert('У вас уже есть активная/ожидающая дуэль.');
                }

                const [roundSnap, currentUserSnap, targetUserSnap] = await Promise.all([
                    db.ref('current_round').once('value'),
                    db.ref(`whitelist/${currentUid}`).once('value'),
                    db.ref(`whitelist/${targetUid}`).once('value')
                ]);
                const roundData = roundSnap.val() || {};
                if (!window.snakeRound?.isSnakeRound?.(roundData)) {
                    return alert('Вызов из клетки доступен только в режиме «Змейка».');
                }

                const currentRow = currentUserSnap.val() || {};
                const targetRow = targetUserSnap.val() || {};
                const activeRoundNum = Number(roundData.number || 0);
                const isSameCell = isSnakeDuelPairOnSameActiveCell(currentRow, targetRow, pos, activeRoundNum);
                if (!isSameCell) {
                    return alert('Вызов доступен только игрокам на одной и той же клетке текущего snake-раунда.');
                }

                if (hasActiveOrPendingDuelBetween(currentUid, targetUid)) {
                    return alert('У вас уже есть активная/ожидающая дуэль.');
                }

                const targetName = players[Number(targetRow.charIndex)]?.n || targetRow.nickname || `ID ${targetUid}`;
                await window.sendCellImpulseToOwner?.(pos - 1, targetUid, encodeURIComponent(targetName));
            } finally {
                snakeDuelInviteInFlight = false;
            }
        }

        window.challengeSnakeCellPlayer = challengeSnakeCellPlayer;

        function normalizeSnakeUsedTaskIds(rawUsedTaskIds) {
            if (!rawUsedTaskIds || typeof rawUsedTaskIds !== 'object') return {};
            return Object.entries(rawUsedTaskIds).reduce((acc, [taskId, used]) => {
                if (!used) return acc;
                const normalizedTaskId = Number(taskId);
                if (!Number.isInteger(normalizedTaskId) || normalizedTaskId < 0) return acc;
                acc[normalizedTaskId] = true;
                return acc;
            }, {});
        }

        function normalizeGlobalUsedTaskIds(rawUsedTaskIds) {
            if (Array.isArray(rawUsedTaskIds)) {
                return rawUsedTaskIds.reduce((acc, taskId) => {
                    const normalizedTaskId = Number(taskId);
                    if (!Number.isInteger(normalizedTaskId) || normalizedTaskId < 0) return acc;
                    acc[normalizedTaskId] = true;
                    return acc;
                }, {});
            }
            return normalizeSnakeUsedTaskIds(rawUsedTaskIds);
        }

        function pickSnakeTaskForPlayer(snakeState, roundNum, globalUsedTaskIdsRaw) {
            const previousRound = Number(snakeState?.taskPoolRound || 0);
            const activeRound = Number(roundNum || 0);
            const shouldResetPool = previousRound !== activeRound;
            const usedTaskIds = shouldResetPool ? {} : normalizeSnakeUsedTaskIds(snakeState?.usedTaskIds);
            const globalUsedTaskIds = normalizeGlobalUsedTaskIds(globalUsedTaskIdsRaw || snakeState?.globalUsedTaskIds);
            const allTaskIds = tasks.map((_, i) => i);
            const uniquePool = allTaskIds.filter((idx) => !globalUsedTaskIds[idx]);
            const taskIdx = uniquePool.length ? uniquePool[Math.floor(Math.random() * uniquePool.length)] : -1;
            if (taskIdx < 0) {
                return {
                    taskIdx: -1,
                    usedTaskIds,
                    globalUsedTaskIds,
                    taskPoolRound: activeRound,
                    exhaustedUniquePool: true
                };
            }
            return {
                taskIdx,
                usedTaskIds: { ...usedTaskIds, [taskIdx]: true },
                globalUsedTaskIds: { ...globalUsedTaskIds, [taskIdx]: true },
                taskPoolRound: activeRound,
                exhaustedUniquePool: false
            };
        }

        function buildSnakeRollRequestId(userId) {
            const uid = String(userId || '').trim();
            const rand = Math.random().toString(36).slice(2, 10);
            return `${uid || 'u'}_${Date.now()}_${rand}`;
        }

        const SNAKE_ROLL_LOCK_STALE_MS = 90 * 1000;

        async function reserveSnakeRollSlot({ userId, roundNum, rollRequestId }) {
            const uid = String(userId || '').trim();
            const requestId = String(rollRequestId || '').trim();
            const expectedRound = Number(roundNum || 0);
            if (!uid || !requestId || expectedRound <= 0) {
                return { ok: false, reason: 'invalid_request' };
            }
            const ref = db.ref(`whitelist/${uid}/snakeState`);
            let txReason = '';
            const tx = await ref.transaction((row) => {
                const state = (row && typeof row === 'object') ? row : {};
                const existingLock = (state.turnLock && typeof state.turnLock === 'object') ? state.turnLock : {};
                if (String(state.lastProcessedRequestId || '') === requestId) {
                    txReason = 'already_processed';
                    return state;
                }
                if (existingLock.inFlight) {
                    const lockTs = Number(existingLock.lockedAt || 0);
                    const lockAgeMs = lockTs > 0 ? (Date.now() - lockTs) : 0;
                    const isStaleLock = lockTs > 0 && lockAgeMs >= SNAKE_ROLL_LOCK_STALE_MS;
                    if (!isStaleLock) {
                        txReason = 'lock_in_flight';
                        return;
                    }
                }
                if (state.awaitingApproval) {
                    txReason = 'awaiting_approval';
                    return;
                }
                if (state.lockedBySphinx) {
                    txReason = 'sphinx_locked';
                    return;
                }
                const cyclesLeft = getForbiddenFruitCyclesRemaining(state, Date.now());
                if (cyclesLeft > 0) {
                    txReason = 'forbidden_fruit_wait';
                    return;
                }
                if (state.sheddingActive && !state.sheddingReleasedAt) {
                    const endsAt = Number(state.sheddingEndsAt || state.sheddingLockUntil || 0);
                    if (!endsAt || endsAt > Date.now()) {
                        txReason = 'shedding_locked';
                        return;
                    }
                }
                return {
                    ...state,
                    turnLock: {
                        inFlight: true,
                        requestId,
                        round: expectedRound,
                        lockedAt: Date.now()
                    },
                    lastRollRequestId: requestId
                };
            });

            if (!tx.committed) {
                return { ok: false, reason: txReason || 'not_committed' };
            }
            return {
                ok: true,
                snakeState: tx.snapshot?.val?.() || {},
                lockRequestId: requestId
            };
        }

        async function releaseSnakeRollSlot(userId, rollRequestId, completed = false) {
            const uid = String(userId || '').trim();
            const requestId = String(rollRequestId || '').trim();
            if (!uid || !requestId) return;
            const ref = db.ref(`whitelist/${uid}/snakeState`);
            await ref.transaction((row) => {
                const state = (row && typeof row === 'object') ? row : {};
                const lock = (state.turnLock && typeof state.turnLock === 'object') ? state.turnLock : {};
                if (String(lock.requestId || '') !== requestId) return state;
                return {
                    ...state,
                    turnLock: {
                        inFlight: false,
                        requestId,
                        round: Number(lock.round || 0),
                        lockedAt: Number(lock.lockedAt || 0),
                        completedAt: completed ? Date.now() : 0
                    },
                    lastProcessedRequestId: completed ? requestId : String(state.lastProcessedRequestId || '')
                };
            });
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



        async function grantSnakeFinalRewardIfNeeded({ userId, roundNum, landingPos }) {
            const uid = String(userId || '').trim();
            const round = Number(roundNum || 0);
            const pos = Number(landingPos || 0);
            if (!uid || round <= 0 || pos !== 100) return { granted: false, reason: 'not_final_cell' };

            const markerPath = `whitelist/${uid}/snakeState/final100Reward`;
            let shouldGrant = false;
            const markerTx = await db.ref(markerPath).transaction((row) => {
                const current = (row && typeof row === 'object') ? row : {};
                if (current.granted) return;
                shouldGrant = true;
                return {
                    granted: true,
                    round,
                    cell: 100,
                    grantedAt: Date.now(),
                    label: 'Финал "Змейки"'
                };
            });
            if (!markerTx.committed || !shouldGrant) return { granted: false, reason: 'already_granted' };

            let startFrom = null;
            const counterTx = await db.ref('ticket_counter').transaction((value) => {
                const current = Number(value) || 0;
                startFrom = current + 1;
                return current + 2;
            });
            if (!counterTx.committed || !Number.isInteger(startFrom)) {
                await db.ref(markerPath).remove();
                return { granted: false, reason: 'ticket_counter_failed' };
            }

            const ticketNums = [startFrom, startFrom + 1];
            const updates = {};
            const nowTs = Date.now();
            ticketNums.forEach((num) => {
                const ticketPayload = {
                    num,
                    ticketNum: num,
                    ticket: String(num),
                    userId: uid,
                    owner: Number(myIndex),
                    round,
                    cell: 100,
                    mode: 'snake',
                    source: 'snake_final_100',
                    sourceLabel: 'Финал "Змейки"',
                    taskLabel: 'Финал "Змейки"',
                    createdAt: nowTs
                };
                updates[`tickets/${num}`] = ticketPayload;
                updates[`users/${uid}/tickets/${num}`] = ticketPayload;
            });
            updates[`${markerPath}/tickets`] = ticketNums;
            updates[`${markerPath}/ticketCounterApplied`] = true;
            updates[`system_notifications/${uid}/snake_final_100_${round}`] = {
                text: `🏁 Финал «Змейки» достигнут! Выданы 2 билетика: #${ticketNums[0]} и #${ticketNums[1]}.`,
                type: 'snake_final_reward',
                createdAt: nowTs,
                expiresAt: nowTs + (7 * 24 * 3600 * 1000)
            };
            await db.ref().update(updates);
            return { granted: true, ticketNums };
        }

        async function roll() {
            return enqueueSnakeAction('roll', async () => {
                setSnakeCriticalUiLock('snake_roll');
            const rollTrace = (label, payload) => {
                if (payload === undefined) {
                    console.info(`[ROLL] ${label}`);
                    return;
                }
                console.info(`[ROLL] ${label}`, payload);
            };

            rollTrace('click received', {
                userId: currentUserId,
                inFlight: snakeRollInFlight,
                myIndex
            });
            if (snakeRollInFlight) return;
            if (isObserverOnlyAdmin()) {
                return alert(getAdminGameplayBlockedLabel());
            }
            snakeRollInFlight = true;
            let activeSnakeRollRequestId = '';
            const diceBtn = document.getElementById('dice-btn');
            if (diceBtn) diceBtn.disabled = true;
            try {
            const userStateSnap = await db.ref(`whitelist/${currentUserId}`).once('value');
            const userState = userStateSnap.val() || {};
                applyPendingStealResolutionsForCurrentUser().catch(() => {});
            if (userState.isEliminated) return alert('Ты подтвердил(а) выход из игры и больше не участвуешь в следующих раундах.');

            const currentRoundSnap = await db.ref('current_round').once('value');
            const currentRound = currentRoundSnap.val() || {};
            const activeFieldMode = resolveRoundFieldMode(currentRound);
            rollTrace(`mode resolved = ${activeFieldMode}`);
            if (activeFieldMode === 'snake') {
                rollTrace('entering snake branch');
                rollTrace(`snake inFlight before = ${snakeRollInFlight}`);
                if (!window.snakeRound || typeof window.snakeRound.getUserSnakeState !== 'function') {
                    throw new Error('snakeRound API is unavailable in roll()');
                }
                await tryResolveSheddingLockByTimer(currentUserId, userState.snakeState || null);
                let snakeState = await window.snakeRound.getUserSnakeState(db, currentUserId);
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
                    snakeState = refreshSnakeState;
                }

                const fruitCyclesLeft = getForbiddenFruitCyclesRemaining(snakeState, Date.now());
                if (fruitCyclesLeft > 0) {
                    return alert(`🍎 Запретный плод: нужно пропустить ещё ${fruitCyclesLeft} полн. цикла(ов) окон.`);
                }

                const powerGuard = canRollInCurrentPowerWindow(snakeState);
                if (!powerGuard.ok) return alert(powerGuard.text || 'Сейчас не окно силы.');

                const rollRequestId = buildSnakeRollRequestId(currentUserId);
                activeSnakeRollRequestId = rollRequestId;
                const reserve = await reserveSnakeRollSlot({
                    userId: currentUserId,
                    roundNum: Number(currentRound.number || 0),
                    rollRequestId
                });
                if (!reserve.ok) {
                    if (reserve.reason === 'awaiting_approval') return alert('Сначала дождись одобрения текущей работы админом.');
                    if (reserve.reason === 'sphinx_locked') return alert('Испытание Сфинкса ещё не завершено.');
                    if (reserve.reason === 'shedding_locked') return alert('Сброс кожи пока активен.');
                    if (reserve.reason === 'forbidden_fruit_wait') return alert('🍎 Запретный плод: блокировка по циклам окон ещё активна.');
                    if (reserve.reason === 'lock_in_flight') return alert('Подожди, предыдущий бросок ещё обрабатывается.');
                    if (reserve.reason === 'already_processed') return;
                    return alert('Не удалось начать ход. Попробуй ещё раз.');
                }
                snakeState = reserve.snakeState || snakeState;

                let playerKarma = Number((await db.ref(`player_season_status/${currentUserId}/karma_points`).once('value')).val() || 0);
                let diceSource = 'normal';
                let forcedDice = null;
                const fateCount = Number(myInventory.fateBone || 0);
                const windCount = Number(myInventory.windBreath || 0);
                if (fateCount > 0 || windCount > 0) {
                    const useSpecial = prompt(`Выбери тип броска:
0 — обычный
1 — Кость Судьбы (x${fateCount})
2 — Дыхание Ветра (x${windCount})`, '0');
                    if (useSpecial === '1' && fateCount > 0) {
                        const picked = Number(prompt('Выбери число от 1 до 6', '6'));
                        if (Number.isInteger(picked) && picked >= 1 && picked <= 6) {
                            const consumed = await tryConsumeSnakeInventoryItem('fateBone');
                            if (consumed) {
                                diceSource = 'fateBone';
                                playerKarma = Number((await db.ref(`player_season_status/${currentUserId}/karma_points`).once('value')).val() || 0);
                                forcedDice = picked;
                            } else {
                                alert('Кость Судьбы уже закончилась.');
                            }
                        }
                    } else if (useSpecial === '2' && windCount > 0) {
                        const first = 1 + Math.floor(Math.random() * 6);
                        const second = 1 + Math.floor(Math.random() * 6);
                        alert(`Дыхание Ветра: ${first} + ${second} = ${first + second}`);
                        const consumed = await tryConsumeSnakeInventoryItem('windBreath');
                        if (consumed) {
                            diceSource = 'windBreath';
                            playerKarma = Number((await db.ref(`player_season_status/${currentUserId}/karma_points`).once('value')).val() || 0);
                            forcedDice = Math.min(12, first + second);
                        } else {
                            alert('Дыхание Ветра уже закончилось.');
                        }
                    }
                }
                let dice = Number.isFinite(forcedDice) ? Number(forcedDice) : (1 + Math.floor(Math.random() * 6));
                let usedReroll = false;
                if (diceSource === 'normal' && playerKarma >= 15) {
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
                rollTrace(`snake current position = ${position}`);
                const baseNextPos = window.snakeRound.evaluateMove(position, dice, !!snakeState.invertNextRoll);
                rollTrace(`dice rolled = ${dice}`);
                let effect = window.snakeRound.resolveCellEffect(baseNextPos, currentRound.snakeConfig || {});
                let nextPos = Number(effect.to || baseNextPos);
                rollTrace(`next position = ${nextPos}`);

                const rankName = window.karmaSystem?.getKarmaRank ? window.karmaSystem.getKarmaRank(playerKarma) : '';
                const isCreatorRank = String(rankName).includes('Творец Миров');
                const negativeTrapTypes = new Set(['snake', 'maelstrom', 'kaa', 'sphinx', 'shedding']);
                let scaleShieldedCell = false;
                let jungleImmunityUsed = false;
                let appliedNegativeEffectThisRoll = false;
                const jungleImmunityPending = !!snakeState.jungleImmunityPending;

                if (String(effect.type) === 'kaa' && isCreatorRank) {
                    effect = { ...effect, type: 'normal', to: baseNextPos, invertNextRoll: false, text: '🛡️ Твой ранг «Творец Миров» защитил от гипноза Каа.' };
                    nextPos = baseNextPos;
                    alert('Твой ранг «Творец Миров» защитил от гипноза Каа!');
                } else if (negativeTrapTypes.has(String(effect.type || ''))) {
                    const consumedScale = await tryConsumeSnakeInventoryItem('greatPythonScale');
                    if (consumedScale) {
                        scaleShieldedCell = true;
                        effect = { ...effect, type: 'normal', to: baseNextPos, invertNextRoll: false, lockSphinx: false, lockUntil: null, text: '🛡️ Чешуя Великого Полоза нейтрализовала всю угрозу клетки.' };
                        nextPos = baseNextPos;
                        alert('Чешуя Великого Полоза сработала: негативный эффект полностью отменён.');
                    } else if (jungleImmunityPending) {
                        jungleImmunityUsed = true;
                        effect = { ...effect, type: 'normal', to: baseNextPos, invertNextRoll: false, lockSphinx: false, lockUntil: null, text: '🌿 Иммунитет джунглей поглотил негативный эффект.' };
                        nextPos = baseNextPos;
                        alert('🌿 Иммунитет джунглей сработал: негативный эффект поглощён.');
                    } else if (playerKarma >= 30) {
                        const useAmulet = confirm(`Попадание на ловушку (${effect.text || effect.type}). Потратить 30 кармы на Защитный амулет и игнорировать эффект?`);
                        if (useAmulet) {
                            await updateKarma(currentUserId, -30);
                            playerKarma = Math.max(0, playerKarma - 30);
                            effect = { ...effect, type: 'normal', to: baseNextPos, invertNextRoll: false, lockSphinx: false, lockUntil: null, text: '🛡️ Защитный амулет нейтрализовал ловушку.' };
                            nextPos = baseNextPos;
                            alert('Защитный амулет сработал: негативный эффект отменён.');
                        }
                    }
                    if (negativeTrapTypes.has(String(effect.type || ''))) appliedNegativeEffectThisRoll = true;
                }

                const roundIdForTrap = Number(currentRound.number || 0);
                const globalUsedTasksSnap = await db.ref(`whitelist/${currentUserId}/${USER_GLOBAL_USED_TASKS_PATH_SUFFIX}`).once('value');
                let globalUsedTaskIds = normalizeGlobalUsedTaskIds(globalUsedTasksSnap.val() || snakeState?.globalUsedTaskIds);

                const trapPath = `snake_traps/${roundIdForTrap}/${nextPos}`;
                const trapTx = await db.ref(trapPath).transaction((row) => {
                    if (!row || !row.armed) return row;
                    if (Number(row.expiresAt || 0) <= Date.now()) return null;
                    return { ...row, armed: false, triggeredBy: String(currentUserId || ''), triggeredAt: Date.now() };
                });
                const trapRow = trapTx.snapshot?.val?.() || null;
                const trapTriggered = !!(trapTx.committed && trapRow && !trapRow.armed && String(trapRow.triggeredBy || '') === String(currentUserId || ''));
                let doubleBurdenBonusTaskIdx = null;
                if (trapTriggered) {
                    const trapType = String(trapRow.type || '');
                    const consumedScaleOnTrap = scaleShieldedCell ? false : await tryConsumeSnakeInventoryItem('greatPythonScale');
                    if (scaleShieldedCell || consumedScaleOnTrap) {
                        alert('Чешуя Великого Полоза поглотила ловушку.');
                    } else if (jungleImmunityPending && !jungleImmunityUsed) {
                        jungleImmunityUsed = true;
                        alert('🌿 Иммунитет джунглей поглотил ловушку.');
                    } else if (trapType === 'rotten_radish') {
                        appliedNegativeEffectThisRoll = true;
                        snakeState = { ...snakeState, forbiddenFruitSkipPending: true, skipNextTurn: true };
                        alert('🥕 Гнилая редиска: следующий ход будет пропущен.');
                        await markSnakeIncident(String(trapRow.ownerId || ''), { type: 'trap_radish_triggered', actorName: players[myIndex]?.n || '', text: `На твою Редиску наступил(а) ${players[myIndex]?.n || 'игрок'}.` });
                    } else if (trapType === 'double_burden') {
                        appliedNegativeEffectThisRoll = true;
                        const bonusPick = pickSnakeTaskForPlayer(snakeState, currentRound.number, globalUsedTaskIds);
                        doubleBurdenBonusTaskIdx = Number(bonusPick.taskIdx || 0);
                        if (Number(bonusPick.taskIdx) < 0) return alert('Пул заданий исчерпан для этого игрока в текущей игре.');
                        globalUsedTaskIds = bonusPick.globalUsedTaskIds;
                        snakeState = { ...snakeState, usedTaskIds: bonusPick.usedTaskIds, globalUsedTaskIds: bonusPick.globalUsedTaskIds };
                        alert('📜 Ловушка «Двойное Бремя»: получено дополнительное задание.');
                        await markSnakeIncident(String(trapRow.ownerId || ''), { type: 'trap_scroll_triggered', actorName: players[myIndex]?.n || '', text: `Твой Свиток сработал на ${players[myIndex]?.n || 'игроке'}.` });
                    }
                    await db.ref(trapPath).remove();
                }

                const baseNegativeApplied = isNegativeSnakeEffectType(effect.type);
                if (baseNegativeApplied) appliedNegativeEffectThisRoll = true;
                const previousNegativeChain = Math.max(0, Number(snakeState.consecutiveNegativeEffects || 0));
                const nextNegativeChain = appliedNegativeEffectThisRoll ? (previousNegativeChain + 1) : 0;
                const shouldGrantJungleImmunity = !jungleImmunityUsed && nextNegativeChain >= 2;

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
                    updates[`rounds/${roundId}/snake/occupancy/${previousCellPos}/${uid}`] = null;
                }

                const existingSelf = presenceList.find((row) => String(row.userId) === uid);
                updates[`snake_presence/${roundId}/${nextPos}/${uid}`] = {
                    userId: uid,
                    owner: myIndex,
                    enteredAt: Number(existingSelf?.enteredAt || nowTs),
                    lastSeenAt: nowTs
                };
                updates[`rounds/${roundId}/snake/occupancy/${nextPos}/${uid}`] = true;

                const taskPick = pickSnakeTaskForPlayer(snakeState, currentRound.number, globalUsedTaskIds);
                if (Number(taskPick.taskIdx) < 0) return alert('Пул заданий исчерпан для этого игрока в текущей игре.');
                const taskIdx = Number(taskPick.taskIdx || 0);
                const taskLabelSnapshot = String(tasks[taskIdx]?.text || 'Обычное задание');
                const assignmentId = `${roundId}_${uid}_${nextPos}_${taskIdx}_${nowTs}`;
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
                        assignmentId,
                        round: currentRound.number,
                        type: String(effect.type || '') === 'sphinx' ? 'snake_sphinx' : 'snake_standard',
                        isSphinxTrial: String(effect.type || '') === 'sphinx',
                        taskLabel: String(effect.type || '') === 'sphinx'
                            ? '🗿 Испытание Сфинкса: сложное супер-задание (бросок кубика заблокирован до одобрения)'
                            : (Number.isInteger(doubleBurdenBonusTaskIdx) ? `📜 Двойное Бремя: основное + бонусное задание (#${doubleBurdenBonusTaskIdx})` : taskLabelSnapshot),
                        bonusTaskIdx: Number.isInteger(doubleBurdenBonusTaskIdx) ? Number(doubleBurdenBonusTaskIdx) : null
                    },
                    currentAssignmentId: `${currentRound.number}_${nextPos}_${taskIdx}`,
                    usedTaskIds: taskPick.usedTaskIds,
                    taskPoolRound: Number(taskPick.taskPoolRound || currentRound.number),
                    uniqueTaskPoolExhausted: !!taskPick.exhaustedUniquePool,
                    globalUsedTaskIds: taskPick.globalUsedTaskIds,
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
                    skipNextTurn: !!snakeState.skipNextTurn,
                    consecutiveNegativeEffects: Math.max(0, nextNegativeChain),
                    jungleImmunityPending: shouldGrantJungleImmunity,
                    jungleImmunityConsumedAt: jungleImmunityUsed ? Date.now() : Number(snakeState.jungleImmunityConsumedAt || 0),
                    forbiddenFruitActive: false,
                    forbiddenFruitAccepted: false,
                    forbiddenFruitGrantedAt: 0,
                    forbiddenFruitSkipPending: !!snakeState.forbiddenFruitSkipPending,
                    forbiddenFruitConsumedAt: Number(snakeState.forbiddenFruitConsumedAt || 0),
                    forbiddenFruitChoice: '',
                    forbiddenFruitAwaitingSubmission: false,
                    forbiddenFruitWaitUntil: 0,
                    forbiddenFruitWaitStartedAt: 0,
                    forbiddenFruitBlockStartCycle: Number(snakeState.forbiddenFruitBlockStartCycle || 0),
                    forbiddenFruitBlockUntilCycle: Number(snakeState.forbiddenFruitBlockUntilCycle || 0),
                    forbiddenFruitBlockedWindowCycles: Number(snakeState.forbiddenFruitBlockedWindowCycles || 0),
                    lastRollRequestId: rollRequestId,
                    lastProcessedRequestId: rollRequestId,
                    turnLock: {
                        inFlight: false,
                        requestId: rollRequestId,
                        round: roundId,
                        lockedAt: nowTs,
                        completedAt: nowTs
                    },
                    powerWindowDayMsk: getCurrentPowerWindowMsk().dayKey,
                    selectedPowerWindowId: getCurrentPowerWindowMsk().activeWindowId,
                    firstPowerRollAt: (String(snakeState.powerWindowDayMsk || '') === String(getCurrentPowerWindowMsk().dayKey || '')) ? Number(snakeState.firstPowerRollAt || Date.now()) : Date.now(),
                    rollMeta: {
                        usedReroll,
                        baseDice: usedReroll ? null : dice,
                        finalDice: dice,
                        spentOnReroll: usedReroll ? 15 : 0,
                        diceSource
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

                if (shouldGrantJungleImmunity) {
                    alert('🌿 Иммунитет джунглей активирован: следующий негативный эффект будет поглощён.');
                }

                const processedEncounterPairKeys = new Set();
                for (const other of othersOnCell) {
                    const otherUserId = String(other.userId || '').trim();
                    if (!otherUserId) continue;
                    const pairKey = window.snakeRound?.buildPairKey
                        ? window.snakeRound.buildPairKey(uid, otherUserId)
                        : [uid, otherUserId].sort((a, b) => a.localeCompare(b, 'ru')).join('__');
                    processedEncounterPairKeys.add(pairKey);
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
                    const accepted = confirm('🍎 Запретный плод: получить +20 кармы сейчас и после принятия текущей работы пропустить 2 полных цикла окон силы?');
                    nextSnakeState.forbiddenFruitActive = true;
                    nextSnakeState.forbiddenFruitAccepted = !!accepted;
                    if (accepted) {
                        await updateKarma(currentUserId, 20);
                        playerKarma += 20;
                        const grantedAt = Date.now();
                        nextSnakeState.forbiddenFruitGrantedAt = grantedAt;
                        nextSnakeState.forbiddenFruitChoice = 'karma20';
                        nextSnakeState.forbiddenFruitAwaitingSubmission = true;
                        nextSnakeState.forbiddenFruitWaitUntil = 0;
                        nextSnakeState.forbiddenFruitWaitStartedAt = 0;
                        nextSnakeState.forbiddenFruitBlockStartCycle = 0;
                        nextSnakeState.forbiddenFruitBlockUntilCycle = 0;
                        nextSnakeState.forbiddenFruitBlockedWindowCycles = 0;
                        nextSnakeState.forbiddenFruitSkipPending = false;
                        nextSnakeState.skipNextTurn = false;
                        nextSnakeState.forbiddenFruitConsumedAt = 0;
                        alert('🍎 Ты выбрал(а) +20 к карме. Сдай работу по текущему заданию. После принятия работы нужно будет пропустить 2 полных цикла окон силы.');
                    } else {
                        nextSnakeState.forbiddenFruitGrantedAt = 0;
                        nextSnakeState.forbiddenFruitChoice = '';
                        nextSnakeState.forbiddenFruitAwaitingSubmission = false;
                        nextSnakeState.forbiddenFruitWaitUntil = 0;
                        nextSnakeState.forbiddenFruitWaitStartedAt = 0;
                        nextSnakeState.forbiddenFruitBlockStartCycle = 0;
                        nextSnakeState.forbiddenFruitBlockUntilCycle = 0;
                        nextSnakeState.forbiddenFruitBlockedWindowCycles = 0;
                        nextSnakeState.forbiddenFruitSkipPending = false;
                        nextSnakeState.skipNextTurn = false;
                        nextSnakeState.forbiddenFruitConsumedAt = Date.now();
                    }
                }
                if (Number(effect.karmaDelta || 0) > 0) {
                    await updateKarma(currentUserId, Number(effect.karmaDelta));
                    playerKarma += Number(effect.karmaDelta);
                }

                rollTrace('about to persist snake state');
                updates[`whitelist/${currentUserId}/snakeState`] = nextSnakeState;
                updates[`whitelist/${currentUserId}/${USER_GLOBAL_USED_TASKS_PATH_SUFFIX}`] = taskPick.globalUsedTaskIds;
                updates[`whitelist/${currentUserId}/last_round`] = currentRound.number;
                rollTrace('about to create assignment', {
                    assignmentId,
                    roundId,
                    cell: nextPos,
                    taskIdx
                });
                updates[`rounds/${roundId}/snake/assignments/${uid}/${assignmentId}`] = {
                    assignmentId,
                    userId: uid,
                    round: roundId,
                    cell: nextPos,
                    taskId: taskIdx,
                    taskIdx,
                    taskLabel: taskLabelSnapshot,
                    taskLabelSnapshot,
                    rollRequestId,
                    status: 'assigned',
                    rewardGranted: false,
                    bonusTaskIdx: Number.isInteger(doubleBurdenBonusTaskIdx) ? Number(doubleBurdenBonusTaskIdx) : null,
                    approvals: { main: false, bonus: !Number.isInteger(doubleBurdenBonusTaskIdx) },
                    createdAt: nowTs
                };
                updates[`rounds/${roundId}/snake/moves/${uid}/${rollRequestId}`] = {
                    rollRequestId,
                    userId: uid,
                    round: roundId,
                    from: position,
                    to: nextPos,
                    dice,
                    usedReroll,
                    effectType: String(effect.type || 'normal'),
                    effectText: String(effect.text || ''),
                    assignmentId,
                    taskId: taskIdx,
                    createdAt: nowTs
                };
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

                const freshPresenceSnap = await db.ref(`snake_presence/${roundId}/${nextPos}`).once('value');
                const freshPresenceList = window.snakeRound?.parseCellPresence
                    ? window.snakeRound.parseCellPresence(freshPresenceSnap.val())
                    : [];
                const missedOthersOnCell = freshPresenceList.filter((row) => {
                    const otherUserId = String(row.userId || '').trim();
                    if (!otherUserId || otherUserId === uid) return false;
                    const pairKey = window.snakeRound?.buildPairKey
                        ? window.snakeRound.buildPairKey(uid, otherUserId)
                        : [uid, otherUserId].sort((a, b) => a.localeCompare(b, 'ru')).join('__');
                    return !processedEncounterPairKeys.has(pairKey);
                });
                for (const other of missedOthersOnCell) {
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
                            nowTs: Date.now()
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
                    const encounterNowTs = Date.now();
                    const encounterState = {
                        pairKey,
                        players: [uid, otherUserId].sort((a, b) => a.localeCompare(b, 'ru')),
                        metAt: encounterNowTs,
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
                        updatedAt: encounterNowTs
                    };
                    const encounterUpdates = {
                        [`snake_encounters/${roundId}/${nextPos}/${pairKey}`]: encounterState,
                        [`snake_duel_history/${roundId}/${nextPos}/${pairKey}`]: historySnap.exists()
                            ? {
                                ...(historySnap.val() || {}),
                                updatedAt: encounterNowTs,
                                lastEncounterAt: encounterNowTs
                            }
                            : {
                                pairKey,
                                players: encounterState.players,
                                round: roundId,
                                cell: nextPos,
                                status: 'pending',
                                createdAt: encounterNowTs,
                                updatedAt: encounterNowTs,
                                lastEncounterAt: encounterNowTs
                            }
                    };
                    await db.ref().update(encounterUpdates);
                    if (encounterState.canStartClash) {
                        await maybeCreateSnakeSynergyFromEncounter(encounterState)
                            .then((result) => {
                                if (result?.created) return;
                                return maybeStartSnakeClashFromEncounter(encounterState);
                            });
                    }
                }

                if (Number(nextPos) === 100) {
                    await grantSnakeFinalRewardIfNeeded({
                        userId: currentUserId,
                        roundNum: Number(currentRound.number || 0),
                        landingPos: Number(nextPos)
                    });
                }
                rollTrace('snake persist success');

                await postNews(`🐍 ${players[myIndex].n} бросил(а) ${dice} и теперь на клетке №${nextPos}. ${effect.text || ''}`);
                const actualCell = (await db.ref(`board/${nextPos - 1}`).once('value')).val();
                showCell(nextPos - 1, actualCell);
                rollTrace('snake flow complete');
                return;
            }

            const boardSnap = await db.ref('board').once('value'), board = boardSnap.val() || {};
            const roundSnap = await db.ref('current_round').once('value'), rData = roundSnap.val();
            let free = []; for(let i=0; i<50; i++) if(!board[i]) free.push(i);
            const userSnap = await db.ref(`whitelist/${currentUserId}/used_tasks`).once('value');
            const globalUsedSnap = await db.ref(`whitelist/${currentUserId}/${USER_GLOBAL_USED_TASKS_PATH_SUFFIX}`).once('value');
            let used = userSnap.val() || [];
            const globalUsed = normalizeGlobalUsedTaskIds(globalUsedSnap.val() || used);
            const avail = tasks.map((_, i) => i).filter(i => !globalUsed[i]);
            if (!free.length || (roundEndTime - Date.now() <= 0)) return alert("Мест нет!");
            if (!avail.length) return alert('Пул заданий исчерпан для этого игрока в текущей игре.');

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
            if(!isGold && !isTrap && !isMagic && !isMagnet && taskIdx >= 0) {
                used.push(taskIdx);
                globalUsed[taskIdx] = true;
                await db.ref().update({
                    [`whitelist/${currentUserId}/used_tasks`]: used,
                    [`whitelist/${currentUserId}/${USER_GLOBAL_USED_TASKS_PATH_SUFFIX}`]: globalUsed
                });
            }
            await db.ref(`whitelist/${currentUserId}/last_round`).set(currentRoundNum);
            const actualCell = (await db.ref('board/'+cellIdx).once('value')).val() || cellData;
            showCell(cellIdx, actualCell);

            if (itemType === 'magicWand') {
                await postNews(`${players[myIndex].n} активировал(а) «Волшебная палочка»`);
                await sendWandBlessingImmediately();
            }
            } catch (err) {
                console.error('[ROLL][ERROR]', err);
                alert(`Ошибка броска: ${err?.message || err}`);
                if (activeSnakeRollRequestId) {
                    await releaseSnakeRollSlot(currentUserId, activeSnakeRollRequestId, false);
                }
                return;
            } finally {
                snakeRollInFlight = false;
                setSnakeCriticalUiLock('');
            }
            });
        }

        async function showSnakeCellInfo(cellPos) {
            const pos = Number(cellPos || 0);
            if (!Number.isInteger(pos) || pos < 1 || pos > 100) return;
            const roundSnap = await db.ref('current_round').once('value');
            const roundData = roundSnap.val() || {};
            const roundNum = Number(roundData.number || 0);
            const cellPresenceSnap = await db.ref(`snake_presence/${roundNum}/${pos}`).once('value');
            const presenceRows = window.snakeRound?.parseCellPresence
                ? window.snakeRound.parseCellPresence(cellPresenceSnap.val())
                : [];
            const [usersSnap, seasonSnap, mySnakeStateSnap] = await Promise.all([
                db.ref('whitelist').once('value'),
                db.ref(`player_season_status/${currentUserId}`).once('value'),
                db.ref(`whitelist/${currentUserId}/snakeState`).once('value')
            ]);
            const users = usersSnap.val() || {};
            const mySeason = seasonSnap.val() || {};
            const mySnakeState = mySnakeStateSnap.val() || {};
            const nowTs = Date.now();
            const cooldownMs = Number(window.__duelContext?.IMPULSE_COOLDOWN_MS || 0);
            const cooldownLeftMs = Math.max(0, Number(mySeason.last_impulse_time || 0) + cooldownMs - nowTs);
            const isCooldownActive = cooldownLeftMs > 0;
            const isAdminObserver = isObserverOnlyAdmin();

            const members = presenceRows.map((row) => {
                const uid = String(row.userId || '').trim();
                if (!uid) return null;
                const userRow = users[uid] || {};
                const playerName = players[Number(userRow.charIndex)]?.n || userRow.nickname || `ID ${uid}`;
                const isSelf = String(uid) === String(currentUserId);
                const canByCellRule = !isSelf && !isAdminObserver && isSnakeDuelPairOnSameActiveCell(users[currentUserId] || {}, userRow, pos, roundNum);
                const hasDuelBlock = hasActiveOrPendingDuelBetween(currentUserId, uid);
                const canChallenge = canByCellRule && !hasDuelBlock && !isCooldownActive;
                return {
                    uid,
                    playerName,
                    isSelf,
                    canChallenge,
                    blockedHint: hasDuelBlock
                        ? 'уже есть активная/ожидающая дуэль'
                        : (isCooldownActive ? 'действует cooldown' : '')
                };
            }).filter(Boolean);

            const membersHtml = members.length
                ? members.map((member) => {
                    const duelBtn = member.canChallenge
                        ? `<button class="admin-btn" style="margin:0; padding:2px 8px; min-width:38px;" onclick="challengeSnakeCellPlayer('${member.uid}', ${pos})">⚔️</button>`
                        : (member.isSelf ? '' : `<span style="font-size:11px; color:#888;">${member.blockedHint || ''}</span>`);
                    return `<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-top:6px;"><span>${member.playerName}</span>${duelBtn}</div>`;
                }).join('')
                : '—';

            const cooldownHint = isCooldownActive
                ? `<div style="margin-top:8px; font-size:12px; color:#777;">⚠️ Дуэльный cooldown активен ещё ~${Math.ceil(cooldownLeftMs / 60000)} мин.</div>`
                : '';

            const myUid = String(currentUserId || '').trim();
            const activeTask = (mySnakeState && typeof mySnakeState === 'object') ? (mySnakeState.activeTask || {}) : {};
            const activeTaskCell = Number(activeTask.cell || 0);
            const activeTaskIdx = Number(activeTask.taskIdx ?? -1);
            const activeAssignmentId = String(activeTask.assignmentId || mySnakeState.currentAssignmentId || '').trim();
            const assignmentRound = Number(activeTask.round || roundNum || 0);
            const isOwnCurrentCell = !isAdminObserver
                && String(currentFieldMode || '') === 'snake'
                && Number(mySnakeState.position || 0) === pos;

            let ownTaskHintHtml = '';
            if (isOwnCurrentCell) {
                if (!myUid || activeTaskCell !== pos || !activeAssignmentId) {
                    ownTaskHintHtml = '<div style="margin-top:10px; padding:10px; border-radius:10px; background:#f8f5ff; color:#5e35b1; font-size:13px;">На этой клетке у вас нет активного задания.</div>';
                } else {
                    const assignmentPath = `rounds/${assignmentRound}/snake/assignments/${myUid}/${activeAssignmentId}`;
                    const assignmentSnap = await db.ref(assignmentPath).once('value');
                    const assignment = assignmentSnap.val() || null;
                    const assignmentCell = Number(assignment?.cell || 0);
                    const assignmentStatus = String(assignment?.status || 'assigned');
                    const isSphinxTask = !!activeTask.isSphinxTrial || String(activeTask.type || '') === 'snake_sphinx';
                    const baseTask = Number.isInteger(activeTaskIdx) && activeTaskIdx >= 0 ? tasks[activeTaskIdx] : null;
                    if (!assignment || assignmentCell !== pos || assignmentStatus !== 'assigned') {
                        ownTaskHintHtml = '<div style="margin-top:10px; padding:10px; border-radius:10px; background:#f8f5ff; color:#5e35b1; font-size:13px;">На этой клетке у вас нет активного задания.</div>';
                    } else if (isSphinxTask) {
                        ownTaskHintHtml = `<div style="margin-top:10px; padding:10px; border-radius:10px; background:#f3e5f5; border:1px solid #d1c4e9; color:#4a148c; font-size:13px;"><b>Ваше активное задание:</b><div style="margin-top:6px;">${String(activeTask.taskLabel || '🗿 Испытание Сфинкса активно. Выполните задание и отправьте работу на модерацию.').trim()}</div></div>`;
                    } else {
                        const taskImageHtml = baseTask?.img ? `<img src="${baseTask.img}" style="width:100%; border-radius:8px; margin-top:8px;">` : '';
                        ownTaskHintHtml = `<div style="margin-top:10px; padding:10px; border-radius:10px; background:#f3e5f5; border:1px solid #d1c4e9; color:#4a148c; font-size:13px;"><b>Ваше активное задание:</b><div style="margin-top:6px;">${String(baseTask?.text || 'Задание активно.').trim()}</div>${taskImageHtml}</div>`;
                    }
                }
            }

            const availableTrapItems = getAvailableSnakeTrapItems(myInventory);
            const isSnakeRound = resolveRoundFieldMode(roundData) === 'snake';
            const myPosition = Number(mySnakeState.position || 1);
            const canCheckTrapPlacement = !isAdminObserver && isSnakeRound && availableTrapItems.length > 0;
            let trapActionHtml = '';
            if (canCheckTrapPlacement) {
                const targetCellValid = Number.isInteger(pos) && pos >= 2 && pos <= 99;
                const inRadius = Math.abs(pos - myPosition) <= 10;
                const trapCellSnap = targetCellValid ? await db.ref(`snake_traps/${roundNum}/${pos}`).once('value') : null;
                const trapCellRow = trapCellSnap?.val() || null;
                const trapAlreadyPlaced = !!(trapCellRow && trapCellRow.armed && Number(trapCellRow.expiresAt || 0) > Date.now());
                if (targetCellValid && inRadius && !trapAlreadyPlaced) {
                    const trapButtons = availableTrapItems
                        .map((item) => `<button class="admin-btn" style="margin:6px 0 0; width:100%;" onclick="placeSnakeTrapOnCell('${item.trapType}', ${pos})">Оставить ловушку · ${item.emoji} ${item.name}</button>`)
                        .join('');
                    trapActionHtml = `<div style="margin-top:10px; padding:10px; border:1px solid #d7ccc8; border-radius:10px; background:#fffaf3;"><b>🕳️ Установка ловушки</b><div style="font-size:12px; color:#6d4c41; margin-top:4px;">Клетка валидна для установки. Выберите ловушку из доступных предметов.</div>${trapButtons}</div>`;
                } else {
                    const reason = !targetCellValid
                        ? 'Ловушки нельзя ставить на клетки 1 и 100.'
                        : (!inRadius ? 'Клетка вне радиуса 10 от вашей позиции.' : 'На клетке уже стоит активная ловушка.');
                    trapActionHtml = `<div style="margin-top:10px; padding:10px; border:1px solid #ef9a9a; border-radius:10px; background:#fff5f5; color:#c62828; font-size:12px;">🕳️ Ловушку здесь поставить нельзя: ${reason}</div>`;
                }
            }

            document.getElementById('mTitle').innerText = `🐍 Клетка №${pos}`;
            document.getElementById('mText').innerHTML = `
                <div style="text-align:left; line-height:1.5;">
                    <div><b>Игроков на клетке:</b> ${presenceRows.length}</div>
                    <div style="margin-top:8px;"><b>Список:</b><br>${membersHtml}</div>
                    ${cooldownHint}
                    ${ownTaskHintHtml}
                    ${trapActionHtml}
                </div>
            `;
            document.getElementById('modal').style.display = 'block';
            document.getElementById('overlay').style.display = 'block';
        }

        window.showSnakeCellInfo = showSnakeCellInfo;

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

        function normalizeRaffleWinnerRecord(rawWinner, fallback = {}) {
            if (!rawWinner && !fallback) return null;
            const source = rawWinner && typeof rawWinner === 'object' ? rawWinner : {};
            const ticket = String(source.ticket || source.ticketNum || source.num || source.winnerId || fallback.ticket || fallback.ticketNum || fallback.num || fallback.winnerId || '').trim();
            const winnerName = String(source.winnerName || source.name || source.playerName || fallback.winnerName || fallback.name || fallback.playerName || '').trim();
            const userId = String(source.userId || fallback.userId || '').trim();
            if (!ticket && !winnerName && !userId) return null;
            return {
                ticket,
                winnerName: winnerName || 'Игрок',
                userId: userId || null,
                createdAt: Number(source.createdAt || fallback.createdAt || 0) || 0,
                source: String(source.source || fallback.source || 'raffle_state_sync'),
                drawId: Number(source.drawId || fallback.drawId || 0) || 0
            };
        }

        function getRaffleWinnersFromState(drawState, tickets = []) {
            const ticketMap = new Map((Array.isArray(tickets) ? tickets : []).map((ticket) => [String(ticket.num), ticket]));
            const winnerCandidates = [];
            const winnerIds = Array.isArray(drawState?.winnerIds) ? drawState.winnerIds : [];
            const winners = Array.isArray(drawState?.winners) ? drawState.winners : [];

            winners.forEach((winner, index) => {
                const fallbackTicket = String(winner?.ticket || winner?.ticketNum || winner?.num || winnerIds[index] || '').trim();
                const ticketInfo = fallbackTicket ? ticketMap.get(fallbackTicket) : null;
                const normalized = normalizeRaffleWinnerRecord(winner, {
                    ticket: fallbackTicket,
                    winnerName: ticketInfo?.name || '',
                    userId: ticketInfo?.userId || null,
                    drawId: Number(drawState?.startTime || drawState?.createdAt || 0) || 0,
                    createdAt: Number(drawState?.completedAt || drawState?.createdAt || 0) || 0,
                    source: 'raffle_state_sync'
                });
                if (normalized) winnerCandidates.push(normalized);
            });

            winnerIds.forEach((ticketNum) => {
                const ticket = String(ticketNum || '').trim();
                if (!ticket) return;
                const ticketInfo = ticketMap.get(ticket);
                const normalized = normalizeRaffleWinnerRecord({
                    ticket,
                    winnerName: ticketInfo?.name || '',
                    userId: ticketInfo?.userId || null,
                    drawId: Number(drawState?.startTime || drawState?.createdAt || 0) || 0,
                    createdAt: Number(drawState?.completedAt || drawState?.createdAt || 0) || 0,
                    source: 'raffle_state_sync'
                });
                if (normalized) winnerCandidates.push(normalized);
            });

            if (drawState?.winnerId) {
                const ticket = String(drawState.winnerId || '').trim();
                const ticketInfo = ticketMap.get(ticket);
                const normalized = normalizeRaffleWinnerRecord({
                    ticket,
                    winnerName: drawState?.winnerName || ticketInfo?.name || '',
                    userId: ticketInfo?.userId || null,
                    drawId: Number(drawState?.startTime || drawState?.createdAt || 0) || 0,
                    createdAt: Number(drawState?.completedAt || drawState?.createdAt || 0) || 0,
                    source: 'raffle_state_sync'
                });
                if (normalized) winnerCandidates.push(normalized);
            }

            const seen = new Set();
            return winnerCandidates.filter((winner) => {
                const dedupeKey = `${winner.ticket}::${winner.userId || ''}`;
                if (!winner.ticket || seen.has(dedupeKey)) return false;
                seen.add(dedupeKey);
                return true;
            });
        }

        function getWinnerRecordsFromHistoryEntry(entry) {
            if (!entry || typeof entry !== 'object') return [];
            const fallback = {
                createdAt: Number(entry.createdAt || 0) || 0,
                drawId: Number(entry.drawId || 0) || 0,
                source: String(entry.source || 'raffle_state_sync')
            };
            if (Array.isArray(entry.winners) && entry.winners.length) {
                return entry.winners
                    .map((winner) => normalizeRaffleWinnerRecord(winner, fallback))
                    .filter(Boolean);
            }
            const legacyWinner = normalizeRaffleWinnerRecord(entry, fallback);
            return legacyWinner ? [legacyWinner] : [];
        }

        async function getWinnerUserIdsForCurrentRaffleCycle() {
            const historySnap = await db.ref('winners_history').once('value');
            const winnerIds = new Set();
            historySnap.forEach((item) => {
                const row = item.val() || {};
                if (Array.isArray(row.winners)) {
                    row.winners.forEach((winner) => {
                        const userId = String(winner?.userId || '').trim();
                        if (userId) winnerIds.add(userId);
                    });
                    return;
                }
                const userId = String(row.userId || '').trim();
                if (userId) winnerIds.add(userId);
            });
            return winnerIds;
        }

        async function collectPostWinTicketExclusionUpdates({ winnerUserId, winnerTicketNum, drawId }) {
            const uid = String(winnerUserId || '').trim();
            const winnerNum = String(winnerTicketNum || '').trim();
            if (!uid || !winnerNum) return {};

            const [boardSnap, archiveSnap, ticketsSnap] = await Promise.all([
                db.ref('board').once('value'),
                db.ref('tickets_archive').once('value'),
                db.ref('tickets').once('value')
            ]);

            const updates = {};
            const stamp = Date.now();
            const reason = 'excluded_after_owner_win';

            boardSnap.forEach((item) => {
                const row = item.val() || {};
                const ticketNum = String(row.ticketNum || row.num || row.ticket || item.key || '').trim();
                if (!/^\d+$/.test(ticketNum)) return;
                if (ticketNum === winnerNum) return;
                if (String(row.userId || '') !== uid) return;
                if (row.excluded) return;
                updates[`board/${item.key}/excluded`] = true;
                updates[`board/${item.key}/raffleExcludedAfterOwnerWin`] = true;
                updates[`board/${item.key}/raffleExclusionReason`] = reason;
                updates[`board/${item.key}/raffleExcludedAtDrawId`] = Number(drawId) || 0;
                updates[`board/${item.key}/raffleExcludedAt`] = stamp;
            });

            archiveSnap.forEach((item) => {
                const row = item.val() || {};
                const ticketNum = String(row.ticketNum || row.num || row.ticket || item.key || '').trim();
                if (!/^\d+$/.test(ticketNum)) return;
                if (ticketNum === winnerNum) return;
                if (String(row.userId || '') !== uid) return;
                if (row.excluded) return;
                updates[`tickets_archive/${item.key}/excluded`] = true;
                updates[`tickets_archive/${item.key}/raffleExcludedAfterOwnerWin`] = true;
                updates[`tickets_archive/${item.key}/raffleExclusionReason`] = reason;
                updates[`tickets_archive/${item.key}/raffleExcludedAtDrawId`] = Number(drawId) || 0;
                updates[`tickets_archive/${item.key}/raffleExcludedAt`] = stamp;
            });

            ticketsSnap.forEach((item) => {
                const row = item.val() || {};
                const ticketNum = String(row.ticketNum || row.num || item.key || '').trim();
                if (!/^\d+$/.test(ticketNum)) return;
                if (ticketNum === winnerNum) return;
                if (String(row.userId || '') !== uid) return;
                if (row.excluded) return;
                updates[`tickets/${item.key}/excluded`] = true;
                updates[`tickets/${item.key}/raffleExcludedAfterOwnerWin`] = true;
                updates[`tickets/${item.key}/raffleExclusionReason`] = reason;
                updates[`tickets/${item.key}/raffleExcludedAtDrawId`] = Number(drawId) || 0;
                updates[`tickets/${item.key}/raffleExcludedAt`] = stamp;
            });

            return updates;
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

        function clearMagicStateTimers(state) {
            if (!state?.timeouts?.length) return;
            state.timeouts.forEach((timerId) => clearTimeout(timerId));
            state.timeouts = [];
        }

        function queueMagicStateTimeout(state, cb, delayMs) {
            if (!state) return 0;
            const timerId = setTimeout(() => {
                state.timeouts = (state.timeouts || []).filter((id) => id !== timerId);
                cb();
            }, delayMs);
            state.timeouts = state.timeouts || [];
            state.timeouts.push(timerId);
            return timerId;
        }

        function createMagicStageLayer(className) {
            const layer = document.createElement('div');
            layer.className = className;
            return layer;
        }

        function stopMagicStarField() {
            if (magicStarFieldState?.rafId) cancelAnimationFrame(magicStarFieldState.rafId);
            clearMagicStateTimers(magicStarFieldState);
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

        function buildStarNodesFromTickets(stage, tickets, targetLayer = stage) {
            const width = stage.clientWidth || 620;
            const height = stage.clientHeight || 420;
            const fragment = document.createDocumentFragment();
            const nodes = tickets.map(ticket => {
                const el = document.createElement('span');
                const len = String(ticket.num).length;
                el.className = `magic-ticket-star size-${Math.min(len, 3)}`;
                const mark = document.createElement('span');
                mark.className = 'ticket-mark';
                mark.textContent = String(ticket.num);
                el.appendChild(mark);
                el.style.setProperty('--so', (0.68 + Math.random() * 0.28).toFixed(2));
                el.style.setProperty('--tw', `${5.5 + Math.random() * 5.5}s`);
                fragment.appendChild(el);
                return {
                    el,
                    x: Math.random() * width,
                    y: Math.random() * height,
                    vx: (Math.random() - 0.5) * 0.2,
                    vy: (Math.random() - 0.5) * 0.18
                };
            });
            targetLayer.appendChild(fragment);
            return nodes;
        }

        function buildMagicCards(tickets, winnerTicket, targetLayer) {
            const fragment = document.createDocumentFragment();
            const cards = tickets.map(ticket => {
                const card = createMagicCardMarkup(ticket, String(ticket.num) === String(winnerTicket));
                card.dataset.baseRadius = String(50 + Math.random() * 70);
                fragment.appendChild(card);
                return card;
            });
            targetLayer.appendChild(fragment);
            return cards;
        }

        function renderMagicEmptyState(stage, message) {
            stage.innerHTML = '';
            const empty = document.createElement('div');
            empty.className = 'magic-empty-state';
            empty.textContent = message;
            stage.appendChild(empty);
        }

        function activateMagicCardLayer(state) {
            if (!state || state.cardsActivated) return;
            state.cardsActivated = true;
            if (state.starLayer) state.starLayer.classList.add('is-hidden');
            if (state.cardLayer) state.cardLayer.classList.add('is-active');
        }

        function buildMagicDrawScene(stage, tickets, winnerTicket) {
            stage.innerHTML = '';
            const starLayer = createMagicStageLayer('magic-stage-layer magic-star-layer');
            const cardLayer = createMagicStageLayer('magic-stage-layer magic-card-layer');
            stage.appendChild(starLayer);
            stage.appendChild(cardLayer);
            return {
                starLayer,
                cardLayer,
                stars: buildStarNodesFromTickets(stage, tickets, starLayer),
                cards: buildMagicCards(tickets, winnerTicket, cardLayer)
            };
        }

        function buildIdleMagicScene(stage, tickets) {
            stage.innerHTML = '';
            const starLayer = createMagicStageLayer('magic-stage-layer magic-star-layer is-idle');
            stage.appendChild(starLayer);
            return buildStarNodesFromTickets(stage, tickets, starLayer);
        }

        async function renderIdleMagicSky() {
            const stage = document.getElementById('magic-cards-stage');
            if (!stage) return;
            const tickets = await getTicketsFromFirebaseDrawPool();
            if (!tickets.length) {
                renderMagicEmptyState(stage, 'Нет активных билетов для звёздного неба');
                return;
            }
            const stars = buildIdleMagicScene(stage, tickets);
            animateDriftingStars(stars, stage);
        }

        function stopMagicAnimationFrame() {
            if (magicDrawAnimationState?.rafId) cancelAnimationFrame(magicDrawAnimationState.rafId);
            clearMagicStateTimers(magicDrawAnimationState);
            magicDrawAnimationState = null;
        }

        function runSyncedRaffleAnimation(drawPayload) {
            const stage = document.getElementById('magic-cards-stage');
            const banner = document.getElementById('magic-winner-banner');
            if (!stage || !banner) return;
            const drawId = Number(drawPayload?.startTime || drawPayload?.createdAt || 0);
            if (!drawId || activeMagicDrawId === drawId) return;
            const raffleWinners = getRaffleWinnersFromState(drawPayload);
            const winnerTicket = String(raffleWinners[0]?.ticket || drawPayload?.winnerId || '');
            if (!winnerTicket) return;
            activeMagicDrawId = drawId;
            banner.classList.remove('show');

            getTicketsFromFirebaseDrawPool().then((tickets) => {
                if (!tickets.length) {
                    renderMagicEmptyState(stage, 'Нет билетов в Firebase /tickets');
                    return;
                }

                const winner = tickets.find(t => String(t.num) === winnerTicket) || tickets[0];
                stopMagicStarField();
                stopMagicAnimationFrame();

                const scene = buildMagicDrawScene(stage, tickets, winner.num);
                const startServerMs = Number(drawPayload.startTime || 0);
                const totalMs = 60000;
                const gatherMs = 2000;
                const nowServer = getServerNowMs();
                const elapsed = Math.max(0, nowServer - startServerMs);

                const state = {
                    rafId: 0,
                    stars: scene.stars,
                    startServerMs,
                    totalMs,
                    gatherMs,
                    winner,
                    winnerShown: false,
                    cards: scene.cards,
                    starLayer: scene.starLayer,
                    cardLayer: scene.cardLayer,
                    cardsActivated: false,
                    timeouts: []
                };
                magicDrawAnimationState = state;

                const revealWinner = () => {
                    if (state.winnerShown) return;
                    state.winnerShown = true;
                    activateMagicCardLayer(state);
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
                        queueMagicStateTimeout(state, () => {
                            if (magicDrawAnimationState === state) winnerCard.classList.add('is-revealed');
                        }, 500);
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
                        activateMagicCardLayer(state);
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
                        activateMagicCardLayer(state);
                        revealWinner();
                        return;
                    }

                    state.rafId = requestAnimationFrame(tick);
                };

                if (elapsed >= totalMs) {
                    activateMagicCardLayer(state);
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
            const [tickets, winnerIds] = await Promise.all([
                getTicketsFromFirebaseDrawPool(),
                getWinnerUserIdsForCurrentRaffleCycle()
            ]);
            const availableTickets = tickets.filter(ticket => !winnerIds.has(String(ticket.userId || '').trim()));
            const drawPool = availableTickets.length ? availableTickets : tickets;
            if (!availableTickets.length && tickets.length) {
                alert('Все владельцы активных билетов уже выигрывали в текущем розыгрыше.');
                return;
            }
            if (!drawPool.length) {
                alert('В папке /tickets Firebase нет активных билетов.');
                return;
            }
            const keys = Object.keys(drawPool.reduce((acc, ticket) => {
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


        function renderWinnerHistory() {
            const preview = document.getElementById('winner-history-preview');
            const list = document.getElementById('winner-history-list');
            if (!preview || !list) return;
            if (!winnerHistoryItems.length) {
                preview.innerText = 'Пока победителей нет.';
                list.innerHTML = '';
                return;
            }
            const latest = winnerHistoryItems[0] || {};
            const latestWinners = getWinnerRecordsFromHistoryEntry(latest);
            const latestSummary = latestWinners.length
                ? latestWinners.map((winner) => `№${winner.ticket} · ${escapeHtml(winner.winnerName)}`).join(', ')
                : 'Победители не найдены';
            preview.innerHTML = `${new Date(latest.createdAt || 0).toLocaleString('ru-RU')} · ${latestSummary}`;
            list.innerHTML = winnerHistoryItems.map((item, idx) => {
                const winners = getWinnerRecordsFromHistoryEntry(item);
                const winnersMarkup = winners.length
                    ? `<div>${winners.map((winner) => `🎟 ${escapeHtml(winner.ticket)} · 👑 ${escapeHtml(winner.winnerName)}`).join('<br>')}</div>`
                    : '<div>Победители не найдены</div>';
                return `<div class="news-item">${idx + 1}. ${new Date(item.createdAt || 0).toLocaleString('ru-RU')} · розыгрыш #${escapeHtml(String(item.drawId || idx + 1))}<br>${winnersMarkup}</div>`;
            }).join('');
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
                winnerHistoryItems = items
                    .filter((item) => getWinnerRecordsFromHistoryEntry(item).length)
                    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
                renderWinnerHistory();
            });

            if (drawScheduleRef) drawScheduleRef.off();
            drawScheduleRef = db.ref('raffle_state');
            drawScheduleRef.on('value', async (snap) => {
                currentDrawSchedule = snap.val() || { status: 'ready' };
                updateAdminDrawStatus();

                const scheduledWinners = getRaffleWinnersFromState(currentDrawSchedule);
                if (currentDrawSchedule.status === 'started' && currentDrawSchedule.startTime && scheduledWinners.length) {
                    runSyncedRaffleAnimation(currentDrawSchedule);
                    const finishAt = Number(currentDrawSchedule.startTime) + 60000;
                    if (getServerNowMs() >= finishAt && !currentDrawSchedule.completedAt) {
                        const tx = await db.ref('raffle_state').transaction(v => {
                            const txWinners = getRaffleWinnersFromState(v || {});
                            if (!v || v.status !== 'started' || v.completedAt || !txWinners.length) return v;
                            return { ...v, status: 'completed', completedAt: firebase.database.ServerValue.TIMESTAMP };
                        });
                        if (tx.committed) {
                            const finalState = tx.snapshot.val() || {};
                            const tickets = await getTicketsFromFirebaseDrawPool();
                            const doneAt = Number(finalState.completedAt) || Date.now();
                            const drawId = Number(finalState.startTime) || doneAt;
                            const winners = getRaffleWinnersFromState(finalState, tickets).map((winner) => ({
                                ...winner,
                                createdAt: doneAt,
                                drawId,
                                source: 'raffle_state_sync'
                            }));
                            if (!winners.length) return;

                            const primaryWinner = winners[0];
                            const postWinUpdatesList = await Promise.all(winners
                                .filter((winner) => winner.userId && winner.ticket)
                                .map((winner) => collectPostWinTicketExclusionUpdates({
                                    winnerUserId: winner.userId,
                                    winnerTicketNum: String(winner.ticket),
                                    drawId
                                })));
                            const mergedPostWinUpdates = postWinUpdatesList.reduce((acc, item) => Object.assign(acc, item || {}), {});
                            const updates = {
                                current_winner: { ticket: String(primaryWinner.ticket), winnerName: primaryWinner.winnerName, userId: primaryWinner.userId || null, createdAt: doneAt, source: 'raffle_state_sync', drawId },
                                last_winner: { ticket: String(primaryWinner.ticket), winnerName: primaryWinner.winnerName, userId: primaryWinner.userId || null, createdAt: doneAt, source: 'raffle_state_sync', drawId },
                                ...mergedPostWinUpdates
                            };

                            const seenWinnerEntries = new Set();
                            winners.forEach((winner) => {
                                const dedupeKey = `${drawId}::${winner.ticket}::${winner.userId || ''}`;
                                if (seenWinnerEntries.has(dedupeKey)) return;
                                seenWinnerEntries.add(dedupeKey);
                                const winnerHistoryKey = db.ref('winners_history').push().key;
                                updates[`winners_history/${winnerHistoryKey}`] = {
                                    ticket: String(winner.ticket),
                                    winnerName: winner.winnerName,
                                    userId: winner.userId || null,
                                    createdAt: doneAt,
                                    drawId,
                                    source: 'raffle_state_sync'
                                };
                            });

                            const wheelHistoryKey = db.ref('wheel_history').push().key;
                            updates[`wheel_history/${wheelHistoryKey}`] = {
                                drawId,
                                winners: winners.map((winner) => ({
                                    ticket: String(winner.ticket),
                                    winnerName: winner.winnerName,
                                    userId: winner.userId || null,
                                    createdAt: doneAt,
                                    drawId,
                                    source: 'raffle_state_sync'
                                })),
                                createdAt: doneAt,
                                source: 'raffle_state_sync'
                            };
                            await db.ref().update(updates);
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
                used_tasks_global: {},
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
            updates[`whitelist/${userId}/${USER_GLOBAL_USED_TASKS_PATH_SUFFIX}`] = {};
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
        const adminResetLocks = {
            session: false,
            season: false
        };

        function setAdminActionButtonState(buttonId, isRunning, runningLabel) {
            const btn = document.getElementById(buttonId);
            if (!btn) return;
            if (!btn.dataset.defaultLabel) {
                btn.dataset.defaultLabel = btn.innerHTML;
            }
            btn.disabled = !!isRunning;
            btn.style.opacity = isRunning ? '0.7' : '1';
            btn.style.pointerEvents = isRunning ? 'none' : '';
            btn.innerHTML = isRunning ? String(runningLabel || '⏳ Выполняется...') : btn.dataset.defaultLabel;
        }

        function showAdminConfirmModal(title, message, confirmLabel = 'Подтвердить', cancelLabel = 'Отмена') {
            const titleEl = document.getElementById('mTitle');
            const textEl = document.getElementById('mText');
            const modalEl = document.getElementById('modal');
            const overlayEl = document.getElementById('overlay');
            if (!titleEl || !textEl || !modalEl || !overlayEl) {
                return Promise.resolve(confirm(message));
            }

            return new Promise((resolve) => {
                let settled = false;
                const finish = (result) => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    closeModal();
                    resolve(result);
                };
                const onOverlayClick = (event) => {
                    if (event.target === overlayEl) finish(false);
                };
                const cleanup = () => {
                    overlayEl.removeEventListener('click', onOverlayClick);
                    document.getElementById('admin-confirm-cancel-btn')?.removeEventListener('click', cancelHandler);
                    document.getElementById('admin-confirm-submit-btn')?.removeEventListener('click', submitHandler);
                };
                const cancelHandler = () => finish(false);
                const submitHandler = () => finish(true);

                titleEl.textContent = title;
                textEl.innerHTML = `
                    <div style="font-size:13px; color:#4a148c; text-align:left; line-height:1.5;">${escapeHtml(message)}</div>
                    <div style="display:flex; gap:8px; margin-top:12px;">
                        <button id="admin-confirm-cancel-btn" class="admin-btn" style="margin:0; flex:1; background:#9e9e9e;">${escapeHtml(cancelLabel)}</button>
                        <button id="admin-confirm-submit-btn" class="admin-btn" style="margin:0; flex:1;">${escapeHtml(confirmLabel)}</button>
                    </div>`;
                modalEl.style.display = 'block';
                overlayEl.style.display = 'block';
                overlayEl.addEventListener('click', onOverlayClick);
                document.getElementById('admin-confirm-cancel-btn')?.addEventListener('click', cancelHandler, { once: true });
                document.getElementById('admin-confirm-submit-btn')?.addEventListener('click', submitHandler, { once: true });
            });
        }

        function cloneResetState(value) {
            if (value === null || typeof value === 'undefined') return {};
            return JSON.parse(JSON.stringify(value));
        }

        function buildSessionResetMeta() {
            return {
                now: Date.now(),
                adminId: String(currentUserId || ''),
                logKey: db.ref('news_feed').push().key,
                mode: 'destructive'
            };
        }

        function buildSessionResetLogEntry(meta, message) {
            return {
                text: String(message || 'Администратор выполнил сброс текущей сессии'),
                createdAt: Number(meta?.now || Date.now()),
                type: meta?.mode === 'safe' ? 'admin_session_reset_safe' : 'admin_session_reset',
                adminId: String(meta?.adminId || '')
            };
        }

        function buildInactiveCollection(source, mapper) {
            if (!source || typeof source !== 'object') return null;
            const next = {};
            Object.entries(source).forEach(([key, value]) => {
                next[key] = mapper(value || {}, key);
            });
            return Object.keys(next).length ? next : null;
        }

        function applySessionResetState(currentRoot, meta) {
            const root = cloneResetState(currentRoot);
            const now = Number(meta?.now || Date.now());
            const adminId = String(meta?.adminId || '');
            const safeMode = String(meta?.mode || 'destructive') === 'safe';

            const clearNode = (key, safeValueFactory = null) => {
                if (!safeMode || typeof safeValueFactory !== 'function') {
                    root[key] = null;
                    return;
                }
                root[key] = safeValueFactory(root[key]);
            };

            const currentRoundNumber = Number(root?.current_round?.number || 0);

            // Step 1: dependent entities.
            clearNode('submissions');
            clearNode('works');
            clearNode('snake_encounters', (value) => buildInactiveCollection(value, (row) => ({
                ...row,
                status: 'reset',
                active: false,
                canStartClash: false,
                resetAt: now,
                resetBy: adminId
            })));
            clearNode('snake_clashes', (value) => buildInactiveCollection(value, (roundMap) => buildInactiveCollection(roundMap, (cellMap) => buildInactiveCollection(cellMap, (row) => ({
                ...row,
                status: 'reset',
                active: false,
                resetAt: now,
                resetBy: adminId
            })))));
            clearNode('snake_synergy', (value) => buildInactiveCollection(value, (roundMap) => buildInactiveCollection(roundMap, (cellMap) => buildInactiveCollection(cellMap, (row) => ({
                ...row,
                status: 'reset',
                active: false,
                resetAt: now,
                resetBy: adminId
            })))));
            clearNode('snake_duel_history');
            clearNode('calligraphy_duels', (value) => buildInactiveCollection(value, (row) => ({
                ...row,
                status: 'reset',
                active: false,
                resetAt: now,
                resetBy: adminId
            })));
            clearNode('system_notifications');

            // Step 2: assignments.
            clearNode('rounds', (value) => buildInactiveCollection(value, (roundRow) => ({
                ...roundRow,
                snake: {
                    ...(roundRow?.snake || {}),
                    assignments: null,
                    occupancy: null,
                    moves: null,
                    active: false,
                    resetAt: now,
                    resetBy: adminId
                }
            })));

            // Step 3: tickets.
            clearNode('tickets');
            clearNode('tickets_archive', (value) => buildInactiveCollection(value, (row) => ({
                ...row,
                active: false,
                excluded: true,
                owner: null,
                userId: null,
                resetAt: now,
                resetBy: adminId
            })));
            clearNode('revoked_tickets');
            root.ticket_counter = 0;

            // Step 4: snake state.
            clearNode('snake_presence');
            clearNode('snake_traps');
            clearNode('snake_smuggler');
            clearNode('snake_arcane_sessions');
            clearNode('snake_robbery_cell_guard');
            clearNode('magic_links');

            // Step 5: raffle state.
            clearNode('wheel_event');
            clearNode('wheel_draw');
            root.raffle_state = {
                status: 'ready',
                participants: null,
                currentDraw: null,
                resetAt: now,
                resetBy: adminId
            };
            clearNode('wheel_history');
            clearNode('current_winner');
            clearNode('last_winner');
            clearNode('winners_history');

            // Step 6: events.
            clearNode('game_event');
            clearNode('game_events', (value) => buildInactiveCollection(value, (row) => ({
                ...row,
                status: 'reset',
                active: false,
                teams: null,
                resetAt: now,
                resetBy: adminId
            })));
            clearNode('current_event');
            clearNode('mushu_event', (value) => ({
                ...(value || {}),
                status: 'reset',
                active: false,
                fed_users: null,
                rewarded_users: null,
                resetAt: now,
                resetBy: adminId
            }));
            clearNode('epic_paint', (value) => ({
                ...(value || {}),
                strokes: null,
                participants: null,
                participants_by_event: null,
                rewarded: null,
                active: false,
                resetAt: now,
                resetBy: adminId
            }));
            clearNode('event_schedule');
            clearNode('round_schedules', (value) => buildInactiveCollection(value, (row) => ({
                ...row,
                status: 'cancelled',
                active: false,
                scheduledFor: null,
                resetAt: now,
                resetBy: adminId
            })));

            // Step 7: players.
            clearNode('board');
            clearNode('players');
            clearNode('whitelist', (value) => buildInactiveCollection(value, (row) => ({
                ...row,
                isActive: false,
                active: false,
                charIndex: null,
                snakeState: null,
                inventory: null,
                used_tasks: null,
                magnifier_used_round: null,
                ink_challenge: null,
                debt: null,
                removedFromSessionAt: now,
                removedFromSessionBy: adminId
            })));
            clearNode('users', (value) => buildInactiveCollection(value, (row) => ({
                ...row,
                isActive: false,
                active: false,
                charIndex: null,
                tickets: null,
                removedFromSessionAt: now,
                removedFromSessionBy: adminId
            })));

            // Step 8: round.
            root.current_round = null;

            const logKey = String(meta?.logKey || '').trim();
            if (logKey) {
                root.news_feed = root.news_feed && typeof root.news_feed === 'object' ? root.news_feed : {};
                root.news_feed[logKey] = buildSessionResetLogEntry(meta, safeMode
                    ? `Администратор выполнил безопасный сброс текущей сессии${currentRoundNumber > 0 ? ` (раунд ${currentRoundNumber})` : ''}`
                    : `Администратор выполнил сброс текущей сессии${currentRoundNumber > 0 ? ` (раунд ${currentRoundNumber})` : ''}`);
            }

            return root;
        }

        async function executeSessionResetTransaction(meta) {
            const tx = await db.ref().transaction((currentRoot) => applySessionResetState(currentRoot, meta), undefined, false);
            if (!tx?.committed) {
                throw new Error(`Session reset transaction was not committed (mode: ${meta?.mode || 'destructive'})`);
            }
            return tx.snapshot?.val() || null;
        }

        async function performSessionReset() {
            const destructiveMeta = buildSessionResetMeta();
            try {
                await executeSessionResetTransaction(destructiveMeta);
                return { mode: destructiveMeta.mode };
            } catch (primaryError) {
                console.error('[admin reset][session] destructive transaction failed', primaryError);
                const safeMeta = {
                    ...buildSessionResetMeta(),
                    now: Date.now(),
                    mode: 'safe'
                };
                try {
                    await executeSessionResetTransaction(safeMeta);
                    console.warn('[admin reset][session] fallback safe reset committed');
                    return { mode: safeMeta.mode, fallbackFrom: primaryError };
                } catch (safeError) {
                    console.error('[admin reset][session] safe transaction failed', safeError);
                    throw safeError;
                }
            }
        }

        function buildSeasonResetUpdates({ seasonProfiles = {}, now = Date.now() } = {}) {
            const updates = {
                gallery_compliments: null,
                player_activity_log: null
            };

            Object.keys(seasonProfiles || {}).forEach((uid) => {
                updates[`player_season_status/${uid}`] = null;
            });

            const logKey = db.ref('news_feed').push().key;
            updates[`news_feed/${logKey}`] = {
                text: 'Администратор сбросил данные сезона',
                createdAt: now,
                type: 'admin_season_reset',
                adminId: String(currentUserId || '')
            };
            return updates;
        }

        async function runAdminResetOperation({
            lockKey,
            buttonId,
            runningLabel,
            title,
            message,
            successMessage,
            buildUpdates,
            executeReset
        }) {
            if (!isAdminUser()) {
                alert('Эта функция доступна только администратору.');
                return false;
            }
            if (adminResetLocks[lockKey]) return false;

            adminResetLocks[lockKey] = true;
            const confirmed = await showAdminConfirmModal(title, message, 'Подтвердить', 'Отмена');
            if (!confirmed) {
                adminResetLocks[lockKey] = false;
                return false;
            }
            setAdminActionButtonState(buttonId, true, runningLabel);

            try {
                if (typeof executeReset === 'function') {
                    await executeReset();
                } else {
                    const whitelistSnap = await db.ref('whitelist').once('value');
                    const usersSnap = await db.ref('users').once('value');
                    const seasonSnap = await db.ref('player_season_status').once('value');
                    const now = Date.now();
                    const updates = buildUpdates({
                        whitelist: whitelistSnap.val() || {},
                        users: usersSnap.val() || {},
                        seasonProfiles: seasonSnap.val() || {},
                        now
                    });
                    await db.ref().update(updates);
                }

                console.info(successMessage);
                alert(successMessage);
                return true;
            } catch (err) {
                console.error('Admin reset failed', { lockKey, err, stack: err?.stack || null });
                alert('Ошибка сброса. Проверьте логи администратора');
                return false;
            } finally {
                adminResetLocks[lockKey] = false;
                setAdminActionButtonState(buttonId, false);
            }
        }

        async function adminResetGame() {
            const done = await runAdminResetOperation({
                lockKey: 'session',
                buttonId: 'admin-reset-session-btn',
                runningLabel: '⏳ Сброс сессии...',
                title: 'Сброс текущей сессии',
                message: 'Вы уверены, что хотите полностью сбросить текущую сессию? Будут удалены текущий раунд, задания, билеты, события и все игроки. Чтобы вернуться в игру, игроков нужно будет добавить заново по Telegram ID.',
                successMessage: 'Сессия успешно сброшена',
                executeReset: performSessionReset
            });
            if (done) location.reload();
        }
        async function adminFullReset() {
            await runAdminResetOperation({
                lockKey: 'season',
                buttonId: 'admin-reset-season-btn',
                runningLabel: '⏳ Сброс сезона...',
                title: 'Сброс данных сезона',
                message: 'Вы уверены, что хотите сбросить данные сезона? Это действие необратимо.',
                successMessage: 'Данные сезона сброшены: карма, сезонный прогресс и сезонная история очищены.',
                buildUpdates: buildSeasonResetUpdates
            });
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

            if (id !== 'tab-gallery' && typeof stopGalleryRealtime === 'function') stopGalleryRealtime();

            if (id === 'tab-wheel') drawWheel();
            if (id === 'tab-works') {
                fillSubmissionTaskOptions();
                renderSubmissions();
            }
            if (id === 'tab-gallery' && typeof renderGalleryTab === 'function') renderGalleryTab();
        }
        function closeModal() {
            document.getElementById('modal').style.display='none';
            document.getElementById('overlay').style.display='none';
            setSnakeCriticalUiLock('');
            const done = snakeUiActiveDone;
            snakeUiActiveDone = null;
            if (typeof done === 'function') done();
        }
        function openRulesScroll() {
            const btn = document.querySelector('.nav-item[onclick*="tab-rules"]');
            switchTab('tab-rules', btn);
        }

        let activeRulesSection = null;
        function setRulesSectionState(sectionName) {
            const sections = ['cells', 'snake'];
            const normalized = sections.includes(sectionName) ? sectionName : null;
            activeRulesSection = normalized;
            sections.forEach((name) => {
                const btn = document.getElementById(`rules-section-${name}-btn`);
                const panel = document.getElementById(`rules-section-${name}`);
                const isActive = normalized === name;
                if (!btn || !panel) return;
                btn.classList.toggle('active', isActive);
                btn.setAttribute('aria-expanded', String(isActive));
                panel.classList.toggle('active', isActive);
                panel.hidden = !isActive;
            });
        }

        function toggleRulesSection(sectionName) {
            const nextSection = activeRulesSection === sectionName ? null : sectionName;
            setRulesSectionState(nextSection);
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
            const canPlay = canUseGameplayFeatures();
            if (uploadCard) uploadCard.style.display = canPlay ? 'block' : 'none';
            if (adminFilters) adminFilters.style.display = isAdmin ? 'block' : 'none';
            if (title) {
                title.innerText = isAdmin
                    ? (canPlay ? '🖼️ Работы и сдача' : '🖼️ Работы игроков')
                    : '📤 Сдача работ';
            }
            if (!isAdmin) {
                worksAdminSelectedUserId = '';
                worksAdminView = 'pending';
            }
            if (isAdmin) {
                syncWorksAdminPlayers();
                syncWorksAdminFiltersUi();
            }
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
                syncWorksAdminFiltersUi();
                renderSubmissions();
            });
        }

        function syncWorksAdminFiltersUi() {
            const pendingBtn = document.getElementById('works-admin-tab-pending');
            const playerBtn = document.getElementById('works-admin-tab-player');
            const playerFilter = document.getElementById('works-admin-player-filter');
            const isPendingView = worksAdminView !== 'by_player';
            if (pendingBtn) pendingBtn.classList.toggle('active', isPendingView);
            if (playerBtn) playerBtn.classList.toggle('active', !isPendingView);
            if (playerFilter) playerFilter.style.display = isPendingView ? 'none' : 'block';
        }

        function setWorksAdminView(rawView) {
            worksAdminView = rawView === 'by_player' ? 'by_player' : 'pending';
            syncWorksAdminFiltersUi();
            renderSubmissions();
        }

        function setWorksAdminPlayer(rawUserId) {
            worksAdminSelectedUserId = String(rawUserId || '').trim();
            renderSubmissions();
        }

        function checkAccess() {
            const isAdmin = isAdminUser();
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
                const currentIsAdmin = isAdminUser();
                if (s.exists()) {
                    myIndex = s.val().charIndex;
                    const playerName = players[myIndex]?.n || 'Игрок';
                    const playerColor = charColors[myIndex] || '#6a1b9a';
                    document.getElementById('player-identity').innerHTML = currentIsAdmin
                        ? `Ты: <b>Администратор + игрок</b><br><span style="color:${playerColor}">${escapeHtml(playerName)}</span><br><small style="color:#666;">Telegram ID: ${currentUserId}</small>`
                        : `Ты: <span style="color:${playerColor}">${escapeHtml(playerName)}</span><br><small style="color:#666;">Telegram ID: ${currentUserId}</small>`;
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
                currentFieldMode = resolveRoundFieldMode(currentRoundData);
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
                if (String(v.type || '') === 'snake_clash_start' && v.clashId) {
                    tryOpenSnakeClashFromId(v.clashId).catch((err) => {
                        console.error('failed to open snake clash by notification', err);
                    });
                }
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
                autoApproveStaleSubmissions().catch((err) => console.error('autoApproveStaleSubmissions failed', err));
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
            if (typeof cell.taskLabel === 'string' && cell.taskLabel.trim()) return cell.taskLabel.trim();
            const t = tasks[cell.taskIdx];
            return t?.text || 'Обычное задание';
        }

        function getTaskLabelByTaskIdx(taskIdx) {
            const normalizedTaskIdx = Number(taskIdx);
            if (!Number.isInteger(normalizedTaskIdx) || normalizedTaskIdx < 0) return 'Обычное задание';
            return String(tasks?.[normalizedTaskIdx]?.text || 'Обычное задание');
        }

        function syncBoardCellIntoLocalCaches(cellIdx, cellData) {
            const normalizedCellIdx = Number(cellIdx);
            if (!Number.isInteger(normalizedCellIdx) || normalizedCellIdx < 0 || !cellData) return;
            const normalizedRow = {
                ...cellData,
                cell: normalizedCellIdx + 1,
                cellIdx: normalizedCellIdx,
                isArchived: false
            };
            liveBoardTicketsData = (Array.isArray(liveBoardTicketsData) ? liveBoardTicketsData : [])
                .filter((row) => Number(row?.cellIdx) !== normalizedCellIdx)
                .concat(normalizedRow);
            allTicketsData = (Array.isArray(allTicketsData) ? allTicketsData : [])
                .filter((row) => row?.isArchived || Number(row?.cellIdx) !== normalizedCellIdx)
                .concat(normalizedRow);
        }

        async function appendPlayerAssignmentLog({
            userId,
            cellIdx,
            round,
            itemKey,
            oldTaskIdx,
            oldTaskLabel,
            newTaskIdx,
            newTaskLabel
        }) {
            const uid = String(userId || '').trim();
            if (!uid) return;
            const now = Date.now();
            await db.ref(`player_activity_log/${uid}`).push({
                type: 'assignment_reroll',
                text: 'Игрок сменил задание с помощью предмета',
                cellIdx: Number(cellIdx),
                cell: Number(cellIdx) + 1,
                round: Number(round || 0),
                itemKey: String(itemKey || '').trim(),
                oldTaskIdx: Number(oldTaskIdx),
                oldTaskLabel: String(oldTaskLabel || '').trim(),
                newTaskIdx: Number(newTaskIdx),
                newTaskLabel: String(newTaskLabel || '').trim(),
                createdAt: now,
                updatedAt: now
            });
        }

        async function replaceBoardCellAssignment(cellIdx, nextTaskIdx, options = {}) {
            const normalizedCellIdx = Number(cellIdx);
            const normalizedTaskIdx = Number(nextTaskIdx);
            if (!Number.isInteger(normalizedCellIdx) || normalizedCellIdx < 0) throw new Error('Некорректная клетка для смены задания.');
            if (!Number.isInteger(normalizedTaskIdx) || normalizedTaskIdx < 0) throw new Error('Некорректное новое задание.');

            const cellRef = db.ref(`board/${normalizedCellIdx}`);
            const cellSnap = await cellRef.once('value');
            const currentCell = cellSnap.val() || null;
            if (!currentCell) throw new Error('Клетка для смены задания не найдена.');

            const oldTaskIdx = Number(currentCell.taskIdx);
            const oldTaskLabel = getTaskLabelByCell(currentCell);
            const newTaskLabel = getTaskLabelByTaskIdx(normalizedTaskIdx);
            const now = Date.now();

            await cellRef.update({
                taskIdx: normalizedTaskIdx,
                taskLabel: newTaskLabel,
                assignmentUpdatedAt: now,
                updatedAt: now,
                lastAssignmentChangeAt: now,
                lastAssignmentChangeSource: String(options.reason || 'item_reroll'),
                lastAssignmentChangeItemKey: String(options.itemKey || '')
            });

            const updatedCellSnap = await cellRef.once('value');
            const updatedCell = updatedCellSnap.val() || {
                ...currentCell,
                taskIdx: normalizedTaskIdx,
                taskLabel: newTaskLabel,
                assignmentUpdatedAt: now,
                updatedAt: now
            };
            syncBoardCellIntoLocalCaches(normalizedCellIdx, updatedCell);
            if (typeof window.updateTicketsTable === 'function') window.updateTicketsTable();
            fillSubmissionTaskOptions();
            renderSubmissions();

            await appendPlayerAssignmentLog({
                userId: String(updatedCell.userId || currentUserId || ''),
                cellIdx: normalizedCellIdx,
                round: Number(updatedCell.round || currentRoundNum || 0),
                itemKey: String(options.itemKey || '').trim(),
                oldTaskIdx,
                oldTaskLabel,
                newTaskIdx: normalizedTaskIdx,
                newTaskLabel
            });

            return {
                cell: updatedCell,
                oldTaskIdx,
                oldTaskLabel,
                newTaskIdx: normalizedTaskIdx,
                newTaskLabel
            };
        }

        function getSnakeTaskLabelSnapshot(row = {}, snakeAssignment = null) {
            const directLabel = String(
                row.taskLabel
                || row.snakeTaskLabel
                || row.snakeTaskLabelSnapshot
                || row.assignmentTaskLabel
                || snakeAssignment?.taskLabel
                || snakeAssignment?.taskLabelSnapshot
                || ''
            ).trim();
            if (directLabel) return directLabel;

            const candidateTaskIdx = Number(
                row.snakeTaskIdx
                ?? row.taskIdx
                ?? row.taskId
                ?? snakeAssignment?.taskIdx
                ?? snakeAssignment?.taskId
                ?? -1
            );
            if (Number.isInteger(candidateTaskIdx) && candidateTaskIdx >= 0 && Array.isArray(tasks) && tasks[candidateTaskIdx]) {
                return String(tasks[candidateTaskIdx].text || 'Обычное задание');
            }

            return '';
        }

        function getSubmissionStatusInfo(status, row = null) {
            const data = row || {};
            if (status === 'accepted') {
                if (Number(data.autoApprovedAt || 0) > 0 && data.requiresAdminReview) {
                    return { text: 'Auto (ожидает review)', className: 'status-accepted' };
                }
                return { text: 'Принято', className: 'status-accepted' };
            }
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

        async function fillSubmissionTaskOptions() {
            const select = document.getElementById('work-task-select');
            if (!select) return;

            if (isObserverOnlyAdmin()) {
                select.innerHTML = `<option value="">${getAdminGameplayBlockedLabel()}</option>`;
                select.disabled = true;
                refreshUploadStateForSelectedTask();
                return;
            }

            const myCells = allTicketsData.filter(t => {
                const sameUserId = Number(t.userId) === Number(currentUserId);
                const sameOwner = Number.isInteger(myIndex) && myIndex >= 0 && Number(t.owner) === Number(myIndex);
                if (!sameUserId && !sameOwner) return false;
                if (!Number.isInteger(t.cellIdx) || t.cellIdx < 0) return false;
                if (t.excluded) return false;
                if (typeof hasRevokedTicket === 'function' && hasRevokedTicket(t.ticket)) return false;
                return true;
            });
            const submitCells = myCells.filter((cell) => {
                if (String(cell.mode || '') !== 'snake') return true;
                const latest = getLatestSubmissionForCell(cell.round, cell.cellIdx);
                return !(latest && isAcceptedLikeStatus(latest.status));
            });

            const snakeCandidate = await getActiveSnakeSubmitCandidate().catch(() => null);
            if (snakeCandidate) {
                const alreadyListed = submitCells.some((cell) => Number(cell.cellIdx) === Number(snakeCandidate.cellIdx)
                    && Number(cell.round) === Number(snakeCandidate.round));
                if (!alreadyListed) {
                    submitCells.push(snakeCandidate);
                }
            }

            if (!submitCells.length) {
                select.innerHTML = '<option value="">Сначала открой клетку с заданием</option>';
                select.disabled = true;
                return;
            }

            updateInkDeadlineHint();
            select.disabled = false;
            select.innerHTML = submitCells.map(cell => {
                const shortTask = String(String(cell.mode || '') === 'snake'
                    ? (getSnakeTaskLabelSnapshot(cell) || cell.taskLabel || getTaskLabelByCell(cell))
                    : getTaskLabelByCell(cell)).slice(0, 90);
                const ticketLabel = String(cell.ticket || '').trim() ? `Билет ${cell.ticket}` : (String(cell.mode || '') === 'snake' ? 'Активное snake-задание' : 'Без билета');
                return `<option value="${cell.cellIdx}">Клетка №${cell.cell} · ${ticketLabel} · ${shortTask}</option>`;
            }).join('');

            refreshUploadStateForSelectedTask();
        }

        function renderSubmissions() {
            const list = document.getElementById('works-list');
            if (!list) return;
            const isAdmin = Number(currentUserId) === Number(ADMIN_ID);
            if (isAdmin) syncWorksAdminFiltersUi();

            const filtered = allSubmissions.filter(item => {
                if (isAdmin && worksAdminView === 'pending') {
                    return String(item.status || 'pending') === 'pending' || !!item.requiresAdminReview;
                }
                if (isAdmin && worksAdminView === 'by_player') {
                    return worksAdminSelectedUserId
                        ? String(item.userId || '') === worksAdminSelectedUserId
                        : false;
                }
                const sameUserId = String(item.userId || '') === String(currentUserId || '');
                const sameOwner = Number.isInteger(myIndex) && myIndex >= 0 && Number(item.owner) === Number(myIndex);
                return sameUserId || sameOwner;
            });

            const buildReviewControls = (item) => isAdmin ? `
                <div style="display:flex; gap:6px; margin-top:8px;">
                    <button onclick="setSubmissionStatus('${item.id}','${item.sourcePrefix || 'submissions'}','${item.dbPath || item.id}','accepted')" style="flex:1; border:1px solid #4CAF50; color:#2e7d32; background:#f1fff1; border-radius:8px; padding:8px;">✅ Принято</button>
                    <button onclick="setSubmissionStatus('${item.id}','${item.sourcePrefix || 'submissions'}','${item.dbPath || item.id}','rejected')" style="flex:1; border:1px solid #f44336; color:#b71c1c; background:#fff5f5; border-radius:8px; padding:8px;">❌ Не принято</button>
                </div>` : '';

            const renderSubmissionCard = (item) => {
                const status = getSubmissionStatusInfo(item.status, item);
                const playerName = getSubmissionPlayerNickname(item) || 'Без никнейма';
                const uploadedAt = Number(item.createdAt || item.updatedAt || 0);
                const uploadedAtText = uploadedAt ? new Date(uploadedAt).toLocaleString('ru-RU') : '—';
                const playerLine = isAdmin ? `<div style="font-size:12px; color:#666; margin-bottom:6px;">Игрок: <b style="color:${charColors[item.owner] || '#333'}">${playerName}</b> · TG ID: ${item.userId || '—'}</div>` : '';
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
                        <div style="font-size:12px; margin-top:4px; color:#444; line-height:1.4;">${getSnakeTaskLabelSnapshot(item) || item.taskLabel || 'Описание задания отсутствует'}</div>
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
                        ${buildReviewControls(item)}
                    </div>
                `;
            };

            if (isAdmin && worksAdminView === 'by_player' && !worksAdminSelectedUserId) {
                list.innerHTML = '<div class="works-card" style="text-align:center; color:#999;">Выберите игрока, чтобы посмотреть его работы.</div>';
                return;
            }

            if (!filtered.length) {
                if (isAdmin && worksAdminView === 'pending') {
                    list.innerHTML = '<div class="works-card" style="text-align:center; color:#999;">Нет работ, ожидающих одобрения.</div>';
                    return;
                }
                if (isAdmin && worksAdminView === 'by_player') {
                    list.innerHTML = '<div class="works-card" style="text-align:center; color:#999;">Пока нет загруженных работ для выбранного игрока.</div>';
                    return;
                }
                list.innerHTML = '<div class="works-card" style="text-align:center; color:#999;">Пока нет загруженных работ.</div>';
                return;
            }

            list.innerHTML = filtered.map(item => renderSubmissionCard(item)).join('');
        }

        async function autoApproveStaleSubmissions() {
            if (submissionsAutoApproveInFlight) return;
            const now = Date.now();
            const staleRows = (allSubmissions || []).filter((item) => {
                if (!item) return false;
                if (String(item.status || 'pending') !== 'pending') return false;
                if (Number(item.autoApprovedAt || 0) > 0) return false;
                const createdAt = Number(item.createdAt || item.updatedAt || 0);
                if (!createdAt) return false;
                return (now - createdAt) >= SUBMISSION_AUTO_APPROVE_MS;
            });
            if (!staleRows.length) return;
            submissionsAutoApproveInFlight = true;
            try {
                for (const row of staleRows) {
                    await setSubmissionStatus(row.id, row.sourcePrefix || 'submissions', row.dbPath || row.id, 'accepted', { auto: true, bypassAdmin: true, silent: true });
                }
            } catch (err) {
                console.error('[AUTO-APPROVE][ERROR]', err);
            } finally {
                submissionsAutoApproveInFlight = false;
            }
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
            if (!currentUserId || !canUseGameplayFeatures() || myIndex === -1) return;
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
                applyPendingStealResolutionsForCurrentUser().catch(() => {});
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
                const debtRound = Number(debt.dueRound || debt.round || currentRoundNum || 0);
                await postNewsOnce(
                    `whitelist/${currentUserId}/news_once/debt_failed_round_${Math.max(0, debtRound)}`,
                    `🔥 ${players[myIndex].n} не закрыл(а) долг по Плащу-невидимке — оба билета сгорели.`,
                    { type: 'debt_failed', round: Math.max(0, debtRound) }
                );
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
                await postNewsOnce(
                    `whitelist/${currentUserId}/news_once/eliminated_no_submission_round_${previousRound}`,
                    `${players[myIndex].n} выбыл(а) из игры`,
                    { type: 'eliminated_no_submission', round: previousRound }
                );
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
            if (isObserverOnlyAdmin()) return alert(getAdminGameplayBlockedLabel());
            const select = document.getElementById('work-task-select');
            const beforeInput = document.getElementById('work-image-before-input');
            const afterInput = document.getElementById('work-image-after-input');
            if (!select || select.disabled) return alert('Нет доступных заданий для сдачи.');
            const chosenCellIdx = Number(select.value);
            if (!Number.isInteger(chosenCellIdx) || chosenCellIdx < 0) return alert('Выбери задание.');
            const beforeFile = beforeInput?.files?.[0];
            const afterFile = afterInput?.files?.[0];
            if (!beforeFile || !afterFile) return alert('Нужно добавить оба фото: «До» и «После».');

            const selectedTicketRow = allTicketsData.find(t => Number(t.cellIdx) === chosenCellIdx && (Number(t.userId) === Number(currentUserId) || Number(t.owner) === Number(myIndex)));
            const snakeCandidate = await getActiveSnakeSubmitCandidate().catch(() => null);
            const selectedSnakeCandidate = snakeCandidate && Number(snakeCandidate.cellIdx) === Number(chosenCellIdx)
                ? snakeCandidate
                : null;

            let cell = selectedSnakeCandidate || selectedTicketRow || null;
            if (!cell?.virtualSnakeActive) {
                const boardCellSnap = await db.ref(`board/${chosenCellIdx}`).once('value');
                cell = boardCellSnap.val();
                if (!cell || Number(cell.userId) !== Number(currentUserId)) return alert('Можно отправлять только свою работу по своему заданию.');
            } else {
                if (Number(cell.userId) !== Number(currentUserId) || Number(cell.owner) !== Number(myIndex)) {
                    return alert('Можно отправлять только свою работу по своему заданию.');
                }

                const snakeStateSnap = await db.ref(`whitelist/${currentUserId}/snakeState`).once('value');
                const snakeState = snakeStateSnap.val() || {};
                const activeTask = snakeState.activeTask || {};
                const activeAssignmentId = String(activeTask.assignmentId || snakeState.currentAssignmentId || '').trim();
                const selectedAssignmentId = String(cell.snakeAssignmentId || '').trim();
                const selectedRound = Number(cell.round || 0);
                const activeRound = Number(activeTask.round || currentRoundNum || 0);
                if (!selectedAssignmentId || !activeAssignmentId || selectedAssignmentId !== activeAssignmentId
                    || !selectedRound || selectedRound !== activeRound) {
                    return alert('Можно отправлять только свою работу по своему заданию.');
                }

                const assignmentSnap = await db.ref(`rounds/${selectedRound}/snake/assignments/${currentUserId}/${selectedAssignmentId}`).once('value');
                const assignment = assignmentSnap.val() || null;
                if (!assignment || Number(assignment.userId) !== Number(currentUserId)
                    || Number(assignment.cell || 0) !== Number(chosenCellIdx) + 1
                    || isSnakeAssignmentClosedStatus(assignment.status)
                    || !!assignment.rewardGranted) {
                    return alert('Можно отправлять только свою работу по своему заданию.');
                }

                cell = {
                    ...cell,
                    round: Number(cell.round || currentRoundNum || 0),
                    mode: 'snake',
                    excluded: false,
                    ticket: ''
                };
            }

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

            let snakeAssignmentPart = 'main';
            let activeSnakeAssignmentId = '';
            if (String(cell.mode || '') === 'snake') {
                const snakeStateSnap = await db.ref(`whitelist/${currentUserId}/snakeState`).once('value');
                const snakeState = snakeStateSnap.val() || {};
                const activeTask = snakeState.activeTask || {};
                activeSnakeAssignmentId = String(activeTask.assignmentId || snakeState.currentAssignmentId || '').trim();
                const assignRound = Number(activeTask.round || cell.round || 0);
                if (activeSnakeAssignmentId && assignRound > 0) {
                    const assignment = (await db.ref(`rounds/${assignRound}/snake/assignments/${currentUserId}/${activeSnakeAssignmentId}`).once('value')).val() || {};
                    const hasBonus = Number.isInteger(Number(assignment.bonusTaskIdx));
                    const appr = assignment.approvals || {};
                    const pendingMain = !appr.main;
                    const pendingBonus = !!hasBonus && !appr.bonus;
                    if (pendingMain && pendingBonus) {
                        const pick = prompt(`Какую часть сдаёшь?\n1 — основное задание\n2 — бонусное задание`, '1');
                        snakeAssignmentPart = pick === '2' ? 'bonus' : 'main';
                    } else if (pendingBonus && !pendingMain) {
                        snakeAssignmentPart = 'bonus';
                    } else {
                        snakeAssignmentPart = 'main';
                    }
                }
            }

            const existing = getLatestSubmissionForCell(cell.round, chosenCellIdx);
            if (String(cell.mode || '') === 'snake' && activeSnakeAssignmentId) {
                const partExisting = (allSubmissions || [])
                    .filter((r) => String(r.snakeAssignmentId || '') === activeSnakeAssignmentId && String(r.snakeAssignmentPart || 'main') === snakeAssignmentPart)
                    .sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0))[0];
                if (partExisting?.status === 'pending' || isAcceptedLikeStatus(partExisting?.status)) {
                    refreshUploadStateForSelectedTask();
                    return alert(partExisting.status === 'pending' ? 'Эта часть задания уже на проверке.' : 'Эта часть задания уже принята.');
                }
            } else if (existing?.status === 'pending' || isAcceptedLikeStatus(existing?.status)) {
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
                    payload.snakeAssignmentId = String(activeTask.assignmentId || snakeState.currentAssignmentId || '').trim();
                    payload.snakeRollRequestId = String(snakeState.lastProcessedRequestId || '').trim();
                    payload.isSphinxTrial = !!activeTask.isSphinxTrial;
                    payload.snakeTaskIdx = Number(activeTask.taskIdx ?? cell.taskIdx ?? -1);
                    payload.sourceAssignmentId = payload.snakeAssignmentId;
                    payload.sourceTaskId = payload.snakeTaskIdx;

                    let assignmentSnapshot = null;
                    const assignmentRound = Number(payload.snakeTaskRound || 0);
                    if (payload.snakeAssignmentId && assignmentRound > 0) {
                        assignmentSnapshot = (await db.ref(`rounds/${assignmentRound}/snake/assignments/${currentUserId}/${payload.snakeAssignmentId}`).once('value')).val() || null;
                    }
                    payload.snakeTaskLabelSnapshot = getSnakeTaskLabelSnapshot({
                        ...payload,
                        taskLabel: activeTask.taskLabel,
                        taskIdx: activeTask.taskIdx
                    }, assignmentSnapshot);
                    if (payload.snakeTaskLabelSnapshot) payload.taskLabel = payload.snakeTaskLabelSnapshot;
                    payload.snakeAssignmentPart = snakeAssignmentPart;
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

        async function setSubmissionStatus(submissionId, sourcePrefix, dbPath, status, options = {}) {

            const opts = (options && typeof options === 'object') ? options : {};
            const isAutoApproval = !!opts.auto;
            const bypassAdmin = !!opts.bypassAdmin;
            const silent = !!opts.silent;
            if (!bypassAdmin && Number(currentUserId) !== Number(ADMIN_ID)) return;
            if (!['accepted', 'rejected'].includes(status)) return;
            const refPath = sourcePrefix === 'works' ? `works/${dbPath || submissionId}` : `submissions/${dbPath || submissionId}`;
            const nowTs = Date.now();
            const patch = {
                status,
                reviewedBy: isAutoApproval ? 'auto' : currentUserId,
                updatedAt: nowTs,
                finalModerationStatus: status
            };
            if (status === 'rejected') {
                const reason = isAutoApproval ? 'Auto-review rejected' : prompt('Укажи причину отказа (игрок увидит это сообщение):', '');
                if (reason === null) return;
                patch.reviewComment = String(reason || '').trim();
                patch.requiresAdminReview = false;
            }
            if (status === 'accepted') {
                patch.reviewComment = '';
                if (isAutoApproval) {
                    patch.autoApprovedAt = nowTs;
                    patch.requiresAdminReview = true;
                    patch.autoApprovalLabel = 'Auto';
                } else {
                    patch.requiresAdminReview = false;
                    patch.manualReviewedAt = nowTs;
                    patch.autoApprovalLabel = 'Принято';
                }
            }
            await db.ref(refPath).update(patch);
            if (status === 'accepted') {
                const rowSnap = await db.ref(refPath).once('value');
                const row = rowSnap.val() || {};
                const uid = String(row.userId || '');
                const roundSnap = await db.ref('current_round').once('value');
                const roundData = roundSnap.val() || {};
                const isSnakeSubmission = String(row.mode || '') === 'snake' || !!row.snakeAssignmentId || Number(row.snakeTaskRound || 0) > 0;
                if (uid && isSnakeSubmission) {
                    const snakeStateSnap = await db.ref(`whitelist/${uid}/snakeState`).once('value');
                    const snakeState = snakeStateSnap.val() || {};
                    const activeTask = snakeState.activeTask || {};
                    const rowCell = Number(row.snakeTaskCell || (Number(row.cellIdx) + 1) || 0);
                    const activeCell = Number(activeTask.cell || 0);
                    const assignmentId = String(
                        row.snakeAssignmentId
                        || activeTask.assignmentId
                        || snakeState.currentAssignmentId
                        || `legacy_${Number(row.snakeTaskRound || row.round || roundData.number || 0)}_${rowCell}_${Number(activeTask.taskIdx ?? row.taskIdx ?? -1)}`
                    ).trim();
                    const assignmentRound = Number(row.snakeTaskRound || activeTask.round || row.round || roundData.number || 0);
                    const assignmentPath = assignmentId ? `rounds/${assignmentRound}/snake/assignments/${uid}/${assignmentId}` : '';
                    if (assignmentId && assignmentPath) {
                        const assignmentBefore = (await db.ref(assignmentPath).once('value')).val() || {};
                        const resolvedSnakeTaskIdx = Number(row.snakeTaskIdx ?? activeTask.taskIdx ?? row.taskIdx ?? assignmentBefore.taskIdx ?? assignmentBefore.taskId ?? -1);
                        const resolvedTaskLabel = getSnakeTaskLabelSnapshot(row, assignmentBefore);
                        const submissionPart = String(row.snakeAssignmentPart || 'main');
                        const approvals = assignmentBefore.approvals || { main: false, bonus: !Number.isInteger(Number(assignmentBefore.bonusTaskIdx)) };
                        if (submissionPart === 'bonus') approvals.bonus = true; else approvals.main = true;
                        const bothApproved = !!approvals.main && !!approvals.bonus;
                        if (!bothApproved) {
                            await db.ref().update({
                                [`${assignmentPath}/approvals`]: approvals,
                                [`${assignmentPath}/status`]: 'partially_approved',
                                [`${assignmentPath}/approvedAt`]: Date.now(),
                                [`whitelist/${uid}/snakeState/awaitingApproval`]: true
                            });
                            return;
                        }

                        let rewardGrantedNow = false;
                        const rewardTx = await db.ref(assignmentPath).transaction((assignmentRow) => {
                            const current = (assignmentRow && typeof assignmentRow === 'object') ? assignmentRow : {
                                assignmentId,
                                userId: uid,
                                round: assignmentRound,
                                cell: rowCell,
                                taskId: resolvedSnakeTaskIdx,
                                taskIdx: resolvedSnakeTaskIdx,
                                taskLabel: resolvedTaskLabel,
                                taskLabelSnapshot: resolvedTaskLabel,
                                status: 'assigned',
                                createdAt: Date.now()
                            };
                            if (current.rewardGranted) return;
                            rewardGrantedNow = true;
                            return {
                                ...current,
                                approvals,
                                rewardGranted: true,
                                rewardGrantedAt: Date.now(),
                                status: 'reward_granted',
                                acceptedStatus: String(status),
                                lastSubmissionId: String(submissionId || ''),
                                reviewedBy: String(currentUserId || ''),
                                taskId: Number(current.taskId ?? resolvedSnakeTaskIdx),
                                taskIdx: Number(current.taskIdx ?? resolvedSnakeTaskIdx),
                                taskLabel: String(current.taskLabel || resolvedTaskLabel || ''),
                                taskLabelSnapshot: String(current.taskLabelSnapshot || current.taskLabel || resolvedTaskLabel || '')
                            };
                        });
                        if (rewardTx.committed && rewardGrantedNow) {
                            let nextTicket = null;
                            await db.ref('ticket_counter').transaction((value) => {
                                const current = Number(value) || 0;
                                nextTicket = current + 1;
                                return nextTicket;
                            });
                            if (!Number.isInteger(nextTicket) || nextTicket <= 0) return;

                            const isSphinxTask = !!activeTask.isSphinxTrial || String(activeTask.type || row.snakeTaskType || '') === 'snake_sphinx';
                            const nowTs = Date.now();
                            const ticketPayload = {
                                num: nextTicket,
                                ticketNum: nextTicket,
                                ticket: String(nextTicket),
                                userId: uid,
                                owner: Number.isFinite(Number(row.owner)) ? Number(row.owner) : Number(snakeState.owner ?? row.charIndex ?? -1),
                                round: Number(row.round || assignmentRound || roundData.number || 0),
                                cell: Number(rowCell || activeCell || 0),
                                taskIdx: resolvedSnakeTaskIdx,
                                taskLabel: String(resolvedTaskLabel || ''),
                                assignmentTaskLabel: String(resolvedTaskLabel || ''),
                                sourceTaskLabel: String(resolvedTaskLabel || ''),
                                mode: 'snake',
                                assignmentId,
                                sourceAssignmentId: assignmentId,
                                source: 'snake_assignment',
                                createdAt: nowTs
                            };
                            const updates = {};
                            updates[`tickets/${nextTicket}`] = ticketPayload;
                            updates[`users/${uid}/tickets/${nextTicket}`] = ticketPayload;
                            updates[`${assignmentPath}/approvals`] = approvals;
                            updates[`${assignmentPath}/taskLabel`] = String(assignmentBefore.taskLabel || resolvedTaskLabel || '');
                            updates[`${assignmentPath}/taskLabelSnapshot`] = String(assignmentBefore.taskLabelSnapshot || assignmentBefore.taskLabel || resolvedTaskLabel || '');
                            updates[`${refPath}/taskLabel`] = String(row.taskLabel || resolvedTaskLabel || '');
                            updates[`${refPath}/snakeTaskLabelSnapshot`] = String(row.snakeTaskLabelSnapshot || resolvedTaskLabel || '');
                            updates[`${refPath}/snakeTaskIdx`] = resolvedSnakeTaskIdx;
                            updates[`whitelist/${uid}/snakeState/awaitingApproval`] = false;
                            updates[`whitelist/${uid}/snakeState/lockedBySphinx`] = isSphinxTask ? false : !!activeTask.lockedBySphinx;
                            updates[`whitelist/${uid}/snakeState/activeTask/isSphinxTrial`] = false;
                            const fruitChoice = String(snakeState.forbiddenFruitChoice || '');
                            const needFruitWait = fruitChoice === 'karma20' && !!snakeState.forbiddenFruitAwaitingSubmission;
                            if (needFruitWait) {
                                const startCycle = Math.max(0, getCurrentPowerWindowCycleIndex(nowTs));
                                updates[`whitelist/${uid}/snakeState/forbiddenFruitWaitStartedAt`] = nowTs;
                                updates[`whitelist/${uid}/snakeState/forbiddenFruitWaitUntil`] = 0;
                                updates[`whitelist/${uid}/snakeState/forbiddenFruitBlockStartCycle`] = startCycle;
                                updates[`whitelist/${uid}/snakeState/forbiddenFruitBlockUntilCycle`] = startCycle + 2;
                                updates[`whitelist/${uid}/snakeState/forbiddenFruitBlockedWindowCycles`] = 2;
                                updates[`whitelist/${uid}/snakeState/forbiddenFruitAwaitingSubmission`] = false;
                                updates[`whitelist/${uid}/snakeState/forbiddenFruitActive`] = false;
                            }
                            updates[`${assignmentPath}/ticketNum`] = nextTicket;
                            updates[`${assignmentPath}/status`] = 'approved';
                            updates[`${assignmentPath}/approvedAt`] = nowTs;
                            updates[`system_notifications/${uid}/${nowTs}_snake_ticket`] = {
                                text: `Твоя работа принята! Твой номер в розыгрыше: #${nextTicket}`,
                                type: 'snake_ticket',
                                createdAt: nowTs,
                                expiresAt: nowTs + (7 * 24 * 3600 * 1000)
                            };
                            if (isSphinxTask) {
                                const clearTs = Date.now();
                                updates[`system_notifications/${uid}/snake_sphinx_trial_done_${clearTs}`] = {
                                    text: '🗿 Испытание Сфинкса пройдено. Путь снова открыт.',
                                    type: 'snake_sphinx_trial_done',
                                    onceKey: `snake_sphinx_trial_done_${Number(activeTask.round || assignmentRound || 0)}_${Number(activeCell || rowCell || 0)}`,
                                    createdAt: clearTs,
                                    expiresAt: clearTs + (24 * 60 * 60 * 1000)
                                };
                            }
                            await db.ref().update(updates);
                            await updateKarma(uid, 5);

                            const synergyCell = Number(rowCell || activeCell || 0);
                            const synergyRound = Number(row.round || assignmentRound || roundData.number || 0);
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
            if (!silent) {
                alert(status === 'accepted' ? 'Статус работы обновлён: Принято.' : 'Статус работы обновлён: Не принято.');
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

        let incidentLogExpanded = false;
        let lastIncidentSummaryKey = '';

        function toggleIncidentLogPanel() {
            incidentLogExpanded = !incidentLogExpanded;
            renderIncidentLogPanel().catch(() => {});
        }

        function toggleProfileTicketHistory() {
            const panel = document.getElementById('profile-ticket-history-panel');
            const btn = document.getElementById('profile-ticket-history-toggle-btn');
            if (!panel || !btn) return;
            const collapsed = panel.style.display === 'none';
            panel.style.display = collapsed ? 'block' : 'none';
            btn.textContent = collapsed ? 'Свернуть' : 'Развернуть';
        }

        async function renderIncidentLogPanel() {
            const wrap = document.getElementById('profile-incident-log');
            const btn = document.getElementById('profile-incident-toggle-btn');
            if (!wrap || !btn) return;
            if (!incidentLogExpanded) {
                wrap.style.maxHeight = '0';
                wrap.classList.remove('expanded');
                btn.textContent = 'Развернуть';
                return;
            }
            const snap = await db.ref(`whitelist/${currentUserId}/incidentLog`).limitToLast(40).once('value');
            const rows = [];
            snap.forEach((item) => rows.push({ id: item.key, ...(item.val() || {}) }));
            rows.sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0));
            wrap.innerHTML = rows.map((r) => `<div style="padding:6px 0; border-bottom:1px dashed #eee;"><div style="font-size:12px; color:#4a148c;">${new Date(Number(r.createdAt||0)).toLocaleString('ru-RU')}</div><div style="font-size:13px;">${String(r.text || 'Событие')}</div></div>`).join('') || '<div style="font-size:12px; color:#777;">Пока пусто.</div>';
            wrap.style.maxHeight = '35vh';
            wrap.classList.add('expanded');
            btn.textContent = 'Свернуть';
        }

        async function showIncidentSummaryOnPowerWindowEntry() {
            const power = getCurrentPowerWindowMsk();
            if (!power.activeWindowId) return;
            const key = `${power.dayKey}_${power.activeWindowId}`;
            if (lastIncidentSummaryKey === key) return;
            const [snap, notifSnap] = await Promise.all([
                db.ref(`whitelist/${currentUserId}/incidentLog`).limitToLast(20).once('value'),
                db.ref(`system_notifications/${currentUserId}`).limitToLast(50).once('value')
            ]);
            const rows = [];
            snap.forEach((item) => rows.push(item.val() || {}));
            const fresh = rows.filter((r) => Number(r.createdAt || 0) > (Date.now() - 24 * 60 * 60 * 1000));
            const notifs = [];
            notifSnap.forEach((item) => notifs.push({ key: item.key, ...(item.val() || {}) }));
            const activeInvite = notifs
                .filter((n) => String(n.type || '') === 'calligraphy_duel_invite' && !n.acknowledged)
                .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0] || null;
            const radishVictims = fresh.filter((r) => String(r.type || '') === 'trap_radish_triggered').map((r) => String(r.actorName || '').trim()).filter(Boolean);
            const arcaneDefs = fresh.filter((r) => String(r.type || '') === 'arcane_defended').length;
            const parts = [];
            if (radishVictims.length) parts.push(`Пока тебя не было, на твою Редиску наступили: ${radishVictims.join(', ')}.`);
            if (arcaneDefs > 0) parts.push(`Пока тебя не было, попыток ограбления, где ты отбился(ась): ${arcaneDefs}.`);
            if (activeInvite) parts.push('Есть активный вызов в «Тотемы».');
            if (!parts.length) {
                lastIncidentSummaryKey = key;
                return;
            }
            enqueueSnakeUiEvent({
                key: `recap_${key}`,
                rank: 3,
                show: (done) => {
                    const titleEl = document.getElementById('mTitle');
                    const textEl = document.getElementById('mText');
                    const modalEl = document.getElementById('modal');
                    const overlayEl = document.getElementById('overlay');
                    if (!titleEl || !textEl || !modalEl || !overlayEl) {
                        done();
                        return;
                    }
                    titleEl.textContent = '📩 Сводка окна силы';
                    const goBtn = activeInvite
                        ? `<button id="snake-recap-go-duel" class="admin-btn" style="margin:8px 0 0; width:100%; background:#6a1b9a;">Перейти к вызову</button>`
                        : '';
                    textEl.innerHTML = `<div style="font-size:13px; color:#4a148c; text-align:left;">${parts.map((p) => `• ${p}`).join('<br>')}</div><button id="snake-recap-ok" class="admin-btn" style="margin:8px 0 0; width:100%;">Понятно</button>${goBtn}`;
                    modalEl.style.display = 'block';
                    overlayEl.style.display = 'block';
                    document.getElementById('snake-recap-ok')?.addEventListener('click', () => {
                        closeModal();
                    }, { once: true });
                    document.getElementById('snake-recap-go-duel')?.addEventListener('click', async () => {
                        if (window.acceptCalligraphyDuel && activeInvite?.duelKey) {
                            await window.acceptCalligraphyDuel(String(activeInvite.duelKey));
                        }
                        closeModal();
                    }, { once: true });
                }
            });
            lastIncidentSummaryKey = key;
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
                if (profile?.deletedAt) return false;

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

        function getGalleryWorkReactionBinding(work) {
            const ownerUserId = resolveSubmissionOwnerUserId(work);
            const sourcePrefix = sanitizeGalleryKeyPart(work?.sourcePrefix || 'submissions');
            const dbPath = sanitizeGalleryKeyPart(work?.dbPath || work?.id || 'unknown');
            const stableWorkId = `${sourcePrefix}__${dbPath}`;
            const legacyPrefix = `${ownerUserId || 'unknown'}_${String(work?.id || '').trim()}_`;
            return { stableWorkId, legacyPrefix, ownerUserId };
        }

        function findAcceptedSubmissionByWorkId(workId) {
            const targetId = String(workId || '').trim();
            if (!targetId) return null;
            const pool = getGalleryApprovedPool();
            return pool.find((item) => {
                const binding = getGalleryWorkReactionBinding(item);
                const directIds = [
                    item?.workId,
                    item?.galleryWorkId,
                    binding.stableWorkId,
                    item?.id,
                    item?.dbPath
                ].map((v) => String(v || '').trim()).filter(Boolean);
                if (directIds.includes(targetId)) return true;
                if (binding.legacyPrefix && targetId.startsWith(binding.legacyPrefix)) return true;
                return false;
            }) || null;
        }

        function resolveGalleryOwnerUserId(workDoc, workId) {
            const directOwnerId = String(workDoc?.ownerUserId || '').trim();
            if (directOwnerId) return directOwnerId;
            const source = findAcceptedSubmissionByWorkId(workId);
            return resolveSubmissionOwnerUserId(source);
        }

        const GALLERY_REACTION_CONFIG = {
            clap: { cost: 0, points: 1, emoji: '👏' },
            heart: { cost: 1, points: 3, emoji: '❤️' },
            sun: { cost: 2, points: 5, emoji: '🌞' }
        };
        const galleryRealtimeState = {
            stopActiveWork: null,
            stopWorkDoc: null,
            stopCompliments: null,
            activeWorkId: '',
            activeWorkDoc: null,
            complimentsByWork: {},
            myReactionType: '',
            pendingReactionType: '',
            inFlight: false
        };

        function getGalleryCountsFromWork(workDoc) {
            const reactions = workDoc?.reactionCounts || workDoc?.reactions || {};
            const compliments = (workDoc?.compliments && typeof workDoc.compliments === 'object') ? workDoc.compliments : null;
            if (compliments && Object.keys(compliments).length > 0) {
                return Object.values(compliments).reduce((acc, row) => {
                    const t = String(row?.type || '').trim();
                    if (t === 'clap' || t === 'heart' || t === 'sun') acc[t] += 1;
                    return acc;
                }, { clap: 0, heart: 0, sun: 0 });
            }
            return {
                clap: Number(reactions.clap || workDoc?.clapCount || 0),
                heart: Number(reactions.heart || workDoc?.heartCount || 0),
                sun: Number(reactions.sun || workDoc?.sunCount || 0)
            };
        }

        function stopGalleryRealtime() {
            if (typeof galleryRealtimeState.stopWorkDoc === 'function') galleryRealtimeState.stopWorkDoc();
            if (typeof galleryRealtimeState.stopActiveWork === 'function') galleryRealtimeState.stopActiveWork();
            if (typeof galleryRealtimeState.stopCompliments === 'function') galleryRealtimeState.stopCompliments();
            galleryRealtimeState.stopActiveWork = null;
            galleryRealtimeState.stopWorkDoc = null;
            galleryRealtimeState.stopCompliments = null;
            galleryRealtimeState.activeWorkId = '';
            galleryRealtimeState.activeWorkDoc = null;
            galleryRealtimeState.complimentsByWork = {};
            galleryRealtimeState.myReactionType = '';
            galleryRealtimeState.pendingReactionType = '';
            galleryRealtimeState.inFlight = false;
            if (galleryRotationTimer) clearInterval(galleryRotationTimer);
        }

        async function loadMyReactionForActiveWork(workId) {
            const uid = String(currentUserId || '').trim();
            if (!uid || !workId) {
                galleryRealtimeState.myReactionType = '';
                return;
            }
            try {
                const snap = await db.ref(`gallery_compliments/${workId}/${uid}`).once('value');
                const row = snap.val() || {};
                galleryRealtimeState.myReactionType = String(row.type || '').trim();
            } catch (err) {
                console.warn('Failed to load my gallery reaction', err);
                galleryRealtimeState.myReactionType = '';
            }
        }

        function getGalleryFallbackWorkDoc(preferredWorkId) {
            const preferredId = String(preferredWorkId || '').trim();
            const preferredWork = preferredId ? findAcceptedSubmissionByWorkId(preferredId) : null;
            const fallback = preferredWork || pickExhibitWorks(getGalleryApprovedPool(), 1)[0] || null;
            if (!fallback) return null;
            const binding = getGalleryWorkReactionBinding(fallback);
            const resolvedWorkId = String(fallback.workId || fallback.galleryWorkId || binding.stableWorkId || '').trim();
            return {
                workId: preferredWork ? preferredId : resolvedWorkId,
                ownerUserId: binding.ownerUserId,
                imageUrl: fallback.afterImageData || fallback.imageData || '',
                afterImageData: fallback.afterImageData || '',
                imageData: fallback.imageData || '',
                taskLabel: String(fallback.taskLabel || fallback.snakeTaskLabelSnapshot || ''),
                reactionCounts: { clap: 0, heart: 0, sun: 0 }
            };
        }

        function resolveGalleryCardWork(runtimeWork, activeWorkId) {
            const exhibitId = String(runtimeWork?.workId || activeWorkId || '').trim();
            const source = findAcceptedSubmissionByWorkId(exhibitId);
            const sourceBinding = source ? getGalleryWorkReactionBinding(source) : null;
            const fallbackImage = String(source?.afterImageData || source?.imageData || '').trim();
            const fallbackOwnerUserId = String(sourceBinding?.ownerUserId || '').trim();
            const merged = {
                ...(runtimeWork || {}),
                workId: exhibitId,
                ownerUserId: String(runtimeWork?.ownerUserId || fallbackOwnerUserId || '').trim(),
                imageUrl: String(runtimeWork?.imageUrl || runtimeWork?.afterImageData || runtimeWork?.imageData || fallbackImage || '').trim(),
                afterImageData: String(runtimeWork?.afterImageData || source?.afterImageData || '').trim(),
                imageData: String(runtimeWork?.imageData || source?.imageData || '').trim(),
                taskLabel: String(runtimeWork?.taskLabel || source?.taskLabel || source?.snakeTaskLabelSnapshot || '').trim(),
                assignmentTaskLabel: String(runtimeWork?.assignmentTaskLabel || source?.assignmentTaskLabel || '').trim(),
                reactionCounts: runtimeWork?.reactionCounts || {},
                compliments: galleryRealtimeState.complimentsByWork[exhibitId] || {}
            };
            const imageResolved = !!String(merged.imageUrl || merged.afterImageData || merged.imageData || '').trim();
            console.log('[GALLERY] card loaded', { exhibitId, hasRuntimeWork: !!runtimeWork, hasSourceFallback: !!source, imageResolved });
            return merged;
        }

        function renderGalleryFromState() {
            const wrap = document.getElementById('gallery-content');
            if (!wrap) return;
            const runtimeWork = galleryRealtimeState.activeWorkDoc;
            const activeWorkId = String(galleryRealtimeState.activeWorkId || '').trim();
            const fallbackWork = runtimeWork ? null : getGalleryFallbackWorkDoc(activeWorkId);
            const work = runtimeWork ? resolveGalleryCardWork(runtimeWork, activeWorkId) : (fallbackWork ? { ...fallbackWork, compliments: galleryRealtimeState.complimentsByWork[String(fallbackWork.workId || activeWorkId || '').trim()] || {} } : null);
            if (!work) {
                wrap.innerHTML = `<div class="gallery-pedestal empty"><div class="gallery-frame-empty"></div><p>Активная работа скоро появится.</p></div>`;
                return;
            }
            const exhibitId = String(work.workId || activeWorkId || '').trim();
            const counts = getGalleryCountsFromWork(work);
            const img = work.imageUrl || work.afterImageData || work.imageData || '';
            console.log('[GALLERY] image ref resolved', { exhibitId, hasImage: !!String(img || '').trim() });
            const ownerUserId = resolveGalleryOwnerUserId(work, exhibitId);
            const hasReaction = !!galleryRealtimeState.myReactionType;
            const inFlight = !!galleryRealtimeState.inFlight;
            const disabledByRole = currentUserRole === 'admin';
            const controlsDisabled = hasReaction || inFlight || disabledByRole;
            const feedbackLine = `Отклик: ${counts.clap} 👏 · ${counts.heart} ❤️ · ${counts.sun} ☀️.`;
            const syncHint = '';
            const imageMarkup = img
                ? `<img src="${img}" class="gallery-image" alt="Выставленная работа">`
                : '<div class="gallery-frame-empty"></div><div style="font-size:12px; color:#8d6e63; margin-top:6px;">Изображение работы ещё загружается.</div>';
            wrap.innerHTML = `
                <div id="gallery-fx" class="gallery-fx"></div>
                <div class="gallery-pedestal">
                    ${imageMarkup}
                    <div id="gallery-feedback-line" style="font-size:12px; margin-top:6px;">${feedbackLine}</div>
                    ${syncHint}
                    <div class="gallery-compliments" style="margin-top:8px;">
                        <div class="compliment-option">
                            <button class="admin-btn compliment-btn clap" style="margin:0; opacity:${controlsDisabled ? '0.5' : '1'};" ${controlsDisabled ? 'disabled' : ''} onclick="sendGalleryCompliment('clap','${exhibitId}','${ownerUserId}')">👏</button>
                            <small>Бесплатно (+1 Карма)</small>
                        </div>
                        <div class="compliment-option">
                            <button class="admin-btn compliment-btn heart" style="margin:0; opacity:${controlsDisabled ? '0.5' : '1'};" ${controlsDisabled ? 'disabled' : ''} onclick="sendGalleryCompliment('heart','${exhibitId}','${ownerUserId}')">❤️</button>
                            <small>1 Билет (+3 Карма)</small>
                        </div>
                        <div class="compliment-option">
                            <button class="admin-btn compliment-btn sun" style="margin:0; opacity:${controlsDisabled ? '0.5' : '1'};" ${controlsDisabled ? 'disabled' : ''} onclick="sendGalleryCompliment('sun','${exhibitId}','${ownerUserId}')">🌞</button>
                            <small>2 Билета (+5 Карма)</small>
                        </div>
                    </div>
                </div>`;
        }
        function bindGalleryWorkDoc(workId) {
            const source = findAcceptedSubmissionByWorkId(workId);
            galleryRealtimeState.activeWorkDoc = source
                ? {
                    workId,
                    ownerUserId: resolveSubmissionOwnerUserId(source),
                    imageUrl: String(source.afterImageData || source.imageData || '').trim(),
                    afterImageData: String(source.afterImageData || '').trim(),
                    imageData: String(source.imageData || '').trim(),
                    taskLabel: String(source.taskLabel || source.snakeTaskLabelSnapshot || '').trim(),
                    assignmentTaskLabel: String(source.assignmentTaskLabel || '').trim()
                }
                : null;
            loadMyReactionForActiveWork(workId).then(() => renderGalleryFromState());
        }

        function startGalleryRealtime() {
            if (galleryRealtimeState.stopActiveWork) return;
            const resolveFallbackWorkId = () => {
                const picked = pickExhibitWorks(getGalleryApprovedPool(), 1)[0] || null;
                if (!picked) return '';
                const binding = getGalleryWorkReactionBinding(picked);
                return String(picked.workId || picked.galleryWorkId || binding.stableWorkId || picked.id || '').trim();
            };
            galleryRealtimeState.stopActiveWork = db.ref('gallery_runtime/active').on('value', (snap) => {
                const row = snap.val() || {};
                const nextWorkId = String(row.workId || resolveFallbackWorkId()).trim();
                if (!nextWorkId) {
                    galleryRealtimeState.activeWorkId = '';
                    galleryRealtimeState.activeWorkDoc = null;
                    renderGalleryFromState();
                    return;
                }
                if (galleryRealtimeState.activeWorkId === nextWorkId) return;
                galleryRealtimeState.activeWorkId = nextWorkId;
                galleryRealtimeState.myReactionType = '';
                galleryRealtimeState.pendingReactionType = '';
                galleryRealtimeState.inFlight = false;
                bindGalleryWorkDoc(nextWorkId);
                renderGalleryFromState();
            }, (err) => {
                console.error('Active gallery listener failed', err);
            });
            galleryRealtimeState.stopActiveWork = () => db.ref('gallery_runtime/active').off('value');

            const complimentsRef = db.ref('gallery_compliments');
            complimentsRef.on('value', (snap) => {
                galleryRealtimeState.complimentsByWork = snap.val() || {};
                const activeWorkId = String(galleryRealtimeState.activeWorkId || '').trim();
                if (activeWorkId) {
                    const myRow = galleryRealtimeState.complimentsByWork?.[activeWorkId]?.[String(currentUserId || '')];
                    galleryRealtimeState.myReactionType = String(myRow?.type || galleryRealtimeState.myReactionType || '').trim();
                }
                renderGalleryFromState();
            });
            galleryRealtimeState.stopCompliments = () => complimentsRef.off('value');
        }

        function applyGalleryOptimisticReaction(type) {
            const work = galleryRealtimeState.activeWorkDoc;
            if (!work || galleryRealtimeState.myReactionType) return null;
            const counts = getGalleryCountsFromWork(work);
            const before = { ...counts };
            counts[type] = Number(counts[type] || 0) + 1;
            galleryRealtimeState.activeWorkDoc = {
                ...(work || {}),
                reactionCounts: counts
            };
            galleryRealtimeState.myReactionType = type;
            galleryRealtimeState.pendingReactionType = type;
            galleryRealtimeState.inFlight = true;
            renderGalleryFromState();
            return before;
        }

        function rollbackGalleryOptimisticReaction(type, beforeCounts) {
            const work = galleryRealtimeState.activeWorkDoc;
            if (!work || !beforeCounts) return;
            galleryRealtimeState.activeWorkDoc = {
                ...(work || {}),
                reactionCounts: { ...beforeCounts }
            };
            if (galleryRealtimeState.pendingReactionType === type) {
                galleryRealtimeState.myReactionType = '';
                galleryRealtimeState.pendingReactionType = '';
            }
            galleryRealtimeState.inFlight = false;
            renderGalleryFromState();
        }

        async function sendGalleryCompliment(type, exhibitId, ownerUserId) {
            console.log('[GALLERY REACT] click received', { type, exhibitId, ownerUserId });
            if (String(currentUserId) === String(ADMIN_ID)) return alert('Админ не может участвовать в голосовании');
            if (!currentUserId) return alert('Пользователь не определён.');
            if (!db) return alert('Галерея временно недоступна.');
            const cfg = GALLERY_REACTION_CONFIG[type];
            if (!cfg) return;
            if (galleryRealtimeState.inFlight) {
                console.log('[GALLERY REACT] guard blocked = inFlight');
                return;
            }
            if (galleryRealtimeState.myReactionType) {
                console.log('[GALLERY REACT] guard blocked = alreadyReacted');
                return alert('Ты уже отправлял(а) реакцию этой картине.');
            }

            const workId = String(exhibitId || galleryRealtimeState.activeWorkId || '').trim();
            if (!workId) {
                console.log('[GALLERY REACT] guard blocked = missingWorkId');
                return alert('Не удалось определить работу галереи. Попробуй еще раз.');
            }

            const targetOwnerUserId = String(ownerUserId || resolveGalleryOwnerUserId(galleryRealtimeState.activeWorkDoc, workId) || '').trim();
            console.log('[GALLERY] reaction target id resolved', { workId, targetOwnerUserId });
            if (!targetOwnerUserId) {
                console.log('[GALLERY REACT] guard blocked = missingOwner');
                return alert('Не удалось определить автора работы.');
            }
            if (targetOwnerUserId === String(currentUserId)) return alert('Нельзя хвалить самого себя.');

            const beforeCounts = applyGalleryOptimisticReaction(type);
            if (!beforeCounts) return;

            try {
                if (cfg.cost > 0) {
                    const ticketSpent = await spendTicketsTransaction(cfg.cost);
                    if (!ticketSpent) throw new Error('Недостаточно билетов');
                }
                const reactionRef = db.ref(`gallery_compliments/${workId}/${currentUserId}`);
                const tx = await reactionRef.transaction((row) => {
                    if (row && String(row.type || '').trim()) return;
                    return {
                        type,
                        fromUserId: String(currentUserId || ''),
                        toUserId: targetOwnerUserId,
                        at: Date.now()
                    };
                });
                if (!tx.committed) throw new Error('Уже есть реакция');

                const karmaAfter = await updateKarma(String(currentUserId || ''), Number(cfg.points || 0));
                seasonProfileData.karma_points = Math.max(0, Number(karmaAfter || seasonProfileData.karma_points || 0));
                updateProfileUI();
                updateProfileTicketBalance();

                const fx = document.getElementById('gallery-fx');
                if (fx) {
                    fx.textContent = cfg.emoji.repeat(6);
                    fx.className = `gallery-fx active ${type}`;
                    setTimeout(() => { fx.className = 'gallery-fx'; fx.textContent = ''; }, 1200);
                }
                playGalleryChime();
                launchVoteConfetti();
            } catch (err) {
                console.error('[GALLERY REACT][ERROR]', err);
                console.warn('Gallery reaction failed', err);
                rollbackGalleryOptimisticReaction(type, beforeCounts);
                alert(err?.message === 'Недостаточно билетов' ? 'Не удалось отправить реакцию: не хватает билетов.' : 'Не удалось отправить реакцию. Попробуй снова.');
                return;
            }

            galleryRealtimeState.inFlight = false;
            galleryRealtimeState.pendingReactionType = '';
            renderGalleryFromState();
        }

        function renderGalleryTab() {
            startGalleryRealtime();
            renderGalleryFromState();
            startGalleryRotationCountdown();
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
        window.replaceBoardCellAssignment = replaceBoardCellAssignment;
        window.roll = roll;
        window.openSnakeShopModal = openSnakeShopModal;
        window.openSnakeBackpackModal = openSnakeBackpackModal;
        window.snakePurchaseItem = snakePurchaseItem;
        window.placeSnakeTrapOnCell = placeSnakeTrapOnCell;
        window.startThiefArcaneFromBackpack = startThiefArcaneFromBackpack;
        window.toggleIncidentLogPanel = toggleIncidentLogPanel;
        window.toggleProfileTicketHistory = toggleProfileTicketHistory;

        // END works.js

        setInterval(() => {
            autoApproveStaleSubmissions().catch((err) => console.error('autoApproveStaleSubmissions interval failed', err));
        }, 60 * 1000);

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
