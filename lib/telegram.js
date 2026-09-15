const TELEGRAM_API = 'https://api.telegram.org';

const sendMessage = async (chatId, text, parse_mode = 'Markdown', reply_markup = null) => {
  const token = process.env.BOT_TOKEN;
  if (!token) return;
  const payload = { chat_id: chatId, text, parse_mode };
  if (reply_markup) payload.reply_markup = reply_markup;
  try {
    await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('sendMessage error:', e);
  }
};

const editMessageText = async (chatId, messageId, text, parse_mode = 'Markdown', reply_markup = null) => {
  const token = process.env.BOT_TOKEN;
  if (!token) return;
  const payload = { chat_id: chatId, message_id: messageId, text, parse_mode };
  if (reply_markup) payload.reply_markup = reply_markup;
  try {
    await fetch(`${TELEGRAM_API}/bot${token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('editMessageText error:', e);
  }
};

module.exports = { sendMessage, editMessageText };