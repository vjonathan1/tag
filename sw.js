// TAG//OPS service worker: makes the app installable and lets the app shell open offline.
// Strategy is NETWORK-FIRST: when online you always get the latest files from GitHub Pages;
// the cache is only used when the network fails. Live game data (Firebase), map tiles, and
// fonts are never touched here.
const CACHE = "tagops-shell-2"; // change the name when SHELL changes so the old cache is replaced
const SHELL = [
  "./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/apple-touch-icon.png",
  "css/styles.css", "js/app.js", "js/config.js", "js/backend-firebase.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Only handle this site's own files. Skip the one-time setup page entirely.
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.endsWith("setup.html")) return;

  e.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: "no-cache" }); // revalidate with the server every time
      if (res.ok) { const c = await caches.open(CACHE); c.put(req, res.clone()); }
      return res;
    } catch {
      // ignoreSearch: offline, "app.js?v=7" can fall back to whatever copy of app.js we have.
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      if (req.mode === "navigate") return caches.match("index.html");
      throw new Error("offline");
    }
  })());
});
