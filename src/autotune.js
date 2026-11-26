// 인식 자동 맞춤: 등록한 퍽·스틱 색과 이 집의 영상(바닥·조명·그림자·신발·카메라)을 보고
// 색 허용 오차, 인식 해상도, 카메라 프레임을 정한다. 집마다 카메라·각도·퍽·바닥 색이 달라 '인식 세부 조정'을
// 손으로 다시 만지지 않아도 되게 하려는 것.
//
// 허용 오차는 두 값 사이에서 고른다.
//  - need (아래쪽): 등록한 물체 자신이 다 잡히려면 필요한 값 — 그늘·반사·가장자리 때문에 물체 안에서도 색이 퍼져 있다
//    (vision.innerNeed: 등록할 때 잼, 3/3 움직여 보기에서 네 모서리를 돌며 잰 한가운데 색으로 보탬)
//  - 안전 (위쪽): 이 값으로 영역을 칠했을 때 바닥·그림자·얼룩이 '퍽만 한 덩어리'로 생기지 않는 값 (vision.distanceMap 으로 확인)
// need 보다 조금 넓게(× 1.35 → 1.2 → 1.1 중 안전한 가장 큰 값) 잡고, 그래도 안 되면 조금 좁혀 보고(퍽이 일부만 칠해져도
// 추적은 됨), 그래도 안 되면 퍽과 거의 같은 색이 영역에 있는 것이라 need 그대로 두고 알린다.
import { labelBlobs, mergeBlobs } from './vision.js';

export const TOL_MIN = 25;
export const TOL_MAX = 180;
/** need 에 곱해 볼 배율: 넓게(조명이 바뀌어도 잡히게) → 좁게. 1 미만은 '바닥과 겹쳐 좁힐 수밖에 없을 때' */
export const WIDEN = [1.35, 1.2, 1.1];
export const NARROW = [0.95, 0.85, 0.75];
/** 영역에서 이 비율 넘게 물체 색으로 칠해지면 바닥 자체가 물체 색 (덩어리를 세지 않아도 안전하지 않다) */
export const FLOOR_RATIO = 0.05;
/** 바닥과의 색 차이에 대한 상한 비율: 이보다 넓히면 물체 둘레(바닥과 섞인 테두리·그림자)까지 물체로 번진다 */
export const BG_CAP = 0.6;

/**
 * 허용 오차 tol 로 칠했을 때 영역에 생기는 '가짜' 덩어리 (등록한 물체 자리는 distanceMap 에서 이미 뺐다).
 * kind 'puck': 추적이 퍽으로 볼 수 있는 크기(등록 면적의 25%~3배)의 덩어리가 하나라도 생기면 안전하지 않다.
 *   그보다 큰 덩어리(스케이트·신발·바지)는 추적이 '너무 큼'으로 거르므로 세지 않는다.
 * kind 'stick': 스틱은 가장 큰 덩어리를 고르므로 등록 면적의 30% 이상이면 크기와 상관없이 안전하지 않다.
 * 반환: { bad, ratio (칠해진 비율), worst (문제 덩어리 가장 큰 면적, 없으면 0) }
 */
export function falseBlobs(map, tol, area, kind = 'puck') {
  const { D, w, h, n } = map;
  const mask = new Uint8Array(w * h);
  let cnt = 0;
  for (let i = 0; i < D.length; i++) if (D[i] <= tol) { mask[i] = 1; cnt++; }
  const ratio = n ? cnt / n : 0;
  if (ratio > FLOOR_RATIO) return { bad: true, ratio, worst: Infinity };
  if (!cnt) return { bad: false, ratio, worst: 0 };
  const lo = Math.max(3, area * (kind === 'stick' ? 0.3 : 0.25)), hi = kind === 'stick' ? Infinity : area * 3;
  let worst = 0;
  for (const b of mergeBlobs(labelBlobs(mask, w, h), 2)) {
    const a = b.px.length;
    if (a >= lo && a <= hi && a > worst) worst = a;
  }
  return { bad: worst > 0, ratio, worst };
}

/**
 * 허용 오차 고르기. need: 물체가 다 잡히는 값, map: vision.distanceMap 결과(없으면 영역 확인 없이 need 기준),
 * area: 등록 면적(처리 px), bgDist: 물체와 바닥 색 차이(모르면 0)
 * 반환: { tol, need, status: 'ok' | 'narrow' (바닥과 겹쳐 조금 좁힘) | 'same' (퍽과 거의 같은 색이 영역에 있음), worst }
 */
export function chooseTolerance({ need, map = null, area = 0, bgDist = 0, kind = 'puck' }) {
  need = clamp(Math.round(need || 0), TOL_MIN, TOL_MAX);
  const cap = bgDist > 0 ? Math.max(need, bgDist * BG_CAP) : TOL_MAX;
  const fit = (k) => clamp(Math.round(Math.min(need * k, cap)), 20, 200);
  if (!map || !(area > 0)) return { tol: fit(WIDEN[1]), need, status: 'ok', worst: 0 };
  for (const k of WIDEN) { const t = fit(k), f = falseBlobs(map, t, area, kind); if (!f.bad) return { tol: t, need, status: 'ok', worst: 0 }; }
  for (const k of NARROW) { const t = fit(k), f = falseBlobs(map, t, area, kind); if (!f.bad) return { tol: t, need, status: 'narrow', worst: 0 }; }
  return { tol: fit(WIDEN[2]), need, status: 'same', worst: falseBlobs(map, fit(WIDEN[2]), area, kind).worst };
}

/** 색 거리 히스토그램(Uint32Array(257), 256 = 못 잡는 색)의 분위수 */
export function histQuantile(hist, q) {
  let total = 0;
  for (let v = 0; v < hist.length; v++) total += hist[v];
  if (!total) return 0;
  const want = total * q;
  let s = 0;
  for (let v = 0; v < hist.length; v++) { s += hist[v]; if (s >= want) return v >= 256 ? Infinity : v; }
  return Infinity;
}

/**
 * 3/3 움직여 보기에서 네 모서리를 돌며 잰 퍽 한가운데 색 -> need (등록 때 잰 값과 큰 쪽).
 * 한가운데의 95% 가 잡히는 값 × 1.1 (먼 쪽 어두운 모서리·창가 밝은 모서리까지). 표본이 적으면 등록 값 그대로
 */
export function needFromTest(hist, registered) {
  let total = 0;
  for (let v = 0; v < hist.length; v++) total += hist[v];
  if (total < 60) return registered || 0;
  const q = histQuantile(hist, 0.95);
  const v = Number.isFinite(q) ? Math.round(q * 1.1) : TOL_MAX;
  return Math.max(registered || 0, Math.min(TOL_MAX, v));
}

/** 인식 해상도 후보 (설정 창과 같은 값) */
export const PROC_WIDTHS = [240, 320, 400];
/** 먼 쪽 모서리에서 퍽이 실제로 읽히는 픽셀 수(영역 배율 포함)가 이 이상이면 충분 — 덩어리 모양·중심이 안정적 */
export const FAR_WANT = 30;
/** 인식이 이 fps 아래면(기기가 버거움) 해상도를 올리지 않고, 내려도 되면 내린다 */
export const SLOW_FPS = 24;

/**
 * 인식 해상도 고르기 (3/3 움직여 보기 끝에).
 * far: 먼 쪽 표적에서 잰 퍽 면적 (지금 해상도 pw 의 처리 px), budget: 영역 크기 몫 배율 (vision.roi.budget),
 * srcW: 카메라 원본 폭, fps: 지금 인식 fps (0 = 모름).
 * 먼 쪽 퍽이 FAR_WANT 픽셀 이상 읽히는 가장 낮은 해상도 (낮을수록 가볍다). 어느 것도 안 되면 가장 높은 것.
 * 기기가 버거우면 올리지 않고, 기준의 60% 만 넘어도 낮은 쪽으로
 */
export function chooseProcWidth({ far, pw, budget = 1, srcW = 0, fps = 0 }) {
  if (!(far > 0) || !(pw > 0)) return pw;
  const eff = (P) => {
    const cap = Math.min(budget, 3, srcW > 0 ? srcW / P : 3);
    const s = Math.max(1, Math.floor(cap * 4) / 4);
    return far * (P / pw) ** 2 * s * s;
  };
  const slow = fps > 0 && fps < SLOW_FPS;
  const want = slow ? FAR_WANT * 0.6 : FAR_WANT;
  let pick = PROC_WIDTHS.find((P) => eff(P) >= want) ?? PROC_WIDTHS[PROC_WIDTHS.length - 1];
  if (slow && pick > pw) pick = pw;
  return pick;
}

/** 영상 자글거림(vision.noiseProbe 평균)이 이보다 크고 화면이 어두우면 카메라를 30fps 로 (노출이 길어져 잡음이 준다) */
export const NOISE_HIGH = 3.5;
export const DARK_LUMA = 110;
/** 카메라 프레임 자동: 어둡고 자글거리면 true (30fps 로 낮출 것) */
export function preferLowRate({ noise, luma }) {
  return noise > NOISE_HIGH && luma > 0 && luma < DARK_LUMA;
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
