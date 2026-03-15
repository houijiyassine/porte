import crypto from 'crypto';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

const CLIENT_ID = process.env.TUYA_CLIENT;
const SECRET    = process.env.TUYA_SECRET;
const DEVICE_ID = process.env.TUYA_DEVICE_ID;
const BASE_URL  = 'https://openapi.tuyaeu.com';

function calcSign(clientId, secret, timestamp, accessToken = '') {
  const str = clientId + accessToken + timestamp;
  return crypto.createHmac('sha256', secret)
    .update(str)
    .digest('hex')
    .toUpperCase();
}

async function getToken() {
  const t    = Date.now().toString();
  const sign = calcSign(CLIENT_ID, SECRET, t);

  const res  = await fetch(`${BASE_URL}/v1.0/token?grant_type=1`, {
    headers: {
      client_id:   CLIENT_ID,
      sign:        sign,
      t:           t,
      sign_method: 'HMAC-SHA256',
      nonce:       '',
    }
  });
  const data = await res.json();
  console.log('Token response:', JSON.stringify(data));
  return data.result?.access_token;
}

async function getDeviceLogs(token) {
  const t         = Date.now().toString();
  const endTime   = Date.now();
  const startTime = endTime - 2 * 60 * 1000;
  const sign      = calcSign(CLIENT_ID, SECRET, t, token);

  const res = await fetch(
    `${BASE_URL}/v1.0/devices/${DEVICE_ID}/logs?type=1&start_time=${startTime}&end_time=${endTime}`,
    {
      headers: {
        client_id:    CLIENT_ID,
        access_token: token,
        sign:         sign,
        t:            t,
        sign_method:  'HMAC-SHA256',
        nonce:        '',
      }
    }
  );
  return res.json();
}

async function sendNotifications(title, body) {
  webpush.setVapidDetails(
    'mailto:admin@example.com',
    process.env.VAPID_PUBLIC,
    process.env.VAPID_PRIVATE
  );

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data: rows } = await supabase
    .from('push_subscriptions')
    .select('subscription');

  for (const row of rows || []) {
    try {
      await webpush.sendNotification(
        row.subscription,
        JSON.stringify({ title, body })
      );
    } catch (e) {
      console.error('Push failed:', e.message);
    }
  }
}

const token = await getToken();

if (!token) {
  console.error('❌ فشل الحصول على token');
  process.exit(1);
}

console.log('✅ Token OK');

const logs   = await getDeviceLogs(token);
console.log('Raw logs:', JSON.stringify(logs, null, 2));

const events = logs.result?.logs || [];

if (events.length > 0) {
  const last   = events[events.length - 1];
  const isOpen = last.value === 'true' || last.value === 'open' || last.value === '1';
  const status = isOpen ? '🔓 فُتح' : '🔒 أُغلق';

  await sendNotifications('RC Door', `الباب ${status} عن طريق الجهاز`);
  console.log('✅ Notification sent:', status);
} else {
  console.log('ℹ️ No physical events in last 2 minutes');
}
