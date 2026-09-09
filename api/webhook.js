module.exports = async (req, res) => {
  // Telegram шлёт POST. GET — чтобы URL можно было проверить в браузере.
  if (req.method !== 'POST') {
    return res.status(200).send('OK');
  }

  try {
    const body = req.body || {};
    const message = body.message;
    if (!message) return res.status(200).send('OK');

    const token = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.error('❌ BOT_TOKEN не найден');
      return res.status(500).send('No token');
    }

    const chatId = message.chat && message.chat.id;
    if (!chatId) return res.status(200).send('OK');
    const text = (message.text || '').toString();

    const send = async (msg) => {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown' }),
      });
    };

    if (text === '/start') {
      await send(
        '🤖 *Бот НЕРВ*\n\n' +
        '📋 Команды:\n' +
        '/profile — Профиль\n' +
        '/tasks — Задания\n' +
        '/help — Помощь'
      );
    } else if (text === '/help') {
      await send('📖 *Команды:*\n\n/start — Главное меню\n/help — Помощь');
    } else {
      await send('🤔 *Неизвестная команда.* Используй /help.');
    }

    // Всегда 200 — иначе Telegram бесконечно ретраит
    return res.status(200).send('OK');
  } catch (error) {
    console.error('Ошибка webhook:', error);
    return res.status(200).send('OK');
  }
};