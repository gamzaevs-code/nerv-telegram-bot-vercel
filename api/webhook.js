const { query } = require('../lib/db');
const { sendMessage, editMessageText } = require('../lib/telegram');
const { handleShopCallback } = require('../lib/shop');
const { handleRoleCallback } = require('../lib/role');
const { handleAdminCallback } = require('../lib/admin');
const { handleModerationCallback } = require('../lib/moderation');
const { handleTasksCallback, handleCreateTaskStep } = require('../lib/tasks');
const { handleProfileCallback } = require('../lib/profile');
const { handleSocialCallback, handleSocialStep } = require('../lib/social');
const { handleTextCommand } = require('../lib/texts');
const { handleStartParam } = require('../lib/deeplinks');
const { notifyUser } = require('../lib/notify');

const userState = {};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('OK');

  try {
    const { message, callback_query } = req.body;
    if (!process.env.BOT_TOKEN) return res.status(500).send('No token');

    const getUser = async (chatId) => {
      try {
        const r = await query(
          `SELECT id, name, "displayName", balance, reputation, role, "referralCode",
                  "loginStreak", "lastDailyBonusAt", "telegramChatId",
                  level, experience, "isBanned", "isModerator", "roleChosen",
                  "notifyNewTasks", avatar, bio
           FROM "User" WHERE "telegramChatId" = $1`,
          [String(chatId)]
        );
        return r.rows[0] || null;
      } catch (e) {
        console.error('getUser:', e);
        return null;
      }
    };

    if (callback_query) {
      const chatId = callback_query.message?.chat?.id || callback_query.from.id;
      const messageId = callback_query.message?.message_id;
      const data = callback_query.data;

      const edit = async (text, parse_mode = 'Markdown', reply_markup = null) => {
        await editMessageText(chatId, messageId, text, parse_mode, reply_markup);
      };

      const user = await getUser(chatId);

      if (user && user.isBanned) {
        await edit('🚫 *Вы заблокированы.*', 'Markdown', { inline_keyboard: [] });
        return res.status(200).send('OK');
      }

      const isAdmin = user && user.role === 'admin';
      const isModerator = user && (user.isModerator || user.role === 'admin');

      const ctx = { edit, user, chatId, messageId, isAdmin, isModerator, userState, sendMessage };

      if (data === 'menu') {
        const { buildMainMenu } = require('../lib/menu');
        await edit('🤖 *Главное меню*', 'Markdown', buildMainMenu(user));
        return res.status(200).send('OK');
      }

      if (data === 'menu_tournament') {
        try {
          const { renderTournamentCard } = require('../lib/tournament');
          const card = await renderTournamentCard();
          await edit(card.text, 'Markdown', card.reply_markup);
        } catch (e) {
          console.error('menu_tournament:', e);
          await edit('❌ *Ошибка загрузки турнира*', 'Markdown', {
            inline_keyboard: [[{ text: '⬅️ В меню', callback_data: 'menu' }]],
          });
        }
        return res.status(200).send('OK');
      }

      if (data === 'tournament_help') {
        try {
          const { getTournamentHelp } = require('../lib/tournament');
          const card = getTournamentHelp();
          await edit(card.text, 'Markdown', card.reply_markup);
        } catch (e) {
          console.error('tournament_help:', e);
        }
        return res.status(200).send('OK');
      }
            // ═══ Обработка вывода ═══
      if (data.startsWith('wd_approve_') || data.startsWith('wd_reject_')) {
        if (!isAdmin) {
          await edit('🚫 *Только для админов*', 'Markdown', { inline_keyboard: [] });
          return res.status(200).send('OK');
        }
        const isApprove = data.startsWith('wd_approve_');
        const reqId = parseInt(data.replace(/^wd_(approve|reject)_/, ''), 10);
        if (!reqId) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return res.status(200).send('OK'); }

        try {
          const r = await query(
            `SELECT id, "userId", amount, status FROM "WithdrawalRequest" WHERE id = $1`,
            [reqId]
          );
          if (r.rows.length === 0) {
            await edit('❌ *Запрос не найден*', 'Markdown', { inline_keyboard: [] });
            return res.status(200).send('OK');
          }
          const w = r.rows[0];
          if (w.status !== 'pending') {
            await edit('⚠️ *Уже обработан*', 'Markdown', { inline_keyboard: [] });
            return res.status(200).send('OK');
          }

          const { notifyUser } = require('../lib/notify');

          if (isApprove) {
            await query(
              `UPDATE "WithdrawalRequest" SET status = 'paid', "processedAt" = NOW() WHERE id = $1`,
              [reqId]
            );
            await query(
              `UPDATE "Transaction" SET status = 'completed', reason = $1 WHERE "userId" = $2 AND type = 'withdraw_hold' AND amount = $3 AND status = 'pending'`,
              [`Вывод ${w.amount} ₽ — выплачено`, w.userId, -w.amount]
            );
            await notifyUser(w.userId, {
              message: `✅ Вывод ${w.amount} ₽ выполнен`,
              pushText: `✅ *Вывод выполнен!*\n\nСумма: *${w.amount} ₽*\nДеньги придут на карту в течение 1-3 рабочих дней.`,
              type: 'system',
              icon: '💸',
              force: true,
            });
            await edit(`✅ *Выплачено* #${reqId} → ${w.amount} ₽`, 'Markdown', { inline_keyboard: [] });
          } else {
            // Отклонение — возврат баланса
            await query(
              `UPDATE "WithdrawalRequest" SET status = 'rejected', "processedAt" = NOW() WHERE id = $1`,
              [reqId]
            );
            await query(`UPDATE "User" SET balance = balance + $1 WHERE id = $2`, [w.amount, w.userId]);
            await query(
              `UPDATE "Transaction" SET status = 'canceled', reason = $1 WHERE "userId" = $2 AND type = 'withdraw_hold' AND amount = $3 AND status = 'pending'`,
              [`Вывод ${w.amount} ₽ — отклонено, возврат`, w.userId, -w.amount]
            );
            await query(
              `INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt")
               VALUES ($1,'withdraw_refund',$2,'completed',$3,NOW())`,
              [w.userId, w.amount, `Возврат за отклонённый вывод #${reqId}`]
            );
            await notifyUser(w.userId, {
              message: `❌ Вывод ${w.amount} ₽ отклонён. Баланс возвращён.`,
              pushText: `❌ *Вывод отклонён*\n\nСумма: *${w.amount} ₽* возвращена на баланс.`,
              type: 'system',
              icon: '❌',
              force: true,
            });
            await edit(`❌ *Отклонено* #${reqId} → возврат ${w.amount} ₽`, 'Markdown', { inline_keyboard: [] });
          }
        } catch (e) {
          console.error('wd_ callback:', e);
          await edit('❌ *Ошибка обработки*', 'Markdown', { inline_keyboard: [] });
        }
        return res.status(200).send('OK');
      }

      // ═══════════ /stats — переключение периода ═══════════
      if (data.startsWith('stats_view_')) {
        if (!isAdmin) {
          await edit('🚫 *Только для админов*', 'Markdown', { inline_keyboard: [] });
          return res.status(200).send('OK');
        }
        const period = data.replace('stats_view_', '');
        try {
          const { getStats, renderStats, buildStatsKeyboard } = require('../lib/stats');
          const stats = await getStats(period);
          const msg = renderStats(stats);
          await edit(msg, 'Markdown', buildStatsKeyboard(period));
        } catch (e) {
          console.error('stats_view:', e);
          await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [] });
        }
        return res.status(200).send('OK');
      }

      if (await handleShopCallback(data, ctx)) return res.status(200).send('OK');
      if (await handleRoleCallback(data, ctx)) return res.status(200).send('OK');
      if (await handleAdminCallback(data, ctx)) return res.status(200).send('OK');
      if (await handleModerationCallback(data, ctx)) return res.status(200).send('OK');
      if (await handleTasksCallback(data, ctx)) return res.status(200).send('OK');
      if (await handleProfileCallback(data, ctx)) return res.status(200).send('OK');
      if (await handleSocialCallback(data, ctx)) return res.status(200).send('OK');

      return res.status(200).send('OK');
    }

    // ========== ТЕКСТОВЫЕ СООБЩЕНИЯ ==========
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

    const ctx = { send, user, chatId, isAdmin, isModerator, userState, sendMessage };

    // ========== DEEP LINKS ==========
    if (text.startsWith('/start ') || text.startsWith('/start@')) {
      const parts = text.split(' ');
      const param = parts[1] || '';
      if (param) {
        const handled = await handleStartParam(param, ctx);
        if (handled) return res.status(200).send('OK');
      }
    }

    // ========== /nick <ник> ==========
    if (text.startsWith('/nick')) {
      if (!user) {
        await send('❌ *Сначала привяжи аккаунт:* /link your@email.com');
        return res.status(200).send('OK');
      }

      const parts = text.split(/\s+/);
      const newNick = parts[1];

      if (!newNick) {
        const { getNicknameInfo } = require('../lib/nickname');
        const info = await getNicknameInfo(user.id);
        if (!info) {
          await send('❌ *Ошибка загрузки ника*');
          return res.status(200).send('OK');
        }
        const cdLine = info.canChange
          ? '✅ _Можешь менять ник прямо сейчас_'
          : `⏳ _Смена доступна через *${info.daysLeft} дн.*_`;
        await send(
          `🎭 *Твой ник:* \`${info.nickname}\`\n\n` +
          `_Формат:_ \`/nick новый_ник\`\n` +
          `_Правила:_ 3-20 символов, латиница, цифры, \`_\`. Начинается с буквы.\n\n` +
          cdLine,
          'Markdown',
          { inline_keyboard: [[{ text: '🔙 В меню', callback_data: 'menu' }]] }
        );
        return res.status(200).send('OK');
      }

      const { setNickname } = require('../lib/nickname');
      const result = await setNickname(user.id, newNick);

      if (!result.ok) {
        await send(
          `❌ *${result.error}*\n\n_Формат:_ \`/nick новый_ник\``,
          'Markdown',
          { inline_keyboard: [[{ text: '🔙 В меню', callback_data: 'menu' }]] }
        );
        return res.status(200).send('OK');
      }

      await send(
        `✅ *Ник обновлён!*\n\n` +
        `🎭 Теперь ты: \`${result.nickname}\`\n\n` +
        `_Следующая смена через 7 дней._`,
        'Markdown',
        { inline_keyboard: [[{ text: '👤 Профиль', callback_data: 'profile' }]] }
      );
      return res.status(200).send('OK');
    }

    // ========== /bio <текст> ==========
    if (text.startsWith('/bio')) {
      if (!user) {
        await send('❌ *Сначала привяжи аккаунт*');
        return res.status(200).send('OK');
      }
      const bioText = text.replace(/^\/bio(@\w+)?/, '').trim();
      if (!bioText) {
        await send(
          `📝 *Bio (описание о себе)*\n\n` +
          `_Формат:_ \`/bio Твой текст\`\n` +
          `_Лимит:_ 200 символов\n\n` +
          `Текущий: _${user.bio ? user.bio : 'не задан'}_`,
          'Markdown',
          { inline_keyboard: [[{ text: '🔙 В меню', callback_data: 'menu' }]] }
        );
        return res.status(200).send('OK');
      }
      if (bioText.length > 200) {
        await send(`❌ *Максимум 200 символов* (у тебя ${bioText.length})`);
        return res.status(200).send('OK');
      }
      await query(`UPDATE "User" SET bio = $1 WHERE id = $2`, [bioText, user.id]);
      await send(
        `✅ *Bio обновлено!*\n\n📝 _${bioText}_`,
        'Markdown',
        { inline_keyboard: [[{ text: '👤 Профиль', callback_data: 'profile' }]] }
      );
      return res.status(200).send('OK');
    }

    // ========== ПОИСК ИГРОКА (/find <ник>) ==========
    if (text.startsWith('/find')) {
      if (!user) {
        await send('❌ *Сначала привяжи аккаунт:* /link your@email.com');
        return res.status(200).send('OK');
      }

      const parts = text.split(/\s+/);
      const q = parts.slice(1).join(' ').trim();

      if (!q) {
        await send(
          `🔍 *Поиск игроков*\n\n` +
          `_Формат:_ \`/find ник\`\n` +
          `_Минимум 2 символа_\n\n` +
          `Пример: \`/find sergey\``,
          'Markdown',
          { inline_keyboard: [[{ text: '🔙 В меню', callback_data: 'menu' }]] }
        );
        return res.status(200).send('OK');
      }

      if (q.length < 2) {
        await send('❌ *Минимум 2 символа*');
        return res.status(200).send('OK');
      }

      try {
        const qLower = q.toLowerCase();
        const r = await query(
          `SELECT u.id, COALESCE(u."displayName", u.name) AS name,
                  u.level, u.role, u."ratingAvg", u."ratingCount",
                  u.reputation, pres."lastSeen"
           FROM "User" u
           LEFT JOIN "UserPresence" pres ON pres."userId" = u.id
           WHERE u."isBanned" = false
             AND LOWER(COALESCE(u."displayName", u.name)) LIKE $1
           ORDER BY
             CASE WHEN LOWER(COALESCE(u."displayName", u.name)) = $2 THEN 0 ELSE 1 END,
             u."ratingAvg" DESC NULLS LAST,
             u.reputation DESC
           LIMIT 10`,
          [`%${qLower}%`, qLower]
        );

        if (r.rows.length === 0) {
          await send(
            `🔍 *Поиск:* \`${q}\`\n\n_Ничего не найдено._`,
            'Markdown',
            { inline_keyboard: [[{ text: '🔙 В меню', callback_data: 'menu' }]] }
          );
          return res.status(200).send('OK');
        }

        let msg = `🔍 *Найдено: ${r.rows.length}*\n_Запрос:_ \`${q}\`\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n`;
        const kb = [];
        for (const u of r.rows) {
          const roleIcon = u.role === 'player' ? '🎮' : u.role === 'viewer' ? '👁' : '⚙️';
          const rating = u.ratingCount > 0 ? `⭐ ${Number(u.ratingAvg).toFixed(1)}` : '⭐ —';
          msg += `${roleIcon} *@${u.name}*\n`;
          msg += `   Ур. ${u.level || 1} • ${rating} • реп. ${u.reputation}\n\n`;
          const shortName = u.name.length > 30 ? u.name.slice(0, 30) + '…' : u.name;
          kb.push([{ text: `👤 @${shortName}`, callback_data: `view_user_${u.id}` }]);
        }
        kb.push([{ text: '🔙 В меню', callback_data: 'menu' }]);

        await send(msg, 'Markdown', { inline_keyboard: kb });
      } catch (e) {
        console.error('/find:', e);
        await send('❌ *Ошибка поиска*');
      }
      return res.status(200).send('OK');
    }

        // ========== /withdrawals (АДМИН) ==========
    if (text.startsWith('/withdrawals')) {
      if (!user) { await send('❌'); return res.status(200).send('OK'); }
      if (!isAdmin) { await send('🚫 *Только для админов*'); return res.status(200).send('OK'); }

      try {
        const r = await query(
          `SELECT w.id, w.amount, w.card, w.status, w."createdAt",
                  COALESCE(u."displayName", u.name) AS uname, u.id AS uid
           FROM "WithdrawalRequest" w
           JOIN "User" u ON u.id = w."userId"
           WHERE w.status = 'pending'
           ORDER BY w."createdAt" ASC
           LIMIT 20`
        );

        if (r.rows.length === 0) {
          await send('✅ *Нет активных запросов на вывод*');
          return res.status(200).send('OK');
        }

        let msg = `💸 *Запросы на вывод:* ${r.rows.length}\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n`;
        const kb = [];
        for (const w of r.rows) {
          const dt = new Date(w.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
          msg += `#${w.id} · *${w.amount} ₽*\n`;
          msg += `👤 @${w.uname}\n`;
          msg += `💳 \`${w.card}\`\n`;
          msg += `🕒 ${dt}\n\n`;

          kb.push([
            { text: `✅ Выплачено #${w.id}`, callback_data: `wd_approve_${w.id}` },
            { text: `❌ Отклонить #${w.id}`, callback_data: `wd_reject_${w.id}` },
          ]);
        }
        await send(msg, 'Markdown', { inline_keyboard: kb });
      } catch (e) {
        console.error('/withdrawals:', e);
        await send('❌ *Ошибка*');
      }
      return res.status(200).send('OK');
    }

    // ========== /stats (АДМИН) ==========
    if (text.startsWith('/stats')) {
      if (!user) {
        await send('❌ *Сначала привяжи аккаунт*');
        return res.status(200).send('OK');
      }
      if (!isAdmin) {
        await send('🚫 *Только для админов*');
        return res.status(200).send('OK');
      }

      try {
        const { getStats, renderStats, buildStatsKeyboard } = require('../lib/stats');
        const stats = await getStats('week');
        const msg = renderStats(stats);
        await send(msg, 'Markdown', buildStatsKeyboard('week'));
      } catch (e) {
        console.error('/stats:', e);
        await send('❌ *Ошибка загрузки статистики*');
      }
      return res.status(200).send('OK');
    }

    // ========== /clearbio ==========
    if (text === '/clearbio' || text === '/clearbio@nerv_05bot') {
      if (!user) { await send('❌'); return res.status(200).send('OK'); }
      await query(`UPDATE "User" SET bio = NULL WHERE id = $1`, [user.id]);
      await send('✅ *Bio удалено*', 'Markdown', {
        inline_keyboard: [[{ text: '👤 Профиль', callback_data: 'profile' }]],
      });
      return res.status(200).send('OK');
    }

    // ========== /clearavatar ==========
    if (text === '/clearavatar' || text === '/clearavatar@nerv_05bot') {
      if (!user) { await send('❌'); return res.status(200).send('OK'); }
      await query(`UPDATE "User" SET avatar = NULL WHERE id = $1`, [user.id]);
      await send('✅ *Аватарка удалена*', 'Markdown', {
        inline_keyboard: [[{ text: '👤 Профиль', callback_data: 'profile' }]],
      });
      return res.status(200).send('OK');
    }

    // ========== УСТАНОВКА АВАТАРКИ (фото) ==========
    if (message.photo && message.photo.length > 0) {
      if (!user) {
        await send('❌ *Сначала привяжи аккаунт:* /link your@email.com');
        return res.status(200).send('OK');
      }
      const photo = message.photo[message.photo.length - 1];
      const fileId = photo.file_id;
      await query(`UPDATE "User" SET avatar = $1 WHERE id = $2`, [fileId, user.id]);
      await send(
        `✅ *Аватарка обновлена!*\n\nОткрой Mini App → Профиль, чтобы увидеть.`,
        'Markdown',
        { inline_keyboard: [[{ text: '👤 Профиль', callback_data: 'profile' }]] }
      );
      return res.status(200).send('OK');
    }

    // ========== /reply_task ==========
    if (text.startsWith('/reply_task')) {
      if (!user) { await send('❌ *Сначала привяжи аккаунт:* /link your@email.com'); return res.status(200).send('OK'); }

      const parts = text.split(' ');
      if (parts.length < 3) {
        await send('⚠️ *Формат:* `/reply\\_task <taskId> <текст>`', 'Markdown');
        return res.status(200).send('OK');
      }

      const taskId = parseInt(parts[1]);
      const msgText = parts.slice(2).join(' ').trim();

      if (isNaN(taskId) || !msgText) {
        await send('❌ *Неверный taskId или пустое сообщение*');
        return res.status(200).send('OK');
      }

      try {
        const { sendChatMessage, getTaskParties } = require('../lib/chat');
        const sent = await sendChatMessage(taskId, user.id, msgText);

        if (!sent.ok) {
          await send(`❌ *${sent.error}*`);
          return res.status(200).send('OK');
        }

        await send('✅ *Сообщение отправлено*');

        const parties = await getTaskParties(taskId);
        const toUserId = parties.creatorId === user.id ? parties.playerId : parties.creatorId;
        if (toUserId) {
          const myName = user.displayName || user.name;
          await notifyUser(toUserId, {
            message: `💬 Новое сообщение по "${parties.title}" от ${myName}`,
            pushText:
              `💬 *Новое сообщение по заданию*\n\n` +
              `📌 ${parties.title}\n` +
              `👤 От: *${myName}*\n\n` +
              `_${msgText.slice(0, 300)}${msgText.length > 300 ? '…' : ''}_\n\n` +
              `↩️ Ответить: /reply\\_task ${taskId} <текст>`,
            type: 'chat',
            icon: '💬',
            linkType: 'task',
            linkId: taskId,
          });
        }
      } catch (e) {
        console.error('/reply_task:', e);
        await send('❌ *Ошибка отправки*');
      }
      return res.status(200).send('OK');
    }

    // ========== ПОШАГОВЫЕ СОСТОЯНИЯ ==========
    if (text && userState[chatId] && userState[chatId].step) {
      const state = userState[chatId];
      if (!user) {
        delete userState[chatId];
        await send('❌ *Сначала привяжи аккаунт*');
        return res.status(200).send('OK');
      }

      if (await handleSocialStep(state, text, ctx)) return res.status(200).send('OK');
      if (await handleCreateTaskStep(state, text, ctx)) return res.status(200).send('OK');
    }

    // ========== ВИДЕО / ДОКУМЕНТ ==========
    if (message.video || message.document) {
      if (!user || user.role !== 'player') {
        await send('❌ *Только игроки*');
        return res.status(200).send('OK');
      }
      const tr = await query(
        `SELECT * FROM "Task" WHERE "playerId"=$1 AND status='taken'
         ORDER BY "updatedAt" DESC LIMIT 1`,
        [user.id]
      );
      if (tr.rows.length === 0) {
        await send('❌ *Нет активных заданий*');
        return res.status(200).send('OK');
      }
      const t = tr.rows[0];
      const fileId = message.video?.file_id || message.document?.file_id;
      if (!fileId) {
        await send('❌ *Видео не получено*');
        return res.status(200).send('OK');
      }
      await query(`UPDATE "Task" SET status='voting', "videoUrl"=$1 WHERE id=$2`, [fileId, t.id]);
      await send(`✅ *Видео загружено:*\n📌 ${t.title}\n\nЗрители могут голосовать.`);

      await notifyUser(t.creatorId, {
        message: `🎬 Видео для задания: ${t.title}`,
        pushText: `🎬 *Видео загружено!*\n\n📌 ${t.title}\n\n_Зрители могут голосовать._`,
        type: 'task',
        icon: '🎬',
        linkType: 'task',
        linkId: t.id,
      });
      return res.status(200).send('OK');
    }

    // ========== ТЕКСТОВЫЕ КОМАНДЫ ==========
    if (text) {
      const handled = await handleTextCommand(text, ctx);
      if (handled) return res.status(200).send('OK');
    }

    await send('🤔 *Неизвестная команда.* /start');
    return res.status(200).send('OK');
  } catch (error) {
    console.error('Ошибка webhook:', error);
    return res.status(500).send('Internal error');
  }
};