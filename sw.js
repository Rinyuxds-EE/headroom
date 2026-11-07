// Headroom Service Worker：把所有檔案存在手機裡，沒有網路也能開（SPEC 第 1 節「離線」）
//
// ⚠️ 每次修改任何檔案、要重新上傳之前，都要把下面的 CACHE_VERSION 數字加 1。
//    手機只會在這個檔案有變的時候才下載新版本；沒改版本號，手機會一直用舊的檔案。

const CACHE_VERSION = 'headroom-v2';

// 要存在手機裡的檔案（測試頁不需要）。新增檔案時記得加進來
const FILES = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/app.js',
  './js/calc.js',
  './js/storage.js',
  './js/donut.js',
  './js/trend.js',
  './js/ui/backup.js',
  './js/ui/balance.js',
  './js/ui/dom.js',
  './js/ui/entries.js',
  './js/ui/entry-panel.js',
  './js/ui/home.js',
  './js/ui/month-switch.js',
  './js/ui/settings.js',
];

// 安裝：一次把所有檔案下載存好（cache: 'reload' 確保拿到伺服器上最新的，不是瀏覽器暫存）
// 全部成功才算安裝完成，所以不會出現「新舊檔案混在一起」的情況
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(FILES.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

// 啟用：刪掉舊版本的快取
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith('headroom-') && key !== CACHE_VERSION)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// 讀取檔案：先用手機裡存的，沒有才上網抓
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // 打開 App（頁面導覽）：一律用存好的 index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => cached || fetch(request)),
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => cached || fetch(request)),
  );
});
