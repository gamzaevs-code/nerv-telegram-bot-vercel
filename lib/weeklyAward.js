// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// lib/weeklyAward.js — «Игрок недели»
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const { query } = require('./db');
const { notifyUser } = require('./notify');

const BONUS = 100;

const getWeekRange = () => {
  const now = new Date();
  const day = now.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMon);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { monday, sunday };
};

const pickWinner = async () => {
  const { monday, sunday } = getWeekRange();

  const r = await query(
    `SELECT u.id, COALESCE(u."displayName", u.name) AS name,
            COUNT(*)::int AS cnt
     FROM "Task" t
     JOIN "User" u ON u.id = t."playerId"
     WHERE t.status = 'approved'
       AND t."updatedAt" >= $1
       AND t."updatedAt" <= $2
       AND u."isBanned" = false
     GROUP BY u.id, u."displayName", u.name
     ORDER BY cnt DESC, u.reputation DESC
     LIMIT 1`,
    [monday.toISOString(), sunday.toISOString()]
  );

  return r.rows[0] || null;
};

const awardWeeklyPlayer = async () => {
  try {
    const { monday, sunday } = getWeekRange();
    const weekStart = monday.toISOString().split('T')[0];

    const exist = await query(
      `SELECT id FROM "WeeklyAward" WHERE "weekStart" = $1`,
      [weekStart]
    );
    if (exist.rows.length > 0) {
      console.log('WeeklyAward: уже начислено за', weekStart);
      return { ok: true, skipped: true, reason: 'already_awarded' };
    }

    const winner = await pickWinner();
    if (!winner || winner.cnt === 0) {
      console.log('WeeklyAward: нет игроков с выполненными заданиями');
      await query(
        `INSERT INTO "WeeklyAward" ("userId","weekStart","weekEnd","tasksCount",bonus)
         VALUES ($1,$2,$2,0,0) ON CONFLICT ("weekStart") DO NOTHING`,
        [1, weekStart]
      );
      return { ok: true, noWinner: true };
    }

    const weekEnd = sunday.toISOString().split('T')[0];

    await query(
      `INSERT INTO "WeeklyAward" ("userId","weekStart","weekEnd","tasksCount",bonus)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT ("weekStart") DO NOTHING`,
      [winner.id, weekStart, weekEnd, winner.cnt, BONUS]
    );

    await query(`UPDATE "User" SET balance = balance + $1 WHERE id = $2`, [BONUS, winner.id]);
    await query(
      `INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt")
       VALUES ($1,'weekly_award',$2,'completed',$3,NOW())`,
      [winner.id, BONUS, `Игрок недели (${weekStart} — ${weekEnd})`]
    );

    await notifyUser(winner.id, {
      message: `🏆 Ты игрок недели! Бонус +${BONUS} ₽`,
      pushText:
        `🏆 *ИГРОК НЕДЕЛИ!*\n\n` +
        `Ты выполнил больше всех заданий за неделю — *${winner.cnt}*!\n\n` +
        `💰 Бонус: *+${BONUS} ₽*\n\n` +
        `_Так держать!_`,
      type: 'system',
      icon: '🏆',
      linkType: 'profile',
      force: true,
    });

    const others = await query(
      `SELECT id FROM "User" 
       WHERE "isBanned" = false 
         AND "telegramChatId" IS NOT NULL 
         AND id != $1`,
      [winner.id]
    );

    for (const u of others.rows) {
      try {
        await notifyUser(u.id, {
          message: `🏅 Игрок недели — @${winner.name} (${winner.cnt} заданий)`,
          pushText:
            `🏅 *Игрок недели*\n\n` +
            `Победитель: *@${winner.name}*\n` +
            `Выполнено заданий: *${winner.cnt}*\n` +
            `💰 Бонус: *+${BONUS} ₽*\n\n` +
            `_Может, следующая неделя твоя?_`,
          type: 'system',
          icon: '🏅',
          force: true,
        });
      } catch (e) { /* silent */ }
    }

    console.log(`WeeklyAward: победил @${winner.name} (id=${winner.id}) с ${winner.cnt} задачами`);
    return { ok: true, winner, bonus: BONUS };
  } catch (e) {
    console.error('awardWeeklyPlayer:', e);
    return { ok: false, error: e.message };
  }
};

const getWeeklyHistory = async (limit = 5) => {
  const r = await query(
    `SELECT w."weekStart", w."weekEnd", w."tasksCount", w.bonus,
            COALESCE(u."displayName", u.name) AS name
     FROM "WeeklyAward" w
     JOIN "User" u ON u.id = w."userId"
     WHERE w."tasksCount" > 0
     ORDER BY w."weekStart" DESC
     LIMIT $1`,
    [limit]
  );
  return r.rows;
};

module.exports = {
  awardWeeklyPlayer,
  getWeeklyHistory,
  pickWinner,
  getWeekRange,
};