// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// API: рейтинги игроков для Mini App (+ рейтинг по отзывам)
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

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { initData, category = 'reputation' } = req.body;
    if (!initData) return res.status(400).json({ ok: false, error: 'initData обязателен' });

    const tgUser = verifyInitData(initData);
    const chatId = String(tgUser.id);

    const meRes = await query(
      `SELECT id FROM "User" WHERE "telegramChatId" = $1`,
      [chatId]
    );
    if (meRes.rows.length === 0) return res.status(403).json({ ok: false, error: 'Аккаунт не привязан' });
    const myId = meRes.rows[0].id;

    let orderBy = '';
    let scoreField = '';
    let whereExtra = '';

    if (category === 'reputation') {
      orderBy = 'reputation DESC'; scoreField = 'reputation';
    } else if (category === 'balance') {
      orderBy = 'balance DESC'; scoreField = 'balance';
    } else if (category === 'completed') {
      orderBy = '"completedTasksCount" DESC'; scoreField = '"completedTasksCount"';
    } else if (category === 'rating') {
      // ⭐ Рейтинг по отзывам (минимум 1 отзыв чтобы не засорять нулями)
      orderBy = '"ratingAvg" DESC, "ratingCount" DESC'; scoreField = '"ratingAvg"';
      whereExtra = `AND "ratingCount" >= 1`;
    } else {
      return res.status(400).json({ ok: false, error: 'Неизвестная категория' });
    }

    const topRes = await query(
      `SELECT id, name, COALESCE("displayName", name) AS display,
              ${scoreField} AS score, level,
              "ratingAvg", "ratingCount",
              (SELECT COUNT(*)::int FROM "UserAchievement" WHERE "userId"="User".id) AS achievements
       FROM "User"
       WHERE "isBanned" = false ${whereExtra}
       ORDER BY ${orderBy}
       LIMIT 20`
    );

    const myScoreRes = await query(
      `SELECT ${scoreField} AS my_score FROM "User" WHERE id = $1`,
      [myId]
    );
    const myScore = myScoreRes.rows[0]?.my_score || 0;

    const myRankRes = await query(
      `SELECT COUNT(*)::int + 1 AS pos FROM "User"
       WHERE "isBanned" = false AND ${scoreField} > $1 ${whereExtra.replace(/AND/, 'AND')}`,
      [myScore]
    );
    const myRank = myRankRes.rows[0].pos;

    const top = topRes.rows.map((u, i) => ({
      rank: i + 1,
      id: u.id,
      name: u.display,
      score: u.score,
      level: u.level || 1,
      achievements: u.achievements,
      ratingAvg: Number(u.ratingAvg) || 0,
      ratingCount: u.ratingCount || 0,
      isMe: u.id === myId,
    }));

    return res.status(200).json({
      ok: true,
      top,
      myRank,
      myScore,
      category,
    });
  } catch (e) {
    console.error('app-leaderboard error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};