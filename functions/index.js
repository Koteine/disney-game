const functions = require('firebase-functions');

// Telegram bot notifications were removed.
// Kept as a minimal module so Firebase Functions deployment remains valid.
exports.healthcheck = functions.https.onRequest((req, res) => {
  res.status(200).send('ok');
});
