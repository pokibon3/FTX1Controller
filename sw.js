// Offline app shell. The cache is keyed by APP_VERSION (js/version.js), passed as sw.js?v=...
const VERSION = 'ftx1-' + (new URL(location.href).searchParams.get('v') || 'dev');
const FILES = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest', 'icons/icon.svg',
  'js/app.js', 'js/ftx1.js', 'js/serial.js', 'js/audio.js', 'js/knob.js', 'js/scope.js', 'js/ftxmeter.js', 'js/filterdisp.js', 'js/version.js', 'js/digits.js', 'js/cwdecoder.js', 'js/cwdec/cw-worklet.js', 'js/cwdec/cwcore.wasm',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// network first so edits show up immediately; cache is the offline fallback.
// Own files skip the HTTP cache (GitHub Pages sends max-age=600), or an update could take 10 minutes to appear.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const own = new URL(e.request.url).origin === location.origin;
  e.respondWith(
    (own ? fetch(e.request.url, { cache: 'no-cache' }) : fetch(e.request))
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
