function updateDeviceOnlineBadge(deviceId, online) {
  var color = online ? 'var(--success)' : 'var(--danger)';
  var bg    = online ? 'rgba(0,230,118,0.12)' : 'rgba(255,61,113,0.12)';
  var bdr   = online ? 'rgba(0,230,118,0.3)' : 'rgba(255,61,113,0.3)';
  var text  = online ? '🟢 متصل' : '🔴 غير متصل';

  doorStatusCache[deviceId] = online;

  var foundIds = [];
  var safeId = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(deviceId) : deviceId.replace(/([\0-\x1f\x7f]|^-?\d)|^-$|[^\x80-\uFFFF\w-]/g, "\\$&");
  document.querySelectorAll('[data-device-id="' + safeId + '"]').forEach(function(el) {
    var doorId = el.getAttribute('data-door-id') || el.id.replace('door-img-', '');
    if (doorId && !foundIds.includes(doorId)) foundIds.push(doorId);
  });
  if (foundIds.length === 0 && typeof institutesCache !== 'undefined') {
    institutesCache.forEach(function(inst) {
      (inst.doors||[]).forEach(function(d) {
        if (d.device_id === deviceId) foundIds.push(d.id);
      });
    });
  }
  foundIds.forEach(function(doorId) {
    var admOnline = document.getElementById('adm-online-' + doorId);
    if (admOnline) {
      admOnline.textContent = text;
      admOnline.style.cssText = 'font-size:0.65rem;font-weight:700;padding:2px 8px;border-radius:20px;background:' + bg + ';color:' + color + ';border:1px solid ' + bdr;
    }
    var userOnline = document.getElementById('user-online-' + doorId);
    if (userOnline) {
      userOnline.textContent = text;
      userOnline.style.cssText = 'font-size:0.72rem;font-weight:700;padding:3px 10px;border-radius:20px;background:' + bg + ';color:' + color;
    }
  });
  document.querySelectorAll('[id^="enligne-"]').forEach(function(span) {
    var instId = span.id.replace('enligne-', '');
    var inst = (typeof institutesCache !== 'undefined') && institutesCache.find(function(i) { return i.id === instId; });
    if (!inst || !inst.doors) return;
    var total   = inst.doors.length;
    var onlineN = inst.doors.filter(function(d) { return doorStatusCache[d.device_id] === true; }).length;
    span.textContent = onlineN + '/' + total;
    span.parentElement.style.color = onlineN > 0 ? 'var(--success)' : 'var(--danger)';
  });
}


// تحديث بطاقة الباب في صفحة المؤسسات/الأدمن
function updateDoorCardState(doorId, deviceId, state, source) {
  var statusEl = document.getElementById('door-status-' + doorId);
  if (statusEl) {
    var label  = state==='open' ? 'مفتوح' : state==='close' ? 'مغلق' : 'متوقف';
    var color  = state==='open' ? 'rgba(0,230,118,0.15)' : state==='close' ? 'rgba(255,61,113,0.15)' : 'rgba(255,179,0,0.15)';
    var tcolor = state==='open' ? 'var(--success)' : state==='close' ? 'var(--danger)' : 'var(--warning)';
    var icon   = state==='open' ? '🔓' : state==='close' ? '🔒' : '⏹';
    statusEl.innerHTML = icon + ' ' + label + (source==='rc' ? ' <span style="font-size:0.62rem;opacity:0.7">RC</span>' : '');
    statusEl.style.cssText = 'font-size:0.7rem;font-weight:700;padding:3px 10px;border-radius:20px;background:' + color + ';color:' + tcolor + ';border:1px solid ' + tcolor + '33';
  }
  var admEl = document.getElementById('adm-status-' + doorId);
  if (admEl) {
    var label  = state==='open' ? '🔓 مفتوح' : state==='close' ? '🔒 مغلق' : '⏹ متوقف';
    var color  = state==='open' ? 'rgba(0,230,118,0.15)' : state==='close' ? 'rgba(255,61,113,0.15)' : 'rgba(255,179,0,0.15)';
    var tcolor = state==='open' ? 'var(--success)' : state==='close' ? 'var(--danger)' : 'var(--warning)';
    admEl.textContent = label;
    admEl.style.cssText = 'font-size:0.7rem;font-weight:700;padding:3px 10px;border-radius:20px;background:' + color + ';color:' + tcolor;
  }
}
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
  setupOtpInputs();
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

// ─── تذكر الحساب ───
(function() {
  var saved = localStorage.getItem('porte_saved_phone');
  if (saved) {
    document.getElementById('login-phone').value = saved;
    var rem = document.getElementById('login-remember');
    if (rem) rem.checked = true;
  }
})();

async function doLogin() {
  const phone = document.getElementById('login-phone').value.trim();
  const pw    = document.getElementById('login-pw').value;
  const remember = document.getElementById('login-remember')?.checked;
  if (remember) localStorage.setItem('porte_saved_phone', phone);
  else localStorage.removeItem('porte_saved_phone');
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


// ─── التسجيل ──────────────────────────────────────────────────────────────────
function showRegisterPage() {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('register-page').style.display = 'flex';
}

function showLoginPage() {
  document.getElementById('register-page').style.display = 'none';
  document.getElementById('otp-page').style.display = 'none';
  document.getElementById('forgot-page').style.display = 'none';
  document.getElementById('login-page').style.display = 'flex';
}

var _registerData = {};
var _otpType = 'register';
var _otpPhone = '';

async function doRegister() {
  const name      = document.getElementById('reg-name').value.trim();
  const last_name = document.getElementById('reg-lastname').value.trim();
  const rawPhone  = document.getElementById('reg-phone').value.trim().replace(/[^0-9]/g,'');
  const phone     = rawPhone ? '+216' + rawPhone : '';
  const pw        = document.getElementById('reg-pw').value;
  const pw2       = document.getElementById('reg-pw2').value;
  const inst_code = document.getElementById('reg-instcode').value.trim();
  const err       = document.getElementById('reg-error');

  err.style.display = 'none';
  if (!name || !phone || !pw || !inst_code) {
    err.textContent = 'جميع الحقول مطلوبة';
    err.style.display = 'block';
    return;
  }
  if (pw !== pw2) {
    err.textContent = 'كلمتا المرور غير متطابقتان';
    err.style.display = 'block';
    return;
  }
  if (pw.length < 4) {
    err.textContent = 'كلمة المرور قصيرة جداً (4 أحرف على الأقل)';
    err.style.display = 'block';
    return;
  }

  _registerData = { name, last_name, phone, pw, inst_code };
  _otpType  = 'register';
  _otpPhone = phone;

  const btn = document.getElementById('reg-btn');
  btn.disabled = true;
  btn.textContent = 'جاري الإرسال...';

  try {
    await apiFetch('/api/auth/send-otp', 'POST', { phone, type: 'register' }, false);
    showOtpPage('register');
  } catch(e) {
    err.textContent = e.message;
    err.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'التالي →';
  }
}

function showOtpPage(type) {
  _otpType = type;
  document.getElementById('register-page').style.display = 'none';
  document.getElementById('forgot-page').style.display = 'none';
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('otp-page').style.display = 'flex';
  document.getElementById('otp-title').textContent = type === 'register' ? 'تأكيد التسجيل' : 'إعادة تعيين كلمة المرور';
  document.getElementById('otp-desc').textContent = 'أدخل الرمز المرسل إلى ' + _otpPhone;
  // في وضع التطوير: تعمير تلقائي بـ 0000
  setTimeout(function() {
    var inputs = document.querySelectorAll('.otp-input');
    ['0','0','0','0'].forEach(function(d, i) { if(inputs[i]) inputs[i].value = d; });
  }, 500);
}

async function verifyOtp() {
  var inputs = document.querySelectorAll('.otp-input');
  var code   = Array.from(inputs).map(function(i){ return i.value; }).join('');
  var err    = document.getElementById('otp-error');
  err.style.display = 'none';

  if (code.length !== 4) {
    err.textContent = 'أدخل الرمز كاملاً';
    err.style.display = 'block';
    return;
  }

  const btn = document.getElementById('otp-btn');
  btn.disabled = true;
  btn.textContent = 'جاري التحقق...';

  try {
    await apiFetch('/api/auth/verify-otp', 'POST', { phone: _otpPhone, code, type: _otpType }, false);

    if (_otpType === 'register') {
      // إتمام التسجيل
      const res = await apiFetch('/api/auth/register', 'POST', _registerData, false);
      token = res.token;
      user  = res.user;
      localStorage.setItem('porte_token', token);
      localStorage.setItem('porte_user', JSON.stringify(user));
      document.getElementById('otp-page').style.display = 'none';
      bootApp();
    } else {
      // إعادة تعيين كلمة المرور
      showNewPasswordPage(code);
    }
  } catch(e) {
    err.textContent = e.message;
    err.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'تأكيد';
  }
}

// OTP inputs navigation
function setupOtpInputs() {
  var inputs = document.querySelectorAll('.otp-input');
  inputs.forEach(function(input, idx) {
    input.addEventListener('input', function() {
      if (this.value.length === 1 && idx < inputs.length - 1) {
        inputs[idx+1].focus();
      }
      // تحقق تلقائي عند اكتمال الرمز
      var code = Array.from(inputs).map(function(i){ return i.value; }).join('');
      if (code.length === 4) verifyOtp();
    });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Backspace' && !this.value && idx > 0) inputs[idx-1].focus();
    });
  });
}

// ─── نسيت كلمة السر ───────────────────────────────────────────────────────────
function showForgotPage() {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('forgot-page').style.display = 'flex';
}

async function doForgot() {
  const phone = document.getElementById('forgot-phone').value.trim();
  const err   = document.getElementById('forgot-error');
  err.style.display = 'none';

  if (!phone) { err.textContent = 'أدخل رقم الهاتف'; err.style.display = 'block'; return; }

  _otpPhone = phone;
  _otpType  = 'reset_password';

  const btn = document.getElementById('forgot-btn');
  btn.disabled = true;
  btn.textContent = 'جاري الإرسال...';

  try {
    await apiFetch('/api/auth/send-otp', 'POST', { phone, type: 'reset_password' }, false);
    showOtpPage('reset_password');
  } catch(e) {
    err.textContent = e.message;
    err.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'إرسال الرمز';
  }
}

var _resetCode = '';
function showNewPasswordPage(code) {
  _resetCode = code;
  document.getElementById('otp-page').style.display = 'none';
  document.getElementById('new-password-page').style.display = 'flex';
}

async function doResetPassword() {
  const new_pw  = document.getElementById('new-pw').value;
  const new_pw2 = document.getElementById('new-pw2').value;
  const err     = document.getElementById('new-pw-error');
  err.style.display = 'none';

  if (new_pw !== new_pw2) { err.textContent = 'كلمتا المرور غير متطابقتان'; err.style.display = 'block'; return; }
  if (new_pw.length < 4)  { err.textContent = 'كلمة المرور قصيرة جداً'; err.style.display = 'block'; return; }

  try {
    await apiFetch('/api/auth/reset-password', 'POST', { phone: _otpPhone, code: _resetCode, new_pw }, false);
    toast('✅ تم تغيير كلمة المرور', 'success');
    document.getElementById('new-password-page').style.display = 'none';
    showLoginPage();
  } catch(e) {
    err.textContent = e.message;
    err.style.display = 'block';
  }
}

// ─── إعدادات المستخدم ──────────────────────────────────────────────────────────
function showSettings() {
  openModal('modal-settings');
}

async function doChangePassword() {
  const old_pw  = document.getElementById('settings-old-pw').value;
  const new_pw  = document.getElementById('settings-new-pw').value;
  const new_pw2 = document.getElementById('settings-new-pw2').value;
  const err     = document.getElementById('settings-pw-error');
  err.style.display = 'none';

  if (new_pw !== new_pw2) { err.textContent = 'كلمتا المرور غير متطابقتان'; err.style.display = 'block'; return; }
  if (new_pw.length < 4)  { err.textContent = 'كلمة المرور قصيرة جداً'; err.style.display = 'block'; return; }

  try {
    await apiFetch('/api/auth/change-password', 'POST', { old_pw, new_pw });
    toast('✅ تم تغيير كلمة المرور', 'success');
    closeModal('modal-settings');
    document.getElementById('settings-old-pw').value = '';
    document.getElementById('settings-new-pw').value = '';
    document.getElementById('settings-new-pw2').value = '';
  } catch(e) {
    err.textContent = e.message;
    err.style.display = 'block';
  }
}

// ─── Heartbeat (تسجيل آخر ظهور) ──────────────────────────────────────────────
setInterval(function() {
  if (token) apiFetch('/api/auth/heartbeat', 'POST', {}).catch(function(){});
}, 5 * 60 * 1000);

// ─── تسجيل خروج تلقائي بعد عدم نشاط ────────────────────────────────────────
var _lastActivity = Date.now();
var _autoLogoutMs = 60 * 60 * 1000; // ساعة واحدة
['click','keydown','touchstart'].forEach(function(ev) {
  document.addEventListener(ev, function() { _lastActivity = Date.now(); });
});
setInterval(function() {
  if (!token) return;
  if (Date.now() - _lastActivity > _autoLogoutMs) {
    toast('تم تسجيل خروجك تلقائياً لعدم النشاط', 'info');
    setTimeout(logout, 2000);
  }
}, 60000);


function showPendingScreen() {
  var nav = document.querySelector('.bottom-nav');
  if (nav) nav.style.display = 'none';

  var pending = document.getElementById('pending-screen');
  if (!pending) {
    pending = document.createElement('div');
    pending.id = 'pending-screen';
    pending.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:var(--bg);z-index:999;overflow-y:auto;padding:20px;display:flex;flex-direction:column';
    document.body.appendChild(pending);
  }

  // Header مثل المستخدم العادي
  pending.innerHTML =
    // شريط علوي
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;padding:12px 16px;background:var(--surface);border-radius:16px;border:1px solid var(--border)">' +
      '<div style="font-size:1.1rem;font-weight:900;color:var(--accent)">PORTE</div>' +
      '<button id="pending-logout-btn" style="padding:8px 18px;border-radius:10px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-family:Cairo,sans-serif;font-size:0.85rem;font-weight:700;cursor:pointer">تسجيل الخروج</button>' +
    '</div>' +

    // رسالة الانتظار
    '<div style="background:var(--surface);border:1px solid rgba(255,179,0,0.3);border-radius:20px;padding:24px;margin-bottom:16px;text-align:center">' +
      '<div style="font-size:3rem;margin-bottom:12px">⏳</div>' +
      '<div style="font-size:1.1rem;font-weight:900;color:var(--warning);margin-bottom:8px">طلبك قيد المراجعة</div>' +
      '<div style="color:var(--muted);font-size:0.85rem;line-height:1.8">' +
        'تم إرسال طلب انضمامك للمسؤول.<br>ستتلقى إشعاراً فور الموافقة.' +
      '</div>' +
    '</div>' +

    // أبواب مجمدة (placeholder)
    '<div style="background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:20px;margin-bottom:12px;opacity:0.4;pointer-events:none">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">' +
        '<div style="font-size:1rem;font-weight:800;color:var(--muted)">🚪 الباب الرئيسي</div>' +
        '<span style="font-size:0.75rem;padding:3px 10px;border-radius:20px;background:var(--surface2);color:var(--muted)">—</span>' +
      '</div>' +
      '<div style="width:100%;aspect-ratio:4/3;background:var(--surface2);border-radius:12px;margin-bottom:12px;display:flex;align-items:center;justify-content:center">' +
        '<span style="font-size:2rem;opacity:0.3">🔒</span>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">' +
        '<div style="padding:14px 4px;border-radius:14px;background:var(--surface2);text-align:center;font-size:0.8rem;color:var(--muted)">فتح</div>' +
        '<div style="padding:14px 4px;border-radius:14px;background:var(--surface2);text-align:center;font-size:0.8rem;color:var(--muted)">غلق</div>' +
        '<div style="padding:14px 4px;border-radius:14px;background:var(--surface2);text-align:center;font-size:0.8rem;color:var(--muted)">إيقاف</div>' +
        '<div style="padding:14px 4px;border-radius:14px;background:var(--surface2);text-align:center;font-size:0.8rem;color:var(--muted)">40ث</div>' +
      '</div>' +
    '</div>' +

    '<div style="background:rgba(255,179,0,0.08);border:1px solid rgba(255,179,0,0.2);border-radius:14px;padding:14px;text-align:center;color:var(--warning);font-size:0.82rem">' +
      '🔔 تأكد من تفعيل الإشعارات لاستلام رد المسؤول' +
    '</div>';

  pending.style.display = 'flex';

  // زر الخروج بعد الرندر
  setTimeout(function() {
    var btn = document.getElementById('pending-logout-btn');
    if (btn) btn.addEventListener('click', function() { logout(); });
  }, 100);
}

// ─── Boot ─────────────────────────────────────
function bootApp() {
  selectedInstId = null; // صفّر عند كل تشغيل
  document.getElementById('main-app').style.display = 'block';

  const roleBadge = document.getElementById('header-role-badge');
  const roleLabels = { user:'مستخدم', admin:'مدير', super_admin:'سوبر أدمن' };
  if (user.role === 'super_admin') {
    roleBadge.textContent = roleLabels[user.role] || user.role;
    roleBadge.className = 'role-badge role-super';
  } else {
    // إخفاء role badge للأدمن والمستخدم
    roleBadge.style.display = 'none';
  }

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
    // إظهار header bar كاملاً للسوبر أدمن فقط
    var instHeaderBar = document.getElementById('inst-header-bar');
    if (instHeaderBar) instHeaderBar.style.display = 'flex';
    var instTitle2 = document.getElementById('inst-page-title');
    var instAddBtn2 = document.getElementById('inst-add-btn');
    if (instTitle2)  instTitle2.style.display  = 'block';
    if (instAddBtn2) instAddBtn2.style.display = 'flex';
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
    // إضافة اسم المؤسسة في الـ header
    apiFetch('/api/institutes').then(function(insts) {
      var inst = Array.isArray(insts) ? insts[0] : null;
      if (!inst) return;
      var logo = document.querySelector('.header-logo');
      if (logo) {
        var instSpan = document.getElementById('header-inst-name');
        if (!instSpan) {
          instSpan = document.createElement('span');
          instSpan.id = 'header-inst-name';
          instSpan.style.cssText = 'font-size:0.78rem;font-weight:700;color:var(--muted);margin-right:8px;padding:3px 10px;background:var(--surface2);border-radius:20px;border:1px solid var(--border)';
          logo.parentNode.insertBefore(instSpan, logo.nextSibling);
        }
        instSpan.textContent = inst.name;
      }
    }).catch(function(){});
    loadAdminDoors();
    updatePendingBadge();
    setInterval(updatePendingBadge, 30000); // تحديث كل 30 ثانية
    // إخفاء عنوان "المؤسسات" وزر الإضافة للأدمن
    var addInstBtn = document.getElementById('inst-add-btn');
    if (addInstBtn) addInstBtn.style.display = 'none';
    var instTitle = document.getElementById('inst-page-title');
    if (instTitle) instTitle.style.display = 'none';
    var instBackBtn = document.getElementById('inst-back-btn');
    if (instBackBtn) instBackBtn.style.display = 'none';
  } else {
    document.querySelectorAll('.nav-item').forEach(function(n){ n.style.display = 'none'; });
    document.getElementById('nav-institutes').style.display = 'flex';
    // تغيير كلمة "المؤسسات" إلى "الأبواب" للمستخدم
    var navLabel = document.getElementById('nav-institutes-label');
    if (navLabel) navLabel.textContent = '';

    // ملء معلومات الإعدادات
    var sName  = document.getElementById('settings-name');
    var sPhone = document.getElementById('settings-phone');
    if (sName)  sName.textContent  = user.name  || '';
    if (sPhone) sPhone.textContent = user.phone || '';

    // إضافة زر الإعدادات في الهيدر
    var headerUser = document.querySelector('.header-user');
    if (headerUser && !document.getElementById('settings-btn')) {
      var settBtn = document.createElement('button');
      settBtn.id = 'settings-btn';
      settBtn.onclick = showSettings;
      settBtn.title = 'الإعدادات';
      settBtn.style.cssText = 'width:36px;height:36px;border-radius:50%;background:rgba(0,212,255,0.1);border:1px solid rgba(0,212,255,0.2);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:1rem';
      settBtn.textContent = '⚙️';
      headerUser.insertBefore(settBtn, headerUser.firstChild);
    }

    // إذا المستخدم في انتظار الموافقة → عرض رسالة
    if (user.request_status === 'pending') {
      showPendingScreen();
      return;
    }
    document.getElementById('nav-institutes').classList.add('active');
    document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
    document.getElementById('page-institutes').classList.add('active');
    startUserLocationTracking();
    // إضافة اسم المستخدم في الهيدر
    apiFetch('/api/institutes').then(function(insts) {
      var inst = Array.isArray(insts) ? insts[0] : null;
      var logo = document.querySelector('.header-logo');
      if (logo && inst) {
        var existing = document.getElementById('header-inst-name');
        if (!existing) {
          var instSpan = document.createElement('div');
          instSpan.id = 'header-inst-name';
          instSpan.style.cssText = 'display:flex;flex-direction:column;align-items:center;margin-right:8px';
          instSpan.innerHTML =
            '<span style="font-size:0.82rem;font-weight:800;color:var(--text)">' + inst.name + '</span>' +
            '<span style="font-size:0.72rem;color:var(--accent)">مرحبا ' + (user.name||'') + '</span>';
          logo.parentNode.insertBefore(instSpan, logo.nextSibling);
        }
      }
    }).catch(function(){});
    // إخفاء عناصر غير ضرورية للمستخدم
    var addBtn = document.getElementById('inst-add-btn');
    if (addBtn) addBtn.style.display = 'none';
    var pageTitle = document.querySelector('#page-institutes .page-title');
    if (pageTitle) pageTitle.style.display = 'none';
    var instTitleU = document.getElementById('inst-page-title');
    if (instTitleU) instTitleU.style.display = 'none';
    var instBackBtnU = document.getElementById('inst-back-btn');
    if (instBackBtnU) instBackBtnU.style.display = 'none';
    loadUserDoors();
  }
}


async function updatePendingBadge() {
  try {
    var insts = await apiFetch('/api/institutes');
    var inst = Array.isArray(insts) ? insts[0] : null;
    if (!inst) return;
    var users = await apiFetch('/api/users?inst_id=' + inst.id);
    var pending = (users||[]).filter(function(u){ return u.request_status === 'pending'; });
    var navUsers = document.getElementById('nav-users');
    if (!navUsers) return;
    var existing = document.getElementById('pending-badge');
    if (pending.length > 0) {
      if (!existing) {
        existing = document.createElement('span');
        existing.id = 'pending-badge';
        existing.style.cssText = 'position:absolute;top:2px;right:2px;min-width:18px;height:18px;background:var(--danger);color:#fff;border-radius:20px;font-size:0.65rem;font-weight:900;display:flex;align-items:center;justify-content:center;padding:0 4px';
        navUsers.style.position = 'relative';
        navUsers.appendChild(existing);
      }
      existing.textContent = pending.length;
    } else if (existing) {
      existing.remove();
    }
  } catch(e) {}
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
        // عند التوقف — أوقف الانيميشن فوراً
        if (msg.action === 'stop' || msg.action === 'auto_stop') {
          // ابحث عن كل الأبواب وأوقف timers
          Object.keys(doorTimers).forEach(function(dId) {
            var imgEl   = document.getElementById('door-img-' + dId);
            var stateEl = document.getElementById('user-state-' + dId)
                       || document.getElementById('door-progress-bar-' + dId)
                       || document.getElementById('door-progress-' + dId);
            stopDoorTimer(dId, imgEl, stateEl);
          });
        }
      }
      // تحديث حالة الباب من Polling
      if (msg.type === 'door_state') {
        var r1       = msg.r1_on, r2 = msg.r2_on;
        var rawState = r1 ? 'open' : r2 ? 'close' : 'idle';
        var doorId   = msg.doorId;
        var hasTimer = !!doorTimers[doorId];

        updateDoorStatusUI(rawState);

        // idle: تجاهل — Tuya يبعثه بعد كل نبضة
        if (rawState === 'idle') {
          // لكن حدّث السجل إذا كان RC
          if (msg.source === 'rc') setTimeout(loadRecentHistory, 500);
          return;
        }

        var imgEl   = document.getElementById('door-img-' + doorId);
        var stateEl = document.getElementById('user-state-' + doorId)
                   || document.getElementById('door-progress-bar-' + doorId)
                   || document.getElementById('door-progress-' + doorId);
        // نسبة منفصلة لصفحة الأدمن
        var pctEl = document.getElementById('door-pct-' + doorId);
        var durEl   = document.querySelector('[data-door-id="' + doorId + '"]');
        var nSecs   = durEl ? parseInt(durEl.getAttribute('data-duration') || '5') : 5;
        var newIsOpen = (rawState === 'open' || rawState === 'open40');

        if (msg.source === 'rc') {
          lastKnownState[doorId] = rawState;
          if (hasTimer) {
            var t = doorTimers[doorId];
            if (t.isOpen === newIsOpen) {
              // نفس الاتجاه = ضغط نفس الزر → إيقاف
              stopDoorTimer(doorId, imgEl, stateEl);
            } else {
              // اتجاه معاكس → أوقف وابدأ من الموضع الحالي
              stopDoorTimer(doorId, imgEl, stateEl);
              // doorPos يبقى على الموضع الحالي
              var img2 = document.getElementById('door-img-' + doorId);
              var st2  = document.getElementById('user-state-' + doorId)
                      || document.getElementById('door-progress-' + doorId);
              startDoorTimer(doorId, img2, st2, nSecs, rawState);
              updateDoorCardState(doorId, msg.deviceId, rawState, 'rc');
            }
          } else {
            doorPos[doorId] = newIsOpen ? 0.0 : 1.0;
            startDoorTimer(doorId, imgEl, stateEl, nSecs, rawState);
            updateDoorCardState(doorId, msg.deviceId, rawState, 'rc');
          }
          setTimeout(loadRecentHistory, 500);
        } else {
          // أمر من التطبيق — أوقف الـ timer القديم وابدأ الجديد
          lastKnownState[doorId] = rawState;
          if (hasTimer) {
            var t = doorTimers[doorId];
            if (t.isOpen === newIsOpen) {
              // نفس الاتجاه → إيقاف
              stopDoorTimer(doorId, imgEl, stateEl);
            } else {
              // اتجاه معاكس → أوقف وابدأ من الموضع الحالي
              stopDoorTimer(doorId, imgEl, stateEl);
              // doorPos يبقى على الموضع الحالي — لا نعيد تعيينه
              startDoorTimer(doorId, imgEl, stateEl, nSecs, rawState);
              updateDoorCardState(doorId, msg.deviceId, rawState, msg.source);
            }
          } else {
            startDoorTimer(doorId, imgEl, stateEl, nSecs, rawState);
            updateDoorCardState(doorId, msg.deviceId, rawState, msg.source);
          }
        }
      }
      if (msg.type === 'new_join_request') {
        // إشعار للأدمن بطلب انضمام جديد
        if (user && (user.role === 'admin' || user.role === 'super_admin')) {
          toast('👤 طلب انضمام جديد: ' + msg.userName, 'info');
          // تحديث قائمة المستخدمين إذا كانت مفتوحة
          if (document.getElementById('page-users')?.classList.contains('active')) {
            loadAdminUsers();
          }
          // badge على تبويب المستخدمين
          var navUsers = document.getElementById('nav-users');
          if (navUsers && !navUsers.querySelector('.notif-dot')) {
            var dot = document.createElement('span');
            dot.className = 'notif-dot';
            dot.style.cssText = 'width:8px;height:8px;background:var(--danger);border-radius:50%;position:absolute;top:4px;right:4px';
            navUsers.style.position = 'relative';
            navUsers.appendChild(dot);
          }
        }
      }
      if (msg.type === 'request_approved') {
        user.request_status = 'approved';
        localStorage.setItem('porte_user', JSON.stringify(user));
        toast('✅ تمت الموافقة على طلبك! مرحباً بك', 'success');
        // إعادة تهيئة الواجهة كاملاً بعد الموافقة
        var ps = document.getElementById('pending-screen');
        if (ps) ps.remove();
        setTimeout(function() { bootApp(); }, 1500);
      }
      if (msg.type === 'request_rejected') {
        toast('❌ تم رفض طلب انضمامك', 'error');
        setTimeout(logout, 2000);
      }
      if (msg.type === 'device_online') {
        updateDeviceOnlineBadge(msg.deviceId, msg.online);
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

// ═══════════════════════════════════════════
// نظام تتبع موضع الباب (0=مغلق، 1=مفتوح)
// ═══════════════════════════════════════════
const doorPos         = {};
const doorTimers      = {};
const doorCompletedAt = {};
const lastKnownState  = {};

function startDoorTimer(doorId, imgEl, stateEl, seconds, action) {
  if (doorTimers[doorId] && doorTimers[doorId]._raf) {
    cancelAnimationFrame(doorTimers[doorId]._raf);
  }

  var isOpen = (action === 'open' || action === 'open40');
  var n      = Math.max(seconds, 1); // بدون هامش — نفس مدة الـ relay

  if (doorPos[doorId] === undefined) {
    doorPos[doorId] = isOpen ? 0.0 : 1.0;
  }

  var fromPos = doorPos[doorId];
  var toPos   = isOpen ? 1.0 : 0.0;
  var dist    = Math.abs(toPos - fromPos);

  if (dist <= 0.01) return;

  // المدة الفعلية = n * نسبة المسافة المتبقية
  var startTime = Date.now();
  var totalMs   = n * 1000 * dist;
  var gen       = ((doorTimers[doorId] || {gen: 0}).gen || 0) + 1;

  doorTimers[doorId] = { _raf: null, startTime: startTime, isOpen: isOpen, gen: gen };

  function tick() {
    var t = doorTimers[doorId];
    if (!t || t.gen !== gen) return;

    var elapsed    = Date.now() - startTime;
    var progress   = Math.min(elapsed / totalMs, 1);
    var pos        = fromPos + (toPos - fromPos) * progress;
    doorPos[doorId] = pos;

    // النسبة: للفتح = pos، للغلق = (1-pos)
    var displayPct = isOpen ? pos : (1 - pos);
    _drawDoorProgress(imgEl, stateEl, displayPct, isOpen, false, pos);
    if (typeof pctEl !== 'undefined' && pctEl) {
      pctEl.style.color = isOpen ? 'var(--success)' : 'var(--danger)';
      pctEl.textContent = Math.round(displayPct * 100) + '%';
    }

    if (progress < 1) {
      t._raf = requestAnimationFrame(tick);
    } else {
      doorPos[doorId] = toPos;
      delete doorTimers[doorId];
      doorCompletedAt[doorId] = Date.now();
      var finalState = isOpen ? 'open' : 'close';
      lastKnownState[doorId] = finalState;
      setTimeout(function() {
        _drawDoorStatic(imgEl, stateEl, finalState);
        // تحديث door-progress- بالحالة النهائية
        var progFinal = document.getElementById('door-progress-' + doorId);
        if (progFinal) {
          var pfColor = finalState === 'open' ? 'var(--success)' : 'var(--danger)';
          var pfIcon  = finalState === 'open' ? '🔓' : '🔒';
          var pfLabel = finalState === 'open' ? 'الباب مفتوح' : 'الباب مغلق';
          progFinal.style.cssText = 'background:var(--surface2);border-radius:10px;padding:10px 14px;display:flex;align-items:center;gap:8px;color:' + pfColor + ';font-weight:700;font-size:0.9rem';
          progFinal.innerHTML = '<span style="font-size:1.1rem">' + pfIcon + '</span>' + pfLabel;
        }
        updateDoorCardState(doorId, null, finalState, 'auto');
      }, 400);
    }
  }

  doorTimers[doorId]._raf = requestAnimationFrame(tick);
}

function stopDoorTimer(doorId, imgEl, stateEl) {
  var t = doorTimers[doorId];
  if (t && t._raf) cancelAnimationFrame(t._raf);
  var isOpen = t ? t.isOpen : ((doorPos[doorId] || 0) >= 0.5);
  delete doorTimers[doorId];

  var pos        = doorPos[doorId] !== undefined ? doorPos[doorId] : 0;
  var displayPct = isOpen ? pos : (1 - pos);
  var pctInt     = Math.round(displayPct * 100);

  var img = imgEl || document.getElementById('door-img-' + doorId);
  var ste = stateEl
         || document.getElementById('user-state-' + doorId)
         || document.getElementById('door-progress-bar-' + doorId)
         || document.getElementById('door-progress-' + doorId);

  _drawDoorProgress(img, ste, displayPct, isOpen, true, pos);


  var stopCss = 'font-size:0.7rem;font-weight:700;padding:3px 10px;border-radius:20px;background:rgba(255,179,0,0.15);color:var(--warning);border:1px solid rgba(255,179,0,0.3)';
  var stopTxt = '⏹ متوقف — ' + pctInt + '%';
  ['adm-status-', 'door-status-'].forEach(function(pfx) {
    var el = document.getElementById(pfx + doorId);
    if (el) { el.textContent = stopTxt; el.style.cssText = stopCss; }
  });
}

function _cancelDoorTimer(doorId) {
  if (doorTimers[doorId] && doorTimers[doorId]._raf) {
    cancelAnimationFrame(doorTimers[doorId]._raf);
  }
  delete doorTimers[doorId];
}

// رسم الباب أثناء الحركة
function _getDoorType(imgEl) {
  if (!imgEl) return 'battante';
  var doorId = imgEl.getAttribute('data-door-id') || imgEl.id.replace('door-img-','');
  var doorEl = doorId ? document.querySelector('[data-door-id="' + doorId + '"]') : null;
  return (doorEl && doorEl.getAttribute('data-door-type')) || 'battante';
}

function _drawDoorSVG(type, color, pos, pct, isStopped) {
  var pctInt = Math.round(pct * 100);

  if (type === 'coulissante') {
    // باب منزلق — يتحرك من اليمين لليسار
    var slideX = pos * 56; // 0=مغلق, 56=مفتوح كاملاً
    return '<svg viewBox="0 0 80 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">' +
      // إطار
      '<rect x="4" y="8" width="72" height="70" rx="3" fill="none" stroke="' + color + '" stroke-width="1.5" opacity="0.3"/>' +
      // مسار الانزلاق
      '<line x1="4" y1="12" x2="76" y2="12" stroke="' + color + '" stroke-width="1" opacity="0.3"/>' +
      // الباب المنزلق
      '<rect x="' + (4 + slideX).toFixed(1) + '" y="14" width="40" height="62" rx="2" fill="' + color + '" fill-opacity="0.18" stroke="' + color + '" stroke-width="1.6"/>' +
      // مقبض
      '<rect x="' + (36 + slideX).toFixed(1) + '" y="42" width="4" height="16" rx="2" fill="' + color + '" opacity="0.9"/>' +
      // نسبة
''  +
      '</svg>';

  } else if (type === 'garage') {
    // باب مرآب — يرفع من الأسفل
    var liftY = pos * 64; // 0=مغلق, 64=مفتوح
    var doorY = 78 - liftY;
    return '<svg viewBox="0 0 80 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">' +
      // إطار
      '<rect x="4" y="8" width="72" height="72" rx="3" fill="none" stroke="' + color + '" stroke-width="1.5" opacity="0.3"/>' +
      // الباب (يرتفع)
      '<rect x="6" y="' + (doorY - 62).toFixed(1) + '" width="68" height="62" rx="2" fill="' + color + '" fill-opacity="0.18" stroke="' + color + '" stroke-width="1.5" clip-path="url(#garage-clip)"/>' +
      '<defs><clipPath id="garage-clip"><rect x="4" y="8" width="72" height="72"/></clipPath></defs>' +
      // خطوط أفقية (لوحات)
      '<line x1="6" y1="' + (doorY - 42).toFixed(1) + '" x2="74" y2="' + (doorY - 42).toFixed(1) + '" stroke="' + color + '" stroke-width="0.8" opacity="0.4" clip-path="url(#garage-clip)"/>' +
      '<line x1="6" y1="' + (doorY - 22).toFixed(1) + '" x2="74" y2="' + (doorY - 22).toFixed(1) + '" stroke="' + color + '" stroke-width="0.8" opacity="0.4" clip-path="url(#garage-clip)"/>' +
      // نسبة
''  +
      '</svg>';

  } else if (type === 'portail') {
    // بوابة — بابان ينفتحان من المنتصف
    var halfAngle = pos * 75; // كل باب يفتح 75 درجة
    return '<svg viewBox="0 0 80 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">' +
      // إطار
      '<rect x="4" y="8" width="72" height="70" rx="3" fill="none" stroke="' + color + '" stroke-width="1.5" opacity="0.3"/>' +
      // الباب الأيسر
      '<g style="transform:rotate(-' + halfAngle.toFixed(1) + 'deg);transform-origin:8px 43px">' +
        '<rect x="8" y="12" width="32" height="62" rx="2" fill="' + color + '" fill-opacity="0.18" stroke="' + color + '" stroke-width="1.5"/>' +
        '<circle cx="36" cy="43" r="2.5" fill="' + color + '" opacity="0.9"/>' +
      '</g>' +
      // الباب الأيمن
      '<g style="transform:rotate(' + halfAngle.toFixed(1) + 'deg);transform-origin:72px 43px">' +
        '<rect x="40" y="12" width="32" height="62" rx="2" fill="' + color + '" fill-opacity="0.18" stroke="' + color + '" stroke-width="1.5"/>' +
        '<circle cx="44" cy="43" r="2.5" fill="' + color + '" opacity="0.9"/>' +
      '</g>' +
      // نسبة
''  +
      '</svg>';

  } else {
    // battante — باب عادي يفتح بزاوية
    var angleDeg = -(pos * 75);
    var handleX  = 20 + (pos * 40);
    var arcPath  = pct > 0.005 ? _describeArc(8, 43, 14, 0, pos * 80) : '';
    return '<svg viewBox="0 0 80 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">' +
      '<rect x="4" y="2" width="72" height="82" rx="5" fill="none" stroke="' + color + '" stroke-width="1.8" opacity="0.3"/>' +
      '<g style="transform:rotate(' + angleDeg.toFixed(2) + 'deg);transform-origin:8px 43px">' +
        '<rect x="8" y="4" width="64" height="78" rx="3" fill="' + color + '" fill-opacity="0.15" stroke="' + color + '" stroke-width="1.6"/>' +
        '<circle cx="' + handleX.toFixed(1) + '" cy="43" r="3.5" fill="' + color + '" opacity="0.95"/>' +
      '</g>' +
      (arcPath ? '<path d="' + arcPath + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" opacity="0.4"/>' : '') +
''  +
      '</svg>';
  }
}

function _drawDoorProgress(imgEl, stateEl, pct, isOpen, isStopped, curPos) {
  var pctInt    = Math.round(pct * 100);
  var color     = isStopped ? '#ffb300' : isOpen ? '#00e676' : '#ff3d71';
  var statusTxt = isStopped ? ('⏹ الباب متوقف — ' + pctInt + '%')
                : isOpen    ? ('🔓 الباب يفتح... — ' + pctInt + '%')
                :             ('🔒 الباب يغلق... — ' + pctInt + '%');
  var pos  = curPos !== undefined ? curPos : (isOpen ? pct : 1 - pct);
  var type = _getDoorType(imgEl);

  if (imgEl) {
    imgEl.innerHTML = _drawDoorSVG(type, color, pos, pct, isStopped);
  }

  if (stateEl) {
    stateEl.style.color      = color;
    stateEl.style.background = 'var(--surface2)';
    stateEl.style.display    = 'flex';
    stateEl.style.alignItems = 'center';
    stateEl.style.justifyContent = 'flex-end';
    stateEl.style.padding    = '10px 14px';
    stateEl.style.borderRadius = '10px';
    stateEl.style.fontWeight = '700';
    stateEl.style.fontSize   = '0.9rem';
    stateEl.innerHTML = '<span style="font-size:1.1rem;margin-left:8px">' + (isStopped ? '⏹' : isOpen ? '🔓' : '🔒') + '</span>' +
      (isStopped ? 'الباب متوقف' : isOpen ? 'الباب يفتح...' : 'الباب يغلق...');
    // تحديث door-pct- بالنسبة
    var doorIdFromEl = stateEl.id ? stateEl.id.replace('user-state-','').replace('door-progress-','') : null;
    if (doorIdFromEl) {
      var pctDisplay = document.getElementById('door-pct-' + doorIdFromEl);
      if (pctDisplay) {
        pctDisplay.style.color = color;
        pctDisplay.textContent = pctInt + '%';
      }
    }
  }
}

// رسم الباب في حالة ثابتة
function _drawDoorStatic(imgEl, stateEl, state) {
  var color  = state === 'open' ? '#00e676' : state === 'close' ? '#ff3d71' : '#ffb300';
  var label  = state === 'open' ? 'الباب مفتوح' : state === 'close' ? 'الباب مغلق' : 'الباب متوقف';
  var icon   = state === 'open' ? '🔓' : state === 'close' ? '🔒' : '⏹';
  var pos    = state === 'open' ? 1.0 : 0.0;
  var pct    = state === 'open' ? 1.0 : 0.0;
  var type   = _getDoorType(imgEl);

  if (imgEl) {
    imgEl.innerHTML = _drawDoorSVG(type, color, pos, pct, false);
  }
  if (stateEl) {
    stateEl.style.color      = color;
    stateEl.style.background = 'var(--surface2)';
    stateEl.innerHTML        = icon + ' ' + label;
  }
}

function renderDoorSVG(container, state) { _drawDoorStatic(container, null, state); }
function _updateStateEl(el, state)       { _drawDoorStatic(null, el, state); }

function _describeArc(cx, cy, r, startDeg, endDeg) {
  if (endDeg >= 360) endDeg = 359.99;
  function polar(deg) {
    var rad = (deg - 90) * Math.PI / 180;
    return { x: (cx + r * Math.cos(rad)).toFixed(2), y: (cy + r * Math.sin(rad)).toFixed(2) };
  }
  var s = polar(startDeg), e = polar(endDeg);
  return 'M ' + s.x + ' ' + s.y + ' A ' + r + ' ' + r + ' 0 ' + (endDeg > 180 ? 1 : 0) + ' 1 ' + e.x + ' ' + e.y;
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

// إرسال أمر لباب محدد من صفحة المؤسسات
async function sendDoorAction(deviceId, action, duration) {
  try {
    var body = { action, deviceId, duration };
    // أرسل الموقع دائماً إذا كان متوفراً
    if (userLocation) { body.lat = userLocation.lat; body.lng = userLocation.lng; body.accuracy = userLocation.accuracy || 999; }
    await apiFetch('/api/door/control', 'POST', body);
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
      <td><span class="badge ${u.status==='active'?'badge-active':'badge-blocked'}">${u.status==='active'?'نشط':'مجمّد'}</span></td>
      <td style="white-space:nowrap">
        <button onclick="editUser(${JSON.stringify(u).replace(/"/g,'&quot;')})" style="background:none;border:none;color:var(--accent2);cursor:pointer;font-size:0.78rem;margin-left:8px">تعديل</button>
        <button onclick="toggleBlock('${u.id}','${u.status}')" style="background:none;border:none;color:${u.status==='active'?'var(--warning)':'#7ec8ff'};cursor:pointer;font-size:0.78rem">${u.status==='active'?'🧊 تجميد العضوية':'🔓 رفع التجميد'}</button>
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
          <button onclick="openEditDoor('${inst.id}','${doorId}','${doorName}','${location}','${deviceId}',${duration},'${door.door_type||'battante'}')" style="background:rgba(124,92,252,0.15);border:1px solid rgba(124,92,252,0.3);border-radius:12px;padding:12px 6px;cursor:pointer;font-size:1.1rem" title="تعديل">✏️</button>
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


function selectDoorType(type) {
  document.getElementById('door-type').value = type;
  document.querySelectorAll('.door-type-btn').forEach(function(btn) {
    if (btn.getAttribute('data-type') === type) {
      btn.style.background = 'rgba(0,212,255,0.15)';
      btn.style.border = '2px solid var(--accent)';
    } else {
      btn.style.background = 'var(--surface2)';
      btn.style.border = '2px solid var(--border)';
    }
  });
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
  selectDoorType('battante');
  openModal('modal-door');
}

function openEditDoor(instId, doorId, name, location, deviceId, duration, doorType) {
  document.getElementById('edit-door-id').value = doorId;
  document.getElementById('edit-door-inst-id').value = instId;
  document.getElementById('door-name').value = name;
  document.getElementById('door-location').value = location;
  document.getElementById('door-device-id').value = deviceId;
  document.getElementById('door-duration').value = duration;
  document.getElementById('door-duration-val').textContent = duration;
  document.getElementById('door-modal-title').textContent = 'تعديل باب';
  selectDoorType(doorType || 'battante');
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
    door_type:        document.getElementById('door-type').value || 'battante',
  };
  try {
    if (id) { await apiFetch(`/api/doors/${id}`, 'PUT', body); }
    else    { await apiFetch('/api/doors', 'POST', body); }
    closeModal('modal-door');
    // تحديث نوع الباب في DOM فوراً بدون reload
    if (id && body.door_type) {
      var newType = body.door_type;
      // تحديث كل العناصر التي تحمل data-door-id
      document.querySelectorAll('[data-door-id="' + id + '"]').forEach(function(el) {
        el.setAttribute('data-door-type', newType);
        if (el.id && el.id.startsWith('door-img-')) {
          // إعادة رسم الصورة بالنوع الجديد
          el.setAttribute('data-door-type', newType);
          var state = lastKnownState[id] || 'close';
          _drawDoorStatic(el, null, state);
        }
      });
      // تحديث cards
      document.querySelectorAll('[data-door-id]').forEach(function(card) {
        if (card.getAttribute('data-door-id') === id) {
          card.setAttribute('data-door-type', newType);
        }
      });
    }
    toast('تم الحفظ', 'success');
    // إعادة تحميل لضمان التزامن
    if (user && user.role === 'super_admin') loadInstitutes();
    else if (user && user.role === 'admin') loadAdminDoors();
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
    var data = await apiFetch('/api/users?inst_id=' + instId);
    var filtered = (data||[]).filter(function(u) { return u.role !== 'super_admin'; });
    // pending أولاً
    filtered.sort(function(a,b){
      var o={pending:0,approved:1,rejected:2};
      return (o[a.request_status||'approved']||1)-(o[b.request_status||'approved']||1);
    });
    var body = document.getElementById('inst-users-body');
    if (!filtered.length) {
      body.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px">لا يوجد مستخدمون</p>';
      return;
    }
    body.innerHTML = '';
    var statusColors = { pending:'var(--warning)', approved:'transparent', rejected:'var(--danger)' };
    var statusLabels = { pending:'انتظار', approved:'', rejected:'مرفوض' };
    var roleLabels   = { user:'مستخدم', admin:'مدير' };

    filtered.forEach(function(u) {
      var status    = u.request_status || 'approved';
      var isBlocked = u.status === 'blocked';
      var isAdminRole = u.role === 'admin';

      var card = document.createElement('div');
      card.style.cssText = 'background:' + (isBlocked?'rgba(80,80,100,0.15)':'var(--surface2)') + ';border-radius:14px;padding:14px;margin-bottom:10px;border:' + (isBlocked?'1px solid rgba(100,180,255,0.2)':'1px solid transparent') + ';';

      // Info row
      var blockedBadge = isBlocked ? '<span style="font-size:0.68rem;font-weight:700;padding:2px 8px;border-radius:20px;background:rgba(100,180,255,0.15);color:#7ec8ff;margin-right:4px">🧊 مجمّد</span>' : '';
      var infoRow = document.createElement('div');
      infoRow.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px';
      infoRow.innerHTML =
        '<div>' +
          '<div style="font-weight:700;font-size:0.92rem">' + u.name + '</div>' +
          '<div style="font-family:JetBrains Mono,monospace;font-size:0.75rem;color:var(--muted);margin-top:2px">📞 ' + formatPhone(u.phone) + '</div>' +
          '<div style="font-size:0.7rem;color:var(--accent2);margin-top:2px">' + (roleLabels[u.role]||u.role) + '</div>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">' +
          blockedBadge +
          '<span style="font-size:0.7rem;font-weight:700;padding:3px 10px;border-radius:20px;background:rgba(0,0,0,0.2);color:' + statusColors[status] + '">' + (statusLabels[status]||status) + '</span>' +
        '</div>';
      card.appendChild(infoRow);

      // Buttons
      var bRow = document.createElement('div');
      bRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px';

      if (!isAdminRole) {
        if (status === 'pending') {
          [['✅ موافقة','approved','rgba(0,230,118,0.15)','var(--success)'],
           ['❌ رفض','rejected','rgba(255,61,113,0.15)','var(--danger)']
          ].forEach(function(item) {
            var b = document.createElement('button');
            b.style.cssText = 'flex:1;padding:7px 8px;border-radius:8px;border:none;background:'+item[2]+';color:'+item[3]+';font-family:Cairo,sans-serif;font-size:0.75rem;font-weight:700;cursor:pointer';
            b.textContent = item[0];
            b.addEventListener('click', (function(uid,act,iid){ return function(){ changeUserStatus(uid,act,iid,instName); loadAdminUsers && setTimeout(loadAdminUsers,200); }; })(u.id,item[1],instId));
            bRow.appendChild(b);
          });
        } else {
          // تجميد/رفع التجميد
          var btnBlock = document.createElement('button');
          btnBlock.setAttribute('data-uid', u.id);
          btnBlock.setAttribute('data-ustatus', u.status);
          btnBlock.setAttribute('data-uname', u.name);
          btnBlock.style.padding = '7px 12px';
          btnBlock.style.borderRadius = '8px';
          btnBlock.style.border = 'none';
          btnBlock.style.background = isBlocked ? 'rgba(100,180,255,0.2)' : 'rgba(255,179,0,0.15)';
          btnBlock.style.color = isBlocked ? '#7ec8ff' : '#ffb300';
          btnBlock.style.fontFamily = 'Cairo,sans-serif';
          btnBlock.style.fontSize = '0.75rem';
          btnBlock.style.fontWeight = '700';
          btnBlock.style.cursor = 'pointer';
          btnBlock.textContent = isBlocked ? '🔓 رفع التجميد' : '🧊 تجميد العضوية';
          btnBlock.addEventListener('click', function(){
            var uid=this.getAttribute('data-uid'), st=this.getAttribute('data-ustatus'), uname=this.getAttribute('data-uname');
            var action = st==='active'?'تجميد العضوية':'رفع التجميد';
            if (!confirm('هل أنت متأكد من '+action+' لـ '+uname+'؟')) return;
            apiFetch('/api/users/'+uid,'PUT',{status:st==='active'?'blocked':'active'})
              .then(function(){ toast('✅ تم '+action,'success'); openInstUsers(instId,instName); })
              .catch(function(e){ toast(e.message,'error'); });
          });
          bRow.appendChild(btnBlock);

          // زر السجل
          var btnLogI = document.createElement('button');
          btnLogI.style.cssText = 'padding:7px 10px;border-radius:8px;border:none;background:rgba(0,212,255,0.15);color:var(--accent);font-family:Cairo,sans-serif;font-size:0.75rem;font-weight:700;cursor:pointer';
          btnLogI.textContent = '📋 السجل';
          btnLogI.addEventListener('click', (function(uid,uname){ return function(){ openUserLog(uid,uname); }; })(u.id,u.name));
          bRow.appendChild(btnLogI);
        }

        // زر كلمة السر للسوبر أدمن
        if (user && user.role === 'super_admin') {
          var btnPw = document.createElement('button');
          btnPw.style.cssText = 'padding:7px 10px;border-radius:8px;border:none;background:rgba(124,92,252,0.15);color:var(--accent2);font-family:Cairo,sans-serif;font-size:0.75rem;font-weight:700;cursor:pointer';
          btnPw.textContent = '👁 كلمة السر';
          btnPw.addEventListener('click', (function(uid,uname){ return function(){ resetUserPw(uid,uname); }; })(u.id,u.name));
          bRow.appendChild(btnPw);
        }

        // زر حذف
        var btnDel = document.createElement('button');
        btnDel.style.cssText = 'padding:7px 10px;border-radius:8px;border:none;background:rgba(255,61,113,0.1);color:var(--danger);font-family:Cairo,sans-serif;font-size:0.75rem;font-weight:700;cursor:pointer';
        btnDel.textContent = '🗑';
        btnDel.addEventListener('click', (function(uid,iid){ return function(){ deleteUser(uid,iid,instName); }; })(u.id,instId));
        bRow.appendChild(btnDel);
      } else {
        // مسؤول: فقط السجل + كلمة السر
        var btnLogA2 = document.createElement('button');
        btnLogA2.style.cssText = 'padding:7px 10px;border-radius:8px;border:none;background:rgba(0,212,255,0.15);color:var(--accent);font-family:Cairo,sans-serif;font-size:0.75rem;font-weight:700;cursor:pointer';
        btnLogA2.textContent = '📋 السجل';
        btnLogA2.addEventListener('click', (function(uid,uname){ return function(){ openUserLog(uid,uname); }; })(u.id,u.name));
        bRow.appendChild(btnLogA2);
        if (user && user.role === 'super_admin') {
          var btnPwA = document.createElement('button');
          btnPwA.style.cssText = 'padding:7px 10px;border-radius:8px;border:none;background:rgba(124,92,252,0.15);color:var(--accent2);font-family:Cairo,sans-serif;font-size:0.75rem;font-weight:700;cursor:pointer';
          btnPwA.textContent = '👁 كلمة السر';
          btnPwA.addEventListener('click', (function(uid,uname){ return function(){ resetUserPw(uid,uname); }; })(u.id,u.name));
          bRow.appendChild(btnPwA);
        }
      }
      card.appendChild(bRow);
      body.appendChild(card);
    });
  } catch(e) {
    document.getElementById('inst-users-body').innerHTML = '<p style="color:var(--danger);text-align:center;padding:20px">' + e.message + '</p>';
  }
}

async function changeUserStatus(userId, status, instId, instName) {
  try {
    // blocked/active → حقل status | approved/rejected → حقل request_status
    var body = (status === 'blocked' || status === 'active')
      ? { status: status }
      : { request_status: status };
    await apiFetch('/api/users/' + userId, 'PUT', body);
    var labels = { approved:'موافق', rejected:'مرفوض', blocked:'تجميد العضوية', active:'رفع التجميد' };
    toast('✅ ' + (labels[status]||status), 'success');
    loadAdminUsers();
  } catch(e) { toast(e.message, 'error'); }
}

async function resetUserPw(userId, userName) {
  if (user && user.role === 'super_admin') {
    try {
      var pwData = await apiFetch('/api/users/' + userId + '/pw');
      var currentPw = pwData.pw || null;
      var promptMsg = '👤 ' + (pwData.name || userName) + '\n';
      if (currentPw) {
        promptMsg += '🔑 كلمة المرور الحالية: ' + currentPw + '\n\n';
      } else {
        promptMsg += '⚠️ كلمة المرور غير محفوظة (مستخدم سجّل قبل تفعيل التشفير)\n';
        promptMsg += 'يمكنك تعيين كلمة مرور جديدة الآن:\n\n';
      }
      promptMsg += 'أدخل كلمة المرور الجديدة (أو اضغط إلغاء):';
      var newPw = prompt(promptMsg);
      if (!newPw || newPw.trim() === '') return;
      await apiFetch('/api/users/' + userId, 'PUT', { pw: newPw.trim() });
      toast('✅ تم تغيير كلمة المرور', 'success');
    } catch(e) { toast(e.message, 'error'); }
  } else {
    var pw = prompt('كلمة المرور الجديدة لـ ' + (userName||'المستخدم') + ':');
    if (!pw || pw.trim() === '') return;
    try {
      await apiFetch('/api/users/' + userId, 'PUT', { pw: pw.trim() });
      toast('✅ تم تغيير كلمة المرور', 'success');
    } catch(e) { toast(e.message, 'error'); }
  }
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

    inst.doors.forEach(function(door) {
      var gpsRange = (door.gps && door.gps.range !== undefined) ? door.gps.range : 100;
      var gpsLat   = door.gps && door.gps.lat;
      var gpsLng   = door.gps && door.gps.lng;
      var userReq  = door.gps && door.gps.user_required;
      var schedule = door.schedule || {};

      var card = document.createElement('div');
      card.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:20px;margin-bottom:16px;position:relative;overflow:hidden';
      card.setAttribute('data-door-id', door.id);
      card.setAttribute('data-duration', door.duration_seconds || 5);
      card.setAttribute('data-door-type', door.door_type || 'battante');
      card.setAttribute('data-gps-lat',   gpsLat||'');
      card.setAttribute('data-gps-lng',   gpsLng||'');
      card.setAttribute('data-gps-range', gpsRange);
      card.setAttribute('data-gps-req',   userReq?'1':'0');
      card.setAttribute('data-schedule',  JSON.stringify(schedule));

      // خط جانبي
      var line = document.createElement('div');
      line.style.cssText = 'position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,var(--accent),var(--accent2))';
      card.appendChild(line);

      // ─── Row 1: متصل (يسار) + اسم الباب (يمين) ───
      var row1 = document.createElement('div');
      row1.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px';
      row1.innerHTML =
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<div id="door-img-icon-' + door.id + '" style="font-size:1.1rem">🚪</div>' +
          '<div style="font-size:1rem;font-weight:800">' + door.name + '</div>' +
        '</div>' +
        '<span id="user-online-' + door.id + '" style="font-size:0.75rem;font-weight:700;padding:4px 12px;border-radius:20px;background:var(--surface2);color:var(--muted)">...</span>';
      card.appendChild(row1);

      // ─── Row 2: صورة الباب الكبيرة ───
      var imgWrap = document.createElement('div');
      imgWrap.style.cssText = 'width:100%;aspect-ratio:4/3;margin-bottom:8px';
      imgWrap.innerHTML = '<div id="door-img-' + door.id + '" data-device-id="' + door.device_id + '" data-door-id="' + door.id + '" data-door-type="' + (door.door_type||'battante') + '" style="width:100%;height:100%"></div>';
      card.appendChild(imgWrap);

      // ─── Row 3: النسبة تحت الصورة ───
      var pctRow = document.createElement('div');
      pctRow.id = 'door-pct-' + door.id;
      pctRow.style.cssText = 'text-align:center;font-size:0.85rem;font-weight:700;color:var(--muted);margin-bottom:6px';
      card.appendChild(pctRow);

      // ─── Row 4: شريط حالة الباب (بدون نسبة) ───
      var stateBar = document.createElement('div');
      stateBar.id = 'user-state-' + door.id;
      stateBar.style.cssText = 'background:var(--surface2);border-radius:10px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;justify-content:flex-end;min-height:40px;font-weight:700;font-size:0.9rem';
      stateBar.innerHTML = '<span style="color:var(--muted)">جاري التحقق...</span>';
      card.appendChild(stateBar);

      // ─── Row 5: أزرار التحكم 4 ───
      var grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:8px';
      [
        ['فتح',    'open',   'rgba(0,230,118,0.15)','rgba(0,230,118,0.3)','var(--success)','🟢'],
        ['غلق',    'close',  'rgba(255,61,113,0.15)','rgba(255,61,113,0.3)','var(--danger)','🔴'],
        ['إيقاف',  'stop',   'rgba(255,179,0,0.15)','rgba(255,179,0,0.3)','var(--warning)','🟡'],
        ['فتح 40ث','open40', 'rgba(0,212,255,0.15)','rgba(0,212,255,0.3)','var(--accent)','⏱'],
      ].forEach(function(item) {
        var btn = document.createElement('button');
        btn.style.cssText = 'padding:14px 4px;border-radius:14px;border:1px solid ' + item[3] + ';background:' + item[2] + ';color:' + item[4] + ';font-family:Cairo,sans-serif;font-weight:700;font-size:0.82rem;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:5px';
        btn.innerHTML = '<span style="font-size:1rem">' + item[5] + '</span><span>' + item[0] + '</span>';
        btn.addEventListener('click', (function(d, act) {
          return function() { userDoorAction(d, act); };
        })(door, item[1]));
        grid.appendChild(btn);
      });
      card.appendChild(grid);

      container.appendChild(card);

      // جلب الحالة
      checkDoorStatus(door.device_id, 'user-online-' + door.id);
      fetchUserDoorState(door);
    });

    setTimeout(updateAllGpsBadges, 1000);

    if (window._doorRefreshInterval) clearInterval(window._doorRefreshInterval);
    window._doorRefreshInterval = setInterval(function() {
      inst.doors.forEach(function(door) { fetchUserDoorState(door); });
    }, 10000);

  } catch(e) {
    container.innerHTML = '<p style="color:var(--danger);text-align:center;padding:40px 0">❌ ' + e.message + '</p>';
  }
}

async function fetchUserDoorState(door) {
  var el = document.getElementById('user-state-' + door.id);
  if (!el) return;
  if (doorTimers[door.id]) return; // تايمر شغال → لا نتدخل
  try {
    var data  = await apiFetch('/api/door/status?deviceId=' + door.device_id);
    var r1    = data.r1_on, r2 = data.r2_on;
    var state = r1 ? 'open' : r2 ? 'close' : (lastKnownState[door.id] || 'close');
    lastKnownState[door.id] = state;

    // رسم صورة الباب
    var imgEl = document.getElementById('door-img-' + door.id);
    if (imgEl) _drawDoorStatic(imgEl, null, state);

    // شريط الحالة بنفس أسلوب الأدمن
    var color = state === 'open' ? 'var(--success)' : state === 'close' ? 'var(--danger)' : 'var(--warning)';
    var icon  = state === 'open' ? '🔓' : state === 'close' ? '🔒' : '⏹';
    var label = state === 'open' ? 'الباب مفتوح' : state === 'close' ? 'الباب مغلق' : 'الباب متوقف';
    el.style.cssText = 'background:var(--surface2);border-radius:10px;padding:10px 14px;display:flex;align-items:center;gap:8px;color:' + color + ';font-weight:700;font-size:0.9rem';
    el.innerHTML = '<span style="font-size:1.1rem">' + icon + '</span>' + label;

    // نسبة تحت الصورة
    var pctEl = document.getElementById('door-pct-' + door.id);
    if (pctEl) {
      pctEl.style.color = color;
      pctEl.textContent = state === 'open' ? '100%' : '0%';
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
      toast('📍 تعذر تحديد موقعك، تأكد من رفع التجميد GPS', 'error');
      return;
    }
  }
  try {
    await apiFetch('/api/door/control', 'POST', body);
    var labels = { open:'✅ تم الفتح', close:'✅ تم الغلق', stop:'✅ تم الإيقاف', open40:'✅ فتح 40 ثانية' };
    toast(labels[action]||'✅ تم', 'success');
    setTimeout(function(){ fetchUserDoorState(door); }, 1500);
  } catch(e) {
    var msg = e.message || 'خطأ';
    if (msg.includes('GPS') || msg.includes('بعيد')) toast('📍 ' + msg, 'error');
    else if (msg.includes('وقت') || msg.includes('مسموح') || msg.includes('اليوم')) toast('⏰ ' + msg, 'error');
    else toast('❌ ' + msg, 'error');
  }
}


// ─── Admin Interface ───────────────────────────────────

function formatPhone(phone) {
  if (!phone) return '';
  var digits = phone.replace(/[^0-9]/g, '').slice(-8);
  if (digits.length !== 8) return phone;
  // تنسيق XXX XXX XX (عكس)
  return digits.slice(5,8) + '  ' + digits.slice(2,5) + '  ' + digits.slice(0,2);
}

async function loadAdminDoors() {
  selectedInstId = null;
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

    (inst.doors||[]).forEach(function(door) {
      var card = document.createElement('div');
      card.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:20px;margin-bottom:16px;position:relative;overflow:hidden';
      card.setAttribute('data-door-id', door.id);
      card.setAttribute('data-duration', door.duration_seconds || 5);
      card.setAttribute('data-door-type', door.door_type || 'battante');

      // خط جانبي
      var line = document.createElement('div');
      line.style.cssText = 'position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,var(--accent),var(--accent2))';
      card.appendChild(line);

      // ─── Row 1: متصل (يسار) + اسم الباب (يمين) ───
      var row1 = document.createElement('div');
      row1.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px';
      row1.innerHTML =
        '<span id="adm-online-' + door.id + '" style="font-size:0.75rem;font-weight:700;padding:4px 12px;border-radius:20px;background:var(--surface2);color:var(--muted)">...</span>' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<div style="font-size:1rem;font-weight:800">' + door.name + '</div>' +
          '<div id="door-img-icon-' + door.id + '" style="font-size:1.1rem">🚪</div>' +
        '</div>';
      card.appendChild(row1);

      // ─── Row 2: صورة الباب الكبيرة ───
      var imgWrap = document.createElement('div');
      imgWrap.style.cssText = 'width:100%;aspect-ratio:4/3;margin-bottom:8px;position:relative';
      imgWrap.innerHTML = '<div id="door-img-' + door.id + '" data-device-id="' + door.device_id + '" data-door-id="' + door.id + '" data-door-type="' + (door.door_type||'battante') + '" style="width:100%;height:100%"></div>';
      card.appendChild(imgWrap);

      // ─── Row 3: النسبة تحت الصورة ───
      var pctRow = document.createElement('div');
      pctRow.style.cssText = 'text-align:center;font-size:0.8rem;color:var(--muted);margin-bottom:4px';
      pctRow.id = 'door-pct-' + door.id;
      card.appendChild(pctRow);

      // ─── Row 4: شريط حالة الباب ───
      var stateBar = document.createElement('div');
      stateBar.id = 'door-progress-' + door.id;
      stateBar.style.cssText = 'background:var(--surface2);border-radius:10px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;min-height:40px';
      card.appendChild(stateBar);

      // ─── Row 5: أزرار التحكم 4 ───
      var grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px';
      [
        ['فتح',        'open',   'rgba(0,230,118,0.15)','rgba(0,230,118,0.3)','var(--success)','🟢'],
        ['غلق',        'close',  'rgba(255,61,113,0.15)','rgba(255,61,113,0.3)','var(--danger)','🔴'],
        ['إيقاف',      'stop',   'rgba(255,179,0,0.15)','rgba(255,179,0,0.3)','var(--warning)','🟡'],
        ['فتح 40ث','open40','rgba(0,212,255,0.15)','rgba(0,212,255,0.3)','var(--accent)','⏱'],
      ].forEach(function(item) {
        var btn = document.createElement('button');
        btn.style.cssText = 'padding:14px 4px;border-radius:14px;border:1px solid ' + item[3] + ';background:' + item[2] + ';color:' + item[4] + ';font-family:Cairo,sans-serif;font-weight:700;font-size:0.82rem;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:5px;line-height:1.3';
        btn.innerHTML = '<span style="font-size:1rem">' + item[5] + '</span><span>' + item[0] + '</span>';
        btn.addEventListener('click', (function(did, act, dur){ return function(){ sendDoorAction(did, act, dur); }; })(door.device_id, item[1], door.duration_seconds||5));
        grid.appendChild(btn);
      });
      card.appendChild(grid);

      // ─── Row 6: GPS + RC notify بجانب بعض ───
      var userReq  = door.gps && door.gps.user_required;
      var rcNotify = door.rc_notify === true;
      var toggleRow = document.createElement('div');
      toggleRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px';
      toggleRow.innerHTML =
        '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between">' +
          '<div>' +
            '<div style="font-size:0.75rem;font-weight:700">📍 GPS</div>' +
            '<div style="font-size:0.7rem;color:' + (userReq?'var(--success)':'var(--danger)') + ';font-weight:700">' + (userReq?'مفعّل':'معطّل') + '</div>' +
          '</div>' +
          '<label class="toggle-switch"><input type="checkbox" ' + (userReq?'checked':'') + ' id="gps-toggle-' + door.id + '"><span class="toggle-knob"></span></label>' +
        '</div>' +
        '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between">' +
          '<div>' +
            '<div style="font-size:0.75rem;font-weight:700">📻 اشعار عند استعمال RC</div>' +
            '<div style="font-size:0.7rem;color:' + (rcNotify?'var(--success)':'var(--danger)') + ';font-weight:700">' + (rcNotify?'مفعّل':'معطّل') + '</div>' +
          '</div>' +
          '<label class="toggle-switch"><input type="checkbox" ' + (rcNotify?'checked':'') + ' id="rc-toggle-' + door.id + '"><span class="toggle-knob"></span></label>' +
        '</div>';
      card.appendChild(toggleRow);
      (function(did) {
        setTimeout(function() {
          var gps = document.getElementById('gps-toggle-' + did);
          var rc  = document.getElementById('rc-toggle-' + did);
          if (gps) gps.addEventListener('change', function() { toggleDoorGps(did, 'user_required', this.checked); });
          if (rc)  rc.addEventListener('change',  function() { toggleDoorRcNotify(did, this.checked); });
        }, 50);
      })(door.id);

      // ─── Row 7: سجل + جدول ───
      var logRow = document.createElement('div');
      logRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px';
      var btnLog = document.createElement('button');
      btnLog.style.cssText = 'padding:11px;border-radius:12px;border:1px solid rgba(0,212,255,0.2);background:rgba(0,212,255,0.08);color:var(--accent);font-family:Cairo,sans-serif;font-size:0.8rem;font-weight:700;cursor:pointer';
      btnLog.textContent = '📋 سجل الباب';
      btnLog.addEventListener('click', (function(id, name){ return function(){ openDoorLogs(id, name); }; })(door.id, door.name));
      logRow.appendChild(btnLog);
      var btnSched = document.createElement('button');
      btnSched.style.cssText = 'padding:11px;border-radius:12px;border:1px solid rgba(255,179,0,0.2);background:rgba(255,179,0,0.08);color:var(--warning);font-family:Cairo,sans-serif;font-size:0.8rem;font-weight:700;cursor:pointer';
      btnSched.textContent = '🕐 جدول الأوقات';
      btnSched.addEventListener('click', (function(d){ return function(){ openDoorSchedule(d.id, d.name, d.schedule||{}); }; })(door));
      logRow.appendChild(btnSched);
      card.appendChild(logRow);

      container.appendChild(card);
      fetchAndUpdateDoorImage(door);
    });

  } catch(e) {
    container.innerHTML = '<p style="color:var(--danger);text-align:center;padding:40px 0">❌ ' + e.message + '</p>';
  }
}

// تبويبة المستخدمين للمدير
async function loadAdminUsers() {
  // اكتب في users-table-section إذا كانت صفحة المستخدمين مفتوحة، وإلا في institutes-list
  var inUsersPage = document.getElementById('page-users')?.classList.contains('active');
  var container = inUsersPage
    ? document.getElementById('users-table-section')
    : document.getElementById('institutes-list');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--muted);text-align:center;padding:40px 0">⏳ جاري التحميل...</p>';
  try {
    var insts = await apiFetch('/api/institutes');
    var inst = Array.isArray(insts) ? insts[0] : null;
    if (!inst) { container.innerHTML = '<p style="color:var(--muted);text-align:center;padding:40px 0">لا توجد مؤسسة</p>'; return; }

    container.innerHTML = '';

    // جلب المستخدمين
    var users = await apiFetch('/api/users?inst_id=' + inst.id);
    var filtered = (users||[]).filter(function(u){ return u.role !== 'super_admin'; });
    // pending أولاً ثم approved ثم rejected
    filtered.sort(function(a, b) {
      var order = { pending: 0, approved: 1, rejected: 2, blocked: 3 };
      var aOrder = order[a.request_status || 'approved'] !== undefined ? order[a.request_status || 'approved'] : 1;
      var bOrder = order[b.request_status || 'approved'] !== undefined ? order[b.request_status || 'approved'] : 1;
      return aOrder - bOrder;
    });


    if (!filtered.length) {
      var empty = document.createElement('p');
      empty.style.cssText = 'color:var(--muted);text-align:center;padding:30px';
      empty.textContent = 'لا يوجد مستخدمون بعد';
      container.appendChild(empty);
      return;
    }

    var statusColors = { pending:'var(--warning)', approved:'transparent', rejected:'var(--danger)' };
    var statusLabels = { pending:'انتظار', approved:'', rejected:'مرفوض' };
    var roleLabels   = { user:'مستخدم', admin:'مدير' };

    filtered.forEach(function(u) {
      var status = u.request_status || 'approved';
      var card = document.createElement('div');
      var isBlocked = u.status === 'blocked';
      card.style.cssText = 'background:' + (isBlocked ? 'rgba(80,80,100,0.15)' : 'var(--surface2)') + ';border-radius:14px;padding:14px;margin-bottom:10px;border:' + (isBlocked ? '1px solid rgba(100,180,255,0.2)' : '1px solid transparent') + ';';

      // Info row
      var infoRow = document.createElement('div');
      infoRow.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px';

      var nameDiv = document.createElement('div');
      nameDiv.innerHTML =
        '<div style="font-weight:700;font-size:0.92rem">' + u.name + '</div>' +
        '<div style="font-family:JetBrains Mono,monospace;font-size:0.75rem;color:var(--muted);margin-top:2px">📞 ' + formatPhone(u.phone) + '</div>' +
        '<div style="font-size:0.7rem;color:var(--accent2);margin-top:2px">' + (roleLabels[u.role]||u.role) + '</div>';

      var badgeDiv = document.createElement('div');
      badgeDiv.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0';
      if (isBlocked) {
        var blkSpan = document.createElement('span');
        blkSpan.style.cssText = 'font-size:0.68rem;font-weight:700;padding:2px 8px;border-radius:20px;background:rgba(100,180,255,0.15);color:#7ec8ff';
        blkSpan.textContent = '🧊 مجمّد';
        badgeDiv.appendChild(blkSpan);
      }
      if (statusLabels[status]) {
        var stSpan = document.createElement('span');
        stSpan.style.cssText = 'font-size:0.7rem;font-weight:700;padding:3px 10px;border-radius:20px;background:rgba(0,0,0,0.2);color:' + (statusColors[status]||'var(--muted)');
        stSpan.textContent = statusLabels[status];
        badgeDiv.appendChild(stSpan);
      }

      infoRow.appendChild(nameDiv);
      infoRow.appendChild(badgeDiv);
      card.appendChild(infoRow);

      // Buttons row - مختلف حسب الحالة
      var bRow = document.createElement('div');
      bRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px';
      var isAdminRole = u.role === 'admin';

      if (!isAdminRole) {
        if (status === 'pending') {
          // انتظار: فقط موافقة + رفض
          [['✅ موافقة','approved','rgba(0,230,118,0.15)','var(--success)'],
           ['❌ رفض','rejected','rgba(255,61,113,0.15)','var(--danger)']
          ].forEach(function(item) {
            var b = document.createElement('button');
            b.style.cssText = 'flex:1;padding:7px 8px;border-radius:8px;border:none;background:'+item[2]+';color:'+item[3]+';font-family:Cairo,sans-serif;font-size:0.75rem;font-weight:700;cursor:pointer';
            b.textContent = item[0];
            b.addEventListener('click', (function(uid,act,iid,uname){ return function(){ changeUserStatus(uid,act,iid,uname); }; })(u.id,item[1],inst.id,u.name));
            bRow.appendChild(b);
          });
        } else {
          // موافق/مرفوض/مجمّد: تجميد + سجل + حذف
          console.log('USER:', u.name, '| status:', JSON.stringify(u.status), '| blocked?', u.status === 'blocked', '| isActive:', u.status !== 'blocked');
          var isActive = u.status !== 'blocked';
          var btnBlock = document.createElement('button');
          btnBlock.setAttribute('data-uid', u.id);
          btnBlock.setAttribute('data-ustatus', u.status);
          btnBlock.setAttribute('data-uname', u.name);
          var blockBg    = isActive ? 'rgba(255,179,0,0.15)' : 'rgba(100,180,255,0.2)';
          var blockColor = isActive ? '#ffb300' : '#7ec8ff';
          btnBlock.style.padding        = '7px 12px';
          btnBlock.style.borderRadius   = '8px';
          btnBlock.style.border         = 'none';
          btnBlock.style.background     = blockBg;
          btnBlock.style.color          = blockColor;
          btnBlock.style.fontFamily     = 'Cairo,sans-serif';
          btnBlock.style.fontSize       = '0.75rem';
          btnBlock.style.fontWeight     = '700';
          btnBlock.style.cursor         = 'pointer';
          btnBlock.textContent = isActive ? '🧊 تجميد العضوية' : '🔓 رفع التجميد';
          btnBlock.addEventListener('click', function(){
            var uid    = this.getAttribute('data-uid');
            var st     = this.getAttribute('data-ustatus');
            var uname  = this.getAttribute('data-uname');
            var newSt  = st === 'active' ? 'blocked' : 'active';
            var action = st === 'active' ? 'تجميد العضوية' : 'رفع التجميد';
            if (!confirm('هل أنت متأكد من ' + action + ' لـ ' + uname + '؟')) return;
            apiFetch('/api/users/'+uid,'PUT',{status:newSt})
              .then(function(){ toast('✅ تم ' + action, 'success'); loadAdminUsers(); })
              .catch(function(e){ toast(e.message,'error'); });
          });
          bRow.appendChild(btnBlock);
          var btnLogU = document.createElement('button');
          btnLogU.style.cssText = 'padding:7px 10px;border-radius:8px;border:none;background:rgba(0,212,255,0.15);color:var(--accent);font-family:Cairo,sans-serif;font-size:0.75rem;font-weight:700;cursor:pointer';
          btnLogU.textContent = '📋 السجل';
          btnLogU.addEventListener('click', (function(uid,uname){ return function(){ openUserLog(uid,uname); }; })(u.id,u.name));
          bRow.appendChild(btnLogU);
          var btnDel = document.createElement('button');
          btnDel.style.cssText = 'padding:7px 10px;border-radius:8px;border:none;background:rgba(255,61,113,0.1);color:var(--danger);font-family:Cairo,sans-serif;font-size:0.75rem;font-weight:700;cursor:pointer';
          btnDel.textContent = '🗑';
          btnDel.addEventListener('click', (function(uid,iid,uname){ return function(){ deleteUser(uid,iid,uname); }; })(u.id,inst.id,u.name));
          bRow.appendChild(btnDel);
        }
      } else {
        // مسؤول: فقط زر السجل
        var btnLogA = document.createElement('button');
        btnLogA.style.cssText = 'padding:7px 10px;border-radius:8px;border:none;background:rgba(0,212,255,0.15);color:var(--accent);font-family:Cairo,sans-serif;font-size:0.75rem;font-weight:700;cursor:pointer';
        btnLogA.textContent = '📋 السجل';
        btnLogA.addEventListener('click', (function(uid,uname){ return function(){ openUserLog(uid,uname); }; })(u.id,u.name));
        bRow.appendChild(btnLogA);
      }
      card.appendChild(bRow);
      container.appendChild(card);
    });
  } catch(e) {
    container.innerHTML = '<p style="color:var(--danger);text-align:center;padding:40px 0">❌ ' + e.message + '</p>';
  }
}




// ─── سجل المستخدم ──────────────────────────────────────────────────────────────
async function openUserLog(userId, userName) {
  // نستخدم modal-door-logs الموجود
  document.getElementById('door-logs-title').textContent = '📋 سجل ' + userName;
  document.getElementById('door-logs-body').innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px">جاري التحميل...</p>';
  openModal('modal-door-logs');
  try {
    var data = await apiFetch('/api/users/' + userId + '/logs');
    if (!Array.isArray(data) || !data.length) {
      document.getElementById('door-logs-body').innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px">لا توجد عمليات بعد</p>';
      return;
    }
    var iconMap  = { open:'🔓', close:'🔒', stop:'⏹', open40:'⏱' };
    var labelMap = { open:'فتح', close:'غلق', stop:'إيقاف', open40:'فتح 40ث' };
    document.getElementById('door-logs-body').innerHTML = data.map(function(log) {
      return '<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)">' +
        '<div style="width:38px;height:38px;border-radius:10px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0">' + (iconMap[log.value]||'🚪') + '</div>' +
        '<div style="flex:1">' +
          '<div style="font-weight:700;font-size:0.88rem">' + (labelMap[log.value]||log.value) + '</div>' +
          '<div style="font-size:0.75rem;color:var(--accent2);margin-top:2px">🚪 ' + (log.door_name||'—') + '</div>' +
        '</div>' +
        '<div style="font-size:0.72rem;color:var(--muted);font-family:JetBrains Mono,monospace">' + formatTime(log.created_at) + '</div>' +
        '</div>';
    }).join('');
  } catch(e) {
    document.getElementById('door-logs-body').innerHTML = '<p style="color:var(--danger);text-align:center;padding:20px">' + e.message + '</p>';
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

  if (name === 'dashboard') { loadStats(); }
  if (name === 'institutes') {
    if (user && user.role === 'super_admin') loadInstitutes();
    else if (user && user.role === 'admin') loadAdminDoors();
    else if (user) loadUserDoors();
  }
  if (name === 'users') {
    var pb = document.getElementById('pending-badge');
    if (pb) pb.remove();
    if (user && user.role === 'super_admin') loadUsersForSuperAdmin();
    else if (user && user.role === 'admin') loadAdminUsers();
    else loadUsers();
    return;
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
  const res  = await fetch(url, opts);
  let data;
  try { data = await res.json(); } catch(e) { data = {}; }
  if (!res.ok) throw new Error(data.error || 'خطأ في الخادم');
  return data;
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

    // الجهاز أجاب → متصل
    updateDeviceOnlineBadge(door.device_id, true);

    if (doorTimers[door.id]) return;

    // idle من Tuya = ريلاي في وضعه الطبيعي، ليس "متوقف"
    if (state === 'idle') {
      state = lastKnownState[door.id] || 'close'; // افتراضي: مغلق
    } else {
      lastKnownState[door.id] = state; // حدّث الحالة المعروفة
    }

    // رسم الصورة الثابتة
    if (imgEl) _drawDoorStatic(imgEl, null, state);

    // كتابة الحالة في door-progress- (يبقى بعد refresh لأنه يُعاد جلبه)
    var progEl = document.getElementById('door-progress-' + door.id);
    if (progEl) {
      var pColor = state === 'open' ? 'var(--success)' : state === 'close' ? 'var(--danger)' : 'var(--warning)';
      var pIcon  = state === 'open' ? '🔓' : state === 'close' ? '🔒' : '⏹';
      var pLabel = state === 'open' ? 'الباب مفتوح' : state === 'close' ? 'الباب مغلق' : 'الباب متوقف';
      progEl.style.cssText = 'background:var(--surface2);border-radius:10px;padding:10px 14px;display:flex;align-items:center;gap:8px;color:' + pColor + ';font-weight:700;font-size:0.9rem';
      progEl.innerHTML = '<span style="font-size:1.1rem">' + pIcon + '</span>' + pLabel;
    }
    updateDoorCardState(door.id, door.device_id, state, 'poll');
  } catch(e) {
    // خطأ في الاتصال بـ Tuya → offline
    doorStatusCache[door.device_id] = false;
    updateDeviceOnlineBadge(door.device_id, false);
    var imgElErr = document.getElementById('door-img-' + door.id);
    if (imgElErr && !imgElErr.innerHTML) {
      imgElErr.innerHTML =
        '<svg viewBox="0 0 80 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;opacity:0.4">' +
        '<rect x="4" y="2" width="72" height="78" rx="5" fill="none" stroke="#8892b0" stroke-width="1.8"/>' +
        '<rect x="8" y="4" width="62" height="74" rx="3" fill="#8892b0" fill-opacity="0.1" stroke="#8892b0" stroke-width="1.6"/>' +
        '<circle cx="22" cy="41" r="3" fill="#8892b0" opacity="0.6"/>' +
        '<text x="40" y="97" text-anchor="middle" font-size="7" fill="#8892b0" font-family="Cairo,sans-serif">غير متصل</text>' +
        '</svg>';
    }
  }
}

async function loadWeekChart() {
  const section = document.getElementById('stats-chart-section');
  if (!section) return;
  try {
    const data = await apiFetch('/api/history');
    if (!data || !data.length) { section.innerHTML = ''; return; }

    // تجميع العمليات حسب اليوم (آخر 7 أيام)
    var days = {};
    for (var i = 6; i >= 0; i--) {
      var d = new Date(); d.setDate(d.getDate() - i);
      var key = d.toISOString().split('T')[0];
      days[key] = { open: 0, close: 0 };
    }
    data.forEach(function(log) {
      var day = (log.created_at || '').split('T')[0];
      if (days[day]) {
        if (log.value === 'open' || log.value === 'open40') days[day].open++;
        else if (log.value === 'close') days[day].close++;
      }
    });

    var keys   = Object.keys(days);
    var opens  = keys.map(function(k){ return days[k].open; });
    var closes = keys.map(function(k){ return days[k].close; });
    var maxVal = Math.max.apply(null, opens.concat(closes).concat([1]));
    var dayNames = ['أحد','اثن','ثلا','أرب','خمي','جمع','سبت'];

    var bars = keys.map(function(key, i) {
      var d    = new Date(key);
      var name = dayNames[d.getDay()];
      var oh   = Math.round((opens[i]  / maxVal) * 80);
      var ch   = Math.round((closes[i] / maxVal) * 80);
      return '<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1">' +
        '<div style="display:flex;align-items:flex-end;gap:2px;height:80px">' +
          '<div title="فتح: '+opens[i]+'" style="width:10px;height:'+oh+'px;background:var(--success);border-radius:3px 3px 0 0;opacity:0.85;min-height:2px"></div>' +
          '<div title="غلق: '+closes[i]+'" style="width:10px;height:'+ch+'px;background:var(--danger);border-radius:3px 3px 0 0;opacity:0.85;min-height:2px"></div>' +
        '</div>' +
        '<div style="font-size:0.65rem;color:var(--muted);font-weight:600">' + name + '</div>' +
        '</div>';
    }).join('');

    section.innerHTML =
      '<div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:16px;margin-bottom:14px">' +
        '<div style="font-size:0.8rem;font-weight:700;color:var(--muted);margin-bottom:12px">📅 آخر 7 أيام</div>' +
        '<div style="display:flex;align-items:flex-end;gap:4px;height:100px">' + bars + '</div>' +
        '<div style="display:flex;gap:16px;margin-top:8px">' +
          '<span style="font-size:0.7rem;color:var(--success);font-weight:700">■ فتح</span>' +
          '<span style="font-size:0.7rem;color:var(--danger);font-weight:700">■ غلق</span>' +
        '</div>' +
      '</div>';
  } catch(e) { section.innerHTML = ''; }
}

async function toggleDoorRcNotify(doorId, value) {
  try {
    await apiFetch('/api/doors/' + doorId, 'PUT', { rc_notify: value });
    // تحديث الكاش
    institutesCache.forEach(function(inst) {
      (inst.doors||[]).forEach(function(door) {
        if (door.id === doorId) door.rc_notify = value;
      });
    });
    // تحديث نص الـ toggle
    var lbl = document.querySelector('#rc-toggle-' + doorId)?.closest('div[style]')?.querySelector('div > div:last-child');
    if (lbl) {
      lbl.style.color = value ? 'var(--success)' : 'var(--danger)';
      lbl.textContent = value ? 'مفعّل ✅' : 'معطّل ❌';
    }
    toast(value ? '🔔 سيتم إشعارك عند استخدام RC' : '🔕 تم إيقاف الإشعار', 'success');
  } catch(e) { toast(e.message, 'error'); }
}
