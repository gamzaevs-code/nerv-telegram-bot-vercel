const { query } = require('./db');
const { aiModerateContent, logModeration } = require('./ai');

// ========== CALLBACK HANDLERS ==========

const handleModerationCallback = async (data, ctx) => {
  const { edit, user, chatId, isModerator, userState, sendMessage } = ctx;

  if (data === 'mod_panel') {
    if (!isModerator) {
      await edit('⛔ *Доступ запрещён.*', 'Markdown', { inline_keyboard: [] });
      return true;
    }
    try {
      const openReports = await query(`SELECT COUNT(*)::int AS c FROM "Report" WHERE status='pending'`);
      const pendingTasks = await query(`SELECT COUNT(*)::int AS c FROM "Task" WHERE status='voting'`);
      const text =
        `👮 *Модератор-панель*\n\n` +
        `🚨 Открытых жалоб: *${openReports.rows[0].c}*\n` +
        `⏳ Заданий на модерации: *${pendingTasks.rows[0].c}*\n`;
      await edit(text, 'Markdown', {
        inline_keyboard: [
          [{ text: '🚨 Открытые жалобы', callback_data: 'mod_reports' }],
          [{ text: '⏳ Задания на модерации', callback_data: 'mod_pending' }],
          [{ text: '🔙 Назад', callback_data: 'menu' }],
        ],
      });
    } catch (e) {
      console.error(e);
      await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
    }
    return true;
  }

  if (data === 'mod_reports') {
    if (!isModerator) {
      await edit('⛔', 'Markdown', { inline_keyboard: [] });
      return true;
    }
    try {
      const r = await query(
        `SELECT r.id, r."targetId", r.reason, r."createdAt", u.name AS reporter
         FROM "Report" r JOIN "User" u ON r."reporterId" = u.id
         WHERE r.status='pending' ORDER BY r."createdAt" DESC LIMIT 10`
      );
      if (r.rows.length === 0) {
        await edit('📭 *Открытых жалоб нет.*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'mod_panel' }]] });
        return true;
      }
      let text = '🚨 *Открытые жалобы:*\n\n';
      const buttons = [];
      r.rows.forEach(rep => {
        text += `#${rep.id} → Задание #${rep.targetId}\n`;
        text += `👤 ${rep.reporter}: ${rep.reason}\n\n`;
        buttons.push([
          { text: `📌 Задание #${rep.targetId}`, callback_data: `task_${rep.targetId}` },
          { text: '✅ Закрыть', callback_data: `report_resolve_${rep.id}` },
        ]);
      });
      buttons.push([{ text: '🔙 Назад', callback_data: 'mod_panel' }]);
      await edit(text, 'Markdown', { inline_keyboard: buttons });
    } catch (e) {
      console.error(e);
      await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'mod_panel' }]] });
    }
    return true;
  }

  if (data.startsWith('report_resolve_')) {
    const reportId = parseInt(data.split('_')[2]);
    if (!isModerator) {
      await edit('⛔', 'Markdown', { inline_keyboard: [] });
      return true;
    }
    try {
      await query(
        `UPDATE "Report" SET status='resolved', "resolvedAt"=NOW() WHERE id=$1`,
        [reportId]
      );
      await query(
        `INSERT INTO "ModeratorLog" ("moderatorId", action, "targetId", reason, "createdAt")
         VALUES ($1,'resolve_report',$2,'Жалоба обработана',NOW())`,
        [user.id, reportId]
      );
      await edit(
        `✅ *Жалоба #${reportId} закрыта*`,
        'Markdown',
        {
          inline_keyboard: [
            [{ text: '🚨 К жалобам', callback_data: 'mod_reports' }],
            [{ text: '🔙 Меню', callback_data: 'menu' }],
          ],
        }
      );
    } catch (e) {
      console.error(e);
      await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'mod_panel' }]] });
    }
    return true;
  }

  if (data === 'mod_pending') {
    if (!isModerator) {
      await edit('⛔', 'Markdown', { inline_keyboard: [] });
      return true;
    }
    try {
      const r = await query(
        `SELECT id, title, reward FROM "Task"
         WHERE status='voting' ORDER BY "updatedAt" DESC LIMIT 15`
      );
      if (r.rows.length === 0) {
        await edit('📭 *Нет заданий на модерации.*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'mod_panel' }]] });
        return true;
      }
      const buttons = r.rows.map(t => [
        { text: `📌 ${t.title} (${t.reward}₽)`, callback_data: `mod_task_${t.id}` },
      ]);
      buttons.push([{ text: '🔙 Назад', callback_data: 'mod_panel' }]);
      await edit('⏳ *Задания на модерации:*', 'Markdown', { inline_keyboard: buttons });
    } catch (e) {
      console.error(e);
      await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'mod_panel' }]] });
    }
    return true;
  }

  if (data.startsWith('mod_task_')) {
    const taskId = parseInt(data.split('_')[2]);
    if (!isModerator) {
      await edit('⛔', 'Markdown', { inline_keyboard: [] });
      return true;
    }
    try {
      const r = await query(`SELECT id, title, status FROM "Task" WHERE id=$1`, [taskId]);
      if (r.rows.length === 0) {
        await edit('❌ *Не найдено*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
        return true;
      }
      const t = r.rows[0];
      await edit(
        `👮 *Модерация задания #${t.id}*\n\n📌 ${t.title}\n📊 Статус: ${t.status}`,
        'Markdown',
        {
          inline_keyboard: [
            [{ text: '🤖 AI-проверка', callback_data: `mod_ai_${t.id}` }],
            [{ text: '✅ Одобрить', callback_data: `mod_approve_${t.id}` }],
            [{ text: '❌ Отклонить', callback_data: `mod_reject_${t.id}` }],
            [{ text: '🗑 Удалить', callback_data: `mod_delete_${t.id}` }],
            [{ text: '🔙 Назад', callback_data: `task_${t.id}` }],
          ],
        }
      );
    } catch (e) {
      console.error(e);
      await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
    }
    return true;
  }

  if (data.startsWith('mod_ai_')) {
    const taskId = parseInt(data.split('_')[2]);
    if (!isModerator) {
      await edit('⛔', 'Markdown', { inline_keyboard: [] });
      return true;
    }
    try {
      const r = await query(`SELECT title, description FROM "Task" WHERE id=$1`, [taskId]);
      if (r.rows.length === 0) {
        await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
        return true;
      }
      const t = r.rows[0];
      await edit('🤖 *Отправляю в GigaChat...*', 'Markdown', { inline_keyboard: [] });
      const mod = await aiModerateContent(t.title, t.description);
      const verdict = mod.ok ? '✅ Контент безопасен' : `🚫 Нарушение: ${mod.reason}`;
      await logModeration(user.id, taskId, 'task_text_manual', `MANUAL: ${mod.reason || 'ok'}`, mod.ok ? 'APPROVED' : 'REJECTED');
      await edit(
        `🤖 *AI-проверка задания #${taskId}*\n\n${verdict}`,
        'Markdown',
        { inline_keyboard: [[{ text: '🔙 К модерации', callback_data: `mod_task_${taskId}` }]] }
      );
    } catch (e) {
      console.error(e);
      await edit('❌ *Ошибка AI*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: `mod_task_${taskId}` }]] });
    }
    return true;
  }

  if (data.startsWith('mod_approve_')) {
    const taskId = parseInt(data.split('_')[2]);
    if (!isModerator) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return true; }
    try {
      await query(`UPDATE "Task" SET status='approved' WHERE id=$1`, [taskId]);
      await query(
        `INSERT INTO "ModeratorLog" ("moderatorId", action, "targetId", reason, "createdAt")
         VALUES ($1,'approve_task',$2,'Ручное одобрение',NOW())`,
        [user.id, taskId]
      );
      await edit(`✅ *Задание #${taskId} одобрено*`, 'Markdown', { inline_keyboard: [[{ text: '🔙 Меню', callback_data: 'menu' }]] });
    } catch (e) {
      console.error(e);
      await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
    }
    return true;
  }

  if (data.startsWith('mod_reject_')) {
    const taskId = parseInt(data.split('_')[2]);
    if (!isModerator) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return true; }
    try {
      await query(`UPDATE "Task" SET status='rejected' WHERE id=$1`, [taskId]);
      await query(
        `INSERT INTO "ModeratorLog" ("moderatorId", action, "targetId", reason, "createdAt")
         VALUES ($1,'reject_task',$2,'Ручное отклонение',NOW())`,
        [user.id, taskId]
      );
      await edit(`❌ *Задание #${taskId} отклонено*`, 'Markdown', { inline_keyboard: [[{ text: '🔙 Меню', callback_data: 'menu' }]] });
    } catch (e) {
      console.error(e);
      await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
    }
    return true;
  }

  if (data.startsWith('mod_delete_')) {
    const taskId = parseInt(data.split('_')[2]);
    if (!isModerator) { await edit('⛔', 'Markdown', { inline_keyboard: [] }); return true; }
    try {
      await query(`DELETE FROM "Task" WHERE id=$1`, [taskId]);
      await query(
        `INSERT INTO "ModeratorLog" ("moderatorId", action, "targetId", reason, "createdAt")
         VALUES ($1,'delete_task',$2,'Удалено модератором',NOW())`,
        [user.id, taskId]
      );
      await edit(`🗑 *Задание #${taskId} удалено*`, 'Markdown', { inline_keyboard: [[{ text: '🔙 Меню', callback_data: 'menu' }]] });
    } catch (e) {
      console.error(e);
      await edit('❌', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
    }
    return true;
  }

  if (data.startsWith('report_task_')) {
    const taskId = parseInt(data.split('_')[2]);
    if (!user) {
      await edit('❌ *Сначала привяжи аккаунт*', 'Markdown', { inline_keyboard: [[{ text: '🔙', callback_data: 'menu' }]] });
      return true;
    }
    userState[chatId] = { step: 'report_reason', taskId };
    await edit(
      '🚨 *Жалоба на задание*\n\nОпиши причину одним сообщением.\n\n_Примеры: «спам», «нарушение правил»_\n\n📌 Отмена — /menu',
      'Markdown',
      { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'menu' }]] }
    );
    return true;
  }

  return false;
};

module.exports = { handleModerationCallback };
