/* ══════════════════════════════════════════════════════
   Cabinet de Psychothérapie — Service Worker
   Rôle : rendre l'application disponible hors connexion.
   ► Ne met en cache QUE les fichiers de l'application (code, polices, icônes).
   ► Aucune donnée patient n'y transite : elles restent dans IndexedDB.
   ► Les requêtes vers d'autres domaines (Google Drive / Agenda) ne sont jamais interceptées.

   ⚠ À CHAQUE DÉPLOIEMENT : incrémenter CACHE_VERSION, sinon les
     utilisateurs continuent à recevoir l'ancienne version en cache.
   ══════════════════════════════════════════════════════ */

'use strict';

const CACHE_VERSION = '2026.10.02-1';
const CACHE_NAME    = 'cabinet-psy-' + CACHE_VERSION;
const CACHE_PREFIX  = 'cabinet-psy-';

const PRECACHE = [
  './',
  'index.html',
  'style.css',
  'manifest.webmanifest',
  'fonts/fonts.css',
  'fonts/cormorant-garamond-latin-300-italic.woff2',
  'fonts/cormorant-garamond-latin-300-normal.woff2',
  'fonts/cormorant-garamond-latin-400-italic.woff2',
  'fonts/cormorant-garamond-latin-400-normal.woff2',
  'fonts/cormorant-garamond-latin-500-normal.woff2',
  'fonts/cormorant-garamond-latin-ext-300-italic.woff2',
  'fonts/cormorant-garamond-latin-ext-300-normal.woff2',
  'fonts/cormorant-garamond-latin-ext-400-italic.woff2',
  'fonts/cormorant-garamond-latin-ext-400-normal.woff2',
  'fonts/cormorant-garamond-latin-ext-500-normal.woff2',
  'fonts/dm-sans-latin-300-normal.woff2',
  'fonts/dm-sans-latin-400-normal.woff2',
  'fonts/dm-sans-latin-500-normal.woff2',
  'fonts/dm-sans-latin-ext-300-normal.woff2',
  'fonts/dm-sans-latin-ext-400-normal.woff2',
  'fonts/dm-sans-latin-ext-500-normal.woff2',
  'js/data.js',
  'js/utils.js',
  'js/security.js',
  'js/google.js',
  'js/invoices.js',
  'js/backup.js',
  'js/pwa.js',
  'js/ui/navigation.js',
  'js/ui/settings.js',
  'js/ui/patients.js',
  'js/ui/sessions.js',
  'js/ui/dashboard.js',
  'js/main.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png'
];

// ── Installation : pré-chargement de tout le « shell » ──
// `cache: 'reload'` contourne le cache HTTP pour ne pas figer un fichier périmé.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' }))))
    )
  );
  // Pas de skipWaiting() automatique : la mise à jour est appliquée quand
  // l'utilisateur l'accepte (message SKIP_WAITING), pour ne pas recharger
  // l'application en pleine saisie ni verrouiller le coffre chiffré.
});

// ── Activation : suppression des anciennes versions ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Requêtes : cache d'abord, réseau en secours ──
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // Google & co : jamais interceptés
  if (url.pathname.endsWith('/clear-cache.html')) return;    // page de dépannage : toujours réseau

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Navigation (ouverture de l'app, retour OAuth…) → index.html
    if (req.mode === 'navigate') {
      const shell = await cache.match('index.html', { ignoreSearch: true });
      if (shell) return shell;
      return fetch(req);
    }

    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    return fetch(req);
  })());
});

// ── Messages depuis la page ──
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (data.type === 'GET_VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: CACHE_VERSION });
  }
});
