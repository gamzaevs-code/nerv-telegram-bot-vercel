// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// ⚡ CRON: ежедневная сводка админу (00:00 МСК)
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const { sendDailySummaryToAdmin } = require('../lib/dailySummary');

module.exports = async (req, res) => {
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const result = await sendDailySummaryToAdmin();
    console.log('[cron-daily-summary]', JSON.stringify(result));
    return res.status(200).json({ ok: true, result });
  } catch (e) {
    console.error('[cron-daily-summary] error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};