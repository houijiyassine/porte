// Service Worker — Push Notifications
self.addEventListener('push', function(event) {
  if (!event.data) return;
  
  let data;
  try { data = event.data.json(); }
  catch(e) { data = { title: '🔔 إشعار جديد', body: event.data.text() }; }

  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    dir: 'rtl',
    lang: 'ar',
    tag: data.tag || 'default',
    renotify: true,
    data: { url: data.url || '/' }
  };

  event.waitUntil(
    self.registration.showNotification(data.title || '🔔 إشعار', options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client)
          return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(event.notification.data?.url || '/');
    })
  );
});

self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
