import express from 'express';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import mqtt from 'mqtt';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ═══════════════════════════════════════════════════════════════════════════════
// Rate Limiting
// ═══════════════════════════════════════════════════════════════════════════════
const rateLimitMap = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const e = rateLimitMap.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > e.resetAt) { e.count = 0; e.resetAt = now + windowMs; }
  e.count++; rateLimitMap.set(key, e);
  return e.count <= max;
}
function rl(max, windowMs) {
  return (req, res, next) => {
    if (!rateLimit(req.ip + req.path, max, windowMs))
      return res.status(429).json({ error: 'محاولات كثيرة، حاول لاحقاً' });
    next();
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Encryption
// ═══════════════════════════════════════════════════════════════════════════════
const PW_SECRET = process.env.PW_SECRET || 'porte-default-secret-change-me-32ch';
function encryptPw(text) {
  const key = crypto.scryptSync(PW_SECRET, 'salt', 32);
  const iv  = crypto.randomBytes(16);
  const c   = crypto.createCipheriv('aes-256-cbc', key, iv);
  return iv.toString('hex') + ':' + Buffer.concat([c.update(text, 'utf8'), c.final()]).toString('hex');
}
function decryptPw(enc) {
  try {
    const [ivHex, encHex] = enc.split(':');
    const key = crypto.scryptSync(PW_SECRET, 'salt', 32);
    const d   = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'));
    return Buffer.concat([d.update(Buffer.from(encHex, 'hex')), d.final()]).toString('utf8');
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════════════════
const SUPABASE_URL         = process.env.SUPABASE_URL      || 'https://sjfaootvlxesdytdsknc.supabase.co';
const SUPABASE_ANON_KEY    = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqZmFvb3R2bHhlc2R5dGRza25jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxODAyNTcsImV4cCI6MjA4ODc1NjI1N30.pEhpszTGygiR6brpWHglnpcASAPw7kyWl0qd5mFwwMQ';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const JWT_SECRET           = process.env.JWT_SECRET        || 'porte-secret-key-2024';
const VAPID_PUBLIC         = process.env.VAPID_PUBLIC      || 'BOfIw6laarxGfV8Ezc04YzfCzq4Njm7ewizkfnGDIWJGpsfHkqUHVG8SXGb8cJZJxOTIzFeauX4K0Z8oYdfgKTw';
const VAPID_PRIVATE        = process.env.VAPID_PRIVATE;
const DEFAULT_DURATION     = parseInt(process.env.DEFAULT_DURATION || '5');
const MQTT_HOST            = process.env.MQTT_HOST  || 'eclipse-mosquitto';
const MQTT_PORT            = parseInt(process.env.MQTT_PORT || '1883');
const MQTT_TOPIC           = process.env.MQTT_TOPIC || 'sonoff4ch'; // الـ topic الافتراضي

// ═══════════════════════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════════════════════
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
if (VAPID_PRIVATE) webpush.setVapidDetails('mailto:admin@porte.app', VAPID_PUBLIC, VAPID_PRIVATE);

const app    = express();
const server = createServer(app);
const wss    = new WebSocketServer({ server });
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ═══════════════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════════════
const wsClients      = new Map(); // userId → ws
const doorStateCache = new Map(); // deviceId → { r1,r2,r3,r4, isOpen, isClose }
const appLastAction  = new Map(); // deviceId → { userId, userName, action, time }
const doorTimers     = {};        // deviceId → timer
const doorProgress   = {};        // deviceId → { pos, isOpen, startTime, duration, startPos }
let   doorCache      = new Map(); // device_id → door object (النقطة 8: متعدد)
let   mqttClient     = null;

// ═══════════════════════════════════════════════════════════════════════════════
// Door Cache
// ═══════════════════════════════════════════════════════════════════════════════
async function loadDoorCache() {
  try {
    const { data, error } = await supabase.from('doors')
      .select('id,inst_id,name,device_id,rc_notify,manual_notify,duration_seconds,gps,schedule,door_type,auto_schedule');
    if (error) { console.error('[DoorCache] error:', error.message); return; }
    doorCache = new Map();
    (data || []).forEach(d => {
      if (d.device_id) {
        d.device_id = d.device_id.replace(/[\r\n\t]/g, '').trim();
        doorCache.set(d.device_id, d);
      }
    });
    console.log(`[DoorCache] loaded ${doorCache.size} door(s): [${[...doorCache.keys()].join(', ')}]`);
    // إرسال PulseTime لكل الأبواب بعد 3 ثوانٍ
    setTimeout(() => {
      if (mqttClient?.connected) {
        doorCache.forEach(door => {
          if (door.duration_seconds && door.device_id) {
            const pt = Math.round(door.duration_seconds * 10);
            [1,2,3,4].forEach(ch => mqttClient.publish(`cmnd/${door.device_id}/PulseTime${ch}`, String(pt), { qos: 1 }));
            console.log(`[PulseTime] init ${door.device_id} → ${pt} (${door.duration_seconds}s)`);
          }
        });
      }
    }, 3000);
  } catch(e) { console.error('[DoorCache]', e.message); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// JWT
// ═══════════════════════════════════════════════════════════════════════════════
function signToken(payload) {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const b = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString('base64url');
  const s = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest('base64url');
  return `${h}.${b}.${s}`;
}
function verifyToken(token) {
  const [h, b, s] = token.split('.');
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest('base64url');
  if (s !== expected) throw new Error('Invalid token');
  return JSON.parse(Buffer.from(b, 'base64url').toString());
}

// ═══════════════════════════════════════════════════════════════════════════════
// Middleware
// ═══════════════════════════════════════════════════════════════════════════════
function auth(req, res, next) {
  const h = req.headers['authorization'];
  if (!h) return res.status(401).json({ error: 'غير مصرح' });
  try { req.user = verifyToken(h.replace('Bearer ', '')); next(); }
  catch { res.status(401).json({ error: 'جلسة منتهية' }); }
}
function adminOnly(req, res, next) {
  if (!['admin','super_admin'].includes(req.user.role)) return res.status(403).json({ error: 'غير مسموح' });
  next();
}
function superAdminOnly(req, res, next) {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'للسوبر أدمن فقط' });
  next();
}

// ═══════════════════════════════════════════════════════════════════════════════
// WebSocket
// ═══════════════════════════════════════════════════════════════════════════════
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}
function broadcastToInst(instId, data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === 1 && c._instId === instId) c.send(msg); });
}
function broadcastToUser(userId, data) {
  const c = wsClients.get(String(userId));
  if (c?.readyState === 1) { c.send(JSON.stringify(data)); return true; }
  return false;
}

wss.on('connection', (ws, req) => {
  const token = new URL(req.url, 'http://localhost').searchParams.get('token');
  let userId = null;
  if (token) {
    try {
      const payload = verifyToken(token);
      userId = payload.id;
      ws._instId = payload.inst_id; // النقطة 8: حفظ inst_id للـ broadcast
      wsClients.set(userId, ws);
    } catch {}
  }
  ws.send(JSON.stringify({ type: 'connected' }));

  // النقطة 2: إرسال حالة الأبواب فور الاتصال
  if (userId) {
    doorCache.forEach(door => {
      const s = doorStateCache.get(door.device_id) || { r1:false, r2:false, r3:false, r4:false };
      const isOpen  = s.r1 || s.r2; // R1=يدوي فتح, R2=RC فتح
      const isClose = s.r3 || s.r4; // R3=يدوي غلق, R4=RC غلق
      ws.send(JSON.stringify({
        type: 'door_state', deviceId: door.device_id,
        doorId: door.id, instId: door.inst_id,
        r1_on: isOpen, r2_on: isClose,
        state: isOpen ? 'open' : isClose ? 'close' : 'idle',
        source: 'init', timestamp: Date.now(),
      }));
    });
  }

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'location' && userId) {
        broadcast({ type: 'user_location', userId, coords: msg.coords });
        const now = new Date().toISOString();
        const { data: u } = await supabase.from('users').select('inst_id').eq('id', userId).single();
        await supabase.from('user_locations').insert({ user_id: userId, inst_id: u?.inst_id, lat: msg.coords.lat, lng: msg.coords.lng, accuracy: msg.coords.accuracy||null, created_at: now });
        await supabase.from('users').update({ last_location: msg.coords, last_seen: now }).eq('id', userId);
        await supabase.from('user_locations').delete().eq('user_id', userId).lt('created_at', new Date(Date.now()-30*24*60*60*1000).toISOString());
      }
    } catch {}
  });
  ws.on('close', () => { if (userId) wsClients.delete(userId); });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Push
// ═══════════════════════════════════════════════════════════════════════════════
async function sendPushToAdmins(instId, notification) {
  if (!VAPID_PRIVATE) return;
  try {
    const { data: admins } = await supabase.from('users').select('id').eq('inst_id', instId).eq('role','admin').eq('status','active');
    if (!admins?.length) return;
    const { data: subs } = await supabase.from('push_subscriptions').select('*').in('user_id', admins.map(a=>a.id));
    if (!subs?.length) return;
    const payload = JSON.stringify(notification);
    await Promise.allSettled(subs.map(sub =>
      webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
        .catch(err => { if (err.statusCode===410) supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); })
    ));
  } catch(e) { console.error('[Push]', e.message); }
}

async function sendPushToAll(notification) {
  if (!VAPID_PRIVATE) return;
  try {
    const { data: subs } = await supabase.from('push_subscriptions').select('*');
    if (!subs?.length) return;
    const payload = JSON.stringify(notification);
    await Promise.allSettled(subs.map(sub =>
      webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
        .catch(err => { if (err.statusCode===410) supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); })
    ));
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════════
// MQTT — النقطة 8: دعم topics متعددة
// ═══════════════════════════════════════════════════════════════════════════════
function mqttControl(deviceId, channel, value) {
  if (!mqttClient?.connected) { console.error('[MQTT] not connected'); return; }
  const topic = `cmnd/${deviceId}/POWER${channel}`;
  mqttClient.publish(topic, value ? 'ON' : 'OFF', { qos: 1 });
  console.log(`[MQTT] ⬆️ ${topic}: ${value ? 'ON' : 'OFF'}`);
}

function startMQTT() {
  const client = mqtt.connect(`mqtt://${MQTT_HOST}:${MQTT_PORT}`, {
    clientId: 'porte-' + Math.random().toString(16).slice(2),
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });

  client.on('connect', () => {
    console.log('[MQTT] ✅ متصل');
    // النقطة 8: الاشتراك في كل الأبواب
    doorCache.forEach(door => subscribeToDevice(client, door.device_id));
    console.log(`[MQTT] 📡 مشترك في ${doorCache.size} باب`);
  });

  client.on('message', async (topic, message) => {
    const msg = message.toString();

    // استخراج deviceId من الـ topic
    // تنسيق: stat/DEVICEID/POWER1 أو tele/DEVICEID/LWT
    const topicParts = topic.split('/');
    if (topicParts.length < 3) return;
    const deviceId = topicParts[1];
    const topicType = topicParts[0];
    const topicSuffix = topicParts.slice(2).join('/');

    // LWT — online/offline
    if (topicType === 'tele' && topicSuffix === 'LWT') {
      const isOnline = msg === 'Online';
      broadcast({ type: 'device_online', deviceId, online: isOnline, timestamp: Date.now() });
      if (!isOnline) {
        const door = doorCache.get(deviceId);
        if (door) sendPushToAdmins(door.inst_id, { title: '⚠️ انقطع اتصال الجهاز', body: `الباب "${door.name}" غير متصل` });
      }
      return;
    }

    // STATE كاملة — تحديث cache
    if (topicType === 'tele' && topicSuffix === 'STATE') {
      try {
        const s = JSON.parse(msg);
        const c = doorStateCache.get(deviceId) || { r1:false, r2:false, r3:false, r4:false };
        if (s.POWER1 !== undefined) c.r1 = s.POWER1 === 'ON';
        if (s.POWER2 !== undefined) c.r2 = s.POWER2 === 'ON';
        if (s.POWER3 !== undefined) c.r3 = s.POWER3 === 'ON';
        if (s.POWER4 !== undefined) c.r4 = s.POWER4 === 'ON';
        doorStateCache.set(deviceId, { ...c });
      } catch {}
      return;
    }

    // POWER state
    if (topicType === 'stat' && topicSuffix.startsWith('POWER')) {
      const ch  = topicSuffix.slice(-1); // '1','2','3','4'
      const val = msg === 'ON';

      const cached = doorStateCache.get(deviceId) || { r1:false, r2:false, r3:false, r4:false };
      const prev   = { ...cached };
      if (ch === '1') cached.r1 = val;
      if (ch === '2') cached.r2 = val;
      if (ch === '3') cached.r3 = val;
      if (ch === '4') cached.r4 = val;
      doorStateCache.set(deviceId, { ...cached });

      // R1+R2 = فتح (R1=يدوي, R2=RC), R3+R4 = غلق (R3=يدوي, R4=RC)
      const isOpen  = cached.r1 || cached.r2;
      const isClose = cached.r3 || cached.r4;
      const changed = (prev.r1!==cached.r1)||(prev.r2!==cached.r2)||(prev.r3!==cached.r3)||(prev.r4!==cached.r4);
      const doorAction = isOpen ? 'open' : isClose ? 'close' : 'idle';

      const lastApp   = appLastAction.get(deviceId);
      const isFromApp = !!(lastApp && (Date.now() - lastApp.time) < 15000);
      const isRC      = (ch === '2' || ch === '4'); // R2+R4 = RC
      const door      = doorCache.get(deviceId);

      // بث للواجهة
      broadcast({
        type: 'door_state', deviceId,
        doorId: door?.id, instId: door?.inst_id,
        channel: ch, r1_on: isOpen, r2_on: isClose,
        state: doorAction,
        source: isFromApp ? 'app' : isRC ? 'rc' : 'manual',
        timestamp: Date.now(),
      });

      // حفظ في السجل فقط عند ON وتغيير حقيقي
      if (changed && val && door) {
        const logEntry = {
          door_id: door.id, inst_id: door.inst_id,
          value: doorAction, created_at: new Date().toISOString(),
        };
        if (isFromApp) {
          logEntry.user_id = lastApp.userId;
          logEntry.source  = lastApp.userName;
          console.log(`[MQTT] 📱 App: ${doorAction} by ${lastApp.userName} on ${door.name}`);
        } else if (isRC) {
          logEntry.user_id = null;
          logEntry.source  = 'RC (جهاز تحكم)';
          console.log(`[MQTT] 📻 RC: ${doorAction} — ${door.name}`);
          if (door.rc_notify) {
            const label = doorAction === 'open' ? 'فتح الباب' : 'غلق الباب';
            sendPushToAdmins(door.inst_id, { title: 'إشعار RC 📻', body: `${label} بواسطة RC — ${door.name}` });
          }
        } else {
          logEntry.user_id = null;
          logEntry.source  = 'يدوي (أزرار الجهاز)';
          console.log(`[MQTT] 🖐️ يدوي: ${doorAction} — ${door.name}`);
          if (door.manual_notify) {
            const label = doorAction === 'open' ? 'فتح الباب' : 'غلق الباب';
            sendPushToAdmins(door.inst_id, { title: 'إشعار يدوي 🖐️', body: `${label} بالأزرار — ${door.name}` });
          }
        }
        const { error } = await supabase.from('door_logs').insert(logEntry);
        if (error) console.error('[Log insert]', error.message);
      }
    }
  });

  client.on('error',     err => console.error('[MQTT] ❌', err.message));
  client.on('reconnect', ()  => console.log('[MQTT] 🔄 إعادة اتصال...'));
  return client;
}

// الاشتراك في topics جهاز معين
function subscribeToDevice(client, deviceId) {
  if (!client || !deviceId) return;
  [1,2,3,4].forEach(p => client.subscribe(`stat/${deviceId}/POWER${p}`));
  client.subscribe(`tele/${deviceId}/STATE`);
  client.subscribe(`tele/${deviceId}/LWT`);
  console.log(`[MQTT] 📡 subscribed: ${deviceId}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Door Actions — النقطة 8: يقبل deviceId متغير
// ═══════════════════════════════════════════════════════════════════════════════
async function openDoor(deviceId, dur) {
  if (doorTimers[deviceId]) { clearTimeout(doorTimers[deviceId]); delete doorTimers[deviceId]; }
  if (doorProgress[deviceId]?._interval) { clearInterval(doorProgress[deviceId]._interval); }
  mqttControl(deviceId, 3, false);
  await new Promise(r => setTimeout(r, 200));
  mqttControl(deviceId, 1, true);
  // تتبع النسبة
  const startPos = doorProgress[deviceId]?.pos ?? 0.0;
  const startTime = Date.now();
  const totalMs = dur * 1000 * (1 - startPos);
  doorProgress[deviceId] = { pos: startPos, isOpen: true, startTime, duration: dur, startPos };
  // broadcast النسبة كل 200ms
  doorProgress[deviceId]._interval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / totalMs, 1);
    const pos = startPos + (1 - startPos) * progress;
    doorProgress[deviceId].pos = pos;
    const dp = doorCache.get(deviceId);
    broadcast({ type: 'door_progress', deviceId, doorId: dp?.id, pos, isOpen: true });
  }, 200);
  broadcast({ type: 'door_event', action: 'open', deviceId });
  doorTimers[deviceId] = setTimeout(() => {
    mqttControl(deviceId, 1, false);
    if (doorProgress[deviceId]?._interval) { clearInterval(doorProgress[deviceId]._interval); }
    doorProgress[deviceId] = { pos: 1.0, isOpen: true };
    broadcast({ type: 'door_event', action: 'auto_stop', deviceId });
    broadcast({ type: 'door_progress', deviceId, pos: 1.0, isOpen: true });
    delete doorTimers[deviceId];
  }, dur * 1000);
  return { success: true };
}

async function closeDoor(deviceId, dur) {
  if (doorTimers[deviceId]) { clearTimeout(doorTimers[deviceId]); delete doorTimers[deviceId]; }
  if (doorProgress[deviceId]?._interval) { clearInterval(doorProgress[deviceId]._interval); }
  mqttControl(deviceId, 1, false);
  await new Promise(r => setTimeout(r, 200));
  mqttControl(deviceId, 3, true);
  // تتبع النسبة
  const startPos = doorProgress[deviceId]?.pos ?? 1.0;
  const startTime = Date.now();
  const totalMs = dur * 1000 * startPos;
  doorProgress[deviceId] = { pos: startPos, isOpen: false, startTime, duration: dur, startPos };
  // broadcast النسبة كل 200ms
  doorProgress[deviceId]._interval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / totalMs, 1);
    const pos = startPos - startPos * progress;
    doorProgress[deviceId].pos = pos;
    const dp2 = doorCache.get(deviceId);
    broadcast({ type: 'door_progress', deviceId, doorId: dp2?.id, pos, isOpen: false });
  }, 200);
  broadcast({ type: 'door_event', action: 'close', deviceId });
  doorTimers[deviceId] = setTimeout(() => {
    mqttControl(deviceId, 3, false);
    if (doorProgress[deviceId]?._interval) { clearInterval(doorProgress[deviceId]._interval); }
    doorProgress[deviceId] = { pos: 0.0, isOpen: false };
    broadcast({ type: 'door_event', action: 'auto_stop', deviceId });
    broadcast({ type: 'door_progress', deviceId, pos: 0.0, isOpen: false });
    delete doorTimers[deviceId];
  }, dur * 1000);
  return { success: true };
}

async function stopDoor(deviceId) {
  if (doorTimers[deviceId]) { clearTimeout(doorTimers[deviceId]); delete doorTimers[deviceId]; }
  if (doorProgress[deviceId]?._interval) {
    clearInterval(doorProgress[deviceId]._interval);
    const currentPos = doorProgress[deviceId]?.pos ?? 0;
    doorProgress[deviceId] = { pos: currentPos, isOpen: doorProgress[deviceId]?.isOpen };
    broadcast({ type: 'door_progress', deviceId, pos: currentPos, isOpen: doorProgress[deviceId]?.isOpen, stopped: true });
  }
  mqttControl(deviceId, 1, false);
  mqttControl(deviceId, 3, false);
  broadcast({ type: 'door_event', action: 'stop', deviceId });
  return { success: true };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Auto Schedule
// ═══════════════════════════════════════════════════════════════════════════════
function checkAutoSchedule() {
  const now      = new Date();
  const dayMap   = [6,0,1,2,3,4,5];
  const todayIdx = dayMap[now.getDay()];
  const timeStr  = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
  for (const [deviceId, door] of doorCache) {
    if (!door.auto_schedule) continue;
    const day = door.auto_schedule[todayIdx];
    if (!day?.enabled) continue;
    if (day.open_time  && timeStr === day.open_time)  { mqttControl(deviceId, 1, true); console.log(`[AutoSchedule] فتح: ${door.name}`); }
    if (day.close_time && timeStr === day.close_time) { mqttControl(deviceId, 3, true); console.log(`[AutoSchedule] غلق: ${door.name}`); }
  }
}
setInterval(checkAutoSchedule, 60000);

// ═══════════════════════════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/health', (req, res) => res.json({ status: 'ok', doors: doorCache.size }));

// AUTH
app.post('/api/auth/send-otp', rl(3, 600000), async (req, res) => {
  try {
    const { phone, type } = req.body;
    if (!phone) return res.status(400).json({ error: 'رقم الهاتف مطلوب' });
    await supabase.from('otp_codes').delete().eq('phone', phone).eq('type', type||'register');
    const { error } = await supabase.from('otp_codes').insert({ phone, code: '0000', type: type||'register', expires_at: new Date(Date.now()+10*60*1000).toISOString() });
    if (error) return res.status(500).json({ error: error.message });
    console.log(`[OTP] ${phone} → 0000 (${type})`);
    res.json({ success: true, message: 'تم إرسال الرمز' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/verify-otp', rl(5, 600000), async (req, res) => {
  try {
    const { phone, code, type } = req.body;
    const { data: otp } = await supabase.from('otp_codes').select('*').eq('phone', phone).eq('type', type||'register').eq('used', false).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!otp) return res.status(400).json({ error: 'لم يتم إرسال رمز' });
    if (new Date(otp.expires_at) < new Date()) return res.status(400).json({ error: 'انتهت صلاحية الرمز' });
    if (otp.code !== code) return res.status(400).json({ error: 'الرمز غير صحيح' });
    await supabase.from('otp_codes').update({ used: true }).eq('id', otp.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/register', rl(3, 3600000), async (req, res) => {
  try {
    const { name, last_name, phone, pw, inst_code } = req.body;
    if (!name || !phone || !pw || !inst_code) return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
    const { data: inst } = await supabase.from('institutes').select('id,name').eq('code', inst_code).maybeSingle();
    if (!inst) return res.status(400).json({ error: 'كود المؤسسة غير صحيح' });
    const { data: ex } = await supabase.from('users').select('id').eq('phone', phone).limit(1);
    if (ex?.length) return res.status(400).json({ error: 'رقم الهاتف مسجل مسبقاً' });
    const { data: newUser, error } = await supabase.from('users').insert({
      name: name + (last_name ? ' '+last_name : ''), last_name, phone,
      pw_hash: crypto.createHash('sha256').update(pw).digest('hex'), pw_plain: encryptPw(pw),
      inst_id: inst.id, role: 'user', status: 'active', request_status: 'pending',
      created_at: new Date().toISOString()
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    const { data: admins } = await supabase.from('users').select('id').eq('inst_id', inst.id).eq('role','admin').eq('status','active');
    if (admins?.length) {
      admins.forEach(a => broadcastToUser(a.id, { type: 'new_join_request', userId: newUser.id, userName: newUser.name, instId: inst.id, instName: inst.name }));
      await sendPushToAdmins(inst.id, { title: '👤 طلب انضمام جديد', body: `${newUser.name} يريد الانضمام إلى ${inst.name}` });
    }
    const token = signToken({ id: newUser.id, role: newUser.role, inst_id: newUser.inst_id, name: newUser.name });
    res.json({ token, user: { id: newUser.id, name: newUser.name, phone: newUser.phone, role: newUser.role, inst_id: newUser.inst_id, request_status: 'pending' } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/reset-password', rl(3, 3600000), async (req, res) => {
  try {
    const { phone, code, new_pw } = req.body;
    const { data: otp } = await supabase.from('otp_codes').select('*').eq('phone', phone).eq('type','reset_password').eq('used',false).order('created_at',{ascending:false}).limit(1).maybeSingle();
    if (!otp || otp.code !== code) return res.status(400).json({ error: 'الرمز غير صحيح' });
    if (new Date(otp.expires_at) < new Date()) return res.status(400).json({ error: 'انتهت صلاحية الرمز' });
    await supabase.from('users').update({ pw_hash: crypto.createHash('sha256').update(new_pw).digest('hex'), pw_plain: encryptPw(new_pw) }).eq('phone', phone);
    await supabase.from('otp_codes').update({ used: true }).eq('id', otp.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/change-password', auth, async (req, res) => {
  try {
    const { old_pw, new_pw } = req.body;
    const { data: u } = await supabase.from('users').select('pw_hash').eq('id', req.user.id).single();
    if (!u) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (u.pw_hash !== crypto.createHash('sha256').update(old_pw).digest('hex')) return res.status(400).json({ error: 'كلمة المرور القديمة غير صحيحة' });
    await supabase.from('users').update({ pw_hash: crypto.createHash('sha256').update(new_pw).digest('hex'), pw_plain: encryptPw(new_pw) }).eq('id', req.user.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', rl(5, 60000), async (req, res) => {
  try {
    const { phone, pw } = req.body;
    if (!phone || !pw) return res.status(400).json({ error: 'الهاتف وكلمة المرور مطلوبان' });
    const { data: u, error } = await supabase.from('users').select('*').eq('phone', phone).single();
    if (error || !u) return res.status(401).json({ error: 'رقم الهاتف غير موجود' });
    if (u.status === 'blocked') return res.status(401).json({ error: 'الحساب موقوف، تواصل مع المسؤول' });
    if (u.pw_hash !== crypto.createHash('sha256').update(pw).digest('hex')) return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
    if (u.expire_date && new Date(u.expire_date) < new Date()) return res.status(401).json({ error: 'انتهت صلاحية الحساب' });
    const token = signToken({ id: u.id, role: u.role, inst_id: u.inst_id, name: u.name });
    res.json({ token, user: { id: u.id, name: u.name, phone: u.phone, role: u.role, inst_id: u.inst_id, request_status: u.request_status } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/heartbeat', auth, async (req, res) => {
  await supabase.from('users').update({ last_seen: new Date().toISOString() }).eq('id', req.user.id);
  res.json({ success: true });
});

// النقطة 2: جلب حالة كل الأبواب دفعة واحدة
app.get('/api/doors/status', auth, (req, res) => {
  const result = [];
  doorCache.forEach(door => {
    const s = doorStateCache.get(door.device_id) || { r1:false, r2:false, r3:false, r4:false };
    const isOpen  = s.r1 || s.r3;
    const isClose = s.r2 || s.r4;
    result.push({
      doorId:   door.id,
      deviceId: door.device_id,
      instId:   door.inst_id,
      r1_on:    isOpen,
      r2_on:    isClose,
      state:    isOpen ? 'open' : isClose ? 'close' : 'idle',
      timer_active: !!doorTimers[door.device_id],
    });
  });
  res.json(result);
});

// DOOR STATUS (باب واحد)
app.get('/api/door/status', auth, (req, res) => {
  const deviceId = req.query.deviceId || MQTT_TOPIC;
  const s = doorStateCache.get(deviceId) || { r1:false, r2:false, r3:false, r4:false };
  const isOpen  = s.r1 || s.r2;
  const isClose = s.r3 || s.r4;
  res.json({ value: isOpen ? 'open' : isClose ? 'close' : 'stop', r1_on: isOpen, r2_on: isClose, timer_active: !!doorTimers[deviceId] });
});

// DOOR CONTROL
app.post('/api/door/control', auth, async (req, res) => {
  try {
    const { action } = req.body;
    const deviceId   = req.body.deviceId || MQTT_TOPIC;
    const duration   = parseInt(req.body.duration) || DEFAULT_DURATION;

    // النقطة 3: منع نفس الأمر مرتين خلال 500ms من نفس المستخدم
    const lastApp = appLastAction.get(deviceId);
    if (lastApp && (Date.now() - lastApp.time) < 500 && lastApp.userId === req.user.id && lastApp.action === action) {
      return res.status(429).json({ error: 'انتظر لحظة', code: 'TOO_FAST' });
    }

    const { data: cu } = await supabase.from('users').select('status,request_status').eq('id', req.user.id).single();
    if (!cu || cu.status === 'blocked') return res.status(403).json({ error: 'حسابك موقوف، تواصل مع المسؤول', code: 'ACCOUNT_BLOCKED' });
    if (cu.request_status === 'pending') return res.status(403).json({ error: 'طلبك لم يتم قبوله بعد', code: 'PENDING_APPROVAL' });

    const role = req.user.role;
    if (role === 'user' || role === 'admin') {
      const door = doorCache.get(deviceId);
      if (door) {
        const gpsReq = role === 'user' ? door.gps?.user_required : door.gps?.admin_required;
        if (gpsReq && door.gps?.lat && door.gps?.lng) {
          const uLat = parseFloat(req.body.lat), uLng = parseFloat(req.body.lng);
          const accuracy = parseFloat(req.body.accuracy) || 999;
          if (!uLat || !uLng) {
            await supabase.from('access_alerts').insert({ user_id: req.user.id, inst_id: req.user.inst_id, type: 'gps_required', action, message: 'محاولة فتح الباب بدون GPS', created_at: new Date().toISOString() });
            return res.status(403).json({ error: 'يجب تفعيل GPS للوصول إلى هذا الباب', code: 'GPS_REQUIRED' });
          }
          const rt = parseInt(req.body.responseTime) || 0;
          if (rt > 0 && rt < 50) {
            await supabase.from('access_alerts').insert({ user_id: req.user.id, inst_id: req.user.inst_id, type: 'fake_gps_suspected', action, lat: uLat, lng: uLng, message: `GPS استجاب في ${rt}ms`, created_at: new Date().toISOString() });
            return res.status(403).json({ error: 'تم اكتشاف موقع غير حقيقي (استجابة فورية).', code: 'FAKE_GPS' });
          }
          if (accuracy < 3) {
            await supabase.from('access_alerts').insert({ user_id: req.user.id, inst_id: req.user.inst_id, type: 'fake_gps_suspected', action, lat: uLat, lng: uLng, message: `دقة GPS مريبة: ${accuracy}م`, created_at: new Date().toISOString() });
            return res.status(403).json({ error: 'تم اكتشاف موقع غير حقيقي.', code: 'FAKE_GPS' });
          }
          const R = 6371000;
          const dLat = (uLat - door.gps.lat) * Math.PI/180, dLng = (uLng - door.gps.lng) * Math.PI/180;
          const a = Math.sin(dLat/2)**2 + Math.cos(door.gps.lat*Math.PI/180)*Math.cos(uLat*Math.PI/180)*Math.sin(dLng/2)**2;
          const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          if (dist > (door.gps.range||100)) {
            await supabase.from('access_alerts').insert({ user_id: req.user.id, inst_id: req.user.inst_id, door_id: door.id, type: 'gps_out_of_range', action, lat: uLat, lng: uLng, message: `بعيد عن الباب بـ ${Math.round(dist)}م`, created_at: new Date().toISOString() });
            return res.status(403).json({ error: `أنت بعيد عن الباب (${Math.round(dist)}م). النطاق المسموح: ${door.gps.range}م`, code: 'GPS_OUT_OF_RANGE' });
          }
        }
        if (role === 'user' && door.schedule && Object.keys(door.schedule).length > 0) {
          const now = new Date();
          const ds  = door.schedule[[1,2,3,4,5,6,0][now.getDay()]];
          if (ds && !ds.enabled) {
            await supabase.from('access_alerts').insert({ user_id: req.user.id, inst_id: req.user.inst_id, type: 'schedule_denied', action, message: 'محاولة فتح الباب خارج أيام العمل', created_at: new Date().toISOString() });
            return res.status(403).json({ error: 'الباب غير مسموح به اليوم', code: 'SCHEDULE_DENIED' });
          }
          if (ds?.enabled && ds.start && ds.end) {
            const ts = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
            if (ts < ds.start || ts > ds.end) {
              await supabase.from('access_alerts').insert({ user_id: req.user.id, inst_id: req.user.inst_id, type: 'schedule_time', action, message: `محاولة فتح الباب خارج الوقت (${ds.start}–${ds.end})`, created_at: new Date().toISOString() });
              return res.status(403).json({ error: `الباب مسموح به من ${ds.start} إلى ${ds.end} فقط`, code: 'SCHEDULE_OUT_OF_RANGE' });
            }
          }
        }
      }
    }

    // سجّل الأمر من التطبيق قبل إرسال MQTT
    appLastAction.set(deviceId, { userId: req.user.id, userName: req.user.name, action, time: Date.now() });

    let result;
    if      (action==='open')   result = await openDoor(deviceId, duration);
    else if (action==='open40') result = await openDoor(deviceId, 40);
    else if (action==='close')  result = await closeDoor(deviceId, duration);
    else if (action==='stop')   result = await stopDoor(deviceId);
    else return res.status(400).json({ error: 'action غير معروف' });

    if (!result?.success) return res.status(500).json({ error: result?.msg });

    broadcast({ type: 'door_event', action, userId: req.user.id, deviceId });
    await sendPushToAll({ title: `🚪 ${['open','open40'].includes(action)?'فتح الباب':action==='close'?'غلق الباب':'إيقاف الباب'}`, body: `بواسطة ${req.user.name}` });
    res.json({ success: true, action });
  } catch(e) { console.error('[Control]', e); res.status(500).json({ error: e.message }); }
});

// HISTORY
app.get('/api/history', auth, async (req, res) => {
  try {
    let q = supabase.from('door_logs').select('*').order('created_at', { ascending: false }).limit(100);
    if (req.user.role !== 'super_admin') q = q.eq('inst_id', req.user.inst_id);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// STATS
app.get('/api/stats', auth, adminOnly, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    let lQ = supabase.from('door_logs').select('id', { count: 'exact' }).gte('created_at', today);
    let uQ = supabase.from('users').select('id,status', { count: 'exact' });
    if (req.user.role !== 'super_admin') { lQ=lQ.eq('inst_id',req.user.inst_id); uQ=uQ.eq('inst_id',req.user.inst_id); }
    const [{ count: tc }, { data: ud }] = await Promise.all([lQ, uQ]);
    res.json({ today_actions: tc||0, active_users: ud?.filter(u=>u.status==='active').length||0, total_users: ud?.length||0 });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stats/full', auth, adminOnly, async (req, res) => {
  try {
    const instId = req.user.role==='super_admin' ? null : req.user.inst_id;
    const today  = new Date(); today.setHours(0,0,0,0);
    let lQ=supabase.from('door_logs').select('value,created_at',{count:'exact'});
    let aQ=supabase.from('access_alerts').select('id',{count:'exact'});
    let uQ=supabase.from('users').select('id,status',{count:'exact'}).neq('role','super_admin');
    if (instId) { lQ=lQ.eq('inst_id',instId); aQ=aQ.eq('inst_id',instId); uQ=uQ.eq('inst_id',instId); }
    const [l,a,u] = await Promise.all([lQ,aQ,uQ]);
    res.json({ today_actions: (l.data||[]).filter(x=>new Date(x.created_at)>=today).length, total_actions: l.count||0, total_opens: (l.data||[]).filter(x=>x.value==='open'||x.value==='open40').length, alert_count: a.count||0, total_users: u.count||0, active_users: (u.data||[]).filter(x=>x.status==='active').length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// USERS
app.get('/api/users', auth, adminOnly, async (req, res) => {
  try {
    let q = supabase.from('users').select('id,name,phone,role,status,request_status,expire_date,note,inst_id').order('created_at', { ascending: false });
    if (req.query.inst_id) q=q.eq('inst_id',req.query.inst_id);
    else if (req.user.role !== 'super_admin') q=q.eq('inst_id',req.user.inst_id);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users', auth, adminOnly, async (req, res) => {
  try {
    const { name, phone, pw, role, expire_date, note } = req.body;
    if (!name || !phone || !pw) return res.status(400).json({ error: 'الاسم والهاتف وكلمة المرور مطلوبة' });
    const { data, error } = await supabase.from('users').insert({ name, phone, pw_hash: crypto.createHash('sha256').update(pw).digest('hex'), pw_plain: encryptPw(pw), role: role||'user', status: 'active', inst_id: req.user.role==='super_admin'?req.body.inst_id:req.user.inst_id, expire_date, note, created_at: new Date().toISOString() }).select().single();
    if (error) throw error;
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/users/:id', auth, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = {};
    ['name','phone','role','status','request_status','expire_date','note'].forEach(k => { if (req.body[k]!==undefined) updates[k]=req.body[k]; });
    if (req.body.pw) { updates.pw_hash=crypto.createHash('sha256').update(req.body.pw).digest('hex'); updates.pw_plain=encryptPw(req.body.pw); }
    const { data, error } = await supabase.from('users').update(updates).eq('id', id).select().single();
    if (error) throw error;
    if (updates.request_status === 'approved') broadcastToUser(id, { type: 'request_approved' });
    else if (updates.request_status === 'rejected') broadcastToUser(id, { type: 'request_rejected' });
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/users/:id', auth, adminOnly, async (req, res) => {
  try { await supabase.from('users').delete().eq('id', req.params.id); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/:id/pw', auth, async (req, res) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'غير مسموح' });
  try {
    const { data } = await supabase.from('users').select('pw_plain,name').eq('id', req.params.id).single();
    let pw = null;
    if (data?.pw_plain) try { pw = decryptPw(data.pw_plain); } catch {}
    res.json({ pw, name: data?.name, has_plain: !!data?.pw_plain });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/:id/door-logs', auth, adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase.from('door_logs').select('id,value,created_at,door_id,doors(name)').eq('user_id', req.params.id).order('created_at',{ascending:false}).limit(50);
    if (error) throw error;
    res.json((data||[]).map(l=>({ id:l.id, value:l.value, created_at:l.created_at, door_id:l.door_id, door_name:l.doors?.name||'—' })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/:id/logs', auth, adminOnly, async (req, res) => {
  try {
    const { data } = await supabase.from('door_logs').select('id,value,created_at,door_id').eq('user_id', req.params.id).order('created_at',{ascending:false}).limit(50);
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/:id/sessions', auth, async (req, res) => {
  try {
    const { data } = await supabase.from('user_sessions').select('*').eq('user_id', req.params.id).order('login_at',{ascending:false}).limit(20);
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/:id/locations', auth, async (req, res) => {
  if (!['super_admin','admin'].includes(req.user.role)) return res.status(403).json({ error: 'غير مسموح' });
  try {
    const since = new Date(Date.now()-(parseInt(req.query.days)||30)*24*60*60*1000).toISOString();
    const { data } = await supabase.from('user_locations').select('lat,lng,accuracy,created_at').eq('user_id', req.params.id).gte('created_at', since).order('created_at',{ascending:false}).limit(500);
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users/:id/request-location', auth, async (req, res) => {
  if (!['super_admin','admin'].includes(req.user.role)) return res.status(403).json({ error: 'غير مسموح' });
  try {
    const ws = wsClients.get(req.params.id);
    if (ws?.readyState===1) { ws.send(JSON.stringify({ type:'location_request', from:req.user.name, requestId:Date.now().toString() })); res.json({ success:true, method:'websocket' }); }
    else {
      const { data } = await supabase.from('users').select('last_location,last_seen,name').eq('id', req.params.id).single();
      res.json({ success:false, offline:true, last_location:data?.last_location, last_seen:data?.last_seen, name:data?.name });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// INSTITUTES
app.get('/api/institutes', auth, async (req, res) => {
  try {
    let q = supabase.from('institutes').select('*').order('created_at', { ascending: false });
    if (req.user.role !== 'super_admin') q = q.eq('id', req.user.inst_id);
    const { data, error } = await q;
    if (error) throw error;
    const enriched = await Promise.all((data||[]).map(async inst => {
      const [{ data: doors }, { count: uc }] = await Promise.all([
        supabase.from('doors').select('*').eq('inst_id', inst.id),
        supabase.from('users').select('id',{count:'exact'}).eq('inst_id', inst.id),
      ]);
      const { data: ad } = await supabase.from('users').select('phone').eq('inst_id',inst.id).eq('role','admin').limit(1).maybeSingle();
      return { ...inst, doors:doors||[], users_count:uc||0, admin_phone:ad?.phone };
    }));
    res.json(enriched);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/institutes', auth, superAdminOnly, async (req, res) => {
  try {
    const { name, code, admin_phone, admin_pw } = req.body;
    if (!name || !code) return res.status(400).json({ error: 'الاسم والكود مطلوبان' });
    const { data: inst, error } = await supabase.from('institutes').insert({ name, code, created_at: new Date().toISOString() }).select().single();
    if (error) throw error;
    if (admin_phone && admin_pw) await supabase.from('users').insert({ inst_id:inst.id, name:'مسؤول '+name, phone:admin_phone, pw_hash:crypto.createHash('sha256').update(admin_pw).digest('hex'), pw_plain:encryptPw(admin_pw), role:'admin', status:'active', created_at:new Date().toISOString() });
    res.json(inst);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/institutes/:id', auth, adminOnly, async (req, res) => {
  try {
    const updates = {};
    ['schedule','gps','name','code'].forEach(k => { if (req.body[k]!==undefined) updates[k]=req.body[k]; });
    const { data, error } = await supabase.from('institutes').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    if (req.body.admin_phone || req.body.admin_pw) {
      const { data: ea } = await supabase.from('users').select('id').eq('inst_id',req.params.id).eq('role','admin').maybeSingle();
      if (ea) {
        const au = {};
        if (req.body.admin_phone) au.phone=req.body.admin_phone;
        if (req.body.admin_pw) { au.pw_hash=crypto.createHash('sha256').update(req.body.admin_pw).digest('hex'); au.pw_plain=encryptPw(req.body.admin_pw); }
        await supabase.from('users').update(au).eq('id', ea.id);
      } else if (req.body.admin_phone && req.body.admin_pw) {
        await supabase.from('users').insert({ inst_id:req.params.id, name:'مسؤول '+(req.body.name||data.name), phone:req.body.admin_phone, pw_hash:crypto.createHash('sha256').update(req.body.admin_pw).digest('hex'), pw_plain:encryptPw(req.body.admin_pw), role:'admin', status:'active', created_at:new Date().toISOString() });
      }
    }
    const { data: ad } = await supabase.from('users').select('phone').eq('inst_id',req.params.id).eq('role','admin').maybeSingle();
    res.json({ ...data, admin_phone: ad?.phone });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/institutes/:id', auth, superAdminOnly, async (req, res) => {
  try { await supabase.from('institutes').delete().eq('id', req.params.id); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/institutes/:id/users', auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('users').select('id,name,phone,role,request_status,last_location,last_seen,created_at').eq('inst_id',req.params.id).neq('role','super_admin').order('created_at',{ascending:false});
    if (error) throw error;
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DOORS
app.get('/api/doors', auth, async (req, res) => {
  try {
    let q = supabase.from('doors').select('*').order('created_at');
    if (req.user.role !== 'super_admin') q=q.eq('inst_id', req.user.inst_id);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/doors', auth, adminOnly, async (req, res) => {
  try {
    const { inst_id, name, location, device_id, duration_seconds } = req.body;
    const cleanDeviceId = device_id?.replace(/[\r\n\t]/g,'').trim();
    const { data, error } = await supabase.from('doors').insert({ inst_id:inst_id||req.user.inst_id, name, location, device_id:cleanDeviceId, duration_seconds:duration_seconds||5, created_at:new Date().toISOString() }).select().single();
    if (error) throw error;
    await loadDoorCache();
    // الاشتراك في الـ topic الجديد
    if (mqttClient?.connected && cleanDeviceId) subscribeToDevice(mqttClient, cleanDeviceId);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/doors/:id', auth, adminOnly, async (req, res) => {
  try {
    const updates = {};
    ['name','location','device_id','duration_seconds','is_active','gps','schedule','rc_notify','manual_notify','door_type','auto_schedule'].forEach(k => { if (req.body[k]!==undefined) updates[k]=req.body[k]; });
    if (updates.device_id) updates.device_id = updates.device_id.replace(/[\r\n\t]/g,'').trim();
    const { data, error } = await supabase.from('doors').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    await loadDoorCache();
    // إرسال PulseTime إذا تغيّرت المدة
    if (updates.duration_seconds && data.device_id && mqttClient?.connected) {
      const pt = Math.round(updates.duration_seconds * 10);
      [1,2,3,4].forEach(ch => mqttClient.publish(`cmnd/${data.device_id}/PulseTime${ch}`, String(pt), { qos: 1 }));
      console.log(`[PulseTime] ${data.device_id} → ${pt} (${updates.duration_seconds}s)`);
    }
    // اشتراك في topic جديد إذا تغيّر device_id
    if (updates.device_id && mqttClient?.connected) subscribeToDevice(mqttClient, updates.device_id);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/doors/:id', auth, adminOnly, async (req, res) => {
  try { await supabase.from('doors').delete().eq('id', req.params.id); await loadDoorCache(); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/doors/:id/logs', auth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('door_logs').select('*').eq('door_id', req.params.id).order('created_at',{ascending:false}).limit(100);
    if (error) throw error;
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/doors/:id/auto-schedule', auth, adminOnly, async (req, res) => {
  try {
    await supabase.from('doors').update({ auto_schedule: req.body.schedule }).eq('id', req.params.id);
    await loadDoorCache();
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUSH
app.post('/api/push/subscribe', auth, async (req, res) => {
  try {
    const sub = req.body.subscription || req.body;
    await supabase.from('push_subscriptions').upsert({ user_id:req.user.id, endpoint:sub.endpoint, p256dh:sub.keys?.p256dh, auth:sub.keys?.auth, updated_at:new Date().toISOString() }, { onConflict:'endpoint' });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/push/vapid-key', (req, res) => res.json({ publicKey: VAPID_PUBLIC }));

// ALERTS
app.get('/api/alerts', auth, adminOnly, async (req, res) => {
  try {
    let q = supabase.from('access_alerts').select('*').order('created_at',{ascending:false}).limit(100);
    if (req.user.role !== 'super_admin') q=q.eq('inst_id', req.user.inst_id);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DEVICE STATUS
app.get('/api/device/status/:deviceId', auth, (req, res) => {
  const s = doorStateCache.get(req.params.deviceId) || { r1:false, r2:false, r3:false, r4:false };
  const isOpen  = s.r1 || s.r2;
  const isClose = s.r3 || s.r4;
  res.json({ success: true, online: true, device_id: req.params.deviceId, r1_on: isOpen, r2_on: isClose });
});

// DEVICE FINGERPRINT
app.post('/api/device/fingerprint', auth, async (req, res) => {
  try {
    const fp = { ua:req.body.ua, lang:req.body.lang, tz:req.body.tz, screen:req.body.screen, platform:req.body.platform, ip:req.headers['x-forwarded-for']?.split(',')[0]||req.socket.remoteAddress };
    const { data: ex } = await supabase.from('users').select('device_fp').eq('id', req.user.id).single();
    if (!ex?.device_fp) { await supabase.from('users').update({ device_fp: fp }).eq('id', req.user.id); }
    else {
      const prev = ex.device_fp;
      if (prev.ua !== fp.ua || prev.screen !== fp.screen) {
        await supabase.from('access_alerts').insert({ user_id:req.user.id, inst_id:req.user.inst_id, type:'device_changed', message:`تغيير جهاز: ${prev.screen}→${fp.screen}`, created_at:new Date().toISOString() });
        await supabase.from('users').update({ device_fp: fp }).eq('id', req.user.id);
      }
    }
    res.json({ ok: true });
  } catch { res.json({ ok: false }); }
});

// ACCESS LIST
app.get('/api/doors/:id/access-list', auth, adminOnly, async (req, res) => {
  try { const { data } = await supabase.from('door_access_list').select('*,users(name,phone)').eq('door_id', req.params.id); res.json(data||[]); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/doors/:id/access-list', auth, adminOnly, async (req, res) => {
  try { const { error } = await supabase.from('door_access_list').upsert({ door_id:req.params.id, user_id:req.body.user_id, type:req.body.type }); if (error) return res.status(500).json({ error:error.message }); res.json({ success:true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/doors/:id/access-list/:userId', auth, adminOnly, async (req, res) => {
  try { await supabase.from('door_access_list').delete().eq('door_id',req.params.id).eq('user_id',req.params.userId); res.json({ success:true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// CATCH ALL
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ═══════════════════════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`✅ Server running on port ${PORT}`);
  await loadDoorCache();
  mqttClient = startMQTT();
  console.log(`📡 MQTT: ${MQTT_HOST}:${MQTT_PORT}`);
});
