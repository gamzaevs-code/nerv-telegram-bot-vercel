const { query } = require('./db');

// ========== XP И УРОВНИ ==========

const calcLevel = (exp) => Math.floor(Math.sqrt(exp / 50)) + 1;

const addExperience = async (userId, amount) => {
  try {
    const r = await query('SELECT level, experience FROM "User" WHERE id=$1', [userId]);
    if (r.rows.length === 0) return null;
    const oldLevel = r.rows[0].level || 1;
    const oldExp = r.rows[0].experience || 0;
    const newExp = oldExp + amount;
    const newLevel = calcLevel(newExp);
    await query('UPDATE "User" SET experience=$1, level=$2 WHERE id=$3', [newExp, newLevel, userId]);
    return { oldLevel, newLevel, expGained: amount, levelUp: newLevel > oldLevel };
  } catch (e) {
    console.error('addExperience:', e);
    return null;
  }
};

const getStreakMultiplier = (streak) => {
  if (streak >= 14) return 2.0;
  if (streak >= 7) return 1.5;
  if (streak >= 3) return 1.2;
  return 1.0;
};

// ========== ЕЖЕДНЕВНЫЕ КВЕСТЫ ==========

const checkDailyQuests = async (userId, actionType, amount = 1) => {
  try {
    const quests = await query(
      `SELECT id, description, reward, "requirementValue" FROM "DailyQuest" WHERE "requirementType"=$1`,
      [actionType]
    );
    if (quests.rows.length === 0) return [];

    const rewards = [];
    for (const q of quests.rows) {
      const existing = await query(
        `SELECT progress, completed FROM "UserDailyQuest"
         WHERE "userId"=$1 AND "questId"=$2 AND date = CURRENT_DATE`,
        [userId, q.id]
      );

      const progress = existing.rows[0]?.progress || 0;
      if (existing.rows[0]?.completed) continue;

      const newProgress = progress + amount;
      const newCompleted = newProgress >= q.requirementValue;

      if (existing.rows.length > 0) {
        await query(
          `UPDATE "UserDailyQuest" SET progress=$1, completed=$2
           WHERE "userId"=$3 AND "questId"=$4 AND date = CURRENT_DATE`,
          [newProgress, newCompleted, userId, q.id]
        );
      } else {
        await query(
          `INSERT INTO "UserDailyQuest" ("userId","questId",progress,completed,date)
           VALUES ($1,$2,$3,$4,CURRENT_DATE)`,
          [userId, q.id, newProgress, newCompleted]
        );
      }

      if (newCompleted) {
        await query('UPDATE "User" SET balance = balance + $1 WHERE id=$2', [q.reward, userId]);
        await query(
          `INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt")
           VALUES ($1,'quest_reward',$2,'completed',$3,NOW())`,
          [userId, q.reward, `Квест: ${q.description}`]
        );
        rewards.push({ description: q.description, reward: q.reward });
      }
    }
    return rewards;
  } catch (e) {
    console.error('checkDailyQuests:', e);
    return [];
  }
};

// ========== УВЕДОМЛЕНИЯ ==========

const notifyLevelUp = async (userId, levelInfo, sendMessageFn) => {
  if (!levelInfo || !levelInfo.levelUp) return;
  try {
    const bonus = levelInfo.newLevel * 50;
    await query('UPDATE "User" SET balance = balance + $1 WHERE id=$2', [bonus, userId]);
    await query(
      `INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt")
       VALUES ($1,'level_bonus',$2,'completed',$3,NOW())`,
      [userId, bonus, `Повышение до уровня ${levelInfo.newLevel}`]
    );
    const r = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [userId]);
    if (r.rows[0]?.telegramChatId) {
      await sendMessageFn(
        r.rows[0].telegramChatId,
        `🎉 *Уровень повышен!*\n\nТы достиг *${levelInfo.newLevel}* уровня!\n💰 Бонус: +${bonus} ₽`
      );
    }
  } catch (e) {
    console.error('notifyLevelUp:', e);
  }
};

const notifyAchievements = async (userId, achievements, sendMessageFn) => {
  if (!achievements || achievements.length === 0) return;
  try {
    const r = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [userId]);
    if (!r.rows[0]?.telegramChatId) return;
    for (const a of achievements) {
      await sendMessageFn(
        r.rows[0].telegramChatId,
        `🎖 *Новое достижение!*\n\n${a.icon} *${a.name}*\n💰 +${a.reward} ₽`
      );
    }
  } catch (e) {
    console.error('notifyAchievements:', e);
  }
};

const notifyReferralEarnings = async (earnings, sendMessageFn) => {
  if (!earnings || earnings.length === 0) return;
  for (const e of earnings) {
    if (!e.chatId) continue;
    try {
      await sendMessageFn(
        e.chatId,
        `💸 *Реферальный бонус!*\n\nУровень: *${e.level}*\n💰 +${e.bonus} ₽`
      );
    } catch (err) {
      console.error('notifyReferralEarnings:', err);
    }
  }
};

// ========== ДОСТИЖЕНИЯ ==========

const checkAchievements = async (userId) => {
  try {
    const u = await query(
      `SELECT balance, reputation, "loginStreak",
              (SELECT COUNT(*)::int FROM "Task" WHERE "playerId"=$1 AND status='approved') AS tasks_completed,
              (SELECT COUNT(*)::int FROM "Task" WHERE "creatorId"=$1) AS tasks_created,
              (SELECT COUNT(*)::int FROM "Message" WHERE "fromUserId"=$1) AS messages_sent,
              (SELECT COUNT(*)::int + 1 FROM "User" WHERE reputation > (SELECT reputation FROM "User" WHERE id=$1)) AS rank
       FROM "User" WHERE id=$1`,
      [userId]
    );
    if (u.rows.length === 0) return [];
    const s = u.rows[0];

    const conditions = {
      tasks_completed_1: s.tasks_completed >= 1,
      tasks_completed_5: s.tasks_completed >= 5,
      tasks_completed_10: s.tasks_completed >= 10,
      tasks_created_5: s.tasks_created >= 5,
      balance_5000: s.balance >= 5000,
      reputation_50: s.reputation >= 50,
      streak_7: s.loginStreak >= 7,
      streak_30: s.loginStreak >= 30,
      messages_10: s.messages_sent >= 10,
      rank_1: s.rank === 1,
    };

    const all = await query('SELECT id, name, icon, reward, "conditionType" FROM "Achievement"');
    const unlocked = await query('SELECT "achievementId" FROM "UserAchievement" WHERE "userId"=$1', [userId]);
    const unlockedIds = new Set(unlocked.rows.map(r => r.achievementId));

    const newAchievements = [];
    for (const a of all.rows) {
      if (unlockedIds.has(a.id)) continue;
      if (conditions[a.conditionType]) {
        await query(
          'INSERT INTO "UserAchievement" ("userId","achievementId","unlockedAt") VALUES ($1,$2,NOW())',
          [userId, a.id]
        );
        await query('UPDATE "User" SET balance = balance + $1 WHERE id=$2', [a.reward, userId]);
        await query(
          `INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt")
           VALUES ($1,'achievement',$2,'completed',$3,NOW())`,
          [userId, a.reward, `Достижение: ${a.name}`]
        );
        newAchievements.push(a);
      }
    }
    return newAchievements;
  } catch (e) {
    console.error('checkAchievements:', e);
    return [];
  }
};

// ========== РЕФЕРАЛЫ ==========

const processReferralEarnings = async (userId, sourceAmount) => {
  try {
    const alreadyEarned = await query(
      `SELECT id FROM "ReferralEarning" WHERE "fromUserId"=$1 LIMIT 1`,
      [userId]
    );
    if (alreadyEarned.rows.length > 0) return [];

    const levels = [
      { level: 1, percent: 0.10 },
      { level: 2, percent: 0.05 },
      { level: 3, percent: 0.02 },
    ];

    const earnings = [];
    let currentUserId = userId;
    let referrerRow = await query('SELECT "referredBy" FROM "User" WHERE id=$1', [currentUserId]);
    let referrerId = referrerRow.rows[0]?.referredBy;

    for (const { level, percent } of levels) {
      if (!referrerId) break;

      const bonus = Math.max(Math.round(sourceAmount * percent), 5);
      await query('UPDATE "User" SET balance = balance + $1 WHERE id=$2', [bonus, referrerId]);
      await query(
        `INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt")
         VALUES ($1,'referral_bonus',$2,'completed',$3,NOW())`,
        [referrerId, bonus, `Реферальный бонус (уровень ${level})`]
      );
      await query(
        `INSERT INTO "ReferralEarning" ("userId","fromUserId",level,amount,"createdAt")
         VALUES ($1,$2,$3,$4,NOW())`,
        [referrerId, userId, level, bonus]
      );

      const entry = { level, userId: referrerId, bonus };
      const refChat = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [referrerId]);
      if (refChat.rows[0]?.telegramChatId) entry.chatId = refChat.rows[0].telegramChatId;
      earnings.push(entry);

      const nextRef = await query('SELECT "referredBy" FROM "User" WHERE id=$1', [referrerId]);
      referrerId = nextRef.rows[0]?.referredBy;
      currentUserId = referrerId;
    }

    return earnings;
  } catch (e) {
    console.error('processReferralEarnings:', e);
    return [];
  }
};

// ========== АВТОПОСТИНГ В КАНАЛ ==========

const postTaskToChannel = async (taskId, title, description, reward, creatorName, sendMessageFn) => {
  try {
    const channelId = process.env.CHANNEL_ID;
    if (!channelId) return;
    const text =
      `📢 *Новое задание!*\n\n` +
      `📌 *${title}*\n` +
      `📝 ${(description || '—').slice(0, 200)}\n` +
      `💰 *${reward} ₽*\n` +
      `👤 ${creatorName}\n\n` +
      `🎯 @nerv_05bot`;
    await sendMessageFn(channelId, text, 'Markdown', {
      inline_keyboard: [[{ text: '🎯 Открыть', url: `https://t.me/nerv_05bot?start=task_${taskId}` }]],
    });
  } catch (e) {
    console.error('postTaskToChannel:', e);
  }
};

// ========== КОМИССИЯ ПЛАТФОРМЫ ==========

const PLATFORM_COMMISSION_RATE = 0.11; // 11%

const calcCommission = (grossAmount) => {
  const commission = Math.round(grossAmount * PLATFORM_COMMISSION_RATE);
  const netAmount = grossAmount - commission;
  return { grossAmount, commission, netAmount, rate: PLATFORM_COMMISSION_RATE };
};

const recordPlatformEarning = async (taskId, playerId, creatorId, grossAmount) => {
  try {
    const { commission, netAmount } = calcCommission(grossAmount);
    await query(
      `INSERT INTO "PlatformEarning" ("taskId","playerId","creatorId","grossAmount","commission","netAmount","createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
      [taskId, playerId, creatorId, grossAmount, commission, netAmount]
    );
    return { commission, netAmount };
  } catch (e) {
    console.error('recordPlatformEarning:', e);
    return null;
  }
};

const getPlatformStats = async (period = 'all') => {
  try {
    let whereClause = '';
    if (period === 'day') whereClause = `WHERE "createdAt" >= NOW() - INTERVAL '1 day'`;
    else if (period === 'week') whereClause = `WHERE "createdAt" >= NOW() - INTERVAL '7 days'`;
    else if (period === 'month') whereClause = `WHERE "createdAt" >= NOW() - INTERVAL '30 days'`;

    const r = await query(
      `SELECT COUNT(*)::int AS deals,
              COALESCE(SUM("grossAmount"),0)::int AS gross,
              COALESCE(SUM("commission"),0)::int AS commission,
              COALESCE(SUM("netAmount"),0)::int AS net
       FROM "PlatformEarning" ${whereClause}`
    );
    return r.rows[0];
  } catch (e) {
    console.error('getPlatformStats:', e);
    return { deals: 0, gross: 0, commission: 0, net: 0 };
  }
};

// ========== EXPORT ==========

module.exports = {
  calcLevel,
  addExperience,
  getStreakMultiplier,
  checkDailyQuests,
  notifyLevelUp,
  notifyAchievements,
  notifyReferralEarnings,
  checkAchievements,
  processReferralEarnings,
  postTaskToChannel,
  PLATFORM_COMMISSION_RATE,
  calcCommission,
  recordPlatformEarning,
  getPlatformStats,
};