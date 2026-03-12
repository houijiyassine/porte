const crypto = require('crypto');

const CLIENT_ID = '59gmr8xdf3m5vdt55c89';
const SECRET    = 'f551321a6229419098b3c40728460bdd';
const BASE      = 'https://openapi.tuyaeu.com';

function sign(str) {
  return crypto.createHmac('sha256', SECRET).update(str).digest('hex').toUpperCase();
}

async function getToken() {
  const t = Date.now().toString();
  const s = sign(CLIENT_ID + t);
  const res = await fetch(`${BASE}/v1.0/token?grant_type=1`, {
    headers: { client_id: CLIENT_ID, sign: s, t, sign_method: 'HMAC-SHA256' }
  });
  const data = await res.json();
  return data.result?.access_token;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { devId, action } = req.body || {};
    if (!devId || !action) return res.status(400).json({ error: 'Missing devId or action' });

    const tok = await getToken();
    if (!tok) return res.status(500).json({ error: 'Token failed' });

    const cmdMap = {
      open:  [{ code: 'switch_1', value: true  }],
      close: [{ code: 'switch_1', value: false }],
      stop:  [{ code: 'switch_1', value: false }],
    };
    const commands = cmdMap[action];
    if (!commands) return res.status(400).json({ error: 'Unknown action' });

    const t   = Date.now().toString();
    const nonce = '';
    const bodyStr  = JSON.stringify({ commands });
    const bodyHash = crypto.createHash('sha256').update(bodyStr).digest('hex');
    const url = `/v1.0/iot-03/devices/${devId}/commands`;
    const strToSign = ['POST', bodyHash, '', url].join('\n');
    const signStr   = CLIENT_ID + tok + t + nonce + strToSign;
    const s = sign(signStr);

    const r = await fetch(`${BASE}${url}`, {
      method: 'POST',
      headers: {
        client_id:    CLIENT_ID,
        access_token: tok,
        sign:         s,
        t,
        nonce,
        sign_method:  'HMAC-SHA256',
        'Content-Type': 'application/json',
      },
      body: bodyStr,
    });

    const data = await r.json();
    return res.status(200).json(data);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
