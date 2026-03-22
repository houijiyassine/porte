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

  const roleBadge = document.getElementById('header-role-badge');
  const roleLabels = { user:'مستخدم', admin:'مدير', super_admin:'سوبر أدمن' };
  roleBadge.textContent = roleLabels[user.role] || user.role;
  roleBadge.className = 'role-badge ' +
    (user.role==='super_admin' ? 'role-super' : user.role==='admin' ? 'role-admin' : 'role-user');

  const pname = document.getElementById('profile-name');
  const prole = document.getElementById('profile-role');
  if (pname) pname.textContent = user.name;
  if (prole) prole.textContent = roleLabels[user.role];

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
  // إرسال fingerprint الجهاز
  setTimeout(function() {
    var fp = {
      ua:       navigator.userAgent,
      lang:     navigator.language,
      tz:       Intl.DateTimeFormat().resolvedOptions().timeZone,
      screen:   screen.width + 'x' + screen.height,
      platform: navigator.platform || '',
    };
    apiFetch('/api/device/fingerprint', 'POST', fp).catch(function(){});
  }, 2000);
  // أيقونة الثيم
  if (localStorage.getItem('porte_theme') === 'light') {
    const btn = document.getElementById('theme-btn');
    if (btn) btn.textContent = '☀️';
  }
  // توجيه حسب الدور
  if (user.role === 'super_admin') {
    var navAlerts = document.getElementById('nav-alerts');
    var navStats  = document.getElementById('nav-stats');
    if (navAlerts) navAlerts.style.display = 'flex';
    if (navStats)  navStats.style.display  = 'flex';
    showPage('institutes', document.getElementById('nav-institutes'));
  } else if (user.role === 'admin') {
    document.querySelectorAll('.nav-item').forEach(function(n){ n.style.display = 'none'; });
    document.getElementById('nav-institutes').style.display = 'flex';
    document.getElementById('nav-users').style.display = 'flex';
    var navAl = document.getElementById('nav-alerts');
    var navSt = document.getElementById('nav-stats');
    if (navAl) navAl.style.display = 'flex';
    if (navSt) navSt.style.display = 'flex';
    document.getElementById('nav-institutes').classList.add('active');
    document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
    document.getElementById('page-institutes').classList.add('active');
    loadAdminDoors();
    // إخفاء زر إضافة مؤسسة للمدير
    var addInstBtn = document.getElementById('inst-add-btn');
    if (addInstBtn) addInstBtn.style.display = 'none';
  } else {
    document.querySelectorAll('.nav-item').forEach(function(n){ n.style.display = 'none'; });
    document.getElementById('nav-institutes').style.display = 'flex';
    document.getElementById('nav-institutes').classList.add('active');
    document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
    document.getElementById('page-institutes').classList.add('active');
    startUserLocationTracking();
    // إخفاء عناصر غير ضرورية للمستخدم
    var addBtn = document.getElementById('inst-add-btn');
    if (addBtn) addBtn.style.display = 'none';
    var pageTitle = document.querySelector('#page-institutes .page-title');
    if (pageTitle) pageTitle.style.display = 'none';
    loadUserDoors();
  }
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
      // تحديث حالة الباب من Polling أو Webhook (RC أو App)
      if (msg.type === 'door_state') {
        var r1 = msg.r1_on, r2 = msg.r2_on;
        var rawState = r1 ? 'open' : r2 ? 'close' : 'idle';
        var doorId   = msg.doorId;
        var imgEl    = document.getElementById('door-img-'      + doorId);
        var stateEl  = document.getElementById('user-state-'    + doorId)
                    || document.getElementById('door-progress-' + doorId);
        var hasTimer = !!doorTimers[doorId];

        updateDoorStatusUI(rawState);

        // ─── منطق التايمر والحالات ───
        var curTimer    = doorTimers[doorId];  // موجود = شغال
        var timerAction = null; // لا نحتاجه بعد الآن

        if (rawState === 'idle') {
          if (hasTimer) {
            // تايمر شغال → أوقفه (إيقاف مبكر من RC أو يدوي)
            stopDoorTimer(doorId, imgEl, stateEl);
            updateDoorCardState(doorId, msg.deviceId, 'idle', msg.source);
          }
          // لا تايمر → idle عابر من Tuya — نتجاهل (الصورة تبقى على lastKnownState)

        } else {
          // open أو close جديد


          var newImgEl   = document.getElementById('door-img-'      + doorId);
          var newStateEl = document.getElementById('user-state-'    + doorId)
                        || document.getElementById('door-progress-' + doorId);
          var durEl   = document.querySelector('[data-door-id="' + doorId + '"]');
          var newSecs = durEl ? parseInt(durEl.getAttribute('data-duration') || '5') : 5;

          if (msg.source === 'rc') {
            lastKnownState[doorId] = rawState;
            startDoorTimer(doorId, newImgEl, newStateEl, newSecs, rawState);
            updateDoorCardState(doorId, msg.deviceId, rawState, 'rc');
          } else if (!hasTimer) {
            if (rawState !== 'idle') lastKnownState[doorId] = rawState;
            startDoorTimer(doorId, newImgEl, newStateEl, newSecs, rawState);
            updateDoorCardState(doorId, msg.deviceId, rawState, msg.source);
          }
          // source=app + تايمر شغال → App يتحكم، لا نتدخل
        }

        // تحديث السجل إذا جاء من RC
        if (msg.source === 'rc') {
          setTimeout(loadRecentHistory, 500);
          var logsTitle = document.getElementById('door-logs-title');
          if (logsTitle && window._openDoorLogsId === doorId) {
            setTimeout(function() { openDoorLogs(doorId, logsTitle.textContent.replace('📋 ','')); }, 600);
          }
        }
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
  const labels = { open:'مفتوح', opened:'مفتوح', close:'مغلق', closed:'مغلق', stop:'متوقف', idle:'متوقف', unknown:'غير معروف' };
  txt.textContent = labels[state] || state;
}

// تحديث بطاقة الباب في صفحة المؤسسات/الأدمن عبر WebSocket
function updateDoorCardState(doorId, deviceId, state, source) {
  // badge الحالة في بطاقة أدمن
  var statusEl = document.getElementById('door-status-' + doorId);
  if (statusEl) {
    var label  = state==='open' ? 'مفتوح' : state==='close' ? 'مغلق' : 'متوقف';
    var color  = state==='open' ? 'rgba(0,230,118,0.15)' : state==='close' ? 'rgba(255,61,113,0.15)' : 'rgba(255,179,0,0.15)';
    var tcolor = state==='open' ? 'var(--success)' : state==='close' ? 'var(--danger)' : 'var(--warning)';
    var icon   = state==='open' ? '🔓' : state==='close' ? '🔒' : '⏹';
    statusEl.innerHTML = icon + ' ' + label + (source==='rc' ? ' <span style="font-size:0.62rem;opacity:0.7">RC</span>' : '');
    statusEl.style.cssText = 'font-size:0.7rem;font-weight:700;padding:3px 10px;border-radius:20px;background:' + color + ';color:' + tcolor + ';border:1px solid ' + tcolor + '33';
  }
  // badge الحالة في بطاقة أدمن (adm-status-)
  var admEl = document.getElementById('adm-status-' + doorId);
  if (admEl) {
    var label  = state==='open' ? 'مفتوح' : state==='close' ? 'مغلق' : 'متوقف';
    var color  = state==='open' ? 'rgba(0,230,118,0.15)' : state==='close' ? 'rgba(255,61,113,0.15)' : 'rgba(255,179,0,0.15)';
    var tcolor = state==='open' ? 'var(--success)' : state==='close' ? 'var(--danger)' : 'var(--warning)';
    admEl.textContent = label;
    admEl.style.cssText = 'font-size:0.7rem;font-weight:700;padding:3px 10px;border-radius:20px;background:' + color + ';color:' + tcolor;
  }
}

// تحديث صورة/أيقونة الباب بناءً على حالته
function updateDoorImage(doorId, state) {
  var imgEl = document.getElementById('door-img-' + doorId);
  if (!imgEl) return;
  imgEl.setAttribute('data-state', state);
  renderDoorSVG(imgEl, state);
}

// ─── Door Control ─────────────────────────────
let timerInterval = null;

// ═══════════════════════════════════════════════════════
//  doorPos[doorId] = 0.0→1.0 (موضع الباب الحالي)
//  0.0 = مغلق تماماً | 1.0 = مفتوح تماماً
//  عند فتح: pos تزيد من pos_حالي إلى 1.0
//  عند غلق: pos تنقص من pos_حالي إلى 0.0
//  عند إيقاف: pos تتجمد حيث هي
// ═══════════════════════════════════════════════════════
const doorPos         = {};  // doorPos[doorId]    = موضع الباب (0→1)
const doorTimers      = {};  // doorTimers[doorId] = { _raf }
const lastKnownState  = {};  // lastKnownState[doorId] = 'open'|'close' — آخر حالة حقيقية

function startDoorTimer(doorId, imgEl, stateEl, seconds, action) {
  // أوقف أي أنيميشن سابق
  if (doorTimers[doorId] && doorTimers[doorId]._raf) {
    cancelAnimationFrame(doorTimers[doorId]._raf);
  }

  var isOpen   = (action === 'open' || action === 'open40');
  var total    = Math.max((seconds - 1.3), 0.5) * 1000;
  var fromPos  = doorPos[doorId] !== undefined ? doorPos[doorId] : (isOpen ? 0 : 1);
  var toPos    = isOpen ? 1.0 : 0.0;
  var dist     = Math.abs(toPos - fromPos);  // المسافة المتبقية
  var duration = total * dist;               // الوقت بناءً على المسافة
  var startTime = Date.now();

  if (dist <= 0.01) return; // وصل بالفعل

  doorTimers[doorId] = { _raf: null };

  function tick() {
    var elapsed = Date.now() - startTime;
    var progress = duration > 0 ? Math.min(elapsed / duration, 1) : 1;
    // الموضع الحالي
    var curPos = fromPos + (toPos - fromPos) * progress;
    doorPos[doorId] = curPos;

    // النسبة للعرض: دائماً من منظور الحركة الحالية (0→100%)
    var displayPct = progress;
    _drawDoorProgress(imgEl, stateEl, displayPct, isOpen, false, curPos);

    if (progress < 1) {
      doorTimers[doorId]._raf = requestAnimationFrame(tick);
    } else {
      doorPos[doorId] = toPos;
      delete doorTimers[doorId];
      var finalState = isOpen ? 'open' : 'close';
      lastKnownState[doorId] = finalState;
      setTimeout(function() {
        _drawDoorStatic(imgEl, stateEl, finalState);
        updateDoorCardState(doorId, null, finalState, 'auto');
      }, 400);
    }
  }

  doorTimers[doorId]._raf = requestAnimationFrame(tick);
}

function stopDoorTimer(doorId, imgEl, stateEl) {
  if (doorTimers[doorId] && doorTimers[doorId]._raf) {
    cancelAnimationFrame(doorTimers[doorId]._raf);
  }
  delete doorTimers[doorId];
  // doorPos[doorId] يبقى كما هو — التجميد في مكانه
  var pos = doorPos[doorId] !== undefined ? doorPos[doorId] : 0;
  _drawDoorProgress(imgEl, stateEl, pos, pos >= 0.5, true, pos);
}

function _cancelDoorTimer(doorId) {
  if (doorTimers[doorId] && doorTimers[doorId]._raf) {
    cancelAnimationFrame(doorTimers[doorId]._raf);
  }
  delete doorTimers[doorId];
  // doorPos يبقى محفوظاً
}

// ─── رسم الباب أثناء الحركة ──────────────────
function _drawDoorProgress(imgEl, stateEl, pct, isOpen, isStopped, curPos) {
  var pctInt = Math.round(pct * 100);
  var color  = isStopped ? '#ffb300' : isOpen ? '#00e676' : '#ff3d71';
  var statusTxt = isStopped ? ('⏹ متوقف — ' + pctInt + '%')
                : isOpen    ? ('🔓 يفتح... — ' + pctInt + '%')
                :             ('🔒 يغلق... — ' + pctInt + '%');
  var label = isStopped ? 'متوقف' : isOpen ? 'يفتح...' : 'يغلق...';

  // زاوية الباب بناءً على doorPos (0=مغلق، 1=مفتوح)
  var pos      = (curPos !== undefined) ? curPos : (isOpen ? pct : 1 - pct);
  var angleDeg = -(pos * 55);
  var handleX  = 22 + (pos * 36);
  var arcPath  = pct > 0.005 ? _describeArc(40, 86, 10, 0, pct * 359.99) : '';

  if (imgEl) {
    imgEl.innerHTML =
      '<svg viewBox="0 0 80 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">' +
      '<rect x="4" y="2" width="72" height="78" rx="5" fill="none" stroke="' + color + '" stroke-width="1.8" opacity="0.3"/>' +
      '<g style="transform:rotate(' + angleDeg.toFixed(2) + 'deg);transform-origin:8px 41px">' +
        '<rect x="8" y="4" width="62" height="74" rx="3" fill="' + color + '" fill-opacity="0.15" stroke="' + color + '" stroke-width="1.6"/>' +
        '<circle cx="' + handleX.toFixed(1) + '" cy="41" r="3.2" fill="' + color + '" opacity="0.95"/>' +
      '</g>' +
      (arcPath
        ? '<circle cx="40" cy="86" r="10" fill="none" stroke="' + color + '33" stroke-width="3"/>' +
          '<path d="' + arcPath + '" fill="none" stroke="' + color + '" stroke-width="3" stroke-linecap="round"/>'
        : '') +
      '<text x="40" y="97" text-anchor="middle" font-size="7.5" fill="' + color + '" font-family="Cairo,sans-serif" font-weight="700">' + pctInt + '%</text>' +
      '</svg>';
  }

  if (stateEl) {
    stateEl.style.color = color;
    stateEl.style.background = 'var(--surface2)';
    stateEl.innerHTML =
      '<div style="flex:1">' +
        '<div style="font-size:0.85rem;font-weight:700;margin-bottom:5px">' + statusTxt + '</div>' +
        '<div style="height:5px;border-radius:3px;background:rgba(255,255,255,0.08);overflow:hidden">' +
          '<div style="height:100%;width:' + pctInt + '%;background:' + color + ';border-radius:3px"></div>' +
        '</div>' +
      '</div>';
  }
}

// ─── رسم الباب في حالة ثابتة ─────────────────
function _drawDoorStatic(imgEl, stateEl, state) {
  var color    = state === 'open' ? '#00e676' : state === 'close' ? '#ff3d71' : '#ffb300';
  var angleDeg = state === 'open' ? -55 : state === 'idle' ? -27 : 0;
  var handleX  = state === 'open' ? 58 : state === 'idle' ? 40 : 22;
  var label    = state === 'open' ? 'مفتوح' : state === 'close' ? 'مغلق' : 'متوقف';
  var icon     = state === 'open' ? '🔓' : state === 'close' ? '🔒' : '⏹';

  if (imgEl) {
    imgEl.innerHTML =
      '<svg viewBox="0 0 80 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">' +
      '<rect x="4" y="2" width="72" height="78" rx="5" fill="none" stroke="' + color + '" stroke-width="1.8" opacity="0.3"/>' +
      '<g style="transform:rotate(' + angleDeg + 'deg);transform-origin:8px 41px">' +
        '<rect x="8" y="4" width="62" height="74" rx="3" fill="' + color + '" fill-opacity="0.18" stroke="' + color + '" stroke-width="1.6"/>' +
        '<circle cx="' + handleX + '" cy="41" r="3.2" fill="' + color + '" opacity="0.95"/>' +
      '</g>' +
      '<text x="40" y="97" text-anchor="middle" font-size="7.5" fill="' + color + '" font-family="Cairo,sans-serif" font-weight="700">' + label + '</text>' +
      '</svg>';
  }

  if (stateEl) {
    stateEl.style.color = color;
    stateEl.style.background = 'var(--surface2)';
    stateEl.innerHTML = icon + ' ' + label;
  }
}

// ─── renderDoorSVG (alias للحالة الثابتة) ────
function renderDoorSVG(container, state) {
  _drawDoorStatic(container, null, state);
}

function _updateStateEl(el, state) {
  _drawDoorStatic(null, el, state);
}

// ─── قوس SVG ──────────────────────────────────
function _describeArc(cx, cy, r, startDeg, endDeg) {
  if (endDeg >= 360) endDeg = 359.99;
  function polar(deg) {
    var rad = (deg - 90) * Math.PI / 180;
    return { x: (cx + r * Math.cos(rad)).toFixed(2), y: (cy + r * Math.sin(rad)).toFixed(2) };
  }
  var s = polar(startDeg), e = polar(endDeg);
  var large = endDeg > 180 ? 1 : 0;
  return 'M ' + s.x + ' ' + s.y + ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + e.x + ' ' + e.y;
}
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

// إرسال أمر لباب محدد من صفحة المؤسسات (أدمن)
async function sendDoorAction(deviceId, action, duration) {
  try {
    var body = { action, deviceId, duration };
    if (userLocation) { body.lat = userLocation.lat; body.lng = userLocation.lng; body.accuracy = userLocation.accuracy || 999; }
    await apiFetch('/api/door/control', 'POST', body);
    var labels = { open:'✅ تم الفتح', close:'✅ تم الغلق', stop:'✅ تم الإيقاف', open40:'✅ فتح 40 ثانية' };
    toast(labels[action] || '✅ تم', 'success');
    // تشغيل التايمر على الباب المناسب
    var doorId = _findDoorIdByDeviceId(deviceId);
    if (doorId) {
      var imgEl   = document.getElementById('door-img-'      + doorId);
      var stateEl = document.getElementById('user-state-'    + doorId)
                 || document.getElementById('door-progress-' + doorId);
      var secs    = (action === 'stop') ? 0 : (action === 'open40' ? 40 : (duration || 5));
      if (action === 'stop') {
        stopDoorTimer(doorId, imgEl, stateEl);
        updateDoorCardState(doorId, deviceId, 'idle', 'app');
      } else {
        lastKnownState[doorId] = (action === 'open' || action === 'open40') ? 'open' : 'close';
        startDoorTimer(doorId, imgEl, stateEl, secs, action);
      }
    }
  } catch(e) {
    toast(e.message || 'خطأ في الاتصال', 'error');
  }
}

// إيجاد doorId من deviceId (من الكاش)
function _findDoorIdByDeviceId(deviceId) {
  // البحث في كل عناصر door-img التي لديها data-device-id
  var allImgs = document.querySelectorAll('[data-device-id]');
  for (var i = 0; i < allImgs.length; i++) {
    if (allImgs[i].getAttribute('data-device-id') === deviceId) {
      // نأخذ data-door-id أو نستخرجه من id="door-img-XXXX"
      var did = allImgs[i].getAttribute('data-door-id') || allImgs[i].id.replace('door-img-', '');
      if (did) return did;
    }
  }
  return null;
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
// (see full loadStats below)

// ─── Users ────────────────────────────────────
async function loadUsers() {
  if (user && user.role === 'super_admin') {
    await loadUsersForSuperAdmin();
    return;
  }
  if (user && user.role === 'admin') {
    await loadAdminUsers();
    return;
  }
  try {
    const data = await apiFetch('/api/users');
    usersCache = (data || []).filter(function(u){ return u.role !== 'super_admin'; });
    renderUsersTable(usersCache);
  } catch {}
}

async function loadUsersForSuperAdmin() {
  const container = document.getElementById('users-list-super');
  const tableSection = document.getElementById('users-table-section');
  if (!container) return;

  // إظهار القائمة وإخفاء الجدول
  container.style.display = 'block';
  if (tableSection) tableSection.style.display = 'none';

  container.innerHTML = '<p style="color:var(--muted);text-align:center;padding:30px">⏳ جاري التحميل...</p>';
  try {
    const insts = await apiFetch('/api/institutes');
    if (!insts.length) {
      container.innerHTML = '<p style="color:var(--muted);text-align:center;padding:30px">لا توجد مؤسسات</p>';
      return;
    }
    container.innerHTML = '';
    insts.forEach(function(inst) {
      var card = document.createElement('div');
      card.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:16px;margin-bottom:12px;cursor:pointer;transition:border-color 0.2s';
      card.onmouseenter = function() { card.style.borderColor = 'rgba(0,212,255,0.3)'; };
      card.onmouseleave = function() { card.style.borderColor = 'var(--border)'; };

      var usersCount = inst.users_count || 0;
      card.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between">' +
          '<div>' +
            '<div style="font-weight:800;font-size:0.95rem">🏫 ' + inst.name + '</div>' +
            '<div style="font-family:JetBrains Mono,monospace;font-size:0.72rem;color:var(--warning);margin-top:3px">🔑 ' + inst.code + '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            '<div style="text-align:center">' +
              '<div style="font-size:1.3rem;font-weight:900;color:var(--success)">' + usersCount + '</div>' +
              '<div style="font-size:0.68rem;color:var(--muted)">مستخدم</div>' +
            '</div>' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" style="color:var(--muted)"><polyline points="9 18 15 12 9 6"/></svg>' +
          '</div>' +
        '</div>';

      card.addEventListener('click', function() {
        openInstUsers(inst.id, inst.name);
      });
      container.appendChild(card);
    });
  } catch(e) {
    container.innerHTML = '<p style="color:var(--danger);text-align:center;padding:30px">' + e.message + '</p>';
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById('users-tbody');
  const roleLabels = { user:'مستخدم', admin:'مدير', super_admin:'سوبر أدمن' };
  const filtered = users.filter(function(u){ return u.role !== 'super_admin'; });
  tbody.innerHTML = filtered.map(u => `
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
  // انتظر حتى يكون institutes-list موجوداً وظاهراً
  const container = await waitForElement('institutes-list');
  if (!container) return;
  try {
    const data = await apiFetch('/api/institutes');
    institutesCache = data || [];
    renderInstitutes(data);
  } catch(e) {
    console.error('[loadInstitutes]', e);
    container.innerHTML = '<p style="color:var(--danger);text-align:center;padding:40px 0">❌ ' + e.message + '</p>';
  }
}

function waitForElement(id, timeout) {
  return new Promise(function(resolve) {
    var el = document.getElementById(id);
    if (el) { resolve(el); return; }
    var t = 0;
    var interval = setInterval(function() {
      el = document.getElementById(id);
      t += 50;
      if (el) { clearInterval(interval); resolve(el); }
      else if (t > (timeout || 3000)) { clearInterval(interval); resolve(null); }
    }, 50);
  });
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
    el.textContent = online ? '🟢 متصل' : '🔴 غير متصل';
    el.style.color = online ? 'var(--success)' : 'var(--danger)';
    el.style.background = online ? 'rgba(0,230,118,0.1)' : 'rgba(255,61,113,0.1)';
  } catch {
    el.textContent = '🔴 غير متصل';
    el.style.color = 'var(--danger)';
    el.style.background = 'rgba(255,61,113,0.1)';
  }
}

// جلب حالة الباب الحقيقية (مفتوح/مغلق/متوقف) وتحديث الصورة والـ badge
async function fetchAndUpdateDoorImage(door) {
  var imgEl = document.getElementById('door-img-' + door.id);
  if (imgEl && !imgEl.innerHTML) {
    imgEl.innerHTML = '<svg viewBox="0 0 80 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;opacity:0.3"><rect x="4" y="2" width="72" height="78" rx="5" fill="none" stroke="#8892b0" stroke-width="1.8"/><rect x="8" y="4" width="62" height="74" rx="3" fill="#8892b0" fill-opacity="0.1" stroke="#8892b0" stroke-width="1.6"/><text x="40" y="97" text-anchor="middle" font-size="7" fill="#8892b0" font-family="Cairo,sans-serif">...</text></svg>';
  }
  try {
    // إذا lastKnownState فارغ → جلب آخر سجل من قاعدة البيانات
    if (!lastKnownState[door.id]) {
      try {
        var logs = await apiFetch('/api/doors/' + door.id + '/logs');
        if (logs && logs.length > 0) {
          var lastVal = logs[0].value;
          if (lastVal === 'open' || lastVal === 'open40') lastKnownState[door.id] = 'open';
          else if (lastVal === 'close') lastKnownState[door.id] = 'close';
        }
      } catch(e) {}
    }

    var data  = await apiFetch('/api/door/status?deviceId=' + door.device_id);
    var state = data.r1_on ? 'open' : data.r2_on ? 'close' : 'idle';
    imgEl = document.getElementById('door-img-' + door.id);

    if (doorTimers[door.id]) return;

    // idle من Tuya = ريلاي في وضعه الطبيعي، ليس "متوقف"
    if (state === 'idle') {
      state = lastKnownState[door.id] || 'close'; // افتراضي: مغلق
    } else {
      lastKnownState[door.id] = state; // حدّث الحالة المعروفة
    }

    if (imgEl) _drawDoorStatic(imgEl, null, state);
    updateDoorCardState(door.id, door.device_id, state, 'poll');
  } catch(e) {}
}

// ─── Door Logs ────────────────────────────────────────
async function openDoorLogs(doorId, doorName) {
  document.getElementById('door-logs-title').textContent = '📋 ' + doorName;
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
  if (!container) return;
  if (!insts || !insts.length) {
    container.innerHTML = '<p style="color:var(--muted);text-align:center;padding:40px 0">لا توجد مؤسسات</p>';
    return;
  }

  container.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;gap:12px';

  insts.forEach(function(inst) {
    const doorsCount = (inst.doors || []).length;
    const usersCount = inst.users_count || 0;

    const card = document.createElement('div');
    card.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:20px;cursor:pointer;transition:border-color 0.2s;position:relative;overflow:hidden';

    // الخط الجانبي
    const line = document.createElement('div');
    line.style.cssText = 'position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(180deg,var(--accent),var(--accent2));border-radius:0 3px 3px 0';
    card.appendChild(line);

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px';

    const nameDiv = document.createElement('div');
    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-size:1.1rem;font-weight:800';
    nameEl.textContent = '🏫 ' + inst.name;
    const codeEl = document.createElement('div');
    codeEl.style.cssText = 'font-family:JetBrains Mono,monospace;font-size:0.72rem;color:var(--warning);margin-top:4px';
    codeEl.textContent = '🔑 ' + inst.code;
    nameDiv.appendChild(nameEl);
    nameDiv.appendChild(codeEl);

    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:6px';

    const btnSched = document.createElement('button');
    btnSched.className = 'door-action-btn dab-timer';
    btnSched.style.cssText = 'padding:6px 10px';
    btnSched.textContent = '🕐';
    btnSched.onclick = function(e) {
      e.stopPropagation();
      openInstSchedule(inst.id, inst.name, inst.schedule || {});
    };

    const btnEdit = document.createElement('button');
    btnEdit.className = 'door-action-btn dab-edit';
    btnEdit.style.cssText = 'padding:6px 10px';
    btnEdit.textContent = '✏️';
    btnEdit.onclick = function(e) {
      e.stopPropagation();
      editInst(inst);
    };

    const btnDel = document.createElement('button');
    btnDel.className = 'door-action-btn dab-del';
    btnDel.style.cssText = 'padding:6px 10px';
    btnDel.textContent = '🗑';
    btnDel.onclick = function(e) {
      e.stopPropagation();
      deleteInst(inst.id);
    };

    const btnUsers = document.createElement('button');
    btnUsers.className = 'door-action-btn dab-timer';
    btnUsers.style.cssText = 'padding:6px 10px';
    btnUsers.textContent = '👥';
    btnUsers.title = 'مستخدمو المؤسسة';
    btnUsers.onclick = function(e) {
      e.stopPropagation();
      openInstUsers(inst.id, inst.name);
    };

    btns.appendChild(btnUsers);
    btns.appendChild(btnSched);
    btns.appendChild(btnEdit);
    btns.appendChild(btnDel);
    header.appendChild(nameDiv);
    header.appendChild(btns);
    card.appendChild(header);

    // Stats
    const stats = document.createElement('div');
    stats.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px';

    [[doorsCount, '🚪 أبواب', 'var(--accent)'],
     [usersCount, '👥 مستخدمون', 'var(--success)'],
     ["<span id='enligne-" + inst.id + "'>0/" + doorsCount + "</span>", '📡 En ligne', 'var(--warning)']
    ].forEach(function(item) {
      const s = document.createElement('div');
      s.style.cssText = 'background:var(--surface2);border-radius:10px;padding:10px;text-align:center';
      s.innerHTML = '<div style="font-size:1.4rem;font-weight:900;font-family:JetBrains Mono;color:' + item[2] + '">' + item[0] + '</div><div style="font-size:0.7rem;color:var(--muted);margin-top:2px">' + item[1] + '</div>';
      stats.appendChild(s);
    });

    card.appendChild(stats);

    // Click → open detail
    card.addEventListener('click', function() {
      selectInstitute(inst.id);
    });

    wrapper.appendChild(card);

    // جلب حالة كل باب مباشرة
    (function(instRef) {
      var doors = instRef.doors || [];
      var total = doors.length;
      if (!total) return;
      doors.forEach(function(door) {
        apiFetch('/api/device/status/' + door.device_id)
          .then(function(data) {
            doorStatusCache[door.device_id] = data.online === true;
            var el = document.getElementById('enligne-' + instRef.id);
            if (el) {
              var count = doors.filter(function(d) {
                return doorStatusCache[d.device_id] === true;
              }).length;
              el.textContent = count + '/' + total;
            }
          })
          .catch(function() {
            doorStatusCache[door.device_id] = false;
          });
      });
    })(inst);
  });

  container.appendChild(wrapper);
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
  var titleEl = document.getElementById('inst-page-title');
  var backBtn = document.getElementById('inst-back-btn');
  var addBtn  = document.getElementById('inst-add-btn');
  if (titleEl) titleEl.innerHTML = 'ال<span style="color:var(--accent)">مؤسسات</span>';
  if (backBtn) backBtn.style.display = 'none';
  if (addBtn)  addBtn.style.display  = 'flex';
  renderInstitutes(institutesCache);
}

function renderInstDetail(inst) {
  const isSuperAdmin = user && user.role === 'super_admin';
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
      <div data-door-id="${doorId}" data-duration="${duration}" style="background:rgba(0,230,118,0.04);border:1px solid rgba(0,230,118,0.2);border-radius:16px;padding:14px;margin-bottom:4px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:6px">
          <div style="display:flex;align-items:center;gap:12px;flex:1">
            <!-- صورة الباب -->
            <div id="door-img-${doorId}" data-state="idle" data-device-id="${deviceId}" data-door-id="${doorId}" style="width:52px;height:64px;flex-shrink:0"></div>
            <div style="flex:1">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px">
                <div style="font-weight:800;font-size:0.95rem">🚪 ${doorName}</div>
                <span id="door-status-${doorId}" style="font-size:0.7rem;font-weight:700;padding:3px 10px;border-radius:20px;background:var(--surface);color:var(--muted)">...</span>
              </div>
              <div style="font-family:JetBrains Mono,monospace;font-size:0.68rem;color:var(--muted);margin-bottom:6px">ID: ${deviceId.substring(0,16)}...</div>
              <!-- progress bar الأدمن -->
              <div id="door-progress-${doorId}" style="font-size:0.8rem;color:var(--muted)"></div>
            </div>
          </div>
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
        <div style="display:grid;grid-template-columns:${isSuperAdmin ? '1fr 1fr' : '1fr'};gap:8px">
          ${isSuperAdmin ? `
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-size:0.72rem;font-weight:700;color:var(--muted)">🏢 GPS مسؤول</div>
              <div style="font-size:0.7rem;font-weight:700;margin-top:2px;color:${adminReq?'var(--success)':'var(--danger)'}">${adminReq?'ON':'OFF'}</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" ${adminReq?'checked':''} onchange="toggleDoorGps('${doorId}','admin_required',this.checked)">
              <span class="toggle-knob"></span>
            </label>
          </div>` : ''}
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
      // رسم صورة الباب الأولية
      // جلب الحالة الحقيقية من Tuya مباشرة (بدون idle مؤقت)
      fetchAndUpdateDoorImage(door);
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


// ─── Institute Users ──────────────────────────────────
async function openInstUsers(instId, instName) {
  document.getElementById('inst-users-title').textContent = 'مستخدمو: ' + instName;
  document.getElementById('inst-users-body').innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px">جاري التحميل...</p>';
  openModal('modal-inst-users');
  try {
    const data = await apiFetch('/api/users?inst_id=' + instId);
    const filtered = (data||[]).filter(function(u) { return u.role !== 'super_admin'; });
    const body = document.getElementById('inst-users-body');
    if (!filtered.length) {
      body.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px">لا يوجد مستخدمون</p>';
      return;
    }
    body.innerHTML = '';
    filtered.forEach(function(u) {
      var status = u.request_status || 'approved';
      var statusLabel = { pending:'انتظار', approved:'موافق', rejected:'مرفوض' }[status] || status;
      var statusColor = { pending:'var(--warning)', approved:'var(--success)', rejected:'var(--danger)' }[status] || 'var(--muted)';
      var roleLabel = { user:'مستخدم', admin:'مدير' }[u.role] || u.role;
      var card = document.createElement('div');
      card.style.cssText = 'background:var(--surface2);border-radius:12px;padding:14px;margin-bottom:10px';
      // Header
      var header = document.createElement('div');
      header.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px';
      header.innerHTML =
        '<div>' +
          '<div style="font-weight:700">' + u.name + '</div>' +
          '<div style="font-family:JetBrains Mono,monospace;font-size:0.78rem;color:var(--muted)">' + u.phone + '</div>' +
          '<div style="font-size:0.72rem;color:var(--accent2)">' + roleLabel + '</div>' +
        '</div>' +
        '<span style="font-size:0.72rem;font-weight:700;padding:3px 10px;border-radius:20px;background:rgba(0,0,0,0.2);color:' + statusColor + '">' + statusLabel + '</span>';
      card.appendChild(header);
      // Buttons
      var btns = document.createElement('div');
      btns.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
      [
        ['موافقة', 'approved', 'rgba(0,230,118,0.15)', 'var(--success)', 'flex:1'],
        ['انتظار', 'pending', 'rgba(255,179,0,0.15)', 'var(--warning)', 'flex:1'],
        ['رفض', 'rejected', 'rgba(255,61,113,0.15)', 'var(--danger)', 'flex:1'],
      ].forEach(function(item) {
        var btn = document.createElement('button');
        btn.style.cssText = item[4] + ';padding:7px;border-radius:8px;border:none;background:' + item[2] + ';color:' + item[3] + ';font-family:Cairo,sans-serif;font-size:0.75rem;font-weight:700;cursor:pointer';
        btn.textContent = item[0];
        btn.addEventListener('click', (function(uid, st, iid) {
          return function() { changeUserStatus(uid, st, iid, instName); };
        })(u.id, item[1], instId));
        btns.appendChild(btn);
      });
      // Reset pw button
      var btnPw = document.createElement('button');
      btnPw.style.cssText = 'padding:7px 10px;border-radius:8px;border:none;background:rgba(124,92,252,0.15);color:var(--accent2);font-family:Cairo,sans-serif;font-size:0.75rem;font-weight:700;cursor:pointer';
      btnPw.textContent = '🔑';
      btnPw.addEventListener('click', (function(uid, uname) { return function() { resetUserPw(uid, uname); }; })(u.id, u.name));
      btns.appendChild(btnPw);
      // Delete button
      var btnDel = document.createElement('button');
      btnDel.style.cssText = 'padding:7px 10px;border-radius:8px;border:none;background:rgba(255,61,113,0.1);color:var(--danger);font-family:Cairo,sans-serif;font-size:0.75rem;font-weight:700;cursor:pointer';
      btnDel.textContent = '🗑';
      btnDel.addEventListener('click', (function(uid, iid) { return function() { deleteUser(uid, iid, instName); }; })(u.id, instId));
      btns.appendChild(btnDel);
      card.appendChild(btns);
      body.appendChild(card);
    });
  } catch(e) {
    document.getElementById('inst-users-body').innerHTML = '<p style="color:var(--danger);text-align:center;padding:20px">' + e.message + '</p>';
  }
}

async function changeUserStatus(userId, status, instId, instName) {
  try {
    await apiFetch('/api/users/' + userId, 'PUT', { request_status: status });
    var labels = { approved:'موافق', pending:'انتظار', rejected:'مرفوض' };
    toast(labels[status] || status, 'success');
    openInstUsers(instId, instName);
  } catch(e) { toast(e.message, 'error'); }
}

async function resetUserPw(userId, userName) {
  // عرض كلمة المرور الحالية للسوبر أدمن
  if (user && user.role === 'super_admin') {
    try {
      var pwData = await apiFetch('/api/users/' + userId + '/pw');
      if (pwData.pw) {
        var action = confirm(
          '👤 ' + (pwData.name || userName) + '\n' +
          '🔑 كلمة المرور الحالية: ' + pwData.pw + '\n\n' +
          'هل تريد تغييرها؟'
        );
        if (!action) return;
      } else {
        // pw_plain فارغ — المستخدم أُنشئ قبل التشفير
        var cont = confirm(
          '👤 ' + (pwData.name || userName) + '\n' +
          '⚠️ كلمة المرور القديمة غير متوفرة\n(أُنشئ الحساب قبل تفعيل التشفير)\n\n' +
          'هل تريد تعيين كلمة مرور جديدة؟'
        );
        if (!cont) return;
      }
    } catch(e) {}
  }
  var pw = prompt('كلمة المرور الجديدة لـ ' + (userName||'المستخدم') + ':');
  if (!pw || pw.trim() === '') return;
  try {
    await apiFetch('/api/users/' + userId, 'PUT', { pw: pw.trim() });
    toast('✅ تم تغيير كلمة المرور', 'success');
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteUser(userId, instId, instName) {
  if (!confirm('هل تريد حذف المستخدم؟')) return;
  try {
    await apiFetch('/api/users/' + userId, 'DELETE');
    toast('تم الحذف', 'success');
    openInstUsers(instId, instName || '');
  } catch(e) { toast(e.message, 'error'); }
}



// ─── User Interface ────────────────────────────────────
let userLocation = null;
let userLocationWatcher = null;

function startUserLocationTracking() {
  if (!navigator.geolocation) return;

  function sendLocation() {
    var t = Date.now();
    navigator.geolocation.getCurrentPosition(
      function(pos) {
        userLocation = {
          lat: pos.coords.latitude, lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy, altitude: pos.coords.altitude,
          altAccuracy: pos.coords.altitudeAccuracy,
          responseTime: Date.now() - t,
        };
        if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'location', coords: userLocation }));
        updateAllGpsBadges();
      },
      function() {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 }
    );
  }

  // أول مرة عند فتح التطبيق
  sendLocation();

  // كل 5 دقائق طالما التطبيق مفتوح
  setInterval(sendLocation, 5 * 60 * 1000);
}

// جلب الموقع عند الضغط على زر — دقة عالية لمرة واحدة
function getUserLocationOnDemand(callback) {
  if (!navigator.geolocation) { callback(null); return; }
  var requestTime = Date.now();
  navigator.geolocation.getCurrentPosition(
    function(pos) {
      var responseTime = Date.now() - requestTime; // زمن الاستجابة
      userLocation = {
        lat:          pos.coords.latitude,
        lng:          pos.coords.longitude,
        accuracy:     pos.coords.accuracy,
        altitude:     pos.coords.altitude,
        altAccuracy:  pos.coords.altitudeAccuracy,
        responseTime: responseTime,
      };
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'location', coords: userLocation }));
      updateAllGpsBadges();
      callback(userLocation);
    },
    function() { callback(userLocation); },
    { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 }
  );
}

function updateAllGpsBadges() {
  document.querySelectorAll('[data-door-id]').forEach(function(doorEl) {
    var doorId = doorEl.getAttribute('data-door-id');
    var gpsBadge = document.getElementById('gps-badge-' + doorId);
    var timeBadge = document.getElementById('time-badge-' + doorId);
    if (gpsBadge) updateGpsBadge(gpsBadge, doorEl);
    if (timeBadge) updateTimeBadge(timeBadge, doorEl);
  });
}

function getDistanceMeters(lat1, lng1, lat2, lng2) {
  var R = 6371000;
  var dLat = (lat2-lat1) * Math.PI/180;
  var dLng = (lng2-lng1) * Math.PI/180;
  var a = Math.sin(dLat/2)*Math.sin(dLat/2) +
          Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*
          Math.sin(dLng/2)*Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function checkTimeAllowed(schedule) {
  if (!schedule || !Object.keys(schedule).length) return { allowed: true, reason: '' };
  var now = new Date();
  var dayMap = [1,2,3,4,5,6,0]; // الاثنين=0 ... الأحد=6
  var dayIndex = dayMap[now.getDay()];
  var daySched = schedule[dayIndex];
  if (!daySched) return { allowed: true, reason: '' };
  if (!daySched.enabled) return { allowed: false, reason: 'غير مسموح اليوم' };
  var timeStr = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
  if (timeStr < daySched.start || timeStr > daySched.end) {
    return { allowed: false, reason: daySched.start + ' — ' + daySched.end };
  }
  return { allowed: true, reason: daySched.start + ' — ' + daySched.end };
}

async function loadUserDoors() {
  var container = document.getElementById('institutes-list');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--muted);text-align:center;padding:40px 0">⏳ جاري التحميل...</p>';
  try {
    var insts = await apiFetch('/api/institutes');
    var inst = Array.isArray(insts) ? insts[0] : null;
    if (!inst || !(inst.doors||[]).length) {
      container.innerHTML = '<p style="color:var(--muted);text-align:center;padding:40px 0">لا توجد أبواب متاحة</p>';
      return;
    }
    container.innerHTML = '';

    // بطاقة معلومات المستخدم
    var initials = (user.name||'?').split(' ').map(function(n){return n[0]||'';}).join('').slice(0,2).toUpperCase();
    var userCard = document.createElement('div');
    userCard.style.cssText = 'background:var(--surface);border:1px solid rgba(0,212,255,0.25);border-radius:20px;padding:18px 20px;margin-bottom:20px';
    var userCardInner = document.createElement('div');
    userCardInner.style.cssText = 'display:flex;align-items:center;gap:14px';
    var avatar = document.createElement('div');
    avatar.style.cssText = 'width:50px;height:50px;border-radius:50%;background:var(--accent2);display:flex;align-items:center;justify-content:center;font-size:1.1rem;font-weight:900;color:#fff;flex-shrink:0';
    avatar.textContent = initials;
    var userInfo = document.createElement('div');
    userInfo.innerHTML =
      '<div style="font-size:1rem;font-weight:800;color:var(--text)">' + (user.name||'') + '</div>' +
      '<div style="font-size:0.78rem;color:var(--muted);margin-top:3px">🏫 ' + inst.name + '</div>' +
      '<div style="font-size:0.72rem;color:var(--accent);margin-top:2px">📱 ' + (user.phone||'') + '</div>';
    userCardInner.appendChild(avatar);
    userCardInner.appendChild(userInfo);
    userCard.appendChild(userCardInner);
    container.appendChild(userCard);

    // الأبواب
    inst.doors.forEach(function(door) {
      var gpsRange  = (door.gps && door.gps.range !== undefined) ? door.gps.range : 100;
      var gpsLat    = door.gps && door.gps.lat;
      var gpsLng    = door.gps && door.gps.lng;
      var userReq   = door.gps && door.gps.user_required;
      var schedule  = door.schedule || {};
      var timeCheck = checkTimeAllowed(schedule);
      var DAYS_LABELS = ['الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت','الأحد'];

      var card = document.createElement('div');
      card.setAttribute('data-door-id', door.id);
      card.setAttribute('data-duration', door.duration_seconds || 5);
      card.setAttribute('data-gps-lat', gpsLat||'');
      card.setAttribute('data-gps-lng', gpsLng||'');
      card.setAttribute('data-gps-range', gpsRange);
      card.setAttribute('data-gps-req', userReq?'1':'0');
      card.setAttribute('data-schedule', JSON.stringify(schedule));
      card.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:20px;margin-bottom:16px;position:relative;overflow:hidden';

      // خط جانبي ديناميكي
      var line = document.createElement('div');
      line.style.cssText = 'position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,var(--accent),var(--accent2))';
      card.appendChild(line);

      // Header
      var hdr = document.createElement('div');
      hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:14px';
      hdr.innerHTML =
        '<div style="display:flex;align-items:center;gap:12px">' +
          '<div id="door-img-' + door.id + '" data-state="idle" data-device-id="' + door.device_id + '" style="width:52px;height:64px;flex-shrink:0"></div>' +
          '<div>' +
            '<div style="font-size:1.05rem;font-weight:800">' + door.name + '</div>' +
            (door.location ? '<div style="font-size:0.75rem;color:var(--muted);margin-top:3px">📍 ' + door.location + '</div>' : '') +
          '</div>' +
        '</div>' +
        '<span id="user-online-' + door.id + '" style="font-size:0.72rem;font-weight:700;padding:3px 10px;border-radius:20px;background:var(--surface2);color:var(--muted)">...</span>';
      card.appendChild(hdr);

      // حالة الباب
      var stateEl = document.createElement('div');
      stateEl.id = 'user-state-' + door.id;
      stateEl.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--surface2);border-radius:10px;margin-bottom:12px;font-weight:700;font-size:0.9rem;color:var(--muted)';
      stateEl.innerHTML = '<span style="width:9px;height:9px;border-radius:50%;background:var(--muted);display:inline-block"></span>جاري التحقق...';
      card.appendChild(stateEl);

      // ─── شارات GPS + وقت ───
      var badges = document.createElement('div');
      badges.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px';

      // GPS Badge
      var gpsBadge = document.createElement('div');
      gpsBadge.id = 'gps-badge-' + door.id;
      if (userReq && gpsLat && gpsLng) {
        gpsBadge.style.cssText = 'padding:10px 12px;border-radius:12px;background:var(--surface2);border:1px solid var(--border);font-size:0.78rem;font-weight:700;text-align:center';
        gpsBadge.textContent = '📍 جاري تحديد موقعك...';
      } else if (userReq && (!gpsLat || !gpsLng)) {
        gpsBadge.style.cssText = 'padding:10px 12px;border-radius:12px;background:rgba(255,179,0,0.1);border:1px solid rgba(255,179,0,0.2);font-size:0.78rem;font-weight:700;text-align:center;color:var(--warning)';
        gpsBadge.textContent = '📍 لم يُحدد موقع الباب';
      } else {
        gpsBadge.style.cssText = 'padding:10px 12px;border-radius:12px;background:rgba(0,230,118,0.1);border:1px solid rgba(0,230,118,0.2);font-size:0.78rem;font-weight:700;text-align:center;color:#00e676';
        gpsBadge.textContent = '📍 GPS غير مطلوب';
      }
      badges.appendChild(gpsBadge);

      // Time Badge
      var timeBadge = document.createElement('div');
      timeBadge.id = 'time-badge-' + door.id;
      if (Object.keys(schedule).length === 0) {
        timeBadge.style.cssText = 'padding:10px 12px;border-radius:12px;background:rgba(0,230,118,0.1);border:1px solid rgba(0,230,118,0.2);font-size:0.78rem;font-weight:700;text-align:center;color:#00e676';
        timeBadge.textContent = '⏰ متاح دائماً';
      } else if (timeCheck.allowed) {
        timeBadge.style.cssText = 'padding:10px 12px;border-radius:12px;background:rgba(0,230,118,0.1);border:1px solid rgba(0,230,118,0.2);font-size:0.78rem;font-weight:700;text-align:center;color:#00e676';
        timeBadge.innerHTML = '⏰ متاح<br><span style="font-size:0.68rem;font-weight:600">' + timeCheck.reason + '</span>';
      } else {
        timeBadge.style.cssText = 'padding:10px 12px;border-radius:12px;background:rgba(255,61,113,0.1);border:1px solid rgba(255,61,113,0.2);font-size:0.78rem;font-weight:700;text-align:center;color:#ff3d71';
        timeBadge.innerHTML = '⛔ مغلق الآن<br><span style="font-size:0.68rem;font-weight:600">' + (timeCheck.reason||'خارج أوقات العمل') + '</span>';
      }
      badges.appendChild(timeBadge);

      card.appendChild(badges);

      // جدول الأوقات المسموحة
      if (Object.keys(schedule).length > 0) {
        var now = new Date();
        var dayMap = [1,2,3,4,5,6,0];
        var todayIdx = dayMap[now.getDay()];
        var schedEl = document.createElement('div');
        schedEl.style.cssText = 'background:var(--surface2);border-radius:12px;padding:12px;margin-bottom:12px';
        var schedHtml = '<div style="font-size:0.75rem;font-weight:700;color:#8892b0;margin-bottom:8px">📅 الأوقات المسموحة</div>';
        DAYS_LABELS.forEach(function(day, i) {
          var d = schedule[i];
          var isToday = i === todayIdx;
          schedHtml += '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;border-radius:8px;margin-bottom:3px;background:' + (isToday ? 'rgba(0,212,255,0.08)' : 'transparent') + ';font-size:0.78rem">' +
            '<span style="font-weight:' + (isToday?'800':'500') + ';color:' + (isToday?'#00d4ff':'#8892b0') + '">' + (isToday?'▶ ':'') + day + '</span>' +
            '<span style="font-family:JetBrains Mono,monospace;font-size:0.72rem;color:' + (d&&d.enabled ? (isToday?'#00e676':'#8892b0') : '#ff3d71') + '">' +
              (d&&d.enabled ? d.start+' → '+d.end : (d?'مغلق':'—')) +
            '</span>' +
            '</div>';
        });
        schedEl.innerHTML = schedHtml;
        card.appendChild(schedEl);
      }

      // أزرار التحكم
      var btns = document.createElement('div');
      btns.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:8px';
      [['🟢','فتح','open'],['🔴','غلق','close'],['🟡','إيقاف','stop'],['⏱','40ث','open40']].forEach(function(item) {
        var btn = document.createElement('button');
        btn.style.cssText = 'padding:14px 4px;border-radius:12px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-family:Cairo,sans-serif;font-weight:700;font-size:0.8rem;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;transition:all 0.15s';
        btn.innerHTML = item[0] + '<span>' + item[1] + '</span>';
        btn.addEventListener('click', (function(d, act) {
          return function() { userDoorAction(d, act); };
        })(door, item[2]));
        btns.appendChild(btn);
      });
      card.appendChild(btns);
      container.appendChild(card);

      // رسم صورة الباب الأولية + جلب الحالة
      checkDoorStatus(door.device_id, 'user-online-' + door.id);
      // جلب الحالة الحقيقية مباشرة
      fetchUserDoorState(door);
    });

    // تحديث GPS badges بعد لحظة
    setTimeout(updateAllGpsBadges, 1000);

    // تحديث حالة الأبواب كل 10 ثوانٍ تلقائياً
    if (window._doorRefreshInterval) clearInterval(window._doorRefreshInterval);
    window._doorRefreshInterval = setInterval(function() {
      inst.doors.forEach(function(door) {
        fetchUserDoorState(door);
      });
    }, 10000);

  } catch(e) {
    container.innerHTML = '<p style="color:var(--danger);text-align:center;padding:40px 0">❌ ' + e.message + '</p>';
  }
}

async function fetchUserDoorState(door) {
  var el = document.getElementById('user-state-' + door.id);
  if (!el) return;
  // رسم spinner مؤقت
  var imgEl0 = document.getElementById('door-img-' + door.id);
  if (imgEl0 && !imgEl0.innerHTML) {
    imgEl0.innerHTML = '<svg viewBox="0 0 80 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;opacity:0.3"><rect x="4" y="2" width="72" height="78" rx="5" fill="none" stroke="#8892b0" stroke-width="1.8"/><rect x="8" y="4" width="62" height="74" rx="3" fill="#8892b0" fill-opacity="0.1" stroke="#8892b0" stroke-width="1.6"/><text x="40" y="97" text-anchor="middle" font-size="7" fill="#8892b0" font-family="Cairo,sans-serif">...</text></svg>';
  }
  try {
    // إذا lastKnownState فارغ → جلب آخر سجل من قاعدة البيانات
    if (!lastKnownState[door.id]) {
      try {
        var logs = await apiFetch('/api/doors/' + door.id + '/logs');
        if (logs && logs.length > 0) {
          var lv = logs[0].value;
          if (lv === 'open' || lv === 'open40') lastKnownState[door.id] = 'open';
          else if (lv === 'close') lastKnownState[door.id] = 'close';
        }
      } catch(e2) {}
    }
    var data = await apiFetch('/api/door/status?deviceId=' + door.device_id);
    var r1 = data.r1_on, r2 = data.r2_on;
    var state = r1 ? 'open' : r2 ? 'close' : 'idle';
    // idle من Tuya ليس "متوقف" — استخدم آخر حالة معروفة
    if (state === 'idle') {
      state = lastKnownState[door.id] || 'close';
    } else {
      lastKnownState[door.id] = state;
    }
    var text, color;
    if (state === 'open')  { text = '🔓 مفتوح'; color = 'var(--success)'; }
    else                   { text = '🔒 مغلق';  color = 'var(--danger)'; }
    el.innerHTML = '<span style="width:9px;height:9px;border-radius:50%;background:' + color + ';display:inline-block;box-shadow:0 0 6px ' + color + '"></span>' + text;
    el.style.color = color;
    // تحديث صورة الباب فقط إذا لم يكن هناك تايمر شغال
    if (!doorTimers[door.id]) {
      var imgEl2b = document.getElementById('door-img-' + door.id);
      var stEl2b  = document.getElementById('user-state-' + door.id);
      if (imgEl2b) _drawDoorStatic(imgEl2b, stEl2b, state);
    }
  } catch(e) {
    el.innerHTML = '<span style="color:var(--muted)">—</span>';
  }
}

// تحديث GPS badge لباب محدد
function updateGpsBadge(badge, doorEl) {
  if (!badge || !doorEl) return;
  var gpsReq = doorEl.getAttribute('data-gps-req') === '1';
  var gpsLat = parseFloat(doorEl.getAttribute('data-gps-lat'));
  var gpsLng = parseFloat(doorEl.getAttribute('data-gps-lng'));
  var range  = parseFloat(doorEl.getAttribute('data-gps-range')) || 100;
  if (!gpsReq) return;
  if (!gpsLat || !gpsLng) return;
  if (!userLocation) {
    badge.style.cssText = 'padding:10px 12px;border-radius:12px;background:rgba(255,179,0,0.1);border:1px solid rgba(255,179,0,0.2);font-size:0.78rem;font-weight:700;text-align:center;color:var(--warning)';
    badge.textContent = '📍 جاري التحديد...';
    return;
  }
  var dist = Math.round(getDistanceMeters(userLocation.lat, userLocation.lng, gpsLat, gpsLng));
  var inRange = dist <= range;
  badge.style.cssText = 'padding:10px 12px;border-radius:12px;background:' +
    (inRange ? 'rgba(0,230,118,0.08);border:1px solid rgba(0,230,118,0.2)' : 'rgba(255,61,113,0.08);border:1px solid rgba(255,61,113,0.2)') +
    ';font-size:0.78rem;font-weight:700;text-align:center;color:' + (inRange ? 'var(--success)' : 'var(--danger)');
  badge.innerHTML = (inRange ? '✅ في النطاق' : '❌ خارج النطاق') + '<br><span style="font-size:0.68rem;font-weight:600">' + dist + 'م / ' + range + 'م</span>';
}

function updateTimeBadge(badge, doorEl) {
  if (!badge) return;
  var schedStr = doorEl.getAttribute('data-schedule');
  try {
    var sched = JSON.parse(schedStr);
    var check = checkTimeAllowed(sched);
    if (!Object.keys(sched).length) return;
    badge.style.cssText = 'padding:10px 12px;border-radius:12px;background:' +
      (check.allowed ? 'rgba(0,230,118,0.08);border:1px solid rgba(0,230,118,0.15)' : 'rgba(255,61,113,0.08);border:1px solid rgba(255,61,113,0.15)') +
      ';font-size:0.78rem;font-weight:700;text-align:center;color:' + (check.allowed ? 'var(--success)' : 'var(--danger)');
    badge.innerHTML = (check.allowed ? '⏰ متاح' : '⛔ مغلق الآن') + '<br><span style="font-size:0.68rem;font-weight:600">' + (check.reason||'') + '</span>';
  } catch(e) {}
}

async function userDoorAction(door, action) {
  var body = { action: action, deviceId: door.device_id, duration: door.duration_seconds || 5 };
  var gpsNeeded = (user.role === 'user' && door.gps && door.gps.user_required) ||
                  (user.role === 'admin' && door.gps && door.gps.admin_required);
  if (gpsNeeded) {
    // جلب الموقع الحالي عند الضغط فقط
    await new Promise(function(resolve) {
      getUserLocationOnDemand(function(loc) {
        if (loc) { body.lat = loc.lat; body.lng = loc.lng; }
        resolve();
      });
    });
    if (!body.lat) {
      toast('📍 تعذر تحديد موقعك، تأكد من تفعيل GPS', 'error');
      return;
    }
  }
  try {
    await apiFetch('/api/door/control', 'POST', body);
    var labels = { open:'✅ تم الفتح', close:'✅ تم الغلق', stop:'✅ تم الإيقاف', open40:'✅ فتح 40 ثانية' };
    toast(labels[action]||'✅ تم', 'success');
    // تشغيل التايمر
    var imgEl   = document.getElementById('door-img-' + door.id);
    var stateEl = document.getElementById('user-state-' + door.id);
    var secs    = action === 'stop' ? 0 : (action === 'open40' ? 40 : (door.duration_seconds || 5));
    if (action === 'stop') {
      stopDoorTimer(door.id, imgEl, stateEl);
    } else {
      lastKnownState[door.id] = (action === 'open' || action === 'open40') ? 'open' : 'close';
      startDoorTimer(door.id, imgEl, stateEl, secs, action);
    }
  } catch(e) {
    var msg = e.message || 'خطأ';
    if (msg.includes('GPS') || msg.includes('بعيد')) toast('📍 ' + msg, 'error');
    else if (msg.includes('وقت') || msg.includes('مسموح') || msg.includes('اليوم')) toast('⏰ ' + msg, 'error');
    else toast('❌ ' + msg, 'error');
  }
}


// ─── Admin Interface ───────────────────────────────────
async function loadAdminDoors() {
  var container = document.getElementById('institutes-list');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--muted);text-align:center;padding:40px 0">⏳ جاري التحميل...</p>';
  try {
    var insts = await apiFetch('/api/institutes');
    var inst = Array.isArray(insts) ? insts[0] : null;
    if (!inst) {
      container.innerHTML = '<p style="color:var(--muted);text-align:center;padding:40px 0">لا توجد مؤسسة</p>';
      return;
    }
    container.innerHTML = '';

    // بطاقة المؤسسة
    var instCard = document.createElement('div');
    instCard.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:16px 20px;margin-bottom:16px';
    instCard.innerHTML =
      '<div style="font-size:1.1rem;font-weight:800">🏫 ' + inst.name + '</div>' +
      '<div style="font-family:JetBrains Mono,monospace;font-size:0.72rem;color:var(--warning);margin-top:3px">🔑 ' + inst.code + '</div>';
    container.appendChild(instCard);

    // زر إضافة باب
    var btnAddDoor = document.createElement('button');
    btnAddDoor.style.cssText = 'width:100%;padding:12px;border-radius:12px;border:1px dashed rgba(0,230,118,0.3);background:rgba(0,230,118,0.05);color:var(--success);font-family:Cairo,sans-serif;font-size:0.85rem;font-weight:700;cursor:pointer;margin-bottom:16px';
    btnAddDoor.textContent = '+ إضافة باب جديد';
    btnAddDoor.addEventListener('click', function() { openAddDoor(inst.id); });
    container.appendChild(btnAddDoor);

    // قائمة الأبواب
    (inst.doors||[]).forEach(function(door) {
      var card = document.createElement('div');
      card.style.cssText = 'background:rgba(0,230,118,0.04);border:1px solid rgba(0,230,118,0.2);border-radius:16px;padding:16px;margin-bottom:12px';
      card.setAttribute('data-door-id', door.id);
      card.setAttribute('data-duration', door.duration_seconds || 5);

      // Header: صورة الباب + اسم + حالة
      var hdr = document.createElement('div');
      hdr.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:12px';
      hdr.innerHTML =
        '<div id="door-img-' + door.id + '" data-device-id="' + door.device_id + '" data-door-id="' + door.id + '" style="width:52px;height:64px;flex-shrink:0"></div>' +
        '<div style="flex:1">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">' +
            '<div style="font-weight:800">🚪 ' + door.name + '</div>' +
            '<span id="adm-status-' + door.id + '" style="font-size:0.7rem;font-weight:700;padding:3px 10px;border-radius:20px;background:var(--surface);color:var(--muted)">...</span>' +
          '</div>' +
          '<div style="font-family:JetBrains Mono,monospace;font-size:0.68rem;color:var(--muted);margin-bottom:5px">ID: ' + (door.device_id||'').substring(0,16) + '...</div>' +
          '<div id="door-progress-' + door.id + '" style="font-size:0.8rem;color:var(--muted)"></div>' +
        '</div>';
      card.appendChild(hdr);

      // أزرار التحكم 4 في grid
      var grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px';
      [['🟢','فتح','open','rgba(0,230,118,0.15)','rgba(0,230,118,0.3)','var(--success)'],
       ['🔴','غلق','close','rgba(255,61,113,0.15)','rgba(255,61,113,0.3)','var(--danger)'],
       ['🟡','إيقاف','stop','rgba(255,179,0,0.15)','rgba(255,179,0,0.3)','var(--warning)'],
       ['⏱','40ث','open40','rgba(0,212,255,0.15)','rgba(0,212,255,0.3)','var(--accent)']
      ].forEach(function(item) {
        var btn = document.createElement('button');
        btn.style.cssText = 'padding:12px 4px;border-radius:12px;border:1px solid ' + item[4] + ';background:' + item[3] + ';color:' + item[5] + ';font-family:Cairo,sans-serif;font-weight:700;font-size:0.8rem;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px';
        btn.innerHTML = item[0] + '<span>' + item[1] + '</span>';
        btn.addEventListener('click', (function(did, act, dur){ return function(){ sendDoorAction(did, act, dur); }; })(door.device_id, item[2], door.duration_seconds||5));
        grid.appendChild(btn);
      });
      card.appendChild(grid);

      // صف الإدارة: تعديل + حذف + GPS
      var adminRow = document.createElement('div');
      adminRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px';

      var btnEdit = document.createElement('button');
      btnEdit.style.cssText = 'padding:9px;border-radius:10px;border:1px solid rgba(124,92,252,0.3);background:rgba(124,92,252,0.1);color:var(--accent2);font-family:Cairo,sans-serif;font-size:0.78rem;font-weight:700;cursor:pointer';
      btnEdit.textContent = '✏️ تعديل';
      btnEdit.addEventListener('click', (function(d){ return function(){ openEditDoor(inst.id, d.id, d.name, d.location||'', d.device_id, d.duration_seconds||5); }; })(door));
      adminRow.appendChild(btnEdit);

      var btnDel = document.createElement('button');
      btnDel.style.cssText = 'padding:9px;border-radius:10px;border:1px solid rgba(255,61,113,0.2);background:rgba(255,61,113,0.08);color:var(--danger);font-family:Cairo,sans-serif;font-size:0.78rem;font-weight:700;cursor:pointer';
      btnDel.textContent = '🗑 حذف';
      btnDel.addEventListener('click', (function(did, iid){ return function(){ deleteDoor(did, iid); }; })(door.id, inst.id));
      adminRow.appendChild(btnDel);

      var btnGps = document.createElement('button');
      var gpsRange = (door.gps && door.gps.range !== undefined) ? door.gps.range : 100;
      var userReq  = door.gps && door.gps.user_required;
      btnGps.style.cssText = 'padding:9px;border-radius:10px;border:1px solid rgba(0,212,255,0.2);background:rgba(0,212,255,0.08);color:var(--accent);font-family:Cairo,sans-serif;font-size:0.78rem;font-weight:700;cursor:pointer';
      btnGps.textContent = '📡 GPS ' + gpsRange + 'م';
      btnGps.addEventListener('click', (function(d){ return function(){ openGpsModal(d.id, d.gps&&d.gps.range!==undefined?d.gps.range:100, d.gps&&d.gps.lat||null, d.gps&&d.gps.lng||null); }; })(door));
      adminRow.appendChild(btnGps);

      card.appendChild(adminRow);

      // GPS toggle للمستخدمين (الأدمن يرى زر واحد فقط)
      var gpsToggle = document.createElement('div');
      gpsToggle.style.cssText = 'background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;margin-bottom:8px';
      gpsToggle.innerHTML =
        '<div>' +
          '<div style="font-size:0.78rem;font-weight:700">📍 GPS إلزامي للمستخدمين</div>' +
          '<div style="font-size:0.7rem;color:' + (userReq?'var(--success)':'var(--danger)') + ';margin-top:2px;font-weight:700">' + (userReq?'مفعّل ✅':'معطّل ❌') + '</div>' +
        '</div>' +
        '<label class="toggle-switch">' +
          '<input type="checkbox" ' + (userReq?'checked':'') + ' id="gps-toggle-' + door.id + '">' +
          '<span class="toggle-knob"></span>' +
        '</label>';
      card.appendChild(gpsToggle);
      // إضافة event listener للـ toggle
      (function(did, ureq) {
        setTimeout(function() {
          var chk = document.getElementById('gps-toggle-' + did);
          if (chk) chk.addEventListener('change', function() { toggleDoorGps(did, 'user_required', this.checked); });
        }, 50);
      })(door.id, userReq);

      // أزرار السجل + الجدول
      var logRow = document.createElement('div');
      logRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px';

      var btnLog = document.createElement('button');
      btnLog.style.cssText = 'padding:10px;border-radius:10px;border:1px solid rgba(0,212,255,0.2);background:rgba(0,212,255,0.08);color:var(--accent);font-family:Cairo,sans-serif;font-size:0.78rem;font-weight:700;cursor:pointer';
      btnLog.textContent = '📋 سجل الباب';
      btnLog.addEventListener('click', (function(id, name){ return function(){ openDoorLogs(id, name); }; })(door.id, door.name));
      logRow.appendChild(btnLog);

      var btnSched = document.createElement('button');
      btnSched.style.cssText = 'padding:10px;border-radius:10px;border:1px solid rgba(255,179,0,0.2);background:rgba(255,179,0,0.08);color:var(--warning);font-family:Cairo,sans-serif;font-size:0.78rem;font-weight:700;cursor:pointer';
      btnSched.textContent = '🕐 جدول الأوقات';
      btnSched.addEventListener('click', (function(d){ return function(){ openDoorSchedule(d.id, d.name, d.schedule||{}); }; })(door));
      logRow.appendChild(btnSched);

      card.appendChild(logRow);
      container.appendChild(card);
      checkDoorStatus(door.device_id, 'adm-status-' + door.id);
      // رسم صورة الباب الأولية وجلب الحالة
      fetchAndUpdateDoorImage(door);
    });

  } catch(e) {
    container.innerHTML = '<p style="color:var(--danger);text-align:center;padding:40px 0">❌ ' + e.message + '</p>';
  }
}

// تبويبة المستخدمين للمدير
async function loadAdminUsers() {
  var container = document.getElementById('institutes-list');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--muted);text-align:center;padding:40px 0">⏳ جاري التحميل...</p>';
  try {
    var insts = await apiFetch('/api/institutes');
    var inst = Array.isArray(insts) ? insts[0] : null;
    if (!inst) { container.innerHTML = '<p style="color:var(--muted);text-align:center;padding:40px 0">لا توجد مؤسسة</p>'; return; }

    // زر إضافة مستخدم
    container.innerHTML = '';
    var btnAdd = document.createElement('button');
    btnAdd.style.cssText = 'width:100%;padding:12px;border-radius:12px;border:1px dashed rgba(0,212,255,0.3);background:rgba(0,212,255,0.05);color:var(--accent);font-family:Cairo,sans-serif;font-size:0.85rem;font-weight:700;cursor:pointer;margin-bottom:16px';
    btnAdd.textContent = '+ إضافة مستخدم جديد';
    btnAdd.addEventListener('click', function() { openAddUser(); });
    container.appendChild(btnAdd);

    // جلب المستخدمين
    var users = await apiFetch('/api/users?inst_id=' + inst.id);
    var filtered = (users||[]).filter(function(u){ return u.role !== 'super_admin'; });

    if (!filtered.length) {
      var empty = document.createElement('p');
      empty.style.cssText = 'color:var(--muted);text-align:center;padding:30px';
      empty.textContent = 'لا يوجد مستخدمون بعد';
      container.appendChild(empty);
      return;
    }

    var statusColors = { pending:'var(--warning)', approved:'var(--success)', rejected:'var(--danger)' };
    var statusLabels = { pending:'انتظار', approved:'موافق', rejected:'مرفوض' };
    var roleLabels   = { user:'مستخدم', admin:'مدير' };

    filtered.forEach(function(u) {
      var status = u.request_status || 'approved';
      var card = document.createElement('div');
      card.style.cssText = 'background:var(--surface2);border-radius:14px;padding:14px;margin-bottom:10px';

      // Info row
      var infoRow = document.createElement('div');
      infoRow.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px';
      infoRow.innerHTML =
        '<div>' +
          '<div style="font-weight:700;font-size:0.92rem">' + u.name + '</div>' +
          '<div style="font-family:JetBrains Mono,monospace;font-size:0.75rem;color:var(--muted);margin-top:2px">📞 ' + u.phone + '</div>' +
          '<div style="font-size:0.7rem;color:var(--accent2);margin-top:2px">' + (roleLabels[u.role]||u.role) + '</div>' +
        '</div>' +
        '<span style="font-size:0.7rem;font-weight:700;padding:3px 10px;border-radius:20px;background:rgba(0,0,0,0.2);color:' + statusColors[status] + '">' + (statusLabels[status]||status) + '</span>';
      card.appendChild(infoRow);

      // Buttons row
      var bRow = document.createElement('div');
      bRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
      [['✅ موافقة','approved','rgba(0,230,118,0.15)','var(--success)','flex:1'],
       ['⏳ انتظار','pending','rgba(255,179,0,0.15)','var(--warning)','flex:1'],
       ['❌ رفض','rejected','rgba(255,61,113,0.15)','var(--danger)','flex:1'],
       ['🗑','del','rgba(255,61,113,0.1)','var(--danger)','']
      ].forEach(function(item) {
        var b = document.createElement('button');
        b.style.cssText = (item[4]?item[4]+';':'') + 'padding:7px 8px;border-radius:8px;border:none;background:' + item[2] + ';color:' + item[3] + ';font-family:Cairo,sans-serif;font-size:0.75rem;font-weight:700;cursor:pointer';
        b.textContent = item[0];
        b.addEventListener('click', (function(uid, act, iid, uname) {
          return function() {
            if (act === 'del') deleteUser(uid, iid, uname);
            else changeUserStatus(uid, act, iid, uname);
          };
        })(u.id, item[1], inst.id, u.name));
        bRow.appendChild(b);
      });
      card.appendChild(bRow);
      container.appendChild(card);
    });
  } catch(e) {
    container.innerHTML = '<p style="color:var(--danger);text-align:center;padding:40px 0">❌ ' + e.message + '</p>';
  }
}



// ─── Stats Page ───────────────────────────────────────
async function loadStats() {
  try {
    const s = await apiFetch('/api/stats/full');
    const grid = document.getElementById('stats-grid');
    if (!grid) return;

    // للسوبر أدمن: أضف إحصائيات المؤسسات
    var extraItems = [];
    if (user && user.role === 'super_admin') {
      try {
        const insts = await apiFetch('/api/institutes');
        extraItems = [{ label:'المؤسسات', value: insts.length, color:'var(--warning)', icon:'🏫' }];
      } catch(e) {}
    }

    const items = [
      { label:'عمليات اليوم',  value: s.today_actions, color:'var(--accent)',  icon:'📊' },
      { label:'إجمالي الفتح',  value: s.total_opens,   color:'var(--success)', icon:'🔓' },
      { label:'التنبيهات',     value: s.alert_count,   color:'var(--danger)',  icon:'🔔' },
      { label:'المستخدمون',    value: s.active_users + '/' + s.total_users, color:'var(--accent2)', icon:'👥' },
    ].concat(extraItems);

    grid.style.gridTemplateColumns = items.length === 5 ? 'repeat(3,1fr)' : '1fr 1fr';
    grid.innerHTML = items.map(function(item) {
      return '<div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:18px;text-align:center">' +
        '<div style="font-size:1.6rem;margin-bottom:6px">' + item.icon + '</div>' +
        '<div style="font-size:1.8rem;font-weight:900;font-family:JetBrains Mono,monospace;color:' + item.color + '">' + item.value + '</div>' +
        '<div style="font-size:0.75rem;color:var(--muted);margin-top:4px">' + item.label + '</div>' +
        '</div>';
    }).join('');
  } catch(e) { console.error('loadStats', e); }
}

// ─── Alerts Page ──────────────────────────────────────
async function loadAlerts() {
  const container = document.getElementById('alerts-list');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--muted);text-align:center;padding:30px">⏳ جاري التحميل...</p>';
  try {
    const data = await apiFetch('/api/alerts');
    if (!data.length) {
      container.innerHTML = '<p style="color:var(--muted);text-align:center;padding:30px">✅ لا توجد تنبيهات</p>';
      return;
    }

    const typeMap = {
      gps_required:    { label:'GPS غير مفعّل',    color:'var(--warning)', icon:'📍' },
      gps_out_of_range:{ label:'خارج نطاق GPS',    color:'var(--danger)',  icon:'🗺' },
      schedule_denied: { label:'خارج أيام العمل',  color:'var(--danger)',  icon:'📅' },
      schedule_time:   { label:'خارج أوقات العمل', color:'var(--warning)', icon:'⏰' },
    };
    const actionMap = { open:'فتح', close:'غلق', stop:'إيقاف', open40:'فتح 40ث' };

    container.innerHTML = data.map(function(alert) {
      var t = typeMap[alert.type] || { label: alert.type, color:'var(--muted)', icon:'⚠️' };
      var mapsLink = (alert.lat && alert.lng)
        ? '<a href="https://www.google.com/maps?q=' + alert.lat + ',' + alert.lng + '" target="_blank" style="color:var(--accent);font-size:0.75rem;text-decoration:none">🗺 الموقع</a>'
        : '';
      return '<div style="background:var(--surface2);border-radius:14px;padding:14px;margin-bottom:10px;border-right:3px solid ' + t.color + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<span style="font-size:1.1rem">' + t.icon + '</span>' +
            '<div>' +
              '<div style="font-weight:700;font-size:0.88rem;color:' + t.color + '">' + t.label + '</div>' +
              '<div style="font-size:0.75rem;color:var(--muted);margin-top:2px">' + alert.message + '</div>' +
            '</div>' +
          '</div>' +
          '<div style="text-align:left">' +
            '<div style="font-size:0.7rem;color:var(--muted)">' + formatTime(alert.created_at) + '</div>' +
            (alert.action ? '<div style="font-size:0.7rem;color:var(--accent2);margin-top:2px">محاولة: ' + (actionMap[alert.action]||alert.action) + '</div>' : '') +
          '</div>' +
        '</div>' +
        mapsLink +
      '</div>';
    }).join('');

    // تحديث badge التنبيهات
    var badge = document.getElementById('nav-alerts-label');
    if (badge && data.length > 0) badge.textContent = 'التنبيهات (' + data.length + ')';

  } catch(e) {
    container.innerHTML = '<p style="color:var(--danger);text-align:center;padding:30px">' + e.message + '</p>';
  }
}


// ─── طلب موقع فوري ────────────────────────────────────
async function requestUserLocationNow(userId, userName) {
  toast('📡 جاري طلب موقع ' + userName + '...', 'info');
  try {
    const res = await apiFetch('/api/users/' + userId + '/request-location', 'POST', {});

    if (res.success) {
      // المستخدم متصل — انتظر الرد عبر WebSocket
      toast('✅ تم إرسال الطلب لـ ' + userName + ' — سيظهر موقعه خلال ثوانٍ', 'success');
      // بعد 5 ثوانٍ اعرض السجل
      setTimeout(function() { showUserLocation(userId, userName); }, 5000);
    } else if (res.offline) {
      // المستخدم غير متصل
      if (res.last_location) {
        var ago = res.last_seen ? ' (آخر ظهور: ' + formatTime(res.last_seen) + ')' : '';
        var open = confirm(userName + ' غير متصل الآن' + ago + '\nهل تريد رؤية آخر موقع معروف؟');
        if (open) {
          window.open('https://www.google.com/maps?q=' + res.last_location.lat + ',' + res.last_location.lng, '_blank');
        }
      } else {
        toast('⚠️ ' + userName + ' غير متصل ولا يوجد موقع محفوظ', 'error');
      }
    }
  } catch(e) { toast(e.message, 'error'); }
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
  if (name === 'institutes') {
    if (user && user.role === 'super_admin') loadInstitutes();
    else if (user && user.role === 'admin') loadAdminDoors();
    else if (user) loadUserDoors();
  }
  if (name === 'users') {
    if (user && user.role === 'admin') { loadAdminUsers(); return; }
  }
  if (name === 'stats')  loadStats();
  if (name === 'alerts') loadAlerts();
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
