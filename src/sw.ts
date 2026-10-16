/// <reference lib="webworker" />
/**
 * Service Worker —— 与原仓库 docs/sw.js 行为一致，并扩展：
 * - HTML：Network-First；静态资源：Stale-While-Revalidate；其他：Cache-First
 * - .json.gz 字典不拦截（由应用层 Cache Storage 管理，支持 ETag 条件更新）
 * - MiSans 字体 CDN（BootCDN/cdnjs）SWR（PRD §3.4.2）
 */
declare const self: ServiceWorkerGlobalScope;

const CACHE_PREFIX = 'pboc';
const SHELL_CACHE = `${CACHE_PREFIX}-shell-v2`;
const STATIC_CACHE = `${CACHE_PREFIX}-static-v8`;
const DICT_CACHE_PREFIX = `${CACHE_PREFIX}-dict`;

const scopeUrl = new URL(self.registration.scope);
const BASE_PATH = scopeUrl.pathname.endsWith('/') ? scopeUrl.pathname : `${scopeUrl.pathname}/`;
const SHELL_URLS = [BASE_PATH, `${BASE_PATH}index.html`];
const STATIC_URLS = [
  `${BASE_PATH}styles/pboc.css`,
  `${BASE_PATH}styles/typography.css`,
  `${BASE_PATH}index.js`,
  `${BASE_PATH}manifest.webmanifest`,
  `${BASE_PATH}assets/icon.svg`,
];

const EXTERNAL_CACHE_HOSTS = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
  'cdn.bootcdn.net',
]);

async function putIfCacheable(cacheName: string, request: Request, response: Response): Promise<Response> {
  if (response && (response.ok || response.type === 'opaque')) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(event: FetchEvent): Promise<Response> {
  const { request } = event;
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then(response => putIfCacheable(STATIC_CACHE, request, response))
    .catch(() => null);

  if (cached) {
    event.waitUntil(networkPromise.then(() => undefined, () => undefined));
    return cached;
  }
  const fresh = await networkPromise;
  return fresh || Response.error();
}

async function networkFirstShell(request: Request): Promise<Response> {
  try {
    const response = await fetch(request, { cache: 'no-cache' });
    await putIfCacheable(SHELL_CACHE, request, response);
    return response;
  } catch {
    return (await caches.match(request)) || (await caches.match(`${BASE_PATH}index.html`)) || Response.error();
  }
}

async function cacheFirst(request: Request): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  await putIfCacheable(STATIC_CACHE, request, response);
  return response;
}

function isStaticAsset(url: URL): boolean {
  return /\.(?:css|js|webmanifest|png|svg|ico|woff2?)$/i.test(url.pathname);
}

self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_URLS)),
      caches.open(STATIC_CACHE).then(cache => cache.addAll(STATIC_URLS)),
    ]).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  const keep = new Set([SHELL_CACHE, STATIC_CACHE]);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => !keep.has(key) && !key.startsWith(DICT_CACHE_PREFIX))
            .map(key => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 字典 gzip 由应用层 Cache Storage 管理（支持条件更新），SW 不拦截
  if (url.pathname.endsWith('.json.gz')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request));
    return;
  }

  if (url.origin !== self.location.origin) {
    if (EXTERNAL_CACHE_HOSTS.has(url.hostname)) {
      event.respondWith(staleWhileRevalidate(event));
    }
    return;
  }

  event.respondWith(isStaticAsset(url) ? staleWhileRevalidate(event) : cacheFirst(request));
});
export {};
