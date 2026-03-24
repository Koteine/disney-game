(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.TotemsUtils = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  function normalizeId(value) {
    return String(value || '').trim();
  }

  function resolveTotemsPlayerOutcome(params) {
    const p = params || {};
    const me = normalizeId(p.currentUserId);
    const winnerId = normalizeId(p.winnerId);
    const loserId = normalizeId(p.loserId);
    if (!me) return 'observer';
    if (winnerId && winnerId === me) return 'win';
    if (loserId && loserId === me) return 'lose';
    return 'observer';
  }

  function filterTotemRewardItems(rewardItems, shopItemKeys) {
    const rewards = Array.isArray(rewardItems) ? rewardItems.filter(Boolean).map(String) : [];
    const shopSet = new Set((Array.isArray(shopItemKeys) ? shopItemKeys : []).map(String));
    const filtered = rewards.filter((item) => !shopSet.has(item));
    return filtered.length ? filtered : rewards;
  }

  function getTotemsSheddingInstruction() {
    return 'Теперь повтори последовательность, которую тебе показали ранее';
  }

  return {
    resolveTotemsPlayerOutcome,
    filterTotemRewardItems,
    getTotemsSheddingInstruction
  };
}));
