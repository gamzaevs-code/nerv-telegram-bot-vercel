const { query } = require('./db');
const { buildMainMenu } = require('./menu');

// ========== CALLBACK HANDLERS ==========

const handleRoleCallback = async (data, ctx) => {
  const { edit, user, chatId } = ctx;

  if (data === 'choose_role_player' || data === 'choose_role_viewer') {
    if (!user) {
      await edit('❌ *Сначала привяжи аккаунт.* /link your@email.com', 'Markdown', { inline_keyboard: [] });
      return true;
    }

    const newRole = data === 'choose_role_player' ? 'player' : 'viewer';
    await query(
      'UPDATE "User" SET role=$1, "roleChosen"=true WHERE id=$2',
      [newRole, user.id]
    );

    const text = newRole === 'player'
      ? `✅ *Ты теперь ИГРОК!* 🎮\n\n*Что тебе доступно:*\n• 🎯 Брать задания из списка\n• 🎬 Загружать видео-выполнения\n• 💰 Получать награды\n• ⚡ Использовать бусты\n\n_Начни с «📋 Доступные задания»._`
      : `✅ *Ты теперь ЗРИТЕЛЬ!* 👁\n\n*Что тебе доступно:*\n• ➕ Создавать задания\n• 🗳️ Голосовать за выполнение\n• 💎 Нанимать игроков\n• 🎁 Получать достижения\n\n_Начни с «➕ Создать»._`;

    await edit(
      text,
      'Markdown',
      {
        inline_keyboard: [
          [{ text: '🤖 Открыть меню', callback_data: 'menu' }],
        ],
      }
    );
    return true;
  }

  if (data === 'change_role') {
    if (!user) {
      await edit('❌ *Привяжи аккаунт*', 'Markdown', { inline_keyboard: [] });
      return true;
    }

    const currentRole = user.role === 'player' ? '🎮 Игрок' : '👁 Зритель';
    await edit(
      `🎭 *Смена роли*\n\nСейчас ты: *${currentRole}*\n\nВыбери новую роль:`,
      'Markdown',
      {
        inline_keyboard: [
          [{ text: '🎮 Стать игроком', callback_data: 'choose_role_player' }],
          [{ text: '👁 Стать зрителем', callback_data: 'choose_role_viewer' }],
          [{ text: '🔙 Назад', callback_data: 'profile' }],
        ],
      }
    );
    return true;
  }

  return false;
};

module.exports = { handleRoleCallback };