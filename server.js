import express from 'express';
import crypto from 'crypto';
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

const TUYA = {
  CLIENT_ID: process.env.TUYA_CLIENT_ID || 'y85me8yq7d3vvk7vghuy',
  SECRET:    process.env.TUYA_SECRET    || '59525637e59245bea73190da68e3c7e9',
  DEVICE_ID: process.env.TUYA_DEVICE_ID || 'bf7c670914391fc80cwayk',
  BASE_URL:  process.env.TUYA_BASE_URL  || 'https://openapi.tuyaeu.com',
};

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC  || 'BOfIw6laarxGfV8Ezc04YzfCzq4Njm7ewizkfnGDIWJGpsfHkqUHVG8SXGb8cJZJxOTIzFeauX4K0Z8oYdfgKTw';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE;

const EMPTY_BODY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

// مدة الفتح الافتراضية بالثواني (يمكن تغييرها لكل باب)
const DEFAULT_DURATION = parseInt(process.env.DEFAULT_DURATION || '5');

// ─── Supabase ─────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);

// ─── Web Push ─────────────────────────────────────────────────────────────────
if (VAPID_PRIVATE) {
  webpush.setVapidDetails('mailto:admin@porte.app', VAPID_PUBLIC, VAPID_PRIVATE);
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');
  ws.send(JSON.stringify({ type: 'connected' }));
  ws.on('close', () => console.log('[WS] Client disconnected'));
});

// ─── Tuya Token ───────────────────────────────────────────────────────────────
let tuyaTokenCache = { token: null, expiresAt: 0 };

function hmacSign(str) {
  return crypto.createHmac('sha256', TUYA.SECRET).update(str).digest('hex').toUpperCase();
}

function buildTokenSign(t) {
  const url          = '/v1.0/token?grant_type=1';
  const stringToSign = ['GET', EMPTY_BODY_HASH, '', url].join('\n');
  return hmacSign(TUYA.CLIENT_ID + t + '' + stringToSign);
}

function buildRequestSign({ token, t, nonce, method, urlPath, body = '' }) {
  const bodyHash     = body
    ? crypto.createHash('sha256').update(body).digest('hex')
    : EMPTY_BODY_HASH;
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
    headers: {
      'client_id': TUYA.CLIENT_ID, 'sign': sign,
      't': t, 'sign_method': 'HMAC-SHA256', 'nonce': '',
      'Content-Type': 'application/json',
    },
  });

  const data = await res.json();
  console.log('[Tuya] Token:', data.success ? '✅' : `❌ ${data.msg}`);
  if (!data.success) throw new Error(`Tuya token error: ${data.msg}`);

  tuyaTokenCache = {
    token:     data.result.access_token,
    expiresAt: now + (data.result.expire_time * 1000) - 60000,
  };
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
    headers: {
      'client_id': TUYA.CLIENT_ID, 'access_token': token,
      'sign': sign, 't': t, 'nonce': nonce,
      'sign_method': 'HMAC-SHA256', 'Content-Type': 'application/json',
    },
    body,
  });

  const data = await res.json();
  console.log('[Tuya] Commands:', JSON.stringify(data));
  return data;
}

async function getTuyaDeviceStatus(deviceId) {
  const token   = await getTuyaToken();
  const t       = Date.now().toString();
  const nonce   = crypto.randomBytes(16).toString('hex');
  const urlPath = `/v1.0/devices/${deviceId}/status`;
  const sign    = buildRequestSign({ token, t, nonce, method: 'GET', urlPath });

  const res = await fetch(`${TUYA.BASE_URL}${urlPath}`, {
    method: 'GET',
    headers: {
      'client_id': TUYA.CLIENT_ID, 'access_token': token,
      'sign': sign, 't': t, 'nonce': nonce,
      'sign_method': 'HMAC-SHA256', 'Content-Type': 'application/json',
    },
  });

  const data = await res.json();
  return data;
}

// ─── منطق الباب الذكي ─────────────────────────────────────────────────────────
/**
 * فتح الباب:
 * 1. إذا R2 شغّال → أوقفه أولاً
 * 2. شغّل R1 مع countdown بـ X ثانية (Tuya يوقفه تلقائياً)
 *
 * غلق الباب:
 * 1. إذا R1 شغّال → أوقفه أولاً
 * 2. شغّل R2 مع countdown بـ X ثانية (Tuya يوقفه تلقائياً)
 */
async function openDoor(deviceId, durationSeconds) {
  // اقرأ الحالة الحالية
  const statusData = await getTuyaDeviceStatus(deviceId);
  const status     = statusData.result || [];
  const r2Status   = status.find(s => s.code === 'switch_2')?.value;

  console.log(`[Door] Open - R2 status: ${r2Status}, duration: ${durationSeconds}s`);

  const commands = [];

  // إذا R2 شغّال، أوقفه أولاً
  if (r2Status === true) {
    commands.push({ code: 'switch_2', value: false });
  }

  // شغّل R1 مع countdown
  commands.push({ code: 'switch_1', value: true });
  commands.push({ code: 'countdown_1', value: durationSeconds });

  return await sendTuyaCommands(deviceId, commands);
}

async function closeDoor(deviceId, durationSeconds) {
  // اقرأ الحالة الحالية
  const statusData = await getTuyaDeviceStatus(deviceId);
  const status     = statusData.result || [];
  const r1Status   = status.find(s => s.code === 'switch_1')?.value;

  console.log(`[Door] Close - R1 status: ${r1Status}, duration: ${durationSeconds}s`);

  const commands = [];

  // إذا R1 شغّال، أوقفه أولاً
  if (r1Status === true) {
    commands.push({ code: 'switch_1', value: false });
  }

  // شغّل R2 مع countdown
  commands.push({ code: 'switch_2', value: true });
  commands.push({ code: 'countdown_2', value: durationSeconds });

  return await sendTuyaCommands(deviceId, commands);
}

async function stopDoor(deviceId) {
  console.log('[Door] Stop - turning off both R1 and R2');
  return await sendTuyaCommands(deviceId, [
    { code: 'switch_1', value: false },
    { code: 'switch_2', value: false },
  ]);
}

// ─── جلب مدة الباب من Supabase ───────────────────────────────────────────────
async function getDoorDuration(doorId) {
  try {
    const { data } = await supabase
      .from('doors')
      .select('duration_seconds')
      .eq('id', doorId)
      .single();
    return data?.duration_seconds || DEFAULT_DURATION;
  } catch {
    return DEFAULT_DURATION;
  }
}

// ─── Push ─────────────────────────────────────────────────────────────────────
async function sendPushToAll(notification) {
  if (!VAPID_PRIVATE) return;
  try {
    const { data: subs } = await supabase.from('push_subscriptions').select('*');
    if (!subs?.length) return;
    const payload = JSON.stringify(notification);
    await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        ).catch(err => {
          if (err.statusCode === 410)
            supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        })
      )
    );
  } catch (err) { console.error('[Push Error]', err); }
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ✅ فتح الباب
app.post('/api/door/open', async (req, res) => {
  try {
    const { userId, doorId } = req.body;
    const deviceId = req.body.deviceId || TUYA.DEVICE_ID;
    const duration = doorId
      ? await getDoorDuration(doorId)
      : (req.body.duration || DEFAULT_DURATION);

    const result = await openDoor(deviceId, duration);
    if (!result.success) return res.status(500).json({ success: false, error: result.msg });

    await supabase.from('door_logs').insert({
      door_id: doorId || null,
      user_id: userId || null,
      action: 'open', source: 'app', success: true,
      created_at: new Date().toISOString(),
    });

    broadcast({ type: 'door_event', action: 'open', doorId, userId, duration });
    await sendPushToAll({ title: '🚪 الباب مفتوح', body: `سيُغلق بعد ${duration} ثانية` });

    res.json({ success: true, message: `تم فتح الباب لمدة ${duration} ثانية` });
  } catch (err) {
    console.error('[Open Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ غلق الباب
app.post('/api/door/close', async (req, res) => {
  try {
    const { userId, doorId } = req.body;
    const deviceId = req.body.deviceId || TUYA.DEVICE_ID;
    const duration = doorId
      ? await getDoorDuration(doorId)
      : (req.body.duration || DEFAULT_DURATION);

    const result = await closeDoor(deviceId, duration);
    if (!result.success) return res.status(500).json({ success: false, error: result.msg });

    await supabase.from('door_logs').insert({
      door_id: doorId || null,
      user_id: userId || null,
      action: 'close', source: 'app', success: true,
      created_at: new Date().toISOString(),
    });

    broadcast({ type: 'door_event', action: 'close', doorId, userId });

    res.json({ success: true, message: 'تم غلق الباب' });
  } catch (err) {
    console.error('[Close Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ إيقاف فوري
app.post('/api/door/stop', async (req, res) => {
  try {
    const { doorId } = req.body;
    const deviceId = req.body.deviceId || TUYA.DEVICE_ID;

    await stopDoor(deviceId);
    broadcast({ type: 'door_event', action: 'stop', doorId });
    res.json({ success: true, message: 'تم الإيقاف' });
  } catch (err) {
    console.error('[Stop Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ /api/door/control (يدعم open/close/stop/pulse)
app.post('/api/door/control', async (req, res) => {
  try {
    const { action, userId, doorId, duration: reqDuration } = req.body;
    const deviceId = req.body.deviceId || TUYA.DEVICE_ID;
    const duration = doorId
      ? await getDoorDuration(doorId)
      : (reqDuration || DEFAULT_DURATION);

    let result;
    if (action === 'open')  result = await openDoor(deviceId, duration);
    else if (action === 'close') result = await closeDoor(deviceId, duration);
    else if (action === 'stop')  result = await stopDoor(deviceId);
    else return res.status(400).json({ success: false, error: 'action غير معروف' });

    if (result && !result.success)
      return res.status(500).json({ success: false, error: result.msg });

    await supabase.from('door_logs').insert({
      door_id: doorId || null, user_id: userId || null,
      action, source: 'app', success: true,
      created_at: new Date().toISOString(),
    });

    broadcast({ type: 'door_event', action, doorId, userId, duration });
    res.json({ success: true, message: `تم تنفيذ: ${action}` });
  } catch (err) {
    console.error('[Control Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ حالة الباب
app.get('/api/door/status', async (req, res) => {
  try {
    const deviceId = req.query.deviceId || TUYA.DEVICE_ID;
    const data     = await getTuyaDeviceStatus(deviceId);
    const status   = data.result || [];

    const r1 = status.find(s => s.code === 'switch_1')?.value;
    const r2 = status.find(s => s.code === 'switch_2')?.value;
    const c1 = status.find(s => s.code === 'countdown_1')?.value;
    const c2 = status.find(s => s.code === 'countdown_2')?.value;

    res.json({
      success: true,
      door: {
        state: r1 ? 'opening' : r2 ? 'closing' : 'idle',
        r1_on: r1,
        r2_on: r2,
        countdown_open:  c1,
        countdown_close: c2,
      },
    });
  } catch (err) {
    console.error('[Status Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ تحديث مدة باب (Super Admin)
app.patch('/api/door/:doorId/duration', async (req, res) => {
  try {
    const { doorId } = req.params;
    const { duration } = req.body; // بالثواني

    if (!duration || duration < 1 || duration > 300)
      return res.status(400).json({ success: false, error: 'المدة يجب أن تكون بين 1 و 300 ثانية' });

    const { error } = await supabase
      .from('doors')
      .update({ duration_seconds: duration })
      .eq('id', doorId);

    if (error) throw error;

    broadcast({ type: 'duration_updated', doorId, duration });
    res.json({ success: true, duration, message: `تم تحديث المدة إلى ${duration} ثانية` });
  } catch (err) {
    console.error('[Duration Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ سجل العمليات
app.get('/api/door/logs', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('door_logs').select('*')
      .order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    res.json({ success: true, logs: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ Push
app.post('/api/push/subscribe', async (req, res) => {
  try {
    const sub = req.body;
    await supabase.from('push_subscriptions').upsert({
      endpoint: sub.endpoint, p256dh: sub.keys?.p256dh, auth: sub.keys?.auth,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/push/vapid-key', (req, res) => res.json({ publicKey: VAPID_PUBLIC }));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔑 Tuya Client ID: ${TUYA.CLIENT_ID}`);
  console.log(`🌐 Tuya Base URL: ${TUYA.BASE_URL}`);
  console.log(`⏱️  Default duration: ${DEFAULT_DURATION}s`);
  console.log(`📱 VAPID configured: ${!!VAPID_PRIVATE}`);
  console.log(`🔌 WebSocket ready`);
});
