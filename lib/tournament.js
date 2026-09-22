// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// ⚡ ЛОГИКА ЕЖЕДНЕВНЫХ ТУРНИРОВ (pg + CommonJS)
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const { query } = require('./db');

const TOURNAMENT_TYPES = ['most_completed', 'most_earned', 'most_active'];

const TYPE_LABELS = {
  most_completed: '✅ Больше всех выполнено',
  most_earned:    '💰 Больше всех заработано',
  most_active:    '⚡ Самый активный',
};

const PRIZE_TABLE = [150, 100, 50];
const PRIZE_POOL_PER_CATEGORY = 300;

const MIN_COMMISSION = 300;
const FULL_COMMISSION = 900;

// ────────────────────────────────────────
// Границы «дня по МСК» в UTC
// ────────────────────────────────────────
const getMskDayBounds = (now = new Date()) => {
  const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
  const msk = new Date(now.getTime() + MSK_OFFSET_MS);
  const mskMidnight = Date.UTC(
    msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate(), 0, 0, 0, 0
  );
  const startUtc = new Date(mskMidnight - MSK_OFFSET_MS);
  const endUtc = new Date(startUtc.getTime() + 24 * 3600e3);
  return { startUtc, endUtc };
};

// ────────────────────────────────────────
// Подсчёт очков по категории
// ────────────────────────────────────────
const computeScores = async (type, startUtc, endUtc) => {
  try {
    if (type === 'most_completed') {
      const r = await query(
        `SELECT "playerId" AS "userId", COUNT(*)::int AS score
           FROM "Task"
          WHERE status = 'approved'
            AND "playerId" IS NOT NULL
            AND "updatedAt" >= $1 AND "updatedAt" < $2
          GROUP BY "playerId"
          ORDER BY score DESC`,
        [startUtc, endUtc]
      );
      return r.rows.map(x => ({ userId: x.userId, score: x.score }));
    }

    if (type === 'most_earned') {
      const r = await query(
        `SELECT "playerId" AS "userId", COALESCE(SUM("netAmount"),0)::int AS score
           FROM "PlatformEarning"
          WHERE "createdAt" >= $1 AND "createdAt" < $2
          GROUP BY "playerId"
          ORDER BY score DESC`,
        [startUtc, endUtc]
      );
      return r.rows.map(x => ({ userId: x.userId, score: x.score }));
    }

    if (type === 'most_active') {
      const [votes, takes, creates] = await Promise.all([
        query(
          `SELECT "voterId" AS "userId", COUNT(*)::int AS score
             FROM "Vote"
            WHERE "createdAt" >= $1 AND "createdAt" < $2
            GROUP BY "voterId"`,
          [startUtc, endUtc]
        ),
        query(
          `SELECT "playerId" AS "userId", COUNT(*)::int AS score
             FROM "Task"
            WHERE "playerId" IS NOT NULL
              AND "updatedAt" >= $1 AND "updatedAt" < $2
            GROUP BY "playerId"`,
          [startUtc, endUtc]
        ),
        query(
          `SELECT "creatorId" AS "userId", COUNT(*)::int AS score
             FROM "Task"
            WHERE "createdAt" >= $1 AND "createdAt" < $2
            GROUP BY "creatorId"`,
          [startUtc, endUtc]
        ),
      ]);

      const acc = new Map();
      const add = (uid, n) => {
        if (uid == null) return;
        acc.set(uid, (acc.get(uid) || 0) + n);
      };
      votes.rows.forEach(v => add(v.userId, v.score));
      takes.rows.forEach(t => add(t.userId, t.score));
      creates.rows.forEach(c => add(c.userId, c.score));

      return [...acc.entries()]
        .map(([userId, score]) => ({ userId, score }))
        .sort((a, b) => b.score - a.score);
    }

    return [];
  } catch (e) {
    console.error('computeScores:', e);
    return [];
  }
};

// ────────────────────────────────────────
// Расчёт фонда
// ────────────────────────────────────────
const calcPrizePool = (commission) => {
  const c = Number(commission) || 0;
  if (c < MIN_COMMISSION) return { perCategory: 0, run: false };
  if (c >= FULL_COMMISSION) return { perCategory: PRIZE_POOL_PER_CATEGORY, run: true };
  const perCategory = Math.floor(PRIZE_POOL_PER_CATEGORY * (c / FULL_COMMISSION));
  return { perCategory, run: true };
};

const splitPrizes = (perCategory) => {
  const total = PRIZE_TABLE.reduce((a, b) => a + b, 0);
  return PRIZE_TABLE.map(p => Math.floor((perCategory * p) / total));
};

// ────────────────────────────────────────
// ГЛАВНАЯ ФУНКЦИЯ — подведение итогов
// ────────────────────────────────────────
const checkAndAwardTournament = async (now = new Date()) => {
  const { startUtc, endUtc } = getMskDayBounds(now);
  const log = { processed: [], skipped: false, prizePaid: 0, commission: 0 };

  try {
    const cr = await query(
      `SELECT COALESCE(SUM(commission),0)::int AS total
         FROM "PlatformEarning"
        WHERE "createdAt" >= $1 AND "createdAt" < $2`,
      [startUtc, endUtc]
    );
    const commission = cr.rows[0] ? cr.rows[0].total : 0;
    log.commission = commission;

    const { perCategory, run } = calcPrizePool(commission);
    if (!run) {
      log.skipped = true;
      log.reason = `commission ${commission}₽ < ${MIN_COMMISSION}₽`;
      return log;
    }

    const prizes = splitPrizes(perCategory);

    for (const type of TOURNAMENT_TYPES) {
      const scores = await computeScores(type, startUtc, endUtc);
      const top3 = scores.slice(0, 3).filter(s => s.score > 0);

      const tRes = await query(
        `INSERT INTO "Tournament"
           (name, description, "startDate", "endDate", "prizePool", status, type, "endedAt")
         VALUES ($1, $2, $3, $4, $5, 'finished', $6, $7)
         RETURNING id`,
        [
          TYPE_LABELS[type],
          `Ежедневный турнир: ${TYPE_LABELS[type]}`,
          startUtc,
          endUtc,
          perCategory,
          type,
          endUtc,
        ]
      );
      const tournamentId = tRes.rows[0].id;

      const winners = [];

      for (let i = 0; i < top3.length; i++) {
        const { userId, score } = top3[i];
        const rank = i + 1;
        const prize = prizes[i] || 0;

        await query(
          `INSERT INTO "TournamentParticipant" ("tournamentId", "userId", score, rank)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT ("tournamentId", "userId")
           DO UPDATE SET score = EXCLUDED.score, rank = EXCLUDED.rank`,
          [tournamentId, userId, score, rank]
        );

        if (prize > 0) {
          await query(
            `UPDATE "User" SET balance = COALESCE(balance,0) + $1 WHERE id = $2`,
            [prize, userId]
          );

          await query(
            `INSERT INTO "Transaction" ("userId", type, amount, status, reason, "createdAt")
             VALUES ($1, 'tournament_prize', $2, 'completed', $3, NOW())`,
            [userId, prize, `${type}:rank${rank}:score${score}`]
          );

          log.prizePaid += prize;
        }

        winners.push({ userId, rank, score, prize });
      }

      await query(
        `UPDATE "Tournament" SET winners = $1::jsonb WHERE id = $2`,
        [JSON.stringify(winners), tournamentId]
      );

      log.processed.push({ type, tournamentId, winners });
    }

    return log;
  } catch (e) {
    console.error('checkAndAwardTournament:', e);
    log.error = e.message;
    return log;
  }
};

// ────────────────────────────────────────
// Рендер карточки турнира (Markdown!)
// ────────────────────────────────────────
const renderTournamentCard = async () => {
  try {
    const { startUtc, endUtc } = getMskDayBounds();

    const parts = [];
    parts.push('🏆 *ЕЖЕДНЕВНЫЙ ТУРНИР*');
    parts.push('▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬');
    parts.push('🔥 Фонд: до *900 ₽/день* (по 300 ₽ на категорию)');
    parts.push('🥇 150 ₽   🥈 100 ₽   🥉 50 ₽');
    parts.push('');

    const medals = ['🥇', '🥈', '🥉'];

    for (const type of TOURNAMENT_TYPES) {
      const scores = await computeScores(type, startUtc, endUtc);
      const top3 = scores.slice(0, 3).filter(s => s.score > 0);

      parts.push(`*${TYPE_LABELS[type]}*`);
      if (top3.length === 0) {
        parts.push('   _ещё нет участников_');
      } else {
        const ids = top3.map(x => x.userId);
        const namesRes = await query(
          `SELECT id, COALESCE("displayName", name) AS name FROM "User" WHERE id = ANY($1)`,
          [ids]
        );
        const namesMap = {};
        namesRes.rows.forEach(r => { namesMap[r.id] = r.name; });

        top3.forEach((t, i) => {
          const name = namesMap[t.userId] || `user#${t.userId}`;
          parts.push(`   ${medals[i]} ${name} — *${t.score}*`);
        });
      }
      parts.push('');
    }

    parts.push('⏰ Итоги в *00:00 МСК*');
    parts.push('▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬');

    return {
      text: parts.join('\n'),
      reply_markup: {
        inline_keyboard: [
          [{ text: '📋 Как заработать очки', callback_data: 'tournament_help' }],
          [{ text: '🔄 Обновить', callback_data: 'menu_tournament' }],
          [{ text: '⬅️ В меню', callback_data: 'menu' }],
        ],
      },
    };
  } catch (e) {
    console.error('renderTournamentCard:', e);
    return {
      text: '🏆 *ТУРНИР*\n\n⚠️ Не удалось загрузить данные.',
      reply_markup: { inline_keyboard: [[{ text: '⬅️ В меню', callback_data: 'menu' }]] },
    };
  }
};

// ────────────────────────────────────────
// Помощь по турниру
// ────────────────────────────────────────
const getTournamentHelp = () => {
  return {
    text:
      '📋 *Как заработать очки*\n' +
      '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n' +
      '*✅ Больше всех выполнено*\n' +
      '   За каждое одобренное задание +1 очко\n\n' +
      '*💰 Больше всех заработано*\n' +
      '   Сумма чистой выплаты за день (после 11%)\n\n' +
      '*⚡ Самый активный*\n' +
      '   Голоса + взятые задания + созданные задания\n\n' +
      '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n' +
      '🕐 Итоги каждый день в *00:00 МСК*\n' +
      '🎁 Призы: 🥇 150 ₽ · 🥈 100 ₽ · 🥉 50 ₽\n' +
      '_(в каждой категории)_',
    reply_markup: {
      inline_keyboard: [[{ text: '⬅️ К турниру', callback_data: 'menu_tournament' }]],
    },
  };
};

module.exports = {
  TOURNAMENT_TYPES,
  TYPE_LABELS,
  getMskDayBounds,
  computeScores,
  calcPrizePool,
  checkAndAwardTournament,
  renderTournamentCard,
  getTournamentHelp,
};