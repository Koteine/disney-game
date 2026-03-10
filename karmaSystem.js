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
    const ref = db.ref(`${SEASON_PATH}/${userId}`);
    const tx = await ref.transaction((row) => {
      const current = row && typeof row === 'object' ? row : { userId: String(userId), nickname: 'Игрок', karma_points: 0 };
      const next = Math.max(0, Math.min(100, (Number(current.karma_points) || 0) + Number(delta || 0)));
      return { ...current, karma_points: next, updatedAt: Date.now() };
    });
    return Number(tx.snapshot.val()?.karma_points) || 0;
  }

  window.karmaSystem = {
    SEASON_PATH,
    getKarmaRank,
    ensureSeasonProfile,
    addKarmaPoints
  };
})();
