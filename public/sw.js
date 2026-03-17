const CACHE_NAME = 'porte-v1';
const ASSETS = ['/', '/index.html', '/app.js', '/style.css'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

self.addEventListener('push', (e) => {
  const data = e.data?.json() || {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'porte', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge.png',
      data: data,
      actions: [
        { action: 'open', title: 'فتح' },
        { action: 'close', title: 'إغلاق' }
      ]
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  if (e.action === 'open' || e.action === 'close') {
    // Handle quick actions
    fetch('/api/door/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${e.notification.data.token}` },
      body: JSON.stringify({ action: e.action })
    });
  }
  e.waitUntil(clients.openWindow('/'));
});
