// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
// NERV MINI APP — логика фронтенда (v5: кликабельные игроки)
// ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬

const tg = window.Telegram?.WebApp;
let initData = '';
let currentUser = null;
let currentFilter = 'all';
let currentTaskId = null;
let currentTopCategory = 'reputation';
let unreadCount = 0;
let chatTaskId = null;
let chatPollTimer = null;

// ========== ИНИЦИАЛИЗАЦИЯ ==========
const init = async () => {
  try {
    if (!tg) { showError('Открой через @nerv_05bot'); return; }
    tg.ready(); tg.expand();
    tg.setHeaderColor('#0a0e1a'); tg.setBackgroundColor('#0a0e1a');

    initData = tg.initData;
    if (!initData) { showError('Нет данных авторизации'); return; }

    const authRes = await fetch('/api/app-auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
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
      method: 'POST', headers: { 'Content-Type': 'application/json' },
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
      if (profileData.profile.onlineCount !== undefined) {
        document.getElementById('online-count').textContent = profileData.profile.onlineCount;
        document.getElementById('online-count-profile').textContent = profileData.profile.onlineCount;
      }
      renderProfileRating(profileData.profile);
    }

    await Promise.all([loadTasks(), loadTop(), loadActivity(), loadNotifications()]);
    showApp();

    setInterval(loadNotifications, 60000);
  } catch (e) {
    console.error('init error:', e);
    showError(e.message || 'Ошибка подключения');
  }
};

const hideLoadingScreen = () => document.getElementById('loading').classList.add('hidden');
const showRoleSelect = (show) => {
  const el = document.getElementById('role-select');
  if (el) show ? el.classList.remove('hidden') : el.classList.add('hidden');
};

// ========== ПРОФИЛЬ (свой) ==========
const loadProfile = async () => {
  try {
    const res = await fetch('/api/app-profile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.ok) {
      renderProfile(data.profile);
      renderProfileRating(data.profile);
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
  document.getElementById('profile-ref-code').textContent = p.referralCode;
  document.getElementById('favorites-count').textContent = '—';

  renderSparkline(p.sparkline);
  renderStreakCalendar(p.streakDays);
  renderBonusTimer(p.nextBonusHours);
  renderAchPreview(p.achievements.preview);
};

const renderProfileRating = (p) => {
  const valEl = document.getElementById('profile-rating-value');
  const cntEl = document.getElementById('profile-rating-count');
  if (!valEl) return;
  const avg = p.ratingAvg || 0;
  const count = p.ratingCount || 0;
  valEl.textContent = count > 0 ? `${avg} / 5` : '— / 5';
  cntEl.textContent = count > 0
    ? `${count} ${count === 1 ? 'отзыв' : count < 5 ? 'отзыва' : 'отзывов'}`
    : 'Пока нет отзывов';
};

const renderSparkline = (spark) => {
  if (!spark) return;
  const el = document.getElementById('profile-sparkline');
  const max = spark.max || 1;
  el.innerHTML = spark.data.map(v => {
    const pct = v > 0 ? Math.max((v / max) * 100, 15) : 0;
    return `<div class="spark-bar ${v === 0 ? 'zero' : ''}" style="height:${pct}%"></div>`;
  }).join('');
};

const renderStreakCalendar = (days) => {
  if (!days) return;
  const el = document.getElementById('streak-calendar');
  el.innerHTML = days.map(active =>
    `<div class="streak-day ${active ? 'active' : ''}">${active ? '🔥' : ''}</div>`
  ).join('');
};

const renderBonusTimer = (hours) => {
  const el = document.getElementById('bonus-timer');
  if (hours <= 0) {
    el.textContent = 'готово!';
    el.style.color = 'var(--success)';
  } else {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    el.textContent = h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
  }
};

const renderAchPreview = (preview) => {
  if (!preview) return;
  const el = document.getElementById('ach-preview');
  el.innerHTML = preview.map(a =>
    `<div class="ach-badge ${a.isUnlocked ? 'unlocked' : 'locked'}">${a.icon}</div>`
  ).join('');
};

// ========== ЗАДАНИЯ ==========
const loadTasks = async () => {
  const listEl = document.getElementById('tasks-list');
  listEl.innerHTML = '<p class="placeholder">Загрузка...</p>';
  try {
    const res = await fetch('/api/app-tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, filter: currentFilter }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    renderTasks(data.tasks, data.userId, data.userRole);
    loadActivity();
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
    const onlineDot = t.isCreatorOnline ? '<span class="online-dot-small"></span>' : '';
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
            <span>${onlineDot}👤 ${escapeHtml(t.creatorName)}</span>
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
      method: 'POST', headers: { 'Content-Type': 'application/json' },
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
  const canChat = t.playerId && (t.isPlayer || t.isCreator);

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

  if (canChat) {
    buttons.push(`<button class="btn-chat" data-action="chat">💬 Написать ${t.isPlayer ? 'создателю' : 'игроку'}</button>`);
  }

  if (t.isCreator && t.status === 'approved' && t.playerId && !t.hasReview) {
    buttons.push(`<button class="btn-review-primary" data-action="leave_review">⭐ Оставить отзыв</button>`);
  }

  if (buttons.length === 0) buttons.push(`<button class="btn-secondary" disabled>Действий нет</button>`);

  actionsEl.innerHTML = buttons.join('');
  actionsEl.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => handleTaskAction(btn.dataset.action));
  });
};

const handleTaskAction = async (action) => {
  if (!currentTaskId) return;

  if (action === 'upload') {
    tg?.HapticFeedback?.impactOccurred?.('medium');
    const link = `https://t.me/nerv_05bot?start=upload_${currentTaskId}`;
    if (tg?.openTelegramLink) tg.openTelegramLink(link);
    else window.open(link, '_blank');
    closeTaskModal();
    return;
  }

  if (action === 'chat') {
    tg?.HapticFeedback?.impactOccurred?.('light');
    closeTaskModal();
    openChatModal(currentTaskId);
    return;
  }

  if (action === 'leave_review') {
    tg?.HapticFeedback?.impactOccurred?.('light');
    try {
      const res = await fetch('/api/app-task-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, taskId: currentTaskId }),
      });
      const data = await res.json();
      if (data.ok && data.task.playerId) {
        closeTaskModal();
        openRatingModal(currentTaskId, data.task.playerId, data.task.title);
      }
    } catch (e) { console.error(e); }
    return;
  }

  const actionsEl = document.getElementById('modal-actions');
  actionsEl.innerHTML = '<div class="modal-loading">Выполняю...</div>';

  try {
    const res = await fetch('/api/app-task-action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
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

// ========== ПРОФИЛЬ ИГРОКА (публичный) ==========
window.openUserProfile = async (userId) => {
  if (!userId) return;
  tg?.HapticFeedback?.impactOccurred?.('light');

  // Создаём модалку если нет
  let modal = document.getElementById('user-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'user-modal';
    modal.className = 'modal hidden';
    modal.innerHTML = `
      <div class="modal-backdrop" id="user-modal-backdrop"></div>
      <div class="modal-content user-modal-content">
        <div class="modal-header">
          <span class="modal-id">👤 ПРОФИЛЬ</span>
          <button class="modal-close" id="user-modal-close">✕</button>
        </div>
        <div id="user-modal-body">
          <div class="modal-loading">Загрузка...</div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('user-modal-backdrop').addEventListener('click', closeUserModal);
    document.getElementById('user-modal-close').addEventListener('click', closeUserModal);
  }

  modal.classList.remove('hidden');
  const body = document.getElementById('user-modal-body');
  body.innerHTML = '<div class="modal-loading">Загрузка...</div>';

  try {
    const res = await fetch('/api/app-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'user_profile', targetId: userId }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    renderUserProfile(data.profile);
  } catch (e) {
    body.innerHTML = `<div class="notif-empty">❌ ${escapeHtml(e.message)}</div>`;
  }
};

window.closeUserModal = () => {
  const m = document.getElementById('user-modal');
  if (m) m.classList.add('hidden');
};

const renderUserProfile = (p) => {
  const body = document.getElementById('user-modal-body');
  const roleLabels = { player: '🎮 Игрок', viewer: '👁 Зритель', admin: '⚙️ Админ', moderator: '👮 Модератор' };
  const roleLabel = roleLabels[p.role] || p.role;

  const expForNext = Math.pow(p.level, 2) * 50;
  const expForCurrent = Math.pow(p.level - 1, 2) * 50;
  const expProgress = p.experience - expForCurrent;
  const expNeeded = expForNext - expForCurrent;
  const expPercent = Math.min(Math.round((expProgress / expNeeded) * 100), 100);

  const ratingStars = p.ratingCount > 0
    ? `${'⭐'.repeat(Math.round(p.ratingAvg))} ${p.ratingAvg}`
    : '— / 5';

  const reviewsHtml = p.reviews && p.reviews.length > 0
    ? p.reviews.map(r => `
        <div class="user-review-item">
          <div class="user-review-head">
            <span class="review-stars">${'⭐'.repeat(r.rating)}</span>
            <b>${escapeHtml(r.reviewerName)}</b>
          </div>
          <div class="review-task">📋 ${escapeHtml(r.taskTitle)}</div>
          ${r.comment ? `<div class="review-comment">${escapeHtml(r.comment)}</div>` : ''}
          <div class="review-date">${new Date(r.createdAt).toLocaleDateString('ru-RU')}</div>
        </div>
      `).join('')
    : '<div class="reviews-empty">Пока нет отзывов</div>';

  body.innerHTML = `
    <div class="user-profile-header">
      <div class="user-profile-avatar">
        ${escapeHtml(p.initials)}
        ${p.isOnline ? '<span class="user-online-dot"></span>' : ''}
      </div>
      <h2 class="user-profile-name">${escapeHtml(p.displayName)}</h2>
      <div class="user-profile-tags">
        <span class="tag tag-role">${roleLabel}</span>
        ${p.isModerator ? '<span class="tag tag-mod">👮 Модератор</span>' : ''}
        ${p.isOnline ? '<span class="tag tag-online">🟢 Онлайн</span>' : ''}
      </div>
    </div>

    <div class="user-profile-rating">
      <div class="user-profile-rating-stars">${ratingStars}</div>
      <div class="user-profile-rating-count">${p.ratingCount} ${p.ratingCount === 1 ? 'отзыв' : p.ratingCount < 5 ? 'отзыва' : 'отзывов'}</div>
    </div>

    <div class="user-profile-stats">
      <div class="user-stat">
        <div class="user-stat-icon">🎖</div>
        <div class="user-stat-value">${p.level}</div>
        <div class="user-stat-label">Уровень</div>
      </div>
      <div class="user-stat">
        <div class="user-stat-icon">🏅</div>
        <div class="user-stat-value">#${p.rank}</div>
        <div class="user-stat-label">Место</div>
      </div>
      <div class="user-stat">
        <div class="user-stat-icon">✅</div>
        <div class="user-stat-value">${p.completedTasksCount}</div>
        <div class="user-stat-label">Заданий</div>
      </div>
      <div class="user-stat">
        <div class="user-stat-icon">🎖</div>
        <div class="user-stat-value">${p.achievements}</div>
        <div class="user-stat-label">Ачивок</div>
      </div>
    </div>

    <div class="user-profile-xp">
      <div class="level-label">
        <span>Опыт</span>
        <span class="exp-info">${p.experience} XP</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${expPercent}%"></div>
      </div>
    </div>

    <div class="user-profile-meta">
      <div class="user-meta-row">
        <span>⭐ Репутация</span>
        <strong>${p.reputation}</strong>
      </div>
      <div class="user-meta-row">
        <span>🔥 Streak</span>
        <strong>${p.loginStreak} дн.</strong>
      </div>
      <div class="user-meta-row">
        <span>📅 В NERV с</span>
        <strong>${new Date(p.memberSince).toLocaleDateString('ru-RU')}</strong>
      </div>
      ${p.isMe ? '' : `<div class="user-meta-row">
        <span>💰 Баланс</span>
        <strong>${Number(p.balance).toLocaleString('ru')} ₽</strong>
      </div>`}
    </div>

    ${p.isMe ? '' : `
      <button class="btn-favorite ${p.isFavorite ? 'active' : ''}" id="user-fav-btn">
        ${p.isFavorite ? '★ В избранном' : '☆ Добавить в избранное'}
      </button>
    `}

    <div class="user-reviews-section">
      <div class="user-reviews-title">⭐ Последние отзывы</div>
      ${reviewsHtml}
    </div>
  `;

  // Обработчик избранного
  if (!p.isMe) {
    const favBtn = document.getElementById('user-fav-btn');
    if (favBtn) {
      favBtn.addEventListener('click', async () => {
        try {
          const res = await fetch('/api/app-data', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ initData, action: 'favorites_toggle', targetId: p.id }),
          });
          const data = await res.json();
          if (!data.ok) throw new Error(data.error);
          const isNow = data.action === 'added';
          favBtn.classList.toggle('active', isNow);
          favBtn.textContent = isNow ? '★ В избранном' : '☆ Добавить в избранное';
          tg?.HapticFeedback?.notificationOccurred?.('success');
        } catch (e) {
          tg?.HapticFeedback?.notificationOccurred?.('error');
        }
      });
    }
  }
};

// ========== ЧАТ ПО ЗАДАНИЮ ==========
const openChatModal = async (taskId) => {
  chatTaskId = taskId;

  let modal = document.getElementById('chat-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'chat-modal';
    modal.className = 'modal hidden';
    modal.innerHTML = `
      <div class="modal-backdrop" id="chat-modal-backdrop"></div>
      <div class="modal-content chat-modal-content">
        <div class="modal-header">
          <span class="modal-id">💬 ЧАТ ПО ЗАДАНИЮ #${taskId}</span>
          <button class="modal-close" id="chat-modal-close">✕</button>
        </div>
        <div class="chat-messages" id="chat-messages">
          <div class="modal-loading">Загрузка...</div>
        </div>
        <div class="chat-input-wrap">
          <input type="text" id="chat-input" class="chat-input" placeholder="Сообщение..." maxlength="2000" autocomplete="off">
          <button class="chat-send" id="chat-send">➤</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('chat-modal-backdrop').addEventListener('click', closeChatModal);
    document.getElementById('chat-modal-close').addEventListener('click', closeChatModal);
    document.getElementById('chat-send').addEventListener('click', sendChatMessage);
    document.getElementById('chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); sendChatMessage(); }
    });
  }

  modal.classList.remove('hidden');
  await loadChatHistory(taskId);

  if (chatPollTimer) clearInterval(chatPollTimer);
  chatPollTimer = setInterval(() => {
    if (chatTaskId) loadChatHistory(chatTaskId, true);
  }, 5000);
};

const closeChatModal = () => {
  const m = document.getElementById('chat-modal');
  if (m) m.classList.add('hidden');
  chatTaskId = null;
  if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
};

const loadChatHistory = async (taskId, silent = false) => {
  const msgEl = document.getElementById('chat-messages');
  if (!msgEl) return;
  if (!silent) msgEl.innerHTML = '<div class="modal-loading">Загрузка...</div>';

  try {
    const res = await fetch('/api/app-chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'history', taskId }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    renderChatMessages(data.messages);
  } catch (e) {
    if (!silent) msgEl.innerHTML = `<div class="notif-empty">❌ ${escapeHtml(e.message)}</div>`;
  }
};

const renderChatMessages = (messages) => {
  const msgEl = document.getElementById('chat-messages');
  if (!msgEl) return;
  if (!messages || messages.length === 0) {
    msgEl.innerHTML = '<div class="chat-empty">💬 Начни диалог первым</div>';
    return;
  }
  const wasAtBottom = msgEl.scrollTop + msgEl.clientHeight >= msgEl.scrollHeight - 30;
  msgEl.innerHTML = messages.map(m => `
    <div class="chat-msg ${m.isMine ? 'mine' : 'theirs'}">
      ${!m.isMine ? `<div class="chat-msg-name">${escapeHtml(m.fromName)}</div>` : ''}
      <div class="chat-msg-text">${escapeHtml(m.message)}</div>
      <div class="chat-msg-time">${new Date(m.createdAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}</div>
    </div>
  `).join('');
  if (wasAtBottom) msgEl.scrollTop = msgEl.scrollHeight;
};

const sendChatMessage = async () => {
  const input = document.getElementById('chat-input');
  if (!input || !chatTaskId) return;
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  tg?.HapticFeedback?.impactOccurred?.('light');

  try {
    const res = await fetch('/api/app-chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'send', taskId: chatTaskId, message: text }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    await loadChatHistory(chatTaskId, true);
  } catch (e) {
    tg?.HapticFeedback?.notificationOccurred?.('error');
    tg?.showAlert?.(`❌ ${e.message}`);
  }
};

// ========== ОТЗЫВЫ И РЕЙТИНГ ==========
const openReviewsModal = (title) => {
  const modal = document.getElementById('reviews-modal');
  document.getElementById('reviews-modal-title').textContent = title;
  document.getElementById('reviews-modal-body').innerHTML = '<div class="modal-loading">Загрузка...</div>';
  modal.classList.remove('hidden');
};

const closeReviewsModal = () => {
  document.getElementById('reviews-modal').classList.add('hidden');
};

const openMyReviews = async () => {
  openReviewsModal('⭐ МОИ ОТЗЫВЫ');
  const body = document.getElementById('reviews-modal-body');

  try {
    const res = await fetch('/api/app-feed', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'reviews_player', playerId: currentUser?.id }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    if (!data.reviews.length) {
      body.innerHTML = '<div class="reviews-empty">⭐ Пока нет отзывов<br><small>Выполняй задания, чтобы получать оценки</small></div>';
      return;
    }

    body.innerHTML = data.reviews.map(r => `
      <div class="review-item">
        <div class="review-head">
          <span class="review-stars">${'⭐'.repeat(r.rating)}</span>
          <b>${escapeHtml(r.reviewer_name || 'Аноним')}</b>
        </div>
        <div class="review-task">📋 ${escapeHtml(r.task_title || '—')}</div>
        ${r.comment ? `<div class="review-comment">${escapeHtml(r.comment)}</div>` : ''}
        <div class="review-date">${new Date(r.createdAt).toLocaleDateString('ru-RU')}</div>
      </div>
    `).join('');
  } catch (e) {
    body.innerHTML = `<div class="reviews-empty">❌ ${escapeHtml(e.message)}</div>`;
  }
};

const openPendingReviews = async () => {
  openReviewsModal('📝 ОСТАВИТЬ ОТЗЫВ');
  const body = document.getElementById('reviews-modal-body');

  try {
    const res = await fetch('/api/app-feed', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'reviews_pending' }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    if (!data.pending.length) {
      body.innerHTML = '<div class="reviews-empty">📝 Нет заданий, ожидающих отзыва<br><small>Отзыв можно оставить после одобрения задания</small></div>';
      return;
    }

    body.innerHTML = data.pending.map(p => `
      <div class="pending-task">
        <div class="pending-task-title">${escapeHtml(p.title)}</div>
        <div class="pending-task-meta">👤 ${escapeHtml(p.player_name || 'Игрок')} • 💰 ${p.reward} ₽</div>
        <button class="btn-review-primary" onclick="openRatingModal(${p.id}, ${p.playerId}, '${escapeAttr(p.title)}')">⭐ Оценить</button>
      </div>
    `).join('');
  } catch (e) {
    body.innerHTML = `<div class="reviews-empty">❌ ${escapeHtml(e.message)}</div>`;
  }
};

window.openRatingModal = (taskId, playerId, taskTitle) => {
  openReviewsModal('⭐ ОЦЕНКА');
  const body = document.getElementById('reviews-modal-body');

  body.innerHTML = `
    <div style="text-align:center;">
      <h2 class="modal-title" style="font-size:16px;margin-bottom:4px;">${escapeHtml(taskTitle)}</h2>
      <p style="color:var(--text-muted);font-size:12px;margin-bottom:12px;">Поставь оценку игроку</p>
      <div class="rating-picker" id="rating-picker">
        ${[1,2,3,4,5].map(n => `<span class="rating-star" data-rating="${n}">⭐</span>`).join('')}
      </div>
      <textarea class="rating-comment-input" id="rating-comment" placeholder="Комментарий (необязательно)" maxlength="500"></textarea>
      <button class="btn-review-primary" id="rating-submit" disabled>Отправить</button>
    </div>
  `;

  let selectedRating = 0;
  const stars = body.querySelectorAll('.rating-star');
  const submitBtn = document.getElementById('rating-submit');

  stars.forEach(star => {
    star.addEventListener('click', () => {
      selectedRating = parseInt(star.dataset.rating, 10);
      stars.forEach(s => {
        s.classList.toggle('active', parseInt(s.dataset.rating, 10) <= selectedRating);
      });
      submitBtn.disabled = false;
      tg?.HapticFeedback?.impactOccurred?.('light');
    });
  });

  submitBtn.addEventListener('click', async () => {
    if (!selectedRating) return;
    const comment = document.getElementById('rating-comment').value.trim() || null;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Отправляю...';

    try {
      const res = await fetch('/api/app-feed', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initData,
          action: 'reviews_create',
          taskId, playerId, rating: selectedRating, comment,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      tg?.HapticFeedback?.notificationOccurred?.('success');
      closeReviewsModal();
      tg?.showAlert?.('⭐ Спасибо за отзыв!');
      loadProfile();
    } catch (e) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Отправить';
      tg?.HapticFeedback?.notificationOccurred?.('error');
      tg?.showAlert?.(`❌ ${e.message}`);
    }
  });
};

const loadTopRated = async () => {
  const listEl = document.getElementById('top-list');
  listEl.innerHTML = '<p class="placeholder">Загрузка...</p>';
  try {
    const res = await fetch('/api/app-feed', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'reviews_top' }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    document.getElementById('top-me').classList.add('hidden');

    if (!data.top.length) {
      listEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⭐</div><p>Пока нет рейтинга</p></div>';
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    listEl.innerHTML = data.top.map((u, i) => {
      const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
      const rankDisplay = i < 3 ? medals[i] : `#${i + 1}`;
      const initials = (u.name || '?').split(' ').slice(0, 2).map(w => w[0] ? w[0].toUpperCase() : '').join('');
      const isMe = currentUser && u.id === currentUser.id;
      return `
        <div class="top-row top-row-clickable ${isMe ? 'is-me' : ''}" data-user-id="${u.id}">
          <div class="top-rank ${rankClass}">${rankDisplay}</div>
          <div class="top-avatar">${initials}</div>
          <div class="top-info">
            <div class="top-name">${escapeHtml(u.name)}</div>
            <div class="top-sub">${u.ratingCount} ${u.ratingCount === 1 ? 'отзыв' : u.ratingCount < 5 ? 'отзыва' : 'отзывов'}</div>
          </div>
          <div class="top-score">⭐ ${u.ratingAvg}</div>
        </div>
      `;
    }).join('');

    // клик → профиль
    listEl.querySelectorAll('.top-row-clickable').forEach(row => {
      row.addEventListener('click', () => openUserProfile(parseInt(row.dataset.userId, 10)));
    });
  } catch (e) {
    console.error('loadTopRated:', e);
    listEl.innerHTML = '<p class="empty-state">❌ Не удалось загрузить</p>';
  }
};

// ========== ЛЕНТА ==========
const loadActivity = async () => {
  const listEl = document.getElementById('activity-list');
  if (!listEl) return;
  try {
    const res = await fetch('/api/app-feed', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'activity' }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    renderActivity(data.feed);
  } catch (e) {
    console.error('loadActivity:', e);
    listEl.innerHTML = '<p class="activity-empty">Пока тихо...</p>';
  }
};

const renderActivity = (feed) => {
  const listEl = document.getElementById('activity-list');
  if (!listEl) return;
  if (!feed || feed.length === 0) {
    listEl.innerHTML = '<p class="activity-empty">Пока тихо...</p>';
    return;
  }
  listEl.innerHTML = feed.map(ev => `
    <div class="activity-item">
      <span class="activity-icon">${ev.icon}</span>
      <span class="activity-text">${ev.text}</span>
      ${ev.meta ? `<span class="activity-meta">${escapeHtml(ev.meta)}</span>` : ''}
      <span class="activity-time">${ev.timeAgo}</span>
    </div>
  `).join('');
};

// ========== ТОП ==========
const loadTop = async () => {
  if (currentTopCategory === 'rating') {
    await loadTopRated();
    return;
  }

  const listEl = document.getElementById('top-list');
  if (!listEl) return;
  listEl.innerHTML = '<p class="placeholder">Загрузка рейтинга...</p>';
  try {
    const res = await fetch('/api/app-leaderboard', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, category: currentTopCategory }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    renderTop(data.top, data.myRank, data.myScore, data.category);
  } catch (e) {
    console.error('loadTop:', e);
    listEl.innerHTML = '<p class="empty-state">❌ Не удалось загрузить</p>';
  }
};

const renderTop = (top, myRank, myScore, category) => {
  const listEl = document.getElementById('top-list');
  const meEl = document.getElementById('top-me');
  if (!top || top.length === 0) {
    listEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🏆</div><p>Пока нет игроков</p></div>';
    meEl.classList.add('hidden');
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const categoryIcons = { reputation: '⭐', balance: '💰', completed: '✅' };
  const suffix = { reputation: '', balance: ' ₽', completed: '' }[category] || '';

  listEl.innerHTML = top.map(u => {
    const rankClass = u.rank === 1 ? 'gold' : u.rank === 2 ? 'silver' : u.rank === 3 ? 'bronze' : '';
    const rankDisplay = u.rank <= 3 ? medals[u.rank - 1] : `#${u.rank}`;
    const initials = u.name.split(' ').slice(0, 2).map(w => w[0] ? w[0].toUpperCase() : '').join('');
    const sub = category === 'completed' ? `Ур. ${u.level} · 🎖 ${u.achievements}` : `Ур. ${u.level}`;
    return `
      <div class="top-row top-row-clickable ${u.isMe ? 'is-me' : ''}" data-user-id="${u.id}">
        <div class="top-rank ${rankClass}">${rankDisplay}</div>
        <div class="top-avatar">${initials}</div>
        <div class="top-info">
          <div class="top-name">${escapeHtml(u.name)}</div>
          <div class="top-sub">${sub}</div>
        </div>
        <div class="top-score">${categoryIcons[category]} ${u.score}${suffix}</div>
      </div>
    `;
  }).join('');

  // клик → профиль
  listEl.querySelectorAll('.top-row-clickable').forEach(row => {
    row.addEventListener('click', () => openUserProfile(parseInt(row.dataset.userId, 10)));
  });

  const inTop = top.some(u => u.isMe);
  if (!inTop && myRank) {
    meEl.classList.remove('hidden');
    document.getElementById('top-me-rank').textContent = `#${myRank}`;
    document.getElementById('top-me-name').textContent = currentUser?.displayName || currentUser?.name || 'Ты';
    document.getElementById('top-me-score').textContent = `${categoryIcons[category]} ${myScore}${suffix}`;
  } else {
    meEl.classList.add('hidden');
  }
};

// ========== УВЕДОМЛЕНИЯ ==========
const loadNotifications = async () => {
  try {
    const res = await fetch('/api/app-feed', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'notifications' }),
    });
    const data = await res.json();
    if (!data.ok) return;
    unreadCount = data.unreadCount;
    updateNotifBadge();
  } catch (e) { console.error('loadNotifications:', e); }
};

const updateNotifBadge = () => {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  if (unreadCount > 0) {
    badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
};

const openNotifModal = async () => {
  let notifications = [];
  try {
    const res = await fetch('/api/app-feed', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'notifications' }),
    });
    const data = await res.json();
    if (data.ok) notifications = data.notifications;
  } catch (e) { console.error(e); }

  let modal = document.getElementById('notif-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'notif-modal';
    modal.className = 'modal hidden';
    modal.innerHTML = `
      <div class="modal-backdrop" id="notif-modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <span class="modal-id">🔔 УВЕДОМЛЕНИЯ</span>
          <button class="modal-close" id="notif-modal-close">✕</button>
        </div>
        <div class="notif-header-action">
          <h2 class="modal-title" style="margin:0;">Уведомления</h2>
          <button class="notif-mark-read" id="notif-mark-read">Прочитать все</button>
        </div>
        <div id="notif-list"></div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('notif-modal-backdrop').addEventListener('click', closeNotifModal);
    document.getElementById('notif-modal-close').addEventListener('click', closeNotifModal);
    document.getElementById('notif-mark-read').addEventListener('click', markAllRead);
  }

  const listEl = document.getElementById('notif-list');
  if (!notifications || notifications.length === 0) {
    listEl.innerHTML = '<div class="notif-empty">📭 Уведомлений пока нет</div>';
  } else {
    listEl.innerHTML = notifications.map(n => `
      <div class="notif-item ${n.isRead ? 'read' : 'unread'}">
        <div class="notif-content">
          <div class="notif-msg">${escapeHtml(n.message)}</div>
          <div class="notif-time">${n.timeAgo}</div>
        </div>
      </div>
    `).join('');
  }
  modal.classList.remove('hidden');
  setTimeout(markAllRead, 1500);
};

const closeNotifModal = () => {
  const m = document.getElementById('notif-modal');
  if (m) m.classList.add('hidden');
};

const markAllRead = async () => {
  try {
    await fetch('/api/app-feed', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'mark_all_read' }),
    });
    unreadCount = 0;
    updateNotifBadge();
  } catch (e) { console.error('markAllRead:', e); }
};

// ========== МЕТРИКИ ==========
const openMetricModal = async (metric) => {
  let data = null;
  try {
    const res = await fetch('/api/app-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, metric }),
    });
    const json = await res.json();
    if (json.ok) data = json;
  } catch (e) { console.error(e); }

  if (!data) return;

  let modal = document.getElementById('metric-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'metric-modal';
    modal.className = 'modal hidden';
    modal.innerHTML = `
      <div class="modal-backdrop" id="metric-modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <span class="modal-id" id="metric-title">📊</span>
          <button class="modal-close" id="metric-modal-close">✕</button>
        </div>
        <div id="metric-body"></div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('metric-modal-backdrop').addEventListener('click', closeMetricModal);
    document.getElementById('metric-modal-close').addEventListener('click', closeMetricModal);
  }

  document.getElementById('metric-title').textContent = data.title || '📊';
  const body = document.getElementById('metric-body');

  if (metric === 'balance' || metric === 'reputation') {
    body.innerHTML = `<h2 class="modal-title">${data.title}</h2>` + data.rows.map(r =>
      `<div class="modal-info-row" style="padding:12px 0;border-bottom:1px solid var(--border);">
        <span>${r.label}</span>
        <strong>${r.value}</strong>
      </div>`
    ).join('');
  }

  if (metric === 'rank' && data.top) {
    body.innerHTML = `<h2 class="modal-title">${data.title}</h2>
      <p style="color:var(--text-muted);font-size:12px;margin-bottom:12px;">Ты на #${data.myRank} месте</p>` +
      data.top.map(u => {
        const medals = ['🥇', '🥈', '🥉'];
        const rankIcon = u.rank <= 3 ? medals[u.rank - 1] : `#${u.rank}`;
        return `<div class="user-row">
          <div class="user-avatar-sm">${rankIcon}</div>
          <div class="user-info">
            <div class="user-name">${escapeHtml(u.name)}</div>
            <div class="user-sub">⭐ ${u.reputation} · Ур. ${u.level}</div>
          </div>
        </div>`;
      }).join('');
  }

  if (metric === 'streak' && data.days) {
    body.innerHTML = `<h2 class="modal-title">${data.title}</h2>
      <p style="color:var(--text-muted);font-size:12px;margin-bottom:12px;">Твоя активность за 7 дней</p>
      <div class="streak-calendar">${data.days.map(d =>
        `<div class="streak-day ${d.active ? 'active' : ''}">${d.active ? '🔥' : ''}</div>`
      ).join('')}</div>`;
  }

  if (metric === 'achievements' && data.achievements) {
    body.innerHTML = `<h2 class="modal-title">${data.title}</h2>
      <p style="color:var(--text-muted);font-size:12px;margin-bottom:12px;">
        Открыто: ${data.achievements.filter(a => a.isUnlocked).length} из ${data.achievements.length}
      </p>` +
      data.achievements.map(a => `
        <div class="user-row" style="cursor:default;">
          <div class="user-avatar-sm" style="font-size:20px;${a.isUnlocked ? '' : 'filter:grayscale(1);opacity:0.4;'}">${a.icon}</div>
          <div class="user-info">
            <div class="user-name">${escapeHtml(a.name)}</div>
            <div class="user-sub">${escapeHtml(a.description || '')} · 🎁 ${a.reward} ₽</div>
          </div>
          ${a.isUnlocked ? '<span style="color:var(--success);font-size:20px;">✓</span>' : '<span style="color:var(--text-muted);font-size:18px;">🔒</span>'}
        </div>
      `).join('');
  }

  modal.classList.remove('hidden');
};

const closeMetricModal = () => {
  const m = document.getElementById('metric-modal');
  if (m) m.classList.add('hidden');
};

// ========== ОНЛАЙН / ИЗБРАННЫЕ ==========
const openOnlineModal = async () => {
  let online = [];
  try {
    const res = await fetch('/api/app-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'online' }),
    });
    const data = await res.json();
    if (data.ok) online = data.online;
  } catch (e) { console.error(e); }

  let modal = document.getElementById('online-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'online-modal';
    modal.className = 'modal hidden';
    modal.innerHTML = `
      <div class="modal-backdrop" id="online-modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <span class="modal-id">🟢 СЕЙЧАС ОНЛАЙН</span>
          <button class="modal-close" id="online-modal-close">✕</button>
        </div>
        <div id="online-body"></div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('online-modal-backdrop').addEventListener('click', closeOnlineModal);
    document.getElementById('online-modal-close').addEventListener('click', closeOnlineModal);
  }

  const body = document.getElementById('online-body');
  if (!online || online.length === 0) {
    body.innerHTML = '<div class="notif-empty">😴 Никого нет онлайн</div>';
  } else {
    body.innerHTML = online.map(u => `
      <div class="user-row" data-user-id="${u.id}">
        <div class="user-avatar-sm">
          ${u.name.split(' ').slice(0,2).map(w=>w[0]?w[0].toUpperCase():'').join('')}
          <div class="user-online-dot"></div>
        </div>
        <div class="user-info">
          <div class="user-name">${escapeHtml(u.name)}</div>
          <div class="user-sub">Ур. ${u.level} · ${u.role === 'player' ? '🎮' : '👁'}</div>
        </div>
        <div class="user-action">›</div>
      </div>
    `).join('');

    body.querySelectorAll('.user-row').forEach(row => {
      row.addEventListener('click', () => {
        closeOnlineModal();
        openUserProfile(parseInt(row.dataset.userId, 10));
      });
    });
  }

  modal.classList.remove('hidden');
};

const closeOnlineModal = () => {
  const m = document.getElementById('online-modal');
  if (m) m.classList.add('hidden');
};

const openFavoritesModal = async () => {
  let favorites = [];
  try {
    const res = await fetch('/api/app-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'favorites' }),
    });
    const data = await res.json();
    if (data.ok) favorites = data.favorites;
  } catch (e) { console.error(e); }

  let modal = document.getElementById('fav-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'fav-modal';
    modal.className = 'modal hidden';
    modal.innerHTML = `
      <div class="modal-backdrop" id="fav-modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <span class="modal-id">⭐ ИЗБРАННЫЕ</span>
          <button class="modal-close" id="fav-modal-close">✕</button>
        </div>
        <div id="fav-body"></div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('fav-modal-backdrop').addEventListener('click', closeFavModal);
    document.getElementById('fav-modal-close').addEventListener('click', closeFavModal);
  }

  const body = document.getElementById('fav-body');
  if (!favorites || favorites.length === 0) {
    body.innerHTML = '<div class="notif-empty">📭 Избранных пока нет</div>';
  } else {
    body.innerHTML = favorites.map(u => `
      <div class="user-row" data-user-id="${u.id}">
        <div class="user-avatar-sm">
          ${u.name.split(' ').slice(0,2).map(w=>w[0]?w[0].toUpperCase():'').join('')}
          ${u.isOnline ? '<div class="user-online-dot"></div>' : ''}
        </div>
        <div class="user-info">
          <div class="user-name">${escapeHtml(u.name)}</div>
          <div class="user-sub">Ур. ${u.level} · ${u.role === 'player' ? '🎮' : '👁'}</div>
        </div>
        <div class="user-action">›</div>
      </div>
    `).join('');

    body.querySelectorAll('.user-row').forEach(row => {
      row.addEventListener('click', () => {
        closeFavModal();
        openUserProfile(parseInt(row.dataset.userId, 10));
      });
    });
  }

  modal.classList.remove('hidden');
};

const closeFavModal = () => {
  const m = document.getElementById('fav-modal');
  if (m) m.classList.add('hidden');
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
    commissionPreview.textContent = Math.round(r * 0.11);
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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

// ========== РОЛИ ==========
const selectRole = async (role, fromModal = false) => {
  if (!fromModal) {
    document.querySelectorAll('.role-card').forEach(c => c.classList.remove('selected'));
    const card = document.querySelector(`.role-card[data-role="${role}"]`);
    if (card) card.classList.add('selected');
  }
  tg?.HapticFeedback?.impactOccurred?.('medium');

  try {
    const res = await fetch('/api/app-change-role', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
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
  const m = document.getElementById('role-modal');
  if (m) m.classList.add('hidden');
};

// ========== УТИЛИТЫ ==========
const escapeHtml = (str) => {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
};

const escapeAttr = (str) => {
  if (!str) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ');
};

const renderUser = (user) => {};
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
  if (e.target.closest('#btn-notif')) { tg?.HapticFeedback?.impactOccurred?.('light'); openNotifModal(); return; }

  const tab = e.target.closest('.tab');
  if (tab) {
    const tabName = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`tab-${tabName}`)?.classList.add('active');
    if (tabName === 'top' && !document.querySelector('.top-row')) loadTop();
    return;
  }

  if (e.target.closest('.activity-title')) { tg?.HapticFeedback?.impactOccurred?.('light'); loadActivity(); return; }

  const metricCard = e.target.closest('[data-metric]');
  if (metricCard) { openMetricModal(metricCard.dataset.metric); return; }

  if (e.target.id === 'online-card') { openOnlineModal(); return; }
  if (e.target.id === 'favorites-card') { openFavoritesModal(); return; }

  if (e.target.id === 'btn-open-reviews') { tg?.HapticFeedback?.impactOccurred?.('light'); openMyReviews(); return; }
  if (e.target.id === 'btn-open-pending') { tg?.HapticFeedback?.impactOccurred?.('light'); openPendingReviews(); return; }
  if (e.target.id === 'reviews-modal-close' || e.target.id === 'reviews-modal-backdrop') { closeReviewsModal(); return; }

  const roleCard = e.target.closest('.role-card');
  if (roleCard) { selectRole(roleCard.dataset.role); return; }

  if (e.target.id === 'btn-change-role') { openRoleModal(); return; }

  const roleModalCard = e.target.closest('.role-modal-card');
  if (roleModalCard) { selectRole(roleModalCard.dataset.role, true); return; }

  const filter = e.target.closest('.filter');
  if (filter && filter.dataset.filter) {
    document.querySelectorAll('#task-filters .filter').forEach(f => f.classList.remove('active'));
    filter.classList.add('active');
    currentFilter = filter.dataset.filter;
    loadTasks();
    return;
  }
  if (filter && filter.dataset.topcat) {
    document.querySelectorAll('.top-filters .filter').forEach(f => f.classList.remove('active'));
    filter.classList.add('active');
    currentTopCategory = filter.dataset.topcat;
    loadTop();
    return;
  }

  if (e.target.id === 'btn-share-ref') {
    const code = document.getElementById('profile-ref-code').textContent;
    const url = `https://t.me/nerv_05bot?start=ref_${code}`;
    const text = `🚀 Присоединяйся к NERV — зарабатывай на выполнении заданий!`;
    if (tg?.openTelegramLink) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
  }

  if (e.target.id === 'modal-close' || e.target.id === 'modal-backdrop') closeTaskModal();
});

document.addEventListener('DOMContentLoaded', () => {
  init();
  initCreateForm();
});