// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// NERV MINI APP — логика фронтенда
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬

const tg = window.Telegram?.WebApp;
let currentUser = null;

// ========== ИНИЦИАЛИЗАЦИЯ ==========
const init = async () => {
  try {
    // Проверяем, что мы внутри Telegram
    if (!tg) {
      showError('Открой это приложение через бота @nerv_05bot');
      return;
    }

    tg.ready();
    tg.expand();

    // Настраиваем тему под Telegram
    tg.setHeaderColor('#0a0e1a');
    tg.setBackgroundColor('#0a0e1a');

    // Отправляем initData на бэк для авторизации
    const initData = tg.initData;
    if (!initData) {
      showError('Нет данных авторизации. Открой приложение заново.');
      return;
    }

    const response = await fetch('/api/app/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.error || 'Авторизация не удалась');
    }

    currentUser = data.user;
    renderUser(currentUser);
    showApp();
  } catch (e) {
    console.error('init error:', e);
    showError(e.message || 'Ошибка подключения');
  }
};

// ========== РЕНДЕР ==========
const renderUser = (user) => {
  document.getElementById('user-tag').textContent = `@${user.telegramUsername || 'user'}`;
  document.getElementById('greeting-name').textContent = user.displayName || user.name;
  document.getElementById('stat-balance').textContent = `${user.balance} ₽`;
  document.getElementById('stat-level').textContent = user.level || 1;
  document.getElementById('stat-reputation').textContent = user.reputation || 0;
};

// ========== UI ==========
const showApp = () => {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
};

const showError = (msg) => {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('error').classList.remove('hidden');
  document.getElementById('error-text').textContent = msg;
};

// ========== ТАБЫ ==========
document.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;

  const tabName = tab.dataset.tab;

  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');

  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  const content = document.getElementById(`tab-${tabName}`);
  if (content) content.classList.add('active');
});

// ========== СТАРТ ==========
document.addEventListener('DOMContentLoaded', init);