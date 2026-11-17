// 대기 원 판단 로직 (순수 함수, 테스트 용이)
import { makeMatcher, matchPixel } from './vision.js';

/**
 * @param {object} p
 * @param {boolean} p.registered   등록된 퍽 모델이 있는지 (area > 0)
 * @param {boolean} p.puckInCircle 등록된 퍽이 추적 중이며 원 안에 있는지
 * @param {object}  p.sample       vision.autoCalibSample() 결과
 * @param {object}  p.model        등록된 퍽 모델 {r,g,b,area}
 * @param {number}  p.tol          퍽 색 허용 오차
 * @returns {'start'|'learn'|'refresh'|'mismatch'|'too_big'|'wait'}
 *  start    등록된 퍽이 원 안에 있음 -> 3초 카운트다운
 *  learn    등록된 퍽이 없음 -> 원 안 물체를 첫 퍽으로 학습
 *  refresh  등록된 퍽과 같은 색인데 추적이 안 됨(크기·조명 변화) -> 같은 퍽으로 보고 크기 갱신
 *  mismatch 등록된 퍽과 다른 물체 -> 안내 (학습하지 않음)
 *  too_big  물체가 원보다 큼
 *  wait     원이 비어 있음
 */
export function decideIdle({ registered, puckInCircle, sample, model, tol }) {
  if (puckInCircle) return 'start';
  if (sample.status === 'too_big') return 'too_big';
  if (sample.status !== 'ok') return 'wait';
  if (!registered) return 'learn';
  return sameColor(sample, model, tol) ? 'refresh' : 'mismatch';
}

/** 샘플 색이 등록된 퍽 색과 같은 범주인지 (채도 높은 색은 색도 비교, 어두운 색은 RGB 거리) */
export function sameColor(sample, model, tol) {
  const m = makeMatcher(model, Math.max(tol, 60) * 1.25);
  return matchPixel(m, sample.r, sample.g, sample.b);
}

// ---------- 게임 종료 후 선택: 퍽을 왼쪽에 두면 한 번 더, 오른쪽에 두면 모드 선택 ----------
export const CHOICE_HOLD_S = 2;      // 이만큼 머물면 실행
export const CHOICE_LEFT = 0.33;     // u < 0.33 = 왼쪽 영역
export const CHOICE_RIGHT = 0.67;    // u > 0.67 = 오른쪽 영역

export function choiceSide(u) { return u < CHOICE_LEFT ? 'L' : u > CHOICE_RIGHT ? 'R' : null; }

/**
 * 퍽 커서가 카드의 '안쪽'에 있는가. 테두리 가까이(가로 inset·세로 inset 비율)는 어느 카드도 아닌 것으로 본다
 * (카드 사이를 지나갈 때 테두리에 걸려 엉뚱한 카드가 골라지는 것을 막음). rect: {left, top, width, height}
 */
export const CARD_INSET = 0.14;
export function inCardCore(rect, x, y, inset = CARD_INSET) {
  const ix = rect.width * inset, iy = rect.height * inset;
  return x >= rect.left + ix && x <= rect.left + rect.width - ix && y >= rect.top + iy && y <= rect.top + rect.height - iy;
}

/**
 * 범용 머무름 판정: 같은 key(카드 번호 등) 위에 holdS초 머물면 그 key를 반환. key가 바뀌거나 null이면 처음부터.
 * c: { key, hold }
 */
export function stepDwell(c, key, dt, holdS = CHOICE_HOLD_S) {
  if (key !== c.key) { c.key = key; c.hold = 0; return null; }
  if (key === null || key === undefined) return null;
  c.hold += dt;
  return c.hold >= holdS ? key : null;
}

/**
 * c: { side, hold } 상태를 한 프레임 진행. 반환: 실행할 쪽 'L' | 'R' | null
 * armed=false 인 동안(결과가 막 뜬 직후)과 추적이 끊긴 동안은 세지 않는다. 영역을 벗어나거나 바꾸면 처음부터.
 */
export function stepChoice(c, { u, tracked, dt, armed }) {
  const side = tracked && armed && u !== null && u !== undefined ? choiceSide(u) : null;
  if (side !== c.side) { c.side = side; c.hold = 0; return null; }
  if (!side) return null;
  c.hold += dt;
  return c.hold >= CHOICE_HOLD_S ? side : null;
}
