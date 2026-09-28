// Service worker: lets Knox install to the home screen and open offline.
// Network-first for everything it serves, falling back to the last cached
// copy, so a new deploy shows up on the next launch rather than being
// pinned behind a stale cache. Calls to Anthropic and GitHub are never cached.

const CACHE = 'knox-v2';
// The SDK must be in here: on the very first visit the page imports it
// before this worker is in control, so it would otherwise never get cached
// and an offline launch would have no way to talk to Claude at all.
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm';
const SHELL = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // A CDN hiccup shouldn't stop the worker installing; the SDK also
      // gets cached the next time the page loads it.
      .then((cache) => cache.addAll(SHELL).then(() => cache.add(SDK_URL).catch(() => {})))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const cacheable = url.origin === self.location.origin || url.hostname === 'cdn.jsdelivr.net';
  if (!cacheable) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      // Only a page navigation may fall back to the cached app page; handing
      // HTML back for a script or image request would break it confusingly.
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./') : Response.error())))
  );
});
