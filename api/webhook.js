const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function query(sql, params = []) {
  return pool.query(sql, params);
}

const userState = {};

// ========== ХЕЛПЕРЫ ДЛЯ ЭТАПА 2 ==========

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
  } catch (e) { console.error('addExperience:', e); return null; }
};

const getStreakMultiplier = (streak) => {
  if (streak >= 14) return 2.0;
  if (streak >= 7) return 1.5;
  if (streak >= 3) return 1.2;
  return 1.0;
};

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

      let progress = existing.rows[0]?.progress || 0;
      const wasCompleted = existing.rows[0]?.completed || false;
      if (wasCompleted) continue;

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
  } catch (e) { console.error('checkDailyQuests:', e); return []; }
};

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
  } catch (e) { console.error('notifyLevelUp:', e); }
};

// ========== ХЕЛПЕРЫ ДЛЯ ЭТАПА 3.1 ==========

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
        await query('INSERT INTO "UserAchievement" ("userId","achievementId","unlockedAt") VALUES ($1,$2,NOW())', [userId, a.id]);
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
  } catch (e) { console.error('checkAchievements:', e); return []; }
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
  } catch (e) { console.error('notifyAchievements:', e); }
};

// ========== ХЕЛПЕРЫ ДЛЯ ЭТАПА 3.2 ==========

const processReferralEarnings = async (userId, sourceAmount, reason = 'Награда реферала') => {
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
        [referrerId, bonus, `Реферальный бонус (уровень ${level}) от пользователя #${userId}`]
      );
      await query(
        `INSERT INTO "ReferralEarning" ("userId","fromUserId",level,amount,"createdAt")
         VALUES ($1,$2,$3,$4,NOW())`,
        [referrerId, userId, level, bonus]
      );

      const entry = { level, userId: referrerId, bonus };

      const refChat = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [referrerId]);
      if (refChat.rows[0]?.telegramChatId) {
        entry.chatId = refChat.rows[0].telegramChatId;
      }

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

const notifyReferralEarnings = async (earnings, sendMessageFn) => {
  if (!earnings || earnings.length === 0) return;
  for (const e of earnings) {
    if (!e.chatId) continue;
    try {
      await sendMessageFn(
        e.chatId,
        `💸 *Реферальный бонус!*\n\nУровень: *${e.level}*\n💰 +${e.bonus} ₽\n\n_Спасибо, что приглашаешь друзей!_`
      );
    } catch (err) { console.error('notifyReferralEarnings:', err); }
  }
};

// ========== КОНЕЦ ХЕЛПЕРОВ ==========

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('OK');

  try {
    const { message, callback_query } = req.body;
    const token = process.env.BOT_TOKEN;
    if (!token) return res.status(500).send('No token');

    const sendMessage = async (chatId, text, parse_mode = 'Markdown', reply_markup = null) => {
      const payload = { chat_id: chatId, text, parse_mode };
      if (reply_markup) payload.reply_markup = reply_markup;
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    };

    const getUser = async (chatId) => {
      try {
        const r = await query(
          `SELECT id, name, "displayName", balance, reputation, role, "referralCode",
                  "loginStreak", "lastDailyBonusAt", "telegramChatId", level, experience,
                  "isBanned", "isModerator"
           FROM "User" WHERE "telegramChatId" = $1`,
          [String(chatId)]
        );
        return r.rows[0] || null;
      } catch (e) { console.error('getUser:', e); return null; }
    };

    const getUserById = async (id) => {
      try {
        const r = await query(
          `SELECT id, name, "displayName", balance, reputation, role, level, experience FROM "User" WHERE id = $1`,
          [id]
        );
        return r.rows[0] || null;
      } catch { return null; }
    };

    // ============ CALLBACK QUERY ============
    if (callback_query) {
      const chatId = callback_query.message?.chat?.id || callback_query.from.id;
      const messageId = callback_query.message?.message_id;
      const data = callback_query.data;

      const edit = async (text, parse_mode = 'Markdown', reply_markup = null) => {
        const payload = { chat_id: chatId, message_id: messageId, text, parse_mode };
        if (reply_markup) payload.reply_markup = reply_markup;
        await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      };

      const user = await getUser(chatId);

      if (user && user.isBanned) {
        await edit('🚫 *Вы заблокированы.*\n\nОбратитесь в поддержку.', 'Markdown', { inline_keyboard: [] });
        return res.status(200).send('OK');
      }

      const isAdmin = user && user.role === 'admin';
      const isModerator = user && (user.isModerator || user.role === 'admin');

      // ---- АДМИН-ПАНЕЛЬ ----
      if (data === 'admin_panel') {
        if (!isAdmin) { await edit('⛔ *Доступ запрещён.*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        await edit('⚙️ *Админ-панель*\n\nВыберите действие:', 'Markdown', {
          inline_keyboard: [
            [{ text: '👥 Все пользователи', callback_data: 'admin_users' }],
            [{ text: '📋 Все задания', callback_data: 'admin_tasks' }],
            [{ text: '📊 Статистика', callback_data: 'admin_stats' }],
            [{ text: '🔙 Назад', callback_data: 'menu' }],
          ],
        });
        return res.status(200).send('OK');
      }

      if (data === 'admin_users') {
        if (!isAdmin) { await edit('⛔ *Доступ запрещён.*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        try {
          const r = await query(`SELECT id, name, email, role, balance, reputation, level FROM "User" ORDER BY "createdAt" DESC LIMIT 20`);
          let text = '👥 *Последние 20 пользователей:*\n\n';
          r.rows.forEach(u => { text += `🆔 ${u.id} | ${u.name} (${u.email})\n   Роль: ${u.role}, Ур: ${u.level}, Баланс: ${u.balance}₽\n\n`; });
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_panel' }]] });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_panel' }]] }); }
        return res.status(200).send('OK');
      }

      if (data === 'admin_tasks') {
        if (!isAdmin) { await edit('⛔ *Доступ запрещён.*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        try {
          const r = await query(`SELECT t.id, t.title, t.reward, t.status, u.name AS creator, p.name AS player FROM "Task" t JOIN "User" u ON t."creatorId" = u.id LEFT JOIN "User" p ON t."playerId" = p.id ORDER BY t."createdAt" DESC LIMIT 20`);
          let text = '📋 *Последние 20 заданий:*\n\n';
          r.rows.forEach(t => { text += `🆔 ${t.id} | ${t.title}\n   Награда: ${t.reward}₽, Статус: ${t.status}\n   Создатель: ${t.creator}\n`; if (t.player) text += `   Игрок: ${t.player}\n`; text += '\n'; });
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_panel' }]] });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_panel' }]] }); }
        return res.status(200).send('OK');
      }

      if (data === 'admin_stats') {
        if (!isAdmin) { await edit('⛔ *Доступ запрещён.*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        try {
          const u = await query('SELECT COUNT(*)::int AS c FROM "User"');
          const t = await query('SELECT COUNT(*)::int AS c FROM "Task"');
          const v = await query('SELECT COUNT(*)::int AS c FROM "Vote"');
          const tr = await query('SELECT COUNT(*)::int AS c FROM "Transaction"');
          const b = await query('SELECT COALESCE(SUM(balance),0)::bigint AS s FROM "User"');
          const text = `📊 *Статистика:*\n\n👥 Пользователей: ${u.rows[0].c}\n📋 Заданий: ${t.rows[0].c}\n🗳️ Голосов: ${v.rows[0].c}\n💳 Транзакций: ${tr.rows[0].c}\n💰 Общий баланс: ${b.rows[0].s} ₽`;
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_panel' }]] });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_panel' }]] }); }
        return res.status(200).send('OK');
      }

      // ---- МОДЕРАЦИЯ ----
      if (data === 'mod_panel') {
        if (!isModerator) { await edit('⛔ *Доступ запрещён.*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        try {
          const openReports = await query(`SELECT COUNT(*)::int AS c FROM "Report" WHERE status='pending'`);
          const pendingTasks = await query(`SELECT COUNT(*)::int AS c FROM "Task" WHERE status='voting'`);
          const text = `👮 *Модератор-панель*\n\n🚨 Открытых жалоб: *${openReports.rows[0].c}*\n⏳ Заданий на модерации: *${pendingTasks.rows[0].c}*\n`;
          await edit(text, 'Markdown', {
            inline_keyboard: [
              [{ text: '🚨 Открытые жалобы', callback_data: 'mod_reports' }],
              [{ text: '⏳ Задания на модерации', callback_data: 'mod_pending' }],
              [{ text: '🔙 Назад', callback_data: 'menu' }],
            ],
          });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      if (data === 'mod_reports') {
        if (!isModerator) { await edit('⛔ *Доступ запрещён.*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        try {
          const r = await query(
            `SELECT r.id, r."targetId", r.reason, r."createdAt", u.name AS reporter
             FROM "Report" r JOIN "User" u ON r."reporterId" = u.id
             WHERE r.status='pending' ORDER BY r."createdAt" DESC LIMIT 10`
          );
          if (r.rows.length === 0) { await edit('📭 *Открытых жалоб нет.*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'mod_panel' }]] }); return res.status(200).send('OK'); }
          let text = '🚨 *Открытые жалобы:*\n\n';
          const buttons = [];
          r.rows.forEach((rep) => {
            text += `#${rep.id} — Задание #${rep.targetId}\n👤 От: ${rep.reporter}\n📝 ${rep.reason}\n\n`;
            buttons.push([{ text: `Задание #${rep.targetId}`, callback_data: `task_${rep.targetId}` }, { text: '✅ Закрыть', callback_data: `report_resolve_${rep.id}` }]);
          });
          buttons.push([{ text: '🔙 Назад', callback_data: 'mod_panel' }]);
          await edit(text, 'Markdown', { inline_keyboard: buttons });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'mod_panel' }]] }); }
        return res.status(200).send('OK');
      }

      if (data.startsWith('report_resolve_')) {
        const reportId = parseInt(data.split('_')[2]);
        if (!isModerator) { await edit('⛔ *Доступ запрещён.*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        try {
          await query(`UPDATE "Report" SET status='resolved', "resolvedAt"=NOW() WHERE id=$1`, [reportId]);
          await query(`INSERT INTO "ModeratorLog" ("moderatorId", action, "targetId", reason, "createdAt") VALUES ($1, 'resolve_report', $2, 'Жалоба обработана', NOW())`, [user.id, reportId]);
          await edit(`✅ *Жалоба #${reportId} закрыта*`, 'Markdown', { inline_keyboard: [[{ text: '🚨 К жалобам', callback_data: 'mod_reports' }], [{ text: '🔙 Меню', callback_data: 'menu' }]] });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'mod_panel' }]] }); }
        return res.status(200).send('OK');
      }

      if (data === 'mod_pending') {
        if (!isModerator) { await edit('⛔ *Доступ запрещён.*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        try {
          const r = await query(`SELECT id, title, reward FROM "Task" WHERE status='voting' ORDER BY "updatedAt" DESC LIMIT 15`);
          if (r.rows.length === 0) { await edit('📭 *Нет заданий на модерации.*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'mod_panel' }]] }); return res.status(200).send('OK'); }
          const buttons = [];
          r.rows.forEach(t => { buttons.push([{ text: `📌 ${t.title} (${t.reward}₽)`, callback_data: `mod_task_${t.id}` }]); });
          buttons.push([{ text: '🔙 Назад', callback_data: 'mod_panel' }]);
          await edit('⏳ *Задания на модерации:*', 'Markdown', { inline_keyboard: buttons });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'mod_panel' }]] }); }
        return res.status(200).send('OK');
      }

      if (data.startsWith('mod_task_')) {
        const taskId = parseInt(data.split('_')[2]);
        if (!isModerator) { await edit('⛔ *Доступ запрещён.*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        try {
          const r = await query(`SELECT id, title, status, "creatorId", "playerId" FROM "Task" WHERE id=$1`, [taskId]);
          if (r.rows.length === 0) { await edit('❌ *Не найдено*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
          const t = r.rows[0];
          await edit(
            `👮 *Модерация задания #${t.id}*\n\n📌 ${t.title}\n📊 Статус: ${t.status}`,
            'Markdown',
            {
              inline_keyboard: [
                [{ text: '✅ Одобрить', callback_data: `mod_approve_${t.id}` }],
                [{ text: '❌ Отклонить', callback_data: `mod_reject_${t.id}` }],
                [{ text: '🗑 Удалить', callback_data: `mod_delete_${t.id}` }],
                [{ text: '🔙 Назад', callback_data: `task_${t.id}` }],
              ],
            }
          );
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      if (data.startsWith('mod_approve_')) {
        const taskId = parseInt(data.split('_')[2]);
        if (!isModerator) { await edit('⛔ *Доступ запрещён.*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        try {
          await query(`UPDATE "Task" SET status='approved' WHERE id=$1`, [taskId]);
          await query(`INSERT INTO "ModeratorLog" ("moderatorId", action, "targetId", reason, "createdAt") VALUES ($1, 'approve_task', $2, 'Ручное одобрение', NOW())`, [user.id, taskId]);
          await edit(`✅ *Задание #${taskId} одобрено*`, 'Markdown', { inline_keyboard: [[{ text: '👮 Ещё', callback_data: `mod_task_${taskId}` }], [{ text: '🔙 Меню', callback_data: 'menu' }]] });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      if (data.startsWith('mod_reject_')) {
        const taskId = parseInt(data.split('_')[2]);
        if (!isModerator) { await edit('⛔ *Доступ запрещён.*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        try {
          await query(`UPDATE "Task" SET status='rejected' WHERE id=$1`, [taskId]);
          await query(`INSERT INTO "ModeratorLog" ("moderatorId", action, "targetId", reason, "createdAt") VALUES ($1, 'reject_task', $2, 'Ручное отклонение', NOW())`, [user.id, taskId]);
          await edit(`❌ *Задание #${taskId} отклонено*`, 'Markdown', { inline_keyboard: [[{ text: '🔙 Меню', callback_data: 'menu' }]] });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      if (data.startsWith('mod_delete_')) {
        const taskId = parseInt(data.split('_')[2]);
        if (!isModerator) { await edit('⛔ *Доступ запрещён.*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        try {
          await query(`DELETE FROM "Task" WHERE id=$1`, [taskId]);
          await query(`INSERT INTO "ModeratorLog" ("moderatorId", action, "targetId", reason, "createdAt") VALUES ($1, 'delete_task', $2, 'Удалено модератором', NOW())`, [user.id, taskId]);
          await edit(`🗑 *Задание #${taskId} удалено*`, 'Markdown', { inline_keyboard: [[{ text: '🔙 Меню', callback_data: 'menu' }]] });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      if (data.startsWith('report_task_')) {
        const taskId = parseInt(data.split('_')[2]);
        if (!user) { await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        userState[chatId] = { step: 'report_reason', taskId };
        await edit(
          '🚨 *Жалоба на задание*\n\nОпиши причину жалобы одним сообщением:\n\n_Примеры: «спам», «нарушение правил», «нецензурная лексика»_\n\n📌 Для отмены — /menu',
          'Markdown',
          { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'menu' }]] }
        );
        return res.status(200).send('OK');
      }

      // ---- МЕНЮ ----
      if (data === 'menu') {
        const keyboard = [
          [{ text: '📊 Профиль', callback_data: 'profile' }, { text: '🎖 Достижения', callback_data: 'achievements' }],
          [{ text: '📋 Доступные задания', callback_data: 'tasks' }],
          [{ text: '📝 Мои задания', callback_data: 'my_tasks' }, { text: '🎨 Мои созданные', callback_data: 'my_created' }],
          [{ text: '💰 Кошелёк', callback_data: 'wallet' }, { text: '➕ Создать', callback_data: 'create' }],
          [{ text: '🏆 Рейтинг', callback_data: 'leaderboard' }, { text: '🎁 Бонус', callback_data: 'daily' }],
          [{ text: '📅 Квесты', callback_data: 'quests' }, { text: '📈 Статистика', callback_data: 'stats' }],
          [{ text: '🔗 Рефералы', callback_data: 'referral' }, { text: '👥 Игроки', callback_data: 'players_menu' }],
          [{ text: '💬 Сообщения', callback_data: 'inbox' }, { text: '💡 Поддержка', callback_data: 'support' }],
          [{ text: '❓ Помощь', callback_data: 'help' }],
        ];
        if (isAdmin) keyboard.push([{ text: '⚙️ Админ-панель', callback_data: 'admin_panel' }]);
        if (isModerator) keyboard.push([{ text: '👮 Модерация', callback_data: 'mod_panel' }]);
        await edit('🤖 *Главное меню*', 'Markdown', { inline_keyboard: keyboard });
        return res.status(200).send('OK');
      }

      // ---- ПРОФИЛЬ ----
      if (data === 'profile') {
        if (!user) { await edit('❌ *Не привязан.* /link your@email.com', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        const rank = await query(`SELECT COUNT(*)::int + 1 AS pos FROM "User" WHERE reputation > $1`, [user.reputation]);
        const level = user.level || 1;
        const exp = user.experience || 0;
        const expForNext = Math.pow(level, 2) * 50;
        const expForCurrent = Math.pow(level - 1, 2) * 50;
        const progress = exp - expForCurrent;
        const needed = expForNext - expForCurrent;
        const pct = Math.min(Math.round((progress / needed) * 100), 100);
        const progressBar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
        await edit(
          `👤 *${user.displayName || user.name}*\n\n` +
          `🎖 Уровень: *${level}*\n` +
          `${progressBar} ${pct}%\n` +
          `_${exp} / ${expForNext} XP_\n\n` +
          `💰 Баланс: ${user.balance} ₽\n` +
          `⭐ Репутация: ${user.reputation}\n` +
          `🎮 Роль: ${user.role}${user.isModerator ? ' 👮' : ''}\n` +
          `🏅 Место: #${rank.rows[0].pos}\n` +
          `🔥 Streak: ${user.loginStreak} дн.`,
          'Markdown',
          { inline_keyboard: [[{ text: '📈 Статистика', callback_data: 'stats' }], [{ text: '🔙 Назад', callback_data: 'menu' }]] }
        );
        return res.status(200).send('OK');
      }

      // ---- КВЕСТЫ ----
      if (data === 'quests') {
        if (!user) { await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        try {
          const all = await query(`SELECT id, description, reward, "requirementValue" FROM "DailyQuest"`);
          if (all.rows.length === 0) { await edit('📅 *Квестов пока нет.*\n\nМы скоро добавим их!', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
          
          const progress = await query(
            `SELECT "questId", progress, completed FROM "UserDailyQuest"
             WHERE "userId"=$1 AND date = CURRENT_DATE`,
            [user.id]
          );
          const progressMap = {};
          progress.rows.forEach(p => { progressMap[p.questId] = p; });

          let text = '📅 *Ежедневные квесты*\n_Сброс в 00:00 МСК_\n\n';
          let totalDone = 0;
          all.rows.forEach(q => {
            const p = progressMap[q.id];
            const prog = p?.progress || 0;
            const isDone = p?.completed || false;
            if (isDone) totalDone++;
            const pct = Math.min(Math.round((prog / q.requirementValue) * 100), 100);
            const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
            text += `${isDone ? '✅' : '🔸'} *${q.description}*\n   ${bar} ${prog}/${q.requirementValue}\n   🎁 ${q.reward} ₽\n\n`;
          });
          text = `📅 *Ежедневные квесты:* ${totalDone}/${all.rows.length}\n\n` + text;
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
        } catch (e) { console.error(e); await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      // ---- СПИСОК ЗАДАНИЙ ----
      if (data === 'tasks') {
        try {
          const r = await query(`SELECT id, title, reward, status, "playerId" FROM "Task" WHERE status IN ('open','voting') ORDER BY "createdAt" DESC LIMIT 10`);
          if (r.rows.length === 0) { await edit('📭 *Нет доступных заданий.*', 'Markdown', { inline_keyboard: [[{ text: '➕ Создать задание', callback_data: 'create' }], [{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
          const isPlayer = user && user.role === 'player';
          const buttons = [];
          r.rows.forEach(t => {
            const row = [{ text: `📌 ${t.title} (${t.reward}₽)`, callback_data: `task_${t.id}` }];
            if (t.status === 'open' && isPlayer && !t.playerId) row.push({ text: '🎯 Взять', callback_data: `take_${t.id}` });
            if (t.status === 'voting') {
              row.push({ text: '✅ За', callback_data: `vote_${t.id}_approve` });
              row.push({ text: '❌ Против', callback_data: `vote_${t.id}_reject` });
            }
            buttons.push(row);
          });
          buttons.push([{ text: '🔙 Назад', callback_data: 'menu' }]);
          await edit('📋 *Доступные задания:*', 'Markdown', { inline_keyboard: buttons });
        } catch (e) { console.error(e); await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      // ---- ПРОСМОТР ЗАДАНИЯ ----
      if (data.startsWith('task_')) {
        const taskId = parseInt(data.split('_')[1]);
        try {
          const r = await query(`SELECT t.*, u.name AS creator, p.name AS player FROM "Task" t JOIN "User" u ON t."creatorId" = u.id LEFT JOIN "User" p ON t."playerId" = p.id WHERE t.id = $1`, [taskId]);
          if (r.rows.length === 0) { await edit('❌ *Не найдено*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] }); return res.status(200).send('OK'); }
          const t = r.rows[0];
          const vr = await query(`SELECT value, COUNT(*)::int AS cnt FROM "Vote" WHERE "taskId"=$1 GROUP BY value`, [taskId]);
          const approve = vr.rows.find(x => x.value === 'approve')?.cnt || 0;
          const reject = vr.rows.find(x => x.value === 'reject')?.cnt || 0;
          let text = `📌 *${t.title}*\n\n📝 ${t.description || 'Без описания'}\n💰 Награда: ${t.reward} ₽\n👤 Создатель: ${t.creator}\n📌 Статус: ${t.status}\n👍 ${approve} / 👎 ${reject}\n`;
          if (t.player) text += `🎮 Игрок: ${t.player}\n`;
          if (t.videoUrl) text += `🎬 Видео загружено\n`;
          const buttons = [];
          const isPlayer = user && user.role === 'player';
          if (t.status === 'open' && isPlayer && !t.playerId) buttons.push([{ text: '🎯 Взять задание', callback_data: `take_${t.id}` }]);
          if (user) buttons.push([{ text: '🚨 Пожаловаться', callback_data: `report_task_${t.id}` }]);
          if (isModerator) buttons.push([{ text: '👮 Модерация', callback_data: `mod_task_${t.id}` }]);
          buttons.push([{ text: '🔙 К списку', callback_data: 'tasks' }]);
          buttons.push([{ text: '🔙 В меню', callback_data: 'menu' }]);
          await edit(text, 'Markdown', { inline_keyboard: buttons });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] }); }
        return res.status(200).send('OK');
      }

      // ---- ВЗЯТИЕ ЗАДАНИЯ ----
      if (data.startsWith('take_')) {
        const taskId = parseInt(data.split('_')[1]);
        if (!user) { await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] }); return res.status(200).send('OK'); }
        if (user.role !== 'player') { await edit('❌ *Только игроки могут брать задания*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] }); return res.status(200).send('OK'); }
        try {
          const r = await query(`UPDATE "Task" SET status='taken', "playerId"=$1 WHERE id=$2 AND status='open' AND "playerId" IS NULL RETURNING *`, [user.id, taskId]);
          if (r.rowCount === 0) { await edit('❌ *Уже взято*', 'Markdown', { inline_keyboard: [[{ text: '🔙 К списку', callback_data: 'tasks' }]] }); return res.status(200).send('OK'); }
          const t = r.rows[0];
          
          const xpRes = await addExperience(user.id, 5);
          const questRewards = await checkDailyQuests(user.id, 'task_taken', 1);
          const achs = await checkAchievements(user.id);
          
          let msg = `✅ *Задание взято!*\n\n📌 ${t.title}\n💰 ${t.reward} ₽\n\n_+5 XP_\n\nОтправь видео в этот чат, чтобы сдать задание.`;
          if (questRewards.length > 0) {
            msg += '\n\n📅 *Квесты:*\n';
            questRewards.forEach(q => { msg += `✅ ${q.description} — +${q.reward} ₽\n`; });
          }
          
          await edit(msg, 'Markdown', { inline_keyboard: [[{ text: '📝 Мои задания', callback_data: 'my_tasks' }], [{ text: '🔙 В меню', callback_data: 'menu' }]] });
          await notifyLevelUp(user.id, xpRes, sendMessage);
          await notifyAchievements(user.id, achs, sendMessage);
          
          const cr = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [t.creatorId]);
          if (cr.rows[0]?.telegramChatId) await sendMessage(cr.rows[0].telegramChatId, `🎯 *Задание взято!*\n📌 ${t.title}\n👤 ${user.displayName || user.name}`);
        } catch (e) { console.error(e); await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] }); }
        return res.status(200).send('OK');
      }

      // ---- ОТКАЗ ОТ ЗАДАНИЯ ----
      if (data.startsWith('abandon_')) {
        const taskId = parseInt(data.split('_')[1]);
        if (!user) { await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'my_tasks' }]] }); return res.status(200).send('OK'); }
        try {
          const r = await query(`UPDATE "Task" SET status='open', "playerId"=NULL WHERE id=$1 AND "playerId"=$2 AND status='taken' RETURNING *`, [taskId, user.id]);
          if (r.rowCount === 0) { await edit('❌ *Не удалось отказаться*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'my_tasks' }]] }); return res.status(200).send('OK'); }
          const t = r.rows[0];
          await edit(`↩️ *Ты отказался от задания:*\n📌 ${t.title}`, 'Markdown', { inline_keyboard: [[{ text: '📝 Мои задания', callback_data: 'my_tasks' }], [{ text: '🔙 В меню', callback_data: 'menu' }]] });
          const cr = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [t.creatorId]);
          if (cr.rows[0]?.telegramChatId) await sendMessage(cr.rows[0].telegramChatId, `↩️ Игрок отказался от задания «${t.title}». Задание снова доступно.`);
        } catch (e) { console.error(e); await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'my_tasks' }]] }); }
        return res.status(200).send('OK');
      }

      // ---- ГОЛОСОВАНИЕ ----
      if (data.startsWith('vote_')) {
        const parts = data.split('_');
        const taskId = parseInt(parts[1]);
        const value = parts[2];
        if (!user) { await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] }); return res.status(200).send('OK'); }
        try {
          const ex = await query('SELECT id FROM "Vote" WHERE "taskId"=$1 AND "voterId"=$2', [taskId, user.id]);
          if (ex.rows.length > 0) { await edit('❌ *Ты уже голосовал*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] }); return res.status(200).send('OK'); }
          await query('INSERT INTO "Vote" ("taskId","voterId",value,"createdAt") VALUES ($1,$2,$3,NOW())', [taskId, user.id, value]);
          await query('UPDATE "User" SET reputation = reputation + 1 WHERE id = $1', [user.id]);
          
          const xpRes = await addExperience(user.id, 3);
          const questRewards = await checkDailyQuests(user.id, 'vote', 1);
          const achs = await checkAchievements(user.id);
          
          const vr = await query('SELECT value, COUNT(*)::int AS cnt FROM "Vote" WHERE "taskId"=$1 GROUP BY value', [taskId]);
          const approve = vr.rows.find(x => x.value === 'approve')?.cnt || 0;
          const reject = vr.rows.find(x => x.value === 'reject')?.cnt || 0;
          
          let msg = `✅ *Голос принят!*\n\n👍 За: ${approve}\n👎 Против: ${reject}\n\n_+1 репутация, +3 XP_`;
          if (questRewards.length > 0) {
            msg += '\n\n📅 *Квесты:*\n';
            questRewards.forEach(q => { msg += `✅ ${q.description} — +${q.reward} ₽\n`; });
          }
          await edit(msg, 'Markdown', { inline_keyboard: [[{ text: '🔙 К списку', callback_data: 'tasks' }]] });
          await notifyLevelUp(user.id, xpRes, sendMessage);
          await notifyAchievements(user.id, achs, sendMessage);
          
          if (approve >= 5) {
            const tr = await query(`UPDATE "Task" SET status='approved' WHERE id=$1 RETURNING *`, [taskId]);
            const t = tr.rows[0];
            
            const plr = await query('SELECT "loginStreak" FROM "User" WHERE id=$1', [t.playerId]);
            const mult = getStreakMultiplier(plr.rows[0]?.loginStreak || 0);
            const reward = Math.round(t.reward * mult);
            
            await query('UPDATE "User" SET balance = balance + $1, "completedTasksCount" = "completedTasksCount" + 1 WHERE id=$2', [reward, t.playerId]);
            await query(`INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt") VALUES ($1,'reward',$2,'completed',$3,NOW())`, [t.playerId, reward, `Выполнение "${t.title}"`]);
            
            const xpPlayer = await addExperience(t.playerId, 50);
            const qr = await checkDailyQuests(t.playerId, 'task_completed', 1);
            const achsPlayer = await checkAchievements(t.playerId);
            
            const pl = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [t.playerId]);
            if (pl.rows[0]?.telegramChatId) {
              let msgPlayer = `🎉 *Задание выполнено!*\n📌 ${t.title}\n💰 +${reward} ₽`;
              if (mult > 1) msgPlayer += `\n🔥 _Streak ×${mult}_`;
              msgPlayer += '\n_+50 XP_';
              if (qr.length > 0) {
                msgPlayer += '\n\n📅 *Квесты:*\n';
                qr.forEach(q => { msgPlayer += `✅ ${q.description} — +${q.reward} ₽\n`; });
              }
              await sendMessage(pl.rows[0].telegramChatId, msgPlayer);
            }
            await notifyLevelUp(t.playerId, xpPlayer, sendMessage);
            await notifyAchievements(t.playerId, achsPlayer, sendMessage);

            const refEarnings = await processReferralEarnings(t.playerId, reward);
            await notifyReferralEarnings(refEarnings, sendMessage);
            
            const cr = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [t.creatorId]);
            if (cr.rows[0]?.telegramChatId) await sendMessage(cr.rows[0].telegramChatId, `✅ *Задание "${t.title}" выполнено!*`);
          }
        } catch (e) { console.error(e); await edit('❌ *Ошибка голосования*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] }); }
        return res.status(200).send('OK');
      }

      // ---- МОИ ЗАДАНИЯ ----
      if (data === 'my_tasks') {
        if (!user) { await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        try {
          const r = await query(`SELECT t.id, t.title, t.reward, t.status, u.name AS creator FROM "Task" t JOIN "User" u ON t."creatorId" = u.id WHERE t."playerId"=$1 ORDER BY t."updatedAt" DESC LIMIT 15`, [user.id]);
          if (r.rows.length === 0) { await edit('📭 *У тебя нет заданий.*\n\nВозьми задание из списка!', 'Markdown', { inline_keyboard: [[{ text: '📋 Доступные', callback_data: 'tasks' }], [{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
          let text = '📝 *Твои задания:*\n\n';
          const buttons = [];
          r.rows.forEach((t, i) => {
            const statusEmoji = t.status === 'open' ? '🟢' : t.status === 'taken' ? '🟡' : t.status === 'voting' ? '🗳️' : t.status === 'approved' ? '✅' : '⚪';
            text += `${i + 1}. ${statusEmoji} *${t.title}*\n   💰 ${t.reward} ₽ · Статус: ${t.status}\n   👤 ${t.creator}\n\n`;
            const row = [{ text: `📌 ${t.title.slice(0, 25)}`, callback_data: `task_${t.id}` }];
            if (t.status === 'taken') row.push({ text: '↩️ Отказаться', callback_data: `abandon_${t.id}` });
            buttons.push(row);
          });
          buttons.push([{ text: '📋 Доступные задания', callback_data: 'tasks' }]);
          buttons.push([{ text: '🔙 Назад', callback_data: 'menu' }]);
          await edit(text, 'Markdown', { inline_keyboard: buttons });
        } catch (e) { console.error(e); await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      // ---- МОИ СОЗДАННЫЕ ----
      if (data === 'my_created') {
        if (!user) { await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        try {
          const r = await query(
            `SELECT t.id, t.title, t.reward, t.status,
                    (SELECT COUNT(*)::int FROM "Vote" WHERE "taskId"=t.id AND value='approve') AS approve,
                    (SELECT COUNT(*)::int FROM "Vote" WHERE "taskId"=t.id AND value='reject') AS reject
             FROM "Task" t WHERE t."creatorId"=$1 ORDER BY t."createdAt" DESC LIMIT 15`,
            [user.id]
          );
          if (r.rows.length === 0) { await edit('📭 *Ты ещё не создавал заданий.*\n\nНажми «➕ Создать» в меню.', 'Markdown', { inline_keyboard: [[{ text: '➕ Создать задание', callback_data: 'create' }], [{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
          let text = '🎨 *Твои созданные задания:*\n\n';
          r.rows.forEach((t, i) => {
            const statusEmoji = t.status === 'open' ? '🟢' : t.status === 'taken' ? '🟡' : t.status === 'voting' ? '🗳️' : t.status === 'approved' ? '✅' : '⚪';
            text += `${i + 1}. ${statusEmoji} *${t.title}*\n   💰 ${t.reward} ₽ · Статус: ${t.status}\n   👍 ${t.approve} / 👎 ${t.reject}\n\n`;
          });
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '➕ Создать ещё', callback_data: 'create' }], [{ text: '🔙 Назад', callback_data: 'menu' }]] });
        } catch (e) { console.error(e); await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      // ---- ДОСТИЖЕНИЯ ----
      if (data === 'achievements') {
        if (!user) { await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        try {
          const r = await query(
            `SELECT a.name, a.description, a.icon, a.reward, ua."unlockedAt"
             FROM "Achievement" a
             LEFT JOIN "UserAchievement" ua ON ua."achievementId" = a.id AND ua."userId" = $1
             ORDER BY ua."unlockedAt" DESC NULLS LAST`,
            [user.id]
          );
          if (r.rows.length === 0) { await edit('🎖 *Достижений пока нет.*\n\nМы работаем над этим!', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
          let text = '🎖 *Достижения:*\n\n';
          let unlocked = 0;
          r.rows.forEach((a) => {
            const isUnlocked = a.unlockedAt !== null;
            if (isUnlocked) unlocked++;
            text += `${isUnlocked ? '✅' : '🔒'} ${a.icon || '🏅'} *${a.name}*\n   ${a.description}\n   🎁 ${a.reward} ₽\n\n`;
          });
          text = `🎖 *Достижения:* ${unlocked}/${r.rows.length}\n\n` + text;
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
        } catch (e) { console.error(e); await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      // ---- СТАТИСТИКА ----
      if (data === 'stats') {
        if (!user) { await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        try {
          const rank = await query(`SELECT COUNT(*)::int + 1 AS pos FROM "User" WHERE reputation > $1`, [user.reputation]);
          const tasksCreated = await query(`SELECT COUNT(*)::int AS c FROM "Task" WHERE "creatorId"=$1`, [user.id]);
          const tasksDone = await query(`SELECT COUNT(*)::int AS c FROM "Task" WHERE "playerId"=$1 AND status='approved'`, [user.id]);
          const earnings = await query(`SELECT COALESCE(SUM(amount),0)::int AS s FROM "Transaction" WHERE "userId"=$1 AND amount > 0`, [user.id]);
          const spendings = await query(`SELECT COALESCE(SUM(amount),0)::int AS s FROM "Transaction" WHERE "userId"=$1 AND amount < 0`, [user.id]);
          const questsToday = await query(`SELECT COUNT(*)::int AS c FROM "UserDailyQuest" WHERE "userId"=$1 AND date = CURRENT_DATE AND completed = true`, [user.id]);
          const totalQuests = await query(`SELECT COUNT(*)::int AS c FROM "DailyQuest"`);
          const achievementsCount = await query(`SELECT COUNT(*)::int AS c FROM "UserAchievement" WHERE "userId"=$1`, [user.id]);
          const referralsEarned = await query(`SELECT COALESCE(SUM(amount),0)::int AS s FROM "ReferralEarning" WHERE "userId"=$1`, [user.id]);
          const text = `📈 *Статистика ${user.displayName || user.name}*\n\n`
            + `🎖 Уровень: *${user.level || 1}* (${user.experience || 0} XP)\n`
            + `🏅 Место в рейтинге: *#${rank.rows[0].pos}*\n`
            + `⭐ Репутация: *${user.reputation}*\n`
            + `🔥 Streak: *${user.loginStreak} дн.*\n`
            + `🎖 Достижений: *${achievementsCount.rows[0].c}*\n\n`
            + `🎨 Создано заданий: *${tasksCreated.rows[0].c}*\n`
            + `✅ Выполнено заданий: *${tasksDone.rows[0].c}*\n`
            + `📅 Квестов сегодня: *${questsToday.rows[0].c}/${totalQuests.rows[0].c}*\n\n`
            + `📥 Всего заработано: *${earnings.rows[0].s} ₽*\n`
            + `📤 Всего потрачено: *${Math.abs(spendings.rows[0].s)} ₽*\n`
            + `💸 Реферальные: *${referralsEarned.rows[0].s} ₽*\n`;
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '📊 Профиль', callback_data: 'profile' }], [{ text: '🏆 Рейтинг', callback_data: 'leaderboard' }], [{ text: '🔙 Назад', callback_data: 'menu' }]] });
        } catch (e) { console.error(e); await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      // ---- ПОДДЕРЖКА ----
      if (data === 'support') {
        if (!user) { await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        userState[chatId] = { step: 'support_message' };
        await edit(
          '💡 *Поддержка*\n\nОпиши свою проблему или вопрос в следующем сообщении. Мы ответим как можно скорее.\n\n📌 Для отмены — /menu',
          'Markdown',
          { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'menu' }]] }
        );
        return res.status(200).send('OK');
      }

      // ---- КОШЕЛЁК ----
      if (data === 'wallet') {
        if (!user) { await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        try {
          const r = await query('SELECT "createdAt", amount, reason FROM "Transaction" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 5', [user.id]);
          let text = `💳 *Кошелёк*\n\n💰 Баланс: ${user.balance} ₽\n\n📊 *Последние транзакции:*\n`;
          if (r.rows.length === 0) text += 'Нет транзакций.';
          else r.rows.forEach(t => { text += `${new Date(t.createdAt).toLocaleDateString()} ${t.amount > 0 ? '+' : ''}${t.amount} ₽ — ${t.reason}\n`; });
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '📈 Полная история', callback_data: 'transactions' }], [{ text: '🔙 Назад', callback_data: 'menu' }]] });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      if (data === 'transactions') {
        if (!user) { await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        try {
          const r = await query('SELECT "createdAt", amount, reason FROM "Transaction" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 20', [user.id]);
          let text = '📊 *История транзакций:*\n\n';
          if (r.rows.length === 0) text += 'Нет транзакций.';
          else r.rows.forEach(t => { text += `${new Date(t.createdAt).toLocaleDateString()} ${t.amount > 0 ? '+' : ''}${t.amount} ₽ — ${t.reason}\n`; });
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'wallet' }]] });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'wallet' }]] }); }
        return res.status(200).send('OK');
      }

      // ---- РЕЙТИНГ ----
      if (data === 'leaderboard') {
        try {
          const r = await query('SELECT name, "displayName", reputation, balance, level FROM "User" ORDER BY reputation DESC LIMIT 10');
          let text = '🏆 *Топ по репутации:*\n\n';
          r.rows.forEach((u, i) => { const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`; text += `${medal} ${u.displayName || u.name} — ⭐ ${u.reputation} (ур.${u.level || 1})\n`; });
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '💰 По балансу', callback_data: 'leaderboard_balance' }], [{ text: '📅 Топ недели', callback_data: 'leaderboard_week' }], [{ text: '🔙 Назад', callback_data: 'menu' }]] });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      if (data === 'leaderboard_balance') {
        try {
          const r = await query('SELECT name, "displayName", reputation, balance, level FROM "User" ORDER BY balance DESC LIMIT 10');
          let text = '💰 *Топ по балансу:*\n\n';
          r.rows.forEach((u, i) => { const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`; text += `${medal} ${u.displayName || u.name} — 💰 ${u.balance}₽ (ур.${u.level || 1})\n`; });
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '⭐ По репутации', callback_data: 'leaderboard' }], [{ text: '📅 Топ недели', callback_data: 'leaderboard_week' }], [{ text: '🔙 Назад', callback_data: 'menu' }]] });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      if (data === 'leaderboard_week') {
        try {
          const r = await query(
            `SELECT u.name, u."displayName", COALESCE(SUM(t.amount),0)::int AS earned
             FROM "User" u
             LEFT JOIN "Transaction" t ON t."userId" = u.id 
               AND t.amount > 0 
               AND t."createdAt" >= NOW() - INTERVAL '7 days'
             GROUP BY u.id, u.name, u."displayName"
             ORDER BY earned DESC LIMIT 10`
          );
          let text = '📅 *Топ недели:*\n\n';
          r.rows.forEach((u, i) => { const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`; text += `${medal} ${u.displayName || u.name} — +${u.earned} ₽\n`; });
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '⭐ По репутации', callback_data: 'leaderboard' }], [{ text: '💰 По балансу', callback_data: 'leaderboard_balance' }], [{ text: '🔙 Назад', callback_data: 'menu' }]] });
        } catch (e) { console.error(e); await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      // ---- БОНУС ----
      if (data === 'daily') {
        if (!user) { await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        const now = new Date();
        const last = user.lastDailyBonusAt ? new Date(user.lastDailyBonusAt) : null;
        const hoursSince = last ? (now - last) / (1000 * 60 * 60) : 24;
        if (hoursSince < 24) { await edit(`⏳ *Бонус уже получен.*\nСледующий через ${Math.ceil(24 - hoursSince)} ч.`, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }

        const streakContinues = last && hoursSince >= 24 && hoursSince <= 48;
        const newStreak = streakContinues ? (user.loginStreak || 0) + 1 : 1;
        const mult = getStreakMultiplier(newStreak);

        const baseBonus = 10;
        const bonus = Math.round(baseBonus * mult);

        await query('UPDATE "User" SET balance = balance + $1, "loginStreak" = $2, "lastDailyBonusAt" = NOW() WHERE id=$3', [bonus, newStreak, user.id]);
        await query(`INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt") VALUES ($1,'daily_bonus',$2,'completed',$3,NOW())`, [user.id, bonus, `Ежедневный бонус (streak ${newStreak})`]);
        const xpRes = await addExperience(user.id, 15);
        const achs = await checkAchievements(user.id);
        
        let streakMsg = streakContinues 
          ? `🔥 Streak: *${newStreak}* дн. (×${mult})` 
          : `🔥 Streak: *1* дн. (начинаем заново)`;
        
        await edit(
          `🎁 *Бонус получен!*\n\n` +
          `💰 +${bonus} ₽ (базовый ${baseBonus} × ${mult})\n` +
          `${streakMsg}\n` +
          `_+15 XP_\n\n` +
          `Баланс: ${user.balance + bonus} ₽`,
          'Markdown',
          { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }
        );
        await notifyLevelUp(user.id, xpRes, sendMessage);
        await notifyAchievements(user.id, achs, sendMessage);
        return res.status(200).send('OK');
      }

      // ---- РЕФЕРАЛЫ ----
      if (data === 'referral') {
        if (!user) { await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        let code = user.referralCode;
        if (!code) { code = Math.random().toString(36).substring(2, 8).toUpperCase(); await query('UPDATE "User" SET "referralCode"=$1 WHERE id=$2', [code, user.id]); }

        const lvl1 = await query('SELECT COUNT(*)::int AS c FROM "User" WHERE "referredBy"=$1', [user.id]);
        const lvl2 = await query(
          `SELECT COUNT(*)::int AS c FROM "User" u
           WHERE u."referredBy" IN (SELECT id FROM "User" WHERE "referredBy"=$1)`,
          [user.id]
        );
        const lvl3 = await query(
          `SELECT COUNT(*)::int AS c FROM "User" u
           WHERE u."referredBy" IN (
             SELECT id FROM "User" WHERE "referredBy" IN (
               SELECT id FROM "User" WHERE "referredBy"=$1
             )
           )`,
          [user.id]
        );
        const totalEarned = await query(
          `SELECT COALESCE(SUM(amount),0)::int AS s FROM "ReferralEarning" WHERE "userId"=$1`,
          [user.id]
        );

        const text = `🔗 *Реферальная программа*\n\n` +
          `Ваш код: *${code}*\n` +
          `Ссылка: https://nerv.vercel.app/signup?ref=${code}\n\n` +
          `📊 *Ваша сеть:*\n` +
          `├ Уровень 1: *${lvl1.rows[0].c}* × 50 ₽\n` +
          `├ Уровень 2: *${lvl2.rows[0].c}* × 25 ₽\n` +
          `└ Уровень 3: *${lvl3.rows[0].c}* × 10 ₽\n\n` +
          `💰 *Всего заработано:* ${totalEarned.rows[0].s} ₽\n\n` +
          `_Бонус начисляется один раз, когда ваш реферал выполняет первое задание._`;

        await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }

      // ---- ПОИСК ИГРОКОВ ----
      if (data === 'players_menu') {
        await edit('👥 *Поиск игроков*\n\nНапиши `/search Имя` для поиска.', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }

      if (data.startsWith('msg_')) {
        const id = parseInt(data.split('_')[1]);
        const target = await getUserById(id);
        if (!target) { await edit('❌ *Не найден*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        await edit(`💬 *Чат с ${target.displayName || target.name}*\n\nИспользуй: /msg ${target.id} <текст>`, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'players_menu' }]] });
        return res.status(200).send('OK');
      }

      // ---- ВХОДЯЩИЕ ----
      if (data === 'inbox') {
        if (!user) { await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        const r = await query(`SELECT m.text, m."fromUserId", u.name, u."displayName" FROM "Message" m JOIN "User" u ON m."fromUserId"=u.id WHERE m."toUserId"=$1 AND m."isRead"=false ORDER BY m."createdAt" DESC`, [user.id]);
        if (r.rows.length === 0) { await edit('📭 *Новых сообщений нет.*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        let text = '💬 *Новые сообщения:*\n\n';
        r.rows.forEach(m => { text += `👤 ${m.displayName || m.name}: ${m.text}\n/msg ${m.fromUserId} ...\n\n`; });
        await query('UPDATE "Message" SET "isRead"=true WHERE "toUserId"=$1 AND "isRead"=false', [user.id]);
        await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }

      // ---- СОЗДАТЬ ЗАДАНИЕ ----
      if (data === 'create') {
        if (!user) { await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        userState[chatId] = { step: 'title' };
        await edit('📝 *Создание задания*\n\nВведите *название*:', 'Markdown', { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }

      // ---- ПОМОЩЬ ----
      if (data === 'help') {
        await edit(
          '📖 *Помощь*\n\n' +
          '*🎯 Основное:*\n' +
          '/start — Меню\n' +
          '/profile — Профиль\n' +
          '/tasks — Задания\n' +
          '/my — Мои задания\n\n' +
          '*💰 Экономика:*\n' +
          '/wallet — Кошелёк\n' +
          '/daily — Бонус\n' +
          '/referral — Рефералы\n' +
          '/leaderboard — Рейтинг\n\n' +
          '*📅 Прогресс:*\n' +
          '/quests — Ежедневные квесты\n' +
          '/stats — Статистика\n\n' +
          '*👥 Соцфункции:*\n' +
          '/search имя — Поиск\n' +
          '/msg id текст — Написать\n' +
          '/inbox — Входящие\n\n' +
          '*⚙️ Прочее:*\n' +
          '/link email — Привязать\n' +
          '/delete_data — Отвязать',
          'Markdown',
          { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }
        );
        return res.status(200).send('OK');
      }

      return res.status(200).send('OK');
    }

    // ============ ТЕКСТОВЫЕ СООБЩЕНИЯ ============
    const chatId = message.chat.id;
    const text = message.text || '';

    const send = async (msg, parse_mode = 'Markdown', reply_markup = null) => {
      await sendMessage(chatId, msg, parse_mode, reply_markup);
    };

    const user = await getUser(chatId);

    if (user && user.isBanned) {
      await send('🚫 *Вы заблокированы.*');
      return res.status(200).send('OK');
    }

    const isAdmin = user && user.role === 'admin';
    const isModerator = user && (user.isModerator || user.role === 'admin');

    // ---- /start /menu ----
    if (text === '/start' || text === '/menu') {
      const keyboard = [
        [{ text: '📊 Профиль', callback_data: 'profile' }, { text: '🎖 Достижения', callback_data: 'achievements' }],
        [{ text: '📋 Доступные задания', callback_data: 'tasks' }],
        [{ text: '📝 Мои задания', callback_data: 'my_tasks' }, { text: '🎨 Мои созданные', callback_data: 'my_created' }],
        [{ text: '💰 Кошелёк', callback_data: 'wallet' }, { text: '➕ Создать', callback_data: 'create' }],
        [{ text: '🏆 Рейтинг', callback_data: 'leaderboard' }, { text: '🎁 Бонус', callback_data: 'daily' }],
        [{ text: '📅 Квесты', callback_data: 'quests' }, { text: '📈 Статистика', callback_data: 'stats' }],
        [{ text: '🔗 Рефералы', callback_data: 'referral' }, { text: '👥 Игроки', callback_data: 'players_menu' }],
        [{ text: '💬 Сообщения', callback_data: 'inbox' }, { text: '💡 Поддержка', callback_data: 'support' }],
        [{ text: '❓ Помощь', callback_data: 'help' }],
      ];
      if (isAdmin) keyboard.push([{ text: '⚙️ Админ-панель', callback_data: 'admin_panel' }]);
      if (isModerator) keyboard.push([{ text: '👮 Модерация', callback_data: 'mod_panel' }]);
      await send('🤖 *Главное меню*', 'Markdown', { inline_keyboard: keyboard });
      return res.status(200).send('OK');
    }

    // ---- /link ----
    if (text.startsWith('/link ')) {
      const email = text.replace('/link ', '').trim().toLowerCase();
      if (!email.match(/^[^@]+@[^@]+\.[^@]+$/)) { await send('❌ *Неверный email*'); return res.status(200).send('OK'); }
      try {
        const r = await query('SELECT id, name FROM "User" WHERE email=$1', [email]);
        if (r.rows.length === 0) { await send('❌ *Пользователь не найден.*'); return res.status(200).send('OK'); }
        const u = r.rows[0];
        await query('UPDATE "User" SET "telegramChatId"=$1, "telegramLinked"=true WHERE id=$2', [String(chatId), u.id]);
        await send(`✅ *Аккаунт привязан!*\n👤 ${u.name}`, 'Markdown', { inline_keyboard: [[{ text: '📊 Профиль', callback_data: 'profile' }]] });
      } catch (e) { console.error(e); await send('❌ *Ошибка привязки*'); }
      return res.status(200).send('OK');
    }

    if (text === '/link') { await send('⚠️ *Укажи email:* `/link your@email.com`'); return res.status(200).send('OK'); }

    // ---- /profile ----
    if (text === '/profile') {
      if (!user) { await send('❌ *Не привязан.* /link your@email.com'); return res.status(200).send('OK'); }
      const rank = await query(`SELECT COUNT(*)::int + 1 AS pos FROM "User" WHERE reputation > $1`, [user.reputation]);
      await send(`👤 *${user.displayName || user.name}*\n\n🎖 Ур. ${user.level || 1} (${user.experience || 0} XP)\n💰 ${user.balance} ₽\n⭐ ${user.reputation}\n🎮 ${user.role}\n🏅 Место: #${rank.rows[0].pos}\n🔥 Streak: ${user.loginStreak} дн.`);
      return res.status(200).send('OK');
    }

    // ---- /profile <id> ----
    if (text.startsWith('/profile ')) {
      const id = parseInt(text.replace('/profile ', '').trim());
      if (isNaN(id)) { await send('❌ *Неверный ID*'); return res.status(200).send('OK'); }
      const target = await getUserById(id);
      if (!target) { await send('❌ *Не найден*'); return res.status(200).send('OK'); }
      await send(`👤 *${target.displayName || target.name}*\n\n🎖 Ур. ${target.level || 1}\n⭐ ${target.reputation}\n🎮 ${target.role}\n\n💬 /msg ${target.id} <текст>`);
      return res.status(200).send('OK');
    }

    // ---- /my ----
    if (text === '/my') {
      if (!user) { await send('❌ *Сначала привяжи*'); return res.status(200).send('OK'); }
      try {
        const r = await query(
          `SELECT t.id, t.title, t.reward, t.status, u.name AS creator
           FROM "Task" t JOIN "User" u ON t."creatorId" = u.id
           WHERE t."playerId"=$1 ORDER BY t."updatedAt" DESC LIMIT 15`,
          [user.id]
        );
        if (r.rows.length === 0) { await send('📭 *У тебя нет заданий.*'); return res.status(200).send('OK'); }
        let msg = '📝 *Твои задания:*\n\n';
        r.rows.forEach((t, i) => {
          const statusEmoji = t.status === 'taken' ? '🟡' : t.status === 'voting' ? '🗳️' : t.status === 'approved' ? '✅' : '⚪';
          msg += `${i + 1}. ${statusEmoji} *${t.title}*\n   💰 ${t.reward} ₽ · ${t.status}\n   👤 ${t.creator}\n\n`;
        });
        await send(msg);
      } catch { await send('❌ *Ошибка*'); }
      return res.status(200).send('OK');
    }

    // ---- /quests ----
    if (text === '/quests') {
      if (!user) { await send('❌ *Сначала привяжи*'); return res.status(200).send('OK'); }
      try {
        const all = await query(`SELECT id, description, reward, "requirementValue" FROM "DailyQuest"`);
        if (all.rows.length === 0) { await send('📅 *Квестов пока нет.*'); return res.status(200).send('OK'); }
        const progress = await query(`SELECT "questId", progress, completed FROM "UserDailyQuest" WHERE "userId"=$1 AND date = CURRENT_DATE`, [user.id]);
        const progressMap = {};
        progress.rows.forEach(p => { progressMap[p.questId] = p; });
        let msg = '📅 *Ежедневные квесты:*\n\n';
        all.rows.forEach(q => {
          const p = progressMap[q.id];
          const prog = p?.progress || 0;
          const isDone = p?.completed || false;
          msg += `${isDone ? '✅' : '🔸'} *${q.description}*\n   ${prog}/${q.requirementValue} · 🎁 ${q.reward} ₽\n\n`;
        });
        await send(msg);
      } catch { await send('❌ *Ошибка*'); }
      return res.status(200).send('OK');
    }

    // ---- /tasks ----
    if (text === '/tasks') {
      try {
        const r = await query(`SELECT id, title, reward, status, "playerId" FROM "Task" WHERE status IN ('open','voting') ORDER BY "createdAt" DESC LIMIT 10`);
        if (r.rows.length === 0) { await send('📭 *Нет заданий.*'); return res.status(200).send('OK'); }
        const isPlayer = user && user.role === 'player';
        const buttons = [];
        r.rows.forEach(t => {
          const row = [{ text: `📌 ${t.title} (${t.reward}₽)`, callback_data: `task_${t.id}` }];
          if (t.status === 'open' && isPlayer && !t.playerId) row.push({ text: '🎯 Взять', callback_data: `take_${t.id}` });
          if (t.status === 'voting') {
            row.push({ text: '✅ За', callback_data: `vote_${t.id}_approve` });
            row.push({ text: '❌ Против', callback_data: `vote_${t.id}_reject` });
          }
          buttons.push(row);
        });
        buttons.push([{ text: '🔙 Назад', callback_data: 'menu' }]);
        await send('📋 *Задания:*', 'Markdown', { inline_keyboard: buttons });
      } catch { await send('❌ *Ошибка*'); }
      return res.status(200).send('OK');
    }

    // ---- /search ----
    if (text.startsWith('/search ')) {
      const q = text.replace('/search ', '').trim();
      if (q.length < 2) { await send('⚠️ *Минимум 2 символа*'); return res.status(200).send('OK'); }
      const r = await query(`SELECT id, name, "displayName", reputation, level FROM "User" WHERE name ILIKE $1 OR "displayName" ILIKE $1 LIMIT 10`, [`%${q}%`]);
      if (r.rows.length === 0) { await send('👥 *Никто не найден*'); return res.status(200).send('OK'); }
      let msg = '👥 *Найдено:*\n\n';
      r.rows.forEach(u => { msg += `• ${u.displayName || u.name} (ур.${u.level || 1}, ⭐ ${u.reputation})\n  /profile ${u.id} — профиль\n  /msg ${u.id} — написать\n\n`; });
      await send(msg);
      return res.status(200).send('OK');
    }

    // ---- /msg <id> <текст> ----
    if (text.startsWith('/msg ')) {
      if (!user) { await send('❌ *Сначала привяжи*'); return res.status(200).send('OK'); }
      const parts = text.split(' ');
      if (parts.length < 3) { await send('⚠️ *Формат:* `/msg id текст`'); return res.status(200).send('OK'); }
      const id = parseInt(parts[1]);
      if (isNaN(id)) { await send('❌ *Неверный ID*'); return res.status(200).send('OK'); }
      const msgText = parts.slice(2).join(' ');
      const target = await getUserById(id);
      if (!target) { await send('❌ *Получатель не найден*'); return res.status(200).send('OK'); }
      if (target.id === user.id) { await send('❌ *Нельзя себе*'); return res.status(200).send('OK'); }
      await query(`INSERT INTO "Message" ("fromUserId","toUserId",text,"createdAt") VALUES ($1,$2,$3,NOW())`, [user.id, target.id, msgText]);
      await send(`✅ *Отправлено ${target.displayName || target.name}*`);
      const tr = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [target.id]);
      if (tr.rows[0]?.telegramChatId) await sendMessage(tr.rows[0].telegramChatId, `💬 *От ${user.displayName || user.name}:*\n\n${msgText}\n\nОтветить: /msg ${user.id} <текст>`);
      const achs = await checkAchievements(user.id);
      await notifyAchievements(user.id, achs, sendMessage);
      return res.status(200).send('OK');
    }

    // ---- /inbox ----
    if (text === '/inbox') {
      if (!user) { await send('❌ *Сначала привяжи*'); return res.status(200).send('OK'); }
      const r = await query(`SELECT m.text, m."fromUserId", u.name, u."displayName" FROM "Message" m JOIN "User" u ON m."fromUserId"=u.id WHERE m."toUserId"=$1 AND m."isRead"=false ORDER BY m."createdAt" DESC`, [user.id]);
      if (r.rows.length === 0) { await send('📭 *Нет сообщений.*'); return res.status(200).send('OK'); }
      let msg = '💬 *Новые сообщения:*\n\n';
      r.rows.forEach(m => { msg += `👤 ${m.displayName || m.name}: ${m.text}\n/msg ${m.fromUserId} ...\n\n`; });
      await query('UPDATE "Message" SET "isRead"=true WHERE "toUserId"=$1 AND "isRead"=false', [user.id]);
      await send(msg);
      return res.status(200).send('OK');
    }

    // ---- /chat <id> ----
    if (text.startsWith('/chat ')) {
      if (!user) { await send('❌ *Сначала привяжи*'); return res.status(200).send('OK'); }
      const id = parseInt(text.replace('/chat ', '').trim());
      if (isNaN(id)) { await send('❌ *Неверный ID*'); return res.status(200).send('OK'); }
      const target = await getUserById(id);
      if (!target) { await send('❌ *Не найден*'); return res.status(200).send('OK'); }
      const r = await query(
        `SELECT m.text, m."fromUserId", u.name, u."displayName" FROM "Message" m JOIN "User" u ON m."fromUserId"=u.id
         WHERE (m."fromUserId"=$1 AND m."toUserId"=$2) OR (m."fromUserId"=$2 AND m."toUserId"=$1)
         ORDER BY m."createdAt" ASC LIMIT 50`,
        [user.id, target.id]
      );
      if (r.rows.length === 0) { await send('💬 *Нет переписки.*'); return res.status(200).send('OK'); }
      let msg = `💬 *Переписка с ${target.displayName || target.name}:*\n\n`;
      r.rows.forEach(m => { const prefix = m.fromUserId === user.id ? 'Вы' : (m.displayName || m.name); msg += `**${prefix}:** ${m.text}\n`; });
      await send(msg);
      return res.status(200).send('OK');
    }

    // ---- /daily ----
    if (text === '/daily') {
      if (!user) { await send('❌ *Сначала привяжи*'); return res.status(200).send('OK'); }
      const now = new Date();
      const last = user.lastDailyBonusAt ? new Date(user.lastDailyBonusAt) : null;
      const hoursSince = last ? (now - last) / (1000 * 60 * 60) : 24;
      if (hoursSince < 24) { await send(`⏳ *Бонус уже получен.* Следующий через ${Math.ceil(24 - hoursSince)} ч.`); return res.status(200).send('OK'); }
      const streakContinues = last && hoursSince >= 24 && hoursSince <= 48;
      const newStreak = streakContinues ? (user.loginStreak || 0) + 1 : 1;
      const mult = getStreakMultiplier(newStreak);
      const baseBonus = 10;
      const bonus = Math.round(baseBonus * mult);
      await query('UPDATE "User" SET balance = balance + $1, "loginStreak"=$2, "lastDailyBonusAt"=NOW() WHERE id=$3', [bonus, newStreak, user.id]);
      await query(`INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt") VALUES ($1,'daily_bonus',$2,'completed',$3,NOW())`, [user.id, bonus, `Ежедневный бонус (streak ${newStreak})`]);
      const xpRes = await addExperience(user.id, 15);
      const achs = await checkAchievements(user.id);
      await send(`🎁 *Бонус получен!* +${bonus} ₽\n🔥 Streak: ${newStreak} дн. (×${mult})\n_+15 XP_`);
      await notifyLevelUp(user.id, xpRes, sendMessage);
      await notifyAchievements(user.id, achs, sendMessage);
      return res.status(200).send('OK');
    }

    // ---- /referral ----
    if (text === '/referral') {
      if (!user) { await send('❌ *Сначала привяжи*'); return res.status(200).send('OK'); }
      let code = user.referralCode;
      if (!code) { code = Math.random().toString(36).substring(2, 8).toUpperCase(); await query('UPDATE "User" SET "referralCode"=$1 WHERE id=$2', [code, user.id]); }
      const lvl1 = await query('SELECT COUNT(*)::int AS c FROM "User" WHERE "referredBy"=$1', [user.id]);
      const totalEarned = await query('SELECT COALESCE(SUM(amount),0)::int AS s FROM "ReferralEarning" WHERE "userId"=$1', [user.id]);
      await send(
        `🔗 *Рефералы*\n\n` +
        `Код: *${code}*\n` +
        `Ссылка: https://nerv.vercel.app/signup?ref=${code}\n\n` +
        `👥 Приглашено напрямую: *${lvl1.rows[0].c}*\n` +
        `💰 Всего заработано: *${totalEarned.rows[0].s} ₽*`
      );
      return res.status(200).send('OK');
    }

    // ---- /leaderboard ----
    if (text === '/leaderboard') {
      const r = await query('SELECT name, "displayName", reputation, balance, level FROM "User" ORDER BY reputation DESC LIMIT 10');
      let msg = '🏆 *Топ:*\n\n';
      r.rows.forEach((u, i) => { const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`; msg += `${medal} ${u.displayName || u.name} — ⭐ ${u.reputation} (ур.${u.level || 1})\n`; });
      await send(msg);
      return res.status(200).send('OK');
    }

    // ---- /admin ----
    if (text === '/admin') {
      if (!isAdmin) { await send('⛔ *Доступ запрещён.*'); return res.status(200).send('OK'); }
      await send('⚙️ *Админ-панель*', 'Markdown', {
        inline_keyboard: [
          [{ text: '👥 Пользователи', callback_data: 'admin_users' }],
          [{ text: '📋 Задания', callback_data: 'admin_tasks' }],
          [{ text: '📊 Статистика', callback_data: 'admin_stats' }],
          [{ text: '🔙 Меню', callback_data: 'menu' }],
        ],
      });
      return res.status(200).send('OK');
    }

    // ---- /mod ----
    if (text === '/mod') {
      if (!isModerator) { await send('⛔ *Доступ запрещён.*'); return res.status(200).send('OK'); }
      await send('👮 *Модератор-панель*', 'Markdown', {
        inline_keyboard: [
          [{ text: '🚨 Открытые жалобы', callback_data: 'mod_reports' }],
          [{ text: '⏳ Задания на модерации', callback_data: 'mod_pending' }],
          [{ text: '🔙 Меню', callback_data: 'menu' }],
        ],
      });
      return res.status(200).send('OK');
    }

    // ---- /help ----
    if (text === '/help') {
      await send(
        '📖 *Помощь*\n\n' +
        '*🎯 Основное:*\n' +
        '/start — Меню\n/profile — Профиль\n/tasks — Задания\n/my — Мои задания\n\n' +
        '*💰 Экономика:*\n/wallet — Кошелёк\n/daily — Бонус\n/referral — Рефералы\n/leaderboard — Рейтинг\n\n' +
        '*📅 Прогресс:*\n/quests — Квесты\n/stats — Статистика\n\n' +
        '*👥 Соцфункции:*\n/search имя — Поиск\n/msg id текст — Написать\n/inbox — Входящие\n\n' +
        '*⚙️ Прочее:*\n/link email — Привязать\n/delete_data — Отвязать',
        'Markdown',
        { inline_keyboard: [[{ text: '🔙 Меню', callback_data: 'menu' }]] }
      );
      return res.status(200).send('OK');
    }

    // ---- /delete_data ----
    if (text === '/delete_data') {
      if (!user) { await send('❌ *Не привязан*'); return res.status(200).send('OK'); }
      await query('UPDATE "User" SET "telegramChatId"=NULL, "telegramLinked"=false WHERE id=$1', [user.id]);
      await send('✅ *Вы отвязаны от бота.*');
      return res.status(200).send('OK');
    }

    // ---- Пошаговое создание + поддержка + жалобы ----
    if (message.text && userState[chatId] && userState[chatId].step) {
      const state = userState[chatId];
      if (!user) { delete userState[chatId]; await send('❌ *Сначала привяжи*'); return res.status(200).send('OK'); }

      if (state.step === 'report_reason') {
        try {
          const taskId = state.taskId;
          await query(
            `INSERT INTO "Report" ("reporterId", "targetType", "targetId", reason, status, "createdAt")
             VALUES ($1, 'task', $2, $3, 'pending', NOW())`,
            [user.id, taskId, text]
          );
          delete userState[chatId];
          await send('✅ *Жалоба отправлена!*\n\nМодераторы рассмотрят её в ближайшее время.', 'Markdown', { inline_keyboard: [[{ text: '🔙 В меню', callback_data: 'menu' }]] });
          const mods = await query(`SELECT "telegramChatId" FROM "User" WHERE "isModerator"=true OR role='admin'`);
          for (const m of mods.rows) {
            if (m.telegramChatId) {
              await sendMessage(m.telegramChatId, `🚨 *Новая жалоба!*\n\nЗадание #${taskId}\n📝 ${text}`);
            }
          }
        } catch (e) {
          console.error('report_reason:', e);
          delete userState[chatId];
          await send('❌ *Не удалось отправить жалобу.*');
        }
        return res.status(200).send('OK');
      }

      if (state.step === 'support_message') {
        try {
          await query(`INSERT INTO "SupportMessage" ("userId", message, "isFromAdmin", "createdAt") VALUES ($1, $2, false, NOW())`, [user.id, text]);
          delete userState[chatId];
          await send('✅ *Обращение отправлено!*\n\nМы ответим в ближайшее время.', 'Markdown', { inline_keyboard: [[{ text: '🔙 В меню', callback_data: 'menu' }]] });
        } catch (e) { console.error('support:', e); await send('❌ *Не удалось отправить.* Попробуй позже.'); delete userState[chatId]; }
        return res.status(200).send('OK');
      }

      if (state.step === 'title') { state.title = text; state.step = 'description'; await send('📝 *Введите описание:*'); return res.status(200).send('OK'); }
      if (state.step === 'description') { state.description = text; state.step = 'reward'; await send('💰 *Введите награду (число, >=10):*'); return res.status(200).send('OK'); }
      if (state.step === 'reward') {
        const reward = parseInt(text, 10);
        if (isNaN(reward) || reward < 10) { await send('❌ *Число больше 9*'); return res.status(200).send('OK'); }
        if (user.role !== 'viewer' && user.role !== 'admin') { await send('❌ *Только зрители и админы*'); delete userState[chatId]; return res.status(200).send('OK'); }
        if (user.balance < reward) { await send(`❌ *Недостаточно.* Баланс: ${user.balance} ₽`); delete userState[chatId]; return res.status(200).send('OK'); }
        const tr = await query(`INSERT INTO "Task" (title,description,reward,status,"creatorId","createdAt","updatedAt") VALUES ($1,$2,$3,'open',$4,NOW(),NOW()) RETURNING *`, [state.title, state.description, reward, user.id]);
        const t = tr.rows[0];
        await query('UPDATE "User" SET balance = balance - $1 WHERE id=$2', [reward, user.id]);
        await query(`INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt") VALUES ($1,'task_create',$2,'completed',$3,NOW())`, [user.id, -reward, `Создание "${t.title}"`]);
        
        const xpRes = await addExperience(user.id, 10);
        const questRewards = await checkDailyQuests(user.id, 'task_created', 1);
        const achs = await checkAchievements(user.id);
        
        delete userState[chatId];
        let msg = `✅ *Создано!*\n📌 ${t.title}\n💰 ${t.reward} ₽\n\n_+10 XP_`;
        if (questRewards.length > 0) {
          msg += '\n\n📅 *Квесты:*\n';
          questRewards.forEach(q => { msg += `✅ ${q.description} — +${q.reward} ₽\n`; });
        }
        await send(msg, 'Markdown', { inline_keyboard: [[{ text: '📋 Задания', callback_data: 'tasks' }], [{ text: '🎨 Мои созданные', callback_data: 'my_created' }]] });
        await notifyLevelUp(user.id, xpRes, sendMessage);
        await notifyAchievements(user.id, achs, sendMessage);
        return res.status(200).send('OK');
      }
    }

    // ---- Обработка видео ----
    if (message.video || message.document) {
      if (!user || user.role !== 'player') { await send('❌ *Только игроки*'); return res.status(200).send('OK'); }
      const tr = await query(`SELECT * FROM "Task" WHERE "playerId"=$1 AND status='taken' ORDER BY "updatedAt" DESC LIMIT 1`, [user.id]);
      if (tr.rows.length === 0) { await send('❌ *Нет активных заданий*'); return res.status(200).send('OK'); }
      const t = tr.rows[0];
      const fileId = message.video?.file_id || message.document?.file_id;
      if (!fileId) { await send('❌ *Видео не получено*'); return res.status(200).send('OK'); }
      await query(`UPDATE "Task" SET status='voting', "videoUrl"=$1 WHERE id=$2`, [fileId, t.id]);
      await send(`✅ *Видео загружено:*\n📌 ${t.title}\n\nЗрители могут голосовать.`);
      const cr = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [t.creatorId]);
      if (cr.rows[0]?.telegramChatId) await sendMessage(cr.rows[0].telegramChatId, `🎬 *Видео для:*\n📌 ${t.title}`);
      return res.status(200).send('OK');
    }

    await send('🤔 *Неизвестная команда.* /start');
    return res.status(200).send('OK');

  } catch (error) {
    console.error('Ошибка:', error);
    return res.status(500).send('Internal error');
  }
};