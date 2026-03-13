const crypto = require('crypto');

const CLIENT_ID = '59gmr8xdf3m5vdt55c89';
const SECRET    = 'f551321a6229419098b3c40728460bdd';
const BASE      = 'https://openapi.tuyaeu.com';

function sign(str) {
  return crypto.createHmac('sha256', SECRET).update(str).digest('hex').toUpperCase();
}
function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

async function getToken() {
  const t     = Date.now().toString();
  const nonce = '';
  const url   = '/v1.0/token?grant_type=1';
  const strToSign = ['GET', sha256(''), '', url].join('\n');
  const s = sign(CLIENT_ID + t + nonce + strToSign);
  const res = await fetch(`${BASE}${url}`, {
    headers: { client_id: CLIENT_ID, sign: s, t, nonce, sign_method: 'HMAC-SHA256' }
  });
  const data = await res.json();
  if (!data.success) throw new Error('Token failed: ' + (data.msg || data.code));
  return data.result?.access_token;
}

async function tuyaGet(url, tok) {
  const t     = Date.now().toString();
  const nonce = '';
  const strToSign = ['GET', sha256(''), '', url].join('\n');
  const s = sign(CLIENT_ID + tok + t + nonce + strToSign);
  const r = await fetch(`${BASE}${url}`, {
    headers: { client_id: CLIENT_ID, access_token: tok, sign: s, t, nonce, sign_method: 'HMAC-SHA256' }
  });
  return r.json();
}

async function tuyaPost(url, tok, commands) {
  const t2      = Date.now().toString();
  const nonce   = '';
  const bodyStr = JSON.stringify({ commands });
  const bodyHash= sha256(bodyStr);
  const strToSign = ['POST', bodyHash, '', url].join('\n');
  const s = sign(CLIENT_ID + tok + t2 + nonce + strToSign);
  const r = await fetch(`${BASE}${url}`, {
    method: 'POST',
    headers: {
      client_id: CLIENT_ID, access_token: tok,
      sign: s, t: t2, nonce, sign_method: 'HMAC-SHA256',
      'Content-Type': 'application/json',
    },
    body: bodyStr,
  });
  return r.json();
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const tok = await getToken();

    // ─── GET: قراءة حالة الجهاز للـ polling ───────────────────────────
    if (req.method === 'GET') {
      const devId = req.query?.devId;
      if (!devId) return res.status(400).json({ error: 'Missing devId' });

      const data = await tuyaGet(`/v1.0/iot-03/devices/${devId}/status`, tok);
      if (!data.success) return res.status(200).json({ success: false, raw: data });

      const s1 = data.result?.find(x => x.code === 'switch_1')?.value;
      const s2 = data.result?.find(x => x.code === 'switch_2')?.value;

      let doorState = 'stopped';
      if      (s1 === true  && s2 === false) doorState = 'open';
      else if (s1 === false && s2 === true)  doorState = 'close';
      else if (s1 === false && s2 === false) doorState = 'stopped';
      else if (s1 === true  && s2 === true)  doorState = 'stopped';

      // جلب حالة الاتصال (online/offline)
      const devInfo = await tuyaGet(`/v1.0/iot-03/devices/${devId}`, tok);
      const online  = devInfo?.result?.online ?? null;

      return res.status(200).json({ success: true, doorState, switch_1: s1, switch_2: s2, online });
    }

    // ─── POST: إرسال أمر للجهاز ────────────────────────────────────────
    const { devId, action } = req.body || {};
    if (!devId || !action) return res.status(400).json({ error: 'Missing devId or action' });
    if (!['open','close','stop'].includes(action))
      return res.status(400).json({ error: 'Unknown action: ' + action });

    const cmdUrl = `/v1.0/iot-03/devices/${devId}/commands`;

    // خطوة 1: أوقف كل الـ relay أولاً (حماية المحرك)
    await tuyaPost(cmdUrl, tok, [
      { code: 'switch_1', value: false },
      { code: 'switch_2', value: false },
    ]);

    if (action === 'stop') {
      return res.status(200).json({ success: true });
    }

    // خطوة 2: انتظر 300ms
    await delay(300);

    // خطوة 3: أرسل أمر الاتجاه
    const dirCmd = action === 'open'
      ? [{ code: 'switch_1', value: true  }, { code: 'switch_2', value: false }]
      : [{ code: 'switch_1', value: false }, { code: 'switch_2', value: true  }];

    const result = await tuyaPost(cmdUrl, tok, dirCmd);
    if (!result.success)
      return res.status(200).json({ success: false, code: result.code, msg: result.msg });

    return res.status(200).json({ success: true });

  } catch (e) {
    console.error('Handler error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
};
