// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// API: расширенный профиль (метрики, спарклайн, достижения, рейтинг)
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const crypto = require('crypto');
const { query } = require('../lib/db');
const { pingPresence, getOnlineCount } = require('../lib/presence');

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
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const { initData } = req.body;
    if (!initData) return res.status(400).json({ ok: false, error: 'initData обязателен' });

    const tgUser = verifyInitData(initData);
    const chatId = String(tgUser.id);

    const userRes = await query(
      `SELECT id, name, "displayName", balance, reputation, role,
              level, experience, "loginStreak", "isModerator",
              "referralCode", "createdAt", "roleChosen",
              "lastDailyBonusAt", avatar, bio,
              "ratingAvg", "ratingCount"
       FROM "User" WHERE "telegramChatId" = $1`,
      [chatId]
    );
    if (userRes.rows.length === 0) return res.status(403).json({ ok: false, error: 'Аккаунт не привязан' });
    const user = userRes.rows[0];

    // Пинг присутствия
    await pingPresence(user.id);
    const onlineCount = await getOnlineCount();

    // Место в рейтинге
    const rankRes = await query(
      `SELECT COUNT(*)::int + 1 AS pos FROM "User" WHERE reputation > $1`,
      [user.reputation]
    );
    const rank = rankRes.rows[0].pos;

    // Достижения (последние 3 + общий счёт)
    const achAll = await query(
      `SELECT a.id, a.name, a.icon, a.reward, ua."unlockedAt"
       FROM "Achievement" a
       LEFT JOIN "UserAchievement" ua ON ua."achievementId" = a.id AND ua."userId" = $1
       ORDER BY ua."unlockedAt" DESC NULLS LAST
       LIMIT 10`,
      [user.id]
    );
    const achUnlocked = achAll.rows.filter(a => a.unlockedAt !== null);
    const achievements = {
      unlocked: achUnlocked.length,
      total: achAll.rows.length,
      preview: achAll.rows.slice(0, 3).map(a => ({
        icon: a.icon || '🏅',
        name: a.name,
        isUnlocked: a.unlockedAt !== null,
      })),
    };

    // Значок
    const badgeRes = await query(
      `SELECT ci.name FROM "UserCosmetic" uc
       JOIN "CosmeticItem" ci ON ci.id = uc."itemId"
       WHERE uc."userId"=$1 AND uc.equipped=true AND ci.type='badge' LIMIT 1`,
      [user.id]
    );
    const badge = badgeRes.rows[0] || null;

    // VIP
    const vipRes = await query(
      `SELECT 1 FROM "UserCosmetic" uc
       JOIN "CosmeticItem" ci ON ci.id = uc."itemId"
       WHERE uc."userId"=$1 AND ci.type='vip'
         AND uc."purchasedAt" >= NOW() - INTERVAL '30 days' LIMIT 1`,
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

    // Инициалы
    const displayName = user.displayName || user.name || 'NERV';
    const initials = displayName.split(' ').slice(0, 2)
      .map(w => w[0] ? w[0].toUpperCase() : '').join('');

    // Реф-код
    let refCode = user.referralCode;
    if (!refCode) {
      refCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      await query('UPDATE "User" SET "referralCode"=$1 WHERE id=$2', [refCode, user.id]);
    }
    const refCount = await query(
      `SELECT COUNT(*)::int AS c FROM "User" WHERE "referredBy"=$1`,
      [user.id]
    );

    // Спарклайн активности (7 дней) — транзакции
    const sparkRes = await query(
      `SELECT DATE("createdAt") AS d, COUNT(*)::int AS c
       FROM "Transaction"
       WHERE "userId"=$1 AND "createdAt" >= NOW() - INTERVAL '7 days'
       GROUP BY DATE("createdAt")
       ORDER BY d ASC`,
      [user.id]
    );
    const sparkData = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const key = date.toISOString().split('T')[0];
      const found = sparkRes.rows.find(r => String(r.d).startsWith(key));
      sparkData.push(found ? found.c : 0);
    }
    const sparkMax = Math.max(...sparkData, 1);

    // Streak-календарь (последние 7 дней активности)
    const streakRes = await query(
      `SELECT DATE("createdAt") AS d
       FROM "Transaction"
       WHERE "userId"=$1 AND "createdAt" >= NOW() - INTERVAL '7 days'
       GROUP BY DATE("createdAt")
       ORDER BY d ASC`,
      [user.id]
    );
    const streakDays = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const key = date.toISOString().split('T')[0];
      streakDays.push(streakRes.rows.some(r => String(r.d).startsWith(key)));
    }

    // Таймер до следующего бонуса
    const lastBonus = user.lastDailyBonusAt ? new Date(user.lastDailyBonusAt) : null;
    const hoursSinceBonus = lastBonus ? (Date.now() - lastBonus.getTime()) / 3600000 : 24;
    const nextBonusHours = Math.max(0, 24 - hoursSinceBonus);

    // Метрики для клика
    const earnRes = await query(
      `SELECT COALESCE(SUM(amount),0)::int AS s FROM "Transaction"
       WHERE "userId"=$1 AND amount > 0`,
      [user.id]
    );
    const spentRes = await query(
      `SELECT COALESCE(SUM(amount),0)::int AS s FROM "Transaction"
       WHERE "userId"=$1 AND amount < 0`,
      [user.id]
    );
    const tasksDoneRes = await query(
      `SELECT COUNT(*)::int AS c FROM "Task" WHERE "playerId"=$1 AND status='approved'`,
      [user.id]
    );
    const tasksCreatedRes = await query(
      `SELECT COUNT(*)::int AS c FROM "Task" WHERE "creatorId"=$1`,
      [user.id]
    );
    const votesRes = await query(
      `SELECT COUNT(*)::int AS c FROM "Vote" WHERE "voterId"=$1`,
      [user.id]
    );
    const refEarnRes = await query(
      `SELECT COALESCE(SUM(amount),0)::int AS s FROM "ReferralEarning" WHERE "userId"=$1`,
      [user.id]
    );

    return res.status(200).json({
      ok: true,
      profile: {
        id: user.id,
        name: user.name,
        displayName,
        initials,
        avatar: user.avatar,
        bio: user.bio,
        balance: user.balance,
        reputation: user.reputation,
        role: user.role,
        roleChosen: user.roleChosen,
        isModerator: user.isModerator,
        isVip,
        level,
        experience: exp,
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
        onlineCount,
        sparkline: { data: sparkData, max: sparkMax },
        streakDays,
        nextBonusHours: Math.round(nextBonusHours * 10) / 10,
        // ⭐ РЕЙТИНГ И ОТЗЫВЫ
        ratingAvg: Number(user.ratingAvg) || 0,
        ratingCount: user.ratingCount || 0,
        metrics: {
          earned: earnRes.rows[0].s,
          spent: Math.abs(spentRes.rows[0].s),
          tasksDone: tasksDoneRes.rows[0].c,
          tasksCreated: tasksCreatedRes.rows[0].c,
          votes: votesRes.rows[0].c,
          refEarned: refEarnRes.rows[0].s,
        },
      },
    });
  } catch (e) {
    console.error('app-profile error:', e);
    return res.status(401).json({ ok: false, error: e.message });
  }
};