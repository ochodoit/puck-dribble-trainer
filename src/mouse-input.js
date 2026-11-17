// 테스트 관리자용 마우스 입력: 카메라 대신 마우스(또는 터치) 포인터를 퍽으로 쓴다.
// 화면 어디를 가리키든 그 자리에 내 퍽이 보이도록, 지금 화면(모드 선택·결과·게임 종류)에 맞춰
// 추적 좌표(u,v)를 거꾸로 계산해 Tracker 에 넣는다.
import { dodgeField } from './render.js';

export const MOUSE_SRC = { width: 1280, height: 720 };

export class MouseInput {
  constructor() {
    this.x = null; this.y = null; // 마지막 포인터 위치 (CSS px, 화면 기준)
    this.enabled = false;
    const onMove = (e) => { if (this.enabled) { this.x = e.clientX; this.y = e.clientY; } };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onMove, { passive: true });
  }

  get has() { return this.x !== null; }
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
/** f(0,0) -> a, f(1,1) -> b 인 선형 사상의 역함수 */
const inv = (val, a, b) => (b === a ? 0.5 : (val - a) / (b - a));

/**
 * 포인터 위치 -> 추적 좌표 {u, v}
 * ctx: { view, canvas, modeList, choiceTrack, modeOpen, resultOpen, game, topInset }
 */
export function pointerToUV(px, py, ctx) {
  const { view, canvas, game } = ctx;
  if (ctx.modeOpen && ctx.modeList) {
    // 모드 선택: 커서가 카드 목록 위 포인터 자리에 오도록 (main 은 flipDepth 면 v를 뒤집어 쓴다)
    const r = ctx.modeList.getBoundingClientRect();
    const vv = clamp01((py - r.top) / r.height);
    return { u: clamp01((px - r.left) / r.width), v: ctx.flipDepth ? 1 - vv : vv };
  }
  if (ctx.resultOpen && ctx.choiceTrack) {
    const r = ctx.choiceTrack.getBoundingClientRect();
    if (r.width > 0) return { u: clamp01((px - r.left) / r.width), v: 0.5 };
  }
  const vr = view.getBoundingClientRect();
  const nx = (px - vr.left) / vr.width, ny = (py - vr.top) / vr.height;
  if (game.running && game.mode.id === 'arcade') {
    // 아케이드: 화면 좌표(가로 1 × 세로 aspect) -> 플레이 존 안의 (u,v)
    const a = game.arcade, z0 = a.toZone(0, 0), z1 = a.toZone(1, 1);
    return { u: clamp01(inv(nx, z0.x, z1.x)), v: clamp01(inv(ny * a.aspect, z0.y, z1.y)) };
  }
  if ((game.running && (game.mode.id === 'obstacle' || game.mode.id === 'wide')) || game.mode.id === 'free') {
    // 평면 경기장(퍽 피하기·와이드 드리블·자유 연습): 캔버스 안 경기장 사각형 기준
    const f = dodgeField(canvas.width, canvas.height, ctx.topInset);
    const fx = (f.x / canvas.width) * vr.width + vr.left, fy = (f.y / canvas.height) * vr.height + vr.top;
    const fw = (f.w / canvas.width) * vr.width, fh = (f.h / canvas.height) * vr.height;
    const X = (px - fx) / fw, Y = ((py - fy) / fh) * game.plane.A;
    const p0 = game.toPlane(0, 0), p1 = game.toPlane(1, 1);
    return { u: clamp01(inv(X, p0.x, p1.x)), v: clamp01(inv(Y, p0.y, p1.y)) };
  }
  // 그 밖(대기 중 가운데 원, 드릴): 화면 전체가 바닥
  return { u: clamp01(nx), v: clamp01(ny) };
}

/** 카메라 영상 처리 결과 대신 쓰는 가짜 결과: 화면 전체가 바닥, 퍽은 포인터 자리 */
export function mouseVisionResult(PW, PH, uv) {
  const quad = [[0, 0], [PW, 0], [PW, PH], [0, PH]];
  const mapping = {
    quad,
    toPx: (u, v) => [u * PW, v * PH],
    toUV: (x, y) => [x / PW, y / PH],
    inside: (x, y, m = 0) => x >= -m * PW && x <= PW * (1 + m) && y >= -m * PH && y <= PH * (1 + m),
  };
  return {
    floor: { quad, mapping, detected: true, locked: true, polygon: [], mode: 'full', fallback: false },
    puck: null, // 화면상의 '실제 퍽 고리'는 그리지 않는다 (좌표계가 모드마다 달라 커서와 어긋남)
    stick: null,
    puckCandidates: [],
    mouse: uv,
  };
}
