/* 旅行日记 Service Worker —— 离线可用版本
 * 策略：
 *   1. 导航请求（页面）：网络优先，失败回落到缓存的 index.html
 *   2. 同源静态资源（JS/CSS/图片/字体）：stale-while-revalidate
 *   3. 第三方资源（地图瓦片 / Leaflet CDN）：cache-first
 *   4. 汇率等接口：只用网络，失败时回落到上次缓存
 */
const VERSION = 'v1.0.0'
const SHELL_CACHE = `td-shell-${VERSION}`
const STATIC_CACHE = `td-static-${VERSION}`
const MEDIA_CACHE = `td-media-${VERSION}`

const SHELL_FILES = ['./', './index.html', './manifest.json']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      await Promise.allSettled(SHELL_FILES.map((f) => cache.add(f)))
      await self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((k) => k.startsWith('td-') && !k.endsWith(VERSION)).map((k) => caches.delete(k))
      )
      await self.clients.claim()
    })()
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') void self.skipWaiting()
})

const cacheable = (res) => !!res && (res.ok || res.type === 'opaque')

async function putSafe(cacheName, request, response) {
  if (!cacheable(response)) return
  try {
    const cache = await caches.open(cacheName)
    await cache.put(request, response.clone())
  } catch {
    // 配额不足等情况忽略
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  const network = fetch(request)
    .then(async (res) => {
      await putSafe(cacheName, request, res)
      return res
    })
    .catch(() => null)
  if (cached) return cached
  const fresh = await network
  return fresh || new Response('', { status: 504, statusText: 'offline' })
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached
  try {
    const res = await fetch(request)
    await putSafe(cacheName, request, res)
    return res
  } catch {
    return new Response('', { status: 504, statusText: 'offline' })
  }
}

async function networkFirst(request, cacheName) {
  try {
    const res = await fetch(request)
    await putSafe(cacheName, request, res)
    return res
  } catch {
    const cache = await caches.open(cacheName)
    return (await cache.match(request)) || new Response('', { status: 504, statusText: 'offline' })
  }
}

async function handleNavigation(request) {
  try {
    const res = await fetch(request)
    if (res.ok) {
      const cache = await caches.open(SHELL_CACHE)
      await cache.put('./index.html', res.clone())
    }
    return res
  } catch {
    const cache = await caches.open(SHELL_CACHE)
    const cached = (await cache.match('./index.html')) || (await cache.match('./'))
    if (cached) return cached
    return new Response('离线中：请先联网打开一次页面，之后即可离线使用。', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    })
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request))
    return
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE))
    return
  }

  const host = url.hostname
  if (host.includes('tile.') || host.includes('unpkg.com') || host.includes('basemaps')) {
    event.respondWith(cacheFirst(request, MEDIA_CACHE))
    return
  }
  if (host.includes('frankfurter') || host.includes('er-api') || host.includes('nominatim')) {
    event.respondWith(networkFirst(request, MEDIA_CACHE))
  }
})
