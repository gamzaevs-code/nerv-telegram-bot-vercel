// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// API: объединённый эндпоинт
// activity + notifications + reviews + online + favorites + metrics + user_profile + search + tasks_history
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const crypto = require('crypto');
const { query } = require('../lib/db');
const { ONLINE_THRESHOLD_MIN } = require('../lib/presence');
const {
  createReview,
  getPlayerReviews,
  getTopRated,
  canReview,
  getPendingReviews,
} = require('../lib/reviews');

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

const timeAgo = (date) => {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч`;
  const d = Math.floor(h / 24);
  return `${d} дн`;
};

const isOnline = (lastSeen) => {
  if (!lastSeen) return false;
  return (Date.now() - new Date(lastSeen).getTime()) / 60000 < ONLINE_THRESHOLD_MIN;
};

module.exports = async (req, res) => {
  // ⭐ GET: редирект на аватарку (для <img src="...">)
  if (req.method === 'GET' && req.query && req.query.action === 'avatar') {
    try {
      const userId = parseInt(req.query.userId, 10);
      if (!userId) return res.status(400).send('No userId');
      const r = await query(`SELECT avatar FROM "User" WHERE id = $1`, [userId]);
      const fileId = r.rows[0]?.avatar;
      if (!fileId) return res.status(404).send('No avatar');

      const token = process.env.BOT_TOKEN;
      const resp = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
      const j = await resp.json();
      if (!j.ok) return res.status(404).send('File not found');

      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.redirect(302, `https://api.telegram.org/file/bot${token}/${j.result.file_path}`);
    } catch (e) {
      console.error('avatar redirect:', e);
      return res.status(500).send('Error');
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const { initData, action } = req.body;
    if (!initData) return res.status(400).json({ ok: false, error: 'initData обязателен' });

    const tgUser = verifyInitData(initData);
    const chatId = String(tgUser.id);

    const meRes = await query(
      `SELECT id, balance, reputation, "displayName", name FROM "User" WHERE "telegramChatId" = $1`,
      [chatId]
    );
    if (meRes.rows.length === 0) return res.status(403).json({ ok: false, error: 'Аккаунт не привязан' });
    const user = meRes.rows[0];
    const myId = user.id;

    // ═══════════ ACTIVITY ═══════════
    if (!action || action === 'activity') {
      const feed = [];

      const tasks = await query(
        `SELECT t.id, t.title, t.reward, COALESCE(u."displayName", u.name) AS creator,
                t."createdAt"
         FROM "Task" t JOIN "User" u ON u.id = t."creatorId"
         WHERE t."createdAt" >= NOW() - INTERVAL '2 days'
         ORDER BY t."createdAt" DESC LIMIT 5`
      );
      tasks.rows.forEach(t => feed.push({
        icon: '📌', type: 'task',
        text: `Задание «${t.title}»`,
        meta: `${t.reward} ₽`,
        timeAgo: timeAgo(t.createdAt),
        createdAt: t.createdAt,
      }));

      const approved = await query(
        `SELECT t.title, t.reward, COALESCE(u."displayName", u.name) AS player, t."updatedAt"
         FROM "Task" t JOIN "User" u ON u.id = t."playerId"
         WHERE t.status='approved' AND t."updatedAt" >= NOW() - INTERVAL '2 days'
         ORDER BY t."updatedAt" DESC LIMIT 5`
      );
      approved.rows.forEach(t => feed.push({
        icon: '✅', type: 'approved',
        text: `${t.player} выполнил «${t.title}»`,
        meta: `+${t.reward} ₽`,
        timeAgo: timeAgo(t.updatedAt),
        createdAt: t.updatedAt,
      }));

      const ach = await query(
        `SELECT a.name, a.icon, COALESCE(u."displayName", u.name) AS uname, ua."unlockedAt"
         FROM "UserAchievement" ua
         JOIN "Achievement" a ON a.id = ua."achievementId"
         JOIN "User" u ON u.id = ua."userId"
         WHERE ua."unlockedAt" >= NOW() - INTERVAL '2 days'
         ORDER BY ua."unlockedAt" DESC LIMIT 3`
      );
      ach.rows.forEach(a => feed.push({
        icon: a.icon || '🎖', type: 'achievement',
        text: `${a.uname} открыл «${a.name}»`,
        meta: '',
        timeAgo: timeAgo(a.unlockedAt),
        createdAt: a.unlockedAt,
      }));

      feed.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return res.status(200).json({ ok: true, feed: feed.slice(0, 15) });
    }

    // ═══════════ NOTIFICATIONS ═══════════
    if (action === 'notifications') {
      const r = await query(
        `SELECT id, message, "isRead", "createdAt"
         FROM "Notification" WHERE "userId" = $1
         ORDER BY "createdAt" DESC LIMIT 30`,
        [myId]
      );
      const unreadRes = await query(
        `SELECT COUNT(*)::int AS c FROM "Notification"
         WHERE "userId"=$1 AND "isRead"=false`,
        [myId]
      );
      return res.status(200).json({
        ok: true,
        notifications: r.rows.map(n => ({
          id: n.id,
          message: n.message,
          isRead: n.isRead,
          timeAgo: timeAgo(n.createdAt),
        })),
        unreadCount: unreadRes.rows[0].c,
      });
    }

    if (action === 'mark_all_read') {
      await query(
        `UPDATE "Notification" SET "isRead"=true WHERE "userId"=$1 AND "isRead"=false`,
        [myId]
      );
      return res.status(200).json({ ok: true });
    }

    // ═══════════ REVIEWS ═══════════
    if (action === 'reviews_top') {
      const top = await getTopRated(10);
      return res.status(200).json({ ok: true, top });
    }

    if (action === 'reviews_player') {
      const playerId = parseInt(req.body.playerId, 10);
      if (!playerId) return res.status(400).json({ ok: false, error: 'playerId required' });
      const reviews = await getPlayerReviews(playerId, 20);
      return res.status(200).json({ ok: true, reviews });
    }

    if (action === 'reviews_pending') {
      const pending = await getPendingReviews(myId, 10);
      return res.status(200).json({ ok: true, pending });
    }

    if (action === 'reviews_can') {
      const taskId = parseInt(req.body.taskId, 10);
      if (!taskId) return res.status(400).json({ ok: false, error: 'taskId required' });
      const result = await canReview(taskId, myId);
      return res.status(200).json({ ok: true, ...result });
    }

    if (action === 'reviews_create') {
      const { taskId, playerId, rating, comment } = req.body;
      if (!taskId || !playerId || !rating) {
        return res.status(400).json({ ok: false, error: 'taskId, playerId, rating required' });
      }
      const result = await createReview({
        taskId: parseInt(taskId, 10),
        reviewerId: myId,
        playerId: parseInt(playerId, 10),
        rating: parseInt(rating, 10),
        comment: comment || null,
      });
      if (!result.ok) return res.status(400).json(result);
      return res.status(200).json({ ok: true, review: result.review });
    }

    // ═══════════ SEARCH USERS ═══════════
    if (action === 'search_users') {
      const q = String(req.body.query || '').trim();
      if (q.length < 2) {
        return res.status(400).json({ ok: false, error: 'Минимум 2 символа' });
      }
      const qLower = q.toLowerCase();

      const r = await query(
        `SELECT u.id, COALESCE(u."displayName", u.name) AS name,
                u.level, u.role, u."ratingAvg", u."ratingCount",
                u.reputation, pres."lastSeen",
                (SELECT COUNT(*)::int FROM "UserAchievement" WHERE "userId"=u.id) AS achievements
         FROM "User" u
         LEFT JOIN "UserPresence" pres ON pres."userId" = u.id
         WHERE u."isBanned" = false
           AND LOWER(COALESCE(u."displayName", u.name)) LIKE $1
         ORDER BY 
           CASE WHEN LOWER(COALESCE(u."displayName", u.name)) = $2 THEN 0 ELSE 1 END,
           u."ratingAvg" DESC NULLS LAST,
           u.reputation DESC
         LIMIT 10`,
        [`%${qLower}%`, qLower]
      );

      return res.status(200).json({
        ok: true,
        query: q,
        users: r.rows.map(u => ({
          id: u.id,
          name: u.name,
          level: u.level || 1,
          role: u.role,
          ratingAvg: Number(u.ratingAvg) || 0,
          ratingCount: u.ratingCount || 0,
          reputation: u.reputation,
          achievements: u.achievements,
          isOnline: isOnline(u.lastSeen),
          isMe: u.id === myId,
        })),
      });
    }

    // ═══════════ USER TASKS HISTORY ═══════════
    if (action === 'user_tasks') {
      const targetId = parseInt(req.body.targetId, 10) || myId;
      const tab = String(req.body.tab || 'player');

      // Проверка, что юзер существует
      const uRes = await query(`SELECT id FROM "User" WHERE id = $1 AND "isBanned" = false`, [targetId]);
      if (uRes.rows.length === 0) {
        return res.status(404).json({ ok: false, error: 'Юзер не найден' });
      }

      let tasks = [];

      if (tab === 'player') {
        const r = await query(
          `SELECT t.id, t.title, t.reward, t.status, t."updatedAt", t."createdAt",
                  COALESCE(u."displayName", u.name) AS creator_name
           FROM "Task" t
           JOIN "User" u ON u.id = t."creatorId"
           WHERE t."playerId" = $1
             AND t.status IN ('approved', 'rejected', 'voting', 'taken')
           ORDER BY t."updatedAt" DESC NULLS LAST
           LIMIT 30`,
          [targetId]
        );
        tasks = r.rows.map(t => ({
          id: t.id,
          title: t.title,
          reward: t.reward,
          status: t.status,
          otherName: t.creator_name,
          date: t.updatedAt || t.createdAt,
        }));
      } else {
        const r = await query(
          `SELECT t.id, t.title, t.reward, t.status, t."updatedAt", t."createdAt",
                  COALESCE(u."displayName", u.name) AS player_name
           FROM "Task" t
           LEFT JOIN "User" u ON u.id = t."playerId"
           WHERE t."creatorId" = $1
           ORDER BY t."createdAt" DESC
           LIMIT 30`,
          [targetId]
        );
        tasks = r.rows.map(t => ({
          id: t.id,
          title: t.title,
          reward: t.reward,
          status: t.status,
          otherName: t.player_name || null,
          date: t.createdAt,
        }));
      }

      // Сводка
      const statsRes = await query(
        `SELECT
           COUNT(*) FILTER (WHERE status='approved')::int AS approved,
           COUNT(*) FILTER (WHERE status='rejected')::int AS rejected,
           COALESCE(SUM(reward) FILTER (WHERE status='approved'), 0)::int AS total_earned
         FROM "Task" WHERE "playerId" = $1`,
        [targetId]
      );

      const stats = tab === 'player' ? {
        approved: statsRes.rows[0].approved,
        rejected: statsRes.rows[0].rejected,
        totalEarned: statsRes.rows[0].total_earned,
      } : null;

      return res.status(200).json({
        ok: true,
        targetId,
        tab,
        tasks,
        stats,
      });
    }

    // ═══════════ PUBLIC PROFILE ═══════════
    if (action === 'user_profile') {
      const targetId = parseInt(req.body.targetId, 10);
      if (!targetId) return res.status(400).json({ ok: false, error: 'targetId обязателен' });

      const r = await query(
        `SELECT u.id, u.name, COALESCE(u."displayName", u.name) AS display,
                u.balance, u.reputation, u.role, u.level, u.experience,
                u."loginStreak", u."isModerator", u."isBanned", u."roleChosen",
                u.avatar, u.bio, u."createdAt",
                u."ratingAvg", u."ratingCount",
                u."completedTasksCount",
                pres."lastSeen",
                (SELECT COUNT(*)::int FROM "UserAchievement" WHERE "userId"=u.id) AS achievements
         FROM "User" u
         LEFT JOIN "UserPresence" pres ON pres."userId" = u.id
         WHERE u.id = $1 AND u."isBanned" = false`,
        [targetId]
      );
      if (r.rows.length === 0) return res.status(404).json({ ok: false, error: 'Игрок не найден' });

      const u = r.rows[0];
      const display = u.display;
      const initials = display.split(' ').slice(0, 2)
        .map(w => w[0] ? w[0].toUpperCase() : '').join('');

      const reviewsRes = await query(
        `SELECT r.rating, r.comment, r."createdAt",
                COALESCE(ru."displayName", ru.name) AS reviewer_name,
                t.title AS task_title
         FROM "Review" r
         LEFT JOIN "User" ru ON ru.id = r."reviewerId"
         LEFT JOIN "Task" t ON t.id = r."taskId"
         WHERE r."playerId" = $1
         ORDER BY r."createdAt" DESC
         LIMIT 5`,
        [targetId]
      );

      const rankRes = await query(
        `SELECT COUNT(*)::int + 1 AS pos FROM "User" WHERE reputation > $1 AND "isBanned" = false`,
        [u.reputation]
      );

      const favRes = await query(
        `SELECT 1 FROM "FavoriteUser" WHERE "userId"=$1 AND "targetId"=$2 LIMIT 1`,
        [myId, targetId]
      );

      return res.status(200).json({
        ok: true,
        profile: {
          id: u.id,
          name: u.name,
          displayName: display,
          initials,
          avatar: u.avatar,
          bio: u.bio,
          balance: u.balance,
          reputation: u.reputation,
          role: u.role,
          roleChosen: u.roleChosen,
          level: u.level || 1,
          experience: u.experience || 0,
          loginStreak: u.loginStreak || 0,
          isModerator: u.isModerator,
          isOnline: isOnline(u.lastSeen),
          memberSince: u.createdAt,
          completedTasksCount: u.completedTasksCount || 0,
          achievements: u.achievements,
          ratingAvg: Number(u.ratingAvg) || 0,
          ratingCount: u.ratingCount || 0,
          rank: rankRes.rows[0].pos,
          isMe: u.id === myId,
          isFavorite: favRes.rows.length > 0,
          reviews: reviewsRes.rows.map(rv => ({
            rating: rv.rating,
            comment: rv.comment,
            createdAt: rv.createdAt,
            reviewerName: rv.reviewer_name || 'Аноним',
            taskTitle: rv.task_title || '—',
          })),
        },
      });
    }

    // ═══════════ ONLINE ═══════════
    if (action === 'online') {
      const onlineRes = await query(
        `SELECT u.id, COALESCE(u."displayName", u.name) AS name, u.level, u.role, pres."lastSeen"
         FROM "UserPresence" pres
         JOIN "User" u ON u.id = pres."userId"
         WHERE pres."lastSeen" >= NOW() - INTERVAL '${ONLINE_THRESHOLD_MIN} minutes'
           AND u."isBanned" = false AND u.id != $1
         ORDER BY pres."lastSeen" DESC LIMIT 30`,
        [myId]
      );
      return res.status(200).json({
        ok: true,
        online: onlineRes.rows.map(u => ({
          id: u.id, name: u.name, level: u.level || 1, role: u.role, lastSeen: u.lastSeen,
        })),
      });
    }

    // ═══════════ FAVORITES ═══════════
    if (action === 'favorites_toggle') {
      const targetId = parseInt(req.body.targetId, 10);
      if (!targetId || targetId === myId) return res.status(400).json({ ok: false, error: 'Неверно' });

      const ex = await query(`SELECT id FROM "FavoriteUser" WHERE "userId"=$1 AND "targetId"=$2`, [myId, targetId]);
      if (ex.rows.length > 0) {
        await query(`DELETE FROM "FavoriteUser" WHERE "userId"=$1 AND "targetId"=$2`, [myId, targetId]);
        return res.status(200).json({ ok: true, action: 'removed' });
      } else {
        const cnt = await query(`SELECT COUNT(*)::int AS c FROM "FavoriteUser" WHERE "userId"=$1`, [myId]);
        if (cnt.rows[0].c >= 20) return res.status(400).json({ ok: false, error: 'Максимум 20' });
        await query(`INSERT INTO "FavoriteUser" ("userId","targetId","createdAt") VALUES ($1,$2,NOW())`, [myId, targetId]);
        return res.status(200).json({ ok: true, action: 'added' });
      }
    }

    if (action === 'favorites') {
      const listRes = await query(
        `SELECT u.id, COALESCE(u."displayName", u.name) AS name, u.level, u.role, pres."lastSeen"
         FROM "FavoriteUser" f
         JOIN "User" u ON u.id = f."targetId"
         LEFT JOIN "UserPresence" pres ON pres."userId" = u.id
         WHERE f."userId" = $1 ORDER BY f."createdAt" DESC`,
        [myId]
      );
      return res.status(200).json({
        ok: true,
        favorites: listRes.rows.map(u => ({
          id: u.id, name: u.name, level: u.level || 1, role: u.role,
          isOnline: isOnline(u.lastSeen),
        })),
      });
    }

    // ═══════════ METRICS ═══════════
    const metric = req.body.metric;

    if (metric === 'balance') {
      const earn = await query(`SELECT COALESCE(SUM(amount),0)::int AS s FROM "Transaction" WHERE "userId"=$1 AND amount > 0`, [myId]);
      const spent = await query(`SELECT COALESCE(SUM(amount),0)::int AS s FROM "Transaction" WHERE "userId"=$1 AND amount < 0`, [myId]);
      const refE = await query(`SELECT COALESCE(SUM(amount),0)::int AS s FROM "ReferralEarning" WHERE "userId"=$1`, [myId]);
      return res.status(200).json({
        ok: true, metric: 'balance', title: '💰 Баланс',
        rows: [
          { label: '💰 Сейчас', value: `${user.balance} ₽` },
          { label: '📥 Всего заработано', value: `${earn.rows[0].s} ₽` },
          { label: '📤 Всего потрачено', value: `${Math.abs(spent.rows[0].s)} ₽` },
          { label: '💸 Реферальные', value: `${refE.rows[0].s} ₽` },
        ],
      });
    }

    if (metric === 'reputation') {
      const votes = await query(`SELECT COUNT(*)::int AS c FROM "Vote" WHERE "voterId"=$1`, [myId]);
      const rankRes = await query(`SELECT COUNT(*)::int + 1 AS pos FROM "User" WHERE reputation > $1`, [user.reputation]);
      return res.status(200).json({
        ok: true, metric: 'reputation', title: '⭐ Репутация',
        rows: [
          { label: '⭐ Сейчас', value: user.reputation },
          { label: '🗳 За голосования', value: votes.rows[0].c },
          { label: '🏅 Место в топе', value: `#${rankRes.rows[0].pos}` },
        ],
      });
    }

    if (metric === 'rank') {
      const top = await query(
        `SELECT COALESCE("displayName", name) AS name, reputation, level
         FROM "User" WHERE "isBanned"=false ORDER BY reputation DESC LIMIT 10`
      );
      const myRankRes = await query(`SELECT COUNT(*)::int + 1 AS pos FROM "User" WHERE reputation > $1`, [user.reputation]);
      return res.status(200).json({
        ok: true, metric: 'rank', title: '🏅 Топ-10',
        myRank: myRankRes.rows[0].pos,
        top: top.rows.map((u, i) => ({ rank: i + 1, name: u.name, reputation: u.reputation, level: u.level || 1 })),
      });
    }

    if (metric === 'streak') {
      const streakRes = await query(
        `SELECT DATE("createdAt") AS d FROM "Transaction"
         WHERE "userId"=$1 AND "createdAt" >= NOW() - INTERVAL '7 days' GROUP BY DATE("createdAt")`,
        [myId]
      );
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date(); date.setDate(date.getDate() - i);
        const key = date.toISOString().split('T')[0];
        days.push({ date: key, active: streakRes.rows.some(r => String(r.d).startsWith(key)) });
      }
      return res.status(200).json({ ok: true, metric: 'streak', title: '🔥 Streak', days });
    }

    if (metric === 'achievements') {
      const all = await query(
        `SELECT a.name, a.icon, a.description, a.reward, ua."unlockedAt"
         FROM "Achievement" a
         LEFT JOIN "UserAchievement" ua ON ua."achievementId" = a.id AND ua."userId" = $1
         ORDER BY ua."unlockedAt" DESC NULLS LAST`,
        [myId]
      );
      return res.status(200).json({
        ok: true, metric: 'achievements', title: '🎖 Достижения',
        achievements: all.rows.map(a => ({
          name: a.name, icon: a.icon || '🏅', description: a.description,
          reward: a.reward, isUnlocked: a.unlockedAt !== null, unlockedAt: a.unlockedAt,
        })),
      });
    }

    return res.status(400).json({ ok: false, error: 'Неизвестное действие' });
  } catch (e) {
    console.error('app-data error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};