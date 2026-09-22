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

const userState = {};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('OK');

  try {
    const { message, callback_query } = req.body;
    if (!process.env.BOT_TOKEN) return res.status(500).send('No token');

    // ========== GET USER ==========
    const getUser = async (chatId) => {
      try {
        const r = await query(
          `SELECT id, name, "displayName", balance, reputation, role, "referralCode",
                  "loginStreak", "lastDailyBonusAt", "telegramChatId",
                  level, experience, "isBanned", "isModerator", "roleChosen",
                  "notifyNewTasks"
           FROM "User" WHERE "telegramChatId" = $1`,
          [String(chatId)]
        );
        return r.rows[0] || null;
      } catch (e) {
        console.error('getUser:', e);
        return null;
      }
    };

    // ========== CALLBACK QUERY ==========
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

      // Меню
      if (data === 'menu') {
        const { buildMainMenu } = require('../lib/menu');
        await edit('🤖 *Главное меню*', 'Markdown', buildMainMenu(user));
        return res.status(200).send('OK');
      }

      // ===== ТУРНИР =====
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

      // Порядок важен
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

    // ========== DEEP LINKS (/start <param>) ==========
    if (text.startsWith('/start ') || text.startsWith('/start@')) {
      const parts = text.split(' ');
      const param = parts[1] || '';
      if (param) {
        const handled = await handleStartParam(param, ctx);
        if (handled) return res.status(200).send('OK');
      }
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
      const cr = await query('SELECT "telegramChatId" FROM "User" WHERE id=$1', [t.creatorId]);
      if (cr.rows[0]?.telegramChatId) {
        await sendMessage(cr.rows[0].telegramChatId, `🎬 *Видео для:*\n📌 ${t.title}`);
      }
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