// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// Хелпер: создание уведомлений
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const { query } = require('./db');

const createNotification = async (userId, type, message, link = null) => {
  try {
    await query(
      `INSERT INTO "Notification" ("userId", type, message, link, "createdAt")
       VALUES ($1, $2, $3, $4, NOW())`,
      [userId, type, message, link]
    );
    return true;
  } catch (e) {
    console.error('createNotification:', e);
    return false;
  }
};

module.exports = { createNotification };