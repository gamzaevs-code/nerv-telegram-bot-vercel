const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('OK');

  try {
    const body = req.body;
    const { message, callback_query } = body;

    // Обработка нажатий на кнопки (callback_query)
    if (callback_query) {
      const chatId = callback_query.message.chat.id;
      const data = callback_query.data;
      const token = process.env.BOT_TOKEN;
      if (!token) return res.status(500).send('No token');

      const sendMessage = async (text, parse_mode = 'Markdown', reply_markup = null) => {
        const payload = { chat_id: chatId, text, parse_mode };
        if (reply_markup) payload.reply_markup = reply_markup;
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      };

      const editMessage = async (text, parse_mode = 'Markdown', reply_markup = null) => {
        const payload = {
          chat_id: chatId,
          message_id: callback_query.message.message_id,
          text,
          parse_mode,
        };
        if (reply_markup) payload.reply_markup = reply_markup;
        await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      };

      const getUser = async () => {
        return await prisma.user.findFirst({
          where: { telegramChatId: String(chatId) },
          select: { id: true, name: true, balance: true, reputation: true, role: true },
        });
      };

      // Обработка callback-данных
      if (data === 'menu') {
        await editMessage(
          '🤖 *Главное меню*\n\nВыберите действие:',
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

      if (data === 'profile') {
        const user = await getUser();
        if (!user) {
          await editMessage(
            '❌ *Ты не привязан к аккаунту.*\n\nИспользуй `/link your@email.com` для привязки.',
            'Markdown',
            { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }
          );
          return res.status(200).send('OK');
        }
        await editMessage(
          `👤 *${user.name}*\n\n` +
          `💰 Баланс: *${user.balance} ₽*\n` +
          `⭐ Репутация: *${user.reputation}*\n` +
          `🎮 Роль: *${user.role}*`,
          'Markdown',
          { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }
        );
        return res.status(200).send('OK');
      }

      if (data === 'tasks') {
        const tasks = await prisma.task.findMany({
          where: { status: 'open' },
          take: 5,
          orderBy: { createdAt: 'desc' },
          include: { creator: { select: { name: true } } },
        });
        if (tasks.length === 0) {
          await editMessage(
            '📭 *Нет открытых заданий.*',
            'Markdown',
            { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }
          );
          return res.status(200).send('OK');
        }
        let reply = '📋 *Список заданий:*\n\n';
        tasks.forEach((t, i) => {
          reply += `${i+1}. *${t.title}*\n`;
          reply += `   💰 ${t.reward} ₽\n`;
          reply += `   👤 ${t.creator.name}\n\n`;
        });
        await editMessage(
          reply,
          'Markdown',
          { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }
        );
        return res.status(200).send('OK');
      }

      if (data === 'wallet') {
        const user = await getUser();
        if (!user) {
          await editMessage(
            '❌ *Сначала привяжи аккаунт через `/link`*',
            'Markdown',
            { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }
          );
          return res.status(200).send('OK');
        }
        await editMessage(
          `💳 *Кошелёк*\n\n` +
          `💰 Баланс: *${user.balance} ₽*\n` +
          `📊 Транзакции: пока не реализовано`,
          'Markdown',
          { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }
        );
        return res.status(200).send('OK');
      }

      if (data === 'create') {
        const user = await getUser();
        if (!user) {
          await editMessage(
            '❌ *Сначала привяжи аккаунт через `/link`*',
            'Markdown',
            { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }
          );
          return res.status(200).send('OK');
        }
        await editMessage(
          '📝 *Создание задания*\n\n' +
          'Используй команду:\n' +
          '`/create "Название" "Описание" Сумма`\n\n' +
          'Пример:\n' +
          '`/create "Пробежать 5 км" "Нужно пробежать 5 км" 100`',
          'Markdown',
          { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }
        );
        return res.status(200).send('OK');
      }

      if (data === 'help') {
        await editMessage(
          '📖 *Помощь*\n\n' +
          'Команды:\n' +
          '/start — Начать\n' +
          '/menu — Главное меню\n' +
          '/profile — Профиль\n' +
          '/tasks — Задания\n' +
          '/link your@email.com — Привязать аккаунт\n' +
          '/help — Помощь',
          'Markdown',
          { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }
        );
        return res.status(200).send('OK');
      }

      // Если callback не распознан
      await editMessage('⚠️ Неизвестное действие', 'Markdown');
      return res.status(200).send('OK');
    }

    // ---------- ОБРАБОТКА ОБЫЧНЫХ СООБЩЕНИЙ ----------

    const chatId = message.chat.id;
    const text = message.text || '';
    const token = process.env.BOT_TOKEN;
    if (!token) return res.status(500).send('No token');

    const sendMessage = async (text, parse_mode = 'Markdown', reply_markup = null) => {
      const payload = { chat_id: chatId, text, parse_mode };
      if (reply_markup) payload.reply_markup = reply_markup;
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    };

    const getUser = async () => {
      return await prisma.user.findFirst({
        where: { telegramChatId: String(chatId) },
        select: { id: true, name: true, balance: true, reputation: true, role: true },
      });
    };

    // /start
    if (text === '/start') {
      await sendMessage(
        '🤖 *Добро пожаловать в НЕРВ Бот!*\n\n' +
        'Используй кнопки ниже для навигации:',
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

    // /menu — вызывает главное меню
    if (text === '/menu') {
      await sendMessage(
        '🤖 *Главное меню*\n\nВыберите действие:',
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

    // /profile
    if (text === '/profile') {
      const user = await getUser();
      if (!user) {
        await sendMessage(
          '❌ *Ты не привязан к аккаунту.*\n\nИспользуй `/link your@email.com` для привязки.',
          'Markdown',
          { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }
        );
        return res.status(200).send('OK');
      }
      await sendMessage(
        `👤 *${user.name}*\n\n` +
        `💰 Баланс: *${user.balance} ₽*\n` +
        `⭐ Репутация: *${user.reputation}*\n` +
        `🎮 Роль: *${user.role}*`,
        'Markdown',
        { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }
      );
      return res.status(200).send('OK');
    }

    // /tasks
    if (text === '/tasks') {
      const tasks = await prisma.task.findMany({
        where: { status: 'open' },
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { creator: { select: { name: true } } },
      });
      if (tasks.length === 0) {
        await sendMessage(
          '📭 *Нет открытых заданий.*',
          'Markdown',
          { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }
        );
        return res.status(200).send('OK');
      }
      let reply = '📋 *Список заданий:*\n\n';
      tasks.forEach((t, i) => {
        reply += `${i+1}. *${t.title}*\n`;
        reply += `   💰 ${t.reward} ₽\n`;
        reply += `   👤 ${t.creator.name}\n\n`;
      });
      await sendMessage(
        reply,
        'Markdown',
        { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }
      );
      return res.status(200).send('OK');
    }

    // /link your@email.com
    if (text.startsWith('/link ')) {
      const email = text.replace('/link ', '').trim().toLowerCase();

      if (!email.match(/^[^@]+@[^@]+\.[^@]+$/)) {
        await sendMessage('❌ *Неверный формат email.*\n\nПример: `/link test@mail.ru`');
        return res.status(200).send('OK');
      }

      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, name: true },
      });

      if (!user) {
        await sendMessage('❌ *Пользователь с таким email не найден.*');
        return res.status(200).send('OK');
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { telegramChatId: String(chatId) },
      });

      await sendMessage(
        `✅ *Аккаунт привязан!*\n\n👤 ${user.name}\nТеперь используй /profile или меню.`,
        'Markdown',
        { inline_keyboard: [[{ text: '📊 Профиль', callback_data: 'profile' }]] }
      );
      return res.status(200).send('OK');
    }

    // /create "Название" "Описание" Сумма
    if (text.startsWith('/create "')) {
      const match = text.match(/^\/create "([^"]*)" "([^"]*)" (\d+)$/);
      if (!match) {
        await sendMessage(
          '❌ *Неверный формат.*\n\n' +
          'Используй:\n' +
          '`/create "Название" "Описание" Сумма`\n\n' +
          'Пример:\n' +
          '`/create "Пробежать 5 км" "Нужно пробежать 5 км" 100`'
        );
        return res.status(200).send('OK');
      }
      const [, title, description, reward] = match;
      const rewardNum = parseInt(reward, 10);

      if (rewardNum < 10) {
        await sendMessage('❌ *Минимальная награда — 10 ₽.*');
        return res.status(200).send('OK');
      }

      const user = await getUser();
      if (!user) {
        await sendMessage('❌ *Сначала привяжи аккаунт через `/link`*');
        return res.status(200).send('OK');
      }

      if (user.role !== 'viewer' && user.role !== 'admin') {
        await sendMessage('❌ *Только зрители и администраторы могут создавать задания.*');
        return res.status(200).send('OK');
      }

      if (user.balance < rewardNum) {
        await sendMessage(`❌ *Недостаточно средств.*\n\nТвой баланс: ${user.balance} ₽, нужно: ${rewardNum} ₽`);
        return res.status(200).send('OK');
      }

      const task = await prisma.task.create({
        data: {
          title,
          description,
          reward: rewardNum,
          creatorId: user.id,
          status: 'open',
        },
      });

      await prisma.user.update({
        where: { id: user.id },
        data: { balance: { decrement: rewardNum } },
      });

      await prisma.transaction.create({
        data: {
          userId: user.id,
          type: 'task_create',
          amount: -rewardNum,
          status: 'completed',
          reason: `Создание задания "${title}"`,
        },
      });

      await sendMessage(
        `✅ *Задание создано!*\n\n` +
        `📌 *${task.title}*\n` +
        `💰 Награда: *${task.reward} ₽*\n` +
        `🆔 ID: *${task.id}*`,
        'Markdown',
        { inline_keyboard: [[{ text: '📋 Задания', callback_data: 'tasks' }]] }
      );
      return res.status(200).send('OK');
    }

    // /link без email
    if (text === '/link') {
      await sendMessage(
        '⚠️ *Укажи email:* `/link your@email.com`\n\n' +
        'Пример: `/link test@mail.ru`'
      );
      return res.status(200).send('OK');
    }

    // Неизвестная команда
    await sendMessage(
      '🤔 *Неизвестная команда.*\n\nИспользуй /start для меню или /help для помощи.'
    );
    return res.status(200).send('OK');

  } catch (error) {
    console.error('Ошибка:', error);
    return res.status(500).send('Internal error');
  }
};