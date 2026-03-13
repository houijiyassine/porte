const webpush = require('web-push');

const VAPID_PUBLIC  = 'BOfIw6laarxGfV8Ezc04YzfCzq4Njm7ewizkfnGDIWJGpsfHkqUHVG8SXGb8cJZJxOTIzFeauX4K0Z8oYdfgKTw';
const VAPID_PRIVATE = 'uG-xpdUzkxefHzbUD-YDtT6Ut0oz1tq0EjUX0UVWyBI';
const SB_URL = 'https://sjfaootvlxesdytdsknc.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqZmFvb3R2bHhlc2R5dGRza25jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzE4MDI1NywiZXhwIjoyMDg4NzU2MjU3fQ.R_0KS6U0VUKfFheCxJ5rmKY9vo7UkVkSx2lFwLjGvFI';

webpush.setVapidDetails('mailto:admin@door-system.com', VAPID_PUBLIC, VAPID_PRIVATE);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { inst_id, user_name } = req.body || {};
  console.log('Push request: inst_id=', inst_id, 'user=', user_name);
  if (!inst_id) return res.status(400).json({ error: 'Missing inst_id' });

  try {
    const r = await fetch(`${SB_URL}/rest/v1/users?select=id,name,role,inst_id,push_sub`, {
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`
      }
    });
    const all = await r.json();
    console.log('Users:', Array.isArray(all) ? all.length : JSON.stringify(all).slice(0,100));

    if (!Array.isArray(all)) {
      return res.status(200).json({ success: false, msg: 'supabase error', raw: all });
    }

    const targets = all.filter(u =>
      u.push_sub &&
      ((u.role === 'admin' && u.inst_id === inst_id) || u.role === 'super')
    );
    console.log('Targets:', targets.length, targets.map(u => u.name));

    if (targets.length === 0) {
      return res.status(200).json({ success: true, sent: 0, total: 0 });
    }

    const payload = JSON.stringify({
      title: '👤 طلب تسجيل جديد',
      body: `${user_name || 'مستخدم جديد'} يطلب الانضمام`,
      tag: 'new-user-' + Date.now(),
      url: '/'
    });

    const results = await Promise.allSettled(
      targets.map(u => {
        const sub = JSON.parse(u.push_sub);
        return webpush.sendNotification(sub, payload);
      })
    );

    const sent = results.filter(r => r.status === 'fulfilled').length;
    const errors = results.filter(r => r.status === 'rejected').map(r => r.reason?.message);
    console.log('Sent:', sent, '/', targets.length, errors);

    return res.status(200).json({ success: true, sent, total: targets.length, errors });
  } catch(e) {
    console.error('Push error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
};
