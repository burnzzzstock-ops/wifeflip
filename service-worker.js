// Offline-first service worker. Caches the app shell so Flipping Friend opens
// instantly and works with no signal (your data lives in IndexedDB, not here).

const CACHE = "flipping-friend-v9";
const ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/app.js",
  "./js/db.js",
  "./js/util.js",
  "./js/barcode.js",
  "./js/api.js",
  "./js/sync.js",
  "./js/icons.js",
  "./js/zxing.min.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  // Never cache backend API calls — they must hit the network for live prices.
  if (new URL(request.url).pathname.startsWith("/api/")) return;

  // Network-first for navigations (so updates show up), cache fallback offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Cache-first for same-origin assets.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((resp) => {
        if (resp.ok && new URL(request.url).origin === location.origin) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return resp;
      }).catch(() => cached);
    })
  );
});
