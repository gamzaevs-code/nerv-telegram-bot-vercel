const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Хранилище для диалогов (создание задания)
const userState = {};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('OK');

  try {
    const { message, callback_query } = req.body;

    // ---------- ОБРАБОТКА НАЖАТИЙ КНОПОК ----------
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

      const send = async (text, parse_mode = 'Markdown', reply_markup = null) => {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode, reply_markup }),
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
              [{ text: '🏆 Рейтинг', callback_data: 'leaderboard' }],
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

      // ---- Задания (список + кнопки "Взять" и "Голосовать") ----
      if (data === 'tasks') {
        try {
          const tasks = await prisma.task.findMany({
            where: { status: { in: ['open', 'voting'] } },
            take: 5,
            orderBy: { createdAt: 'desc' },
            include: { creator: { select: { name: true } }, player: { select: { name: true } } },
          });
          if (tasks.length === 0) {
            await edit('📭 *Нет открытых заданий.*', 'Markdown', {
              inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]],
            });
            return res.status(200).send('OK');
          }

          const user = await getUser();
          const isPlayer = user && user.role === 'player';
          const isViewer = user && (user.role === 'viewer' || user.role === 'admin');

          const buttons = [];
          tasks.forEach((t) => {
            const row = [
              { text: `📌 ${t.title} (${t.reward}₽)`, callback_data: `task_${t.id}` }
            ];
            // Кнопка "Взять" для игроков, если задание открыто
            if (isPlayer && t.status === 'open' && !t.playerId) {
              row.push({ text: '🎯 Взять', callback_data: `take_${t.id}` });
            }
            // Кнопки голосования для зрителей/админов, если задание в голосовании
            if (isViewer && t.status === 'voting') {
              row.push({ text: '✅ За', callback_data: `vote_${t.id}_approve` });
              row.push({ text: '❌ Против', callback_data: `vote_${t.id}_reject` });
            }
            buttons.push(row);
          });
          buttons.push([{ text: '🔙 Назад', callback_data: 'menu' }]);

          await edit('📋 *Доступные задания:*', 'Markdown', { inline_keyboard: buttons });
          return res.status(200).send('OK');
        } catch (error) {
          console.error(error);
          await edit('❌ *Ошибка загрузки заданий*', 'Markdown', {
            inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]],
          });
          return res.status(200).send('OK');
        }
      }

      // ---- Детали задания ----
      if (data.startsWith('task_')) {
        const taskId = parseInt(data.split('_')[1]);
        if (isNaN(taskId)) {
          await edit('❌ *Некорректный ID*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] });
          return res.status(200).send('OK');
        }
        try {
          const task = await prisma.task.findUnique({
            where: { id: taskId },
            include: { creator: { select: { name: true } }, player: { select: { name: true } } },
          });
          if (!task) {
            await edit('❌ *Задание не найдено*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] });
            return res.status(200).send('OK');
          }
          let text = `📌 *${task.title}*\n\n`;
          text += `📝 ${task.description || 'Без описания'}\n`;
          text += `💰 Награда: ${task.reward} ₽\n`;
          text += `👤 Создатель: ${task.creator.name}\n`;
          text += `📌 Статус: ${task.status}\n`;
          if (task.player) text += `🎮 Игрок: ${task.player.name}\n`;
          if (task.videoUrl) text += `🎬 Видео: есть\n`;

          const buttons = [
            [{ text: '🔙 К списку', callback_data: 'tasks' }],
            [{ text: '🔙 В меню', callback_data: 'menu' }],
          ];
          // Если задание в голосовании, показываем кнопки голосования для зрителей
          if (task.status === 'voting') {
            const user = await getUser();
            if (user && (user.role === 'viewer' || user.role === 'admin')) {
              buttons.unshift([
                { text: '✅ За', callback_data: `vote_${task.id}_approve` },
                { text: '❌ Против', callback_data: `vote_${task.id}_reject` },
              ]);
            }
          }
          await edit(text, 'Markdown', { inline_keyboard: buttons });
          return res.status(200).send('OK');
        } catch {
          await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] });
          return res.status(200).send('OK');
        }
      }

      // ---- Взятие задания ----
      if (data.startsWith('take_')) {
        const taskId = parseInt(data.split('_')[1]);
        if (isNaN(taskId)) {
          await edit('❌ *Некорректный ID*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] });
          return res.status(200).send('OK');
        }
        const user = await getUser();
        if (!user) {
          await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] });
          return res.status(200).send('OK');
        }
        if (user.role !== 'player') {
          await edit('❌ *Только игроки могут брать задания*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] });
          return res.status(200).send('OK');
        }

        try {
          const updated = await prisma.task.updateMany({
            where: { id: taskId, status: 'open', playerId: null },
            data: { status: 'taken', playerId: user.id },
          });
          if (updated.count === 0) {
            await edit('❌ *Задание уже взято или недоступно*', 'Markdown', { inline_keyboard: [[{ text: '🔙 К списку', callback_data: 'tasks' }]] });
            return res.status(200).send('OK');
          }
          const task = await prisma.task.findUnique({ where: { id: taskId }, include: { creator: { select: { name: true } } } });
          await edit(
            `✅ *Задание взято!*\n\n📌 ${task.title}\n💰 ${task.reward} ₽\n👤 Создатель: ${task.creator.name}\n\n📹 Отправьте видео-доказательство (файл) в этот чат.`,
            'Markdown',
            { inline_keyboard: [[{ text: '📋 Мои задания', callback_data: 'my_tasks' }], [{ text: '🔙 В меню', callback_data: 'menu' }]] }
          );
          return res.status(200).send('OK');
        } catch {
          await edit('❌ *Ошибка взятия задания*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] });
          return res.status(200).send('OK');
        }
      }

      // ---- Голосование ----
      if (data.startsWith('vote_')) {
        const parts = data.split('_');
        const taskId = parseInt(parts[1]);
        const value = parts[2];
        const user = await getUser();
        if (!user) {
          await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] });
          return res.status(200).send('OK');
        }

        // Проверка, не голосовал ли уже
        const existing = await prisma.vote.findUnique({
          where: { taskId_voterId: { taskId, voterId: user.id } },
        });
        if (existing) {
          await edit('❌ *Ты уже голосовал за это задание*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] });
          return res.status(200).send('OK');
        }

        try {
          await prisma.vote.create({
            data: {
              taskId,
              voterId: user.id,
              value,
            },
          });

          // Обновляем репутацию за голосование
          await prisma.user.update({
            where: { id: user.id },
            data: { reputation: { increment: 1 } },
          });

          // Подсчёт голосов
          const votes = await prisma.vote.groupBy({
            by: ['value'],
            where: { taskId },
            _count: true,
          });
          const approveCount = votes.find(v => v.value === 'approve')?._count || 0;
          const rejectCount = votes.find(v => v.value === 'reject')?._count || 0;

          await edit(
            `✅ *Голос принят!*\n\n📌 Задание #${taskId}\nЗа: ${approveCount}\nПротив: ${rejectCount}`,
            'Markdown',
            { inline_keyboard: [[{ text: '🔙 К списку', callback_data: 'tasks' }]] }
          );

          // Автозавершение при 5 голосах "За"
          if (approveCount >= 5) {
            const task = await prisma.task.update({
              where: { id: taskId },
              data: { status: 'approved' },
            });
            // Награда игроку
            await prisma.user.update({
              where: { id: task.playerId },
              data: { balance: { increment: task.reward }, completedTasksCount: { increment: 1 } },
            });
            await prisma.transaction.create({
              data: {
                userId: task.playerId,
                type: 'reward',
                amount: task.reward,
                status: 'completed',
                reason: `Выполнение задания "${task.title}"`,
              },
            });
            // Уведомление игроку
            const player = await prisma.user.findUnique({ where: { id: task.playerId }, select: { telegramChatId: true } });
            if (player && player.telegramChatId) {
              await send(`🎉 *Задание выполнено!*\n\n📌 ${task.title}\n💰 +${task.reward} ₽`);
            }
          }

          return res.status(200).send('OK');
        } catch (error) {
          console.error(error);
          await edit('❌ *Ошибка голосования*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'tasks' }]] });
          return res.status(200).send('OK');
        }
      }

      // ---- Мои задания ----
      if (data === 'my_tasks') {
        const user = await getUser();
        if (!user) {
          await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
          return res.status(200).send('OK');
        }
        try {
          const tasks = await prisma.task.findMany({
            where: { playerId: user.id, status: { in: ['taken', 'voting', 'approved'] } },
            orderBy: { updatedAt: 'desc' },
            include: { creator: { select: { name: true } } },
          });
          if (tasks.length === 0) {
            await edit('📭 *У тебя нет активных заданий.*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
            return res.status(200).send('OK');
          }
          let text = '📋 *Твои задания:*\n\n';
          tasks.forEach((t, i) => {
            text += `${i+1}. *${t.title}*\n   💰 ${t.reward} ₽\n   Статус: ${t.status}\n   👤 Создатель: ${t.creator.name}\n\n`;
          });
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
          return res.status(200).send('OK');
        } catch {
          await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
          return res.status(200).send('OK');
        }
      }

      // ---- Кошелёк ----
      if (data === 'wallet') {
        const user = await getUser();
        if (!user) {
          await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
          return res.status(200).send('OK');
        }
        try {
          const transactions = await prisma.transaction.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: 'desc' },
            take: 5,
          });
          let text = `💳 *Кошелёк*\n\n💰 Баланс: ${user.balance} ₽\n\n📊 *Последние транзакции:*\n`;
          if (transactions.length === 0) {
            text += 'Нет транзакций.';
          } else {
            transactions.forEach((t) => {
              const sign = t.amount > 0 ? '+' : '';
              text += `${t.createdAt.toLocaleDateString()} ${sign}${t.amount} ₽ — ${t.reason}\n`;
            });
          }
          await edit(text, 'Markdown', {
            inline_keyboard: [
              [{ text: '📈 Полная история', callback_data: 'transactions' }],
              [{ text: '🔙 Назад', callback_data: 'menu' }],
            ],
          });
          return res.status(200).send('OK');
        } catch {
          await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
          return res.status(200).send('OK');
        }
      }

      // ---- Полная история транзакций ----
      if (data === 'transactions') {
        const user = await getUser();
        if (!user) {
          await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
          return res.status(200).send('OK');
        }
        try {
          const transactions = await prisma.transaction.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: 'desc' },
            take: 20,
          });
          let text = '📊 *История транзакций:*\n\n';
          if (transactions.length === 0) {
            text += 'Нет транзакций.';
          } else {
            transactions.forEach((t) => {
              const sign = t.amount > 0 ? '+' : '';
              text += `${t.createdAt.toLocaleDateString()} ${sign}${t.amount} ₽ — ${t.reason}\n`;
            });
          }
          await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'wallet' }]] });
          return res.status(200).send('OK');
        } catch {
          await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'wallet' }]] });
          return res.status(200).send('OK');
        }
      }

      // ---- Рейтинг ----
      if (data === 'leaderboard') {
        try {
          const users = await prisma.user.findMany({
            orderBy: { reputation: 'desc' },
            take: 10,
            select: { name: true, reputation: true, balance: true },
          });
          let text = '🏆 *Топ игроков по репутации:*\n\n';
          users.forEach((u, i) => {
            text += `${i+1}. ${u.name} — ⭐ ${u.reputation} (💰 ${u.balance}₽)\n`;
          });
          await edit(text, 'Markdown', {
            inline_keyboard: [
              [{ text: '💰 По балансу', callback_data: 'leaderboard_balance' }],
              [{ text: '🔙 Назад', callback_data: 'menu' }],
            ],
          });
          return res.status(200).send('OK');
        } catch {
          await edit('❌ *Ошибка загрузки рейтинга*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
          return res.status(200).send('OK');
        }
      }

      // ---- Рейтинг по балансу ----
      if (data === 'leaderboard_balance') {
        try {
          const users = await prisma.user.findMany({
            orderBy: { balance: 'desc' },
            take: 10,
            select: { name: true, reputation: true, balance: true },
          });
          let text = '💰 *Топ игроков по балансу:*\n\n';
          users.forEach((u, i) => {
            text += `${i+1}. ${u.name} — 💰 ${u.balance}₽ (⭐ ${u.reputation})\n`;
          });
          await edit(text, 'Markdown', {
            inline_keyboard: [
              [{ text: '⭐ По репутации', callback_data: 'leaderboard' }],
              [{ text: '🔙 Назад', callback_data: 'menu' }],
            ],
          });
          return res.status(200).send('OK');
        } catch {
          await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
          return res.status(200).send('OK');
        }
      }

      // ---- Создать задание (запуск диалога) ----
      if (data === 'create') {
        const user = await getUser();
        if (!user) {
          await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
          return res.status(200).send('OK');
        }
        if (user.role !== 'viewer' && user.role !== 'admin') {
          await edit('❌ *Только зрители и админы могут создавать задания*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
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
          '📖 *Помощь*\n\n/start — Меню\n/link email — Привязать аккаунт\n/create — Создать задание\n/tasks — Список заданий\n/take — Взять задание (по ID)\n/profile — Профиль\n/wallet — Кошелёк\n/leaderboard — Рейтинг\n/delete_data — Отвязать аккаунт\n/help — Помощь',
          'Markdown',
          { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }
        );
        return res.status(200).send('OK');
      }

      return res.status(200).send('OK');
    }

    // ---------- ОБЫЧНЫЕ ТЕКСТОВЫЕ СООБЩЕНИЯ ----------
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

    // ---- /start ----
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
            [{ text: '🏆 Рейтинг', callback_data: 'leaderboard' }],
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
          where: { status: { in: ['open', 'voting'] } },
          take: 5,
          orderBy: { createdAt: 'desc' },
          include: { creator: { select: { name: true } }, player: { select: { name: true } } },
        });
        if (tasks.length === 0) {
          await send('📭 *Нет открытых заданий.*', 'Markdown', {
            inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]],
          });
          return res.status(200).send('OK');
        }
        const user = await getUser();
        const isPlayer = user && user.role === 'player';
        const isViewer = user && (user.role === 'viewer' || user.role === 'admin');

        const buttons = [];
        tasks.forEach((t) => {
          const row = [
            { text: `📌 ${t.title} (${t.reward}₽)`, callback_data: `task_${t.id}` }
          ];
          if (isPlayer && t.status === 'open' && !t.playerId) {
            row.push({ text: '🎯 Взять', callback_data: `take_${t.id}` });
          }
          if (isViewer && t.status === 'voting') {
            row.push({ text: '✅ За', callback_data: `vote_${t.id}_approve` });
            row.push({ text: '❌ Против', callback_data: `vote_${t.id}_reject` });
          }
          buttons.push(row);
        });
        buttons.push([{ text: '🔙 Назад', callback_data: 'menu' }]);

        await send('📋 *Доступные задания:*', 'Markdown', { inline_keyboard: buttons });
        return res.status(200).send('OK');
      } catch {
        await send('❌ *Ошибка загрузки заданий*', 'Markdown', {
          inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]],
        });
        return res.status(200).send('OK');
      }
    }

    // ---- /link ----
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

    // ---- /leaderboard ----
    if (text === '/leaderboard') {
      try {
        const users = await prisma.user.findMany({
          orderBy: { reputation: 'desc' },
          take: 10,
          select: { name: true, reputation: true, balance: true },
        });
        let msg = '🏆 *Топ игроков по репутации:*\n\n';
        users.forEach((u, i) => {
          msg += `${i+1}. ${u.name} — ⭐ ${u.reputation} (💰 ${u.balance}₽)\n`;
        });
        await send(msg, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      } catch {
        await send('❌ *Ошибка загрузки рейтинга*', 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
        return res.status(200).send('OK');
      }
    }

    // ---- /delete_data ----
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

    // ---------- ОБРАБОТКА ВИДЕО ----------
    if (message.video || message.document) {
      const user = await prisma.user.findFirst({
        where: { telegramChatId: String(chatId) },
        select: { id: true, role: true },
      });
      if (!user || user.role !== 'player') {
        await send('❌ *Только игроки могут загружать видео для заданий.*');
        return res.status(200).send('OK');
      }

      // Ищем задание, которое игрок взял и находится в статусе taken
      const task = await prisma.task.findFirst({
        where: { playerId: user.id, status: 'taken' },
        orderBy: { updatedAt: 'desc' },
        include: { creator: { select: { name: true, telegramChatId: true } } },
      });
      if (!task) {
        await send('❌ *У тебя нет активных заданий, требующих видео.*');
        return res.status(200).send('OK');
      }

      const fileId = message.video?.file_id || message.document?.file_id;
      if (!fileId) {
        await send('❌ *Не удалось получить видео.*');
        return res.status(200).send('OK');
      }

      // Обновляем задание
      await prisma.task.update({
        where: { id: task.id },
        data: { status: 'voting', videoUrl: fileId },
      });

      await send(
        `✅ *Видео загружено для задания:*\n\n📌 ${task.title}\n\nТеперь зрители могут голосовать.`
      );

      // Уведомляем создателя
      if (task.creator.telegramChatId) {
        await send(
          `🎬 *Игрок загрузил видео для вашего задания:*\n\n📌 ${task.title}\n\nПерейдите в список заданий для голосования.`
        );
      }
      return res.status(200).send('OK');
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