(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.RewardDeliveryUtils = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  function buildTotemsWinnerNotification(outcome = {}) {
    const parts = [];
    if (outcome.winnerTicketGranted) parts.push('1 билет');
    if (outcome.winnerItemGranted) parts.push('1 редкий предмет');
    if (!parts.length) return 'Победа в «Тотемах», но награды пока не начислены. Сообщите администратору.';
    return `Победа в «Тотемах»! Тебе выданы: ${parts.join(' и ')}.`;
  }

  function buildTotemsLoserNotification(outcome = {}) {
    if (outcome.loserKarmaGranted) return '«Тотемы» завершены: ты получаешь +1 кармы.';
    return '«Тотемы» завершены: награда кармы не начислена, обратитесь к администратору.';
  }

  function pickEpicPaintNotifiedUids(rewardedUids = []) {
    const seen = new Set();
    return (Array.isArray(rewardedUids) ? rewardedUids : [])
      .map((uid) => String(uid || '').trim())
      .filter((uid) => uid && !seen.has(uid) && seen.add(uid));
  }

  return {
    buildTotemsWinnerNotification,
    buildTotemsLoserNotification,
    pickEpicPaintNotifiedUids
  };
}));
