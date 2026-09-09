@'
module.exports = async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(200).send('OK');
  }

  const chatId = message.chat.id;
  const text = message.text;

  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.error('❌ BOT_TOKEN не найден');
    return res.status(500).send('No token');
  }

  let reply = '🤔 Неизвестная команда. Используй /help.';
  if (text === '/start') reply = '✅ Бот работает на Vercel!';
  else if (text === '/help') reply = '📖 Команды: /start, /help';

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: reply }),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).send('Error sending message');
  }

  res.status(200).send('OK');
};
'@ | Out-File -FilePath api\webhook.js -Encoding utf8
