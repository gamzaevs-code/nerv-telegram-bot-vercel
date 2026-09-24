// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// lib/profile.js — профиль + отзывы + настройки + ник
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
const { query } = require('./db');
const {
  addExperience,
  getStreakMultiplier,
  checkAchievements,
  notifyLevelUp,
  notifyAchievements,
} = require('./helpers');
const { getEquippedBadge, checkVipStatus } = require('./shop');
const {
  isNotifyEnabled,
  toggleNotifications,
  getNotificationSettings,
  toggleNotificationType,
} = require('./notifications');
const { getPlayerReviews, getPendingReviews, createReview } = require('./reviews');
const { getNicknameInfo } = require('./nickname');

// ═══════════ ЭКРАН НАСТРОЕК УВЕДОМЛЕНИЙ ═══════════
const renderNotifSettings = async (edit, userId) => {
  const s = await getNotificationSettings(userId);
  if (!s) {
    await edit('❌ *Ошибка загрузки настроек*', 'Markdown', {
      inline_keyboard: [[{ text: '🔙 К профилю', callback_data: 'profile' }]],
    });
    return;
  }

  const kb = [
    [{ text: `${s.newTasks ? '🔔' : '🔕'} Новые задания (500+ ₽)`, callback_data: 'notif_toggle_new' }],
    [{ text: `${s.reviews ? '🔔' : '🔕'} Отзывы и оценки`, callback_data: 'notif_toggle_reviews' }],
    [{ text: `${s.status ? '🔔' : '🔕'} Статус заданий`, callback_data: 'notif_toggle_status' }],
    [{ text: `${s.levelup ? '🔔' : '🔕'} Уровень / достижения`, callback_data: 'notif_toggle_levelup' }],
    [{ text: '🔙 К профилю', callback_data: 'profile' }],
  ];

  const text =
    `🔔 *Настройки уведомлений*\n` +
    `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
    `_Нажми на категорию, чтобы включить или выключить._\n\n` +
    `🔔 — включено\n` +
    `🔕 — выключено\n\n` +
    `📋 *Что куда входит:*\n` +
    `• *Новые задания* — пуш о заданиях от 500 ₽\n` +
    `• *Отзывы* — когда тебя оценивают\n` +
    `• *Статус заданий* — взято / видео / одобрено / отклонено / отказ\n` +
    `• *Уровень / достижения* — повышение, ачивки\n\n` +
    `💡 _Сообщения чата и системные уведомления приходят всегда._`;

  await edit(text, 'Markdown', { inline_keyboard: kb });
};

const handleProfileCallback = async (data, ctx) => {
  const { edit, user, chatId } = ctx;

  // ═══════════ ПРОФИЛЬ ═══════════
  if (data === 'profile') {
    if (!user) {
      await edit('❌ *Не привязан.* /link your@email.com', 'Markdown',
        { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
      return true;
    }
    const rank = await query(`SELECT COUNT(*)::int + 1 AS pos FROM "User" WHERE reputation > $1`, [user.reputation]);
    const badge = await getEquippedBadge(user.id);
    const vip = await checkVipStatus(user.id);
    const level = user.level || 1;
    const exp = user.experience || 0;
    const expForNext = Math.pow(level, 2) * 50;
    const expForCurrent = Math.pow(level - 1, 2) * 50;
    const progress = exp - expForCurrent;
    const needed = expForNext - expForCurrent;
    const pct = Math.min(Math.round((progress / needed) * 100), 100);
    const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));

    const ratingRes = await query(
      `SELECT "ratingAvg", "ratingCount" FROM "User" WHERE id = $1`,
      [user.id]
    );
    const ratingAvg = Number(ratingRes.rows[0]?.ratingAvg) || 0;
    const ratingCount = ratingRes.rows[0]?.ratingCount || 0;
    const ratingLine = ratingCount > 0
      ? `⭐ Рейтинг: ${ratingAvg} / 5 _(${ratingCount} ${ratingCount === 1 ? 'отзыв' : ratingCount < 5 ? 'отзыва' : 'отзывов'})_`
      : `⭐ Рейтинг: _пока нет отзывов_`;

    const badgeEmoji = badge ? badge.name.split(' ')[0] : '';
    let text = `👤 *${user.displayName || user.name}* ${badgeEmoji}${vip ? ' 💎' : ''}\n\n`;
    text += `🎖 Уровень: *${level}*\n`;
    text += `${bar} ${pct}%\n`;
    text += `_${exp} / ${expForNext} XP_\n\n`;
    text += `💰 Баланс: ${user.balance} ₽\n`;
    text += `⭐ Репутация: ${user.reputation}\n`;
    text += `${ratingLine}\n`;
    text += `🎭 Ник: \`${user.displayName || user.name}\`\n`;
    text += `🎮 Роль: ${user.role}${user.isModerator ? ' 👮' : ''}\n`;
    text += `🏅 Место: #${rank.rows[0].pos}\n`;
    text += `🔥 Streak: ${user.loginStreak} дн.`;
    if (vip) text += `\n💎 VIP активен`;

    await edit(text, 'Markdown', {
      inline_keyboard: [
        [{ text: '📈 Статистика', callback_data: 'stats' }],
        [
          { text: '⭐ Мои отзывы', callback_data: 'reviews_my' },
          { text: '📝 Оставить отзыв', callback_data: 'reviews_pending' },
        ],
        [{ text: '🎒 Мои покупки', callback_data: 'my_items' }],
        [{ text: '🔔 Настройки уведомлений', callback_data: 'notif_settings' }],
        [{ text: '🎭 Изменить ник', callback_data: 'nick_info' }],
        [{ text: '🎮 Сменить роль', callback_data: 'change_role' }],
        [{ text: '🔙 Назад', callback_data: 'menu' }],
      ],
    });
    return true;
  }

  // ═══════════ ИНФО О НИКЕ ═══════════
  if (data === 'nick_info') {
    if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return true; }
    const info = await getNicknameInfo(user.id);
    if (!info) {
      await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'profile' }]] });
      return true;
    }
    const cdLine = info.canChange
      ? '✅ _Можешь менять ник прямо сейчас_'
      : `⏳ _Смена доступна через *${info.daysLeft} дн.*_`;

    const text =
      `🎭 *Твой ник*\n` +
      `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
      `Сейчас: \`${info.nickname}\`\n\n` +
      `📝 *Как сменить:*\n` +
      `Отправь команду:\n` +
      `\`/nick новый_ник\`\n\n` +
      `📋 *Правила:*\n` +
      `• 3-20 символов\n` +
      `• латиница, цифры, \`_\`\n` +
      `• начинается с буквы\n` +
      `• уникальный (не занят)\n` +
      `• смена раз в 7 дней\n\n` +
      cdLine;

    await edit(text, 'Markdown', {
      inline_keyboard: [[{ text: '🔙 К профилю', callback_data: 'profile' }]],
    });
    return true;
  }

  // ═══════════ НАСТРОЙКИ УВЕДОМЛЕНИЙ ═══════════
  if (data === 'notif_settings') {
    if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return true; }
    await renderNotifSettings(edit, user.id);
    return true;
  }

  if (data.startsWith('notif_toggle_')) {
    if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return true; }
    const type = data.replace('notif_toggle_', '');
    const validTypes = ['new', 'reviews', 'status', 'levelup'];
    if (!validTypes.includes(type)) {
      await renderNotifSettings(edit, user.id);
      return true;
    }
    await toggleNotificationType(user.id, type);
    await renderNotifSettings(edit, user.id);
    return true;
  }

  if (data === 'toggle_notifications') {
    if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return true; }
    const newState = await toggleNotifications(user.id);
    if (newState === null) {
      await edit('❌ *Ошибка*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'profile' }]] });
      return true;
    }
    await renderNotifSettings(edit, user.id);
    return true;
  }

  // ═══════════ МОИ ОТЗЫВЫ ═══════════
  if (data === 'reviews_my') {
    if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return true; }
    const reviews = await getPlayerReviews(user.id, 10);
    if (reviews.length === 0) {
      await edit(
        '⭐ *Мои отзывы*\n\n_Пока нет отзывов._\n\nВыполняй задания, чтобы получать оценки от зрителей!',
        'Markdown',
        { inline_keyboard: [[{ text: '🔙 К профилю', callback_data: 'profile' }]] }
      );
      return true;
    }

    const ratingRes = await query(
      `SELECT "ratingAvg", "ratingCount" FROM "User" WHERE id = $1`,
      [user.id]
    );
    const avg = Number(ratingRes.rows[0]?.ratingAvg) || 0;
    const cnt = ratingRes.rows[0]?.ratingCount || 0;

    let text = `⭐ *Мои отзывы*\n\n`;
    text += `📊 Средний рейтинг: *${avg} / 5*\n`;
    text += `📝 Всего отзывов: *${cnt}*\n`;
    text += `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n`;

    for (const r of reviews) {
      const stars = '⭐'.repeat(r.rating);
      text += `${stars} *${r.rating}/5*\n`;
      text += `📋 ${r.task_title || '—'}\n`;
      text += `👤 ${r.reviewer_name || 'Аноним'}\n`;
      if (r.comment) {
        const c = r.comment.length > 150 ? r.comment.slice(0, 150) + '…' : r.comment;
        text += `💬 _${c}_\n`;
      }
      text += `🕒 ${new Date(r.createdAt).toLocaleDateString('ru-RU')}\n\n`;
    }

    await edit(text, 'Markdown', {
      inline_keyboard: [[{ text: '🔙 К профилю', callback_data: 'profile' }]],
    });
    return true;
  }

  // ═══════════ ОСТАВИТЬ ОТЗЫВ ═══════════
  if (data === 'reviews_pending') {
    if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return true; }
    const pending = await getPendingReviews(user.id, 10);
    if (pending.length === 0) {
      await edit(
        '📝 *Оставить отзыв*\n\n_Нет заданий, ожидающих отзыва._\n\nОтзыв можно оставить после одобрения задания.',
        'Markdown',
        { inline_keyboard: [[{ text: '🔙 К профилю', callback_data: 'profile' }]] }
      );
      return true;
    }

    let text = `📝 *Оставить отзыв*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n`;
    const kb = [];
    for (const p of pending) {
      text += `📋 *${p.title}*\n`;
      text += `💰 ${p.reward} ₽ • 👤 ${p.player_name || 'Игрок'}\n\n`;
      const titleShort = p.title.length > 25 ? p.title.slice(0, 25) + '…' : p.title;
      kb.push([{
        text: `⭐ ${titleShort}`,
        callback_data: `rev_rate_${p.id}_${p.playerId}`,
      }]);
    }
    kb.push([{ text: '🔙 К профилю', callback_data: 'profile' }]);

    await edit(text, 'Markdown', { inline_keyboard: kb });
    return true;
  }

  // ═══════════ ВЫБОР ОЦЕНКИ ═══════════
  if (data.startsWith('rev_rate_')) {
    if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return true; }
    const parts = data.split('_');
    const taskId = parseInt(parts[2], 10);
    const playerId = parseInt(parts[3], 10);

    const tRes = await query(
      `SELECT title FROM "Task" WHERE id = $1`,
      [taskId]
    );
    const title = tRes.rows[0]?.title || 'Задание';

    const kb = [[
      { text: '1⭐', callback_data: `rev_set_${taskId}_${playerId}_1` },
      { text: '2⭐', callback_data: `rev_set_${taskId}_${playerId}_2` },
      { text: '3⭐', callback_data: `rev_set_${taskId}_${playerId}_3` },
      { text: '4⭐', callback_data: `rev_set_${taskId}_${playerId}_4` },
      { text: '5⭐', callback_data: `rev_set_${taskId}_${playerId}_5` },
    ], [
      { text: '🔙 Назад', callback_data: 'reviews_pending' },
    ]];

    await edit(
      `⭐ *Оценка задания*\n\n` +
      `📋 ${title}\n\n` +
      `Выбери оценку от 1 до 5:`,
      'Markdown',
      { inline_keyboard: kb }
    );
    return true;
  }

  // ═══════════ СОХРАНЕНИЕ ОЦЕНКИ ═══════════
  if (data.startsWith('rev_set_')) {
    if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return true; }
    const parts = data.split('_');
    const taskId = parseInt(parts[2], 10);
    const playerId = parseInt(parts[3], 10);
    const rating = parseInt(parts[4], 10);

    const result = await createReview({
      taskId,
      reviewerId: user.id,
      playerId,
      rating,
      comment: null,
    });

    if (!result.ok) {
      await edit(
        `❌ *${result.error}*`,
        'Markdown',
        { inline_keyboard: [[{ text: '🔙 К профилю', callback_data: 'profile' }]] }
      );
      return true;
    }

    const stars = '⭐'.repeat(rating);
    await edit(
      `✅ *Спасибо за отзыв!*\n\n` +
      `Оценка: ${stars} (${rating}/5)\n\n` +
      `_Хочешь добавить комментарий? В Mini App можно оставить с текстом._`,
      'Markdown',
      { inline_keyboard: [[{ text: '🔙 К профилю', callback_data: 'profile' }]] }
    );
    return true;
  }

  // ═══════════ ПРОЧИЕ ═══════════

  if (data === 'stats') {
    if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return true; }
    try {
      const rank = await query(`SELECT COUNT(*)::int + 1 AS pos FROM "User" WHERE reputation > $1`, [user.reputation]);
      const tc = await query(`SELECT COUNT(*)::int AS c FROM "Task" WHERE "creatorId"=$1`, [user.id]);
      const td = await query(`SELECT COUNT(*)::int AS c FROM "Task" WHERE "playerId"=$1 AND status='approved'`, [user.id]);
      const e = await query(`SELECT COALESCE(SUM(amount),0)::int AS s FROM "Transaction" WHERE "userId"=$1 AND amount > 0`, [user.id]);
      const s = await query(`SELECT COALESCE(SUM(amount),0)::int AS s FROM "Transaction" WHERE "userId"=$1 AND amount < 0`, [user.id]);
      const q = await query(`SELECT COUNT(*)::int AS c FROM "UserDailyQuest" WHERE "userId"=$1 AND date = CURRENT_DATE AND completed = true`, [user.id]);
      const tq = await query(`SELECT COUNT(*)::int AS c FROM "DailyQuest"`);
      const ac = await query(`SELECT COUNT(*)::int AS c FROM "UserAchievement" WHERE "userId"=$1`, [user.id]);
      const re = await query(`SELECT COALESCE(SUM(amount),0)::int AS s FROM "ReferralEarning" WHERE "userId"=$1`, [user.id]);

      const text =
        `📈 *Статистика ${user.displayName || user.name}*\n\n` +
        `🎖 Уровень: *${user.level || 1}* (${user.experience || 0} XP)\n` +
        `🏅 Место: *#${rank.rows[0].pos}*\n` +
        `⭐ Репутация: *${user.reputation}*\n` +
        `🔥 Streak: *${user.loginStreak} дн.*\n` +
        `🎖 Достижений: *${ac.rows[0].c}*\n\n` +
        `🎨 Создано заданий: *${tc.rows[0].c}*\n` +
        `✅ Выполнено заданий: *${td.rows[0].c}*\n` +
        `📅 Квестов сегодня: *${q.rows[0].c}/${tq.rows[0].c}*\n\n` +
        `📥 Всего заработано: *${e.rows[0].s} ₽*\n` +
        `📤 Всего потрачено: *${Math.abs(s.rows[0].s)} ₽*\n` +
        `💸 Реферальные: *${re.rows[0].s} ₽*\n`;

      await edit(text, 'Markdown', {
        inline_keyboard: [
          [{ text: '📊 Профиль', callback_data: 'profile' }],
          [{ text: '🏆 Рейтинг', callback_data: 'leaderboard' }],
          [{ text: '🔙 Назад', callback_data: 'menu' }],
        ],
      });
    } catch (e) {
      console.error(e);
      await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
    }
    return true;
  }

  if (data === 'achievements') {
    if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return true; }
    try {
      const r = await query(
        `SELECT a.name, a.description, a.icon, a.reward, ua."unlockedAt"
         FROM "Achievement" a
         LEFT JOIN "UserAchievement" ua ON ua."achievementId" = a.id AND ua."userId" = $1
         ORDER BY ua."unlockedAt" DESC NULLS LAST`,
        [user.id]
      );
      if (r.rows.length === 0) {
        await edit('🎖 *Достижений пока нет.*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
        return true;
      }
      let text = '🎖 *Достижения:*\n\n';
      let unlocked = 0;
      r.rows.forEach(a => {
        const isU = a.unlockedAt !== null;
        if (isU) unlocked++;
        text += `${isU ? '✅' : '🔒'} ${a.icon || '🏅'} *${a.name}*\n   ${a.description}\n   🎁 ${a.reward} ₽\n\n`;
      });
      text = `🎖 *Достижения:* ${unlocked}/${r.rows.length}\n\n` + text;
      await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
    } catch (e) {
      console.error(e);
      await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
    }
    return true;
  }

  if (data === 'quests') {
    if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return true; }
    try {
      const all = await query(`SELECT id, description, reward, "requirementValue" FROM "DailyQuest"`);
      if (all.rows.length === 0) {
        await edit('📅 *Квестов пока нет.*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
        return true;
      }
      const progress = await query(
        `SELECT "questId", progress, completed FROM "UserDailyQuest"
         WHERE "userId"=$1 AND date = CURRENT_DATE`,
        [user.id]
      );
      const progressMap = {};
      progress.rows.forEach(p => { progressMap[p.questId] = p; });

      let text = '📅 *Ежедневные квесты*\n_Сброс в 00:00 МСК_\n\n';
      let totalDone = 0;
      all.rows.forEach(q => {
        const p = progressMap[q.id];
        const prog = p?.progress || 0;
        const isDone = p?.completed || false;
        if (isDone) totalDone++;
        const pct = Math.min(Math.round((prog / q.requirementValue) * 100), 100);
        const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
        text += `${isDone ? '✅' : '🔸'} *${q.description}*\n   ${bar} ${prog}/${q.requirementValue}\n   🎁 ${q.reward} ₽\n\n`;
      });
      text = `📅 *Квесты:* ${totalDone}/${all.rows.length}\n\n` + text;
      await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
    } catch (e) {
      console.error(e);
      await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
    }
    return true;
  }

  if (data === 'leaderboard') {
    try {
      const r = await query('SELECT name, "displayName", reputation, level FROM "User" ORDER BY reputation DESC LIMIT 10');
      let text = '🏆 *Топ по репутации:*\n\n';
      r.rows.forEach((u, i) => {
        const m = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        text += `${m} ${u.displayName || u.name} — ⭐ ${u.reputation} (ур.${u.level || 1})\n`;
      });
      await edit(text, 'Markdown', {
        inline_keyboard: [
          [{ text: '💰 По балансу', callback_data: 'leaderboard_balance' }],
          [{ text: '📅 Топ недели', callback_data: 'leaderboard_week' }],
          [{ text: '⭐ По отзывам', callback_data: 'leaderboard_rating' }],
          [{ text: '🔙 Назад', callback_data: 'menu' }],
        ],
      });
    } catch (e) {
      console.error(e);
      await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
    }
    return true;
  }

  if (data === 'leaderboard_balance') {
    try {
      const r = await query('SELECT name, "displayName", balance, level FROM "User" ORDER BY balance DESC LIMIT 10');
      let text = '💰 *Топ по балансу:*\n\n';
      r.rows.forEach((u, i) => {
        const m = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        text += `${m} ${u.displayName || u.name} — 💰 ${u.balance} ₽ (ур.${u.level || 1})\n`;
      });
      await edit(text, 'Markdown', {
        inline_keyboard: [
          [{ text: '⭐ По репутации', callback_data: 'leaderboard' }],
          [{ text: '📅 Топ недели', callback_data: 'leaderboard_week' }],
          [{ text: '⭐ По отзывам', callback_data: 'leaderboard_rating' }],
          [{ text: '🔙 Назад', callback_data: 'menu' }],
        ],
      });
    } catch (e) {
      console.error(e);
      await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
    }
    return true;
  }

  if (data === 'leaderboard_week') {
    try {
      const r = await query(
        `SELECT u.name, u."displayName", COALESCE(SUM(t.amount),0)::int AS earned
         FROM "User" u
         LEFT JOIN "Transaction" t ON t."userId" = u.id
           AND t.amount > 0
           AND t."createdAt" >= NOW() - INTERVAL '7 days'
         GROUP BY u.id, u.name, u."displayName"
         ORDER BY earned DESC LIMIT 10`
      );
      let text = '📅 *Топ недели:*\n\n';
      r.rows.forEach((u, i) => {
        const m = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        text += `${m} ${u.displayName || u.name} — +${u.earned} ₽\n`;
      });
      await edit(text, 'Markdown', {
        inline_keyboard: [
          [{ text: '⭐ По репутации', callback_data: 'leaderboard' }],
          [{ text: '💰 По балансу', callback_data: 'leaderboard_balance' }],
          [{ text: '⭐ По отзывам', callback_data: 'leaderboard_rating' }],
          [{ text: '🔙 Назад', callback_data: 'menu' }],
        ],
      });
    } catch (e) {
      console.error(e);
      await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
    }
    return true;
  }

  if (data === 'leaderboard_rating') {
    try {
      const r = await query(
        `SELECT name, "displayName", "ratingAvg", "ratingCount", level
         FROM "User"
         WHERE "ratingCount" >= 3 AND "isBanned" = false
         ORDER BY "ratingAvg" DESC, "ratingCount" DESC
         LIMIT 10`
      );
      if (r.rows.length === 0) {
        await edit(
          '⭐ *Топ по отзывам*\n\n_Пока нет игроков с 3+ отзывами._',
          'Markdown',
          { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'leaderboard' }]] }
        );
        return true;
      }
      let text = '⭐ *Топ по отзывам:*\n\n';
      r.rows.forEach((u, i) => {
        const m = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        text += `${m} ${u.displayName || u.name} — ⭐ ${u.ratingAvg} (${u.ratingCount} отз.)\n`;
      });
      await edit(text, 'Markdown', {
        inline_keyboard: [
          [{ text: '⭐ По репутации', callback_data: 'leaderboard' }],
          [{ text: '💰 По балансу', callback_data: 'leaderboard_balance' }],
          [{ text: '📅 Топ недели', callback_data: 'leaderboard_week' }],
          [{ text: '🔙 Назад', callback_data: 'menu' }],
        ],
      });
    } catch (e) {
      console.error(e);
      await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
    }
    return true;
  }

  if (data === 'wallet') {
    if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return true; }
    try {
      const r = await query(
        'SELECT "createdAt", amount, reason FROM "Transaction" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 5',
        [user.id]
      );
      let text = `💳 *Кошелёк*\n\n💰 Баланс: ${user.balance} ₽\n\n📊 *Последние транзакции:*\n`;
      if (r.rows.length === 0) text += 'Нет транзакций.';
      else r.rows.forEach(t => {
        text += `${new Date(t.createdAt).toLocaleDateString()} ${t.amount > 0 ? '+' : ''}${t.amount} ₽ — ${t.reason}\n`;
      });
      await edit(text, 'Markdown', {
        inline_keyboard: [
          [{ text: '📈 Полная история', callback_data: 'transactions' }],
          [{ text: '🔙 Назад', callback_data: 'menu' }],
        ],
      });
    } catch (e) {
      console.error(e);
      await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
    }
    return true;
  }

  if (data === 'transactions') {
    if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return true; }
    try {
      const r = await query(
        'SELECT "createdAt", amount, reason FROM "Transaction" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 20',
        [user.id]
      );
      let text = '📊 *История транзакций:*\n\n';
      if (r.rows.length === 0) text += 'Нет транзакций.';
      else r.rows.forEach(t => {
        text += `${new Date(t.createdAt).toLocaleDateString()} ${t.amount > 0 ? '+' : ''}${t.amount} ₽ — ${t.reason}\n`;
      });
      await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'wallet' }]] });
    } catch (e) {
      console.error(e);
      await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'wallet' }]] });
    }
    return true;
  }

  if (data === 'daily') {
    if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return true; }
    const now = new Date();
    const last = user.lastDailyBonusAt ? new Date(user.lastDailyBonusAt) : null;
    const hoursSince = last ? (now - last) / 3600000 : 24;
    if (hoursSince < 24) {
      await edit(`⏳ *Бонус уже получен.*\nСледующий через ${Math.ceil(24 - hoursSince)} ч.`, 'Markdown', {
        inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]],
      });
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

    const streakMsg = streakContinues
      ? `🔥 Streak: *${newStreak}* дн. (×${mult})`
      : `🔥 Streak: *1* дн. (начинаем заново)`;

    await edit(
      `🎁 *Бонус получен!*\n\n💰 +${bonus} ₽ (базовый ${baseBonus} × ${mult})\n${streakMsg}\n_+15 XP_\n\nБаланс: ${user.balance + bonus} ₽`,
      'Markdown',
      { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] }
    );
    await notifyLevelUp(user.id, xpRes, ctx.sendMessage);
    await notifyAchievements(user.id, achs, ctx.sendMessage);
    return true;
  }

  if (data === 'referral') {
    if (!user) { await edit('❌', 'Markdown', { inline_keyboard: [] }); return true; }
    let code = user.referralCode;
    if (!code) {
      code = Math.random().toString(36).substring(2, 8).toUpperCase();
      await query('UPDATE "User" SET "referralCode"=$1 WHERE id=$2', [code, user.id]);
    }
    const lvl1 = await query('SELECT COUNT(*)::int AS c FROM "User" WHERE "referredBy"=$1', [user.id]);
    const lvl2 = await query(
      `SELECT COUNT(*)::int AS c FROM "User" u
       WHERE u."referredBy" IN (SELECT id FROM "User" WHERE "referredBy"=$1)`,
      [user.id]
    );
    const lvl3 = await query(
      `SELECT COUNT(*)::int AS c FROM "User" u
       WHERE u."referredBy" IN (
         SELECT id FROM "User" WHERE "referredBy" IN (
           SELECT id FROM "User" WHERE "referredBy"=$1
         )
       )`,
      [user.id]
    );
    const totalEarned = await query(
      `SELECT COALESCE(SUM(amount),0)::int AS s FROM "ReferralEarning" WHERE "userId"=$1`,
      [user.id]
    );

    const text =
      `🔗 *Реферальная программа*\n\n` +
      `Ваш код: *${code}*\n` +
      `Ссылка: https://nerv.vercel.app/signup?ref=${code}\n\n` +
      `📊 *Ваша сеть:*\n` +
      `├ Уровень 1: *${lvl1.rows[0].c}* × 50 ₽\n` +
      `├ Уровень 2: *${lvl2.rows[0].c}* × 25 ₽\n` +
      `└ Уровень 3: *${lvl3.rows[0].c}* × 10 ₽\n\n` +
      `💰 *Всего заработано:* ${totalEarned.rows[0].s} ₽\n\n` +
      `_Бонус начисляется один раз, когда ваш реферал выполняет первое задание._`;

    await edit(text, 'Markdown', { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'menu' }]] });
    return true;
  }

  return false;
};

module.exports = { handleProfileCallback };