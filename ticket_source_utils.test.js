const assert = require('assert');
const utils = require('./ticket_source_utils');

assert.strictEqual(utils.resolveTicketSource({ isEventReward: true, eventId: 'totems_duel' }), 'TOTEMS');
assert.strictEqual(utils.resolveTicketSource({ source: 'epic_paint' }), 'EPIC_PAINT');
assert.strictEqual(utils.resolveTicketSource({ source: 'task' }), 'TASK');
assert.strictEqual(utils.resolveTicketSource({ source: 'snake_assignment' }), 'PVP_SNAKE');
assert.strictEqual(utils.resolveTicketSource({ isManualReward: true }), 'ADMIN');
assert.strictEqual(utils.resolveTicketSource({ isManualRevoke: true }), 'ADMIN_REVOKE');
assert.strictEqual(utils.getTicketSourceLabel({ source: 'totems_duel' }), '🎯 Тотемы');
assert.strictEqual(utils.getTicketSourceLabel({ source: 'epic_paint' }), '🎨 Эпичный раскрас');
assert.strictEqual(utils.getTicketSourceLabel({ source: 'task' }), '📝 Задание');

const imgDetails = utils.resolveTaskDetails({
  taskSnapshot: { type: 'image', text: '', imageUrl: 'https://example.com/task.png' }
}, []);
assert.strictEqual(imgDetails.type, 'image');
assert.strictEqual(imgDetails.imageUrl, 'https://example.com/task.png');
assert.strictEqual(imgDetails.text, '');

const textDetails = utils.resolveTaskDetails({ taskIdx: 0 }, [{ text: 'Текст задания', img: '' }]);
assert.strictEqual(textDetails.type, 'text');
assert.strictEqual(textDetails.text, 'Текст задания');
assert.strictEqual(textDetails.imageUrl, '');

const noEpicFallback = utils.resolveTicketSource({ isEventReward: true, eventId: 'totems_duel' });
assert.notStrictEqual(noEpicFallback, 'EPIC_PAINT');

console.log('ticket_source_utils tests passed');
