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
const SUPABASE_URL      = process.env.SUPABASE_URL      || 'https://sjfaootvlxesdytdsknc.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqZmFvb3R2bHhlc2R5dGRza25jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxODAyNTcsImV4cCI6MjA4ODc1NjI1N30.pEhpszTGygiR6brpWHglnpcASAPw7kyWl0qd5mFwwMQ';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const TUYA = {
  CLIENT_ID: process.env.TUYA_CLIENT_ID || '59gmr8xdf3m5vdt55c89',
  SECRET:    process.env.TUYA_SECRET    || 'f551321a6229419098b3c40728460bdd',
  DEVICE_ID: process.env.TUYA_DEVICE_ID || 'bf7c670914391fc80cwayk',
  BASE_URL:  process.env.TUYA_BASE_URL  || 'https://openapi.tuyaeu.com',
};

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC  || 'BOfIw6laarxGfV8Ezc04YzfCzq4Njm7ewizkfnGDIWJGpsfHkqUHVG8SXGb8cJZJxOTIzFeauX4K0Z8oYdfgKTw';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE;

const EMPTY_BODY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

// ─── Supabase ─────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);

// ─── Web Push ─────────────────────────────────────────────────────────────────
if (VAPID_PRIVATE) {
  webpush.setVapidDetails('mailto:admin@porte.app', VAPID_PUBLIC, VAPID_PRIVATE);
}

// ─── WebSocket broadcast ──────────────────────────────────────────────────────
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

wss.on('connection', (ws, req) => {
  // Extract token from query string for auth
  const url   = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  console.log('[WS] Client connected, token present:', !!token);

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      console.log('[WS] Received:', data);
    } catch (e) { /* ignore */ }
  });

  ws.on('close', () => console.log('[WS] Client disconnected'));

  // Send current status on connect
  ws.send(JSON.stringify({ type: 'connected', message: 'WebSocket ready' }));
});

// ─── Tuya Token Cache ─────────────────────────────────────────────────────────
let tuyaTokenCache = { token: null, expiresAt: 0 };

function hmacSign(str) {
  return crypto.createHmac('sha256', TUYA.SECRET).update(str).digest('hex').toUpperCase();
}

// ✅ التوقيع الصحيح لطلب التوكن (الخوارزمية الجديدة post-2021)
function buildTokenSign(t) {
  const url          = '/v1.0/token?grant_type=1';
  const stringToSign = ['GET', EMPTY_BODY_HASH, '', url].join('\n');
  const str          = TUYA.CLIENT_ID + t + '' + stringToSign;
  console.log('[Tuya] Token signStr:', str);
  return hmacSign(str);
}

// ✅ التوقيع الصحيح للطلبات العادية
function buildRequestSign({ token, t, nonce, method, urlPath, body = '' }) {
  const bodyHash     = body
    ? crypto.createHash('sha256').update(body).digest('hex')
    : EMPTY_BODY_HASH;
  const stringToSign = [method.toUpperCase(), bodyHash, '', urlPath].join('\n');
  const str          = TUYA.CLIENT_ID + token + t + nonce + stringToSign;
  console.log('[Tuya] Request signStr:', str);
  return hmacSign(str);
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
  console.log('[Tuya] Token response:', JSON.stringify(data));

  if (!data.success) throw new Error(`Tuya token error: ${data.msg} (code: ${data.code})`);

  tuyaTokenCache = {
    token:     data.result.access_token,
    expiresAt: now + (data.result.expire_time * 1000) - 60000,
  };
  return tuyaTokenCache.token;
}

async function sendTuyaCommand(commands) {
  const token   = await getTuyaToken();
  const t       = Date.now().toString();
  const nonce   = crypto.randomBytes(16).toString('hex');
  const urlPath = `/v1.0/devices/${TUYA.DEVICE_ID}/commands`;
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
  console.log('[Tuya] Command response:', JSON.stringify(data));
  return data;
}

async function getTuyaDeviceStatus() {
  const token   = await getTuyaToken();
  const t       = Date.now().toString();
  const nonce   = crypto.randomBytes(16).toString('hex');
  const urlPath = `/v1.0/devices/${TUYA.DEVICE_ID}/status`;
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
  console.log('[Tuya] Status response:', JSON.stringify(data));
  return data;
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

// فتح الباب
app.post('/api/door/open', async (req, res) => {
  try {
    const { userId, reason } = req.body;
    const result = await sendTuyaCommand([{ code: 'switch_1', value: true }]);
    if (!result.success) return res.status(500).json({ success: false, error: result.msg });
    await supabase.from('door_logs').insert({
      user_id: userId || 'unknown', action: 'open', reason: reason || 'manual',
      success: true, created_at: new Date().toISOString(),
    });
    broadcast({ type: 'door_event', action: 'open', userId });
    await sendPushToAll({ title: '🚪 الباب مفتوح', body: `بواسطة ${userId || 'مجهول'}` });
    res.json({ success: true, message: 'تم فتح الباب' });
  } catch (err) {
    console.error('[Door Open Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// إغلاق الباب
app.post('/api/door/close', async (req, res) => {
  try {
    const { userId } = req.body;
    const result = await sendTuyaCommand([{ code: 'switch_1', value: false }]);
    if (!result.success) return res.status(500).json({ success: false, error: result.msg });
    await supabase.from('door_logs').insert({
      user_id: userId || 'unknown', action: 'close', success: true,
      created_at: new Date().toISOString(),
    });
    broadcast({ type: 'door_event', action: 'close', userId });
    res.json({ success: true, message: 'تم إغلاق الباب' });
  } catch (err) {
    console.error('[Door Close Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ endpoint جديد: /api/door/control (الذي يطلبه app.js)
app.post('/api/door/control', async (req, res) => {
  try {
    const { action, userId, duration } = req.body;
    // action: 'open' | 'close' | 'stop' | 'pulse'

    if (action === 'open') {
      const result = await sendTuyaCommand([{ code: 'switch_1', value: true }]);
      if (!result.success) return res.status(500).json({ success: false, error: result.msg });
      await supabase.from('door_logs').insert({
        user_id: userId || 'unknown', action: 'open', success: true,
        created_at: new Date().toISOString(),
      });
      broadcast({ type: 'door_event', action: 'open', userId });
      await sendPushToAll({ title: '🚪 الباب مفتوح', body: `بواسطة ${userId || 'مجهول'}` });
      return res.json({ success: true, message: 'تم فتح الباب' });
    }

    if (action === 'close') {
      const result = await sendTuyaCommand([{ code: 'switch_1', value: false }]);
      if (!result.success) return res.status(500).json({ success: false, error: result.msg });
      await supabase.from('door_logs').insert({
        user_id: userId || 'unknown', action: 'close', success: true,
        created_at: new Date().toISOString(),
      });
      broadcast({ type: 'door_event', action: 'close', userId });
      return res.json({ success: true, message: 'تم إغلاق الباب' });
    }

    if (action === 'stop') {
      // بعض الأجهزة تدعم stop
      const result = await sendTuyaCommand([{ code: 'stop', value: true }]);
      broadcast({ type: 'door_event', action: 'stop', userId });
      return res.json({ success: result.success, message: 'تم إيقاف الباب' });
    }

    if (action === 'pulse') {
      // فتح ثم إغلاق بعد مدة (افتراضي 40 ثانية)
      const ms = (duration || 40) * 1000;
      const r1 = await sendTuyaCommand([{ code: 'switch_1', value: true }]);
      if (!r1.success) return res.status(500).json({ success: false, error: r1.msg });
      broadcast({ type: 'door_event', action: 'open', userId });
      setTimeout(async () => {
        await sendTuyaCommand([{ code: 'switch_1', value: false }]);
        broadcast({ type: 'door_event', action: 'close', userId: 'auto' });
      }, ms);
      return res.json({ success: true, message: `فتح لمدة ${duration || 40} ثانية` });
    }

    res.status(400).json({ success: false, error: 'action غير معروف' });
  } catch (err) {
    console.error('[Door Control Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// حالة الباب
app.get('/api/door/status', async (req, res) => {
  try {
    const data = await getTuyaDeviceStatus();
    res.json({ success: true, status: data.result });
  } catch (err) {
    console.error('[Door Status Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// سجل العمليات
app.get('/api/door/logs', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('door_logs').select('*')
      .order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    res.json({ success: true, logs: data });
  } catch (err) {
    console.error('[Logs Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Push subscribe
app.post('/api/push/subscribe', async (req, res) => {
  try {
    const sub = req.body;
    await supabase.from('push_subscriptions').upsert({
      endpoint: sub.endpoint, p256dh: sub.keys?.p256dh, auth: sub.keys?.auth,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });
    res.json({ success: true });
  } catch (err) {
    console.error('[Push Subscribe Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/push/vapid-key', (req, res) => res.json({ publicKey: VAPID_PUBLIC }));

// Fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔑 Tuya Client ID: ${TUYA.CLIENT_ID}`);
  console.log(`🌐 Tuya Base URL: ${TUYA.BASE_URL}`);
  console.log(`📱 VAPID configured: ${!!VAPID_PRIVATE}`);
  console.log(`🔌 WebSocket ready`);
});
