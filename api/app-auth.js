// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// API: авторизация в Mini App через Telegram initData
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

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (calculatedHash !== hash) {
    throw new Error('Неверная подпись initData');
  }

  const authDate = parseInt(params.get('auth_date') || '0', 10);
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > 86400) {
    throw new Error('Данные авторизации устарели');
  }

  const userJson = params.get('user');
  if (!userJson) throw new Error('user не найден');

  return JSON.parse(userJson);
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { initData } = req.body;
    if (!initData) {
      return res.status(400).json({ ok: false, error: 'initData обязателен' });
    }

    const tgUser = verifyInitData(initData);
    const chatId = String(tgUser.id);

    const r = await query(
      `SELECT id, name, "displayName", balance, reputation, role,
              level, experience, "loginStreak", "isBanned",
              "telegramChatId"
       FROM "User" WHERE "telegramChatId" = $1`,
      [chatId]
    );

    if (r.rows.length === 0) {
      return res.status(403).json({
        ok: false,
        error: 'Аккаунт не привязан. Открой бота и напиши /link your@email.com',
      });
    }

    const user = r.rows[0];

    if (user.isBanned) {
      return res.status(403).json({ ok: false, error: 'Аккаунт заблокирован' });
    }

    return res.status(200).json({
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        displayName: user.displayName,
        balance: user.balance,
        reputation: user.reputation,
        role: user.role,
        level: user.level,
        experience: user.experience,
        loginStreak: user.loginStreak,
        telegramUsername: tgUser.username || null,
      },
    });
  } catch (e) {
    console.error('auth error:', e);
    return res.status(401).json({ ok: false, error: e.message });
  }
};