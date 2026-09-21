const CACHE_NAME = "wrrk-v8";
const FONT_HOSTS = new Set(["use.typekit.net", "p.typekit.net"]);
const PRECACHE = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/favicon.ico",
  "/favicon-96x96.png",
  "/apple-touch-icon.png",
  "/web-app-manifest-192x192.png",
  "/web-app-manifest-512x512.png",
];

/** Character stills + Lottie JSON — online-only; never store in the SW cache. */
const INTRO_MEDIA = /^\/wrrk-(jumprope|run|stretch|weights)\.(json|svg)$/;

/**
 * @param {string} pathname
 */
function isIntroPath(pathname) {
  return (
    INTRO_MEDIA.test(pathname) ||
    pathname === "/wrrk-logotype.svg" ||
    (pathname.startsWith("/_astro/") && /lottie/i.test(pathname))
  );
}

/**
 * @param {URL} url
 */
function isIntroAsset(url) {
  return url.origin === self.location.origin && isIntroPath(url.pathname);
}

/**
 * @param {URL} url
 */
function shouldHandle(url) {
  if (url.origin === self.location.origin) return true;
  return FONT_HOSTS.has(url.hostname);
}

/**
 * @param {Cache} cache
 * @param {RequestInfo} request
 * @param {Response} response
 */
async function cachePut(cache, request, response) {
  try {
    await cache.put(request, response);
  } catch {
    // Quota exceeded / unsupported entries must never fail the response path.
  }
}

/**
 * @param {Request} request
 */
async function matchCached(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  if (request.mode === "navigate") {
    return (
      (await caches.match("/", { ignoreSearch: true })) ||
      (await caches.match("/index.html", { ignoreSearch: true }))
    );
  }
  return undefined;
}

/**
 * Collect same-origin /_astro module URLs referenced by a JS bundle.
 * @param {string} source
 * @param {string} basePath
 */
function findModuleUrls(source, basePath) {
  /** @type {string[]} */
  const urls = [];
  const base = new URL(basePath, self.location.origin);

  for (const match of source.matchAll(/from\s*["'](\.?\.?\/[^"']+)["']/g)) {
    urls.push(new URL(match[1], base).pathname);
  }
  for (const match of source.matchAll(/["'`](\/_astro\/[^"'`]+)["'`]/g)) {
    urls.push(match[1]);
  }

  return urls;
}

/**
 * Precache HTML shell, linked assets, and the JS module graph.
 * @param {Cache} cache
 * @param {string} path
 */
async function precachePageAssets(cache, path) {
  const response = await fetch(path);
  if (!response.ok) return;

  await cachePut(cache, path, response.clone());
  if (path === "/index.html") await cachePut(cache, "/", response.clone());
  if (path === "/") await cachePut(cache, "/index.html", response.clone());

  const html = await response.text();
  const linked = [...html.matchAll(/(?:src|href)="(\/_astro\/[^"]+)"/g)].map((match) => match[1]);
  const queue = [...linked];
  const seen = new Set();

  while (queue.length) {
    const assetPath = queue.pop();
    if (!assetPath || seen.has(assetPath)) continue;
    seen.add(assetPath);

    // Intro-only media (incl. Lottie chunk) stays online-only.
    if (isIntroPath(assetPath)) continue;

    try {
      const assetResponse = await fetch(assetPath);
      if (!assetResponse.ok) continue;
      await cachePut(cache, assetPath, assetResponse.clone());

      const contentType = assetResponse.headers.get("content-type") || "";
      if (!assetPath.endsWith(".js") && !contentType.includes("javascript")) continue;

      const source = await assetResponse.text();
      queue.push(...findModuleUrls(source, assetPath));
    } catch {
      // Keep install resilient if an individual asset fails.
    }
  }
}

/**
 * @param {Request} request
 */
async function revalidate(request) {
  try {
    const response = await fetch(request);
    if (!response.ok || response.type === "opaque") return;
    const url = new URL(request.url);
    if (isIntroAsset(url)) return;
    const cache = await caches.open(CACHE_NAME);
    await cachePut(cache, request, response.clone());
    if (request.mode === "navigate") {
      await cachePut(cache, "/", response.clone());
      await cachePut(cache, "/index.html", response.clone());
    }
  } catch {
    // Ignore background refresh failures.
  }
}

/**
 * @param {Request} request
 * @param {{ updateShell?: boolean }} [options]
 */
async function fetchAndCache(request, { updateShell = false } = {}) {
  const response = await fetch(request);
  const url = new URL(request.url);
  if (response.ok && response.type !== "opaque" && !isIntroAsset(url)) {
    const cache = await caches.open(CACHE_NAME);
    await cachePut(cache, request, response.clone());
    if (updateShell) {
      await cachePut(cache, "/", response.clone());
      await cachePut(cache, "/index.html", response.clone());
    }
  }
  return response;
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

  // Intro media is online-only — never read or write the SW cache for it.
  if (isIntroAsset(url)) {
    event.respondWith(fetch(request));
    return;
  }

  const isNavigate = request.mode === "navigate";
  const isImmutableAsset = url.origin === self.location.origin && url.pathname.startsWith("/_astro/");

  event.respondWith(
    (async () => {
      // Navigations + hashed assets: cache-first so iOS cold starts work offline.
      if (isNavigate || isImmutableAsset) {
        const cached = await matchCached(request);
        if (cached) {
          if (isNavigate) event.waitUntil(revalidate(request));
          return cached;
        }

        try {
          return await fetchAndCache(request, { updateShell: isNavigate });
        } catch (error) {
          const fallback = await matchCached(request);
          if (fallback) return fallback;
          throw error;
        }
      }

      // Everything else (icons, fonts, manifest): network-first with cache fallback.
      const cached = await matchCached(request);
      try {
        return await fetchAndCache(request);
      } catch (error) {
        if (cached) return cached;
        throw error;
      }
    })(),
  );
});
