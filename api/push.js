const webpush = require('web-push');

const VAPID_PUBLIC  = 'BHPSYKGfHxf1q5y6RBv7_h5KWuYU3OrV0AEdZwHYE3S581kEmL_5MXHVjV1xEe1i07IpfqheYAssVMPmZZdJU2U';
const VAPID_PRIVATE = 'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg3wqZmYo3VwlZySkAGDuuhrRY0ytiAHoAVdKaGd5ECj-hRANCAARz0mChnx8X9aucukQb-_4eSlrmFNzq1dABHWcB2BN0ufNZBJi_-TFx1Y1dcRHtYtOyKX6oXmALLFTD5mWXSVNl';
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
  if (!inst_id) return res.status(400).json({ error: 'Missing inst_id' });

  try {
    // جلب كل المديرين الذين لديهم push_sub
    const r = await fetch(`${SB_URL}/rest/v1/users?inst_id=eq.${inst_id}&role=eq.admin&push_sub=not.is.null&select=push_sub`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
    });
    const admins = await r.json();

    // جلب super admins أيضاً
    const r2 = await fetch(`${SB_URL}/rest/v1/users?role=eq.super&push_sub=not.is.null&select=push_sub`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
    });
    const supers = await r2.json();

    const all = [...(admins||[]), ...(supers||[])];
    const payload = JSON.stringify({
      title: '👤 طلب تسجيل جديد',
      body: `${user_name || 'مستخدم جديد'} يطلب الانضمام`,
      tag: 'new-user-' + Date.now(),
      url: '/'
    });

    const results = await Promise.allSettled(
      all.map(u => {
        try {
          const sub = JSON.parse(u.push_sub);
          return webpush.sendNotification(sub, payload);
        } catch(e) { return Promise.reject(e); }
      })
    );

    const sent = results.filter(r => r.status === 'fulfilled').length;
    return res.status(200).json({ success: true, sent, total: all.length });
  } catch(e) {
    console.error('Push error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
};
