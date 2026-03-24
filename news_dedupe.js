(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.NewsDedupe = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  function sanitizeNewsUniqueKey(rawKey) {
    const source = String(rawKey || '').trim();
    if (!source) return '';
    return source
      .replace(/[.#$\[\]/]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 180);
  }

  function buildNewsUniqueKey(parts) {
    if (!parts || typeof parts !== 'object') return '';
    const items = [];
    if (parts.type) items.push(`type:${String(parts.type).trim()}`);
    if (parts.eventId) items.push(`event:${String(parts.eventId).trim()}`);
    if (parts.sourceId) items.push(`src:${String(parts.sourceId).trim()}`);
    if (Number.isFinite(Number(parts.round))) items.push(`round:${Number(parts.round)}`);
    if (parts.actionId) items.push(`action:${String(parts.actionId).trim()}`);
    if (parts.bucketMs && parts.timestamp) {
      const bucketMs = Math.max(1, Number(parts.bucketMs));
      const bucket = Math.floor(Number(parts.timestamp) / bucketMs);
      items.push(`bucket:${bucket}`);
    }
    return sanitizeNewsUniqueKey(items.join('|'));
  }

  return {
    sanitizeNewsUniqueKey,
    buildNewsUniqueKey
  };
}));
