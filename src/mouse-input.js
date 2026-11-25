// 카메라 없이 체험(누구나, 운영자 테스트 포함): 카메라 대신 마우스 포인터나 손가락(터치)을 퍽으로 쓴다.
// 화면 어디를 가리키든 그 자리에 내 퍽이 보이도록, 지금 화면(모드 선택·결과·게임 종류)에 맞춰
// 추적 좌표(u,v)를 거꾸로 계산해 Tracker 에 넣는다.
import { dodgeField, FLOOR_MODES } from './render.js';

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
 * ctx: { view, canvas, modeList, choiceTrack, modeOpen, resultOpen, game, topInset, cursorFlip, puckFlip, floorMap, PW, PH }
 * cursorFlip: 모드 선택 커서가 v를 뒤집어 쓰는지. puckFlip: 바닥 위 화면에서 내 퍽을 영상 속 퍽과 위아래 반대 자리에 그리는 중
 * (퀵 핸즈·반응 타겟·자유 연습) — 커서 자리에 퍽이 보이도록 거꾸로 읽는다
 */
export function pointerToUV(px, py, ctx) {
  const { view, canvas, game } = ctx;
  if (ctx.modeOpen && ctx.modeList) {
    // 모드 선택: 커서가 카드 목록 위 포인터 자리에 오도록 (main 은 cursorFlip 이면 v를 뒤집어 쓴다)
    const r = ctx.modeList.getBoundingClientRect();
    const vv = clamp01((py - r.top) / r.height);
    return { u: clamp01((px - r.left) / r.width), v: ctx.cursorFlip ? 1 - vv : vv };
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
  if (game.running && !FLOOR_MODES.has(game.mode.id)) {
    // 평면 경기장(흰 판: 퍽 피하기·8자 드리블): 캔버스 안 경기장 사각형 기준
    const f = dodgeField(canvas.width, canvas.height, ctx.topInset);
    const fx = (f.x / canvas.width) * vr.width + vr.left, fy = (f.y / canvas.height) * vr.height + vr.top;
    const fw = (f.w / canvas.width) * vr.width, fh = (f.h / canvas.height) * vr.height;
    const X = (px - fx) / fw, Y = ((py - fy) / fh) * game.plane.A;
    const p0 = game.toPlane(0, 0), p1 = game.toPlane(1, 1);
    return { u: clamp01(inv(X, p0.x, p1.x)), v: clamp01(inv(Y, p0.y, p1.y)) };
  }
  // 그 밖(바닥 위 게임: 와이드·퀵 핸즈·반응 타겟·자유 연습 · 대기 중 가운데 원): 카메라 화면 좌표 그대로
  // (내 퍽을 위아래 반대 자리에 그리는 중이면 거꾸로). 바닥 = 수동으로 맞춘 네 모서리(있으면), 없으면 화면 전체
  const [u, v] = ctx.floorMap ? ctx.floorMap.toUV(nx * ctx.PW, ny * ctx.PH) : [nx, ny];
  return { u: clamp01(u), v: clamp01(ctx.puckFlip ? 1 - v : v) };
}

/** 카메라 영상 처리 결과 대신 쓰는 가짜 결과: 화면 전체가 바닥, 퍽은 포인터 자리 */
export function mouseVisionResult(PW, PH, uv, floorMap = null) {
  // 수동 영역: 카메라 모드와 같이 네 모서리로 만든 원근 사상을 쓴다 (영역 편집이 테스트에서도 그대로 보이게)
  if (floorMap) return { floor: { quad: floorMap.quad, mapping: floorMap, detected: true, locked: true, polygon: [], mode: 'manual', fallback: false }, puck: null, stick: null, puckCandidates: [], mouse: uv };
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
