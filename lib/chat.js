// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// Чат между игроком и создателем по заданию
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const { query } = require('./db');

// Получить участников задания (creator + player)
const getTaskParties = async (taskId) => {
  try {
    const r = await query(
      `SELECT t.id, t.title, t.status,
              t."creatorId", t."playerId",
              u1."telegramChatId" AS creator_chat,
              u2."telegramChatId" AS player_chat,
              COALESCE(u1."displayName", u1.name) AS creator_name,
              COALESCE(u2."displayName", u2.name) AS player_name
       FROM "Task" t
       JOIN "User" u1 ON u1.id = t."creatorId"
       LEFT JOIN "User" u2 ON u2.id = t."playerId"
       WHERE t.id = $1`,
      [taskId]
    );
    return r.rows[0] || null;
  } catch (e) {
    console.error('getTaskParties:', e);
    return null;
  }
};

// Проверить, что пользователь может писать в чат задания
const canChat = async (taskId, userId) => {
  const parties = await getTaskParties(taskId);
  if (!parties) return { ok: false, error: 'Задание не найдено' };
  if (parties.creatorId !== userId && parties.playerId !== userId) {
    return { ok: false, error: 'Ты не участник этого задания' };
  }
  if (!parties.playerId) {
    return { ok: false, error: 'У задания ещё нет игрока' };
  }
  return { ok: true, parties };
};

// Отправить сообщение
const sendChatMessage = async (taskId, fromUserId, message) => {
  try {
    const check = await canChat(taskId, fromUserId);
    if (!check.ok) return { ok: false, error: check.error };

    const { parties } = check;
    const toUserId = parties.creatorId === fromUserId ? parties.playerId : parties.creatorId;

    const r = await query(
      `INSERT INTO "TaskChat" ("taskId","fromUserId","toUserId",message,"createdAt")
       VALUES ($1,$2,$3,$4,NOW()) RETURNING id, "createdAt"`,
      [taskId, fromUserId, toUserId, message.trim().slice(0, 2000)]
    );

    return {
      ok: true,
      messageId: r.rows[0].id,
      toUserId,
      createdAt: r.rows[0].createdAt,
    };
  } catch (e) {
    console.error('sendChatMessage:', e);
    return { ok: false, error: 'Ошибка отправки' };
  }
};

// Получить историю чата по заданию
const getChatHistory = async (taskId, userId, limit = 50) => {
  try {
    const check = await canChat(taskId, userId);
    if (!check.ok) return { ok: false, error: check.error };

    const r = await query(
      `SELECT c.id, c."fromUserId", c.message, c."createdAt",
              COALESCE(u."displayName", u.name) AS from_name
       FROM "TaskChat" c
       JOIN "User" u ON u.id = c."fromUserId"
       WHERE c."taskId" = $1
       ORDER BY c."createdAt" ASC
       LIMIT $2`,
      [taskId, limit]
    );

    // Помечаем входящие как прочитанные
    await query(
      `UPDATE "TaskChat" SET "isRead" = true
       WHERE "taskId" = $1 AND "toUserId" = $2 AND "isRead" = false`,
      [taskId, userId]
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
    console.error('getChatHistory:', e);
    return { ok: false, error: 'Ошибка загрузки' };
  }
};

// Количество непрочитанных по заданию
const getUnreadCountByTask = async (taskId, userId) => {
  try {
    const r = await query(
      `SELECT COUNT(*)::int AS c FROM "TaskChat"
       WHERE "taskId" = $1 AND "toUserId" = $2 AND "isRead" = false`,
      [taskId, userId]
    );
    return r.rows[0].c;
  } catch (e) { console.error('getUnreadCountByTask:', e); return 0; }
};

// Общее количество непрочитанных чатов у юзера
const getTotalUnreadChats = async (userId) => {
  try {
    const r = await query(
      `SELECT COUNT(DISTINCT "taskId")::int AS c FROM "TaskChat"
       WHERE "toUserId" = $1 AND "isRead" = false`,
      [userId]
    );
    return r.rows[0].c;
  } catch (e) { console.error('getTotalUnreadChats:', e); return 0; }
};

module.exports = {
  getTaskParties,
  canChat,
  sendChatMessage,
  getChatHistory,
  getUnreadCountByTask,
  getTotalUnreadChats,
};