import express from 'express';
import crypto from 'crypto';

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
app.post('/api/auth/login', async (req, res) => {
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
          const userLat = parseFloat(req.body.lat);
          const userLng = parseFloat(req.body.lng);
          if (!userLat || !userLng) {
            await supabase.from('access_alerts').insert({
              user_id: req.user.id, inst_id: req.user.inst_id,
              type: 'gps_required', action: action,
              message: 'محاولة فتح الباب بدون GPS',
              created_at: new Date().toISOString(),
            }).catch(()=>{});
            return res.status(403).json({ error: 'يجب تفعيل GPS للوصول إلى هذا الباب', code: 'GPS_REQUIRED' });
          }
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

    // سجّل العملية
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
        .from('users').select('phone').eq('inst_id', inst.id).eq('role', 'admin').single();
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
    ['name','location','device_id','duration_seconds','is_active','gps','schedule'].forEach(k => {
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

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔑 Tuya Client ID: ${TUYA.CLIENT_ID}`);
  console.log(`⏱️  Default duration: ${DEFAULT_DURATION}s`);
  console.log(`🔌 WebSocket ready`);
});
