// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// lib/notifications.js — пуш-уведомления и настройки
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const { query } = require('./db');
const { notifyMany } = require('./notify');

// ========== ОДИНОЧНЫЕ ФУНКЦИИ (совместимость) ==========

const isNotifyEnabled = async (userId) => {
  try {
    const r = await query('SELECT "notifyNewTasks" FROM "User" WHERE id=$1', [userId]);
    return r.rows[0]?.notifyNewTasks !== false;
  } catch (e) {
    console.error('isNotifyEnabled:', e);
    return false;
  }
};

const toggleNotifications = async (userId) => {
  try {
    const r = await query(
      `UPDATE "User" SET "notifyNewTasks" = NOT "notifyNewTasks"
       WHERE id=$1 RETURNING "notifyNewTasks"`,
      [userId]
    );
    return r.rows[0]?.notifyNewTasks;
  } catch (e) {
    console.error('toggleNotifications:', e);
    return null;
  }
};

// ========== МАССОВЫЕ (о новых заданиях) ==========

const notifyNewTask = async (taskId, title, reward, creatorName) => {
  try {
    const subs = await query(
      `SELECT id FROM "User"
       WHERE "notifyNewTasks" = true
         AND "telegramChatId" IS NOT NULL
         AND "isBanned" = false`
    );
    if (subs.rows.length === 0) return 0;

    const userIds = subs.rows.map(r => r.id);
    const res = await notifyMany(userIds, {
      message: `🔔 Новое задание: ${title} (${reward} ₽)`,
      pushText:
        `🔔 *Новое задание!*\n\n` +
        `📌 ${title}\n` +
        `💰 Награда: *${reward} ₽*\n` +
        `👤 Создатель: ${creatorName}`,
      type: 'new_task', // ← мапится на notifyNewTasks
      icon: '🔔',
      linkType: 'task',
      linkId: taskId,
      replyMarkup: {
        inline_keyboard: [[
          { text: '🎯 Посмотреть', url: `https://t.me/nerv_05bot?start=task_${taskId}` },
        ]],
      },
    });
    return res.sent;
  } catch (e) {
    console.error('notifyNewTask:', e);
    return 0;
  }
};

// ========== НАСТРОЙКИ (ТУМБЛЕРЫ) ==========

const TYPE_FIELD_MAP = {
  new: 'notifyNewTasks',
  reviews: 'notifyReviews',
  status: 'notifyStatus',
  levelup: 'notifyLevelUp',
};

/**
 * Получить все настройки юзера
 */
const getNotificationSettings = async (userId) => {
  try {
    const r = await query(
      `SELECT "notifyNewTasks", "notifyReviews", "notifyStatus", "notifyLevelUp"
       FROM "User" WHERE id = $1`,
      [userId]
    );
    if (r.rows.length === 0) return null;
    const u = r.rows[0];
    return {
      newTasks: u.notifyNewTasks !== false,
      reviews: u.notifyReviews !== false,
      status: u.notifyStatus !== false,
      levelup: u.notifyLevelUp !== false,
    };
  } catch (e) {
    console.error('getNotificationSettings:', e);
    return null;
  }
};

/**
 * Переключить одну настройку
 * @param {string} type - 'new' | 'reviews' | 'status' | 'levelup'
 * @returns {boolean|null} - новое значение или null при ошибке
 */
const toggleNotificationType = async (userId, type) => {
  const field = TYPE_FIELD_MAP[type];
  if (!field) return null;
  try {
    const r = await query(
      `UPDATE "User" SET "${field}" = NOT "${field}" WHERE id = $1 RETURNING "${field}"`,
      [userId]
    );
    return r.rows[0]?.[field];
  } catch (e) {
    console.error('toggleNotificationType:', e);
    return null;
  }
};

module.exports = {
  isNotifyEnabled,
  toggleNotifications,
  notifyNewTask,
  getNotificationSettings,
  toggleNotificationType,
};