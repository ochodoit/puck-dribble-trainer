// 방문·플레이 통계: Google 애널리틱스 4 (GA4, Firebase 프로젝트 headsuppuck 에 연결된 속성).
// 공식 주소(https://puck-trainer.com)에서만 켠다 — 내 컴퓨터·테스트·같은 Wi-Fi에서는 아무것도 보내지 않는다.
// 개인정보(별명·나이·팀·등번호·계정 id)는 보내지 않고, 광고용 신호(Google 신호·광고 맞춤설정)도 끈다.
// 보내는 이벤트 (GA 관리 > 맞춤 정의에 같은 이름으로 측정기준 mode·member·completed·method·error, 측정항목 play_seconds 등록):
//   game_start { mode, member }   game_end { mode, member, completed, play_seconds, score }
//   sign_up { method }   login { method }   camera_start   camera_error { error }   puck_registered
export const GA_ID = 'G-ZMXQ9TNPLQ';
const HOSTS = ['puck-trainer.com', 'www.puck-trainer.com'];

let send = null; // 켜지면 gtag 함수

/** 이 주소에서 통계를 켜는가: 공식 주소(https)만 */
export const analyticsAllowed = (loc) => loc?.protocol === 'https:' && HOSTS.includes(loc?.hostname);

/** GA4 태그를 한 번만 불러온다. 반환: 켜졌는지 */
export function initAnalytics(loc = globalThis.location, doc = globalThis.document) {
  if (send) return true;
  if (!doc || !analyticsAllowed(loc)) return false;
  const w = doc.defaultView;
  w.dataLayer = w.dataLayer || [];
  w.gtag = function gtag() { w.dataLayer.push(arguments); }; // gtag.js 가 읽는 형식 그대로 (arguments 객체)
  w.gtag('js', new Date());
  w.gtag('config', GA_ID, { allow_google_signals: false, allow_ad_personalization_signals: false });
  const s = doc.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  doc.head.appendChild(s);
  send = w.gtag;
  return true;
}

/** 이벤트 하나 (꺼져 있으면 아무것도 안 함). 값은 숫자와 짧은 글자만 — 통계가 실패해도 게임은 그대로 */
export function track(name, params = {}) {
  if (!send) return;
  try { send('event', name, params); } catch { /* 무시 */ }
}
