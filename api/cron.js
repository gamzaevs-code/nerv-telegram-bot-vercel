// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// API: cron (турниры + сводка + игрок недели)
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const { checkAndAwardTournament } = require('../lib/tournament');
const { sendDailySummaryToAdmin } = require('../lib/dailySummary');
const { awardWeeklyPlayer } = require('../lib/weeklyAward');

module.exports = async (req, res) => {
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

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

    if (task === 'weekly_award') {
      const result = await awardWeeklyPlayer();
      console.log('[cron-weekly]', JSON.stringify(result));
      return res.status(200).json({ ok: true, task: 'weekly_award', result });
    }

    // Без параметра — запускаем всё (на всякий случай)
    const t = await checkAndAwardTournament(new Date());
    const s = await sendDailySummaryToAdmin();
    const w = await awardWeeklyPlayer();
    return res.status(200).json({ ok: true, tournament: t, summary: s, weekly: w });
  } catch (e) {
    console.error('[cron] error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};