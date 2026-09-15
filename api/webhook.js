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
        `SELECT progress, completed FROM "UserDailyQuest" WHERE "userId"=$1 AND "questId"=$2 AND date = CURRENT_DATE`,
        [userId, q.id]
      );
      let progress = existing.rows[0]?.progress || 0;
      const wasCompleted = existing.rows[0]?.completed || false;
      if (wasCompleted) continue;
      const newProgress = progress + amount;
      const newCompleted = newProgress >= q.requirementValue;
      if (existing.rows.length > 0) {
        await query(`UPDATE "UserDailyQuest" SET progress=$1, completed=$2 WHERE "userId"=$3 AND "questId"=$4 AND date = CURRENT_DATE`, [newProgress, newCompleted, userId, q.id]);
      } else {
        await query(`INSERT INTO "UserDailyQuest" ("userId","questId",progress,completed,date) VALUES ($1,$2,$3,$4,CURRENT_DATE)`, [userId, q.id, newProgress, newCompleted]);
      }
      if (newCompleted) {
        await query('UPDATE "User" SET balance = balance + $1 WHERE id=$2', [q.reward, userId]);
        await query(`INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt") VALUES ($1,'quest_reward',$2,'completed',$3,NOW())`, [userId, q.reward, `Квест: ${q.description}`]);
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
    await query(`INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt") VALUES ($1,'level_bonus',$2,'completed',$3,NOW())`, [userId, bonus, `Повышение до уровня ${levelInfo.newLevel}`]);
    const r = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [userId]);
    if (r.rows[0]?.telegramChatId) {
      await sendMessageFn(r.rows[0].telegramChatId, `🎉 *Уровень повышен!*\n\nТы достиг *${levelInfo.newLevel}* уровня!\n💰 Бонус: +${bonus} ₽`);
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
        await query(`INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt") VALUES ($1,'achievement',$2,'completed',$3,NOW())`, [userId, a.reward, `Достижение: ${a.name}`]);
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
      await sendMessageFn(r.rows[0].telegramChatId, `🎖 *Новое достижение!*\n\n${a.icon} *${a.name}*\n💰 +${a.reward} ₽`);
    }
  } catch (e) { console.error('notifyAchievements:', e); }
};

// ========== ХЕЛПЕРЫ ДЛЯ ЭТАПА 3.2 ==========

const processReferralEarnings = async (userId, sourceAmount) => {
  try {
    const alreadyEarned = await query(`SELECT id FROM "ReferralEarning" WHERE "fromUserId"=$1 LIMIT 1`, [userId]);
    if (alreadyEarned.rows.length > 0) return [];
    const levels = [{ level: 1, percent: 0.10 }, { level: 2, percent: 0.05 }, { level: 3, percent: 0.02 }];
    const earnings = [];
    let currentUserId = userId;
    let referrerRow = await query('SELECT "referredBy" FROM "User" WHERE id=$1', [currentUserId]);
    let referrerId = referrerRow.rows[0]?.referredBy;
    for (const { level, percent } of levels) {
      if (!referrerId) break;
      const bonus = Math.max(Math.round(sourceAmount * percent), 5);
      await query('UPDATE "User" SET balance = balance + $1 WHERE id=$2', [bonus, referrerId]);
      await query(`INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt") VALUES ($1,'referral_bonus',$2,'completed',$3,NOW())`, [referrerId, bonus, `Реферальный бонус (уровень ${level}) от #${userId}`]);
      await query(`INSERT INTO "ReferralEarning" ("userId","fromUserId",level,amount,"createdAt") VALUES ($1,$2,$3,$4,NOW())`, [referrerId, userId, level, bonus]);
      const entry = { level, userId: referrerId, bonus };
      const refChat = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [referrerId]);
      if (refChat.rows[0]?.telegramChatId) entry.chatId = refChat.rows[0].telegramChatId;
      earnings.push(entry);
      const nextRef = await query('SELECT "referredBy" FROM "User" WHERE id=$1', [referrerId]);
      referrerId = nextRef.rows[0]?.referredBy;
      currentUserId = referrerId;
    }
    return earnings;
  } catch (e) { console.error('processReferralEarnings:', e); return []; }
};

const notifyReferralEarnings = async (earnings, sendMessageFn) => {
  if (!earnings || earnings.length === 0) return;
  for (const e of earnings) {
    if (!e.chatId) continue;
    try {
      await sendMessageFn(e.chatId, `💸 *Реферальный бонус!*\n\nУровень: *${e.level}*\n💰 +${e.bonus} ₽`);
    } catch (err) { console.error('notifyReferralEarnings:', err); }
  }
};

// ========== ХЕЛПЕРЫ ДЛЯ ЭТАПА 4 ==========

const postTaskToChannel = async (taskId, title, description, reward, creatorName, sendMessageFn) => {
  try {
    const channelId = process.env.CHANNEL_ID;
    if (!channelId) return;
    const text = `📢 *Новое задание на NERV!*\n\n📌 *${title}*\n📝 ${(description || 'Без описания').slice(0, 200)}\n💰 Награда: *${reward} ₽*\n👤 ${creatorName}\n\n🎯 Хочешь выполнить? Переходи в бот: @nerv_05bot`;
    await sendMessageFn(channelId, text, 'Markdown', {
      inline_keyboard: [[{ text: '🎯 Открыть задание', url: `https://t.me/nerv_05bot?start=task_${taskId}` }]],
    });
  } catch (e) { console.error('postTaskToChannel:', e); }
};

// ========== ХЕЛПЕРЫ ДЛЯ ЭТАПА 5: AI-МОДЕРАЦИЯ ==========

const AI_MODEL = process.env.AI_MODEL || 'GigaChat/GigaChat-2-Max';
const AI_API_URL = 'https://foundation-models.api.cloud.ru/v1/chat/completions';

const aiModerateContent = async (title, description) => {
  try {
    const apiKey = process.env.CLOUD_API_KEY;
    if (!apiKey) { console.warn('aiModerateContent: CLOUD_API_KEY не задан'); return { ok: true, reason: 'no_api_key' }; }

    const prompt = `Ты — модератор контента на игровой платформе для выполнения заданий.
Проверь текст задания на наличие нарушений:
- Мат и нецензурная лексика
- Оскорбления, угрозы, травля
- Реклама наркотиков, оружия, азартных игр
- Экстремизм, разжигание розни
- Порнография (18+)
- Скам, мошенничество, фишинг
- Ссылки на подозрительные ресурсы

ЗАДАНИЕ:
Название: ${title}
Описание: ${(description || '').slice(0, 500)}

Ответь СТРОГО в формате JSON, без markdown и без пояснений:
{"ok": true, "reason": ""} — если контент безопасен
{"ok": false, "reason": "краткое объяснение на русском"} — если есть нарушение`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(AI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      console.error('aiModerateContent HTTP error:', response.status, errText.slice(0, 200));
      return { ok: true, reason: 'service_error' };
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '';
    console.log('aiModerateContent raw:', raw.slice(0, 300));

    const clean = raw.replace(/```json\s*|\s*```/g, '').trim();
    let parsed;
    try { parsed = JSON.parse(clean); } catch {
      const match = clean.match(/\{[\s\S]*?\}/);
      if (match) { try { parsed = JSON.parse(match[0]); } catch { parsed = null; } }
    }

    if (!parsed || typeof parsed.ok !== 'boolean') {
      console.error('aiModerateContent: parse error:', clean.slice(0, 200));
      return { ok: true, reason: 'parse_error' };
    }
    return { ok: parsed.ok, reason: (parsed.reason || '').slice(0, 200) };
  } catch (e) {
    if (e.name === 'AbortError') console.error('aiModerateContent: timeout');
    else console.error('aiModerateContent error:', e);
    return { ok: true, reason: 'exception' };
  }
};

const logModeration = async (userId, taskId, contentType, verdict, finalStatus) => {
  try {
    await query(
      `INSERT INTO "ModerationLog" ("userId", "taskId", "contentType", "aiVerdict", "finalStatus", "createdAt")
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [userId, taskId, contentType, verdict, finalStatus]
    );
  } catch (e) { console.error('logModeration:', e); }
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
                  "loginStreak", "lastDailyBonusAt", "telegramChatId", level, experience, "isBanned", "isModerator"
           FROM "User" WHERE "telegramChatId" = $1`,
          [String(chatId)]
        );
        return r.rows[0] || null;
      } catch (e) { console.error('getUser:', e); return null; }
    };

    const getUserById = async (id) => {
      try {
        const r = await query(`SELECT id, name, "displayName", balance, reputation, role, level, experience FROM "User" WHERE id = $1`, [id]);
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
        await edit('🚫 *Вы заблокированы.*', 'Markdown', { inline_keyboard: [] });
        return res.status(200).send('OK');
      }

      const isAdmin = user && user.role === 'admin';
      const isModerator = user && (user.isModerator || user.role === 'admin');

      // ---- АДМИН ----
      if (data === 'admin_panel') {
        if (!isAdmin) { await edit('⛔ *Доступ запрещён.*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        await edit('⚙️ *Админ-панель*', 'Markdown', {
          inline_keyboard: [
            [{ text: '👥 Все пользователи', callback_data: 'admin_users' }],
            [{ text: '📋 Все задания', callback_data: 'admin_tasks' }],
            [{ text: '📊 Расширенная статистика', callback_data: 'admin_stats_full' }],
            [{ text: '📢 Рассылка', callback_data: 'admin_broadcast' }],
            [{ text: 'ℹ️ О боте', callback_data: 'about' }],
            [{ text: '🔙 Назад', callback_data: 'menu' }],
          ],
        });
        return res.status(200).send('OK');
      }

      if (data === 'admin_users') {
        if (!isAdmin) { await edit('⛔ *Доступ запрещён.*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        try {
          const r = await query(`SELECT id, name, email, role, balance, reputation, level, "isBanned" FROM "User" ORDER BY "createdAt" DESC LIMIT 20`);
          let text = '👥 *Последние 20 пользователей:*\n\n';
          const buttons = [];
          r.rows.forEach(u => {
            const ban = u.isBanned ? '🚫' : '';
            text += `🆔 ${u.id} ${ban} | ${u.name}\n   Роль: ${u.role}, Ур: ${u.level}, Баланс: ${u.balance}₽\n\n`;
            buttons.push([{ text: `${ban} ${u.name.slice(0, 20)}`, callback_data: `admin_user_${u.id}` }]);
          });
          buttons.push([{ text: '🔙 Назад', callback_data: 'admin_panel' }]);
          await edit(text, 'Markdown', { inline_keyboard: buttons });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_panel' }]] }); }
        return res.status(200).send('OK');
      }

      if (data.startsWith('admin_user_')) {
        const id = parseInt(data.split('_')[2]);
        if (!isAdmin) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        try {
          const r = await query(`SELECT id, name, email, role, balance, reputation, level, experience, "isBanned", "isModerator" FROM "User" WHERE id=$1`, [id]);
          if (r.rows.length === 0) { await edit('❌ *Не найден*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_users' }]] }); return res.status(200).send('OK'); }
          const u = r.rows[0];
          const text = `👤 *${u.name}*\n\n🆔 ${u.id}\n📧 ${u.email}\n🎮 ${u.role}\n🎖 Ур: ${u.level} (${u.experience} XP)\n💰 ${u.balance} ₽\n⭐ ${u.reputation}\n🚫 ${u.isBanned ? 'Да' : 'Нет'}\n👮 ${u.isModerator ? 'Да' : 'Нет'}`;
          const buttons = [
            [{ text: u.isBanned ? '✅ Разбанить' : '🚫 Забанить', callback_data: `admin_ban_${u.id}` }],
            [{ text: u.isModerator ? '❌ Снять модератора' : '👮 Сделать модератором', callback_data: `admin_mod_${u.id}` }],
            [{ text: '🔙 К списку', callback_data: 'admin_users' }],
          ];
          await edit(text, 'Markdown', { inline_keyboard: buttons });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_users' }]] }); }
        return res.status(200).send('OK');
      }

      if (data.startsWith('admin_ban_')) {
        const id = parseInt(data.split('_')[2]);
        if (!isAdmin) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        try {
          const u = await query('SELECT "isBanned" FROM "User" WHERE id=$1', [id]);
          const newState = !u.rows[0].isBanned;
          await query('UPDATE "User" SET "isBanned"=$1 WHERE id=$2', [newState, id]);
          await edit(newState ? `🚫 *Пользователь #${id} забанен*` : `✅ *Пользователь #${id} разбанен*`, 'Markdown', { inline_keyboard: [[{ text: '🔙 К пользователю', callback_data: `admin_user_${id}` }]] });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_users' }]] }); }
        return res.status(200).send('OK');
      }

      if (data.startsWith('admin_mod_')) {
        const id = parseInt(data.split('_')[2]);
        if (!isAdmin) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        try {
          const u = await query('SELECT "isModerator" FROM "User" WHERE id=$1', [id]);
          const newState = !u.rows[0].isModerator;
          await query('UPDATE "User" SET "isModerator"=$1 WHERE id=$2', [newState, id]);
          await edit(newState ? `👮 *Пользователь #${id} — модератор*` : `❌ *Снята роль модератора с #${id}*`, 'Markdown', { inline_keyboard: [[{ text: '🔙 К пользователю', callback_data: `admin_user_${id}` }]] });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_users' }]] }); }
        return res.status(200).send('OK');
      }

      if (data === 'admin_stats_full') {
        if (!isAdmin) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        try {
          const u = await query('SELECT COUNT(*)::int AS c FROM "User"');
          const t = await query('SELECT COUNT(*)::int AS c FROM "Task"');
          const tA = await query(`SELECT COUNT(*)::int AS c FROM "Task" WHERE status='approved'`);
          const v = await query('SELECT COUNT(*)::int AS c FROM "Vote"');
          const tr = await query('SELECT COUNT(*)::int AS c FROM "Transaction"');
          const b = await query('SELECT COALESCE(SUM(balance),0)::bigint AS s FROM "User"');
          const topUsers = await query(`SELECT name, "displayName", balance FROM "User" ORDER BY balance DESC LIMIT 5`);
          const topTasks = await query(`SELECT title, reward, status FROM "Task" ORDER BY reward DESC LIMIT 5`);
          let text = `📊 *Расширенная статистика:*\n\n👥 Пользователей: *${u.rows[0].c}*\n📋 Заданий: *${t.rows[0].c}*\n✅ Выполнено: *${tA.rows[0].c}*\n🗳️ Голосов: *${v.rows[0].c}*\n💳 Транзакций: *${tr.rows[0].c}*\n💰 Общий баланс: *${b.rows[0].s} ₽*\n\n🏆 *Топ-5 по балансу:*\n`;
          topUsers.rows.forEach((u, i) => { text += `${i + 1}. ${u.displayName || u.name} — ${u.balance} ₽\n`; });
          text += `\n💎 *Топ-5 заданий:*\n`;
          topTasks.rows.forEach((t, i) => { text += `${i + 1}. ${t.title.slice(0, 30)} — ${t.reward} ₽ (${t.status})\n`; });
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_panel' }]] });
        } catch (e) { console.error(e); await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_panel' }]] }); }
        return res.status(200).send('OK');
      }

      if (data === 'admin_broadcast') {
        if (!isAdmin) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        userState[chatId] = { step: 'broadcast_message' };
        await edit('📢 *Рассылка*\n\nВведите текст. Для отмены — /menu', 'Markdown', { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }

      if (data === 'admin_tasks') {
        if (!isAdmin) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        try {
          const r = await query(`SELECT t.id, t.title, t.reward, t.status, u.name AS creator FROM "Task" t JOIN "User" u ON t."creatorId" = u.id ORDER BY t."createdAt" DESC LIMIT 20`);
          let text = '📋 *Задания:*\n\n';
          r.rows.forEach(t => { text += `🆔 ${t.id} | ${t.title}\n   ${t.reward}₽ · ${t.status} · ${t.creator}\n\n`; });
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_panel' }]] });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_panel' }]] }); }
        return res.status(200).send('OK');
      }

      // ---- МОДЕРАЦИЯ ----
      if (data === 'mod_panel') {
        if (!isModerator) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        try {
          const openReports = await query(`SELECT COUNT(*)::int AS c FROM "Report" WHERE status='pending'`);
          const pendingTasks = await query(`SELECT COUNT(*)::int AS c FROM "Task" WHERE status='voting'`);
          await edit(
            `👮 *Модератор-панель*\n\n🚨 Открытых жалоб: *${openReports.rows[0].c}*\n⏳ Заданий на модерации: *${pendingTasks.rows[0].c}*\n`,
            'Markdown',
            {
              inline_keyboard: [
                [{ text: '🚨 Открытые жалобы', callback_data: 'mod_reports' }],
                [{ text: '⏳ Задания на модерации', callback_data: 'mod_pending' }],
                [{ text: '🔙 Назад', callback_data: 'menu' }],
              ],
            }
          );
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      if (data === 'mod_reports') {
        if (!isModerator) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        try {
          const r = await query(`SELECT r.id, r."targetId", r.reason, r."createdAt", u.name AS reporter FROM "Report" r JOIN "User" u ON r."reporterId" = u.id WHERE r.status='pending' ORDER BY r."createdAt" DESC LIMIT 10`);
          if (r.rows.length === 0) { await edit('📭 *Открытых жалоб нет.*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'mod_panel' }]] }); return res.status(200).send('OK'); }
          let text = '🚨 *Открытые жалобы:*\n\n';
          const buttons = [];
          r.rows.forEach(rep => {
            text += `#${rep.id} — Задание #${rep.targetId}\n👤 ${rep.reporter}\n📝 ${rep.reason}\n\n`;
            buttons.push([{ text: `Задание #${rep.targetId}`, callback_data: `task_${rep.targetId}` }, { text: '✅ Закрыть', callback_data: `report_resolve_${rep.id}` }]);
          });
          buttons.push([{ text: '🔙 Назад', callback_data: 'mod_panel' }]);
          await edit(text, 'Markdown', { inline_keyboard: buttons });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'mod_panel' }]] }); }
        return res.status(200).send('OK');
      }

      if (data.startsWith('report_resolve_')) {
        const reportId = parseInt(data.split('_')[2]);
        if (!isModerator) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        try {
          await query(`UPDATE "Report" SET status='resolved', "resolvedAt"=NOW() WHERE id=$1`, [reportId]);
          await query(`INSERT INTO "ModeratorLog" ("moderatorId", action, "targetId", reason, "createdAt") VALUES ($1, 'resolve_report', $2, 'Жалоба обработана', NOW())`, [user.id, reportId]);
          await edit(`✅ *Жалоба #${reportId} закрыта*`, 'Markdown', { inline_keyboard: [[{ text: '🚨 К жалобам', callback_data: 'mod_reports' }], [{ text: '🔙 Меню', callback_data: 'menu' }]] });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'mod_panel' }]] }); }
        return res.status(200).send('OK');
      }

      if (data === 'mod_pending') {
        if (!isModerator) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
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
        if (!isModerator) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        try {
          const r = await query(`SELECT id, title, status FROM "Task" WHERE id=$1`, [taskId]);
          if (r.rows.length === 0) { await edit('❌ *Не найдено*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
          const t = r.rows[0];
          await edit(
            `👮 *Модерация задания #${t.id}*\n\n📌 ${t.title}\n📊 Статус: ${t.status}`,
            'Markdown',
            {
              inline_keyboard: [
                [{ text: '🤖 AI-проверка', callback_data: `mod_ai_${t.id}` }],
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

      if (data.startsWith('mod_ai_')) {
        const taskId = parseInt(data.split('_')[2]);
        if (!isModerator) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        try {
          const r = await query(`SELECT title, description FROM "Task" WHERE id=$1`, [taskId]);
          if (r.rows.length === 0) { await edit('❌ *Не найдено*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
          const t = r.rows[0];
          await edit('🤖 *Отправляю в GigaChat...*', 'Markdown', { inline_keyboard: [] });
          const moderation = await aiModerateContent(t.title, t.description);
          const verdict = moderation.ok ? '✅ Контент безопасен' : `🚫 Нарушение: ${moderation.reason}`;
          await logModeration(user.id, taskId, 'task_text_manual', `MANUAL: ${moderation.reason || 'ok'}`, moderation.ok ? 'APPROVED' : 'REJECTED');
          await edit(`🤖 *AI-проверка задания #${taskId}*\n\n${verdict}`, 'Markdown', { inline_keyboard: [[{ text: '🔙 К модерации', callback_data: `mod_task_${taskId}` }]] });
        } catch (e) { console.error(e); await edit('❌ *Ошибка AI*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: `mod_task_${taskId}` }]] }); }
        return res.status(200).send('OK');
      }

      if (data.startsWith('mod_approve_')) {
        const taskId = parseInt(data.split('_')[2]);
        if (!isModerator) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        try {
          await query(`UPDATE "Task" SET status='approved' WHERE id=$1`, [taskId]);
          await query(`INSERT INTO "ModeratorLog" ("moderatorId", action, "targetId", reason, "createdAt") VALUES ($1, 'approve_task', $2, 'Ручное одобрение', NOW())`, [user.id, taskId]);
          await edit(`✅ *Задание #${taskId} одобрено*`, 'Markdown', { inline_keyboard: [[{ text: '🔙 Меню', callback_data: 'menu' }]] });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      if (data.startsWith('mod_reject_')) {
        const taskId = parseInt(data.split('_')[2]);
        if (!isModerator) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        try {
          await query(`UPDATE "Task" SET status='rejected' WHERE id=$1`, [taskId]);
          await query(`INSERT INTO "ModeratorLog" ("moderatorId", action, "targetId", reason, "createdAt") VALUES ($1, 'reject_task', $2, 'Ручное отклонение', NOW())`, [user.id, taskId]);
          await edit(`❌ *Задание #${taskId} отклонено*`, 'Markdown', { inline_keyboard: [[{ text: '🔙 Меню', callback_data: 'menu' }]] });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      if (data.startsWith('mod_delete_')) {
        const taskId = parseInt(data.split('_')[2]);
        if (!isModerator) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
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
        await edit('🚨 *Жалоба на задание*\n\nОпиши причину одним сообщением.\n\n📌 Для отмены — /menu', 'Markdown', { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }

      // ---- О БОТЕ ----
      if (data === 'about') {
        const text = `ℹ️ *О боте NERV*\n\n🎯 NERV — платформа для выполнения заданий.\n\n👤 *Роли:*\n• Зритель — создаёт задания\n• Игрок — выполняет задания\n\n🎮 *Как это работает:*\n1. Зритель создаёт задание\n2. Игрок берёт и выполняет\n3. Зрители голосуют (5+ = награда)\n\n💰 *Экономика:*\n• Ежедневные бонусы и streak\n• Ежедневные квесты\n• 10 достижений\n• 3 уровня рефералов\n\n🛡 *Модерация:*\n• AI-проверка через GigaChat\n• Жалобы на задания\n\n👨‍💻 Разработка: @gamzaev_s`;
        await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
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
          [{ text: 'ℹ️ О боте', callback_data: 'about' }, { text: '❓ Помощь', callback_data: 'help' }],
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
          `👤 *${user.displayName || user.name}*\n\n🎖 Уровень: *${level}*\n${progressBar} ${pct}%\n_${exp} / ${expForNext} XP_\n\n💰 ${user.balance} ₽\n⭐ ${user.reputation}\n🎮 ${user.role}${user.isModerator ? ' 👮' : ''}\n🏅 Место: #${rank.rows[0].pos}\n🔥 Streak: ${user.loginStreak} дн.`,
          'Markdown',
          { inline_keyboard: [[{ text: '📈 Статистика', callback_data: 'stats' }], [{ text: '🔙 Назад', callback_data: 'menu' }]] }
        );
        return res.status(200).send('OK');
      }

      // ---- КВЕСТЫ ----
      if (data === 'quests') {
        if (!user) { await edit('❌ *Сначала привяжи*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        try {
          const all = await query(`SELECT id, description, reward, "requirementValue" FROM "DailyQuest"`);
          if (all.rows.length === 0) { await edit('📅 *Квестов нет.*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
          const progress = await query(`SELECT "questId", progress, completed FROM "UserDailyQuest" WHERE "userId"=$1 AND date = CURRENT_DATE`, [user.id]);
          const progressMap = {};
          progress.rows.forEach(p => { progressMap[p.questId] = p; });
          let text = '📅 *Ежедневные квесты*\n\n';
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
          text = `📅 *Квесты:* ${totalDone}/${all.rows.length}\n\n` + text;
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
        } catch (e) { console.error(e); await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      // ---- ЗАДАНИЯ ----
      if (data === 'tasks') {
        try {
          const r = await query(`SELECT id, title, reward, status, "playerId" FROM "Task" WHERE status IN ('open','voting') ORDER BY "createdAt" DESC LIMIT 10`);
          if (r.rows.length === 0) { await edit('📭 *Нет доступных заданий.*', 'Markdown', { inline_keyboard: [[{ text: '➕ Создать', callback_data: 'create' }], [{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
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

      if (data.startsWith('task_')) {
        const taskId = parseInt(data.split('_')[1]);
        try {
          const r = await query(`SELECT t.*, u.name AS creator, p.name AS player FROM "Task" t JOIN "User" u ON t."creatorId" = u.id LEFT JOIN "User" p ON t."playerId" = p.id WHERE t.id = $1`, [taskId]);
          if (r.rows.length === 0) { await edit('❌ *Не найдено*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] }); return res.status(200).send('OK'); }
          const t = r.rows[0];
          const vr = await query(`SELECT value, COUNT(*)::int AS cnt FROM "Vote" WHERE "taskId"=$1 GROUP BY value`, [taskId]);
          const approve = vr.rows.find(x => x.value === 'approve')?.cnt || 0;
          const reject = vr.rows.find(x => x.value === 'reject')?.cnt || 0;
          let text = `📌 *${t.title}*\n\n📝 ${t.description || '—'}\n💰 ${t.reward} ₽\n👤 ${t.creator}\n📌 ${t.status}\n👍 ${approve} / 👎 ${reject}\n`;
          if (t.player) text += `🎮 ${t.player}\n`;
          if (t.videoUrl) text += `🎬 Видео загружено\n`;
          const buttons = [];
          const isPlayer = user && user.role === 'player';
          if (t.status === 'open' && isPlayer && !t.playerId) buttons.push([{ text: '🎯 Взять', callback_data: `take_${t.id}` }]);
          if (user) buttons.push([{ text: '🚨 Пожаловаться', callback_data: `report_task_${t.id}` }]);
          if (isModerator) buttons.push([{ text: '👮 Модерация', callback_data: `mod_task_${t.id}` }]);
          buttons.push([{ text: '🔙 К списку', callback_data: 'tasks' }]);
          buttons.push([{ text: '🔙 В меню', callback_data: 'menu' }]);
          await edit(text, 'Markdown', { inline_keyboard: buttons });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] }); }
        return res.status(200).send('OK');
      }

      if (data.startsWith('take_')) {
        const taskId = parseInt(data.split('_')[1]);
        if (!user) { await edit('❌ *Сначала привяжи*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] }); return res.status(200).send('OK'); }
        if (user.role !== 'player') { await edit('❌ *Только игроки*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] }); return res.status(200).send('OK'); }
        try {
          const r = await query(`UPDATE "Task" SET status='taken', "playerId"=$1 WHERE id=$2 AND status='open' AND "playerId" IS NULL RETURNING *`, [user.id, taskId]);
          if (r.rowCount === 0) { await edit('❌ *Уже взято*', 'Markdown', { inline_keyboard: [[{ text: '🔙 К списку', callback_data: 'tasks' }]] }); return res.status(200).send('OK'); }
          const t = r.rows[0];
          const xpRes = await addExperience(user.id, 5);
          const questRewards = await checkDailyQuests(user.id, 'task_taken', 1);
          const achs = await checkAchievements(user.id);
          let msg = `✅ *Задание взято!*\n\n📌 ${t.title}\n💰 ${t.reward} ₽\n\n_+5 XP_`;
          if (questRewards.length > 0) {
            msg += '\n\n📅 *Квесты:*\n';
            questRewards.forEach(q => { msg += `✅ ${q.description} — +${q.reward} ₽\n`; });
          }
          await edit(msg, 'Markdown', { inline_keyboard: [[{ text: '📝 Мои задания', callback_data: 'my_tasks' }], [{ text: '🔙 В меню', callback_data: 'menu' }]] });
          await notifyLevelUp(user.id, xpRes, sendMessage);
          await notifyAchievements(user.id, achs, sendMessage);
          const cr = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [t.creatorId]);
          if (cr.rows[0]?.telegramChatId) await sendMessage(cr.rows[0].telegramChatId, `🎯 *Задание взято!*\n📌 ${t.title}`);
        } catch (e) { console.error(e); await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] }); }
        return res.status(200).send('OK');
      }

      if (data.startsWith('abandon_')) {
        const taskId = parseInt(data.split('_')[1]);
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        try {
          const r = await query(`UPDATE "Task" SET status='open', "playerId"=NULL WHERE id=$1 AND "playerId"=$2 AND status='taken' RETURNING *`, [taskId, user.id]);
          if (r.rowCount === 0) { await edit('❌ *Не удалось*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'my_tasks' }]] }); return res.status(200).send('OK'); }
          const t = r.rows[0];
          await edit(`↩️ *Отказался:* 📌 ${t.title}`, 'Markdown', { inline_keyboard: [[{ text: '📝 Мои задания', callback_data: 'my_tasks' }], [{ text: '🔙 В меню', callback_data: 'menu' }]] });
          const cr = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [t.creatorId]);
          if (cr.rows[0]?.telegramChatId) await sendMessage(cr.rows[0].telegramChatId, `↩️ Игрок отказался от «${t.title}»`);
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'my_tasks' }]] }); }
        return res.status(200).send('OK');
      }

      if (data.startsWith('vote_')) {
        const parts = data.split('_');
        const taskId = parseInt(parts[1]);
        const value = parts[2];
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        try {
          const ex = await query('SELECT id FROM "Vote" WHERE "taskId"=$1 AND "voterId"=$2', [taskId, user.id]);
          if (ex.rows.length > 0) { await edit('❌ *Уже голосовал*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] }); return res.status(200).send('OK'); }
          await query('INSERT INTO "Vote" ("taskId","voterId",value,"createdAt") VALUES ($1,$2,$3,NOW())', [taskId, user.id, value]);
          await query('UPDATE "User" SET reputation = reputation + 1 WHERE id = $1', [user.id]);
          const xpRes = await addExperience(user.id, 3);
          const questRewards = await checkDailyQuests(user.id, 'vote', 1);
          const achs = await checkAchievements(user.id);
          const vr = await query('SELECT value, COUNT(*)::int AS cnt FROM "Vote" WHERE "taskId"=$1 GROUP BY value', [taskId]);
          const approve = vr.rows.find(x => x.value === 'approve')?.cnt || 0;
          const reject = vr.rows.find(x => x.value === 'reject')?.cnt || 0;
          let msg = `✅ *Голос принят*\n👍 ${approve} / 👎 ${reject}\n\n_+1 реп, +3 XP_`;
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
              let m = `🎉 *Задание выполнено!*\n📌 ${t.title}\n💰 +${reward} ₽`;
              if (mult > 1) m += `\n🔥 _Streak ×${mult}_`;
              m += '\n_+50 XP_';
              if (qr.length > 0) { m += '\n\n📅 *Квесты:*\n'; qr.forEach(q => { m += `✅ ${q.description} — +${q.reward} ₽\n`; }); }
              await sendMessage(pl.rows[0].telegramChatId, m);
            }
            await notifyLevelUp(t.playerId, xpPlayer, sendMessage);
            await notifyAchievements(t.playerId, achsPlayer, sendMessage);
            const refEarnings = await processReferralEarnings(t.playerId, reward);
            await notifyReferralEarnings(refEarnings, sendMessage);
            const cr = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [t.creatorId]);
            if (cr.rows[0]?.telegramChatId) await sendMessage(cr.rows[0].telegramChatId, `✅ *"${t.title}" выполнено!*`);
          }
        } catch (e) { console.error(e); await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] }); }
        return res.status(200).send('OK');
      }

      if (data === 'my_tasks') {
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        try {
          const r = await query(`SELECT t.id, t.title, t.reward, t.status, u.name AS creator FROM "Task" t JOIN "User" u ON t."creatorId" = u.id WHERE t."playerId"=$1 ORDER BY t."updatedAt" DESC LIMIT 15`, [user.id]);
          if (r.rows.length === 0) { await edit('📭 *У тебя нет заданий.*', 'Markdown', { inline_keyboard: [[{ text: '📋 Доступные', callback_data: 'tasks' }], [{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
          let text = '📝 *Твои задания:*\n\n';
          const buttons = [];
          r.rows.forEach((t, i) => {
            const e = t.status === 'taken' ? '🟡' : t.status === 'voting' ? '🗳️' : t.status === 'approved' ? '✅' : '⚪';
            text += `${i + 1}. ${e} *${t.title}* · ${t.reward} ₽ · ${t.status}\n`;
            const row = [{ text: `📌 ${t.title.slice(0, 25)}`, callback_data: `task_${t.id}` }];
            if (t.status === 'taken') row.push({ text: '↩️ Отказ', callback_data: `abandon_${t.id}` });
            buttons.push(row);
          });
          buttons.push([{ text: '🔙 Назад', callback_data: 'menu' }]);
          await edit(text, 'Markdown', { inline_keyboard: buttons });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      if (data === 'my_created') {
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        try {
          const r = await query(`SELECT t.id, t.title, t.reward, t.status, (SELECT COUNT(*)::int FROM "Vote" WHERE "taskId"=t.id AND value='approve') AS approve, (SELECT COUNT(*)::int FROM "Vote" WHERE "taskId"=t.id AND value='reject') AS reject FROM "Task" t WHERE t."creatorId"=$1 ORDER BY t."createdAt" DESC LIMIT 15`, [user.id]);
          if (r.rows.length === 0) { await edit('📭 *Не создавал.*', 'Markdown', { inline_keyboard: [[{ text: '➕ Создать', callback_data: 'create' }], [{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
          let text = '🎨 *Созданные задания:*\n\n';
          r.rows.forEach((t, i) => {
            const e = t.status === 'open' ? '🟢' : t.status === 'taken' ? '🟡' : t.status === 'voting' ? '🗳️' : t.status === 'approved' ? '✅' : '⚪';
            text += `${i + 1}. ${e} *${t.title}* · ${t.reward} ₽ · ${t.status}\n👍 ${t.approve} / 👎 ${t.reject}\n\n`;
          });
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '➕ Создать ещё', callback_data: 'create' }], [{ text: '🔙 Назад', callback_data: 'menu' }]] });
        } catch { await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      if (data === 'achievements') {
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        try {
          const r = await query(`SELECT a.name, a.description, a.icon, a.reward, ua."unlockedAt" FROM "Achievement" a LEFT JOIN "UserAchievement" ua ON ua."achievementId" = a.id AND ua."userId" = $1 ORDER BY ua."unlockedAt" DESC NULLS LAST`, [user.id]);
          if (r.rows.length === 0) { await edit('🎖 *Пока нет.*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
          let text = '🎖 *Достижения:*\n\n';
          let unlocked = 0;
          r.rows.forEach(a => {
            const isU = a.unlockedAt !== null;
            if (isU) unlocked++;
            text += `${isU ? '✅' : '🔒'} ${a.icon || '🏅'} *${a.name}*\n   ${a.description}\n   🎁 ${a.reward} ₽\n\n`;
          });
          text = `🎖 *Достижения:* ${unlocked}/${r.rows.length}\n\n` + text;
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
        } catch (e) { console.error(e); await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      if (data === 'stats') {
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        try {
          const rank = await query(`SELECT COUNT(*)::int + 1 AS pos FROM "User" WHERE reputation > $1`, [user.reputation]);
          const tc = await query(`SELECT COUNT(*)::int AS c FROM "Task" WHERE "creatorId"=$1`, [user.id]);
          const td = await query(`SELECT COUNT(*)::int AS c FROM "Task" WHERE "playerId"=$1 AND status='approved'`, [user.id]);
          const e = await query(`SELECT COALESCE(SUM(amount),0)::int AS s FROM "Transaction" WHERE "userId"=$1 AND amount > 0`, [user.id]);
          const s = await query(`SELECT COALESCE(SUM(amount),0)::int AS s FROM "Transaction" WHERE "userId"=$1 AND amount < 0`, [user.id]);
          const q = await query(`SELECT COUNT(*)::int AS c FROM "UserDailyQuest" WHERE "userId"=$1 AND date = CURRENT_DATE AND completed = true`, [user.id]);
          const tq = await query(`SELECT COUNT(*)::int AS c FROM "DailyQuest"`);
          const ac = await query(`SELECT COUNT(*)::int AS c FROM "UserAchievement" WHERE "userId"=$1`, [user.id]);
          const re = await query(`SELECT COALESCE(SUM(amount),0)::int AS s FROM "ReferralEarning" WHERE "userId"=$1`, [user.id]);
          const text = `📈 *Статистика ${user.displayName || user.name}*\n\n🎖 Ур: *${user.level || 1}* (${user.experience || 0} XP)\n🏅 Место: *#${rank.rows[0].pos}*\n⭐ Реп: *${user.reputation}*\n🔥 Streak: *${user.loginStreak} дн.*\n🎖 Достижений: *${ac.rows[0].c}*\n\n🎨 Создано: *${tc.rows[0].c}*\n✅ Выполнено: *${td.rows[0].c}*\n📅 Квестов: *${q.rows[0].c}/${tq.rows[0].c}*\n\n📥 Заработано: *${e.rows[0].s} ₽*\n📤 Потрачено: *${Math.abs(s.rows[0].s)} ₽*\n💸 Реферальные: *${re.rows[0].s} ₽*\n`;
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '📊 Профиль', callback_data: 'profile' }], [{ text: '🏆 Рейтинг', callback_data: 'leaderboard' }], [{ text: '🔙 Назад', callback_data: 'menu' }]] });
        } catch (e) { console.error(e); await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      if (data === 'support') {
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        userState[chatId] = { step: 'support_message' };
        await edit('💡 *Поддержка*\n\nОпиши проблему. Для отмены — /menu', 'Markdown', { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }

      if (data === 'wallet') {
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        try {
          const r = await query('SELECT "createdAt", amount, reason FROM "Transaction" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 5', [user.id]);
          let text = `💳 *Кошелёк*\n\n💰 ${user.balance} ₽\n\n📊 *Последние:*\n`;
          if (r.rows.length === 0) text += 'Нет транзакций.';
          else r.rows.forEach(t => { text += `${new Date(t.createdAt).toLocaleDateString()} ${t.amount > 0 ? '+' : ''}${t.amount} ₽ — ${t.reason}\n`; });
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '📈 История', callback_data: 'transactions' }], [{ text: '🔙 Назад', callback_data: 'menu' }]] });
        } catch { await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      if (data === 'transactions') {
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        try {
          const r = await query('SELECT "createdAt", amount, reason FROM "Transaction" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 20', [user.id]);
          let text = '📊 *История:*\n\n';
          if (r.rows.length === 0) text += 'Пусто.';
          else r.rows.forEach(t => { text += `${new Date(t.createdAt).toLocaleDateString()} ${t.amount > 0 ? '+' : ''}${t.amount} ₽ — ${t.reason}\n`; });
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'wallet' }]] });
        } catch { await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'wallet' }]] }); }
        return res.status(200).send('OK');
      }

      if (data === 'leaderboard') {
        try {
          const r = await query('SELECT name, "displayName", reputation, balance, level FROM "User" ORDER BY reputation DESC LIMIT 10');
          let text = '🏆 *Топ по репутации:*\n\n';
          r.rows.forEach((u, i) => { const m = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`; text += `${m} ${u.displayName || u.name} — ⭐ ${u.reputation} (ур.${u.level || 1})\n`; });
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '💰 По балансу', callback_data: 'leaderboard_balance' }], [{ text: '📅 Топ недели', callback_data: 'leaderboard_week' }], [{ text: '🔙 Назад', callback_data: 'menu' }]] });
        } catch { await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      if (data === 'leaderboard_balance') {
        try {
          const r = await query('SELECT name, "displayName", balance, level FROM "User" ORDER BY balance DESC LIMIT 10');
          let text = '💰 *Топ по балансу:*\n\n';
          r.rows.forEach((u, i) => { const m = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`; text += `${m} ${u.displayName || u.name} — ${u.balance}₽\n`; });
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '⭐ По репутации', callback_data: 'leaderboard' }], [{ text: '📅 Топ недели', callback_data: 'leaderboard_week' }], [{ text: '🔙 Назад', callback_data: 'menu' }]] });
        } catch { await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      if (data === 'leaderboard_week') {
        try {
          const r = await query(`SELECT u.name, u."displayName", COALESCE(SUM(t.amount),0)::int AS earned FROM "User" u LEFT JOIN "Transaction" t ON t."userId" = u.id AND t.amount > 0 AND t."createdAt" >= NOW() - INTERVAL '7 days' GROUP BY u.id, u.name, u."displayName" ORDER BY earned DESC LIMIT 10`);
          let text = '📅 *Топ недели:*\n\n';
          r.rows.forEach((u, i) => { const m = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`; text += `${m} ${u.displayName || u.name} — +${u.earned} ₽\n`; });
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '⭐ По репутации', callback_data: 'leaderboard' }], [{ text: '💰 По балансу', callback_data: 'leaderboard_balance' }], [{ text: '🔙 Назад', callback_data: 'menu' }]] });
        } catch { await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      if (data === 'daily') {
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        const now = new Date();
        const last = user.lastDailyBonusAt ? new Date(user.lastDailyBonusAt) : null;
        const hS = last ? (now - last) / 3600000 : 24;
        if (hS < 24) { await edit(`⏳ *Бонус уже получен.* Через ${Math.ceil(24 - hS)} ч.`, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        const sc = last && hS >= 24 && hS <= 48;
        const ns = sc ? (user.loginStreak || 0) + 1 : 1;
        const m = getStreakMultiplier(ns);
        const base = 10;
        const b = Math.round(base * m);
        await query('UPDATE "User" SET balance = balance + $1, "loginStreak"=$2, "lastDailyBonusAt"=NOW() WHERE id=$3', [b, ns, user.id]);
        await query(`INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt") VALUES ($1,'daily_bonus',$2,'completed',$3,NOW())`, [user.id, b, `Ежедневный бонус (streak ${ns})`]);
        const xp = await addExperience(user.id, 15);
        const achs = await checkAchievements(user.id);
        await edit(`🎁 *Бонус!* +${b} ₽\n🔥 Streak: *${ns}* дн. (×${m})\n_+15 XP_`, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
        await notifyLevelUp(user.id, xp, sendMessage);
        await notifyAchievements(user.id, achs, sendMessage);
        return res.status(200).send('OK');
      }

      if (data === 'referral') {
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        let code = user.referralCode;
        if (!code) { code = Math.random().toString(36).substring(2, 8).toUpperCase(); await query('UPDATE "User" SET "referralCode"=$1 WHERE id=$2', [code, user.id]); }
        const l1 = await query('SELECT COUNT(*)::int AS c FROM "User" WHERE "referredBy"=$1', [user.id]);
        const l2 = await query(`SELECT COUNT(*)::int AS c FROM "User" u WHERE u."referredBy" IN (SELECT id FROM "User" WHERE "referredBy"=$1)`, [user.id]);
        const l3 = await query(`SELECT COUNT(*)::int AS c FROM "User" u WHERE u."referredBy" IN (SELECT id FROM "User" WHERE "referredBy" IN (SELECT id FROM "User" WHERE "referredBy"=$1))`, [user.id]);
        const te = await query(`SELECT COALESCE(SUM(amount),0)::int AS s FROM "ReferralEarning" WHERE "userId"=$1`, [user.id]);
        const text = `🔗 *Рефералы*\n\nКод: *${code}*\nhttps://nerv.vercel.app/signup?ref=${code}\n\n📊 *Сеть:*\n├ Ур.1: *${l1.rows[0].c}* × 50 ₽\n├ Ур.2: *${l2.rows[0].c}* × 25 ₽\n└ Ур.3: *${l3.rows[0].c}* × 10 ₽\n\n💰 *Заработано:* ${te.rows[0].s} ₽`;
        await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }

      if (data === 'players_menu') {
        await edit('👥 *Поиск игроков*\n\nНапиши `/search Имя`', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }

      if (data.startsWith('msg_')) {
        const id = parseInt(data.split('_')[1]);
        const target = await getUserById(id);
        if (!target) { await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        await edit(`💬 *Чат с ${target.displayName || target.name}*\n\n/msg ${target.id} <текст>`, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'players_menu' }]] });
        return res.status(200).send('OK');
      }

      if (data === 'inbox') {
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        const r = await query(`SELECT m.text, m."fromUserId", u.name, u."displayName" FROM "Message" m JOIN "User" u ON m."fromUserId"=u.id WHERE m."toUserId"=$1 AND m."isRead"=false ORDER BY m."createdAt" DESC`, [user.id]);
        if (r.rows.length === 0) { await edit('📭 *Пусто.*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        let text = '💬 *Новые:*\n\n';
        r.rows.forEach(m => { text += `👤 ${m.displayName || m.name}: ${m.text}\n/msg ${m.fromUserId} ...\n\n`; });
        await query('UPDATE "Message" SET "isRead"=true WHERE "toUserId"=$1 AND "isRead"=false', [user.id]);
        await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }

      if (data === 'create') {
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        userState[chatId] = { step: 'title' };
        await edit('📝 *Создание задания*\n\nВведите *название*:', 'Markdown', { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }

      if (data === 'help') {
        await edit(
          '📖 *Помощь*\n\n🎯 /start, /profile, /tasks, /my\n💰 /wallet, /daily, /referral, /leaderboard\n📅 /quests, /stats\n👥 /search, /msg, /inbox\n⚙️ /link, /delete_data',
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

    if (user && user.isBanned) { await send('🚫 *Вы заблокированы.*'); return res.status(200).send('OK'); }

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
        [{ text: 'ℹ️ О боте', callback_data: 'about' }, { text: '❓ Помощь', callback_data: 'help' }],
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
        if (r.rows.length === 0) { await send('❌ *Не найден*'); return res.status(200).send('OK'); }
        const u = r.rows[0];
        await query('UPDATE "User" SET "telegramChatId"=$1, "telegramLinked"=true WHERE id=$2', [String(chatId), u.id]);
        await send(`✅ *Привязано!*\n👤 ${u.name}`, 'Markdown', { inline_keyboard: [[{ text: '📊 Профиль', callback_data: 'profile' }]] });
      } catch (e) { console.error(e); await send('❌ *Ошибка*'); }
      return res.status(200).send('OK');
    }
    if (text === '/link') { await send('⚠️ `/link your@email.com`'); return res.status(200).send('OK'); }

    // ---- /profile ----
    if (text === '/profile') {
      if (!user) { await send('❌ *Не привязан.* /link your@email.com'); return res.status(200).send('OK'); }
      const rank = await query(`SELECT COUNT(*)::int + 1 AS pos FROM "User" WHERE reputation > $1`, [user.reputation]);
      await send(`👤 *${user.displayName || user.name}*\n\n🎖 Ур. ${user.level || 1} (${user.experience || 0} XP)\n💰 ${user.balance} ₽\n⭐ ${user.reputation}\n🎮 ${user.role}\n🏅 #${rank.rows[0].pos}\n🔥 ${user.loginStreak} дн.`);
      return res.status(200).send('OK');
    }
    if (text.startsWith('/profile ')) {
      const id = parseInt(text.replace('/profile ', '').trim());
      if (isNaN(id)) { await send('❌ *Неверный ID*'); return res.status(200).send('OK'); }
      const t = await getUserById(id);
      if (!t) { await send('❌ *Не найден*'); return res.status(200).send('OK'); }
      await send(`👤 *${t.displayName || t.name}*\n\n🎖 Ур. ${t.level || 1}\n⭐ ${t.reputation}\n🎮 ${t.role}\n\n/msg ${t.id}`);
      return res.status(200).send('OK');
    }

    // ---- /my ----
    if (text === '/my') {
      if (!user) { await send('❌ *Сначала привяжи*'); return res.status(200).send('OK'); }
      try {
        const r = await query(`SELECT t.id, t.title, t.reward, t.status, u.name AS creator FROM "Task" t JOIN "User" u ON t."creatorId" = u.id WHERE t."playerId"=$1 ORDER BY t."updatedAt" DESC LIMIT 15`, [user.id]);
        if (r.rows.length === 0) { await send('📭 *Нет заданий.*'); return res.status(200).send('OK'); }
        let msg = '📝 *Твои задания:*\n\n';
        r.rows.forEach((t, i) => { const e = t.status === 'taken' ? '🟡' : t.status === 'voting' ? '🗳️' : t.status === 'approved' ? '✅' : '⚪'; msg += `${i + 1}. ${e} *${t.title}* · ${t.reward} ₽\n`; });
        await send(msg);
      } catch { await send('❌ *Ошибка*'); }
      return res.status(200).send('OK');
    }

    // ---- /quests ----
    if (text === '/quests') {
      if (!user) { await send('❌ *Привяжи*'); return res.status(200).send('OK'); }
      try {
        const all = await query(`SELECT id, description, reward, "requirementValue" FROM "DailyQuest"`);
        if (all.rows.length === 0) { await send('📅 *Пусто.*'); return res.status(200).send('OK'); }
        const p = await query(`SELECT "questId", progress, completed FROM "UserDailyQuest" WHERE "userId"=$1 AND date = CURRENT_DATE`, [user.id]);
        const pm = {};
        p.rows.forEach(x => { pm[x.questId] = x; });
        let msg = '📅 *Квесты:*\n\n';
        all.rows.forEach(q => {
          const x = pm[q.id];
          msg += `${x?.completed ? '✅' : '🔸'} *${q.description}*\n   ${x?.progress || 0}/${q.requirementValue} · 🎁 ${q.reward} ₽\n\n`;
        });
        await send(msg);
      } catch { await send('❌'); }
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
          if (t.status === 'open' && isPlayer && !t.playerId) row.push({ text: '🎯', callback_data: `take_${t.id}` });
          if (t.status === 'voting') { row.push({ text: '✅', callback_data: `vote_${t.id}_approve` }); row.push({ text: '❌', callback_data: `vote_${t.id}_reject` }); }
          buttons.push(row);
        });
        buttons.push([{ text: '🔙 Назад', callback_data: 'menu' }]);
        await send('📋 *Задания:*', 'Markdown', { inline_keyboard: buttons });
      } catch { await send('❌'); }
      return res.status(200).send('OK');
    }

    // ---- /search ----
    if (text.startsWith('/search ')) {
      const q = text.replace('/search ', '').trim();
      if (q.length < 2) { await send('⚠️ *Минимум 2*'); return res.status(200).send('OK'); }
      const r = await query(`SELECT id, name, "displayName", reputation, level FROM "User" WHERE name ILIKE $1 OR "displayName" ILIKE $1 LIMIT 10`, [`%${q}%`]);
      if (r.rows.length === 0) { await send('👥 *Никто*'); return res.status(200).send('OK'); }
      let msg = '👥 *Найдено:*\n\n';
      r.rows.forEach(u => { msg += `• ${u.displayName || u.name} (⭐ ${u.reputation})\n/profile ${u.id}\n/msg ${u.id}\n\n`; });
      await send(msg);
      return res.status(200).send('OK');
    }

    // ---- /msg ----
    if (text.startsWith('/msg ')) {
      if (!user) { await send('❌'); return res.status(200).send('OK'); }
      const parts = text.split(' ');
      if (parts.length < 3) { await send('⚠️ `/msg id текст`'); return res.status(200).send('OK'); }
      const id = parseInt(parts[1]);
      if (isNaN(id)) { await send('❌ ID'); return res.status(200).send('OK'); }
      const msgText = parts.slice(2).join(' ');
      const t = await getUserById(id);
      if (!t) { await send('❌ *Не найден*'); return res.status(200).send('OK'); }
      if (t.id === user.id) { await send('❌'); return res.status(200).send('OK'); }
      await query(`INSERT INTO "Message" ("fromUserId","toUserId",text,"createdAt") VALUES ($1,$2,$3,NOW())`, [user.id, t.id, msgText]);
      await send(`✅ *Отправлено ${t.displayName || t.name}*`);
      const tr = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [t.id]);
      if (tr.rows[0]?.telegramChatId) await sendMessage(tr.rows[0].telegramChatId, `💬 *От ${user.displayName || user.name}:*\n\n${msgText}\n\n/msg ${user.id} <ответ>`);
      const achs = await checkAchievements(user.id);
      await notifyAchievements(user.id, achs, sendMessage);
      return res.status(200).send('OK');
    }

    // ---- /inbox ----
    if (text === '/inbox') {
      if (!user) { await send('❌'); return res.status(200).send('OK'); }
      const r = await query(`SELECT m.text, m."fromUserId", u.name, u."displayName" FROM "Message" m JOIN "User" u ON m."fromUserId"=u.id WHERE m."toUserId"=$1 AND m."isRead"=false ORDER BY m."createdAt" DESC`, [user.id]);
      if (r.rows.length === 0) { await send('📭 *Нет сообщений.*'); return res.status(200).send('OK'); }
      let msg = '💬 *Новые:*\n\n';
      r.rows.forEach(m => { msg += `👤 ${m.displayName || m.name}: ${m.text}\n/msg ${m.fromUserId} ...\n\n`; });
      await query('UPDATE "Message" SET "isRead"=true WHERE "toUserId"=$1 AND "isRead"=false', [user.id]);
      await send(msg);
      return res.status(200).send('OK');
    }

    // ---- /daily ----
    if (text === '/daily') {
      if (!user) { await send('❌'); return res.status(200).send('OK'); }
      const now = new Date();
      const last = user.lastDailyBonusAt ? new Date(user.lastDailyBonusAt) : null;
      const hS = last ? (now - last) / 3600000 : 24;
      if (hS < 24) { await send(`⏳ *Уже получен.* Через ${Math.ceil(24 - hS)} ч.`); return res.status(200).send('OK'); }
      const sc = last && hS >= 24 && hS <= 48;
      const ns = sc ? (user.loginStreak || 0) + 1 : 1;
      const m = getStreakMultiplier(ns);
      const b = Math.round(10 * m);
      await query('UPDATE "User" SET balance = balance + $1, "loginStreak"=$2, "lastDailyBonusAt"=NOW() WHERE id=$3', [b, ns, user.id]);
      await query(`INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt") VALUES ($1,'daily_bonus',$2,'completed',$3,NOW())`, [user.id, b, `Ежедневный бонус`]);
      const xp = await addExperience(user.id, 15);
      const achs = await checkAchievements(user.id);
      await send(`🎁 *+${b} ₽*\n🔥 Streak: ${ns} дн. (×${m})\n_+15 XP_`);
      await notifyLevelUp(user.id, xp, sendMessage);
      await notifyAchievements(user.id, achs, sendMessage);
      return res.status(200).send('OK');
    }

    // ---- /referral ----
    if (text === '/referral') {
      if (!user) { await send('❌'); return res.status(200).send('OK'); }
      let code = user.referralCode;
      if (!code) { code = Math.random().toString(36).substring(2, 8).toUpperCase(); await query('UPDATE "User" SET "referralCode"=$1 WHERE id=$2', [code, user.id]); }
      const l1 = await query('SELECT COUNT(*)::int AS c FROM "User" WHERE "referredBy"=$1', [user.id]);
      const te = await query('SELECT COALESCE(SUM(amount),0)::int AS s FROM "ReferralEarning" WHERE "userId"=$1', [user.id]);
      await send(`🔗 *Рефералы*\n\nКод: *${code}*\nhttps://nerv.vercel.app/signup?ref=${code}\n\n👥 Приглашено: *${l1.rows[0].c}*\n💰 Заработано: *${te.rows[0].s} ₽*`);
      return res.status(200).send('OK');
    }

    // ---- /leaderboard ----
    if (text === '/leaderboard') {
      const r = await query('SELECT name, "displayName", reputation, level FROM "User" ORDER BY reputation DESC LIMIT 10');
      let msg = '🏆 *Топ:*\n\n';
      r.rows.forEach((u, i) => { const m = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`; msg += `${m} ${u.displayName || u.name} — ⭐ ${u.reputation}\n`; });
      await send(msg);
      return res.status(200).send('OK');
    }

    // ---- /admin ----
    if (text === '/admin') {
      if (!isAdmin) { await send('⛔'); return res.status(200).send('OK'); }
      await send('⚙️ *Админ-панель*', 'Markdown', {
        inline_keyboard: [
          [{ text: '👥 Пользователи', callback_data: 'admin_users' }],
          [{ text: '📋 Задания', callback_data: 'admin_tasks' }],
          [{ text: '📊 Расширенная статистика', callback_data: 'admin_stats_full' }],
          [{ text: '📢 Рассылка', callback_data: 'admin_broadcast' }],
          [{ text: '🔙 Меню', callback_data: 'menu' }],
        ],
      });
      return res.status(200).send('OK');
    }

    // ---- /mod ----
    if (text === '/mod') {
      if (!isModerator) { await send('⛔'); return res.status(200).send('OK'); }
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
        '📖 *Помощь*\n\n🎯 /start, /profile, /tasks, /my\n💰 /wallet, /daily, /referral, /leaderboard\n📅 /quests, /stats\n👥 /search, /msg, /inbox\n⚙️ /link, /delete_data',
        'Markdown',
        { inline_keyboard: [[{ text: '🔙 Меню', callback_data: 'menu' }]] }
      );
      return res.status(200).send('OK');
    }

    // ---- /delete_data ----
    if (text === '/delete_data') {
      if (!user) { await send('❌'); return res.status(200).send('OK'); }
      await query('UPDATE "User" SET "telegramChatId"=NULL, "telegramLinked"=false WHERE id=$1', [user.id]);
      await send('✅ *Отвязано.*');
      return res.status(200).send('OK');
    }

    // ---- Пошаговые состояния ----
    if (message.text && userState[chatId] && userState[chatId].step) {
      const state = userState[chatId];
      if (!user) { delete userState[chatId]; await send('❌'); return res.status(200).send('OK'); }

      if (state.step === 'broadcast_message') {
        try {
          const all = await query(`SELECT "telegramChatId" FROM "User" WHERE "telegramChatId" IS NOT NULL`);
          let sent = 0, failed = 0;
          for (const u of all.rows) {
            try { await sendMessage(u.telegramChatId, `📢 *Сообщение от админа:*\n\n${text}`); sent++; }
            catch { failed++; }
          }
          delete userState[chatId];
          await send(`✅ *Рассылка:*\n📤 ${sent}\n❌ ${failed}`, 'Markdown', { inline_keyboard: [[{ text: '🔙 В меню', callback_data: 'menu' }]] });
        } catch (e) { console.error('broadcast:', e); delete userState[chatId]; await send('❌'); }
        return res.status(200).send('OK');
      }

      if (state.step === 'report_reason') {
        try {
          const taskId = state.taskId;
          await query(`INSERT INTO "Report" ("reporterId", "targetType", "targetId", reason, status, "createdAt") VALUES ($1, 'task', $2, $3, 'pending', NOW())`, [user.id, taskId, text]);
          delete userState[chatId];
          await send('✅ *Жалоба отправлена!*', 'Markdown', { inline_keyboard: [[{ text: '🔙 В меню', callback_data: 'menu' }]] });
          const mods = await query(`SELECT "telegramChatId" FROM "User" WHERE "isModerator"=true OR role='admin'`);
          for (const m of mods.rows) { if (m.telegramChatId) await sendMessage(m.telegramChatId, `🚨 *Новая жалоба!*\n\nЗадание #${taskId}\n📝 ${text}`); }
        } catch (e) { console.error('report:', e); delete userState[chatId]; await send('❌'); }
        return res.status(200).send('OK');
      }

      if (state.step === 'support_message') {
        try {
          await query(`INSERT INTO "SupportMessage" ("userId", message, "isFromAdmin", "createdAt") VALUES ($1, $2, false, NOW())`, [user.id, text]);
          delete userState[chatId];
          await send('✅ *Обращение отправлено!*', 'Markdown', { inline_keyboard: [[{ text: '🔙 В меню', callback_data: 'menu' }]] });
        } catch (e) { console.error('support:', e); await send('❌'); delete userState[chatId]; }
        return res.status(200).send('OK');
      }

      if (state.step === 'title') { state.title = text; state.step = 'description'; await send('📝 *Введите описание:*'); return res.status(200).send('OK'); }
      if (state.step === 'description') { state.description = text; state.step = 'reward'; await send('💰 *Введите награду (число, >=10):*'); return res.status(200).send('OK'); }
      if (state.step === 'reward') {
        const reward = parseInt(text, 10);
        if (isNaN(reward) || reward < 10) { await send('❌ *Число больше 9*'); return res.status(200).send('OK'); }
        if (user.role !== 'viewer' && user.role !== 'admin') { await send('❌ *Только зрители и админы*'); delete userState[chatId]; return res.status(200).send('OK'); }
        if (user.balance < reward) { await send(`❌ *Недостаточно.* Баланс: ${user.balance} ₽`); delete userState[chatId]; return res.status(200).send('OK'); }

        // 🤖 AI-модерация
        await send('🤖 *Проверяю контент...*\n\nОбычно это занимает 2-5 секунд.');
        const mod = await aiModerateContent(state.title, state.description);

        if (!mod.ok) {
          await logModeration(user.id, null, 'task_text', `BLOCKED: ${mod.reason}`, 'REJECTED');
          delete userState[chatId];
          await send(`🚫 *Задание отклонено модерацией*\n\n📝 ${mod.reason}\n\n_Попробуй переформулировать._`, 'Markdown', { inline_keyboard: [[{ text: '🔙 В меню', callback_data: 'menu' }]] });
          return res.status(200).send('OK');
        }

        const tr = await query(`INSERT INTO "Task" (title,description,reward,status,"creatorId","createdAt","updatedAt") VALUES ($1,$2,$3,'open',$4,NOW(),NOW()) RETURNING *`, [state.title, state.description, reward, user.id]);
        const t = tr.rows[0];
        await logModeration(user.id, t.id, 'task_text', `OK: ${mod.reason || 'approved'}`, 'APPROVED');
        await query('UPDATE "User" SET balance = balance - $1 WHERE id=$2', [reward, user.id]);
        await query(`INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt") VALUES ($1,'task_create',$2,'completed',$3,NOW())`, [user.id, -reward, `Создание "${t.title}"`]);
        const xpRes = await addExperience(user.id, 10);
        const questRewards = await checkDailyQuests(user.id, 'task_created', 1);
        const achs = await checkAchievements(user.id);
        await postTaskToChannel(t.id, t.title, t.description, t.reward, user.displayName || user.name, sendMessage);
        delete userState[chatId];
        let msg = `✅ *Создано!*\n📌 ${t.title}\n💰 ${t.reward} ₽\n\n_+10 XP_\n_Проверено AI ✅_`;
        if (questRewards.length > 0) { msg += '\n\n📅 *Квесты:*\n'; questRewards.forEach(q => { msg += `✅ ${q.description} — +${q.reward} ₽\n`; }); }
        await send(msg, 'Markdown', { inline_keyboard: [[{ text: '📋 Задания', callback_data: 'tasks' }], [{ text: '🎨 Мои созданные', callback_data: 'my_created' }]] });
        await notifyLevelUp(user.id, xpRes, sendMessage);
        await notifyAchievements(user.id, achs, sendMessage);
        return res.status(200).send('OK');
      }
    }

    // ---- Видео ----
    if (message.video || message.document) {
      if (!user || user.role !== 'player') { await send('❌ *Только игроки*'); return res.status(200).send('OK'); }
      const tr = await query(`SELECT * FROM "Task" WHERE "playerId"=$1 AND status='taken' ORDER BY "updatedAt" DESC LIMIT 1`, [user.id]);
      if (tr.rows.length === 0) { await send('❌ *Нет активных*'); return res.status(200).send('OK'); }
      const t = tr.rows[0];
      const fileId = message.video?.file_id || message.document?.file_id;
      if (!fileId) { await send('❌'); return res.status(200).send('OK'); }
      await query(`UPDATE "Task" SET status='voting', "videoUrl"=$1 WHERE id=$2`, [fileId, t.id]);
      await send(`✅ *Видео загружено:*\n📌 ${t.title}`);
      const cr = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [t.creatorId]);
      if (cr.rows[0]?.telegramChatId) await sendMessage(cr.rows[0].telegramChatId, `🎬 *Видео:*\n📌 ${t.title}`);
      return res.status(200).send('OK');
    }

    await send('🤔 *Неизвестная команда.* /start');
    return res.status(200).send('OK');

  } catch (error) {
    console.error('Ошибка:', error);
    return res.status(500).send('Internal error');
  }
};