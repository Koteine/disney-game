const assert = require('assert');
const { buildMiniEventResetPatch } = require('./mini_event_reset');

const nowTs = 1700000000000;
const patch = buildMiniEventResetPatch({
  duels: {
    d1: { status: 'attacker_pending' },
    d2: { status: 'resolved' }
  },
  snakeClashes: {
    '10': { '5': { 'a_b': { status: 'active' }, 'c_d': { status: 'resolved' } } }
  },
  notifications: {
    '1': {
      n1: { type: 'calligraphy_duel_invite' },
      n2: { type: 'regular' }
    }
  },
  seasonStatus: { '1': {}, '2': {} },
  users: { '1': {}, '2': {} },
  whitelist: { '1': {}, '3': {} }
}, nowTs);

assert.strictEqual(patch['calligraphy_duels/d1/status'], 'expired');
assert.strictEqual(patch['calligraphy_duels/d1/expiredByRoundStart'], true);
assert.strictEqual(patch['calligraphy_duels/d2/status'], undefined);
assert.strictEqual(patch['snake_clashes/10/5/a_b/status'], 'expired');
assert.strictEqual(patch['system_notifications/1/n1'], null);
assert.strictEqual(patch['system_notifications/1/n2'], undefined);
assert.strictEqual(patch['player_season_status/2/last_impulse_time'], 0);
assert.strictEqual(patch['users/2/last_impulse_time'], 0);
assert.strictEqual(patch['whitelist/3/last_impulse_time'], 0);

console.log('mini_event_reset tests passed');
