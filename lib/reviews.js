// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// lib/reviews.js — отзывы и рейтинг игроков
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const { query } = require('./db');
const { sendMessage } = require('./telegram');

// ─── Создать отзыв ──────────────────────────────────────────
const createReview = async ({ taskId, reviewerId, playerId, rating, comment }) => {
  if (!rating || rating < 1 || rating > 5) {
    return { ok: false, error: 'Оценка должна быть от 1 до 5' };
  }
  if (reviewerId === playerId) {
    return { ok: false, error: 'Нельзя оценивать самого себя' };
  }

  const t = await query(
    `SELECT id, status, "creatorId", "playerId", title
     FROM "Task" WHERE id = $1`,
    [taskId]
  );
  if (t.rows.length === 0) return { ok: false, error: 'Задание не найдено' };
  const task = t.rows[0];

  if (task.creatorId !== reviewerId) return { ok: false, error: 'Только создатель может оставить отзыв' };
  if (task.playerId !== playerId) return { ok: false, error: 'Игрок не совпадает' };
  if (task.status !== 'approved') return { ok: false, error: 'Задание ещё не одобрено' };

  const ex = await query(
    `SELECT id FROM "Review" WHERE "taskId" = $1 AND "reviewerId" = $2`,
    [taskId, reviewerId]
  );
  if (ex.rows.length > 0) return { ok: false, error: 'Вы уже оставили отзыв' };

  const ins = await query(
    `INSERT INTO "Review" ("taskId","reviewerId","playerId",rating,comment,"createdAt")
     VALUES ($1,$2,$3,$4,$5,NOW())
     RETURNING id, rating, comment, "createdAt"`,
    [taskId, reviewerId, playerId, rating, comment || null]
  );

  // Уведомление игроку
  try {
    const pr = await query(
      `SELECT "telegramChatId" FROM "User" WHERE id = $1`,
      [playerId]
    );
    const chatId = pr.rows[0]?.telegramChatId;
    if (chatId) {
      const stars = '⭐'.repeat(rating);
      const msg =
        `⭐ *Новый отзыв!*\n\n` +
        `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
        `📋 *${task.title}*\n` +
        `Оценка: ${stars} (${rating}/5)\n` +
        (comment ? `💬 _${comment.slice(0, 200)}_\n` : '') +
        `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
        `Твой рейтинг обновлён ⚡`;
      await sendMessage(chatId, msg, 'Markdown');
    }
  } catch (e) { console.error('notify review:', e); }

  return { ok: true, review: ins.rows[0] };
};

// ─── Отзывы игрока ──────────────────────────────────────────
const getPlayerReviews = async (playerId, limit = 20, offset = 0) => {
  const r = await query(
    `SELECT r.id, r.rating, r.comment, r."createdAt",
            COALESCE(u."displayName", u.name) AS reviewer_name,
            u."telegramChatId" AS reviewer_chat,
            t.title AS task_title
     FROM "Review" r
     LEFT JOIN "User" u ON u.id = r."reviewerId"
     LEFT JOIN "Task" t ON t.id = r."taskId"
     WHERE r."playerId" = $1
     ORDER BY r."createdAt" DESC
     LIMIT $2 OFFSET $3`,
    [playerId, limit, offset]
  );
  return r.rows;
};

// ─── Топ-10 по рейтингу ─────────────────────────────────────
const getTopRated = async (limit = 10) => {
  const r = await query(
    `SELECT id, COALESCE("displayName", name) AS name,
            "ratingAvg", "ratingCount", level, reputation
     FROM "User"
     WHERE "ratingCount" >= 3 AND "isBanned" = false
     ORDER BY "ratingAvg" DESC, "ratingCount" DESC
     LIMIT $1`,
    [limit]
  );
  return r.rows;
};

// ─── Может ли юзер оставить отзыв ───────────────────────────
const canReview = async (taskId, reviewerId) => {
  const t = await query(
    `SELECT t.id, t.status, t."creatorId", t."playerId", t.title,
            (SELECT id FROM "Review" WHERE "taskId" = t.id AND "reviewerId" = $2) AS existing_review
     FROM "Task" t WHERE t.id = $1`,
    [taskId, reviewerId]
  );
  if (t.rows.length === 0) return { can: false, reason: 'not_found' };
  const task = t.rows[0];
  if (task.creatorId !== reviewerId) return { can: false, reason: 'not_creator', task };
  if (task.status !== 'approved') return { can: false, reason: 'not_approved', task };
  if (!task.playerId) return { can: false, reason: 'no_player', task };
  if (task.existing_review) return { can: false, reason: 'already_reviewed', task };
  return { can: true, task };
};

// ─── Задания, ожидающие отзыва ──────────────────────────────
const getPendingReviews = async (reviewerId, limit = 10) => {
  const r = await query(
    `SELECT t.id, t.title, t.reward, t."playerId", t."updatedAt",
            COALESCE(u."displayName", u.name) AS player_name,
            u."telegramChatId" AS player_chat
     FROM "Task" t
     LEFT JOIN "User" u ON u.id = t."playerId"
     WHERE t."creatorId" = $1
       AND t.status = 'approved'
       AND t."playerId" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM "Review" r WHERE r."taskId" = t.id AND r."reviewerId" = $1
       )
     ORDER BY t."updatedAt" DESC
     LIMIT $2`,
    [reviewerId, limit]
  );
  return r.rows;
};

module.exports = {
  createReview,
  getPlayerReviews,
  getTopRated,
  canReview,
  getPendingReviews,
};