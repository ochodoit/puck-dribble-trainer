// 인식 품질 기록 (데이터 쌓기 1단계): 카메라로 하는 한 판마다 영상 없이 '숫자만' 모은다.
// 어떤 환경(조명·카메라 각도·퍽 색·해상도)에서 퍽을 놓치거나, 블레이드로 잇거나, 다른 물체로 튀는지 보고 기본값·안내를 고치려는 것.
// 게임이 끝나면 GA4 통계(공식 주소에서만, 개인정보 없이 — analytics.js)에 vision_quality 로 보내고, 이 기기에도 최근 30판을 남긴다
// (운영자 화면 '인식 기록'). 결과 화면의 '인식이 이상했어요'는 같은 숫자를 vision_report 로 보낸다.

export const LOG_KEEP = 30;
export const LOG_KEY = 'puck-trainer.vision-log.v1';
/** 이보다 짧은 판(초)은 기록하지 않는다 (바로 멈춘 판은 숫자가 의미 없음) */
export const LOG_MIN_SEC = 10;

/** 한 판 동안의 프레임별 인식 상태를 센다 (게임 중, 카메라로 처리한 프레임마다 frame 을 부른다) */
export class VisionLog {
  constructor() { this.reset(); }

  reset() {
    this.frames = 0;      // 처리한 프레임
    this.tracked = 0;     // 퍽 자리가 있었던 프레임 (직접 봤거나 블레이드로 이은 자리)
    this.sure = 0;        // 확실한 자리 (직접 본 퍽이 0.15초 넘게 이어짐 — 감점 판정에 쓰는 자리)
    this.bridged = 0;     // 블레이드로 이은 자리 (퍽이 스틱에 가려짐)
    this.doubtful = 0;    // 애매한 조각 (가려져 작아진·가늘고 긴·떼어 낸 조각)
    this.thin = 0;        // 퍽 색 가는 줄(샤프트·그림자)을 지운 프레임
    this.lost = 0;        // 퍽을 놓친 횟수 (추적 중 -> 놓침)
    this.jumps = 0;       // 튀는 값이 이어져 자리를 옮긴 횟수 (다른 물체로 옮겨 갔을 수 있음)
    this.prevState = 'lost';
    this.jumps0 = null;
  }

  /** 프레임 하나. tracker: Tracker, meas: 이번 측정({u,v,doubtful?,bridged?}|null), vision: Vision (thinRemoved) */
  frame(tracker, meas, vision) {
    this.frames++;
    if (tracker.state === 'tracked') this.tracked++;
    if (tracker.confident) this.sure++;
    if (tracker.bridged) this.bridged++;
    if (meas && meas.doubtful) this.doubtful++;
    if ((vision?.thinRemoved || 0) > 0) this.thin++;
    if (this.prevState !== 'lost' && tracker.state === 'lost') this.lost++;
    this.prevState = tracker.state;
    if (this.jumps0 === null) this.jumps0 = tracker.jumps || 0;
    this.jumps = Math.max(0, (tracker.jumps || 0) - this.jumps0);
  }
}

/** 정규화 다각형 넓이 (신발끈 공식) */
function polyArea(q) {
  let s = 0;
  for (let i = 0; i < q.length; i++) { const [x0, y0] = q[i], [x1, y1] = q[(i + 1) % q.length]; s += x0 * y1 - x1 * y0; }
  return Math.abs(s) / 2;
}

/**
 * 한 판의 인식 품질 요약. GA4 매개변수로 그대로 보낸다 (25개 이하, 숫자·짧은 글자만 — 개인정보 없음).
 * c: { mode, seconds, level, elapsed, fps, procWidth, hits, unsure, shadowCut, floorLuma, puckTol, stickTol, stick, puckModel, quad, member }
 *    quad: 정규화 네 모서리 [[u,v] × 4] (왼쪽 위부터 시계 방향) — 판이 화면에서 차지하는 넓이(area_pct)와 위·아래 변 길이 비(tilt: 카메라 기울기)
 */
export function qualitySummary(log, c = {}) {
  const f = Math.max(1, log.frames), pct = (n) => Math.round((n / f) * 100);
  const pm = c.puckModel || {}, mx = Math.max(pm.r || 0, pm.g || 0, pm.b || 0), mn = Math.min(pm.r || 0, pm.g || 0, pm.b || 0);
  const q = Array.isArray(c.quad) && c.quad.length === 4 ? c.quad : null;
  const top = q ? Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) : 0, bot = q ? Math.hypot(q[2][0] - q[3][0], q[2][1] - q[3][1]) : 0;
  return {
    mode: String(c.mode || ''), seconds: c.seconds || 0, level: c.level || 'normal', play_seconds: Math.round(c.elapsed || 0),
    fps: Math.round(c.fps || 0), proc_width: c.procWidth || 0, frames: log.frames,
    track_pct: pct(log.tracked), sure_pct: pct(log.sure), bridged_pct: pct(log.bridged), doubtful_pct: pct(log.doubtful), thin_pct: pct(log.thin),
    lost_count: log.lost, jump_count: log.jumps, hits: c.hits || 0, unsure_touch: c.unsure || 0,
    shadow_cut: Math.round((c.shadowCut || 0) * 100), floor_luma: Math.round(c.floorLuma || 0),
    puck_tol: Math.round(c.puckTol || 0), stick_tol: c.stick ? Math.round(c.stickTol || 0) : 0,
    puck_kind: mx > 60 && mx - mn > 0.35 * mx ? 'color' : 'dark',
    area_pct: q ? Math.round(polyArea(q) * 100) : 0, tilt: bot > 0 ? Math.round((top / bot) * 100) : 0,
    member: c.member ? 'member' : 'guest',
  };
}

/** 이 기기의 최근 기록 (새것부터). 저장소를 못 쓰면 빈 목록 */
export function loadLog(store = globalThis.localStorage) {
  try { const a = JSON.parse(store?.getItem(LOG_KEY) || '[]'); return Array.isArray(a) ? a.filter((x) => x && typeof x === 'object') : []; } catch { return []; }
}

/** 이 기기에 한 판 기록을 남긴다 (최근 LOG_KEEP 판). 반환: 남긴 항목 */
export function saveLog(sum, store = globalThis.localStorage, now = Date.now()) {
  const entry = { at: now, ...sum };
  try { store?.setItem(LOG_KEY, JSON.stringify([entry, ...loadLog(store)].slice(0, LOG_KEEP))); } catch { /* 저장 공간 없음: 무시 */ }
  return entry;
}

/** '인식이 이상했어요': 그 판 기록(at)에 표시 */
export function markReported(at, store = globalThis.localStorage) {
  try {
    const a = loadLog(store);
    const e = a.find((x) => x.at === at);
    if (e) { e.reported = 1; store.setItem(LOG_KEY, JSON.stringify(a)); }
    return !!e;
  } catch { return false; }
}
