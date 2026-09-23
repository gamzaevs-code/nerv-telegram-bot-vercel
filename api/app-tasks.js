// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// API: список заданий для Mini App (с онлайн-статусами)
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
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calcHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (calcHash !== hash) throw new Error('Неверная подпись initData');

  const authDate = parseInt(params.get('auth_date') || '0', 10);
  if (Math.floor(Date.now() / 1000) - authDate > 86400) throw new Error('Данные устарели');

  const userJson = params.get('user');
  if (!userJson) throw new Error('user не найден');
  return JSON.parse(userJson);
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { initData, filter = 'all' } = req.body;
    if (!initData) return res.status(400).json({ ok: false, error: 'initData обязателен' });

    const tgUser = verifyInitData(initData);
    const chatId = String(tgUser.id);

    // Получаем пользователя (для проверки прав)
    const userRes = await query(
      `SELECT id, role, "isBanned" FROM "User" WHERE "telegramChatId" = $1`,
      [chatId]
    );
    if (userRes.rows.length === 0) return res.status(403).json({ ok: false, error: 'Аккаунт не привязан' });

    const user = userRes.rows[0];
    if (user.isBanned) return res.status(403).json({ ok: false, error: 'Аккаунт заблокирован' });

    // Фильтр по статусу
    let statusFilter = '';
    if (filter === 'open') statusFilter = `AND t.status = 'open'`;
    else if (filter === 'voting') statusFilter = `AND t.status = 'voting'`;
    else if (filter === 'mine') statusFilter = `AND t."playerId" = ${user.id}`;
    else statusFilter = `AND t.status IN ('open','voting','taken')`;

    const tasksRes = await query(
      `SELECT t.id, t.title, t.description, t.reward, t.status, t."playerId",
              t."videoUrl", t."createdAt", t."deadlineAt",
              u.name AS "creatorName",
              COALESCE(u."displayName", u.name) AS "creatorDisplay",
              u.id AS "creatorId",
              p.name AS "playerName",
              pres."lastSeen" AS "creatorLastSeen",
              (SELECT COUNT(*)::int FROM "Vote" WHERE "taskId"=t.id AND value='approve') AS approve,
              (SELECT COUNT(*)::int FROM "Vote" WHERE "taskId"=t.id AND value='reject') AS reject
       FROM "Task" t
       JOIN "User" u ON t."creatorId" = u.id
       LEFT JOIN "User" p ON t."playerId" = p.id
       LEFT JOIN "UserPresence" pres ON pres."userId" = u.id
       WHERE 1=1 ${statusFilter}
       ORDER BY t."createdAt" DESC
       LIMIT 50`
    );

    const tasks = tasksRes.rows.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description || '',
      reward: t.reward,
      status: t.status,
      approve: t.approve,
      reject: t.reject,
      creatorId: t.creatorId,
      creatorName: t.creatorDisplay || t.creatorName,
      isCreatorOnline: t.creatorLastSeen
        ? (Date.now() - new Date(t.creatorLastSeen).getTime()) / 60000 < ONLINE_THRESHOLD_MIN
        : false,
      playerName: t.playerName,
      hasVideo: !!t.videoUrl,
      deadlineAt: t.deadlineAt,
      createdAt: t.createdAt,
    }));

    return res.status(200).json({
      ok: true,
      tasks,
      userRole: user.role,
      userId: user.id,
    });
  } catch (e) {
    console.error('app-tasks error:', e);
    return res.status(401).json({ ok: false, error: e.message });
  }
};