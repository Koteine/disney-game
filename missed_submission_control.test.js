const assert = require('assert');
const ctl = require('./missed_submission_control');

assert.strictEqual(ctl.shouldSendReminder({ msLeft: ctl.THREE_HOURS_MS, isParticipant: true, hasSubmission: false, alreadySent: false }), true);
assert.strictEqual(ctl.shouldSendReminder({ msLeft: ctl.THREE_HOURS_MS + 1, isParticipant: true, hasSubmission: false, alreadySent: false }), false);
assert.strictEqual(ctl.shouldSendReminder({ msLeft: 1000, isParticipant: true, hasSubmission: true, alreadySent: false }), false);

assert.strictEqual(ctl.resolveMissedSubmissionOutcome({ hasAcceptedSubmission: false, hasAnySubmission: false, surrenderAvailable: true }), 'auto_forfeit');
assert.strictEqual(ctl.resolveMissedSubmissionOutcome({ hasAcceptedSubmission: false, hasAnySubmission: false, surrenderAvailable: false }), 'eliminate');
assert.strictEqual(ctl.resolveMissedSubmissionOutcome({ hasAcceptedSubmission: false, hasAnySubmission: true, surrenderAvailable: false }), 'rejected_only');
assert.strictEqual(ctl.resolveMissedSubmissionOutcome({ hasAcceptedSubmission: true, hasAnySubmission: true, surrenderAvailable: false }), 'none');

// After give-up restore (surrenderAvailable=true), next miss is first-miss behavior again.
assert.strictEqual(ctl.resolveMissedSubmissionOutcome({ hasAcceptedSubmission: false, hasAnySubmission: false, surrenderAvailable: true }), 'auto_forfeit');

// Mode parity: cells/snake feed the same domain outcome.
['cells', 'snake'].forEach(() => {
  assert.strictEqual(ctl.resolveMissedSubmissionOutcome({ hasAcceptedSubmission: false, hasAnySubmission: false, surrenderAvailable: false }), 'eliminate');
});

console.log('missed_submission_control tests passed');
