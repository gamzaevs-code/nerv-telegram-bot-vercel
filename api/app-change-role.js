// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// API: смена роли игрок / зритель в Mini App
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const crypto = require('crypto');
const { query } = require('../lib/db');
const { sendMessage } = require('../lib/telegram');

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
    const { initData, role } = req.body;
    if (!initData) return res.status(400).json({ ok: false, error: 'initData обязателен' });
    if (!['player', 'viewer'].includes(role)) {
      return res.status(400).json({ ok: false, error: 'Неверная роль' });
    }

    const tgUser = verifyInitData(initData);
    const chatId = String(tgUser.id);

    const userRes = await query(
      `SELECT id, name, "displayName", role, "isBanned" FROM "User" WHERE "telegramChatId" = $1`,
      [chatId]
    );
    if (userRes.rows.length === 0) return res.status(403).json({ ok: false, error: 'Аккаунт не привязан' });
    const user = userRes.rows[0];
    if (user.isBanned) return res.status(403).json({ ok: false, error: 'Аккаунт заблокирован' });

    // Админ не может сменить свою роль на player/viewer
    if (user.role === 'admin' && role !== 'admin') {
      await query(
        `UPDATE "User" SET role=$1, "roleChosen"=true WHERE id=$2`,
        [role, user.id]
      );
    } else {
      await query(
        `UPDATE "User" SET role=$1, "roleChosen"=true WHERE id=$2`,
        [role, user.id]
      );
    }

    // Уведомление в Telegram
    const newRoleLabel = role === 'player' ? '🎮 Игрок' : '👁 Зритель';
    const tgMsg = role === 'player'
      ? `🎮 *Ты теперь ИГРОК!*\n\nЧто доступно:\n• Брать задания\n• Загружать видео-выполнения\n• Получать награды`
      : `👁 *Ты теперь ЗРИТЕЛЬ!*\n\nЧто доступно:\n• Создавать задания\n• Голосовать за выполнение\n• Нанимать игроков`;
    try {
      await sendMessage(chatId, tgMsg, 'Markdown');
    } catch (e) { console.error('notify role change:', e); }

    return res.status(200).json({
      ok: true,
      role,
      roleLabel: newRoleLabel,
    });
  } catch (e) {
    console.error('app-change-role error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};