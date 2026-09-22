// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// 📊 ЕЖЕДНЕВНАЯ СВОДКА АДМИНУ
// Отправляется в 00:00 МСК (= 21:00 UTC)
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const { query } = require('./db');
const { sendMessage } = require('./telegram');

const DIV = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';

const getMskDayBounds = (now = new Date()) => {
  const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
  const msk = new Date(now.getTime() + MSK_OFFSET_MS);
  const mskMidnight = Date.UTC(
    msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate(), 0, 0, 0, 0
  );
  const startUtc = new Date(mskMidnight - MSK_OFFSET_MS);
  const endUtc = new Date(startUtc.getTime() + 24 * 3600e3);
  return { startUtc, endUtc };
};

const formatDate = (date) => {
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
  ];
  const d = new Date(date);
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

const buildDailySummary = async (now = new Date()) => {
  const { startUtc, endUtc } = getMskDayBounds(now);

  // Новые пользователи
  const newUsers = await query(
    `SELECT COUNT(*)::int AS c FROM "User" WHERE "createdAt" >= $1 AND "createdAt" < $2`,
    [startUtc, endUtc]
  );

  // Создано заданий
  const createdTasks = await query(
    `SELECT COUNT(*)::int AS c FROM "Task" WHERE "createdAt" >= $1 AND "createdAt" < $2`,
    [startUtc, endUtc]
  );

  // Выполнено заданий (по PlatformEarning)
  const completedTasks = await query(
    `SELECT COUNT(*)::int AS c FROM "PlatformEarning" WHERE "createdAt" >= $1 AND "createdAt" < $2`,
    [startUtc, endUtc]
  );

  // Голоса
  const votes = await query(
    `SELECT COUNT(*)::int AS c FROM "Vote" WHERE "createdAt" >= $1 AND "createdAt" < $2`,
    [startUtc, endUtc]
  );

  // Оборот и доход
  const money = await query(
    `SELECT COALESCE(SUM("grossAmount"),0)::int AS gross,
            COALESCE(SUM("commission"),0)::int AS commission
     FROM "PlatformEarning"
     WHERE "createdAt" >= $1 AND "createdAt" < $2`,
    [startUtc, endUtc]
  );
  const gross = money.rows[0]?.gross || 0;
  const commission = money.rows[0]?.commission || 0;
  const avgCheck = completedTasks.rows[0].c > 0
    ? Math.round(gross / completedTasks.rows[0].c)
    : 0;

  // Топ-игрок дня
  const topPlayer = await query(
    `SELECT u.id, COALESCE(u."displayName", u.name) AS name,
            COALESCE(SUM(pe."netAmount"),0)::int AS earned
     FROM "PlatformEarning" pe
     JOIN "User" u ON u.id = pe."playerId"
     WHERE pe."createdAt" >= $1 AND pe."createdAt" < $2
     GROUP BY u.id, u.name, u."displayName"
     ORDER BY earned DESC LIMIT 1`,
    [startUtc, endUtc]
  );

  // Топ-задание дня
  const topTask = await query(
    `SELECT t.title, t.reward FROM "Task" t
     WHERE t."createdAt" >= $1 AND t."createdAt" < $2
     ORDER BY t.reward DESC LIMIT 1`,
    [startUtc, endUtc]
  );

  // Всего пользователей
  const totalUsers = await query(`SELECT COUNT(*)::int AS c FROM "User"`);
  const totalTasks = await query(`SELECT COUNT(*)::int AS c FROM "Task"`);

  // Формируем текст
  let text = `📊 *СВОДКА ЗА ДЕНЬ*\n${DIV}\n`;
  text += `📅 ${formatDate(now)}\n\n`;

  text += `👥 Новых пользователей: *${newUsers.rows[0].c}*\n`;
  text += `📋 Создано заданий: *${createdTasks.rows[0].c}*\n`;
  text += `✅ Выполнено: *${completedTasks.rows[0].c}*\n`;
  text += `🗳 Голосов: *${votes.rows[0].c}*\n\n`;

  text += `💰 Оборот: *${gross} ₽*\n`;
  text += `💵 Твой доход (11%): *${commission} ₽*\n`;
  if (completedTasks.rows[0].c > 0) {
    text += `📈 Средний чек: *${avgCheck} ₽*\n`;
  }
  text += `\n`;

  if (topPlayer.rows.length > 0) {
    text += `🏆 *Топ-игрок дня:*\n`;
    text += `   ${topPlayer.rows[0].name} — *+${topPlayer.rows[0].earned} ₽*\n\n`;
  } else {
    text += `🏆 *Топ-игрок дня:* _никто не выполнял задания_\n\n`;
  }

  if (topTask.rows.length > 0) {
    text += `📌 *Топ-задание дня:*\n`;
    text += `   «${topTask.rows[0].title.slice(0, 40)}» — *${topTask.rows[0].reward} ₽*\n\n`;
  }

  text += `${DIV}\n`;
  text += `💡 *Всего в системе:*\n`;
  text += `   👥 Пользователей: *${totalUsers.rows[0].c}*\n`;
  text += `   📋 Заданий: *${totalTasks.rows[0].c}*\n`;
  text += `${DIV}`;

  return text;
};

const sendDailySummaryToAdmin = async () => {
  try {
    const adminChatId = process.env.ADMIN_CHAT_ID;
    if (!adminChatId) {
      console.error('sendDailySummaryToAdmin: ADMIN_CHAT_ID не задан');
      return { ok: false, error: 'no_admin_chat_id' };
    }

    const text = await buildDailySummary();
    await sendMessage(adminChatId, text, 'Markdown');

    return { ok: true, adminChatId };
  } catch (e) {
    console.error('sendDailySummaryToAdmin:', e);
    return { ok: false, error: e.message };
  }
};

module.exports = { buildDailySummary, sendDailySummaryToAdmin, getMskDayBounds };