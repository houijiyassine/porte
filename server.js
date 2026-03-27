import express from 'express';
import crypto from 'crypto';

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const rateLimitMap = new Map(); // key → { count, resetAt }

function rateLimit(key, maxRequests, windowMs) {
  const now = Date.now();
  const entry = rateLimitMap.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
  entry.count++;
  rateLimitMap.set(key, entry);
  return entry.count <= maxRequests;
}

function rateLimitMiddleware(maxRequests, windowMs) {
  return (req, res, next) => {
    const key = req.ip + req.path;
    if (!rateLimit(key, maxRequests, windowMs)) {
      return res.status(429).json({ error: 'محاولات كثيرة، حاول لاحقاً' });
    }
    next();
  };
}

// ─── AES-256 Encryption ───────────────────────────────────────────────────────
const PW_SECRET = process.env.PW_SECRET || 'porte-default-secret-change-me-32ch';

function encryptPw(plainText) {
  const key    = crypto.scryptSync(PW_SECRET, 'salt', 32);
  const iv     = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const enc    = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + enc.toString('hex');
}

function decryptPw(encrypted) {
  try {
    const [ivHex, encHex] = encrypted.split(':');
    const key     = crypto.scryptSync(PW_SECRET, 'salt', 32);
    const iv      = Buffer.from(ivHex, 'hex');
    const encBuf  = Buffer.from(encHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([decipher.update(encBuf), decipher.final()]).toString('utf8');
  } catch { return null; }
}


import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app    = express();
const server = createServer(app);
const wss    = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Config ───────────────────────────────────────────────────────────────────
const SUPABASE_URL         = process.env.SUPABASE_URL      || 'https://sjfaootvlxesdytdsknc.supabase.co';
const SUPABASE_ANON_KEY    = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqZmFvb3R2bHhlc2R5dGRza25jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxODAyNTcsImV4cCI6MjA4ODc1NjI1N30.pEhpszTGygiR6brpWHglnpcASAPw7kyWl0qd5mFwwMQ';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const JWT_SECRET           = process.env.JWT_SECRET || 'porte-secret-key-2024';

const TUYA = {
  CLIENT_ID: process.env.TUYA_CLIENT_ID || 'y85me8yq7d3vvk7vghuy',
  SECRET:    process.env.TUYA_SECRET    || '59525637e59245bea73190da68e3c7e9',
  DEVICE_ID: process.env.TUYA_DEVICE_ID || 'bf7c670914391fc80cwayk',
  BASE_URL:  process.env.TUYA_BASE_URL  || 'https://openapi.tuyaeu.com',
};

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC  || 'BOfIw6laarxGfV8Ezc04YzfCzq4Njm7ewizkfnGDIWJGpsfHkqUHVG8SXGb8cJZJxOTIzFeauX4K0Z8oYdfgKTw';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE;
const EMPTY_BODY_HASH  = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const DEFAULT_DURATION = parseInt(process.env.DEFAULT_DURATION || '5');

// ─── Supabase ─────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);

// ─── Web Push ─────────────────────────────────────────────────────────────────
if (VAPID_PRIVATE) {
  webpush.setVapidDetails('mailto:admin@porte.app', VAPID_PUBLIC, VAPID_PRIVATE);
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
const wsClients = new Map(); // userId → ws

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

wss.on('connection', (ws, req) => {
  const url   = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  let userId  = null;

  if (token) {
    try {
      const payload = verifyToken(token);
      userId = payload.id;
      wsClients.set(userId, ws);
    } catch {}
  }

  ws.send(JSON.stringify({ type: 'connected' }));

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'location' && userId) {
        broadcast({ type: 'user_location', userId, coords: msg.coords });
        const now = new Date().toISOString();
        // حفظ في تاريخ المواقع
        const { data: userData } = await supabase.from('users').select('inst_id').eq('id', userId).single();
        await supabase.from('user_locations').insert({
          user_id:   userId,
          inst_id:   userData?.inst_id,
          lat:       msg.coords.lat,
          lng:       msg.coords.lng,
          accuracy:  msg.coords.accuracy || null,
          created_at: now,
        });
        // تحديث آخر موقع معروف
        await supabase.from('users').update({
          last_location: msg.coords,
          last_seen: now,
        }).eq('id', userId);
        // حذف المواقع الأقدم من 30 يوم لهذا المستخدم
        await supabase.from('user_locations')
          .delete()
          .eq('user_id', userId)
          .lt('created_at', new Date(Date.now() - 30*24*60*60*1000).toISOString());
      }
    } catch {}
  });

  ws.on('close', () => {
    if (userId) wsClients.delete(userId);
  });
});

// ─── JWT ──────────────────────────────────────────────────────────────────────
function signToken(payload) {
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body    = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString('base64url');
  const sig     = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  const [header, body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  if (sig !== expected) throw new Error('Invalid token');
  return JSON.parse(Buffer.from(body, 'base64url').toString());
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: 'غير مصرح' });
  try {
    req.user = verifyToken(authHeader.replace('Bearer ', ''));
    next();
  } catch {
    res.status(401).json({ error: 'جلسة منتهية' });
  }
}

function adminOnly(req, res, next) {
  if (!['admin', 'super_admin'].includes(req.user.role))
    return res.status(403).json({ error: 'غير مسموح' });
  next();
}

function superAdminOnly(req, res, next) {
  if (req.user.role !== 'super_admin')
    return res.status(403).json({ error: 'للسوبر أدمن فقط' });
  next();
}

// ─── Tuya ─────────────────────────────────────────────────────────────────────
let tuyaTokenCache = { token: null, expiresAt: 0 };

function hmacSign(str) {
  return crypto.createHmac('sha256', TUYA.SECRET).update(str).digest('hex').toUpperCase();
}

function buildTokenSign(t) {
  const stringToSign = ['GET', EMPTY_BODY_HASH, '', '/v1.0/token?grant_type=1'].join('\n');
  return hmacSign(TUYA.CLIENT_ID + t + '' + stringToSign);
}

function buildRequestSign({ token, t, nonce, method, urlPath, body = '' }) {
  const bodyHash     = body ? crypto.createHash('sha256').update(body).digest('hex') : EMPTY_BODY_HASH;
  const stringToSign = [method.toUpperCase(), bodyHash, '', urlPath].join('\n');
  return hmacSign(TUYA.CLIENT_ID + token + t + nonce + stringToSign);
}

async function getTuyaToken() {
  const now = Date.now();
  if (tuyaTokenCache.token && now < tuyaTokenCache.expiresAt) return tuyaTokenCache.token;
  const t    = now.toString();
  const sign = buildTokenSign(t);
  const res  = await fetch(`${TUYA.BASE_URL}/v1.0/token?grant_type=1`, {
    method: 'GET',
    headers: { 'client_id': TUYA.CLIENT_ID, 'sign': sign, 't': t, 'sign_method': 'HMAC-SHA256', 'nonce': '', 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!data.success) throw new Error(`Tuya token error: ${data.msg}`);
  tuyaTokenCache = { token: data.result.access_token, expiresAt: now + (data.result.expire_time * 1000) - 60000 };
  return tuyaTokenCache.token;
}

async function sendTuyaCommands(deviceId, commands) {
  const token   = await getTuyaToken();
  const t       = Date.now().toString();
  const nonce   = crypto.randomBytes(16).toString('hex');
  const urlPath = `/v1.0/devices/${deviceId}/commands`;
  const body    = JSON.stringify({ commands });
  const sign    = buildRequestSign({ token, t, nonce, method: 'POST', urlPath, body });
  const res = await fetch(`${TUYA.BASE_URL}${urlPath}`, {
    method: 'POST',
    headers: { 'client_id': TUYA.CLIENT_ID, 'access_token': token, 'sign': sign, 't': t, 'nonce': nonce, 'sign_method': 'HMAC-SHA256', 'Content-Type': 'application/json' },
    body,
  });
  return await res.json();
}

async function getTuyaDeviceStatus(deviceId) {
  const token   = await getTuyaToken();
  const t       = Date.now().toString();
  const nonce   = crypto.randomBytes(16).toString('hex');
  const urlPath = `/v1.0/devices/${deviceId}/status`;
  const sign    = buildRequestSign({ token, t, nonce, method: 'GET', urlPath });
  const res = await fetch(`${TUYA.BASE_URL}${urlPath}`, {
    method: 'GET',
    headers: { 'client_id': TUYA.CLIENT_ID, 'access_token': token, 'sign': sign, 't': t, 'nonce': nonce, 'sign_method': 'HMAC-SHA256', 'Content-Type': 'application/json' },
  });
  return await res.json();
}

// ─── Door Logic ───────────────────────────────────────────────────────────────
const doorTimers = {};

async function openDoor(deviceId, durationSeconds) {
  if (doorTimers[deviceId]) { clearTimeout(doorTimers[deviceId]); delete doorTimers[deviceId]; }
  const statusData = await getTuyaDeviceStatus(deviceId);
  const status     = statusData.result || [];
  const r2On       = status.find(s => s.code === 'switch_2')?.value;
  const commands   = [];
  if (r2On) commands.push({ code: 'switch_2', value: false });
  commands.push({ code: 'switch_1', value: true });
  const result = await sendTuyaCommands(deviceId, commands);
  doorTimers[deviceId] = setTimeout(async () => {
    await sendTuyaCommands(deviceId, [{ code: 'switch_1', value: false }]);
    broadcast({ type: 'door_event', action: 'auto_stop', deviceId });
    delete doorTimers[deviceId];
  }, durationSeconds * 1000);
  return result;
}

async function closeDoor(deviceId, durationSeconds) {
  if (doorTimers[deviceId]) { clearTimeout(doorTimers[deviceId]); delete doorTimers[deviceId]; }
  const statusData = await getTuyaDeviceStatus(deviceId);
  const status     = statusData.result || [];
  const r1On       = status.find(s => s.code === 'switch_1')?.value;
  const commands   = [];
  if (r1On) commands.push({ code: 'switch_1', value: false });
  commands.push({ code: 'switch_2', value: true });
  const result = await sendTuyaCommands(deviceId, commands);
  doorTimers[deviceId] = setTimeout(async () => {
    await sendTuyaCommands(deviceId, [{ code: 'switch_2', value: false }]);
    broadcast({ type: 'door_event', action: 'auto_stop', deviceId });
    delete doorTimers[deviceId];
  }, durationSeconds * 1000);
  return result;
}

async function stopDoor(deviceId) {
  if (doorTimers[deviceId]) { clearTimeout(doorTimers[deviceId]); delete doorTimers[deviceId]; }
  return await sendTuyaCommands(deviceId, [{ code: 'switch_1', value: false }, { code: 'switch_2', value: false }]);
}

// ─── Push ─────────────────────────────────────────────────────────────────────
async function sendPushToAll(notification) {
  if (!VAPID_PRIVATE) return;
  try {
    const { data: subs } = await supabase.from('push_subscriptions').select('*');
    if (!subs?.length) return;
    const payload = JSON.stringify(notification);
    await Promise.allSettled(subs.map(sub =>
      webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
        .catch(err => { if (err.statusCode === 410) supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); })
    ));
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ─── AUTH ─────────────────────────────────────────────────────────────────────

// ─── OTP (ثابت 0000 للتطوير) ──────────────────────────────────────────────────
app.post('/api/auth/send-otp', rateLimitMiddleware(3, 600000), async (req, res) => {
  try {
    const { phone, type } = req.body;
    if (!phone) return res.status(400).json({ error: 'رقم الهاتف مطلوب' });
    // حذف OTP قديم
    await supabase.from('otp_codes').delete().eq('phone', phone).eq('type', type||'register');
    // إنشاء OTP جديد (0000 للتطوير)
    const code = '0000';
    const { error } = await supabase.from('otp_codes').insert({
      phone, code, type: type||'register',
      expires_at: new Date(Date.now() + 10*60*1000).toISOString()
    });
    if (error) return res.status(500).json({ error: error.message });
    // TODO: إرسال SMS حقيقي لاحقاً
    console.log(`[OTP] ${phone} → ${code} (${type})`);
    res.json({ success: true, message: 'تم إرسال الرمز' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/verify-otp', rateLimitMiddleware(5, 600000), async (req, res) => {
  try {
    const { phone, code, type } = req.body;
    const { data: otp } = await supabase.from('otp_codes')
      .select('*').eq('phone', phone).eq('type', type||'register')
      .eq('used', false).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!otp) return res.status(400).json({ error: 'لم يتم إرسال رمز' });
    if (new Date(otp.expires_at) < new Date()) return res.status(400).json({ error: 'انتهت صلاحية الرمز' });
    if (otp.code !== code) return res.status(400).json({ error: 'الرمز غير صحيح' });
    await supabase.from('otp_codes').update({ used: true }).eq('id', otp.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── التسجيل ──────────────────────────────────────────────────────────────────
app.post('/api/auth/register', rateLimitMiddleware(3, 3600000), async (req, res) => {
  try {
    const { name, last_name, phone, pw, inst_code } = req.body;
    if (!name || !phone || !pw || !inst_code)
      return res.status(400).json({ error: 'جميع الحقول مطلوبة' });

    // البحث عن المؤسسة
    const { data: inst } = await supabase.from('institutes')
      .select('id,name').eq('code', inst_code).maybeSingle();
    if (!inst) return res.status(400).json({ error: 'كود المؤسسة غير صحيح' });

    // التحقق من عدم وجود الهاتف
    const { data: existingUsers } = await supabase.from('users')
      .select('id').eq('phone', phone).limit(1);
    if (existingUsers && existingUsers.length > 0)
      return res.status(400).json({ error: 'رقم الهاتف مسجل مسبقاً' });

    // إنشاء الحساب
    const pw_hash = crypto.createHash('sha256').update(pw).digest('hex');
    const { data: newUser, error } = await supabase.from('users').insert({
      name: name + (last_name ? ' ' + last_name : ''),
      last_name, phone, pw_hash,
      inst_id: inst.id, role: 'user',
      status: 'active', request_status: 'pending',
      created_at: new Date().toISOString()
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });

    // إشعار للأدمن فقط
    const { data: admins } = await supabase.from('users')
      .select('id').eq('inst_id', inst.id).eq('role', 'admin').eq('status', 'active');
    if (admins?.length) {
      await sendPushToAdmins(inst.id, {
        title: '👤 طلب انضمام جديد',
        body: name + ' يريد الانضمام إلى ' + inst.name,
      });
    }

    const token = signToken({ id: newUser.id, role: newUser.role, inst_id: newUser.inst_id, name: newUser.name });
    res.json({
      token,
      user: { id: newUser.id, name: newUser.name, phone: newUser.phone, role: newUser.role, inst_id: newUser.inst_id, request_status: 'pending' }
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── نسيت كلمة السر ──────────────────────────────────────────────────────────
app.post('/api/auth/reset-password', rateLimitMiddleware(3, 3600000), async (req, res) => {
  try {
    const { phone, code, new_pw } = req.body;
    // التحقق من OTP
    const { data: otp } = await supabase.from('otp_codes')
      .select('*').eq('phone', phone).eq('type', 'reset_password')
      .eq('used', false).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!otp || otp.code !== code) return res.status(400).json({ error: 'الرمز غير صحيح' });
    if (new Date(otp.expires_at) < new Date()) return res.status(400).json({ error: 'انتهت صلاحية الرمز' });

    const pw_hash = crypto.createHash('sha256').update(new_pw).digest('hex');
    const { error } = await supabase.from('users').update({ pw_hash }).eq('phone', phone);
    if (error) return res.status(500).json({ error: error.message });
    await supabase.from('otp_codes').update({ used: true }).eq('id', otp.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── تغيير كلمة السر (مسجل دخول) ────────────────────────────────────────────
app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
  try {
    const { old_pw, new_pw } = req.body;
    const { data: u } = await supabase.from('users').select('pw_hash').eq('id', req.user.id).single();
    const old_hash = crypto.createHash('sha256').update(old_pw).digest('hex');
    if (u.pw_hash !== old_hash) return res.status(400).json({ error: 'كلمة المرور القديمة غير صحيحة' });
    const new_hash = crypto.createHash('sha256').update(new_pw).digest('hex');
    await supabase.from('users').update({ pw_hash: new_hash }).eq('id', req.user.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── جدول أوقات تلقائي ────────────────────────────────────────────────────────
app.post('/api/doors/:id/auto-schedule', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { schedule } = req.body;
    await supabase.from('doors').update({ auto_schedule: schedule }).eq('id', req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── قائمة بيضاء/سوداء ───────────────────────────────────────────────────────
app.get('/api/doors/:id/access-list', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { data } = await supabase.from('door_access_list')
      .select('*,users(name,phone)').eq('door_id', req.params.id);
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/doors/:id/access-list', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { user_id, type } = req.body;
    const { error } = await supabase.from('door_access_list')
      .upsert({ door_id: req.params.id, user_id, type });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/doors/:id/access-list/:userId', authMiddleware, adminOnly, async (req, res) => {
  try {
    await supabase.from('door_access_list')
      .delete().eq('door_id', req.params.id).eq('user_id', req.params.userId);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── سجل جلسات المستخدم ──────────────────────────────────────────────────────
app.get('/api/users/:id/sessions', authMiddleware, async (req, res) => {
  try {
    const { data } = await supabase.from('user_sessions')
      .select('*').eq('user_id', req.params.id)
      .order('login_at', { ascending: false }).limit(20);
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── تحديث last_seen ──────────────────────────────────────────────────────────
app.post('/api/auth/heartbeat', authMiddleware, async (req, res) => {
  try {
    await supabase.from('users').update({ last_seen: new Date().toISOString() }).eq('id', req.user.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', rateLimitMiddleware(5, 60000), async (req, res) => {
  try {
    const { phone, pw } = req.body;
    if (!phone || !pw) return res.status(400).json({ error: 'الهاتف وكلمة المرور مطلوبان' });

    const { data: users, error } = await supabase
      .from('users')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (error || !users) return res.status(401).json({ error: 'رقم الهاتف غير موجود أو الحساب محظور' });

    const pwHash = crypto.createHash('sha256').update(pw).digest('hex');
    if (users.pw_hash !== pwHash) return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });

    // تحقق من انتهاء الصلاحية
    if (users.expire_date && new Date(users.expire_date) < new Date())
      return res.status(401).json({ error: 'انتهت صلاحية الحساب' });

    const token = signToken({ id: users.id, role: users.role, inst_id: users.inst_id, name: users.name });

    res.json({
      token,
      user: { id: users.id, name: users.name, phone: users.phone, role: users.role, inst_id: users.inst_id }
    });
  } catch (err) {
    console.error('[Login Error]', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// ─── DOOR STATUS ──────────────────────────────────────────────────────────────
app.get('/api/door/status', authMiddleware, async (req, res) => {
  try {
    const deviceId = req.query.deviceId || TUYA.DEVICE_ID;
    const data     = await getTuyaDeviceStatus(deviceId);
    const status   = data.result || [];
    const r1 = status.find(s => s.code === 'switch_1')?.value;
    const r2 = status.find(s => s.code === 'switch_2')?.value;
    const state = r1 ? 'open' : r2 ? 'close' : 'stop';
    res.json({ value: state, r1_on: r1, r2_on: r2, timer_active: !!doorTimers[deviceId] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DOOR CONTROL ─────────────────────────────────────────────────────────────
app.post('/api/door/control', authMiddleware, async (req, res) => {
  try {
    const { action } = req.body;
    const deviceId   = req.body.deviceId || TUYA.DEVICE_ID;
    const duration   = req.body.duration || DEFAULT_DURATION;

    // التحقق من القيود حسب الدور
    const role = req.user.role;
    if (role === 'user' || role === 'admin') {
      const { data: door } = await supabase.from('doors')
        .select('gps,schedule,inst_id').eq('device_id', deviceId).single();

      if (door) {
        // تحديد هل GPS مطلوب لهذا الدور
        const gpsRequired = role === 'user' ? door.gps?.user_required : door.gps?.admin_required;

        if (gpsRequired && door.gps?.lat && door.gps?.lng) {
          const userLat  = parseFloat(req.body.lat);
          const userLng  = parseFloat(req.body.lng);
          const accuracy = parseFloat(req.body.accuracy) || 999;

          if (!userLat || !userLng) {
            await supabase.from('access_alerts').insert({
              user_id: req.user.id, inst_id: req.user.inst_id,
              type: 'gps_required', action: action,
              message: 'محاولة فتح الباب بدون GPS',
              created_at: new Date().toISOString(),
            }).catch(()=>{});
            return res.status(403).json({ error: 'يجب تفعيل GPS للوصول إلى هذا الباب', code: 'GPS_REQUIRED' });
          }

          // ─── كشف Fake GPS ───────────────────────────────
          const altitude     = req.body.altitude;
          const altAccuracy  = req.body.altAccuracy;
          const responseTime = parseInt(req.body.responseTime) || 0;

          // 1. زمن استجابة سريع جداً (أقل من 50ms = fake)
          if (responseTime > 0 && responseTime < 50) {
            await supabase.from('access_alerts').insert({
              user_id: req.user.id, inst_id: req.user.inst_id,
              type: 'fake_gps_suspected', action: action,
              lat: userLat, lng: userLng,
              message: `GPS استجاب في ${responseTime}ms — سرعة مريبة (Fake GPS)`,
              created_at: new Date().toISOString(),
            }).catch(()=>{});
            return res.status(403).json({ error: 'تم اكتشاف موقع غير حقيقي (استجابة فورية).', code: 'FAKE_GPS' });
          }

          // 2. دقة مريبة جداً (أقل من 3م = مشبوه)
          if (accuracy < 3) {
            await supabase.from('access_alerts').insert({
              user_id: req.user.id, inst_id: req.user.inst_id,
              type: 'fake_gps_suspected', action: action,
              lat: userLat, lng: userLng,
              message: `دقة GPS مريبة: ${accuracy}م — محتمل fake GPS`,
              created_at: new Date().toISOString(),
            }).catch(()=>{});
            return res.status(403).json({ error: 'تم اكتشاف موقع غير حقيقي. تواصل مع المسؤول.', code: 'FAKE_GPS' });
          }

          // 2. فحص سرعة التنقل مقارنة بآخر موقع
          const { data: lastLoc } = await supabase.from('user_locations')
            .select('lat,lng,created_at')
            .eq('user_id', req.user.id)
            .order('created_at', { ascending: false })
            .limit(1).single().catch(()=>({ data: null }));

          if (lastLoc) {
            const timeDiff = (Date.now() - new Date(lastLoc.created_at).getTime()) / 1000; // بالثواني
            if (timeDiff < 300 && timeDiff > 0) { // آخر 5 دقائق
              const R2 = 6371000;
              const dLat2 = (userLat - lastLoc.lat) * Math.PI / 180;
              const dLng2 = (userLng - lastLoc.lng) * Math.PI / 180;
              const a2 = Math.sin(dLat2/2)**2 + Math.cos(lastLoc.lat*Math.PI/180)*Math.cos(userLat*Math.PI/180)*Math.sin(dLng2/2)**2;
              const dist2 = R2 * 2 * Math.atan2(Math.sqrt(a2), Math.sqrt(1-a2));
              const speedMs = dist2 / timeDiff; // متر/ثانية
              // أكثر من 50م/ث = 180كم/ساعة = مستحيل مشياً
              if (speedMs > 50) {
                await supabase.from('access_alerts').insert({
                  user_id: req.user.id, inst_id: req.user.inst_id,
                  type: 'fake_gps_teleport', action: action,
                  lat: userLat, lng: userLng,
                  message: `تنقل مشبوه: ${Math.round(dist2)}م في ${Math.round(timeDiff)}ث (${Math.round(speedMs*3.6)}كم/س)`,
                  created_at: new Date().toISOString(),
                }).catch(()=>{});
                return res.status(403).json({ error: 'تم اكتشاف تنقل غير طبيعي. تواصل مع المسؤول.', code: 'FAKE_GPS_TELEPORT' });
              }
            }
          }
          // 4. altitude = null أو 0 مع accuracy ممتاز = مشبوه
          if (accuracy < 10 && (altitude === null || altitude === 0) && altAccuracy === null) {
            await supabase.from('access_alerts').insert({
              user_id: req.user.id, inst_id: req.user.inst_id,
              type: 'fake_gps_suspected', action: action,
              lat: userLat, lng: userLng,
              message: `GPS بدون ارتفاع مع دقة ${accuracy}م — محتمل fake GPS`,
              created_at: new Date().toISOString(),
            }).catch(()=>{});
            return res.status(403).json({ error: 'تم اكتشاف موقع غير حقيقي (بيانات ناقصة).', code: 'FAKE_GPS' });
          }
          // ────────────────────────────────────────────────

          const R = 6371000;
          const dLat = (userLat - door.gps.lat) * Math.PI / 180;
          const dLng = (userLng - door.gps.lng) * Math.PI / 180;
          const a = Math.sin(dLat/2)**2 + Math.cos(door.gps.lat*Math.PI/180) * Math.cos(userLat*Math.PI/180) * Math.sin(dLng/2)**2;
          const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          if (distance > (door.gps.range || 100)) {
            await supabase.from('access_alerts').insert({
              user_id: req.user.id, inst_id: req.user.inst_id,
              door_id: (await supabase.from('doors').select('id').eq('device_id',deviceId).single()).data?.id,
              type: 'gps_out_of_range', action: action,
              lat: userLat, lng: userLng,
              message: `بعيد عن الباب بـ ${Math.round(distance)}م (مسموح: ${door.gps.range}م)`,
              created_at: new Date().toISOString(),
            }).catch(()=>{});
            return res.status(403).json({ error: `أنت بعيد عن الباب (${Math.round(distance)}م). النطاق المسموح: ${door.gps.range}م`, code: 'GPS_OUT_OF_RANGE' });
          }
        }

        // التحقق من الجدول — للمستخدم فقط
        if (role === 'user' && door.schedule && Object.keys(door.schedule).length > 0) {
          const now = new Date();
          const dayMap = [1,2,3,4,5,6,0];
          const dayIndex = dayMap[now.getDay()];
          const daySchedule = door.schedule[dayIndex];
          if (daySchedule && !daySchedule.enabled) {
            await supabase.from('access_alerts').insert({
              user_id: req.user.id, inst_id: req.user.inst_id,
              type: 'schedule_denied', action: action,
              message: 'محاولة فتح الباب خارج أيام العمل',
              created_at: new Date().toISOString(),
            }).catch(()=>{});
            return res.status(403).json({ error: 'الباب غير مسموح به اليوم', code: 'SCHEDULE_DENIED' });
          }
          if (daySchedule?.enabled && daySchedule.start && daySchedule.end) {
            const timeStr = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
            if (timeStr < daySchedule.start || timeStr > daySchedule.end) {
              await supabase.from('access_alerts').insert({
                user_id: req.user.id, inst_id: req.user.inst_id,
                type: 'schedule_time', action: action,
                message: `محاولة فتح الباب خارج الوقت المسموح (${daySchedule.start}–${daySchedule.end})`,
                created_at: new Date().toISOString(),
              }).catch(()=>{});
              return res.status(403).json({ error: `الباب مسموح به من ${daySchedule.start} إلى ${daySchedule.end} فقط`, code: 'SCHEDULE_OUT_OF_RANGE' });
            }
          }
        }
      }
    }

    let result;
    if      (action === 'open')   result = await openDoor(deviceId, duration);
    else if (action === 'open40') result = await openDoor(deviceId, 40);
    else if (action === 'close')  result = await closeDoor(deviceId, duration);
    else if (action === 'stop')   result = await stopDoor(deviceId);
    else return res.status(400).json({ error: 'action غير معروف' });

    if (result && !result.success)
      return res.status(500).json({ error: result.msg });

    // تسجيل أن الأمر جاء من التطبيق (للـ Webhook)
    markAppAction(deviceId, req.user.id, req.user.name, action);
    triggerBurst((duration || DEFAULT_DURATION) + 3);
    // سجّل العملية — سيُسجّل الآن عبر Webhook تلقائياً
    // لكن نحتفظ بسجل مباشر كـ fallback
    const deviceId2 = req.body.deviceId || TUYA.DEVICE_ID;
    const { data: doorData } = await supabase.from('doors').select('id').eq('device_id', deviceId2).single();
    await supabase.from('door_logs').insert({
      user_id: req.user.id,
      inst_id: req.user.inst_id,
      door_id: doorData?.id || null,
      value: action,
      source: req.user.name,
      created_at: new Date().toISOString(),
    });

    broadcast({ type: 'door_event', action, userId: req.user.id });
    await sendPushToAll({ title: `🚪 ${action === 'open' || action === 'open40' ? 'فتح الباب' : 'غلق الباب'}`, body: `بواسطة ${req.user.name}` });

    res.json({ success: true, action });
  } catch (err) {
    console.error('[Control Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── HISTORY ──────────────────────────────────────────────────────────────────
app.get('/api/history', authMiddleware, async (req, res) => {
  try {
    let query = supabase.from('door_logs').select('*').order('created_at', { ascending: false }).limit(100);
    if (req.user.role !== 'super_admin') query = query.eq('inst_id', req.user.inst_id);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── STATS ────────────────────────────────────────────────────────────────────
app.get('/api/stats', authMiddleware, adminOnly, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    let logsQuery = supabase.from('door_logs').select('id', { count: 'exact' }).gte('created_at', today);
    let usersQuery = supabase.from('users').select('id,status', { count: 'exact' });

    if (req.user.role !== 'super_admin') {
      logsQuery  = logsQuery.eq('inst_id', req.user.inst_id);
      usersQuery = usersQuery.eq('inst_id', req.user.inst_id);
    }

    const [{ count: todayActions }, { data: usersData }] = await Promise.all([logsQuery, usersQuery]);

    const activeUsers  = usersData?.filter(u => u.status === 'active').length || 0;
    const totalUsers   = usersData?.length || 0;

    res.json({ today_actions: todayActions || 0, active_users: activeUsers, total_users: totalUsers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── USERS ────────────────────────────────────────────────────────────────────
app.get('/api/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    let query = supabase.from('users')
      .select('id,name,phone,role,status,request_status,expire_date,note,inst_id')
      .order('created_at', { ascending: false });
    // فلتر حسب المؤسسة
    if (req.query.inst_id) {
      query = query.eq('inst_id', req.query.inst_id);
    } else if (req.user.role !== 'super_admin') {
      query = query.eq('inst_id', req.user.inst_id);
    }
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { name, phone, pw, role, expire_date, note } = req.body;
    if (!name || !phone || !pw) return res.status(400).json({ error: 'الاسم والهاتف وكلمة المرور مطلوبة' });

    const pw_hash = crypto.createHash('sha256').update(pw).digest('hex');
    const inst_id = req.user.role === 'super_admin' ? req.body.inst_id : req.user.inst_id;

    const { data, error } = await supabase.from('users').insert({
      name, phone, pw_hash,
      role: role || 'user',
      status: 'active',
      inst_id, expire_date, note,
      created_at: new Date().toISOString(),
    }).select().single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = {};
    const allowed = ['name', 'phone', 'role', 'status', 'expire_date', 'note'];
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    if (req.body.pw) updates.pw_hash = crypto.createHash('sha256').update(req.body.pw).digest('hex');

    const { data, error } = await supabase.from('users').update(updates).eq('id', id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── INSTITUTES ───────────────────────────────────────────────────────────────
app.get('/api/institutes', authMiddleware, async (req, res) => {
  try {
    let query = supabase.from('institutes').select('*').order('created_at', { ascending: false });
    if (req.user.role !== 'super_admin') query = query.eq('id', req.user.inst_id);
    const { data, error } = await query;
    if (error) throw error;

    // إضافة الأبواب والمستخدمين لكل مؤسسة
    const enriched = await Promise.all((data||[]).map(async inst => {
      const [{ data: doors }, { count: usersCount }] = await Promise.all([
        supabase.from('doors').select('*').eq('inst_id', inst.id),
        supabase.from('users').select('id', { count: 'exact' }).eq('inst_id', inst.id),
      ]);
      const { data: adminUser } = await supabase
        .from('users').select('phone').eq('inst_id', inst.id).eq('role', 'admin').limit(1).maybeSingle();
      return { ...inst, doors: doors||[], users_count: usersCount||0, admin_phone: adminUser?.phone };
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/institutes', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const { name, code, admin_phone, admin_pw } = req.body;
    if (!name || !code) return res.status(400).json({ error: 'الاسم والكود مطلوبان' });

    const { data: inst, error } = await supabase
      .from('institutes').insert({ name, code, created_at: new Date().toISOString() })
      .select().single();
    if (error) throw error;

    // إنشاء حساب المسؤول تلقائياً
    if (admin_phone && admin_pw) {
      const pw_hash = crypto.createHash('sha256').update(admin_pw).digest('hex');
      await supabase.from('users').insert({
        inst_id: inst.id, name: 'مسؤول ' + name,
        phone: admin_phone, pw_hash,
        pw_plain: encryptPw(admin_pw),
        role: 'admin', status: 'active',
        created_at: new Date().toISOString(),
      });
    }

    res.json(inst);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/institutes/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = {};
    ['schedule','gps','name','code'].forEach(k => {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    });

    const { data, error } = await supabase.from('institutes').update(updates).eq('id', id).select().single();
    if (error) throw error;

    // تحديث أو إنشاء حساب المسؤول
    if (req.body.admin_phone || req.body.admin_pw) {
      const { data: existingAdmin } = await supabase
        .from('users').select('id').eq('inst_id', id).eq('role', 'admin').single();

      if (existingAdmin) {
        const adminUpdates = {};
        if (req.body.admin_phone) adminUpdates.phone = req.body.admin_phone;
        if (req.body.admin_pw)    adminUpdates.pw_hash  = crypto.createHash('sha256').update(req.body.admin_pw).digest('hex');
        adminUpdates.pw_plain = encryptPw(req.body.admin_pw);
        await supabase.from('users').update(adminUpdates).eq('id', existingAdmin.id);
      } else if (req.body.admin_phone && req.body.admin_pw) {
        const pw_hash = crypto.createHash('sha256').update(req.body.admin_pw).digest('hex');
        await supabase.from('users').insert({
          inst_id: id, name: 'مسؤول ' + (req.body.name || data.name),
          phone: req.body.admin_phone, pw_hash, role: 'admin', status: 'active',
          created_at: new Date().toISOString(),
        });
      }
    }

    // جلب بيانات المسؤول لإرجاعها
    const { data: adminData } = await supabase
      .from('users').select('phone').eq('inst_id', id).eq('role', 'admin').single();

    res.json({ ...data, admin_phone: adminData?.phone });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/institutes/:id', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    await supabase.from('institutes').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUSH ─────────────────────────────────────────────────────────────────────
app.post('/api/push/subscribe', authMiddleware, async (req, res) => {
  try {
    const sub = req.body.subscription || req.body;
    await supabase.from('push_subscriptions').upsert({
      user_id: req.user.id,
      endpoint: sub.endpoint,
      p256dh:   sub.keys?.p256dh,
      auth:     sub.keys?.auth,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/push/vapid-key', (req, res) => res.json({ publicKey: VAPID_PUBLIC }));

// ─── Fallback ─────────────────────────────────────────────────────────────────

// ─── DOORS ────────────────────────────────────────────────────────────────────
app.get('/api/doors', authMiddleware, async (req, res) => {
  try {
    let query = supabase.from('doors').select('*').order('created_at');
    if (req.user.role !== 'super_admin') query = query.eq('inst_id', req.user.inst_id);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/doors', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { inst_id, name, location, device_id, duration_seconds } = req.body;
    const { data, error } = await supabase.from('doors').insert({
      inst_id: inst_id || req.user.inst_id,
      name, location, device_id,
      duration_seconds: duration_seconds || 5,
      created_at: new Date().toISOString(),
    }).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/doors/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const updates = {};
    ['name','location','device_id','duration_seconds','is_active','gps','schedule','rc_notify','door_type'].forEach(k => {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    });
    const { data, error } = await supabase.from('doors').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// سجل باب محدد
app.get('/api/doors/:id/logs', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('door_logs')
      .select('*')
      .eq('door_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/doors/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await supabase.from('doors').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// ─── DEVICE ONLINE STATUS ─────────────────────────────────────────────────────
app.get('/api/device/status/:deviceId', authMiddleware, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const token   = await getTuyaToken();
    const t       = Date.now().toString();
    const nonce   = crypto.randomBytes(16).toString('hex');
    const urlPath = `/v1.0/devices/${deviceId}`;
    const sign    = buildRequestSign({ token, t, nonce, method: 'GET', urlPath });

    const r = await fetch(`${TUYA.BASE_URL}${urlPath}`, {
      method: 'GET',
      headers: {
        'client_id': TUYA.CLIENT_ID, 'access_token': token,
        'sign': sign, 't': t, 'nonce': nonce,
        'sign_method': 'HMAC-SHA256', 'Content-Type': 'application/json',
      },
    });
    const data = await r.json();
    console.log('[Device Status]', deviceId, JSON.stringify(data?.result)?.slice(0,100));
    const online = data.result?.online === true;
    res.json({ success: true, online, device_id: deviceId, result: data.result });
  } catch (err) {
    res.json({ success: false, online: false });
  }
});


// السوبر أدمن يرى كلمة المرور
app.get('/api/users/:id/pw', authMiddleware, async (req, res) => {
  if (req.user.role !== 'super_admin')
    return res.status(403).json({ error: 'غير مسموح' });
  try {
    const { data } = await supabase.from('users').select('pw_plain,pw_hash,name').eq('id', req.params.id).single();
    const pw = data?.pw_plain ? decryptPw(data.pw_plain) : null;
    res.json({ pw: pw, name: data?.name });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// قائمة مستخدمي مؤسسة مع موقعهم
app.get('/api/institutes/:id/users', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id,name,phone,role,request_status,last_location,last_seen,created_at')
      .eq('inst_id', req.params.id)
      .neq('role', 'super_admin')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// تاريخ مواقع مستخدم (30 يوم)
app.get('/api/users/:id/locations', authMiddleware, async (req, res) => {
  if (!['super_admin','admin'].includes(req.user.role))
    return res.status(403).json({ error: 'غير مسموح' });
  try {
    const days = parseInt(req.query.days) || 30;
    const since = new Date(Date.now() - days*24*60*60*1000).toISOString();
    const { data, error } = await supabase
      .from('user_locations')
      .select('lat,lng,accuracy,created_at')
      .eq('user_id', req.params.id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw error;
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ─── Alerts ───────────────────────────────────────────────────────────────────
app.get('/api/alerts', authMiddleware, adminOnly, async (req, res) => {
  try {
    let query = supabase.from('access_alerts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (req.user.role !== 'super_admin') query = query.eq('inst_id', req.user.inst_id);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Stats
app.get('/api/stats/full', authMiddleware, adminOnly, async (req, res) => {
  try {
    const instId = req.user.role === 'super_admin' ? null : req.user.inst_id;
    const today  = new Date(); today.setHours(0,0,0,0);

    let logsQ = supabase.from('door_logs').select('value,created_at', { count: 'exact' });
    let alertsQ = supabase.from('access_alerts').select('id', { count: 'exact' });
    let usersQ = supabase.from('users').select('id,status', { count: 'exact' }).neq('role','super_admin');

    if (instId) { logsQ = logsQ.eq('inst_id', instId); alertsQ = alertsQ.eq('inst_id', instId); usersQ = usersQ.eq('inst_id', instId); }

    const [logs, alerts, users] = await Promise.all([logsQ, alertsQ, usersQ]);

    const todayLogs = (logs.data||[]).filter(l => new Date(l.created_at) >= today).length;
    const openCount = (logs.data||[]).filter(l => l.value === 'open' || l.value === 'open40').length;

    res.json({
      today_actions: todayLogs,
      total_actions: logs.count || 0,
      total_opens:   openCount,
      alert_count:   alerts.count || 0,
      total_users:   users.count || 0,
      active_users:  (users.data||[]).filter(u => u.status === 'active').length,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ─── طلب موقع مستخدم فوري ────────────────────────────────────────────────────
app.post('/api/users/:id/request-location', authMiddleware, async (req, res) => {
  if (req.user.role !== 'super_admin' && req.user.role !== 'admin')
    return res.status(403).json({ error: 'غير مسموح' });
  try {
    const targetId = req.params.id;
    // إرسال طلب عبر WebSocket إذا كان المستخدم متصلاً
    const targetWs = wsClients.get(targetId);
    if (targetWs && targetWs.readyState === 1) {
      targetWs.send(JSON.stringify({
        type: 'location_request',
        from: req.user.name,
        requestId: Date.now().toString()
      }));
      res.json({ success: true, method: 'websocket' });
    } else {
      // المستخدم غير متصل — إرجاع آخر موقع معروف
      const { data } = await supabase.from('users')
        .select('last_location,last_seen,name').eq('id', targetId).single();
      res.json({
        success: false,
        offline: true,
        last_location: data?.last_location,
        last_seen: data?.last_seen,
        name: data?.name
      });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ─── Device Fingerprint ───────────────────────────────────────────────────────
app.post('/api/device/fingerprint', authMiddleware, async (req, res) => {
  try {
    const fp = {
      ua: req.body.ua, lang: req.body.lang,
      tz: req.body.tz, screen: req.body.screen,
      platform: req.body.platform,
      ip: req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress,
    };
    // حفظ أو تحديث fingerprint
    const { data: existing } = await supabase.from('users')
      .select('device_fp').eq('id', req.user.id).single();

    if (!existing?.device_fp) {
      // أول مرة — حفظ
      await supabase.from('users').update({ device_fp: fp }).eq('id', req.user.id);
    } else {
      // فحص تغيير الجهاز
      const prev = existing.device_fp;
      if (prev.ua !== fp.ua || prev.screen !== fp.screen) {
        // تنبيه تغيير الجهاز
        await supabase.from('access_alerts').insert({
          user_id: req.user.id, inst_id: req.user.inst_id,
          type: 'device_changed',
          message: `تغيير جهاز: ${prev.screen}→${fp.screen} / ${prev.ua?.slice(0,30)}→${fp.ua?.slice(0,30)}`,
          created_at: new Date().toISOString(),
        }).catch(()=>{});
        await supabase.from('users').update({ device_fp: fp }).eq('id', req.user.id);
      }
    }
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false }); }
});


// ─── Tuya Webhook ────────────────────────────────────────────────────────────

app.post('/api/tuya/webhook', async (req, res) => {
  try {
    const t     = req.headers['t'] || '';
    const sign  = req.headers['sign'] || '';
    const nonce = req.headers['nonce'] || '';
    const body  = JSON.stringify(req.body);

    // التحقق من التوقيع
    const strToSign = TUYA.CLIENT_ID + t + nonce + body;
    const expected  = crypto.createHmac('sha256', TUYA.SECRET)
      .update(strToSign).digest('hex').toUpperCase();
    if (sign && sign !== expected) {
      return res.status(401).json({ code: 'SIGN_INVALID' });
    }

    const event = req.body;
    console.log('[Tuya Webhook]', JSON.stringify(event).slice(0, 200));

    if (event.devId) {
      const deviceId = event.devId;
      const status   = event.status || [];

      const { data: door } = await supabase
        .from('doors').select('id,inst_id,name').eq('device_id', deviceId).single();

      if (door) {
        const state = {};
        status.forEach(s => { state[s.code] = s.value; });

        const r1 = state['switch_1'] === true || state['switch_1'] === 'true';
        const r2 = state['switch_2'] === true || state['switch_2'] === 'true';

        let doorAction = 'idle';
        if (r1) doorAction = 'open';
        else if (r2) doorAction = 'close';

        // ─── هل الأمر جاء من التطبيق أم من RC؟ ───
        const lastApp = appLastAction.get(deviceId);
        const isFromApp = lastApp && (Date.now() - lastApp.time) < 15000; // خلال 15 ثانية
        const source = isFromApp ? 'app' : 'rc';

        // تسجيل في door_logs فقط عند تغيير حقيقي (R1 أو R2 = ON)
        if (r1 || r2) {
          await supabase.from('door_logs').insert({
            door_id:    door.id,
            inst_id:    door.inst_id,
            user_id:    isFromApp ? lastApp.userId : null,
            value:      doorAction,
            source:     isFromApp ? lastApp.userName : 'RC (جهاز تحكم)',
            created_at: new Date().toISOString(),
          });

          if (!isFromApp) {
            console.log(`[Webhook] 📻 RC فتح الباب ${door.name}`);
          }
        }

        // إرسال للعملاء عبر WebSocket
        broadcast({
          type:     'door_state',
          deviceId:  deviceId,
          doorId:    door.id,
          instId:    door.inst_id,
          r1_on:     r1,
          r2_on:     r2,
          state:     doorAction,
          source:    source,
          timestamp: Date.now(),
        });
      }
    }

    res.json({ success: true });
  } catch(err) {
    console.error('[Webhook Error]', err.message);
    res.status(200).json({ success: true });
  }
});


// ─── Door Status Polling ──────────────────────────────────────────────────────


// ─── Door Tracking ────────────────────────────────────────────────────────────
const doorStateCache = new Map();
const appLastAction  = new Map();

function markAppAction(deviceId, userId, userName, action) {
  appLastAction.set(deviceId, { action, userId, userName, time: Date.now() });
}

// كاش حالة الاتصال لكل جهاز
const deviceOnlineCache = new Map(); // deviceId → true/false

async function checkDeviceOnline(deviceId) {
  try {
    const token   = await getTuyaToken();
    const t       = Date.now().toString();
    const nonce   = crypto.randomBytes(8).toString('hex');
    const urlPath = `/v1.0/devices/${deviceId}`;
    const sign    = buildRequestSign({ token, t, nonce, method: 'GET', urlPath });
    const r = await fetch(`${TUYA.BASE_URL}${urlPath}`, {
      method: 'GET',
      headers: {
        'client_id': TUYA.CLIENT_ID, 'access_token': token,
        'sign': sign, 't': t, 'nonce': nonce,
        'sign_method': 'HMAC-SHA256', 'Content-Type': 'application/json',
      },
    });
    const data = await r.json();
    const online = data.result?.online === true;
    const wasOnline = deviceOnlineCache.get(deviceId);

    // إذا تغيرت حالة الاتصال → بث فوري
    if (wasOnline !== undefined && wasOnline !== online) {
      console.log(`[Polling] ${online ? '🟢 En ligne' : '🔴 Hors ligne'}: ${deviceId}`);
      broadcast({ type: 'device_online', deviceId, online, timestamp: Date.now() });
    }
    deviceOnlineCache.set(deviceId, online);
    return online;
  } catch(e) { return deviceOnlineCache.get(deviceId) ?? false; }
}

// ─── نظام Polling الذكي ───────────────────────────────
// عادي:   3000ms
// نشاط:    200ms (عند تغيير حالة الباب)
// offline: 30000ms (عند عدم الاستجابة)
// يرجع للـ 3000ms بعد n ثانية بدون تغيير

const POLL_NORMAL  = 3000;
const POLL_FAST    = 200;
const POLL_OFFLINE = 30000;

let _pollInterval    = POLL_NORMAL;
let _lastChange      = 0;        // آخر تغيير في الحالة
let _lastChangeDur   = 5;        // مدة n للباب الذي تغير
let _pollTimer       = null;
const deviceOffline  = new Map(); // deviceId → true إذا offline


async function checkAutoSchedule() {
  try {
    const { data: doors } = await supabase.from('doors')
      .select('id,device_id,auto_schedule,inst_id').not('auto_schedule', 'is', null);
    if (!doors?.length) return;

    const now   = new Date();
    const dayMap = [6,0,1,2,3,4,5]; // الأحد=0 في JS → الأحد=6 في جدولنا
    const todayIdx = dayMap[now.getDay()];
    const timeStr  = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');

    for (const door of doors) {
      if (!door.auto_schedule) continue;
      const sched = door.auto_schedule;
      const day   = sched[todayIdx];
      if (!day || !day.enabled) continue;

      // فتح تلقائي
      if (day.open_time && timeStr === day.open_time) {
        const token   = await getTuyaToken();
        await sendTuyaCommands(door.device_id, [{ code: 'switch_1', value: true }]);
        console.log(`[AutoSchedule] فتح تلقائي: ${door.device_id}`);
      }
      // غلق تلقائي
      if (day.close_time && timeStr === day.close_time) {
        await sendTuyaCommands(door.device_id, [{ code: 'switch_2', value: true }]);
        console.log(`[AutoSchedule] غلق تلقائي: ${door.device_id}`);
      }
    }
  } catch(e) { console.error('[AutoSchedule Error]', e.message); }
}

async function pollAllDoors() {
  // ─── تنفيذ الجدول التلقائي ───
  await checkAutoSchedule();
  try {
    const { data: doors } = await supabase
      .from('doors').select('id,inst_id,name,device_id,rc_notify,auto_schedule')
      .not('device_id', 'is', null);
    if (!doors?.length) return;

    let anyOffline = false;
    let anyChange  = false;

    for (const door of doors) {
      if (!door.inst_id) continue;
      try {
        const token   = await getTuyaToken();
        const t       = Date.now().toString();
        const nonce   = crypto.randomBytes(8).toString('hex');
        const urlPath = `/v1.0/devices/${door.device_id}/status`;
        const sign    = buildRequestSign({ token, t, nonce, method: 'GET', urlPath });
        const r = await fetch(`${TUYA.BASE_URL}${urlPath}`, {
          method: 'GET',
          headers: {
            'client_id': TUYA.CLIENT_ID, 'access_token': token,
            'sign': sign, 't': t, 'nonce': nonce,
            'sign_method': 'HMAC-SHA256', 'Content-Type': 'application/json',
          },
        });
        const data = await r.json();

        // كشف offline: result فارغ أو success=false
        const isOnline = data.success && Array.isArray(data.result) && data.result.length > 0;
        const wasOnline = !deviceOffline.get(door.device_id);
        if (wasOnline !== isOnline) {
          deviceOffline.set(door.device_id, !isOnline);
          broadcast({ type: 'device_online', deviceId: door.device_id, online: isOnline, timestamp: Date.now() });
          // إشعار للأدمن عند فقدان الاتصال
          if (!isOnline && wasOnline) {
            sendPushToAdmins(door.inst_id, {
              title: '⚠️ انقطع اتصال الجهاز',
              body: 'الباب "' + door.name + '" غير متصل بالإنترنت',
            });
            console.log(`[Offline Alert] ${door.name}`);
          }
        }
        if (!isOnline) { anyOffline = true; continue; }

        const sm = {};
        data.result.forEach(s => { sm[s.code] = s.value; });
        const r1 = sm['switch_1'] === true || sm['switch_1'] === 'true' || sm['switch_1'] === 1;
        const r2 = sm['switch_2'] === true || sm['switch_2'] === 'true' || sm['switch_2'] === 1;

        const prev    = doorStateCache.get(door.device_id);
        const changed = !prev || prev.r1 !== r1 || prev.r2 !== r2;
        const doorAction = r1 ? 'open' : r2 ? 'close' : 'idle';

        doorStateCache.set(door.device_id, { r1, r2 });

        if (changed) {
          anyChange = true;
          _lastChange = Date.now(); // سجّل وقت آخر تغيير
          _pollInterval = POLL_FAST; // انتقل فوراً لـ 0.2s

          const lastApp   = appLastAction.get(door.device_id);
          const isFromApp = lastApp && (Date.now() - lastApp.time) < 15000;

          // RC insert
          if (!isFromApp && (r1 || r2)) {
            supabase.from('door_logs').insert({
              door_id: door.id, inst_id: door.inst_id, user_id: null,
              value: doorAction, source: 'RC (جهاز تحكم)',
              created_at: new Date().toISOString(),
            }).then(({ error }) => { if (error) console.error('[RC insert]', error.message); });

            if (door.rc_notify) {
              const rcLabel = doorAction === 'open' ? 'فتح الباب' : 'غلق الباب';
              sendPushToAdmins(door.inst_id, {
                title: 'إشعار RC 📻',
                body: rcLabel + ' بواسطة RC — ' + door.name,
              });
            }
          }

          // بث للواجهة
          broadcast({
            type: 'door_state', deviceId: door.device_id,
            doorId: door.id, instId: door.inst_id,
            r1_on: r1, r2_on: r2, state: doorAction,
            source: isFromApp ? 'app' : 'rc', timestamp: Date.now(),
          });
        }
      } catch(e) {}
    }

    // حساب الـ interval التالي
    const now       = Date.now();
    const sinceChange = (now - _lastChange) / 1000; // ثوانٍ منذ آخر تغيير
    const n         = _lastChangeDur || 5;

    // إذا مرّت n ثانية بدون تغيير → رجوع 3s
    const sinceLastChange = (Date.now() - _lastChange) / 1000;
    if (sinceLastChange < n + 1) {
      _pollInterval = POLL_FAST;   // نشاط → 0.2s
    } else {
      _pollInterval = POLL_NORMAL; // هدوء → 3s
    }

  } catch(e) { console.error('[Polling Error]', e.message); }
}

function triggerBurst(durationSec) {
  _lastChange    = Date.now();
  _lastChangeDur = durationSec || 10;
  _pollInterval  = POLL_FAST;
}


async function sendPushToAdmins(instId, notification) {
  if (!VAPID_PRIVATE) return;
  try {
    const { data: admins } = await supabase.from('users').select('id')
      .eq('inst_id', instId).in('role', ['admin']).eq('status','active');
    if (!admins?.length) return;
    const { data: subs } = await supabase.from('push_subscriptions').select('*')
      .in('user_id', admins.map(a => a.id));
    if (!subs?.length) return;
    const payload = JSON.stringify(notification);
    await Promise.allSettled(subs.map(sub =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      ).catch(err => {
        if (err.statusCode === 410)
          supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      })
    ));
  } catch(e) { console.error('[Push Error]', e.message); }
}

function startPolling() {
  async function run() {
    await pollAllDoors();
    _pollTimer = setTimeout(run, _pollInterval);
  }
  console.log('[Polling] بدأ (عادي:3s / نشاط:0.2s / offline:30s)');
  _pollTimer = setTimeout(run, 5000);
}
startPolling();

// مسار Webhook القديم كـ alias
app.post('/api/webhook/tuya', async (req, res) => {
  // redirect to new handler
  req.url = '/api/tuya/webhook';
  app.handle(req, res);
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔑 Tuya Client ID: ${TUYA.CLIENT_ID}`);
  console.log(`⏱️  Default duration: ${DEFAULT_DURATION}s`);
  console.log(`🔌 WebSocket ready`);
});
