/* 实习投递管家 · Service Worker
 *
 * 策略：
 *   - 导航请求（打开页面）：网络优先，失败回退缓存的 index.html —— 保证离线也能打开
 *   - 静态资源（图标/manifest）：缓存优先，后台更新
 *   - 只处理 GET，只处理同源请求；其他一律放行，不做任何拦截
 *
 * 升级版本：改动应用后把 VERSION 加一，用户下次打开时后台拉新，并弹提示让 ta 刷新。
 */
const VERSION = 'v3';
const CACHE = 'intern-tracker-' + VERSION;

/* 预缓存：应用外壳。用相对路径，方便挂在 GitHub Pages 之类的子目录下。 */
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-maskable.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      /* 逐个添加：某个图标缺失（比如还没生成 PNG）不至于让整次安装失败 */
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('intern-tracker-') && k !== CACHE).map((k) => caches.delete(k))
      );
      if (self.registration.navigationPreload) {
        try { await self.registration.navigationPreload.disable(); } catch (e) { /* 忽略 */ }
      }
      await self.clients.claim();
      /* 让已打开的页面知道有新版本可用 */
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => c.postMessage({ type: 'SW_UPDATED', version: VERSION }));
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return; // 站外请求（地图、招聘页链接）不插手

  /* 页面导航：网络优先 -> 离线回退到缓存的首页 */
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put('./index.html', fresh.clone()).catch(() => {});
          return fresh;
        } catch (e) {
          const cache = await caches.open(CACHE);
          /* 带上 ?selftest=1 之类的参数时，忽略查询串再匹配，保证离线也能打开 */
          return (
            (await cache.match('./index.html', { ignoreSearch: true })) ||
            (await cache.match('./', { ignoreSearch: true })) ||
            new Response(
              '<!doctype html><meta charset="utf-8"><title>离线</title>' +
                '<body style="font-family:system-ui;padding:2rem;text-align:center">' +
                '<h2>离线了</h2><p>第一次打开需要联网加载一次，之后就能离线用了。</p></body>',
              { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            )
          );
        }
      })()
    );
    return;
  }

  /* 其他同源静态资源：缓存优先，后台悄悄更新 */
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) {
        fetch(req)
          .then((res) => { if (res && res.ok) cache.put(req, res.clone()); })
          .catch(() => {});
        return hit;
      }
      try {
        const res = await fetch(req);
        if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch (e) {
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })()
  );
});

/* 页面可以主动问：你是哪个版本的？ */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'GET_VERSION' && event.source) {
    event.source.postMessage({ type: 'SW_VERSION', version: VERSION });
  }
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
});
