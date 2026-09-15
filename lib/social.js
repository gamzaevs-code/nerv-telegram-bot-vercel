const { query } = require('./db');
const { checkAchievements, notifyAchievements } = require('./helpers');

// ========== ВСПОМОГАТЕЛЬНЫЕ ==========

const getUserById = async (id) => {
  try {
    const r = await query(
      `SELECT id, name, "displayName", balance, reputation, role, level, experience
       FROM "User" WHERE id = $1`,
      [id]
    );
    return r.rows[0] || null;
  } catch {
    return null;
  }
};

// ========== CALLBACK HANDLERS ==========

const handleSocialCallback = async (data, ctx) => {
  const { edit, user, chatId, userState } = ctx;

  if (data === 'players_menu') {
    await edit(
      '👥 *Поиск игроков*\n\nНапиши `/search Имя` для поиска.',
      'Markdown',
      { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }
    );
    return true;
  }

  if (data.startsWith('msg_')) {
    const id = parseInt(data.split('_')[1]);
    const target = await getUserById(id);
    if (!target) {
      await edit('❌ *Не найден*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
      return true;
    }
    await edit(
      `💬 *Чат с ${target.displayName || target.name}*\n\nИспользуй: /msg ${target.id} <текст>`,
      'Markdown',
      { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'players_menu' }]] }
    );
    return true;
  }

  if (data === 'inbox') {
    if (!user) {
      await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
      return true;
    }
    const r = await query(
      `SELECT m.text, m."fromUserId", u.name, u."displayName"
       FROM "Message" m JOIN "User" u ON m."fromUserId"=u.id
       WHERE m."toUserId"=$1 AND m."isRead"=false
       ORDER BY m."createdAt" DESC`,
      [user.id]
    );
    if (r.rows.length === 0) {
      await edit('📭 *Новых сообщений нет.*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
      return true;
    }
    let text = '💬 *Новые сообщения:*\n\n';
    r.rows.forEach(m => {
      text += `👤 ${m.displayName || m.name}: ${m.text}\n/msg ${m.fromUserId} ...\n\n`;
    });
    await query('UPDATE "Message" SET "isRead"=true WHERE "toUserId"=$1 AND "isRead"=false', [user.id]);
    await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
    return true;
  }

  if (data === 'support') {
    if (!user) {
      await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
      return true;
    }
    userState[chatId] = { step: 'support_message' };
    await edit(
      '💡 *Поддержка*\n\nОпиши свою проблему или вопрос в следующем сообщении.\n\n📌 Для отмены — /menu',
      'Markdown',
      { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'menu' }]] }
    );
    return true;
  }

  if (data === 'about') {
    const text =
      `ℹ️ *О боте NERV*\n\n` +
      `🎯 NERV — платформа для выполнения заданий.\n\n` +
      `👤 *Роли:*\n` +
      `• Зритель — создаёт задания\n` +
      `• Игрок — выполняет задания\n\n` +
      `🎮 *Как это работает:*\n` +
      `1. Зритель создаёт задание\n` +
      `2. Игрок берёт и выполняет\n` +
      `3. Зрители голосуют (5+ = награда)\n\n` +
      `💰 *Экономика:*\n` +
      `• Ежедневные бонусы и streak\n` +
      `• Ежедневные квесты\n` +
      `• 10 достижений\n` +
      `• 3 уровня рефералов\n` +
      `• Магазин косметики\n\n` +
      `🛡 *Модерация:*\n` +
      `• AI-проверка через GigaChat\n` +
      `• Жалобы на задания\n\n` +
      `👨‍💻 Разработка: @gamzaev_s`;
    await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
    return true;
  }

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
      '/quests — Квесты\n' +
      '/stats — Статистика\n\n' +
      '*👥 Соцфункции:*\n' +
      '/search имя — Поиск\n' +
      '/msg id текст — Написать\n' +
      '/inbox — Входящие\n\n' +
      '*⚙️ Прочее:*\n' +
      '/link email — Привязать\n' +
      '/delete_data — Отвязать\n\n' +
      '🛒 Магазин — кнопка в главном меню',
      'Markdown',
      { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }
    );
    return true;
  }

  return false;
};

// ========== ОБРАБОТКА ПОШАГОВЫХ СОСТОЯНИЙ ==========

const handleSocialStep = async (state, text, ctx) => {
  const { send, user, chatId, userState, sendMessage } = ctx;

  if (state.step === 'support_message') {
    try {
      await query(
        `INSERT INTO "SupportMessage" ("userId", message, "isFromAdmin", "createdAt")
         VALUES ($1, $2, false, NOW())`,
        [user.id, text]
      );
      delete userState[chatId];
      await send('✅ *Обращение отправлено!*\n\nМы ответим в ближайшее время.', 'Markdown', {
        inline_keyboard: [[{ text: '🔙 В меню', callback_data: 'menu' }]],
      });
    } catch (e) {
      console.error('support:', e);
      await send('❌ *Не удалось отправить.* Попробуй позже.');
      delete userState[chatId];
    }
    return true;
  }

  if (state.step === 'report_reason') {
    try {
      const taskId = state.taskId;
      await query(
        `INSERT INTO "Report" ("reporterId", "targetType", "targetId", reason, status, "createdAt")
         VALUES ($1, 'task', $2, $3, 'pending', NOW())`,
        [user.id, taskId, text]
      );
      delete userState[chatId];
      await send('✅ *Жалоба отправлена!*\n\nМодераторы рассмотрят её в ближайшее время.', 'Markdown', {
        inline_keyboard: [[{ text: '🔙 В меню', callback_data: 'menu' }]],
      });
      const mods = await query(
        `SELECT "telegramChatId" FROM "User" WHERE "isModerator"=true OR role='admin'`
      );
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
    return true;
  }

  if (state.step === 'broadcast_message') {
    try {
      const all = await query(
        `SELECT "telegramChatId" FROM "User" WHERE "telegramChatId" IS NOT NULL`
      );
      let sent = 0;
      let failed = 0;
      for (const u of all.rows) {
        try {
          await sendMessage(u.telegramChatId, `📢 *Сообщение от администрации:*\n\n${text}`);
          sent++;
        } catch {
          failed++;
        }
      }
      delete userState[chatId];
      await send(
        `✅ *Рассылка завершена!*\n\n📤 Отправлено: ${sent}\n❌ Ошибок: ${failed}`,
        'Markdown',
        { inline_keyboard: [[{ text: '🔙 В меню', callback_data: 'menu' }]] }
      );
    } catch (e) {
      console.error('broadcast:', e);
      delete userState[chatId];
      await send('❌ *Ошибка рассылки*');
    }
    return true;
  }

  return false;
};

// ========== ТЕКСТОВЫЕ КОМАНДЫ СОЦФУНКЦИЙ ==========

const handleSocialText = async (text, ctx) => {
  const { send, user, chatId, sendMessage } = ctx;

  if (text.startsWith('/search ')) {
    const q = text.replace('/search ', '').trim();
    if (q.length < 2) {
      await send('⚠️ *Минимум 2 символа*');
      return true;
    }
    const r = await query(
      `SELECT id, name, "displayName", reputation, level FROM "User"
       WHERE name ILIKE $1 OR "displayName" ILIKE $1 LIMIT 10`,
      [`%${q}%`]
    );
    if (r.rows.length === 0) {
      await send('👥 *Никто не найден*');
      return true;
    }
    let msg = '👥 *Найдено:*\n\n';
    r.rows.forEach(u => {
      msg += `• ${u.displayName || u.name} (ур.${u.level || 1}, ⭐ ${u.reputation})\n`;
      msg += `  /profile ${u.id}\n`;
      msg += `  /msg ${u.id}\n\n`;
    });
    await send(msg);
    return true;
  }

  if (text.startsWith('/msg ')) {
    if (!user) { await send('❌ *Сначала привяжи*'); return true; }
    const parts = text.split(' ');
    if (parts.length < 3) { await send('⚠️ *Формат:* `/msg id текст`'); return true; }
    const id = parseInt(parts[1]);
    if (isNaN(id)) { await send('❌ *Неверный ID*'); return true; }
    const msgText = parts.slice(2).join(' ');
    const target = await getUserById(id);
    if (!target) { await send('❌ *Получатель не найден*'); return true; }
    if (target.id === user.id) { await send('❌ *Нельзя себе*'); return true; }

    await query(
      `INSERT INTO "Message" ("fromUserId","toUserId",text,"createdAt")
       VALUES ($1,$2,$3,NOW())`,
      [user.id, target.id, msgText]
    );
    await send(`✅ *Отправлено ${target.displayName || target.name}*`);

    const tr = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [target.id]);
    if (tr.rows[0]?.telegramChatId) {
      await sendMessage(
        tr.rows[0].telegramChatId,
        `💬 *От ${user.displayName || user.name}:*\n\n${msgText}\n\n/msg ${user.id} <ответ>`
      );
    }
    const achs = await checkAchievements(user.id);
    await notifyAchievements(user.id, achs, sendMessage);
    return true;
  }

  if (text === '/inbox') {
    if (!user) { await send('❌ *Сначала привяжи*'); return true; }
    const r = await query(
      `SELECT m.text, m."fromUserId", u.name, u."displayName"
       FROM "Message" m JOIN "User" u ON m."fromUserId"=u.id
       WHERE m."toUserId"=$1 AND m."isRead"=false
       ORDER BY m."createdAt" DESC`,
      [user.id]
    );
    if (r.rows.length === 0) { await send('📭 *Нет сообщений.*'); return true; }
    let msg = '💬 *Новые сообщения:*\n\n';
    r.rows.forEach(m => {
      msg += `👤 ${m.displayName || m.name}: ${m.text}\n`;
      msg += `/msg ${m.fromUserId} ...\n\n`;
    });
    await query('UPDATE "Message" SET "isRead"=true WHERE "toUserId"=$1 AND "isRead"=false', [user.id]);
    await send(msg);
    return true;
  }

  return false;
};

module.exports = { handleSocialCallback, handleSocialStep, handleSocialText, getUserById };