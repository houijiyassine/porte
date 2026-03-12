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
  const t = Date.now().toString();
  const nonce = '';
  // Token signing: no access_token included
  // strToSign = METHOD + \n + sha256(body) + \n + headers + \n + url
  const url = '/v1.0/token?grant_type=1';
  const strToSign = ['GET', sha256(''), '', url].join('\n');
  const signStr = CLIENT_ID + t + nonce + strToSign;
  const s = sign(signStr);

  const res = await fetch(`${BASE}${url}`, {
    headers: {
      client_id:   CLIENT_ID,
      sign:        s,
      t,
      nonce,
      sign_method: 'HMAC-SHA256',
    }
  });
  const data = await res.json();
  if (!data.success) {
    console.error('Token error:', JSON.stringify(data));
    throw new Error('Token failed: ' + (data.msg || data.code));
  }
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

    // Map actions to switch_1 commands
    const cmdMap = {
      open:  [{ code: 'switch_1', value: true  }],
      close: [{ code: 'switch_1', value: false }],
      stop:  [{ code: 'switch_1', value: false }],
    };
    const commands = cmdMap[action];
    if (!commands) return res.status(400).json({ error: 'Unknown action: ' + action });

    const t     = Date.now().toString();
    const nonce = '';
    const url   = `/v1.0/iot-03/devices/${devId}/commands`;
    const bodyStr  = JSON.stringify({ commands });
    const bodyHash = sha256(bodyStr);

    // Correct Tuya signing with access_token:
    // strToSign = METHOD + \n + sha256(body) + \n + headers_str + \n + url
    const strToSign = ['POST', bodyHash, '', url].join('\n');
    const signStr   = CLIENT_ID + tok + t + nonce + strToSign;
    const s = sign(signStr);

    console.log('→ Sending to Tuya:', url, bodyStr);
    console.log('→ signStr:', signStr);

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
    console.log('← Tuya response:', JSON.stringify(data));

    if (!data.success) {
      return res.status(200).json({
        success: false,
        code: data.code,
        msg:  data.msg || 'Tuya rejected command',
        raw:  data
      });
    }

    return res.status(200).json({ success: true, result: data.result });

  } catch (e) {
    console.error('Handler error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
};
