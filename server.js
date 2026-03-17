import express from 'express';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
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

// ─── Supabase ─────────────────────────────────────────────────────────────────
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY
);

// ─── Web Push ─────────────────────────────────────────────────────────────────
if (VAPID_PRIVATE) {
  webpush.setVapidDetails(
    'mailto:admin@porte.app',
    VAPID_PUBLIC,
    VAPID_PRIVATE
  );
}

// ─── Tuya Token Cache ─────────────────────────────────────────────────────────
let tuyaTokenCache = { token: null, expiresAt: 0 };

function buildTokenSign(t) {
  const str = TUYA.CLIENT_ID + t;
  return crypto.createHmac('sha256', TUYA.SECRET).update(str).digest('hex').toUpperCase();
}

function buildRequestSign({ token, t, nonce, method, path: urlPath, query = {}, body = '' }) {
  const bodyHash = crypto
    .createHash('sha256')
    .update(typeof body === 'string' ? body : JSON.stringify(body))
    .digest('hex');

  const queryStr = Object.keys(query).length
    ? '?' + new URLSearchParams(query).toString()
    : '';

  const stringToSign = [method.toUpperCase(), bodyHash, '', urlPath + queryStr].join('\n');
  const str = TUYA.CLIENT_ID + token + t + nonce + stringToSign;

  return crypto.createHmac('sha256', TUYA.SECRET).update(str).digest('hex').toUpperCase();
}

async function getTuyaToken() {
  const now = Date.now();
  if (tuyaTokenCache.token && now < tuyaTokenCache.expiresAt) return tuyaTokenCache.token;

  const t    = now.toString();
  const sign = buildTokenSign(t);

  const res  = await fetch(`${TUYA.BASE_URL}/v1.0/token?grant_type=1`, {
    method: 'GET',
    headers: {
      'client_id': TUYA.CLIENT_ID, 'sign': sign, 't': t,
      'sign_method': 'HMAC-SHA256', 'nonce': '', 'Content-Type': 'application/json',
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
  const nonce   = crypto.randomBytes(8).toString('hex');
  const urlPath = `/v1.0/devices/${TUYA.DEVICE_ID}/commands`;
  const body    = JSON.stringify({ commands });
  const sign    = buildRequestSign({ token, t, nonce, method: 'POST', path: urlPath, body });

  const res  = await fetch(`${TUYA.BASE_URL}${urlPath}`, {
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
  const nonce   = crypto.randomBytes(8).toString('hex');
  const urlPath = `/v1.0/devices/${TUYA.DEVICE_ID}/status`;
  const sign    = buildRequestSign({ token, t, nonce, method: 'GET', path: urlPath });

  const res  = await fetch(`${TUYA.BASE_URL}${urlPath}`, {
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
  } catch (err) { console.error('[Push Send Error]', err); }
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.post('/api/door/open', async (req, res) => {
  try {
    const { userId, reason } = req.body;
    const result = await sendTuyaCommand([{ code: 'switch_1', value: true }]);
    if (!result.success) return res.status(500).json({ success: false, error: result.msg });

    await supabase.from('door_logs').insert({
      user_id: userId || 'unknown', action: 'open', reason: reason || 'manual',
      success: true, created_at: new Date().toISOString(),
    });
    await sendPushToAll({ title: '🚪 الباب مفتوح', body: `تم فتح الباب بواسطة ${userId || 'مجهول'}` });
    res.json({ success: true, message: 'تم فتح الباب' });
  } catch (err) {
    console.error('[Door Open Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/door/close', async (req, res) => {
  try {
    const { userId } = req.body;
    const result = await sendTuyaCommand([{ code: 'switch_1', value: false }]);
    if (!result.success) return res.status(500).json({ success: false, error: result.msg });

    await supabase.from('door_logs').insert({
      user_id: userId || 'unknown', action: 'close', success: true,
      created_at: new Date().toISOString(),
    });
    res.json({ success: true, message: 'تم إغلاق الباب' });
  } catch (err) {
    console.error('[Door Close Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/door/status', async (req, res) => {
  try {
    const data = await getTuyaDeviceStatus();
    res.json({ success: true, status: data.result });
  } catch (err) {
    console.error('[Door Status Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

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

app.post('/api/push/subscribe', async (req, res) => {
  try {
    const subscription = req.body;
    await supabase.from('push_subscriptions').upsert({
      endpoint: subscription.endpoint,
      p256dh:   subscription.keys?.p256dh,
      auth:     subscription.keys?.auth,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });
    res.json({ success: true });
  } catch (err) {
    console.error('[Push Subscribe Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/push/vapid-key', (req, res) => res.json({ publicKey: VAPID_PUBLIC }));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔑 Tuya Client ID: ${TUYA.CLIENT_ID}`);
  console.log(`🌐 Tuya Base URL: ${TUYA.BASE_URL}`);
  console.log(`📱 VAPID configured: ${!!VAPID_PRIVATE}`);
});
