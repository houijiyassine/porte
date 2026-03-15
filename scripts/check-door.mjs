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
