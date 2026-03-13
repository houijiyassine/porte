const webpush = require('web-push');

const VAPID_PUBLIC  = 'BOfIw6laarxGfV8Ezc04YzfCzq4Njm7ewizkfnGDIWJGpsfHkqUHVG8SXGb8cJZJxOTIzFeauX4K0Z8oYdfgKTw';
const VAPID_PRIVATE = 'uG-xpdUzkxefHzbUD-YDtT6Ut0oz1tq0EjUX0UVWyBI';
const SB_URL = 'https://sjfaootvlxesdytdsknc.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqZmFvb3R2bHhlc2R5dGRza25jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE3MDY5NjEsImV4cCI6MjA1NzI4Mjk2MX0.tHZIXKzQAGiMDHvJzQjShlBcXOdnRB5UeVJv3lDrBog';

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
    // جلب كل المستخدمين
    const r = await fetch(`${SB_URL}/rest/v1/users?select=id,name,role,inst_id,push_sub`, {
      headers: { 
        apikey: SB_KEY, 
        Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    const all = await r.json();
    console.log('All users count:', Array.isArray(all) ? all.length : 'not array', typeof all);

    if (!Array.isArray(all)) {
      return res.status(200).json({ success: false, msg: 'supabase error', raw: all });
    }

    // فلتر: admin من نفس المؤسسة أو super، ولديهم push_sub
    const targets = all.filter(u =>
      u.push_sub &&
      ((u.role === 'admin' && u.inst_id === inst_id) || u.role === 'super')
    );

    console.log(`Targets: ${targets.length}/${all.length}`, targets.map(u=>u.name));

    if (targets.length === 0) {
      return res.status(200).json({ success: true, sent: 0, total: 0, msg: 'no targets with push_sub' });
    }

    const payload = JSON.stringify({
      title: '👤 طلب تسجيل جديد',
      body: `${user_name || 'مستخدم جديد'} يطلب الانضمام`,
      tag: 'new-user-' + Date.now(),
      url: '/'
    });

    const results = await Promise.allSettled(
      targets.map(u => {
        try {
          const sub = JSON.parse(u.push_sub);
          return webpush.sendNotification(sub, payload);
        } catch(e) { return Promise.reject(e); }
      })
    );

    const sent = results.filter(r => r.status === 'fulfilled').length;
    const errors = results.filter(r => r.status === 'rejected').map(r => r.reason?.message);
    console.log(`Sent: ${sent}/${targets.length}`, errors);

    return res.status(200).json({ success: true, sent, total: targets.length, errors });
  } catch(e) {
    console.error('Push error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
};
