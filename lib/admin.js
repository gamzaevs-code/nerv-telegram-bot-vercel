const { query } = require('./db');

// ========== CALLBACK HANDLERS ==========

const handleAdminCallback = async (data, ctx) => {
  const { edit, user, chatId, isAdmin, userState, sendMessage } = ctx;

  if (data === 'admin_panel') {
    if (!isAdmin) {
      await edit('⛔ *Доступ запрещён.*', 'Markdown', { inline_keyboard: [] });
      return true;
    }
    await edit('⚙️ *Админ-панель*\n\nВыбери действие:', 'Markdown', {
      inline_keyboard: [
        [{ text: '👥 Все пользователи', callback_data: 'admin_users' }],
        [{ text: '📋 Все задания', callback_data: 'admin_tasks' }],
        [{ text: '📊 Расширенная статистика', callback_data: 'admin_stats_full' }],
        [{ text: '📢 Рассылка', callback_data: 'admin_broadcast' }],
        [{ text: 'ℹ️ О боте', callback_data: 'about' }],
        [{ text: '🔙 Назад', callback_data: 'menu' }],
      ],
    });
    return true;
  }

  if (data === 'admin_users') {
    if (!isAdmin) {
      await edit('⛔', 'Markdown', { inline_keyboard: [] });
      return true;
    }
    try {
      const r = await query(
        `SELECT id, name, role, balance, level, "isBanned"
         FROM "User" ORDER BY "createdAt" DESC LIMIT 20`
      );
      let text = '👥 *Последние 20 пользователей:*\n\n';
      const buttons = [];
      r.rows.forEach(u => {
        const ban = u.isBanned ? '🚫' : '';
        text += `🆔 ${u.id} ${ban} | ${u.name} · ${u.role} · ${u.balance} ₽\n`;
        buttons.push([{ text: `${ban} ${u.name.slice(0, 25)}`, callback_data: `admin_user_${u.id}` }]);
      });
      buttons.push([{ text: '🔙 Назад', callback_data: 'admin_panel' }]);
      await edit(text, 'Markdown', { inline_keyboard: buttons });
    } catch (e) {
      console.error(e);
      await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'admin_panel' }]] });
    }
    return true;
  }

  if (data.startsWith('admin_user_')) {
    const id = parseInt(data.split('_')[2]);
    if (!isAdmin) {
      await edit('⛔', 'Markdown', { inline_keyboard: [] });
      return true;
    }
    try {
      const r = await query(
        `SELECT id, name, email, role, balance, reputation, level, experience,
                "isBanned", "isModerator" FROM "User" WHERE id=$1`,
        [id]
      );
      if (r.rows.length === 0) {
        await edit('❌ *Не найден*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'admin_users' }]] });
        return true;
      }
      const u = r.rows[0];
      const text =
        `👤 *${u.name}*\n\n` +
        `🆔 ID: ${u.id}\n` +
        `📧 ${u.email}\n` +
        `🎮 Роль: ${u.role}\n` +
        `🎖 Ур: ${u.level} (${u.experience} XP)\n` +
        `💰 ${u.balance} ₽\n` +
        `⭐ ${u.reputation}\n` +
        `🚫 Бан: ${u.isBanned ? 'Да' : 'Нет'}\n` +
        `👮 Модератор: ${u.isModerator ? 'Да' : 'Нет'}`;
      const buttons = [
        [{ text: u.isBanned ? '✅ Разбанить' : '🚫 Забанить', callback_data: `admin_ban_${u.id}` }],
        [{ text: u.isModerator ? '❌ Снять модератора' : '👮 Сделать модератором', callback_data: `admin_mod_${u.id}` }],
        [{ text: '🔙 К списку', callback_data: 'admin_users' }],
      ];
      await edit(text, 'Markdown', { inline_keyboard: buttons });
    } catch (e) {
      console.error(e);
      await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'admin_users' }]] });
    }
    return true;
  }

  if (data.startsWith('admin_ban_')) {
    const id = parseInt(data.split('_')[2]);
    if (!isAdmin) {
      await edit('⛔', 'Markdown', { inline_keyboard: [] });
      return true;
    }
    try {
      const u = await query('SELECT "isBanned" FROM "User" WHERE id=$1', [id]);
      const newState = !u.rows[0].isBanned;
      await query('UPDATE "User" SET "isBanned"=$1 WHERE id=$2', [newState, id]);
      await edit(
        newState ? `🚫 *Пользователь #${id} забанен*` : `✅ *Пользователь #${id} разбанен*`,
        'Markdown',
        { inline_keyboard: [[{ text: '🔙 К пользователю', callback_data: `admin_user_${id}` }]] }
      );
    } catch (e) {
      console.error(e);
      await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'admin_users' }]] });
    }
    return true;
  }

  if (data.startsWith('admin_mod_')) {
    const id = parseInt(data.split('_')[2]);
    if (!isAdmin) {
      await edit('⛔', 'Markdown', { inline_keyboard: [] });
      return true;
    }
    try {
      const u = await query('SELECT "isModerator" FROM "User" WHERE id=$1', [id]);
      const newState = !u.rows[0].isModerator;
      await query('UPDATE "User" SET "isModerator"=$1 WHERE id=$2', [newState, id]);
      await edit(
        newState ? `👮 *Пользователь #${id} — модератор*` : `❌ *Снята роль модератора с #${id}*`,
        'Markdown',
        { inline_keyboard: [[{ text: '🔙 К пользователю', callback_data: `admin_user_${id}` }]] }
      );
    } catch (e) {
      console.error(e);
      await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'admin_users' }]] });
    }
    return true;
  }

  if (data === 'admin_stats_full') {
    if (!isAdmin) {
      await edit('⛔', 'Markdown', { inline_keyboard: [] });
      return true;
    }
    try {
      const u = await query('SELECT COUNT(*)::int AS c FROM "User"');
      const t = await query('SELECT COUNT(*)::int AS c FROM "Task"');
      const tA = await query(`SELECT COUNT(*)::int AS c FROM "Task" WHERE status='approved'`);
      const v = await query('SELECT COUNT(*)::int AS c FROM "Vote"');
      const tr = await query('SELECT COUNT(*)::int AS c FROM "Transaction"');
      const b = await query('SELECT COALESCE(SUM(balance),0)::bigint AS s FROM "User"');
      const topUsers = await query(
        `SELECT name, "displayName", balance FROM "User" ORDER BY balance DESC LIMIT 5`
      );
      const topTasks = await query(
        `SELECT title, reward, status FROM "Task" ORDER BY reward DESC LIMIT 5`
      );

      let text = `📊 *Расширенная статистика:*\n\n`;
      text += `👥 Пользователей: *${u.rows[0].c}*\n`;
      text += `📋 Заданий всего: *${t.rows[0].c}*\n`;
      text += `✅ Выполнено: *${tA.rows[0].c}*\n`;
      text += `🗳️ Голосов: *${v.rows[0].c}*\n`;
      text += `💳 Транзакций: *${tr.rows[0].c}*\n`;
      text += `💰 Общий баланс: *${b.rows[0].s} ₽*\n\n`;
      text += `🏆 *Топ-5 по балансу:*\n`;
      topUsers.rows.forEach((x, i) => {
        text += `${i + 1}. ${x.displayName || x.name} — ${x.balance} ₽\n`;
      });
      text += `\n💎 *Топ-5 заданий:*\n`;
      topTasks.rows.forEach((x, i) => {
        text += `${i + 1}. ${x.title.slice(0, 30)} — ${x.reward} ₽ (${x.status})\n`;
      });

      await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_panel' }]] });
    } catch (e) {
      console.error(e);
      await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'admin_panel' }]] });
    }
    return true;
  }

  if (data === 'admin_broadcast') {
    if (!isAdmin) {
      await edit('⛔', 'Markdown', { inline_keyboard: [] });
      return true;
    }
    userState[chatId] = { step: 'broadcast_message' };
    await edit(
      '📢 *Рассылка*\n\nВведи текст для рассылки всем пользователям.\n\n📌 Отмена — /menu',
      'Markdown',
      { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'menu' }]] }
    );
    return true;
  }

  if (data === 'admin_tasks') {
    if (!isAdmin) {
      await edit('⛔', 'Markdown', { inline_keyboard: [] });
      return true;
    }
    try {
      const r = await query(
        `SELECT t.id, t.title, t.reward, t.status, u.name AS creator
         FROM "Task" t JOIN "User" u ON t."creatorId" = u.id
         ORDER BY t."createdAt" DESC LIMIT 20`
      );
      let text = '📋 *Последние 20 заданий:*\n\n';
      r.rows.forEach(t => {
        text += `#${t.id} · *${t.title}* · ${t.reward} ₽ · ${t.status} · ${t.creator}\n`;
      });
      await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_panel' }]] });
    } catch (e) {
      console.error(e);
      await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'admin_panel' }]] });
    }
    return true;
  }

  return false;
};

module.exports = { handleAdminCallback };