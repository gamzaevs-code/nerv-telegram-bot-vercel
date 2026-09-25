const { query } = require('./db');
const { buildMainMenu } = require('./menu');

// Обработка deep links при /start <параметр>
// Возвращает true если обработал, false если нет
const handleStartParam = async (param, ctx) => {
  const { send, user, chatId, userState, edit } = ctx;

  if (!param) return false;

  // ==== bonus — открыть меню бонуса ====
  if (param === 'bonus') {
    if (!user) {
      await send('❌ *Сначала привяжи аккаунт:* /link your@email.com');
      return true;
    }

    const now = new Date();
    const last = user.lastDailyBonusAt ? new Date(user.lastDailyBonusAt) : null;
    const hoursSince = last ? (now - last) / 3600000 : 24;
    const canClaim = hoursSince >= 24;

    const streakContinues = last && hoursSince >= 24 && hoursSince <= 48;
    const nextStreak = streakContinues ? (user.loginStreak || 0) + 1 : 1;

    let text = `🎁 *Ежедневный бонус*\n`;
    text += `${'▬'.repeat(18)}\n\n`;

    if (canClaim) {
      text += `🔥 Streak: *${user.loginStreak || 0} дн.*\n`;
      text += `➡️ Следующий: *${nextStreak} дн.*\n\n`;
      text += `💰 Награда зависит от streak:\n`;
      text += `• 1-2 дня: ×1.0 (10 ₽)\n`;
      text += `• 3-6 дней: ×1.2 (12 ₽)\n`;
      text += `• 7-13 дней: ×1.5 (15 ₽)\n`;
      text += `• 14+: ×2.0 (20 ₽)\n\n`;
      text += `_Забрать бонус за текущий день?_`;
    } else {
      const hoursLeft = 24 - hoursSince;
      const h = Math.floor(hoursLeft);
      const m = Math.round((hoursLeft - h) * 60);
      text += `⏳ Следующий бонус через *${h > 0 ? `${h} ч ${m} мин` : `${m} мин`}*\n\n`;
      text += `🔥 Streak: *${user.loginStreak || 0} дн.*\n`;
      text += `_Не пропускай — streak сбрасывается после 48 ч._`;
    }

    await send(text, 'Markdown', {
      inline_keyboard: [
        canClaim ? [{ text: '🎁 Забрать бонус', callback_data: 'daily' }] : [],
        [{ text: '🔙 Меню', callback_data: 'menu' }],
      ].filter(row => row.length > 0),
    });
    return true;
  }

  // ==== task_123 — открыть задание ====
  if (param.startsWith('task_')) {
    const taskId = parseInt(param.replace('task_', ''));
    if (isNaN(taskId)) return false;

    try {
      const r = await query(
        `SELECT t.id, t.title, t.reward, t.status, t."playerId", u.name AS creator
         FROM "Task" t JOIN "User" u ON t."creatorId" = u.id
         WHERE t.id = $1`,
        [taskId]
      );
      if (r.rows.length === 0) {
        await send('❌ *Задание не найдено или удалено*', 'Markdown', {
          inline_keyboard: [[{ text: '🔙 Меню', callback_data: 'menu' }]],
        });
        return true;
      }
      const t = r.rows[0];
      const isPlayer = user && user.role === 'player';
      const canTake = t.status === 'open' && isPlayer && !t.playerId;

      let text = `📌 *${t.title}*\n\n`;
      text += `💰 Награда: ${t.reward} ₽\n`;
      text += `👤 Создатель: ${t.creator}\n`;
      text += `📌 Статус: ${t.status}\n`;

      const buttons = [];
      if (canTake) buttons.push([{ text: '🎯 Взять задание', callback_data: `take_${t.id}` }]);
      buttons.push([{ text: '📋 Все задания', callback_data: 'tasks' }]);
      buttons.push([{ text: '🔙 В меню', callback_data: 'menu' }]);

      await send(text, 'Markdown', { inline_keyboard: buttons });
    } catch (e) {
      console.error('deeplink task_:', e);
      await send('❌ *Ошибка загрузки задания*');
    }
    return true;
  }

  // ==== ref_ABC123 — активация реферального кода ====
  if (param.startsWith('ref_')) {
    const code = param.replace('ref_', '').toUpperCase().trim();
    if (!code) return false;

    if (!user) {
      await send('❌ *Сначала привяжи аккаунт:* /link your@email.com');
      return true;
    }

    if (user.referredBy) {
      await send('ℹ️ *Ты уже в чьей-то реферальной сети*', 'Markdown', {
        inline_keyboard: [[{ text: '🔙 Меню', callback_data: 'menu' }]],
      });
      return true;
    }

    try {
      const ref = await query(
        `SELECT id, name, "displayName" FROM "User" WHERE "referralCode"=$1 AND id<>$2`,
        [code, user.id]
      );
      if (ref.rows.length === 0) {
        await send('❌ *Реферальный код не найден*');
        return true;
      }
      const refUser = ref.rows[0];

      await query('UPDATE "User" SET "referredBy"=$1 WHERE id=$2', [refUser.id, user.id]);

      await send(
        `🎁 *Реферальный код активирован!*\n\n` +
        `Тебя пригласил: *${refUser.displayName || refUser.name}*\n\n` +
        `_Он получит бонус, когда ты выполнишь первое задание._`,
        'Markdown',
        { inline_keyboard: [[{ text: '🔙 Меню', callback_data: 'menu' }]] }
      );
    } catch (e) {
      console.error('deeplink ref_:', e);
      await send('❌ *Ошибка активации кода*');
    }
    return true;
  }

  // ==== upload_XXX — загрузка видео по заданию ====
  if (param.startsWith('upload_')) {
    const taskId = parseInt(param.replace('upload_', ''));
    if (isNaN(taskId)) return false;

    if (!user) {
      await send('❌ *Сначала привяжи аккаунт:* /link your@email.com');
      return true;
    }
    if (user.role !== 'player') {
      await send('❌ *Только игроки могут сдавать видео*');
      return true;
    }

    try {
      const r = await query(
        `SELECT id, title, status, "playerId" FROM "Task"
         WHERE id=$1 AND "playerId"=$2 AND status='taken'`,
        [taskId, user.id]
      );
      if (r.rows.length === 0) {
        await send(
          '❌ *Не найдено*\n\n_Задание не взято или уже сдано._',
          'Markdown',
          { inline_keyboard: [[{ text: '📋 Мои задания', callback_data: 'my_tasks' }], [{ text: '🔙 Меню', callback_data: 'menu' }]] }
        );
        return true;
      }
      const t = r.rows[0];
      await send(
        `📹 *Загрузка видео*\n${'▬'.repeat(18)}\n\n📌 *${t.title}*\n\n*Отправь видео прямо в этот чат как обычное сообщение.*\n\n_После загрузки задание перейдёт в голосование._`,
        'Markdown',
        { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'menu' }]] }
      );
    } catch (e) {
      console.error('deeplink upload_:', e);
      await send('❌ *Ошибка загрузки*');
    }
    return true;
  }

  // ==== invite_XXX — приглашение в гильдию ====
  if (param.startsWith('invite_')) {
    const guildId = parseInt(param.replace('invite_', ''));
    if (isNaN(guildId)) return false;

    await send(
      `🎉 *Приглашение в гильдию*\n\n_Функция скоро появится!_\n\nСледи за обновлениями.`,
      'Markdown',
      { inline_keyboard: [[{ text: '🔙 Меню', callback_data: 'menu' }]] }
    );
    return true;
  }

  // ==== Реферальный код в формате просто букв/цифр (без префикса) ====
  if (/^[A-Z0-9]{4,10}$/.test(param.toUpperCase())) {
    return await handleStartParam('ref_' + param, ctx);
  }

  return false;
};

module.exports = { handleStartParam };