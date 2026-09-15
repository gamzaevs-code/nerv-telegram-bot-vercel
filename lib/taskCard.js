const { query } = require('./db');
const { calcCommission } = require('./helpers');

// Разделитель в стиле киберпанк
const DIV = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';

// Прогресс-бар для голосования
const votesBar = (approve, needed = 5) => {
  const filled = Math.min(approve, needed);
  const empty = Math.max(needed - filled, 0);
  return '▰'.repeat(filled) + '▱'.repeat(empty) + ` ${approve}/${needed}`;
};

// Таймер до дедлайна
const timeUntil = (deadline) => {
  if (!deadline) return null;
  const now = new Date();
  const d = new Date(deadline);
  const diff = d - now;
  if (diff <= 0) return '⌛ истёк';

  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);

  if (days > 0) return `${days}д ${hours}ч`;
  if (hours > 0) return `${hours}ч ${mins}м`;
  return `${mins}м`;
};

// Статус с эмодзи и текстом
const statusInfo = (status) => {
  switch (status) {
    case 'open':     return { emoji: '🟢', label: 'ОТКРЫТО', color: '🟢' };
    case 'taken':    return { emoji: '🟡', label: 'ВЗЯТО', color: '🟡' };
    case 'voting':   return { emoji: '🗳', label: 'ГОЛОСОВАНИЕ', color: '🔵' };
    case 'approved': return { emoji: '✅', label: 'ВЫПОЛНЕНО', color: '🟢' };
    case 'rejected': return { emoji: '❌', label: 'ОТКЛОНЕНО', color: '🔴' };
    default:         return { emoji: '⚪', label: 'НЕИЗВЕСТНО', color: '⚪' };
  }
};

// Обрезаем длинный текст
const truncate = (str, max = 200) => {
  if (!str) return '—';
  return str.length > max ? str.slice(0, max) + '...' : str;
};

// ========== РЕНДЕР КАРТОЧКИ ==========

const renderTaskCard = (task, viewer = null) => {
  const t = task;
  const status = statusInfo(t.status);
  const comm = calcCommission(t.reward);
  const approve = t.approve || 0;
  const reject = t.reject || 0;

  const creatorName = t.creatorDisplay || t.creator || 'Аноним';
  const playerName = t.playerDisplay || t.player;

  let text = `⚡ *ЗАДАНИЕ #${t.id}* ⚡\n`;
  text += `${DIV}\n\n`;
  text += `📌 *${t.title}*\n\n`;
  text += `📝 ${truncate(t.description, 400)}\n\n`;
  text += `${DIV}\n`;

  // Финансы
  text += `💰 Награда: *${t.reward} ₽*\n`;
  text += `💵 Игроку: *${comm.netAmount} ₽*\n`;
  text += `🔻 Комиссия: ${comm.commission} ₽ _(11%)_\n`;

  // Игрок — если есть
  if (playerName) {
    text += `${DIV}\n`;
    text += `🎮 Игрок: *${playerName}*\n`;
  }

  text += `${DIV}\n`;

  // Статус и метрики
  text += `${status.color} Статус: *${status.label}*\n`;

  if (t.status === 'voting' || approve > 0 || reject > 0) {
    text += `🗳 Голоса: \`${votesBar(approve)}\`\n`;
    if (reject > 0) text += `👎 Против: ${reject}\n`;
  }

  if (t.deadlineAt) {
    const tLeft = timeUntil(t.deadlineAt);
    if (tLeft) text += `⏱ Дедлайн: *${tLeft}*\n`;
  }

  // Создатель
  text += `${DIV}\n`;
  text += `👤 Создатель: ${creatorName}\n`;

  // Видео
  if (t.videoUrl) {
      text += `🎬 _Видео-выполнение загружено_\n`;
  }

  text += `${DIV}`;

  return {
    text,
    approve,
    reject,
    status,
  };
};

// ========== КЛАВИАТУРА КАРТОЧКИ ==========

const buildTaskKeyboard = (task, viewer) => {
  const t = task;
  const buttons = [];
  const isPlayer = viewer && viewer.role === 'player';
  const isModerator = viewer && (viewer.isModerator || viewer.role === 'admin');
  const canTake = t.status === 'open' && isPlayer && !t.playerId;

  // Главное действие
  if (canTake) {
    buttons.push([{ text: '⚡ ВЗЯТЬ ЗАДАНИЕ', callback_data: `take_${t.id}` }]);
  }

  // Управление игрока (отказ)
  if (t.status === 'taken' && viewer && t.playerId === viewer.id) {
    buttons.push([{ text: '↩️ Отказаться', callback_data: `abandon_${t.id}` }]);
  }

  // Голосование
  if (t.status === 'voting' && viewer) {
    buttons.push([
      { text: '✅ ЗА', callback_data: `vote_${t.id}_approve` },
      { text: '❌ ПРОТИВ', callback_data: `vote_${t.id}_reject` },
    ]);
  }

  // Второстепенные действия
  const secondary = [];
  if (viewer) {
    secondary.push({ text: '🚨', callback_data: `report_task_${t.id}` });
  }
  if (isModerator) {
    secondary.push({ text: '👮', callback_data: `mod_task_${t.id}` });
  }
  secondary.push({
    text: '📤',
    url: `https://t.me/share/url?url=${encodeURIComponent(`https://t.me/nerv_05bot?start=task_${t.id}`)}&text=${encodeURIComponent(`Задание: ${t.title}`)}`,
  });
  if (secondary.length > 0) buttons.push(secondary);

  // Навигация
  buttons.push([
    { text: '◀ СПИСОК', callback_data: 'tasks' },
    { text: '◀ МЕНЮ', callback_data: 'menu' },
  ]);

  return { inline_keyboard: buttons };
};

// ========== ЗАГРУЗКА ЗАДАНИЯ С ДАННЫМИ ==========

const getTaskWithDetails = async (taskId) => {
  try {
    const r = await query(
      `SELECT t.*,
              u.name AS creator,
              u."displayName" AS "creatorDisplay",
              p.name AS player,
              p."displayName" AS "playerDisplay"
       FROM "Task" t
       JOIN "User" u ON t."creatorId" = u.id
       LEFT JOIN "User" p ON t."playerId" = p.id
       WHERE t.id = $1`,
      [taskId]
    );
    if (r.rows.length === 0) return null;
    const task = r.rows[0];

    // Подтягиваем голоса
    const vr = await query(
      `SELECT value, COUNT(*)::int AS cnt FROM "Vote" WHERE "taskId"=$1 GROUP BY value`,
      [taskId]
    );
    task.approve = vr.rows.find(x => x.value === 'approve')?.cnt || 0;
    task.reject = vr.rows.find(x => x.value === 'reject')?.cnt || 0;

    return task;
  } catch (e) {
    console.error('getTaskWithDetails:', e);
    return null;
  }
};

module.exports = {
  renderTaskCard,
  buildTaskKeyboard,
  getTaskWithDetails,
  DIV,
  votesBar,
  timeUntil,
  statusInfo,
};