(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.TicketSourceUtils = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const TICKET_SOURCES = Object.freeze({
    TOTEMS: 'TOTEMS',
    EPIC_PAINT: 'EPIC_PAINT',
    WALL_BATTLE: 'WALL_BATTLE',
    TASK: 'TASK',
    PVP_SNAKE: 'PVP_SNAKE',
    RAFFLE: 'RAFFLE',
    ADMIN: 'ADMIN',
    ADMIN_REVOKE: 'ADMIN_REVOKE',
    EVENT: 'EVENT',
    OTHER: 'OTHER'
  });

  function normalizeString(value) {
    return String(value || '').trim();
  }

  function resolveTicketSource(row) {
    const ticket = row || {};
    const explicit = normalizeString(ticket.ticketSource).toUpperCase();
    if (TICKET_SOURCES[explicit]) return explicit;

    const source = normalizeString(ticket.source).toLowerCase();
    if (source === 'totems_duel') return TICKET_SOURCES.TOTEMS;
    if (source === 'epic_paint') return TICKET_SOURCES.EPIC_PAINT;
    if (source === 'wall_battle') return TICKET_SOURCES.WALL_BATTLE;
    if (source === 'task' || source === 'submission_approval') return TICKET_SOURCES.TASK;
    if (source === 'snake_assignment' || source === 'snake_clash' || source.startsWith('snake_')) return TICKET_SOURCES.PVP_SNAKE;
    if (source === 'raffle' || source.startsWith('raffle_')) return TICKET_SOURCES.RAFFLE;
    if (source === 'admin' || source === 'admin_grant') return TICKET_SOURCES.ADMIN;
    if (source === 'admin_revoke') return TICKET_SOURCES.ADMIN_REVOKE;

    if (ticket.isManualReward) return TICKET_SOURCES.ADMIN;
    if (ticket.isManualRevoke) return TICKET_SOURCES.ADMIN_REVOKE;

    if (ticket.isEventReward) {
      const eventId = normalizeString(ticket.eventId).toLowerCase();
      if (eventId === 'totems_duel') return TICKET_SOURCES.TOTEMS;
      if (eventId === 'epic_paint') return TICKET_SOURCES.EPIC_PAINT;
      if (eventId === 'wall_battle') return TICKET_SOURCES.WALL_BATTLE;
      return TICKET_SOURCES.EVENT;
    }

    return TICKET_SOURCES.OTHER;
  }

  function getTicketSourceLabel(row) {
    const source = resolveTicketSource(row);
    if (source === TICKET_SOURCES.TOTEMS) return '🎯 Тотемы';
    if (source === TICKET_SOURCES.EPIC_PAINT) return '🎨 Эпичный раскрас';
    if (source === TICKET_SOURCES.WALL_BATTLE) return '🛡️ Стенка на стенку';
    if (source === TICKET_SOURCES.TASK) return '📝 Задание';
    if (source === TICKET_SOURCES.PVP_SNAKE) return '🐍 PvP / Snake clash';
    if (source === TICKET_SOURCES.RAFFLE) return '🎁 Розыгрыш';
    if (source === TICKET_SOURCES.ADMIN) return '🎫 Админ';
    if (source === TICKET_SOURCES.ADMIN_REVOKE) return '🧾 Изъят админом';
    if (source === TICKET_SOURCES.EVENT) return '🎉 Событие';
    return 'Иной источник';
  }

  function resolveTaskDetails(row, tasks) {
    const ticket = row || {};
    const snapshot = (ticket.taskSnapshot && typeof ticket.taskSnapshot === 'object') ? ticket.taskSnapshot : {};
    const snapshotText = normalizeString(snapshot.text || snapshot.label || ticket.sourceTaskLabel || ticket.taskLabel);
    const snapshotImage = normalizeString(snapshot.imageUrl || snapshot.image || ticket.sourceTaskImage || ticket.taskImage);
    const snapshotType = normalizeString(snapshot.type || (snapshotImage ? 'image' : (snapshotText ? 'text' : 'unknown')));

    if (snapshotText || snapshotImage) {
      return {
        type: snapshotType || (snapshotImage ? 'image' : 'text'),
        text: snapshotText,
        imageUrl: snapshotImage
      };
    }

    const taskIdx = Number(ticket.taskIdx);
    const task = Number.isInteger(taskIdx) && taskIdx >= 0 && Array.isArray(tasks) ? (tasks[taskIdx] || null) : null;
    return {
      type: normalizeString(task?.img) ? 'image' : 'text',
      text: normalizeString(task?.text),
      imageUrl: normalizeString(task?.img)
    };
  }

  return {
    TICKET_SOURCES,
    resolveTicketSource,
    getTicketSourceLabel,
    resolveTaskDetails
  };
}));
