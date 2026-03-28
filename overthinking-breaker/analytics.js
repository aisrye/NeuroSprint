// ── Gamification Config ──
const LEVELS = [
  { level: 1, title: 'Rookie Thinker',    xpNeeded: 100 },
  { level: 2, title: 'Focus Apprentice',  xpNeeded: 250 },
  { level: 3, title: 'Flow Seeker',       xpNeeded: 500 },
  { level: 4, title: 'Mind Breaker',      xpNeeded: 900 },
  { level: 5, title: 'Clarity Master',    xpNeeded: Infinity },
];

const BADGE_DEFS = [
  { id: 'first_task',    icon: '🎯', name: 'First Step',     desc: 'Add your first task',          check: s => s.tasksAdded >= 1 },
  { id: 'first_done',    icon: '✅', name: 'Done Deal',       desc: 'Complete your first task',     check: s => s.completed >= 1 },
  { id: 'five_done',     icon: '🔥', name: 'On Fire',         desc: 'Complete 5 tasks',             check: s => s.completed >= 5 },
  { id: 'breaker',       icon: '💥', name: 'Block Breaker',   desc: 'Use a mini-action once',       check: s => s.miniActionsUsed >= 1 },
  { id: 'breaker5',      icon: '⚡', name: 'Action Hero',     desc: 'Use mini-actions 5 times',     check: s => s.miniActionsUsed >= 5 },
  { id: 'no_overthink',  icon: '🧘', name: 'Zen Mode',        desc: 'Complete a task without overthinking', check: s => s.cleanCompletions >= 1 },
  { id: 'speed_run',     icon: '🚀', name: 'Speed Runner',    desc: 'Complete a task in under 5 min', check: s => s.fastCompletions >= 1 },
  { id: 'xp100',         icon: '🌟', name: 'Century',         desc: 'Earn 100 XP',                  check: s => s.xp >= 100 },
];

// ── Analytics State ──
function loadAnalytics() {
  const defaults = {
    xp: 0,
    tasksAdded: 0,
    completed: 0,
    overthinkingEvents: 0,
    miniActionsUsed: 0,
    cleanCompletions: 0,
    fastCompletions: 0,
    earnedBadges: [],
    taskStats: {},   // taskId -> { name, overthinkCount, timeSpent, completedAfterMini }
  };
  try {
    return Object.assign(defaults, JSON.parse(localStorage.getItem('otb_analytics') || '{}'));
  } catch { return defaults; }
}

function saveAnalytics(data) {
  localStorage.setItem('otb_analytics', JSON.stringify(data));
}

function awardXP(amount, reason) {
  const data = loadAnalytics();
  data.xp += amount;
  saveAnalytics(data);
  showToast(`+${amount} XP — ${reason}`, 'info');
  updateXPBar(data.xp);
  checkBadges(data);
  checkLevelUp(data);
}

function updateXPBar(xp) {
  const level = getLevelInfo(xp);
  const pct = level.next === Infinity ? 100 : Math.min(100, ((xp - level.prevXp) / (level.next - level.prevXp)) * 100);
  document.getElementById('xpLabel').textContent = `${xp} XP`;
  document.getElementById('xpFill').style.width = pct + '%';
  document.getElementById('levelCircle').textContent = level.level;
  document.getElementById('levelTitle').textContent = level.title;
  document.getElementById('levelSub').textContent = `${xp} / ${level.next === Infinity ? '∞' : level.next} XP`;
  document.getElementById('levelXpFill').style.width = pct + '%';
}

function getLevelInfo(xp) {
  let cumulative = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    const prevXp = cumulative;
    if (xp < LEVELS[i].xpNeeded || i === LEVELS.length - 1) {
      return { level: LEVELS[i].level, title: LEVELS[i].title, next: LEVELS[i].xpNeeded, prevXp };
    }
    cumulative = LEVELS[i].xpNeeded;
  }
  return { level: 5, title: 'Clarity Master', next: Infinity, prevXp: 900 };
}

let lastLevel = 1;
function checkLevelUp(data) {
  const info = getLevelInfo(data.xp);
  if (info.level > lastLevel) {
    lastLevel = info.level;
    showToast(`🎉 Level Up! You're now Level ${info.level}: ${info.title}`, 'success');
  }
}

function checkBadges(data) {
  BADGE_DEFS.forEach(b => {
    if (!data.earnedBadges.includes(b.id) && b.check(data)) {
      data.earnedBadges.push(b.id);
      saveAnalytics(data);
      showToast(`🏆 Badge Unlocked: ${b.name}!`, 'success');
      renderBadges();
    }
  });
}

function renderBadges() {
  const data = loadAnalytics();
  const grid = document.getElementById('badgesGrid');
  grid.innerHTML = BADGE_DEFS.map(b => {
    const earned = data.earnedBadges.includes(b.id);
    return `<div class="badge-item ${earned ? 'earned' : 'locked'}">
      <div class="badge-icon">${b.icon}</div>
      <div class="badge-name">${b.name}</div>
      <div class="badge-desc">${b.desc}</div>
    </div>`;
  }).join('');
}

function renderAnalytics() {
  const data = loadAnalytics();

  document.getElementById('statTasksAdded').textContent = data.tasksAdded;
  document.getElementById('statCompleted').textContent = data.completed;
  document.getElementById('statOverthinking').textContent = data.overthinkingEvents;
  document.getElementById('statMiniActions').textContent = data.miniActionsUsed;

  // Overthinking chart
  const oChart = document.getElementById('overthinkingChart');
  const tChart = document.getElementById('timeChart');
  const stats = data.taskStats || {};
  const keys = Object.keys(stats);

  if (keys.length === 0) {
    oChart.innerHTML = '<div class="empty-state" style="padding:20px"><p>No data yet.</p></div>';
    tChart.innerHTML = '<div class="empty-state" style="padding:20px"><p>No data yet.</p></div>';
  } else {
    const maxO = Math.max(...keys.map(k => stats[k].overthinkCount || 0), 1);
    const maxT = Math.max(...keys.map(k => Math.round((stats[k].timeSpent || 0) / 60000)), 1);

    oChart.innerHTML = keys.map(k => {
      const val = stats[k].overthinkCount || 0;
      const pct = Math.round((val / maxO) * 100);
      return `<div class="chart-bar-row">
        <div class="chart-bar-label" title="${stats[k].name}">${stats[k].name}</div>
        <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${pct}%;background:var(--warn)"></div></div>
        <div class="chart-bar-val">${val}</div>
      </div>`;
    }).join('');

    tChart.innerHTML = keys.map(k => {
      const val = Math.round((stats[k].timeSpent || 0) / 60000);
      const pct = Math.round((val / maxT) * 100);
      return `<div class="chart-bar-row">
        <div class="chart-bar-label" title="${stats[k].name}">${stats[k].name}</div>
        <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${pct}%;background:var(--neon2)"></div></div>
        <div class="chart-bar-val">${val}m</div>
      </div>`;
    }).join('');
  }

  // Mini-action success
  const successEl = document.getElementById('miniActionSuccess');
  const successTasks = keys.filter(k => stats[k].completedAfterMini);
  if (successTasks.length === 0) {
    successEl.innerHTML = '<div class="empty-state" style="padding:20px"><p>No completions yet.</p></div>';
  } else {
    successEl.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">` +
      successTasks.map(k => `<span class="tag tag-green">✅ ${stats[k].name}</span>`).join('') +
      `</div>`;
  }

  updateXPBar(data.xp);
  renderBadges();
}

function recordTaskStat(taskId, taskName, field, value) {
  const data = loadAnalytics();
  if (!data.taskStats[taskId]) data.taskStats[taskId] = { name: taskName, overthinkCount: 0, timeSpent: 0, completedAfterMini: false };
  if (field === 'overthinkCount') data.taskStats[taskId].overthinkCount++;
  if (field === 'timeSpent') data.taskStats[taskId].timeSpent += value;
  if (field === 'completedAfterMini') data.taskStats[taskId].completedAfterMini = true;
  saveAnalytics(data);
}
