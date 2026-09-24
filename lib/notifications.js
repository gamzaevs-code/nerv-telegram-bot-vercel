// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// lib/notifications.js — пуш-уведомления и подписки
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const { query } = require('./db');
const { notifyMany } = require('./notify');

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
      type: 'task',
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

module.exports = { isNotifyEnabled, toggleNotifications, notifyNewTask };