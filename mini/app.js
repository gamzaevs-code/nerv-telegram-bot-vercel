// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// NERV MINI APP — логика фронтенда
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬

const tg = window.Telegram?.WebApp;
let initData = '';
let currentUser = null;
let currentFilter = 'all';

// ========== ИНИЦИАЛИЗАЦИЯ ==========
const init = async () => {
  try {
    if (!tg) { showError('Открой через @nerv_05bot'); return; }

    tg.ready();
    tg.expand();
    tg.setHeaderColor('#0a0e1a');
    tg.setBackgroundColor('#0a0e1a');

    initData = tg.initData;
    if (!initData) { showError('Нет данных авторизации'); return; }

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
    if (!authData.ok) throw new Error(authData.error);

    currentUser = authData.user;
    renderUser(currentUser);

    // Загружаем параллельно профиль и задания
    await Promise.all([loadProfile(), loadTasks()]);

    showApp();
  } catch (e) {
    console.error('init error:', e);
    showError(e.message || 'Ошибка подключения');
  }
};

// ========== ПРОФИЛЬ ==========
const loadProfile = async () => {
  try {
    const res = await fetch('/api/app-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.ok) renderProfile(data.profile);
  } catch (e) { console.error('loadProfile:', e); }
};

const renderProfile = (p) => {
  document.getElementById('profile-avatar').textContent = p.initials || '?';
  document.getElementById('profile-name').textContent = p.displayName;

  const roleLabels = { player: '🎮 Игрок', viewer: '👁 Зритель', admin: '⚙️ Админ' };
  document.getElementById('profile-role').textContent = roleLabels[p.role] || p.role;

  if (p.isVip) document.getElementById('profile-vip').style.display = '';
  if (p.isModerator) document.getElementById('profile-mod').style.display = '';

  if (p.badge) {
    const badgeEl = document.getElementById('profile-badge');
    badgeEl.style.display = 'flex';
    badgeEl.textContent = p.badge.name.split(' ')[0] || '🎖';
  }

  document.getElementById('profile-level').textContent = p.level;
  document.getElementById('profile-exp-progress').textContent = p.expProgress;
  document.getElementById('profile-exp-needed').textContent = p.expNeeded;
  document.getElementById('profile-exp-bar').style.width = `${p.expPercent}%`;

  document.getElementById('profile-balance').textContent = `${Number(p.balance).toLocaleString('ru')} ₽`;
  document.getElementById('profile-reputation').textContent = p.reputation;
  document.getElementById('profile-rank').textContent = `#${p.rank}`;
  document.getElementById('profile-streak').textContent = `${p.loginStreak} дн.`;

  document.getElementById('profile-achievements').textContent = `${p.achievements.unlocked} / ${p.achievements.total}`;
  document.getElementById('profile-referrals').textContent = p.referralCount;
  document.getElementById('profile-ref-code').textContent = p.referralCode;
};

// ========== ЗАДАНИЯ ==========
const loadTasks = async () => {
  const listEl = document.getElementById('tasks-list');
  listEl.innerHTML = '<p class="placeholder">Загрузка...</p>';

  try {
    const res = await fetch('/api/app-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, filter: currentFilter }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    renderTasks(data.tasks, data.userId, data.userRole);
  } catch (e) {
    console.error('loadTasks:', e);
    listEl.innerHTML = '<p class="empty-state">❌ Не удалось загрузить задания</p>';
  }
};

const statusLabels = {
  open: '🟢 Открыто',
  taken: '🟡 Взято',
  voting: '🗳 Голосование',
  approved: '✅ Выполнено',
  rejected: '❌ Отклонено',
};

const renderTasks = (tasks, userId, userRole) => {
  const listEl = document.getElementById('tasks-list');

  if (!tasks || tasks.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <p>Нет заданий в этой категории</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = tasks.map(t => {
    const statusClass = `status-${t.status}`;
    const statusLabel = statusLabels[t.status] || t.status;
    const isMyTask = t.playerName && userId && t.playerId === userId;

    let votes = '';
    if (t.status === 'voting') {
      votes = `
        <div class="votes-bar">
          <span class="votes-approve">👍 ${t.approve}</span>
          <span class="votes-reject">👎 ${t.reject}</span>
        </div>
      `;
    }

    return `
      <div class="task-card ${statusClass}" data-task-id="${t.id}">
        <div class="task-header">
          <div class="task-title">${escapeHtml(t.title)}</div>
          <div class="task-reward">${t.reward} ₽</div>
        </div>
        ${t.description ? `<div class="task-desc">${escapeHtml(t.description)}</div>` : ''}
        <div class="task-footer">
          <span class="task-status ${t.status}">${statusLabel}</span>
          <div class="task-meta">
            <span>👤 ${escapeHtml(t.creatorName)}</span>
            ${t.hasVideo ? '<span>🎬</span>' : ''}
          </div>
        </div>
        ${votes}
      </div>
    `;
  }).join('');

  // Клик по карточке — пока ничего (в следующем этапе — детали)
  listEl.querySelectorAll('.task-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.taskId;
      tg.showAlert?.(`Задание #${id} — детали в следующем этапе`);
    });
  });
};

// ========== УТИЛИТЫ ==========
const escapeHtml = (str) => {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

// ========== UI ==========
const renderUser = (user) => {
  document.getElementById('user-tag').textContent = `@${user.telegramUsername || 'user'}`;
};

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
  if (tab) {
    const tabName = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const content = document.getElementById(`tab-${tabName}`);
    if (content) content.classList.add('active');
    return;
  }

  // Фильтры
  const filter = e.target.closest('.filter');
  if (filter) {
    document.querySelectorAll('.filter').forEach(f => f.classList.remove('active'));
    filter.classList.add('active');
    currentFilter = filter.dataset.filter;
    loadTasks();
    return;
  }

  // Поделиться
  if (e.target.id === 'btn-share-ref') {
    const code = document.getElementById('profile-ref-code').textContent;
    const url = `https://t.me/nerv_05bot?start=ref_${code}`;
    const text = `🚀 Присоединяйся к NERV — зарабатывай на выполнении заданий!`;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
    }
  }
});

// ========== СТАРТ ==========
document.addEventListener('DOMContentLoaded', init);