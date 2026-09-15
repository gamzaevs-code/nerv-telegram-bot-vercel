const { query } = require('./db');
const { buildMainMenu } = require('./menu');

// Обработка deep links при /start <параметр>
// Возвращает true если обработал, false если нет
const handleStartParam = async (param, ctx) => {
  const { send, user, chatId, userState } = ctx;

  if (!param) return false;

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

    // Если пользователь уже зарегистрирован — не активируем
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

  // ==== invite_XXX — приглашение в гильдию (пока заглушка) ====
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
    // Это может быть просто реферальный код
    return await handleStartParam('ref_' + param, ctx);
  }

  return false;
};

module.exports = { handleStartParam };