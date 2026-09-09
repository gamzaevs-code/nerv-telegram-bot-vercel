const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('OK');

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

    const sendMessage = async (text, parse_mode = 'Markdown') => {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode }),
      });
    };

    const getUser = async () => {
      return await prisma.user.findFirst({
        where: { telegramChatId: String(chatId) },
        select: { id: true, name: true, balance: true, reputation: true, role: true, level: true, experience: true },
      });
    };

    // ---------- КОМАНДЫ ----------

    if (text === '/start') {
      await sendMessage(
        `🤖 *Бот НЕРВ*\n\n` +
        `📋 Команды:\n` +
        `/profile — Мой профиль\n` +
        `/tasks — Список заданий\n` +
        `/link your@email.com — Привязать аккаунт\n` +
        `/create "Название" "Описание" Сумма — Создать задание\n` +
        `/take <id> — Взять задание\n` +
        `/vote <id> approve/reject — Голосовать\n` +
        `/transactions — История транзакций\n` +
        `/leaderboard — Топ игроков\n` +
        `/help — Помощь`
      );
      return res.status(200).send('OK');
    }

    // -------------------- ПРОФИЛЬ --------------------
    if (text === '/profile') {
      const user = await getUser();
      if (!user) {
        await sendMessage('❌ *Ты не привязан к аккаунту.*\n\nИспользуй `/link your@email.com` для привязки.');
        return res.status(200).send('OK');
      }
      await sendMessage(
        `👤 *${user.name}*\n\n` +
        `💰 Баланс: *${user.balance} ₽*\n` +
        `⭐ Репутация: *${user.reputation}*\n` +
        `🎮 Роль: *${user.role}*\n` +
        `📈 Уровень: *${user.level}*\n` +
        `⚡ Опыт: *${user.experience}*`
      );
      return res.status(200).send('OK');
    }

    // -------------------- СПИСОК ЗАДАНИЙ --------------------
    if (text === '/tasks') {
      const tasks = await prisma.task.findMany({
        where: { status: 'open' },
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { creator: { select: { name: true } } },
      });
      if (tasks.length === 0) {
        await sendMessage('📭 *Нет открытых заданий.*');
        return res.status(200).send('OK');
      }
      let reply = '📋 *Список заданий:*\n\n';
      tasks.forEach((t) => {
        reply += `🆔 *${t.id}* — *${t.title}*\n`;
        reply += `   💰 Награда: *${t.reward} ₽*\n`;
        reply += `   👤 Создатель: ${t.creator.name}\n`;
        reply += `   📌 Статус: ${t.status}\n\n`;
      });
      await sendMessage(reply);
      return res.status(200).send('OK');
    }

    // -------------------- ПРИВЯЗКА АККАУНТА --------------------
    if (text.startsWith('/link ')) {
      const email = text.replace('/link ', '').trim().toLowerCase();
      if (!email.match(/^[^@]+@[^@]+\.[^@]+$/)) {
        await sendMessage('❌ *Неверный формат email.*\n\nПример: `/link test@mail.ru`');
        return res.status(200).send('OK');
      }
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, name: true, role: true },
      });
      if (!user) {
        await sendMessage('❌ *Пользователь с таким email не найден.*\n\nПроверь email или зарегистрируйся на сайте.');
        return res.status(200).send('OK');
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { telegramChatId: String(chatId) },
      });
      await sendMessage(`✅ *Аккаунт привязан!*\n\n👤 ${user.name}\n🎮 Роль: *${user.role}*\n\nТеперь используй /profile, /tasks, /create и другие команды.`);
      return res.status(200).send('OK');
    }

    if (text === '/link') {
      await sendMessage('⚠️ *Укажи email:* `/link your@email.com`\n\nПример: `/link test@mail.ru`');
      return res.status(200).send('OK');
    }

    // -------------------- СОЗДАНИЕ ЗАДАНИЯ --------------------
    if (text.startsWith('/create ')) {
      // Формат: /create "Название" "Описание" Сумма
      const match = text.match(/^\/create "([^"]*)" "([^"]*)" (\d+)$/);
      if (!match) {
        await sendMessage(
          '❌ *Неверный формат.*\n\n' +
          'Используй: `/create "Название" "Описание" Сумма`\n\n' +
          'Пример: `/create "Пробежать 5 км" "Нужно пробежать за 30 минут" 100`'
        );
        return res.status(200).send('OK');
      }

      const [, title, description, reward] = match;
      const rewardNum = parseInt(reward, 10);

      // Проверяем пользователя
      const user = await getUser();
      if (!user) {
        await sendMessage('❌ *Сначала привяжи аккаунт через `/link`.*');
        return res.status(200).send('OK');
      }

      // Только зрители и админы могут создавать
      if (user.role !== 'viewer' && user.role !== 'admin') {
        await sendMessage('❌ *Только зрители и администраторы могут создавать задания.*');
        return res.status(200).send('OK');
      }

      if (rewardNum < 10) {
        await sendMessage('❌ *Минимальная награда — 10 ₽.*');
        return res.status(200).send('OK');
      }

      if (user.balance < rewardNum) {
        await sendMessage(`❌ *Недостаточно средств.*\n\nТвой баланс: *${user.balance} ₽*\nНужно: *${rewardNum} ₽*`);
        return res.status(200).send('OK');
      }

      // Создаём задание
      const task = await prisma.task.create({
        data: {
          title,
          description,
          reward: rewardNum,
          creatorId: user.id,
          status: 'open',
        },
      });

      // Списываем средства
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
        `📌 Название: *${task.title}*\n` +
        `💰 Награда: *${task.reward} ₽*\n` +
        `🆔 ID: *${task.id}*\n\n` +
        `Теперь игроки могут взять его через /take ${task.id}`
      );
      return res.status(200).send('OK');
    }

    if (text === '/create') {
      await sendMessage(
        '📝 *Создание задания*\n\n' +
        'Используй формат:\n' +
        '`/create "Название" "Описание" Сумма`\n\n' +
        'Пример:\n' +
        '`/create "Пробежать 5 км" "Нужно пробежать за 30 минут" 100`'
      );
      return res.status(200).send('OK');
    }

    // -------------------- ВЗЯТИЕ ЗАДАНИЯ --------------------
    if (text.startsWith('/take ')) {
      const id = parseInt(text.replace('/take ', ''), 10);
      if (isNaN(id)) {
        await sendMessage('❌ *Укажи корректный ID задания.*\n\nПример: `/take 5`');
        return res.status(200).send('OK');
      }

      const user = await getUser();
      if (!user) {
        await sendMessage('❌ *Сначала привяжи аккаунт через `/link`.*');
        return res.status(200).send('OK');
      }

      if (user.role !== 'player' && user.role !== 'admin') {
        await sendMessage('❌ *Только игроки и администраторы могут брать задания.*');
        return res.status(200).send('OK');
      }

      // Атомарное взятие
      const task = await prisma.task.findUnique({
        where: { id },
        select: { id: true, status: true, playerId: true, creatorId: true, title: true },
      });

      if (!task) {
        await sendMessage('❌ *Задание не найдено.*');
        return res.status(200).send('OK');
      }

      if (task.status !== 'open') {
        await sendMessage('❌ *Задание уже взято или недоступно.*');
        return res.status(200).send('OK');
      }

      if (task.creatorId === user.id) {
        await sendMessage('❌ *Ты не можешь взять своё собственное задание.*');
        return res.status(200).send('OK');
      }

      // Обновляем задание
      await prisma.task.update({
        where: { id },
        data: { status: 'taken', playerId: user.id },
      });

      await sendMessage(`✅ *Задание взято!*\n\n📌 *${task.title}*\n🆔 ID: *${task.id}*\n\nТеперь загрузи видео и отправь на голосование.`);
      return res.status(200).send('OK');
    }

    if (text === '/take') {
      await sendMessage('🎯 *Взять задание*\n\nУкажи ID задания: `/take <id>`\n\nПример: `/take 5`');
      return res.status(200).send('OK');
    }

    // -------------------- ГОЛОСОВАНИЕ --------------------
    if (text.startsWith('/vote ')) {
      const parts = text.split(' ');
      if (parts.length < 3) {
        await sendMessage('❌ *Неверный формат.*\n\nИспользуй: `/vote <id> approve` или `/vote <id> reject`');
        return res.status(200).send('OK');
      }
      const id = parseInt(parts[1], 10);
      const value = parts[2].toLowerCase();
      if (isNaN(id) || !['approve', 'reject'].includes(value)) {
        await sendMessage('❌ *Укажи корректный ID и значение (approve/reject).*');
        return res.status(200).send('OK');
      }

      const user = await getUser();
      if (!user) {
        await sendMessage('❌ *Сначала привяжи аккаунт через `/link`.*');
        return res.status(200).send('OK');
      }

      const task = await prisma.task.findUnique({
        where: { id },
        select: { id: true, status: true, playerId: true, creatorId: true, title: true },
      });

      if (!task) {
        await sendMessage('❌ *Задание не найдено.*');
        return res.status(200).send('OK');
      }

      if (task.status !== 'voting') {
        await sendMessage('❌ *Задание не на стадии голосования.*');
        return res.status(200).send('OK');
      }

      if (task.creatorId === user.id) {
        await sendMessage('❌ *Создатель не может голосовать за своё задание.*');
        return res.status(200).send('OK');
      }

      if (task.playerId === user.id) {
        await sendMessage('❌ *Исполнитель не может голосовать за своё задание.*');
        return res.status(200).send('OK');
      }

      // Проверяем, голосовал ли уже
      const existingVote = await prisma.vote.findUnique({
        where: { taskId_voterId: { taskId: task.id, voterId: user.id } },
      });
      if (existingVote) {
        await sendMessage('❌ *Ты уже проголосовал за это задание.*');
        return res.status(200).send('OK');
      }

      // Создаём голос
      await prisma.vote.create({
        data: {
          taskId: task.id,
          voterId: user.id,
          value,
        },
      });

      // После голосования можно проверить количество голосов и автоматически завершить задание,
      // но пока просто уведомляем.
      await sendMessage(`✅ *Голос учтён!*\n\nЗадание: *${task.title}*\nТвой голос: *${value}*`);
      return res.status(200).send('OK');
    }

    if (text === '/vote') {
      await sendMessage('🗳️ *Голосование*\n\nФормат: `/vote <id> approve/reject`\n\nПример: `/vote 5 approve`');
      return res.status(200).send('OK');
    }

    // -------------------- ТРАНЗАКЦИИ --------------------
    if (text === '/transactions') {
      const user = await getUser();
      if (!user) {
        await sendMessage('❌ *Сначала привяжи аккаунт через `/link`.*');
        return res.status(200).send('OK');
      }

      const transactions = await prisma.transaction.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      if (transactions.length === 0) {
        await sendMessage('📭 *История транзакций пуста.*');
        return res.status(200).send('OK');
      }

      let reply = '💳 *Последние транзакции:*\n\n';
      transactions.forEach((t) => {
        const sign = t.amount >= 0 ? '+' : '';
        reply += `${t.createdAt.toLocaleDateString()} — ${t.reason || t.type}: *${sign}${t.amount} ₽*\n`;
      });
      await sendMessage(reply);
      return res.status(200).send('OK');
    }

    // -------------------- ТОП ИГРОКОВ --------------------
    if (text === '/leaderboard') {
      const users = await prisma.user.findMany({
        orderBy: { reputation: 'desc' },
        take: 10,
        select: { name: true, reputation: true, level: true, role: true },
      });

      if (users.length === 0) {
        await sendMessage('📭 *Нет пользователей для рейтинга.*');
        return res.status(200).send('OK');
      }

      let reply = '🏆 *Топ игроков по репутации:*\n\n';
      users.forEach((u, i) => {
        reply += `${i+1}. *${u.name}* — ⭐ ${u.reputation} (уровень ${u.level})\n`;
      });
      await sendMessage(reply);
      return res.status(200).send('OK');
    }

    // -------------------- ПОМОЩЬ --------------------
    if (text === '/help') {
      await sendMessage(
        `📖 *Полный список команд:*\n\n` +
        `/start — Главное меню\n` +
        `/profile — Мой профиль\n` +
        `/tasks — Список заданий\n` +
        `/link your@email.com — Привязать аккаунт\n` +
        `/create "Название" "Описание" Сумма — Создать задание\n` +
        `/take <id> — Взять задание\n` +
        `/vote <id> approve/reject — Проголосовать\n` +
        `/transactions — История транзакций\n` +
        `/leaderboard — Топ игроков\n` +
        `/help — Эта справка`
      );
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