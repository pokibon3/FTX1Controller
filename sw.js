// Offline app shell. The cache is keyed by APP_VERSION (js/version.js), passed as sw.js?v=...
const VERSION = 'ftx1-' + (new URL(location.href).searchParams.get('v') || 'dev');
const FILES = [
  './', 'index.html', 'manual.html', 'css/style.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/ftx1.js', 'js/serial.js', 'js/audio.js', 'js/knob.js', 'js/scope.js', 'js/ftxmeter.js', 'js/filterdisp.js', 'js/version.js', 'js/digits.js', 'js/exmenu.js', 'js/exdefaults.js', 'js/model.js', 'js/ft991a.js', 'js/meter991.js', 'js/exmenu991.js', 'js/exdefaults991.js', 'js/ft8.js', 'js/ft8/ft8-worker.js', 'js/ft8/ft8-worklet.js', 'js/ft8/ft8core.wasm', 'js/cwdecoder.js', 'js/cwview.js', 'js/cwsend.js', 'js/cwdec/cw-worklet.js', 'js/cwdec/cwcore.wasm',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// network first so edits show up immediately; cache is the offline fallback.
// Own files bypass both the browser cache and the CDN (GitHub Pages / Fastly keep files for 10 minutes even on a
// revalidating request): a unique query makes every fetch come from the origin. The cache keeps the plain URL.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const own = url.origin === location.origin;
  if (own) url.searchParams.set('_', Date.now());
  e.respondWith(
    (own ? fetch(url, { cache: 'no-store' }) : fetch(e.request))
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
