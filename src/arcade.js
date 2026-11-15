// 아케이드: 웹캠으로 추적한 퍽의 (X, Y)를 화면 하단 플레이 존에 매핑하는 체감형 스틱핸들링 게임
// 좌표계: 화면 폭 = 1 단위, 높이 = aspect (H/W). 플레이 존은 하단 30%.
// 규칙: 제한 시간(Game이 관리) 동안의 점수로 겨룬다. 목숨 없음 — 충돌은 감점 + 콤보 초기화.
import { C, F, rgba, text, pill, sparks, font } from './theme.js';

export const ZONE_RATIO = 0.30;      // 화면 높이 중 플레이 존 비율
export const PUCK_R = 0.022;         // 퍽 아바타 반지름 (화면 폭 단위)
export const HIT_PENALTY = 100;      // 충돌 감점
export const FEVER_BONUS = 300;      // 20콤보마다 보너스
const INVULN_MS = 1500;              // 피격 후 무적
const NEAR_MISS = 0.15;              // 히트박스 바깥 15% = DEKE 범위
const COUNTDOWN_S = 3;               // 헤드업 카운트다운 (페이스오프 서클에 정지)
const PAUSE_AFTER_LOST_MS = 600;     // 추적 끊김이 이 시간을 넘으면 일시정지 (시간도 멈춤)

const DIFF = {
  easy:   { speed: 0.20, interval: 2.1, gapPucks: 2.5, beamWeight: 6,  gateWeight: 14, maxSpeed: 0.55 },
  normal: { speed: 0.26, interval: 1.7, gapPucks: 2.0, beamWeight: 10, gateWeight: 18, maxSpeed: 0.75 },
  hard:   { speed: 0.33, interval: 1.4, gapPucks: 1.5, beamWeight: 14, gateWeight: 22, maxSpeed: 0.95 },
};

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export class Arcade {
  constructor(sfx) {
    this.sfx = sfx;
    this.aspect = 0.75;
    this.floorWidthM = 1.5;
    this.phase = 'idle';   // idle | countdown | play
    this.reset();
  }

  reset() {
    this.score = 0;
    this.combo = 0; this.maxCombo = 0;
    this.dekes = 0; this.passed = 0; this.items = 0; this.hits = 0;
    this.elapsed = 0; this.survivalAcc = 0;
    this.level = 0; this.speedMul = 1;
    this.obstacles = []; this.pickups = []; this.effects = [];
    this.spawnTimer = 0.8; this.pickupTimer = 2.5; this.pickupSide = 1; this.gateSide = 1;
    this.invulnUntil = 0; this.hold = 0; this.countdownShown = -1;
    this.paused = false; this.lostSince = 0;
    this.instruction = ''; this.avatar = null;
    this.startDistance = 0;
    this.idleHold = 0; this.idleAutoStart = false;
  }

  get zoneTop() { return this.aspect * (1 - ZONE_RATIO); }
  get zoneH() { return this.aspect * ZONE_RATIO; }
  get multiplier() { return this.combo >= 20 ? 3 : this.combo >= 10 ? 2 : this.combo >= 5 ? 1.5 : 1; }

  start(puck, difficulty = 'normal', skipCountdown = false) {
    this.reset();
    this.diff = DIFF[difficulty] || DIFF.normal;
    this.startDistance = puck?.distance || 0;
    if (skipCountdown) {
      // 핸즈프리 시작: 이미 원 안에 3초 정지했으므로 바로 GO
      this.phase = 'play';
      this.instruction = 'GO!';
      this._pop(0.5, this.zoneTop - 0.1, 'Go!', C.red, 900, 'script');
      this.sfx?.go?.();
    } else {
      this.phase = 'countdown';
      this.instruction = '퍽을 가운데 원 안에 멈추고 화면을 보세요';
    }
  }

  /** 세로 화면(aspect 큼)에서도 장애물이 같은 시간에 떨어지도록 낙하 속도 보정 */
  get fallScale() { return clamp(this.aspect / 0.5625, 1, 2); }

  /** 추적 좌표(u,v) -> 플레이 존 화면 좌표 */
  toZone(u, v) { return { x: u, y: this.zoneTop + v * this.zoneH }; }

  update(dt, puck, now) {
    for (const e of this.effects) e.age = (now - e.t0) / e.dur;
    this.effects = this.effects.filter((e) => e.age < 1);
    if (this.phase === 'idle') return;

    // 퍽 아바타 위치 (가림 보정: predicted 상태는 추적기의 속도 예측값 사용)
    const tracked = puck.state === 'tracked';
    if (puck.pos) { this.avatar = this.toZone(puck.pos.x, puck.pos.y); this.lostSince = 0; }
    else if (!this.lostSince) this.lostSince = now;
    const lostLong = !puck.pos && this.lostSince && now - this.lostSince > PAUSE_AFTER_LOST_MS;

    if (this.phase === 'countdown') return this._updateCountdown(dt, tracked, now);

    // ---- 플레이 ----
    if (lostLong) { this.paused = true; this.instruction = '퍽을 찾는 중… 퍽을 카메라에 보여주세요'; return; }
    this.paused = false;
    this.elapsed += dt;

    // 시간 점수: 1초마다 +10
    this.survivalAcc += dt;
    while (this.survivalAcc >= 1) { this.survivalAcc -= 1; this._addScore(10); }

    // 난이도 진행: 1000점마다 속도 +10%, 게이트/빔 빈도 증가
    this.level = Math.floor(this.score / 1000);
    this.speedMul = Math.min(this.diff.maxSpeed / this.diff.speed, Math.pow(1.1, this.level));
    const speed = this.diff.speed * this.speedMul * this.fallScale;

    // 스폰
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this._spawnObstacle(speed);
      this.spawnTimer = Math.max(0.75, this.diff.interval / Math.pow(1.06, this.level)) * rand(0.85, 1.15);
    }
    this.pickupTimer -= dt;
    if (this.pickupTimer <= 0) {
      this.pickups.push({ x: this.pickupSide > 0 ? rand(0.62, 0.85) : rand(0.15, 0.38), y: -0.05, r: 0.028, vy: speed, born: now });
      this.pickupSide *= -1; // 좌우 번갈아 -> 8자 경로 유도
      this.pickupTimer = rand(2.2, 3.6);
    }

    const a = this.avatar;
    const canHit = tracked && now >= this.invulnUntil && !!a;

    // 장애물 이동/판정
    for (const o of this.obstacles) {
      if (o.type === 'beam') this._updateBeam(o, dt, a, canHit, now);
      else {
        o.y += o.vy * dt;
        if (a && !o.hit) {
          const rects = this._rects(o);
          const margin = Math.max(0.012, NEAR_MISS * Math.min(o.w, o.h));
          let hit = false, near = false;
          for (const rc of rects) {
            const d = circleRectDist(a.x, a.y, rc);
            if (d <= PUCK_R) hit = true;
            else if (d <= PUCK_R + margin) near = true;
          }
          if (hit && canHit) this._onHit(o, now);
          else if (hit && !canHit) { /* 무적/예측 상태: 판정 없음 */ }
          else if (near) o.nearMiss = true;
          // 통과: 장애물 전체가 퍽 아래로 지나감
          if (!o.hit && !o.passed && o.y - o.h / 2 > a.y + PUCK_R) {
            o.passed = true; this.passed++;
            this._combo(now);
            this._addScore(50, o.x, o.y - o.h / 2 - 0.03, '+50');
            if (o.nearMiss) { this.dekes++; this._addScore(100, a.x, a.y - 0.08, 'Deke! +100', C.red, 'script'); this.sfx?.deke?.(); }
          }
        }
      }
    }
    this.obstacles = this.obstacles.filter((o) => (o.type === 'beam' ? !o.done : o.y - o.h / 2 < this.aspect + 0.05));

    // 황금 퍽
    for (const p of this.pickups) {
      p.y += p.vy * dt;
      if (a && tracked && !p.taken && Math.hypot(a.x - p.x, a.y - p.y) < p.r + PUCK_R) {
        p.taken = true; this.items++;
        this._combo(now);
        this._addScore(200, p.x, p.y - 0.04, '+200');
        this.sfx?.target?.();
      }
    }
    this.pickups = this.pickups.filter((p) => !p.taken && p.y < this.aspect + 0.05);

    this.instruction = this.combo >= 20 ? 'FEVER ×3' : this.combo >= 5 ? `콤보 ${this.combo} ×${this.multiplier}` : '장애물을 피하고 황금 퍽을 모으세요';
  }

  _updateCountdown(dt, tracked, now) {
    const c = this.faceoff();
    const inside = this.avatar && tracked && Math.hypot(this.avatar.x - c.x, this.avatar.y - c.y) < c.r;
    if (inside) this.hold += dt; else if (this.hold > 0) { this.hold = 0; this.countdownShown = -1; }
    const remain = Math.ceil(COUNTDOWN_S - this.hold);
    if (inside && remain !== this.countdownShown && remain > 0) { this.countdownShown = remain; this.sfx?.tick?.(); }
    this.instruction = inside ? `시선은 화면에! ${remain}` : '퍽을 가운데 원 안에 멈추고 화면을 보세요';
    if (this.hold >= COUNTDOWN_S) {
      this.phase = 'play';
      this.instruction = 'GO!';
      this._pop(0.5, this.zoneTop - 0.1, 'Go!', C.red, 900, 'script');
      this.sfx?.go?.();
    }
  }

  faceoff() { return { x: 0.5, y: this.zoneTop + this.zoneH * 0.5, r: 0.07 }; }

  _spawnObstacle(speed) {
    const lvl = this.level;
    const w = { blocker: 50, gate: this.diff.gateWeight + 4 * lvl, beam: this.diff.beamWeight + 4 * lvl, gap: 14 + 2 * lvl };
    const total = w.blocker + w.gate + w.beam + w.gap;
    let r = Math.random() * total, type = 'blocker';
    for (const k of ['blocker', 'gate', 'beam', 'gap']) { if (r < w[k]) { type = k; break; } r -= w[k]; }
    if (type === 'beam' && this.obstacles.some((o) => o.type === 'beam')) type = 'blocker';
    switch (type) {
      case 'blocker': {
        const bw = rand(0.11, 0.2), bh = rand(0.07, 0.1);
        this.obstacles.push({ type, x: rand(0.1, 0.9), y: -bh, w: bw, h: bh, vy: speed, round: Math.random() < 0.5 });
        break;
      }
      case 'gate': {
        const bw = 0.65, bh = 0.055;
        const x = this.gateSide > 0 ? 1 - bw / 2 : bw / 2; // 좌우 번갈아
        this.gateSide *= -1;
        this.obstacles.push({ type, x, y: -bh, w: bw, h: bh, vy: speed * 0.9, side: x > 0.5 ? 'R' : 'L' });
        break;
      }
      case 'gap': {
        const hole = this.diff.gapPucks * PUCK_R * 2;
        this.obstacles.push({ type, x: 0.5, y: -0.06, w: 1, h: 0.05, vy: speed * 0.85, holeX: rand(0.15, 0.85), hole });
        break;
      }
      case 'beam': {
        const near = Math.random() < 0.7; // 70%는 가까운 띠 -> 몸쪽으로 당기기(토 드래그)
        const x = Math.random() < 0.5 ? 0 : 1;
        this.obstacles.push({ type, band: near ? 'near' : 'far', state: 'warn', t: 0, warn: 0.9, sweep: 1.3 / Math.min(1.6, this.speedMul),
          x, dir: x === 0 ? 1 : -1, w: 0.016, h: this.zoneH / 2, y: 0, done: false, nearMiss: false });
        break;
      }
    }
  }

  _updateBeam(o, dt, a, canHit, now) {
    o.t += dt;
    const bandTop = o.band === 'near' ? this.zoneTop + this.zoneH / 2 : this.zoneTop;
    const bandBot = bandTop + this.zoneH / 2;
    if (o.state === 'warn') {
      if (o.t >= o.warn) { o.state = 'fire'; o.t = 0; this.sfx?.beam?.(); }
      return;
    }
    const prevX = o.x;
    o.x = o.dir > 0 ? o.t / o.sweep : 1 - o.t / o.sweep;
    if (a && !o.hit) {
      const inBand = a.y >= bandTop - PUCK_R * 0.5 && a.y <= bandBot + PUCK_R * 0.5;
      const crossed = (prevX - a.x) * (o.x - a.x) <= 0 || Math.abs(o.x - a.x) < o.w / 2 + PUCK_R;
      if (crossed && !o.checked) {
        o.checked = true;
        if (inBand) { if (canHit) this._onHit(o, now); }
        else {
          const boundary = o.band === 'near' ? bandTop : bandBot;
          if (Math.abs(a.y - boundary) < NEAR_MISS * (this.zoneH / 2) + PUCK_R) o.nearMiss = true;
        }
      }
    }
    if (o.t >= o.sweep) {
      o.done = true;
      if (!o.hit) {
        this.passed++; this._combo(now);
        this._addScore(50, 0.5, this.zoneTop - 0.03, '+50');
        if (o.nearMiss && a) { this.dekes++; this._addScore(100, a.x, a.y - 0.08, 'Deke! +100', C.red, 'script'); this.sfx?.deke?.(); }
      }
    }
  }

  _rects(o) {
    if (o.type === 'gap') {
      const h = o.hole / 2;
      return [
        { x0: -0.02, x1: o.holeX - h, y0: o.y - o.h / 2, y1: o.y + o.h / 2 },
        { x0: o.holeX + h, x1: 1.02, y0: o.y - o.h / 2, y1: o.y + o.h / 2 },
      ];
    }
    return [{ x0: o.x - o.w / 2, x1: o.x + o.w / 2, y0: o.y - o.h / 2, y1: o.y + o.h / 2 }];
  }

  /** 충돌: 목숨 대신 감점 + 콤보 초기화 + 1.5초 무적 */
  _onHit(o, now) {
    o.hit = true;
    this.hits++;
    this.combo = 0;
    this.score = Math.max(0, this.score - HIT_PENALTY);
    this.invulnUntil = now + INVULN_MS;
    this.effects.push({ type: 'flash', t0: now, dur: 350, age: 0 });
    this._pop(this.avatar.x, this.avatar.y - 0.07, `충돌 −${HIT_PENALTY}`, C.red, 900);
    this.sfx?.hit?.();
    this.instruction = `충돌 −${HIT_PENALTY} · 1.5초 무적`;
  }

  _combo() {
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    if (this.combo === 5 || this.combo === 10) { this._pop(this.avatar?.x ?? 0.5, (this.avatar?.y ?? this.zoneTop) - 0.12, `Combo ×${this.multiplier}`, C.red, 1000, 'script'); this.sfx?.combo?.(); }
    if (this.combo >= 20 && this.combo % 20 === 0) {
      this.score += FEVER_BONUS;
      this._pop(0.5, this.zoneTop - 0.12, `Fever! +${FEVER_BONUS}`, C.red, 1300, 'script');
      this.sfx?.heal?.();
    }
  }

  _addScore(base, x, y, label, color = C.ink, style = 'display') {
    const pts = Math.round(base * this.multiplier);
    this.score += pts;
    if (label) this._pop(x, y, this.multiplier > 1 && base !== 10 ? `${label} ×${this.multiplier}` : label, color, 900, style);
  }

  _pop(x, y, str, color, dur = 900, style = 'display') { this.effects.push({ type: 'pop', x, y, text: str, color, style, t0: performance.now(), dur, age: 0 }); }

  result(puck) {
    const distM = Math.max(0, (puck?.distance || 0) - this.startDistance) * this.floorWidthM;
    return {
      score: this.score, maxCombo: this.maxCombo, dekes: this.dekes, passed: this.passed, items: this.items, hits: this.hits,
      elapsed: this.elapsed, distanceM: distM, level: this.level,
      items_: [
        ['점수', this.score], ['최고 콤보', this.maxCombo], ['아슬아슬 회피 (DEKE)', this.dekes],
        ['통과한 장애물', this.passed], ['황금 퍽', this.items], ['충돌', this.hits],
        ['퍽 이동 거리', `${distM.toFixed(1)} m`], ['도달 속도', `×${(this.speedMul).toFixed(2)}`],
      ],
    };
  }

  // =================== 렌더링 (화면 좌표, 폭 = W) ===================
  // 종이색으로 덮은 화면 위에 잉크 도형. 레드는 플레이어의 퍽과 스윕 빔에만.
  draw(ctx, W, H, now, puck) {
    const S = W; // 1 단위 = 화면 폭
    const zt = this.zoneTop * S, zh = this.zoneH * S;
    const dpr = W / (ctx.canvas.clientWidth || W);
    const fs = Math.max(11 * dpr, W * 0.019); // 본문 글자 크기 (CSS 11px 이상)
    const hair = Math.max(1.2, W * 0.0016);
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    // 종이 워시: 카메라 영상은 은은하게만 비친다
    ctx.fillStyle = rgba(C.paper, 0.86); ctx.fillRect(0, 0, W, H);
    // 플레이 존: 위쪽 잉크 선 하나 + 가운데 점선
    ctx.fillStyle = rgba(C.paper2, 0.55); ctx.fillRect(0, zt, W, zh);
    ctx.beginPath(); ctx.moveTo(0, zt); ctx.lineTo(W, zt); ctx.lineWidth = hair * 1.4; ctx.strokeStyle = C.ink; ctx.stroke();
    ctx.setLineDash([hair * 2, hair * 6]); ctx.beginPath(); ctx.moveTo(0, zt + zh / 2); ctx.lineTo(W, zt + zh / 2); ctx.lineWidth = hair; ctx.strokeStyle = rgba(C.ink, 0.45); ctx.stroke(); ctx.setLineDash([]);
    text(ctx, 'PLAY ZONE', W * 0.014, zt + fs * 0.9, fs * 0.72, { weight: 600, color: C.mute, align: 'left', halo: false });
    text(ctx, '↑ 몸쪽 · 당기기', W * 0.014, zt + fs * 2.1, fs * 0.8, { weight: 500, color: C.inkSoft, align: 'left', halo: false });
    text(ctx, '↓ 카메라쪽 · 밀기', W - W * 0.014, H - fs * 0.9, fs * 0.8, { weight: 500, color: C.inkSoft, align: 'right', halo: false });

    if (this.phase === 'idle') {
      if (this.idleAutoStart) {
        const c = this.faceoff();
        this._drawCircle(ctx, S, c, Math.min(1, this.idleHold / COUNTDOWN_S));
        if (this.idleHold > 0) text(ctx, String(Math.ceil(COUNTDOWN_S - this.idleHold)), W / 2, zt - W * 0.11, W * 0.13, { family: F.display, weight: 900, halo: false });
        text(ctx, '퍽을 원 안에 3초 두면 시작', W / 2, zt - W * 0.035, fs, { weight: 500, color: C.inkSoft, halo: false });
      } else {
        text(ctx, '시작을 누르면 카운트다운이 시작됩니다', W / 2, zt - W * 0.045, fs, { weight: 500, color: C.inkSoft, halo: false });
      }
      this._drawAvatar(ctx, S, now, puck, true);
      ctx.restore();
      return;
    }

    // 카운트다운: 페이스오프 서클
    if (this.phase === 'countdown') {
      this._drawCircle(ctx, S, this.faceoff(), Math.min(1, this.hold / COUNTDOWN_S));
      if (this.hold > 0) text(ctx, String(Math.ceil(COUNTDOWN_S - this.hold)), W / 2, zt - W * 0.12, W * 0.15, { family: F.display, weight: 900, halo: false });
      else text(ctx, '퍽을 원 안에 멈추세요', W / 2, zt - W * 0.075, W * 0.042, { family: F.display, weight: 900, halo: false });
      text(ctx, 'Head up — 시선은 화면에', W / 2, zt - W * 0.028, fs, { weight: 500, color: C.inkSoft, halo: false });
    }

    for (const o of this.obstacles) {
      if (o.type === 'beam') this._drawBeam(ctx, S, o, now);
      else this._drawObstacle(ctx, S, o, now);
    }
    // 황금 퍽: 옐로 원 + 잉크 외곽선
    for (const p of this.pickups) {
      const x = p.x * S, y = p.y * S, r = p.r * S * (1 + 0.06 * Math.sin(now / 160));
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.72, 0, 0, Math.PI * 2);
      ctx.fillStyle = C.yellow; ctx.fill(); ctx.lineWidth = hair * 1.4; ctx.strokeStyle = C.ink; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x - r * 0.25, y - r * 0.2, r * 0.3, r * 0.14, -0.4, 0, Math.PI * 2); ctx.fillStyle = rgba(C.paper, 0.85); ctx.fill();
      sparks(ctx, x, y, r * 1.45, r * 1.8, 6, C.ink, hair, now / 900);
    }

    this._drawAvatar(ctx, S, now, puck, false);

    // 이펙트
    for (const e of this.effects) {
      if (e.type === 'flash') {
        const a = 1 - e.age, bw = W * 0.012;
        ctx.lineWidth = bw; ctx.strokeStyle = rgba(C.red, a); ctx.strokeRect(bw / 2, bw / 2, W - bw, H - bw);
      } else if (e.type === 'pop') {
        ctx.globalAlpha = Math.min(1, (1 - e.age) * 1.6);
        const script = e.style === 'script';
        const size = script ? W * 0.07 : W * 0.03;
        text(ctx, e.text, clamp(e.x, 0.12, 0.88) * S, Math.max(size, e.y * S - e.age * W * 0.05), size,
          { family: script ? F.script : F.display, weight: script ? 700 : 800, color: e.color, halo: true });
        ctx.globalAlpha = 1;
      }
    }

    if (this.paused && this.phase === 'play') {
      ctx.fillStyle = rgba(C.paper, 0.9); ctx.fillRect(0, 0, W, H);
      text(ctx, '퍽을 찾는 중', W / 2, H / 2 - W * 0.01, W * 0.055, { family: F.display, weight: 900, halo: false });
      text(ctx, '퍽을 카메라에 보이게 두면 이어서 진행됩니다 · 시간은 멈춰 있습니다', W / 2, H / 2 + W * 0.04, fs, { weight: 500, color: C.inkSoft, halo: false });
    }

    text(ctx, `LV ${this.level + 1}  ·  ×${this.speedMul.toFixed(1)}`, W - W * 0.014, zt - fs * 0.9, fs * 0.8, { weight: 600, color: C.mute, align: 'right', halo: false });
    ctx.restore();
  }

  _drawCircle(ctx, S, c, progress) {
    const W = S, cx = c.x * S, cy = c.y * S, r = c.r * S;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = rgba(C.paper, 0.7); ctx.fill();
    ctx.setLineDash(progress > 0 ? [] : [W * 0.008, W * 0.008]); ctx.lineWidth = Math.max(1.5, W * 0.0022); ctx.strokeStyle = C.ink; ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.09, 0, Math.PI * 2); ctx.fillStyle = C.red; ctx.fill();
    if (progress > 0) {
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
      ctx.lineWidth = W * 0.006; ctx.strokeStyle = C.red; ctx.stroke();
    }
  }

  _drawObstacle(ctx, S, o, now) {
    const W = S, hair = Math.max(1.2, W * 0.0016);
    const blink = o.hit && Math.floor(now / 80) % 2 === 0;
    const body = blink ? C.red : C.ink;
    if (o.type === 'gap') {
      const h = o.hole / 2, y0 = (o.y - o.h / 2) * S, hh = o.h * S;
      ctx.fillStyle = body;
      ctx.fillRect(-2, y0, (o.holeX - h) * S + 2, hh);
      ctx.fillRect((o.holeX + h) * S, y0, W - (o.holeX + h) * S + 2, hh);
      // 틈새 표시: 레드 꺾쇠 두 개
      ctx.lineWidth = hair * 2; ctx.strokeStyle = C.red;
      for (const sx of [-1, 1]) { const ex = (o.holeX + sx * h) * S; ctx.beginPath(); ctx.moveTo(ex, y0 - hh * 0.35); ctx.lineTo(ex, y0 + hh * 1.35); ctx.stroke(); }
      text(ctx, '틈새', o.holeX * S, y0 - W * 0.02, W * 0.017, { weight: 600, color: C.ink, halo: false });
      return;
    }
    const x = (o.x - o.w / 2) * S, y = (o.y - o.h / 2) * S, w = o.w * S, h = o.h * S;
    ctx.fillStyle = body;
    ctx.beginPath();
    if (o.type === 'blocker' && o.round) ctx.ellipse(o.x * S, o.y * S, w / 2, h / 2, 0, 0, Math.PI * 2);
    else ctx.roundRect(x, y, w, h, o.type === 'gate' ? h / 2 : W * 0.012);
    ctx.fill();
    if (o.type === 'gate') {
      text(ctx, 'SLALOM', o.x * S, o.y * S, h * 0.42, { weight: 700, color: C.paper, halo: false });
      const openX = o.side === 'R' ? (o.x - o.w / 2) * S * 0.5 : ((o.x + o.w / 2) + (1 - (o.x + o.w / 2)) / 2) * S;
      text(ctx, o.side === 'R' ? '← 왼쪽' : '오른쪽 →', openX, o.y * S, W * 0.022, { weight: 600, color: C.ink, halo: false });
    } else {
      // 수비수: 감은 눈 두 개 + 코 (선 일러스트 느낌)
      const cx = o.x * S, cy = o.y * S, e = h * 0.16;
      ctx.lineWidth = Math.max(1.5, h * 0.045); ctx.strokeStyle = C.paper;
      for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + sx * e * 1.5, cy - e * 0.3, e * 0.55, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(cx, cy - e * 0.1); ctx.lineTo(cx - e * 0.35, cy + e * 0.9); ctx.lineTo(cx + e * 0.2, cy + e * 0.9); ctx.stroke();
    }
  }

  _drawBeam(ctx, S, o, now) {
    const W = S;
    const bandTop = (o.band === 'near' ? this.zoneTop + this.zoneH / 2 : this.zoneTop) * S;
    const bandH = (this.zoneH / 2) * S;
    if (o.state === 'warn') {
      // 경고: 잉크 빗금 + 레드 알약 라벨
      ctx.save();
      ctx.beginPath(); ctx.rect(0, bandTop, W, bandH); ctx.clip();
      ctx.lineWidth = Math.max(1, W * 0.0014); ctx.strokeStyle = rgba(C.ink, 0.22 + 0.18 * (0.5 + 0.5 * Math.sin(now / 70)));
      const step = W * 0.022;
      for (let x = -bandH; x < W + bandH; x += step) { ctx.beginPath(); ctx.moveTo(x, bandTop + bandH); ctx.lineTo(x + bandH, bandTop); ctx.stroke(); }
      ctx.restore();
      const label = o.band === 'near' ? '스윕 — 퍽을 몸쪽으로 당기세요' : '스윕 — 퍽을 카메라 쪽으로 미세요';
      pill(ctx, label, W / 2, bandTop + bandH / 2, Math.max(12, W * 0.022), { bg: C.red, fg: C.paper, border: null, weight: 600 });
      return;
    }
    const x = o.x * S, bw = Math.max(3, o.w * S);
    ctx.fillStyle = rgba(C.red, 0.1); ctx.fillRect(0, bandTop, W, bandH);
    ctx.fillStyle = C.red; ctx.fillRect(x - bw / 2, bandTop, bw, bandH);
    sparks(ctx, x, bandTop + bandH / 2, bw * 1.6, bw * 2.6, 8, C.red, Math.max(1.2, W * 0.0018), now / 200);
  }

  _drawAvatar(ctx, S, now, puck, ghost) {
    const W = S, hair = Math.max(1.2, W * 0.0016);
    const a = this.avatar;
    if (!a) {
      if (ghost) text(ctx, '퍽이 인식되면 여기에 표시됩니다', W / 2, (this.zoneTop + this.zoneH / 2) * S, Math.max(11, W * 0.017), { weight: 500, color: C.mute, halo: false });
      return;
    }
    const x = a.x * S, y = a.y * S, r = PUCK_R * S;
    // 궤적: 가는 레드 선
    if (puck?.trail?.length > 1) {
      for (let i = 1; i < puck.trail.length; i++) {
        const p0 = this.toZone(puck.trail[i - 1].x, puck.trail[i - 1].y), p1 = this.toZone(puck.trail[i].x, puck.trail[i].y);
        const alpha = Math.max(0, 1 - (now - puck.trail[i].t) / 700) * 0.55;
        if (alpha <= 0) continue;
        ctx.beginPath(); ctx.moveTo(p0.x * S, p0.y * S); ctx.lineTo(p1.x * S, p1.y * S);
        ctx.strokeStyle = rgba(C.red, alpha); ctx.lineWidth = hair * 1.5; ctx.stroke();
      }
    }
    const invuln = now < this.invulnUntil;
    if (invuln && Math.floor(now / 100) % 2 === 0) ctx.globalAlpha = 0.3;
    const predicted = puck?.state === 'predicted';
    // 콤보: 방사형 스파크 (5+ 잉크, 10+ 레드, 20+ 이중)
    if (this.combo >= 5 && !ghost) {
      const col = this.combo >= 10 ? C.red : C.ink;
      sparks(ctx, x, y, r * 1.7, r * (2.3 + 0.25 * Math.sin(now / 90)), this.combo >= 10 ? 12 : 8, col, hair * 1.6, now / 500);
      if (this.combo >= 20) sparks(ctx, x, y, r * 2.8, r * 3.3, 12, C.yellow, hair * 2.2, -now / 400);
    }
    // 퍽: 레드 원반 + 잉크 외곽선
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.74, 0, 0, Math.PI * 2);
    if (ghost || predicted) { ctx.fillStyle = rgba(C.red, ghost ? 0.25 : 0.4); ctx.fill(); ctx.setLineDash([hair * 3, hair * 3]); }
    else { ctx.fillStyle = C.red; ctx.fill(); }
    ctx.lineWidth = hair * 1.6; ctx.strokeStyle = C.ink; ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
}

/** 원 중심과 사각형 사이 최단 거리 (내부면 0) */
export function circleRectDist(cx, cy, r) {
  const dx = Math.max(r.x0 - cx, 0, cx - r.x1);
  const dy = Math.max(r.y0 - cy, 0, cy - r.y1);
  return Math.hypot(dx, dy);
}

export { font };
