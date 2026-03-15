import crypto from 'crypto';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

const CLIENT_ID = process.env.TUYA_CLIENT;
const SECRET    = process.env.TUYA_SECRET;
const DEVICE_ID = process.env.TUYA_DEVICE_ID;
const BASE_URL  = 'https://openapi.tuyaeu.com';

function calcSign(clientId, secret, t, accessToken, method, path, body = '') {
  const contentHash = crypto.createHash('sha256').update(body).digest('hex');
  const stringToSign = [method, contentHash, '', path].join('\n');
  const signStr = clientId + accessToken + t + stringToSign;
  return crypto.createHmac('sha256', secret)
    .update(signStr)
    .digest('hex')
    .toUpperCase();
}

async function getToken() {
  const t    = Date.now().toString();
  const path = '/v1.0/token?grant_type=1';
  const sign = calcSign(CLIENT_ID, SECRET, t, '', 'GET', path);

  const res  = await fetch(`${BASE_URL}${path}`, {
    headers: {
      client_id:   CLIENT_ID,
      sign:        sign,
      t:           t,
      sign_method: 'HMAC-SHA256',
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
  const path      = `/v1.0/devices/${DEVICE_ID}/logs?type=1&start_time=${startTime}&end_time=${endTime}`;
  const sign      = calcSign(CLIENT_ID, SECRET, t, token, 'GET', path);

  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      client_id:    CLIENT_ID,
      access_token: token,
      sign:         sign,
      t:            t,
      sign_method:  'HMAC-SHA256',
    }
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
    process.env.SU
