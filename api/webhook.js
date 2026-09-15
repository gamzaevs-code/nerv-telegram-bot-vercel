const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function query(sql, params = []) {
  return pool.query(sql, params);
}

const userState = {};

// ========== ХЕЛПЕРЫ ЭТАПА 2 ==========
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
    const quests = await query(`SELECT id, description, reward, "requirementValue" FROM "DailyQuest" WHERE "requirementType"=$1`, [actionType]);
    if (quests.rows.length === 0) return [];
    const rewards = [];
    for (const q of quests.rows) {
      const ex = await query(`SELECT progress, completed FROM "UserDailyQuest" WHERE "userId"=$1 AND "questId"=$2 AND date = CURRENT_DATE`, [userId, q.id]);
      const progress = ex.rows[0]?.progress || 0;
      if (ex.rows[0]?.completed) continue;
      const np = progress + amount;
      const nc = np >= q.requirementValue;
      if (ex.rows.length > 0) await query(`UPDATE "UserDailyQuest" SET progress=$1, completed=$2 WHERE "userId"=$3 AND "questId"=$4 AND date = CURRENT_DATE`, [np, nc, userId, q.id]);
      else await query(`INSERT INTO "UserDailyQuest" ("userId","questId",progress,completed,date) VALUES ($1,$2,$3,$4,CURRENT_DATE)`, [userId, q.id, np, nc]);
      if (nc) {
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
    if (r.rows[0]?.telegramChatId) await sendMessageFn(r.rows[0].telegramChatId, `🎉 *Уровень повышен!*\n\nТы достиг *${levelInfo.newLevel}* уровня!\n💰 Бонус: +${bonus} ₽`);
  } catch (e) { console.error('notifyLevelUp:', e); }
};

// ========== ХЕЛПЕРЫ ЭТАПА 3.1 ==========
const checkAchievements = async (userId) => {
  try {
    const u = await query(
      `SELECT balance, reputation, "loginStreak",
              (SELECT COUNT(*)::int FROM "Task" WHERE "playerId"=$1 AND status='approved') AS tasks_completed,
              (SELECT COUNT(*)::int FROM "Task" WHERE "creatorId"=$1) AS tasks_created,
              (SELECT COUNT(*)::int FROM "Message" WHERE "fromUserId"=$1) AS messages_sent,
              (SELECT COUNT(*)::int + 1 FROM "User" WHERE reputation > (SELECT reputation FROM "User" WHERE id=$1)) AS rank
       FROM "User" WHERE id=$1`, [userId]
    );
    if (u.rows.length === 0) return [];
    const s = u.rows[0];
    const conditions = {
      tasks_completed_1: s.tasks_completed >= 1, tasks_completed_5: s.tasks_completed >= 5, tasks_completed_10: s.tasks_completed >= 10,
      tasks_created_5: s.tasks_created >= 5, balance_5000: s.balance >= 5000, reputation_50: s.reputation >= 50,
      streak_7: s.loginStreak >= 7, streak_30: s.loginStreak >= 30, messages_10: s.messages_sent >= 10, rank_1: s.rank === 1,
    };
    const all = await query('SELECT id, name, icon, reward, "conditionType" FROM "Achievement"');
    const un = await query('SELECT "achievementId" FROM "UserAchievement" WHERE "userId"=$1', [userId]);
    const unIds = new Set(un.rows.map(r => r.achievementId));
    const newA = [];
    for (const a of all.rows) {
      if (unIds.has(a.id)) continue;
      if (conditions[a.conditionType]) {
        await query('INSERT INTO "UserAchievement" ("userId","achievementId","unlockedAt") VALUES ($1,$2,NOW())', [userId, a.id]);
        await query('UPDATE "User" SET balance = balance + $1 WHERE id=$2', [a.reward, userId]);
        await query(`INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt") VALUES ($1,'achievement',$2,'completed',$3,NOW())`, [userId, a.reward, `Достижение: ${a.name}`]);
        newA.push(a);
      }
    }
    return newA;
  } catch (e) { console.error('checkAchievements:', e); return []; }
};

const notifyAchievements = async (userId, achievements, sendMessageFn) => {
  if (!achievements || achievements.length === 0) return;
  try {
    const r = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [userId]);
    if (!r.rows[0]?.telegramChatId) return;
    for (const a of achievements) await sendMessageFn(r.rows[0].telegramChatId, `🎖 *Новое достижение!*\n\n${a.icon} *${a.name}*\n💰 +${a.reward} ₽`);
  } catch (e) { console.error('notifyAchievements:', e); }
};

// ========== ХЕЛПЕРЫ ЭТАПА 3.2 ==========
const processReferralEarnings = async (userId, sourceAmount) => {
  try {
    const ae = await query(`SELECT id FROM "ReferralEarning" WHERE "fromUserId"=$1 LIMIT 1`, [userId]);
    if (ae.rows.length > 0) return [];
    const levels = [{ level: 1, percent: 0.10 }, { level: 2, percent: 0.05 }, { level: 3, percent: 0.02 }];
    const earnings = [];
    let currentUserId = userId;
    let referrerRow = await query('SELECT "referredBy" FROM "User" WHERE id=$1', [currentUserId]);
    let referrerId = referrerRow.rows[0]?.referredBy;
    for (const { level, percent } of levels) {
      if (!referrerId) break;
      const bonus = Math.max(Math.round(sourceAmount * percent), 5);
      await query('UPDATE "User" SET balance = balance + $1 WHERE id=$2', [bonus, referrerId]);
      await query(`INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt") VALUES ($1,'referral_bonus',$2,'completed',$3,NOW())`, [referrerId, bonus, `Реферальный бонус (уровень ${level})`]);
      await query(`INSERT INTO "ReferralEarning" ("userId","fromUserId",level,amount,"createdAt") VALUES ($1,$2,$3,$4,NOW())`, [referrerId, userId, level, bonus]);
      const entry = { level, userId: referrerId, bonus };
      const rc = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [referrerId]);
      if (rc.rows[0]?.telegramChatId) entry.chatId = rc.rows[0].telegramChatId;
      earnings.push(entry);
      const nr = await query('SELECT "referredBy" FROM "User" WHERE id=$1', [referrerId]);
      referrerId = nr.rows[0]?.referredBy;
      currentUserId = referrerId;
    }
    return earnings;
  } catch (e) { console.error('processReferralEarnings:', e); return []; }
};

const notifyReferralEarnings = async (earnings, sendMessageFn) => {
  if (!earnings || earnings.length === 0) return;
  for (const e of earnings) {
    if (!e.chatId) continue;
    try { await sendMessageFn(e.chatId, `💸 *Реферальный бонус!*\n\nУровень: *${e.level}*\n💰 +${e.bonus} ₽`); } catch (err) { console.error(err); }
  }
};

// ========== ХЕЛПЕР ЭТАПА 4 ==========
const postTaskToChannel = async (taskId, title, description, reward, creatorName, sendMessageFn) => {
  try {
    const channelId = process.env.CHANNEL_ID;
    if (!channelId) return;
    const text = `📢 *Новое задание!*\n\n📌 *${title}*\n📝 ${(description || '—').slice(0, 200)}\n💰 *${reward} ₽*\n👤 ${creatorName}\n\n🎯 @nerv_05bot`;
    await sendMessageFn(channelId, text, 'Markdown', { inline_keyboard: [[{ text: '🎯 Открыть', url: `https://t.me/nerv_05bot?start=task_${taskId}` }]] });
  } catch (e) { console.error('postTaskToChannel:', e); }
};

// ========== ХЕЛПЕР ЭТАПА 5: AI-МОДЕРАЦИЯ ==========
const AI_MODEL = process.env.AI_MODEL || 'GigaChat/GigaChat-2-Max';
const AI_API_URL = 'https://foundation-models.api.cloud.ru/v1/chat/completions';

const aiModerateContent = async (title, description) => {
  try {
    const apiKey = process.env.CLOUD_API_KEY;
    if (!apiKey) return { ok: true, reason: 'no_api_key' };
    const prompt = `Ты — модератор контента. Проверь задание на нарушения: мат, оскорбления, наркотики, оружие, азартные игры, экстремизм, порнографию, скам, фишинг.\n\nНазвание: ${title}\nОписание: ${(description || '').slice(0, 500)}\n\nОтветь СТРОГО в JSON: {"ok": true, "reason": ""} или {"ok": false, "reason": "краткое объяснение"}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(AI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: AI_MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 200 }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) { console.error('AI error:', response.status); return { ok: true, reason: 'service_error' }; }
    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '';
    const clean = raw.replace(/```json\s*|\s*```/g, '').trim();
    let parsed;
    try { parsed = JSON.parse(clean); } catch {
      const match = clean.match(/\{[\s\S]*?\}/);
      if (match) { try { parsed = JSON.parse(match[0]); } catch { parsed = null; } }
    }
    if (!parsed || typeof parsed.ok !== 'boolean') return { ok: true, reason: 'parse_error' };
    return { ok: parsed.ok, reason: (parsed.reason || '').slice(0, 200) };
  } catch (e) { console.error('aiModerateContent:', e); return { ok: true, reason: 'exception' }; }
};

const logModeration = async (userId, taskId, contentType, verdict, finalStatus) => {
  try {
    await query(`INSERT INTO "ModerationLog" ("userId", "taskId", "contentType", "aiVerdict", "finalStatus", "createdAt") VALUES ($1,$2,$3,$4,$5,NOW())`, [userId, taskId, contentType, verdict, finalStatus]);
  } catch (e) { console.error('logModeration:', e); }
};

// ========== ХЕЛПЕРЫ ЭТАПА 6: МАГАЗИН ==========
const getEquippedBadge = async (userId) => {
  try {
    const r = await query(
      `SELECT ci.name, ci.type FROM "UserCosmetic" uc JOIN "CosmeticItem" ci ON ci.id = uc."itemId" WHERE uc."userId"=$1 AND uc.equipped=true AND ci.type='badge' LIMIT 1`,
      [userId]
    );
    return r.rows[0] || null;
  } catch { return null; }
};

const checkVipStatus = async (userId) => {
  try {
    const r = await query(
      `SELECT ci.name, uc."purchasedAt" FROM "UserCosmetic" uc JOIN "CosmeticItem" ci ON ci.id = uc."itemId"
       WHERE uc."userId"=$1 AND ci.type='vip' AND uc."purchasedAt" >= NOW() - INTERVAL '30 days'
       ORDER BY uc."purchasedAt" DESC LIMIT 1`, [userId]
    );
    return r.rows[0] || null;
  } catch { return null; }
};

const applyBoost = async (userId) => {
  try {
    const r = await query(
      `SELECT uc.id, ci.name, ci.price FROM "UserCosmetic" uc JOIN "CosmeticItem" ci ON ci.id = uc."itemId"
       WHERE uc."userId"=$1 AND ci.type='boost' AND uc.equipped=false ORDER BY uc."purchasedAt" ASC LIMIT 1`, [userId]
    );
    if (r.rows.length === 0) return null;
    await query('DELETE FROM "UserCosmetic" WHERE id=$1', [r.rows[0].id]);
    const mult = r.rows[0].name.includes('×3') ? 3 : 2;
    return { mult, name: r.rows[0].name };
  } catch (e) { console.error('applyBoost:', e); return null; }
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
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
    };

    const getUser = async (chatId) => {
      try {
        const r = await query(`SELECT id, name, "displayName", balance, reputation, role, "referralCode", "loginStreak", "lastDailyBonusAt", "telegramChatId", level, experience, "isBanned", "isModerator" FROM "User" WHERE "telegramChatId" = $1`, [String(chatId)]);
        return r.rows[0] || null;
      } catch (e) { console.error('getUser:', e); return null; }
    };

    const getUserById = async (id) => {
      try {
        const r = await query(`SELECT id, name, "displayName", balance, reputation, role, level, experience FROM "User" WHERE id = $1`, [id]);
        return r.rows[0] || null;
      } catch { return null; }
    };

    // ============ CALLBACK ============
    if (callback_query) {
      const chatId = callback_query.message?.chat?.id || callback_query.from.id;
      const messageId = callback_query.message?.message_id;
      const data = callback_query.data;

      const edit = async (text, parse_mode = 'Markdown', reply_markup = null) => {
        const payload = { chat_id: chatId, message_id: messageId, text, parse_mode };
        if (reply_markup) payload.reply_markup = reply_markup;
        await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
      };

      const user = await getUser(chatId);
      if (user && user.isBanned) { await edit('🚫 *Вы заблокированы.*', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
      const isAdmin = user && user.role === 'admin';
      const isModerator = user && (user.isModerator || user.role === 'admin');

      // ===== МАГАЗИН =====
      if (data === 'shop') {
        await edit(
          '🛒 *Магазин NERV*\n\nВыбери категорию:',
          'Markdown',
          {
            inline_keyboard: [
              [{ text: '🎖 Значки', callback_data: 'shop_cat_badge' }, { text: '💎 VIP', callback_data: 'shop_cat_vip' }],
              [{ text: '⚡ Бусты', callback_data: 'shop_cat_boost' }, { text: '🎨 Другое', callback_data: 'shop_cat_other' }],
              [{ text: '🎒 Мои покупки', callback_data: 'my_items' }],
              [{ text: '🔙 Назад', callback_data: 'menu' }],
            ],
          }
        );
        return res.status(200).send('OK');
      }

      if (data.startsWith('shop_cat_')) {
        const cat = data.replace('shop_cat_', '');
        let items;
        if (cat === 'badge') items = await query(`SELECT id, name, description, price FROM "CosmeticItem" WHERE type='badge' ORDER BY price ASC`);
        else if (cat === 'vip') items = await query(`SELECT id, name, description, price FROM "CosmeticItem" WHERE type='vip' ORDER BY price ASC`);
        else if (cat === 'boost') items = await query(`SELECT id, name, description, price FROM "CosmeticItem" WHERE type='boost' ORDER BY price ASC`);
        else items = await query(`SELECT id, name, description, price FROM "CosmeticItem" WHERE type NOT IN ('badge','vip','boost') ORDER BY price ASC`);

        if (items.rows.length === 0) { await edit('📭 *Пусто.*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'shop' }]] }); return res.status(200).send('OK'); }
        const buttons = items.rows.map(i => [{ text: `${i.name} — ${i.price} ₽`, callback_data: `shop_item_${i.id}` }]);
        buttons.push([{ text: '🔙 Назад', callback_data: 'shop' }]);
        await edit(`🛒 *${cat === 'badge' ? '🎖 Значки' : cat === 'vip' ? '💎 VIP' : cat === 'boost' ? '⚡ Бусты' : '🎨 Другое'}*`, 'Markdown', { inline_keyboard: buttons });
        return res.status(200).send('OK');
      }

      if (data.startsWith('shop_item_')) {
        const itemId = parseInt(data.split('_')[2]);
        const r = await query(`SELECT id, name, description, price, type FROM "CosmeticItem" WHERE id=$1`, [itemId]);
        if (r.rows.length === 0) { await edit('❌ *Не найдено*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'shop' }]] }); return res.status(200).send('OK'); }
        const item = r.rows[0];
        const owned = user ? await query(`SELECT id, equipped FROM "UserCosmetic" WHERE "userId"=$1 AND "itemId"=$2`, [user.id, itemId]) : { rows: [] };
        let text = `🛒 *${item.name}*\n\n📝 ${item.description || '—'}\n💰 Цена: *${item.price} ₽*`;
        const buttons = [];
        if (owned.rows.length > 0) {
          text += `\n\n✅ *Уже куплено*`;
          if (item.type === 'badge' && !owned.rows[0].equipped) buttons.push([{ text: '🎖 Надеть значок', callback_data: `equip_badge_${itemId}` }]);
          if (item.type === 'badge' && owned.rows[0].equipped) buttons.push([{ text: '❌ Снять значок', callback_data: `unequip_badge_${itemId}` }]);
        } else {
          if (!user) text += '\n\n_Привяжи аккаунт для покупки: /link email_';
          else buttons.push([{ text: '💳 Купить', callback_data: `shop_buy_${itemId}` }]);
        }
        buttons.push([{ text: '🔙 Назад', callback_data: `shop_cat_${item.type}` }]);
        await edit(text, 'Markdown', { inline_keyboard: buttons });
        return res.status(200).send('OK');
      }

      if (data.startsWith('shop_buy_')) {
        const itemId = parseInt(data.split('_')[2]);
        if (!user) { await edit('❌ *Привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'shop' }]] }); return res.status(200).send('OK'); }
        const r = await query(`SELECT id, name, price, type FROM "CosmeticItem" WHERE id=$1`, [itemId]);
        if (r.rows.length === 0) { await edit('❌ *Не найдено*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'shop' }]] }); return res.status(200).send('OK'); }
        const item = r.rows[0];
        const owned = await query(`SELECT id FROM "UserCosmetic" WHERE "userId"=$1 AND "itemId"=$2`, [user.id, itemId]);
        if (owned.rows.length > 0) { await edit('❌ *Уже куплено*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: `shop_item_${itemId}` }]] }); return res.status(200).send('OK'); }
        if (user.balance < item.price) { await edit(`❌ *Недостаточно.*\nНужно: ${item.price} ₽\nУ тебя: ${user.balance} ₽`, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: `shop_item_${itemId}` }]] }); return res.status(200).send('OK'); }
        await query('UPDATE "User" SET balance = balance - $1 WHERE id=$2', [item.price, user.id]);
        await query('INSERT INTO "UserCosmetic" ("userId","itemId",equipped,"purchasedAt") VALUES ($1,$2,$3,NOW())', [user.id, itemId, false]);
        await query('INSERT INTO "ShopTransaction" ("userId","itemId","amountPaid","purchasedAt") VALUES ($1,$2,$3,NOW())', [user.id, itemId, item.price]);
        await query(`INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt") VALUES ($1,'shop_purchase',$2,'completed',$3,NOW())`, [user.id, -item.price, `Покупка "${item.name}"`]);
        await edit(`✅ *Куплено!*\n\n🛒 ${item.name}\n💰 -${item.price} ₽\n\n_Осталось: ${user.balance - item.price} ₽_`, 'Markdown', { inline_keyboard: [[{ text: '🎒 Мои покупки', callback_data: 'my_items' }], [{ text: '🛒 В магазин', callback_data: 'shop' }]] });
        return res.status(200).send('OK');
      }

      if (data.startsWith('equip_badge_')) {
        const itemId = parseInt(data.split('_')[2]);
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        await query(`UPDATE "UserCosmetic" SET equipped=false WHERE "userId"=$1 AND "itemId" IN (SELECT id FROM "CosmeticItem" WHERE type='badge')`, [user.id]);
        await query(`UPDATE "UserCosmetic" SET equipped=true WHERE "userId"=$1 AND "itemId"=$2`, [user.id, itemId]);
        await edit('✅ *Значок надет!*', 'Markdown', { inline_keyboard: [[{ text: '🎒 Мои покупки', callback_data: 'my_items' }]] });
        return res.status(200).send('OK');
      }

      if (data.startsWith('unequip_badge_')) {
        const itemId = parseInt(data.split('_')[2]);
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        await query(`UPDATE "UserCosmetic" SET equipped=false WHERE "userId"=$1 AND "itemId"=$2`, [user.id, itemId]);
        await edit('✅ *Значок снят*', 'Markdown', { inline_keyboard: [[{ text: '🎒 Мои покупки', callback_data: 'my_items' }]] });
        return res.status(200).send('OK');
      }

      if (data === 'my_items') {
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        const r = await query(`SELECT uc.id, uc.equipped, ci.name, ci.type, ci.price FROM "UserCosmetic" uc JOIN "CosmeticItem" ci ON ci.id = uc."itemId" WHERE uc."userId"=$1 ORDER BY uc."purchasedAt" DESC`, [user.id]);
        if (r.rows.length === 0) { await edit('🎒 *Пока ничего не куплено.*', 'Markdown', { inline_keyboard: [[{ text: '🛒 В магазин', callback_data: 'shop' }], [{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        let text = '🎒 *Мои покупки:*\n\n';
        const buttons = [];
        r.rows.forEach(it => {
          const eq = it.equipped ? ' ✅' : '';
          text += `${eq} *${it.name}* · ${it.type} · ${it.price} ₽\n`;
          if (it.type === 'badge') buttons.push([{ text: `${it.equipped ? '❌ Снять' : '🎖 Надеть'} ${it.name.slice(0, 20)}`, callback_data: it.equipped ? `unequip_badge_${it.id}` : `shop_item_${it.id}` }]);
        });
        buttons.push([{ text: '🛒 В магазин', callback_data: 'shop' }]);
        buttons.push([{ text: '🔙 Назад', callback_data: 'menu' }]);
        await edit(text, 'Markdown', { inline_keyboard: buttons });
        return res.status(200).send('OK');
      }

      // ===== МЕНЮ =====
      if (data === 'menu') {
        const keyboard = [
          [{ text: '📊 Профиль', callback_data: 'profile' }, { text: '🎖 Достижения', callback_data: 'achievements' }],
          [{ text: '📋 Доступные задания', callback_data: 'tasks' }],
          [{ text: '📝 Мои задания', callback_data: 'my_tasks' }, { text: '🎨 Мои созданные', callback_data: 'my_created' }],
          [{ text: '🛒 Магазин', callback_data: 'shop' }, { text: '🎒 Мои покупки', callback_data: 'my_items' }],
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

      if (data === 'profile') {
        if (!user) { await edit('❌ *Не привязан.* /link your@email.com', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        const rank = await query(`SELECT COUNT(*)::int + 1 AS pos FROM "User" WHERE reputation > $1`, [user.reputation]);
        const badge = await getEquippedBadge(user.id);
        const vip = await checkVipStatus(user.id);
        const level = user.level || 1;
        const exp = user.experience || 0;
        const efN = Math.pow(level, 2) * 50;
        const efC = Math.pow(level - 1, 2) * 50;
        const pct = Math.min(Math.round(((exp - efC) / (efN - efC)) * 100), 100);
        const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
        let text = `👤 *${user.displayName || user.name}*${badge ? ' ' + badge.name.split(' ')[0] : ''}${vip ? ' 💎' : ''}\n\n`;
        text += `🎖 Ур: *${level}*\n${bar} ${pct}%\n_${exp} / ${efN} XP_\n\n`;
        text += `💰 ${user.balance} ₽\n⭐ ${user.reputation}\n🎮 ${user.role}${user.isModerator ? ' 👮' : ''}\n🏅 #${rank.rows[0].pos}\n🔥 Streak: ${user.loginStreak} дн.`;
        if (vip) text += `\n💎 VIP активен`;
        if (badge) text += `\n🎖 Значок: ${badge.name}`;
        await edit(text, 'Markdown', { inline_keyboard: [[{ text: '📈 Статистика', callback_data: 'stats' }], [{ text: '🎒 Мои покупки', callback_data: 'my_items' }], [{ text: '🔙 Назад', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }

      // ===== ДУБЛИРУЕМ ОСТАЛЬНЫЕ ОБРАБОТЧИКИ =====
      // (admin_panel, admin_users, admin_user_, admin_ban_, admin_mod_, admin_stats_full, admin_broadcast, admin_tasks,
      //  mod_panel, mod_reports, report_resolve_, mod_pending, mod_task_, mod_ai_, mod_approve_, mod_reject_, mod_delete_, report_task_,
      //  about, quests, tasks, task_, take_, abandon_, vote_, my_tasks, my_created, achievements, stats, support, wallet, transactions,
      //  leaderboard, leaderboard_balance, leaderboard_week, daily, referral, players_menu, msg_, inbox, create, help)

      // АДМИН
      if (data === 'admin_panel') {
        if (!isAdmin) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        await edit('⚙️ *Админ-панель*', 'Markdown', { inline_keyboard: [
          [{ text: '👥 Пользователи', callback_data: 'admin_users' }],
          [{ text: '📋 Задания', callback_data: 'admin_tasks' }],
          [{ text: '📊 Расширенная статистика', callback_data: 'admin_stats_full' }],
          [{ text: '📢 Рассылка', callback_data: 'admin_broadcast' }],
          [{ text: '🔙 Меню', callback_data: 'menu' }],
        ]});
        return res.status(200).send('OK');
      }
      if (data === 'admin_users') {
        if (!isAdmin) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        const r = await query(`SELECT id, name, role, balance, level, "isBanned" FROM "User" ORDER BY "createdAt" DESC LIMIT 20`);
        let text = '👥 *Пользователи:*\n\n';
        const buttons = [];
        r.rows.forEach(u => {
          const ban = u.isBanned ? '🚫' : '';
          text += `🆔 ${u.id} ${ban} | ${u.name} · ${u.role} · ${u.balance}₽\n`;
          buttons.push([{ text: `${ban} ${u.name.slice(0, 25)}`, callback_data: `admin_user_${u.id}` }]);
        });
        buttons.push([{ text: '🔙 Назад', callback_data: 'admin_panel' }]);
        await edit(text, 'Markdown', { inline_keyboard: buttons });
        return res.status(200).send('OK');
      }
      if (data.startsWith('admin_user_')) {
        const id = parseInt(data.split('_')[2]);
        if (!isAdmin) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        const r = await query(`SELECT id, name, email, role, balance, reputation, level, "isBanned", "isModerator" FROM "User" WHERE id=$1`, [id]);
        if (r.rows.length === 0) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        const u = r.rows[0];
        const text = `👤 *${u.name}*\n\n🆔 ${u.id}\n📧 ${u.email}\n🎮 ${u.role}\n🎖 Ур: ${u.level}\n💰 ${u.balance} ₽\n⭐ ${u.reputation}\n🚫 Бан: ${u.isBanned ? 'Да' : 'Нет'}\n👮 Модер: ${u.isModerator ? 'Да' : 'Нет'}`;
        await edit(text, 'Markdown', { inline_keyboard: [
          [{ text: u.isBanned ? '✅ Разбанить' : '🚫 Забанить', callback_data: `admin_ban_${u.id}` }],
          [{ text: u.isModerator ? '❌ Снять модератора' : '👮 Сделать модератором', callback_data: `admin_mod_${u.id}` }],
          [{ text: '🔙 К списку', callback_data: 'admin_users' }],
        ]});
        return res.status(200).send('OK');
      }
      if (data.startsWith('admin_ban_')) {
        const id = parseInt(data.split('_')[2]);
        if (!isAdmin) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        const u = await query('SELECT "isBanned" FROM "User" WHERE id=$1', [id]);
        const ns = !u.rows[0].isBanned;
        await query('UPDATE "User" SET "isBanned"=$1 WHERE id=$2', [ns, id]);
        await edit(ns ? `🚫 *#${id} забанен*` : `✅ *#${id} разбанен*`, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: `admin_user_${id}` }]] });
        return res.status(200).send('OK');
      }
      if (data.startsWith('admin_mod_')) {
        const id = parseInt(data.split('_')[2]);
        if (!isAdmin) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        const u = await query('SELECT "isModerator" FROM "User" WHERE id=$1', [id]);
        const ns = !u.rows[0].isModerator;
        await query('UPDATE "User" SET "isModerator"=$1 WHERE id=$2', [ns, id]);
        await edit(ns ? `👮 *#${id} — модератор*` : `❌ *Снято*`, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: `admin_user_${id}` }]] });
        return res.status(200).send('OK');
      }
      if (data === 'admin_stats_full') {
        if (!isAdmin) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        const u = await query('SELECT COUNT(*)::int AS c FROM "User"');
        const t = await query('SELECT COUNT(*)::int AS c FROM "Task"');
        const tA = await query(`SELECT COUNT(*)::int AS c FROM "Task" WHERE status='approved'`);
        const b = await query('SELECT COALESCE(SUM(balance),0)::bigint AS s FROM "User"');
        const top = await query(`SELECT name, "displayName", balance FROM "User" ORDER BY balance DESC LIMIT 5`);
        let text = `📊 *Статистика:*\n\n👥 ${u.rows[0].c}\n📋 ${t.rows[0].c}\n✅ ${tA.rows[0].c}\n💰 ${b.rows[0].s} ₽\n\n🏆 Топ-5:\n`;
        top.rows.forEach((x, i) => { text += `${i + 1}. ${x.displayName || x.name} — ${x.balance} ₽\n`; });
        await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'admin_panel' }]] });
        return res.status(200).send('OK');
      }
      if (data === 'admin_broadcast') {
        if (!isAdmin) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        userState[chatId] = { step: 'broadcast_message' };
        await edit('📢 *Рассылка*\n\nВведите текст. Отмена — /menu', 'Markdown', { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }
      if (data === 'admin_tasks') {
        if (!isAdmin) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        const r = await query(`SELECT t.id, t.title, t.reward, t.status, u.name AS creator FROM "Task" t JOIN "User" u ON t."creatorId" = u.id ORDER BY t."createdAt" DESC LIMIT 20`);
        let text = '📋 *Задания:*\n\n';
        r.rows.forEach(t => { text += `#${t.id} · ${t.title} · ${t.reward}₽ · ${t.status} · ${t.creator}\n`; });
        await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'admin_panel' }]] });
        return res.status(200).send('OK');
      }

      // МОДЕРАЦИЯ
      if (data === 'mod_panel') {
        if (!isModerator) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        const o = await query(`SELECT COUNT(*)::int AS c FROM "Report" WHERE status='pending'`);
        const p = await query(`SELECT COUNT(*)::int AS c FROM "Task" WHERE status='voting'`);
        await edit(`👮 *Модерация*\n\n🚨 Жалоб: ${o.rows[0].c}\n⏳ На модерации: ${p.rows[0].c}`, 'Markdown', { inline_keyboard: [
          [{ text: '🚨 Открытые жалобы', callback_data: 'mod_reports' }],
          [{ text: '⏳ Задания на модерации', callback_data: 'mod_pending' }],
          [{ text: '🔙 Назад', callback_data: 'menu' }],
        ]});
        return res.status(200).send('OK');
      }
      if (data === 'mod_reports') {
        if (!isModerator) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        const r = await query(`SELECT r.id, r."targetId", r.reason, u.name AS reporter FROM "Report" r JOIN "User" u ON r."reporterId" = u.id WHERE r.status='pending' ORDER BY r."createdAt" DESC LIMIT 10`);
        if (r.rows.length === 0) { await edit('📭 *Пусто*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'mod_panel' }]] }); return res.status(200).send('OK'); }
        let text = '🚨 *Жалобы:*\n\n';
        const buttons = [];
        r.rows.forEach(rep => { text += `#${rep.id} → Задание #${rep.targetId} от ${rep.reporter}: ${rep.reason}\n`; buttons.push([{ text: `#${rep.targetId}`, callback_data: `task_${rep.targetId}` }, { text: '✅ Закрыть', callback_data: `report_resolve_${rep.id}` }]); });
        buttons.push([{ text: '🔙', callback_data: 'mod_panel' }]);
        await edit(text, 'Markdown', { inline_keyboard: buttons });
        return res.status(200).send('OK');
      }
      if (data.startsWith('report_resolve_')) {
        const rid = parseInt(data.split('_')[2]);
        if (!isModerator) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        await query(`UPDATE "Report" SET status='resolved', "resolvedAt"=NOW() WHERE id=$1`, [rid]);
        await query(`INSERT INTO "ModeratorLog" ("moderatorId", action, "targetId", reason, "createdAt") VALUES ($1,'resolve_report',$2,'обработано',NOW())`, [user.id, rid]);
        await edit(`✅ *#${rid} закрыта*`, 'Markdown', { inline_keyboard: [[{ text: '🚨 К жалобам', callback_data: 'mod_reports' }], [{ text: '🔙', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }
      if (data === 'mod_pending') {
        if (!isModerator) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        const r = await query(`SELECT id, title, reward FROM "Task" WHERE status='voting' ORDER BY "updatedAt" DESC LIMIT 15`);
        if (r.rows.length === 0) { await edit('📭 *Пусто*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'mod_panel' }]] }); return res.status(200).send('OK'); }
        const buttons = r.rows.map(t => [{ text: `📌 ${t.title} (${t.reward}₽)`, callback_data: `mod_task_${t.id}` }]);
        buttons.push([{ text: '🔙', callback_data: 'mod_panel' }]);
        await edit('⏳ *На модерации:*', 'Markdown', { inline_keyboard: buttons });
        return res.status(200).send('OK');
      }
      if (data.startsWith('mod_task_')) {
        const tid = parseInt(data.split('_')[2]);
        if (!isModerator) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        const r = await query(`SELECT id, title, status FROM "Task" WHERE id=$1`, [tid]);
        if (r.rows.length === 0) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        const t = r.rows[0];
        await edit(`👮 *Задание #${t.id}*\n📌 ${t.title}\n📊 ${t.status}`, 'Markdown', { inline_keyboard: [
          [{ text: '🤖 AI-проверка', callback_data: `mod_ai_${t.id}` }],
          [{ text: '✅ Одобрить', callback_data: `mod_approve_${t.id}` }],
          [{ text: '❌ Отклонить', callback_data: `mod_reject_${t.id}` }],
          [{ text: '🗑 Удалить', callback_data: `mod_delete_${t.id}` }],
          [{ text: '🔙 Назад', callback_data: `task_${t.id}` }],
        ]});
        return res.status(200).send('OK');
      }
      if (data.startsWith('mod_ai_')) {
        const tid = parseInt(data.split('_')[2]);
        if (!isModerator) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        const r = await query(`SELECT title, description FROM "Task" WHERE id=$1`, [tid]);
        if (r.rows.length === 0) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        await edit('🤖 *Проверяю...*', 'Markdown', { inline_keyboard: [] });
        const mod = await aiModerateContent(r.rows[0].title, r.rows[0].description);
        const v = mod.ok ? '✅ Безопасно' : `🚫 ${mod.reason}`;
        await logModeration(user.id, tid, 'manual_ai', `MANUAL: ${mod.reason || 'ok'}`, mod.ok ? 'APPROVED' : 'REJECTED');
        await edit(`🤖 *#${tid}*\n\n${v}`, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: `mod_task_${tid}` }]] });
        return res.status(200).send('OK');
      }
      if (data.startsWith('mod_approve_')) {
        const tid = parseInt(data.split('_')[2]);
        if (!isModerator) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        await query(`UPDATE "Task" SET status='approved' WHERE id=$1`, [tid]);
        await query(`INSERT INTO "ModeratorLog" ("moderatorId", action, "targetId", reason, "createdAt") VALUES ($1,'approve',$2,'ручное',NOW())`, [user.id, tid]);
        await edit(`✅ *#${tid} одобрено*`, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }
      if (data.startsWith('mod_reject_')) {
        const tid = parseInt(data.split('_')[2]);
        if (!isModerator) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        await query(`UPDATE "Task" SET status='rejected' WHERE id=$1`, [tid]);
        await query(`INSERT INTO "ModeratorLog" ("moderatorId", action, "targetId", reason, "createdAt") VALUES ($1,'reject',$2,'ручное',NOW())`, [user.id, tid]);
        await edit(`❌ *#${tid} отклонено*`, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }
      if (data.startsWith('mod_delete_')) {
        const tid = parseInt(data.split('_')[2]);
        if (!isModerator) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        await query(`DELETE FROM "Task" WHERE id=$1`, [tid]);
        await query(`INSERT INTO "ModeratorLog" ("moderatorId", action, "targetId", reason, "createdAt") VALUES ($1,'delete',$2,'удалено',NOW())`, [user.id, tid]);
        await edit(`🗑 *#${tid} удалено*`, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }
      if (data.startsWith('report_task_')) {
        const tid = parseInt(data.split('_')[2]);
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        userState[chatId] = { step: 'report_reason', taskId: tid };
        await edit('🚨 *Жалоба*\n\nОпиши причину. Отмена — /menu', 'Markdown', { inline_keyboard: [[{ text: '❌', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }

      // ABOUT
      if (data === 'about') {
        await edit(`ℹ️ *О NERV*\n\n🎯 Платформа для выполнения заданий.\n\n👤 Зрители создают, игроки выполняют.\n\n💰 Экономика: бонусы, квесты, достижения, рефералы, магазин.\n\n🛡 AI-модерация через GigaChat.\n\n👨‍💻 @gamzaev_s`, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }

      // КВЕСТЫ
      if (data === 'quests') {
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        const all = await query(`SELECT id, description, reward, "requirementValue" FROM "DailyQuest"`);
        if (all.rows.length === 0) { await edit('📅 *Пусто*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        const p = await query(`SELECT "questId", progress, completed FROM "UserDailyQuest" WHERE "userId"=$1 AND date = CURRENT_DATE`, [user.id]);
        const pm = {};
        p.rows.forEach(x => { pm[x.questId] = x; });
        let total = 0;
        let text = '📅 *Квесты:*\n\n';
        all.rows.forEach(q => {
          const x = pm[q.id];
          if (x?.completed) total++;
          const pr = Math.min(Math.round(((x?.progress || 0) / q.requirementValue) * 100), 100);
          const bar = '█'.repeat(Math.floor(pr / 10)) + '░'.repeat(10 - Math.floor(pr / 10));
          text += `${x?.completed ? '✅' : '🔸'} *${q.description}*\n   ${bar} ${x?.progress || 0}/${q.requirementValue} · 🎁 ${q.reward} ₽\n\n`;
        });
        text = `📅 *${total}/${all.rows.length}*\n\n` + text;
        await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }

      // ЗАДАНИЯ
      if (data === 'tasks') {
        const r = await query(`SELECT id, title, reward, status, "playerId" FROM "Task" WHERE status IN ('open','voting') ORDER BY "createdAt" DESC LIMIT 10`);
        if (r.rows.length === 0) { await edit('📭 *Нет заданий*', 'Markdown', { inline_keyboard: [[{ text: '➕ Создать', callback_data: 'create' }], [{ text: '🔙', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        const isP = user && user.role === 'player';
        const buttons = [];
        r.rows.forEach(t => {
          const row = [{ text: `📌 ${t.title} (${t.reward}₽)`, callback_data: `task_${t.id}` }];
          if (t.status === 'open' && isP && !t.playerId) row.push({ text: '🎯', callback_data: `take_${t.id}` });
          if (t.status === 'voting') { row.push({ text: '✅', callback_data: `vote_${t.id}_approve` }); row.push({ text: '❌', callback_data: `vote_${t.id}_reject` }); }
          buttons.push(row);
        });
        buttons.push([{ text: '🔙', callback_data: 'menu' }]);
        await edit('📋 *Доступные:*', 'Markdown', { inline_keyboard: buttons });
        return res.status(200).send('OK');
      }
      if (data.startsWith('task_')) {
        const tid = parseInt(data.split('_')[1]);
        const r = await query(`SELECT t.*, u.name AS creator, p.name AS player FROM "Task" t JOIN "User" u ON t."creatorId" = u.id LEFT JOIN "User" p ON t."playerId" = p.id WHERE t.id = $1`, [tid]);
        if (r.rows.length === 0) { await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'tasks' }]] }); return res.status(200).send('OK'); }
        const t = r.rows[0];
        const vr = await query(`SELECT value, COUNT(*)::int AS cnt FROM "Vote" WHERE "taskId"=$1 GROUP BY value`, [tid]);
        const ap = vr.rows.find(x => x.value === 'approve')?.cnt || 0;
        const rj = vr.rows.find(x => x.value === 'reject')?.cnt || 0;
        let text = `📌 *${t.title}*\n\n📝 ${t.description || '—'}\n💰 ${t.reward} ₽\n👤 ${t.creator}\n📌 ${t.status}\n👍 ${ap} / 👎 ${rj}\n`;
        if (t.player) text += `🎮 ${t.player}\n`;
        const buttons = [];
        const isP = user && user.role === 'player';
        if (t.status === 'open' && isP && !t.playerId) buttons.push([{ text: '🎯 Взять', callback_data: `take_${t.id}` }]);
        if (user) buttons.push([{ text: '🚨 Жалоба', callback_data: `report_task_${t.id}` }]);
        if (isModerator) buttons.push([{ text: '👮 Модерация', callback_data: `mod_task_${t.id}` }]);
        buttons.push([{ text: '🔙 К списку', callback_data: 'tasks' }, { text: '🔙 Меню', callback_data: 'menu' }]);
        await edit(text, 'Markdown', { inline_keyboard: buttons });
        return res.status(200).send('OK');
      }
      if (data.startsWith('take_')) {
        const tid = parseInt(data.split('_')[1]);
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        if (user.role !== 'player') { await edit('❌ *Только игроки*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'tasks' }]] }); return res.status(200).send('OK'); }
        const r = await query(`UPDATE "Task" SET status='taken', "playerId"=$1 WHERE id=$2 AND status='open' AND "playerId" IS NULL RETURNING *`, [user.id, tid]);
        if (r.rowCount === 0) { await edit('❌ *Уже взято*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'tasks' }]] }); return res.status(200).send('OK'); }
        const t = r.rows[0];
        const xp = await addExperience(user.id, 5);
        const qr = await checkDailyQuests(user.id, 'task_taken', 1);
        const acs = await checkAchievements(user.id);
        let msg = `✅ *Взято!*\n📌 ${t.title}\n💰 ${t.reward} ₽\n\n_+5 XP_`;
        if (qr.length > 0) { msg += '\n\n📅 *Квесты:*\n'; qr.forEach(q => { msg += `✅ ${q.description} +${q.reward} ₽\n`; }); }
        await edit(msg, 'Markdown', { inline_keyboard: [[{ text: '📝 Мои', callback_data: 'my_tasks' }], [{ text: '🔙 Меню', callback_data: 'menu' }]] });
        await notifyLevelUp(user.id, xp, sendMessage);
        await notifyAchievements(user.id, acs, sendMessage);
        const cr = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [t.creatorId]);
        if (cr.rows[0]?.telegramChatId) await sendMessage(cr.rows[0].telegramChatId, `🎯 *Задание взято!*\n📌 ${t.title}`);
        return res.status(200).send('OK');
      }
      if (data.startsWith('abandon_')) {
        const tid = parseInt(data.split('_')[1]);
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        const r = await query(`UPDATE "Task" SET status='open', "playerId"=NULL WHERE id=$1 AND "playerId"=$2 AND status='taken' RETURNING *`, [tid, user.id]);
        if (r.rowCount === 0) { await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'my_tasks' }]] }); return res.status(200).send('OK'); }
        await edit(`↩️ Отказался: ${r.rows[0].title}`, 'Markdown', { inline_keyboard: [[{ text: '📝 Мои', callback_data: 'my_tasks' }], [{ text: '🔙', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }
      if (data.startsWith('vote_')) {
        const parts = data.split('_');
        const tid = parseInt(parts[1]);
        const val = parts[2];
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        const ex = await query('SELECT id FROM "Vote" WHERE "taskId"=$1 AND "voterId"=$2', [tid, user.id]);
        if (ex.rows.length > 0) { await edit('❌ *Уже голосовал*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'tasks' }]] }); return res.status(200).send('OK'); }
        await query('INSERT INTO "Vote" ("taskId","voterId",value,"createdAt") VALUES ($1,$2,$3,NOW())', [tid, user.id, val]);
        await query('UPDATE "User" SET reputation = reputation + 1 WHERE id = $1', [user.id]);
        const xp = await addExperience(user.id, 3);
        await checkDailyQuests(user.id, 'vote', 1);
        const acs = await checkAchievements(user.id);
        const vr = await query('SELECT value, COUNT(*)::int AS cnt FROM "Vote" WHERE "taskId"=$1 GROUP BY value', [tid]);
        const ap = vr.rows.find(x => x.value === 'approve')?.cnt || 0;
        const rj = vr.rows.find(x => x.value === 'reject')?.cnt || 0;
        await edit(`✅ *Голос*\n👍 ${ap} / 👎 ${rj}\n_+1 реп, +3 XP_`, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'tasks' }]] });
        await notifyLevelUp(user.id, xp, sendMessage);
        await notifyAchievements(user.id, acs, sendMessage);
        if (ap >= 5) {
          const tr = await query(`UPDATE "Task" SET status='approved' WHERE id=$1 RETURNING *`, [tid]);
          const t = tr.rows[0];
          const plr = await query('SELECT "loginStreak" FROM "User" WHERE id=$1', [t.playerId]);
          const mult = getStreakMultiplier(plr.rows[0]?.loginStreak || 0);
          let reward = Math.round(t.reward * mult);
          // Boost
          const boost = await applyBoost(t.playerId);
          if (boost) reward = Math.round(reward * boost.mult);
          await query('UPDATE "User" SET balance = balance + $1, "completedTasksCount" = "completedTasksCount" + 1 WHERE id=$2', [reward, t.playerId]);
          await query(`INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt") VALUES ($1,'reward',$2,'completed',$3,NOW())`, [t.playerId, reward, `Выполнение "${t.title}"`]);
          const xpP = await addExperience(t.playerId, 50);
          const qr = await checkDailyQuests(t.playerId, 'task_completed', 1);
          const acsP = await checkAchievements(t.playerId);
          const pl = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [t.playerId]);
          if (pl.rows[0]?.telegramChatId) {
            let m = `🎉 *Выполнено!*\n📌 ${t.title}\n💰 +${reward} ₽`;
            if (mult > 1) m += `\n🔥 ×${mult}`;
            if (boost) m += `\n⚡ ${boost.name}`;
            m += '\n_+50 XP_';
            if (qr.length > 0) { m += '\n\n📅 *Квесты:*\n'; qr.forEach(q => { m += `✅ ${q.description} +${q.reward} ₽\n`; }); }
            await sendMessage(pl.rows[0].telegramChatId, m);
          }
          await notifyLevelUp(t.playerId, xpP, sendMessage);
          await notifyAchievements(t.playerId, acsP, sendMessage);
          const ref = await processReferralEarnings(t.playerId, reward);
          await notifyReferralEarnings(ref, sendMessage);
          const cr = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [t.creatorId]);
          if (cr.rows[0]?.telegramChatId) await sendMessage(cr.rows[0].telegramChatId, `✅ *"${t.title}" выполнено!*`);
        }
        return res.status(200).send('OK');
      }
      if (data === 'my_tasks') {
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        const r = await query(`SELECT t.id, t.title, t.reward, t.status FROM "Task" t WHERE t."playerId"=$1 ORDER BY t."updatedAt" DESC LIMIT 15`, [user.id]);
        if (r.rows.length === 0) { await edit('📭 *Пусто*', 'Markdown', { inline_keyboard: [[{ text: '📋', callback_data: 'tasks' }], [{ text: '🔙', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        let text = '📝 *Твои:*\n\n';
        const buttons = [];
        r.rows.forEach((t, i) => {
          const e = t.status === 'taken' ? '🟡' : t.status === 'voting' ? '🗳️' : t.status === 'approved' ? '✅' : '⚪';
          text += `${i + 1}. ${e} ${t.title} · ${t.reward}₽\n`;
          const row = [{ text: `📌 ${t.title.slice(0, 20)}`, callback_data: `task_${t.id}` }];
          if (t.status === 'taken') row.push({ text: '↩️', callback_data: `abandon_${t.id}` });
          buttons.push(row);
        });
        buttons.push([{ text: '🔙', callback_data: 'menu' }]);
        await edit(text, 'Markdown', { inline_keyboard: buttons });
        return res.status(200).send('OK');
      }
      if (data === 'my_created') {
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        const r = await query(`SELECT t.id, t.title, t.reward, t.status FROM "Task" t WHERE t."creatorId"=$1 ORDER BY t."createdAt" DESC LIMIT 15`, [user.id]);
        if (r.rows.length === 0) { await edit('📭 *Пусто*', 'Markdown', { inline_keyboard: [[{ text: '➕', callback_data: 'create' }], [{ text: '🔙', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        let text = '🎨 *Созданные:*\n\n';
        r.rows.forEach((t, i) => { text += `${i + 1}. ${t.title} · ${t.reward}₽ · ${t.status}\n`; });
        await edit(text, 'Markdown', { inline_keyboard: [[{ text: '➕ Ещё', callback_data: 'create' }], [{ text: '🔙', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }
      if (data === 'achievements') {
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        const r = await query(`SELECT a.name, a.description, a.icon, a.reward, ua."unlockedAt" FROM "Achievement" a LEFT JOIN "UserAchievement" ua ON ua."achievementId" = a.id AND ua."userId" = $1 ORDER BY ua."unlockedAt" DESC NULLS LAST`, [user.id]);
        if (r.rows.length === 0) { await edit('🎖 *Пусто*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        let text = '🎖 *Достижения:*\n\n';
        let u = 0;
        r.rows.forEach(a => { const isU = a.unlockedAt !== null; if (isU) u++; text += `${isU ? '✅' : '🔒'} ${a.icon || '🏅'} *${a.name}*\n   ${a.description}\n   🎁 ${a.reward} ₽\n\n`; });
        text = `🎖 *${u}/${r.rows.length}*\n\n` + text;
        await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }
      if (data === 'stats') {
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        const rank = await query(`SELECT COUNT(*)::int + 1 AS pos FROM "User" WHERE reputation > $1`, [user.reputation]);
        const tc = await query(`SELECT COUNT(*)::int AS c FROM "Task" WHERE "creatorId"=$1`, [user.id]);
        const td = await query(`SELECT COUNT(*)::int AS c FROM "Task" WHERE "playerId"=$1 AND status='approved'`, [user.id]);
        const e = await query(`SELECT COALESCE(SUM(amount),0)::int AS s FROM "Transaction" WHERE "userId"=$1 AND amount > 0`, [user.id]);
        const s = await query(`SELECT COALESCE(SUM(amount),0)::int AS s FROM "Transaction" WHERE "userId"=$1 AND amount < 0`, [user.id]);
        const ac = await query(`SELECT COUNT(*)::int AS c FROM "UserAchievement" WHERE "userId"=$1`, [user.id]);
        const re = await query(`SELECT COALESCE(SUM(amount),0)::int AS s FROM "ReferralEarning" WHERE "userId"=$1`, [user.id]);
        const text = `📈 *Статистика ${user.displayName || user.name}*\n\n🎖 Ур: ${user.level || 1} (${user.experience || 0} XP)\n🏅 #${rank.rows[0].pos}\n⭐ ${user.reputation}\n🔥 ${user.loginStreak} дн.\n🎖 ${ac.rows[0].c} ачивок\n\n🎨 Создано: ${tc.rows[0].c}\n✅ Выполнено: ${td.rows[0].c}\n\n📥 +${e.rows[0].s} ₽\n📤 -${Math.abs(s.rows[0].s)} ₽\n💸 Реферальные: ${re.rows[0].s} ₽`;
        await edit(text, 'Markdown', { inline_keyboard: [[{ text: '📊 Профиль', callback_data: 'profile' }], [{ text: '🏆 Топ', callback_data: 'leaderboard' }], [{ text: '🔙', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }
      if (data === 'support') {
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        userState[chatId] = { step: 'support_message' };
        await edit('💡 *Поддержка*\n\nОпиши проблему. /menu', 'Markdown', { inline_keyboard: [[{ text: '❌', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }
      if (data === 'wallet') {
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        const r = await query('SELECT "createdAt", amount, reason FROM "Transaction" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 5', [user.id]);
        let text = `💳 *Кошелёк*\n\n💰 ${user.balance} ₽\n\n`;
        if (r.rows.length === 0) text += 'Пусто.';
        else r.rows.forEach(t => { text += `${new Date(t.createdAt).toLocaleDateString()} ${t.amount > 0 ? '+' : ''}${t.amount} ₽ — ${t.reason}\n`; });
        await edit(text, 'Markdown', { inline_keyboard: [[{ text: '📈 История', callback_data: 'transactions' }], [{ text: '🔙', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }
      if (data === 'transactions') {
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        const r = await query('SELECT "createdAt", amount, reason FROM "Transaction" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 20', [user.id]);
        let text = '📊 *История:*\n\n';
        if (r.rows.length === 0) text += 'Пусто.';
        else r.rows.forEach(t => { text += `${new Date(t.createdAt).toLocaleDateString()} ${t.amount > 0 ? '+' : ''}${t.amount} ₽ — ${t.reason}\n`; });
        await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'wallet' }]] });
        return res.status(200).send('OK');
      }
      if (data === 'leaderboard') {
        const r = await query('SELECT name, "displayName", reputation, level FROM "User" ORDER BY reputation DESC LIMIT 10');
        let text = '🏆 *Топ:*\n\n';
        r.rows.forEach((u, i) => { const m = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`; text += `${m} ${u.displayName || u.name} — ⭐ ${u.reputation}\n`; });
        await edit(text, 'Markdown', { inline_keyboard: [[{ text: '💰 По балансу', callback_data: 'leaderboard_balance' }], [{ text: '📅 Топ недели', callback_data: 'leaderboard_week' }], [{ text: '🔙', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }
      if (data === 'leaderboard_balance') {
        const r = await query('SELECT name, "displayName", balance FROM "User" ORDER BY balance DESC LIMIT 10');
        let text = '💰 *Топ по балансу:*\n\n';
        r.rows.forEach((u, i) => { const m = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`; text += `${m} ${u.displayName || u.name} — ${u.balance}₽\n`; });
        await edit(text, 'Markdown', { inline_keyboard: [[{ text: '⭐ Репутация', callback_data: 'leaderboard' }], [{ text: '🔙', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }
      if (data === 'leaderboard_week') {
        const r = await query(`SELECT u.name, u."displayName", COALESCE(SUM(t.amount),0)::int AS earned FROM "User" u LEFT JOIN "Transaction" t ON t."userId" = u.id AND t.amount > 0 AND t."createdAt" >= NOW() - INTERVAL '7 days' GROUP BY u.id, u.name, u."displayName" ORDER BY earned DESC LIMIT 10`);
        let text = '📅 *Топ недели:*\n\n';
        r.rows.forEach((u, i) => { const m = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`; text += `${m} ${u.displayName || u.name} — +${u.earned} ₽\n`; });
        await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }
      if (data === 'daily') {
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        const now = new Date();
        const last = user.lastDailyBonusAt ? new Date(user.lastDailyBonusAt) : null;
        const hS = last ? (now - last) / 3600000 : 24;
        if (hS < 24) { await edit(`⏳ *Уже получен.* Через ${Math.ceil(24 - hS)} ч.`, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        const sc = last && hS >= 24 && hS <= 48;
        const ns = sc ? (user.loginStreak || 0) + 1 : 1;
        const m = getStreakMultiplier(ns);
        const b = Math.round(10 * m);
        await query('UPDATE "User" SET balance = balance + $1, "loginStreak"=$2, "lastDailyBonusAt"=NOW() WHERE id=$3', [b, ns, user.id]);
        await query(`INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt") VALUES ($1,'daily_bonus',$2,'completed',$3,NOW())`, [user.id, b, `Ежедневный бонус`]);
        const xp = await addExperience(user.id, 15);
        const acs = await checkAchievements(user.id);
        await edit(`🎁 *+${b} ₽*\n🔥 Streak: ${ns} дн. (×${m})\n_+15 XP_`, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
        await notifyLevelUp(user.id, xp, sendMessage);
        await notifyAchievements(user.id, acs, sendMessage);
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
        await edit(`🔗 *Рефералы*\n\nКод: *${code}*\nhttps://nerv.vercel.app/signup?ref=${code}\n\n├ Ур.1: ${l1.rows[0].c} × 50 ₽\n├ Ур.2: ${l2.rows[0].c} × 25 ₽\n└ Ур.3: ${l3.rows[0].c} × 10 ₽\n\n💰 Заработано: *${te.rows[0].s} ₽*`, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }
      if (data === 'players_menu') { await edit('👥 `/search Имя`', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
      if (data.startsWith('msg_')) {
        const id = parseInt(data.split('_')[1]);
        const t = await getUserById(id);
        if (!t) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        await edit(`💬 *${t.displayName || t.name}*\n\n/msg ${t.id} <текст>`, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'players_menu' }]] });
        return res.status(200).send('OK');
      }
      if (data === 'inbox') {
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        const r = await query(`SELECT m.text, m."fromUserId", u.name, u."displayName" FROM "Message" m JOIN "User" u ON m."fromUserId"=u.id WHERE m."toUserId"=$1 AND m."isRead"=false ORDER BY m."createdAt" DESC`, [user.id]);
        if (r.rows.length === 0) { await edit('📭', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        let text = '💬 *Новые:*\n\n';
        r.rows.forEach(m => { text += `👤 ${m.displayName || m.name}: ${m.text}\n/msg ${m.fromUserId}\n\n`; });
        await query('UPDATE "Message" SET "isRead"=true WHERE "toUserId"=$1 AND "isRead"=false', [user.id]);
        await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }
      if (data === 'create') {
        if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }
        userState[chatId] = { step: 'title' };
        await edit('📝 *Создание задания*\n\nВведи название:', 'Markdown', { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }
      if (data === 'help') {
        await edit('📖 *Помощь*\n\n/start, /profile, /tasks, /my\n/wallet, /daily, /referral, /leaderboard\n/quests, /stats\n/search, /msg, /inbox\n/link, /delete_data\n\n🛒 Магазин — кнопка в меню', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }
      return res.status(200).send('OK');
    }

    // ============ ТЕКСТОВЫЕ ============
    const chatId = message.chat.id;
    const text = message.text || '';
    const send = async (msg, parse_mode = 'Markdown', reply_markup = null) => { await sendMessage(chatId, msg, parse_mode, reply_markup); };
    const user = await getUser(chatId);
    if (user && user.isBanned) { await send('🚫 *Заблокирован*'); return res.status(200).send('OK'); }
    const isAdmin = user && user.role === 'admin';
    const isModerator = user && (user.isModerator || user.role === 'admin');

    if (text === '/start' || text === '/menu') {
      const keyboard = [
        [{ text: '📊 Профиль', callback_data: 'profile' }, { text: '🎖 Достижения', callback_data: 'achievements' }],
        [{ text: '📋 Доступные задания', callback_data: 'tasks' }],
        [{ text: '📝 Мои задания', callback_data: 'my_tasks' }, { text: '🎨 Мои созданные', callback_data: 'my_created' }],
        [{ text: '🛒 Магазин', callback_data: 'shop' }, { text: '🎒 Мои покупки', callback_data: 'my_items' }],
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

    if (text.startsWith('/link ')) {
      const email = text.replace('/link ', '').trim().toLowerCase();
      if (!email.match(/^[^@]+@[^@]+\.[^@]+$/)) { await send('❌ *Email неверный*'); return res.status(200).send('OK'); }
      const r = await query('SELECT id, name FROM "User" WHERE email=$1', [email]);
      if (r.rows.length === 0) { await send('❌ *Не найден*'); return res.status(200).send('OK'); }
      await query('UPDATE "User" SET "telegramChatId"=$1, "telegramLinked"=true WHERE id=$2', [String(chatId), r.rows[0].id]);
      await send(`✅ *Привязано!*\n👤 ${r.rows[0].name}`, 'Markdown', { inline_keyboard: [[{ text: '📊 Профиль', callback_data: 'profile' }]] });
      return res.status(200).send('OK');
    }
    if (text === '/link') { await send('⚠️ `/link email`'); return res.status(200).send('OK'); }
    if (text === '/profile') {
      if (!user) { await send('❌ /link email'); return res.status(200).send('OK'); }
      const rank = await query(`SELECT COUNT(*)::int + 1 AS pos FROM "User" WHERE reputation > $1`, [user.reputation]);
      await send(`👤 *${user.displayName || user.name}*\n\n🎖 Ур. ${user.level || 1} (${user.experience || 0} XP)\n💰 ${user.balance} ₽\n⭐ ${user.reputation}\n🎮 ${user.role}\n🏅 #${rank.rows[0].pos}\n🔥 ${user.loginStreak} дн.`);
      return res.status(200).send('OK');
    }
    if (text === '/my') {
      if (!user) { await send('❌'); return res.status(200).send('OK'); }
      const r = await query(`SELECT t.title, t.reward, t.status FROM "Task" t WHERE t."playerId"=$1 ORDER BY t."updatedAt" DESC LIMIT 15`, [user.id]);
      if (r.rows.length === 0) { await send('📭'); return res.status(200).send('OK'); }
      let msg = '📝 *Твои:*\n\n';
      r.rows.forEach((t, i) => { const e = t.status === 'taken' ? '🟡' : t.status === 'voting' ? '🗳️' : t.status === 'approved' ? '✅' : '⚪'; msg += `${i + 1}. ${e} ${t.title} · ${t.reward}₽\n`; });
      await send(msg);
      return res.status(200).send('OK');
    }
    if (text === '/tasks') {
      const r = await query(`SELECT id, title, reward, status, "playerId" FROM "Task" WHERE status IN ('open','voting') ORDER BY "createdAt" DESC LIMIT 10`);
      if (r.rows.length === 0) { await send('📭'); return res.status(200).send('OK'); }
      const isP = user && user.role === 'player';
      const buttons = [];
      r.rows.forEach(t => {
        const row = [{ text: `📌 ${t.title} (${t.reward}₽)`, callback_data: `task_${t.id}` }];
        if (t.status === 'open' && isP && !t.playerId) row.push({ text: '🎯', callback_data: `take_${t.id}` });
        if (t.status === 'voting') { row.push({ text: '✅', callback_data: `vote_${t.id}_approve` }); row.push({ text: '❌', callback_data: `vote_${t.id}_reject` }); }
        buttons.push(row);
      });
      buttons.push([{ text: '🔙', callback_data: 'menu' }]);
      await send('📋 *Задания:*', 'Markdown', { inline_keyboard: buttons });
      return res.status(200).send('OK');
    }
    if (text.startsWith('/search ')) {
      const q = text.replace('/search ', '').trim();
      if (q.length < 2) { await send('⚠️'); return res.status(200).send('OK'); }
      const r = await query(`SELECT id, name, "displayName", reputation FROM "User" WHERE name ILIKE $1 OR "displayName" ILIKE $1 LIMIT 10`, [`%${q}%`]);
      if (r.rows.length === 0) { await send('👥'); return res.status(200).send('OK'); }
      let msg = '👥 *Найдено:*\n\n';
      r.rows.forEach(u => { msg += `• ${u.displayName || u.name} (⭐ ${u.reputation})\n/profile ${u.id}\n\n`; });
      await send(msg);
      return res.status(200).send('OK');
    }
    if (text.startsWith('/msg ')) {
      if (!user) { await send('❌'); return res.status(200).send('OK'); }
      const parts = text.split(' ');
      if (parts.length < 3) { await send('⚠️ `/msg id текст`'); return res.status(200).send('OK'); }
      const id = parseInt(parts[1]);
      if (isNaN(id)) { await send('❌'); return res.status(200).send('OK'); }
      const msgText = parts.slice(2).join(' ');
      const t = await getUserById(id);
      if (!t) { await send('❌'); return res.status(200).send('OK'); }
      if (t.id === user.id) { await send('❌'); return res.status(200).send('OK'); }
      await query(`INSERT INTO "Message" ("fromUserId","toUserId",text,"createdAt") VALUES ($1,$2,$3,NOW())`, [user.id, t.id, msgText]);
      await send(`✅ *Отправлено*`);
      const tr = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [t.id]);
      if (tr.rows[0]?.telegramChatId) await sendMessage(tr.rows[0].telegramChatId, `💬 *От ${user.displayName || user.name}:*\n\n${msgText}\n\n/msg ${user.id}`);
      const acs = await checkAchievements(user.id);
      await notifyAchievements(user.id, acs, sendMessage);
      return res.status(200).send('OK');
    }
    if (text === '/inbox') {
      if (!user) { await send('❌'); return res.status(200).send('OK'); }
      const r = await query(`SELECT m.text, m."fromUserId", u.name, u."displayName" FROM "Message" m JOIN "User" u ON m."fromUserId"=u.id WHERE m."toUserId"=$1 AND m."isRead"=false ORDER BY m."createdAt" DESC`, [user.id]);
      if (r.rows.length === 0) { await send('📭'); return res.status(200).send('OK'); }
      let msg = '💬 *Новые:*\n\n';
      r.rows.forEach(m => { msg += `👤 ${m.displayName || m.name}: ${m.text}\n/msg ${m.fromUserId}\n\n`; });
      await query('UPDATE "Message" SET "isRead"=true WHERE "toUserId"=$1 AND "isRead"=false', [user.id]);
      await send(msg);
      return res.status(200).send('OK');
    }
    if (text === '/daily') {
      if (!user) { await send('❌'); return res.status(200).send('OK'); }
      const now = new Date();
      const last = user.lastDailyBonusAt ? new Date(user.lastDailyBonusAt) : null;
      const hS = last ? (now - last) / 3600000 : 24;
      if (hS < 24) { await send(`⏳ *Уже получен.*`); return res.status(200).send('OK'); }
      const sc = last && hS >= 24 && hS <= 48;
      const ns = sc ? (user.loginStreak || 0) + 1 : 1;
      const m = getStreakMultiplier(ns);
      const b = Math.round(10 * m);
      await query('UPDATE "User" SET balance = balance + $1, "loginStreak"=$2, "lastDailyBonusAt"=NOW() WHERE id=$3', [b, ns, user.id]);
      await query(`INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt") VALUES ($1,'daily_bonus',$2,'completed',$3,NOW())`, [user.id, b, `Бонус`]);
      const xp = await addExperience(user.id, 15);
      const acs = await checkAchievements(user.id);
      await send(`🎁 *+${b} ₽*\n🔥 ${ns} дн.\n_+15 XP_`);
      await notifyLevelUp(user.id, xp, sendMessage);
      await notifyAchievements(user.id, acs, sendMessage);
      return res.status(200).send('OK');
    }
    if (text === '/referral') {
      if (!user) { await send('❌'); return res.status(200).send('OK'); }
      let code = user.referralCode;
      if (!code) { code = Math.random().toString(36).substring(2, 8).toUpperCase(); await query('UPDATE "User" SET "referralCode"=$1 WHERE id=$2', [code, user.id]); }
      const l1 = await query('SELECT COUNT(*)::int AS c FROM "User" WHERE "referredBy"=$1', [user.id]);
      const te = await query('SELECT COALESCE(SUM(amount),0)::int AS s FROM "ReferralEarning" WHERE "userId"=$1', [user.id]);
      await send(`🔗 *Рефералы*\n\nКод: *${code}*\nhttps://nerv.vercel.app/signup?ref=${code}\n\n👥 ${l1.rows[0].c}\n💰 ${te.rows[0].s} ₽`);
      return res.status(200).send('OK');
    }
    if (text === '/leaderboard') {
      const r = await query('SELECT name, "displayName", reputation FROM "User" ORDER BY reputation DESC LIMIT 10');
      let msg = '🏆 *Топ:*\n\n';
      r.rows.forEach((u, i) => { const m = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`; msg += `${m} ${u.displayName || u.name} — ⭐ ${u.reputation}\n`; });
      await send(msg);
      return res.status(200).send('OK');
    }
    if (text === '/quests') {
      if (!user) { await send('❌'); return res.status(200).send('OK'); }
      const all = await query(`SELECT id, description, reward, "requirementValue" FROM "DailyQuest"`);
      if (all.rows.length === 0) { await send('📅'); return res.status(200).send('OK'); }
      const p = await query(`SELECT "questId", progress, completed FROM "UserDailyQuest" WHERE "userId"=$1 AND date = CURRENT_DATE`, [user.id]);
      const pm = {};
      p.rows.forEach(x => { pm[x.questId] = x; });
      let msg = '📅 *Квесты:*\n\n';
      all.rows.forEach(q => { const x = pm[q.id]; msg += `${x?.completed ? '✅' : '🔸'} ${q.description}: ${x?.progress || 0}/${q.requirementValue} · ${q.reward}₽\n`; });
      await send(msg);
      return res.status(200).send('OK');
    }
    if (text === '/admin') {
      if (!isAdmin) { await send('⛔'); return res.status(200).send('OK'); }
      await send('⚙️ *Админ*', 'Markdown', { inline_keyboard: [
        [{ text: '👥 Пользователи', callback_data: 'admin_users' }],
        [{ text: '📋 Задания', callback_data: 'admin_tasks' }],
        [{ text: '📊 Статистика', callback_data: 'admin_stats_full' }],
        [{ text: '📢 Рассылка', callback_data: 'admin_broadcast' }],
        [{ text: '🔙 Меню', callback_data: 'menu' }],
      ]});
      return res.status(200).send('OK');
    }
    if (text === '/mod') {
      if (!isModerator) { await send('⛔'); return res.status(200).send('OK'); }
      await send('👮 *Модерация*', 'Markdown', { inline_keyboard: [
        [{ text: '🚨 Жалобы', callback_data: 'mod_reports' }],
        [{ text: '⏳ Модерация', callback_data: 'mod_pending' }],
        [{ text: '🔙 Меню', callback_data: 'menu' }],
      ]});
      return res.status(200).send('OK');
    }
    if (text === '/help') {
      await send('📖 *Помощь*\n\n/start, /profile, /tasks, /my\n/wallet, /daily, /referral, /leaderboard\n/quests, /stats\n/search, /msg, /inbox\n/link, /delete_data\n\n🛒 Магазин — кнопка в меню', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
      return res.status(200).send('OK');
    }
    if (text === '/delete_data') {
      if (!user) { await send('❌'); return res.status(200).send('OK'); }
      await query('UPDATE "User" SET "telegramChatId"=NULL, "telegramLinked"=false WHERE id=$1', [user.id]);
      await send('✅ *Отвязано*');
      return res.status(200).send('OK');
    }

    // Пошаговые состояния
    if (message.text && userState[chatId] && userState[chatId].step) {
      const state = userState[chatId];
      if (!user) { delete userState[chatId]; await send('❌'); return res.status(200).send('OK'); }

      if (state.step === 'broadcast_message') {
        try {
          const all = await query(`SELECT "telegramChatId" FROM "User" WHERE "telegramChatId" IS NOT NULL`);
          let sent = 0;
          for (const u of all.rows) { try { await sendMessage(u.telegramChatId, `📢 *Сообщение:*\n\n${text}`); sent++; } catch {} }
          delete userState[chatId];
          await send(`✅ *Отправлено ${sent}*`, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
        } catch (e) { console.error(e); delete userState[chatId]; }
        return res.status(200).send('OK');
      }
      if (state.step === 'report_reason') {
        try {
          await query(`INSERT INTO "Report" ("reporterId", "targetType", "targetId", reason, status, "createdAt") VALUES ($1,'task',$2,$3,'pending',NOW())`, [user.id, state.taskId, text]);
          delete userState[chatId];
          await send('✅ *Жалоба отправлена*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
          const mods = await query(`SELECT "telegramChatId" FROM "User" WHERE "isModerator"=true OR role='admin'`);
          for (const m of mods.rows) { if (m.telegramChatId) await sendMessage(m.telegramChatId, `🚨 *Жалоба на #${state.taskId}*\n${text}`); }
        } catch (e) { console.error(e); delete userState[chatId]; }
        return res.status(200).send('OK');
      }
      if (state.step === 'support_message') {
        try {
          await query(`INSERT INTO "SupportMessage" ("userId", message, "isFromAdmin", "createdAt") VALUES ($1,$2,false,NOW())`, [user.id, text]);
          delete userState[chatId];
          await send('✅ *Обращение отправлено*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
        } catch (e) { delete userState[chatId]; }
        return res.status(200).send('OK');
      }
      if (state.step === 'title') { state.title = text; state.step = 'description'; await send('📝 *Введи описание:*'); return res.status(200).send('OK'); }
      if (state.step === 'description') { state.description = text; state.step = 'reward'; await send('💰 *Введи награду (>=10):*'); return res.status(200).send('OK'); }
      if (state.step === 'reward') {
        const reward = parseInt(text, 10);
        if (isNaN(reward) || reward < 10) { await send('❌ *Число >=10*'); return res.status(200).send('OK'); }
        if (user.role !== 'viewer' && user.role !== 'admin') { await send('❌ *Только зрители*'); delete userState[chatId]; return res.status(200).send('OK'); }
        if (user.balance < reward) { await send(`❌ *Недостаточно*`); delete userState[chatId]; return res.status(200).send('OK'); }
        await send('🤖 *Проверяю контент...*');
        const mod = await aiModerateContent(state.title, state.description);
        if (!mod.ok) {
          await logModeration(user.id, null, 'task_text', `BLOCKED: ${mod.reason}`, 'REJECTED');
          delete userState[chatId];
          await send(`🚫 *Отклонено AI:*\n${mod.reason}`, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
          return res.status(200).send('OK');
        }
        const tr = await query(`INSERT INTO "Task" (title,description,reward,status,"creatorId","createdAt","updatedAt") VALUES ($1,$2,$3,'open',$4,NOW(),NOW()) RETURNING *`, [state.title, state.description, reward, user.id]);
        const t = tr.rows[0];
        await logModeration(user.id, t.id, 'task_text', `OK`, 'APPROVED');
        await query('UPDATE "User" SET balance = balance - $1 WHERE id=$2', [reward, user.id]);
        await query(`INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt") VALUES ($1,'task_create',$2,'completed',$3,NOW())`, [user.id, -reward, `Создание "${t.title}"`]);
        const xp = await addExperience(user.id, 10);
        await checkDailyQuests(user.id, 'task_created', 1);
        const acs = await checkAchievements(user.id);
        await postTaskToChannel(t.id, t.title, t.description, t.reward, user.displayName || user.name, sendMessage);
        delete userState[chatId];
        await send(`✅ *Создано!*\n📌 ${t.title}\n💰 ${t.reward} ₽\n_Проверено AI ✅_`, 'Markdown', { inline_keyboard: [[{ text: '📋', callback_data: 'tasks' }], [{ text: '🎨 Мои', callback_data: 'my_created' }]] });
        await notifyLevelUp(user.id, xp, sendMessage);
        await notifyAchievements(user.id, acs, sendMessage);
        return res.status(200).send('OK');
      }
    }

    // Видео
    if (message.video || message.document) {
      if (!user || user.role !== 'player') { await send('❌ *Только игроки*'); return res.status(200).send('OK'); }
      const tr = await query(`SELECT * FROM "Task" WHERE "playerId"=$1 AND status='taken' ORDER BY "updatedAt" DESC LIMIT 1`, [user.id]);
      if (tr.rows.length === 0) { await send('❌ *Нет активных*'); return res.status(200).send('OK'); }
      const t = tr.rows[0];
      const fid = message.video?.file_id || message.document?.file_id;
      if (!fid) { await send('❌'); return res.status(200).send('OK'); }
      await query(`UPDATE "Task" SET status='voting', "videoUrl"=$1 WHERE id=$2`, [fid, t.id]);
      await send(`✅ *Видео загружено:* ${t.title}`);
      const cr = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [t.creatorId]);
      if (cr.rows[0]?.telegramChatId) await sendMessage(cr.rows[0].telegramChatId, `🎬 *Видео:* ${t.title}`);
      return res.status(200).send('OK');
    }

    await send('🤔 *Неизвестная команда.* /start');
    return res.status(200).send('OK');
  } catch (error) {
    console.error('Ошибка:', error);
    return res.status(500).send('Internal error');
  }
};