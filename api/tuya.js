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

    if (!['open','close','stop'].includes(action))
      return res.status(400).json({ error: 'Unknown action: ' + action });

    // Helper: send one command set to Tuya
    async function sendCmd(commands) {
      const t2      = Date.now().toString();
      const nonce   = '';
      const url     = `/v1.0/iot-03/devices/${devId}/commands`;
      const bodyStr = JSON.stringify({ commands });
      const bodyHash= sha256(bodyStr);
      const strToSign = ['POST', bodyHash, '', url].join('\n');
      const signStr   = CLIENT_ID + tok + t2 + nonce + strToSign;
      const s = sign(signStr);

      const r = await fetch(`${BASE}${url}`, {
        method: 'POST',
        headers: {
          client_id:    CLIENT_ID,
          access_token: tok,
          sign:         s,
          t:            t2,
          nonce,
          sign_method:  'HMAC-SHA256',
          'Content-Type': 'application/json',
        },
        body: bodyStr,
      });
      return r.json();
    }

    function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

    // Step 1: ALWAYS stop both relays first (protect motor)
    const stopResult = await sendCmd([
      { code: 'switch_1', value: false },
      { code: 'switch_2', value: false },
    ]);
    console.log('← STOP result:', JSON.stringify(stopResult));

    if (action === 'stop') {
      return res.status(200).json({ success: true, result: stopResult.result });
    }

    // Step 2: Wait 300ms so relays are fully OFF before switching direction
    await delay(300);

    // Step 3: Send the direction command
    const dirCmd = action === 'open'
      ? [{ code: 'switch_1', value: true  }, { code: 'switch_2', value: false }]
      : [{ code: 'switch_1', value: false }, { code: 'switch_2', value: true  }];

    const dirResult = await sendCmd(dirCmd);
    console.log('← DIR result:', JSON.stringify(dirResult));

    if (!dirResult.success) {
      return res.status(200).json({
        success: false,
        code: dirResult.code,
        msg:  dirResult.msg || 'Tuya rejected command',
        raw:  dirResult,
      });
    }

    return res.status(200).json({ success: true, result: dirResult.result });

  } catch (e) {
    console.error('Handler error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
};
