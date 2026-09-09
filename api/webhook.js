module.exports = async (req, res) => {
  // Разрешаем только POST-запросы
  if (req.method !== 'POST') {
    return res.status(200).send('OK');
  }

  try {
    const { message } = req.body;

    // Если нет сообщения — просто OK
    if (!message) {
      return res.status(200).send('OK');
    }

    const chatId = message.chat.id;
    const text = message.text || '';

    const token = process.env.BOT_TOKEN;
    if (!token) {
      console.error('❌ BOT_TOKEN не найден');
      return res.status(500).send('No token');
    }

    // Определяем ответ
    let reply = '🤔 Неизвестная команда. Используй /help.';
    if (text === '/start') reply = '✅ Бот работает на Vercel!';
    else if (text === '/help') reply = '📖 Команды: /start, /help';

    // Отправляем ответ в Telegram
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: reply }),
    });

    if (!response.ok) {
      console.error('Ошибка отправки сообщения:', await response.text());
      return res.status(500).send('Error sending message');
    }

    return res.status(200).send('OK');
  } catch (error) {
    console.error('Ошибка:', error);
    return res.status(500).send('Internal error');
  }
};