// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// API: объединённый эндпоинт (online + favorites + metric)
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const crypto = require('crypto');
const { query } = require('../lib/db');
const { ONLINE_THRESHOLD_MIN } = require('../lib/presence');

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
    const { initData, action } = req.body;
    if (!initData) return res.status(400).json({ ok: false, error: 'initData обязателен' });

    const tgUser = verifyInitData(initData);
    const chatId = String(tgUser.id);

    const meRes = await query(`SELECT id, balance, reputation FROM "User" WHERE "telegramChatId" = $1`, [chatId]);
    if (meRes.rows.length === 0) return res.status(403).json({ ok: false, error: 'Аккаунт не привязан' });
    const user = meRes.rows[0];
    const myId = user.id;

    // ========== ONLINE ==========
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

    // ========== FAVORITES ==========
    if (action === 'favorites_toggle') {
      const targetId = parseInt(req.body.targetId);
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
          isOnline: u.lastSeen ? (Date.now() - new Date(u.lastSeen).getTime()) / 60000 < ONLINE_THRESHOLD_MIN : false,
        })),
      });
    }

    // ========== METRIC ==========
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