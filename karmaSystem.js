(function () {
  const SEASON_PATH = 'player_season_status';

  function getKarmaRank(points) {
    const p = Number(points) || 0;
    if (p <= 20) return 'Зритель из Первого Ряда 👩‍🎤';
    if (p <= 40) return 'Ценитель 🧐';
    if (p <= 60) return '41-60 🖌️✨';
    if (p <= 85) return 'Творец Миров 🌌';
    return 'Бессмертный Мастер 👑';
  }

  async function ensureSeasonProfile(db, userId, nickname, isAdmin) {
    if (!db || !userId || isAdmin) return;
    const ref = db.ref(`${SEASON_PATH}/${userId}`);
    await ref.transaction((row) => {
      if (row && typeof row === 'object') {
        if (!row.nickname && nickname) row.nickname = nickname;
        if (typeof row.karma_points !== 'number') row.karma_points = 0;
        return row;
      }
      return {
        userId: String(userId),
        nickname: String(nickname || 'Игрок'),
        karma_points: 0,
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
