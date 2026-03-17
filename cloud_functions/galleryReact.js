/**
 * Callable Cloud Function for safe gallery reactions.
 *
 * Firestore:
 * - gallery_runtime/active
 * - gallery_works/{workId}
 * - gallery_works/{workId}/reactions/{userId}
 *
 * Realtime Database:
 * - player_season_status/{userId} (karma)
 * - revoked_tickets/{ticketNum} (ticket spending)
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const rtdb = admin.database();

const REACTIONS = {
  clap: { cost: 0, karma: 1 },
  heart: { cost: 1, karma: 3 },
  sun: { cost: 2, karma: 5 }
};

exports.galleryReact = functions.https.onCall(async (data, context) => {
  const uid = String(context.auth?.uid || '').trim();
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Auth required');

  const workId = String(data?.workId || '').trim();
  const reactionType = String(data?.reactionType || '').trim();
  if (!workId || !REACTIONS[reactionType]) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid reaction payload');
  }

  const cfg = REACTIONS[reactionType];
  const workRef = db.doc(`gallery_works/${workId}`);
  const reactionRef = db.doc(`gallery_works/${workId}/reactions/${uid}`);
  const activeRef = db.doc('gallery_runtime/active');
  const userSeasonRef = rtdb.ref(`player_season_status/${uid}`);

  let karmaAfter = 0;

  await db.runTransaction(async (tx) => {
    const [activeSnap, workSnap, reactionSnap] = await Promise.all([
      tx.get(activeRef),
      tx.get(workRef),
      tx.get(reactionRef)
    ]);

    const activeWorkId = String(activeSnap.data()?.workId || '').trim();
    if (activeWorkId && activeWorkId !== workId) {
      throw new functions.https.HttpsError('failed-precondition', 'Active work changed');
    }
    if (!workSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Work not found');
    }
    if (reactionSnap.exists) {
      throw new functions.https.HttpsError('already-exists', 'Already reacted');
    }

    const ownerUserId = String(workSnap.data()?.ownerUserId || '').trim();
    if (!ownerUserId || ownerUserId === uid) {
      throw new functions.https.HttpsError('permission-denied', 'Self reaction denied');
    }

    tx.set(reactionRef, {
      userId: uid,
      type: reactionType,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    tx.set(workRef, {
      reactionCounts: {
        [reactionType]: admin.firestore.FieldValue.increment(1)
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });

  if (cfg.cost > 0) {
    // Use your existing ticket allocation algorithm here.
    // This placeholder must atomically reserve `cfg.cost` tickets for uid.
    const ok = await spendTickets(uid, cfg.cost);
    if (!ok) {
      await Promise.all([reactionRef.delete(), workRef.set({ reactionCounts: { [reactionType]: admin.firestore.FieldValue.increment(-1) } }, { merge: true })]);
      throw new functions.https.HttpsError('failed-precondition', 'Not enough tickets');
    }
  }

  await userSeasonRef.update({
    karma_points: admin.database.ServerValue.increment(cfg.karma),
    updatedAt: Date.now(),
    lastGalleryComplimentType: reactionType,
    lastGalleryComplimentExhibitId: workId,
    lastGalleryComplimentAt: Date.now()
  });

  const karmaSnap = await rtdb.ref(`player_season_status/${uid}/karma_points`).get();
  karmaAfter = Number(karmaSnap.val() || 0);

  return { ok: true, karmaAfter };
});

async function spendTickets(uid, cost) {
  if (!cost) return true;
  // TODO: Replace with production ticket reservation logic used in your project.
  // Return true when reservation succeeds and false when balance is insufficient.
  return false;
}
