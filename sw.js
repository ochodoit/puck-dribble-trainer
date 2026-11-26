// 서비스 워커: 한 번 연 뒤에는 인터넷이 끊겨도 게임이 열리게 한다 (src/install.js 가 공식 주소에서만 등록).
// 전략은 '네트워크 먼저': 인터넷이 되면 언제나 새로 받은 파일을 쓰고(배포하면 바로 반영), 받은 파일은 저장해 둔다.
// 인터넷이 안 될 때만 저장해 둔 파일로 연다. 그래서 배포할 때 이 파일을 고칠 필요는 없다.
// 이 사이트 주소의 GET 요청만 다룬다. Firebase·글꼴·통계 같은 다른 주소는 건드리지 않는다 (로그인·랭킹은 인터넷이 있어야 함).
// 저장 방식을 바꾸면 CACHE 이름의 숫자를 올린다 (예전 저장분은 activate 에서 지워진다).
// 문제가 생겨 서비스 워커를 끄려면: 이 파일 내용을 아래 한 줄로 바꿔 배포하면 다음 방문 때 모두 해제된다.
//   self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', () => self.registration.unregister());
const CACHE = 'puck-trainer-v1';
// 처음 설치할 때 미리 받아 둘 첫 화면 파일 (게임 코드 src/*.js 는 페이지가 불러온 목록을 install.js 가 보내 준다)
const SHELL = ['./', './index.html', './en/', './style.css', './manifest.webmanifest', './favicon.ico',
  './icons/icon.svg', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/hero-art.webp'];

const OFFLINE_HTML = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<title>퍽 드리블 트레이너</title><style>body{font-family:system-ui,sans-serif;background:#F4F1EA;color:#1d1b17;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px}</style></head>'
  + '<body><main><h1>인터넷 연결이 필요해요</h1><p>이 페이지는 아직 저장되지 않았어요. 연결되면 다시 열어 주세요.</p>'
  + '<p lang="en">You are offline and this page has not been saved yet. Please try again when you are connected.</p></main></body></html>';

/** 이 사이트 파일이고 저장해도 되는 응답인가 (다른 주소·오류·넘겨주기 응답은 저장하지 않음) */
const storable = (res) => !!res && res.ok && res.type === 'basic';
/** 페이지 주소는 ?c=초대코드 같은 뒷부분을 떼고 저장한다 (같은 페이지가 여러 벌 쌓이지 않게) */
const pageKey = (url) => new URL(url).origin + new URL(url).pathname;

async function put(key, res) {
  try { const c = await caches.open(CACHE); await c.put(key, res); } catch { /* 저장 공간 부족 등: 무시 */ }
}

async function fromCache(req, isPage) {
  const c = await caches.open(CACHE);
  const url = new URL(req.url);
  const hit = await c.match(isPage ? pageKey(req.url) : req, { ignoreSearch: isPage });
  if (hit || !isPage) return hit;
  // '/guide' 와 '/guide/', '/' 와 '/index.html' 은 같은 페이지
  const p = url.pathname;
  const alt = p.endsWith('/') ? p + 'index.html' : p.endsWith('/index.html') ? p.slice(0, -'index.html'.length) : p + '/';
  return c.match(url.origin + alt);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // 하나가 실패해도 나머지는 저장한다 (addAll 은 하나만 실패해도 전부 실패)
    await Promise.all(SHELL.map(async (u) => {
      try { const res = await fetch(new Request(u, { cache: 'reload' })); if (storable(res)) await c.put(pageKey(res.url || new URL(u, self.location).href), res); } catch { /* 다음에 */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('puck-trainer-') && k !== CACHE) await caches.delete(k);
    // 페이지를 열 때 서비스 워커가 깨어나는 시간만큼 기다리지 않게 (지원하는 브라우저만)
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.enable(); } catch { /* 무시 */ } }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.endsWith('/sw.js')) return;
  const isPage = req.mode === 'navigate';
  event.respondWith((async () => {
    try {
      const res = (isPage && (await event.preloadResponse)) || (await fetch(req));
      if (storable(res)) event.waitUntil(put(isPage ? pageKey(req.url) : req, res.clone()));
      return res;
    } catch (err) {
      const hit = await fromCache(req, isPage);
      if (hit) return hit;
      if (isPage) return new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      throw err;
    }
  })());
});

// 페이지가 이미 불러온 파일 목록을 보내 주면 (src/install.js) 저장해 둔다: 처음 방문한 그 화면 그대로 다음에 오프라인으로 열 수 있게
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'cache-urls' || !Array.isArray(data.urls)) return;
  event.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(data.urls.slice(0, 300).map(async (u) => {
      try {
        const url = new URL(u, self.location);
        if (url.origin !== self.location.origin || url.pathname.endsWith('/sw.js')) return;
        const key = data.page === u ? pageKey(url.href) : url.href;
        if (await c.match(key)) return;
        const res = await fetch(url.href);
        if (storable(res)) await c.put(key, res);
      } catch { /* 다음에 */ }
    }));
  })());
});
