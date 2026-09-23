// Список онлайн-пользователей
const crypto = require('crypto');
const { query } = require('../lib/db');
const { ONLINE_THRESHOLD_MIN } = require('../lib/presence');

const verifyInitData = (initData) => {
  const botToken = process.env.BOT_TOKEN;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calcHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (calcHash !== hash) throw new Error('Неверная подпись');
  return JSON.parse(params.get('user'));
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const { initData } = req.body;
    if (!initData) return res.status(400).json({ ok: false, error: 'initData обязателен' });

    const tgUser = verifyInitData(initData);
    const chatId = String(tgUser.id);

    const meRes = await query(`SELECT id FROM "User" WHERE "telegramChatId" = $1`, [chatId]);
    if (meRes.rows.length === 0) return res.status(403).json({ ok: false, error: 'Аккаунт не привязан' });
    const myId = meRes.rows[0].id;

    const onlineRes = await query(
      `SELECT u.id, COALESCE(u."displayName", u.name) AS name, u.level,
              u.role, pres."lastSeen"
       FROM "UserPresence" pres
       JOIN "User" u ON u.id = pres."userId"
       WHERE pres."lastSeen" >= NOW() - INTERVAL '${ONLINE_THRESHOLD_MIN} minutes'
         AND u."isBanned" = false
         AND u.id != $1
       ORDER BY pres."lastSeen" DESC
       LIMIT 30`,
      [myId]
    );

    const online = onlineRes.rows.map(u => ({
      id: u.id,
      name: u.name,
      level: u.level || 1,
      role: u.role,
      lastSeen: u.lastSeen,
    }));

    return res.status(200).json({ ok: true, online, count: online.length });
  } catch (e) {
    console.error('app-online error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};