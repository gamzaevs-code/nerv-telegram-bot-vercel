const { query } = require('./db');
const { sendMessage } = require('./telegram');
const { buildMainMenu } = require('./menu');
const {
  addExperience,
  getStreakMultiplier,
  checkAchievements,
  notifyLevelUp,
  notifyAchievements,
} = require('./helpers');
const { handleSocialText } = require('./social');

// ========== ХЕЛПЕРЫ ==========

const getUserById = async (id) => {
  try {
    const r = await query(
      `SELECT id, name, "displayName", balance, reputation, role, level, experience
       FROM "User" WHERE id = $1`,
      [id]
    );
    return r.rows[0] || null;
  } catch {
    return null;
  }
};

// ========== ОСНОВНОЙ ОБРАБОТЧИК ТЕКСТА ==========

const handleTextCommand = async (text, ctx) => {
  const { send, user, chatId, sendMessage, userState } = ctx;
  const isAdmin = user && user.role === 'admin';
  const isModerator = user && (user.isModerator || user.role === 'admin');

  // /start /menu
  if (text === '/start' || text === '/menu') {
    // Если роль ещё не выбрана — предложить выбор
    if (user && !user.roleChosen) {
      await send(
        `👋 *Добро пожаловать в NERV!*\n\n` +
        `Это платформа для выполнения заданий:\n` +
        `• 👁 *Зрители* создают задания и платят за выполнение\n` +
        `• 🎮 *Игроки* выполняют задания и получают награду\n\n` +
        `Выбери свою роль:`,
        'Markdown',
        {
          inline_keyboard: [
            [{ text: '🎮 Я игрок', callback_data: 'choose_role_player' }],
            [{ text: '👁 Я зритель', callback_data: 'choose_role_viewer' }],
          ],
        }
      );
      return true;
    }

    await send('🤖 *Главное меню*', 'Markdown', buildMainMenu(user));
    return true;
  }

  // /link
  if (text.startsWith('/link ')) {
    const email = text.replace('/link ', '').trim().toLowerCase();
    if (!email.match(/^[^@]+@[^@]+\.[^@]+$/)) {
      await send('❌ *Неверный email*');
      return true;
    }
    try {
      const r = await query('SELECT id, name FROM "User" WHERE email=$1', [email]);
      if (r.rows.length === 0) { await send('❌ *Пользователь не найден.*'); return true; }
      const u = r.rows[0];
      await query(
        'UPDATE "User" SET "telegramChatId"=$1, "telegramLinked"=true WHERE id=$2',
        [String(chatId), u.id]
      );
      await send(`✅ *Аккаунт привязан!*\n👤 ${u.name}`, 'Markdown', {
        inline_keyboard: [[{ text: '📊 Профиль', callback_data: 'profile' }]],
      });
    } catch (e) {
      console.error(e);
      await send('❌ *Ошибка привязки*');
    }
    return true;
  }

  if (text === '/link') {
    await send('⚠️ *Укажи email:* `/link your@email.com`');
    return true;
  }

  // /profile
  if (text === '/profile') {
    if (!user) { await send('❌ *Не привязан.* /link your@email.com'); return true; }
    const rank = await query(
      `SELECT COUNT(*)::int + 1 AS pos FROM "User" WHERE reputation > $1`,
      [user.reputation]
    );
    await send(
      `👤 *${user.displayName || user.name}*\n\n` +
      `🎖 Ур. ${user.level || 1} (${user.experience || 0} XP)\n` +
      `💰 ${user.balance} ₽\n` +
      `⭐ ${user.reputation}\n` +
      `🎮 ${user.role}\n` +
      `🏅 Место: #${rank.rows[0].pos}\n` +
      `🔥 Streak: ${user.loginStreak} дн.`
    );
    return true;
  }

  if (text.startsWith('/profile ')) {
    const id = parseInt(text.replace('/profile ', '').trim());
    if (isNaN(id)) { await send('❌ *Неверный ID*'); return true; }
    const t = await getUserById(id);
    if (!t) { await send('❌ *Не найден*'); return true; }
    await send(
      `👤 *${t.displayName || t.name}*\n\n` +
      `🎖 Ур. ${t.level || 1}\n` +
      `⭐ ${t.reputation}\n` +
      `🎮 ${t.role}\n\n` +
      `💬 /msg ${t.id} <текст>`
    );
    return true;
  }

  // /my
  if (text === '/my') {
    if (!user) { await send('❌ *Сначала привяжи*'); return true; }
    const r = await query(
      `SELECT t.id, t.title, t.reward, t.status
       FROM "Task" t WHERE t."playerId"=$1
       ORDER BY t."updatedAt" DESC LIMIT 15`,
      [user.id]
    );
    if (r.rows.length === 0) { await send('📭 *У тебя нет заданий.*'); return true; }
    let msg = '📝 *Твои задания:*\n\n';
    r.rows.forEach((t, i) => {
      const e = t.status === 'taken' ? '🟡' : t.status === 'voting' ? '🗳️' : t.status === 'approved' ? '✅' : '⚪';
      msg += `${i + 1}. ${e} *${t.title}*\n   💰 ${t.reward} ₽ · ${t.status}\n\n`;
    });
    await send(msg);
    return true;
  }

  // /quests
  if (text === '/quests') {
    if (!user) { await send('❌ *Сначала привяжи*'); return true; }
    const all = await query(`SELECT id, description, reward, "requirementValue" FROM "DailyQuest"`);
    if (all.rows.length === 0) { await send('📅 *Квестов пока нет.*'); return true; }
    const progress = await query(
      `SELECT "questId", progress, completed FROM "UserDailyQuest"
       WHERE "userId"=$1 AND date = CURRENT_DATE`,
      [user.id]
    );
    const progressMap = {};
    progress.rows.forEach(p => { progressMap[p.questId] = p; });

    let msg = '📅 *Ежедневные квесты:*\n\n';
    all.rows.forEach(q => {
      const p = progressMap[q.id];
      const prog = p?.progress || 0;
      const isDone = p?.completed || false;
      msg += `${isDone ? '✅' : '🔸'} *${q.description}*\n   ${prog}/${q.requirementValue} · 🎁 ${q.reward} ₽\n\n`;
    });
    await send(msg);
    return true;
  }

  // /tasks
  if (text === '/tasks') {
    const r = await query(
      `SELECT id, title, reward, status, "playerId" FROM "Task"
       WHERE status IN ('open','voting') ORDER BY "createdAt" DESC LIMIT 10`
    );
    if (r.rows.length === 0) { await send('📭 *Нет заданий.*'); return true; }
    const isPlayer = user && user.role === 'player';
    const buttons = [];
    r.rows.forEach(t => {
      const row = [{ text: `📌 ${t.title} (${t.reward}₽)`, callback_data: `task_${t.id}` }];
      if (t.status === 'open' && isPlayer && !t.playerId) {
        row.push({ text: '🎯 Взять', callback_data: `take_${t.id}` });
      }
      if (t.status === 'voting') {
        row.push({ text: '✅ За', callback_data: `vote_${t.id}_approve` });
        row.push({ text: '❌ Против', callback_data: `vote_${t.id}_reject` });
      }
      buttons.push(row);
    });
    buttons.push([{ text: '🔙 Назад', callback_data: 'menu' }]);
    await send('📋 *Задания:*', 'Markdown', { inline_keyboard: buttons });
    return true;
  }

  // /daily
  if (text === '/daily') {
    if (!user) { await send('❌ *Сначала привяжи*'); return true; }
    const now = new Date();
    const last = user.lastDailyBonusAt ? new Date(user.lastDailyBonusAt) : null;
    const hoursSince = last ? (now - last) / 3600000 : 24;
    if (hoursSince < 24) {
      await send(`⏳ *Бонус уже получен.* Следующий через ${Math.ceil(24 - hoursSince)} ч.`);
      return true;
    }
    const streakContinues = last && hoursSince >= 24 && hoursSince <= 48;
    const newStreak = streakContinues ? (user.loginStreak || 0) + 1 : 1;
    const mult = getStreakMultiplier(newStreak);
    const baseBonus = 10;
    const bonus = Math.round(baseBonus * mult);

    await query(
      'UPDATE "User" SET balance = balance + $1, "loginStreak"=$2, "lastDailyBonusAt"=NOW() WHERE id=$3',
      [bonus, newStreak, user.id]
    );
    await query(
      `INSERT INTO "Transaction" ("userId",type,amount,status,reason,"createdAt")
       VALUES ($1,'daily_bonus',$2,'completed',$3,NOW())`,
      [user.id, bonus, `Ежедневный бонус (streak ${newStreak})`]
    );
    const xpRes = await addExperience(user.id, 15);
    const achs = await checkAchievements(user.id);

    await send(`🎁 *Бонус получен!* +${bonus} ₽\n🔥 Streak: ${newStreak} дн. (×${mult})\n_+15 XP_`);
    await notifyLevelUp(user.id, xpRes, sendMessage);
    await notifyAchievements(user.id, achs, sendMessage);
    return true;
  }

  // /referral
  if (text === '/referral') {
    if (!user) { await send('❌ *Сначала привяжи*'); return true; }
    let code = user.referralCode;
    if (!code) {
      code = Math.random().toString(36).substring(2, 8).toUpperCase();
      await query('UPDATE "User" SET "referralCode"=$1 WHERE id=$2', [code, user.id]);
    }
    const lvl1 = await query('SELECT COUNT(*)::int AS c FROM "User" WHERE "referredBy"=$1', [user.id]);
    const totalEarned = await query(
      `SELECT COALESCE(SUM(amount),0)::int AS s FROM "ReferralEarning" WHERE "userId"=$1`,
      [user.id]
    );
    await send(
      `🔗 *Рефералы*\n\n` +
      `Код: *${code}*\n` +
      `Ссылка: https://nerv.vercel.app/signup?ref=${code}\n\n` +
      `👥 Приглашено напрямую: *${lvl1.rows[0].c}*\n` +
      `💰 Всего заработано: *${totalEarned.rows[0].s} ₽*`
    );
    return true;
  }

  // /leaderboard
  if (text === '/leaderboard') {
    const r = await query(
      'SELECT name, "displayName", reputation, level FROM "User" ORDER BY reputation DESC LIMIT 10'
    );
    let msg = '🏆 *Топ:*\n\n';
    r.rows.forEach((u, i) => {
      const m = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      msg += `${m} ${u.displayName || u.name} — ⭐ ${u.reputation} (ур.${u.level || 1})\n`;
    });
    await send(msg);
    return true;
  }

  // /admin
  if (text === '/admin') {
    if (!isAdmin) { await send('⛔ *Доступ запрещён.*'); return true; }
    await send('⚙️ *Админ-панель*', 'Markdown', {
      inline_keyboard: [
        [{ text: '👥 Пользователи', callback_data: 'admin_users' }],
        [{ text: '📋 Задания', callback_data: 'admin_tasks' }],
        [{ text: '📊 Расширенная статистика', callback_data: 'admin_stats_full' }],
        [{ text: '📢 Рассылка', callback_data: 'admin_broadcast' }],
        [{ text: '🔙 Меню', callback_data: 'menu' }],
      ],
    });
    return true;
  }

  // /mod
  if (text === '/mod') {
    if (!isModerator) { await send('⛔ *Доступ запрещён.*'); return true; }
    await send('👮 *Модератор-панель*', 'Markdown', {
      inline_keyboard: [
        [{ text: '🚨 Открытые жалобы', callback_data: 'mod_reports' }],
        [{ text: '⏳ Задания на модерации', callback_data: 'mod_pending' }],
        [{ text: '🔙 Меню', callback_data: 'menu' }],
      ],
    });
    return true;
  }

  // /help
  if (text === '/help') {
    await send(
      '📖 *Помощь*\n\n' +
      '*🎯 Основное:*\n' +
      '/start — Меню\n' +
      '/profile — Профиль\n' +
      '/tasks — Задания\n' +
      '/my — Мои задания\n\n' +
      '*💰 Экономика:*\n' +
      '/wallet — Кошелёк\n' +
      '/daily — Бонус\n' +
      '/referral — Рефералы\n' +
      '/leaderboard — Рейтинг\n\n' +
      '*📅 Прогресс:*\n' +
      '/quests — Квесты\n' +
      '/stats — Статистика\n\n' +
      '*👥 Соцфункции:*\n' +
      '/search имя — Поиск\n' +
      '/msg id текст — Написать\n' +
      '/inbox — Входящие\n\n' +
      '*⚙️ Прочее:*\n' +
      '/link email — Привязать\n' +
      '/delete_data — Отвязать',
      'Markdown',
      { inline_keyboard: [[{ text: '🔙 Меню', callback_data: 'menu' }]] }
    );
    return true;
  }

  // /delete_data
  if (text === '/delete_data') {
    if (!user) { await send('❌ *Не привязан*'); return true; }
    await query(
      'UPDATE "User" SET "telegramChatId"=NULL, "telegramLinked"=false WHERE id=$1',
      [user.id]
    );
    await send('✅ *Вы отвязаны от бота.*');
    return true;
  }

  // Социальные (поиск, ЛС, inbox)
  const handled = await handleSocialText(text, ctx);
  if (handled) return true;

  return false;
};

module.exports = { handleTextCommand };