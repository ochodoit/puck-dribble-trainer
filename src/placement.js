// 카메라 위치 점검 (시작 준비 3/3 움직여 보기 끝에): 등록된 퍽 크기와 영역(네 모서리 바닥 사상)으로
// 먼 쪽 퍽이 화면에서 얼마나 작게 보일지 어림하고, 3/3 에서 실제로 잰 크기·놓친 정도와 합쳐
// "더 높이세요 / 지금이 최소 높이 / 좋아요 / 여유 있음(TV를 가리면 조금 낮춰도 됨)" 을 정한다.
// 기준값은 실제 크기 3D 장면 시뮬레이션(테스트 CAM·PLC)에서 정했다: 240px 인식에서 먼 쪽 퍽이 6px(카메라 50cm)이면
// 먼 줄을 놓쳤고, 13~15px(75~80cm)부터 모두 잡혔다. 해상도를 올렸어도 240px 기준으로 환산해 판단한다 (위치 정확도는 해상도로 안 좋아지므로)

export const FAR_MIN = 9;    // 먼 쪽 퍽 면적(240px 기준)이 이보다 작으면 → 더 높이 (인식 한계)
export const FAR_OK = 13;    // 이보다 작으면 → 지금이 최소 높이 (더 낮추지 말 것)
export const FAR_ROOM = 26;  // 이 이상이면 → 여유 있음 (화면을 가리면 조금 낮춰도 됨)
export const LOST_MAX = 0.35; // 3/3 에서 먼 쪽 절반에 있는 동안 이 비율 넘게 놓쳤으면 → 더 높이
// 내려다보는 각도: 영역 가운데의 (세로 축척 / 가로 축척) ≈ sin(각도) × (영역 깊이 / 폭). 깊이는 모르므로 흔한 비율(2m×1.5m)로 어림
export const DEPTH_RATIO = 0.75;
export const ANGLE_RAISE = 13; // 이보다 낮게 내려다보면(°) → 더 높이 (카메라 50cm 쯤: 위치 오차 8cm, 먼 줄을 놓침)
export const ANGLE_OK = 22;    // 이보다 낮으면 → 최소 높이 (80cm 쯤: 오차 6cm)
export const ANGLE_ROOM = 40;  // 이 이상이고 먼 쪽 퍽도 크면 → 여유 있음

/** 바닥 좌표 (u,v) 자리의 넓이 축척 (가로 축척 × 세로 축척, px²/단위²): 퍽이 그 자리에서 차지할 면적에 비례 */
export function localScale(mapping, u, v, d = 0.02) {
  const a = mapping.toPx(u - d, v), b = mapping.toPx(u + d, v), c = mapping.toPx(u, v - d), e = mapping.toPx(u, v + d);
  return (Math.hypot(b[0] - a[0], b[1] - a[1]) / (2 * d)) * (Math.hypot(e[0] - c[0], e[1] - c[1]) / (2 * d));
}

/**
 * 영역 가운데에서 카메라가 바닥을 내려다보는 각도 어림 (°). 영역 깊이/폭 비율을 DEPTH_RATIO 로 가정.
 * 바닥(미터) → 화면 국소 변환의 두 특이값 비(작은 것/큰 것)가 sin(각도) — 카메라가 옆(TV 옆)에서 비스듬히 봐도 맞다
 */
export function viewAngle(mapping, depthRatio = DEPTH_RATIO) {
  const d = 0.02, a = mapping.toPx(0.5 - d, 0.5), b = mapping.toPx(0.5 + d, 0.5), c = mapping.toPx(0.5, 0.5 - d), e = mapping.toPx(0.5, 0.5 + d);
  // 열: 가로 1단위(폭)당, 세로 1단위(깊이 = 폭 × 비율)당 화면 이동 → 같은 실제 길이 기준으로 맞춘다
  const ux = (b[0] - a[0]) / (2 * d), uy = (b[1] - a[1]) / (2 * d);
  const vx = (e[0] - c[0]) / (2 * d) / depthRatio, vy = (e[1] - c[1]) / (2 * d) / depthRatio;
  const S = ux * ux + uy * uy + vx * vx + vy * vy, det = Math.abs(ux * vy - uy * vx);
  const r = Math.sqrt(Math.max(0, S * S - 4 * det * det));
  const sMax = Math.sqrt((S + r) / 2), sMin = Math.sqrt(Math.max(0, (S - r) / 2));
  return sMax > 0 ? (Math.asin(Math.min(1, sMin / sMax)) * 180) / Math.PI : 90;
}

/**
 * mapping: 바닥 사상 (toPx), puckArea: 등록된 퍽 면적(영역 가운데에서 잰 처리 px), PW: 처리 해상도 폭
 * measured: 3/3 움직여 보기에서 잰 값 { far: [먼 쪽 표적에서 퍽 면적…], near: [...], farFrames, farMissed } (없으면 어림만)
 * 반환: { verdict: 'raise'|'minimum'|'good'|'room', far, near, predictedFar, lost, angle }
 *   far·near: 240px 기준 퍽 면적 (먼 쪽 = 영역 위쪽 끝 근처, 가까운 쪽 = 아래쪽 끝 근처), angle: 내려다보는 각도 어림(°)
 */
export function placementCheck({ mapping, puckArea, PW, measured = null }) {
  const k = (240 / PW) ** 2;
  const sc = localScale(mapping, 0.5, 0.5);
  const angle = viewAngle(mapping);
  const at = (u, v) => (puckArea * localScale(mapping, u, v)) / sc * k;
  const predictedFar = Math.min(at(0.15, 0.12), at(0.85, 0.12));
  const predictedNear = Math.min(at(0.15, 0.88), at(0.85, 0.88));
  // 실제로 잰 값이 있으면 그것을 믿는다 (두꺼운 퍽은 낮은 각도에서 옆면까지 보여 바닥 축척 어림보다 크게 보인다)
  const far = measured?.far?.length ? Math.min(...measured.far) * k : predictedFar;
  const near = measured?.near?.length ? Math.min(...measured.near) * k : predictedNear;
  const lost = measured?.farFrames > 15 ? measured.farMissed / measured.farFrames : 0;
  let verdict = 'good';
  if (far < FAR_MIN || lost > LOST_MAX || angle < ANGLE_RAISE) verdict = 'raise';
  else if (far < FAR_OK || angle < ANGLE_OK) verdict = 'minimum';
  else if (far >= FAR_ROOM && angle >= ANGLE_ROOM && lost < 0.1) verdict = 'room';
  return { verdict, far: +far.toFixed(1), near: +near.toFixed(1), predictedFar: +predictedFar.toFixed(1), lost: +lost.toFixed(2), angle: Math.round(angle) };
}
