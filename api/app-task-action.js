// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// API: детали задания + действия (взять/отказаться/голосовать)
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const crypto = require('crypto');
const { query } = require('../lib/db');
const {
  addExperience,
  checkDailyQuests,
  checkAchievements,
  notifyLevelUp,
  notifyAchievements,
  calcCommission,
  recordPlatformEarning,
  getStreakMultiplier,
  processReferralEarnings,
  notifyReferralEarnings,
} = require('../lib/helpers');
const { sendMessage } = require('../lib/telegram');
const { applyBoost } = require('../lib/shop');

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

const getTaskDetail = async (taskId, userId) => {
  const r = await query(
    `SELECT t.id, t.title, t.description, t.reward, t.status, t."playerId",
            t."videoUrl", t."createdAt", t."deadlineAt",
            u.id AS "creatorId", u.name AS "creatorName",
            COALESCE(u."displayName", u.name) AS "creatorDisplay",
            p.id AS "playerIdRef", p.name AS "playerName",
            COALESCE(p."displayName", p.name) AS "playerDisplay"
     FROM "Task" t
     JOIN "User" u ON t."creatorId" = u.id
     LEFT JOIN "User" p ON t."playerId" = p.id
     WHERE t.id = $1`,
    [taskId]
  );
  if (r.rows.length === 0) return null;
  const t = r.rows[0];

  const vr = await query(
    `SELECT value, COUNT(*)::int AS cnt FROM "Vote" WHERE "taskId"=$1 GROUP BY value`,
    [taskId]
  );
  const approve = vr.rows.find(x => x.value === 'approve')?.cnt || 0;
  const reject = vr.rows.find(x => x.value === 'reject')?.cnt || 0;

  const votedRes = await query(
    `SELECT value FROM "Vote" WHERE "taskId"=$1 AND "voterId"=$2`,
    [taskId, userId]
  );
  const myVote = votedRes.rows[0]?.value || null;

  const isPlayer = t.playerIdRef === userId;
  const isCreator = t.creatorId === userId;

  // ⭐ Проверка: оставлял ли текущий юзер отзыв по этому заданию
  const reviewRes = await query(
    `SELECT 1 FROM "Review" WHERE "taskId"=$1 AND "reviewerId"=$2 LIMIT 1`,
    [taskId, userId]
  );
  const hasReview = reviewRes.rows.length > 0;

  return {
    id: t.id,
    title: t.title,
    description: t.description || '',
    reward: t.reward,
    status: t.status,
    approve,
    reject,
    myVote,
    creatorId: t.creatorId,
    creatorName: t.creatorDisplay || t.creatorName,
    playerId: t.playerIdRef,
    playerName: t.playerDisplay || t.playerName,
    hasVideo: !!t.videoUrl,
    videoUrl: t.videoUrl,
    deadlineAt: t.deadlineAt,
    createdAt: t.createdAt,
    isCreator,
    isPlayer,
    canUpload: isPlayer && t.status === 'taken',
    hasReview, // ⭐ NEW
  };
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { initData, action, taskId } = req.body;
    if (!initData) return res.status(400).json({ ok: false, error: 'initData обязателен' });

    const tgUser = verifyInitData(initData);
    const chatId = String(tgUser.id);

    const userRes = await query(
      `SELECT id, name, role, "isBanned", "roleChosen" FROM "User" WHERE "telegramChatId" = $1`,
      [chatId]
    );
    if (userRes.rows.length === 0) return res.status(403).json({ ok: false, error: 'Аккаунт не привязан' });
    const user = userRes.rows[0];
    if (user.isBanned) return res.status(403).json({ ok: false, error: 'Аккаунт заблокирован' });

    // ==== Получить детали ====
    if (!action) {
      const detail = await getTaskDetail(taskId, user.id);
      if (!detail) return res.status(404).json({ ok: false, error: 'Задание не найдено' });
      return res.status(200).json({ ok: true, task: detail, userRole: user.role });
    }

    // ==== Взять задание ====
    if (action === 'take') {
      if (!user.roleChosen) return res.status(400).json({ ok: false, error: 'Сначала выбери роль в боте' });
      if (user.role !== 'player') return res.status(400).json({ ok: false, error: 'Только игроки могут брать задания' });

      const r = await query(
        `UPDATE "Task" SET status='taken', "playerId"=$1
         WHERE id=$2 AND status='open' AND "playerId" IS NULL
         RETURNING *`,
        [user.id, taskId]
      );
      if (r.rowCount === 0) return res.status(400).json({ ok: false, error: 'Задание уже взято' });

      const t = r.rows[0];

      try {
        const xpRes = await addExperience(user.id, 5);
        await checkDailyQuests(user.id, 'task_taken', 1);
        const achs = await checkAchievements(user.id);
        await notifyLevelUp(user.id, xpRes, sendMessage);
        await notifyAchievements(user.id, achs, sendMessage);
      } catch (e) { console.error('after take:', e); }

      const cr = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [t.creatorId]);
      if (cr.rows[0]?.telegramChatId) {
        await sendMessage(cr.rows[0].telegramChatId, `🎯 *Задание взято!*\n📌 ${t.title}\n👤 ${user.name}`);
      }

      const detail = await getTaskDetail(taskId, user.id);
      return res.status(200).json({ ok: true, action: 'taken', task: detail });
    }

    // ==== Отказаться ====
    if (action === 'abandon') {
      const r = await query(
        `UPDATE "Task" SET status='open', "playerId"=NULL
         WHERE id=$1 AND "playerId"=$2 AND status='taken'
         RETURNING *`,
        [taskId, user.id]
      );
      if (r.rowCount === 0) return res.status(400).json({ ok: false, error: 'Не удалось отказаться' });

      const t = r.rows[0];
      const cr = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [t.creatorId]);
      if (cr.rows[0]?.telegramChatId) {
        await sendMessage(cr.rows[0].telegramChatId, `↩️ Игрок отказался от задания «${t.title}»`);
      }

      const detail = await getTaskDetail(taskId, user.id);
      return res.status(200).json({ ok: true, action: 'abandoned', task: detail });
    }

    // ==== Голосование ====
    if (action === 'vote_approve' || action === 'vote_reject') {
      const value = action === 'vote_approve' ? 'approve' : 'reject';

      const ex = await query(
        `SELECT id FROM "Vote" WHERE "taskId"=$1 AND "voterId"=$2`,
        [taskId, user.id]
      );
      if (ex.rows.length > 0) return res.status(400).json({ ok: false, error: 'Ты уже голосовал' });

      await query(
        `INSERT INTO "Vote" ("taskId","voterId",value,"createdAt") VALUES ($1,$2,$3,NOW())`,
        [taskId, user.id, value]
      );
      await query(`UPDATE "User" SET reputation = reputation + 1 WHERE id = $1`, [user.id]);

      try {
        const xpRes = await addExperience(user.id, 3);
        await checkDailyQuests(user.id, 'vote', 1);
        const achs = await checkAchievements(user.id);
        await notifyLevelUp(user.id, xpRes, sendMessage);
        await notifyAchievements(user.id, achs, sendMessage);
      } catch (e) { console.error('after vote:', e); }

      // Проверяем итог
      const vr = await query(
        `SELECT value, COUNT(*)::int AS cnt FROM "Vote" WHERE "taskId"=$1 GROUP BY value`,
        [taskId]
      );
      const approve = vr.rows.find(x => x.value === 'approve')?.cnt || 0;

      if (approve >= 5) {
        const tr = await query(
          `UPDATE "Task" SET status='approved' WHERE id=$1 AND status='voting' RETURNING *`,
          [taskId]
        );
        if (tr.rowCount > 0) {
          const t = tr.rows[0];

          const plr = await query('SELECT "loginStreak" FROM "User" WHERE id=$1', [t.playerId]);
          const mult = getStreakMultiplier(plr.rows[0]?.loginStreak || 0);
          let grossReward = Math.round(t.reward * mult);
          const boost = await applyBoost(t.playerId);
          if (boost) grossReward = Math.round(grossReward * boost.mult);
          const { commission, netAmount } = calcCommission(grossReward);

          await query(
            'UPDATE "User" SET balance = balance + $1, "completedTasksCount" = "completedTasksCount" + 1 WHERE id=$2',
            [netAmount, t.playerId]
          );
          await query(
            `INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt")
             VALUES ($1,'reward',$2,'completed',$3,NOW())`,
            [t.playerId, netAmount, `Выполнение "${t.title}" (комиссия ${commission} ₽)`]
          );
          await recordPlatformEarning(t.id, t.playerId, t.creatorId, grossReward);

          const xpPlayer = await addExperience(t.playerId, 50);
          await checkDailyQuests(t.playerId, 'task_completed', 1);
          const achsPlayer = await checkAchievements(t.playerId);
          await notifyLevelUp(t.playerId, xpPlayer, sendMessage);
          await notifyAchievements(t.playerId, achsPlayer, sendMessage);

          const refEarnings = await processReferralEarnings(t.playerId, netAmount);
          await notifyReferralEarnings(refEarnings, sendMessage);

          const pl = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [t.playerId]);
          if (pl.rows[0]?.telegramChatId) {
            let m = `🎉 *Задание выполнено!*\n📌 ${t.title}\n💰 +${netAmount} ₽`;
            if (commission > 0) m += `\n_Комиссия: -${commission} ₽_`;
            if (mult > 1) m += `\n🔥 _Streak ×${mult}_`;
            if (boost) m += `\n⚡ _${boost.name}_`;
            await sendMessage(pl.rows[0].telegramChatId, m);
          }
          const cr = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [t.creatorId]);
          if (cr.rows[0]?.telegramChatId) {
            await sendMessage(cr.rows[0].telegramChatId, `✅ *Задание "${t.title}" выполнено!*`);
          }
        }
      }

      const detail = await getTaskDetail(taskId, user.id);
      return res.status(200).json({ ok: true, action: value, task: detail });
    }

    return res.status(400).json({ ok: false, error: 'Неизвестное действие' });
  } catch (e) {
    console.error('app-task-action error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};