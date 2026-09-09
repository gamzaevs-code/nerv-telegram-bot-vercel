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
        select: { id: true, name: true, balance: true, reputation: true, role: true },
      });
    };

    // ---------- КОМАНДЫ ----------

    if (text === '/start') {
      await sendMessage(
        `🤖 *Бот НЕРВ*\n\n` +
        `📋 Команды:\n` +
        `/profile — Мой профиль\n` +
        `/tasks — Список заданий\n` +
        `/link <email> — Привязать аккаунт\n` +
        `/help — Помощь`
      );
      return res.status(200).send('OK');
    }

    if (text === '/help') {
      await sendMessage(
        `📖 *Команды:*\n\n` +
        `/start — Главное меню\n` +
        `/profile — Мой профиль\n` +
        `/tasks — Список заданий\n` +
        `/link <email> — Привязать аккаунт\n` +
        `/help — Помощь`
      );
      return res.status(200).send('OK');
    }

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
        `🎮 Роль: *${user.role}*`
      );
      return res.status(200).send('OK');
    }

    if (text === '/tasks') {
      const tasks = await prisma.task.findMany({
        where: { status: 'open' },
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { creator: { select: { name: true } } },
      });
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

    if (text.startsWith('/link ')) {
      const email = text.replace('/link ', '').trim().toLowerCase();
      if (!email.match(/^[^@]+@[^@]+\.[^@]+$/)) {
        await sendMessage('❌ *Неверный формат email.*\n\nПример: `/link test@mail.ru`');
        return res.status(200).send('OK');
      }
      const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true } });
      if (!user) {
        await sendMessage('❌ *Пользователь с таким email не найден.*');
        return res.status(200).send('OK');
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { telegramChatId: String(chatId) },
      });
      await sendMessage(`✅ *Аккаунт привязан!*\n\n👤 ${user.name}`);
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