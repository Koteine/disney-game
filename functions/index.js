const functions = require('firebase-functions');

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const DUEL_URL = 'https://t.me/DisneyGamebyKoteine_bot/ColoringGameByKoteine';
const EVENT_MESSAGE_BY_TYPE = {
  epic_paint: '🎨 Начался ЭПИЧНЫЙ ЗАКРАС! Весь холст в твоем распоряжении...',
  feed_mushu: "🐲 Хранитель проголодался! Начался ивент 'Кормление Мушу'...",
  mushu_feast: "🐲 Хранитель проголодался! Начался ивент 'Кормление Мушу'...",
  wall_to_wall: "⚔️ К бою! Объявлен сбор на раскрас 'Стенка на стенку'...",
  wall_battle: "⚔️ К бою! Объявлен сбор на раскрас 'Стенка на стенку'...",
};

function getBotToken() {
  const envToken = process.env.BOT_TOKEN;
  if (envToken) {
    return envToken;
  }

  try {
    return functions.config().telegram.token;
  } catch (error) {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

exports.notifyDuelInvite = functions.database
  .ref('/active_duels/{duelId}')
  .onCreate(async (snapshot, context) => {
    const duelData = snapshot.val() || {};
    const duelId = context.params.duelId;
    const targetUserId = duelData.targetUserId;
    const senderName = duelData.senderName || 'Игрок';

    if (!targetUserId) {
      console.warn(`Duel ${duelId}: missing targetUserId, skipping notification.`);
      return null;
    }

    const botToken = getBotToken();
    if (!botToken) {
      console.error('Telegram bot token is not configured. Set BOT_TOKEN or functions.config().telegram.token.');
      return null;
    }

    const text = `🔔 ${senderName} бросает тебе вызов в Дуэли Каллиграфов! Твоя кисть готова к бою? 🖌`;

    const payload = {
      chat_id: targetUserId,
      text,
      reply_markup: {
        inline_keyboard: [[{ text: '🖌 Вступить в дуэль!', url: DUEL_URL }]],
      },
    };

    try {
      const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.status === 403) {
        console.warn(`Duel ${duelId}: user ${targetUserId} blocked the bot (403). Notification will not be retried.`);
        return null;
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Duel ${duelId}: Telegram sendMessage failed (${response.status}): ${errorText}`);
        return null;
      }

      console.log(`Duel ${duelId}: notification sent to user ${targetUserId}.`);
      return null;
    } catch (error) {
      console.error(`Duel ${duelId}: network error while sending Telegram message.`, error);
      return null;
    }
  });

exports.notifyEventStart = functions.database
  .ref('/current_event/status')
  .onUpdate(async (change) => {
    const beforeStatus = change.before.val();
    const afterStatus = change.after.val();

    if (afterStatus !== 'active' || beforeStatus === 'active') {
      return null;
    }

    const botToken = getBotToken();
    if (!botToken) {
      console.error('Telegram bot token is not configured. Set BOT_TOKEN or functions.config().telegram.token.');
      return null;
    }

    const currentEventSnapshot = await change.after.ref.parent.once('value');
    const currentEventData = currentEventSnapshot.val() || {};
    const eventType = currentEventData.type;
    const eventText = EVENT_MESSAGE_BY_TYPE[eventType];

    if (!eventText) {
      console.warn(`Unknown current_event.type: ${eventType}. Notification skipped.`);
      return null;
    }

    const playersSnapshot = await change.after.ref.root.child('player_season_status').once('value');
    const playersData = playersSnapshot.val() || {};
    const userIds = Object.keys(playersData);

    let sentCount = 0;

    for (const userId of userIds) {
      const payload = {
        chat_id: userId,
        text: eventText,
        reply_markup: {
          inline_keyboard: [[{ text: '🎮 Перейти к ивенту', url: DUEL_URL }]],
        },
      };

      try {
        const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (response.status === 403) {
          console.warn(`Event notify: user ${userId} blocked the bot (403).`);
        } else if (!response.ok) {
          const errorText = await response.text();
          console.error(`Event notify: Telegram sendMessage failed for user ${userId} (${response.status}): ${errorText}`);
        } else {
          sentCount += 1;
        }
      } catch (error) {
        console.error(`Event notify: network error while sending message to user ${userId}.`, error);
      }

      await sleep(50);
    }

    console.log(`Event notify: successfully sent ${sentCount} messages for event ${eventType}.`);
    return null;
  });

exports.notifyAdminBroadcast = functions.database
  .ref('/admin_event_notifications/{requestId}')
  .onCreate(async (snapshot, context) => {
    const requestId = context.params.requestId;
    const requestData = snapshot.val() || {};
    const eventType = String(requestData.eventType || '').trim();
    const eventText = EVENT_MESSAGE_BY_TYPE[eventType];

    if (!eventText) {
      await snapshot.ref.update({
        status: 'failed',
        finishedAt: Date.now(),
        error: `Unknown event type: ${eventType || 'empty'}`,
      });
      return null;
    }

    const botToken = getBotToken();
    if (!botToken) {
      await snapshot.ref.update({
        status: 'failed',
        finishedAt: Date.now(),
        error: 'Telegram bot token is not configured',
      });
      console.error('Telegram bot token is not configured. Set BOT_TOKEN or functions.config().telegram.token.');
      return null;
    }

    await snapshot.ref.update({ status: 'in_progress', startedAt: Date.now() });

    const playersSnapshot = await snapshot.ref.root.child('player_season_status').once('value');
    const playersData = playersSnapshot.val() || {};
    const userIds = Object.keys(playersData);

    let sentCount = 0;
    let failedCount = 0;

    for (const userId of userIds) {
      const payload = {
        chat_id: userId,
        text: eventText,
        reply_markup: {
          inline_keyboard: [[{ text: '🎮 Перейти к ивенту', url: DUEL_URL }]],
        },
      };

      try {
        const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (response.status === 403) {
          failedCount += 1;
          console.warn(`Admin broadcast ${requestId}: user ${userId} blocked the bot (403).`);
        } else if (!response.ok) {
          failedCount += 1;
          const errorText = await response.text();
          console.error(`Admin broadcast ${requestId}: Telegram sendMessage failed for user ${userId} (${response.status}): ${errorText}`);
        } else {
          sentCount += 1;
        }
      } catch (error) {
        failedCount += 1;
        console.error(`Admin broadcast ${requestId}: network error while sending message to user ${userId}.`, error);
      }

      await sleep(50);
    }

    await snapshot.ref.update({
      status: 'completed',
      finishedAt: Date.now(),
      totalCount: userIds.length,
      sentCount,
      failedCount,
    });

    console.log(`Admin broadcast ${requestId}: successfully sent ${sentCount} messages for event ${eventType}.`);
    return null;
  });
