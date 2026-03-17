# 🚪 PORTE — نظام التحكم الذكي في أبواب المؤسسات

## هيكل المشروع
```
porte/
├── server.js              # Express + WebSocket + Tuya API
├── package.json
├── railway.json           # Railway deployment config
├── supabase_setup.sql     # إعداد قاعدة البيانات
├── .env.example           # متغيرات البيئة
├── .github/
│   └── workflows/
│       └── deploy.yml     # CI/CD
└── public/
    ├── index.html         # واجهة PWA
    ├── app.js             # منطق الواجهة
    ├── sw.js              # Service Worker
    └── manifest.json      # PWA Manifest
```

---

## ⚡ خطوات النشر

### 1. إعداد Supabase
1. اذهب إلى [Supabase SQL Editor](https://supabase.com/dashboard/project/sjfaootvlxesdytdsknc/sql)
2. الصق محتوى `supabase_setup.sql` وشغّله

### 2. رفع الكود على GitHub
```bash
cd porte
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/houijiyassine/porte
git push -u origin main
```

### 3. نشر على Railway
1. اذهب إلى [railway.app](https://railway.app)
2. أنشئ مشروع جديد من GitHub → `houijiyassine/porte`
3. أضف متغيرات البيئة التالية في Railway Dashboard:

| المتغير | القيمة |
|---------|--------|
| `SUPABASE_URL` | `https://sjfaootvlxesdytdsknc.supabase.co` |
| `SUPABASE_SERVICE_KEY` | من Supabase → Settings → API |
| `TUYA_CLIENT_ID` | `59gmr8xdf3m5vdt55c89` |
| `TUYA_SECRET` | من Tuya IoT Platform |
| `TUYA_DEVICE_ID` | `bf7c670914391fc80cwayk` |
| `TUYA_REGION` | `openapi.tuyaeu.com` |
| `VAPID_PUBLIC` | `BOfIw6laarxGfV8Ezc04YzfCzq4Njm7ewizkfnGDIWJGpsfHkqUHVG8SXGb8cJZJxOTIzFeauX4K0Z8oYdfgKTw` |
| `VAPID_PRIVATE` | مفتاحك الخاص |
| `JWT_SECRET` | أي نص عشوائي قوي |

### 4. إعداد Tuya Webhook
في [Tuya IoT Platform](https://iot.tuya.com):
- اذهب إلى Cloud → Development → الـ app → Service API
- أضف Webhook URL: `https://YOUR_RAILWAY_URL/api/webhook/tuya`

---

## 👥 أدوار المستخدمين

| الدور | الصلاحيات |
|-------|-----------|
| `user` | فتح/غلق/إيقاف/فتح40ث |
| `admin` | كل ما سبق + إدارة مستخدمين + جدول + GPS + إحصائيات + سجل |
| `super_admin` | كل ما سبق + إدارة مؤسسات + مواقع المستخدمين |

## 🔐 بيانات الدخول الافتراضية
- **Super Admin**: هاتف `22630506` | كلمة مرور: `admin123`
- **⚠️ غيّر كلمة المرور فور أول تسجيل دخول!**

---

## 🛠 تطوير محلي
```bash
npm install
cp .env.example .env
# عدّل .env بالقيم الحقيقية
npm run dev
```

## 🌐 الـ API Endpoints

| الطريقة | المسار | الوصف |
|---------|--------|-------|
| POST | `/api/auth/login` | تسجيل الدخول |
| POST | `/api/door/control` | التحكم في الباب |
| GET  | `/api/door/status` | حالة الباب |
| GET  | `/api/users` | قائمة المستخدمين |
| POST | `/api/users` | إضافة مستخدم |
| PUT  | `/api/users/:id` | تعديل مستخدم |
| GET  | `/api/history` | سجل العمليات |
| GET  | `/api/stats` | الإحصائيات |
| GET  | `/api/institutes` | المؤسسات |
| POST | `/api/institutes` | إضافة مؤسسة |
| POST | `/api/push/subscribe` | الاشتراك بالإشعارات |
| POST | `/api/webhook/tuya` | Tuya Webhook |

## 🔌 WebSocket Events

| الحدث | الاتجاه | الوصف |
|-------|---------|-------|
| `door_action` | Server → Client | حدث تحكم في الباب |
| `door_state` | Server → Client | تغيير حالة الباب (Tuya) |
| `location_update` | Server → Client | تحديث موقع مستخدم |
| `location` | Client → Server | إرسال موقع GPS |
