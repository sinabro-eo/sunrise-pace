// 산에서 신호가 끊겨도 열리도록 파일을 저장해 둔다. 신호가 있으면 항상 최신 파일을 먼저 받는다.
const CACHE = 'sunrise-pace-v1';
const FILES = ['./', 'index.html', 'style.css', 'manifest.json', 'icons/icon.svg', 'js/app.js', 'js/pace.js', 'js/sun.js', 'js/courses.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
