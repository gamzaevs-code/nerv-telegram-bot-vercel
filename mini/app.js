// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// NERV MINI APP — логика фронтенда
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬

const tg = window.Telegram?.WebApp;
let initData = '';
let currentUser = null;
let currentFilter = 'all';
let currentTaskId = null;

// ========== ИНИЦИАЛИЗАЦИЯ ==========
const init = async () => {
  try {
    if (!tg) { showError('Открой через @nerv_05bot'); return; }
    tg.ready(); tg.expand();
    tg.setHeaderColor('#0a0e1a'); tg.setBackgroundColor('#0a0e1a');

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

    const profileRes = await fetch('/api/app-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
    });
    const profileData = await profileRes.json();

    if (profileData.ok && !profileData.profile.roleChosen) {
      hideLoadingScreen();
      showRoleSelect(true);
      return;
    }

    if (profileData.ok) {
      renderProfile(profileData.profile);
      document.getElementById('create-balance').textContent =
        `${Number(profileData.profile.balance).toLocaleString('ru')} ₽`;
    }

    await loadTasks();
    showApp();
  } catch (e) {
    console.error('init error:', e);
    showError(e.message || 'Ошибка подключения');
  }
};

const hideLoadingScreen = () => {
  document.getElementById('loading').classList.add('hidden');
};

const showRoleSelect = (show) => {
  const el = document.getElementById('role-select');
  if (!el) return;
  if (show) el.classList.remove('hidden');
  else el.classList.add('hidden');
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
    if (data.ok) {
      renderProfile(data.profile);
      document.getElementById('create-balance').textContent =
        `${Number(data.profile.balance).toLocaleString('ru')} ₽`;
    }
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
    const b = document.getElementById('profile-badge');
    b.style.display = 'flex';
    b.textContent = p.badge.name.split(' ')[0] || '🎖';
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
    listEl.innerHTML = '<p class="empty-state">❌ Не удалось загрузить</p>';
  }
};

const statusLabels = {
  open: '🟢 Открыто', taken: '🟡 Взято', voting: '🗳 Голосование',
  approved: '✅ Выполнено', rejected: '❌ Отклонено',
};

const renderTasks = (tasks, userId, userRole) => {
  const listEl = document.getElementById('tasks-list');
  if (!tasks || tasks.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📭</div><p>Нет заданий</p></div>`;
    return;
  }
  listEl.innerHTML = tasks.map(t => {
    const statusClass = `status-${t.status}`;
    const statusLabel = statusLabels[t.status] || t.status;
    let votes = '';
    if (t.status === 'voting') {
      votes = `<div class="votes-bar"><span class="votes-approve">👍 ${t.approve}</span><span class="votes-reject">👎 ${t.reject}</span></div>`;
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

  listEl.querySelectorAll('.task-card').forEach(card => {
    card.addEventListener('click', () => openTaskModal(card.dataset.taskId));
  });
};

// ========== МОДАЛКА ЗАДАНИЯ ==========
const openTaskModal = async (taskId) => {
  currentTaskId = taskId;
  const modal = document.getElementById('task-modal');
  modal.classList.remove('hidden');

  document.getElementById('modal-id').textContent = `#${taskId}`;
  document.getElementById('modal-title').textContent = 'Загрузка...';
  document.getElementById('modal-reward').textContent = '';
  document.getElementById('modal-desc').textContent = '';
  document.getElementById('modal-status').textContent = '';
  document.getElementById('modal-actions').innerHTML = '<div class="modal-loading">Загрузка...</div>';
  document.getElementById('modal-votes').style.display = 'none';

  try {
    const res = await fetch('/api/app-task-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, taskId }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    renderTaskModal(data.task, data.userRole);
  } catch (e) {
    document.getElementById('modal-title').textContent = '❌ Ошибка';
    document.getElementById('modal-desc').textContent = e.message;
  }
};

const renderTaskModal = (t, userRole) => {
  document.getElementById('modal-id').textContent = `#${t.id}`;
  document.getElementById('modal-title').textContent = t.title;
  document.getElementById('modal-reward').textContent = `${t.reward} ₽`;

  const statusEl = document.getElementById('modal-status');
  statusEl.textContent = statusLabels[t.status] || t.status;
  statusEl.className = `modal-status ${t.status}`;

  document.getElementById('modal-desc').textContent = t.description || '—';
  document.getElementById('modal-creator').textContent = t.creatorName;

  if (t.playerName) {
    document.getElementById('modal-player-row').style.display = '';
    document.getElementById('modal-player').textContent = t.playerName;
  } else {
    document.getElementById('modal-player-row').style.display = 'none';
  }

  if (t.status === 'voting') {
    document.getElementById('modal-votes').style.display = '';
    const pct = Math.min((t.approve / 5) * 100, 100);
    document.getElementById('modal-votes-fill').style.width = `${pct}%`;
    document.getElementById('modal-votes-count').textContent = `${t.approve} / 5`;
    document.getElementById('modal-approve').textContent = t.approve;
    document.getElementById('modal-reject').textContent = t.reject;
  } else {
    document.getElementById('modal-votes').style.display = 'none';
  }

  const actionsEl = document.getElementById('modal-actions');
  const buttons = [];
  const canTake = t.status === 'open' && userRole === 'player' && !t.playerId;
  const isMyTask = t.isPlayer;
  const canUpload = t.canUpload;

  if (canTake) buttons.push(`<button class="btn-primary" data-action="take">⚡ ВЗЯТЬ ЗАДАНИЕ</button>`);
  if (canUpload) buttons.push(`<button class="btn-primary" data-action="upload">📹 ЗАГРУЗИТЬ ВИДЕО</button>`);
  if (isMyTask && t.status === 'taken') buttons.push(`<button class="btn-secondary" data-action="abandon">↩️ Отказаться</button>`);

  if (t.status === 'voting') {
    if (t.myVote) {
      const voteLabel = t.myVote === 'approve' ? '👍 Ты проголосовал ЗА' : '👎 Ты проголосовал ПРОТИВ';
      buttons.push(`<button class="btn-disabled" disabled>${voteLabel}</button>`);
    } else if (t.isPlayer || t.isCreator) {
      buttons.push(`<button class="btn-disabled" disabled>Своё задание нельзя голосовать</button>`);
    } else {
      buttons.push(`<button class="btn-approve" data-action="vote_approve">✅ ЗА</button>`);
      buttons.push(`<button class="btn-reject" data-action="vote_reject">❌ ПРОТИВ</button>`);
    }
  }

  if (buttons.length === 0) buttons.push(`<button class="btn-secondary" disabled>Действий нет</button>`);

  actionsEl.innerHTML = buttons.join('');
  actionsEl.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => handleTaskAction(btn.dataset.action));
  });
};

const handleTaskAction = async (action) => {
  if (!currentTaskId) return;

  // Загрузка видео — закрываем Mini App и открываем бота
  if (action === 'upload') {
    tg?.HapticFeedback?.impactOccurred?.('medium');
    const link = `https://t.me/nerv_05bot?start=upload_${currentTaskId}`;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(link);
    } else {
      window.open(link, '_blank');
    }
    closeTaskModal();
    return;
  }

  const actionsEl = document.getElementById('modal-actions');
  actionsEl.innerHTML = '<div class="modal-loading">Выполняю...</div>';

  try {
    const res = await fetch('/api/app-task-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action, taskId: currentTaskId }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    tg?.HapticFeedback?.notificationOccurred?.('success');
    renderTaskModal(data.task, currentUser.role);
    loadTasks();
    loadProfile();
  } catch (e) {
    actionsEl.innerHTML = `<button class="btn-secondary" disabled>❌ ${escapeHtml(e.message)}</button>`;
    tg?.HapticFeedback?.notificationOccurred?.('error');
  }
};

const closeTaskModal = () => {
  document.getElementById('task-modal').classList.add('hidden');
  currentTaskId = null;
};

// ========== СОЗДАНИЕ ЗАДАНИЯ ==========
const initCreateForm = () => {
  const form = document.getElementById('create-form');
  const titleInput = document.getElementById('create-title');
  const descInput = document.getElementById('create-desc');
  const rewardInput = document.getElementById('create-reward');
  const titleCount = document.getElementById('title-count');
  const descCount = document.getElementById('desc-count');
  const commissionPreview = document.getElementById('commission-preview');
  const statusEl = document.getElementById('create-status');
  const btnPublish = document.getElementById('btn-publish');

  if (!form) return;

  titleInput.addEventListener('input', () => { titleCount.textContent = titleInput.value.length; });
  descInput.addEventListener('input', () => { descCount.textContent = descInput.value.length; });

  rewardInput.addEventListener('input', () => {
    const r = parseInt(rewardInput.value, 10) || 0;
    const comm = Math.round(r * 0.11);
    commissionPreview.textContent = comm;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    statusEl.classList.add('hidden');
    statusEl.classList.remove('success', 'error', 'loading');

    const title = titleInput.value.trim();
    const description = descInput.value.trim();
    const reward = parseInt(rewardInput.value, 10);

    if (!title || title.length < 3) { showCreateStatus('❌ Название минимум 3 символа', 'error'); return; }
    if (!description || description.length < 5) { showCreateStatus('❌ Описание минимум 5 символов', 'error'); return; }
    if (isNaN(reward) || reward < 10) { showCreateStatus('❌ Минимальная награда 10 ₽', 'error'); return; }

    btnPublish.disabled = true;
    showCreateStatus('🤖 Проверяю контент... Обычно 2-5 секунд', 'loading');

    try {
      const res = await fetch('/api/app-create-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, title, description, reward }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      tg?.HapticFeedback?.notificationOccurred?.('success');
      showCreateStatus(`✅ Задание #${data.task.id} создано! Проверено AI.`, 'success');

      form.reset();
      titleCount.textContent = '0';
      descCount.textContent = '0';
      commissionPreview.textContent = '0';

      setTimeout(() => { loadTasks(); loadProfile(); }, 500);
      setTimeout(() => { document.querySelector('.tab[data-tab="tasks"]')?.click(); }, 2000);
    } catch (err) {
      tg?.HapticFeedback?.notificationOccurred?.('error');
      showCreateStatus(`❌ ${err.message}`, 'error');
    } finally {
      btnPublish.disabled = false;
    }
  });

  const showCreateStatus = (text, type) => {
    statusEl.textContent = text;
    statusEl.className = `create-status ${type}`;
    statusEl.classList.remove('hidden');
  };
};

// ========== ВЫБОР / СМЕНА РОЛИ ==========
const selectRole = async (role, fromModal = false) => {
  if (!fromModal) {
    document.querySelectorAll('.role-card').forEach(c => c.classList.remove('selected'));
    const card = document.querySelector(`.role-card[data-role="${role}"]`);
    if (card) card.classList.add('selected');
  }

  tg?.HapticFeedback?.impactOccurred?.('medium');

  try {
    const res = await fetch('/api/app-change-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, role }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    tg?.HapticFeedback?.notificationOccurred?.('success');

    if (fromModal) closeRoleModal();

    if (currentUser) currentUser.role = role;
    await loadProfile();
    await loadTasks();

    if (!fromModal) {
      showRoleSelect(false);
      showApp();
    } else {
      tg?.showAlert?.(`✅ Роль изменена на «${data.roleLabel}»`);
    }
  } catch (e) {
    console.error('selectRole error:', e);
    tg?.showAlert?.(`❌ ${e.message}`);
    tg?.HapticFeedback?.notificationOccurred?.('error');
  }
};

const openRoleModal = () => {
  let modal = document.getElementById('role-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'role-modal';
    modal.className = 'modal hidden';
    modal.innerHTML = `
      <div class="modal-backdrop" id="role-modal-backdrop"></div>
      <div class="modal-content role-modal-content">
        <div class="modal-header">
          <span class="modal-id">🎭 СМЕНА РОЛИ</span>
          <button class="modal-close" id="role-modal-close">✕</button>
        </div>
        <h2 class="modal-title">Выбери новую роль</h2>
        <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 16px;">
          Можно менять когда угодно
        </p>
        <div class="role-modal-cards" id="role-modal-cards"></div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('role-modal-backdrop').addEventListener('click', closeRoleModal);
    document.getElementById('role-modal-close').addEventListener('click', closeRoleModal);
  }

  const cardsEl = document.getElementById('role-modal-cards');
  const currentRole = currentUser?.role || 'viewer';

  cardsEl.innerHTML = `
    <div class="role-modal-card ${currentRole === 'player' ? 'current' : ''}" data-role="player">
      <div class="role-icon-sm">🎮</div>
      <div class="role-info">
        <div class="role-info-name">Игрок</div>
        <div class="role-info-desc">Брать задания и получать награды</div>
      </div>
      ${currentRole === 'player' ? '<span class="role-badge-current">СЕЙЧАС</span>' : ''}
    </div>
    <div class="role-modal-card ${currentRole === 'viewer' ? 'current' : ''}" data-role="viewer">
      <div class="role-icon-sm">👁</div>
      <div class="role-info">
        <div class="role-info-name">Зритель</div>
        <div class="role-info-desc">Создавать задания и голосовать</div>
      </div>
      ${currentRole === 'viewer' ? '<span class="role-badge-current">СЕЙЧАС</span>' : ''}
    </div>
  `;

  modal.classList.remove('hidden');
};

const closeRoleModal = () => {
  const modal = document.getElementById('role-modal');
  if (modal) modal.classList.add('hidden');
};

// ========== УТИЛИТЫ ==========
const escapeHtml = (str) => {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
};

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

// ========== СОБЫТИЯ ==========
document.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) {
    const tabName = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`tab-${tabName}`)?.classList.add('active');
    return;
  }

  const roleCard = e.target.closest('.role-card');
  if (roleCard) {
    selectRole(roleCard.dataset.role);
    return;
  }

  if (e.target.id === 'btn-change-role') {
    openRoleModal();
    return;
  }

  const roleModalCard = e.target.closest('.role-modal-card');
  if (roleModalCard) {
    selectRole(roleModalCard.dataset.role, true);
    return;
  }

  const filter = e.target.closest('.filter');
  if (filter) {
    document.querySelectorAll('.filter').forEach(f => f.classList.remove('active'));
    filter.classList.add('active');
    currentFilter = filter.dataset.filter;
    loadTasks();
    return;
  }

  if (e.target.id === 'btn-share-ref') {
    const code = document.getElementById('profile-ref-code').textContent;
    const url = `https://t.me/nerv_05bot?start=ref_${code}`;
    const text = `🚀 Присоединяйся к NERV — зарабатывай на выполнении заданий!`;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
    }
  }

  if (e.target.id === 'modal-close' || e.target.id === 'modal-backdrop') {
    closeTaskModal();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  init();
  initCreateForm();
});