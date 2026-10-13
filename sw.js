// Service Worker: legt die App-Dateien im Zwischenspeicher ab, damit das Drumpad ohne Internet startet.
// Nach Änderungen an der App die Versionsnummer erhöhen, damit der alte Zwischenspeicher verworfen wird.
const CACHE = "drumpad-v1";
const ASSETS = [
  "./", "index.html", "style.css", "app.js", "audio.js", "db.js", "logic.js",
  "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Zuerst der Zwischenspeicher, im Hintergrund wird die neue Fassung geholt und beim nächsten Start verwendet.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = (await cache.match(request, { ignoreSearch: true })) ?? (request.mode === "navigate" ? await cache.match("index.html") : undefined);
      const refresh = fetch(request).then((response) => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      });
      if (cached) {
        refresh.catch(() => {});
        return cached;
      }
      return refresh;
    }),
  );
});
