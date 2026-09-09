module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).send('OK');
  }
  try {
    const { message } = req.body;
    if (!message) return res.status(200).send('OK');

    const token = process.env.BOT_TOKEN;
    if (!token) return res.status(500).send('No token');

    const chatId = message.chat.id;
    const text = message.text || '';

    let reply = '🤔 Неизвестная команда. Используй /help.';
    if (text === '/start') reply = '✅ Бот работает (тестовая версия без БД)';

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: reply }),
    });

    return res.status(200).send('OK');
  } catch (error) {
    console.error('Ошибка:', error);
    return res.status(500).send('Error');
  }
};