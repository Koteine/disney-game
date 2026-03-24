(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.MiniEventReset = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  function buildMiniEventResetPatch(data, nowTs) {
    const src = data || {};
    const at = Number(nowTs) || Date.now();
    const updates = {};
    const duelTerminalStatuses = new Set(['resolved', 'declined', 'expired']);
    const duelNotificationTypes = new Set([
      'calligraphy_duel_invite',
      'calligraphy_duel_wait_notice',
      'calligraphy_duel_timeout',
      'calligraphy_duel_declined',
      'calligraphy_duel_result',
      'snake_clash_start',
      'snake_clash_result_win',
      'snake_clash_result_loss',
      'snake_clash_draw'
    ]);

    Object.entries(src.duels || {}).forEach(([duelKey, duel]) => {
      const status = String(duel?.status || '');
      if (duelTerminalStatuses.has(status)) return;
      updates[`calligraphy_duels/${duelKey}/status`] = 'expired';
      updates[`calligraphy_duels/${duelKey}/expiresAt`] = 0;
      updates[`calligraphy_duels/${duelKey}/expiredAt`] = at;
      updates[`calligraphy_duels/${duelKey}/expiredByRoundStart`] = true;
    });

    Object.entries(src.snakeClashes || {}).forEach(([roundKey, cells]) => {
      Object.entries(cells || {}).forEach(([cellKey, pairs]) => {
        Object.entries(pairs || {}).forEach(([pairKey, clash]) => {
          if (String(clash?.status || '') !== 'active') return;
          const basePath = `snake_clashes/${roundKey}/${cellKey}/${pairKey}`;
          updates[`${basePath}/status`] = 'expired';
          updates[`${basePath}/expiredAt`] = at;
          updates[`${basePath}/expiredByRoundStart`] = true;
        });
      });
    });

    Object.entries(src.notifications || {}).forEach(([uid, rows]) => {
      Object.entries(rows || {}).forEach(([notifKey, notif]) => {
        if (!duelNotificationTypes.has(String(notif?.type || ''))) return;
        updates[`system_notifications/${uid}/${notifKey}`] = null;
      });
    });

    Object.keys(src.seasonStatus || {}).forEach((uid) => {
      updates[`player_season_status/${uid}/last_impulse_time`] = 0;
      updates[`player_season_status/${uid}/updatedAt`] = at;
    });
    Object.keys(src.users || {}).forEach((uid) => {
      updates[`users/${uid}/last_impulse_time`] = 0;
    });
    Object.keys(src.whitelist || {}).forEach((uid) => {
      updates[`whitelist/${uid}/last_impulse_time`] = 0;
    });

    return updates;
  }

  return { buildMiniEventResetPatch };
}));
