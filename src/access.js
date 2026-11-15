// 접속 코드(PIN) 게이트. 공개 호스팅(GitHub Pages)에서 모르는 사람이 쓰지 못하게 막는 간단한 잠금.
// PIN_HASH 가 비어 있으면 잠금 없음. 변경: node tools/set-pin.mjs <새PIN>
// 주의: 클라이언트 측 잠금이라 소스를 읽으면 우회할 수 있습니다. 개인 정보가 없는 게임용 가벼운 보호입니다.
export const PIN_HASH = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4';
const KEY = 'puck-trainer.access.v1';

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function isLocked() {
  if (!PIN_HASH) return false;
  try { return localStorage.getItem(KEY) !== PIN_HASH; } catch { return true; }
}

export async function tryUnlock(pin) {
  if (!PIN_HASH) return true;
  if (!crypto?.subtle) return false; // HTTP 등 비보안 컨텍스트
  const h = await sha256(String(pin).trim());
  if (h !== PIN_HASH) return false;
  try { localStorage.setItem(KEY, PIN_HASH); } catch { /* 저장 불가 시 매번 입력 */ }
  return true;
}

export function lock() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
