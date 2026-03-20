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
    document.getElementById('nav-users').style.display = 'none';
  }
  if (isSuperAdmin) {
    document.getElementById('nav-map').style.display = 'flex';
  }
  // إظهار المؤسسات للأدمن والسوبر أدمن
  // nav-institutes ظاهر دائماً
  loadStats();

  connectWS();
  subscribePush();
  startLocationTracking();
  // أيقونة الثيم
  if (localStorage.getItem('porte_theme') === 'light') {
    const btn = document.getElementById('theme-btn');
    if (btn) btn.textContent = '☀️';
  }
  // تحميل المؤسسات مباشرة عند الدخول
  loadInstitutes();
  // تفعيل زر المؤسسات
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navInst = document.getElementById('nav-institutes');
  if (navInst) navInst.classList.add('active');
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
    const statEl = document.getElementById('stat-inst');
    if (statEl) statEl.textContent = data.length;
    renderInstitutes(data);
  } catch(e) {
    console.error('[loadInstitutes error]', e);
  }
}

// ─── GPS Modal ────────────────────────────────────────
let currentGpsInstId = null;

let currentGpsDoorId = null;

function openGpsModal(doorId, range, lat, lng) {
  currentGpsDoorId = doorId;
  const r = range === undefined || range === null ? 100 : range;
  document.getElementById('gps-radius').value = r;
  document.getElementById('gps-radius-val').textContent = r;
  document.getElementById('gps-info-val').textContent = r;
  document.getElementById('gps-lat').value = lat || '';
  document.getElementById('gps-lng').value = lng || '';
  openModal('modal-gps');
}

async function saveGpsModal() {
  const range = parseInt(document.getElementById('gps-radius').value);
  const lat   = parseFloat(document.getElementById('gps-lat').value) || null;
  const lng   = parseFloat(document.getElementById('gps-lng').value) || null;
  try {
    await apiFetch('/api/doors/' + currentGpsDoorId, 'PUT', {
      gps: { range, lat, lng }
    });
    closeModal('modal-gps');
    // تحديث الـ badge مباشرة بدون إعادة تحميل كاملة
    document.querySelectorAll('[data-gps-door="' + currentGpsDoorId + '"]').forEach(el => {
      el.textContent = '📡 ' + range + 'م';
    });
    // تحديث الكاش
    institutesCache.forEach(inst => {
      (inst.doors||[]).forEach(door => {
        if (door.id === currentGpsDoorId) {
          door.gps = { ...(door.gps||{}), range, lat, lng };
        }
      });
    });
    toast('تم حفظ إعدادات GPS', 'success');
  } catch(e) { toast(e.message, 'error'); }
}

function useMyLocation() {
  if (!navigator.geolocation) return toast('GPS غير متاح', 'error');
  navigator.geolocation.getCurrentPosition(pos => {
    document.getElementById('gps-lat').value = pos.coords.latitude.toFixed(6);
    document.getElementById('gps-lng').value = pos.coords.longitude.toFixed(6);
    toast('تم تحديد موقعك', 'success');
  }, () => toast('تعذر تحديد الموقع', 'error'));
}

// ─── Door Online Status ────────────────────────────────
const doorStatusCache = {};

async function checkDoorStatus(deviceId, elemId) {
  const el = document.getElementById(elemId);
  if (!el) return;
  el.textContent = '...';
  el.style.color = 'var(--muted)';
  el.style.background = 'var(--surface)';
  try {
    const data = await apiFetch(`/api/device/status/${deviceId}`);
    const online = data.online === true;
    doorStatusCache[deviceId] = online;
    el.textContent = online ? 'En ligne' : 'Hors ligne';
    el.style.color = online ? 'var(--success)' : 'var(--danger)';
    el.style.background = online ? 'rgba(0,230,118,0.1)' : 'rgba(255,61,113,0.1)';
  } catch {
    el.textContent = 'Hors ligne';
    el.style.color = 'var(--danger)';
    el.style.background = 'rgba(255,61,113,0.1)';
  }
}

// ─── Door Logs ────────────────────────────────────────
async function openDoorLogs(doorId, doorName) {
  document.getElementById('door-logs-title').textContent = 'سجل: ' + doorName;
  document.getElementById('door-logs-body').innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px">جاري التحميل...</p>';
  openModal('modal-door-logs');
  try {
    const data = await apiFetch('/api/doors/' + doorId + '/logs');
    if (!data?.length) {
      document.getElementById('door-logs-body').innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px">لا توجد عمليات بعد</p>';
      return;
    }
    const iconMap  = { open:'🔓', close:'🔒', stop:'⏹', open40:'⏱' };
    const colorMap = { open:'rgba(0,230,118,0.1)', close:'rgba(255,61,113,0.1)', stop:'rgba(255,179,0,0.1)', open40:'rgba(0,212,255,0.1)' };
    const labelMap = { open:'فتح', close:'غلق', stop:'إيقاف', open40:'فتح 40ث' };
    document.getElementById('door-logs-body').innerHTML = data.map(function(log) {
      return '<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)">' +
        '<div style="width:38px;height:38px;border-radius:10px;background:' + (colorMap[log.value]||'var(--surface2)') + ';display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0">' + (iconMap[log.value]||'🚪') + '</div>' +
        '<div style="flex:1"><div style="font-weight:700;font-size:0.88rem">' + (labelMap[log.value]||log.value) + '</div>' +
        '<div style="font-size:0.75rem;color:var(--muted);margin-top:2px">👤 ' + (log.source||'—') + '</div></div>' +
        '<div style="font-size:0.72rem;color:var(--muted);font-family:JetBrains Mono,monospace">' + formatTime(log.created_at) + '</div></div>';
    }).join('');
  } catch(e) {
    document.getElementById('door-logs-body').innerHTML = '<p style="color:var(--danger);text-align:center;padding:20px">' + e.message + '</p>';
  }
}

// ─── Door Schedule ─────────────────────────────────────
const DAYS_AR = ['الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت','الأحد'];
let currentScheduleDoorId = null;
let doorSchedule = {};

function openDoorSchedule(doorId, doorName, scheduleData) {
  currentScheduleDoorId = doorId;
  try {
    doorSchedule = scheduleData && typeof scheduleData === 'object' ? scheduleData : {};
  } catch(e) { doorSchedule = {}; }
  document.getElementById('door-schedule-title').textContent = 'جدول: ' + doorName;
  const grid = document.getElementById('door-schedule-grid');
  grid.innerHTML = DAYS_AR.map(function(day, i) {
    const d = doorSchedule[i] || { enabled: false, start: '08:00', end: '18:00' };
    return '<div style="display:flex;align-items:center;gap:10px;background:var(--surface2);border-radius:12px;padding:12px 14px">' +
      '<span style="width:76px;font-weight:600;font-size:0.85rem">' + day + '</span>' +
      '<label class="day-toggle"><input type="checkbox" ' + (d.enabled?'checked':'') + ' onchange="doorSchedule[' + i + ']={...(doorSchedule[' + i + ']||{}),enabled:this.checked}"><span class="toggle-slider"></span></label>' +
      '<div style="display:flex;align-items:center;gap:6px;flex:1">' +
      '<input type="time" value="' + d.start + '" onchange="doorSchedule[' + i + ']={...(doorSchedule[' + i + ']||{}),start:this.value}" style="background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:5px 8px;font-size:0.8rem;font-family:JetBrains Mono;width:84px">' +
      '<span style="color:var(--muted)">→</span>' +
      '<input type="time" value="' + d.end + '" onchange="doorSchedule[' + i + ']={...(doorSchedule[' + i + ']||{}),end:this.value}" style="background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:5px 8px;font-size:0.8rem;font-family:JetBrains Mono;width:84px">' +
      '</div></div>';
  }).join('');
  openModal('modal-door-schedule');
}

async function saveDoorSchedule() {
  try {
    await apiFetch('/api/doors/' + currentScheduleDoorId, 'PUT', { schedule: doorSchedule });
    closeModal('modal-door-schedule');
    loadInstitutes();
    toast('تم حفظ الجدول', 'success');
  } catch(e) { toast(e.message, 'error'); }
}

// ─── Selected Institute ───────────────────────────────
let selectedInstId = null;

function renderInstitutes(insts) {
  const container = document.getElementById('institutes-list');
  if (!insts?.length) {
    container.innerHTML = '<p style="color:var(--muted);text-align:center;padding:40px 0">لا توجد مؤسسات بعد</p>';
    return;
  }

  // إذا كان هناك مؤسسة مختارة — اعرض تفاصيلها فقط
  if (selectedInstId) {
    const inst = insts.find(i => i.id === selectedInstId);
    if (inst) { renderInstDetail(inst); return; }
    selectedInstId = null;
  }

  // قائمة المؤسسات
  renderInstList(insts);
}

function renderInstList(insts) {
  const container = document.getElementById('institutes-list');
  let html = '<div style="display:flex;flex-direction:column;gap:12px">';

  insts.forEach(function(inst) {
    const doorsCount = (inst.doors||[]).length;
    const onlineCount = (inst.doors||[]).filter(d => doorStatusCache[d.device_id] === true).length;

    html += `
      <div onclick="selectInstitute('${inst.id}')" style="background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:20px;cursor:pointer;transition:all 0.2s;position:relative;overflow:hidden" onmouseover="this.style.borderColor='rgba(0,212,255,0.3)'" onmouseout="this.style.borderColor='var(--border)'">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px">
          <div>
            <div style="font-size:1.1rem;font-weight:800">🏫 ${inst.name}</div>
            <div style="font-family:JetBrains Mono,monospace;font-size:0.72rem;color:var(--warning);margin-top:4px">🔑 ${inst.code}</div>
          </div>
          <div style="display:flex;gap:6px">
            <button onclick="event.stopPropagation();openInstSchedule('${inst.id}','${inst.name}',${JSON.stringify(inst.schedule||{}).replace(/"/g,'&quot;')})" class="door-action-btn dab-timer" style="padding:6px 10px">🕐</button>
            <button onclick="event.stopPropagation();editInst(${JSON.stringify(inst).replace(/"/g,'&quot;')})" class="door-action-btn dab-edit" style="padding:6px 10px">✏️</button>
            <button onclick="event.stopPropagation();deleteInst('${inst.id}')" class="door-action-btn dab-del" style="padding:6px 10px">🗑</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
          <div style="background:var(--surface2);border-radius:10px;padding:10px;text-align:center">
            <div style="font-size:1.4rem;font-weight:900;font-family:JetBrains Mono;color:var(--accent)">${doorsCount}</div>
            <div style="font-size:0.7rem;color:var(--muted);margin-top:2px">🚪 أبواب</div>
          </div>
          <div style="background:var(--surface2);border-radius:10px;padding:10px;text-align:center">
            <div style="font-size:1.4rem;font-weight:900;font-family:JetBrains Mono;color:var(--success)">${inst.users_count||0}</div>
            <div style="font-size:0.7rem;color:var(--muted);margin-top:2px">👥 مستخدمون</div>
          </div>
          <div style="background:var(--surface2);border-radius:10px;padding:10px;text-align:center">
            <div style="font-size:1.4rem;font-weight:900;font-family:JetBrains Mono;color:var(--success)">${onlineCount}/${doorsCount}</div>
            <div style="font-size:0.7rem;color:var(--muted);margin-top:2px">📡 En ligne</div>
          </div>
        </div>
        <div style="position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(180deg,var(--accent),var(--accent2));border-radius:0 3px 3px 0"></div>
      </div>`;
  });

  html += '</div>';
  container.innerHTML = html;

  // تحقق من حالة الأجهزة
  setTimeout(function() {
    insts.forEach(function(inst) {
      (inst.doors||[]).forEach(function(door) {
        checkDoorStatus(door.device_id, null, function(online) {
          // تحديث عداد المتصلة
        });
      });
    });
  }, 500);
}

function selectInstitute(instId) {
  selectedInstId = instId;
  loadInstitutes();
  // تحديث عنوان الصفحة
  document.getElementById('inst-page-title').textContent = 'تفاصيل المؤسسة';
  document.getElementById('inst-back-btn').style.display = 'flex';
  document.getElementById('inst-add-btn').style.display = 'none';
}

function backToInstList() {
  selectedInstId = null;
  document.getElementById('inst-page-title').textContent = 'المؤسسات';
  document.getElementById('inst-back-btn').style.display = 'none';
  document.getElementById('inst-add-btn').style.display = 'flex';
  loadInstitutes();
}

function renderInstDetail(inst) {
  const container = document.getElementById('institutes-list');
  let doorsHtml = '';

  (inst.doors||[]).forEach(function(door, idx) {
    const doorId   = door.id;
    const deviceId = door.device_id;
    const doorName = door.name;
    const location = door.location || '';
    const duration = door.duration_seconds || 5;
    const gpsRange = (door.gps && door.gps.range !== undefined) ? door.gps.range : 100;
    const gpsLat   = door.gps?.lat || null;
    const gpsLng   = door.gps?.lng || null;
    const adminReq = door.gps?.admin_required || false;
    const userReq  = door.gps?.user_required || false;
    const schedData = JSON.stringify(door.schedule || {}).replace(/"/g, '&quot;');

    if (idx > 0) doorsHtml += '<div style="margin:10px 0"></div>';

    doorsHtml += `
      <div style="background:rgba(0,230,118,0.04);border:1px solid rgba(0,230,118,0.2);border-radius:16px;padding:14px;margin-bottom:4px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:6px">
          <div>
            <div style="font-weight:800;font-size:0.95rem">⏳ ${doorName}</div>
            <div style="font-family:JetBrains Mono,monospace;font-size:0.68rem;color:var(--muted);margin-top:2px">ID: ${deviceId.substring(0,16)}...</div>
          </div>
          <span id="door-status-${doorId}" style="font-size:0.7rem;font-weight:700;padding:3px 10px;border-radius:20px;background:var(--surface);color:var(--muted)">...</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px">
          <button onclick="sendDoorAction('${deviceId}','open',${duration})" style="background:rgba(0,230,118,0.15);border:1px solid rgba(0,230,118,0.3);border-radius:12px;padding:14px 6px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;font-family:Cairo,sans-serif;font-weight:700;font-size:0.82rem;color:var(--success)">🟢<span>فتح</span></button>
          <button onclick="sendDoorAction('${deviceId}','close',${duration})" style="background:rgba(255,61,113,0.15);border:1px solid rgba(255,61,113,0.3);border-radius:12px;padding:14px 6px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;font-family:Cairo,sans-serif;font-weight:700;font-size:0.82rem;color:var(--danger)">🔴<span>غلق</span></button>
          <button onclick="sendDoorAction('${deviceId}','stop',0)" style="background:rgba(255,179,0,0.15);border:1px solid rgba(255,179,0,0.3);border-radius:12px;padding:14px 6px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;font-family:Cairo,sans-serif;font-weight:700;font-size:0.82rem;color:var(--warning)">🟡<span>إيقاف</span></button>
          <button onclick="sendDoorAction('${deviceId}','open40',40)" style="background:rgba(0,212,255,0.15);border:1px solid rgba(0,212,255,0.3);border-radius:12px;padding:14px 6px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;font-family:Cairo,sans-serif;font-weight:700;font-size:0.82rem;color:var(--accent)">⏱<span>40ث</span></button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px">
          <button onclick="openEditDoor('${inst.id}','${doorId}','${doorName}','${location}','${deviceId}',${duration})" style="background:rgba(124,92,252,0.15);border:1px solid rgba(124,92,252,0.3);border-radius:12px;padding:12px 6px;cursor:pointer;font-size:1.1rem" title="تعديل">✏️</button>
          <button onclick="deleteDoor('${doorId}','${inst.id}')" style="background:rgba(255,61,113,0.1);border:1px solid rgba(255,61,113,0.2);border-radius:12px;padding:12px 6px;cursor:pointer;font-size:1.1rem" title="حذف">🗑</button>
          <button onclick="openGpsModal('${doorId}',${gpsRange},${gpsLat},${gpsLng})" data-gps-door="${doorId}" style="background:rgba(0,212,255,0.1);border:1px solid rgba(0,212,255,0.2);border-radius:12px;padding:8px 4px;cursor:pointer;font-size:0.7rem;font-weight:700;color:var(--accent);font-family:Cairo,sans-serif">📡 ${gpsRange}م</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          <button onclick="openDoorLogs('${doorId}','${doorName}')" style="background:rgba(0,212,255,0.08);border:1px solid rgba(0,212,255,0.2);border-radius:12px;padding:10px 6px;cursor:pointer;font-family:Cairo,sans-serif;font-size:0.78rem;font-weight:700;color:var(--accent);display:flex;align-items:center;justify-content:center;gap:6px">📋 سجل الباب</button>
          <button onclick="openDoorSchedule('${doorId}','${doorName}',${schedData === '&quot;{}&quot;' ? '{}' : schedData})" style="background:rgba(255,179,0,0.08);border:1px solid rgba(255,179,0,0.2);border-radius:12px;padding:10px 6px;cursor:pointer;font-family:Cairo,sans-serif;font-size:0.78rem;font-weight:700;color:var(--warning);display:flex;align-items:center;justify-content:center;gap:6px">🕐 جدول الأوقات</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-size:0.72rem;font-weight:700;color:var(--muted)">🏢 GPS مسؤول</div>
              <div style="font-size:0.7rem;font-weight:700;margin-top:2px;color:${adminReq?'var(--success)':'var(--danger)'}">${adminReq?'ON':'OFF'}</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" ${adminReq?'checked':''} onchange="toggleDoorGps('${doorId}','admin_required',this.checked)">
              <span class="toggle-knob"></span>
            </label>
          </div>
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-size:0.72rem;font-weight:700;color:var(--muted)">📍 GPS مستخدمين</div>
              <div style="font-size:0.7rem;font-weight:700;margin-top:2px;color:${userReq?'var(--success)':'var(--danger)'}">${userReq?'ON':'OFF'}</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" ${userReq?'checked':''} onchange="toggleDoorGps('${doorId}','user_required',this.checked)">
              <span class="toggle-knob"></span>
            </label>
          </div>
        </div>
      </div>`;
  });

  container.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:20px;margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div>
          <div style="font-size:1.15rem;font-weight:800">🏫 ${inst.name}</div>
          <div style="font-family:JetBrains Mono,monospace;font-size:0.72rem;color:var(--warning);margin-top:3px">🔑 ${inst.code}</div>
        </div>
        <div style="display:flex;gap:6px">
          <button onclick="openInstSchedule('${inst.id}','${inst.name}',${JSON.stringify(inst.schedule||{}).replace(/"/g,'&quot;')})" class="door-action-btn dab-timer">🕐 جدول</button>
          <button onclick="editInst(${JSON.stringify(inst).replace(/"/g,'&quot;')})" class="door-action-btn dab-edit">✏️</button>
        </div>
      </div>
    </div>
    <div class="section-label" style="margin-bottom:8px">الأبواب (${(inst.doors||[]).length}):</div>
    ${doorsHtml}
    <button onclick="openAddDoor('${inst.id}')" style="margin-top:10px;width:100%;padding:12px;border-radius:12px;font-size:0.85rem;background:rgba(0,230,118,0.1);border:1px solid rgba(0,230,118,0.2);color:var(--success);font-family:Cairo,sans-serif;font-weight:700;cursor:pointer">
      + إضافة باب
    </button>`;

  setTimeout(function() {
    (inst.doors||[]).forEach(function(door) {
      checkDoorStatus(door.device_id, 'door-status-' + door.id);
    });
  }, 300);
}


function openAddInst() {
  document.getElementById('edit-inst-id').value = '';
  document.getElementById('inst-name').value = '';
  document.getElementById('inst-code').value = '';
  document.getElementById('inst-admin-phone').value = '';
  document.getElementById('inst-admin-pw').value = '';
  document.getElementById('inst-modal-title').textContent = 'إضافة مؤسسة';
  openModal('modal-inst');
}

function editInst(inst) {
  document.getElementById('edit-inst-id').value = inst.id;
  document.getElementById('inst-name').value = inst.name;
  document.getElementById('inst-code').value = inst.code;
  document.getElementById('inst-admin-phone').value = inst.admin_phone || '';
  document.getElementById('inst-admin-pw').value = '';
  document.getElementById('inst-modal-title').textContent = 'تعديل مؤسسة';
  openModal('modal-inst');
}

async function saveInstitute() {
  const id         = document.getElementById('edit-inst-id').value;
  const name       = document.getElementById('inst-name').value.trim();
  const code       = document.getElementById('inst-code').value.trim();
  const adminPhone = document.getElementById('inst-admin-phone').value.trim();
  const adminPw    = document.getElementById('inst-admin-pw').value;

  if (!name || !code) return toast('الاسم والكود مطلوبان', 'error');

  const body = { name, code };
  if (adminPhone) body.admin_phone = adminPhone;
  if (adminPw)    body.admin_pw    = adminPw;

  try {
    if (id) {
      await apiFetch('/api/institutes/' + id, 'PUT', body);
    } else {
      if (!adminPhone || !adminPw) return toast('هاتف وكلمة مرور المسؤول مطلوبان عند الإنشاء', 'error');
      await apiFetch('/api/institutes', 'POST', body);
    }
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

async function toggleDoorGps(doorId, key, value) {
  try {
    let doorGps = {};
    institutesCache.forEach(inst => {
      const door = (inst.doors||[]).find(d => d.id === doorId);
      if (door) doorGps = door.gps || {};
    });
    const gps = { ...doorGps, [key]: value };
    await apiFetch('/api/doors/' + doorId, 'PUT', { gps });
    // تحديث الكاش فقط بدون إعادة رندر
    institutesCache.forEach(inst => {
      (inst.doors||[]).forEach(door => {
        if (door.id === doorId) door.gps = gps;
      });
    });
    toast('تم التحديث', 'success');
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
const DAYS = ['الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت','الأحد'];
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

// ─── Institute Schedule ───────────────────────────────
let currentScheduleInstId = null;
let instSchedule = {};

function openInstSchedule(instId, instName, schedData) {
  currentScheduleInstId = instId;
  try { instSchedule = (schedData && typeof schedData === 'object') ? schedData : {}; }
  catch(e) { instSchedule = {}; }
  document.getElementById('inst-schedule-title').textContent = 'جدول: ' + instName;
  const grid = document.getElementById('inst-schedule-grid');
  const days = ['الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت','الأحد'];
  grid.innerHTML = days.map(function(day, i) {
    const d = instSchedule[i] || { enabled: false, start: '08:00', end: '18:00' };
    return '<div style="display:flex;align-items:center;gap:10px;background:var(--surface2);border-radius:12px;padding:12px 14px">' +
      '<span style="width:76px;font-weight:600;font-size:0.85rem">' + day + '</span>' +
      '<label class="day-toggle"><input type="checkbox" ' + (d.enabled?'checked':'') +
      ' onchange="instSchedule[' + i + ']={...(instSchedule[' + i + ']||{}),enabled:this.checked}"><span class="toggle-slider"></span></label>' +
      '<div style="display:flex;align-items:center;gap:6px;flex:1">' +
      '<input type="time" value="' + d.start + '" onchange="instSchedule[' + i + ']={...(instSchedule[' + i + ']||{}),start:this.value}" style="background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:5px 8px;font-size:0.8rem;font-family:JetBrains Mono;width:84px">' +
      '<span style="color:var(--muted)">→</span>' +
      '<input type="time" value="' + d.end + '" onchange="instSchedule[' + i + ']={...(instSchedule[' + i + ']||{}),end:this.value}" style="background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:5px 8px;font-size:0.8rem;font-family:JetBrains Mono;width:84px">' +
      '</div></div>';
  }).join('');
  openModal('modal-inst-schedule');
}

async function saveInstSchedule() {
  try {
    await apiFetch('/api/institutes/' + currentScheduleInstId, 'PUT', { schedule: instSchedule });
    closeModal('modal-inst-schedule');
    toast('تم حفظ جدول المؤسسة', 'success');
  } catch(e) { toast(e.message, 'error'); }
}

// ─── Theme Toggle ──────────────────────────────────────
function toggleTheme() {
  const html = document.documentElement;
  const isLight = html.getAttribute('data-theme') === 'light';
  if (isLight) {
    html.removeAttribute('data-theme');
    document.getElementById('theme-btn').textContent = '🌙';
    localStorage.setItem('porte_theme', 'dark');
  } else {
    html.setAttribute('data-theme', 'light');
    document.getElementById('theme-btn').textContent = '☀️';
    localStorage.setItem('porte_theme', 'light');
  }
}

// ─── Navigation ───────────────────────────────
function showPage(name, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = document.getElementById(`page-${name}`);
  if (page) page.classList.add('active');
  if (btn) btn.classList.add('active');

  if (name === 'dashboard')   { loadStats(); }
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
