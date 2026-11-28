// 게임/트레이닝 로직. 좌표는 바닥 정규화 좌표 (u: 0..1 가로, v: 0..1 세로)
import { Arcade, SCORE_MULT } from './arcade.js';
import { clockNow } from './clock.js';
import { C } from './theme.js';

// timed: 제한 시간(1·3·5분 선택) 동안의 점수로 겨루는 모드. 목숨 없음 — 충돌은 감점.
export const MODES = [
  { id: 'arcade', name: '아케이드', en: 'Arcade', duration: 0, timed: true, levels: true,
    desc: '내려오는 퍽을 좌우로 쳐서 피하고 코인을 모으세요.' },
  { id: 'obstacle', name: '퍽 피하기', en: 'Dodge', duration: 0, timed: true, levels: true,
    desc: '네 변에서 날아오는 빨간 퍽을 피하세요.' },
  { id: 'wide', name: '와이드 드리블', en: 'Wide Dribble', duration: 0, timed: true, stages: 3,
    desc: '좌우 끝까지 넓게, 3가지 훈련을 이어서.' },
  { id: 'figure8', name: '8자 드리블', en: 'Figure 8', duration: 45,
    desc: '두 콘 사이를 8자로 돌며 게이트 통과.' },
  { id: 'quick', name: '퀵 핸즈', en: 'Quick Hands', duration: 0, timed: true, stages: 3,
    desc: '3시·6시·9시 방향 박스에서 차례로 빠르게 좌우로.' },
  { id: 'reaction', name: '반응 타겟', en: 'Reaction Target', duration: 30,
    desc: '나타나는 타겟으로 최대한 빨리 이동.' },
  { id: 'free', name: '자유 연습', en: 'Free Practice', duration: 0,
    desc: '번호를 놓아 나만의 코스로 연습.' },
];

export const PLAY_MINUTES = [1, 3, 5];
export const DODGE_HIT_PENALTY = 50;
/** 난이도 (levels: true 인 모드 = 아케이드·퍽 피하기만 난이도가 있다) */
export const LEVELS = [['easy', '쉬움'], ['normal', '보통'], ['hard', '어려움']];
export const levelLabel = (lv) => (LEVELS.find(([k]) => k === lv) || LEVELS[1])[1];
/** 이 모드의 난이도 ('normal' | 'easy' | 'hard'). 난이도가 없는 모드는 항상 'normal' */
export const modeLevel = (modeId, level) => (MODES.find((x) => x.id === modeId)?.levels && (level === 'easy' || level === 'hard') ? level : 'normal');
/**
 * 랭킹 키: 시간제 모드는 시간별로, 투명 모드는 일반과 따로, 난이도는 쉬움·어려움만 따로 집계
 * (예: arcade@60, arcade@60-inv, arcade@60-hard, arcade@60-inv-easy). 보통은 예전 키 그대로라 기존 기록이 이어진다.
 * community.js 의 bragKey 는 보통 난이도 기록만 쓴다
 */
export const rankKey = (modeId, seconds, invisible = false, level = 'normal') => {
  const m = MODES.find((x) => x.id === modeId);
  const lv = modeLevel(modeId, level);
  return (m?.timed ? `${modeId}@${seconds}` : modeId) + (invisible ? '-inv' : '') + (lv === 'normal' ? '' : `-${lv}`);
};

/**
 * 점수 기준 하나로 맞추기: 게임마다 원래 점수(원점수)의 크기가 달랐다 (8자 드리블 수십 점, 퍽 피하기 1분 1000점 안팎).
 * 화면에 보이는 점수 = 원점수 × 배율(랭킹 키마다). 1분(한 판)·보통에서 잘한 판이 100점대 후반이고, 시간(1·3·5분 = 1 : 2.1 : 2.9)과
 * 난이도(쉬움·보통·어려움 = 1 : 1.15 : 1.3)에 따라 길고 어려울수록 커져 최대 500점대.
 * 원점수는 그대로 저장·비교한다 (랭킹·최고 기록·자랑 글은 같은 키 안에서만 비교하므로 순서가 그대로) — 보일 때만 배율을 곱한다.
 * 그래서 예전에 플레이한 기록도 보일 때 같은 기준으로 낮춰지거나 높여진다.
 * 기본 배율은 베타 랭킹의 실제 상위 기록으로 맞췄다 (아케이드 1분 200~365, 퍽 피하기 1분 935~1010, 와이드 1분 158~239, 8자 10~28, 반응 타겟 5~42)
 */
export const SCORE_TIME = { 60: 1, 180: 2.1, 300: 2.9 };
export const SCORE_LEVEL = { easy: 1, normal: 1.15, hard: 1.3 };
// 게임별 기본 배율: 1분(시간이 정해진 게임은 한 판)·쉬움(난이도 없는 게임은 보통) 원점수 1점 -> 보이는 점수
export const SCORE_BASE = { arcade: 0.7, obstacle: 0.15, wide: 0.713, quick: 0.437, figure8: 6, reaction: 4 };
const LEGACY_QUICK_SCALE = 4; // 예전 퀵 핸즈(20초 한 판, 시간 없는 키 'quick') 기록

/** 랭킹 키(rankKey)의 점수 배율. 모르는 키·자유 연습은 1 */
export function scoreScale(key) {
  const m = /^([a-z0-9]+)(?:@(\d+))?(-inv)?(?:-(easy|hard))?$/.exec(String(key || ''));
  if (!m) return 1;
  const id = m[1], sec = m[2] ? Number(m[2]) : 0, lv = m[4] || 'normal';
  const base = SCORE_BASE[id];
  if (!base) return 1;
  if (id === 'quick' && !sec) return LEGACY_QUICK_SCALE;
  // 원점수는 시간에 비례해 쌓이므로 분으로 나눈 뒤 시간 배율을 곱한다 (시간이 정해진 게임·예전 키는 1)
  const min = sec / 60 || 1, time = (SCORE_TIME[sec] ?? min) / min;
  if (id === 'arcade') return (base * time * SCORE_LEVEL[lv]) / (SCORE_MULT[lv] || 1); // 아케이드 원점수에는 난이도 배율이 이미 들어 있다
  if (id === 'obstacle') return base * time * SCORE_LEVEL[lv];
  return base * time; // 와이드·퀵 핸즈(난이도 없음)·8자·반응 타겟
}

/** 보이는 점수 = 원점수 × 배율 (반올림, 0 아래 없음). key: 랭킹 키 */
export const shownScore = (key, raw) => Math.max(0, Math.round((Number(raw) || 0) * scoreScale(key)));

/**
 * 와이드 드리블의 3가지 훈련 (고른 시간만큼 하나씩 이어서).
 * 판(평면 경기장) 가로를 10칸으로 나눠 왼쪽 끝 = 1번, 오른쪽 끝 = 10번. seq 가 없으면 좌우 끝 구역을 번갈아 터치.
 */
export const WIDE_DRILLS = [
  { label: '좌우 끝', seq: null },
  { label: '양 끝 짧은 터치', seq: [1, 2, 1, 10, 9, 10] },
  { label: '양 끝과 가운데', seq: [1, 2, 1, 6, 5, 10, 9, 10, 5, 6] },
];
/** 훈련마다 시작 전 퍽을 가운데 구역에 이만큼(초) 계속 둬야 시작. 그동안 게임 시계는 멈춤 */
export const WIDE_HOLD_SEC = 3;
export const WIDE_HOLD_R = 0.06; // 가운데 대기 동그라미 반지름 (경기장 가로 대비). 판정은 조금 넉넉하게 1.25배
export const WIDE_LANES = 10;
export const WIDE_BAND = 0.6;   // 구역 높이 (경기장 세로 대비, 위아래 가운데)
export const WIDE_END = { x: 0.1375, w: 0.065 }; // 훈련 1의 끝 구역 (0.105~0.17): 안쪽 선(0.17)은 그대로 두고 폭만 절반
/** 와이드 칸 사이 틈 (경기장 가로 대비): 붙은 두 칸을 한 번에 읽지 않게 칸마다 이만큼 띄워 그린다 (판정도 같은 칸) */
export const WIDE_GAP = 0.02;
/** 한 칸을 읽은 뒤 다음 칸을 읽기까지 쉬는 시간(ms): 경계에서 흔들려도 두 칸이 연달아 읽히지 않게 */
export const WIDE_REARM_MS = 120;
/** n번 칸의 가로 가운데 (1 ~ 10) */
export const laneX = (n) => (n - 0.5) / WIDE_LANES;

export const PUCK_R = 0.0125; // 내 퍽(잉크 정원) 반지름 = 목표 판정에 쓰는 크기 (경기장 가로 대비). 예전(0.025)의 절반 — 구역이 겹쳐 읽히지 않게
const CONE_R = 0.045;
// 8자 콘 충돌: 확실한 자리(추적기 confident)가 같은 콘에 이만큼 연속 프레임 닿아야 감점 (한 프레임 튄 값으로 감점하지 않게)
export const CONE_CONFIRM = 2;
// 목표 지점 크기 (경기장 가로 대비): 예전의 절반
export const TARGET_DRAW_R = 0.02125; // 반응 타겟 원 반지름 (예전의 절반)
const REACT_APPROACH = 0.4;       // 타겟 쪽으로 이만큼(폭/초) 빠르게 다가가기 시작하면 '반응'
export const GATE_DRAW_R = 0.01875; // 8자 게이트 원 반지름 (예전의 절반)
export const F8_HOLD_R = 0.055;     // 8자 시작 대기 원 반지름 (가운데). 판정은 1.25배
export const F8_HOLD_SEC = 3;       // 가운데 원에 퍽을 둔 채로 3초(3·2·1을 세며 원이 차오름) -> 시작. 그동안 게임 시계는 멈춤
const F8_CONES = [0.3, 0.7];       // 두 콘의 가로 위치 (세로는 가운데)
/** 퀵 핸즈 박스 (경기장 가로·세로 대비). 예전 가운데 박스(0.272 × 0.4)의 2/3 — 세 방향으로 옮겨 다니도록 작게 */
export const QUICK_BOX = { w: 0.272 * (2 / 3), h: 0.4 * (2 / 3) };
/**
 * 퀵 핸즈 3세트: 고른 시간(1·3·5분)씩 3시 → 6시 → 9시 방향 박스에서 (= 한 사이클). x = 경기장 가로, y = 세로(A배) 비율.
 * 6시 = 화면 아래쪽 (카메라 쪽으로 밀면 위로 가므로 몸쪽), 3시 = 오른쪽, 9시 = 왼쪽
 */
export const QUICK_SETS = [
  { label: '3시 방향', x: 0.75, y: 0.5 },
  { label: '6시 방향', x: 0.5, y: 0.75 },
  { label: '9시 방향', x: 0.25, y: 0.5 },
];

/**
 * 목표 통과 판정: 내 퍽(원)과 목표(원·사각형)가 겹친 넓이가 둘 중 작은 쪽 넓이의 이만큼 이상이면 통과.
 * 점 하나(퍽 가운데)가 아니라 화면에 보이는 퍽 원 전체로 본다 — 퍽이 목표에 걸치기만 해도 인정
 */
export const HIT_OVERLAP = 0.3;

/** 두 원(반지름 r1·r2, 가운데 거리 d)이 겹친 넓이 */
export function circleOverlap(d, r1, r2) {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a = Math.acos(Math.min(1, Math.max(-1, (d * d + r1 * r1 - r2 * r2) / (2 * d * r1))));
  const b = Math.acos(Math.min(1, Math.max(-1, (d * d + r2 * r2 - r1 * r1) / (2 * d * r2))));
  return r1 * r1 * (a - Math.sin(2 * a) / 2) + r2 * r2 * (b - Math.sin(2 * b) / 2);
}

const _reach = new Map();
/** 두 원이 (작은 쪽 넓이 대비) frac 이상 겹치는 가장 먼 가운데 거리. 이 거리보다 가까우면 통과 */
export function overlapReach(r1, r2, frac = HIT_OVERLAP) {
  const key = `${r1}|${r2}|${frac}`;
  let d = _reach.get(key);
  if (d !== undefined) return d;
  const need = frac * Math.PI * Math.min(r1, r2) ** 2;
  let lo = Math.abs(r1 - r2), hi = r1 + r2;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (circleOverlap(m, r1, r2) >= need) lo = m; else hi = m; }
  if (_reach.size > 200) _reach.clear();
  _reach.set(key, lo);
  return lo;
}

/** 원(가운데 c, 반지름 r)과 사각형 z(가운데 x·y, 너비 w, 높이 h)가 겹친 넓이 (세로로 잘라 더함) */
export function discRectOverlap(c, r, z, n = 32) {
  const x0 = Math.max(c.x - r, z.x - z.w / 2), x1 = Math.min(c.x + r, z.x + z.w / 2);
  if (!(x1 > x0)) return 0;
  const y0 = z.y - z.h / 2, y1 = z.y + z.h / 2, dx = (x1 - x0) / n;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const x = x0 + (i + 0.5) * dx, hh = Math.sqrt(Math.max(0, r * r - (x - c.x) ** 2));
    s += Math.max(0, Math.min(c.y + hh, y1) - Math.max(c.y - hh, y0));
  }
  return s * dx;
}

/** 사각형 목표 판정: 내 퍽 원이 사각형과 (작은 쪽 넓이 대비) frac 이상 겹치면 true */
export const discInRect = (c, r, z, frac = HIT_OVERLAP) => discRectOverlap(c, r, z) >= frac * Math.min(Math.PI * r * r, z.w * z.h);

/** 선분 a→b 가 상자 [x0,x1]×[y0,y1] 를 지나는지 (한 프레임 사이에 빠르게 지나쳐도 인정) */
export function segHitsBox(a, b, [x0, x1, y0, y1]) {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}

/**
 * 와이드 구역의 판정 상자: 퍽 가운데(점)가 빨간 구역 안에 들어가면 인정.
 * 양 끝 구역(edge)은 바깥(벽 쪽)으로 끝까지 — 안쪽 선만 넘으면 더 밀어도 인정
 */
export function wideHitBox(z) {
  return [z.edge === 'L' ? -1 : z.x - z.w / 2, z.edge === 'R' ? 2 : z.x + z.w / 2, z.y - z.h / 2, z.y + z.h / 2];
}

/** 반응 타겟 하나 (평면 좌표: 세로는 A배. 무작위 자리) */
const newTarget = (A = 1) => ({ x: rand(0.12, 0.88), y: rand(0.15, 0.85) * A, r: TARGET_DRAW_R, born: clockNow(), lastD: null, lastAt: 0, approachN: 0, approachAt: 0 });

/** 8자 방향: 가운데에서 어느 콘으로 먼저 가는지(L/R) × 콘을 위·아래 어느 쪽부터 도는지(up/down) */
export const FIGURE8_DIRS = ['L-up', 'L-down', 'R-up', 'R-down'];
/**
 * 8자 코스의 게이트 순서. 가운데에서 출발해 첫 콘을 위(또는 아래)부터 한 바퀴 돌고 가운데로,
 * 가운데를 엇갈려 지나 반대쪽 콘도 같은 쪽(위 또는 아래)부터 돌아 가운데로 = 8자 한 바퀴
 */
export function figure8Waypoints(dir = 'L-up') {
  const [side, turn] = FIGURE8_DIRS.includes(dir) ? dir.split('-') : ['L', 'up'];
  const [first, second] = turn === 'down' ? [0.78, 0.22] : [0.22, 0.78];
  const loop = (cx, end) => [{ x: 0.5, y: 0.5 }, { x: cx, y: first }, { x: end, y: 0.5 }, { x: cx, y: second }];
  const left = loop(F8_CONES[0], 0.1), right = loop(F8_CONES[1], 0.9);
  return side === 'R' ? [...right, ...left] : [...left, ...right];
}

const DIFF = {
  // flyMin~flyMax: 날아오는 퍽의 속도 범위(평면 폭/초). 퍽마다 이 안에서 무작위로 정해지고 이후 일정
  easy:   { cones: 2, moving: 0,   speed: 0.10, addEvery: 20, maxCones: 4, flyers: 1, flyEvery: 12, flyMin: 0.18, flyMax: 0.55, flyMax_n: 10 },
  normal: { cones: 3, moving: 0.5, speed: 0.16, addEvery: 15, maxCones: 6, flyers: 2, flyEvery: 9,  flyMin: 0.25, flyMax: 0.85, flyMax_n: 12 },
  hard:   { cones: 5, moving: 1,   speed: 0.24, addEvery: 12, maxCones: 8, flyers: 3, flyEvery: 7,  flyMin: 0.35, flyMax: 1.10, flyMax_n: 14 },
};
export const FLYER_R = 0.0175;     // 날아오는 빨간 퍽 반지름 (평면 폭 단위)
const FLYER_WARN_MS = 650;         // 출발 전 가장자리 경고 시간
const FLYER_MARGIN = 0.12;         // 바닥 바깥 출발/소멸 여유

const rand = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
/** 선분 a-b 와 점 p 의 거리 (빠르게 지나가 프레임 사이에 원을 건너뛰어도 통과로 본다) */
const segDist = (a, b, p) => {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
};
const clamp01 = (x) => Math.min(1, Math.max(0, x));
/** 점과 콘 사이 거리. 움직이는 콘은 좌우 이동 범위(선분) 전체를 차지하는 것으로 계산 */
const coneDist = (p, c) => {
  if (!c.moving) return dist(p, c);
  const x0 = c.baseX - c.amp, x1 = c.baseX + c.amp;
  return Math.hypot(p.x - Math.min(x1, Math.max(x0, p.x)), p.y - c.y);
};

export class Game {
  constructor(sfx) {
    this.sfx = sfx;
    this.arcade = new Arcade(sfx);
    this.mode = MODES[0];
    this.difficulty = 'normal';
    this.playSeconds = 60;   // 시간제 모드의 제한 시간 (60 | 180 | 300)
    this.invisible = false;  // 투명 모드: 플레이 중 내 퍽을 숨김 (랭킹 키가 따로)
    this.figure8Dir = 'L-up'; // 8자 방향 (FIGURE8_DIRS)
    // 퍽 피하기의 평면: 가로 1 × 세로 A (같은 단위). flip = 카메라 쪽으로 밀면 위로. main이 화면에 맞춰 설정
    this.plane = { A: 1, flip: false };
    this.me = null;          // 평면 위의 내 퍽 위치
    // 자유 연습 코스: points = [{n, x, y}] (x, y는 평면 경기장의 0~1 비율), 번호 순으로 정렬. reach = 도착 판정 반경(평면 폭 단위)
    // cycles = 목표 사이클 수(10~100). 한 사이클 = 놓은 포인트를 번호 순서대로 한 번 다 찍는 것
    this.course = { points: [], reach: 0.04, cycles: 10 };
    this.onEnd = null;
    this.running = false;
    this.resetState();
  }

  /** 이 판의 제한 시간(초). 0이면 무제한(자유 연습). 여러 훈련을 잇는 모드(와이드)는 훈련 수 × 고른 시간 */
  get limit() { return this.mode.timed ? this.playSeconds * (this.mode.stages || 1) : this.mode.duration; }
  /** 지금 몇 번째 훈련인지 (0부터) */
  get stage() { return this.mode.stages ? Math.min(this.mode.stages - 1, Math.floor(this.elapsed / this.playSeconds)) : 0; }
  /** 지금 게임(모드·시간·투명·난이도)의 점수 배율 (scoreScale) */
  get scoreK() { return scoreScale(rankKey(this.mode.id, this.playSeconds, this.invisible, this.difficulty)); }
  /** 화면에 보이는 점수 = 원점수(this.score) × 배율 */
  get shownScore() { return Math.max(0, Math.round((Number(this.score) || 0) * this.scoreK)); }
  /** 지금 훈련의 남은 시간(초) */
  get stageLeft() { return this.mode.stages ? Math.max(0, Math.min(this.timeLeft, this.playSeconds * (this.stage + 1) - this.elapsed)) : this.timeLeft; }

  resetState() {
    this.timeLeft = this.limit;
    this.elapsed = 0;
    this.score = 0;
    this.hits = 0;
    this.instruction = '';
    this.cones = [];
    this.targets = [];
    this.zones = [];
    this.waypoints = [];
    this.flyers = [];
    this.me = null;
    this.courseIdx = 0; this.lapStart = 0; this.courseLeft = true;
    this.wpIndex = 0;
    this.wide = null;
    this.effects = [];
    this.stats = {};
    this.invulnUntil = 0;
    this.lastTickSec = -1;
    this._puckTouchesBase = 0;
    this._f8Prev = null;
    this._coneTouch = null; // 8자: 지금 닿아 있는 콘과 연속 프레임 수 (CONE_CONFIRM)
    this._prevMe = null;
    this.f8Hold = null; // 8자 시작 대기 {t: 가운데 원에 퍽을 둔 시간(초)}. null 이면 진행 중
    this.quickSet = 0;  // 퀵 핸즈: 지금 세트 (0 = 3시, 1 = 6시, 2 = 9시)
    this._A = this.plane.A; // 경기장 세로 비율이 바뀌면(화면 회전 등) 코스·목표를 다시 맞춘다
    if (this.mode?.id === 'figure8') this._figure8Course(); // 시작 전에도 코스와 첫 방향(점선)을 미리 보여 준다
    if (this.mode?.id === 'quick') this.zones = [{ ...this._quickZone(0), active: false }]; // 시작 전 첫 세트(3시) 박스 미리보기
  }

  /** 8자 코스 (평면 좌표: 가로 1 × 세로 A). 게이트·콘 자리는 경기장 비율로 정하고 세로만 A배 */
  _figure8Course() {
    const A = this.plane.A;
    this.cones = F8_CONES.map((x) => ({ x, y: 0.5 * A, r: CONE_R, moving: false, hitUntil: 0 }));
    this.waypoints = figure8Waypoints(this.figure8Dir).map((p) => ({ x: p.x, y: p.y * A }));
    this.wpIndex = 0;
  }

  /** 퀵 핸즈 박스 (평면 좌표): set 번째 세트의 방향 자리 */
  _quickZone(set = 0) {
    const A = this.plane.A, s = QUICK_SETS[set] || QUICK_SETS[0];
    return { id: 'C', x: s.x, y: s.y * A, w: QUICK_BOX.w, h: QUICK_BOX.h * A, active: true, warn: false };
  }

  /** 퀵 핸즈: i번째 세트 시작 (고른 시간이 지나면 다음 방향 박스로). 처음 세트는 알림 없이 */
  _quickStage(i) {
    const first = this.quickSet === i;
    this.quickSet = i;
    this.zones = [this._quickZone(i)];
    if (first) return;
    const s = QUICK_SETS[i];
    this._pop(s.x, s.y * this.plane.A, s.label, C.red, 'script');
    this.sfx?.target();
  }

  /** 경기장 세로 비율(A)이 바뀌었을 때: 코스·박스·타겟을 새 비율에 맞춘다 (진행 상황은 그대로) */
  _replane() {
    const A = this.plane.A, old = this._A;
    this._A = A;
    if (!(old > 0) || old === A) return;
    const k = A / old;
    if (this.mode.id === 'figure8') { const i = this.wpIndex; this._figure8Course(); this.wpIndex = i; }
    if (this.mode.id === 'quick' && this.zones.length) this.zones = [this._quickZone(this.quickSet)];
    for (const t of this.targets) t.y *= k;
    if (this._prevMe) this._prevMe.y *= k;
    if (this._f8Prev) this._f8Prev.y *= k;
  }

  /** 가운데 원 판정 (8자 시작 대기): 평면 좌표의 경기장 가운데 */
  get center() { return { x: 0.5, y: 0.5 * this.plane.A }; }

  /** 8자 방향 바꾸기 (게임 중에도). 게이트를 새 방향으로 다시 놓고 가운데 게이트부터 — 점수·바퀴 수·시간은 그대로 */
  setFigure8Dir(dir) {
    this.figure8Dir = FIGURE8_DIRS.includes(dir) ? dir : 'L-up';
    if (this.mode?.id !== 'figure8') return;
    this._figure8Course();
    this._f8Prev = null;
    // 게임 중에 바꾸면 시계를 멈추고, 다시 가운데 원 3초 -> 3·2·1 로 이어서 (점수·바퀴 수·남은 시간은 그대로)
    if (this.running) { this.f8Hold = { t: 0 }; this._f8HoldText(); }
  }

  /** 8자 시작 대기 한 프레임: 가운데 원에 퍽을 둔 채로 3·2·1 (벗어나면 처음부터) -> 다 세면 바로 시작. me: 평면 좌표 */
  _f8HoldStep(dt, me, puck) {
    const h = this.f8Hold, c = this.center;
    const inside = me && puck.state !== 'lost' && Math.hypot(me.x - c.x, me.y - c.y) < F8_HOLD_R * 1.25;
    const before = h.t;
    h.t = inside ? h.t + dt : 0;
    if (inside && before === 0) this.sfx?.tick();                                        // 3
    else if (inside && Math.floor(h.t) > Math.floor(before) && h.t < F8_HOLD_SEC) this.sfx?.tick(); // 2, 1
    if (h.t >= F8_HOLD_SEC) {
      this.f8Hold = null; this._f8Prev = null; this.wpIndex = 0;
      this._pop(c.x, c.y, '시작!', C.red, 'script');
      this.sfx?.go();
      this.instruction = '진한 빨간 원으로 · 옅은 원이 그다음';
      return;
    }
    this._f8HoldText();
  }

  _f8HoldText() {
    const h = this.f8Hold;
    if (!h) return;
    this.instruction = h.t > 0 ? `그대로 두세요 · ${Math.ceil(F8_HOLD_SEC - h.t)}` : '퍽을 가운데 원에 3초 두세요';
  }

  setMode(id) {
    this.mode = MODES.find((m) => m.id === id) || MODES[0];
    this.onModeChange?.(this.mode); // main: 모드마다 다른 앞뒤 방향(plane.flip)을 바로 맞춘다
    this.resetState();
  }

  start(puck, opts = {}) {
    this.resetState();
    this.tracker = puck;
    this.running = true;
    this.startedAt = clockNow();
    const p = puck?.pos ? this.toPlane(puck.pos.x, puck.pos.y) : this.center; // 평면 좌표의 지금 내 퍽 자리

    switch (this.mode.id) {
      case 'arcade':
        this.arcade.start(puck, this.difficulty, !!opts.handsFree);
        this.arcade.scoreK = this.scoreK; // 아케이드가 띄우는 +코인·충돌 숫자도 보이는 점수 기준으로
        this.instruction = this.arcade.instruction;
        break;
      case 'obstacle':
        this.stats = { dodged: 0, hits: 0, close: 0, maxFlyers: 0 };
        this.flyers = [];
        this.flySpawnTimer = 0.6;
        this.instruction = '사방에서 날아오는 빨간 퍽을 피하세요!';
        break;
      case 'wide':
        this.stats = { reps: 0, drills: WIDE_DRILLS.map(() => 0), sets: WIDE_DRILLS.map(() => 0) };
        this._wideStage(0);
        // 시작 원에 퍽을 3초 둬서 시작했으면(자동 시작) 이미 준비된 것: 훈련 1은 바로. 버튼으로 시작하면 훈련 1도 가운데 대기부터
        if (opts.handsFree) { this.wide.hold = null; this._wideZones(); }
        break;
      case 'figure8':
        this._figure8Course();
        this.stats = { laps: 0, gates: 0, hits: 0 };
        this.instruction = '진한 빨간 원으로 · 옅은 원이 그다음';
        // 시작 원에서 이미 3·2·1을 셌으면(자동 시작) 바로 시작. 버튼으로 시작하면 가운데 원에 3초부터
        this.f8Hold = opts.handsFree ? null : { t: 0 };
        this._f8HoldText();
        break;
      case 'quick':
        this._quickStage(0); // 첫 세트: 3시 방향
        this.stats = { touches: 0, outside: 0, sets: QUICK_SETS.map(() => 0) };
        this._puckTouchesBase = puck?.touches || 0;
        this.instruction = '박스 안에서 빠르게 좌우로!';
        break;
      case 'reaction':
        this.stats = { hits: 0, times: [], travel: [] };
        this._spawnTarget(p, 0.3, 0.5); // spawnedAt은 첫 update에서 게임 시계 기준으로 기록
        this.instruction = '타겟이 나타나면 바로 출발!';
        break;
      default: // free: 직접 만든 코스를 번호 순서대로
        this.timeLeft = 0;
        this.stats = { reached: 0, laps: 0, lapTimes: [], touches: 0, distance: 0 };
        this.courseIdx = 0; this.lapStart = 0; this.courseLeft = true;
        this.instruction = this.course.points.length ? `${this.course.points[0].n}번으로` : '자유롭게 드리블하세요';
    }
    this.sfx?.start();
  }

  stop(reason = 'manual') {
    if (!this.running) return;
    this.running = false;
    const result = this._buildResult(reason);
    if (this.mode.id === 'arcade') this.arcade.phase = 'idle';
    this.sfx?.end();
    this.onEnd?.(result);
    return result;
  }

  /** dt: 초, puck: Tracker, now: ms */
  update(dt, puck, now) {
    if (this._A !== this.plane.A) this._replane();
    // 와이드 드리블: 훈련 전 가운데 대기 중에는 게임 시계가 멈춤
    if (!(this.running && ((this.wide && this.wide.hold != null) || this.f8Hold))) this.elapsed += dt;
    for (const e of this.effects) e.age = (now - e.t0) / e.dur;
    this.effects = this.effects.filter((e) => e.age < 1);

    if (!this.running) return;
    const d = DIFF[this.difficulty] || DIFF.normal;

    if (this.limit > 0) {
      this.timeLeft = Math.max(0, this.limit - this.elapsed);
      const left = this.mode.stages ? this.stageLeft : this.timeLeft; // 훈련마다 끝나기 3초 전부터 똑딱
      const sec = Math.ceil(left);
      if (sec <= 3 && sec !== this.lastTickSec && sec > 0) { this.sfx?.tick(); this.lastTickSec = sec; }
      if (this.timeLeft <= 0) { this.stop('time'); return; }
    }

    // 움직이는 콘
    for (const c of this.cones) {
      if (c.moving) {
        c.phase += dt * c.speed * Math.PI * 2 / 2.2;
        c.x = c.baseX + Math.sin(c.phase) * c.amp;
      }
    }

    const pos = puck.pos;
    const tracked = puck.state === 'tracked';
    const pp = pos ? { x: pos.x, y: pos.y } : null;
    // 아케이드를 뺀 모든 모드는 평면 경기장(가로 1 × 세로 A)에서 판정한다 — 화면에 보이는 그대로
    const me = pp && this.mode.id !== 'arcade' ? this.toPlane(pp.x, pp.y) : null;
    if (this.mode.id !== 'arcade') this.me = me;

    switch (this.mode.id) {
      case 'arcade': {
        this.arcade.update(dt, puck, now);
        this.score = this.arcade.score; this.hits = this.arcade.hits; this.instruction = this.arcade.instruction;
        this.elapsed = this.arcade.elapsed; // 카운트다운·일시정지 동안은 시계가 멈춤
        this.timeLeft = Math.max(0, this.limit - this.elapsed);
        break;
      }
      case 'obstacle': {
        const A = this.plane.A;
        // 시간이 지날수록 동시에 날아오는 퍽 수 증가
        const want = Math.min(d.flyMax_n, d.flyers + Math.floor(this.elapsed / d.flyEvery));
        this.flySpawnTimer -= dt;
        if (this.flyers.length < want && this.flySpawnTimer <= 0) {
          this._spawnFlyer(me, d, now, A);
          this.flySpawnTimer = this.flyers.length < want ? rand(0.25, 0.6) : 0;
        }
        this.stats.maxFlyers = Math.max(this.stats.maxFlyers, this.flyers.length);
        this.hits = this.stats.hits;
        this.score = Math.max(0, Math.floor(this.elapsed) * 10 + this.stats.dodged * 5 + this.stats.close * 15 - this.stats.hits * DODGE_HIT_PENALTY);
        // 감점은 확실한 자리로만 (블레이드로 이은 자리·튄 직후 자리로 '맞았다'고 하지 않게)
        const canHit = me && tracked && puck.confident !== false && now >= this.invulnUntil;
        for (const f of this.flyers) {
          if (now < f.launchAt) continue;              // 가장자리 경고 중
          f.x += f.vx * dt; f.y += f.vy * dt;           // 직선 이동 (속도 일정)
          const inside = f.x > -0.02 && f.x < 1.02 && f.y > -0.02 && f.y < A + 0.02;
          if (inside) f.entered = true;
          if (me) {
            const dd = dist(me, f);
            f.minDist = Math.min(f.minDist, dd);
            if (canHit && !f.hit && dd < FLYER_R + PUCK_R) {
              f.hit = true; this.stats.hits++; // 목숨 없음: 감점 + 1.2초 무적
              this.invulnUntil = now + 1200;
              this._pop(f.x, f.y - 0.08, `충돌 −${Math.max(1, Math.round(DODGE_HIT_PENALTY * this.scoreK))}`, C.red);
              this.effects.push({ type: 'flash', t0: now, dur: 350, age: 0 });
              this.sfx?.hit();
            }
          }
          const gone = f.x < -FLYER_MARGIN - 0.05 || f.x > 1 + FLYER_MARGIN + 0.05 || f.y < -FLYER_MARGIN - 0.05 || f.y > A + FLYER_MARGIN + 0.05;
          if (gone && f.entered && !f.counted) {
            f.counted = true;
            if (!f.hit) {
              this.stats.dodged++;
              if (f.minDist < FLYER_R + PUCK_R + 0.035) { this.stats.close++; this._pop(me?.x ?? 0.5, (me?.y ?? A / 2) - 0.1, `아슬! +${Math.max(1, Math.round(15 * this.scoreK))}`, C.red, 'script'); this.sfx?.rep(); }
            }
          }
        }
        this.flyers = this.flyers.filter((f) => !f.counted && now - f.born < 20000);
        const n = this.flyers.filter((f) => now >= f.launchAt).length;
        this.instruction = `동시에 ${Math.max(n, 1)}개`;
        break;
      }
      case 'wide': {
        if (this.stage !== this.wide.stage) this._wideStage(this.stage); // 고른 시간이 지나면 다음 훈련
        else if (this.wide.A !== this.plane.A) this._wideZones();         // 화면 크기가 바뀌면 구역 높이도
        const w = this.wide;
        if (w.hold != null) {
          // 시작 전: 가운데 구역에 3초 계속 두면 시작 (벗어나거나 퍽을 놓치면 처음부터)
          const c = this.zones.find((zz) => zz.hold);
          const inside = me && puck.state !== 'lost' && c && Math.hypot(me.x - c.x, me.y - c.y) < c.r * 1.25;
          const before = Math.floor(w.hold);
          w.hold = inside ? w.hold + dt : 0;
          if (inside && Math.floor(w.hold) > before && w.hold < WIDE_HOLD_SEC) this.sfx?.tick();
          if (w.hold >= WIDE_HOLD_SEC) {
            w.hold = null;
            this._pop(0.5, this.plane.A * 0.5, '시작!', C.red, 'script');
            this.sfx?.go();
          }
          this._wideZones();
          break;
        }
        const z = this.zones.find((zz) => zz.active);
        // 퍽 가운데가 빨간 구역에 들어가면 (빠르게 지나쳐도 선분으로). 칸 사이 틈 + 읽은 뒤 잠깐 쉼 -> 붙은 두 칸을 한 번에 읽지 않음
        const prevW = me && tracked && w.prev && dist(w.prev, me) < 0.15 ? w.prev : me; // 추적이 튄 큰 점프는 선분으로 보지 않음
        w.prev = me && tracked ? { x: me.x, y: me.y } : null;
        if (me && tracked && z && now >= (w.rearmAt || 0) && segHitsBox(prevW, me, wideHitBox(z))) {
          w.rearmAt = now + WIDE_REARM_MS;
          w.prev = null; // 다음 칸은 이 자리부터 새로
          this.stats.reps++; this.stats.drills[w.stage]++; this.score = this.stats.reps;
          this.sfx?.rep();
          if (w.seq) {
            w.idx = (w.idx + 1) % w.seq.length;
            if (w.idx === 0) { this.stats.sets[w.stage]++; this._pop(0.5, this.plane.A * 0.5, `${this.stats.sets[w.stage]}세트!`, C.red, 'script'); this.sfx?.target(); }
            else this._pop(z.x, z.y, '+1', C.ink);
          } else {
            this._pop(z.x, z.y, '+1', C.ink);
            w.idx = 1 - w.idx;
          }
          this._wideZones();
        }
        break;
      }
      case 'figure8': {
        if (this.f8Hold) { this._f8HoldStep(dt, me, puck); break; }
        if (me && tracked) {
          const wp = this.waypoints[this.wpIndex];
          const prev = this._f8Prev && dist(this._f8Prev, me) < 0.15 ? this._f8Prev : me; // 추적이 튄 큰 점프는 선분으로 보지 않음
          this._f8Prev = { x: me.x, y: me.y };
          // 퍽 원이 게이트 원에 30% 이상 겹치면 통과 (빠르게 지나가 프레임 사이에 건너뛰어도 선분으로)
          if (segDist(prev, me, wp) < overlapReach(PUCK_R, GATE_DRAW_R)) {
            this.stats.gates++; this.score += 1;
            this._ring(wp.x, wp.y, GATE_DRAW_R, now); // 숫자 대신 지나간 자리에 퍼지는 고리
            this.sfx?.rep();
            this.wpIndex = (this.wpIndex + 1) % this.waypoints.length;
            if (this.wpIndex === 0) { this.stats.laps++; this.score += 4; this._pop(this.center.x, this.center.y, `${this.stats.laps}바퀴!`, C.red, 'script'); this.sfx?.target(); }
            this.instruction = `다음 게이트 ${this.wpIndex + 1}/${this.waypoints.length}`;
          }
          // 게이트 통과는 블레이드로 이은 자리로도 세지만(블레이드 밑에 덮고 끌고 가는 퍽), 콘 충돌(감점)은 확실한 자리로만
          this._checkCones(me, now, () => { this.stats.hits++; this.score = Math.max(0, this.score - 2); }, puck.confident !== false);
        } else this._coneTouch = null;
        break;
      }
      case 'quick': {
        if (this.stage !== this.quickSet) this._quickStage(this.stage); // 고른 시간이 지나면 다음 방향 박스로 (3시 → 6시 → 9시)
        const z = this.zones[0];
        if (me && tracked) {
          if (discInRect(me, PUCK_R, z)) {
            const touches = puck.touches - this._puckTouchesBase;
            if (touches > this.stats.touches) { this.sfx?.rep(); this.stats.sets[this.quickSet] += touches - this.stats.touches; }
            this.stats.touches = touches; this.score = touches;
            this.instruction = '좋아요, 계속!';
            z.warn = false;
          } else {
            this._puckTouchesBase = puck.touches - this.stats.touches; // 밖에서의 터치는 제외
            this.instruction = '박스 안으로!';
            z.warn = true;
          }
        }
        break;
      }
      case 'reaction': {
        const t = this.targets[0];
        if (t && !t.spawnedAt) t.spawnedAt = now;
        // 반응 시간 = 타겟 출현 후 퍽이 그 타겟 쪽으로 움직이기 시작할 때까지 (이동 시간과 분리).
        // 도착하자마자 다음 타겟이 나오므로 '움직이는 중'이 아니라 '새 타겟 쪽으로 방향을 잡았는가'로 본다 (2프레임 연속)
        if (t && !t.movedAt && tracked && me) {
          const d = dist(me, t);
          const v = t.lastD != null && now > t.lastAt ? (t.lastD - d) / ((now - t.lastAt) / 1000) : 0;
          if (v > REACT_APPROACH) { t.approachAt = t.approachAt || t.lastAt; if (++t.approachN >= 2) t.movedAt = t.approachAt; }
          else { t.approachN = 0; t.approachAt = 0; }
          t.lastD = d; t.lastAt = now;
        }
        if (me && tracked) {
          const prev = this._prevMe && dist(this._prevMe, me) < 0.15 ? this._prevMe : me; // 빠르게 지나가도 선분으로 (튄 점프 제외)
          this._prevMe = { x: me.x, y: me.y };
          this._checkTargets(prev, me, (t) => {
            const total = (now - t.spawnedAt) / 1000;
            const rt = ((t.movedAt || now) - t.spawnedAt) / 1000;
            this.stats.times.push(rt); this.stats.travel.push(total - rt); this.stats.hits++;
            this._ring(t.x, t.y, t.r, now);
            this.score += Math.max(1, Math.round(10 - rt * 8));
            this._pop(t.x, t.y, `반응 ${rt.toFixed(2)}s`, C.ink);
            this.sfx?.target();
            // 도착 즉시 다음 타겟을 무작위 자리에 (기다림 없음)
            this._spawnTarget(me, 0.3, 0.5);
            this.targets[0].spawnedAt = now;
          });
        }
        break;
      }
      default: { // free: 평면에서 번호 순서대로 포인트에 퍽을 가져다 놓기
        const A = this.plane.A;
        const pts = this.course.points;
        if (pts.length && me && tracked) {
          const tg = pts[this.courseIdx % pts.length];
          const dd = Math.hypot(me.x - tg.x, me.y - tg.y * A);
          if (dd > this.course.reach * 1.6) this.courseLeft = true; // 같은 포인트를 다시 찍으려면 한 번 벗어나야 함
          if (dd < overlapReach(PUCK_R, this.course.reach) && this.courseLeft) { // 퍽 원이 목표 원에 30% 이상 걸치면
            this.stats.reached++;
            this.sfx?.rep();
            this.courseIdx++;
            if (pts.length === 1) this.courseLeft = false;
            if (this.courseIdx >= pts.length) {
              // 한 사이클 완료: 걸린 시간 기록
              this.courseIdx = 0;
              const lt = this.elapsed - this.lapStart;
              this.stats.laps++; this.stats.lapTimes.push(lt);
              this._pop(tg.x, tg.y * A - 0.07, `사이클 ${this.stats.laps} · ${lt.toFixed(1)}s`, C.red, 'script');
              this.sfx?.target();
              this.lapStart = this.elapsed;
              if (this.stats.laps >= (this.course.cycles || 10)) { this.score = this.stats.laps; this.stop('done'); return; } // 목표 사이클 달성
            }
            this.instruction = `${pts[this.courseIdx].n}번으로`;
          }
        }
        this.score = pts.length ? this.stats.laps : puck.touches;
        this.stats.touches = puck.touches; this.stats.distance = puck.distance;
      }
    }
  }

  // ---------- 내부 ----------
  /** 추적 좌표(u,v) -> 평면 좌표 (가로 1 × 세로 A, 같은 단위) */
  toPlane(u, v) { return { x: u, y: (this.plane.flip ? 1 - v : v) * this.plane.A }; }

  /** 평면(가로 1 × 세로 A) 바깥 네 변에서 출발해 안쪽 목표점을 향해 직선으로 날아오는 빨간 퍽 */
  _spawnFlyer(playerPos, d, now, A = 1) {
    const p = playerPos || { x: 0.5, y: A / 2 };
    for (let tries = 0; tries < 20; tries++) {
      const side = Math.floor(Math.random() * 4); // 0 위, 1 오른쪽, 2 아래, 3 왼쪽
      const m = FLYER_MARGIN;
      const start = side === 0 ? { x: rand(0.05, 0.95), y: -m } : side === 1 ? { x: 1 + m, y: rand(0.05, 0.95) * A }
        : side === 2 ? { x: rand(0.05, 0.95), y: A + m } : { x: -m, y: rand(0.05, 0.95) * A };
      // 절반은 플레이어 근처를 겨냥, 절반은 무작위 지점
      const aim = Math.random() < 0.5
        ? { x: clamp01(p.x + rand(-0.12, 0.12)), y: Math.min(A, Math.max(0, p.y + rand(-0.12, 0.12))) }
        : { x: rand(0.15, 0.85), y: rand(0.15, 0.85) * A };
      const dx = aim.x - start.x, dy = aim.y - start.y;
      const len = Math.hypot(dx, dy) || 1;
      const speed = rand(d.flyMin, d.flyMax); // 속도는 퍽마다 랜덤, 이후 일정
      const f = { x: start.x, y: start.y, vx: dx / len * speed, vy: dy / len * speed, speed, r: FLYER_R, side,
        launchAt: now + FLYER_WARN_MS, entered: false, hit: false, counted: false, minDist: Infinity, born: now };
      // 플레이어 바로 옆에서 출발하거나(거의 즉시 충돌) 다른 퍽과 겹쳐 출발하지 않도록
      if (dist(f, p) < 0.25) continue;
      if (this.flyers.some((o) => now < o.launchAt && dist(o, f) < 0.1)) continue;
      this.flyers.push(f);
      return f;
    }
    return null;
  }

  /** 반응 타겟을 평면 경기장의 무작위 자리에 (avoid: 지금 내 퍽 자리, 평면 좌표. 그 자리에서 min~max 거리) */
  _spawnTarget(avoid, minDist = 0.25, maxDist = Infinity) {
    const A = this.plane.A;
    for (let tries = 0; tries < 80; tries++) {
      const t = newTarget(A);
      const dd = dist(t, avoid);
      if (dd < minDist || dd > maxDist) continue;
      if (this.cones.some((c) => coneDist(t, c) < c.r + t.r + 0.04)) continue;
      this.targets = [t];
      return;
    }
    // 빈자리를 못 찾으면(경기장이 납작해 거리 범위를 못 맞춤 등) 범위에 가장 가까운 후보를 사용
    let bestT = null, bestD = Infinity;
    for (let i = 0; i < 60; i++) {
      const t = newTarget(A);
      const dd = dist(t, avoid), off = dd < minDist ? minDist - dd : dd > maxDist ? dd - maxDist : 0;
      if (off < bestD) { bestD = off; bestT = t; }
    }
    this.targets = [bestT];
  }

  /** 반응 타겟 판정: 이번 프레임에 퍽이 지나간 선분(prev -> me)이 타겟과 30% 이상 겹치면 */
  _checkTargets(prev, me, onHit) {
    for (const t of [...this.targets]) {
      if (segDist(prev, me, t) < overlapReach(PUCK_R, t.r)) { onHit(t); return; }
    }
  }

  /**
   * 콘 충돌. sure: 확실한 자리(추적기 confident — 직접 본 퍽이 이어짐)일 때만 센다. 블레이드로 이은 자리·예측 자리·튄 직후 자리로는 감점하지 않는다.
   * 같은 콘에 CONE_CONFIRM 프레임 연속 닿아야 충돌 (한 프레임 튄 값으로 감점하지 않게)
   */
  _checkCones(pp, now, onHit, sure = true) {
    if (now < this.invulnUntil) { this._coneTouch = null; return; }
    let touching = null;
    if (sure) for (const c of this.cones) if (dist(pp, c) < c.r + PUCK_R) { touching = c; break; }
    const prev = this._coneTouch;
    this._coneTouch = touching ? { cone: touching, n: prev && prev.cone === touching ? prev.n + 1 : 1 } : null;
    if (!touching || this._coneTouch.n < CONE_CONFIRM) return;
    this._coneTouch = null;
    const c = touching;
    c.hitUntil = now + 500;
    this.invulnUntil = now + 1200;
    this._pop(c.x, c.y - 0.08, '충돌!', C.red);
    this.effects.push({ type: 'flash', t0: now, dur: 350, age: 0 });
    this.sfx?.hit();
    onHit(c);
  }

  /** 와이드 드리블: i번째 훈련 시작 (처음 또는 시간이 지나 다음 훈련으로) */
  _wideStage(i) {
    const first = !this.wide;
    const d = WIDE_DRILLS[i];
    this.wide = { stage: i, seq: d.seq, idx: 0, hold: 0, prev: null, rearmAt: 0 }; // hold: 가운데에 둔 시간(초). null 이면 훈련 진행 중
    this._wideZones();
    if (!first) {
      this._pop(0.5, this.plane.A * 0.5, d.label, C.red, 'script'); // 바뀐 훈련 이름만 (숫자 없이)
      this.sfx?.target();
    }
  }

  /** 지금 목표 구역(빨강)과 그다음 구역(점선)을 평면 좌표로. 구역은 위아래 가운데, 높이 WIDE_BAND */
  _wideZones() {
    const w = this.wide, A = this.plane.A;
    const y = A / 2, h = WIDE_BAND * A;
    w.A = A;
    // 칸 k (1 ~ 10): 칸 폭에서 틈만큼 빼고 그린다. 1번·10번은 벽 쪽으로 열린 끝 칸
    const lane = (k, active) => ({ id: k, n: k, x: laneX(k), y, w: 1 / WIDE_LANES - WIDE_GAP, h, active, next: !active, edge: k === 1 ? 'L' : k === WIDE_LANES ? 'R' : null });
    // 훈련 1의 끝 구역 (L·R)
    const end = (side, active) => ({ id: side, x: side === 'L' ? WIDE_END.x : 1 - WIDE_END.x, y, w: WIDE_END.w, h, active, edge: side });
    if (w.hold != null) {
      // 시작 전: 가운데 대기 구역(차오르는 정도 = progress) + 첫 목표를 옅게 미리
      const first = w.seq ? { ...lane(w.seq[0], false) } : { ...end('L', false), next: true };
      this.zones = [{ id: 'C', x: 0.5, y, r: WIDE_HOLD_R, w: WIDE_HOLD_R * 2, h: WIDE_HOLD_R * 2, active: false, hold: true, progress: Math.min(1, w.hold / WIDE_HOLD_SEC) }, first];
      this.instruction = w.hold > 0 ? `그대로 두세요 · ${Math.ceil(WIDE_HOLD_SEC - w.hold)}` : '퍽을 가운데 동그라미에 3초 두세요';
      return;
    }
    if (!w.seq) {
      // 훈련 1: 좌우 끝 구역을 번갈아 (idx 0 = 왼쪽부터)
      this.zones = [end('L', w.idx === 0), end('R', w.idx === 1)];
      this.instruction = w.idx === 0 ? '← 왼쪽 끝으로' : '오른쪽 끝으로 →';
      return;
    }
    const n = w.seq[w.idx], next = w.seq[(w.idx + 1) % w.seq.length];
    const prev = w.seq[(w.idx + w.seq.length - 1) % w.seq.length];
    this.zones = [lane(n, true), lane(next, false)];
    // 화면에 숫자를 쓰지 않으므로 안내도 방향으로 (직전 자리 기준)
    this.instruction = n < prev ? '← 진한 빨간 영역으로' : '진한 빨간 영역으로 →';
  }

  /** 목표를 지나간 자리에 잠깐 퍼지며 사라지는 잉크 고리 */
  _ring(x, y, r, now) { this.effects.push({ type: 'ring', x, y, r, t0: now, dur: 450, age: 0 }); }

  _pop(x, y, text, color = C.ink, style = 'display') { this.effects.push({ type: 'pop', x, y, text, color, style, t0: clockNow(), dur: 900, age: 0 }); }

  _buildResult(reason) {
    const r = { mode: this.mode, score: this.score, reason, elapsed: this.elapsed, limit: this.limit, seconds: this.mode.timed ? this.playSeconds : 0, invisible: this.invisible, level: modeLevel(this.mode.id, this.difficulty), rankKey: rankKey(this.mode.id, this.playSeconds, this.invisible, this.difficulty), items: [] };
    const minutes = `${Math.round(this.playSeconds / 60)}분`;
    const s = this.stats;
    switch (this.mode.id) {
      case 'arcade': {
        const a = this.arcade.result(this.tracker);
        r.items = [...a.items_, ['게임 시간', minutes]]; r.arcade = a;
        break;
      }
      case 'obstacle':
        r.items = [['점수', this.score], ['피한 퍽', s.dodged], ['아슬아슬 회피', s.close], ['충돌', s.hits], ['최대 동시 퍽', s.maxFlyers], ['게임 시간', minutes]];
        break;
      case 'wide':
        r.items = [['점수', this.score],
          ...WIDE_DRILLS.map((d, i) => [`훈련 ${i + 1} · ${d.label}`, d.seq ? `${s.drills[i]} · ${s.sets[i]}세트` : s.drills[i]]),
          ['분당 터치', Math.round(s.reps / Math.max(1, this.elapsed) * 60)], ['게임 시간', `${minutes} × ${this.mode.stages}`]];
        break;
      case 'figure8':
        r.items = [['점수', this.score], ['완주 바퀴', s.laps], ['통과 게이트', s.gates], ['콘 충돌', s.hits]];
        break;
      case 'quick':
        r.items = [['점수', this.score], ['터치 수', s.touches], ...QUICK_SETS.map((q, i) => [q.label, s.sets?.[i] ?? 0]),
          ['초당 터치', (s.touches / Math.max(1, this.elapsed)).toFixed(2)], ['게임 시간', `${minutes} × ${this.mode.stages}`]];
        break;
      case 'reaction': {
        const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
        const best = s.times.length ? Math.min(...s.times) : 0;
        r.items = [['점수', this.score], ['타겟 성공', s.hits], ['평균 반응', `${mean(s.times).toFixed(2)}s`], ['최고 반응', `${best.toFixed(2)}s`], ['평균 이동', `${mean(s.travel).toFixed(2)}s`]];
        break;
      }
      default: {
        const lt = s.lapTimes || [];
        const sec = (v) => `${v.toFixed(1)}s`;
        const target = this.course.cycles || 10; // 값이 없으면 기본 10 사이클
        r.cycles = { done: s.laps || 0, target, avg: lt.length ? lt.reduce((a, b) => a + b, 0) / lt.length : null, best: lt.length ? Math.min(...lt) : null };
        r.items = this.course.points.length
          ? [['완료 사이클', `${s.laps || 0} / ${target}`],
            ['평균 사이클', lt.length ? sec(r.cycles.avg) : '-'], ['가장 빠른 사이클', lt.length ? sec(r.cycles.best) : '-'], ['가장 느린 사이클', lt.length ? sec(Math.max(...lt)) : '-'],
            ['통과한 포인트', s.reached || 0], ['총 시간', sec(this.elapsed)], ['이동 거리', `${(s.distance || 0).toFixed(1)} 폭`]]
          : [['터치(방향 전환)', s.touches || 0], ['이동 거리', `${(s.distance || 0).toFixed(1)} 폭`], ['연습 시간', `${Math.round(this.elapsed)}s`]];
      }
    }
    // 보이는 점수 (원점수 × 배율): 결과 화면의 '점수'는 이것으로. r.score 는 원점수 그대로 (최고 기록·랭킹에 저장·비교)
    r.shown = shownScore(r.rankKey, r.score);
    for (const it of r.items) if (it[0] === '점수') it[1] = r.shown;
    if (this.tracker?.frames) {
      r.trackRate = this.tracker.trackRate;
      r.items.push(['퍽 추적률', `${Math.round(r.trackRate * 100)}%`]);
    }
    return r;
  }
}
