const functions = require('firebase-functions');

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const DUEL_URL = 'https://t.me/DisneyGamebyKoteine_bot/ColoringGameByKoteine';

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
