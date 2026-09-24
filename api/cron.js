// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// API: cron (турниры + сводка админу)
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const { checkAndAwardTournament } = require('../lib/tournament');
const { sendDailySummaryToAdmin } = require('../lib/dailySummary');

module.exports = async (req, res) => {
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // Определяем, что запускать по query-параметру
  const url = new URL(req.url, 'http://x');
  const task = url.searchParams.get('task');

  try {
    if (task === 'tournament') {
      const result = await checkAndAwardTournament(new Date());
      console.log('[cron-tournament]', JSON.stringify(result));
      return res.status(200).json({ ok: true, task: 'tournament', result });
    }

    if (task === 'summary') {
      const result = await sendDailySummaryToAdmin();
      console.log('[cron-summary]', JSON.stringify(result));
      return res.status(200).json({ ok: true, task: 'summary', result });
    }

    // Без параметра — запускаем оба
    const t = await checkAndAwardTournament(new Date());
    const s = await sendDailySummaryToAdmin();
    return res.status(200).json({ ok: true, tournament: t, summary: s });
  } catch (e) {
    console.error('[cron] error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};