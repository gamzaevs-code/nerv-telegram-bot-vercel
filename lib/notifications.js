// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// Пуш-уведомления в Telegram (о новых заданиях 500+ ₽)
// + управление подписками на них
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const { query } = require('./db');
const { sendMessage } = require('./telegram');

// Проверка, включены ли у пользователя уведомления
const isNotifyEnabled = async (userId) => {
  try {
    const r = await query('SELECT "notifyNewTasks" FROM "User" WHERE id=$1', [userId]);
    return r.rows[0]?.notifyNewTasks !== false;
  } catch (e) {
    console.error('isNotifyEnabled:', e);
    return false;
  }
};

// Переключить состояние уведомлений (вкл ↔ выкл)
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

// Разослать push всем подписчикам о новом задании (500+ ₽)
const notifyNewTask = async (taskId, title, reward, creatorName) => {
  try {
    const subs = await query(
      `SELECT "telegramChatId" FROM "User"
       WHERE "notifyNewTasks" = true
         AND "telegramChatId" IS NOT NULL
         AND "isBanned" = false`
    );
    if (subs.rows.length === 0) return 0;

    const text =
      `🔔 *Новое задание!*\n\n` +
      `📌 ${title}\n` +
      `💰 Награда: *${reward} ₽*\n` +
      `👤 Создатель: ${creatorName}`;

    let sent = 0;
    for (const u of subs.rows) {
      try {
        await sendMessage(u.telegramChatId, text, 'Markdown', {
          inline_keyboard: [[
            { text: '🎯 Посмотреть', url: `https://t.me/nerv_05bot?start=task_${taskId}` },
          ]],
        });
        sent++;
      } catch {
        // Пользователь заблокировал бота — пропускаем
      }
    }
    return sent;
  } catch (e) {
    console.error('notifyNewTask:', e);
    return 0;
  }
};

module.exports = {
  isNotifyEnabled,
  toggleNotifications,
  notifyNewTask,
};