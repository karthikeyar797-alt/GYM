/* DayFlow – Personal Daily Planner. Vanilla JS, no build step. */
(function () {
  'use strict';

  /* ================= helpers ================= */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.prototype.slice.call(r.querySelectorAll(s));
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseYmd = s => { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
  const today = () => ymd(new Date());
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toMin = t => { if (!t) return null; const p = t.split(':'); return +p[0] * 60 + +p[1]; };
  const fromMin = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  const fmtDur = m => { const h = Math.floor(m / 60), mm = m % 60; return (h ? h + 'h ' : '') + (mm || !h ? mm + 'm' : '').trim(); };
  const litres = ml => (ml / 1000).toFixed(ml % 1000 === 0 ? 0 : 2).replace(/0$/, '') + 'L';
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const fmtDate = s => { const d = parseYmd(s); return DOW[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getFullYear(); };
  const fmtShort = s => { const d = parseYmd(s); return d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3); };
  const mondayOf = s => { const d = parseYmd(s); const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return ymd(d); };

  const CATS = { Study: '#6366f1', Work: '#0ea5e9', Gym: '#f97316', Personal: '#ec4899', Health: '#10b981', Other: '#94a3b8' };
  const CAT_ICONS = { Study: '📚', Work: '💼', Gym: '🏋️', Personal: '🌸', Health: '🩺', Other: '📌' };
  const PRIOS = ['High', 'Medium', 'Low'];
  const REMINDERS = [['', 'No reminder'], ['0', 'At start time'], ['5', '5 minutes before'], ['15', '15 minutes before'], ['30', '30 minutes before'], ['60', '1 hour before'], ['1440', '1 day before']];
  const NAV = [
    ['dashboard', '🏠', 'Dashboard'], ['calendar', '📅', 'Calendar'], ['tasks', '✅', 'Tasks'], ['habits', '🔄', 'Habits'],
    ['water', '💧', 'Water'], ['focus', '⏱', 'Focus'], ['notes', '📝', 'Notes'], ['analytics', '📊', 'Analytics'],
    ['review', '🌙', 'Daily Review'], ['plan', '🗓', 'Plan Tomorrow'], ['settings', '⚙️', 'Settings']
  ];
  const BOTTOM = [['dashboard', '🏠', 'Home'], ['calendar', '📅', 'Calendar'], ['tasks', '✅', 'Tasks'], ['habits', '🔄', 'Habits'], ['settings', '👤', 'Profile']];

  /* ================= state ================= */
  let user = null, state = null;
  let apiBase = '', authToken = localStorage.getItem('dayflow:token') || '', dbOnline = false;
  const ui = { view: 'dashboard', date: today(), calView: 'month', calCursor: today(), menu: null, catFilter: 'all', noteTag: 'all', noteQuery: '', heatHabit: 'all', justDone: null, reviewDate: today(), sidebar: false, bannerDismissed: false };
  const timer = { mode: 'focus', total: 1500, remaining: 1500, running: false, endAt: 0 };

  /* ================= SQLite API Client ================= */
  async function detectApiBase() {
    const candidates = [
      window.location.origin,
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:8000',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001'
    ];
    for (const base of candidates) {
      if (!base || base === 'null' || base.startsWith('file:')) continue;
      try {
        const res = await fetch(base + '/api/status', { method: 'GET', signal: AbortSignal.timeout(1500) });
        if (res.ok) {
          const data = await res.json();
          if (data && data.database === 'SQLite') {
            apiBase = base;
            dbOnline = true;
            updateDbStatus(true, 'SQLite DB Ready');
            return base;
          }
        }
      } catch (e) { /* try next */ }
    }
    dbOnline = false;
    updateDbStatus(false, 'SQLite Server Offline');
    return '';
  }

  function updateDbStatus(online, text) {
    const badge = $('#dbStatusBadge'), txt = $('#dbStatusText');
    if (!badge || !txt) return;
    if (online) {
      badge.classList.remove('error');
      txt.textContent = text || 'SQLite DB Ready';
    } else {
      badge.classList.add('error');
      txt.textContent = text || 'SQLite Server Offline';
    }
  }

  async function apiRequest(endpoint, method = 'GET', body = null) {
    if (!apiBase) await detectApiBase();
    if (!apiBase) {
      return { ok: false, error: 'Cannot connect to SQLite server. Run "node server.js"' };
    }
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    try {
      const res = await fetch(apiBase + endpoint, opts);
      const data = await res.json().catch(() => ({ ok: false, error: 'Invalid response from server' }));
      if (!res.ok && !data.error) data.error = 'Request failed (' + res.status + ')';
      return data;
    } catch (err) {
      return { ok: false, error: 'Network error: ' + err.message };
    }
  }

  function defaultState() {
    return {
      profile: { name: '', photo: '' },
      tasks: [], events: [], habits: [], habitLogs: {}, waterLogs: [], focus: [], notes: [], reviews: {},
      schedule: [], schedules: {}, notifs: [], fired: {}, lastDay: today(),
      settings: { theme: 'system', waterGoal: 3000, glass: 250, focusMin: 25, breakMin: 5, taskDuration: 60, remTask: true, remWater: true, remHabit: true, browserNotif: false, waterInterval: 90, smart: true }
    };
  }
  function mergeState(s) {
    const d = defaultState();
    const out = Object.assign({}, d, s || {});
    out.settings = Object.assign({}, d.settings, (s && s.settings) || {});
    out.profile = Object.assign({}, d.profile, (s && s.profile) || {});
    ['tasks', 'events', 'habits', 'waterLogs', 'focus', 'notes', 'schedule', 'notifs'].forEach(k => { if (!Array.isArray(out[k])) out[k] = []; });
    ['habitLogs', 'reviews', 'schedules', 'fired'].forEach(k => { if (!out[k] || typeof out[k] !== 'object') out[k] = {}; });
    return out;
  }

  /* ================= persistence ================= */
  const storeKey = () => 'dayflow:' + (user ? user.uid : 'guest');
  let syncTimer = null;
  function save() {
    if (!user || !state) return;
    try { localStorage.setItem(storeKey(), JSON.stringify(state)); } catch (e) { toast('Could not save locally: ' + e.message); }
    if (apiBase && authToken && !user.demo) {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(async function () {
        try {
          const res = await apiRequest('/api/data', 'POST', { data: state });
          if (!res.ok && res.error) console.warn('SQLite sync warning:', res.error);
        } catch (e) { console.warn('SQLite sync error:', e); }
      }, 600);
    }
  }
  async function loadState(cloudData = null) {
    let local = null;
    try { local = JSON.parse(localStorage.getItem(storeKey()) || 'null'); } catch (e) { local = null; }
    let cloud = cloudData;
    if (!cloud && apiBase && authToken && user && !user.demo) {
      try {
        const res = await apiRequest('/api/data', 'GET');
        if (res.ok && res.data) cloud = res.data;
      } catch (e) { console.warn('Could not load from SQLite:', e); }
    }
    state = mergeState(cloud || local);
  }

  /* ================= data helpers ================= */
  const waterTotal = d => state.waterLogs.filter(w => w.date === d).reduce((a, w) => a + w.ml, 0);
  const focusMins = d => state.focus.filter(f => f.date === d).reduce((a, f) => a + f.mins, 0);
  const habitDone = (id, d) => !!(state.habitLogs[id] && state.habitLogs[id][d]);
  function dayStats(d) {
    const t = state.tasks.filter(x => x.date === d);
    const td = t.filter(x => x.done).length;
    const hs = state.habits.length;
    const hd = state.habits.filter(h => habitDone(h.id, d)).length;
    const w = waterTotal(d), goal = state.settings.waterGoal || 3000;
    const parts = [];
    if (t.length) parts.push(td / t.length);
    if (hs) parts.push(hd / hs);
    parts.push(Math.min(1, w / goal));
    const pct = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length * 100);
    return { tasks: t.length, tasksDone: td, habits: hs, habitsDone: hd, water: w, waterPct: Math.min(100, Math.round(w / goal * 100)), focus: focusMins(d), pct: pct };
  }
  const dayActive = d => { const s = dayStats(d); return s.tasksDone > 0 || s.habitsDone > 0 || s.water > 0 || s.focus > 0; };
  function overallStreak() {
    let d = today(), n = 0;
    if (!dayActive(d)) d = addDays(d, -1);
    while (dayActive(d) && n < 3650) { n++; d = addDays(d, -1); }
    return n;
  }
  function habitStreak(id) {
    let d = today(), n = 0;
    if (!habitDone(id, d)) d = addDays(d, -1);
    while (habitDone(id, d) && n < 3650) { n++; d = addDays(d, -1); }
    return n;
  }
  function habitBest(id) {
    const days = Object.keys(state.habitLogs[id] || {}).filter(k => state.habitLogs[id][k]).sort();
    let best = 0, cur = 0, prev = null;
    days.forEach(function (d) { cur = prev && addDays(prev, 1) === d ? cur + 1 : 1; if (cur > best) best = cur; prev = d; });
    return best;
  }
  function habitRange(id, from, to) { let n = 0, tot = 0; for (let d = from; d <= to; d = addDays(d, 1)) { tot++; if (habitDone(id, d)) n++; } return { n: n, tot: tot }; }
  function itemsFor(d) {
    const out = [];
    state.tasks.filter(t => t.date === d).forEach(t => out.push({ type: 'task', id: t.id, title: t.title, start: t.start, end: t.end, category: t.category, done: t.done, reminder: t.reminder, priority: t.priority }));
    state.events.filter(e => e.date === d).forEach(e => out.push({ type: 'event', id: e.id, title: e.title, start: e.start, end: e.end, category: e.category, done: false, reminder: e.reminder }));
    out.sort((a, b) => (a.start || '99:99').localeCompare(b.start || '99:99'));
    return out;
  }
  const getSched = d => (state.schedules[d] || state.schedule).slice().sort((a, b) => a.time.localeCompare(b.time));
  function editableSched(d) {
    if (!state.schedules[d]) state.schedules[d] = state.schedule.map(x => Object.assign({}, x));
    return state.schedules[d];
  }
  function mergedSchedule(d) {
    const out = getSched(d).map(r => ({ src: 'routine', id: r.id, time: r.time, label: r.label, color: '#8b5cf6' }));
    itemsFor(d).filter(i => i.start).forEach(i => out.push({ src: i.type, id: i.id, time: i.start, label: i.title, end: i.end, done: i.done, color: CATS[i.category] || CATS.Other }));
    return out.sort((a, b) => a.time.localeCompare(b.time));
  }

  /* ================= notifications ================= */
  function notify(text, opts) {
    opts = opts || {};
    state.notifs.unshift({ id: uid(), text: text, time: Date.now(), read: false });
    state.notifs = state.notifs.slice(0, 60);
    save();
    toast(text);
    if (state.settings.browserNotif && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification('DayFlow', { body: text.replace(/[^\x00-\x7F]+/g, '').trim() || text, tag: opts.tag || undefined }); } catch (e) { /* ignore */ }
    }
    renderHeader();
    renderRight();
  }
  function toast(msg) {
    const root = $('#toasts'); if (!root) return;
    const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg;
    root.appendChild(el);
    setTimeout(function () { el.remove(); }, 4500);
  }
  function checkReminders() {
    if (!state) return;
    const now = new Date(), nowMs = now.getTime(), td = today();
    const fire = (key, text) => { if (state.fired[key]) return; state.fired[key] = nowMs; notify(text, { tag: key }); };
    const consider = (kind, it) => {
      if (it.reminder === '' || it.reminder == null || !it.start || !state.settings.remTask) return;
      if (kind === 'task' && it.done) return;
      const startMs = parseYmd(it.date).getTime() + toMin(it.start) * 60000;
      const at = startMs - Number(it.reminder) * 60000;
      if (nowMs >= at && nowMs < startMs + 6 * 3600000) {
        const mins = Math.round((startMs - nowMs) / 60000);
        const when = mins > 1 ? 'starts in ' + (mins >= 120 ? Math.round(mins / 60) + ' hours' : mins + ' minutes') : mins === 1 ? 'starts in 1 minute' : 'is starting now';
        fire(kind + ':' + it.id + ':' + it.date + ':' + it.reminder, (kind === 'event' ? '📅 ' : '✅ ') + it.title + ' ' + when + '.');
      }
    };
    state.tasks.forEach(t => consider('task', t));
    state.events.forEach(e => consider('event', e));
    if (state.settings.remHabit) {
      state.habits.forEach(function (h) {
        if (!h.time || habitDone(h.id, td)) return;
        const at = parseYmd(td).getTime() + toMin(h.time) * 60000;
        if (nowMs >= at && nowMs < at + 3 * 3600000) fire('habit:' + h.id + ':' + td, h.icon + ' Time for your habit: ' + h.name);
      });
    }
    if (state.settings.remWater) {
      const hr = now.getHours();
      const iv = Math.max(15, Number(state.settings.waterInterval) || 90) * 60000;
      if (hr >= 8 && hr < 22 && waterTotal(td) < state.settings.waterGoal) {
        if (!state.lastWater) { state.lastWater = nowMs; save(); }
        else if (nowMs - state.lastWater >= iv) { state.lastWater = nowMs; notify('Time to drink water 💧', { tag: 'water' }); }
      }
    }
    // tidy old fired keys
    const keys = Object.keys(state.fired);
    if (keys.length > 400) keys.sort((a, b) => state.fired[a] - state.fired[b]).slice(0, keys.length - 300).forEach(k => delete state.fired[k]);
  }

  /* ================= modal ================= */
  function modal(title, body, onSubmit, opts) {
    opts = opts || {};
    const root = $('#modalRoot');
    root.innerHTML = '<div class="overlay" data-action="closeModalBg"><form class="modal" autocomplete="off"><div class="modal-head"><h3>' + esc(title) + '</h3><button type="button" class="icon-btn" data-action="closeModal" aria-label="Close">✕</button></div><div class="modal-body">' + body + '</div><div class="modal-foot"><button type="button" class="btn ghost" data-action="closeModal">Cancel</button><button class="btn ' + (opts.danger ? 'danger' : 'primary') + '">' + esc(opts.submit || 'Save') + '</button></div></form></div>';
    const form = $('form', root);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const r = onSubmit(new FormData(form));
      if (r !== false) closeModal();
    });
    setTimeout(function () { const f = form.querySelector('input:not([type=hidden]),textarea,select'); if (f) f.focus(); }, 30);
  }
  function closeModal() { $('#modalRoot').innerHTML = ''; }
  function confirmBox(title, msg, onYes, label) {
    modal(title, '<p>' + esc(msg) + '</p>', function () { onYes(); }, { danger: true, submit: label || 'Delete' });
  }
  const optList = (arr, sel) => arr.map(v => '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(v) + '</option>').join('');
  const remOpts = sel => REMINDERS.map(r => '<option value="' + r[0] + '"' + (String(sel == null ? '' : sel) === r[0] ? ' selected' : '') + '>' + r[1] + '</option>').join('');

  /* ================= forms ================= */
  function taskModal(id, preset) {
    const t = id ? state.tasks.find(x => x.id === id) : null;
    const v = t || Object.assign({ title: '', desc: '', date: ui.date, start: '', end: '', priority: 'Medium', category: 'Personal', reminder: '' }, preset || {});
    modal(t ? 'Edit task' : 'New task',
      '<div class="field"><label>Task title *</label><input name="title" required maxlength="140" value="' + esc(v.title) + '" placeholder="e.g. Complete assignment"></div>' +
      '<div class="field"><label>Description</label><textarea name="desc" maxlength="1000">' + esc(v.desc) + '</textarea></div>' +
      '<div class="row3"><div class="field"><label>Date *</label><input type="date" name="date" required value="' + esc(v.date) + '"></div>' +
      '<div class="field"><label>Start time</label><input type="time" name="start" value="' + esc(v.start) + '"></div>' +
      '<div class="field"><label>End time</label><input type="time" name="end" value="' + esc(v.end) + '"></div></div>' +
      '<div class="row2"><div class="field"><label>Priority</label><select name="priority">' + optList(PRIOS, v.priority) + '</select></div>' +
      '<div class="field"><label>Category</label><select name="category">' + optList(Object.keys(CATS), v.category) + '</select></div></div>' +
      '<div class="field"><label>Reminder (needs a start time)</label><select name="reminder">' + remOpts(v.reminder) + '</select></div>',
      function (f) {
        const title = String(f.get('title')).trim();
        if (!title) { toast('Please enter a title'); return false; }
        let start = f.get('start') || '', end = f.get('end') || '';
        if (start && !end) end = fromMin(Math.min(1439, toMin(start) + (Number(state.settings.taskDuration) || 60)));
        if (start && end && end <= start) { toast('End time must be after start time'); return false; }
        const rem = String(f.get('reminder') || '');
        if (rem !== '' && !start) { toast('Add a start time to use a reminder'); return false; }
        const data = { title: title, desc: String(f.get('desc') || '').trim(), date: f.get('date'), start: start, end: end, priority: f.get('priority'), category: f.get('category'), reminder: rem };
        if (t) Object.assign(t, data);
        else state.tasks.push(Object.assign({ id: uid(), done: false, doneAt: null }, data));
        save(); render(); toast(t ? 'Task updated' : 'Task added');
      });
  }
  function eventModal(id, preset) {
    const e0 = id ? state.events.find(x => x.id === id) : null;
    const v = e0 || Object.assign({ title: '', date: ui.date, start: '09:00', end: '10:00', category: 'Study', reminder: '15', notes: '' }, preset || {});
    modal(e0 ? 'Edit event' : 'New event',
      '<div class="field"><label>Event title *</label><input name="title" required maxlength="140" value="' + esc(v.title) + '" placeholder="e.g. DSA Study"></div>' +
      '<div class="row3"><div class="field"><label>Date *</label><input type="date" name="date" required value="' + esc(v.date) + '"></div>' +
      '<div class="field"><label>Start</label><input type="time" name="start" required value="' + esc(v.start) + '"></div>' +
      '<div class="field"><label>End</label><input type="time" name="end" required value="' + esc(v.end) + '"></div></div>' +
      '<div class="row2"><div class="field"><label>Category</label><select name="category">' + optList(Object.keys(CATS), v.category) + '</select></div>' +
      '<div class="field"><label>Reminder</label><select name="reminder">' + remOpts(v.reminder) + '</select></div></div>' +
      '<div class="field"><label>Notes</label><textarea name="notes">' + esc(v.notes) + '</textarea></div>',
      function (f) {
        const title = String(f.get('title')).trim();
        if (!title) { toast('Please enter a title'); return false; }
        const start = f.get('start'), end = f.get('end');
        if (!start || !end || end <= start) { toast('End time must be after start time'); return false; }
        const data = { title: title, date: f.get('date'), start: start, end: end, category: f.get('category'), reminder: String(f.get('reminder') || ''), notes: String(f.get('notes') || '') };
        if (e0) Object.assign(e0, data); else state.events.push(Object.assign({ id: uid() }, data));
        save(); render(); toast(e0 ? 'Event updated' : 'Event added');
      });
  }
  function habitModal(id) {
    const h = id ? state.habits.find(x => x.id === id) : null;
    const v = h || { name: '', icon: '✨', time: '' };
    modal(h ? 'Edit habit' : 'New habit',
      '<div class="row2"><div class="field"><label>Name *</label><input name="name" required maxlength="60" value="' + esc(v.name) + '" placeholder="e.g. Meditation"></div>' +
      '<div class="field"><label>Emoji</label><input name="icon" maxlength="4" value="' + esc(v.icon) + '"></div></div>' +
      '<div class="field"><label>Daily reminder time (optional)</label><input type="time" name="time" value="' + esc(v.time) + '"></div>',
      function (f) {
        const name = String(f.get('name')).trim();
        if (!name) { toast('Please enter a name'); return false; }
        const data = { name: name, icon: String(f.get('icon') || '✨').trim() || '✨', time: f.get('time') || '' };
        if (h) Object.assign(h, data); else state.habits.push(Object.assign({ id: uid() }, data));
        save(); render(); toast(h ? 'Habit updated' : 'Habit added');
      });
  }
  function noteModal(id) {
    const n = id ? state.notes.find(x => x.id === id) : null;
    const v = n || { title: '', content: '', date: today(), tags: [] };
    modal(n ? 'Edit note' : 'New note',
      '<div class="field"><label>Title *</label><input name="title" required maxlength="120" value="' + esc(v.title) + '"></div>' +
      '<div class="field"><label>Content</label><textarea name="content" style="min-height:160px">' + esc(v.content) + '</textarea></div>' +
      '<div class="row2"><div class="field"><label>Date</label><input type="date" name="date" value="' + esc(v.date) + '"></div>' +
      '<div class="field"><label>Tags (comma separated)</label><input name="tags" value="' + esc(v.tags.join(', ')) + '" placeholder="study, idea, daily"></div></div>',
      function (f) {
        const title = String(f.get('title')).trim();
        if (!title) { toast('Please enter a title'); return false; }
        const tags = String(f.get('tags') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        const data = { title: title, content: String(f.get('content') || ''), date: f.get('date') || today(), tags: tags };
        if (n) Object.assign(n, data); else state.notes.unshift(Object.assign({ id: uid() }, data));
        save(); render(); toast('Note saved');
      });
  }
  function schedModal(date, id) {
    const list = state.schedules[date] || state.schedule;
    const r = id ? list.find(x => x.id === id) : null;
    modal(r ? 'Edit schedule item' : 'Add schedule item',
      '<div class="row2"><div class="field"><label>Time *</label><input type="time" name="time" required value="' + esc(r ? r.time : '08:00') + '"></div>' +
      '<div class="field"><label>Activity *</label><input name="label" required maxlength="80" value="' + esc(r ? r.label : '') + '" placeholder="e.g. Breakfast"></div></div>',
      function (f) {
        const label = String(f.get('label')).trim();
        if (!label) { toast('Please enter an activity'); return false; }
        const arr = editableSched(date);
        if (r) { const it = arr.find(x => x.id === id); if (it) { it.time = f.get('time'); it.label = label; } }
        else arr.push({ id: uid(), time: f.get('time'), label: label });
        save(); render();
      });
  }
  function waterCustomModal() {
    modal('Add water', '<div class="field"><label>Amount (ml) *</label><input type="number" name="ml" min="10" max="5000" step="10" required value="' + (state.settings.glass || 250) + '"></div>',
      function (f) { const ml = Number(f.get('ml')); if (!(ml > 0) || ml > 5000) { toast('Enter 1–5000 ml'); return false; } addWater(ml); });
  }

  /* ================= actions ================= */
  function addWater(ml) {
    state.waterLogs.push({ id: uid(), date: today(), time: fromMin(new Date().getHours() * 60 + new Date().getMinutes()), ml: ml });
    state.lastWater = Date.now();
    save(); render();
    const left = state.settings.waterGoal - waterTotal(today());
    toast(left > 0 ? '💧 +' + ml + ' ml · ' + litres(left) + ' to go' : '🎉 Daily water goal reached!');
  }
  function burst(el) {
    if (!el) return;
    const r = el.getBoundingClientRect(); const box = document.createElement('div');
    box.className = 'confetti'; box.style.left = (r.left + r.width / 2) + 'px'; box.style.top = (r.top + r.height / 2) + 'px';
    const colors = ['#10b981', '#6366f1', '#f59e0b', '#ec4899', '#0ea5e9'];
    for (let i = 0; i < 14; i++) {
      const p = document.createElement('i'); const a = Math.random() * Math.PI * 2, d = 30 + Math.random() * 40;
      p.style.background = colors[i % colors.length]; p.style.setProperty('--x', Math.cos(a) * d + 'px'); p.style.setProperty('--y', Math.sin(a) * d + 'px'); p.style.setProperty('--r', Math.random() * 360 + 'deg');
      box.appendChild(p);
    }
    document.body.appendChild(box); setTimeout(function () { box.remove(); }, 900);
  }
  function loadSample() {
    const d = today();
    const rt = [['07:00', 'Wake up'], ['07:30', 'Breakfast'], ['09:00', 'College'], ['13:00', 'Lunch'], ['17:00', 'Gym'], ['19:00', 'DSA Practice'], ['21:00', 'Dinner'], ['22:00', 'Project Work'], ['23:00', 'Sleep']];
    state.schedule = rt.map(r => ({ id: uid(), time: r[0], label: r[1] }));
    const T = (title, cat, prio, start, end, rem) => state.tasks.push({ id: uid(), title: title, desc: '', date: d, start: start, end: end, priority: prio, category: cat, reminder: rem, done: false, doneAt: null });
    T('Complete DSA problems', 'Study', 'High', '19:00', '20:30', '15');
    T('Work on AI project', 'Work', 'High', '22:00', '23:00', '15');
    T('Go to gym', 'Gym', 'Medium', '17:00', '18:00', '30');
    T('Read 20 pages', 'Personal', 'Low', '', '', '');
    T('Drink 3L water', 'Health', 'Medium', '', '', '');
    const E = (title, cat, s, e) => state.events.push({ id: uid(), title: title, date: d, start: s, end: e, category: cat, reminder: '15', notes: '' });
    E('College', 'Study', '09:00', '13:00'); E('DSA Study', 'Study', '19:00', '20:30');
    [['Workout', '🏋️', '17:00'], ['Study', '📚', ''], ['Read', '📖', ''], ['Meditation', '🧘', '07:15'], ['Drink water', '💧', ''], ['Coding practice', '💻', '']].forEach(h => state.habits.push({ id: uid(), name: h[0], icon: h[1], time: h[2] }));
    save(); render(); toast('Sample day loaded ✨');
  }

  /* ================= small components ================= */
  const avatar = (cls) => {
    const p = state.profile.photo || user.photoURL; const name = displayName();
    return p ? '<img class="avatar ' + (cls || '') + '" src="' + esc(p) + '" alt="" referrerpolicy="no-referrer">' : '<div class="avatar ' + (cls || '') + '">' + esc((name[0] || '?').toUpperCase()) + '</div>';
  };
  const displayName = () => (state.profile.name || user.displayName || (user.email || 'there').split('@')[0]);
  const firstName = () => displayName().split(' ')[0];
  const catChip = c => '<span class="chip" style="--c:' + (CATS[c] || CATS.Other) + '">' + (CAT_ICONS[c] || '') + ' ' + esc(c) + '</span>';
  const emptyBox = (e, msg, btn) => '<div class="empty"><span class="e">' + e + '</span>' + msg + (btn ? '<div style="margin-top:10px">' + btn + '</div>' : '') + '</div>';
  const progress = (pct, cls) => '<div class="progress ' + (cls || '') + '"><i style="width:' + Math.max(0, Math.min(100, pct)) + '%"></i></div>';

  function taskItem(t) {
    const rem = t.reminder !== '' && t.reminder != null ? '<span class="chip plain">🔔 ' + (t.reminder === '0' ? 'at start' : t.reminder === '1440' ? '1d before' : t.reminder + 'm before') + '</span>' : '';
    return '<div class="task ' + (t.done ? 'done' : '') + (ui.justDone === t.id ? ' pop' : '') + '" draggable="' + (!t.done) + '" data-drag="' + t.id + '">' +
      '<button class="check ' + (t.done ? 'on' : '') + '" data-action="toggleTask" data-id="' + t.id + '" aria-label="' + (t.done ? 'Mark incomplete' : 'Mark complete') + '">' + (t.done ? '✓' : '') + '</button>' +
      '<div class="task-main"><div class="task-title">' + esc(t.title) + '</div>' + (t.desc ? '<div class="task-desc">' + esc(t.desc) + '</div>' : '') +
      '<div class="meta"><span class="chip prio-' + t.priority.toLowerCase() + '">' + esc(t.priority) + '</span>' + catChip(t.category) +
      (t.start ? '<span class="chip plain">🕒 ' + esc(t.start) + (t.end ? '–' + esc(t.end) : '') + '</span>' : '') + rem + '</div></div>' +
      '<div class="task-actions">' +
      (t.done ? '' : '<span class="move-btns"><button class="icon-btn tiny-btn" data-action="moveTask" data-dir="-1" data-id="' + t.id + '" aria-label="Move up">↑</button><button class="icon-btn tiny-btn" data-action="moveTask" data-dir="1" data-id="' + t.id + '" aria-label="Move down">↓</button></span>') +
      '<button class="icon-btn tiny-btn" data-action="editTask" data-id="' + t.id + '" aria-label="Edit">✏️</button>' +
      '<button class="icon-btn tiny-btn" data-action="delTask" data-id="' + t.id + '" aria-label="Delete">🗑</button></div></div>';
  }
  function scheduleHTML(date, editable) {
    const items = mergedSchedule(date);
    const nowM = date === today() ? new Date().getHours() * 60 + new Date().getMinutes() : null;
    if (!items.length) return emptyBox('🕘', 'No schedule yet.', editable ? '<button class="btn small primary" data-action="addSched" data-date="' + date + '">Add item</button>' : '');
    let nextIdx = -1;
    if (nowM != null) nextIdx = items.findIndex(i => toMin(i.time) >= nowM);
    return '<div class="timeline">' + items.map(function (i, idx) {
      const past = nowM != null && toMin(i.time) < nowM && !(i.end && toMin(i.end) > nowM);
      const cls = (past ? 'past ' : '') + (idx === nextIdx ? 'now' : '');
      const tag = i.src === 'routine' ? '' : '<small>' + (i.src === 'event' ? 'Event' : 'Task') + (i.end ? ' · until ' + esc(i.end) : '') + '</small>';
      const actions = editable && i.src === 'routine' ? '<div class="tl-actions"><button class="icon-btn tiny-btn" data-action="editSched" data-date="' + date + '" data-id="' + i.id + '" aria-label="Edit">✏️</button><button class="icon-btn tiny-btn" data-action="delSched" data-date="' + date + '" data-id="' + i.id + '" aria-label="Delete">🗑</button></div>' : '';
      return '<div class="tl-item ' + cls + '"><div class="tl-time">' + esc(i.time) + '</div><span class="tl-dot" style="--c:' + i.color + '"></span><div class="tl-body ' + (i.done ? 'muted' : '') + '">' + esc(i.label) + tag + '</div>' + actions + '</div>';
    }).join('') + '</div>';
  }
  function scheduleCard(date, title) {
    return '<div class="card"><div class="card-head"><h3>' + title + '</h3><div style="display:flex;gap:6px"><button class="btn small" data-action="addSched" data-date="' + date + '">+ Add</button><button class="btn small ghost" data-action="saveDefaultSched" data-date="' + date + '" title="Use this routine as the default for new days">Set default</button></div></div>' + scheduleHTML(date, true) + '</div>';
  }
  function suggestions() {
    if (!state.settings.smart) return '';
    const d = today(), h = new Date().getHours();
    const tasks = state.tasks.filter(t => t.date === d), pending = tasks.filter(t => !t.done), high = pending.filter(t => t.priority === 'High');
    const tips = [];
    const hello = h < 12 ? 'Good morning!' : h < 17 ? 'Good afternoon!' : 'Good evening!';
    tips.push(hello + ' ' + (tasks.length ? 'You have ' + tasks.length + ' task' + (tasks.length > 1 ? 's' : '') + ' today' + (pending.length < tasks.length ? ' (' + pending.length + ' left).' : '.') : 'Nothing planned yet — add a task to get started.'));
    if (high.length) tips.push('You have ' + high.length + ' high-priority task' + (high.length > 1 ? 's' : '') + ' pending.');
    const nowM = new Date().getHours() * 60 + new Date().getMinutes();
    const busy = itemsFor(d).filter(i => i.start && i.end && !i.done).map(i => [toMin(i.start), toMin(i.end)]).sort((a, b) => a[0] - b[0]);
    let cur = Math.max(nowM, 8 * 60), best = null; const endDay = 22 * 60;
    busy.forEach(function (b) { const s = Math.min(b[0], endDay); if (s - cur >= 45 && (!best || s - cur > best[1] - best[0])) best = [cur, s]; cur = Math.max(cur, b[1]); });
    if (endDay - cur >= 45 && (!best || endDay - cur > best[1] - best[0])) best = [cur, endDay];
    if (best && best[1] - best[0] >= 45) {
      tips.push('You have a free ' + fmtDur(best[1] - best[0]) + ' window between ' + fromMin(best[0]) + ' and ' + fromMin(best[1]) + '.');
      if (high.length) tips.push('Consider working on “' + high[0].title + '” during this time.');
    }
    const w = waterTotal(d); if (h >= 12 && w < state.settings.waterGoal * 0.4) tips.push('Hydration is a bit low — have a glass of water 💧');
    return tips.map(t => '<div class="tip">' + esc(t) + '</div>').join('');
  }

  /* ================= views ================= */
  function viewDashboard() {
    const d = today(), s = dayStats(d), streak = overallStreak();
    const tasks = state.tasks.filter(t => t.date === d);
    const empty = !state.tasks.length && !state.habits.length && !state.events.length;
    const pendingT = tasks.filter(t => !t.done), doneT = tasks.filter(t => t.done);
    const bar = '█'.repeat(Math.round(s.pct / 10)) + '░'.repeat(10 - Math.round(s.pct / 10));
    return (empty ? '<div class="banner"><div class="grow"><b>Welcome! Your planner is empty.</b><br><span class="muted">Load a sample day to explore, or start from scratch.</span></div><button class="btn primary" data-action="sample">Load sample day</button><button class="btn" data-action="addTask">+ Add task</button></div>' : '') +
      '<div class="grid g2" style="grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)">' +
      '<div class="card hero-card"><div class="card-head"><h3>TODAY\'S PROGRESS</h3><span>🔥 ' + streak + '-day streak</span></div><div class="big">' + s.pct + '%</div><div style="font-family:monospace;letter-spacing:2px;margin:4px 0 10px;opacity:.9">' + bar + '</div>' + progress(s.pct) +
      '<p style="margin:12px 0 0;opacity:.95">' + s.tasksDone + ' / ' + s.tasks + ' Tasks Completed · ' + s.habitsDone + ' / ' + s.habits + ' Habits · ' + litres(s.water) + ' water</p></div>' +
      '<div class="card"><div class="card-head"><h3>💡 Smart suggestions</h3></div>' + (suggestions() || '<div class="muted">Suggestions are turned off in Settings.</div>') + '</div></div>' +
      '<div class="grid g5 mt keep2">' +
      statCard('✅', s.tasksDone, 'Tasks completed') + statCard('⏳', s.tasks - s.tasksDone, 'Tasks remaining') + statCard('🔄', s.habitsDone + '/' + s.habits, 'Habits today') + statCard('💧', litres(s.water), 'of ' + litres(state.settings.waterGoal)) + statCard('🔥', streak, 'Day streak') + '</div>' +
      '<div class="grid g2 mt"><div class="card"><div class="card-head"><h3>Today\'s tasks</h3><button class="btn small primary" data-action="addTask">+ Add</button></div>' +
      (tasks.length ? pendingT.map(taskItem).join('') + (doneT.length ? '<div class="section-label">Completed</div>' + doneT.map(taskItem).join('') : '') : emptyBox('🎯', 'No tasks for today.', '<button class="btn small" data-action="addTask">Add your first task</button>')) + '</div>' +
      '<div class="grid" style="align-content:start"><div class="card"><div class="card-head"><h3>Today\'s habits</h3><button class="btn small" data-action="goto" data-view="habits">Open</button></div>' + habitQuick() + '</div>' +
      '<div class="card"><div class="card-head"><h3>💧 Water</h3><span class="muted">' + litres(s.water) + ' / ' + litres(state.settings.waterGoal) + '</span></div>' + progress(s.waterPct, 'blue') +
      '<div class="water-btns" style="margin-top:12px"><button class="btn small" data-action="addWater" data-ml="250">+250 ml</button><button class="btn small" data-action="addWater" data-ml="500">+500 ml</button><button class="btn small" data-action="addWater" data-ml="750">+750 ml</button><button class="btn small" data-action="waterCustom">Custom</button></div></div></div></div>' +
      '<div class="card mt only-narrow">' + '<div class="card-head"><h3>Today\'s schedule</h3><button class="btn small" data-action="addSched" data-date="' + d + '">+ Add</button></div>' + scheduleHTML(d, true) + '</div>' +
      '<div class="mt" style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" data-action="goto" data-view="review">🌙 Daily review</button><button class="btn" data-action="goto" data-view="plan">🗓 Plan tomorrow</button></div>';
  }
  const statCard = (ic, n, l) => '<div class="card stat"><span class="ic">' + ic + '</span><span class="n">' + n + '</span><span class="l">' + l + '</span></div>';
  function habitQuick() {
    if (!state.habits.length) return emptyBox('🌱', 'No habits yet.', '<button class="btn small" data-action="addHabit">Create a habit</button>');
    const d = today();
    return state.habits.map(h => '<div class="li"><button class="check ' + (habitDone(h.id, d) ? 'on' : '') + '" data-action="toggleHabit" data-id="' + h.id + '" data-date="' + d + '" aria-label="Toggle habit">' + (habitDone(h.id, d) ? '✓' : '') + '</button><span>' + esc(h.icon) + ' ' + esc(h.name) + '</span><span class="spacer"></span><span class="muted tiny">🔥 ' + habitStreak(h.id) + '</span></div>').join('');
  }

  function viewTasks() {
    const d = ui.date;
    let list = state.tasks.filter(t => t.date === d);
    if (ui.catFilter !== 'all') list = list.filter(t => t.category === ui.catFilter);
    const pending = list.filter(t => !t.done), done = list.filter(t => t.done);
    return '<div class="page-title"><h2>Tasks</h2><button class="btn primary" data-action="addTask">+ Add task</button></div>' +
      '<div class="card"><div class="card-head" style="flex-wrap:wrap"><div style="display:flex;gap:6px;align-items:center"><button class="icon-btn" data-action="shiftDate" data-n="-1" aria-label="Previous day">‹</button><input type="date" data-ui="date" value="' + d + '" style="width:auto"><button class="icon-btn" data-action="shiftDate" data-n="1" aria-label="Next day">›</button><button class="btn small" data-action="dateToday">Today</button></div>' +
      '<div class="filters"><button class="btn small ' + (ui.catFilter === 'all' ? 'active' : '') + '" data-action="catFilter" data-cat="all">All</button>' + Object.keys(CATS).map(c => '<button class="btn small ' + (ui.catFilter === c ? 'active' : '') + '" data-action="catFilter" data-cat="' + c + '">' + c + '</button>').join('') + '</div></div>' +
      '<div class="section-label">' + fmtDate(d) + ' · To do (' + pending.length + ')</div>' +
      (pending.length ? pending.map(taskItem).join('') : emptyBox('🎉', list.length ? 'All done for this day!' : 'No tasks here yet.', '<button class="btn small primary" data-action="addTask">Add task</button>')) +
      '<div class="section-label">Completed (' + done.length + ')</div>' + (done.length ? done.map(taskItem).join('') : '<div class="muted tiny">Nothing completed yet.</div>') +
      '<p class="muted tiny" style="margin-bottom:0">Tip: drag tasks to reorder them.</p></div>';
  }

  /* ---- calendar ---- */
  function chipsFor(d, max) {
    const items = itemsFor(d); const shown = items.slice(0, max);
    return shown.map(i => '<span class="ev ' + (i.done ? 'done' : '') + '" style="--c:' + (CATS[i.category] || CATS.Other) + '">' + (i.start ? esc(i.start) + ' ' : '') + esc(i.title) + '</span>').join('') + (items.length > max ? '<div class="more">+' + (items.length - max) + ' more</div>' : '') +
      '<div class="dots">' + items.slice(0, 6).map(i => '<i style="--c:' + (CATS[i.category] || CATS.Other) + '"></i>').join('') + '</div>';
  }
  function viewCalendar() {
    const cur = parseYmd(ui.calCursor), t = today();
    let title = '', body = '';
    if (ui.calView === 'month') {
      title = MONTHS[cur.getMonth()] + ' ' + cur.getFullYear();
      const first = new Date(cur.getFullYear(), cur.getMonth(), 1), offset = (first.getDay() + 6) % 7;
      const start = new Date(first); start.setDate(1 - offset);
      let cells = '';
      for (let i = 0; i < 42; i++) {
        const dd = new Date(start); dd.setDate(start.getDate() + i); const ds = ymd(dd);
        if (i >= 35 && dd.getMonth() !== cur.getMonth()) break;
        cells += '<div class="cell ' + (dd.getMonth() !== cur.getMonth() ? 'other ' : '') + (ds === t ? 'today ' : '') + (ds === ui.date ? 'sel' : '') + '" data-action="pickDate" data-date="' + ds + '"><span class="dn">' + dd.getDate() + '</span>' + chipsFor(ds, 3) + '</div>';
      }
      body = '<div class="month">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => '<div class="dow">' + x + '</div>').join('') + cells + '</div>';
    } else if (ui.calView === 'week') {
      const m = mondayOf(ui.calCursor); title = fmtShort(m) + ' – ' + fmtShort(addDays(m, 6)) + ' ' + parseYmd(addDays(m, 6)).getFullYear();
      let cols = '';
      for (let i = 0; i < 7; i++) {
        const ds = addDays(m, i);
        cols += '<div class="wcol ' + (ds === t ? 'today ' : '') + (ds === ui.date ? 'sel' : '') + '" data-action="pickDate" data-date="' + ds + '"><div class="wh"><span>' + DOW[parseYmd(ds).getDay()] + ' ' + parseYmd(ds).getDate() + '</span></div>' + chipsFor(ds, 8) + '</div>';
      }
      body = '<div class="week">' + cols + '</div>';
    } else {
      title = fmtDate(ui.calCursor);
      const items = itemsFor(ui.calCursor); let rows = '';
      const allDay = items.filter(i => !i.start);
      if (allDay.length) rows += '<div class="hour" style="cursor:default"><div class="hl">Any time</div><div>' + allDay.map(i => '<span class="ev" style="--c:' + (CATS[i.category] || CATS.Other) + ';font-size:13px;padding:3px 8px">' + (i.type === 'task' ? '☐ ' : '📅 ') + esc(i.title) + '</span>').join('') + '</div></div>';
      for (let h = 6; h <= 23; h++) {
        const here = items.filter(i => i.start && Math.floor(toMin(i.start) / 60) === h);
        rows += '<div class="hour" data-action="addEventAt" data-time="' + pad(h) + ':00"><div class="hl">' + pad(h) + ':00</div><div>' + here.map(i => '<span class="ev ' + (i.done ? 'done' : '') + '" style="--c:' + (CATS[i.category] || CATS.Other) + ';font-size:13px;padding:3px 8px">' + esc(i.start) + (i.end ? '–' + esc(i.end) : '') + ' · ' + esc(i.title) + '</span>').join('') + '</div></div>';
      }
      const early = items.filter(i => i.start && Math.floor(toMin(i.start) / 60) < 6);
      if (early.length) rows = '<div class="hour" style="cursor:default"><div class="hl">Early</div><div>' + early.map(i => '<span class="ev" style="--c:' + (CATS[i.category] || CATS.Other) + ';font-size:13px;padding:3px 8px">' + esc(i.start) + ' · ' + esc(i.title) + '</span>').join('') + '</div></div>' + rows;
      body = '<div class="dayview">' + rows + '</div><p class="muted tiny">Click an hour to create an event at that time.</p>';
    }
    return '<div class="page-title"><h2>Calendar</h2><button class="btn primary" data-action="addEvent">+ Event</button></div>' +
      '<div class="grid" style="grid-template-columns:minmax(0,1fr)"><div class="card"><div class="cal-head"><button class="icon-btn" data-action="calPrev" aria-label="Previous">‹</button><button class="icon-btn" data-action="calNext" aria-label="Next">›</button><h3>' + title + '</h3><button class="btn small" data-action="calToday">Today</button><span class="spacer"></span><div class="seg">' + ['month', 'week', 'day'].map(v => '<button class="' + (ui.calView === v ? 'active' : '') + '" data-action="calView" data-v="' + v + '">' + v[0].toUpperCase() + v.slice(1) + '</button>').join('') + '</div></div>' + body + '</div>' + dayDetail(ui.date) + '</div>';
  }
  function dayDetail(d) {
    const tasks = state.tasks.filter(t => t.date === d), events = state.events.filter(e => e.date === d).sort((a, b) => a.start.localeCompare(b.start));
    const rem = [].concat(tasks.filter(t => t.reminder !== '' && t.reminder != null && t.start).map(t => ({ t: t.title, s: t.start, r: t.reminder })), events.filter(e => e.reminder !== '' && e.reminder != null).map(e => ({ t: e.title, s: e.start, r: e.reminder })));
    return '<div class="card day-detail"><div class="card-head"><h3>' + fmtDate(d) + '</h3><div style="display:flex;gap:6px"><button class="btn small" data-action="addTask">+ Task</button><button class="btn small primary" data-action="addEvent">+ Event</button></div></div>' +
      '<h4>Events</h4>' + (events.length ? events.map(e => '<div class="li"><span class="dot" style="--c:' + (CATS[e.category] || CATS.Other) + '"></span><b>' + esc(e.start) + '–' + esc(e.end) + '</b> ' + esc(e.title) + '<span class="spacer"></span><button class="icon-btn tiny-btn" data-action="editEvent" data-id="' + e.id + '" aria-label="Edit">✏️</button><button class="icon-btn tiny-btn" data-action="delEvent" data-id="' + e.id + '" aria-label="Delete">🗑</button></div>').join('') : '<div class="muted tiny">No events.</div>') +
      '<h4>Tasks</h4>' + (tasks.length ? tasks.map(t => '<div class="li"><button class="check ' + (t.done ? 'on' : '') + '" data-action="toggleTask" data-id="' + t.id + '" aria-label="Toggle">' + (t.done ? '✓' : '') + '</button><span style="' + (t.done ? 'text-decoration:line-through;opacity:.6' : '') + '">' + esc(t.title) + '</span><span class="spacer"></span>' + (t.start ? '<span class="muted tiny">' + esc(t.start) + '</span>' : '') + '<button class="icon-btn tiny-btn" data-action="editTask" data-id="' + t.id + '" aria-label="Edit">✏️</button></div>').join('') : '<div class="muted tiny">No tasks.</div>') +
      '<h4>Habits</h4>' + (state.habits.length ? state.habits.map(h => '<div class="li"><button class="check ' + (habitDone(h.id, d) ? 'on' : '') + '" data-action="toggleHabit" data-id="' + h.id + '" data-date="' + d + '" aria-label="Toggle habit">' + (habitDone(h.id, d) ? '✓' : '') + '</button>' + esc(h.icon) + ' ' + esc(h.name) + '</div>').join('') : '<div class="muted tiny">No habits yet.</div>') +
      '<h4>Reminders</h4>' + (rem.length ? rem.map(r => '<div class="li">🔔 ' + esc(r.t) + '<span class="spacer"></span><span class="muted tiny">' + esc(r.s) + (r.r === '0' ? '' : ' (−' + (r.r === '1440' ? '1 day' : r.r + 'm') + ')') + '</span></div>').join('') : '<div class="muted tiny">No reminders.</div>') + '</div>';
  }

  /* ---- habits ---- */
  function viewHabits() {
    const t = today(), mStart = t.slice(0, 8) + '01', wStart = addDays(t, -6);
    const last7 = []; for (let i = 6; i >= 0; i--) last7.push(addDays(t, -i));
    return '<div class="page-title"><h2>Habits</h2><button class="btn primary" data-action="addHabit">+ New habit</button></div>' +
      '<div class="card">' + (state.habits.length ? state.habits.map(function (h) {
        const wk = habitRange(h.id, wStart, t), mo = habitRange(h.id, mStart, t);
        return '<div class="habit"><span class="hi">' + esc(h.icon) + '</span><div class="hm"><b>' + esc(h.name) + '</b><div class="stats"><span>🔥 Streak <b>' + habitStreak(h.id) + '</b></span><span>🏆 Best <b>' + habitBest(h.id) + '</b></span><span>Week <b>' + Math.round(wk.n / wk.tot * 100) + '%</b></span><span>Month <b>' + Math.round(mo.n / mo.tot * 100) + '%</b> (' + mo.n + '/' + mo.tot + ')</span></div></div>' +
          '<div class="week-dots">' + last7.map(function (d) { const on = habitDone(h.id, d); const isT = d === t; return '<div class="wd"><button class="' + (on ? 'on' : (!isT ? 'miss' : '')) + '" data-action="toggleHabit" data-id="' + h.id + '" data-date="' + d + '" aria-label="' + DOW[parseYmd(d).getDay()] + '">' + (on ? '✓' : (isT ? '' : '✗')) + '</button>' + DOW[parseYmd(d).getDay()].slice(0, 3) + '</div>'; }).join('') + '</div>' +
          '<div><button class="icon-btn tiny-btn" data-action="editHabit" data-id="' + h.id + '" aria-label="Edit">✏️</button><button class="icon-btn tiny-btn" data-action="delHabit" data-id="' + h.id + '" aria-label="Delete">🗑</button></div></div>';
      }).join('') : emptyBox('🌱', 'Build routines you love. Create your first habit.', '<button class="btn primary" data-action="addHabit">+ New habit</button>')) + '</div>' +
      '<div class="card mt"><div class="card-head"><h3>Habit heatmap</h3><select data-ui="heatHabit" style="width:auto"><option value="all">All habits</option>' + state.habits.map(h => '<option value="' + h.id + '"' + (ui.heatHabit === h.id ? ' selected' : '') + '>' + esc(h.name) + '</option>').join('') + '</select></div>' + heatmap() + '<div class="tiny muted" style="margin-top:6px">Last 20 weeks · darker = more habits completed</div></div>';
  }
  function heatmap() {
    const t = today(); const start = addDays(mondayOf(t), -19 * 7); let html = '';
    for (let i = 0; i < 140; i++) {
      const d = addDays(start, i); if (d > t) { html += '<div class="hc fut"></div>'; continue; }
      let lvl = 0;
      if (ui.heatHabit !== 'all' && state.habits.some(h => h.id === ui.heatHabit)) lvl = habitDone(ui.heatHabit, d) ? 4 : 0;
      else if (state.habits.length) { const r = state.habits.filter(h => habitDone(h.id, d)).length / state.habits.length; lvl = r === 0 ? 0 : r <= .25 ? 1 : r <= .5 ? 2 : r < 1 ? 3 : 4; }
      html += '<div class="hc ' + (lvl ? 'l' + lvl : '') + '" title="' + d + '"></div>';
    }
    return '<div class="heat">' + html + '</div>';
  }

  /* ---- water ---- */
  function viewWater() {
    const t = today(), total = waterTotal(t), goal = state.settings.waterGoal, pct = Math.min(100, Math.round(total / goal * 100));
    const R = 78, C = 2 * Math.PI * R, logs = state.waterLogs.filter(w => w.date === t).slice().reverse();
    const days = []; for (let i = 6; i >= 0; i--) days.push(addDays(t, -i));
    const avg = Math.round(days.reduce((a, d) => a + waterTotal(d), 0) / 7);
    return '<div class="page-title"><h2>Water</h2></div><div class="grid g2"><div class="card"><div class="card-head"><h3>Hydration today</h3><span class="muted">Goal ' + litres(goal) + '</span></div>' +
      '<div style="display:flex;gap:24px;align-items:center;justify-content:center;flex-wrap:wrap"><div class="ring-wrap"><svg width="190" height="190" viewBox="0 0 190 190"><defs><linearGradient id="grad" x1="0" x2="1"><stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#6366f1"/></linearGradient></defs><circle class="ring-bg" cx="95" cy="95" r="' + R + '" fill="none" stroke-width="16"/><circle class="ring-fg" cx="95" cy="95" r="' + R + '" fill="none" stroke-width="16" stroke-linecap="round" transform="rotate(-90 95 95)" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - pct / 100)).toFixed(1) + '"/></svg><div class="ring-text"><b>' + litres(total) + '</b><span class="muted">💧 ' + pct + '%</span></div></div>' +
      '<div class="bottle" aria-hidden="true"><i style="height:' + pct + '%"></i></div></div>' +
      '<p style="text-align:center;margin:14px 0 4px">💧 ' + litres(total) + ' / ' + litres(goal) + ' &nbsp;·&nbsp; <b>' + pct + '%</b></p><div class="water-btns" style="justify-content:center;margin-top:10px"><button class="btn primary" data-action="addWater" data-ml="250">+250 ml</button><button class="btn primary" data-action="addWater" data-ml="500">+500 ml</button><button class="btn primary" data-action="addWater" data-ml="750">+750 ml</button><button class="btn" data-action="addWater" data-ml="' + state.settings.glass + '">+1 glass (' + state.settings.glass + ' ml)</button><button class="btn" data-action="waterCustom">Custom</button></div></div>' +
      '<div class="grid" style="align-content:start"><div class="card"><div class="card-head"><h3>Settings</h3></div><div class="row2"><div class="field"><label>Daily goal (litres)</label><input type="number" min="0.5" max="10" step="0.25" data-setting="waterGoalL" value="' + (goal / 1000) + '"></div><div class="field"><label>Glass / bottle size (ml)</label><input type="number" min="50" max="2000" step="50" data-setting="glass" data-type="number" value="' + state.settings.glass + '"></div></div>' +
      '<div class="switch"><span>Water reminders</span><input type="checkbox" data-setting="remWater" data-type="bool"' + (state.settings.remWater ? ' checked' : '') + '></div><div class="field" style="margin-top:8px"><label>Remind me every</label><select data-setting="waterInterval" data-type="number">' + [30, 45, 60, 90, 120, 180].map(m => '<option value="' + m + '"' + (Number(state.settings.waterInterval) === m ? ' selected' : '') + '>' + (m < 60 ? m + ' minutes' : m / 60 + (m === 60 ? ' hour' : ' hours')) + '</option>').join('') + '</select></div></div>' +
      '<div class="card"><div class="card-head"><h3>Today\'s log</h3></div>' + (logs.length ? logs.map(l => '<div class="li">💧 <b>' + l.ml + ' ml</b><span class="muted tiny">' + esc(l.time) + '</span><span class="spacer"></span><button class="icon-btn tiny-btn" data-action="delWater" data-id="' + l.id + '" aria-label="Remove">🗑</button></div>').join('') : '<div class="muted tiny">No water logged yet.</div>') + '</div></div></div>' +
      '<div class="card mt"><div class="card-head"><h3>Last 7 days</h3><span class="muted">Average ' + litres(avg) + ' / day</span></div>' + colChart(days.map(d => ({ label: DOW[parseYmd(d).getDay()], value: waterTotal(d) })), goal, v => litres(v)) + '</div>';
  }
  function colChart(data, max, fmt) {
    const m = Math.max(max || 0, 1, ...data.map(x => x.value));
    return '<div class="cols">' + data.map(x => '<div class="col"><span class="bv">' + (fmt ? fmt(x.value) : x.value) + '</span><div class="bar" style="height:' + Math.max(2, Math.round(x.value / m * 100)) + '%"></div><span class="bl">' + esc(x.label) + '</span></div>').join('') + '</div>';
  }

  /* ---- focus ---- */
  function viewFocus() {
    const t = today(), sessions = state.focus.filter(f => f.date === t), mins = sessions.reduce((a, f) => a + f.mins, 0);
    const days = []; for (let i = 6; i >= 0; i--) days.push(addDays(t, -i));
    const presets = [[25, 5], [50, 10]]; const fm = state.settings.focusMin, bm = state.settings.breakMin;
    const isCustom = !presets.some(p => p[0] === fm && p[1] === bm);
    return '<div class="page-title"><h2>Focus</h2></div><div class="grid g2"><div class="card"><div class="timer"><div class="seg">' +
      presets.map(p => '<button class="' + (fm === p[0] && bm === p[1] ? 'active' : '') + '" data-action="preset" data-f="' + p[0] + '" data-b="' + p[1] + '">' + p[0] + '/' + p[1] + '</button>').join('') + '<button class="' + (isCustom ? 'active' : '') + '" data-action="customTimer">Custom</button></div>' +
      '<div class="timer-mode tm" id="timerMode">' + (timer.mode === 'focus' ? 'FOCUS SESSION' : 'BREAK TIME') + '</div>' +
      '<div class="ring-wrap"><svg width="240" height="240" viewBox="0 0 240 240"><circle class="ring-bg" cx="120" cy="120" r="104" fill="none" stroke-width="12"/><circle id="timerRing" class="ring-fg" cx="120" cy="120" r="104" fill="none" stroke-width="12" stroke-linecap="round" transform="rotate(-90 120 120)" stroke-dasharray="653.5" stroke-dashoffset="' + (653.5 * (1 - timer.remaining / timer.total)).toFixed(1) + '"/></svg><div class="ring-text"><b class="tt" id="timerText" style="font-size:46px">' + fmtClock(timer.remaining) + '</b></div></div>' +
      '<div style="display:flex;gap:8px"><button class="btn primary" id="timerStart" data-action="timerToggle">' + (timer.running ? 'Pause' : 'Start') + '</button><button class="btn" data-action="timerReset">Reset</button><button class="btn ghost" data-action="timerSkip">Skip</button></div></div></div>' +
      '<div class="grid" style="align-content:start"><div class="grid g2"><div class="card stat"><span class="ic">🎯</span><span class="n">' + sessions.length + '</span><span class="l">Sessions today</span></div><div class="card stat"><span class="ic">⏳</span><span class="n">' + fmtDur(mins) + '</span><span class="l">Focus time today</span></div></div>' +
      '<div class="card"><div class="card-head"><h3>Last 7 days (minutes)</h3></div>' + colChart(days.map(d => ({ label: DOW[parseYmd(d).getDay()], value: focusMins(d) })), 60, v => v + 'm') + '</div></div></div>';
  }
  const fmtClock = s => pad(Math.floor(s / 60)) + ':' + pad(s % 60);
  function resetTimer(mode) {
    timer.mode = mode || timer.mode; timer.total = (timer.mode === 'focus' ? state.settings.focusMin : state.settings.breakMin) * 60; timer.remaining = timer.total; timer.running = false;
  }
  function updateTimerDOM() {
    const t = $('#timerText'); if (!t) return;
    t.textContent = fmtClock(timer.remaining);
    const r = $('#timerRing'); if (r) r.setAttribute('stroke-dashoffset', (653.5 * (1 - timer.remaining / timer.total)).toFixed(1));
  }
  function tickTimer() {
    if (!timer.running || !state) return;
    timer.remaining = Math.max(0, Math.round((timer.endAt - Date.now()) / 1000));
    if (timer.remaining <= 0) {
      timer.running = false;
      if (timer.mode === 'focus') {
        state.focus.push({ id: uid(), date: today(), mins: state.settings.focusMin, at: Date.now() });
        save(); resetTimer('break'); notify('Focus session complete! Take a short break ☕');
      } else { resetTimer('focus'); notify('Break is over. Ready to focus? 🎯'); }
      render();
    } else updateTimerDOM();
  }

  /* ---- notes ---- */
  function viewNotes() {
    const tags = Array.from(new Set([].concat.apply([], state.notes.map(n => n.tags)))).sort();
    let list = state.notes.slice();
    if (ui.noteTag !== 'all') list = list.filter(n => n.tags.indexOf(ui.noteTag) >= 0);
    if (ui.noteQuery) { const q = ui.noteQuery.toLowerCase(); list = list.filter(n => (n.title + ' ' + n.content + ' ' + n.tags.join(' ')).toLowerCase().indexOf(q) >= 0); }
    list.sort((a, b) => b.date.localeCompare(a.date));
    return '<div class="page-title"><h2>Notes</h2><button class="btn primary" data-action="addNote">+ New note</button></div>' +
      '<div class="card" style="margin-bottom:16px"><input type="search" id="noteSearch" placeholder="Search notes…" value="' + esc(ui.noteQuery) + '"><div class="filters" style="margin-top:10px"><button class="btn small ' + (ui.noteTag === 'all' ? 'active' : '') + '" data-action="noteTag" data-tag="all">All</button>' + tags.map(t => '<button class="btn small ' + (ui.noteTag === t ? 'active' : '') + '" data-action="noteTag" data-tag="' + esc(t) + '">#' + esc(t) + '</button>').join('') + '</div></div>' +
      (list.length ? '<div class="notes-grid">' + list.map(n => '<div class="note"><div style="display:flex;justify-content:space-between;gap:8px"><b>' + esc(n.title) + '</b><span class="muted tiny" style="white-space:nowrap">' + fmtShort(n.date) + '</span></div><p>' + esc(n.content) + '</p><div class="meta">' + n.tags.map(t => '<span class="chip">#' + esc(t) + '</span>').join('') + '</div><div style="display:flex;gap:6px"><button class="btn small" data-action="editNote" data-id="' + n.id + '">Edit</button><button class="btn small ghost" data-action="delNote" data-id="' + n.id + '">Delete</button></div></div>').join('') + '</div>' : '<div class="card">' + emptyBox('📝', state.notes.length ? 'No notes match your filter.' : 'Capture ideas, study notes and daily thoughts.', '<button class="btn primary" data-action="addNote">+ New note</button>') + '</div>');
  }

  /* ---- analytics ---- */
  function viewAnalytics() {
    const t = today(); const days = []; for (let i = 6; i >= 0; i--) days.push(addDays(t, -i));
    const st = days.map(d => dayStats(d));
    const tasksDone = st.reduce((a, s) => a + s.tasksDone, 0);
    const missed = state.tasks.filter(x => days.indexOf(x.date) >= 0 && x.date < t && !x.done).length;
    const habitsDone = st.reduce((a, s) => a + s.habitsDone, 0);
    const waterAvg = Math.round(st.reduce((a, s) => a + s.water, 0) / 7);
    const sessions = state.focus.filter(f => days.indexOf(f.date) >= 0).length;
    const weekPct = Math.round(st.reduce((a, s) => a + s.pct, 0) / 7);
    let bi = 0; st.forEach((s, i) => { if (s.pct > st[bi].pct) bi = i; });
    const bestDay = st[bi].pct > 0 ? DOW[parseYmd(days[bi]).getDay()] : '—';
    // month
    const mStart = t.slice(0, 8) + '01', mDays = []; for (let d = mStart; d <= t; d = addDays(d, 1)) mDays.push(d);
    const ms = mDays.map(d => dayStats(d));
    const mTasks = ms.reduce((a, s) => a + s.tasksDone, 0), mHabits = ms.reduce((a, s) => a + s.habitsDone, 0);
    const mAvg = Math.round(ms.reduce((a, s) => a + s.pct, 0) / (ms.length || 1));
    let mb = 0; ms.forEach((s, i) => { if (s.pct > ms[mb].pct) mb = i; });
    const mFocus = ms.reduce((a, s) => a + s.focus, 0);
    const first = parseYmd(mStart), lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    let grid = ''; for (let i = 0; i < (first.getDay() + 6) % 7; i++) grid += '<div></div>';
    for (let i = 1; i <= lastDay; i++) {
      const d = mStart.slice(0, 8) + pad(i), s = d <= t ? dayStats(d) : null;
      const a = s ? Math.max(.1, s.pct / 100) : 0;
      grid += '<div class="mcell" style="' + (s ? 'background:color-mix(in srgb,var(--primary) ' + Math.round(a * 85) + '%,var(--card2));color:' + (a > .5 ? '#fff' : 'inherit') : 'opacity:.35') + '" title="' + d + (s ? ': ' + s.pct + '%' : '') + '">' + i + '</div>';
    }
    return '<div class="page-title"><h2>Analytics</h2></div><h3 style="margin:0 0 10px">Last 7 days</h3>' +
      '<div class="grid g4">' + statCard('✅', tasksDone, 'Tasks completed') + statCard('⚠️', missed, 'Tasks missed') + statCard('🔄', habitsDone, 'Habits completed') + statCard('💧', litres(waterAvg), 'Avg water / day') + statCard('⏱', sessions, 'Focus sessions') + statCard('🏆', bestDay, 'Most productive day') + statCard('📈', weekPct + '%', 'Weekly productivity') + statCard('🔥', overallStreak(), 'Current streak') + '</div>' +
      '<div class="grid g2 mt"><div class="card"><div class="card-head"><h3>Daily productivity</h3></div>' + colChart(days.map((d, i) => ({ label: DOW[parseYmd(d).getDay()], value: st[i].pct })), 100, v => v + '%') + '</div>' +
      '<div class="card"><div class="card-head"><h3>Tasks completed per day</h3></div>' + days.map((d, i) => '<div class="hbar"><span>' + fmtShort(d) + ' ' + DOW[parseYmd(d).getDay()] + '</span>' + progress(st[i].tasks ? st[i].tasksDone / st[i].tasks * 100 : 0, 'green') + '<span>' + st[i].tasksDone + '/' + st[i].tasks + '</span></div>').join('') + '</div></div>' +
      '<h3 style="margin:22px 0 10px">' + MONTHS[first.getMonth()] + ' ' + first.getFullYear() + '</h3><div class="grid g3">' + statCard('✅', mTasks, 'Tasks completed') + statCard('🔄', mHabits, 'Habits completed') + statCard('📈', mAvg + '%', 'Average productivity') + statCard('🔥', overallStreak(), 'Current streak') + statCard('🌟', ms[mb] && ms[mb].pct > 0 ? fmtShort(mDays[mb]) + ' (' + ms[mb].pct + '%)' : '—', 'Best day') + statCard('⏳', fmtDur(mFocus), 'Total focus time') + '</div>' +
      '<div class="card mt"><div class="card-head"><h3>Month at a glance</h3></div><div class="mgrid">' + ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => '<div class="muted tiny" style="text-align:center">' + x + '</div>').join('') + grid + '</div></div>';
  }

  /* ---- review ---- */
  function viewReview() {
    const d = ui.reviewDate, s = dayStats(d), r = state.reviews[d] || { well: '', improve: '', priority: '' };
    const past = Object.keys(state.reviews).sort().reverse().filter(k => k !== d).slice(0, 8);
    return '<div class="page-title"><h2>Daily Review</h2><input type="date" data-ui="reviewDate" value="' + d + '" max="' + today() + '" style="width:auto"></div>' +
      '<div class="grid g2"><div class="card"><div class="card-head"><h3>' + (d === today() ? 'Today\'s Review' : fmtDate(d)) + '</h3></div>' +
      '<div class="grid g2" style="gap:10px"><div class="tip">Tasks completed<br><b>' + s.tasksDone + '/' + s.tasks + '</b></div><div class="tip">Habits<br><b>' + s.habitsDone + '/' + s.habits + '</b></div><div class="tip">Water<br><b>' + litres(s.water) + '/' + litres(state.settings.waterGoal) + '</b></div><div class="tip">Focus time<br><b>' + fmtDur(s.focus) + '</b></div></div>' +
      '<form id="reviewForm" style="margin-top:12px"><div class="field"><label>What went well today?</label><textarea name="well">' + esc(r.well) + '</textarea></div><div class="field"><label>What could be improved tomorrow?</label><textarea name="improve">' + esc(r.improve) + '</textarea></div><div class="field"><label>Top priority for tomorrow?</label><input name="priority" value="' + esc(r.priority) + '"></div><button class="btn primary">Save review</button></form></div>' +
      '<div class="card"><div class="card-head"><h3>Previous reviews</h3></div>' + (past.length ? past.map(k => '<div class="li" style="flex-direction:column;align-items:flex-start"><b>' + fmtDate(k) + '</b><span class="muted tiny">👍 ' + esc(state.reviews[k].well || '—') + '</span><span class="muted tiny">🔧 ' + esc(state.reviews[k].improve || '—') + '</span><span class="muted tiny">⭐ ' + esc(state.reviews[k].priority || '—') + '</span></div>').join('') : emptyBox('🌙', 'No past reviews yet.')) + '</div></div>';
  }

  /* ---- plan tomorrow ---- */
  function viewPlan() {
    const tm = addDays(today(), 1), tasks = state.tasks.filter(t => t.date === tm), events = state.events.filter(e => e.date === tm).sort((a, b) => a.start.localeCompare(b.start));
    const rv = state.reviews[today()];
    return '<div class="page-title"><h2>Plan Tomorrow</h2><span class="muted">' + fmtDate(tm) + '</span></div>' +
      (rv && rv.priority ? '<div class="banner">⭐ Top priority you set in your review: <b>' + esc(rv.priority) + '</b></div>' : '') +
      '<div class="grid g2"><div class="card"><div class="card-head"><h3>Tasks</h3></div><form id="quickPlan" class="row2" style="margin-bottom:12px"><div class="field" style="grid-column:1/-1;margin:0"><input name="title" required maxlength="140" placeholder="Add a task for tomorrow…"></div><select name="priority"><option>Medium</option><option>High</option><option>Low</option></select><select name="category">' + optList(Object.keys(CATS), 'Personal') + '</select><input type="time" name="start" aria-label="Start time"><select name="reminder">' + remOpts('15') + '</select><button class="btn primary" style="grid-column:1/-1">Add task</button></form>' +
      (tasks.length ? tasks.map(taskItem).join('') : emptyBox('🗒', 'Nothing planned for tomorrow yet.')) + '</div>' +
      '<div class="grid" style="align-content:start"><div class="card"><div class="card-head"><h3>Events</h3><button class="btn small primary" data-action="addEventTomorrow">+ Event</button></div>' + (events.length ? events.map(e => '<div class="li"><span class="dot" style="--c:' + (CATS[e.category] || CATS.Other) + '"></span><b>' + esc(e.start) + '–' + esc(e.end) + '</b> ' + esc(e.title) + '<span class="spacer"></span><button class="icon-btn tiny-btn" data-action="editEvent" data-id="' + e.id + '" aria-label="Edit">✏️</button><button class="icon-btn tiny-btn" data-action="delEvent" data-id="' + e.id + '" aria-label="Delete">🗑</button></div>').join('') : '<div class="muted tiny">No events.</div>') + '</div>' +
      '<div class="card"><div class="card-head"><h3>Habits</h3><button class="btn small" data-action="addHabit">+ Habit</button></div>' + (state.habits.length ? state.habits.map(h => '<div class="li">' + esc(h.icon) + ' ' + esc(h.name) + '</div>').join('') : '<div class="muted tiny">Habits repeat every day once created.</div>') + '</div>' +
      scheduleCard(tm, 'Tomorrow\'s schedule') + '</div></div>';
  }

  /* ---- settings ---- */
  function viewSettings() {
    const s = state.settings, perm = 'Notification' in window ? Notification.permission : 'unsupported';
    return '<div class="page-title"><h2>Settings</h2></div><div class="grid g2" style="align-items:start">' +
      '<div class="card"><div class="card-head"><h3>Profile</h3></div><div style="display:flex;gap:14px;align-items:center;margin-bottom:14px">' + avatar() + '<div style="min-width:0"><b>' + esc(displayName()) + '</b><div class="muted tiny" style="overflow:hidden;text-overflow:ellipsis">' + esc(user.email || '') + '</div></div></div>' +
      '<div class="field"><label>Name</label><input data-setting="profileName" value="' + esc(state.profile.name || user.displayName || '') + '" maxlength="60"></div><div class="field"><label>Profile picture URL</label><input data-setting="profilePhoto" value="' + esc(state.profile.photo || '') + '" placeholder="https://… (leave empty for Google photo)"></div><div class="field"><label>Gmail</label><input value="' + esc(user.email || '') + '" disabled></div></div>' +
      '<div class="grid" style="align-content:start"><div class="card"><div class="card-head"><h3>Appearance</h3></div><div class="seg">' + ['light', 'dark', 'system'].map(m => '<button class="' + (s.theme === m ? 'active' : '') + '" data-action="theme" data-v="' + m + '">' + m[0].toUpperCase() + m.slice(1) + '</button>').join('') + '</div></div>' +
      '<div class="card"><div class="card-head"><h3>Notifications</h3></div><div class="switch"><span>Task &amp; event reminders</span><input type="checkbox" data-setting="remTask" data-type="bool"' + (s.remTask ? ' checked' : '') + '></div><div class="switch"><span>Water reminders</span><input type="checkbox" data-setting="remWater" data-type="bool"' + (s.remWater ? ' checked' : '') + '></div><div class="switch"><span>Habit reminders</span><input type="checkbox" data-setting="remHabit" data-type="bool"' + (s.remHabit ? ' checked' : '') + '></div><div class="switch"><span>Smart daily suggestions</span><input type="checkbox" data-setting="smart" data-type="bool"' + (s.smart ? ' checked' : '') + '></div>' +
      '<div class="switch"><span>Browser notifications<br><span class="muted tiny">Permission: ' + perm + '</span></span><button class="btn small ' + (s.browserNotif && perm === 'granted' ? 'active' : '') + '" data-action="browserNotif">' + (s.browserNotif && perm === 'granted' ? 'Enabled ✓' : 'Enable') + '</button></div></div>' +
      '<div class="card"><div class="card-head"><h3>Productivity</h3></div><div class="row2"><div class="field"><label>Default task duration (min)</label><input type="number" min="5" max="600" data-setting="taskDuration" data-type="number" value="' + s.taskDuration + '"></div><div class="field"><label>Daily water goal (L)</label><input type="number" min="0.5" max="10" step="0.25" data-setting="waterGoalL" value="' + s.waterGoal / 1000 + '"></div><div class="field"><label>Focus minutes</label><input type="number" min="1" max="180" data-setting="focusMin" data-type="number" value="' + s.focusMin + '"></div><div class="field"><label>Break minutes</label><input type="number" min="1" max="60" data-setting="breakMin" data-type="number" value="' + s.breakMin + '"></div></div></div>' +
      '<div class="card"><div class="card-head"><h3>Account</h3></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-action="logout">Log out</button><button class="btn danger" data-action="deleteAccount">Delete account</button></div></div></div></div>';
  }

  /* ================= render ================= */
  function greeting() { const h = new Date().getHours(); return (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening') + ', ' + firstName(); }
  function clockText() { const n = new Date(); return fmtDate(ymd(n)) + ' · ' + pad(n.getHours()) + ':' + pad(n.getMinutes()) + ':' + pad(n.getSeconds()); }
  function renderHeader() {
    if (!state) return;
    const unread = state.notifs.filter(n => !n.read).length;
    $('#header').innerHTML = '<button class="icon-btn menu-btn" data-action="openMenu" aria-label="Menu">☰</button>' + avatar() +
      '<div style="min-width:0"><h1 id="greet">' + esc(greeting()) + '</h1><div class="sub" id="clock">' + esc(clockText()) + '</div></div><span class="spacer"></span>' +
      '<button class="icon-btn" data-action="openSearch" aria-label="Search" title="Search (Ctrl+K)">🔍</button>' +
      '<div class="menu-wrap"><button class="icon-btn" data-action="menu" data-m="notif" aria-label="Notifications">🔔' + (unread ? '<span class="badge">' + unread + '</span>' : '') + '</button><div class="dropdown ' + (ui.menu === 'notif' ? 'show' : '') + '"><div class="card-head"><h3>Notifications</h3><button class="btn small ghost" data-action="clearNotifs">Clear all</button></div>' +
      (state.notifs.length ? state.notifs.slice(0, 15).map(n => '<div class="item ' + (n.read ? '' : 'unread') + '">' + esc(n.text) + '<div class="muted tiny">' + new Date(n.time).toLocaleString() + '</div></div>').join('') : '<div class="empty">You\'re all caught up 🎉</div>') + '</div></div>' +
      '<button class="icon-btn" data-action="goto" data-view="settings" aria-label="Settings">⚙️</button>' +
      '<div class="menu-wrap"><button class="icon-btn" data-action="menu" data-m="profile" aria-label="Profile menu">▾</button><div class="dropdown ' + (ui.menu === 'profile' ? 'show' : '') + '"><div style="display:flex;gap:12px;align-items:center;padding:6px 6px 12px">' + avatar() + '<div style="min-width:0"><b>' + esc(displayName()) + '</b><div class="muted tiny" style="overflow:hidden;text-overflow:ellipsis">' + esc(user.email || '') + '</div></div></div><button class="btn wide" data-action="goto" data-view="settings" style="margin-bottom:6px">Settings</button><button class="btn wide" data-action="logout">Log out</button></div></div>';
  }
  function renderNav() {
    $('#sideNav').innerHTML = NAV.map(n => '<button class="nav-item ' + (ui.view === n[0] ? 'active' : '') + '" data-action="goto" data-view="' + n[0] + '"><span class="ni">' + n[1] + '</span>' + n[2] + '</button>').join('');
    $('#bottomNav').innerHTML = BOTTOM.map(n => '<button class="' + (ui.view === n[0] ? 'active' : '') + '" data-action="goto" data-view="' + n[0] + '"><span>' + n[1] + '</span>' + n[2] + '</button>').join('');
    $('#sideUser').innerHTML = avatar('sm') + '<div class="who"><b>' + esc(displayName()) + '</b><span>' + esc(user.email || '') + '</span></div>';
    $('#sidebar').classList.toggle('open', ui.sidebar); $('#scrim').classList.toggle('show', ui.sidebar);
  }
  function renderRight() {
    if (!state) return;
    const d = today();
    $('#rightPanel').innerHTML = '<div class="card"><div class="card-head"><h3>Today\'s schedule</h3><button class="btn small" data-action="addSched" data-date="' + d + '">+ Add</button></div>' + scheduleHTML(d, true) + '</div>' +
      '<div class="card"><div class="card-head"><h3>Notifications</h3></div>' + (state.notifs.length ? state.notifs.slice(0, 5).map(n => '<div class="li" style="align-items:flex-start"><span>' + esc(n.text) + '</span></div>').join('') : '<div class="muted tiny">No notifications yet. Reminders you set will appear here.</div>') + '</div>';
  }
  function renderBanner() {
    const b = $('#banner');
    const show = state && 'Notification' in window && Notification.permission === 'default' && !state.settings.browserNotif && !ui.bannerDismissed && !state.notifPrompted;
    b.innerHTML = show ? '<div class="banner"><div class="grow">🔔 Enable browser notifications so reminders can reach you even in another tab.</div><button class="btn primary small" data-action="browserNotif">Enable</button><button class="btn small ghost" data-action="dismissBanner">Not now</button></div>' : '';
  }
  const VIEWS = { dashboard: viewDashboard, tasks: viewTasks, calendar: viewCalendar, habits: viewHabits, water: viewWater, focus: viewFocus, notes: viewNotes, analytics: viewAnalytics, review: viewReview, plan: viewPlan, settings: viewSettings };
  function render() {
    if (!state || !user) return;
    applyTheme(); renderHeader(); renderNav(); renderRight(); renderBanner();
    const v = $('#view'); const scroll = window.scrollY;
    try { v.innerHTML = (VIEWS[ui.view] || viewDashboard)(); }
    catch (e) { console.error(e); v.innerHTML = '<div class="card"><div class="empty"><span class="e">⚠️</span>Something went wrong showing this page.<br><span class="tiny">' + esc(e.message) + '</span></div></div>'; }
    window.scrollTo(0, scroll);
  }
  function applyTheme() {
    const t = state ? state.settings.theme : 'system';
    const dark = t === 'dark' || (t === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }

  /* ================= search ================= */
  function openSearch() {
    $('#searchRoot').innerHTML = '<div class="overlay" data-action="closeSearchBg"><div class="search-box"><input id="searchInput" type="search" placeholder="Search tasks, events, habits, notes, reviews…" autocomplete="off"><div class="results" id="searchResults"><div class="empty">Type to search across all days.</div></div></div></div>';
    const inp = $('#searchInput'); inp.focus();
    inp.addEventListener('input', function () { $('#searchResults').innerHTML = searchHTML(inp.value); });
  }
  function searchHTML(q) {
    q = q.trim().toLowerCase(); if (!q) return '<div class="empty">Type to search across all days.</div>';
    const m = s => String(s || '').toLowerCase().indexOf(q) >= 0, res = [];
    state.tasks.forEach(t => { if (m(t.title) || m(t.desc) || m(t.category)) res.push({ k: 'Task', t: (t.done ? '✓ ' : '') + t.title, s: fmtDate(t.date), v: 'tasks', d: t.date }); });
    state.events.forEach(e => { if (m(e.title) || m(e.notes) || m(e.category)) res.push({ k: 'Event', t: e.title, s: fmtDate(e.date) + ' · ' + e.start, v: 'calendar', d: e.date }); });
    state.habits.forEach(h => { if (m(h.name)) res.push({ k: 'Habit', t: h.icon + ' ' + h.name, s: 'Streak ' + habitStreak(h.id), v: 'habits', d: '' }); });
    state.notes.forEach(n => { if (m(n.title) || m(n.content) || n.tags.some(m)) res.push({ k: 'Note', t: n.title, s: fmtDate(n.date), v: 'notes', d: '' }); });
    Object.keys(state.reviews).forEach(k => { const r = state.reviews[k]; if (m(r.well) || m(r.improve) || m(r.priority)) res.push({ k: 'Review', t: 'Review of ' + fmtDate(k), s: r.well || r.improve || r.priority, v: 'review', d: k }); });
    state.schedule.forEach(r => { if (m(r.label)) res.push({ k: 'Routine', t: r.label, s: r.time, v: 'dashboard', d: '' }); });
    if (!res.length) return '<div class="empty"><span class="e">🔎</span>No results for “' + esc(q) + '”</div>';
    return res.slice(0, 60).map(r => '<button class="res" data-action="searchGo" data-view="' + r.v + '" data-date="' + r.d + '"><span class="rt">' + r.k + '</span><span><b>' + esc(r.t) + '</b><small>' + esc(r.s) + '</small></span></button>').join('');
  }

  /* ================= events ================= */
  const H = {
    goto: el => { ui.view = el.dataset.view; ui.menu = null; ui.sidebar = false; window.scrollTo(0, 0); render(); },
    menu: el => { ui.menu = ui.menu === el.dataset.m ? null : el.dataset.m; if (ui.menu === 'notif') { state.notifs.forEach(n => n.read = true); save(); setTimeout(renderHeader, 0); } renderHeader(); if (ui.menu === 'notif') { const dd = $('#header .dropdown.show'); if (dd) dd.classList.add('show'); } },
    openMenu: () => { ui.sidebar = true; renderNav(); },
    closeMenu: () => { ui.sidebar = false; renderNav(); },
    openSearch: openSearch,
    closeSearchBg: (el, e) => { if (e.target === el) $('#searchRoot').innerHTML = ''; },
    searchGo: el => { $('#searchRoot').innerHTML = ''; if (el.dataset.date) { ui.date = el.dataset.date; ui.calCursor = el.dataset.date; ui.reviewDate = el.dataset.date; } ui.view = el.dataset.view; render(); },
    clearNotifs: () => { state.notifs = []; save(); ui.menu = null; renderHeader(); renderRight(); },
    closeModal: closeModal,
    closeModalBg: (el, e) => { if (e.target === el) closeModal(); },
    sample: loadSample,
    addTask: () => taskModal(null, ui.view === 'plan' ? { date: addDays(today(), 1) } : null),
    editTask: el => taskModal(el.dataset.id),
    delTask: el => confirmBox('Delete task?', 'This task will be permanently removed.', function () { state.tasks = state.tasks.filter(t => t.id !== el.dataset.id); save(); render(); toast('Task deleted'); }),
    toggleTask: el => {
      const t = state.tasks.find(x => x.id === el.dataset.id); if (!t) return;
      t.done = !t.done; t.doneAt = t.done ? Date.now() : null; ui.justDone = t.done ? t.id : null;
      save(); render();
      if (t.done) { burst($('.check.on[data-id="' + t.id + '"]')); setTimeout(function () { ui.justDone = null; }, 700); }
    },
    moveTask: el => {
      const i = state.tasks.findIndex(t => t.id === el.dataset.id), dir = Number(el.dataset.dir); const t = state.tasks[i]; if (!t) return;
      let j = i + dir; while (j >= 0 && j < state.tasks.length && (state.tasks[j].date !== t.date || state.tasks[j].done)) j += dir;
      if (j < 0 || j >= state.tasks.length) return;
      state.tasks.splice(i, 1); state.tasks.splice(j, 0, t); save(); render();
    },
    shiftDate: el => { ui.date = addDays(ui.date, Number(el.dataset.n)); render(); },
    dateToday: () => { ui.date = today(); render(); },
    catFilter: el => { ui.catFilter = el.dataset.cat; render(); },
    addEvent: () => eventModal(null, ui.view === 'plan' ? { date: addDays(today(), 1) } : null),
    addEventTomorrow: () => eventModal(null, { date: addDays(today(), 1) }),
    addEventAt: el => eventModal(null, { date: ui.calCursor, start: el.dataset.time, end: fromMin(Math.min(1439, toMin(el.dataset.time) + 60)) }),
    editEvent: el => eventModal(el.dataset.id),
    delEvent: el => confirmBox('Delete event?', 'This event will be permanently removed.', function () { state.events = state.events.filter(e => e.id !== el.dataset.id); save(); render(); toast('Event deleted'); }),
    pickDate: el => { ui.date = el.dataset.date; ui.calCursor = el.dataset.date; render(); },
    calView: el => { ui.calView = el.dataset.v; render(); },
    calToday: () => { ui.calCursor = today(); ui.date = today(); render(); },
    calPrev: () => calShift(-1), calNext: () => calShift(1),
    addHabit: () => habitModal(null), editHabit: el => habitModal(el.dataset.id),
    delHabit: el => confirmBox('Delete habit?', 'The habit and its history will be removed.', function () { state.habits = state.habits.filter(h => h.id !== el.dataset.id); delete state.habitLogs[el.dataset.id]; save(); render(); toast('Habit deleted'); }),
    toggleHabit: el => {
      const id = el.dataset.id, d = el.dataset.date; if (!state.habitLogs[id]) state.habitLogs[id] = {};
      if (state.habitLogs[id][d]) delete state.habitLogs[id][d]; else { state.habitLogs[id][d] = true; burst(el); }
      save(); render();
    },
    addWater: el => addWater(Number(el.dataset.ml)), waterCustom: waterCustomModal,
    delWater: el => { state.waterLogs = state.waterLogs.filter(w => w.id !== el.dataset.id); save(); render(); },
    preset: el => { state.settings.focusMin = Number(el.dataset.f); state.settings.breakMin = Number(el.dataset.b); if (!timer.running) resetTimer('focus'); save(); render(); },
    customTimer: () => modal('Custom timer', '<div class="row2"><div class="field"><label>Focus (min)</label><input type="number" name="f" min="1" max="180" required value="' + state.settings.focusMin + '"></div><div class="field"><label>Break (min)</label><input type="number" name="b" min="1" max="60" required value="' + state.settings.breakMin + '"></div></div>', function (f) {
      const a = Number(f.get('f')), b = Number(f.get('b')); if (!(a >= 1 && a <= 180 && b >= 1 && b <= 60)) { toast('Focus 1–180, break 1–60 minutes'); return false; }
      state.settings.focusMin = Math.round(a); state.settings.breakMin = Math.round(b); timer.running = false; resetTimer('focus'); save(); render();
    }),
    timerToggle: () => {
      if (timer.running) { timer.running = false; timer.remaining = Math.max(0, Math.round((timer.endAt - Date.now()) / 1000)); }
      else { if (timer.remaining <= 0) resetTimer(); timer.endAt = Date.now() + timer.remaining * 1000; timer.running = true; }
      const b = $('#timerStart'); if (b) b.textContent = timer.running ? 'Pause' : 'Start';
    },
    timerReset: () => { resetTimer(); render(); },
    timerSkip: () => { resetTimer(timer.mode === 'focus' ? 'break' : 'focus'); render(); },
    addNote: () => noteModal(null), editNote: el => noteModal(el.dataset.id),
    delNote: el => confirmBox('Delete note?', 'This note will be permanently removed.', function () { state.notes = state.notes.filter(n => n.id !== el.dataset.id); save(); render(); }),
    noteTag: el => { ui.noteTag = el.dataset.tag; render(); },
    addSched: el => schedModal(el.dataset.date, null), editSched: el => schedModal(el.dataset.date, el.dataset.id),
    delSched: el => { const arr = editableSched(el.dataset.date); const i = arr.findIndex(x => x.id === el.dataset.id); if (i >= 0) arr.splice(i, 1); save(); render(); },
    saveDefaultSched: el => { state.schedule = getSched(el.dataset.date).map(x => Object.assign({}, x)); save(); toast('Saved as your default routine'); },
    theme: el => { state.settings.theme = el.dataset.v; save(); render(); },
    dismissBanner: () => { ui.bannerDismissed = true; renderBanner(); },
    browserNotif: () => {
      if (!('Notification' in window)) { toast('This browser does not support notifications'); return; }
      if (Notification.permission === 'denied') { toast('Notifications are blocked. Allow them in your browser site settings.'); return; }
      Notification.requestPermission().then(function (p) {
        state.settings.browserNotif = p === 'granted'; state.notifPrompted = true; save(); render();
        if (p === 'granted') notify('Browser notifications enabled 🔔'); else toast('Permission not granted');
      });
    },
    logout: doLogout,
    deleteAccount: () => confirmBox('Delete account?', 'All your planner data will be permanently deleted. This cannot be undone.', deleteAccount, 'Delete everything')
  };
  function calShift(n) {
    const d = parseYmd(ui.calCursor);
    if (ui.calView === 'month') { d.setDate(1); d.setMonth(d.getMonth() + n); } else if (ui.calView === 'week') d.setDate(d.getDate() + 7 * n); else d.setDate(d.getDate() + n);
    ui.calCursor = ymd(d); if (ui.calView === 'day') ui.date = ui.calCursor; render();
  }

  document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-action]');
    if (!e.target.closest('.menu-wrap') && ui.menu) { ui.menu = null; if (state) renderHeader(); }
    if (!el) return;
    const fn = H[el.dataset.action];
    if (fn) { try { fn(el, e); } catch (err) { console.error(err); toast('Something went wrong: ' + err.message); } }
  });
  document.addEventListener('change', function (e) {
    const el = e.target; if (!state) return;
    if (el.dataset.ui) { ui[el.dataset.ui] = el.value || (el.dataset.ui === 'date' ? today() : ''); if (el.dataset.ui === 'date') ui.calCursor = ui.date; render(); return; }
    const k = el.dataset.setting; if (!k) return;
    const val = el.dataset.type === 'bool' ? el.checked : el.dataset.type === 'number' ? Number(el.value) : el.value;
    if (k === 'waterGoalL') { const l = Number(el.value); if (!(l >= .5 && l <= 10)) { toast('Goal must be between 0.5 and 10 litres'); render(); return; } state.settings.waterGoal = Math.round(l * 1000); }
    else if (k === 'profileName') state.profile.name = el.value.trim();
    else if (k === 'profilePhoto') state.profile.photo = el.value.trim();
    else if (el.dataset.type === 'number' && !(val > 0)) { toast('Please enter a valid number'); render(); return; }
    else state.settings[k] = val;
    if ((k === 'focusMin' || k === 'breakMin') && !timer.running) resetTimer();
    save(); render();
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'noteSearch') { ui.noteQuery = e.target.value; const pos = e.target.selectionStart; render(); const n = $('#noteSearch'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (er) { /* ignore */ } } }
  });
  document.addEventListener('submit', function (e) {
    if (!state) return;
    if (e.target.id === 'reviewForm') {
      e.preventDefault(); const f = new FormData(e.target);
      state.reviews[ui.reviewDate] = { well: String(f.get('well') || ''), improve: String(f.get('improve') || ''), priority: String(f.get('priority') || '') };
      save(); toast('Review saved ✓'); render();
    } else if (e.target.id === 'quickPlan') {
      e.preventDefault(); const f = new FormData(e.target), title = String(f.get('title')).trim(); if (!title) return;
      const start = f.get('start') || '', rem = start ? String(f.get('reminder') || '') : '';
      state.tasks.push({ id: uid(), title: title, desc: '', date: addDays(today(), 1), start: start, end: start ? fromMin(Math.min(1439, toMin(start) + (Number(state.settings.taskDuration) || 60))) : '', priority: f.get('priority'), category: f.get('category'), reminder: rem, done: false, doneAt: null });
      save(); render(); toast('Added to tomorrow');
    }
  });
  document.addEventListener('keydown', function (e) {
    if (!state) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); }
    if (e.key === 'Escape') { closeModal(); $('#searchRoot').innerHTML = ''; ui.sidebar = false; ui.menu = null; renderNav(); renderHeader(); }
  });
  // drag & drop reorder
  let dragId = null;
  document.addEventListener('dragstart', function (e) { const el = e.target.closest && e.target.closest('[data-drag]'); if (!el) return; dragId = el.dataset.drag; el.classList.add('dragging'); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); } catch (er) { /* ignore */ } });
  document.addEventListener('dragend', function () { dragId = null; $$('.dragging,.over').forEach(x => x.classList.remove('dragging', 'over')); });
  document.addEventListener('dragover', function (e) { const el = e.target.closest && e.target.closest('[data-drag]'); if (!el || !dragId) return; e.preventDefault(); $$('.over').forEach(x => x.classList.remove('over')); if (el.dataset.drag !== dragId) el.classList.add('over'); });
  document.addEventListener('drop', function (e) {
    const el = e.target.closest && e.target.closest('[data-drag]'); if (!el || !dragId) return; e.preventDefault();
    const from = state.tasks.findIndex(t => t.id === dragId), to = state.tasks.findIndex(t => t.id === el.dataset.drag);
    if (from < 0 || to < 0 || from === to) return;
    const t = state.tasks.splice(from, 1)[0]; state.tasks.splice(to, 0, t); dragId = null; save(); render();
  });

  /* ================= clock tick ================= */
  let tickN = 0;
  setInterval(function () {
    if (!state || !user) return;
    tickN++;
    const c = $('#clock'); if (c) c.textContent = clockText();
    const g = $('#greet'); if (g) g.textContent = greeting();
    tickTimer();
    if (state.lastDay !== today()) { // midnight rollover
      const wasToday = ui.date === state.lastDay;
      state.lastDay = today(); if (wasToday) { ui.date = today(); ui.calCursor = today(); }
      ui.reviewDate = today(); save(); render(); toast('🌅 New day! Your dashboard has switched to today.');
    }
    if (tickN % 15 === 0) { try { checkReminders(); } catch (e) { console.error(e); } }
    if (tickN % 60 === 0 && ui.view === 'dashboard' && !$('#modalRoot').firstChild) render();
  }, 1000);

  /* ================= auth ================= */
  function showLogin(msg) {
    $('#app').classList.add('hidden');
    $('#loginScreen').classList.remove('hidden');
    const alertBox = $('#authAlert');
    if (alertBox) {
      if (msg) {
        alertBox.className = 'auth-alert success';
        alertBox.textContent = msg;
        alertBox.classList.remove('hidden');
      } else {
        alertBox.classList.add('hidden');
      }
    }
  }

  async function enterApp(u, initialData = null) {
    user = u;
    await loadState(initialData);
    if (state.lastDay !== today()) state.lastDay = today();
    Object.assign(ui, { view: 'dashboard', date: today(), calCursor: today(), reviewDate: today(), menu: null, sidebar: false });
    resetTimer('focus');
    $('#loginScreen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    render();
    try { checkReminders(); } catch (e) { console.error(e); }
  }

  async function doLogout() {
    if (authToken && !user?.demo) {
      try { await apiRequest('/api/logout', 'POST'); } catch (e) { /* ignore */ }
    }
    authToken = '';
    localStorage.removeItem('dayflow:token');
    localStorage.removeItem('dayflow:demoSession');
    user = null;
    state = null;
    closeModal();
    showLogin('You have been logged out.');
  }

  async function deleteAccount() {
    const u = user;
    try { localStorage.removeItem(storeKey()); } catch (e) { /* ignore */ }
    if (!u || u.demo) {
      state = null;
      doLogout();
      return;
    }
    try {
      if (authToken) {
        const res = await apiRequest('/api/account', 'DELETE');
        if (!res.ok) throw new Error(res.error || 'Failed to delete account');
      }
      authToken = '';
      localStorage.removeItem('dayflow:token');
      state = null;
      user = null;
      showLogin('Your SQLite account and all data have been deleted.');
    } catch (e) {
      toast('Could not delete account: ' + (e.message || e));
    }
  }

  function setAuthAlert(type, message) {
    const el = $('#authAlert');
    if (!el) return;
    if (!message) {
      el.classList.add('hidden');
      return;
    }
    el.className = 'auth-alert ' + type;
    el.textContent = message;
    el.classList.remove('hidden');
  }

  async function boot() {
    applyTheme();

    // Tab switching
    const tabIn = $('#tabSignIn'), tabUp = $('#tabSignUp');
    const formIn = $('#signInForm'), formUp = $('#signUpForm');
    const title = $('#authTitle'), subtitle = $('#authSubtitle');

    if (tabIn && tabUp) {
      tabIn.addEventListener('click', function () {
        tabIn.classList.add('active'); tabIn.setAttribute('aria-selected', 'true');
        tabUp.classList.remove('active'); tabUp.setAttribute('aria-selected', 'false');
        if (formIn) formIn.classList.remove('hidden');
        if (formUp) formUp.classList.add('hidden');
        if (title) title.textContent = 'Welcome Back';
        if (subtitle) subtitle.textContent = 'Sign in to your SQLite-powered planner';
        setAuthAlert('', '');
      });
      tabUp.addEventListener('click', function () {
        tabUp.classList.add('active'); tabUp.setAttribute('aria-selected', 'true');
        tabIn.classList.remove('active'); tabIn.setAttribute('aria-selected', 'false');
        if (formUp) formUp.classList.remove('hidden');
        if (formIn) formIn.classList.add('hidden');
        if (title) title.textContent = 'Create SQLite Account';
        if (subtitle) subtitle.textContent = 'Start tracking your habits, tasks & routines';
        setAuthAlert('', '');
      });
    }

    // Password visibility toggles
    $$('.pwd-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const targetId = btn.dataset.target;
        const input = $('#' + targetId);
        if (!input) return;
        if (input.type === 'password') {
          input.type = 'text';
          btn.textContent = '🙈';
        } else {
          input.type = 'password';
          btn.textContent = '👁';
        }
      });
    });

    // Sign In form handler
    if (formIn) {
      formIn.addEventListener('submit', async function (e) {
        e.preventDefault();
        const f = new FormData(formIn);
        const username = String(f.get('username') || '').trim();
        const password = String(f.get('password') || '').trim();
        if (!username || !password) return;

        const btn = $('#loginSubmitBtn');
        if (btn) { btn.disabled = true; btn.querySelector('span').textContent = 'Signing in...'; }
        setAuthAlert('', '');

        try {
          const res = await apiRequest('/api/login', 'POST', { username, password });
          if (res.ok && res.token && res.user) {
            authToken = res.token;
            localStorage.setItem('dayflow:token', res.token);
            setAuthAlert('success', 'Login successful! Opening planner...');
            toast('Welcome back, ' + (res.user.displayName || res.user.username) + '! ✓');
            setTimeout(() => enterApp(res.user, res.data), 200);
          } else {
            setAuthAlert('error', res.error || 'Invalid username or password');
          }
        } catch (err) {
          setAuthAlert('error', 'Login error: ' + err.message);
        } finally {
          if (btn) { btn.disabled = false; btn.querySelector('span').textContent = 'Sign In'; }
        }
      });
    }

    // Sign Up form handler
    if (formUp) {
      formUp.addEventListener('submit', async function (e) {
        e.preventDefault();
        const f = new FormData(formUp);
        const name = String(f.get('name') || '').trim();
        const username = String(f.get('username') || '').trim();
        const email = String(f.get('email') || '').trim();
        const password = String(f.get('password') || '').trim();
        if (!username || !password) return;

        const btn = $('#regSubmitBtn');
        if (btn) { btn.disabled = true; btn.querySelector('span').textContent = 'Creating account...'; }
        setAuthAlert('', '');

        try {
          const res = await apiRequest('/api/register', 'POST', { name, username, email, password });
          if (res.ok && res.token && res.user) {
            authToken = res.token;
            localStorage.setItem('dayflow:token', res.token);
            setAuthAlert('success', 'Account created in SQLite database!');
            toast('Welcome, ' + (res.user.displayName || res.user.username) + '! 🎉');
            setTimeout(() => enterApp(res.user, {}), 250);
          } else {
            setAuthAlert('error', res.error || 'Registration failed');
          }
        } catch (err) {
          setAuthAlert('error', 'Registration error: ' + err.message);
        } finally {
          if (btn) { btn.disabled = false; btn.querySelector('span').textContent = 'Create Account'; }
        }
      });
    }

    // Demo button handler
    $('#demoBtn').addEventListener('click', function () {
      localStorage.setItem('dayflow:demoSession', '1');
      enterApp({ uid: 'demo', displayName: 'Demo User', email: 'demo@local.device', photoURL: '', demo: true });
      toast('Demo mode: data is stored in your browser.');
    });

    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const f = function () { if (state && state.settings.theme === 'system') applyTheme(); };
      if (mq.addEventListener) mq.addEventListener('change', f);
    }

    // Connect to SQLite backend
    await detectApiBase();

    // Auto login with saved token
    if (authToken) {
      try {
        const res = await apiRequest('/api/me', 'GET');
        if (res.ok && res.user) {
          enterApp(res.user);
          return;
        } else {
          // Token expired or invalid
          localStorage.removeItem('dayflow:token');
          authToken = '';
        }
      } catch (e) {
        console.warn('Auto-login check failed:', e);
      }
    }

    if (localStorage.getItem('dayflow:demoSession') === '1') {
      enterApp({ uid: 'demo', displayName: 'Demo User', email: 'demo@local.device', photoURL: '', demo: true });
    } else {
      showLogin();
    }
  }

  boot();
})();
