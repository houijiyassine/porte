import crypto from 'crypto';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

const CLIENT_ID  = process.env.TUYA_CLIENT;
const SECRET     = process.env.TUYA_SECRET;
const DEVICE_ID  = process.env.TUYA_DEVICE_ID;
const BASE_URL   = 'https://openapi.tuyaeu.com';

async function getToken() {
  const t    = Date.now().toString();
  const sign = crypto.createHmac('sha256', SECRET)
    .update(CLIENT_ID + t)
    .digest('hex').toUpperCase();

  const res  = await fetch(`${BASE_URL}/v1.0/token?grant_type=1`, {
    headers: { client_id: CLIENT_ID, sign, t, sign_method: 'HMAC-SHA256' }
  });
  const data = await res.json();
  return data.result.access_token;
}

async function getDeviceLogs(token) {
  const t         = Date.now().toString();
  const endTime   = Date.now();
  const startTime = endTime - 2 * 60 * 1000;

  const sign = crypto.createHmac('sha256', SECRET)
    .update(CLIENT_ID + token + t)
    .digest('hex').toUpperCase();

  const res = await fetch(
    `${BASE_URL}/v1.0/devices/${DEVICE_ID}/logs?type=1&start_time=${startTime}&end_time=${endTime}`,
    {
      headers: {
        client_id: CLIENT_ID,
        access_token: token,
        sign, t,
        sign_method: 'HMAC-SHA256'
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
const logs  = await getDeviceLogs(token);

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
