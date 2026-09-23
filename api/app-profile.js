// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// API: расширенный профиль для Mini App
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

const calcLevel = (exp) => Math.floor(Math.sqrt(exp / 50)) + 1;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { initData } = req.body;
    if (!initData) return res.status(400).json({ ok: false, error: 'initData обязателен' });

    const tgUser = verifyInitData(initData);
    const chatId = String(tgUser.id);

    const userRes = await query(
      `SELECT id, name, "displayName", balance, reputation, role,
              level, experience, "loginStreak", "isModerator",
              "referralCode", "createdAt", "roleChosen"
       FROM "User" WHERE "telegramChatId" = $1`,
      [chatId]
    );

    if (userRes.rows.length === 0) {
      return res.status(403).json({ ok: false, error: 'Аккаунт не привязан' });
    }

    const user = userRes.rows[0];

    // Место в рейтинге (по репутации)
    const rankRes = await query(
      `SELECT COUNT(*)::int + 1 AS pos FROM "User" WHERE reputation > $1`,
      [user.reputation]
    );
    const rank = rankRes.rows[0].pos;

    // Достижения
    const achRes = await query(
      `SELECT COUNT(*)::int AS c FROM "UserAchievement" WHERE "userId"=$1`,
      [user.id]
    );
    const achTotalRes = await query(`SELECT COUNT(*)::int AS c FROM "Achievement"`);
    const achievements = {
      unlocked: achRes.rows[0].c,
      total: achTotalRes.rows[0].c,
    };

    // Значок (если надет)
    const badgeRes = await query(
      `SELECT ci.name, ci.imageUrl FROM "UserCosmetic" uc
       JOIN "CosmeticItem" ci ON ci.id = uc."itemId"
       WHERE uc."userId"=$1 AND uc.equipped=true AND ci.type='badge' LIMIT 1`,
      [user.id]
    );
    const badge = badgeRes.rows[0] || null;

    // VIP-статус
    const vipRes = await query(
      `SELECT ci.name, uc."purchasedAt" FROM "UserCosmetic" uc
       JOIN "CosmeticItem" ci ON ci.id = uc."itemId"
       WHERE uc."userId"=$1 AND ci.type='vip'
         AND uc."purchasedAt" >= NOW() - INTERVAL '30 days'
       ORDER BY uc."purchasedAt" DESC LIMIT 1`,
      [user.id]
    );
    const isVip = vipRes.rows.length > 0;

    // XP-прогресс
    const level = user.level || 1;
    const exp = user.experience || 0;
    const expForNext = Math.pow(level, 2) * 50;
    const expForCurrent = Math.pow(level - 1, 2) * 50;
    const expProgress = exp - expForCurrent;
    const expNeeded = expForNext - expForCurrent;
    const expPercent = Math.min(Math.round((expProgress / expNeeded) * 100), 100);

    // Инициалы для аватара
    const displayName = user.displayName || user.name || 'NERV';
    const initials = displayName
      .split(' ')
      .slice(0, 2)
      .map(w => w[0] ? w[0].toUpperCase() : '')
      .join('');

    // Реф-код (создаём, если нет)
    let refCode = user.referralCode;
    if (!refCode) {
      refCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      await query('UPDATE "User" SET "referralCode"=$1 WHERE id=$2', [refCode, user.id]);
    }

    // Рефералы (количество)
    const refCount = await query(
      `SELECT COUNT(*)::int AS c FROM "User" WHERE "referredBy"=$1`,
      [user.id]
    );

    return res.status(200).json({
      ok: true,
      profile: {
        id: user.id,
        name: user.name,
        displayName,
        initials,
        balance: user.balance,
        reputation: user.reputation,
        role: user.role,
        roleChosen: user.roleChosen,
        isModerator: user.isModerator,
        isVip,
        level,
        experience: exp,
        expForNext,
        expProgress,
        expNeeded,
        expPercent,
        loginStreak: user.loginStreak || 0,
        rank,
        achievements,
        badge,
        referralCode: refCode,
        referralCount: refCount.rows[0].c,
        memberSince: user.createdAt,
        telegramUsername: tgUser.username || null,
      },
    });
  } catch (e) {
    console.error('app-profile error:', e);
    return res.status(401).json({ ok: false, error: e.message });
  }
};