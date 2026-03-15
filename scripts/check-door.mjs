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

async function getDeviceLogs(token) {
  const t = Date.now().toString();
  const endTime = Date.now();
  const startTime = endTime - 2 * 60 * 1000;
  const fullPath = '/v2.0/cloud/thing/' + DEVICE_ID + '/report-logs?start_time=' + startTime + '&end_time=' + endTime + '&size=20';
  const sign = getSign(CLIENT_ID, SECRET, t, token, 'GET', fullPath);
  const res = await fetch(BASE_URL + fullPath, {
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

const token = await getToken();
if (!token) {
  console.error('فشل الحصول على token');
  process.exit(1);
}

console.log('Token OK');

const logsData = await getDeviceLogs(token);
console.log('Logs response:', JSON.stringify(logsData, null, 2));

const logs = (logsData.result && logsData.result.logs) ? logsData.result.logs : [];

if (logs.length === 0) {
  console.log('لا توجد أحداث — جاري استخدام الحالة الحالية');

  const statusData = await getDeviceStatus(token);
  const result = statusData.result || [];
  const switch1 = result.find(r => r.code === 'switch_1');
  const currentValue = String(switch1 ? switch1.value : 'unknown');

  const { data: prevData } = await supabase
    .from('door_state')
    .select('value')
    .order('created_at', { ascending: false })
    .limit(1);

  const prevValue = prevData && prevData.length > 0 ? prevData[0].value : null;

  if (prevValue === null || prevValue !== currentValue) {
    const isOpen = currentValue === 'true';
    const status = isOpen ? 'فُتح' : 'أُغلق';
    await sendNotifications('RC Door', 'الباب ' + status);
    await supabase.from('door_state').insert({ value: currentValue });
    console.log('تم الإشعار:', status);
  } else {
    console.log('لم تتغير الحالة');
  }
} else {
  const switch1Logs = logs.filter(l => l.code === 'switch_1');
  console.log('switch_1 events:', switch1Logs.length);

  const { data: prevData } = await supabase
    .from('door_state')
    .select('value, created_at')
    .order('created_at', { ascending: false })
    .limit(1);

  const lastSavedTime = prevData && prevData.length > 0 ? new Date(prevData[0].created_at).getTime() : 0;

  const newEvents = switch1Logs.filter(l => parseInt(l.event_time) > lastSavedTime);
  console.log('New events:', newEvents.length);

  if (newEvents.length > 0) {
    let message = 'أحداث الباب:\n';
    for (const event of newEvents) {
      const isOpen = event.value === 'true' || event.value === true;
      message += isOpen ? '🔓 فُتح\n' : '🔒 أُغلق\n';
    }

    await sendNotifications('RC Door', message.trim());

    const lastEvent = newEvents[newEvents.length - 1];
    await supabase.from('door_state').insert({ value: String(lastEvent.value) });

    console.log('تم إرسال', newEvents.length, 'حدث');
  } else {
    console.log('لا أحداث جديدة');
  }
}
