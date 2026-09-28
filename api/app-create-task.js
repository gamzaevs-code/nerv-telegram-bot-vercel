// в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬
// API: СЃРѕР·РґР°РЅРёРµ Р·Р°РґР°РЅРёСЏ РёР· Mini App
// в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬в–¬
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
  if (!botToken) throw new Error('BOT_TOKEN РЅРµ Р·Р°РґР°РЅ');
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('hash РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚');
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calcHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (calcHash !== hash) throw new Error('РќРµРІРµСЂРЅР°СЏ РїРѕРґРїРёСЃСЊ initData');
  const authDate = parseInt(params.get('auth_date') || '0', 10);
  if (Math.floor(Date.now() / 1000) - authDate > 86400) throw new Error('Р”Р°РЅРЅС‹Рµ СѓСЃС‚Р°СЂРµР»Рё');
  const userJson = params.get('user');
  if (!userJson) throw new Error('user РЅРµ РЅР°Р№РґРµРЅ');
  return JSON.parse(userJson);
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { initData, title, description, reward } = req.body;
    if (!initData) return res.status(400).json({ ok: false, error: 'initData РѕР±СЏР·Р°С‚РµР»РµРЅ' });

    const tgUser = verifyInitData(initData);
    const chatId = String(tgUser.id);

    const userRes = await query(
      `SELECT id, name, "displayName", balance, role, "isBanned", "roleChosen"
       FROM "User" WHERE "telegramChatId" = $1`,
      [chatId]
    );
    if (userRes.rows.length === 0) return res.status(403).json({ ok: false, error: 'РђРєРєР°СѓРЅС‚ РЅРµ РїСЂРёРІСЏР·Р°РЅ' });
    const user = userRes.rows[0];
    if (user.isBanned) return res.status(403).json({ ok: false, error: 'РђРєРєР°СѓРЅС‚ Р·Р°Р±Р»РѕРєРёСЂРѕРІР°РЅ' });

    // Р’Р°Р»РёРґР°С†РёСЏ
    if (!title || title.trim().length < 3) {
      return res.status(400).json({ ok: false, error: 'РќР°Р·РІР°РЅРёРµ РјРёРЅРёРјСѓРј 3 СЃРёРјРІРѕР»Р°' });
    }
    if (title.trim().length > 100) {
      return res.status(400).json({ ok: false, error: 'РќР°Р·РІР°РЅРёРµ РјР°РєСЃРёРјСѓРј 100 СЃРёРјРІРѕР»РѕРІ' });
    }
    if (!description || description.trim().length < 5) {
      return res.status(400).json({ ok: false, error: 'РћРїРёСЃР°РЅРёРµ РјРёРЅРёРјСѓРј 5 СЃРёРјРІРѕР»РѕРІ' });
    }
    if (description.trim().length > 1000) {
      return res.status(400).json({ ok: false, error: 'РћРїРёСЃР°РЅРёРµ РјР°РєСЃРёРјСѓРј 1000 СЃРёРјРІРѕР»РѕРІ' });
    }

    const rewardInt = parseInt(reward, 10);
    if (isNaN(rewardInt) || rewardInt < 10) {
      return res.status(400).json({ ok: false, error: 'РњРёРЅРёРјР°Р»СЊРЅР°СЏ РЅР°РіСЂР°РґР° 10 в‚Ѕ' });
    }
    if (rewardInt > 100000) {
      return res.status(400).json({ ok: false, error: 'РњР°РєСЃРёРјСѓРј 100 000 в‚Ѕ' });
    }

    if (user.role !== 'viewer' && user.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'РўРѕР»СЊРєРѕ Р·СЂРёС‚РµР»Рё Рё Р°РґРјРёРЅС‹ РјРѕРіСѓС‚ СЃРѕР·РґР°РІР°С‚СЊ Р·Р°РґР°РЅРёСЏ' });
    }
    if (!user.roleChosen) {
      return res.status(403).json({ ok: false, error: 'РЎРЅР°С‡Р°Р»Р° РІС‹Р±РµСЂРё СЂРѕР»СЊ РІ Р±РѕС‚Рµ' });
    }
    if (user.balance < rewardInt) {
      return res.status(400).json({ ok: false, error: `РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ. Р‘Р°Р»Р°РЅСЃ: ${user.balance} в‚Ѕ` });
    }

    // AI-РјРѕРґРµСЂР°С†РёСЏ
    const mod = await aiModerateContent(title.trim(), description.trim());
    if (!mod.ok) {
      await logModeration(user.id, null, 'task_text', `BLOCKED: ${mod.reason}`, 'REJECTED');
      return res.status(400).json({ ok: false, error: `рџљ« РћС‚РєР»РѕРЅРµРЅРѕ РјРѕРґРµСЂР°С†РёРµР№: ${mod.reason}` });
    }

    // РЎРѕР·РґР°С‘Рј Р·Р°РґР°РЅРёРµ
    const tr = await query(
      `INSERT INTO "Task" (title, description, reward, status, "creatorId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'open', $4, NOW(), NOW()) RETURNING *`,
      [title.trim(), description.trim(), rewardInt, user.id]
    );
    const t = tr.rows[0];

    await logModeration(user.id, t.id, 'task_text', `OK: ${mod.reason || 'approved'}`, 'APPROVED');

    // РЎРїРёСЃС‹РІР°РµРј СЃ Р±Р°Р»Р°РЅСЃР°
    await query('UPDATE "User" SET balance = balance - $1 WHERE id=$2', [rewardInt, user.id]);
    await query(
      `INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt")
       VALUES ($1,'task_create',$2,'completed',$3,NOW())`,
      [user.id, -rewardInt, `РЎРѕР·РґР°РЅРёРµ "${t.title}"`]
    );

    // XP, РєРІРµСЃС‚С‹, Р°С‡РёРІРєРё
    try {
      const xpRes = await addExperience(user.id, 10);
      await checkDailyQuests(user.id, 'task_created', 1);
      const achs = await checkAchievements(user.id);
      await notifyLevelUp(user.id, xpRes, sendMessage);
      await notifyAchievements(user.id, achs, sendMessage);
    } catch (e) { console.error('after create:', e); }

    // РђРІС‚РѕРїРѕСЃС‚РёРЅРі
    try {
      await postTaskToChannel(t.id, t.title, t.description, t.reward, user.displayName || user.name, sendMessage);
    } catch (e) { console.error('postTaskToChannel:', e); }

    // Push-СѓРІРµРґРѕРјР»РµРЅРёСЏ (500+)
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
    // SECURITY: Log auth failures separately
    if (e.message.includes('подпись') || e.message.includes('устарел')) {
      console.warn(`[SECURITY] Auth error in app-create-task: ${e.message}`);
    } else {
      console.error('app-create-task error:', e);
    }
    return res.status(500).json({ ok: false, error: e.message });
  }
};