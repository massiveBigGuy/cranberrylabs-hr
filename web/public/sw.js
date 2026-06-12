// Service worker for Web Push notifications.
// Registered from web/src/lib/push.ts at /sw.js (served from web/public/).

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'cranberrylabs HR', {
      body: data.body ?? 'Application generation complete.',
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: 'queue-drained',       // collapse duplicate notifications
      renotify: false,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes('/applications') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow('/applications');
    })
  );
});
