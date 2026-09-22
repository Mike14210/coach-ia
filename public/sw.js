// Service worker Coach IA — coquille hors-ligne. Bump la version pour invalider.
const CACHE = "coach-ia-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch { return; }

  // API : jamais de cache, toujours le réseau (données fraîches).
  if (url.hostname === "api.iacoachsportif.eu") return;
  // Ressources externes (polices, YouTube…) : on ne touche pas.
  if (url.origin !== self.location.origin) return;

  // Navigation (index.html) : réseau d'abord (voir les déploiements tout de suite),
  // repli sur le cache si hors-ligne.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => { const c = res.clone(); caches.open(CACHE).then((cache) => cache.put(req, c)); return res; })
        .catch(() => caches.match(req).then((r) => r || caches.match("/index.html")))
    );
    return;
  }

  // Assets même origine : cache d'abord, mise à jour en arrière-plan.
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const net = fetch(req)
        .then((res) => { if (res && res.status === 200) cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      return cached || net;
    })
  );
});
