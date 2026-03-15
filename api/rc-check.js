const crypto = require('crypto');
const webpush = require('web-push');

const CLIENT_ID = '59gmr8xdf3m5vdt55c89';
const SECRET    = 'f551321a6229419098b3c40728460bdd';
const BASE      = 'https://openapi.tuyaeu.com';

const SB_URL = 'https://sjfaootvlxesdytdsknc.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqZmFvb3R2bHhlc2R5dGRza25jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzE4MDI1NywiZXhwIjoyMDg4NzU2MjU3fQ.R_0KS6U0VUKfFheCxJ5rmKY9vo7UkVkSx2lFwLjGvFI';

const VAPID_PUBLIC  = 'BOfIw6laarxGfV8Ezc04YzfCzq4Njm7ewizkfnGDIWJGpsfHkqUHVG8SXGb8cJZJxOTIzFeauX4K0Z8oYdfgKTw';
const VAPID_PRIVATE = 'uG-xpdUzkxefHzbUD-YDtT6Ut0oz1tq0EjUX0UVWyBI';
webpush.setVapidDetails('mailto:admin@door-system.com', VAPID_PUBLIC, VAPID_PRIVATE);

function sign(str) { return crypto.createHmac('sha256', SECRET).update(str).digest('hex').toUpperCase(); }
function sha256(str) { return crypto.createHash('sha256').update(str).digest('hex'); }

async function getToken() {
  const t = Date.now().toString();
  const url = '/v1.0/token?grant_type=1';
  const s = sign(CLIENT_ID + t + '' + ['GET', sha256(''), '', url].join('\n'));
  const res = await fetch(`${BASE}${url}`, {
    headers: { client_id: CLIENT_ID, sign: s, t, nonce: '', sign_method: 'HMAC-SHA256' }
  });
  const data = await res.json();
  if (!data.success) throw new Error('Token failed');
  return data.result?.access_token;
}

async function getDoorState(devId, tok) {
  const t = Date.now().toString();
  const url = `/v1.0/iot-03/devices/${devId}/status`;
  const s = sign(CLIENT_ID + tok + t + '' + ['GET', sha256(''), '', url].join('\n'));
  const r = await fetch(`${BASE}${url}`, {
    headers: { client_id: CLIENT_ID, access_token: tok, sign: s, t, nonce: '', sign_method: 'HMAC-SHA256' }
  });
  const data = await r.json();
  if (!data.success) return null;
  const s1 = data.result?.find(x => x.code === 'switch_1')?.value;
  const s2 = data.result?.find(x => x.code === 'switch_2')?.value;
  if (s1 === true  && s2 === false) return 'open';
  if (s1 === false && s2 === true)  return 'close';
  return 'stopped';
}

async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
  });
  return r.json();
}

async function sbPatch(table, id, body) {
  await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal'
    },
    body: JSON.stringify(body)
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const [institutes, users] = await Promise.all([
      sbGet('institutes?select=id,name,doors,rc_door_states'),
      sbGet('users?select=id,name,role,inst_id,push_sub')
    ]);

    if (!Array.isArray(institutes) || !Array.isArray(users)) {
      return res.status(200).json({ ok: false, msg: 'DB error' });
    }

    const tok = await getToken();
    let totalNotif = 0;

    for (const inst of institutes) {
      const doors = Array.isArray(inst.doors) ? inst.doors : [];
      const prevStates = inst.rc_door_states || {};
      const newStates = { ...prevStates };
      let changed = false;

      for (const door of doors) {
        if (!door.devId) continue;

        const state = await getDoorState(door.devId, tok);
        if (!state || state === 'stopped') continue;

        const prev = prevStates[door.id];

        if (prev === undefined) {
          // أول مرة — سجّل الحالة بدون إشعار
          newStates[door.id] = state;
          changed = true;
          continue;
        }

        if (state === prev) continue; // لم تتغير

        // تغيّرت! → أرسل إشعار
        newStates[door.id] = state;
        changed = true;

        const title = `🚪 ${state === 'open' ? 'فتح' : 'غلق'} الباب`;
        const body  = `${door.name} — ${state === 'open' ? 'تم الفتح' : 'تم الغلق'} عبر جهاز التحكم`;
        const payload = JSON.stringify({ title, body, tag: `rc-${door.id}`, url: '/' });

        const targets = users.filter(u =>
          u.role === 'admin' && u.inst_id === inst.id && u.push_sub
        );

        for (const u of targets) {
          try {
            const sub = typeof u.push_sub === 'string' ? JSON.parse(u.push_sub) : u.push_sub;
            await webpush.sendNotification(sub, payload);
            totalNotif++;
          } catch(e) {
            console.warn(`Push failed for ${u.name}:`, e.message);
          }
        }
      }

      if (changed) await sbPatch('institutes', inst.id, { rc_door_states: newStates });
    }

    return res.status(200).json({ ok: true, notifications: totalNotif });

  } catch(e) {
    console.error('rc-check error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
