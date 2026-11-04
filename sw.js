// Service worker tối giản để FOHU cài được như ứng dụng. Không lưu đệm gì: mọi yêu cầu đi thẳng ra mạng.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => { if (e.request.mode === 'navigate') e.respondWith(fetch(e.request)); });
