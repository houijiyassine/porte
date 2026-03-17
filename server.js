import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import TuyaConnector from '@tuya-connector/nodejs';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// ─── Supabase ─────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://sjfaootvlxesdytdsknc.supabase.co',
  process.env.SUPABASE_SERVICE_KEY
);

// ─── VAPID ────────────────────────────────────────────────────────────────────
webpush.setVapidDetails(
  'mailto:admin@porte.app',
  process.env.VAPID_PUBLIC,
  process.env.VAPID_PRIVATE
);

// ─── Tuya Connector ──────────────────────────────────────────────────────────
const tuya = new TuyaConnector({
  accessKey: process.env.TUYA_CLIENT_ID || '59gmr8xdf3m5vdt55c89',
  secretKey: process.env.TUYA_SECRET,
  baseUrl: `https://${process.env.TUYA_REGION || 'openapi.tuyaeu.com'}`,
  rpc: { timeout: 10000 },
});

const DEVICE_ID = process.env.TUYA_DEVICE_ID || 'bf7c670914391fc80cwayk';

console.log('Tuya Config:', {
  accessKey: process.env.TUYA_CLIENT_ID,
  DEVICE_ID,
  baseUrl: `https://${process.env.TUYA_REGION || 'openapi.tuyaeu.com'}`,
  secretLength: process.env.TUYA_SECRET?.length,
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── WebSocket ────────────────────────────────────────────────────────────────
const wsClients = new Map();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  if (!token) { ws.close(); return; }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'porte_secret_2024');
    wsClients.set(decoded.id, ws);
    ws.userId = decoded.id;
    ws.userRole = decoded.role;
    ws.send(JSON.stringify({ type: 'connected', userId: decoded.id }));
    ws.on('close', () => wsClients.delete(decoded.id));
    ws.on('message', (data) => handleWsMessage(ws, JSON.parse(data)));
  } catch { ws.close(); }
});

function broadcast(message, roleFilter = null) {
  wsClients.forEach((ws) => {
    if (ws.readyState === 1) {
      if (!roleFilter || ws.userRole === roleFilter || ws.userRole === 'super_admin') {
        ws.send(JSON.stringify(message));
      }
    }
  });
}

async function handleWsMessage(ws, msg) {
  if (msg.type === 'location') {
    await supabase.from('users').update({ last_loc: msg.coords }).eq('id', ws.userId);
    broadcast({ type: 'location_update', userId: ws.userId, coords: msg.coords }, 'super_admin');
  }
}

// ─── Door Control ─────────────────────────────────────────────────────────────
async function controlDoor(action) {
  console.log('Door action:', action);

  let commands = [];

  if (action === 'open' || action === 'open40') {
    commands = [{ code: 'switch_1', value: true }];
  } else if (action === 'close') {
    commands = [{ code: 'switch_1', value: false }];
  } else if (action === 'stop') {
    commands = [{ code: 'switch_2', value: true }];
  }

  const result = await tuya.request({
    method: 'POST',
    path: `/v1.0/devices/${DEVICE_ID}/commands`,
    body: { commands },
  });

  console.log('Tuya Result:', JSON.stringify(result));

  if (action === 'open40') {
    setTimeout(async () => {
      console.log('Auto close after 40s');
      await tuya.request({
        method: 'POST',
        path: `/v1.0/devices/${DEVICE_ID}/commands`,
        body: { commands: [{ code: 'switch_1', value: false }] },
      });
    }, 40000);
  }

  return result;
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function authMiddleware(roles = []) {
  return (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'porte_secret_2024');
      if (roles.length && !roles.includes(decoded.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      req.user = decoded;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid token' });
    }
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.post('/api/auth/login', async (req, res) => {
  const { phone, pw } = req.body;
  const { data: user, error } = await supabase
    .from('users').select('*').eq('phone', phone).eq('pw', pw).single();
  if (error || !user) return res.status(401).json({ error: 'بيانات غير صحيحة' });
  if (user.status === 'blocked') return res.status(403).json({ error: 'الحساب محظور' });
  if (user.expire_date && new Date(user.expire_date) < new Date()) {
    return res.status(403).json({ error: 'انتهت صلاحية الحساب' });
  }
  const token = jwt.sign(
    { id: user.id, role: user.role, inst_id: user.inst_id, name: user.name },
    process.env.JWT_SECRET || 'porte_secret_2024',
    { expiresIn: '30d' }
  );
  console.log('Login:', user.name, user.role);
  res.json({ token, user: { id: user.id, name: user.name, role: user.role, inst_id: user.inst_id } });
});

app.post('/api/door/control', authMiddleware(['user','admin','super_admin']), async (req, res) => {
  const { action } = req.body;
  console.log('Door control:', action, 'by', req.user.name);
  try {
    const result = await controlDoor(action);
    await supabase.from('door_state').insert({
      value: action,
      source: `${req.user.name} (${req.user.role})`,
    });
    notifyAdmins(req.user.inst_id, {
      title: 'تحكم في الباب',
      body: `${req.user.name} قام بـ ${getActionLabel(action)}`,
    });
    broadcast({ type: 'door_action', action, user: req.user.name, time: Date.now() });
    res.json({ success: true, result });
  } catch (err) {
    console.error('Door error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/door/status', authMiddleware(), async (req, res) => {
  const { data } = await supabase
    .from('door_state').select('*').order('created_at', { ascending: false }).limit(1).single();
  res.json(data || {});
});

app.post('/api/push/subscribe', authMiddleware(), async (req, res) => {
  await supabase.from('users').update({ push_sub: req.body.subscription }).eq('id', req.user.id);
  res.json({ success: true });
});

app.get('/api/users', authMiddleware(['admin','super_admin']), async (req, res) => {
  let query = supabase.from('users').select('id,name,phone,role,status,expire_date,note,schedule,last_loc');
  if (req.user.role === 'admin') query = query.eq('inst_id', req.user.inst_id);
  const { data } = await query;
  res.json(data || []);
});

app.post('/api/users', authMiddleware(['admin','super_admin']), async (req, res) => {
  const { name, phone, pw, role, expire_date, note } = req.body;
  const inst_id = req.user.role === 'super_admin' ? req.body.inst_id : req.user.inst_id;
  const { data, error } = await supabase.from('users')
    .insert({ name, phone, pw, role: role || 'user', status: 'active', inst_id, expire_date, note });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, data });
});

app.put('/api/users/:id', authMiddleware(['admin','super_admin']), async (req, res) => {
  const { error } = await supabase.from('users').update(req.body).eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

app.delete('/api/users/:id', authMiddleware(['admin','super_admin']), async (req, res) => {
  await supabase.from('users').delete().eq('id', req.params.id);
  res.json({ success: true });
});

app.get('/api/institutes', authMiddleware(['admin','super_admin']), async (req, res) => {
  let query = supabase.from('institutes').select('*');
  if (req.user.role === 'admin') query = query.eq('id', req.user.inst_id);
  const { data } = await query;
  res.json(data || []);
});

app.post('/api/institutes', authMiddleware(['super_admin']), async (req, res) => {
  const { data, error } = await supabase.from('institutes').insert(req.body);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, data });
});

app.put('/api/institutes/:id', authMiddleware(['admin','super_admin']), async (req, res) => {
  const { error } = await supabase.from('institutes').update(req.body).eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

app.get('/api/history', authMiddleware(), async (req, res) => {
  const { data } = await supabase
    .from('door_state').select('*').order('created_at', { ascending: false }).limit(100);
  res.json(data || []);
});

app.get('/api/stats', authMiddleware(['admin','super_admin']), async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const { data: todayActions } = await supabase.from('door_state').select('*').gte('created_at', today);
  const { data: users } = await supabase.from('users').select('id,status').eq('inst_id', req.user.inst_id);
  res.json({
    today_actions: todayActions?.length || 0,
    active_users: users?.filter(u => u.status === 'active').length || 0,
    total_users: users?.length || 0,
  });
});

app.post('/api/webhook/tuya', async (req, res) => {
  console.log('Tuya Webhook:', JSON.stringify(req.body));
  const { data } = req.body;
  if (data) {
    const action = data.value ? 'opened' : 'closed';
    await supabase.from('door_state').insert({ value: action, source: 'tuya_webhook' });
    broadcast({ type: 'door_state', state: action, time: Date.now() });
  }
  res.json({ success: true });
});

function getActionLabel(action) {
  return { open:'فتح', close:'غلق', stop:'إيقاف', open40:'فتح 40ث' }[action] || action;
}

async function notifyAdmins(inst_id, notification) {
  if (!inst_id) return;
  const { data: admins } = await supabase
    .from('users').select('push_sub')
    .eq('inst_id', inst_id).eq('role', 'admin').not('push_sub', 'is', null);
  admins?.forEach(admin => {
    if (admin.push_sub) {
      webpush.sendNotification(admin.push_sub, JSON.stringify(notification)).catch(() => {});
    }
  });
}

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Porte running on port ${PORT}`));
