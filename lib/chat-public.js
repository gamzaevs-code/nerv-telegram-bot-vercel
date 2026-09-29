// ═════════════════════════════════════════════════════════════════
// PUBLIC CHAT: Visible to all task participants
// Separate timeline from private chats
// ═════════════════════════════════════════════════════════════════

const { query } = require('./db');
const { canChat } = require('./chat');

/**
 * Send public message (visible to all task participants)
 */
const sendPublicChatMessage = async (taskId, fromUserId, message) => {
  try {
    const check = await canChat(taskId, fromUserId);
    if (!check.ok) return { ok: false, error: check.error };

    const r = await query(
      `INSERT INTO "TaskChatPublic" ("taskId","fromUserId","message","createdAt")
       VALUES ($1,$2,$3,NOW()) RETURNING id, "createdAt"`,
      [taskId, fromUserId, message.trim().slice(0, 2000)]
    );

    return {
      ok: true,
      messageId: r.rows[0].id,
      createdAt: r.rows[0].createdAt,
    };
  } catch (e) {
    console.error('sendPublicChatMessage:', e);
    return { ok: false, error: 'Ошибка отправки в общий чат' };
  }
};

/**
 * Get public chat history (visible to all participants)
 */
const getPublicChatHistory = async (taskId, userId, limit = 50) => {
  try {
    const check = await canChat(taskId, userId);
    if (!check.ok) return { ok: false, error: check.error };

    const r = await query(
      `SELECT c.id, c."fromUserId", c.message, c."createdAt",
              COALESCE(u."displayName", u.name) AS from_name
       FROM "TaskChatPublic" c
       JOIN "User" u ON u.id = c."fromUserId"
       WHERE c."taskId" = $1
       ORDER BY c."createdAt" ASC
       LIMIT $2`,
      [taskId, limit]
    );

    // Mark as read
    await query(
      `UPDATE "TaskChatPublic" SET "isRead" = true
       WHERE "taskId" = $1 AND "isRead" = false`,
      [taskId]
    );

    return {
      ok: true,
      messages: r.rows.map(m => ({
        id: m.id,
        fromUserId: m.fromUserId,
        fromName: m.from_name,
        message: m.message,
        isMine: m.fromUserId === userId,
        createdAt: m.createdAt,
      })),
    };
  } catch (e) {
    console.error('getPublicChatHistory:', e);
    return { ok: false, error: 'Ошибка загрузки публичного чата' };
  }
};

/**
 * Get unread count in public chat
 */
const getUnreadPublicCountByTask = async (taskId) => {
  try {
    const r = await query(
      `SELECT COUNT(*)::int AS c FROM "TaskChatPublic"
       WHERE "taskId" = $1 AND "isRead" = false`,
      [taskId]
    );
    return r.rows[0].c;
  } catch (e) {
    console.error('getUnreadPublicCountByTask:', e);
    return 0;
  }
};

/**
 * Get total unread public chats for user (across all tasks)
 */
const getTotalUnreadPublicChats = async (userId) => {
  try {
    const r = await query(
      `SELECT COUNT(DISTINCT "taskId")::int AS c FROM "TaskChatPublic" tpc
       WHERE tpc."taskId" IN (
         SELECT t.id FROM "Task" t
         WHERE t."creatorId" = $1 OR t."playerId" = $1
       ) AND tpc."isRead" = false`,
      [userId]
    );
    return r.rows[0].c;
  } catch (e) {
    console.error('getTotalUnreadPublicChats:', e);
    return 0;
  }
};

module.exports = {
  sendPublicChatMessage,
  getPublicChatHistory,
  getUnreadPublicCountByTask,
  getTotalUnreadPublicChats,
};
