// в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬
// API: СЂР°СЃС€РёСЂРµРЅРЅС‹Р№ РїСЂРѕС„РёР»СЊ (РјРµС‚СЂРёРєРё, СЃРїР°СЂРєР»Р°Р№РЅ, РґРѕСЃС‚РёР¶РµРЅРёСЏ, СЂРµР№С‚РёРЅРі, РЅРёРє)
// в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬
const crypto = require('crypto');
const { query } = require('../lib/db');
const { pingPresence, getOnlineCount } = require('../lib/presence');

const verifyInitData = (initData) => {
  const botToken = process.env.BOT_TOKEN;
  if (!botToken) throw new Error('BOT_TOKEN РЅРµ Р·Р°РґР°РЅ');
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('hash РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚');
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calcHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (calcHash !== hash) throw new Error('РќРµРІРµСЂРЅР°СЏ РїРѕРґРїРёСЃСЊ initData');
  const authDate = parseInt(params.get('auth_date') || '0', 10);
  if (Math.floor(Date.now() / 1000) - authDate > 86400) throw new Error('Р”Р°РЅРЅС‹Рµ СѓСЃС‚Р°СЂРµР»Рё');
  const userJson = params.get('user');
  if (!userJson) throw new Error('user РЅРµ РЅР°Р№РґРµРЅ');
  return JSON.parse(userJson);
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const { initData } = req.body;
    if (!initData) return res.status(400).json({ ok: false, error: 'initData РѕР±СЏР·Р°С‚РµР»РµРЅ' });

    const tgUser = verifyInitData(initData);
    const chatId = String(tgUser.id);

    const userRes = await query(
      `SELECT id, name, "displayName", balance, reputation, role,
              level, experience, "loginStreak", "isModerator",
              "referralCode", "createdAt", "roleChosen",
              "lastDailyBonusAt", avatar, bio,
              "ratingAvg", "ratingCount", "nicknameUpdatedAt", "premiumPlan", "premiumExpireAt"
       FROM "User" WHERE "telegramChatId" = $1`,
      [chatId]
    );
    if (userRes.rows.length === 0) return res.status(403).json({ ok: false, error: 'РђРєРєР°СѓРЅС‚ РЅРµ РїСЂРёРІСЏР·Р°РЅ' });
    const user = userRes.rows[0];

    // РџРёРЅРі РїСЂРёСЃСѓС‚СЃС‚РІРёСЏ
    await pingPresence(user.id);
    const onlineCount = await getOnlineCount();

    // РњРµСЃС‚Рѕ РІ СЂРµР№С‚РёРЅРіРµ
    const rankRes = await query(
      `SELECT COUNT(*)::int + 1 AS pos FROM "User" WHERE reputation > $1`,
      [user.reputation]
    );
    const rank = rankRes.rows[0].pos;

    // Р”РѕСЃС‚РёР¶РµРЅРёСЏ
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
        icon: a.icon || 'рџЏ…',
        name: a.name,
        isUnlocked: a.unlockedAt !== null,
      })),
    };

    // Р—РЅР°С‡РѕРє
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

    // XP-РїСЂРѕРіСЂРµСЃСЃ
    const level = user.level || 1;
    const exp = user.experience || 0;
    const expForNext = Math.pow(level, 2) * 50;
    const expForCurrent = Math.pow(level - 1, 2) * 50;
    const expProgress = exp - expForCurrent;
    const expNeeded = expForNext - expForCurrent;
    const expPercent = Math.min(Math.round((expProgress / expNeeded) * 100), 100);

    // РРЅРёС†РёР°Р»С‹
    const displayName = user.displayName || user.name || 'NERV';
    const initials = displayName.split(' ').slice(0, 2)
      .map(w => w[0] ? w[0].toUpperCase() : '').join('');

    // Р РµС„-РєРѕРґ
    let refCode = user.referralCode;
    if (!refCode) {
      // Р“РµРЅРµСЂРёСЂРѕРІР°С‚СЊ РєСЂРёРїС‚РѕРіСЂР°С„РёС‡РµСЃРєРё Р±РµР·РѕРїР°СЃРЅС‹Р№ СЂРµС„РµСЂР°Р»СЊРЅС‹Р№ РєРѕРґ
      const crypto = require('crypto');
      refCode = crypto.randomBytes(4).toString('hex').toUpperCase();
      await query('UPDATE "User" SET "referralCode"=$1 WHERE id=$2', [refCode, user.id]);
    }
    const refCount = await query(
      `SELECT COUNT(*)::int AS c FROM "User" WHERE "referredBy"=$1`,
      [user.id]
    );

    // РЎРїР°СЂРєР»Р°Р№РЅ Р°РєС‚РёРІРЅРѕСЃС‚Рё (7 РґРЅРµР№) вЂ” РІСЃРµ РґРµР№СЃС‚РІРёСЏ
    const sparkRes = await query(
      `SELECT DATE(d) AS d, COUNT(*)::int AS c FROM (
         SELECT "createdAt" AS d FROM "Transaction" WHERE "userId"=$1 AND "createdAt" >= NOW() - INTERVAL '7 days'
         UNION ALL
         SELECT "createdAt" AS d FROM "Task" WHERE "creatorId"=$1 AND "createdAt" >= NOW() - INTERVAL '7 days'
         UNION ALL
         SELECT "updatedAt" AS d FROM "Task" WHERE "playerId"=$1 AND "updatedAt" >= NOW() - INTERVAL '7 days' AND status='approved'
         UNION ALL
         SELECT "createdAt" AS d FROM "Vote" WHERE "voterId"=$1 AND "createdAt" >= NOW() - INTERVAL '7 days'
         UNION ALL
         SELECT "unlockedAt" AS d FROM "UserAchievement" WHERE "userId"=$1 AND "unlockedAt" >= NOW() - INTERVAL '7 days'
       ) AS acts
       GROUP BY DATE(d)
       ORDER BY DATE(d) ASC`,
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

    // Streak-РєР°Р»РµРЅРґР°СЂСЊ
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

    // РўР°Р№РјРµСЂ Р±РѕРЅСѓСЃР°
    const lastBonus = user.lastDailyBonusAt ? new Date(user.lastDailyBonusAt) : null;
    const hoursSinceBonus = lastBonus ? (Date.now() - lastBonus.getTime()) / 3600000 : 24;
    const nextBonusHours = Math.max(0, 24 - hoursSinceBonus);

    // РњРµС‚СЂРёРєРё
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
        // в­ђ Р Р•Р™РўРРќР“ Р РћРўР—Р«Р’Р«
        ratingAvg: Number(user.ratingAvg) || 0,
        ratingCount: user.ratingCount || 0,
        // рџЋ­ РќРРљ
        premiumPlan: user.premiumPlan || 'free',
        premiumExpireAt: user.premiumExpireAt,
        nicknameUpdatedAt: user.nicknameUpdatedAt,
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
    // SECURITY: Log auth failures
    if (e.message.includes('подпись') || e.message.includes('устарел')) {
      console.warn(`[SECURITY] Auth error in app-profile: ${e.message}`);
    } else {
      console.error('app-profile error:', e);
    }
    return res.status(401).json({ ok: false, error: e.message });
  }
};
