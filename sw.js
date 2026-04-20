/**
 * Marker — Service Worker
 * Cache-first strategy for offline support (Rule R3.1)
 */

const CACHE_NAME = 'marker-v6';

const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './css/variables.css',
    './css/base.css',
    './css/components.css',
    './css/views.css',
    './css/animations.css',
    './js/app.js',
    './js/db.js',
    './js/modules/i18n.js',
    './js/modules/project-manager.js',
    './js/modules/sheet-designer.js',
    './js/modules/sheet-renderer.js',
    './js/modules/answer-key.js',
    './js/modules/scanner.js',
    './js/modules/omr-engine.js',
    './js/modules/results.js',
    './js/modules/excel-export.js',
    './js/utils/constants.js',
    './js/utils/ui-helpers.js',
    './js/utils/math-utils.js',
    './js/utils/image-utils.js',
    './js/utils/extensibility.js',
];

// External resources to cache
const EXTERNAL_ASSETS = [
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
];

// ── Install: Cache all assets ──
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Caching app assets...');
                // Cache local assets (ignore failures for non-existent files during development)
                const localPromises = ASSETS_TO_CACHE.map(url =>
                    cache.add(url).catch(err => {
                        console.warn(`[SW] Failed to cache: ${url}`, err.message);
                    })
                );
                // Cache external assets
                const externalPromises = EXTERNAL_ASSETS.map(url =>
                    cache.add(url).catch(err => {
                        console.warn(`[SW] Failed to cache external: ${url}`, err.message);
                    })
                );
                return Promise.all([...localPromises, ...externalPromises]);
            })
            .then(() => self.skipWaiting())
    );
});

// ── Activate: Clean up old caches ──
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames
                        .filter(name => name !== CACHE_NAME)
                        .map(name => {
                            console.log(`[SW] Deleting old cache: ${name}`);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => self.clients.claim())
    );
});

// ── Fetch: Cache-first, then network ──
self.addEventListener('fetch', (event) => {
    const { request } = event;

    // Skip non-GET requests
    if (request.method !== 'GET') return;

    // Skip chrome-extension and other non-http schemes
    if (!request.url.startsWith('http')) return;

    event.respondWith(
        caches.match(request)
            .then(cachedResponse => {
                if (cachedResponse) {
                    // Return cached version, but also update cache in background
                    event.waitUntil(
                        fetch(request)
                            .then(networkResponse => {
                                if (networkResponse && networkResponse.status === 200) {
                                    const responseClone = networkResponse.clone();
                                    caches.open(CACHE_NAME).then(cache => {
                                        cache.put(request, responseClone);
                                    });
                                }
                            })
                            .catch(() => { /* Offline, ignore */ })
                    );
                    return cachedResponse;
                }

                // Not in cache: try network, then cache the response
                return fetch(request)
                    .then(networkResponse => {
                        if (networkResponse && networkResponse.status === 200) {
                            const responseClone = networkResponse.clone();
                            caches.open(CACHE_NAME).then(cache => {
                                cache.put(request, responseClone);
                            });
                        }
                        return networkResponse;
                    })
                    .catch(() => {
                        // Offline fallback for navigation requests
                        if (request.mode === 'navigate') {
                            return caches.match('./index.html');
                        }
                        return new Response('Offline', { status: 503 });
                    });
            })
    );
});

// ── Message handler for cache updates ──
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
