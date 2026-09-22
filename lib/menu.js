const buildMainMenu = (user) => {
  const isAdmin = user && user.role === 'admin';
  const isModerator = user && (user.isModerator || user.role === 'admin');

  const keyboard = [
    [
      { text: '📊 Профиль', callback_data: 'profile' },
      { text: '🎖 Достижения', callback_data: 'achievements' },
    ],
    [{ text: '📋 Доступные задания', callback_data: 'tasks' }],
    [
      { text: '📝 Мои задания', callback_data: 'my_tasks' },
      { text: '🎨 Мои созданные', callback_data: 'my_created' },
    ],
    [
      { text: '🏆 Турнир', callback_data: 'menu_tournament' },
      { text: '🎁 Бонус', callback_data: 'daily' },
    ],
    [
      { text: '🛒 Магазин', callback_data: 'shop' },
      { text: '🎒 Мои покупки', callback_data: 'my_items' },
    ],
    [
      { text: '💰 Кошелёк', callback_data: 'wallet' },
      { text: '➕ Создать', callback_data: 'create' },
    ],
    [
      { text: '🏅 Рейтинг', callback_data: 'leaderboard' },
      { text: '📅 Квесты', callback_data: 'quests' },
    ],
    [
      { text: '📈 Статистика', callback_data: 'stats' },
      { text: '🔗 Рефералы', callback_data: 'referral' },
    ],
    [
      { text: '👥 Игроки', callback_data: 'players_menu' },
      { text: '💬 Сообщения', callback_data: 'inbox' },
    ],
    [
      { text: '💡 Поддержка', callback_data: 'support' },
      { text: 'ℹ️ О боте', callback_data: 'about' },
    ],
    [{ text: '❓ Помощь', callback_data: 'help' }],
  ];

  if (isAdmin) {
    keyboard.push([{ text: '⚙️ Админ-панель', callback_data: 'admin_panel' }]);
  }
  if (isModerator) {
    keyboard.push([{ text: '👮 Модерация', callback_data: 'mod_panel' }]);
  }

  return { inline_keyboard: keyboard };
};

module.exports = { buildMainMenu };