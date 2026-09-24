// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// lib/notify.js — единый хаб уведомлений
// Уважает настройки юзера (тумблеры в профиле)
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const { query } = require('./db');
const { sendMessage } = require('./telegram');

// Маппинг type → поле в User
// Если type НЕ в маппинге → всегда отправляется (chat, system, tournament)
const TYPE_TO_FIELD = {
  new_task: 'notifyNewTasks',
  review: 'notifyReviews',
  task: 'notifyStatus',
  levelup: 'notifyLevelUp',
  achievement: 'notifyLevelUp',
};

/**
 * Проверка: разрешён ли этот тип уведомлений для юзера
 */
const isTypeEnabled = async (userId, type) => {
  const field = TYPE_TO_FIELD[type];
  if (!field) return true; // chat / system / tournament — всегда
  try {
    const r = await query(
      `SELECT "${field}" AS enabled FROM "User" WHERE id = $1`,
      [userId]
    );
    return r.rows[0]?.enabled !== false;
  } catch (e) {
    console.error('isTypeEnabled:', e);
    return true;
  }
};

/**
 * Универсальная отправка. Проверяет настройки, пишет в Notification, шлёт push.
 */
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
    force = false, // force=true — игнорировать настройки
  } = opts;

  if (!userId || !message) return { ok: false, error: 'userId и message обязательны' };

  // Проверка настроек
  if (!force) {
    const enabled = await isTypeEnabled(userId, type);
    if (!enabled) return { ok: true, skipped: true };
  }

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
    if (res.ok && !res.skipped) sent++;
  }
  return { ok: true, sent };
};

module.exports = { notifyUser, notifyMany, isTypeEnabled };