const CACHE_NAME = "wrrk-v2";
const FONT_HOSTS = new Set(["use.typekit.net", "p.typekit.net"]);
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/favicon.ico",
  "/favicon-96x96.png",
  "/apple-touch-icon.png",
  "/web-app-manifest-192x192.png",
  "/web-app-manifest-512x512.png",
];

/**
 * @param {URL} url
 */
function shouldHandle(url) {
  if (url.origin === self.location.origin) return true;
  return FONT_HOSTS.has(url.hostname);
}

/**
 * @param {Cache} cache
 * @param {string} path
 */
async function precachePageAssets(cache, path) {
  const response = await fetch(path);
  if (!response.ok) return;
  await cache.put(path, response.clone());
  const html = await response.text();
  const assets = [...html.matchAll(/(?:src|href)="(\/_astro\/[^"]+)"/g)].map((match) => match[1]);
  await Promise.all(assets.map((asset) => cache.add(asset).catch(() => undefined)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined)));
      await precachePageAssets(cache, "/");
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!shouldHandle(url)) return;

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        if (response.ok || response.type === "opaque") {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          const shell = (await caches.match("/")) || (await caches.match("/index.html"));
          if (shell) return shell;
        }
        throw error;
      }
    })(),
  );
});
