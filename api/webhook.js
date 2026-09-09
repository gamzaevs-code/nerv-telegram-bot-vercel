module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).send('OK');
  }

  try {
    const { message } = req.body;
    if (!message) return res.status(200).send('OK');

    const token = process.env.BOT_TOKEN;
    if (!token) {
      console.error('❌ BOT_TOKEN не найден');
      return res.status(500).send('No token');
    }

    const chatId = message.chat.id;
    const text = message.text || '';

    let reply = '🤔 Неизвестная команда. Используй /help.';
    if (text === '/start') reply = '✅ Бот работает на Vercel!';
    else if (text === '/help') reply = '📖 Команды: /start, /help';

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: reply }),
    });

    if (!response.ok) {
      console.error('Ошибка отправки сообщения:', await response.text());
    }

    return res.status(200).send('OK');
  } catch (error) {
    console.error('Ошибка:', error);
    return res.status(200).send('OK');
  }
};