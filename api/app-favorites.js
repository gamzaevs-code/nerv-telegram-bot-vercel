// Избранные игроки
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
    const { initData, action, targetId } = req.body;
    if (!initData) return res.status(400).json({ ok: false, error: 'initData обязателен' });

    const tgUser = verifyInitData(initData);
    const chatId = String(tgUser.id);

    const meRes = await query(`SELECT id FROM "User" WHERE "telegramChatId" = $1`, [chatId]);
    if (meRes.rows.length === 0) return res.status(403).json({ ok: false, error: 'Аккаунт не привязан' });
    const myId = meRes.rows[0].id;

    // Добавить/удалить из избранных
    if (action === 'toggle' && targetId) {
      if (targetId === myId) return res.status(400).json({ ok: false, error: 'Нельзя себя' });

      const ex = await query(
        `SELECT id FROM "FavoriteUser" WHERE "userId"=$1 AND "targetId"=$2`,
        [myId, targetId]
      );
      if (ex.rows.length > 0) {
        await query(`DELETE FROM "FavoriteUser" WHERE "userId"=$1 AND "targetId"=$2`, [myId, targetId]);
        return res.status(200).json({ ok: true, action: 'removed' });
      } else {
        const cnt = await query(`SELECT COUNT(*)::int AS c FROM "FavoriteUser" WHERE "userId"=$1`, [myId]);
        if (cnt.rows[0].c >= 20) return res.status(400).json({ ok: false, error: 'Максимум 20 избранных' });
        await query(`INSERT INTO "FavoriteUser" ("userId","targetId","createdAt") VALUES ($1,$2,NOW())`, [myId, targetId]);
        return res.status(200).json({ ok: true, action: 'added' });
      }
    }

    // Получить список избранных
    const listRes = await query(
      `SELECT u.id, COALESCE(u."displayName", u.name) AS name, u.level, u.role,
              pres."lastSeen"
       FROM "FavoriteUser" f
       JOIN "User" u ON u.id = f."targetId"
       LEFT JOIN "UserPresence" pres ON pres."userId" = u.id
       WHERE f."userId" = $1
       ORDER BY f."createdAt" DESC`,
      [myId]
    );

    const favorites = listRes.rows.map(u => ({
      id: u.id,
      name: u.name,
      level: u.level || 1,
      role: u.role,
      isOnline: u.lastSeen
        ? (Date.now() - new Date(u.lastSeen).getTime()) / 60000 < ONLINE_THRESHOLD_MIN
        : false,
    }));

    return res.status(200).json({ ok: true, favorites });
  } catch (e) {
    console.error('app-favorites error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};