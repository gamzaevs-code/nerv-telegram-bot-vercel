// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// API: лента активности + уведомления (объединено)
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
    .map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calcHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (calcHash !== hash) throw new Error('Неверная подпись');
  const authDate = parseInt(params.get('auth_date') || '0', 10);
  if (Math.floor(Date.now() / 1000) - authDate > 86400) throw new Error('Устарело');
  return JSON.parse(params.get('user'));
};

const timeAgo = (date) => {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч`;
  const d = Math.floor(h / 24);
  return `${d} дн`;
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const { initData, action } = req.body;
    if (!initData) return res.status(400).json({ ok: false, error: 'initData обязателен' });

    const tgUser = verifyInitData(initData);
    const chatId = String(tgUser.id);

    const meRes = await query(
      `SELECT id, "displayName", name FROM "User" WHERE "telegramChatId" = $1`,
      [chatId]
    );
    if (meRes.rows.length === 0) return res.status(403).json({ ok: false, error: 'Аккаунт не привязан' });
    const me = meRes.rows[0];

    // ================= ACTIVITY =================
    if (!action || action === 'activity') {
      const feed = [];

      const tasks = await query(
        `SELECT t.id, t.title, t.reward, COALESCE(u."displayName", u.name) AS creator,
                t."createdAt"
         FROM "Task" t JOIN "User" u ON u.id = t."creatorId"
         WHERE t."createdAt" >= NOW() - INTERVAL '2 days'
         ORDER BY t."createdAt" DESC LIMIT 5`
      );
      tasks.rows.forEach(t => feed.push({
        icon: '📌', type: 'task',
        text: `Задание «${t.title}»`,
        meta: `${t.reward} ₽`,
        timeAgo: timeAgo(t.createdAt),
        createdAt: t.createdAt,
      }));

      const approved = await query(
        `SELECT t.title, t.reward, COALESCE(u."displayName", u.name) AS player, t."updatedAt"
         FROM "Task" t JOIN "User" u ON u.id = t."playerId"
         WHERE t.status='approved' AND t."updatedAt" >= NOW() - INTERVAL '2 days'
         ORDER BY t."updatedAt" DESC LIMIT 5`
      );
      approved.rows.forEach(t => feed.push({
        icon: '✅', type: 'approved',
        text: `${t.player} выполнил «${t.title}»`,
        meta: `+${t.reward} ₽`,
        timeAgo: timeAgo(t.updatedAt),
        createdAt: t.updatedAt,
      }));

      const ach = await query(
        `SELECT a.name, a.icon, COALESCE(u."displayName", u.name) AS uname, ua."unlockedAt"
         FROM "UserAchievement" ua
         JOIN "Achievement" a ON a.id = ua."achievementId"
         JOIN "User" u ON u.id = ua."userId"
         WHERE ua."unlockedAt" >= NOW() - INTERVAL '2 days'
         ORDER BY ua."unlockedAt" DESC LIMIT 3`
      );
      ach.rows.forEach(a => feed.push({
        icon: a.icon || '🎖', type: 'achievement',
        text: `${a.uname} открыл «${a.name}»`,
        meta: '',
        timeAgo: timeAgo(a.unlockedAt),
        createdAt: a.unlockedAt,
      }));

      feed.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return res.status(200).json({ ok: true, feed: feed.slice(0, 15) });
    }

    // ================= NOTIFICATIONS =================
    if (action === 'notifications') {
      const r = await query(
        `SELECT id, message, "isRead", "createdAt"
         FROM "Notification" WHERE "userId" = $1
         ORDER BY "createdAt" DESC LIMIT 30`,
        [me.id]
      );
      const unreadRes = await query(
        `SELECT COUNT(*)::int AS c FROM "Notification"
         WHERE "userId"=$1 AND "isRead"=false`,
        [me.id]
      );
      return res.status(200).json({
        ok: true,
        notifications: r.rows.map(n => ({
          id: n.id,
          message: n.message,
          isRead: n.isRead,
          timeAgo: timeAgo(n.createdAt),
        })),
        unreadCount: unreadRes.rows[0].c,
      });
    }

    if (action === 'mark_all_read') {
      await query(
        `UPDATE "Notification" SET "isRead"=true WHERE "userId"=$1 AND "isRead"=false`,
        [me.id]
      );
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'Неизвестное действие' });
  } catch (e) {
    console.error('app-feed error:', e);
    return res.status(401).json({ ok: false, error: e.message });
  }
};