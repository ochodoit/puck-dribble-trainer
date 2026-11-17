// 복제 사이트 막기 (1차): 공식 주소와 내 컴퓨터(개발·테스트)·같은 Wi-Fi(사설 IP)에서만 앱을 실행한다.
// 다른 사이트의 틀(iframe) 안에 넣어 띄우는 것(클릭 가로채기)도 막는다.
// main.js 가 맨 먼저 불러오므로, 여기서 멈추면 앱의 나머지는 실행되지 않는다.
// 소스를 고쳐 이 검사를 지울 수는 있지만, 온라인 가입·랭킹은 Firebase 쪽(승인된 도메인, API 키 제한, 보안 규칙)에서 따로 막는다.
export const OFFICIAL_URL = 'https://ochodoit.github.io/puck-dribble-trainer/';
const OFFICIAL_HOST = 'ochodoit.github.io';
const OFFICIAL_PATH = /^\/(puck-dribble-trainer|semple)(\/|$)/; // semple = 예전 주소

/** 내 컴퓨터에서 연 페이지인가 (개발 서버·테스트) */
export function isDevHost(loc) {
  const h = String(loc?.hostname || '');
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost');
}

/** 같은 Wi-Fi에서 컴퓨터를 서버로 쓸 때 (README 방법 A, 예: https://192.168.0.12:8443): 사설 IP 주소 */
export function isLanHost(loc) {
  const h = String(loc?.hostname || '');
  return /^10\.\d+\.\d+\.\d+$/.test(h) || /^192\.168\.\d+\.\d+$/.test(h) || /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h) || h.endsWith('.local');
}

/** 이 주소에서 앱을 실행해도 되는가 */
export function siteAllowed(loc) {
  if (isDevHost(loc) || isLanHost(loc)) return true;
  return loc?.protocol === 'https:' && loc.hostname === OFFICIAL_HOST && OFFICIAL_PATH.test(loc.pathname || '');
}

function stop(text) {
  const box = document.createElement('main');
  box.className = 'guard-stop';
  const p = document.createElement('p');
  p.textContent = text;
  const a = document.createElement('a');
  a.href = OFFICIAL_URL; a.target = '_top'; a.rel = 'noopener';
  a.textContent = OFFICIAL_URL;
  box.append(p, a);
  const paint = () => { document.body.replaceChildren(box); };
  if (document.body) paint(); else document.addEventListener('DOMContentLoaded', paint);
  throw new Error('puck-trainer: blocked');
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  let framed = false;
  try { framed = window.top !== window.self; } catch { framed = true; }
  if (!siteAllowed(window.location)) stop('공식 퍽 드리블 트레이너가 아닙니다. 공식 사이트에서 이용해 주세요.');
  else if (framed && !isDevHost(window.location)) stop('다른 사이트 안에서는 열 수 없습니다. 공식 사이트에서 이용해 주세요.');
}
