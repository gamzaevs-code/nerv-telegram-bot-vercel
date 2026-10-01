import { verifyTelegramWebApp } from '../lib/telegram-verify.js';
import {
  sendUserMessage,
  getUserMessageHistory,
  getUserConversations,
  getUnreadMessageCount,
  getUnreadCountFromUser,
  markMessagesAsRead,
} from '../lib/user-messages.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { initData, action, recipientId, limit = 50, text } = req.body;

    if (!initData) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Verify user
    let userData;
    try {
      userData = verifyTelegramWebApp(initData);
    } catch (e) {
      return res.status(401).json({ error: 'Invalid authorization' });
    }

    const userId = userData.user.id;

    // ═══ SEND MESSAGE ═══
    if (action === 'send') {
      if (!recipientId || !text) {
        return res.status(400).json({ error: 'Missing recipientId or text' });
      }

      const message = await sendUserMessage(userId, Number(recipientId), text);
      return res.status(200).json({
        ok: true,
        message: {
          id: message.id,
          text: message.text,
          createdAt: message.createdAt,
        },
      });
    }

    // ═══ GET HISTORY ═══
    if (action === 'history') {
      if (!recipientId) {
        return res.status(400).json({ error: 'Missing recipientId' });
      }

      const messages = await getUserMessageHistory(userId, Number(recipientId), limit);
      
      // Mark as read
      await markMessagesAsRead(userId, Number(recipientId));

      return res.status(200).json({
        ok: true,
        messages,
      });
    }

    // ═══ GET CONVERSATIONS LIST ═══
    if (action === 'conversations') {
      const conversations = await getUserConversations(userId, limit);
      return res.status(200).json({
        ok: true,
        conversations,
      });
    }

    // ═══ UNREAD COUNT (TOTAL) ═══
    if (action === 'unread_count') {
      const count = await getUnreadMessageCount(userId);
      return res.status(200).json({
        ok: true,
        count,
      });
    }

    // ═══ UNREAD COUNT FROM USER ═══
    if (action === 'unread_count_from_user') {
      if (!recipientId) {
        return res.status(400).json({ error: 'Missing recipientId' });
      }

      const count = await getUnreadCountFromUser(userId, Number(recipientId));
      return res.status(200).json({
        ok: true,
        count,
      });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error('app-messages error:', e);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
}
