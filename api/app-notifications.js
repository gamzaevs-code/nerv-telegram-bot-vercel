// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// API: уведомления пользователя для Mini App
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
  const diff = Math.floor((Date.now() - new Date(date)) / 1000);
  if (diff < 60) return 'только что';
  if (diff < 3600) return `${Math.floor(diff / 60)} мин`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч`;
  return `${Math.floor(diff / 86400)} дн`;
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const { initData, action } = req.body;
    if (!initData) return res.status(400).json({ ok: false, error: 'initData обязателен' });

    const tgUser = verifyInitData(initData);
    const chatId = String(tgUser.id);

    const userRes = await query(`SELECT id FROM "User" WHERE "telegramChatId" = $1`, [chatId]);
    if (userRes.rows.length === 0) return res.status(403).json({ ok: false, error: 'Аккаунт не привязан' });
    const userId = userRes.rows[0].id;

    // Отметить все как прочитанные
    if (action === 'mark_all_read') {
      await query(`UPDATE "Notification" SET "isRead"=true WHERE "userId"=$1 AND "isRead"=false`, [userId]);
      return res.status(200).json({ ok: true });
    }

    // Получить список уведомлений
    const notifRes = await query(
      `SELECT id, type, message, "isRead", link, "createdAt"
       FROM "Notification"
       WHERE "userId"=$1
       ORDER BY "createdAt" DESC LIMIT 50`,
      [userId]
    );

    const unreadRes = await query(
      `SELECT COUNT(*)::int AS c FROM "Notification" WHERE "userId"=$1 AND "isRead"=false`,
      [userId]
    );

    const notifications = notifRes.rows.map(n => ({
      id: n.id,
      type: n.type,
      message: n.message,
      isRead: n.isRead,
      link: n.link,
      timeAgo: timeAgo(n.createdAt),
    }));

    return res.status(200).json({
      ok: true,
      notifications,
      unreadCount: unreadRes.rows[0].c,
    });
  } catch (e) {
    console.error('app-notifications error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};