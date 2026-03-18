/* ─────────────────────────────────────────────
   PORTE — Frontend App v2
   ───────────────────────────────────────────── */

const API = '';
let token = localStorage.getItem('porte_token');
let user  = JSON.parse(localStorage.getItem('porte_user') || 'null');
let ws    = null;
let usersCache = [];

// ─── Init ─────────────────────────────────────
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
    try { await navigator.serviceWorker.register('/sw.js'); } catch(e) {}
  }
}

// ─── Login ────────────────────────────────────
document.getElementById('login-btn').onclick = doLogin;
document.getElementById('login-pw').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });

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

// ─── Boot ─────────────────────────────────────
function bootApp() {
  document.getElementById('main-app').style.display = 'block';

  const initials = user.name.split(' ').map(n=>n[0]).join('').slice(0,2);
  document.getElementById('header-avatar').textContent = initials;

  const roleBadge = document.getElementById('header-role-badge');
  const roleLabels = { user:'مستخدم', admin:'مدير', super_admin:'سوبر أدمن' };
  roleBadge.textContent = roleLabels[user.role] || user.role;
  roleBadge.className = 'role-badge ' +
    (user.role==='super_admin' ? 'role-super' : user.role==='admin' ? 'role-admin' : 'role-user');

  document.getElementById('profile-name').textContent = user.name;
  document.getElementById('profile-role').textContent = roleLabels[user.role];

  const isAdmin      = ['admin','super_admin'].includes(user.role);
  const isSuperAdmin = user.role === 'super_admin';

  if (!isAdmin) {
    document.getElementById('nav-dashboard').style.display = 'none';
    document.getElementById('nav-users').style.display = 'none';
  }
  if (isSuperAdmin) {
    document.getElementById('nav-map').style.display = 'flex';
    document.getElementById('nav-institutes').style.display = 'flex';
  }
  if (isAdmin) {
    document.getElementById('schedule-section').style.display = 'block';
    document.getElementById('gps-section').style.display = 'block';
    initScheduleUI();
    loadStats();
  }

  loadDoorStatus();
  loadRecentHistory();
  connectWS();
  subscribePush();
  startLocationTracking();
}

// ─── WebSocket ────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}?token=${token}`);

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'door_event') {
        updateDoorStatusUI(msg.action);
        loadRecentHistory();
      }
      if (msg.type === 'user_location') {
        updateUserMarker(msg.userId, msg.coords);
      }
    } catch {}
  };

  ws.onclose = () => setTimeout(connectWS, 3000);
}

// ─── Door Status ──────────────────────────────
async function loadDoorStatus() {
  try {
    const data = await apiFetch('/api/door/status');
    const state = data?.value || 'unknown';
    updateDoorStatusUI(state);
  } catch {}
}

function updateDoorStatusUI(state) {
  const el  = document.getElementById('door-status');
  const txt = document.getElementById('door-status-text');
  el.className = `door-status-value status-${
    state==='open'||state==='opened' ? 'open' :
    state==='close'||state==='closed' ? 'closed' : 'unknown'
  }`;
  const labels = { open:'مفتوح', opened:'مفتوح', close:'مغلق', closed:'مغلق', stop:'متوقف', unknown:'غير معروف' };
  txt.textContent = labels[state] || state;
}

// ─── Door Control ─────────────────────────────
let timerInterval = null;

async function sendAction(action) {
  try {
    await apiFetch('/api/door/control', 'POST', { action });
    const labels = { open:'تم فتح الباب', close:'تم غلق الباب', stop:'تم الإيقاف', open40:'فتح لمدة 40 ثانية' };
    toast(labels[action] || 'تم', 'success');
    if (action === 'open40') {
      startTimer(40);
      updateDoorStatusUI('open');
    } else {
      updateDoorStatusUI(action);
    }
    loadRecentHistory();
  } catch(e) {
    toast(e.message || 'خطأ في الاتصال', 'error');
  }
}

// إرسال أمر لباب محدد من صفحة المؤسسات
async function sendDoorAction(deviceId, action, duration) {
  try {
    await apiFetch('/api/door/control', 'POST', { action, deviceId, duration });
    toast(`تم: ${action}`, 'success');
  } catch(e) {
    toast(e.message, 'error');
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
    fill.style.width = `${(remaining/seconds)*100}%`;
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

// ─── History ──────────────────────────────────
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
  if (!items?.length) {
    container.innerHTML = '<p style="color:var(--muted);font-size:0.85rem;padding:14px 0">لا توجد عمليات</p>';
    return;
  }
  const iconMap  = { open:'🔓', opened:'🔓', close:'🔒', closed:'🔒', stop:'⏹', open40:'⏱' };
  const colorMap = { open:'h-open', opened:'h-open', close:'h-close', closed:'h-close', stop:'h-stop', open40:'h-open' };
  const labelMap = { open:'فتح الباب', opened:'فتح الباب', close:'غلق الباب', closed:'غلق الباب', stop:'إيقاف', open40:'فتح 40ث' };
  container.innerHTML = items.map(h => `
    <div class="history-item">
      <div class="history-icon ${colorMap[h.value]||'h-stop'}">${iconMap[h.value]||'🚪'}</div>
      <div class="history-info">
        <div class="history-action">${labelMap[h.value]||h.value}</div>
        <div class="history-meta">${h.source||'—'}</div>
      </div>
      <div class="history-time">${formatTime(h.created_at)}</div>
    </div>
  `).join('');
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('ar',{hour:'2-digit',minute:'2-digit'}) + '\n' + d.toLocaleDateString('ar');
}

// ─── Stats ────────────────────────────────────
async function loadStats() {
  try {
    const data = await apiFetch('/api/stats');
    document.getElementById('stat-today').textContent = data.today_actions ?? '—';
    document.getElementById('stat-users').textContent = data.active_users ?? '—';
    document.getElementById('stat-total').textContent = data.total_users ?? '—';
  } catch {}
}

// ─── Users ────────────────────────────────────
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
      <td style="direction:ltr;font-family:'JetBrains Mono';font-size:0.82rem">${u.phone}</td>
      <td><span class="badge ${u.role==='admin'||u.role==='super_admin'?'role-admin':'role-user'}" style="font-size:0.72rem">${roleLabels[u.role]||u.role}</span></td>
      <td><span class="badge ${u.status==='active'?'badge-active':'badge-blocked'}">${u.status==='active'?'نشط':'محظور'}</span></td>
      <td style="white-space:nowrap">
        <button onclick="editUser(${JSON.stringify(u).replace(/"/g,'&quot;')})" style="background:none;border:none;color:var(--accent2);cursor:pointer;font-size:0.78rem;margin-left:8px">تعديل</button>
        <button onclick="toggleBlock('${u.id}','${u.status}')" style="background:none;border:none;color:var(--warning);cursor:pointer;font-size:0.78rem">${u.status==='active'?'حظر':'تفعيل'}</button>
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
    if (id) { await apiFetch(`/api/users/${id}`, 'PUT', body); }
    else    { await apiFetch('/api/users', 'POST', body); }
    closeModal('modal-user');
    loadUsers();
    toast('تم الحفظ بنجاح', 'success');
  } catch(e) { toast(e.message, 'error'); }
}

async function toggleBlock(id, status) {
  await apiFetch(`/api/users/${id}`, 'PUT', { status: status==='active'?'blocked':'active' });
  loadUsers();
  toast('تم تحديث الحالة', 'success');
}

// ─── Institutes ───────────────────────────────
let institutesCache = [];

async function loadInstitutes() {
  try {
    const data = await apiFetch('/api/institutes');
    institutesCache = data || [];
    document.getElementById('stat-inst').textContent = data.length;
    renderInstitutes(data);
  } catch {}
}

function renderInstitutes(insts) {
  const container = document.getElementById('institutes-list');
  if (!insts?.length) {
    container.innerHTML = '<p style="color:var(--muted);text-align:center;padding:40px 0">لا توجد مؤسسات بعد</p>';
    return;
  }
  container.innerHTML = insts.map(inst => `
    <div class="inst-card">
      <div class="inst-header">
        <div>
          <div class="inst-name">🏫 ${inst.name}</div>
          <div class="inst-code">🔑 ${inst.code}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button onclick="editInst(${JSON.stringify(inst).replace(/"/g,'&quot;')})" class="door-action-btn dab-edit">تعديل</button>
          <button onclick="deleteInst('${inst.id}')" class="door-action-btn dab-del">حذف</button>
        </div>
      </div>

      <div class="inst-meta">
        <span>🚪 ${(inst.doors||[]).length} باب</span>
        <span>👥 ${(inst.users_count||0)} مستخدم</span>
        <span>📡 GPS: ${inst.gps?.range||100}م</span>
      </div>

      <div class="section-label">سجلات الأبواب:</div>
      ${(inst.doors||[]).map(door => `
        <div class="door-row">
          <div class="door-row-info">
            <div class="door-row-name">⏳ ${door.name}</div>
            <div class="door-row-id">ID: ${door.device_id?.substring(0,16)}...</div>
          </div>
          <div class="door-row-btns">
            <button class="door-action-btn dab-open"  onclick="sendDoorAction('${door.device_id}','open',${door.duration_seconds||5})">فتح 🟢</button>
            <button class="door-action-btn dab-close" onclick="sendDoorAction('${door.device_id}','close',${door.duration_seconds||5})">غلق 🔴</button>
            <button class="door-action-btn dab-stop"  onclick="sendDoorAction('${door.device_id}','stop',0)">إيقاف 🟡</button>
            <button class="door-action-btn dab-timer" onclick="sendDoorAction('${door.device_id}','open40',40)">40ث ⏱</button>
            <button class="door-action-btn dab-edit"  onclick="openEditDoor('${inst.id}','${door.id}','${door.name}','${door.location||''}','${door.device_id}',${door.duration_seconds||5})">✏️</button>
            <button class="door-action-btn dab-del"   onclick="deleteDoor('${door.id}','${inst.id}')">🗑</button>
          </div>
        </div>
        <div class="gps-row">
          <div>
            <div class="gps-label">🏢 GPS مسؤول</div>
            <div class="toggle-status" style="color:${inst.gps?.admin_required?'var(--success)':'var(--danger)'}">${inst.gps?.admin_required?'ON':'OFF'}</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" ${inst.gps?.admin_required?'checked':''} onchange="toggleGps('${inst.id}','admin_required',this.checked)">
            <span class="toggle-knob"></span>
          </label>
        </div>
        <div class="gps-row" style="margin-top:4px;margin-bottom:8px">
          <div>
            <div class="gps-label">📍 GPS مستخدمين</div>
            <div class="toggle-status" style="color:${inst.gps?.user_required?'var(--success)':'var(--danger)'}">${inst.gps?.user_required?'ON':'OFF'}</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" ${inst.gps?.user_required?'checked':''} onchange="toggleGps('${inst.id}','user_required',this.checked)">
            <span class="toggle-knob"></span>
          </label>
        </div>
      `).join('')}

      <button class="door-action-btn dab-open" onclick="openAddDoor('${inst.id}')" style="margin-top:8px;width:100%;padding:10px;border-radius:10px;font-size:0.82rem">
        + إضافة باب
      </button>
    </div>
  `).join('');
}

function openAddInst() {
  document.getElementById('edit-inst-id').value = '';
  document.getElementById('inst-name').value = '';
  document.getElementById('inst-code').value = '';
  document.getElementById('inst-modal-title').textContent = 'إضافة مؤسسة';
  openModal('modal-inst');
}

function editInst(inst) {
  document.getElementById('edit-inst-id').value = inst.id;
  document.getElementById('inst-name').value = inst.name;
  document.getElementById('inst-code').value = inst.code;
  document.getElementById('inst-modal-title').textContent = 'تعديل مؤسسة';
  openModal('modal-inst');
}

async function saveInstitute() {
  const id   = document.getElementById('edit-inst-id').value;
  const name = document.getElementById('inst-name').value;
  const code = document.getElementById('inst-code').value;
  try {
    if (id) { await apiFetch(`/api/institutes/${id}`, 'PUT', { name, code }); }
    else    { await apiFetch('/api/institutes', 'POST', { name, code }); }
    closeModal('modal-inst');
    loadInstitutes();
    toast('تم الحفظ', 'success');
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteInst(id) {
  if (!confirm('هل تريد حذف المؤسسة؟')) return;
  try {
    await apiFetch(`/api/institutes/${id}`, 'DELETE');
    loadInstitutes();
    toast('تم الحذف', 'success');
  } catch(e) { toast(e.message, 'error'); }
}

async function toggleGps(instId, key, value) {
  try {
    const inst = institutesCache.find(i => i.id === instId);
    const gps  = { ...(inst?.gps||{}), [key]: value };
    await apiFetch(`/api/institutes/${instId}`, 'PUT', { gps });
    loadInstitutes();
  } catch(e) { toast(e.message, 'error'); }
}

// ─── Doors ────────────────────────────────────
function changeDuration(delta) {
  const input = document.getElementById('door-duration');
  const val   = document.getElementById('door-duration-val');
  let v = parseInt(input.value) + delta;
  v = Math.max(1, Math.min(300, v));
  input.value = v;
  val.textContent = v;
}

function openAddDoor(instId) {
  document.getElementById('edit-door-id').value = '';
  document.getElementById('edit-door-inst-id').value = instId;
  document.getElementById('door-name').value = '';
  document.getElementById('door-location').value = '';
  document.getElementById('door-device-id').value = '';
  document.getElementById('door-duration').value = '5';
  document.getElementById('door-duration-val').textContent = '5';
  document.getElementById('door-modal-title').textContent = 'إضافة باب';
  openModal('modal-door');
}

function openEditDoor(instId, doorId, name, location, deviceId, duration) {
  document.getElementById('edit-door-id').value = doorId;
  document.getElementById('edit-door-inst-id').value = instId;
  document.getElementById('door-name').value = name;
  document.getElementById('door-location').value = location;
  document.getElementById('door-device-id').value = deviceId;
  document.getElementById('door-duration').value = duration;
  document.getElementById('door-duration-val').textContent = duration;
  document.getElementById('door-modal-title').textContent = 'تعديل باب';
  openModal('modal-door');
}

async function saveDoor() {
  const id       = document.getElementById('edit-door-id').value;
  const inst_id  = document.getElementById('edit-door-inst-id').value;
  const body = {
    inst_id,
    name:             document.getElementById('door-name').value,
    location:         document.getElementById('door-location').value,
    device_id:        document.getElementById('door-device-id').value,
    duration_seconds: parseInt(document.getElementById('door-duration').value),
  };
  try {
    if (id) { await apiFetch(`/api/doors/${id}`, 'PUT', body); }
    else    { await apiFetch('/api/doors', 'POST', body); }
    closeModal('modal-door');
    loadInstitutes();
    toast('تم الحفظ', 'success');
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteDoor(doorId, instId) {
  if (!confirm('هل تريد حذف الباب؟')) return;
  try {
    await apiFetch(`/api/doors/${doorId}`, 'DELETE');
    loadInstitutes();
    toast('تم الحذف', 'success');
  } catch(e) { toast(e.message, 'error'); }
}

// ─── Schedule ─────────────────────────────────
const DAYS = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
let schedule = {};

async function initScheduleUI() {
  try {
    const inst = await apiFetch('/api/institutes');
    const myInst = Array.isArray(inst) ? inst.find(i => i.id === user.inst_id) : inst;
    schedule = myInst?.schedule || {};
  } catch {}
  const grid = document.getElementById('schedule-grid');
  grid.innerHTML = DAYS.map((day,i) => {
    const d = schedule[i] || { enabled:false, start:'08:00', end:'17:00' };
    return `
      <div class="schedule-day">
        <span class="day-name">${day}</span>
        <label class="day-toggle">
          <input type="checkbox" ${d.enabled?'checked':''} onchange="schedule[${i}]={...(schedule[${i}]||{}),enabled:this.checked}">
          <span class="toggle-slider"></span>
        </label>
        <div class="time-inputs">
          <input type="time" value="${d.start}" onchange="schedule[${i}]={...(schedule[${i}]||{}),start:this.value}">
          <span style="color:var(--muted)">→</span>
          <input type="time" value="${d.end}" onchange="schedule[${i}]={...(schedule[${i}]||{}),end:this.value}">
        </div>
      </div>`;
  }).join('');
}

async function saveSchedule() {
  try {
    await apiFetch(`/api/institutes/${user.inst_id}`, 'PUT', { schedule });
    toast('تم حفظ الجدول', 'success');
  } catch(e) { toast(e.message, 'error'); }
}

async function saveGps() {
  const range = document.getElementById('gps-range').value;
  try {
    await apiFetch(`/api/institutes/${user.inst_id}`, 'PUT', { gps: { range: parseInt(range) } });
    toast('تم حفظ نطاق GPS', 'success');
  } catch(e) { toast(e.message, 'error'); }
}

// ─── Push ─────────────────────────────────────
async function subscribePush() {
  if (!('Notification' in window)) return;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array('BOfIw6laarxGfV8Ezc04YzfCzq4Njm7ewizkfnGDIWJGpsfHkqUHVG8SXGb8cJZJxOTIzFeauX4K0Z8oYdfgKTw')
  });
  await apiFetch('/api/push/subscribe', 'POST', { subscription: sub });
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g,'+').replace(/_/g,'/');
  const rawData = window.atob(base64);
  return new Uint8Array([...rawData].map(c => c.charCodeAt(0)));
}

// ─── Location ─────────────────────────────────
let locationInterval = null;

function startLocationTracking() {
  if (!navigator.geolocation) return;
  const send = () => {
    navigator.geolocation.getCurrentPosition(pos => {
      if (ws?.readyState === 1) {
        ws.send(JSON.stringify({ type:'location', coords:{ lat:pos.coords.latitude, lng:pos.coords.longitude } }));
      }
    });
  };
  send();
  locationInterval = setInterval(send, 30000);
}

function updateUserMarker(userId, coords) {
  console.log('User location:', userId, coords);
}

// ─── Navigation ───────────────────────────────
function showPage(name, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = document.getElementById(`page-${name}`);
  if (page) page.classList.add('active');
  if (btn) btn.classList.add('active');

  if (name === 'dashboard')   { loadRecentHistory(); loadStats(); }
  if (name === 'users')       loadUsers();
  if (name === 'institutes')  loadInstitutes();
  if (name === 'map')         initMap();
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

// ─── Modals ───────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => { if(e.target===overlay) overlay.classList.remove('show'); });
});

// ─── Logout ───────────────────────────────────
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

// ─── Toast ────────────────────────────────────
function toast(msg, type = 'info') {
  const container = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success:'✅', error:'❌', info:'ℹ️' };
  el.innerHTML = `<span class="toast-icon">${icons[type]||'ℹ️'}</span><span class="toast-msg">${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ─── API Fetch ────────────────────────────────
async function apiFetch(url, method = 'GET', body = null, auth = true) {
  const headers = { 'Content-Type':'application/json' };
  if (auth && token) headers['Authorization'] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(API + url, opts);
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) logout();
    throw new Error(data.error || 'خطأ في الخادم');
  }
  return data;
}
