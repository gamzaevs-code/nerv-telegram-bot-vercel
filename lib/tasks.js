const { query } = require('./db');
const {
  addExperience,
  getStreakMultiplier,
  checkDailyQuests,
  notifyLevelUp,
  notifyAchievements,
  checkAchievements,
  processReferralEarnings,
  notifyReferralEarnings,
  postTaskToChannel,
  calcCommission,
  recordPlatformEarning,
} = require('./helpers');
const { aiModerateContent, logModeration } = require('./ai');
const { applyBoost } = require('./shop');

// ========== CALLBACK HANDLERS ==========

const handleTasksCallback = async (data, ctx) => {
  const { edit, user, chatId, isModerator, userState, sendMessage } = ctx;

  if (data === 'tasks') {
    try {
      const r = await query(
        `SELECT id, title, reward, status, "playerId" FROM "Task"
         WHERE status IN ('open','voting') ORDER BY "createdAt" DESC LIMIT 10`
      );
      if (r.rows.length === 0) {
        await edit('📭 *Нет доступных заданий.*', 'Markdown', {
          inline_keyboard: [
            [{ text: '➕ Создать', callback_data: 'create' }],
            [{ text: '🔙 Назад', callback_data: 'menu' }],
          ],
        });
        return true;
      }
      const isPlayer = user && user.role === 'player';
      const buttons = [];
      r.rows.forEach(t => {
        const row = [{ text: `📌 ${t.title} (${t.reward}₽)`, callback_data: `task_${t.id}` }];
        if (t.status === 'open' && isPlayer && !t.playerId) {
          row.push({ text: '🎯 Взять', callback_data: `take_${t.id}` });
        }
        if (t.status === 'voting') {
          row.push({ text: '✅ За', callback_data: `vote_${t.id}_approve` });
          row.push({ text: '❌ Против', callback_data: `vote_${t.id}_reject` });
        }
        buttons.push(row);
      });
      buttons.push([{ text: '🔙 Назад', callback_data: 'menu' }]);
      await edit('📋 *Доступные задания:*', 'Markdown', { inline_keyboard: buttons });
    } catch (e) {
      console.error(e);
      await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
    }
    return true;
  }

  if (data.startsWith('task_')) {
    const taskId = parseInt(data.split('_')[1]);
    try {
      const r = await query(
        `SELECT t.*, u.name AS creator, p.name AS player
         FROM "Task" t
         JOIN "User" u ON t."creatorId" = u.id
         LEFT JOIN "User" p ON t."playerId" = p.id
         WHERE t.id = $1`,
        [taskId]
      );
      if (r.rows.length === 0) {
        await edit('❌ *Не найдено*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'tasks' }]] });
        return true;
      }
      const t = r.rows[0];
      const vr = await query(
        `SELECT value, COUNT(*)::int AS cnt FROM "Vote" WHERE "taskId"=$1 GROUP BY value`,
        [taskId]
      );
      const approve = vr.rows.find(x => x.value === 'approve')?.cnt || 0;
      const reject = vr.rows.find(x => x.value === 'reject')?.cnt || 0;

      const taskComm = calcCommission(t.reward);
      let text = `📌 *${t.title}*\n\n`;
      text += `📝 ${t.description || '—'}\n`;
      text += `💰 Награда: ${t.reward} ₽\n`;
      text += `💵 Игрок получит: *${taskComm.netAmount} ₽*\n`;
      text += `_Комиссия платформы (11%): ${taskComm.commission} ₽_\n`;
      text += `👤 Создатель: ${t.creator}\n`;
      text += `📌 Статус: ${t.status}\n`;
      text += `👍 ${approve} / 👎 ${reject}\n`;
      if (t.player) text += `🎮 Игрок: ${t.player}\n`;
      if (t.videoUrl) text += `🎬 Видео загружено\n`;

      const buttons = [];
      const isPlayer = user && user.role === 'player';
      if (t.status === 'open' && isPlayer && !t.playerId) {
        buttons.push([{ text: '🎯 Взять задание', callback_data: `take_${t.id}` }]);
      }
      if (user) buttons.push([{ text: '🚨 Пожаловаться', callback_data: `report_task_${t.id}` }]);
      if (isModerator) buttons.push([{ text: '👮 Модерация', callback_data: `mod_task_${t.id}` }]);

      // Кнопка «Поделиться»
      buttons.push([{
        text: '📤 Поделиться',
        url: `https://t.me/share/url?url=${encodeURIComponent(`https://t.me/nerv_05bot?start=task_${t.id}`)}&text=${encodeURIComponent(`Посмотри задание: ${t.title}`)}`,
      }]);

      buttons.push([{ text: '🔙 К списку', callback_data: 'tasks' }]);
      buttons.push([{ text: '🔙 В меню', callback_data: 'menu' }]);

      await edit(text, 'Markdown', { inline_keyboard: buttons });
    } catch (e) {
      console.error(e);
      await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'tasks' }]] });
    }
    return true;
  }

  if (data.startsWith('take_')) {
    const taskId = parseInt(data.split('_')[1]);
    if (!user) {
      await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'tasks' }]] });
      return true;
    }
    if (!user.roleChosen) {
      await edit('⚠️ *Сначала выбери роль*', 'Markdown', {
        inline_keyboard: [[{ text: '🎭 Выбрать роль', callback_data: 'change_role' }]],
      });
      return true;
    }
    if (user.role !== 'player') {
      await edit('❌ *Только игроки могут брать задания*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'tasks' }]] });
      return true;
    }
    try {
      const r = await query(
        `UPDATE "Task" SET status='taken', "playerId"=$1
         WHERE id=$2 AND status='open' AND "playerId" IS NULL
         RETURNING *`,
        [user.id, taskId]
      );
      if (r.rowCount === 0) {
        await edit('❌ *Уже взято*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'tasks' }]] });
        return true;
      }
      const t = r.rows[0];
      const xpRes = await addExperience(user.id, 5);
      const questRewards = await checkDailyQuests(user.id, 'task_taken', 1);
      const achs = await checkAchievements(user.id);

      let msg = `✅ *Задание взято!*\n\n📌 ${t.title}\n💰 ${t.reward} ₽\n\n_+5 XP_\n\nОтправь видео в этот чат, чтобы сдать.`;
      if (questRewards.length > 0) {
        msg += '\n\n📅 *Квесты:*\n';
        questRewards.forEach(q => { msg += `✅ ${q.description} — +${q.reward} ₽\n`; });
      }
      await edit(msg, 'Markdown', {
        inline_keyboard: [
          [{ text: '📝 Мои задания', callback_data: 'my_tasks' }],
          [{ text: '🔙 В меню', callback_data: 'menu' }],
        ],
      });

      await notifyLevelUp(user.id, xpRes, sendMessage);
      await notifyAchievements(user.id, achs, sendMessage);

      const cr = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [t.creatorId]);
      if (cr.rows[0]?.telegramChatId) {
        await sendMessage(cr.rows[0].telegramChatId, `🎯 *Задание взято!*\n📌 ${t.title}`);
      }
    } catch (e) {
      console.error(e);
      await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'tasks' }]] });
    }
    return true;
  }

  if (data.startsWith('abandon_')) {
    const taskId = parseInt(data.split('_')[1]);
    if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return true; }
    try {
      const r = await query(
        `UPDATE "Task" SET status='open', "playerId"=NULL
         WHERE id=$1 AND "playerId"=$2 AND status='taken'
         RETURNING *`,
        [taskId, user.id]
      );
      if (r.rowCount === 0) {
        await edit('❌ *Не удалось отказаться*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'my_tasks' }]] });
        return true;
      }
      const t = r.rows[0];
      await edit(`↩️ *Отказался от задания:*\n📌 ${t.title}`, 'Markdown', {
        inline_keyboard: [
          [{ text: '📝 Мои задания', callback_data: 'my_tasks' }],
          [{ text: '🔙 В меню', callback_data: 'menu' }],
        ],
      });
      const cr = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [t.creatorId]);
      if (cr.rows[0]?.telegramChatId) {
        await sendMessage(cr.rows[0].telegramChatId, `↩️ Игрок отказался от задания «${t.title}».`);
      }
    } catch (e) {
      console.error(e);
      await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'my_tasks' }]] });
    }
    return true;
  }

  if (data.startsWith('vote_')) {
    const parts = data.split('_');
    const taskId = parseInt(parts[1]);
    const value = parts[2];
    if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return true; }
    try {
      const ex = await query(
        'SELECT id FROM "Vote" WHERE "taskId"=$1 AND "voterId"=$2',
        [taskId, user.id]
      );
      if (ex.rows.length > 0) {
        await edit('❌ *Ты уже голосовал*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'tasks' }]] });
        return true;
      }
      await query(
        'INSERT INTO "Vote" ("taskId","voterId",value,"createdAt") VALUES ($1,$2,$3,NOW())',
        [taskId, user.id, value]
      );
      await query('UPDATE "User" SET reputation = reputation + 1 WHERE id = $1', [user.id]);

      const xpRes = await addExperience(user.id, 3);
      const questRewards = await checkDailyQuests(user.id, 'vote', 1);
      const achs = await checkAchievements(user.id);

      const vr = await query(
        'SELECT value, COUNT(*)::int AS cnt FROM "Vote" WHERE "taskId"=$1 GROUP BY value',
        [taskId]
      );
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
        const tr = await query(
          `UPDATE "Task" SET status='approved' WHERE id=$1 RETURNING *`,
          [taskId]
        );
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
        const qr = await checkDailyQuests(t.playerId, 'task_completed', 1);
        const achsPlayer = await checkAchievements(t.playerId);

        const pl = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [t.playerId]);
        if (pl.rows[0]?.telegramChatId) {
          let m = `🎉 *Задание выполнено!*\n📌 ${t.title}\n💰 +${netAmount} ₽`;
          if (commission > 0) m += `\n_Комиссия платформы: -${commission} ₽_`;
          if (mult > 1) m += `\n🔥 _Streak ×${mult}_`;
          if (boost) m += `\n⚡ _${boost.name}_`;
          m += '\n_+50 XP_';
          if (qr.length > 0) {
            m += '\n\n📅 *Квесты:*\n';
            qr.forEach(q => { m += `✅ ${q.description} — +${q.reward} ₽\n`; });
          }
          await sendMessage(pl.rows[0].telegramChatId, m);
        }
        await notifyLevelUp(t.playerId, xpPlayer, sendMessage);
        await notifyAchievements(t.playerId, achsPlayer, sendMessage);

        const refEarnings = await processReferralEarnings(t.playerId, netAmount);
        await notifyReferralEarnings(refEarnings, sendMessage);

        const cr = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [t.creatorId]);
        if (cr.rows[0]?.telegramChatId) {
          await sendMessage(cr.rows[0].telegramChatId, `✅ *Задание "${t.title}" выполнено!*`);
        }
      }
    } catch (e) {
      console.error(e);
      await edit('❌ *Ошибка голосования*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'tasks' }]] });
    }
    return true;
  }

  if (data === 'my_tasks') {
    if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return true; }
    try {
      const r = await query(
        `SELECT t.id, t.title, t.reward, t.status
         FROM "Task" t
         WHERE t."playerId"=$1
         ORDER BY t."updatedAt" DESC LIMIT 15`,
        [user.id]
      );
      if (r.rows.length === 0) {
        await edit('📭 *У тебя нет заданий.*', 'Markdown', {
          inline_keyboard: [
            [{ text: '📋 Доступные', callback_data: 'tasks' }],
            [{ text: '🔙 Назад', callback_data: 'menu' }],
          ],
        });
        return true;
      }
      let text = '📝 *Твои задания:*\n\n';
      const buttons = [];
      r.rows.forEach((t, i) => {
        const e = t.status === 'taken' ? '🟡' : t.status === 'voting' ? '🗳️' : t.status === 'approved' ? '✅' : '⚪';
        text += `${i + 1}. ${e} *${t.title}*\n   💰 ${t.reward} ₽ · ${t.status}\n\n`;
        const row = [{ text: `📌 ${t.title.slice(0, 25)}`, callback_data: `task_${t.id}` }];
        if (t.status === 'taken') row.push({ text: '↩️ Отказаться', callback_data: `abandon_${t.id}` });
        buttons.push(row);
      });
      buttons.push([{ text: '📋 Доступные', callback_data: 'tasks' }]);
      buttons.push([{ text: '🔙 Назад', callback_data: 'menu' }]);
      await edit(text, 'Markdown', { inline_keyboard: buttons });
    } catch (e) {
      console.error(e);
      await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
    }
    return true;
  }

  if (data === 'my_created') {
    if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return true; }
    try {
      const r = await query(
        `SELECT t.id, t.title, t.reward, t.status,
                (SELECT COUNT(*)::int FROM "Vote" WHERE "taskId"=t.id AND value='approve') AS approve,
                (SELECT COUNT(*)::int FROM "Vote" WHERE "taskId"=t.id AND value='reject') AS reject
         FROM "Task" t WHERE t."creatorId"=$1
         ORDER BY t."createdAt" DESC LIMIT 15`,
        [user.id]
      );
      if (r.rows.length === 0) {
        await edit('📭 *Ты ещё не создавал заданий.*', 'Markdown', {
          inline_keyboard: [
            [{ text: '➕ Создать', callback_data: 'create' }],
            [{ text: '🔙 Назад', callback_data: 'menu' }],
          ],
        });
        return true;
      }
      let text = '🎨 *Твои созданные:*\n\n';
      r.rows.forEach((t, i) => {
        const e = t.status === 'open' ? '🟢' : t.status === 'taken' ? '🟡' : t.status === 'voting' ? '🗳️' : t.status === 'approved' ? '✅' : '⚪';
        text += `${i + 1}. ${e} *${t.title}*\n   💰 ${t.reward} ₽ · ${t.status}\n   👍 ${t.approve} / 👎 ${t.reject}\n\n`;
      });
      await edit(text, 'Markdown', {
        inline_keyboard: [
          [{ text: '➕ Создать ещё', callback_data: 'create' }],
          [{ text: '🔙 Назад', callback_data: 'menu' }],
        ],
      });
    } catch (e) {
      console.error(e);
      await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
    }
    return true;
  }

  if (data === 'create') {
    if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return true; }
    if (!user.roleChosen) {
      await edit('⚠️ *Сначала выбери роль*', 'Markdown', {
        inline_keyboard: [[{ text: '🎭 Выбрать роль', callback_data: 'change_role' }]],
      });
      return true;
    }
    userState[chatId] = { step: 'title' };
    await edit('📝 *Создание задания*\n\nВведите *название*:', 'Markdown', {
      inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'menu' }]],
    });
    return true;
  }

  return false;
};

// ========== ПОШАГОВОЕ СОЗДАНИЕ ЗАДАНИЯ ==========

const handleCreateTaskStep = async (state, text, ctx) => {
  const { send, user, chatId, userState, sendMessage } = ctx;

  if (state.step === 'title') {
    state.title = text;
    state.step = 'description';
    await send('📝 *Введите описание:*');
    return true;
  }

  if (state.step === 'description') {
    state.description = text;
    state.step = 'reward';
    await send('💰 *Введите награду (число, >=10):*');
    return true;
  }

  if (state.step === 'reward') {
    const reward = parseInt(text, 10);
    if (isNaN(reward) || reward < 10) {
      await send('❌ *Число больше 9*');
      return true;
    }
    if (user.role !== 'viewer' && user.role !== 'admin') {
      await send('❌ *Только зрители и админы*');
      delete userState[chatId];
      return true;
    }
    if (user.balance < reward) {
      await send(`❌ *Недостаточно.* Баланс: ${user.balance} ₽`);
      delete userState[chatId];
      return true;
    }

    await send('🤖 *Проверяю контент...*\n\n_Обычно это занимает 2-5 секунд._');
    const mod = await aiModerateContent(state.title, state.description);

    if (!mod.ok) {
      await logModeration(user.id, null, 'task_text', `BLOCKED: ${mod.reason}`, 'REJECTED');
      delete userState[chatId];
      await send(
        `🚫 *Задание отклонено модерацией*\n\n📝 ${mod.reason}\n\n_Попробуй переформулировать._`,
        'Markdown',
        { inline_keyboard: [[{ text: '🔙 В меню', callback_data: 'menu' }]] }
      );
      return true;
    }

    const tr = await query(
      `INSERT INTO "Task" (title,description,reward,status,"creatorId","createdAt","updatedAt")
       VALUES ($1,$2,$3,'open',$4,NOW(),NOW()) RETURNING *`,
      [state.title, state.description, reward, user.id]
    );
    const t = tr.rows[0];
    await logModeration(user.id, t.id, 'task_text', `OK: ${mod.reason || 'approved'}`, 'APPROVED');

    await query('UPDATE "User" SET balance = balance - $1 WHERE id=$2', [reward, user.id]);
    await query(
      `INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt")
       VALUES ($1,'task_create',$2,'completed',$3,NOW())`,
      [user.id, -reward, `Создание "${t.title}"`]
    );

    const xpRes = await addExperience(user.id, 10);
    const questRewards = await checkDailyQuests(user.id, 'task_created', 1);
    const achs = await checkAchievements(user.id);

    await postTaskToChannel(t.id, t.title, t.description, t.reward, user.displayName || user.name, sendMessage);

    delete userState[chatId];
    let msg = `✅ *Создано!*\n📌 ${t.title}\n💰 ${t.reward} ₽\n\n_+10 XP_\n_Проверено AI ✅_`;
    if (questRewards.length > 0) {
      msg += '\n\n📅 *Квесты:*\n';
      questRewards.forEach(q => { msg += `✅ ${q.description} — +${q.reward} ₽\n`; });
    }
    await send(msg, 'Markdown', {
      inline_keyboard: [
        [{ text: '📋 Задания', callback_data: 'tasks' }],
        [{ text: '🎨 Мои созданные', callback_data: 'my_created' }],
      ],
    });
    await notifyLevelUp(user.id, xpRes, sendMessage);
    await notifyAchievements(user.id, achs, sendMessage);
    return true;
  }

  return false;
};

module.exports = { handleTasksCallback, handleCreateTaskStep };