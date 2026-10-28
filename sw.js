// 讓網站可以「加入主畫面」當成 App 使用；斷網時用最後一次開過的版本。
// 一律先取網路（拿到最新版與最新資料），失敗才用快取。拼接大螢幕（wall/）有自己的 sw.js。
const CACHE = 'etf-v1';
const FILES = ['./', 'index.html', 'returns.html', 'watchlist.html', 'watchlist.js', 'app.js', 'stocks.csv',
  'proxy.txt', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // 只處理本站檔案；Yahoo 資料代理等外部請求不經過快取
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, {ignoreSearch: true}))
  );
});
