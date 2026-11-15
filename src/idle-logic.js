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
