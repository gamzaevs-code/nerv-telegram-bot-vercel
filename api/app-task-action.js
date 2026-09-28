// в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬
// API: РґРµС‚Р°Р»Рё Р·Р°РґР°РЅРёСЏ + РґРµР№СЃС‚РІРёСЏ (РІР·СЏС‚СЊ/РѕС‚РєР°Р·Р°С‚СЊСЃСЏ/РіРѕР»РѕСЃРѕРІР°С‚СЊ)
// в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬
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
const { notifyUser } = require('../lib/notify');
const { applyBoost } = require('../lib/shop');

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

  const reviewRes = await query(
    `SELECT 1 FROM "Review" WHERE "taskId"=$1 AND "reviewerId"=$2 LIMIT 1`,
    [taskId, userId]
  );
  const hasReview = reviewRes.rows.length > 0;

  return {
    id: t.id, title: t.title, description: t.description || '',
    reward: t.reward, status: t.status,
    approve, reject, myVote,
    creatorId: t.creatorId, creatorName: t.creatorDisplay || t.creatorName,
    playerId: t.playerIdRef, playerName: t.playerDisplay || t.playerName,
    hasVideo: !!t.videoUrl, videoUrl: t.videoUrl,
    deadlineAt: t.deadlineAt, createdAt: t.createdAt,
    isCreator, isPlayer,
    canUpload: isPlayer && t.status === 'taken',
    hasReview,
  };
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { initData, action, taskId } = req.body;
    if (!initData) return res.status(400).json({ ok: false, error: 'initData РѕР±СЏР·Р°С‚РµР»РµРЅ' });

    const tgUser = verifyInitData(initData);
    const chatId = String(tgUser.id);

    const userRes = await query(
      `SELECT id, name, role, "isBanned", "roleChosen" FROM "User" WHERE "telegramChatId" = $1`,
      [chatId]
    );
    if (userRes.rows.length === 0) return res.status(403).json({ ok: false, error: 'РђРєРєР°СѓРЅС‚ РЅРµ РїСЂРёРІСЏР·Р°РЅ' });
    const user = userRes.rows[0];
    if (user.isBanned) return res.status(403).json({ ok: false, error: 'РђРєРєР°СѓРЅС‚ Р·Р°Р±Р»РѕРєРёСЂРѕРІР°РЅ' });

    if (!action) {
      const detail = await getTaskDetail(taskId, user.id);
      if (!detail) return res.status(404).json({ ok: false, error: 'Р—Р°РґР°РЅРёРµ РЅРµ РЅР°Р№РґРµРЅРѕ' });
      return res.status(200).json({ ok: true, task: detail, userRole: user.role });
    }

    // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ Р’Р—РЇРўР¬ в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
    if (action === 'take') {
      if (!user.roleChosen) return res.status(400).json({ ok: false, error: 'РЎРЅР°С‡Р°Р»Р° РІС‹Р±РµСЂРё СЂРѕР»СЊ РІ Р±РѕС‚Рµ' });
      if (user.role !== 'player') return res.status(400).json({ ok: false, error: 'РўРѕР»СЊРєРѕ РёРіСЂРѕРєРё РјРѕРіСѓС‚ Р±СЂР°С‚СЊ Р·Р°РґР°РЅРёСЏ' });

      const r = await query(
        `UPDATE "Task" SET status='taken', "playerId"=$1
         WHERE id=$2 AND status='open' AND "playerId" IS NULL
         RETURNING *`,
        [user.id, taskId]
      );
      if (r.rowCount === 0) return res.status(400).json({ ok: false, error: 'Р—Р°РґР°РЅРёРµ СѓР¶Рµ РІР·СЏС‚Рѕ' });

      const t = r.rows[0];

      try {
        const xpRes = await addExperience(user.id, 5);
        await checkDailyQuests(user.id, 'task_taken', 1);
        const achs = await checkAchievements(user.id);
        await notifyLevelUp(user.id, xpRes, sendMessage);
        await notifyAchievements(user.id, achs, sendMessage);
      } catch (e) { console.error('after take:', e); }

      await notifyUser(t.creatorId, {
        message: `рџЋЇ Р—Р°РґР°РЅРёРµ "${t.title}" РІР·СЏС‚Рѕ РёРіСЂРѕРєРѕРј ${user.name}`,
        pushText: `рџЋЇ *Р—Р°РґР°РЅРёРµ РІР·СЏС‚Рѕ!*\nрџ“Њ ${t.title}\nрџ‘¤ ${user.name}`,
        type: 'task',
        icon: 'рџЋЇ',
        linkType: 'task',
        linkId: t.id,
      });

      const detail = await getTaskDetail(taskId, user.id);
      return res.status(200).json({ ok: true, action: 'taken', task: detail });
    }

    // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ РћРўРљРђР—РђРўР¬РЎРЇ в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
    if (action === 'abandon') {
      const r = await query(
        `UPDATE "Task" SET status='open', "playerId"=NULL
         WHERE id=$1 AND "playerId"=$2 AND status='taken'
         RETURNING *`,
        [taskId, user.id]
      );
      if (r.rowCount === 0) return res.status(400).json({ ok: false, error: 'РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєР°Р·Р°С‚СЊСЃСЏ' });

      const t = r.rows[0];
      await notifyUser(t.creatorId, {
        message: `в†©пёЏ РРіСЂРѕРє РѕС‚РєР°Р·Р°Р»СЃСЏ РѕС‚ Р·Р°РґР°РЅРёСЏ В«${t.title}В»`,
        pushText: `в†©пёЏ *РРіСЂРѕРє РѕС‚РєР°Р·Р°Р»СЃСЏ*\nрџ“Њ ${t.title}\n\n_Р—Р°РґР°РЅРёРµ СЃРЅРѕРІР° РѕС‚РєСЂС‹С‚Рѕ._`,
        type: 'task',
        icon: 'в†©пёЏ',
        linkType: 'task',
        linkId: t.id,
      });

      const detail = await getTaskDetail(taskId, user.id);
      return res.status(200).json({ ok: true, action: 'abandoned', task: detail });
    }

    // в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ Р“РћР›РћРЎРћР’РђРќРР• в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
    if (action === 'vote_approve' || action === 'vote_reject') {
      const value = action === 'vote_approve' ? 'approve' : 'reject';

      // РџР РћР’Р•Р РљРђ: СЋР·РµСЂ СѓР¶Рµ РіРѕР»РѕСЃРѕРІР°Р» (FIXED: РїСЂРѕРІРµСЂРєР° РёРґРµРјРїРѕС‚РµРЅС‚РЅРѕСЃС‚Рё)
      const existingVote = await query(
        `SELECT id, value FROM "Vote" WHERE "taskId"=$1 AND "voterId"=$2`,
        [taskId, user.id]
      );
      if (existingVote.rows.length > 0) return res.status(400).json({ ok: false, error: 'РўС‹ СѓР¶Рµ РіРѕР»РѕСЃРѕРІР°Р»' });

      // Р”РѕР±Р°РІРёС‚СЊ РіРѕР»РѕСЃ
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

      const vr = await query(
        `SELECT value, COUNT(*)::int AS cnt FROM "Vote" WHERE "taskId"=$1 GROUP BY value`,
        [taskId]
      );
      const approve = vr.rows.find(x => x.value === 'approve')?.cnt || 0;
      const reject = vr.rows.find(x => x.value === 'reject')?.cnt || 0;

      // в”Ђв”Ђ 5+ рџ‘Ќ в†’ approved в”Ђв”Ђ
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
            [t.playerId, netAmount, `Р’С‹РїРѕР»РЅРµРЅРёРµ "${t.title}" (РєРѕРјРёСЃСЃРёСЏ ${commission} в‚Ѕ)`]
          );
          await recordPlatformEarning(t.id, t.playerId, t.creatorId, grossReward);

          const xpPlayer = await addExperience(t.playerId, 50);
          await checkDailyQuests(t.playerId, 'task_completed', 1);
          const achsPlayer = await checkAchievements(t.playerId);

          let m = `рџЋ‰ *Р—Р°РґР°РЅРёРµ РІС‹РїРѕР»РЅРµРЅРѕ!*\nрџ“Њ ${t.title}\nрџ’° +${netAmount} в‚Ѕ`;
          if (commission > 0) m += `\n_РљРѕРјРёСЃСЃРёСЏ: -${commission} в‚Ѕ_`;
          if (mult > 1) m += `\nрџ”Ґ _Streak Г—${mult}_`;
          if (boost) m += `\nвљЎ _${boost.name}_`;

          await notifyUser(t.playerId, {
            message: `рџЋ‰ Р—Р°РґР°РЅРёРµ "${t.title}" РІС‹РїРѕР»РЅРµРЅРѕ! +${netAmount} в‚Ѕ`,
            pushText: m,
            type: 'task',
            icon: 'рџЋ‰',
            linkType: 'task',
            linkId: t.id,
          });

          await notifyLevelUp(t.playerId, xpPlayer, sendMessage);
          await notifyAchievements(t.playerId, achsPlayer, sendMessage);

          const refEarnings = await processReferralEarnings(t.playerId, netAmount);
          await notifyReferralEarnings(refEarnings, sendMessage);

          await notifyUser(t.creatorId, {
            message: `вњ… Р—Р°РґР°РЅРёРµ "${t.title}" РІС‹РїРѕР»РЅРµРЅРѕ! РћСЃС‚Р°РІСЊ РѕС‚Р·С‹РІ РёРіСЂРѕРєСѓ.`,
            pushText: `вњ… *Р—Р°РґР°РЅРёРµ РІС‹РїРѕР»РЅРµРЅРѕ!*\nрџ“Њ ${t.title}\n\n_РћСЃС‚Р°РІСЊ РѕС‚Р·С‹РІ РёРіСЂРѕРєСѓ вЂ” РєРЅРѕРїРєР° В«в­ђ РћСЃС‚Р°РІРёС‚СЊ РѕС‚Р·С‹РІВ» РІ РїСЂРѕС„РёР»Рµ._`,
            type: 'task',
            icon: 'вњ…',
            linkType: 'task',
            linkId: t.id,
          });
        }
      }

      // в”Ђв”Ђ 5+ рџ‘Ћ в†’ rejected (РќРћР’РћР•) в”Ђв”Ђ
      if (reject >= 5) {
        const tr = await query(
          `UPDATE "Task" SET status='rejected' WHERE id=$1 AND status='voting' RETURNING *`,
          [taskId]
        );
        if (tr.rowCount > 0) {
          const t = tr.rows[0];

          await notifyUser(t.playerId, {
            message: `вќЊ Р—Р°РґР°РЅРёРµ "${t.title}" РѕС‚РєР»РѕРЅРµРЅРѕ`,
            pushText: `вќЊ *Р—Р°РґР°РЅРёРµ РѕС‚РєР»РѕРЅРµРЅРѕ*\nрџ“Њ ${t.title}\n\n_Р—СЂРёС‚РµР»Рё РїСЂРѕРіРѕР»РѕСЃРѕРІР°Р»Рё РїСЂРѕС‚РёРІ._`,
            type: 'task',
            icon: 'вќЊ',
            linkType: 'task',
            linkId: t.id,
          });

          await query('UPDATE "User" SET balance = balance + $1 WHERE id=$2', [t.reward, t.creatorId]);
          await query(
            `INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt")
             VALUES ($1,'refund',$2,'completed',$3,NOW())`,
            [t.creatorId, t.reward, `Р’РѕР·РІСЂР°С‚ Р·Р° "${t.title}" (РѕС‚РєР»РѕРЅРµРЅРѕ)`]
          );

          await notifyUser(t.creatorId, {
            message: `вќЊ Р—Р°РґР°РЅРёРµ "${t.title}" РѕС‚РєР»РѕРЅРµРЅРѕ. Р’РѕР·РІСЂР°С‚ ${t.reward} в‚Ѕ`,
            pushText: `вќЊ *Р—Р°РґР°РЅРёРµ РѕС‚РєР»РѕРЅРµРЅРѕ*\nрџ“Њ ${t.title}\n\nрџ’° Р’РѕР·РІСЂР°С‚: *+${t.reward} в‚Ѕ*`,
            type: 'task',
            icon: 'рџ’°',
            linkType: 'task',
            linkId: t.id,
          });
        }
      }

      const detail = await getTaskDetail(taskId, user.id);
      return res.status(200).json({ ok: true, action: value, task: detail });
    }

    return res.status(400).json({ ok: false, error: 'РќРµРёР·РІРµСЃС‚РЅРѕРµ РґРµР№СЃС‚РІРёРµ' });
  } catch (e) {
    // SECURITY: Log auth failures
    if (e.message.includes('подпись') || e.message.includes('устарел')) {
      console.warn(`[SECURITY] Auth error in app-task-action: ${e.message}`);
    } else {
      console.error('app-task-action error:', e);
    }
    return res.status(500).json({ ok: false, error: e.message });
  }
};