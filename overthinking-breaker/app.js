// ── Auth Guard ──
(function() {
  if (!localStorage.getItem('otb_user')) window.location.href = 'index.html';
  const user = localStorage.getItem('otb_user');
  document.getElementById('usernameDisplay').textContent = user;
  document.getElementById('avatarInitial').textContent = user[0].toUpperCase();
})();

// ── Settings ──
function loadSettings() {
  try { return Object.assign({ inactivity: 300, tabSwitch: 10, editThrash: 10 }, JSON.parse(localStorage.getItem('otb_settings') || '{}')); }
  catch { return { inactivity: 300, tabSwitch: 10, editThrash: 10 }; }
}

function saveSettings() {
  const s = {
    inactivity: parseInt(document.getElementById('settingInactivity').value) || 30,
    tabSwitch: parseInt(document.getElementById('settingTabSwitch').value) || 3,
    editThrash: parseInt(document.getElementById('settingEditThrash').value) || 5,
  };
  localStorage.setItem('otb_settings', JSON.stringify(s));
  showToast('Settings saved', 'success');
}

function applySettingsToUI() {
  const s = loadSettings();
  document.getElementById('settingInactivity').value = s.inactivity;
  document.getElementById('settingTabSwitch').value = s.tabSwitch;
  document.getElementById('settingEditThrash').value = s.editThrash;
}

// ── Task State ──
let tasks = [];
let activeTaskId = null;
let taskTimers = {};       // taskId -> { startTime, elapsed }
let timerInterval = null;

// Overthinking signals per active task
let signals = {
  lastActivity: Date.now(),
  tabSwitches: 0,
  editCount: 0,
  popupShown: false,
  usedMiniAction: false,
};

function loadTasks() {
  try { tasks = JSON.parse(localStorage.getItem('otb_tasks') || '[]'); }
  catch { tasks = []; }
}

function saveTasks() {
  localStorage.setItem('otb_tasks', JSON.stringify(tasks));
}

function addTask() {
  const name = document.getElementById('newTaskName').value.trim();
  const category = document.getElementById('newTaskCategory').value;
  if (!name) { showToast('Enter a task name first', 'warn'); return; }

  const task = {
    id: Date.now().toString(),
    name,
    category,
    status: 'idle',   // idle | active | overthinking | done
    createdAt: Date.now(),
    elapsed: 0,
    overthinkCount: 0,
    usedMiniAction: false,
  };

  tasks.push(task);
  saveTasks();
  document.getElementById('newTaskName').value = '';

  const data = loadAnalytics();
  data.tasksAdded++;
  saveAnalytics(data);
  checkBadges(data);

  awardXP(5, 'Task added');
  renderTasks();
}

function startTask(id) {
  if (activeTaskId === id) return;

  const task = tasks.find(t => t.id === id);
  if (!task || task.status === 'done') return;

  // Pause previous
  if (activeTaskId) pauseTask(activeTaskId);

  activeTaskId = id;
  task.status = 'active';
  taskTimers[id] = { startTime: Date.now(), elapsed: task.elapsed || 0 };

  // Reset signals
  signals = { lastActivity: Date.now(), tabSwitches: 0, editCount: 0, popupShown: false, usedMiniAction: task.usedMiniAction };

  saveTasks();
  renderTasks();
  showToast(`Started: ${task.name}`, 'info');

  if (!timerInterval) {
    timerInterval = setInterval(tickTimers, 1000);
  }
}

function pauseTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  if (taskTimers[id]) {
    task.elapsed = (taskTimers[id].elapsed || 0) + (Date.now() - taskTimers[id].startTime);
    recordTaskStat(id, task.name, 'timeSpent', Date.now() - taskTimers[id].startTime);
  }
  if (task.status === 'active' || task.status === 'overthinking') task.status = 'idle';
  saveTasks();
}

function completeTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  if (taskTimers[id]) {
    task.elapsed = (taskTimers[id].elapsed || 0) + (Date.now() - taskTimers[id].startTime);
    recordTaskStat(id, task.name, 'timeSpent', Date.now() - taskTimers[id].startTime);
  }

  const wasClean = task.overthinkCount === 0;
  const wasFast = task.elapsed < 5 * 60 * 1000;

  task.status = 'done';
  if (activeTaskId === id) activeTaskId = null;

  const data = loadAnalytics();
  data.completed++;
  if (wasClean) data.cleanCompletions++;
  if (wasFast) data.fastCompletions++;
  if (task.usedMiniAction) recordTaskStat(id, task.name, 'completedAfterMini', true);
  saveAnalytics(data);
  checkBadges(data);

  awardXP(20, 'Task completed');
  saveTasks();
  renderTasks();
  dismissPopup();
  showToast(`✅ Task completed: ${task.name}`, 'success');
}

function deleteTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  if (activeTaskId === id) { activeTaskId = null; signals = resetSignals(); }
  saveTasks();
  renderTasks();
}

function resetSignals() {
  return { lastActivity: Date.now(), tabSwitches: 0, editCount: 0, popupShown: false, usedMiniAction: false };
}

function tickTimers() {
  if (!activeTaskId) return;
  const task = tasks.find(t => t.id === activeTaskId);
  if (!task || task.status === 'done') return;

  const timer = taskTimers[activeTaskId];
  if (!timer) return;

  const totalElapsed = (timer.elapsed || 0) + (Date.now() - timer.startTime);
  task.elapsed = totalElapsed;

  // Update timer display
  const el = document.getElementById(`timer-${activeTaskId}`);
  if (el) {
    el.textContent = formatTime(totalElapsed);
    el.className = 'task-timer' + (totalElapsed > 10 * 60 * 1000 ? ' warn' : '');
  }

  checkOverthinking(task);
}

function checkOverthinking(task) {
  const s = loadSettings();
  const now = Date.now();
  const inactiveSec = (now - signals.lastActivity) / 1000;

  const triggered =
    inactiveSec >= s.inactivity ||
    signals.tabSwitches >= s.tabSwitch ||
    signals.editCount >= s.editThrash;

  if (triggered && !signals.popupShown) {
    signals.popupShown = true;
    task.overthinkCount++;
    task.status = 'overthinking';

    const data = loadAnalytics();
    data.overthinkingEvents++;
    saveAnalytics(data);
    recordTaskStat(task.id, task.name, 'overthinkCount');

    saveTasks();
    renderTasks();
    showOverthinkingPopup(task, inactiveSec, signals.tabSwitches, signals.editCount);
  }
}

// ── Render ──
function renderTasks() {
  const list = document.getElementById('taskList');
  const activeTasks = tasks.filter(t => t.status !== 'done');
  const overthinkingTasks = tasks.filter(t => t.status === 'overthinking');

  document.getElementById('activeTaskCount').textContent = `${activeTasks.length} active`;
  document.getElementById('overthinkingCount').textContent = `${overthinkingTasks.length} overthinking`;

  if (tasks.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🎯</div>
      <p>No tasks yet. Add one above to get started.</p>
    </div>`;
    return;
  }

  const categoryIcons = { study: '📚', assignment: '📝', project: '💻', reading: '📖', other: '🔧' };

  list.innerHTML = tasks.map(task => {
    const isActive = task.id === activeTaskId;
    const elapsed = task.elapsed || 0;
    const dotClass = task.status === 'done' ? 'done' : task.status === 'overthinking' ? 'overthinking' : isActive ? 'active' : 'idle';
    const itemClass = task.status === 'done' ? 'completed' : task.status === 'overthinking' ? 'overthinking' : isActive ? 'active-task' : '';
    const icon = categoryIcons[task.category] || '🔧';

    return `<div class="task-item ${itemClass}" id="task-${task.id}">
      <div class="task-status-dot ${dotClass}"></div>
      <div class="task-info">
        <div class="task-name">${icon} ${escHtml(task.name)}</div>
        <div class="task-meta">
          ${task.status === 'done' ? '<span class="tag tag-green">Done</span>' : task.status === 'overthinking' ? '<span class="tag tag-warn">⚠️ Overthinking</span>' : isActive ? '<span class="tag tag-cyan">Active</span>' : '<span class="tag" style="background:var(--surface2);color:var(--muted)">Idle</span>'}
          ${task.overthinkCount > 0 ? `<span class="tag tag-warn" style="margin-left:4px">🔁 ${task.overthinkCount}x</span>` : ''}
          ${task.usedMiniAction ? `<span class="tag tag-purple" style="margin-left:4px">⚡ mini-action</span>` : ''}
        </div>
      </div>
      <div class="task-timer ${elapsed > 10 * 60 * 1000 ? 'warn' : ''}" id="timer-${task.id}">${formatTime(elapsed)}</div>
      <div class="task-actions">
        ${task.status !== 'done' ? `<button class="btn btn-secondary btn-sm" onclick="startTask('${task.id}')">${isActive ? '▶ Active' : '▶ Start'}</button>` : ''}
        ${task.status !== 'done' ? `<button class="btn btn-primary btn-sm" onclick="completeTask('${task.id}')">✅</button>` : ''}
        <button class="btn btn-danger btn-sm" onclick="deleteTask('${task.id}')">🗑</button>
      </div>
    </div>`;
  }).join('');
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Mini-Action Suggestions ──
const MINI_ACTIONS = {
  study: [
    'Write down just ONE thing you already know about this topic.',
    'Set a 5-minute timer and read only the first paragraph.',
    'Sketch a rough mind map — no need to be perfect.',
    'Explain the topic out loud to yourself in 30 seconds.',
    'Find one example or analogy that makes it click.',
  ],
  assignment: [
    'Write a messy first sentence — it doesn\'t have to be good.',
    'List 3 bullet points of what the assignment is asking.',
    'Open a blank doc and type your name + the title.',
    'Set a 10-minute sprint: write anything, edit later.',
    'Identify the single most important thing to address first.',
  ],
  project: [
    'Pick the smallest possible feature and start there.',
    'Write a comment block describing what you want to build.',
    'Create the file/folder structure — no code yet.',
    'Google one specific thing you\'re unsure about.',
    'Write pseudocode for just the first function.',
  ],
  reading: [
    'Read only the headings and subheadings first.',
    'Set a goal: understand just the first section.',
    'Write one question you want the reading to answer.',
    'Skim for bold words or key terms.',
    'Read for 5 minutes, then take a 1-minute break.',
  ],
  other: [
    'Break it into 3 smaller steps and do just the first.',
    'Set a 5-minute timer and start without thinking.',
    'Write down what\'s blocking you — then ignore it.',
    'Do the easiest part first to build momentum.',
    'Ask: what\'s the absolute minimum I can do right now?',
  ],
};

let currentPopupTaskId = null;

function showOverthinkingPopup(task, inactiveSec, tabSwitches, editCount) {
  currentPopupTaskId = task.id;

  const reasons = [];
  const s = loadSettings();
  if (inactiveSec >= s.inactivity) reasons.push(`${Math.round(inactiveSec)}s of inactivity`);
  if (tabSwitches >= s.tabSwitch) reasons.push(`${tabSwitches} tab switches`);
  if (editCount >= s.editThrash) reasons.push(`${editCount} repeated edits`);

  document.getElementById('popupSubtitle').textContent =
    `Detected: ${reasons.join(', ')} on "${task.name}"`;

  const steps = MINI_ACTIONS[task.category] || MINI_ACTIONS.other;
  // Pick 3 random steps
  const shuffled = [...steps].sort(() => Math.random() - 0.5).slice(0, 3);

  document.getElementById('miniStepsList').innerHTML = shuffled.map((step, i) =>
    `<div class="mini-step" onclick="useMiniAction('${task.id}', this)">
      <div class="step-num">${i + 1}</div>
      <div class="step-text">${step}</div>
    </div>`
  ).join('');

  document.getElementById('popupOverlay').classList.add('show');
}

function useMiniAction(taskId, el) {
  el.style.borderColor = 'var(--neon3)';
  el.style.background = 'rgba(16,185,129,0.1)';

  const task = tasks.find(t => t.id === taskId);
  if (task) task.usedMiniAction = true;
  saveTasks();

  const data = loadAnalytics();
  data.miniActionsUsed++;
  saveAnalytics(data);
  checkBadges(data);

  awardXP(10, 'Mini-action used');
  signals.usedMiniAction = true;

  setTimeout(() => dismissPopup(), 800);
}

function dismissPopup() {
  document.getElementById('popupOverlay').classList.remove('show');
  currentPopupTaskId = null;

  // Reset signals so detection can fire again after a cooldown
  if (activeTaskId) {
    signals.lastActivity = Date.now();
    signals.tabSwitches = 0;
    signals.editCount = 0;
    signals.popupShown = false;

    const task = tasks.find(t => t.id === activeTaskId);
    if (task && task.status === 'overthinking') {
      task.status = 'active';
      saveTasks();
      renderTasks();
    }
  }
}

function markTaskDone() {
  const id = currentPopupTaskId || activeTaskId;
  if (id) completeTask(id);
}

// ── Behavior Monitoring ──
// Track user activity to detect overthinking signals

document.addEventListener('keydown', () => {
  if (!activeTaskId) return;
  signals.lastActivity = Date.now();
  signals.editCount++;
});

document.addEventListener('mousemove', () => {
  if (!activeTaskId) return;
  signals.lastActivity = Date.now();
});

document.addEventListener('click', () => {
  if (!activeTaskId) return;
  signals.lastActivity = Date.now();
});

// Tab visibility change = tab switch signal
document.addEventListener('visibilitychange', () => {
  if (!activeTaskId) return;
  if (document.hidden) {
    signals.tabSwitches++;
  } else {
    signals.lastActivity = Date.now();
  }
});

// ── Navigation ──
function showPage(name, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  if (el) el.classList.add('active');

  if (name === 'analytics') renderAnalytics();
  if (name === 'badges') { renderBadges(); updateXPBar(loadAnalytics().xp); }
  if (name === 'settings') applySettingsToUI();
}

// ── Toast ──
function showToast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── Misc ──
function logout() {
  if (activeTaskId) pauseTask(activeTaskId);
  localStorage.removeItem('otb_user');
  window.location.href = 'index.html';
}

function clearAllData() {
  if (!confirm('Clear all session data? This cannot be undone.')) return;
  localStorage.removeItem('otb_tasks');
  localStorage.removeItem('otb_analytics');
  tasks = [];
  activeTaskId = null;
  taskTimers = {};
  signals = resetSignals();
  renderTasks();
  showToast('Session data cleared', 'warn');
}

// ── Init ──
loadTasks();
renderTasks();
updateXPBar(loadAnalytics().xp);
lastLevel = getLevelInfo(loadAnalytics().xp).level;

document.getElementById('newTaskName').addEventListener('keydown', e => {
  if (e.key === 'Enter') addTask();
});
