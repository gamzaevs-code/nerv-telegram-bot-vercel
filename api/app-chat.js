// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// API: чат по заданию (история + отправка)
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const crypto = require('crypto');
const { query } = require('../lib/db');
const { sendMessage } = require('../lib/telegram');
const {
  getChatHistory,
  sendChatMessage,
  getTaskParties,
  getTotalUnreadChats,
} = require('../lib/chat');

const verifyInitData = (initData) => {
  const botToken = process.env.BOT_TOKEN;
  if (!botToken) throw new Error('BOT_TOKEN не задан');
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('hash отсутствует');
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calcHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (calcHash !== hash) throw new Error('Неверная подпись');
  const authDate = parseInt(params.get('auth_date') || '0', 10);
  if (Math.floor(Date.now() / 1000) - authDate > 86400) throw new Error('Устарело');
  return JSON.parse(params.get('user'));
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const { initData, action, taskId, message } = req.body;
    if (!initData) return res.status(400).json({ ok: false, error: 'initData обязателен' });

    const tgUser = verifyInitData(initData);
    const chatId = String(tgUser.id);

    const meRes = await query(
      `SELECT id, COALESCE("displayName", name) AS name FROM "User" WHERE "telegramChatId" = $1`,
      [chatId]
    );
    if (meRes.rows.length === 0) return res.status(403).json({ ok: false, error: 'Аккаунт не привязан' });
    const me = meRes.rows[0];

    // ===== Список всех чатов (по заданиям) =====
    if (action === 'list') {
      const r = await query(
        `SELECT DISTINCT t.id AS "taskId", t.title, t.status,
                (SELECT c.message FROM "TaskChat" c WHERE c."taskId"=t.id ORDER BY c."createdAt" DESC LIMIT 1) AS last_message,
                (SELECT c."createdAt" FROM "TaskChat" c WHERE c."taskId"=t.id ORDER BY c."createdAt" DESC LIMIT 1) AS last_at,
                (SELECT COUNT(*)::int FROM "TaskChat" c WHERE c."taskId"=t.id AND c."toUserId"=$1 AND c."isRead"=false) AS unread
         FROM "Task" t
         WHERE (t."creatorId"=$1 OR t."playerId"=$1)
           AND EXISTS (SELECT 1 FROM "TaskChat" c WHERE c."taskId"=t.id)
         ORDER BY last_at DESC NULLS LAST
         LIMIT 30`,
        [me.id]
      );
      return res.status(200).json({ ok: true, chats: r.rows });
    }

    // ===== История по заданию =====
    if (action === 'history') {
      if (!taskId) return res.status(400).json({ ok: false, error: 'taskId обязателен' });
      const hist = await getChatHistory(taskId, me.id);
      if (!hist.ok) return res.status(400).json(hist);
      return res.status(200).json({ ok: true, messages: hist.messages });
    }

    // ===== Отправить сообщение =====
    if (action === 'send') {
      if (!taskId || !message || !message.trim()) {
        return res.status(400).json({ ok: false, error: 'Пустое сообщение' });
      }
      const sent = await sendChatMessage(taskId, me.id, message);
      if (!sent.ok) return res.status(400).json(sent);

      // Push получателю в Telegram
      const parties = await getTaskParties(taskId);
      const toChatId = parties.creatorId === me.id ? parties.player_chat : parties.creator_chat;

      if (toChatId) {
        const pushText =
          `💬 *Новое сообщение по заданию*\n\n` +
          `📌 ${parties.title}\n` +
          `👤 От: *${me.name}*\n\n` +
          `_${message.slice(0, 300)}${message.length > 300 ? '…' : ''}_\n\n` +
          `↩️ Ответить: /reply\\_task ${taskId} <текст>`;
        try { await sendMessage(toChatId, pushText, 'Markdown'); }
        catch (err) { console.error('push chat:', err); }
      }

      return res.status(200).json({ ok: true, messageId: sent.messageId, createdAt: sent.createdAt });
    }

    // ===== Общий счётчик =====
    if (action === 'unread_count') {
      const c = await getTotalUnreadChats(me.id);
      return res.status(200).json({ ok: true, count: c });
    }

    return res.status(400).json({ ok: false, error: 'Неизвестное действие' });
  } catch (e) {
    console.error('app-chat error:', e);
    return res.status(401).json({ ok: false, error: e.message });
  }
};