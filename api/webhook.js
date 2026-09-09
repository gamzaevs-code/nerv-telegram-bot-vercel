const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const userState = {};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('OK');

  try {
    const { message, callback_query } = req.body;

    // ---------- ОБРАБОТКА КНОПОК ----------
    if (callback_query) {
      const chatId = callback_query.message.chat.id;
      const data = callback_query.data;
      const token = process.env.BOT_TOKEN;
      if (!token) return res.status(500).send('No token');

      const edit = async (text, parse_mode = 'Markdown', reply_markup = null) => {
        await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: callback_query.message.message_id,
            text,
            parse_mode,
            reply_markup,
          }),
        });
      };

      const getUser = async () => {
        try {
          return await prisma.user.findFirst({
            where: { telegramChatId: String(chatId) },
            select: { id: true, name: true, balance: true, reputation: true, role: true },
          });
        } catch {
          return null;
        }
      };

      // ---- Меню ----
      if (data === 'menu') {
        await edit(
          '🤖 *Главное меню*\nВыберите действие:',
          'Markdown',
          {
            inline_keyboard: [
              [{ text: '📊 Профиль', callback_data: 'profile' }],
              [{ text: '📋 Задания', callback_data: 'tasks' }],
              [{ text: '💰 Кошелёк', callback_data: 'wallet' }],
              [{ text: '➕ Создать задание', callback_data: 'create' }],
              [{ text: '❓ Помощь', callback_data: 'help' }],
            ],
          }
        );
        return res.status(200).send('OK');
      }

      // ---- Профиль ----
      if (data === 'profile') {
        const user = await getUser();
        if (!user) {
          await edit('❌ *Ты не привязан.* Используй /link your@email.com', 'Markdown', {
            inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]],
          });
          return res.status(200).send('OK');
        }
        await edit(
          `👤 *${user.name}*\n\n💰 Баланс: ${user.balance} ₽\n⭐ Репутация: ${user.reputation}\n🎮 Роль: ${user.role}`,
          'Markdown',
          { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }
        );
        return res.status(200).send('OK');
      }

      // ---- Задания ----
      if (data === 'tasks') {
        try {
          const tasks = await prisma.task.findMany({
            where: { status: 'open' },
            take: 5,
            orderBy: { createdAt: 'desc' },
            include: { creator: { select: { name: true } } },
          });
          if (tasks.length === 0) {
            await edit('📭 *Нет открытых заданий.*', 'Markdown', {
              inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]],
            });
            return res.status(200).send('OK');
          }
          let reply = '📋 *Список заданий:*\n\n';
          tasks.forEach((t, i) => {
            reply += `${i+1}. *${t.title}*\n   💰 ${t.reward} ₽\n   👤 ${t.creator.name}\n\n`;
          });
          await edit(reply, 'Markdown', {
            inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]],
          });
          return res.status(200).send('OK');
        } catch {
          await edit('❌ *Ошибка загрузки заданий*', 'Markdown', {
            inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]],
          });
          return res.status(200).send('OK');
        }
      }

      // ---- Кошелёк ----
      if (data === 'wallet') {
        const user = await getUser();
        if (!user) {
          await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', {
            inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]],
          });
          return res.status(200).send('OK');
        }
        await edit(
          `💳 *Кошелёк*\n\n💰 Баланс: ${user.balance} ₽`,
          'Markdown',
          { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }
        );
        return res.status(200).send('OK');
      }

      // ---- Создать задание ----
      if (data === 'create') {
        const user = await getUser();
        if (!user) {
          await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', {
            inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]],
          });
          return res.status(200).send('OK');
        }
        userState[chatId] = { step: 'title' };
        await edit(
          '📝 *Создание задания*\n\nВведите *название* задания:',
          'Markdown',
          { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'menu' }]] }
        );
        return res.status(200).send('OK');
      }

      // ---- Помощь ----
      if (data === 'help') {
        await edit(
          '📖 *Помощь*\n\n/start — Меню\n/link email — Привязать\n/create — Создать задание\n/delete_data — Удалить мои данные\n/help — Помощь',
          'Markdown',
          { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }
        );
        return res.status(200).send('OK');
      }

      return res.status(200).send('OK');
    }

    // ---------- ОБЫЧНЫЕ СООБЩЕНИЯ ----------
    const chatId = message.chat.id;
    const text = message.text || '';
    const token = process.env.BOT_TOKEN;
    if (!token) return res.status(500).send('No token');

    const send = async (msg, parse_mode = 'Markdown', reply_markup = null) => {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode, reply_markup }),
      });
    };

    const getUser = async () => {
      try {
        return await prisma.user.findFirst({
          where: { telegramChatId: String(chatId) },
          select: { id: true, name: true, balance: true, reputation: true, role: true },
        });
      } catch {
        return null;
      }
    };

    // ---- /start (без проверки согласия) ----
    if (text === '/start' || text === '/menu') {
      await send(
        '🤖 *Добро пожаловать в НЕРВ Бот!*\n\nВыберите действие:',
        'Markdown',
        {
          inline_keyboard: [
            [{ text: '📊 Профиль', callback_data: 'profile' }],
            [{ text: '📋 Задания', callback_data: 'tasks' }],
            [{ text: '💰 Кошелёк', callback_data: 'wallet' }],
            [{ text: '➕ Создать задание', callback_data: 'create' }],
            [{ text: '❓ Помощь', callback_data: 'help' }],
          ],
        }
      );
      return res.status(200).send('OK');
    }

    // ---- /profile ----
    if (text === '/profile') {
      const user = await getUser();
      if (!user) {
        await send('❌ *Ты не привязан.* Используй /link your@email.com', 'Markdown', {
          inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]],
        });
        return res.status(200).send('OK');
      }
      await send(
        `👤 *${user.name}*\n\n💰 ${user.balance} ₽\n⭐ ${user.reputation}\n🎮 ${user.role}`,
        'Markdown',
        { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }
      );
      return res.status(200).send('OK');
    }

    // ---- /tasks ----
    if (text === '/tasks') {
      try {
        const tasks = await prisma.task.findMany({
          where: { status: 'open' },
          take: 5,
          orderBy: { createdAt: 'desc' },
          include: { creator: { select: { name: true } } },
        });
        if (tasks.length === 0) {
          await send('📭 *Нет открытых заданий.*', 'Markdown', {
            inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]],
          });
          return res.status(200).send('OK');
        }
        let reply = '📋 *Список заданий:*\n\n';
        tasks.forEach((t, i) => {
          reply += `${i+1}. *${t.title}*\n   💰 ${t.reward} ₽\n   👤 ${t.creator.name}\n\n`;
        });
        await send(reply, 'Markdown', {
          inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]],
        });
        return res.status(200).send('OK');
      } catch {
        await send('❌ *Ошибка загрузки заданий*', 'Markdown', {
          inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]],
        });
        return res.status(200).send('OK');
      }
    }

    // ---- /link your@email.com ----
    if (text.startsWith('/link ')) {
      const email = text.replace('/link ', '').trim().toLowerCase();
      if (!email.match(/^[^@]+@[^@]+\.[^@]+$/)) {
        await send('❌ *Неверный email*');
        return res.status(200).send('OK');
      }
      try {
        const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true } });
        if (!user) {
          await send('❌ *Пользователь с таким email не найден.*');
          return res.status(200).send('OK');
        }
        await prisma.user.update({
          where: { id: user.id },
          data: { telegramChatId: String(chatId) },
        });
        await send(`✅ *Аккаунт привязан!*\n👤 ${user.name}`, 'Markdown', {
          inline_keyboard: [[{ text: '📊 Профиль', callback_data: 'profile' }]],
        });
        return res.status(200).send('OK');
      } catch {
        await send('❌ *Ошибка привязки*');
        return res.status(200).send('OK');
      }
    }

    if (text === '/link') {
      await send('⚠️ *Укажи email:* `/link your@email.com`\nПример: `/link test@mail.ru`');
      return res.status(200).send('OK');
    }

    // ---- /delete_data (удаляет telegramChatId) ----
    if (text === '/delete_data') {
      try {
        const user = await prisma.user.findFirst({
          where: { telegramChatId: String(chatId) },
          select: { id: true },
        });
        if (!user) {
          await send('❌ *Вы не привязаны к аккаунту.*');
          return res.status(200).send('OK');
        }
        await prisma.user.update({
          where: { id: user.id },
          data: { telegramChatId: null },
        });
        await send('✅ *Вы отвязаны от бота.*');
        return res.status(200).send('OK');
      } catch {
        await send('❌ *Ошибка*');
        return res.status(200).send('OK');
      }
    }

    // ---- Пошаговое создание задания ----
    if (userState[chatId] && userState[chatId].step) {
      const state = userState[chatId];
      const user = await prisma.user.findFirst({
        where: { telegramChatId: String(chatId) },
        select: { id: true, balance: true, role: true },
      });
      if (!user) {
        delete userState[chatId];
        await send('❌ *Сначала привяжи аккаунт*');
        return res.status(200).send('OK');
      }

      if (state.step === 'title') {
        state.title = text;
        state.step = 'description';
        await send('📝 *Введите описание задания:*', 'Markdown', {
          inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'menu' }]],
        });
        return res.status(200).send('OK');
      }

      if (state.step === 'description') {
        state.description = text;
        state.step = 'reward';
        await send('💰 *Введите награду (число, минимум 10):*', 'Markdown', {
          inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'menu' }]],
        });
        return res.status(200).send('OK');
      }

      if (state.step === 'reward') {
        const reward = parseInt(text, 10);
        if (isNaN(reward) || reward < 10) {
          await send('❌ *Введите число больше 9*');
          return res.status(200).send('OK');
        }

        if (user.role !== 'viewer' && user.role !== 'admin') {
          await send('❌ *Только зрители и админы могут создавать задания*');
          delete userState[chatId];
          return res.status(200).send('OK');
        }

        if (user.balance < reward) {
          await send(`❌ *Недостаточно средств.* Баланс: ${user.balance} ₽`);
          delete userState[chatId];
          return res.status(200).send('OK');
        }

        try {
          const task = await prisma.task.create({
            data: {
              title: state.title,
              description: state.description,
              reward: reward,
              creatorId: user.id,
              status: 'open',
            },
          });

          await prisma.user.update({
            where: { id: user.id },
            data: { balance: { decrement: reward } },
          });

          await prisma.transaction.create({
            data: {
              userId: user.id,
              type: 'task_create',
              amount: -reward,
              status: 'completed',
              reason: `Создание задания "${task.title}"`,
            },
          });

          delete userState[chatId];

          await send(
            `✅ *Задание создано!*\n\n📌 ${task.title}\n💰 ${task.reward} ₽`,
            'Markdown',
            { inline_keyboard: [[{ text: '📋 Задания', callback_data: 'tasks' }]] }
          );
          return res.status(200).send('OK');
        } catch (error) {
          console.error(error);
          await send('❌ *Ошибка создания задания*');
          delete userState[chatId];
          return res.status(200).send('OK');
        }
      }
    }

    // Неизвестная команда
    await send('🤔 *Неизвестная команда.* Используй /start');
    return res.status(200).send('OK');

  } catch (error) {
    console.error('Ошибка:', error);
    return res.status(500).send('Internal error');
  }
};