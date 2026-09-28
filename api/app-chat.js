// в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬
// API: С‡Р°С‚ РїРѕ Р·Р°РґР°РЅРёСЋ (РёСЃС‚РѕСЂРёСЏ + РѕС‚РїСЂР°РІРєР°)
// в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬
const crypto = require('crypto');
const { query } = require('../lib/db');
const {
  getChatHistory,
  sendChatMessage,
  getTaskParties,
  getTotalUnreadChats,
} = require('../lib/chat');
const { notifyUser } = require('../lib/notify');

const verifyInitData = (initData) => {
  const botToken = process.env.BOT_TOKEN;
  if (!botToken) throw new Error('BOT_TOKEN РЅРµ Р·Р°РґР°РЅ');
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('hash РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚');
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calcHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (calcHash !== hash) throw new Error('РќРµРІРµСЂРЅР°СЏ РїРѕРґРїРёСЃСЊ');
  const authDate = parseInt(params.get('auth_date') || '0', 10);
  if (Math.floor(Date.now() / 1000) - authDate > 86400) throw new Error('РЈСЃС‚Р°СЂРµР»Рѕ');
  return JSON.parse(params.get('user'));
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const { initData, action, taskId, message } = req.body;
    if (!initData) return res.status(400).json({ ok: false, error: 'initData РѕР±СЏР·Р°С‚РµР»РµРЅ' });

    const tgUser = verifyInitData(initData);
    const chatId = String(tgUser.id);

    const meRes = await query(
      `SELECT id, COALESCE("displayName", name) AS name FROM "User" WHERE "telegramChatId" = $1`,
      [chatId]
    );
    if (meRes.rows.length === 0) return res.status(403).json({ ok: false, error: 'РђРєРєР°СѓРЅС‚ РЅРµ РїСЂРёРІСЏР·Р°РЅ' });
    const me = meRes.rows[0];

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

    if (action === 'history') {
      if (!taskId) return res.status(400).json({ ok: false, error: 'taskId РѕР±СЏР·Р°С‚РµР»РµРЅ' });
      const hist = await getChatHistory(taskId, me.id);
      if (!hist.ok) return res.status(400).json(hist);
      return res.status(200).json({ ok: true, messages: hist.messages });
    }

    if (action === 'send') {
      if (!taskId || !message || !message.trim()) {
        return res.status(400).json({ ok: false, error: 'РџСѓСЃС‚РѕРµ СЃРѕРѕР±С‰РµРЅРёРµ' });
      }
      const sent = await sendChatMessage(taskId, me.id, message);
      if (!sent.ok) return res.status(400).json(sent);

      // рџ”” Push РїРѕР»СѓС‡Р°С‚РµР»СЋ С‡РµСЂРµР· notifyUser
      const parties = await getTaskParties(taskId);
      const toUserId = parties.creatorId === me.id ? parties.playerId : parties.creatorId;

      if (toUserId) {
        await notifyUser(toUserId, {
          message: `рџ’¬ РќРѕРІРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ РїРѕ "${parties.title}" РѕС‚ ${me.name}`,
          pushText:
            `рџ’¬ *РќРѕРІРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ РїРѕ Р·Р°РґР°РЅРёСЋ*\n\n` +
            `рџ“Њ ${parties.title}\n` +
            `рџ‘¤ РћС‚: *${me.name}*\n\n` +
            `_${message.slice(0, 300)}${message.length > 300 ? 'вЂ¦' : ''}_\n\n` +
            `в†©пёЏ РћС‚РІРµС‚РёС‚СЊ: /reply\\_task ${taskId} <С‚РµРєСЃС‚>`,
          type: 'chat',
          icon: 'рџ’¬',
          linkType: 'task',
          linkId: taskId,
        });
      }

      return res.status(200).json({ ok: true, messageId: sent.messageId, createdAt: sent.createdAt });
    }

    if (action === 'unread_count') {
      const c = await getTotalUnreadChats(me.id);
      return res.status(200).json({ ok: true, count: c });
    }

    return res.status(400).json({ ok: false, error: 'РќРµРёР·РІРµСЃС‚РЅРѕРµ РґРµР№СЃС‚РІРёРµ' });
  } catch (e) {
    // SECURITY: Log auth failures
    if (e.message.includes('подпись') || e.message.includes('устарел')) {
      console.warn(`[SECURITY] Auth error in app-chat: ${e.message}`);
    } else {
      console.error('app-chat error:', e);
    }
    return res.status(401).json({ ok: false, error: e.message });
  }
};