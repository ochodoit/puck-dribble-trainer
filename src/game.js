// 게임/트레이닝 로직. 좌표는 바닥 정규화 좌표 (u: 0..1 가로, v: 0..1 세로)
import { Arcade } from './arcade.js';
import { C } from './theme.js';

// timed: 제한 시간(1·3·5분 선택) 동안의 점수로 겨루는 모드. 목숨 없음 — 충돌은 감점.
export const MODES = [
  { id: 'arcade', name: '아케이드', en: 'Arcade', duration: 0, timed: true,
    desc: '색색의 퍽이 같은 속도로 내려옵니다. 노란 퍽은 먹고 나머지는 피하세요. 제한 시간 동안의 점수로 겨룹니다.' },
  { id: 'obstacle', name: '퍽 피하기', en: 'Dodge', duration: 0, timed: true,
    desc: '평면 경기장의 네 변에서 직선으로 날아오는 빨간 퍽을 피하세요. 시간이 갈수록 늘어납니다. 충돌은 감점.' },
  { id: 'wide', name: '와이드 드리블', en: 'Wide', duration: 30,
    desc: '좌우 끝 구역을 번갈아 터치. 넓은 가동 범위 훈련.' },
  { id: 'figure8', name: '8자 드리블', en: 'Figure 8', duration: 45,
    desc: '두 콘 사이를 8자로 돌며 순서대로 게이트 통과. 콘을 치면 감점.' },
  { id: 'quick', name: '퀵 핸즈', en: 'Quick hands', duration: 20,
    desc: '가운데 박스 안에서 최대한 빠르게 좌우로 퍽을 움직이세요.' },
  { id: 'reaction', name: '반응 타겟', en: 'Reaction', duration: 30,
    desc: '무작위로 나타나는 타겟으로 퍽을 최대한 빨리 이동. 평균 반응 시간 측정.' },
  { id: 'free', name: '자유 연습', en: 'Free', duration: 0,
    desc: '인식 상태를 보며 자유롭게 드리블. 터치 수·속도·이동 거리 표시. 기록 없음.' },
];

export const PLAY_MINUTES = [1, 3, 5];
export const DODGE_HIT_PENALTY = 50;
/** 랭킹 키: 시간제 모드는 시간별로 따로 집계 (예: arcade@60) */
export const rankKey = (modeId, seconds) => { const m = MODES.find((x) => x.id === modeId); return m?.timed ? `${modeId}@${seconds}` : modeId; };

export const PUCK_R = 0.025;
const CONE_R = 0.045;
const TARGET_R = 0.085;
const WAYPOINT_R = 0.09;

const DIFF = {
  easy:   { cones: 2, moving: 0,   speed: 0.10, addEvery: 20, maxCones: 4, flyers: 1, flyEvery: 12, flyMin: 0.25, flyMax: 0.50, flyMax_n: 10 },
  normal: { cones: 3, moving: 0.5, speed: 0.16, addEvery: 15, maxCones: 6, flyers: 2, flyEvery: 9,  flyMin: 0.35, flyMax: 0.75, flyMax_n: 12 },
  hard:   { cones: 5, moving: 1,   speed: 0.24, addEvery: 12, maxCones: 8, flyers: 3, flyEvery: 7,  flyMin: 0.50, flyMax: 1.00, flyMax_n: 14 },
};
export const FLYER_R = 0.035;      // 날아오는 빨간 퍽 반지름 (바닥 폭 단위)
const FLYER_WARN_MS = 650;         // 출발 전 가장자리 경고 시간
const FLYER_MARGIN = 0.12;         // 바닥 바깥 출발/소멸 여유

const rand = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
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
    // 퍽 피하기의 평면: 가로 1 × 세로 A (같은 단위). flip = 카메라 쪽으로 밀면 위로. main이 화면에 맞춰 설정
    this.plane = { A: 1, flip: false };
    this.me = null;          // 평면 위의 내 퍽 위치
    this.onEnd = null;
    this.running = false;
    this.resetState();
  }

  /** 이 판의 제한 시간(초). 0이면 무제한(자유 연습) */
  get limit() { return this.mode.timed ? this.playSeconds : this.mode.duration; }

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
    this.wpIndex = 0;
    this.effects = [];
    this.stats = {};
    this.invulnUntil = 0;
    this.lastTickSec = -1;
    this._puckTouchesBase = 0;
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
        this.zones = [
          { id: 'L', x: 0.17, y: 0.5, w: 0.26, h: 0.9, active: true },
          { id: 'R', x: 0.83, y: 0.5, w: 0.26, h: 0.9, active: false },
        ];
        this.stats = { reps: 0 };
        this.instruction = '← 왼쪽 구역으로';
        break;
      case 'figure8':
        this.cones = [{ x: 0.3, y: 0.5, r: CONE_R, moving: false, hitUntil: 0 }, { x: 0.7, y: 0.5, r: CONE_R, moving: false, hitUntil: 0 }];
        this.waypoints = [
          { x: 0.5, y: 0.5 }, { x: 0.3, y: 0.22 }, { x: 0.1, y: 0.5 }, { x: 0.3, y: 0.78 },
          { x: 0.5, y: 0.5 }, { x: 0.7, y: 0.22 }, { x: 0.9, y: 0.5 }, { x: 0.7, y: 0.78 },
        ];
        this.wpIndex = 0;
        this.stats = { laps: 0, gates: 0, hits: 0 };
        this.instruction = '가운데 게이트부터 순서대로';
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
      default: // free
        this.timeLeft = 0;
        this.stats = {};
        this.instruction = '자유롭게 드리블하세요';
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
    this.elapsed += dt;
    for (const e of this.effects) e.age = (now - e.t0) / e.dur;
    this.effects = this.effects.filter((e) => e.age < 1);

    if (!this.running) return;
    const d = DIFF[this.difficulty] || DIFF.normal;

    if (this.limit > 0) {
      this.timeLeft = Math.max(0, this.limit - this.elapsed);
      const sec = Math.ceil(this.timeLeft);
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
        if (pp && tracked) {
          const z = this.zones.find((z) => z.active);
          if (z && this._inZone(pp, z)) {
            this.stats.reps++; this.score = this.stats.reps;
            this._pop(z.x, z.y, '+1', C.ink);
            this.sfx?.rep();
            this.zones.forEach((zz) => (zz.active = !zz.active));
            this.instruction = this.zones[0].active ? '← 왼쪽 구역으로' : '오른쪽 구역으로 →';
          }
        }
        break;
      }
      case 'figure8': {
        if (pp && tracked) {
          const wp = this.waypoints[this.wpIndex];
          if (dist(pp, wp) < WAYPOINT_R) {
            this.stats.gates++; this.score += 1;
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
        // 반응 시간 = 타겟 출현 후 퍽이 처음 움직이기 시작할 때까지 (이동 시간과 분리)
        if (t && !t.movedAt && tracked && puck.speed > 0.4) t.movedAt = now;
        if (pp && tracked) {
          this._checkTargets(pp, (t) => {
            const total = (now - t.spawnedAt) / 1000;
            const rt = ((t.movedAt || now) - t.spawnedAt) / 1000;
            this.stats.times.push(rt); this.stats.travel.push(total - rt); this.stats.hits++;
            this.score += Math.max(1, Math.round(10 - rt * 8));
            this._pop(t.x, t.y, `반응 ${rt.toFixed(2)}s`, C.ink);
            this.sfx?.target();
            this.targets = [];
            this.nextSpawn = now + rand(500, 1400); // 예측 못 하게 랜덤 지연
          });
        }
        if (!this.targets.length && this.nextSpawn && now >= this.nextSpawn) {
          this._spawnTarget(pp || { x: 0.5, y: 0.5 }, 0.3, 0.5);
          this.targets[0].spawnedAt = now;
          this.nextSpawn = 0;
        }
        break;
      }
      default: { // free
        this.score = puck.touches;
        this.stats = { touches: puck.touches, distance: puck.distance, speed: puck.speed };
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
      const t = { x: rand(0.12, 0.88), y: rand(0.15, 0.85), r: TARGET_R, born: performance.now() };
      const dd = dist(t, avoid);
      if (dd < minDist || dd > maxDist) continue;
      if (this.cones.some((c) => coneDist(t, c) < c.r + t.r + 0.04)) continue;
      this.targets = [t];
      return;
    }
    // 빈자리를 못 찾으면 콘에서 가장 먼 후보를 사용
    let bestT = null, bestD = -1;
    for (let i = 0; i < 40; i++) {
      const t = { x: rand(0.12, 0.88), y: rand(0.15, 0.85), r: TARGET_R, born: performance.now() };
      const dmin = Math.min(dist(t, avoid), ...this.cones.map((c) => coneDist(t, c)));
      if (dmin > bestD) { bestD = dmin; bestT = t; }
    }
    this.targets = [bestT];
  }

  _checkTargets(pp, onHit) {
    for (const t of [...this.targets]) {
      if (dist(pp, t) < t.r) { onHit(t); return; }
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

  _pop(x, y, text, color = C.ink, style = 'display') { this.effects.push({ type: 'pop', x, y, text, color, style, t0: performance.now(), dur: 900, age: 0 }); }

  _buildResult(reason) {
    const r = { mode: this.mode, score: this.score, reason, elapsed: this.elapsed, limit: this.limit, rankKey: rankKey(this.mode.id, this.playSeconds), items: [] };
    const minutes = `${Math.round(this.limit / 60)}분`;
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
        r.items = [['반복 횟수', s.reps], ['분당 반복', Math.round(s.reps / Math.max(1, this.elapsed) * 60)]];
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
      default:
        r.items = [['터치(방향 전환)', s.touches || 0], ['이동 거리', `${(s.distance || 0).toFixed(1)} 바닥폭`], ['연습 시간', `${Math.round(this.elapsed)}s`]];
    }
    if (this.tracker?.frames) {
      r.trackRate = this.tracker.trackRate;
      r.items.push(['퍽 추적률', `${Math.round(r.trackRate * 100)}%`]);
    }
    return r;
  }
}
