(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.MissedSubmissionControl = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

  function shouldSendReminder(params) {
    const p = params || {};
    const msLeft = Number(p.msLeft || 0);
    const isParticipant = !!p.isParticipant;
    const hasSubmission = !!p.hasSubmission;
    const alreadySent = !!p.alreadySent;
    const windowMs = Number(p.reminderWindowMs || THREE_HOURS_MS);
    if (!isParticipant || hasSubmission || alreadySent) return false;
    return msLeft > 0 && msLeft <= windowMs;
  }

  function resolveMissedSubmissionOutcome(params) {
    const p = params || {};
    if (p.hasAcceptedSubmission) return 'none';
    if (p.hasAnySubmission) return 'rejected_only';
    return p.surrenderAvailable ? 'auto_forfeit' : 'eliminate';
  }

  return {
    THREE_HOURS_MS,
    shouldSendReminder,
    resolveMissedSubmissionOutcome
  };
}));
