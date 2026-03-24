const assert = require('assert');
const utils = require('./reward_delivery_utils');

assert.strictEqual(
  utils.buildTotemsWinnerNotification({ winnerTicketGranted: true, winnerItemGranted: true }),
  'Победа в «Тотемах»! Тебе выданы: 1 билет и 1 редкий предмет.'
);
assert.ok(
  utils.buildTotemsWinnerNotification({ winnerTicketGranted: false, winnerItemGranted: false }).includes('не начислены')
);
assert.strictEqual(
  utils.buildTotemsLoserNotification({ loserKarmaGranted: true }),
  '«Тотемы» завершены: ты получаешь +1 кармы.'
);
assert.ok(
  utils.buildTotemsLoserNotification({ loserKarmaGranted: false }).includes('не начислена')
);
assert.deepStrictEqual(
  utils.pickEpicPaintNotifiedUids(['10', '10', 11, '', null, '12']),
  ['10', '11', '12']
);

console.log('reward_delivery_utils tests passed');
