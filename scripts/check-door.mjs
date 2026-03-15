import crypto from 'crypto';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

const CLIENT_ID = process.env.TUYA_CLIENT;
const SECRET = process.env.TUYA_SECRET;
const DEVICE_ID = process.env.TUYA_DEVICE_ID;
const BASE_URL = 'https://openapi.tuyaeu.com';

function getSign(clientId, secret, t, accessToken, method, path) {
  const contentHash = crypto.createHash('sha256').update('').digest('hex');
  const stringToSign = method + '\n' + contentHash + '\n' + '' + '\n' + path;
  const signStr = clientId + accessToken + t + stringToSign;
  return crypto.createHmac('sha256', secret).update(signStr).digest('hex').toUpperCase();
}

async function getToken() {
  const t = Date.now().toString();
  const path = '/v1.0/token?grant_type=1';
  const sign = getSign(CLIENT_ID, SECRET, t, '', 'GET', path);
  const res = await fetch(BASE_URL + path, {
    headers: { client_id: CLIENT_ID, sign, t, sign_method: 'HMAC-SHA256' }
  });
  const data = await res.json();
  console.log('Token response:', JSON.stringify(data));
  return data.result && data.result.access_token ? data.result.access_token : null;
}

async function getDeviceStatus(token) {
  const t = Date.now().toString();
  const path = '/v1.0/devices/' + DEVICE_ID + '/status';
  const sign = getSign(CLIENT_ID, SECRET, t, token, 'GET', path);
  const res = await fetch(BASE_URL + path, {
    headers: { client_id: CLIENT_ID, access_token: token, sign, t, sign_method: 'HMAC-SHA256' }
  });
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
  const result = await supabase
    .from('users')
    .select('push_sub')
    .not('push_sub', 'is', null);
  const rows = result.data || [];
  console.log('Users with push_sub:', rows.length);
  for (const row of rows) {
    try {
      const subscription = typeof row.push_sub === 'string'
        ? JSON.parse(row.push_sub)
        : row.push_sub;
      await webpush.sendNotification(subscription, JSON.stringify({ title, body }));
      console.log('Push sent OK');
    } catch (e) {
      console.error('Push failed:', e.message);
    }
  }
}

const token = await getToken();
if (!token) {
  console.error('فشل الحصول على token');
  process.exit(1);
}
console.log('Token OK');

const status = await getDeviceStatus(token);
console.log('Device status:', JSON.stringify(status, null, 2));
