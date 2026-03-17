import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import crypto from 'crypto';
import webpush from 'web-push';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

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
  process.env.VAPID_PUBLIC || 'BOfIw6laarxGfV8Ezc04YzfCzq4Njm7ewizkfnGDIWJGpsfHkqUHVG8SXGb8cJZJxOTIzFeauX4K0Z8oYdfgKTw',
  process.env.VAPID_PRIVATE
);

// ─── Tuya Config ──────────────────────────────────────────────────────────────
const TUYA = {
  CLIENT_ID: process.env.TUYA_CLIENT_ID || '59gmr8xdf3m5vdt55c89',
  SECRET: process.env.TUYA_SECRET,
  DEVICE_ID: process.env.TUYA_DEVICE_ID || 'bf7c670914391fc80cwayk',
  BASE_URL: `https://${process.env.TUYA_REGION || 'openapi.tuyaeu.com'}`,
};

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── WebSocket Clients Map ────────────────────────────────────────────────────
const wsClients = new Map(); // userId -> ws

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
  } catch {
    ws.close();
  }
});

function broadcast(message, roleFilter = null) {
  wsClients.forEach((ws, userId) => {
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

// ─── Tuya Helper ──────────────────────────────────────────────────────────────
async function getTuyaToken() {
  const t = Date.now().toString();
  const str = TUYA.CLIENT_ID + t;
  const sign = crypto.createHmac('sha256', TUYA.SECRET).update(str).digest('hex').toUpperCase();
  
  const res = await fetch(`${TUYA.BASE_URL}/v1.0/token?grant_type=1`, {
    headers: { client_id: TUYA.CLIENT_ID, sign, t, sign_method: 'HMAC-SHA256' }
  });
  const data = await res.json();
  return data.result?.access_token;
}

async function tuyaRequest(method, path, body = null) {
  const token = await getTuyaToken();
  const t = Date.now().toString();
  const contentHash = crypto.createHash('sha256').update(body ? JSON.stringify(body) : '').digest('hex');
  const strToSign = [method, contentHash, '', path].join('\n');
  const str = TUYA.CLIENT_ID + token + t + strToSign;
  const sign = crypto.createHmac('sha256', TUYA.SECRET).update(str).digest('hex').toUpperCase();
  
  const opts = {
    method,
    headers: {
      client_id: TUYA.CLIENT_ID,
      access_token: token,
      sign, t,
      sign_method: 'HMAC-SHA256',
      'Content-Type': 'application/json',
    }
  };
  if (body) opts.body = JSON.stringify(body);
  
  const res = await fetch(`${TUYA.BASE_URL}${path}`, opts);
  return res.json();
}

async function controlDoor(action) {
  const commands = {
    open:  [{ code: 'switch_1', value: true }],
    close: [{ code: 'switch_1', value: false }],
    stop:  [{ code: 'switch_2', value: true }],
    open40: [{ code: 'switch_1', value: true }],
  };
  
  if (action === 'open40') {
    await tuyaRequest('POST', `/v1.0/devices/${TUYA.DEVICE_ID}/commands`, { commands: commands.open });
    setTimeout(async () => {
      await tuyaRequest('POST', `/v1.0/devices/${TUYA.DEVICE_ID}/commands`, { commands: commands.close });
    }, 40000);
    return { success: true };
  }
  
  return tuyaRequest('POST', `/v1.0/devices/${TUYA.DEVICE_ID}/commands`, { commands: commands[action] });
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

// ─── API Routes ───────────────────────────────────────────────────────────────

// Auth
app.post('/api/auth/login', async (req, res) => {
  const { phone, pw } = req.body;
  const { data: user } = await supabase
    .from('users').select('*').eq('phone', phone).eq('pw', pw).single();
  
  if (!user) return res.status(401).json({ error: 'بيانات غير صحيحة' });
  if (user.status === 'blocked') return res.status(403).json({ error: 'الحساب محظور' });
  
  // Check expiry
  if (user.expire_date && new Date(user.expire_date) < new Date()) {
    return res.status(403).json({ error: 'انتهت صلاحية الحساب' });
  }
  
  const token = jwt.sign(
    { id: user.id, role: user.role, inst_id: user.inst_id, name: user.name },
    process.env.JWT_SECRET || 'porte_secret_2024',
    { expiresIn: '30d' }
  );
  
  res.json({ token, user: { id: user.id, name: user.name, role: user.role, inst_id: user.inst_id } });
});

// Door control
app.post('/api/door/control', authMiddleware(['user','admin','super_admin']), async (req, res) => {
  const { action, door_id } = req.body;
  
  // Check schedule
  const { data: inst } = await supabase
    .from('institutes').select('*').eq('id', req.user.inst_id).single();
  
  if (inst?.schedule && !isScheduleAllowed(inst.schedule)) {
    if (req.user.role === 'user') {
      return res.status(403).json({ error: 'خارج أوقات العمل المحددة' });
    }
  }
  
  const result = await controlDoor(action);
  
  // Log to door_state
  await supabase.from('door_state').insert({
    value: action,
    source: `${req.user.name} (${req.user.role})`,
  });
  
  // Log to history
  await supabase.from('institutes').update({
    history: supabase.rpc('append_history', {
      inst_id: req.user.inst_id,
      entry: { action, user: req.user.name, time: new Date().toISOString() }
    })
  }).eq('id', req.user.inst_id);
  
  // Notify admins
  notifyAdmins(req.user.inst_id, {
    title: 'تحكم في الباب',
    body: `${req.user.name} قام بـ ${getActionLabel(action)}`,
    action, userId: req.user.id
  });
  
  broadcast({ type: 'door_action', action, user: req.user.name, time: Date.now() });
  res.json({ success: true, result });
});

// Door status
app.get('/api/door/status', authMiddleware(), async (req, res) => {
  const { data } = await supabase
    .from('door_state').select('*').order('created_at', { ascending: false }).limit(1).single();
  res.json(data);
});

// Push subscription
app.post('/api/push/subscribe', authMiddleware(), async (req, res) => {
  await supabase.from('users').update({ push_sub: req.body.subscription }).eq('id', req.user.id);
  res.json({ success: true });
});

// Users management (admin+)
app.get('/api/users', authMiddleware(['admin','super_admin']), async (req, res) => {
  const query = supabase.from('users').select('id,name,phone,role,status,expire_date,note,schedule,last_loc');
  if (req.user.role === 'admin') query.eq('inst_id', req.user.inst_id);
  const { data } = await query;
  res.json(data);
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
  const { data, error } = await supabase.from('users').update(req.body).eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

app.delete('/api/users/:id', authMiddleware(['admin','super_admin']), async (req, res) => {
  await supabase.from('users').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// Institutes (super_admin)
app.get('/api/institutes', authMiddleware(['super_admin']), async (req, res) => {
  const { data } = await supabase.from('institutes').select('*');
  res.json(data);
});

app.post('/api/institutes', authMiddleware(['super_admin']), async (req, res) => {
  const { data, error } = await supabase.from('institutes').insert(req.body);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, data });
});

app.put('/api/institutes/:id', authMiddleware(['admin','super_admin']), async (req, res) => {
  const id = req.params.id;
  if (req.user.role === 'admin' && req.user.inst_id !== id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  await supabase.from('institutes').update(req.body).eq('id', id);
  res.json({ success: true });
});

// History
app.get('/api/history', authMiddleware(['admin','super_admin']), async (req, res) => {
  const { data } = await supabase
    .from('door_state').select('*').order('created_at', { ascending: false }).limit(100);
  res.json(data);
});

// Stats
app.get('/api/stats', authMiddleware(['admin','super_admin']), async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const { data: todayActions } = await supabase
    .from('door_state').select('*').gte('created_at', today);
  const { data: users } = await supabase
    .from('users').select('id,status').eq('inst_id', req.user.inst_id);
  
  res.json({
    today_actions: todayActions?.length || 0,
    active_users: users?.filter(u => u.status === 'active').length || 0,
    total_users: users?.length || 0,
  });
});

// Tuya Webhook
app.post('/api/webhook/tuya', async (req, res) => {
  const { data } = req.body;
  if (data) {
    const action = data.value ? 'opened' : 'closed';
    await supabase.from('door_state').insert({ value: action, source: 'tuya_webhook' });
    broadcast({ type: 'door_state', state: action, time: Date.now() });
  }
  res.json({ success: true });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isScheduleAllowed(schedule) {
  const now = new Date();
  const day = now.getDay();
  const time = now.getHours() * 60 + now.getMinutes();
  const daySchedule = schedule[day];
  if (!daySchedule || !daySchedule.enabled) return false;
  const [sh, sm] = daySchedule.start.split(':').map(Number);
  const [eh, em] = daySchedule.end.split(':').map(Number);
  return time >= sh * 60 + sm && time <= eh * 60 + em;
}

function getActionLabel(action) {
  return { open: 'فتح الباب', close: 'غلق الباب', stop: 'إيقاف الباب', open40: 'فتح لمدة 40ث' }[action] || action;
}

async function notifyAdmins(inst_id, notification) {
  const { data: admins } = await supabase
    .from('users').select('push_sub').eq('inst_id', inst_id).eq('role', 'admin').not('push_sub', 'is', null);
  
  admins?.forEach(admin => {
    if (admin.push_sub) {
      webpush.sendNotification(admin.push_sub, JSON.stringify(notification)).catch(() => {});
    }
  });
}

// ─── Serve SPA ────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Porte server running on port ${PORT}`));
