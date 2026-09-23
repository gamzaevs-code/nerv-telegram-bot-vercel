// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// Онлайн-статусы
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const { query } = require('./db');

const ONLINE_THRESHOLD_MIN = 5; // считается онлайн, если был 5 минут назад

const pingPresence = async (userId) => {
  try {
    await query(
      `INSERT INTO "UserPresence" ("userId","isOnline","lastSeen","createdAt")
       VALUES ($1, true, NOW(), NOW())
       ON CONFLICT ("userId")
       DO UPDATE SET "isOnline" = true, "lastSeen" = NOW()`,
      [userId]
    );
    return true;
  } catch (e) {
    console.error('pingPresence:', e);
    return false;
  }
};

const getOnlineCount = async () => {
  try {
    const r = await query(
      `SELECT COUNT(*)::int AS c FROM "UserPresence"
       WHERE "lastSeen" >= NOW() - INTERVAL '${ONLINE_THRESHOLD_MIN} minutes'`
    );
    return r.rows[0]?.c || 0;
  } catch (e) {
    console.error('getOnlineCount:', e);
    return 0;
  }
};

const isUserOnline = (lastSeen) => {
  if (!lastSeen) return false;
  const diff = (Date.now() - new Date(lastSeen).getTime()) / 1000 / 60;
  return diff < ONLINE_THRESHOLD_MIN;
};

module.exports = { pingPresence, getOnlineCount, isUserOnline, ONLINE_THRESHOLD_MIN };