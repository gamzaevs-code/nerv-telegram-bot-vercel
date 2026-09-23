// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// API: лента активности
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const crypto = require('crypto');
const { query } = require('../lib/db');

const verifyInitData = (initData) => {
  const botToken = process.env.BOT_TOKEN;
  if (!botToken) throw new Error('BOT_TOKEN не задан');
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('hash отсутствует');
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calcHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (calcHash !== hash) throw new Error('Неверная подпись initData');
  const authDate = parseInt(params.get('auth_date') || '0', 10);
  if (Math.floor(Date.now() / 1000) - authDate > 86400) throw new Error('Данные устарели');
  const userJson = params.get('user');
  if (!userJson) throw new Error('user не найден');
  return JSON.parse(userJson);
};

const timeAgo = (date) => {
  const now = new Date();
  const d = new Date(date);
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'только что';
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  return `${Math.floor(diff / 86400)} дн назад`;
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { initData } = req.body;
    if (!initData) return res.status(400).json({ ok: false, error: 'initData обязателен' });

    verifyInitData(initData);

    const events = [];

    // 1. Последние выполненные задания
    const completed = await query(
      `SELECT pe.id, pe."createdAt" AS time,
              u.name AS user_name, COALESCE(u."displayName", u.name) AS user_display,
              t.title AS task_title, pe."netAmount" AS amount
       FROM "PlatformEarning" pe
       JOIN "User" u ON u.id = pe."playerId"
       JOIN "Task" t ON t.id = pe."taskId"
       WHERE pe."createdAt" >= NOW() - INTERVAL '7 days'
       ORDER BY pe."createdAt" DESC LIMIT 10`
    );
    completed.rows.forEach(r => {
      events.push({
        type: 'completed',
        icon: '🟢',
        text: `<strong>${r.user_display || r.user_name}</strong> выполнил «${r.task_title}»`,
        meta: `+${r.amount} ₽`,
        time: r.time,
        timeAgo: timeAgo(r.time),
      });
    });

    // 2. Новые задания
    const newTasks = await query(
      `SELECT t.id, t.title, t.reward, t."createdAt" AS time,
              u.name AS user_name, COALESCE(u."displayName", u.name) AS user_display
       FROM "Task" t
       JOIN "User" u ON u.id = t."creatorId"
       WHERE t."createdAt" >= NOW() - INTERVAL '7 days'
       ORDER BY t."createdAt" DESC LIMIT 10`
    );
    newTasks.rows.forEach(r => {
      events.push({
        type: 'new_task',
        icon: '👤',
        text: `<strong>${r.user_display || r.user_name}</strong> создал «${r.title}»`,
        meta: `${r.reward} ₽`,
        time: r.time,
        timeAgo: timeAgo(r.time),
      });
    });

    // 3. Достижения
    const achievements = await query(
      `SELECT ua."unlockedAt" AS time, a.name AS ach_name, a.icon AS ach_icon,
              u.name AS user_name, COALESCE(u."displayName", u.name) AS user_display
       FROM "UserAchievement" ua
       JOIN "Achievement" a ON a.id = ua."achievementId"
       JOIN "User" u ON u.id = ua."userId"
       WHERE ua."unlockedAt" >= NOW() - INTERVAL '7 days'
       ORDER BY ua."unlockedAt" DESC LIMIT 10`
    );
    achievements.rows.forEach(r => {
      events.push({
        type: 'achievement',
        icon: '🎖',
        text: `<strong>${r.user_display || r.user_name}</strong> получил достижение «${r.ach_name}»`,
        meta: r.ach_icon || '🏅',
        time: r.time,
        timeAgo: timeAgo(r.time),
      });
    });

    // 4. Идёт голосование
    const voting = await query(
      `SELECT t.id, t.title, t."updatedAt" AS time,
              (SELECT COUNT(*)::int FROM "Vote" WHERE "taskId"=t.id AND value='approve') AS approve
       FROM "Task" t
       WHERE t.status = 'voting'
       ORDER BY t."updatedAt" DESC LIMIT 5`
    );
    voting.rows.forEach(r => {
      events.push({
        type: 'voting',
        icon: '🗳',
        text: `Идёт голосование: «${r.title}»`,
        meta: `${r.approve}/5 👍`,
        time: r.time,
        timeAgo: timeAgo(r.time),
      });
    });

    // Сортируем по времени (свежие вверху)
    events.sort((a, b) => new Date(b.time) - new Date(a.time));

    // Берём топ-15
    const feed = events.slice(0, 15);

    return res.status(200).json({ ok: true, feed });
  } catch (e) {
    console.error('app-activity error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
