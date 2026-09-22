// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// ⚡ CRON: подведение итогов турнира (00:00 МСК = 21:00 UTC)
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const { checkAndAwardTournament } = require('../lib/tournament');

module.exports = async (req, res) => {
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const result = await checkAndAwardTournament(new Date());
    console.log('[cron-tournament]', JSON.stringify(result));
    return res.status(200).json({ ok: true, result });
  } catch (e) {
    console.error('[cron-tournament] error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};