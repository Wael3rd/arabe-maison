// Service worker : l'appli marche hors ligne ; content.json est toujours rafraîchi quand le réseau est là.
const VERSION = 'arabe-v2';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/engine.js', 'js/parent.js', 'js/store.js', 'js/tts.js', 'js/util.js',
  'content.json', 'icons/icon-192.png', 'icons/icon-512.png',
  'fonts/noto-naskh-arabic-arabic-400-normal.woff2', 'fonts/noto-naskh-arabic-arabic-700-normal.woff2',
  'fonts/nunito-latin-400-normal.woff2', 'fonts/nunito-latin-700-normal.woff2',
  'fonts/nunito-latin-800-normal.woff2', 'fonts/nunito-latin-900-normal.woff2',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Contenu et code : réseau d'abord (mises à jour immédiates), cache si hors ligne.
  if (/content\.json$|\.js$|\.css$|\.html$|\/$/.test(url.pathname)) {
    e.respondWith(fetch(e.request).then(r => {
      const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
    return;
  }
  // Polices, icônes : cache d'abord.
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
    const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return res;
  })));
});
