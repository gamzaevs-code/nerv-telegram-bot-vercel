// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// NERV MINI APP — логика фронтенда
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬

const tg = window.Telegram?.WebApp;
let initData = '';
let currentUser = null;

// ========== ИНИЦИАЛИЗАЦИЯ ==========
const init = async () => {
  try {
    if (!tg) {
      showError('Открой это приложение через бота @nerv_05bot');
      return;
    }

    tg.ready();
    tg.expand();
    tg.setHeaderColor('#0a0e1a');
    tg.setBackgroundColor('#0a0e1a');

    initData = tg.initData;
    if (!initData) {
      showError('Нет данных авторизации. Открой заново.');
      return;
    }

    // Авторизация
    const authRes = await fetch('/api/app-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
    });

    if (!authRes.ok) {
      const err = await authRes.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${authRes.status}`);
    }

    const authData = await authRes.json();
    if (!authData.ok) throw new Error(authData.error || 'Авторизация не удалась');

    currentUser = authData.user;
    renderUser(currentUser);

    // Загружаем профиль
    await loadProfile();

    showApp();
  } catch (e) {
    console.error('init error:', e);
    showError(e.message || 'Ошибка подключения');
  }
};

// ========== ЗАГРУЗКА ПРОФИЛЯ ==========
const loadProfile = async () => {
  try {
    const res = await fetch('/api/app-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    const p = data.profile;
    renderProfile(p);
  } catch (e) {
    console.error('loadProfile:', e);
  }
};

// ========== РЕНДЕР ПРОФИЛЯ ==========
const renderProfile = (p) => {
  // Аватар
  document.getElementById('profile-avatar').textContent = p.initials || '?';

  // Имя
  document.getElementById('profile-name').textContent = p.displayName;

  // Роль
  const roleLabels = { player: '🎮 Игрок', viewer: '👁 Зритель', admin: '⚙️ Админ' };
  document.getElementById('profile-role').textContent = roleLabels[p.role] || p.role;

  // VIP
  if (p.isVip) document.getElementById('profile-vip').style.display = '';

  // Модератор
  if (p.isModerator) document.getElementById('profile-mod').style.display = '';

  // Значок
  if (p.badge) {
    const badgeEl = document.getElementById('profile-badge');
    badgeEl.style.display = 'flex';
    badgeEl.textContent = p.badge.name.split(' ')[0] || '🎖';
  }

  // Уровень
  document.getElementById('profile-level').textContent = p.level;
  document.getElementById('profile-exp-progress').textContent = p.expProgress;
  document.getElementById('profile-exp-needed').textContent = p.expNeeded;
  document.getElementById('profile-exp-bar').style.width = `${p.expPercent}%`;

  // Метрики
  document.getElementById('profile-balance').textContent = `${p.balance.toLocaleString('ru')} ₽`;
  document.getElementById('profile-reputation').textContent = p.reputation;
  document.getElementById('profile-rank').textContent = `#${p.rank}`;
  document.getElementById('profile-streak').textContent = `${p.loginStreak} дн.`;

  // Достижения
  document.getElementById('profile-achievements').textContent = `${p.achievements.unlocked} / ${p.achievements.total}`;

  // Рефералы
  document.getElementById('profile-referrals').textContent = p.referralCount;
  document.getElementById('profile-ref-code').textContent = p.referralCode;
};

// ========== РЕНДЕР ПОЛЬЗОВАТЕЛЯ В ХЕДЕРЕ ==========
const renderUser = (user) => {
  document.getElementById('user-tag').textContent = `@${user.telegramUsername || 'user'}`;
};

// ========== КНОПКА "ПОДЕЛИТЬСЯ" ==========
document.addEventListener('click', (e) => {
  if (e.target.id === 'btn-share-ref') {
    const code = document.getElementById('profile-ref-code').textContent;
    const url = `https://t.me/nerv_05bot?start=ref_${code}`;
    const text = `🚀 Присоединяйся к NERV — зарабатывай на выполнении заданий!`;

    if (tg && tg.openTelegramLink) {
      tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
    } else {
      navigator.clipboard.writeText(url);
      tg?.showAlert?.('Ссылка скопирована!');
    }
  }
});

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