const assert = require('assert');
const utils = require('./totems_utils');

assert.strictEqual(utils.resolveTotemsPlayerOutcome({ currentUserId: '10', winnerId: '10', loserId: '11' }), 'win');
assert.strictEqual(utils.resolveTotemsPlayerOutcome({ currentUserId: '11', winnerId: '10', loserId: '11' }), 'lose');
assert.strictEqual(utils.resolveTotemsPlayerOutcome({ currentUserId: '12', winnerId: '10', loserId: '11' }), 'observer');

const rewardPool = utils.filterTotemRewardItems(['totemShard', 'shopA', 'pythonEye'], ['shopA', 'shopB']);
assert.deepStrictEqual(rewardPool, ['totemShard', 'pythonEye']);

const fallbackPool = utils.filterTotemRewardItems(['shopA'], ['shopA']);
assert.deepStrictEqual(fallbackPool, ['shopA']);

assert.strictEqual(utils.getTotemsSheddingInstruction(), 'Теперь повтори последовательность, которую тебе показали ранее');

console.log('totems_utils tests passed');
