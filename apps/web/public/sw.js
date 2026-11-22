const CACHE_NAME = 'shopcontrol-shell-v18';
const STATIC_CACHE_NAME = 'shopcontrol-static-v18';

const PRECACHE_URLS = [
  '/',
  '/pos',
  '/commerce/stock',
  '/commerce/products',
  '/commerce/cash',
  '/commerce/clients',
  '/commerce/expenses',
  '/commerce/orders',
  '/commerce/purchases',
  '/commerce/transfers',
  '/commerce/documents',
  '/owner',
  '/owner/settings',
  '/owner/shops',
  '/owner/reports',
  '/owner/subscription',
  '/owner/operators',
  '/owner/audit',
  '/owner/agents',
  '/admin',
  '/admin/shops',
  '/admin/merchants',
  '/admin/platform',
  '/admin/security',
  '/messaging',
  '/agent',
  '/agent/profile',
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
        fetch(request)
          .then((networkRes) => {
            if (networkRes.ok) {
              cache.put(request, networkRes.clone());
            }
            return networkRes;
          })
          .catch(() =>
            cache.match(request).then((cached) => cached || new Response('', { status: 404 })),
          ),
      ),
    );
    return;
  }

  // 3. Navigation HTML et composants Next.js (RSC payload)
  const isNavigation =
    request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html');
  const isRsc = url.searchParams.has('_rsc');

  if (isNavigation || isRsc) {
    // Si hors ligne, servir immédiatement depuis le cache sans aucun délai d'attente
    if (!navigator.onLine) {
      event.respondWith(
        caches.match(request, { ignoreSearch: true }).then((cached) => {
          if (cached) return cached;
          return caches.match(url.pathname, { ignoreSearch: true }).then((pathCached) => {
            if (pathCached) return pathCached;
            return caches
              .match('/pos')
              .then((posCached) => posCached || caches.match('/') || new Response('Hors-ligne', { status: 200 }));
          });
        }),
      );
      return;
    }

    event.respondWith(
      new Promise((resolve) => {
        let didTimeout = false;
        const timer = setTimeout(() => {
          didTimeout = true;
          caches.match(request, { ignoreSearch: true }).then((cached) => {
            if (cached) resolve(cached);
          });
        }, 1000);

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
            caches.match(request, { ignoreSearch: true }).then((cached) => {
              if (cached) {
                resolve(cached);
              } else {
                caches.match(url.pathname, { ignoreSearch: true }).then((pathCached) => {
                  resolve(pathCached || caches.match('/pos') || caches.match('/') || new Response('Hors-ligne', { status: 200 }));
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
      .catch(() => caches.match(request, { ignoreSearch: true })),
  );
});
