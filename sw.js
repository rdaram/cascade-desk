/* Swing Desk service worker. Shell: cache-first (instant/offline). data.json: network-first, cached copy offline.
   VERSION changes only when the app shell changes, which triggers the in-app "Update available" prompt. */
const VERSION = '3bd9e44402';
const SHELL = 'sd-shell-' + VERSION;
const DATA = 'sd-data';
const ASSETS = ["./", "index.html", "app.css", "app.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-192.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png", "icons/favicon-32.png"];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    await (await caches.open(SHELL)).addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })));
    // also keep a first copy of the ledger so the app opens offline right after install (best effort)
    try { const r = await fetch('data.json', { cache: 'no-store' }); if (r.ok) await (await caches.open(DATA)).put(new URL('data.json', self.registration.scope).href, r); } catch (err) {}
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('sd-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('message', e => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;               // Finnhub etc. go straight to the network
  if (url.pathname.endsWith('/data.json')) {                 // network-first, fall back to the last copy
    e.respondWith((async () => {
      try {
        const res = await fetch(req, { cache: 'no-store' });
        if (res.ok) { const c = await caches.open(DATA); await c.put(new URL('data.json', self.registration.scope).href, res.clone()); }
        return res;
      } catch (err) {
        const hit = await caches.match(new URL('data.json', self.registration.scope).href, { cacheName: DATA });
        if (hit) { const h = new Headers(hit.headers); h.set('X-SD-Offline', '1'); return new Response(await hit.blob(), { status: 200, headers: h }); }
        return new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }
  if (req.mode === 'navigate') {                             // app shell for every navigation
    e.respondWith(caches.match(new URL('./', self.registration.scope).href, { cacheName: SHELL })
      .then(hit => hit || fetch(req)).catch(() => caches.match(new URL('index.html', self.registration.scope).href)));
    return;
  }
  e.respondWith(caches.match(req, { cacheName: SHELL, ignoreSearch: true }).then(hit => hit || fetch(req)));
});
