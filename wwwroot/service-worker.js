self.addEventListener('install', event => {
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    self.clients.claim();
});
self.addEventListener('fetch', event => {
    // 通常のネットワークリクエストをそのまま通す
    event.respondWith(fetch(event.request));
});