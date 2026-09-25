// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// lib/stats.js — расширенная статистика для админа
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const { query } = require('./db');

const PERIODS = {
  day:   { label: 'день',   interval: "NOW() - INTERVAL '1 day'" },
  week:  { label: 'неделю', interval: "NOW() - INTERVAL '7 days'" },
  month: { label: 'месяц',  interval: "NOW() - INTERVAL '30 days'" },
  all:   { label: 'всё время', interval: null },
};

const fmt = (n) => Number(n || 0).toLocaleString('ru');

const buildWhere = (period, col = '"createdAt"') => {
  const p = PERIODS[period] || PERIODS.week;
  return p.interval ? `AND ${col} >= ${p.interval}` : '';
};

/**
 * Собрать сводку
 */
const getStats = async (period = 'week') => {
  const wP = buildWhere(period, 'p."createdAt"');        // Payment
  const wT = buildWhere(period, 't."createdAt"');        // Task
  const wTr = buildWhere(period, 'tr."createdAt"');      // Transaction
  const wU = buildWhere(period, 'u."createdAt"');        // User
  const wV = buildWhere(period, 'v."createdAt"');        // Vote

  // ── Доход платформы ──
  const income = await query(
    `SELECT
       COALESCE(SUM("commission"),0)::int AS commission,
       COALESCE(SUM("grossAmount"),0)::int AS gross,
       COUNT(*)::int AS deals
     FROM "PlatformEarning" pe
     WHERE 1=1 ${buildWhere(period, 'pe."createdAt"')}`
  );
  const inc = income.rows[0];

  // ── Пополнения ЮKassa ──
  const deposits = await query(
    `SELECT COALESCE(SUM(amount),0)::int AS sum, COUNT(*)::int AS cnt
     FROM "Payment" p
     WHERE p.status = 'succeeded' ${wP}`
  );

  // ── Задания ──
  const tasks = await query(
    `SELECT
       COUNT(*) FILTER (WHERE status='open')::int AS open,
       COUNT(*) FILTER (WHERE status='taken')::int AS taken,
       COUNT(*) FILTER (WHERE status='voting')::int AS voting,
       COUNT(*) FILTER (WHERE status='approved')::int AS approved,
       COUNT(*) FILTER (WHERE status='rejected')::int AS rejected,
       COUNT(*)::int AS total
     FROM "Task" t WHERE 1=1 ${wT}`
  );
  const tk = tasks.rows[0];

  // ── Юзеры ──
  const users = await query(
    `SELECT
       COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '1 day')::int AS today,
       COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '7 days')::int AS week,
       COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '30 days')::int AS month,
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE role='player')::int AS players,
       COUNT(*) FILTER (WHERE role='viewer')::int AS viewers
     FROM "User" u WHERE "isBanned" = false`
  );
  const us = users.rows[0];

  // ── Голосования ──
  const votes = await query(
    `SELECT COUNT(*)::int AS c FROM "Vote" v WHERE 1=1 ${wV}`
  );

  // ── Топ-5 игроков по заработку ──
  const topPlayers = await query(
    `SELECT COALESCE(u."displayName", u.name) AS name,
            COALESCE(SUM(tr.amount),0)::int AS earned
     FROM "Transaction" tr
     JOIN "User" u ON u.id = tr."userId"
     WHERE tr.type = 'reward' AND tr.amount > 0 ${wTr}
     GROUP BY u.id, u."displayName", u.name
     ORDER BY earned DESC
     LIMIT 5`
  );

  // ── Топ-5 создателей по потраченному ──
  const topCreators = await query(
    `SELECT COALESCE(u."displayName", u.name) AS name,
            COALESCE(SUM(ABS(tr.amount)),0)::int AS spent
     FROM "Transaction" tr
     JOIN "User" u ON u.id = tr."userId"
     WHERE tr.type = 'task_create' AND tr.amount < 0 ${wTr}
     GROUP BY u.id, u."displayName", u.name
     ORDER BY spent DESC
     LIMIT 5`
  );

  // ── Топ-5 заданий по обороту ──
  const topTasks = await query(
    `SELECT t.title, t.reward, COALESCE(u."displayName", u.name) AS creator
     FROM "Task" t
     JOIN "User" u ON u.id = t."creatorId"
     WHERE t.status = 'approved' ${wT}
     ORDER BY t.reward DESC
     LIMIT 5`
  );

  // ── Спарклайн: активность за 7 дней (транзакции) ──
  const spark = await query(
    `SELECT DATE("createdAt") AS d, COUNT(*)::int AS c
     FROM "Transaction"
     WHERE "createdAt" >= NOW() - INTERVAL '7 days'
     GROUP BY DATE("createdAt")
     ORDER BY d ASC`
  );
  const sparkData = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(); date.setDate(date.getDate() - i);
    const key = date.toISOString().split('T')[0];
    const found = spark.rows.find(r => String(r.d).startsWith(key));
    sparkData.push(found ? found.c : 0);
  }
  const sparkMax = Math.max(...sparkData, 1);

  // ── Средний чек ──
  const avgCheck = tk.approved > 0
    ? Math.round(inc.gross / tk.approved)
    : 0;

  // ── Конверсия ──
  const conversion = tk.total > 0
    ? Math.round((tk.approved / tk.total) * 100)
    : 0;

  return {
    period,
    periodLabel: PERIODS[period]?.label || period,
    income: inc,
    deposits: deposits.rows[0],
    tasks: tk,
    users: us,
    votes: votes.rows[0].c,
    topPlayers: topPlayers.rows,
    topCreators: topCreators.rows,
    topTasks: topTasks.rows,
    sparkline: { data: sparkData, max: sparkMax },
    avgCheck,
    conversion,
  };
};

/**
 * Собрать текст для сообщения
 */
const renderStats = (s) => {
  const bar = s.sparkline.data.map(v => {
    if (v === 0) return '▁';
    const pct = v / s.sparkline.max;
    if (pct < 0.2) return '▂';
    if (pct < 0.4) return '▃';
    if (pct < 0.6) return '▄';
    if (pct < 0.8) return '▅';
    if (pct < 1)   return '▆';
    return '█';
  }).join('');

  const periodLabel = s.periodLabel.toUpperCase();

  let text = `📊 *СТАТИСТИКА NERV*\n`;
  text += `_Период: ${periodLabel}_\n`;
  text += `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n`;

  // 💰 Доход
  text += `💰 *Доход платформы:*\n`;
  text += `   • Комиссия: *${fmt(s.income.commission)} ₽*\n`;
  text += `   • Оборот сделок: *${fmt(s.income.gross)} ₽*\n`;
  text += `   • Сделок: *${fmt(s.income.deals)}*\n`;
  text += `   • Средний чек: *${fmt(s.avgCheck)} ₽*\n\n`;

  // 💳 Пополнения
  text += `💳 *Пополнения (ЮKassa):*\n`;
  text += `   • Сумма: *${fmt(s.deposits.sum)} ₽*\n`;
  text += `   • Транзакций: *${fmt(s.deposits.cnt)}*\n\n`;

  // 📋 Задания
  text += `📋 *Задания:*\n`;
  text += `   • Всего: *${fmt(s.tasks.total)}*\n`;
  text += `   • ✅ Выполнено: *${fmt(s.tasks.approved)}*\n`;
  text += `   • ❌ Отклонено: *${fmt(s.tasks.rejected)}*\n`;
  text += `   • 🟢 Открыто: *${fmt(s.tasks.open)}*\n`;
  text += `   • 🟡 Взято: *${fmt(s.tasks.taken)}*\n`;
  text += `   • 🗳 Голосование: *${fmt(s.tasks.voting)}*\n`;
  text += `   • 🎯 Конверсия: *${s.conversion}%*\n\n`;

  // 👥 Юзеры
  text += `👥 *Пользователи:*\n`;
  text += `   • Всего: *${fmt(s.users.total)}*\n`;
  text += `   • 🎮 Игроки: *${fmt(s.users.players)}*\n`;
  text += `   • 👁 Зрители: *${fmt(s.users.viewers)}*\n`;
  text += `   • 🆕 За сутки: *${fmt(s.users.today)}*\n`;
  text += `   • 🆕 За неделю: *${fmt(s.users.week)}*\n`;
  text += `   • 🆕 За месяц: *${fmt(s.users.month)}*\n\n`;

  // 🗳 Голоса
  text += `🗳 *Голосований:* ${fmt(s.votes)}\n\n`;

  // 📈 Спарклайн
  text += `📈 *Активность за 7 дней:*\n`;
  text += `\`${bar}\`\n`;
  text += `_${s.sparkline.data.join(' • ')}_\n\n`;

  // 🏆 Топы
  if (s.topPlayers.length > 0) {
    text += `🏆 *Топ игроков по заработку:*\n`;
    s.topPlayers.forEach((p, i) => {
      const m = ['🥇', '🥈', '🥉', '4.', '5.'][i];
      text += `${m} ${p.name} — *${fmt(p.earned)} ₽*\n`;
    });
    text += `\n`;
  }

  if (s.topCreators.length > 0) {
    text += `💸 *Топ создателей по тратам:*\n`;
    s.topCreators.forEach((c, i) => {
      const m = ['🥇', '🥈', '🥉', '4.', '5.'][i];
      text += `${m} ${c.name} — *${fmt(c.spent)} ₽*\n`;
    });
    text += `\n`;
  }

  if (s.topTasks.length > 0) {
    text += `📌 *Топ заданий по чеку:*\n`;
    s.topTasks.forEach((t, i) => {
      const m = ['🥇', '🥈', '🥉', '4.', '5.'][i];
      const title = t.title.length > 30 ? t.title.slice(0, 30) + '…' : t.title;
      text += `${m} ${title} — *${fmt(t.reward)} ₽*\n`;
    });
  }

  return text;
};

/**
 * Клавиатура выбора периода
 */
const buildStatsKeyboard = (currentPeriod = 'week') => {
  const btn = (p, label) => ({
    text: (p === currentPeriod ? '✅ ' : '') + label,
    callback_data: `stats_view_${p}`,
  });
  return {
    inline_keyboard: [
      [btn('day', '📅 День'), btn('week', '📆 Неделя')],
      [btn('month', '🗓 Месяц'), btn('all', '♾ Всё время')],
      [{ text: '🔄 Обновить', callback_data: `stats_view_${currentPeriod}` }],
    ],
  };
};

module.exports = { getStats, renderStats, buildStatsKeyboard, PERIODS };