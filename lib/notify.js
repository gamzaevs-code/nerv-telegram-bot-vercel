// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// lib/notify.js — единый хаб уведомлений
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const { query } = require('./db');
const { sendMessage } = require('./telegram');

const notifyUser = async (userId, opts = {}) => {
  const {
    message,
    pushText = message,
    type = 'system',
    icon = '🔔',
    linkType = null,
    linkId = null,
    replyMarkup = null,
    skipPush = false,
    skipDb = false,
  } = opts;

  if (!userId || !message) return { ok: false, error: 'userId и message обязательны' };

  const result = { ok: true };

  // 1) Notification (для колокольчика Mini App)
  if (!skipDb) {
    try {
      await query(
        `INSERT INTO "Notification" ("userId", message, "isRead", type, icon, "linkType", "linkId", "createdAt")
         VALUES ($1, $2, false, $3, $4, $5, $6, NOW())`,
        [userId, message, type, icon, linkType, linkId]
      );
    } catch (e) {
      console.error('notifyUser:DB:', e);
      result.ok = false;
      result.error = e.message;
    }
  }

  // 2) Push в Telegram
  if (!skipPush) {
    try {
      const r = await query(
        `SELECT "telegramChatId" FROM "User" WHERE id = $1`,
        [userId]
      );
      const chatId = r.rows[0]?.telegramChatId;
      if (chatId) {
        await sendMessage(chatId, pushText, 'Markdown', replyMarkup);
      }
    } catch (e) {
      console.error('notifyUser:TG:', e);
      result.ok = false;
      result.error = e.message;
    }
  }

  return result;
};

const notifyMany = async (userIds, opts = {}) => {
  if (!Array.isArray(userIds) || userIds.length === 0) return { ok: true, sent: 0 };
  let sent = 0;
  for (const uid of userIds) {
    const res = await notifyUser(uid, opts);
    if (res.ok) sent++;
  }
  return { ok: true, sent };
};

module.exports = { notifyUser, notifyMany };