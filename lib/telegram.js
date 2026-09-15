const TELEGRAM_API = 'https://api.telegram.org';

const callApi = async (method, payload) => {
  const token = process.env.BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (e) {
    console.error(`telegram.${method}:`, e);
    return null;
  }
};

const sendMessage = async (chatId, text, parse_mode = 'Markdown', reply_markup = null) => {
  const payload = { chat_id: chatId, text, parse_mode };
  if (reply_markup) payload.reply_markup = reply_markup;
  return await callApi('sendMessage', payload);
};

const editMessageText = async (chatId, messageId, text, parse_mode = 'Markdown', reply_markup = null) => {
  const payload = { chat_id: chatId, message_id: messageId, text, parse_mode };
  if (reply_markup) payload.reply_markup = reply_markup;
  return await callApi('editMessageText', payload);
};

const sendVideo = async (chatId, video, caption = '', reply_markup = null) => {
  const payload = { chat_id: chatId, video, caption, parse_mode: 'Markdown' };
  if (reply_markup) payload.reply_markup = reply_markup;
  return await callApi('sendVideo', payload);
};

const deleteMessage = async (chatId, messageId) => {
  return await callApi('deleteMessage', { chat_id: chatId, message_id: messageId });
};

module.exports = { sendMessage, editMessageText, sendVideo, deleteMessage, callApi };