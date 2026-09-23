// Детали метрик по клику
const crypto = require('crypto');
const { query } = require('../lib/db');

const verifyInitData = (initData) => {
  const botToken = process.env.BOT_TOKEN;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calcHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (calcHash !== hash) throw new Error('Неверная подпись');
  return JSON.parse(params.get('user'));
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const { initData, metric } = req.body;
    if (!initData) return res.status(400).json({ ok: false, error: 'initData обязателен' });

    const tgUser = verifyInitData(initData);
    const chatId = String(tgUser.id);

    const userRes = await query(
      `SELECT id, balance, reputation FROM "User" WHERE "telegramChatId" = $1`,
      [chatId]
    );
    if (userRes.rows.length === 0) return res.status(403).json({ ok: false, error: 'Аккаунт не привязан' });
    const user = userRes.rows[0];

    if (metric === 'balance') {
      const earn = await query(`SELECT COALESCE(SUM(amount),0)::int AS s FROM "Transaction" WHERE "userId"=$1 AND amount > 0`, [user.id]);
      const spent = await query(`SELECT COALESCE(SUM(amount),0)::int AS s FROM "Transaction" WHERE "userId"=$1 AND amount < 0`, [user.id]);
      const refE = await query(`SELECT COALESCE(SUM(amount),0)::int AS s FROM "ReferralEarning" WHERE "userId"=$1`, [user.id]);
      return res.status(200).json({
        ok: true,
        metric: 'balance',
        title: '💰 Баланс',
        rows: [
          { label: '💰 Сейчас', value: `${user.balance} ₽` },
          { label: '📥 Всего заработано', value: `${earn.rows[0].s} ₽` },
          { label: '📤 Всего потрачено', value: `${Math.abs(spent.rows[0].s)} ₽` },
          { label: '💸 Реферальные', value: `${refE.rows[0].s} ₽` },
        ],
      });
    }

    if (metric === 'reputation') {
      const votes = await query(`SELECT COUNT(*)::int AS c FROM "Vote" WHERE "voterId"=$1`, [user.id]);
      const rankRes = await query(`SELECT COUNT(*)::int + 1 AS pos FROM "User" WHERE reputation > $1`, [user.reputation]);
      return res.status(200).json({
        ok: true,
        metric: 'reputation',
        title: '⭐ Репутация',
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
        ok: true,
        metric: 'rank',
        title: '🏅 Топ-10',
        myRank: myRankRes.rows[0].pos,
        top: top.rows.map((u, i) => ({
          rank: i + 1,
          name: u.name,
          reputation: u.reputation,
          level: u.level || 1,
        })),
      });
    }

    if (metric === 'streak') {
      const streakRes = await query(
        `SELECT DATE("createdAt") AS d FROM "Transaction"
         WHERE "userId"=$1 AND "createdAt" >= NOW() - INTERVAL '7 days'
         GROUP BY DATE("createdAt")`,
        [user.id]
      );
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const key = date.toISOString().split('T')[0];
        days.push({
          date: key,
          active: streakRes.rows.some(r => String(r.d).startsWith(key)),
        });
      }
      const multiplier = user.balance >= 0 ? 1 : 1;
      return res.status(200).json({
        ok: true,
        metric: 'streak',
        title: '🔥 Streak',
        days,
        multiplier,
      });
    }

    if (metric === 'achievements') {
      const all = await query(
        `SELECT a.name, a.icon, a.description, a.reward, ua."unlockedAt"
         FROM "Achievement" a
         LEFT JOIN "UserAchievement" ua ON ua."achievementId" = a.id AND ua."userId" = $1
         ORDER BY ua."unlockedAt" DESC NULLS LAST`,
        [user.id]
      );
      return res.status(200).json({
        ok: true,
        metric: 'achievements',
        title: '🎖 Достижения',
        achievements: all.rows.map(a => ({
          name: a.name,
          icon: a.icon || '🏅',
          description: a.description,
          reward: a.reward,
          isUnlocked: a.unlockedAt !== null,
          unlockedAt: a.unlockedAt,
        })),
      });
    }

    return res.status(400).json({ ok: false, error: 'Неизвестная метрика' });
  } catch (e) {
    console.error('app-metric error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};