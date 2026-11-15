// 아케이드 서바이벌: 웹캠으로 추적한 퍽의 (X, Y)를 화면 하단 플레이 존에 매핑하는 체감형 스틱핸들링 게임
// 좌표계: 화면 폭 = 1 단위, 높이 = aspect (H/W). 플레이 존은 하단 30%.

export const ZONE_RATIO = 0.30;      // 화면 높이 중 플레이 존 비율
export const PUCK_R = 0.022;         // 퍽 아바타 반지름 (화면 폭 단위)
const INVULN_MS = 1500;              // 피격 후 무적
const NEAR_MISS = 0.15;              // 히트박스 바깥 15% = DEKE 범위
const COUNTDOWN_S = 3;               // 헤드업 카운트다운 (페이스오프 서클에 정지)
const PAUSE_AFTER_LOST_MS = 600;     // 추적 끊김이 이 시간을 넘으면 일시정지

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
    this.phase = 'idle';   // idle | countdown | play | over
    this.reset();
  }

  reset() {
    this.score = 0; this.scoreAcc = 0;
    this.lives = 3; this.combo = 0; this.maxCombo = 0;
    this.dekes = 0; this.passed = 0; this.items = 0; this.hits = 0;
    this.elapsed = 0; this.survivalAcc = 0;
    this.level = 0; this.speedMul = 1;
    this.obstacles = []; this.pickups = []; this.effects = [];
    this.spawnTimer = 0.8; this.pickupTimer = 2.5; this.pickupSide = 1; this.gateSide = 1;
    this.invulnUntil = 0; this.hold = 0; this.countdownShown = -1;
    this.paused = false; this.lostSince = 0; this.feverHealed = 0;
    this.instruction = ''; this.avatar = null; this.lastHeal = 0;
    this.startDistance = 0;
  }

  get zoneTop() { return this.aspect * (1 - ZONE_RATIO); }
  get zoneH() { return this.aspect * ZONE_RATIO; }
  get multiplier() { return this.combo >= 20 ? 3 : this.combo >= 10 ? 2 : this.combo >= 5 ? 1.5 : 1; }

  start(puck, difficulty = 'normal') {
    this.reset();
    this.diff = DIFF[difficulty] || DIFF.normal;
    this.phase = 'countdown';
    this.startDistance = puck?.distance || 0;
    this.instruction = '퍽을 가운데 원 안에 멈추고 화면을 보세요';
  }

  /** 추적 좌표(u,v) -> 플레이 존 화면 좌표 */
  toZone(u, v) { return { x: u, y: this.zoneTop + v * this.zoneH }; }

  update(dt, puck, now) {
    for (const e of this.effects) e.age = (now - e.t0) / e.dur;
    this.effects = this.effects.filter((e) => e.age < 1);
    if (this.phase === 'idle' || this.phase === 'over') return;

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

    // 생존 점수: 1초마다 +10
    this.survivalAcc += dt;
    while (this.survivalAcc >= 1) { this.survivalAcc -= 1; this._addScore(10); }

    // 난이도 진행: 1000점마다 속도 +10%, 게이트/빔 빈도 증가
    this.level = Math.floor(this.score / 1000);
    this.speedMul = Math.min(this.diff.maxSpeed / this.diff.speed, Math.pow(1.1, this.level));
    const speed = this.diff.speed * this.speedMul;

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
            if (o.nearMiss) { this.dekes++; this._addScore(100, a.x, a.y - 0.08, 'DEKE! +100', '#38bdf8'); this.sfx?.deke?.(); }
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
        this._addScore(200, p.x, p.y - 0.04, '+200', '#fbbf24');
        this.sfx?.target?.();
      }
    }
    this.pickups = this.pickups.filter((p) => !p.taken && p.y < this.aspect + 0.05);

    this.instruction = this.combo >= 20 ? 'FEVER! ×3' : this.combo >= 10 ? `콤보 ${this.combo} ×2` : this.combo >= 5 ? `콤보 ${this.combo} ×1.5` : '장애물을 피하고 황금 퍽을 모으세요';
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
      this._pop(0.5, this.zoneTop - 0.1, 'GO!', '#22c55e', 900);
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
        this.obstacles.push({ type, band: near ? 'near' : 'far', state: 'warn', t: 0, warn: 0.9, sweep: 1.3 / Math.min(1.6, this.speedMul),
          x: Math.random() < 0.5 ? 0 : 1, dir: 1, w: 0.016, h: this.zoneH / 2, y: 0, done: false, nearMiss: false });
        const b = this.obstacles[this.obstacles.length - 1];
        b.dir = b.x === 0 ? 1 : -1;
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
        if (o.nearMiss && a) { this.dekes++; this._addScore(100, a.x, a.y - 0.08, 'DEKE! +100', '#38bdf8'); this.sfx?.deke?.(); }
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

  _onHit(o, now) {
    o.hit = true;
    this.lives--; this.hits++;
    this.combo = 0;
    this.invulnUntil = now + INVULN_MS;
    this.effects.push({ type: 'flash', t0: now, dur: 350, age: 0 });
    this._pop(this.avatar.x, this.avatar.y - 0.07, '충돌!', '#ef4444', 800);
    this.sfx?.hit?.();
    if (this.lives <= 0) { this.phase = 'over'; this.instruction = '게임 오버'; }
    else this.instruction = '무적 1.5초! 퍽을 빼세요';
  }

  _combo(now) {
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    if (this.combo === 5 || this.combo === 10) { this._pop(this.avatar?.x ?? 0.5, (this.avatar?.y ?? this.zoneTop) - 0.12, `콤보 ×${this.multiplier}`, this.combo >= 10 ? '#fbbf24' : '#38bdf8', 1000); this.sfx?.combo?.(); }
    if (this.combo >= 20 && this.combo % 20 === 0) {
      this._pop(0.5, this.zoneTop - 0.12, 'FEVER ×3!', '#f472b6', 1200);
      if (this.lives < 3) { this.lives++; this._pop(0.5, this.zoneTop - 0.05, '❤ 회복', '#f87171', 1200); this.sfx?.heal?.(); }
      else this.sfx?.combo?.();
    }
  }

  _addScore(base, x, y, text, color = '#22c55e') {
    const pts = Math.round(base * this.multiplier);
    this.score += pts;
    if (text) this._pop(x, y, this.multiplier > 1 && base !== 10 ? `${text} ×${this.multiplier}` : text, color, 900);
  }

  _pop(x, y, text, color, dur = 900) { this.effects.push({ type: 'pop', x, y, text, color, t0: performance.now(), dur, age: 0 }); }

  result(puck) {
    const distM = Math.max(0, (puck?.distance || 0) - this.startDistance) * this.floorWidthM;
    return {
      score: this.score, maxCombo: this.maxCombo, dekes: this.dekes, passed: this.passed, items: this.items, hits: this.hits,
      elapsed: this.elapsed, distanceM: distM, level: this.level,
      items_: [
        ['점수', this.score], ['최고 콤보', this.maxCombo], ['아슬아슬 회피 (DEKE)', this.dekes],
        ['통과한 장애물', this.passed], ['황금 퍽', this.items], ['생존 시간', `${this.elapsed.toFixed(1)}s`],
        ['퍽 이동 거리', `${distM.toFixed(1)} m`], ['도달 속도', `×${(this.speedMul).toFixed(2)}`],
      ],
    };
  }

  // =================== 렌더링 (화면 좌표, 폭 = W) ===================
  draw(ctx, W, H, now, puck) {
    const S = W; // 1 단위 = 화면 폭
    const zt = this.zoneTop * S, zh = this.zoneH * S;
    const font = Math.round(W * 0.03);
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    // 배경 어둡게 + 플레이 존
    ctx.fillStyle = 'rgba(2,6,23,0.5)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(56,189,248,0.08)'; ctx.fillRect(0, zt, W, zh);
    ctx.setLineDash([W * 0.015, W * 0.01]); ctx.strokeStyle = 'rgba(56,189,248,0.6)'; ctx.lineWidth = W * 0.003;
    ctx.beginPath(); ctx.moveTo(0, zt); ctx.lineTo(W, zt); ctx.stroke();
    ctx.setLineDash([W * 0.006, W * 0.012]); ctx.strokeStyle = 'rgba(148,163,184,0.35)';
    ctx.beginPath(); ctx.moveTo(0, zt + zh / 2); ctx.lineTo(W, zt + zh / 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(148,163,184,0.7)'; ctx.font = `${Math.round(font * 0.7)}px system-ui`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('↑ 몸쪽(당기기)', W * 0.012, zt + W * 0.008);
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText('↓ 카메라쪽(밀기)', W - W * 0.012, H - W * 0.008);

    if (this.phase === 'idle') {
      this._text(ctx, '시작을 누르면 카운트다운이 시작됩니다', W / 2, zt - W * 0.05, font, '#e5e7eb');
      this._drawAvatar(ctx, S, now, puck, true);
      ctx.restore();
      return;
    }

    // 카운트다운: 페이스오프 서클
    if (this.phase === 'countdown') {
      const c = this.faceoff();
      const cx = c.x * S, cy = c.y * S, r = c.r * S;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(239,68,68,0.15)'; ctx.fill();
      ctx.lineWidth = W * 0.006; ctx.strokeStyle = '#ef4444'; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.12, 0, Math.PI * 2); ctx.fillStyle = '#ef4444'; ctx.fill();
      if (this.hold > 0) {
        ctx.beginPath(); ctx.arc(cx, cy, r * 1.18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (this.hold / COUNTDOWN_S));
        ctx.lineWidth = W * 0.01; ctx.strokeStyle = '#22c55e'; ctx.stroke();
        this._text(ctx, String(Math.ceil(COUNTDOWN_S - this.hold)), W / 2, zt - W * 0.12, font * 4, '#fff', true);
      } else {
        this._text(ctx, '퍽을 원 안에 멈추세요', W / 2, zt - W * 0.06, font * 1.3, '#fca5a5', true);
      }
      this._text(ctx, '👀 시선은 화면에 (헤드업)', W / 2, zt - W * 0.02, font, '#e5e7eb');
    }

    // 장애물
    for (const o of this.obstacles) {
      if (o.type === 'beam') this._drawBeam(ctx, S, o, now);
      else this._drawObstacle(ctx, S, o, now);
    }
    // 황금 퍽
    for (const p of this.pickups) {
      const x = p.x * S, y = p.y * S, r = p.r * S * (1 + 0.08 * Math.sin(now / 150));
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      g.addColorStop(0, '#fef3c7'); g.addColorStop(0.5, '#fbbf24'); g.addColorStop(1, '#b45309');
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.7, 0, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = W * 0.003; ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x, y, r * 1.6, r * 1.1, 0, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(251,191,36,0.35)'; ctx.stroke();
    }

    this._drawAvatar(ctx, S, now, puck, false);

    // 이펙트
    for (const e of this.effects) {
      if (e.type === 'flash') { ctx.fillStyle = `rgba(239,68,68,${0.4 * (1 - e.age)})`; ctx.fillRect(0, 0, W, H); }
      else if (e.type === 'pop') {
        ctx.globalAlpha = 1 - e.age;
        const big = e.text.startsWith('DEKE') || e.text.startsWith('FEVER') || e.text === 'GO!';
        this._text(ctx, e.text, clamp(e.x, 0.08, 0.92) * S, Math.max(font, e.y * S - e.age * W * 0.06), font * (big ? 1.9 : 1.2), e.color, true);
        ctx.globalAlpha = 1;
      }
    }

    if (this.paused && this.phase === 'play') {
      ctx.fillStyle = 'rgba(2,6,23,0.55)'; ctx.fillRect(0, 0, W, H);
      this._text(ctx, '퍽을 찾는 중…', W / 2, H / 2, font * 1.8, '#f59e0b', true);
      this._text(ctx, '퍽을 카메라에 보이게 두면 이어서 진행됩니다', W / 2, H / 2 + font * 2, font, '#e5e7eb');
    }
    if (this.phase === 'over') this._text(ctx, 'GAME OVER', W / 2, zt - W * 0.08, font * 2.4, '#ef4444', true);

    // 레벨/속도 표시
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(226,232,240,0.7)'; ctx.font = `${Math.round(font * 0.8)}px system-ui`;
    ctx.fillText(`LV ${this.level + 1} · 속도 ×${this.speedMul.toFixed(1)}`, W - W * 0.012, zt - W * 0.008);
    ctx.restore();
  }

  _drawObstacle(ctx, S, o, now) {
    const W = S;
    const hitFlash = o.hit && (Math.floor(now / 80) % 2 === 0);
    if (o.type === 'gap') {
      const h = o.hole / 2;
      const rects = [[-0.02, o.holeX - h], [o.holeX + h, 1.02]];
      for (const [x0, x1] of rects) {
        const g = ctx.createLinearGradient(0, (o.y - o.h / 2) * S, 0, (o.y + o.h / 2) * S);
        g.addColorStop(0, hitFlash ? '#fca5a5' : '#c084fc'); g.addColorStop(1, hitFlash ? '#ef4444' : '#6d28d9');
        ctx.fillStyle = g;
        ctx.fillRect(x0 * S, (o.y - o.h / 2) * S, (x1 - x0) * S, o.h * S);
      }
      // 구멍 표시
      ctx.setLineDash([W * 0.01, W * 0.008]); ctx.strokeStyle = 'rgba(34,197,94,0.9)'; ctx.lineWidth = W * 0.003;
      ctx.strokeRect((o.holeX - h) * S, (o.y - o.h / 2) * S, o.hole * S, o.h * S); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = `700 ${Math.round(W * 0.022)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('↓ 틈새', o.holeX * S, (o.y - o.h / 2) * S - W * 0.02);
      return;
    }
    const x = (o.x - o.w / 2) * S, y = (o.y - o.h / 2) * S, w = o.w * S, h = o.h * S;
    const g = ctx.createLinearGradient(x, y, x, y + h);
    if (o.type === 'gate') { g.addColorStop(0, hitFlash ? '#fca5a5' : '#fb923c'); g.addColorStop(1, hitFlash ? '#ef4444' : '#c2410c'); }
    else { g.addColorStop(0, hitFlash ? '#fca5a5' : '#f87171'); g.addColorStop(1, hitFlash ? '#ef4444' : '#991b1b'); }
    ctx.fillStyle = g;
    ctx.beginPath();
    if (o.type === 'blocker' && o.round) ctx.ellipse(o.x * S, o.y * S, w / 2, h / 2, 0, 0, Math.PI * 2);
    else ctx.roundRect(x, y, w, h, W * 0.012);
    ctx.fill();
    ctx.lineWidth = W * 0.003; ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.stroke();
    if (o.type === 'gate') {
      // 경고 줄무늬 + 열린 쪽 화살표
      ctx.save(); ctx.clip();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = h * 0.5;
      for (let sx = x - h; sx < x + w + h; sx += h * 1.2) { ctx.beginPath(); ctx.moveTo(sx, y + h); ctx.lineTo(sx + h, y); ctx.stroke(); }
      ctx.restore();
      ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(W * 0.03)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(o.side === 'R' ? '◀ 왼쪽으로' : '오른쪽으로 ▶', o.side === 'R' ? (o.x - o.w / 2) * S * 0.5 : ((o.x + o.w / 2) + (1 - (o.x + o.w / 2)) / 2) * S, o.y * S);
    } else {
      // 수비수 아이콘 (헬멧)
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.arc(o.x * S, o.y * S - h * 0.08, h * 0.22, Math.PI, 0); ctx.fill();
      ctx.fillRect(o.x * S - h * 0.22, o.y * S - h * 0.08, h * 0.44, h * 0.1);
    }
  }

  _drawBeam(ctx, S, o, now) {
    const W = S;
    const bandTop = (o.band === 'near' ? this.zoneTop + this.zoneH / 2 : this.zoneTop) * S;
    const bandH = (this.zoneH / 2) * S;
    if (o.state === 'warn') {
      const blink = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(now / 70));
      ctx.fillStyle = `rgba(239,68,68,${blink * 0.5})`; ctx.fillRect(0, bandTop, W, bandH);
      ctx.strokeStyle = `rgba(239,68,68,${blink + 0.3})`; ctx.lineWidth = W * 0.004; ctx.strokeRect(W * 0.002, bandTop, W - W * 0.004, bandH);
      const label = o.band === 'near' ? '⚠ 스윕 빔! 퍽을 몸쪽으로 당기세요 (토 드래그)' : '⚠ 스윕 빔! 퍽을 카메라 쪽으로 미세요';
      this._text(ctx, label, W / 2, bandTop + bandH / 2, Math.round(W * 0.03), '#fecaca', true);
      return;
    }
    const x = o.x * S;
    ctx.fillStyle = 'rgba(239,68,68,0.12)'; ctx.fillRect(0, bandTop, W, bandH);
    const grad = ctx.createLinearGradient(x - W * 0.03, 0, x + W * 0.03, 0);
    grad.addColorStop(0, 'rgba(239,68,68,0)'); grad.addColorStop(0.5, 'rgba(254,202,202,0.95)'); grad.addColorStop(1, 'rgba(239,68,68,0)');
    ctx.fillStyle = grad; ctx.fillRect(x - W * 0.03, bandTop, W * 0.06, bandH);
    ctx.fillStyle = '#fff'; ctx.fillRect(x - o.w * S / 2, bandTop, o.w * S, bandH);
  }

  _drawAvatar(ctx, S, now, puck, ghost) {
    const W = S;
    const a = this.avatar;
    if (!a) {
      if (ghost) this._text(ctx, '퍽이 인식되면 여기에 표시됩니다', W / 2, (this.zoneTop + this.zoneH / 2) * S, Math.round(W * 0.025), '#94a3b8');
      return;
    }
    const x = a.x * S, y = a.y * S, r = PUCK_R * S;
    // 궤적
    if (puck?.trail?.length > 1) {
      for (let i = 1; i < puck.trail.length; i++) {
        const p0 = this.toZone(puck.trail[i - 1].x, puck.trail[i - 1].y), p1 = this.toZone(puck.trail[i].x, puck.trail[i].y);
        const alpha = Math.max(0, 1 - (now - puck.trail[i].t) / 700) * 0.6;
        if (alpha <= 0) continue;
        ctx.beginPath(); ctx.moveTo(p0.x * S, p0.y * S); ctx.lineTo(p1.x * S, p1.y * S);
        ctx.strokeStyle = `rgba(56,189,248,${alpha})`; ctx.lineWidth = r * 0.5 * (i / puck.trail.length) + 1; ctx.stroke();
      }
    }
    const invuln = now < this.invulnUntil;
    if (invuln && Math.floor(now / 100) % 2 === 0) ctx.globalAlpha = 0.35;
    const predicted = puck?.state === 'predicted';
    // 콤보 불꽃
    if (this.combo >= 5 && !ghost) {
      const gold = this.combo >= 10, fever = this.combo >= 20;
      for (let k = 0; k < (fever ? 9 : 6); k++) {
        const ang = now / 300 + k * (Math.PI * 2 / (fever ? 9 : 6));
        const fr = r * (1.5 + 0.4 * Math.sin(now / 90 + k));
        const fx = x + Math.cos(ang) * fr, fy = y - r * 0.6 + Math.sin(ang) * fr * 0.6 - Math.abs(Math.sin(now / 120 + k)) * r;
        ctx.beginPath(); ctx.ellipse(fx, fy, r * 0.45, r * 0.8, ang, 0, Math.PI * 2);
        ctx.fillStyle = fever ? `hsla(${(now / 4 + k * 40) % 360},90%,60%,0.75)` : gold ? 'rgba(251,191,36,0.75)' : 'rgba(56,189,248,0.7)';
        ctx.fill();
      }
    }
    ctx.beginPath(); ctx.ellipse(x, y, r * 2, r * 1.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = predicted ? 'rgba(245,158,11,0.2)' : 'rgba(56,189,248,0.22)'; ctx.fill();
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, '#475569'); g.addColorStop(1, '#0f172a');
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.72, 0, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = W * 0.004; ctx.strokeStyle = predicted ? '#f59e0b' : ghost ? 'rgba(148,163,184,0.8)' : '#38bdf8'; ctx.stroke();
    ctx.globalAlpha = 1;
  }

  _text(ctx, text, x, y, size, color, bold = false) {
    ctx.font = `${bold ? 800 : 500} ${Math.round(size)}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, size * 0.14); ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }
}

/** 원 중심과 사각형 사이 최단 거리 (내부면 0) */
export function circleRectDist(cx, cy, r) {
  const dx = Math.max(r.x0 - cx, 0, cx - r.x1);
  const dy = Math.max(r.y0 - cy, 0, cy - r.y1);
  return Math.hypot(dx, dy);
}
