// 바로가기 만들기 (앱으로 설치) + 오프라인 실행 (서비스 워커 sw.js 등록).
//  - 크롬·엣지·삼성 인터넷: 브라우저의 설치 창을 띄운다 (바탕화면·시작 메뉴·홈 화면에 아이콘, 주소창 없는 창으로 열림)
//  - 아이폰·아이패드, 맥 사파리, 파이어폭스, 카카오톡 같은 앱 안 브라우저: 설치 창이 없어 방법을 보여 준다
//  - 이미 아이콘으로 열었으면(앱 모드) 버튼을 숨긴다
// 화면 글자는 한국어로 넣고, 영어 화면에서는 i18n.js 가 바꾼다 (사전: i18n-en.js)
import { isDevHost, isLanHost } from './guard.js';
import { track } from './analytics.js';

const OFFICIAL_HOSTS = ['puck-trainer.com', 'www.puck-trainer.com'];

/** 서비스 워커를 등록할 주소인가: 공식 주소만. 내 컴퓨터는 ?sw=1 로 열었을 때만 (테스트가 요청을 가로채는 데 방해되지 않게) */
export function swAllowed(loc) {
  if (isDevHost(loc)) return /[?&]sw=1(&|$)/.test(String(loc?.search || ''));
  if (isLanHost(loc)) return false; // 같은 Wi-Fi 서버는 자체 인증서라 등록이 안 된다
  return loc?.protocol === 'https:' && OFFICIAL_HOSTS.includes(loc?.hostname);
}

/**
 * 이 브라우저에서 바로가기를 만드는 방법
 *  'prompt'  설치 창을 띄울 수 있는 브라우저 (창이 준비되면 버튼을 보인다)
 *  'ios'     아이폰·아이패드: 공유 → 홈 화면에 추가
 *  'mac'     맥 사파리: 파일 → Dock에 추가
 *  'android' 설치 창이 없는 안드로이드 브라우저: 메뉴 → 홈 화면에 추가
 *  'drag'    그 밖의 컴퓨터 브라우저 (파이어폭스 등): 주소창 왼쪽 아이콘을 바탕화면으로 끌기
 *  'inapp'   카카오톡·인스타그램·네이버 앱 안: 다른 브라우저로 열어야 한다
 */
export function installKind(ua = '', touchPoints = 0, hasPrompt = false) {
  ua = String(ua);
  if (/KAKAOTALK|Instagram|FBAN|FBAV|NAVER\(inapp|\bLine\/|DaumApps|everytimeApp|; wv\)/i.test(ua)) return 'inapp';
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return 'ios';
  if (hasPrompt) return 'prompt';
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(ua)) return 'mac';
  if (/Android/.test(ua)) return 'android';
  return 'drag';
}

/** 휴대폰·태블릿인가 (버튼 글자: 홈 화면 / 바탕화면) */
export const isMobileUa = (ua = '', touchPoints = 0) => /Android|iPhone|iPad|iPod|Mobile/.test(String(ua)) || (/Macintosh/.test(String(ua)) && touchPoints > 1);

const STEPS = {
  ios: [
    '주소창 옆이나 화면 아래의 공유 버튼(네모에 위쪽 화살표)을 누르세요.',
    '목록을 내려 ‘홈 화면에 추가’를 고르세요.',
    '‘추가’를 누르면 홈 화면에 퍽 드리블 아이콘이 생겨요.',
  ],
  mac: [
    '화면 맨 위 메뉴 막대에서 ‘파일’을 누르세요.',
    '‘Dock에 추가’를 고르면 Dock과 Launchpad에 아이콘이 생겨요 (macOS 14 이상).',
  ],
  android: [
    '브라우저 메뉴(⋮ 또는 ≡)를 누르세요.',
    '‘홈 화면에 추가’ 또는 ‘설치’를 고르세요.',
  ],
  drag: [
    '창을 조금 줄여 바탕화면이 보이게 하세요.',
    '주소창 맨 왼쪽의 자물쇠(사이트 정보) 아이콘을 누른 채 바탕화면으로 끌어다 놓으면 바로가기가 생겨요.',
    '크롬이나 엣지로 열면 이 버튼 한 번으로 앱처럼 설치할 수 있어요.',
  ],
  inapp: [
    '카카오톡·인스타그램 같은 앱 안에서는 바로가기를 만들 수 없어요.',
    '오른쪽 위(또는 아래) 메뉴에서 ‘다른 브라우저로 열기’를 누르세요.',
    '열린 Safari·Chrome에서 다시 ‘바로가기 만들기’를 누르세요.',
  ],
};

/** 이미 아이콘으로 열린 앱 모드인가 */
function runningAsApp(w = globalThis) {
  const mm = (q) => { try { return w.matchMedia(q).matches; } catch { return false; } };
  return w.navigator?.standalone === true || mm('(display-mode: standalone)') || mm('(display-mode: minimal-ui)')
    || mm('(display-mode: window-controls-overlay)') || (mm('(display-mode: fullscreen)') && !w.document?.fullscreenElement);
}

/** 서비스 워커 등록 + 지금 화면이 불러온 파일을 저장해 두라고 알린다 (다음에 오프라인으로 열 수 있게) */
export async function registerSW(w = globalThis) {
  const nav = w.navigator;
  if (!nav?.serviceWorker || !swAllowed(w.location)) return null;
  try {
    const reg = await nav.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    const ready = await nav.serviceWorker.ready;
    const send = () => {
      const origin = w.location.origin;
      const urls = [w.location.href, ...w.performance.getEntriesByType('resource').map((e) => e.name)]
        .filter((u) => { try { return new URL(u).origin === origin; } catch { return false; } });
      ready.active?.postMessage({ type: 'cache-urls', page: w.location.href, urls: [...new Set(urls)] });
    };
    if (w.document.readyState === 'complete') send(); else w.addEventListener('load', send, { once: true });
    return reg;
  } catch (err) {
    console.warn('service worker', err);
    return null;
  }
}

/** 첫 화면의 '바로가기 만들기' 카드 (index.html #install-card) */
export function initInstall(doc = globalThis.document, w = globalThis) {
  registerSW(w);
  const card = doc.getElementById('install-card');
  if (!card) return;
  const btn = doc.getElementById('btn-install'), help = doc.getElementById('install-help');
  const ua = w.navigator?.userAgent || '', touch = w.navigator?.maxTouchPoints || 0;
  const kind = installKind(ua, touch, 'onbeforeinstallprompt' in w);
  let deferred = null;
  btn.textContent = isMobileUa(ua, touch) ? '홈 화면에 바로가기 만들기' : '바탕화면에 바로가기 만들기';
  const show = (on) => card.classList.toggle('hidden', !on || runningAsApp(w));

  const fillHelp = () => {
    const ol = doc.createElement('ol');
    for (const s of STEPS[kind] || STEPS.drag) { const li = doc.createElement('li'); li.textContent = s; ol.append(li); }
    help.replaceChildren(ol);
  };

  btn.addEventListener('click', async () => {
    if (deferred) {
      const ev = deferred; deferred = null;
      try {
        await ev.prompt();
        const { outcome } = await ev.userChoice;
        track('install_prompt', { outcome });
        if (outcome === 'accepted') show(false);
      } catch { /* 창을 띄우지 못함 */ }
      if (!deferred && kind === 'prompt') show(false); // 닫았으면 브라우저가 다시 준비될 때까지 숨긴다
      return;
    }
    const open = help.classList.contains('hidden');
    if (open) fillHelp();
    help.classList.toggle('hidden', !open);
    btn.setAttribute('aria-expanded', String(open));
    if (open) track('install_help', { kind });
  });

  // 크롬·엣지: 설치할 수 있게 되면 브라우저가 알려 준다 (이미 설치했으면 오지 않음 → 버튼도 안 보임)
  w.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    help.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
    show(true);
  });
  w.addEventListener('appinstalled', () => { deferred = null; show(false); track('app_installed'); });
  show(kind !== 'prompt');
}
