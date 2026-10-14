const CACHE_PREFIX = 'auto-haus-assets-';
const CACHE_NAME = `${CACHE_PREFIX}v28`;
const CACHEABLE = /\.(?:css|js|png|jpe?g|webp|hdr|woff2?)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin || !CACHEABLE.test(new URL(request.url).pathname)) return;

  event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
    const cached = await cache.match(request);
    const source = /\.(?:js|css)$/i.test(new URL(request.url).pathname);
    if (cached && !source) return cached;
    try {
      const response = await fetch(request, { cache: 'no-cache' });
      if (response.ok && response.type !== 'opaque') await cache.put(request, response.clone());
      return response;
    } catch (error) {
      if (cached) return cached;
      throw error;
    }
  }));
});
