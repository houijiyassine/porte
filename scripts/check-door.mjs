import crypto from 'crypto';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

const CLIENT_ID = process.env.TUYA_CLIENT;
const SECRET = process.env.TUYA_SECRET;
const DEVICE_ID = process.env.TUYA_DEVICE_ID;
const BASE_URL = 'https://openapi.tuyaeu.com';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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
  return data.result && data.result.access_token ? data.result.access_token : null;
}

async function getDeviceInfo(token) {
  const t = Date.now().toString();
  const path = '/v1.0/devices/' + DEVICE_ID;
  const sign = getSign(CLIENT_ID, SECRET, t, token, 'GET', path);
  const res = await fetch(BASE_URL + path, {
    headers: { client_id: CLIENT_ID, access_token: token, sign, t, sign_method: 'HMAC-SHA256' }
  });
  return res.json();
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

async function wasAppCommand() {
  const since = new Date(Date.now() - 30000).toISOString();
  const { data } = await supabase
    .from('app_commands')
    .select('id')
    .eq('device_id', DEVICE_ID)
    .gte('created_at', since)
    .limit(1);
  return data && data.length > 0;
}

async function sendNotifications(title, body) {
  webpush.setVapidDetails(
    'mailto:admin@example.com',
    process.env.VAPID_PUBLIC,
    process.env.VAPID_PRIVATE
  );
  const result = await supabase
    .from('users')
    .select('push_sub')
    .not('push_sub', 'is', null);
  const rows = result.data || [];
  for (const row of rows) {
    try {
      const subscription = typeof row.push_sub === 'string'
        ? JSON.parse(row.push_sub)
        : row.push_sub;
      await webpush.sendNotification(subscription, JSON.stringify({ title, body }));
    } catch (e) {
      console.error('Push failed:', e.message);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const token = await getToken();
if (!token) {
  console.error('فشل الحصول على token');
  process.exit(1);
}
console.log('Token OK');

const { data: prevData } = await supabase
  .from('door_state')
  .select('value')
  .order('created_at', { ascending: false })
  .limit(1);

let prevValue = prevData && prevData.length > 0 ? prevData[0].value : null;
console.log('Initial state:', prevValue);

for (let i = 0; i < 11; i++) {
  const devInfo = await getDeviceInfo(token);
  const isOnline = devInfo?.result?.online === true;

  if (!isOnline) {
    console.log(`[${i+1}/11] الجهاز offline — تخطي`);
    if (i < 10) await sleep(5000);
    continue;
  }

  const statusData = await getDeviceStatus(token);
  const result = statusData.result || [];
  const switch1 = result.find(r => r.code === 'switch_1');
  const currentValue = String(switch1 ? switch1.value : 'unknown');

  console.log(`[${i+1}/11] switch_1: ${currentValue} | prev: ${prevValue}`);

  if (prevValue !== null && prevValue !== currentValue) {
    const fromApp = await wasAppCommand();

    if (fromApp) {
      console.log('تغيير عبر التطبيق — لا إشعار');
    } else {
      const isOpen = currentValue === 'true';
      const status = isOpen ? 'فُتح' : 'أُغلق';
      await sendNotifications('RC Door 🚪', 'الباب ' + status + ' عبر جهاز التحكم');
      console.log('✅ إشعار RC:', status);
    }

    await supabase.from('door_state').insert({ value: currentValue });
    prevValue = currentValue;
  }

  if (i < 10) await sleep(5000);
}

console.log('انتهى الفحص');
