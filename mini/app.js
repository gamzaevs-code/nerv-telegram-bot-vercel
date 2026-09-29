// NERV MINI APP — v9 (safe)
const tg = window.Telegram?.WebApp;
let initData = '';
let currentUser = null;
let currentFilter = 'all';
let currentTaskId = null;
let currentTopCategory = 'reputation';
let unreadCount = 0;
let chatTaskId = null;
let chatPollTimer = null;
let chatType = 'private'; // 'private' или 'public'

const safeNum = (v) => Number(v) || 0;
const safeArr = (v) => Array.isArray(v) ? v : [];
const safeStr = (v) => (v === null || v === undefined) ? '' : String(v);

// ═══ INIT ═══
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
    if (!authRes.ok) throw new Error(`HTTP ${authRes.status}`);
    const authData = await authRes.json();
    if (!authData.ok) throw new Error(authData.error || 'Auth error');

    currentUser = authData.user;
    renderUser(currentUser);

    const profileRes = await fetch('/api/app-profile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
    });
    if (!profileRes.ok) throw new Error(`Profile: HTTP ${profileRes.status}`);
    const profileData = await profileRes.json();

    if (profileData.ok && !profileData.profile.roleChosen) {
      showApp();
      hideLoadingScreen();
      showRoleSelect(true);
      return;
    }

    if (profileData.ok) {
      renderProfile(profileData.profile);
      const balEl = document.getElementById('create-balance');
      if (balEl) balEl.textContent = `${safeNum(profileData.profile.balance).toLocaleString('ru')} ₽`;
      if (profileData.profile.onlineCount !== undefined) {
        const oc = document.getElementById('online-count');
        const ocp = document.getElementById('online-count-profile');
        if (oc) oc.textContent = profileData.profile.onlineCount;
        if (ocp) ocp.textContent = profileData.profile.onlineCount;
      }
      renderProfileRating(profileData.profile);
    }

    if (currentUser.role === 'admin') {
      const admTab = document.getElementById('admin-tab');
      if (admTab) admTab.classList.remove('hidden');
    }

    await Promise.all([loadTasks(), loadTop(), loadActivity(), loadNotifications()]);
    showApp();
    checkPendingPayment();
    setInterval(loadNotifications, 60000);
  } catch (e) {
    console.error('init error:', e);
    showError(e.message || 'Ошибка подключения');
  }
};

const hideLoadingScreen = () => {
  const el = document.getElementById('loading');
  if (!el) return;
  el.classList.add('fade-out');
  setTimeout(() => el.classList.add('hidden'), 700);
};

const showRoleSelect = (show) => {
  const el = document.getElementById('role-select');
  if (el) show ? el.classList.remove('hidden') : el.classList.add('hidden');
};

// ═══ PROFILE ═══
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
      const balEl = document.getElementById('create-balance');
      if (balEl) balEl.textContent = `${safeNum(data.profile.balance).toLocaleString('ru')} ₽`;
    }
  } catch (e) { console.error('loadProfile:', e); }
};

const renderProfile = (p) => {
  if (!p) return;
  const ach = p.achievements || { unlocked: 0, total: 0, preview: [] };

  const avatarEl = document.getElementById('profile-avatar');
  if (avatarEl) {
    if (p.avatar) avatarEl.innerHTML = `<img src="/api/app-data?action=avatar&userId=${p.id}" alt="">`;
    else avatarEl.textContent = p.initials || '?';
  }
  const nameEl = document.getElementById('profile-name');
  if (nameEl) nameEl.textContent = '@' + (p.displayName || p.name || 'NERV');

  const roleLabels = { player: '🎮 Игрок', viewer: '👁 Зритель', admin: '⚙️ Админ' };
  const roleEl = document.getElementById('profile-role');
  if (roleEl) roleEl.textContent = roleLabels[p.role] || p.role || '—';

  if (p.isVip) { const e = document.getElementById('profile-vip'); if (e) e.style.display = ''; }
  if (p.isModerator) { const e = document.getElementById('profile-mod'); if (e) e.style.display = ''; }

  if (p.badge && p.badge.name) {
    const b = document.getElementById('profile-badge');
    if (b) { b.style.display = 'flex'; b.textContent = p.badge.name.split(' ')[0] || '🎖'; }
  }

  const setText = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  const setWidth = (id, v) => { const e = document.getElementById(id); if (e) e.style.width = v; };

  setText('profile-level', p.level || 1);
  setText('profile-exp-progress', p.expProgress || 0);
  setText('profile-exp-needed', p.expNeeded || 50);
  setWidth('profile-exp-bar', `${p.expPercent || 0}%`);
  setText('profile-balance', `${safeNum(p.balance).toLocaleString('ru')} ₽`);
  setText('profile-reputation', p.reputation || 0);
  setText('profile-rank', `#${p.rank || '—'}`);
  setText('profile-streak', `${p.loginStreak || 0} дн.`);
  setText('profile-achievements', `${ach.unlocked} / ${ach.total}`);
  setText('profile-ref-code', p.referralCode || '—');
  setText('favorites-count', '—');

  renderStreakCalendar(p.streakDays);
  renderBonusTimer(p.nextBonusHours);
  renderAchPreview(ach.preview);
};

const renderProfileRating = (p) => {
  if (!p) return;
  const valEl = document.getElementById('profile-rating-value');
  const cntEl = document.getElementById('profile-rating-count');
  if (!valEl) return;
  const avg = p.ratingAvg || 0;
  const count = p.ratingCount || 0;
  valEl.textContent = count > 0 ? `${avg} / 5` : '— / 5';
  if (cntEl) cntEl.textContent = count > 0
    ? `${count} ${count === 1 ? 'отзыв' : count < 5 ? 'отзыва' : 'отзывов'}`
    : 'Пока нет отзывов';
};

const renderStreakCalendar = (days) => {
  const el = document.getElementById('streak-calendar');
  if (!el) return;
  const arr = safeArr(days);
  el.innerHTML = arr.map(active =>
    `<div class="streak-day ${active ? 'active' : ''}">${active ? '🔥' : ''}</div>`
  ).join('');
};

const renderBonusTimer = (hours) => {
  const el = document.getElementById('bonus-timer');
  const card = document.getElementById('bonus-timer-card');
  if (!el) return;
  const h = safeNum(hours);
  if (h <= 0) {
    el.textContent = 'можно забрать!';
    el.style.color = 'var(--success)';
    if (card) card.style.borderColor = 'var(--success)';
  } else {
    const hh = Math.floor(h);
    const m = Math.round((h - hh) * 60);
    el.textContent = hh > 0 ? `${hh} ч ${m} мин` : `${m} мин`;
    el.style.color = '';
    if (card) card.style.borderColor = '';
  }
};

const renderAchPreview = (preview) => {
  const el = document.getElementById('ach-preview');
  if (!el) return;
  const arr = safeArr(preview);
  el.innerHTML = arr.map(a =>
    `<div class="ach-badge ${a.isUnlocked ? 'unlocked' : 'locked'}">${a.icon || '🏅'}</div>`
  ).join('');
};

// ═══ TASKS ═══
const loadTasks = async () => {
  const listEl = document.getElementById('tasks-list');
  if (!listEl) return;
  listEl.innerHTML = '<p class="placeholder">Загрузка...</p>';
  try {
    const res = await fetch('/api/app-tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, filter: currentFilter }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Error');
    renderTasks(safeArr(data.tasks), data.userId, data.userRole);
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
  if (!listEl) return;
  if (!tasks.length) {
    listEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📭</div><p>Нет заданий</p></div>`;
    return;
  }
  listEl.innerHTML = tasks.map(t => {
    const statusLabel = statusLabels[t.status] || t.status;
    let votes = '';
    if (t.status === 'voting') {
      votes = `<div class="votes-bar"><span class="votes-approve">👍 ${safeNum(t.approve)}</span><span class="votes-reject">👎 ${safeNum(t.reject)}</span></div>`;
    }
    const onlineDot = t.isCreatorOnline ? '<span class="online-dot-small"></span>' : '';
    return `
      <div class="task-card status-${t.status}" data-task-id="${t.id}">
        <div class="task-header">
          <div class="task-title">${escapeHtml(t.title)}</div>
          <div class="task-reward">${t.reward || 0} ₽</div>
        </div>
        ${t.description ? `<div class="task-desc">${escapeHtml(t.description)}</div>` : ''}
        <div class="task-footer">
          <span class="task-status ${t.status}">${statusLabel}</span>
          <div class="task-meta">
            <span>${onlineDot}👤 @${escapeHtml(t.creatorName || 'nerv')}</span>
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

// ═══ TASK MODAL ═══
const openTaskModal = async (taskId) => {
  currentTaskId = taskId;
  const modal = document.getElementById('task-modal');
  if (!modal) return;
  modal.classList.remove('hidden');

  const setT = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  setT('modal-id', `#${taskId}`);
  setT('modal-title', 'Загрузка...');
  setT('modal-reward', '');
  setT('modal-desc', '');
  setT('modal-status', '');
  const actionsEl = document.getElementById('modal-actions');
  if (actionsEl) actionsEl.innerHTML = '<div class="modal-loading">Загрузка...</div>';
  const votesEl = document.getElementById('modal-votes');
  if (votesEl) votesEl.style.display = 'none';

  try {
    const res = await fetch('/api/app-task-action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, taskId }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    renderTaskModal(data.task, data.userRole);
  } catch (e) {
    setT('modal-title', '❌ Ошибка');
    setT('modal-desc', e.message);
  }
};

const renderTaskModal = (t, userRole) => {
  if (!t) return;
  const setT = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  setT('modal-id', `#${t.id}`);
  setT('modal-title', t.title);
  setT('modal-reward', `${t.reward || 0} ₽`);

  const statusEl = document.getElementById('modal-status');
  if (statusEl) {
    statusEl.textContent = statusLabels[t.status] || t.status;
    statusEl.className = `modal-status ${t.status}`;
  }

  setT('modal-desc', t.description || '—');
  setT('modal-creator', '@' + (t.creatorName || 'nerv'));

  const playerRow = document.getElementById('modal-player-row');
  if (t.playerName) {
    if (playerRow) playerRow.style.display = '';
    setT('modal-player', '@' + t.playerName);
  } else {
    if (playerRow) playerRow.style.display = 'none';
  }

  const votesEl = document.getElementById('modal-votes');
  if (t.status === 'voting') {
    if (votesEl) votesEl.style.display = '';
    const approve = safeNum(t.approve);
    const reject = safeNum(t.reject);
    const pct = Math.min((approve / 5) * 100, 100);
    const fill = document.getElementById('modal-votes-fill');
    if (fill) fill.style.width = `${pct}%`;
    setT('modal-votes-count', `${approve} / 5`);
    setT('modal-approve', approve);
    setT('modal-reject', reject);
  } else {
    if (votesEl) votesEl.style.display = 'none';
  }

  const actionsEl = document.getElementById('modal-actions');
  if (!actionsEl) return;
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
      buttons.push(`<button class="btn-disabled" disabled>${t.myVote === 'approve' ? '👍 Ты проголосовал ЗА' : '👎 Ты проголосовал ПРОТИВ'}</button>`);
    } else if (t.isPlayer || t.isCreator) {
      buttons.push(`<button class="btn-disabled" disabled>Своё задание нельзя голосовать</button>`);
    } else {
      buttons.push(`<button class="btn-approve" data-action="vote_approve">✅ ЗА</button>`);
      buttons.push(`<button class="btn-reject" data-action="vote_reject">❌ ПРОТИВ</button>`);
    }
  }

  if (canChat) buttons.push(`<button class="btn-chat" data-action="chat">💬 Написать ${t.isPlayer ? 'создателю' : 'игроку'}</button>`);

  if (t.isCreator && t.status === 'approved' && t.playerId && !t.hasReview) {
    buttons.push(`<button class="btn-review-primary" data-action="leave_review">⭐ Оставить отзыв</button>`);
  }

  if (!buttons.length) buttons.push(`<button class="btn-secondary" disabled>Действий нет</button>`);

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
      if (data.ok && data.task?.playerId) {
        closeTaskModal();
        openRatingModal(currentTaskId, data.task.playerId, data.task.title);
      }
    } catch (e) { console.error(e); }
    return;
  }

  const actionsEl = document.getElementById('modal-actions');
  if (actionsEl) actionsEl.innerHTML = '<div class="modal-loading">Выполняю...</div>';

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
    if (actionsEl) actionsEl.innerHTML = `<button class="btn-secondary" disabled>❌ ${escapeHtml(e.message)}</button>`;
    tg?.HapticFeedback?.notificationOccurred?.('error');
  }
};

const closeTaskModal = () => {
  const m = document.getElementById('task-modal');
  if (m) m.classList.add('hidden');
  currentTaskId = null;
};

// ═══ USER PROFILE ═══
window.openUserProfile = async (userId) => {
  if (!userId) return;
  tg?.HapticFeedback?.impactOccurred?.('light');

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
        <div id="user-modal-body"><div class="modal-loading">Загрузка...</div></div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('user-modal-backdrop').addEventListener('click', closeUserModal);
    document.getElementById('user-modal-close').addEventListener('click', closeUserModal);
  }

  modal.classList.remove('hidden');
  const body = document.getElementById('user-modal-body');
  if (body) body.innerHTML = '<div class="modal-loading">Загрузка...</div>';

  try {
    const res = await fetch('/api/app-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'user_profile', targetId: userId }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Error');
    renderUserProfile(data.profile);
  } catch (e) {
    if (body) body.innerHTML = `<div class="notif-empty">❌ ${escapeHtml(e.message)}</div>`;
  }
};

window.closeUserModal = () => {
  const m = document.getElementById('user-modal');
  if (m) m.classList.add('hidden');
};

const renderUserProfile = (p) => {
  if (!p) return;
  const body = document.getElementById('user-modal-body');
  if (!body) return;

  const roleLabels = { player: '🎮 Игрок', viewer: '👁 Зритель', admin: '⚙️ Админ' };
  const roleLabel = roleLabels[p.role] || p.role || '—';

  const expForNext = Math.pow(p.level || 1, 2) * 50;
  const expForCurrent = Math.pow((p.level || 1) - 1, 2) * 50;
  const expProgress = (p.experience || 0) - expForCurrent;
  const expNeeded = expForNext - expForCurrent || 1;
  const expPercent = Math.min(Math.round((expProgress / expNeeded) * 100), 100);

  const ratingStars = (p.ratingCount || 0) > 0
    ? `${'⭐'.repeat(Math.round(p.ratingAvg || 0))} ${p.ratingAvg || 0}`
    : '— / 5';

  const reviews = safeArr(p.reviews);
  const reviewsHtml = reviews.length > 0
    ? reviews.map(r => `
        <div class="user-review-item">
          <div class="user-review-head">
            <span class="review-stars">${'⭐'.repeat(r.rating || 0)}</span>
            <b>@${escapeHtml(r.reviewerName || 'Аноним')}</b>
          </div>
          <div class="review-task">📋 ${escapeHtml(r.taskTitle || '—')}</div>
          ${r.comment ? `<div class="review-comment">${escapeHtml(r.comment)}</div>` : ''}
          <div class="review-date">${new Date(r.createdAt).toLocaleDateString('ru-RU')}</div>
        </div>
      `).join('')
    : '<div class="reviews-empty">Пока нет отзывов</div>';

  body.innerHTML = `
    <div class="user-profile-header">
      <div class="user-profile-avatar">
        ${p.avatar ? `<img src="/api/app-data?action=avatar&userId=${p.id}" alt="">` : escapeHtml(p.initials || '?')}
        ${p.isOnline ? '<span class="user-online-dot"></span>' : ''}
      </div>
      <h2 class="user-profile-name">@${escapeHtml(p.displayName || 'NERV')}</h2>
      ${p.bio ? `<div class="user-profile-bio">${escapeHtml(p.bio)}</div>` : ''}
      <div class="user-profile-tags">
        <span class="tag tag-role">${roleLabel}</span>
        ${p.isModerator ? '<span class="tag tag-mod">👮 Модератор</span>' : ''}
        ${p.isOnline ? '<span class="tag tag-online">🟢 Онлайн</span>' : ''}
      </div>
    </div>

    <div class="user-profile-rating">
      <div class="user-profile-rating-stars">${ratingStars}</div>
      <div class="user-profile-rating-count">${p.ratingCount || 0} ${p.ratingCount === 1 ? 'отзыв' : p.ratingCount < 5 ? 'отзыва' : 'отзывов'}</div>
    </div>

    <div class="user-profile-stats">
      <div class="user-stat"><div class="user-stat-icon">🎖</div><div class="user-stat-value">${p.level || 1}</div><div class="user-stat-label">Уровень</div></div>
      <div class="user-stat"><div class="user-stat-icon">🏅</div><div class="user-stat-value">#${p.rank || '—'}</div><div class="user-stat-label">Место</div></div>
      <div class="user-stat"><div class="user-stat-icon">✅</div><div class="user-stat-value">${p.completedTasksCount || 0}</div><div class="user-stat-label">Заданий</div></div>
      <div class="user-stat"><div class="user-stat-icon">🎖</div><div class="user-stat-value">${p.achievements || 0}</div><div class="user-stat-label">Ачивок</div></div>
    </div>

    <div class="user-profile-xp">
      <div class="level-label"><span>Опыт</span><span class="exp-info">${p.experience || 0} XP</span></div>
      <div class="progress-bar"><div class="progress-fill" style="width:${expPercent}%"></div></div>
    </div>

    <div class="user-profile-meta">
      <div class="user-meta-row"><span>⭐ Репутация</span><strong>${p.reputation || 0}</strong></div>
      <div class="user-meta-row"><span>🔥 Streak</span><strong>${p.loginStreak || 0} дн.</strong></div>
      <div class="user-meta-row"><span>📅 В NERV с</span><strong>${new Date(p.memberSince).toLocaleDateString('ru-RU')}</strong></div>
      ${p.isMe ? '' : `<div class="user-meta-row"><span>💰 Баланс</span><strong>${safeNum(p.balance).toLocaleString('ru')} ₽</strong></div>`}
    </div>

    <button class="btn-history" data-open-tasks-history="${p.id}">📋 История заданий</button>
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

// ═══ CHAT ═══
const openChatModal = async (taskId) => {
  chatTaskId = taskId;
  chatType = 'private'; // Reset to private when opening
  let modal = document.getElementById('chat-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'chat-modal';
    modal.className = 'modal hidden';
    modal.innerHTML = `
      <div class="modal-backdrop" id="chat-modal-backdrop"></div>
      <div class="modal-content chat-modal-content">
        <div class="modal-header">
          <span class="modal-id">💬 ЧАТ ПО ЗАДАНИЮ</span>
          <button class="modal-close" id="chat-modal-close">✕</button>
        </div>
        
        <!-- CHAT TYPE TABS -->
        <div class="chat-tabs">
          <button class="chat-tab active" data-type="private" id="chat-tab-private">
            🔒 Личный
          </button>
          <button class="chat-tab" data-type="public" id="chat-tab-public">
            💬 Общий
          </button>
        </div>
        
        <div class="chat-messages" id="chat-messages"></div>
        <div class="chat-input-wrap">
          <input type="text" id="chat-input" class="chat-input" placeholder="Сообщение..." maxlength="2000" autocomplete="off">
          <button class="chat-send" id="chat-send">➤</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('chat-modal-backdrop').addEventListener('click', closeChatModal);
    document.getElementById('chat-modal-close').addEventListener('click', closeChatModal);
    
    // Chat type switcher
    const tabs = modal.querySelectorAll('.chat-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', async () => {
        chatType = tab.dataset.type;
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        await loadChatHistory(chatTaskId);
      });
    });
  }
  const titleEl = modal.querySelector('.modal-id');
  if (titleEl) titleEl.textContent = `💬 ЧАТ ПО ЗАДАНИЮ #${taskId}`;
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
    // Choose action based on chat type
    const action = chatType === 'public' ? 'public_history' : 'history';
    const res = await fetch('/api/app-chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action, taskId }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    renderChatMessages(safeArr(data.messages));
  } catch (e) {
    if (!silent) msgEl.innerHTML = `<div class="notif-empty">❌ ${escapeHtml(e.message)}</div>`;
  }
};

const renderChatMessages = (messages) => {
  const msgEl = document.getElementById('chat-messages');
  if (!msgEl) return;
  if (!messages.length) {
    msgEl.innerHTML = '<div class="chat-empty">💬 Начни диалог первым</div>';
    return;
  }
  const wasAtBottom = msgEl.scrollTop + msgEl.clientHeight >= msgEl.scrollHeight - 30;
  msgEl.innerHTML = messages.map(m => `
    <div class="chat-msg ${m.isMine ? 'mine' : 'theirs'}">
      ${!m.isMine ? `<div class="chat-msg-name">@${escapeHtml(m.fromName || 'nerv')}</div>` : ''}
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
    // Choose action based on chat type
    const action = chatType === 'public' ? 'public_send' : 'send';
    const res = await fetch('/api/app-chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action, taskId: chatTaskId, message: text }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    await loadChatHistory(chatTaskId, true);
  } catch (e) {
    tg?.HapticFeedback?.notificationOccurred?.('error');
    tg?.showAlert?.(`❌ ${e.message}`);
  }
};

// ═══ REVIEWS ═══
const openReviewsModal = (title) => {
  const modal = document.getElementById('reviews-modal');
  const tEl = document.getElementById('reviews-modal-title');
  const bEl = document.getElementById('reviews-modal-body');
  if (tEl) tEl.textContent = title;
  if (bEl) bEl.innerHTML = '<div class="modal-loading">Загрузка...</div>';
  if (modal) modal.classList.remove('hidden');
};

const closeReviewsModal = () => {
  const m = document.getElementById('reviews-modal');
  if (m) m.classList.add('hidden');
};

const openMyReviews = async () => {
  openReviewsModal('⭐ МОИ ОТЗЫВЫ');
  const body = document.getElementById('reviews-modal-body');
  if (!body) return;
  try {
    const res = await fetch('/api/app-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'reviews_player', playerId: currentUser?.id }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    const reviews = safeArr(data.reviews);
    if (!reviews.length) {
      body.innerHTML = '<div class="reviews-empty">⭐ Пока нет отзывов</div>';
      return;
    }
    body.innerHTML = reviews.map(r => `
      <div class="review-item">
        <div class="review-head">
          <span class="review-stars">${'⭐'.repeat(r.rating || 0)}</span>
          <b>@${escapeHtml(r.reviewer_name || 'Аноним')}</b>
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
  if (!body) return;
  try {
    const res = await fetch('/api/app-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'reviews_pending' }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    const pending = safeArr(data.pending);
    if (!pending.length) {
      body.innerHTML = '<div class="reviews-empty">📝 Нет заданий, ожидающих отзыва</div>';
      return;
    }
    body.innerHTML = pending.map(p => `
      <div class="pending-task">
        <div class="pending-task-title">${escapeHtml(p.title)}</div>
        <div class="pending-task-meta">👤 @${escapeHtml(p.player_name || 'Игрок')} • 💰 ${p.reward} ₽</div>
        <button class="btn-review-primary open-review-btn" data-task-id="${p.id}" data-player-id="${p.playerId}" data-title="${escapeHtml(p.title)}">⭐ Оценить</button>
      </div>
    `).join('');
  } catch (e) {
    body.innerHTML = `<div class="reviews-empty">❌ ${escapeHtml(e.message)}</div>`;
  }
};

window.openRatingModal = (taskId, playerId, taskTitle) => {
  openReviewsModal('⭐ ОЦЕНКА');
  const body = document.getElementById('reviews-modal-body');
  if (!body) return;
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
      stars.forEach(s => s.classList.toggle('active', parseInt(s.dataset.rating, 10) <= selectedRating));
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
      const res = await fetch('/api/app-data', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, action: 'reviews_create', taskId, playerId, rating: selectedRating, comment }),
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
      tg?.showAlert?.(`❌ ${e.message}`);
    }
  });
};

const loadTopRated = async () => {
  const listEl = document.getElementById('top-list');
  if (!listEl) return;
  listEl.innerHTML = '<p class="placeholder">Загрузка...</p>';
  try {
    const res = await fetch('/api/app-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'reviews_top' }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    const topMe = document.getElementById('top-me');
    if (topMe) topMe.classList.add('hidden');
    const top = safeArr(data.top);
    if (!top.length) {
      listEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⭐</div><p>Пока нет рейтинга</p></div>';
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    listEl.innerHTML = top.map((u, i) => {
      const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
      const rankDisplay = i < 3 ? medals[i] : `#${i + 1}`;
      const name = u.name || 'NERV';
      const initials = name.split(' ').slice(0, 2).map(w => w[0] ? w[0].toUpperCase() : '').join('');
      const isMe = currentUser && u.id === currentUser.id;
      return `
        <div class="top-row top-row-clickable ${isMe ? 'is-me' : ''}" data-user-id="${u.id}">
          <div class="top-rank ${rankClass}">${rankDisplay}</div>
          <div class="top-avatar">${initials}</div>
          <div class="top-info">
            <div class="top-name">@${escapeHtml(name)}</div>
            <div class="top-sub">${u.ratingCount || 0} отзывов</div>
          </div>
          <div class="top-score">⭐ ${u.ratingAvg || 0}</div>
        </div>
      `;
    }).join('');
    listEl.querySelectorAll('.top-row-clickable').forEach(row => {
      row.addEventListener('click', () => openUserProfile(parseInt(row.dataset.userId, 10)));
    });
  } catch (e) {
    console.error('loadTopRated:', e);
    listEl.innerHTML = '<p class="empty-state">❌ Не удалось загрузить</p>';
  }
};

// ═══ FEED ═══
const loadActivity = async () => {
  const listEl = document.getElementById('activity-list');
  if (!listEl) return;
  try {
    const res = await fetch('/api/app-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'activity' }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    renderActivity(safeArr(data.feed));
  } catch (e) {
    listEl.innerHTML = '<p class="activity-empty">Пока тихо...</p>';
  }
};

const renderActivity = (feed) => {
  const listEl = document.getElementById('activity-list');
  if (!listEl) return;
  if (!feed.length) { listEl.innerHTML = '<p class="activity-empty">Пока тихо...</p>'; return; }
  listEl.innerHTML = feed.map(ev => `
    <div class="activity-item">
      <span class="activity-icon">${ev.icon || '📌'}</span>
      <span class="activity-text">${ev.text || ''}</span>
      ${ev.meta ? `<span class="activity-meta">${escapeHtml(ev.meta)}</span>` : ''}
      <span class="activity-time">${ev.timeAgo || ''}</span>
    </div>
  `).join('');
};

// ═══ TOP ═══
const loadTop = async () => {
  if (currentTopCategory === 'rating') { await loadTopRated(); return; }
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
    renderTop(safeArr(data.top), data.myRank, data.myScore, data.category);
  } catch (e) {
    console.error('loadTop:', e);
    listEl.innerHTML = '<p class="empty-state">❌ Не удалось загрузить</p>';
  }
};

const renderTop = (top, myRank, myScore, category) => {
  const listEl = document.getElementById('top-list');
  const meEl = document.getElementById('top-me');
  if (!listEl) return;
  if (!top.length) {
    listEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🏆</div><p>Пока нет игроков</p></div>';
    if (meEl) meEl.classList.add('hidden');
    return;
  }
  const medals = ['🥇', '🥈', '🥉'];
  const categoryIcons = { reputation: '⭐', balance: '💰', completed: '✅' };
  const suffix = { reputation: '', balance: ' ₽', completed: '' }[category] || '';

  listEl.innerHTML = top.map(u => {
    const rankClass = u.rank === 1 ? 'gold' : u.rank === 2 ? 'silver' : u.rank === 3 ? 'bronze' : '';
    const rankDisplay = u.rank <= 3 ? medals[u.rank - 1] : `#${u.rank}`;
    const name = u.name || 'NERV';
    const initials = name.split(' ').slice(0, 2).map(w => w[0] ? w[0].toUpperCase() : '').join('');
    const sub = category === 'completed' ? `Ур. ${u.level || 1} · 🎖 ${u.achievements || 0}` : `Ур. ${u.level || 1}`;
    return `
      <div class="top-row top-row-clickable ${u.isMe ? 'is-me' : ''}" data-user-id="${u.id}">
        <div class="top-rank ${rankClass}">${rankDisplay}</div>
        <div class="top-avatar">${initials}</div>
        <div class="top-info">
          <div class="top-name">@${escapeHtml(name)}</div>
          <div class="top-sub">${sub}</div>
        </div>
        <div class="top-score">${categoryIcons[category] || '⭐'} ${u.score || 0}${suffix}</div>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.top-row-clickable').forEach(row => {
    row.addEventListener('click', () => openUserProfile(parseInt(row.dataset.userId, 10)));
  });

  if (!meEl) return;
  const inTop = top.some(u => u.isMe);
  if (!inTop && myRank) {
    meEl.classList.remove('hidden');
    const rEl = document.getElementById('top-me-rank');
    const nEl = document.getElementById('top-me-name');
    const sEl = document.getElementById('top-me-score');
    if (rEl) rEl.textContent = `#${myRank}`;
    if (nEl) nEl.textContent = '@' + (currentUser?.displayName || currentUser?.name || 'Ты');
    if (sEl) sEl.textContent = `${categoryIcons[category] || '⭐'} ${myScore || 0}${suffix}`;
  } else {
    meEl.classList.add('hidden');
  }
};

// ═══ NOTIFS ═══
const loadNotifications = async () => {
  try {
    const res = await fetch('/api/app-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'notifications' }),
    });
    const data = await res.json();
    if (!data.ok) return;
    unreadCount = data.unreadCount || 0;
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
    const res = await fetch('/api/app-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'notifications' }),
    });
    const data = await res.json();
    if (data.ok) notifications = safeArr(data.notifications);
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
  if (listEl) {
    if (!notifications.length) {
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
    await fetch('/api/app-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'mark_all_read' }),
    });
    unreadCount = 0;
    updateNotifBadge();
  } catch (e) { console.error('markAllRead:', e); }
};

// ═══ METRICS ═══
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

  if (!data) {
    tg?.showAlert?.('❌ Не удалось загрузить');
    return;
  }

  const METRIC_TITLES = {
    balance: '💰 Баланс',
    reputation: '⭐ Репутация',
    rank: '🏅 Топ-10',
    streak: '🔥 Streak',
    achievements: '🎖 Достижения',
  };
  const title = data.title || METRIC_TITLES[metric] || '📊';

  // ⭐ ДОСТИЖЕНИЯ — через reviews-modal
  if (metric === 'achievements') {
    const reviewsModal = document.getElementById('reviews-modal');
    const titleEl = document.getElementById('reviews-modal-title');
    const rBody = document.getElementById('reviews-modal-body');
    if (!reviewsModal || !rBody) return;
    if (titleEl) titleEl.textContent = '🎖 ДОСТИЖЕНИЯ';

    const list = Array.isArray(data.achievements) ? data.achievements : [];
    const unlocked = list.filter(a => a.isUnlocked).length;

    rBody.innerHTML = `
      <p style="color:var(--text-muted);font-size:12px;margin-bottom:12px;text-align:center;">
        Открыто: <b>${unlocked}</b> из <b>${list.length}</b>
      </p>
      ${list.length === 0
        ? '<div class="reviews-empty">Достижений пока нет</div>'
        : list.map(a => `
          <div class="user-review-item" style="${a.isUnlocked ? '' : 'opacity:0.5;'}">
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="font-size:28px;${a.isUnlocked ? '' : 'filter:grayscale(1);'}">${a.icon || '🏅'}</div>
              <div style="flex:1;min-width:0;">
                <div style="font-weight:700;font-size:14px;">${escapeHtml(a.name || 'Достижение')}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${escapeHtml(a.description || '')}</div>
                <div style="font-size:11px;color:var(--accent);margin-top:4px;">🎁 ${Number(a.reward) || 0} ₽</div>
              </div>
              ${a.isUnlocked ? '<span style="color:var(--success);font-size:20px;">✓</span>' : '<span style="color:var(--text-muted);font-size:18px;">🔒</span>'}
            </div>
          </div>
        `).join('')}
    `;
    reviewsModal.classList.remove('hidden');
    return;
  }

  // Остальные метрики — через metric-modal
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

  const titleEl = document.getElementById('metric-title');
  if (titleEl) titleEl.textContent = title;
  const body = document.getElementById('metric-body');
  if (!body) return;

  // 💰 Баланс / ⭐ Репутация
  if (metric === 'balance' || metric === 'reputation') {
    const rows = Array.isArray(data.rows) ? data.rows : [];
    body.innerHTML = `<h2 class="modal-title">${escapeHtml(title)}</h2>` +
      (rows.length === 0
        ? '<div style="color:var(--text-muted);text-align:center;padding:20px;">Нет данных</div>'
        : rows.map(r =>
          `<div class="modal-info-row" style="padding:12px 0;border-bottom:1px solid var(--border);">
            <span>${escapeHtml(r.label || '')}</span>
            <strong>${escapeHtml(String(r.value ?? '—'))}</strong>
          </div>`
        ).join('')
      );
  }

  // 🏅 Топ-10
  if (metric === 'rank') {
    const top = Array.isArray(data.top) ? data.top : [];
    const myRank = data.myRank || '—';
    body.innerHTML = `<h2 class="modal-title">${escapeHtml(title)}</h2>
      <p style="color:var(--text-muted);font-size:12px;margin-bottom:12px;">Ты на #${myRank} месте</p>` +
      (top.length === 0
        ? '<div style="color:var(--text-muted);text-align:center;padding:20px;">Пусто</div>'
        : top.map(u => {
          const medals = ['🥇', '🥈', '🥉'];
          const rankIcon = u.rank <= 3 ? medals[u.rank - 1] : `#${u.rank}`;
          return `<div class="user-row">
            <div class="user-avatar-sm">${rankIcon}</div>
            <div class="user-info">
              <div class="user-name">@${escapeHtml(u.name || 'NERV')}</div>
              <div class="user-sub">⭐ ${Number(u.reputation) || 0} · Ур. ${Number(u.level) || 1}</div>
            </div>
          </div>`;
        }).join('')
      );
  }

  // 🔥 Streak
  if (metric === 'streak') {
    const days = Array.isArray(data.days) ? data.days : [];
    body.innerHTML = `<h2 class="modal-title">${escapeHtml(title)}</h2>
      <p style="color:var(--text-muted);font-size:12px;margin-bottom:12px;">Твоя активность за 7 дней</p>
      <div class="streak-calendar">${days.map(d =>
        `<div class="streak-day ${d.active ? 'active' : ''}">${d.active ? '🔥' : ''}</div>`
      ).join('')}</div>`;
  }

  modal.classList.remove('hidden');
};

const closeMetricModal = () => {
  const m = document.getElementById('metric-modal');
  if (m) m.classList.add('hidden');
};

// ═══ ONLINE / FAVORITES ═══
const openOnlineModal = async () => {
  let online = [];
  try {
    const res = await fetch('/api/app-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'online' }),
    });
    const data = await res.json();
    if (data.ok) online = safeArr(data.online);
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
  if (body) {
    if (!online.length) {
      body.innerHTML = '<div class="notif-empty">😴 Никого нет онлайн</div>';
    } else {
      body.innerHTML = online.map(u => {
        const name = u.name || 'NERV';
        const initials = name.split(' ').slice(0,2).map(w=>w[0]?w[0].toUpperCase():'').join('');
        return `<div class="user-row" data-user-id="${u.id}">
          <div class="user-avatar-sm">${initials}<div class="user-online-dot"></div></div>
          <div class="user-info">
            <div class="user-name">@${escapeHtml(name)}</div>
            <div class="user-sub">Ур. ${u.level} · ${u.role === 'player' ? '🎮' : '👁'}</div>
          </div>
          <div class="user-action">›</div>
        </div>`;
      }).join('');
      body.querySelectorAll('.user-row').forEach(row => {
        row.addEventListener('click', () => {
          closeOnlineModal();
          openUserProfile(parseInt(row.dataset.userId, 10));
        });
      });
    }
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
    if (data.ok) favorites = safeArr(data.favorites);
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
  if (body) {
    if (!favorites.length) {
      body.innerHTML = '<div class="notif-empty">📭 Избранных пока нет</div>';
    } else {
      body.innerHTML = favorites.map(u => {
        const name = u.name || 'NERV';
        const initials = name.split(' ').slice(0,2).map(w=>w[0]?w[0].toUpperCase():'').join('');
        return `<div class="user-row" data-user-id="${u.id}">
          <div class="user-avatar-sm">${initials}${u.isOnline ? '<div class="user-online-dot"></div>' : ''}</div>
          <div class="user-info">
            <div class="user-name">@${escapeHtml(name)}</div>
            <div class="user-sub">Ур. ${u.level} · ${u.role === 'player' ? '🎮' : '👁'}</div>
          </div>
          <div class="user-action">›</div>
        </div>`;
      }).join('');
      body.querySelectorAll('.user-row').forEach(row => {
        row.addEventListener('click', () => {
          closeFavModal();
          openUserProfile(parseInt(row.dataset.userId, 10));
        });
      });
    }
  }
  modal.classList.remove('hidden');
};

const closeFavModal = () => {
  const m = document.getElementById('fav-modal');
  if (m) m.classList.add('hidden');
};

// ═══ TOPUP ═══
window.openTopupModal = () => {
  let modal = document.getElementById('topup-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'topup-modal';
    modal.className = 'modal hidden';
    modal.innerHTML = `
      <div class="modal-backdrop" id="topup-modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <span class="modal-id">💰 ПОПОЛНЕНИЕ</span>
          <button class="modal-close" id="topup-modal-close">✕</button>
        </div>
        <h2 class="modal-title">Пополнить баланс</h2>
        <p style="color:var(--text-muted);font-size:12px;margin-bottom:12px;">Минимум 100 ₽ • Оплата через ЮKassa</p>
        <div class="topup-presets">
          ${[100, 300, 500, 1000, 3000].map(v => `<button class="topup-preset" data-amount="${v}">${v} ₽</button>`).join('')}
        </div>
        <input type="number" id="topup-amount" class="form-input" placeholder="Своя сумма" min="100" max="100000" style="margin:12px 0;">
        <button class="btn-publish" id="topup-go">💳 Перейти к оплате</button>
        <div id="topup-status" class="create-status hidden"></div>
        <div style="margin-top:20px;border-top:1px solid var(--border);padding-top:12px;">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">📜 История пополнений</div>
          <div id="topup-history"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('topup-modal-backdrop').addEventListener('click', closeTopupModal);
    document.getElementById('topup-modal-close').addEventListener('click', closeTopupModal);
    modal.querySelectorAll('.topup-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('topup-amount').value = btn.dataset.amount;
        modal.querySelectorAll('.topup-preset').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
    document.getElementById('topup-go').addEventListener('click', createTopupPayment);
  }
  modal.classList.remove('hidden');
  loadTopupHistory();
};

window.closeTopupModal = () => {
  const m = document.getElementById('topup-modal');
  if (m) m.classList.add('hidden');
};

const createTopupPayment = async () => {
  const amount = parseInt(document.getElementById('topup-amount').value, 10);
  const statusEl = document.getElementById('topup-status');
  const btn = document.getElementById('topup-go');
  if (!statusEl || !btn) return;
  if (isNaN(amount) || amount < 100) {
    statusEl.textContent = '❌ Минимум 100 ₽';
    statusEl.className = 'create-status error';
    statusEl.classList.remove('hidden');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Создаю платёж...';
  statusEl.classList.add('hidden');
  try {
    const res = await fetch('/api/app-payment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'create', amount }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    if (tg?.openLink) tg.openLink(data.confirmationUrl);
    else window.open(data.confirmationUrl, '_blank');
    localStorage.setItem('nerv_pending_payment', data.yookassaId);
    statusEl.textContent = '⏳ Ожидаем оплату...';
    statusEl.className = 'create-status loading';
    statusEl.classList.remove('hidden');
  } catch (e) {
    statusEl.textContent = `❌ ${e.message}`;
    statusEl.className = 'create-status error';
    statusEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = '💳 Перейти к оплате';
  }
};

const loadTopupHistory = async () => {
  const el = document.getElementById('topup-history');
  if (!el) return;
  try {
    const res = await fetch('/api/app-payment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'history' }),
    });
    const data = await res.json();
    if (!data.ok || !safeArr(data.payments).length) {
      el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">Пока нет пополнений</div>';
      return;
    }
    const statusEmoji = { succeeded: '✅', pending: '⏳', canceled: '❌', waiting_for_capture: '🟡' };
    el.innerHTML = safeArr(data.payments).map(p => `
      <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:12px;border-bottom:1px solid rgba(35,45,74,0.4);">
        <span>${statusEmoji[p.status] || '❓'} ${new Date(p.createdAt).toLocaleDateString('ru-RU')}</span>
        <strong style="color:var(--accent);">+${p.amount} ₽</strong>
      </div>
    `).join('');
  } catch (e) { el.innerHTML = ''; }
};

const checkPendingPayment = async (attempt = 0) => {
  if (attempt > 60) return;
  const pending = localStorage.getItem('nerv_pending_payment');
  if (!pending) return;
  try {
    const res = await fetch('/api/app-payment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'check', yookassaId: pending }),
    });
    const data = await res.json();
    if (data.ok && data.status === 'succeeded') {
      tg?.HapticFeedback?.notificationOccurred?.('success');
      tg?.showAlert?.('✅ Платёж прошёл!');
      localStorage.removeItem('nerv_pending_payment');
      loadProfile();
      setTimeout(loadProfile, 1500);
      setTimeout(loadProfile, 4000);
    } else if (data.ok && data.status === 'canceled') {
      localStorage.removeItem('nerv_pending_payment');
    } else if (data.ok && data.status === 'pending') {
      setTimeout(() => checkPendingPayment(attempt + 1), 3000);
    }
  } catch (e) { /* silent */ }
};

// ═══ SEARCH ═══
const SEARCH_HISTORY_KEY = 'nerv_search_history';

const getSearchHistory = () => {
  try { return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]'); }
  catch { return []; }
};

const addToSearchHistory = (q) => {
  q = (q || '').trim();
  if (!q) return;
  let h = getSearchHistory().filter(x => x.toLowerCase() !== q.toLowerCase());
  h.unshift(q);
  h = h.slice(0, 5);
  try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(h)); } catch {}
};

const renderSearchHistory = () => {
  const el = document.getElementById('search-history');
  if (!el) return;
  const h = getSearchHistory();
  if (!h.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">История</div>' +
    h.map(q => `<button class="search-chip" data-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('');
};

window.openSearchModal = () => {
  tg?.HapticFeedback?.impactOccurred?.('light');
  let modal = document.getElementById('search-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'search-modal';
    modal.className = 'modal hidden';
    modal.innerHTML = `
      <div class="modal-backdrop" id="search-modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <span class="modal-id">🔍 ПОИСК ИГРОКА</span>
          <button class="modal-close" id="search-modal-close">✕</button>
        </div>
        <input type="text" id="search-input" class="form-input" placeholder="Введи ник (мин. 2 символа)..." maxlength="30" autocomplete="off" style="margin:12px 0;">
        <div id="search-history" style="margin-bottom:12px;"></div>
        <div id="search-results"></div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('search-modal-backdrop').addEventListener('click', closeSearchModal);
    document.getElementById('search-modal-close').addEventListener('click', closeSearchModal);
  }
  const input = document.getElementById('search-input');
  if (input) input.value = '';
  const results = document.getElementById('search-results');
  if (results) results.innerHTML = '';
  renderSearchHistory();
  modal.classList.remove('hidden');
  setTimeout(() => document.getElementById('search-input')?.focus(), 150);
};

window.closeSearchModal = () => {
  const m = document.getElementById('search-modal');
  if (m) m.classList.add('hidden');
};

const doSearch = async (q) => {
  q = (q || '').trim();
  const results = document.getElementById('search-results');
  if (!results) return;
  if (q.length < 2) {
    results.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px;">Введи минимум 2 символа</div>';
    return;
  }
  results.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:20px;">Поиск...</div>';
  try {
    const res = await fetch('/api/app-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'search_users', query: q }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    const users = safeArr(data.users);
    if (!users.length) {
      results.innerHTML = `<div style="color:var(--text-muted);text-align:center;padding:20px;">Ничего не найдено по «${escapeHtml(q)}»</div>`;
      return;
    }
    addToSearchHistory(q);
    results.innerHTML = users.map(u => {
      const name = u.name || 'NERV';
      const initials = name.split(' ').slice(0, 2).map(w => w[0] ? w[0].toUpperCase() : '').join('');
      const rating = (u.ratingCount || 0) > 0 ? `⭐ ${(u.ratingAvg || 0).toFixed(1)}` : '⭐ —';
      const roleIcon = u.role === 'player' ? '🎮' : u.role === 'viewer' ? '👁' : '⚙️';
      const meTag = u.isMe ? ' <span style="color:var(--accent);font-size:10px;">ТЫ</span>' : '';
      return `<div class="user-row" data-user-id="${u.id}">
        <div class="user-avatar-sm">${initials}${u.isOnline ? '<div class="user-online-dot"></div>' : ''}</div>
        <div class="user-info">
          <div class="user-name">@${escapeHtml(name)}${meTag}</div>
          <div class="user-sub">${roleIcon} Ур. ${u.level || 1} · ${rating} · реп. ${u.reputation || 0}</div>
        </div>
        <div class="user-action">›</div>
      </div>`;
    }).join('');
    results.querySelectorAll('.user-row').forEach(row => {
      row.addEventListener('click', () => {
        const uid = parseInt(row.dataset.userId, 10);
        closeSearchModal();
        setTimeout(() => openUserProfile(uid), 150);
      });
    });
  } catch (e) {
    console.error('doSearch:', e);
    results.innerHTML = `<div style="color:var(--error);text-align:center;padding:20px;">❌ ${escapeHtml(e.message)}</div>`;
  }
};

// ═══ CREATE FORM ═══
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
    showCreateStatus('🤖 Проверяю контент...', 'loading');
    try {
      const res = await fetch('/api/app-create-task', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, title, description, reward }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      tg?.HapticFeedback?.notificationOccurred?.('success');
      showCreateStatus(`✅ Задание #${data.task.id} создано!`, 'success');
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

// ═══ ROLE ═══
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
    if (!fromModal) { showRoleSelect(false); showApp(); }
    else tg?.showAlert?.(`✅ Роль: ${data.roleLabel}`);
  } catch (e) {
    tg?.showAlert?.(`❌ ${e.message}`);
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
      <div class="role-info"><div class="role-info-name">Игрок</div><div class="role-info-desc">Брать задания</div></div>
      ${currentRole === 'player' ? '<span class="role-badge-current">СЕЙЧАС</span>' : ''}
    </div>
    <div class="role-modal-card ${currentRole === 'viewer' ? 'current' : ''}" data-role="viewer">
      <div class="role-icon-sm">👁</div>
      <div class="role-info"><div class="role-info-name">Зритель</div><div class="role-info-desc">Создавать задания</div></div>
      ${currentRole === 'viewer' ? '<span class="role-badge-current">СЕЙЧАС</span>' : ''}
    </div>
  `;
  modal.classList.remove('hidden');
};

const closeRoleModal = () => {
  const m = document.getElementById('role-modal');
  if (m) m.classList.add('hidden');
};

// ═══ UTILS ═══
const escapeHtml = (str) => {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
};

const renderUser = (user) => {};
const showApp = () => {
  const loading = document.getElementById('loading');
  const app = document.getElementById('app');
  if (app) app.classList.remove('hidden');
  setTimeout(() => {
    if (loading) {
      loading.classList.add('fade-out');
      setTimeout(() => loading.classList.add('hidden'), 700);
    }
  }, 600);
};
const showError = (msg) => {
  const l = document.getElementById('loading');
  const e = document.getElementById('error');
  const t = document.getElementById('error-text');
  if (l) l.classList.add('hidden');
  if (e) e.classList.remove('hidden');
  if (t) t.textContent = msg;
};

// ═══ GLOBAL CLICK ═══
document.addEventListener('click', (e) => {
  // bonus
  if (e.target.closest('#bonus-timer-card')) {
    tg?.HapticFeedback?.impactOccurred?.('light');
    const link = 'https://t.me/nerv_05bot?start=bonus';
    if (tg?.openTelegramLink) tg.openTelegramLink(link);
    else window.open(link, '_blank');
    return;
  }
  // search
  if (e.target.closest('#btn-search')) { openSearchModal(); return; }
  // notifs
  if (e.target.closest('#btn-notif')) { tg?.HapticFeedback?.impactOccurred?.('light'); openNotifModal(); return; }

  // search chip
  const chip = e.target.closest('.search-chip');
  if (chip) {
    const input = document.getElementById('search-input');
    if (input) input.value = chip.dataset.q || '';
    doSearch(chip.dataset.q);
    return;
  }

  // open review btn (pending)
  const rBtn = e.target.closest('.open-review-btn');
  if (rBtn) {
    openRatingModal(
      parseInt(rBtn.dataset.taskId, 10),
      parseInt(rBtn.dataset.playerId, 10),
      rBtn.dataset.title || ''
    );
    return;
  }

  // open tasks history
  const thBtn = e.target.closest('[data-open-tasks-history]');
  if (thBtn) { openTasksHistory(parseInt(thBtn.dataset.openTasksHistory, 10)); return; }
  if (e.target.id === 'btn-tasks-history') { openTasksHistory(currentUser?.id); return; }

  // chat send (global)
  if (e.target.id === 'chat-send') { sendChatMessage(); return; }

  // tabs
  const tab = e.target.closest('.tab');
  if (tab) {
    const tabName = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`tab-${tabName}`)?.classList.add('active');
    if (tabName === 'top' && !document.querySelector('.top-row')) loadTop();
    if (tabName === 'admin' && !document.querySelector('#admin-stats-container .card')) loadAdminStats();
    return;
  }

  if (e.target.closest('.activity-title')) { tg?.HapticFeedback?.impactOccurred?.('light'); loadActivity(); return; }

  const metricCard = e.target.closest('[data-metric]');
  if (metricCard) { openMetricModal(metricCard.dataset.metric); return; }

  if (e.target.id === 'online-card') { openOnlineModal(); return; }
  if (e.target.id === 'favorites-card') { openFavoritesModal(); return; }
  if (e.target.id === 'btn-open-reviews') { openMyReviews(); return; }
  if (e.target.id === 'btn-open-pending') { openPendingReviews(); return; }
  if (e.target.id === 'reviews-modal-close' || e.target.id === 'reviews-modal-backdrop') { closeReviewsModal(); return; }
  if (e.target.id === 'btn-withdraw') { openWithdrawModal(); return; }
  if (e.target.id === 'btn-topup') { openTopupModal(); return; }

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
  if (filter && filter.dataset.admperiod) {
    document.querySelectorAll('.admin-period-filters .filter').forEach(f => f.classList.remove('active'));
    filter.classList.add('active');
    loadAdminStats(filter.dataset.admperiod);
    return;
  }

  if (e.target.id === 'btn-share-ref') {
    const code = document.getElementById('profile-ref-code')?.textContent || '';
    const url = `https://t.me/nerv_05bot?start=ref_${code}`;
    const text = `🚀 Присоединяйся к NERV!`;
    if (tg?.openTelegramLink) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
  }

  if (e.target.id === 'modal-close' || e.target.id === 'modal-backdrop') closeTaskModal();
});

// search input listeners (global)
let searchDebounce = null;
document.addEventListener('input', (e) => {
  if (e.target.id === 'search-input') {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => doSearch(e.target.value), 400);
  }
});
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'search-input' && e.key === 'Enter') {
    e.preventDefault();
    doSearch(e.target.value);
  }
  if (e.target.id === 'chat-input' && e.key === 'Enter') {
    e.preventDefault();
    sendChatMessage();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  init();
  initCreateForm();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    checkPendingPayment();
    loadProfile();
  }
});

// ═══ WITHDRAW ═══
window.openWithdrawModal = () => {
  let modal = document.getElementById('withdraw-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'withdraw-modal';
    modal.className = 'modal hidden';
    modal.innerHTML = `
      <div class="modal-backdrop" id="withdraw-modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <span class="modal-id">💸 ВЫВОД</span>
          <button class="modal-close" id="withdraw-modal-close">✕</button>
        </div>
        <h2 class="modal-title">Вывести деньги</h2>
        <p style="color:var(--text-muted);font-size:12px;margin-bottom:12px;">Минимум 500 ₽ • Комиссия 20%</p>
        <div class="form-group">
          <label class="form-label">💰 Сумма (₽)</label>
          <input type="number" id="withdraw-amount" class="form-input" placeholder="Минимум 500" min="500" max="100000">
        </div>
        <div id="withdraw-calc" class="withdraw-calc" style="display:none;">
          <div class="withdraw-calc-row"><span>Сумма:</span><strong id="wc-amount">0 ₽</strong></div>
          <div class="withdraw-calc-row"><span>Комиссия (20%):</span><strong id="wc-commission" style="color:var(--warning);">0 ₽</strong></div>
          <div class="withdraw-calc-row"><span>Получишь:</span><strong id="wc-payout" style="color:var(--success);">0 ₽</strong></div>
        </div>
        <div class="form-group" style="margin-top:12px;">
          <label class="form-label">💳 Куда вывести</label>
          <input type="text" id="withdraw-card" class="form-input" placeholder="Номер карты или телефон" maxlength="100">
        </div>
        <button class="btn-publish" id="withdraw-go" style="margin-top:12px;">💸 Отправить заявку</button>
        <div id="withdraw-status" class="create-status hidden"></div>
        <div style="margin-top:20px;border-top:1px solid var(--border);padding-top:12px;">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">📜 История выводов</div>
          <div id="withdraw-history"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('withdraw-modal-backdrop').addEventListener('click', closeWithdrawModal);
    document.getElementById('withdraw-modal-close').addEventListener('click', closeWithdrawModal);
    document.getElementById('withdraw-go').addEventListener('click', createWithdrawRequest);
    document.getElementById('withdraw-amount').addEventListener('input', () => {
      const amt = parseInt(document.getElementById('withdraw-amount').value, 10);
      const calc = document.getElementById('withdraw-calc');
      if (!amt || amt < 500) { calc.style.display = 'none'; return; }
      const commission = Math.max(Math.round(amt * 0.20), 1);
      const payout = amt - commission;
      document.getElementById('wc-amount').textContent = amt.toLocaleString('ru') + ' ₽';
      document.getElementById('wc-commission').textContent = '-' + commission.toLocaleString('ru') + ' ₽';
      document.getElementById('wc-payout').textContent = payout.toLocaleString('ru') + ' ₽';
      calc.style.display = 'block';
    });
  }
  modal.classList.remove('hidden');
  loadWithdrawHistory();
};

window.closeWithdrawModal = () => {
  const m = document.getElementById('withdraw-modal');
  if (m) m.classList.add('hidden');
};

const createWithdrawRequest = async () => {
  const amount = parseInt(document.getElementById('withdraw-amount').value, 10);
  const card = document.getElementById('withdraw-card').value.trim();
  const statusEl = document.getElementById('withdraw-status');
  const btn = document.getElementById('withdraw-go');
  if (isNaN(amount) || amount < 500) {
    statusEl.textContent = '❌ Минимум 500 ₽';
    statusEl.className = 'create-status error';
    statusEl.classList.remove('hidden');
    return;
  }
  if (!card || card.length < 8) {
    statusEl.textContent = '❌ Укажи карту или телефон';
    statusEl.className = 'create-status error';
    statusEl.classList.remove('hidden');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Отправляю...';
  statusEl.classList.add('hidden');
  try {
    const res = await fetch('/api/app-payment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'withdraw_create', amount, card }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    tg?.HapticFeedback?.notificationOccurred?.('success');
    statusEl.textContent = `✅ Заявка отправлена! К выплате: ${data.payout} ₽`;
    statusEl.className = 'create-status success';
    statusEl.classList.remove('hidden');
    document.getElementById('withdraw-amount').value = '';
    document.getElementById('withdraw-card').value = '';
    const calcEl = document.getElementById('withdraw-calc');
    if (calcEl) calcEl.style.display = 'none';
    loadProfile();
    loadWithdrawHistory();
  } catch (e) {
    statusEl.textContent = `❌ ${e.message}`;
    statusEl.className = 'create-status error';
    statusEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = '💸 Отправить заявку';
  }
};

const loadWithdrawHistory = async () => {
  const el = document.getElementById('withdraw-history');
  if (!el) return;
  try {
    const res = await fetch('/api/app-payment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'withdraw_history' }),
    });
    const data = await res.json();
    if (!data.ok || !safeArr(data.withdrawals).length) {
      el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">Пока нет выводов</div>';
      return;
    }
    const st = { pending: '⏳', approved: '🟡', paid: '✅', rejected: '❌' };
    el.innerHTML = data.withdrawals.map(w => `
      <div style="padding:8px 0;font-size:12px;border-bottom:1px solid rgba(35,45,74,0.4);">
        <div style="display:flex;justify-content:space-between;">
          <span>${st[w.status] || '❓'} ${new Date(w.createdAt).toLocaleDateString('ru-RU')}</span>
          <strong style="color:var(--accent);">${w.amount} ₽</strong>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-top:2px;">
          <span>К получению: ${w.payout || w.amount} ₽</span>
          <span>Комиссия: ${w.commission || 0} ₽</span>
        </div>
      </div>
    `).join('');
  } catch (e) { el.innerHTML = ''; }
};

// ═══ TASKS HISTORY ═══
let tasksHistoryUserId = null;
let tasksHistoryTab = 'player';

window.openTasksHistory = (userId) => {
  tasksHistoryUserId = userId || currentUser?.id;
  tasksHistoryTab = 'player';
  tg?.HapticFeedback?.impactOccurred?.('light');
  let modal = document.getElementById('tasks-history-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'tasks-history-modal';
    modal.className = 'modal hidden';
    modal.innerHTML = `
      <div class="modal-backdrop" id="tasks-history-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <span class="modal-id">📋 ИСТОРИЯ ЗАДАНИЙ</span>
          <button class="modal-close" id="tasks-history-close">✕</button>
        </div>
        <div class="tasks-history-tabs">
          <button class="tasks-history-tab active" data-thtab="player">🎮 Выполнил</button>
          <button class="tasks-history-tab" data-thtab="creator">🎨 Создал</button>
        </div>
        <div id="tasks-history-body"><div class="modal-loading">Загрузка...</div></div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('tasks-history-backdrop').addEventListener('click', closeTasksHistory);
    document.getElementById('tasks-history-close').addEventListener('click', closeTasksHistory);
    modal.querySelectorAll('.tasks-history-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.tasks-history-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        tasksHistoryTab = btn.dataset.thtab;
        loadTasksHistory();
      });
    });
  }
  modal.querySelectorAll('.tasks-history-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.thtab === 'player');
  });
  modal.classList.remove('hidden');
  loadTasksHistory();
};

window.closeTasksHistory = () => {
  const m = document.getElementById('tasks-history-modal');
  if (m) m.classList.add('hidden');
};

const loadTasksHistory = async () => {
  const body = document.getElementById('tasks-history-body');
  if (!body) return;
  body.innerHTML = '<div class="modal-loading">Загрузка...</div>';
  try {
    const res = await fetch('/api/app-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initData,
        action: 'user_tasks',
        targetId: tasksHistoryUserId,
        tab: tasksHistoryTab,
      }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    renderTasksHistory(data);
  } catch (e) {
    body.innerHTML = `<div class="notif-empty">❌ ${escapeHtml(e.message)}</div>`;
  }
};

const renderTasksHistory = (data) => {
  const body = document.getElementById('tasks-history-body');
  if (!body) return;
  const statusLabels = {
    open: '🟢 Открыто', taken: '🟡 Взято', voting: '🗳 Голосование',
    approved: '✅ Выполнено', rejected: '❌ Отклонено',
  };
  let html = '';
  if (data.tab === 'player' && data.stats) {
    html += `<div class="tasks-history-stats">
      <div class="th-stat"><div class="th-stat-icon">✅</div><div class="th-stat-value">${data.stats.approved || 0}</div><div class="th-stat-label">Выполнено</div></div>
      <div class="th-stat"><div class="th-stat-icon">❌</div><div class="th-stat-value">${data.stats.rejected || 0}</div><div class="th-stat-label">Отклонено</div></div>
      <div class="th-stat"><div class="th-stat-icon">💰</div><div class="th-stat-value">${safeNum(data.stats.totalEarned).toLocaleString('ru')}</div><div class="th-stat-label">Заработано ₽</div></div>
    </div>`;
  }
  const tasks = safeArr(data.tasks);
  if (!tasks.length) {
    html += `<div class="notif-empty">${data.tab === 'player' ? '📭 Ещё не выполнял' : '📭 Ещё не создавал'}</div>`;
    body.innerHTML = html;
    return;
  }
  html += '<div class="tasks-history-list">';
  for (const t of tasks) {
    const statusLabel = statusLabels[t.status] || t.status;
    const dateStr = new Date(t.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
    const other = t.otherName
      ? (data.tab === 'player' ? `👤 @${escapeHtml(t.otherName)}` : `🎮 @${escapeHtml(t.otherName)}`)
      : (data.tab === 'creator' ? '<span style="color:var(--text-muted);">Не взят</span>' : '');
    html += `<div class="th-item" data-task-id="${t.id}">
      <div class="th-item-head">
        <div class="th-item-title">${escapeHtml(t.title)}</div>
        <div class="th-item-reward">${t.reward || 0} ₽</div>
      </div>
      <div class="th-item-meta">
        <span class="th-status th-status-${t.status}">${statusLabel}</span>
        <span>${other}</span>
        <span style="margin-left:auto;opacity:0.6;">${dateStr}</span>
      </div>
    </div>`;
  }
  html += '</div>';
  body.innerHTML = html;
  body.querySelectorAll('.th-item').forEach(el => {
    el.addEventListener('click', () => {
      const taskId = parseInt(el.dataset.taskId, 10);
      closeTasksHistory();
      setTimeout(() => openTaskModal(taskId), 150);
    });
  });
};

// ═══ ADMIN ═══
let currentAdminPeriod = 'week';

const loadAdminStats = async (period) => {
  period = period || currentAdminPeriod;
  currentAdminPeriod = period;
  const c = document.getElementById('admin-stats-container');
  if (!c) return;
  c.innerHTML = '<p class="placeholder">Загрузка...</p>';
  try {
    const res = await fetch('/api/app-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, action: 'admin_stats', period }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    renderAdminStats(data);
  } catch (e) {
    c.innerHTML = `<p class="empty-state">❌ ${escapeHtml(e.message)}</p>`;
  }
};

const renderAdminStats = (s) => {
  const c = document.getElementById('admin-stats-container');
  if (!c) return;
  const fmt = (n) => safeNum(n).toLocaleString('ru');
  let html = '';
  html += `<div class="card"><div class="card-label">💰 Доход · ${escapeHtml(s.periodLabel || '')}</div>
    <div class="admin-row"><span>Комиссия</span><strong>${fmt(s.income?.commission)} ₽</strong></div>
    <div class="admin-row"><span>Оборот</span><strong>${fmt(s.income?.gross)} ₽</strong></div>
    <div class="admin-row"><span>Сделок</span><strong>${fmt(s.income?.deals)}</strong></div>
  </div>`;
  html += `<div class="card"><div class="card-label">💳 Пополнения</div>
    <div class="admin-row"><span>Сумма</span><strong>${fmt(s.deposits?.sum)} ₽</strong></div>
    <div class="admin-row"><span>Транзакций</span><strong>${fmt(s.deposits?.cnt)}</strong></div>
  </div>`;
  html += `<div class="card"><div class="card-label">📋 Задания</div>
    <div class="admin-row"><span>Всего</span><strong>${fmt(s.tasks?.total)}</strong></div>
    <div class="admin-row"><span>✅ Выполнено</span><strong>${fmt(s.tasks?.approved)}</strong></div>
    <div class="admin-row"><span>❌ Отклонено</span><strong>${fmt(s.tasks?.rejected)}</strong></div>
  </div>`;
  html += `<div class="card"><div class="card-label">👥 Юзеры</div>
    <div class="admin-row"><span>Всего</span><strong>${fmt(s.users?.total)}</strong></div>
    <div class="admin-row"><span>🎮 Игроки</span><strong>${fmt(s.users?.players)}</strong></div>
    <div class="admin-row"><span>👁 Зрители</span><strong>${fmt(s.users?.viewers)}</strong></div>
  </div>`;
  c.innerHTML = html;
};