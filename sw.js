// The deploy workflow (.github/workflows/static.yml) replaces the
// placeholder below with the commit SHA on every push to main, so this
// never needs a manual bump - it's just "did the deployed commit change,"
// which is exactly the question that matters for cache invalidation.
const CACHE_VERSION = '__CACHE_VERSION__';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_VERSION) return caches.delete(cache);
        })
      ))
      .then(() => self.clients.claim())
  );
});

// The playback notification's Skip/Pause actions run here, not in the
// page, since the SW is what owns the notification. Relays the action to
// any open page via postMessage, where executionEngine actually lives -
// this event handler has no access to it directly. Tapping the
// notification body itself (event.action === '') is deliberately a no-op:
// the notification is meant to be usable without ever opening the app.
self.addEventListener('notificationclick', (event) => {
  if (!event.action) return;

  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      clientList.forEach((client) => client.postMessage({ type: 'workout-tts-notification-action', action: event.action }));
    })
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_VERSION).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      });
    })
  );
});