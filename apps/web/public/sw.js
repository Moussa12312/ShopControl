const CACHE_NAME = 'shopcontrol-shell-v10';
const STATIC_CACHE_NAME = 'shopcontrol-static-v10';

const PRECACHE_URLS = [
  '/',
  '/pos',
  '/commerce/stock',
  '/login',
  '/manifest.json',
  '/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== STATIC_CACHE_NAME)
          .map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 1. Ne jamais intercepter ni mettre en cache les requêtes API (sécurité données financières)
  if (url.pathname.startsWith('/api/')) return;

  // 2. Fichiers statiques Next.js et assets (Cache-First avec mise à jour en tâche de fond)
  const isStaticAsset =
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.woff2');

  if (isStaticAsset) {
    event.respondWith(
      caches.open(STATIC_CACHE_NAME).then((cache) =>
        cache.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request)
            .then((networkRes) => {
              if (networkRes.ok) {
                cache.put(request, networkRes.clone());
              }
              return networkRes;
            })
            .catch(() => cached || new Response('', { status: 404 }));
        }),
      ),
    );
    return;
  }

  // 3. Pages HTML (Network-First avec Timeout 2s -> Fallback Cache instantané en cas de réseau lent/coupé)
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      new Promise((resolve) => {
        let didTimeout = false;
        const timer = setTimeout(() => {
          didTimeout = true;
          caches.match(request).then((cached) => {
            if (cached) resolve(cached);
          });
        }, 2000);

        fetch(request)
          .then((networkRes) => {
            clearTimeout(timer);
            if (networkRes.ok) {
              const copy = networkRes.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            resolve(networkRes);
          })
          .catch(() => {
            clearTimeout(timer);
            caches.match(request).then((cached) => {
              if (cached) {
                resolve(cached);
              } else {
                caches.match('/pos').then((posCached) => {
                  resolve(posCached || caches.match('/') || new Response('Hors-ligne', { status: 503 }));
                });
              }
            });
          });
      }),
    );
    return;
  }

  // 4. Par défaut : Réseau avec fallback sur le cache
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      })
      .catch(() => caches.match(request)),
  );
});
