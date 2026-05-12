// ══ SERATTA CREW — Service Worker ══
// Permite funcionamiento offline básico y notificaciones push

const CACHE_NAME = 'seratta-crew-v1';
const OFFLINE_URLS = [
  '/',
  '/crew',
  '/index.html',
];

// Instalar — cachear recursos base
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_URLS))
  );
  self.skipWaiting();
});

// Activar — limpiar caches viejos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network first, cache fallback
self.addEventListener('fetch', (event) => {
  // No interceptar requests de Supabase ni API
  if (event.request.url.includes('supabase.co') ||
      event.request.url.includes('anthropic.com')) {
    return;
  }
  event.respondWith(
    fetch(event.request)
      .catch(() => caches.match(event.request))
  );
});

// Push notifications — recibir alertas del servidor
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  const options = {
    body: data.body || 'Tienes una notificación de Seratta',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    vibrate: [200, 100, 200],
    data: { url: data.url || '/crew' },
    actions: [
      { action: 'ver', title: 'Ver ahora' },
      { action: 'cerrar', title: 'Cerrar' }
    ]
  };
  event.waitUntil(
    self.registration.showNotification(data.title || '🍽️ Seratta Crew', options)
  );
});

// Click en notificación — abrir la app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'ver' || !event.action) {
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then((clientList) => {
        const url = event.notification.data?.url || '/crew';
        for (const client of clientList) {
          if (client.url.includes('/crew') && 'focus' in client) {
            return client.focus();
          }
        }
        return clients.openWindow(url);
      })
    );
  }
});
