// 게임/트레이닝 로직. 좌표는 바닥 정규화 좌표 (u: 0..1 가로, v: 0..1 세로)
import { Arcade } from './arcade.js';
import { C } from './theme.js';

// timed: 제한 시간(1·3·5분 선택) 동안의 점수로 겨루는 모드. 목숨 없음 — 충돌은 감점.
export const MODES = [
  { id: 'arcade', name: '아케이드', en: 'Arcade', duration: 0, timed: true,
    desc: '내려오는 퍽을 좌우로 쳐서 피하고 coin을 모으세요.' },
  { id: 'obstacle', name: '퍽 피하기', en: 'Dodge', duration: 0, timed: true,
    desc: '네 변에서 날아오는 빨간 퍽을 피하세요.' },
  { id: 'wide', name: '와이드 드리블', en: 'Wide', duration: 0, timed: true, stages: 3,
    desc: '좌우 끝까지 넓게, 3가지 훈련을 이어서.' },
  { id: 'figure8', name: '8자 드리블', en: 'Figure 8', duration: 45,
    desc: '두 콘 사이를 8자로 돌며 게이트 통과.' },
  { id: 'quick', name: '퀵 핸즈', en: 'Quick hands', duration: 20,
    desc: '가운데 박스 안에서 빠르게 좌우로.' },
  { id: 'reaction', name: '반응 타겟', en: 'Reaction', duration: 30,
    desc: '나타나는 타겟으로 최대한 빨리 이동.' },
  { id: 'free', name: '자유 연습', en: 'Free · course', duration: 0,
    desc: '번호를 놓아 나만의 코스로 연습.' },
];

export const PLAY_MINUTES = [1, 3, 5];
export const DODGE_HIT_PENALTY = 50;
/** 랭킹 키: 시간제 모드는 시간별로, 투명 모드는 일반과 따로 집계 (예: arcade@60, arcade@60-inv). community.js 의 bragKey 와 같은 규칙 */
export const rankKey = (modeId, seconds, invisible = false) => {
  const m = MODES.find((x) => x.id === modeId);
  return (m?.timed ? `${modeId}@${seconds}` : modeId) + (invisible ? '-inv' : '');
};

/**
 * 와이드 드리블의 3가지 훈련 (고른 시간만큼 하나씩 이어서).
 * 판(평면 경기장) 가로를 10칸으로 나눠 왼쪽 끝 = 1번, 오른쪽 끝 = 10번. seq 가 없으면 좌우 끝 구역을 번갈아 터치.
 */
export const WIDE_DRILLS = [
  { label: '좌우 끝', seq: null },
  { label: '양 끝 짧은 터치', seq: [1, 2, 1, 10, 9, 10] },
  { label: '양 끝과 가운데', seq: [1, 2, 1, 6, 5, 6, 5, 10, 9, 10, 5, 6, 5, 6] },
];
/** 훈련마다 시작 전 퍽을 가운데 구역에 이만큼(초) 계속 둬야 시작. 그동안 게임 시계는 멈춤 */
export const WIDE_HOLD_SEC = 3;
export const WIDE_HOLD_W = 0.2; // 가운데 대기 구역 폭 (5·6번 칸 두 칸)
export const WIDE_LANES = 10;
export const WIDE_BAND = 0.6;   // 구역 높이 (경기장 세로 대비, 위아래 가운데)
export const WIDE_END = { x: 0.105, w: 0.13 }; // 훈련 1의 끝 구역: 예전(폭 0.26)의 절반 두께, 바깥 끝은 그대로
/** n번 칸의 가로 가운데 (1 ~ 10) */
export const laneX = (n) => (n - 0.5) / WIDE_LANES;

export const PUCK_R = 0.025;
const CONE_R = 0.045;
// 목표 지점 크기 (바닥 폭 단위): 예전의 절반. 판정 반경은 그린 원보다 조금 넉넉하게
export const TARGET_DRAW_R = 0.02125; // 반응 타겟 그린 원 반지름 (예전의 절반)
const TARGET_HIT_R = 0.026;       // 반응 타겟 판정 반경 (그린 원보다 조금 넉넉하게)
const REACT_APPROACH = 0.4;       // 타겟 쪽으로 이만큼(폭/초) 빠르게 다가가기 시작하면 '반응'
const WAYPOINT_R = 0.0225;        // 8자 게이트 판정 반경 (그린 원보다 조금 넉넉하게)
export const GATE_DRAW_R = 0.01875; // 8자 게이트 그린 원 반지름 (예전의 절반)
const F8_CONES = [0.3, 0.7];       // 두 콘의 가로 위치 (세로는 가운데)

/** 반응 타겟 하나 (무작위 자리, 판정 반경은 그린 원보다 조금 넉넉) */
const newTarget = () => ({ x: rand(0.12, 0.88), y: rand(0.15, 0.85), r: TARGET_DRAW_R, hitR: TARGET_HIT_R, born: performance.now(), lastD: null, lastAt: 0, approachN: 0, approachAt: 0 });

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
    if (this.mode?.id === 'figure8') this._figure8Course(); // 시작 전에도 코스와 첫 방향(점선)을 미리 보여 준다
  }

  _figure8Course() {
    this.cones = F8_CONES.map((x) => ({ x, y: 0.5, r: CONE_R, moving: false, hitUntil: 0 }));
    this.waypoints = figure8Waypoints(this.figure8Dir);
    this.wpIndex = 0;
  }

  setMode(id) {
    this.mode = MODES.find((m) => m.id === id) || MODES[0];
    this.resetState();
  }

  start(puck, opts = {}) {
    this.resetState();
    this.tracker = puck;
    this.running = true;
    this.startedAt = performance.now();
    const d = DIFF[this.difficulty] || DIFF.normal;
    const p = puck?.pos || { x: 0.5, y: 0.5 };

    switch (this.mode.id) {
      case 'arcade':
        this.arcade.start(puck, this.difficulty, !!opts.handsFree);
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
        break;
      case 'quick':
        this.zones = [{ id: 'C', x: 0.5, y: 0.5, w: 0.34, h: 0.5, active: true }];
        this.stats = { touches: 0, outside: 0 };
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
    // 와이드 드리블: 훈련 전 가운데 대기 중에는 게임 시계가 멈춤
    if (!(this.running && this.wide && this.wide.hold != null)) this.elapsed += dt;
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

    switch (this.mode.id) {
      case 'arcade': {
        this.arcade.update(dt, puck, now);
        this.score = this.arcade.score; this.hits = this.arcade.hits; this.instruction = this.arcade.instruction;
        this.elapsed = this.arcade.elapsed; // 카운트다운·일시정지 동안은 시계가 멈춤
        this.timeLeft = Math.max(0, this.limit - this.elapsed);
        break;
      }
      case 'obstacle': {
        // 바닥 원근이 아니라 평면에서 판정: 퍽의 (u,v)를 가로 1 × 세로 A 평면 좌표로 옮긴다
        const A = this.plane.A;
        const me = pp ? this.toPlane(pp.x, pp.y) : null;
        this.me = me;
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
        const canHit = me && tracked && now >= this.invulnUntil;
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
              this._pop(f.x, f.y - 0.08, `충돌 −${DODGE_HIT_PENALTY}`, C.red);
              this.effects.push({ type: 'flash', t0: now, dur: 350, age: 0 });
              this.sfx?.hit();
            }
          }
          const gone = f.x < -FLYER_MARGIN - 0.05 || f.x > 1 + FLYER_MARGIN + 0.05 || f.y < -FLYER_MARGIN - 0.05 || f.y > A + FLYER_MARGIN + 0.05;
          if (gone && f.entered && !f.counted) {
            f.counted = true;
            if (!f.hit) {
              this.stats.dodged++;
              if (f.minDist < FLYER_R + PUCK_R + 0.035) { this.stats.close++; this._pop(me?.x ?? 0.5, (me?.y ?? A / 2) - 0.1, '아슬! +15', C.red, 'script'); this.sfx?.rep(); }
            }
          }
        }
        this.flyers = this.flyers.filter((f) => !f.counted && now - f.born < 20000);
        const n = this.flyers.filter((f) => now >= f.launchAt).length;
        this.instruction = `동시에 ${Math.max(n, 1)}개`;
        break;
      }
      case 'wide': {
        // 평면 경기장에서 판정 (퍽 피하기·자유 연습과 같은 좌표·방향)
        const me = pp ? this.toPlane(pp.x, pp.y) : null;
        this.me = me;
        if (this.stage !== this.wide.stage) this._wideStage(this.stage); // 고른 시간이 지나면 다음 훈련
        else if (this.wide.A !== this.plane.A) this._wideZones();         // 화면 크기가 바뀌면 구역 높이도
        const w = this.wide;
        if (w.hold != null) {
          // 시작 전: 가운데 구역에 3초 계속 두면 시작 (벗어나거나 퍽을 놓치면 처음부터)
          const c = this.zones.find((zz) => zz.hold);
          const inside = me && puck.state !== 'lost' && c && this._inZone(me, c);
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
        if (me && tracked && z && this._inZone(me, z)) {
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
        if (pp && tracked) {
          const wp = this.waypoints[this.wpIndex];
          const prev = this._f8Prev && dist(this._f8Prev, pp) < 0.15 ? this._f8Prev : pp; // 추적이 튄 큰 점프는 선분으로 보지 않음
          this._f8Prev = { x: pp.x, y: pp.y };
          if (segDist(prev, pp, wp) < WAYPOINT_R) {
            this.stats.gates++; this.score += 1;
            this._ring(wp.x, wp.y, GATE_DRAW_R, now); // 숫자 대신 지나간 자리에 퍼지는 고리
            this.sfx?.rep();
            this.wpIndex = (this.wpIndex + 1) % this.waypoints.length;
            if (this.wpIndex === 0) { this.stats.laps++; this.score += 4; this._pop(0.5, 0.5, `${this.stats.laps}바퀴!`, C.red, 'script'); this.sfx?.target(); }
            this.instruction = `다음 게이트 ${this.wpIndex + 1}/${this.waypoints.length}`;
          }
          this._checkCones(pp, now, () => { this.stats.hits++; this.score = Math.max(0, this.score - 2); });
        }
        break;
      }
      case 'quick': {
        const z = this.zones[0];
        if (pp && tracked) {
          if (this._inZone(pp, z)) {
            const touches = puck.touches - this._puckTouchesBase;
            if (touches > this.stats.touches) { this.sfx?.rep(); }
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
        if (t && !t.movedAt && tracked && pp) {
          const d = dist(pp, t);
          const v = t.lastD != null && now > t.lastAt ? (t.lastD - d) / ((now - t.lastAt) / 1000) : 0;
          if (v > REACT_APPROACH) { t.approachAt = t.approachAt || t.lastAt; if (++t.approachN >= 2) t.movedAt = t.approachAt; }
          else { t.approachN = 0; t.approachAt = 0; }
          t.lastD = d; t.lastAt = now;
        }
        if (pp && tracked) {
          this._checkTargets(pp, (t) => {
            const total = (now - t.spawnedAt) / 1000;
            const rt = ((t.movedAt || now) - t.spawnedAt) / 1000;
            this.stats.times.push(rt); this.stats.travel.push(total - rt); this.stats.hits++;
            this._ring(t.x, t.y, t.r, now);
            this.score += Math.max(1, Math.round(10 - rt * 8));
            this._pop(t.x, t.y, `반응 ${rt.toFixed(2)}s`, C.ink);
            this.sfx?.target();
            // 도착 즉시 다음 타겟을 무작위 자리에 (기다림 없음)
            this._spawnTarget(pp, 0.3, 0.5);
            this.targets[0].spawnedAt = now;
          });
        }
        break;
      }
      default: { // free: 평면에서 번호 순서대로 포인트에 퍽을 가져다 놓기
        const A = this.plane.A;
        const me = pp ? this.toPlane(pp.x, pp.y) : null;
        this.me = me;
        const pts = this.course.points;
        if (pts.length && me && tracked) {
          const tg = pts[this.courseIdx % pts.length];
          const dd = Math.hypot(me.x - tg.x, me.y - tg.y * A);
          if (dd > this.course.reach * 1.6) this.courseLeft = true; // 같은 포인트를 다시 찍으려면 한 번 벗어나야 함
          if (dd < this.course.reach && this.courseLeft) {
            this.stats.reached++;
            this.sfx?.rep();
            this.courseIdx++;
            if (pts.length === 1) this.courseLeft = false;
            if (this.courseIdx >= pts.length) {
              // 한 사이클 완료: 걸린 시간 기록
              this.courseIdx = 0;
              const lt = this.elapsed - this.lapStart;
              this.stats.laps++; this.stats.lapTimes.push(lt);
              this._pop(tg.x, tg.y * A - 0.07, `Cycle ${this.stats.laps} · ${lt.toFixed(1)}s`, C.red, 'script');
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

  _spawnTarget(avoid, minDist = 0.25, maxDist = Infinity) {
    for (let tries = 0; tries < 80; tries++) {
      const t = newTarget();
      const dd = dist(t, avoid);
      if (dd < minDist || dd > maxDist) continue;
      if (this.cones.some((c) => coneDist(t, c) < c.r + t.r + 0.04)) continue;
      this.targets = [t];
      return;
    }
    // 빈자리를 못 찾으면 콘에서 가장 먼 후보를 사용
    let bestT = null, bestD = -1;
    for (let i = 0; i < 40; i++) {
      const t = newTarget();
      const dmin = Math.min(dist(t, avoid), ...this.cones.map((c) => coneDist(t, c)));
      if (dmin > bestD) { bestD = dmin; bestT = t; }
    }
    this.targets = [bestT];
  }

  _checkTargets(pp, onHit) {
    for (const t of [...this.targets]) {
      if (dist(pp, t) < (t.hitR || t.r)) { onHit(t); return; }
    }
  }

  _checkCones(pp, now, onHit) {
    if (now < this.invulnUntil) return;
    for (const c of this.cones) {
      if (dist(pp, c) < c.r + PUCK_R) {
        c.hitUntil = now + 500;
        this.invulnUntil = now + 1200;
        this._pop(c.x, c.y - 0.08, '충돌!', C.red);
        this.effects.push({ type: 'flash', t0: now, dur: 350, age: 0 });
        this.sfx?.hit();
        onHit(c);
        return;
      }
    }
  }

  _inZone(p, z) { return Math.abs(p.x - z.x) < z.w / 2 && Math.abs(p.y - z.y) < z.h / 2; }

  /** 와이드 드리블: i번째 훈련 시작 (처음 또는 시간이 지나 다음 훈련으로) */
  _wideStage(i) {
    const first = !this.wide;
    const d = WIDE_DRILLS[i];
    this.wide = { stage: i, seq: d.seq, idx: 0, hold: 0 }; // hold: 가운데에 둔 시간(초). null 이면 훈련 진행 중
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
    if (w.hold != null) {
      // 시작 전: 가운데 대기 구역(차오르는 정도 = progress) + 첫 목표를 옅게 미리
      const first = w.seq
        ? { id: w.seq[0], n: w.seq[0], x: laneX(w.seq[0]), y, w: 1 / WIDE_LANES, h, active: false, next: true }
        : { id: 'L', x: WIDE_END.x, y, w: WIDE_END.w, h, active: false, next: true };
      this.zones = [{ id: 'C', x: 0.5, y, w: WIDE_HOLD_W, h, active: false, hold: true, progress: Math.min(1, w.hold / WIDE_HOLD_SEC) }, first];
      this.instruction = w.hold > 0 ? '그대로 두세요' : '퍽을 가운데에 3초 두세요';
      return;
    }
    if (!w.seq) {
      // 훈련 1: 좌우 끝 구역을 번갈아 (idx 0 = 왼쪽부터)
      this.zones = [
        { id: 'L', x: WIDE_END.x, y, w: WIDE_END.w, h, active: w.idx === 0 },
        { id: 'R', x: 1 - WIDE_END.x, y, w: WIDE_END.w, h, active: w.idx === 1 },
      ];
      this.instruction = w.idx === 0 ? '← 왼쪽 끝으로' : '오른쪽 끝으로 →';
      return;
    }
    const n = w.seq[w.idx], next = w.seq[(w.idx + 1) % w.seq.length];
    const prev = w.seq[(w.idx + w.seq.length - 1) % w.seq.length];
    const lane = (k, active) => ({ id: k, n: k, x: laneX(k), y, w: 1 / WIDE_LANES, h, active, next: !active });
    this.zones = [lane(n, true), lane(next, false)];
    // 화면에 숫자를 쓰지 않으므로 안내도 방향으로 (직전 자리 기준)
    this.instruction = n < prev ? '← 진한 빨간 영역으로' : '진한 빨간 영역으로 →';
  }

  /** 목표를 지나간 자리에 잠깐 퍼지며 사라지는 잉크 고리 */
  _ring(x, y, r, now) { this.effects.push({ type: 'ring', x, y, r, t0: now, dur: 450, age: 0 }); }

  _pop(x, y, text, color = C.ink, style = 'display') { this.effects.push({ type: 'pop', x, y, text, color, style, t0: performance.now(), dur: 900, age: 0 }); }

  _buildResult(reason) {
    const r = { mode: this.mode, score: this.score, reason, elapsed: this.elapsed, limit: this.limit, seconds: this.mode.timed ? this.playSeconds : 0, invisible: this.invisible, rankKey: rankKey(this.mode.id, this.playSeconds, this.invisible), items: [] };
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
        r.items = [['터치 수', s.touches], ['초당 터치', (s.touches / Math.max(1, this.elapsed)).toFixed(2)]];
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
    if (this.tracker?.frames) {
      r.trackRate = this.tracker.trackRate;
      r.items.push(['퍽 추적률', `${Math.round(r.trackRate * 100)}%`]);
    }
    return r;
  }
}
