// service-worker.js
const CACHE_NAME = 'weld-query-v5';
const ASSETS = [
  './index.html',
  './data.js',
  './schedule.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// 安装时缓存核心文件
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(ASSETS).catch(function(err) {
        console.log('缓存部分文件失败:', err);
      });
    })
  );
  self.skipWaiting();
});

// 激活时清理旧缓存
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) { return key !== CACHE_NAME; })
            .map(function(key) { return caches.delete(key); })
      );
    })
  );
  self.clients.claim();
});

// 拦截请求，优先使用缓存（离线可用）
self.addEventListener('fetch', function(event) {
  // 仅处理 GET 请求
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(function(response) {
      return response || fetch(event.request).catch(function() {
        return caches.match('./index.html');
      });
    })
  );
});

// 收到前端「立即生效」指令时跳过等待，激活新版本
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
