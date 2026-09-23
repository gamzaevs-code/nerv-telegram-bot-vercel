// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// API: создание задания из Mini App
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const crypto = require('crypto');
const { query } = require('../lib/db');
const { aiModerateContent, logModeration } = require('../lib/ai');
const {
  addExperience,
  checkDailyQuests,
  checkAchievements,
  notifyLevelUp,
  notifyAchievements,
  postTaskToChannel,
} = require('../lib/helpers');
const { notifyNewTask } = require('../lib/notifications');
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
    const { initData, title, description, reward } = req.body;
    if (!initData) return res.status(400).json({ ok: false, error: 'initData обязателен' });

    const tgUser = verifyInitData(initData);
    const chatId = String(tgUser.id);

    const userRes = await query(
      `SELECT id, name, "displayName", balance, role, "isBanned", "roleChosen"
       FROM "User" WHERE "telegramChatId" = $1`,
      [chatId]
    );
    if (userRes.rows.length === 0) return res.status(403).json({ ok: false, error: 'Аккаунт не привязан' });
    const user = userRes.rows[0];
    if (user.isBanned) return res.status(403).json({ ok: false, error: 'Аккаунт заблокирован' });

    // Валидация
    if (!title || title.trim().length < 3) {
      return res.status(400).json({ ok: false, error: 'Название минимум 3 символа' });
    }
    if (title.trim().length > 100) {
      return res.status(400).json({ ok: false, error: 'Название максимум 100 символов' });
    }
    if (!description || description.trim().length < 5) {
      return res.status(400).json({ ok: false, error: 'Описание минимум 5 символов' });
    }
    if (description.trim().length > 1000) {
      return res.status(400).json({ ok: false, error: 'Описание максимум 1000 символов' });
    }

    const rewardInt = parseInt(reward, 10);
    if (isNaN(rewardInt) || rewardInt < 10) {
      return res.status(400).json({ ok: false, error: 'Минимальная награда 10 ₽' });
    }
    if (rewardInt > 100000) {
      return res.status(400).json({ ok: false, error: 'Максимум 100 000 ₽' });
    }

    if (user.role !== 'viewer' && user.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Только зрители и админы могут создавать задания' });
    }
    if (!user.roleChosen) {
      return res.status(403).json({ ok: false, error: 'Сначала выбери роль в боте' });
    }
    if (user.balance < rewardInt) {
      return res.status(400).json({ ok: false, error: `Недостаточно. Баланс: ${user.balance} ₽` });
    }

    // AI-модерация
    const mod = await aiModerateContent(title.trim(), description.trim());
    if (!mod.ok) {
      await logModeration(user.id, null, 'task_text', `BLOCKED: ${mod.reason}`, 'REJECTED');
      return res.status(400).json({ ok: false, error: `🚫 Отклонено модерацией: ${mod.reason}` });
    }

    // Создаём задание
    const tr = await query(
      `INSERT INTO "Task" (title, description, reward, status, "creatorId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'open', $4, NOW(), NOW()) RETURNING *`,
      [title.trim(), description.trim(), rewardInt, user.id]
    );
    const t = tr.rows[0];

    await logModeration(user.id, t.id, 'task_text', `OK: ${mod.reason || 'approved'}`, 'APPROVED');

    // Списываем с баланса
    await query('UPDATE "User" SET balance = balance - $1 WHERE id=$2', [rewardInt, user.id]);
    await query(
      `INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt")
       VALUES ($1,'task_create',$2,'completed',$3,NOW())`,
      [user.id, -rewardInt, `Создание "${t.title}"`]
    );

    // XP, квесты, ачивки
    try {
      const xpRes = await addExperience(user.id, 10);
      await checkDailyQuests(user.id, 'task_created', 1);
      const achs = await checkAchievements(user.id);
      await notifyLevelUp(user.id, xpRes, sendMessage);
      await notifyAchievements(user.id, achs, sendMessage);
    } catch (e) { console.error('after create:', e); }

    // Автопостинг
    try {
      await postTaskToChannel(t.id, t.title, t.description, t.reward, user.displayName || user.name, sendMessage);
    } catch (e) { console.error('postTaskToChannel:', e); }

    // Push-уведомления (500+)
    if (rewardInt >= 500) {
      try {
        await notifyNewTask(t.id, t.title, t.reward, user.displayName || user.name);
      } catch (e) { console.error('notifyNewTask:', e); }
    }

    return res.status(200).json({
      ok: true,
      task: { id: t.id, title: t.title, reward: t.reward },
    });
  } catch (e) {
    console.error('app-create-task error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};