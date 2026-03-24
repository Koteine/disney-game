const assert = require('assert');
const { sanitizeNewsUniqueKey, buildNewsUniqueKey } = require('./news_dedupe');

assert.strictEqual(sanitizeNewsUniqueKey('  duel/start#1  '), 'duel_start_1');
assert.strictEqual(sanitizeNewsUniqueKey('a/b[c]d.e$f'), 'a_b_c_d_e_f');

const key = buildNewsUniqueKey({
  type: 'event_summary',
  eventId: 'wall_battle',
  sourceId: 'evt_42',
  round: 7,
  actionId: 'done',
  timestamp: 1700000999123,
  bucketMs: 60_000
});
assert.strictEqual(
  key,
  'type:event_summary|event:wall_battle|src:evt_42|round:7|action:done|bucket:28333349'
);

const keyWithoutBucket = buildNewsUniqueKey({ type: 'round_start', round: 11 });
assert.strictEqual(keyWithoutBucket, 'type:round_start|round:11');

console.log('news_dedupe tests passed');
