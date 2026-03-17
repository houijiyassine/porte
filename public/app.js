/* ─────────────────────────────────────────────────────
   PORTE — Frontend App
   ───────────────────────────────────────────────────── */

const API = '';  // same origin
let token = localStorage.getItem('porte_token');
let user  = JSON.parse(localStorage.getItem('porte_user') || 'null');
let ws    = null;
let usersCache = [];

// ─── Init ─────────────────────────────────────────────
window.addEventListener('load', async () => {
  await registerSW();
  setTimeout(() => {
    document.getElementById('loading').style.display = 'none';
    if (token && user) {
      bootApp();
    } else {
      document.getElementById('login-page').style.display = 'flex';
    }
  }, 1600);
});

async function registerSW() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js');
    } catch(e) {}
  }
}

// ─── Login ────────────────────────────────────────────
document.getElementById('login-btn').onclick = doLogin;
document.getElementById('login-pw').addEventListener('keydown', e => { if(e.key === 'Enter') doLogin(); });

async function doLogin() {
  const phone = document.getElementById('login-phone').value.trim();
  const pw    = document.getElementById('login-pw').value;
  const err   = document.getElementById('login-error');
  err.style.display = 'none';

  const btn = document.getElementById('login-btn');
  btn.innerHTML = '<span>جاري التحقق...</span>';
  btn.disabled = true;

  try {
    const res = await apiFetch('/api/auth/login', 'POST', { phone, pw }, false);
    token = res.token;
    user  = res.user;
    localStorage.setItem('porte_token', token);
    localStorage.setItem('porte_user', JSON.stringify(user));
    document.getElementById('login-page').style.display = 'none';
    bootApp();
  } catch(e) {
    err.textContent = e.message || 'خطأ في تسجيل الدخول';
    err.style.display = 'block';
  } finally {
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>دخول`;
    btn.disabled = false;
  }
}

// ─── Boot ─────────────────────────────────────────────
function bootApp() {
  document.getElementById('main-app').style.display = 'block';
  
  // Header
  const initials = user.name.split(' ').map(n => n[0]).join('').slice(0,2);
  document.getElementById('header-avatar').textContent = initials;
  
  const roleBadge = document.getElementById('header-role-badge');
  const roleLabels = { user: 'مستخدم', admin: 'مدير', super_admin: 'سوبر أدمن' };
  roleBadge.textContent = roleLabels[user.role] || user.role;
  roleBadge.className = 'role-badge ' + 
    (user.role === 'super_admin' ? 'role-super' : user.role === 'admin' ? 'role-admin' : 'role-user');

  // Profile page
  document.getElementById('profile-name').textContent = user.name;
  document.getElementById('profile-role').textContent = roleLabels[user.role];

  // Role-based UI
  const isAdmin = ['admin','super_admin'].includes(user.role);
  const isSuperAdmin = user.role === 'super_admin';
  
  if (!isAdmin) {
    document.getElementById('nav-dashboard').style.display = 'none';
    document.getElementById('nav-users').style.display = 'none';
  }
  if (isSuperAdmin) {
    document.getElementById('nav-map').style.display = 'flex';
    document.getElementById('institutes-section').style.display = 'block';
    loadInstitutes();
  }
  if (isAdmin) {
    document.getElementById('schedule-section').style.display = 'block';
    document.getElementById('gps-section').style.display = 'block';
    initScheduleUI();
    loadStats();
  }

  // Connect WebSocket
  connectWS();
  
  // Load door status
  loadDoorStatus();
  loadRecentHistory();
  
  // Subscribe to push
  subscribePush();
  
  // Location tracking for super admin
  if (isSuperAdmin) startLocationTracking();
}

// ─── WebSocket ────────────────────────────────────────
function connectWS() {
  const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + `?token=${token}`;
  ws = new WebSocket(wsUrl);
  
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'door_action' || msg.type === 'door_state') {
      const state = msg.state || (msg.action === 'open' || msg.action === 'open40' ? 'open' : msg.action === 'close' ? 'closed' : null);
      if (state) updateDoorStatusUI(state, msg.user);
      loadRecentHistory();
    }
    if (msg.type === 'location_update' && user.role === 'super_admin') {
      updateUserMarker(msg.userId, msg.coords);
    }
  };
  
  ws.onclose = () => setTimeout(connectWS, 3000);
}

// ─── Door Status ──────────────────────────────────────
async function loadDoorStatus() {
  try {
    const data = await apiFetch('/api/door/status');
    const state = data?.value || 'unknown';
    updateDoorStatusUI(state);
  } catch {}
}

function updateDoorStatusUI(state, byUser) {
  const el  = document.getElementById('door-status');
  const txt = document.getElementById('door-status-text');
  el.className = `door-status-value status-${state === 'open' || state === 'opened' ? 'open' : state === 'close' || state === 'closed' ? 'closed' : 'unknown'}`;
  const labels = { open:'مفتوح', opened:'مفتوح', close:'مغلق', closed:'مغلق', stop:'متوقف', unknown:'غير معروف' };
  txt.textContent = labels[state] || state;
}

// ─── Door Control ─────────────────────────────────────
let timerInterval = null;

async function sendAction(action) {
  try {
    const res = await apiFetch('/api/door/control', 'POST', { action });
    
    const labels = { open:'تم فتح الباب', close:'تم غلق الباب', stop:'تم الإيقاف', open40:'فتح لمدة 40 ثانية' };
    toast(labels[action] || 'تم', 'success');
    
    if (action === 'open40') {
      startTimer(40);
      updateDoorStatusUI('open');
    } else {
      updateDoorStatusUI(action);
    }
  } catch(e) {
    toast(e.message || 'خطأ في الاتصال', 'error');
  }
}

function startTimer(seconds) {
  const bar  = document.getElementById('timer-bar');
  const fill = document.getElementById('timer-fill');
  const txt  = document.getElementById('timer-text');
  
  bar.classList.add('active');
  txt.style.display = 'block';
  
  let remaining = seconds;
  fill.style.width = '100%';
  txt.textContent = `سيُغلق بعد ${remaining} ثانية`;
  
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    remaining--;
    fill.style.width = `${(remaining / seconds) * 100}%`;
    txt.textContent = remaining > 0 ? `سيُغلق بعد ${remaining} ثانية` : 'تم الغلق';
    if (remaining <= 0) {
      clearInterval(timerInterval);
      setTimeout(() => {
        bar.classList.remove('active');
        txt.style.display = 'none';
        updateDoorStatusUI('closed');
      }, 1500);
    }
  }, 1000);
}

// ─── History ──────────────────────────────────────────
async function loadRecentHistory() {
  try {
    const data = await apiFetch('/api/history');
    renderHistory(data?.slice(0,5), 'recent-history');
    if (document.getElementById('page-dashboard').classList.contains('active')) {
      renderHistory(data, 'full-history');
    }
  } catch {}
}

function renderHistory(items, containerId) {
  const container = document.getElementById(containerId);
  if (!items?.length) { container.innerHTML = '<p style="color:var(--muted);font-size:0.9rem;padding:16px 0">لا توجد عمليات</p>'; return; }
  
  const iconMap = { open:'🔓', opened:'🔓', close:'🔒', closed:'🔒', stop:'⏹', open40:'⏱' };
  const colorMap = { open:'h-open', opened:'h-open', close:'h-close', closed:'h-close', stop:'h-stop', open40:'h-open' };
  const labelMap = { open:'فتح الباب', opened:'فتح الباب', close:'غلق الباب', closed:'غلق الباب', stop:'إيقاف', open40:'فتح 40ث' };
  
  container.innerHTML = items.map(h => `
    <div class="history-item">
      <div class="history-icon ${colorMap[h.value] || 'h-stop'}">${iconMap[h.value] || '🚪'}</div>
      <div class="history-info">
        <div class="history-action">${labelMap[h.value] || h.value}</div>
        <div class="history-meta">${h.source || '—'}</div>
      </div>
      <div class="history-time">${formatTime(h.created_at)}</div>
    </div>
  `).join('');
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('ar', { hour:'2-digit', minute:'2-digit' }) + '\n' + d.toLocaleDateString('ar');
}

// ─── Stats ────────────────────────────────────────────
async function loadStats() {
  try {
    const data = await apiFetch('/api/stats');
    document.getElementById('stat-today').textContent = data.today_actions ?? '—';
    document.getElementById('stat-users').textContent = data.active_users ?? '—';
    document.getElementById('stat-total').textContent = data.total_users ?? '—';
  } catch {}
}

// ─── Users ────────────────────────────────────────────
async function loadUsers() {
  try {
    const data = await apiFetch('/api/users');
    usersCache = data || [];
    renderUsersTable(usersCache);
  } catch {}
}

function renderUsersTable(users) {
  const tbody = document.getElementById('users-tbody');
  const roleLabels = { user:'مستخدم', admin:'مدير', super_admin:'سوبر أدمن' };
  tbody.innerHTML = users.map(u => `
    <tr>
      <td style="font-weight:600">${u.name}</td>
      <td style="direction:ltr;font-family:'JetBrains Mono'">${u.phone}</td>
      <td><span class="badge ${u.role === 'admin' || u.role === 'super_admin' ? 'role-admin' : 'role-user'}" style="font-size:0.75rem">${roleLabels[u.role] || u.role}</span></td>
      <td><span class="badge ${u.status === 'active' ? 'badge-active' : 'badge-blocked'}">${u.status === 'active' ? 'نشط' : 'محظور'}</span></td>
      <td>
        <button onclick="editUser(${JSON.stringify(u).replace(/"/g,"&quot;")})" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:0.8rem;margin-left:8px">تعديل</button>
        <button onclick="toggleBlock('${u.id}','${u.status}')" style="background:none;border:none;color:var(--warning);cursor:pointer;font-size:0.8rem">${u.status === 'active' ? 'حظر' : 'تفعيل'}</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px">لا يوجد مستخدمون</td></tr>';
}

document.getElementById('user-search').addEventListener('input', function() {
  const q = this.value.toLowerCase();
  renderUsersTable(usersCache.filter(u => u.name.toLowerCase().includes(q) || u.phone.includes(q)));
});

function openAddUser() {
  document.getElementById('edit-user-id').value = '';
  document.getElementById('u-name').value = '';
  document.getElementById('u-phone').value = '';
  document.getElementById('u-pw').value = '';
  document.getElementById('u-expire').value = '';
  document.getElementById('u-note').value = '';
  document.getElementById('user-modal-title').textContent = 'إضافة مستخدم';
  openModal('modal-user');
}

function editUser(u) {
  document.getElementById('edit-user-id').value = u.id;
  document.getElementById('u-name').value = u.name;
  document.getElementById('u-phone').value = u.phone;
  document.getElementById('u-pw').value = '';
  document.getElementById('u-role').value = u.role;
  document.getElementById('u-expire').value = u.expire_date?.split('T')[0] || '';
  document.getElementById('u-note').value = u.note || '';
  document.getElementById('user-modal-title').textContent = 'تعديل مستخدم';
  openModal('modal-user');
}

async function saveUser() {
  const id   = document.getElementById('edit-user-id').value;
  const body = {
    name:        document.getElementById('u-name').value,
    phone:       document.getElementById('u-phone').value,
    role:        document.getElementById('u-role').value,
    expire_date: document.getElementById('u-expire').value || null,
    note:        document.getElementById('u-note').value,
  };
  const pw = document.getElementById('u-pw').value;
  if (pw) body.pw = pw;
  
  try {
    if (id) {
      await apiFetch(`/api/users/${id}`, 'PUT', body);
    } else {
      await apiFetch('/api/users', 'POST', body);
    }
    closeModal('modal-user');
    loadUsers();
    toast('تم الحفظ بنجاح', 'success');
  } catch(e) {
    toast(e.message, 'error');
  }
}

async function toggleBlock(id, status) {
  await apiFetch(`/api/users/${id}`, 'PUT', { status: status === 'active' ? 'blocked' : 'active' });
  loadUsers();
  toast('تم تحديث الحالة', 'success');
}

// ─── Schedule ─────────────────────────────────────────
const DAYS = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
let schedule = {};

async function initScheduleUI() {
  try {
    const inst = await apiFetch('/api/institutes');
    const myInst = Array.isArray(inst) ? inst.find(i => i.id === user.inst_id) : inst;
    schedule = myInst?.schedule || {};
  } catch {}
  
  const grid = document.getElementById('schedule-grid');
  grid.innerHTML = DAYS.map((day, i) => {
    const d = schedule[i] || { enabled: false, start: '08:00', end: '17:00' };
    return `
      <div class="schedule-day">
        <span class="day-name">${day}</span>
        <label class="day-toggle">
          <input type="checkbox" ${d.enabled ? 'checked' : ''} onchange="schedule[${i}] = {...(schedule[${i}]||{}), enabled: this.checked}">
          <span class="toggle-slider"></span>
        </label>
        <div class="time-inputs">
          <input type="time" value="${d.start}" onchange="schedule[${i}] = {...(schedule[${i}]||{}), start: this.value}">
          <span style="color:var(--muted)">→</span>
          <input type="time" value="${d.end}" onchange="schedule[${i}] = {...(schedule[${i}]||{}), end: this.value}">
        </div>
      </div>
    `;
  }).join('');
}

async function saveSchedule() {
  try {
    await apiFetch(`/api/institutes/${user.inst_id}`, 'PUT', { schedule });
    toast('تم حفظ الجدول', 'success');
  } catch(e) {
    toast(e.message, 'error');
  }
}

async function saveGps() {
  const range = document.getElementById('gps-range').value;
  try {
    await apiFetch(`/api/institutes/${user.inst_id}`, 'PUT', { gps: { range: parseInt(range) } });
    toast('تم حفظ نطاق GPS', 'success');
  } catch(e) {
    toast(e.message, 'error');
  }
}

// ─── Institutes (Super Admin) ─────────────────────────
async function loadInstitutes() {
  try {
    const data = await apiFetch('/api/institutes');
    const tbody = document.getElementById('inst-tbody');
    document.getElementById('stat-inst').textContent = data.length;
    tbody.innerHTML = data.map(i => `
      <tr>
        <td style="font-weight:600">${i.name}</td>
        <td style="direction:ltr;font-family:'JetBrains Mono'">${i.code}</td>
        <td><button onclick="deleteInst('${i.id}')" style="background:none;border:none;color:var(--danger);cursor:pointer">حذف</button></td>
      </tr>
    `).join('');
  } catch {}
}

function openAddInst() { openModal('modal-inst'); }

async function saveInstitute() {
  const name = document.getElementById('inst-name').value;
  const code = document.getElementById('inst-code').value;
  try {
    await apiFetch('/api/institutes', 'POST', { name, code });
    closeModal('modal-inst');
    loadInstitutes();
    toast('تمت إضافة المؤسسة', 'success');
  } catch(e) {
    toast(e.message, 'error');
  }
}

// ─── Push Notifications ───────────────────────────────
async function subscribePush() {
  if (!('Notification' in window)) return;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return;
  
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(
      'BOfIw6laarxGfV8Ezc04YzfCzq4Njm7ewizkfnGDIWJGpsfHkqUHVG8SXGb8cJZJxOTIzFeauX4K0Z8oYdfgKTw'
    )
  });
  
  await apiFetch('/api/push/subscribe', 'POST', { subscription: sub });
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return new Uint8Array([...rawData].map(c => c.charCodeAt(0)));
}

// ─── Location ─────────────────────────────────────────
let locationInterval = null;
let mapInstance = null;
const userMarkers = {};

function startLocationTracking() {
  if (!navigator.geolocation) return;
  const send = () => {
    navigator.geolocation.getCurrentPosition(pos => {
      if (ws?.readyState === 1) {
        ws.send(JSON.stringify({ type: 'location', coords: { lat: pos.coords.latitude, lng: pos.coords.longitude } }));
      }
    });
  };
  send();
  locationInterval = setInterval(send, 30000);
}

function updateUserMarker(userId, coords) {
  // Map integration placeholder - uses Leaflet if available
  console.log('User location update:', userId, coords);
}

// ─── Page Navigation ──────────────────────────────────
function showPage(name, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  
  const page = document.getElementById(`page-${name}`);
  if (page) page.classList.add('active');
  if (btn) btn.classList.add('active');
  
  // Lazy load
  if (name === 'dashboard') { loadRecentHistory(); loadStats(); }
  if (name === 'users') loadUsers();
  if (name === 'map') initMap();
}

function initMap() {
  const container = document.getElementById('map-container');
  if (container.innerHTML) return;
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);flex-direction:column;gap:12px">
      <span style="font-size:2rem">📍</span>
      <span>انتظر مواقع المستخدمين...</span>
    </div>`;
}

// ─── Modals ───────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

// Click outside to close
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('show'); });
});

// ─── Logout ───────────────────────────────────────────
function showLogout() { logout(); }

function logout() {
  localStorage.removeItem('porte_token');
  localStorage.removeItem('porte_user');
  token = null; user = null;
  document.getElementById('main-app').style.display = 'none';
  document.getElementById('login-page').style.display = 'flex';
  if (ws) ws.close();
  clearInterval(locationInterval);
}

// ─── Toast ────────────────────────────────────────────
function toast(msg, type = 'info') {
  const container = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success:'✅', error:'❌', info:'ℹ️' };
  el.innerHTML = `<span class="toast-icon">${icons[type]||'ℹ️'}</span><span class="toast-msg">${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ─── API Fetch ────────────────────────────────────────
async function apiFetch(url, method = 'GET', body = null, auth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && token) headers['Authorization'] = `Bearer ${token}`;
  
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  
  const res = await fetch(API + url, opts);
  const data = await res.json();
  
  if (!res.ok) {
    if (res.status === 401) logout();
    throw new Error(data.error || 'خطأ في الخادم');
  }
  return data;
}
