const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function query(sql, params = []) {
  return pool.query(sql, params);
}

const userState = {};

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
          `SELECT id, name, "displayName", balance, reputation, role, "referralCode", "loginStreak", "lastDailyBonusAt", "telegramChatId"
           FROM "User" WHERE "telegramChatId" = $1`,
          [String(chatId)]
        );
        return r.rows[0] || null;
      } catch (e) { console.error('getUser:', e); return null; }
    };

    const getUserById = async (id) => {
      try {
        const r = await query(
          `SELECT id, name, "displayName", balance, reputation, role FROM "User" WHERE id = $1`,
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
      const isAdmin = user && user.role === 'admin';

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
          const r = await query(`SELECT id, name, email, role, balance, reputation FROM "User" ORDER BY "createdAt" DESC LIMIT 20`);
          let text = '👥 *Последние 20 пользователей:*\n\n';
          r.rows.forEach(u => { text += `🆔 ${u.id} | ${u.name} (${u.email})\n   Роль: ${u.role}, Баланс: ${u.balance}₽, Реп: ${u.reputation}\n\n`; });
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

      if (data === 'menu') {
        const keyboard = [
          [{ text: '📊 Профиль', callback_data: 'profile' }],
          [{ text: '📋 Задания', callback_data: 'tasks' }],
          [{ text: '💰 Кошелёк', callback_data: 'wallet' }],
          [{ text: '➕ Создать задание', callback_data: 'create' }],
          [{ text: '🏆 Рейтинг', callback_data: 'leaderboard' }],
          [{ text: '🎁 Бонус', callback_data: 'daily' }],
          [{ text: '🔗 Рефералы', callback_data: 'referral' }],
          [{ text: '👥 Игроки', callback_data: 'players_menu' }],
          [{ text: '💬 Сообщения', callback_data: 'inbox' }],
        ];
        if (isAdmin) keyboard.push([{ text: '⚙️ Админ', callback_data: 'admin_panel' }]);
        keyboard.push([{ text: '❓ Помощь', callback_data: 'help' }]);
        await edit('🤖 *Главное меню*', 'Markdown', { inline_keyboard: keyboard });
        return res.status(200).send('OK');
      }

      if (data === 'profile') {
        if (!user) { await edit('❌ *Не привязан.* /link your@email.com', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        await edit(`👤 *${user.displayName || user.name}*\n\n💰 Баланс: ${user.balance} ₽\n⭐ Репутация: ${user.reputation}\n🎮 Роль: ${user.role}`, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }

      if (data === 'tasks') {
        try {
          const r = await query(`SELECT id, title, reward, status, "playerId" FROM "Task" WHERE status IN ('open','voting') ORDER BY "createdAt" DESC LIMIT 10`);
          if (r.rows.length === 0) { await edit('📭 *Нет доступных заданий.*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
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
          let text = `📌 *${t.title}*\n\n📝 ${t.description || 'Без описания'}\n💰 Награда: ${t.reward} ₽\n👤 Создатель: ${t.creator}\n📌 Статус: ${t.status}\n`;
          if (t.player) text += `🎮 Игрок: ${t.player}\n`;
          if (t.videoUrl) text += `🎬 Видео загружено\n`;
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙 К списку', callback_data: 'tasks' }], [{ text: '🔙 В меню', callback_data: 'menu' }]] });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] }); }
        return res.status(200).send('OK');
      }

      if (data.startsWith('take_')) {
        const taskId = parseInt(data.split('_')[1]);
        if (!user) { await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] }); return res.status(200).send('OK'); }
        if (user.role !== 'player') { await edit('❌ *Только игроки*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] }); return res.status(200).send('OK'); }
        try {
          const r = await query(`UPDATE "Task" SET status='taken', "playerId"=$1 WHERE id=$2 AND status='open' AND "playerId" IS NULL RETURNING *`, [user.id, taskId]);
          if (r.rowCount === 0) { await edit('❌ *Уже взято*', 'Markdown', { inline_keyboard: [[{ text: '🔙 К списку', callback_data: 'tasks' }]] }); return res.status(200).send('OK'); }
          const t = r.rows[0];
          await edit(`✅ *Задание взято!*\n\n📌 ${t.title}\n💰 ${t.reward} ₽\n\nЗагрузи видео в этот чат.`, 'Markdown', { inline_keyboard: [[{ text: '📋 Мои задания', callback_data: 'my_tasks' }], [{ text: '🔙 В меню', callback_data: 'menu' }]] });
          const cr = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [t.creatorId]);
          if (cr.rows[0]?.telegramChatId) await sendMessage(cr.rows[0].telegramChatId, `🎯 *Задание взято!*\n📌 ${t.title}\n👤 ${user.displayName || user.name}`);
        } catch (e) { console.error(e); await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] }); }
        return res.status(200).send('OK');
      }

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
          const vr = await query('SELECT value, COUNT(*)::int AS cnt FROM "Vote" WHERE "taskId"=$1 GROUP BY value', [taskId]);
          const approve = vr.rows.find(x => x.value === 'approve')?.cnt || 0;
          const reject = vr.rows.find(x => x.value === 'reject')?.cnt || 0;
          await edit(`✅ *Голос принят!*\n\nЗа: ${approve}\nПротив: ${reject}`, 'Markdown', { inline_keyboard: [[{ text: '🔙 К списку', callback_data: 'tasks' }]] });
          if (approve >= 5) {
            const tr = await query(`UPDATE "Task" SET status='approved' WHERE id=$1 RETURNING *`, [taskId]);
            const t = tr.rows[0];
            await query('UPDATE "User" SET balance = balance + $1, "completedTasksCount" = "completedTasksCount" + 1 WHERE id=$2', [t.reward, t.playerId]);
            await query(`INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt") VALUES ($1,'reward',$2,'completed',$3,NOW())`, [t.playerId, t.reward, `Выполнение "${t.title}"`]);
            const pl = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [t.playerId]);
            if (pl.rows[0]?.telegramChatId) await sendMessage(pl.rows[0].telegramChatId, `🎉 *Задание выполнено!*\n📌 ${t.title}\n💰 +${t.reward} ₽`);
            const cr = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [t.creatorId]);
            if (cr.rows[0]?.telegramChatId) await sendMessage(cr.rows[0].telegramChatId, `✅ *Задание "${t.title}" выполнено!*`);
          }
        } catch (e) { console.error(e); await edit('❌ *Ошибка голосования*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] }); }
        return res.status(200).send('OK');
      }

      if (data === 'my_tasks') {
        if (!user) { await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        try {
          const r = await query(`SELECT t.id, t.title, t.reward, t.status, u.name AS creator FROM "Task" t JOIN "User" u ON t."creatorId" = u.id WHERE t."playerId"=$1 ORDER BY t."updatedAt" DESC`, [user.id]);
          if (r.rows.length === 0) { await edit('📭 *У тебя нет заданий.*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
          let text = '📋 *Твои задания:*\n\n';
          r.rows.forEach((t, i) => { text += `${i + 1}. *${t.title}*\n   💰 ${t.reward} ₽\n   Статус: ${t.status}\n   👤 ${t.creator}\n\n`; });
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

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

      if (data === 'leaderboard') {
        try {
          const r = await query('SELECT name, "displayName", reputation, balance FROM "User" ORDER BY reputation DESC LIMIT 10');
          let text = '🏆 *Топ по репутации:*\n\n';
          r.rows.forEach((u, i) => { text += `${i + 1}. ${u.displayName || u.name} — ⭐ ${u.reputation} (💰 ${u.balance}₽)\n`; });
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '💰 По балансу', callback_data: 'leaderboard_balance' }], [{ text: '🔙 Назад', callback_data: 'menu' }]] });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      if (data === 'leaderboard_balance') {
        try {
          const r = await query('SELECT name, "displayName", reputation, balance FROM "User" ORDER BY balance DESC LIMIT 10');
          let text = '💰 *Топ по балансу:*\n\n';
          r.rows.forEach((u, i) => { text += `${i + 1}. ${u.displayName || u.name} — 💰 ${u.balance}₽ (⭐ ${u.reputation})\n`; });
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '⭐ По репутации', callback_data: 'leaderboard' }], [{ text: '🔙 Назад', callback_data: 'menu' }]] });
        } catch { await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); }
        return res.status(200).send('OK');
      }

      if (data === 'daily') {
        if (!user) { await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        const now = new Date();
        const last = user.lastDailyBonusAt ? new Date(user.lastDailyBonusAt) : null;
        const hoursSince = last ? (now - last) / (1000 * 60 * 60) : 24;
        if (hoursSince < 24) { await edit(`⏳ *Бонус уже получен.*\nСледующий через ${Math.ceil(24 - hoursSince)} ч.`, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        const bonus = 10;
        await query('UPDATE "User" SET balance = balance + $1, "loginStreak" = "loginStreak" + 1, "lastDailyBonusAt" = NOW() WHERE id=$2', [bonus, user.id]);
        await query(`INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt") VALUES ($1,'daily_bonus',$2,'completed','Ежедневный бонус',NOW())`, [user.id, bonus]);
        await edit(`🎁 *Бонус получен!*\n+${bonus} ₽\nБаланс: ${user.balance + bonus} ₽`, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }

      if (data === 'referral') {
        if (!user) { await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        let code = user.referralCode;
        if (!code) { code = Math.random().toString(36).substring(2, 8).toUpperCase(); await query('UPDATE "User" SET "referralCode"=$1 WHERE id=$2', [code, user.id]); }
        const inv = await query('SELECT COUNT(*)::int AS cnt FROM "User" WHERE "referredBy"=$1', [user.id]);
        await edit(`🔗 *Рефералы*\n\nВаш код: *${code}*\nСсылка: https://nerv.vercel.app/signup?ref=${code}\n\n👥 Приглашено: ${inv.rows[0].cnt}\n💰 50 ₽ за каждого.`, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }

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

      if (data === 'create') {
        if (!user) { await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }); return res.status(200).send('OK'); }
        userState[chatId] = { step: 'title' };
        await edit('📝 *Создание задания*\n\nВведите *название*:', 'Markdown', { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }

      if (data === 'help') {
        await edit('📖 *Помощь*\n\n/start — Меню\n/link email — Привязать\n/profile — Профиль\n/tasks — Задания\n/wallet — Кошелёк\n/leaderboard — Рейтинг\n/daily — Бонус\n/referral — Рефералы\n/search имя — Поиск\n/msg id текст — Написать\n/inbox — Входящие\n/help — Помощь', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
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
    const isAdmin = user && user.role === 'admin';

    if (text === '/start' || text === '/menu') {
      const keyboard = [
        [{ text: '📊 Профиль', callback_data: 'profile' }],
        [{ text: '📋 Задания', callback_data: 'tasks' }],
        [{ text: '💰 Кошелёк', callback_data: 'wallet' }],
        [{ text: '➕ Создать задание', callback_data: 'create' }],
        [{ text: '🏆 Рейтинг', callback_data: 'leaderboard' }],
        [{ text: '🎁 Бонус', callback_data: 'daily' }],
        [{ text: '🔗 Рефералы', callback_data: 'referral' }],
        [{ text: '👥 Игроки', callback_data: 'players_menu' }],
        [{ text: '💬 Сообщения', callback_data: 'inbox' }],
      ];
      if (isAdmin) keyboard.push([{ text: '⚙️ Админ', callback_data: 'admin_panel' }]);
      keyboard.push([{ text: '❓ Помощь', callback_data: 'help' }]);
      await send('🤖 *Главное меню*', 'Markdown', { inline_keyboard: keyboard });
      return res.status(200).send('OK');
    }

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

    if (text === '/profile') {
      if (!user) { await send('❌ *Не привязан.* /link your@email.com'); return res.status(200).send('OK'); }
      await send(`👤 *${user.displayName || user.name}*\n\n💰 ${user.balance} ₽\n⭐ ${user.reputation}\n🎮 ${user.role}`);
      return res.status(200).send('OK');
    }

    if (text.startsWith('/profile ')) {
      const id = parseInt(text.replace('/profile ', '').trim());
      if (isNaN(id)) { await send('❌ *Неверный ID*'); return res.status(200).send('OK'); }
      const target = await getUserById(id);
      if (!target) { await send('❌ *Не найден*'); return res.status(200).send('OK'); }
      await send(`👤 *${target.displayName || target.name}*\n\n⭐ ${target.reputation}\n🎮 ${target.role}\n\n💬 /msg ${target.id} <текст>`);
      return res.status(200).send('OK');
    }

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

    if (text.startsWith('/search ')) {
      const q = text.replace('/search ', '').trim();
      if (q.length < 2) { await send('⚠️ *Минимум 2 символа*'); return res.status(200).send('OK'); }
      const r = await query(`SELECT id, name, "displayName", reputation FROM "User" WHERE name ILIKE $1 OR "displayName" ILIKE $1 LIMIT 10`, [`%${q}%`]);
      if (r.rows.length === 0) { await send('👥 *Никто не найден*'); return res.status(200).send('OK'); }
      let msg = '👥 *Найдено:*\n\n';
      r.rows.forEach(u => { msg += `• ${u.displayName || u.name} (⭐ ${u.reputation})\n  /profile ${u.id} — профиль\n  /msg ${u.id} — написать\n\n`; });
      await send(msg);
      return res.status(200).send('OK');
    }

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
      return res.status(200).send('OK');
    }

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

    if (text === '/daily') {
      if (!user) { await send('❌ *Сначала привяжи*'); return res.status(200).send('OK'); }
      const now = new Date();
      const last = user.lastDailyBonusAt ? new Date(user.lastDailyBonusAt) : null;
      const hoursSince = last ? (now - last) / (1000 * 60 * 60) : 24;
      if (hoursSince < 24) { await send(`⏳ *Бонус уже получен.* Следующий через ${Math.ceil(24 - hoursSince)} ч.`); return res.status(200).send('OK'); }
      const bonus = 10;
      await query('UPDATE "User" SET balance = balance + $1, "loginStreak"="loginStreak"+1, "lastDailyBonusAt"=NOW() WHERE id=$2', [bonus, user.id]);
      await query(`INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt") VALUES ($1,'daily_bonus',$2,'completed','Ежедневный бонус',NOW())`, [user.id, bonus]);
      await send(`🎁 *Бонус получен!* +${bonus} ₽\nБаланс: ${user.balance + bonus} ₽`);
      return res.status(200).send('OK');
    }

    if (text === '/referral') {
      if (!user) { await send('❌ *Сначала привяжи*'); return res.status(200).send('OK'); }
      let code = user.referralCode;
      if (!code) { code = Math.random().toString(36).substring(2, 8).toUpperCase(); await query('UPDATE "User" SET "referralCode"=$1 WHERE id=$2', [code, user.id]); }
      const inv = await query('SELECT COUNT(*)::int AS cnt FROM "User" WHERE "referredBy"=$1', [user.id]);
      await send(`🔗 *Рефералы*\n\nКод: *${code}*\nСсылка: https://nerv.vercel.app/signup?ref=${code}\n\n👥 Приглашено: ${inv.rows[0].cnt}`);
      return res.status(200).send('OK');
    }

    if (text === '/leaderboard') {
      const r = await query('SELECT name, "displayName", reputation, balance FROM "User" ORDER BY reputation DESC LIMIT 10');
      let msg = '🏆 *Топ:*\n\n';
      r.rows.forEach((u, i) => { msg += `${i + 1}. ${u.displayName || u.name} — ⭐ ${u.reputation} (💰 ${u.balance}₽)\n`; });
      await send(msg);
      return res.status(200).send('OK');
    }

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

    if (text === '/delete_data') {
      if (!user) { await send('❌ *Не привязан*'); return res.status(200).send('OK'); }
      await query('UPDATE "User" SET "telegramChatId"=NULL, "telegramLinked"=false WHERE id=$1', [user.id]);
      await send('✅ *Вы отвязаны от бота.*');
      return res.status(200).send('OK');
    }

    if (message.text && userState[chatId] && userState[chatId].step) {
      const state = userState[chatId];
      if (!user) { delete userState[chatId]; await send('❌ *Сначала привяжи*'); return res.status(200).send('OK'); }

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
        delete userState[chatId];
        await send(`✅ *Создано!*\n📌 ${t.title}\n💰 ${t.reward} ₽`, 'Markdown', { inline_keyboard: [[{ text: '📋 Задания', callback_data: 'tasks' }]] });
        return res.status(200).send('OK');
      }
    }

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