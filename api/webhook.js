const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).send('OK');
  }

  try {
    const { message } = req.body;
    if (!message) return res.status(200).send('OK');

    const chatId = message.chat.id;
    const text = message.text || '';
    const token = process.env.BOT_TOKEN;
    if (!token) {
      console.error('❌ BOT_TOKEN не найден');
      return res.status(500).send('No token');
    }

    // --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
    const sendMessage = async (text, parse_mode = 'Markdown') => {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode }),
      });
    };

    const getUserByTelegramId = async () => {
      return await prisma.user.findFirst({
        where: { telegramChatId: String(chatId) },
        select: { id: true, name: true, balance: true, reputation: true, role: true },
      });
    };

    const linkUser = async (email) => {
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, name: true },
      });
      if (!user) return null;
      await prisma.user.update({
        where: { id: user.id },
        data: { telegramChatId: String(chatId) },
      });
      return user;
    };

    const getOpenTasks = async () => {
      return await prisma.task.findMany({
        where: { status: 'open' },
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { creator: { select: { name: true } } },
      });
    };

    const createTask = async (title, description, reward) => {
      const user = await getUserByTelegramId();
      if (!user) throw new Error('User not linked');
      if (user.role !== 'viewer' && user.role !== 'admin') {
        throw new Error('Only viewers and admins can create tasks');
      }
      if (user.balance < reward) {
        throw new Error('Insufficient balance');
      }
      const task = await prisma.task.create({
        data: {
          title,
          description,
          reward,
          creatorId: user.id,
          status: 'open',
        },
      });
      // Списать средства
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
          reason: `Создание задания "${title}"`,
        },
      });
      return task;
    };

    // --- ОБРАБОТКА КОМАНД ---

    // /start
    if (text === '/start') {
      await sendMessage(
        `🤖 *Бот НЕРВ*\n\n` +
        `📋 Команды:\n` +
        `/profile — Мой профиль\n` +
        `/tasks — Список заданий\n` +
        `/link <email> — Привязать аккаунт\n` +
        `/create — Создать задание\n` +
        `/help — Помощь`
      );
      return res.status(200).send('OK');
    }

    // /help
    if (text === '/help') {
      await sendMessage(
        `📖 *Команды:*\n\n` +
        `/start — Главное меню\n` +
        `/profile — Мой профиль\n` +
        `/tasks — Список заданий\n` +
        `/link <email> — Привязать аккаунт\n` +
        `/create — Создать задание (по шагам)\n` +
        `/help — Помощь`
      );
      return res.status(200).send('OK');
    }

    // /profile
    if (text === '/profile') {
      const user = await getUserByTelegramId();
      if (!user) {
        await sendMessage('❌ *Ты не привязан к аккаунту.*\n\nИспользуй `/link your@email.com` для привязки.');
        return res.status(200).send('OK');
      }
      await sendMessage(
        `👤 *${user.name}*\n\n` +
        `💰 Баланс: *${user.balance} ₽*\n` +
        `⭐ Репутация: *${user.reputation}*\n` +
        `🎮 Роль: *${user.role}*`
      );
      return res.status(200).send('OK');
    }

    // /tasks
    if (text === '/tasks') {
      const tasks = await getOpenTasks();
      if (tasks.length === 0) {
        await sendMessage('📭 *Нет открытых заданий.*');
        return res.status(200).send('OK');
      }
      let reply = '📋 *Список заданий:*\n\n';
      tasks.forEach((t, i) => {
        reply += `${i+1}. *${t.title}*\n`;
        reply += `   💰 ${t.reward} ₽\n`;
        reply += `   👤 ${t.creator.name}\n\n`;
      });
      await sendMessage(reply);
      return res.status(200).send('OK');
    }

    // /link <email>
    if (text.startsWith('/link ')) {
      const email = text.replace('/link ', '').trim().toLowerCase();
      if (!email.match(/^[^@]+@[^@]+\.[^@]+$/)) {
        await sendMessage('❌ *Неверный формат email.*\n\nПример: `/link test@mail.ru`');
        return res.status(200).send('OK');
      }
      const user = await linkUser(email);
      if (!user) {
        await sendMessage('❌ *Пользователь с таким email не найден.*\n\nПроверь email или зарегистрируйся на сайте.');
        return res.status(200).send('OK');
      }
      await sendMessage(`✅ *Аккаунт привязан!*\n\n👤 ${user.name}\nТеперь ты можешь использовать /profile и /tasks.`);
      return res.status(200).send('OK');
    }

    // /create — запускает диалог создания задания (только для viewer/admin)
    if (text === '/create') {
      // Проверяем, что пользователь привязан и имеет роль
      const user = await getUserByTelegramId();
      if (!user) {
        await sendMessage('❌ *Сначала привяжи аккаунт через `/link`.*');
        return res.status(200).send('OK');
      }
      if (user.role !== 'viewer' && user.role !== 'admin') {
        await sendMessage('❌ *Только зрители и администраторы могут создавать задания.*');
        return res.status(200).send('OK');
      }
      // Начинаем диалог — запрашиваем название
      // Для простоты используем inline-клавиатуру или просто просим ввести данные через команды.
      // В версии 1 попросим ввести через цепочку сообщений (сохраняя состояние в памяти).
      // Так как Vercel — serverless, состояние не сохраняется между вызовами.
      // Поэтому для сложных диалогов лучше использовать вебхук + базу данных для хранения состояний.
      // Ограничимся командой с параметрами: /create "Название" "Описание" 100
      await sendMessage(
        '📝 *Создание задания*\n\n' +
        'Используй формат:\n' +
        '`/create "Название" "Описание" Сумма`\n\n' +
        'Пример:\n' +
        '`/create "Пробежать 5 км" "Нужно пробежать 5 км за 30 минут" 100`'
      );
      return res.status(200).send('OK');
    }

    // Обработка команды /create с параметрами
    if (text.startsWith('/create "')) {
      // Парсим: /create "Название" "Описание" Сумма
      const match = text.match(/^\/create "([^"]*)" "([^"]*)" (\d+)$/);
      if (!match) {
        await sendMessage('❌ *Неверный формат.*\n\nИспользуй:\n`/create "Название" "Описание" Сумма`');
        return res.status(200).send('OK');
      }
      const [, title, description, reward] = match;
      const rewardNum = parseInt(reward, 10);
      if (rewardNum < 10) {
        await sendMessage('❌ *Минимальная награда — 10 ₽.*');
        return res.status(200).send('OK');
      }
      try {
        const task = await createTask(title, description, rewardNum);
        await sendMessage(`✅ *Задание создано!*\n\n📌 *${task.title}*\n💰 Награда: *${task.reward} ₽*\n🆔 ID: *${task.id}*`);
      } catch (error) {
        await sendMessage(`❌ *Ошибка:* ${error.message}`);
      }
      return res.status(200).send('OK');
    }

    // Неизвестная команда
    await sendMessage('🤔 *Неизвестная команда.*\n\nИспользуй /help для списка команд.');
    return res.status(200).send('OK');

  } catch (error) {
    console.error('Ошибка:', error);
    return res.status(500).send('Internal error');
  }
};