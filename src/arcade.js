// 아케이드: 웹캠으로 추적한 퍽의 (X, Y)를 화면 하단 플레이 존에 매핑하는 체감형 스틱핸들링 게임
// 좌표계: 화면 폭 = 1 단위, 높이 = aspect (H/W). 좌우 테두리 안쪽이 경기장 레인, 플레이 존은 하단 30%.
// 규칙: 색이 다른 퍽들이 무작위 위치에서 같은 속도로 내려온다. 노란 퍽만 먹고, 나머지 색은 피한다.
//       제한 시간(Game이 관리) 동안의 점수로 겨룬다. 목숨 없음 — 충돌은 감점 + 콤보 초기화.
import { C, F, rgba, text, sparks, font } from './theme.js';

export const ZONE_RATIO = 0.30;      // 화면 높이 중 플레이 존 비율
export const FIELD_MARGIN = 0.05;    // 좌우 테두리 위치 (화면 폭 비율)
export const PUCK_R = 0.022;         // 내 퍽 반지름 (화면 폭 단위)
export const HIT_PENALTY = 100;      // 충돌 감점
export const FEVER_BONUS = 300;      // 20콤보마다 보너스
export const DODGE_LANE = 0.08;      // 이 거리 안으로 스쳐 지나간 퍽만 '피했다'로 인정 (+50)
const INVULN_MS = 1500;              // 피격 후 무적
const NEAR_MISS = 0.15;              // 히트박스 바깥 15% = DEKE 범위
const COUNTDOWN_S = 3;               // 헤드업 카운트다운 (페이스오프 서클에 정지)
const PAUSE_AFTER_LOST_MS = 600;     // 추적 끊김이 이 시간을 넘으면 일시정지 (시간도 멈춤)

// 피해야 하는 퍽의 색 (팬톤 계열, 레드·옐로와 겹치지 않게). 레드 = 나, 옐로 = 먹는 퍽.
export const PUCK_COLORS = [
  C.ink,        // 잉크 블랙
  '#1F4E8C',    // PANTONE Classic Blue 계열
  '#2F7D62',    // PANTONE 7724 C 계열 그린
  '#7A5C99',    // PANTONE 7676 C 계열 바이올렛
];

// speed: 낙하 속도(화면 폭/초) — 한 판 내내 일정. 난이도는 '개수'로만 올라간다.
const DIFF = {
  easy:   { speed: 0.20, interval: 1.25, minInterval: 0.55 },
  normal: { speed: 0.26, interval: 1.00, minInterval: 0.42 },
  hard:   { speed: 0.32, interval: 0.80, minInterval: 0.32 },
};

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export class Arcade {
  constructor(sfx) {
    this.sfx = sfx;
    this.aspect = 0.75;
    this.floorWidthM = 1.5;
    this.flipY = true;     // true: 카메라 쪽으로 밀면 화면 위로(퍽들이 내려오는 쪽), 몸쪽으로 당기면 아래로
    this.wash = 0.88;      // 경기장 종이 배경의 불투명도 (1 = 카메라 영상 완전히 가림, 0 = 영상 그대로)
    this.phase = 'idle';   // idle | countdown | play
    this.reset();
  }

  reset() {
    this.score = 0;
    this.combo = 0; this.maxCombo = 0;
    this.dekes = 0; this.passed = 0; this.items = 0; this.hits = 0;
    this.elapsed = 0; this.survivalAcc = 0;
    this.level = 0;
    this.obstacles = []; this.pickups = []; this.effects = [];
    this.spawnTimer = 0.8; this.pickupTimer = 2.5; this.pickupSide = 1; this.lastSpawnX = -1;
    this.invulnUntil = 0; this.hold = 0; this.countdownShown = -1;
    this.paused = false; this.lostSince = 0;
    this.instruction = ''; this.avatar = null;
    this.startDistance = 0;
    this.idleHold = 0; this.idleAutoStart = false;
  }

  get zoneTop() { return this.aspect * (1 - ZONE_RATIO); }
  get zoneH() { return this.aspect * ZONE_RATIO; }
  get multiplier() { return this.combo >= 20 ? 3 : this.combo >= 10 ? 2 : this.combo >= 5 ? 1.5 : 1; }
  /** 세로 화면(aspect 큼)에서도 같은 시간에 떨어지도록 낙하 속도 보정 */
  get fallScale() { return clamp(this.aspect / 0.5625, 1, 2); }
  /** 낙하 속도: 한 판 내내 일정 (모든 퍽 동일) */
  get speed() { return (this.diff || DIFF.normal).speed * this.fallScale; }
  /** 퍽이 나오는 간격: 레벨이 오를수록 짧아진다 (속도 대신 개수로 난이도 상승) */
  interval() { const d = this.diff || DIFF.normal; return Math.max(d.minInterval, d.interval / (1 + 0.16 * this.level)); }

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

  /** 추적 좌표(u,v) -> 테두리 안쪽 플레이 존 화면 좌표 */
  toZone(u, v) { return { x: FIELD_MARGIN + u * (1 - 2 * FIELD_MARGIN), y: this.zoneTop + (this.flipY ? 1 - v : v) * this.zoneH }; }

  update(dt, puck, now) {
    for (const e of this.effects) e.age = (now - e.t0) / e.dur;
    this.effects = this.effects.filter((e) => e.age < 1);
    if (this.phase === 'idle') return;

    // 내 퍽 위치 (가림 보정: predicted 상태는 추적기의 속도 예측값 사용)
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

    // 난이도 진행: 1000점마다 레벨 +1 -> 퍽이 더 자주 나온다 (속도는 그대로)
    this.level = Math.floor(this.score / 1000);
    const vy = this.speed;

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) { this._spawnPuck(vy); this.spawnTimer = this.interval() * rand(0.8, 1.2); }
    this.pickupTimer -= dt;
    if (this.pickupTimer <= 0) {
      const lo = FIELD_MARGIN + 0.08, hi = 1 - FIELD_MARGIN - 0.08, mid = 0.5;
      this.pickups.push({ x: this.pickupSide > 0 ? rand(mid + 0.1, hi) : rand(lo, mid - 0.1), y: -0.05, r: 0.026, vy, born: now });
      this.pickupSide *= -1; // 좌우 번갈아 -> 8자 경로 유도
      this.pickupTimer = rand(2.2, 3.6);
    }

    const a = this.avatar;
    const canHit = tracked && now >= this.invulnUntil && !!a;

    // 내려오는 퍽: 이동 + 판정 (원-원)
    for (const o of this.obstacles) {
      o.y += o.vy * dt;
      if (!a) continue;
      const d = Math.hypot(a.x - o.x, a.y - o.y);
      if (d < o.minDist) o.minDist = d;
      const touch = o.r + PUCK_R;
      if (!o.hit) {
        if (d <= touch) { if (canHit) this._onHit(o, now); }
        else if (d <= touch + Math.max(0.012, NEAR_MISS * o.r * 2)) o.nearMiss = true;
      }
      // 통과: 퍽 전체가 내 퍽 아래로 지나감. 가까이 스친 퍽만 '피했다'로 인정
      if (!o.passed && o.y - o.r > a.y + PUCK_R) {
        o.passed = true;
        if (!o.hit && o.minDist < touch + DODGE_LANE) {
          this.passed++;
          this._combo(now);
          this._addScore(50, o.x, o.y - o.r - 0.03, '+50');
          if (o.nearMiss) { this.dekes++; this._addScore(100, a.x, a.y - 0.08, 'Deke! +100', C.red, 'script'); this.sfx?.deke?.(); }
        }
      }
    }
    this.obstacles = this.obstacles.filter((o) => o.y - o.r < this.aspect + 0.05);

    // 노란 퍽: 먹으면 +200
    for (const p of this.pickups) {
      p.y += p.vy * dt;
      if (a && tracked && !p.taken && Math.hypot(a.x - p.x, a.y - p.y) < p.r + PUCK_R) {
        p.taken = true; this.items++;
        this._combo(now);
        this._addScore(200, p.x, p.y - 0.04, '+200');
        this.sfx?.target?.();
      }
    }
    this.pickups = this.pickups.filter((p) => !p.taken && p.y - p.r < this.aspect + 0.05);

    this.instruction = this.combo >= 20 ? 'FEVER ×3' : this.combo >= 5 ? `콤보 ${this.combo} ×${this.multiplier}` : '노란 퍽은 먹고, 나머지는 피하세요';
  }

  _updateCountdown(dt, tracked) {
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

  /** 색이 다른 퍽 하나를 테두리 안쪽 무작위 위치 위에서 떨어뜨린다 (속도는 모두 같음) */
  _spawnPuck(vy) {
    const r = rand(0.026, 0.042);
    const lo = FIELD_MARGIN + r, hi = 1 - FIELD_MARGIN - r;
    let x = rand(lo, hi);
    // 바로 앞 퍽과 같은 자리에 겹쳐 나오지 않게 한 번 다시 뽑기
    if (this.lastSpawnX >= 0 && Math.abs(x - this.lastSpawnX) < 0.1) x = rand(lo, hi);
    this.lastSpawnX = x;
    const color = PUCK_COLORS[Math.floor(Math.random() * PUCK_COLORS.length)];
    const o = { x, y: -r, r, vy, color, minDist: Infinity, passed: false, hit: false, nearMiss: false };
    this.obstacles.push(o);
    return o;
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
        ['피한 퍽', this.passed], ['노란 퍽', this.items], ['충돌', this.hits],
        ['퍽 이동 거리', `${distM.toFixed(1)} m`], ['레벨', this.level + 1],
      ],
    };
  }

  // =================== 렌더링 (화면 좌표, 폭 = W) ===================
  // 종이색 화면 + 좌우 헤어라인 테두리. 모든 퍽은 외곽선 없는 정원. 레드 = 나, 옐로 = 먹는 퍽.
  draw(ctx, W, H, now, puck) {
    const S = W; // 1 단위 = 화면 폭
    const dpr = W / (ctx.canvas.clientWidth || W);
    const zt = this.zoneTop * S, zh = this.zoneH * S;
    const fs = Math.max(11 * dpr, W * 0.017);   // 본문 글자 (CSS 11px 이상)
    const hair = Math.max(1, dpr);              // 헤어라인: 화면상 1px
    const L = FIELD_MARGIN * S, Rr = (1 - FIELD_MARGIN) * S;
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    // 종이 워시: 레인 안쪽은 영상이 은은하게 비치고, 테두리 바깥은 종이로 덮는다
    ctx.fillStyle = rgba(C.paper, this.wash); ctx.fillRect(L, 0, Rr - L, H);
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, L, H); ctx.fillRect(Rr, 0, W - Rr, H);
    // 플레이 존 바탕
    ctx.fillStyle = rgba(C.paper2, 0.5 * this.wash); ctx.fillRect(L, zt, Rr - L, zh);
    // 좌우 테두리 + 플레이 존 경계 (모두 헤어라인)
    ctx.lineWidth = hair; ctx.strokeStyle = C.ink;
    ctx.beginPath(); ctx.moveTo(L, 0); ctx.lineTo(L, H); ctx.moveTo(Rr, 0); ctx.lineTo(Rr, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(L, zt); ctx.lineTo(Rr, zt); ctx.stroke();
    text(ctx, 'PLAY ZONE', L + W * 0.012, zt + fs * 0.95, fs * 0.66, { weight: 600, color: C.mute, align: 'left', halo: false });
    text(ctx, `LV ${this.level + 1}`, Rr - W * 0.012, zt + fs * 0.95, fs * 0.66, { weight: 600, color: C.mute, align: 'right', halo: false });
    // 방향 안내: 위 = 카메라 쪽으로 밀기, 아래 = 몸쪽으로 당기기 (flipY=false면 반대)
    const up = this.flipY ? '↑ 카메라쪽 · 밀기' : '↑ 몸쪽 · 당기기', down = this.flipY ? '↓ 몸쪽 · 당기기' : '↓ 카메라쪽 · 밀기';
    text(ctx, up, L + W * 0.012, zt + fs * 2.1, fs * 0.74, { weight: 500, color: C.inkSoft, align: 'left', halo: false });
    text(ctx, down, L + W * 0.012, H - fs * 0.95, fs * 0.74, { weight: 500, color: C.inkSoft, align: 'left', halo: false });

    if (this.phase === 'idle') {
      if (this.idleAutoStart) {
        this._drawCircle(ctx, S, this.faceoff(), Math.min(1, this.idleHold / COUNTDOWN_S), hair);
        if (this.idleHold > 0) text(ctx, String(Math.ceil(COUNTDOWN_S - this.idleHold)), W / 2, zt - W * 0.11, W * 0.13, { family: F.display, weight: 900, halo: false });
        text(ctx, '퍽을 원 안에 3초 두면 시작', W / 2, zt - W * 0.035, fs, { weight: 500, color: C.inkSoft, halo: false });
      } else {
        text(ctx, '시작을 누르면 카운트다운이 시작됩니다', W / 2, zt - W * 0.045, fs, { weight: 500, color: C.inkSoft, halo: false });
      }
      this._drawLegend(ctx, S, zt, fs);
      this._drawAvatar(ctx, S, now, puck, true, hair);
      ctx.restore();
      return;
    }

    // 카운트다운: 페이스오프 서클
    if (this.phase === 'countdown') {
      this._drawCircle(ctx, S, this.faceoff(), Math.min(1, this.hold / COUNTDOWN_S), hair);
      if (this.hold > 0) text(ctx, String(Math.ceil(COUNTDOWN_S - this.hold)), W / 2, zt - W * 0.12, W * 0.15, { family: F.display, weight: 900, halo: false });
      else text(ctx, '퍽을 원 안에 멈추세요', W / 2, zt - W * 0.085, W * 0.04, { family: F.display, weight: 900, halo: false });
      text(ctx, 'Head up — 시선은 화면에', W / 2, zt - W * 0.035, fs, { weight: 500, color: C.inkSoft, halo: false });
      this._drawLegend(ctx, S, zt, fs);
    }

    // 내려오는 퍽: 색만 다른 정원 (외곽선 없음)
    for (const o of this.obstacles) {
      const x = o.x * S, y = o.y * S, r = o.r * S;
      if (o.hit && Math.floor(now / 80) % 2 === 0) ctx.globalAlpha = 0.25;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = o.color; ctx.fill();
      // 퍽 윗면: 종이색 가는 고리 하나
      ctx.beginPath(); ctx.arc(x, y, r * 0.62, 0, Math.PI * 2); ctx.lineWidth = hair; ctx.strokeStyle = rgba(C.paper, 0.35); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // 노란 퍽: 옐로 정원 + 잉크 헤어라인
    for (const p of this.pickups) {
      const x = p.x * S, y = p.y * S, r = p.r * S;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = C.yellow; ctx.fill();
      ctx.lineWidth = hair; ctx.strokeStyle = C.ink; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, r * 1.5 + r * 0.12 * Math.sin(now / 180), 0, Math.PI * 2); ctx.lineWidth = hair; ctx.strokeStyle = rgba(C.ink, 0.35); ctx.stroke();
    }

    this._drawAvatar(ctx, S, now, puck, false, hair);

    // 이펙트
    for (const e of this.effects) {
      if (e.type === 'flash') {
        ctx.fillStyle = rgba(C.red, 0.12 * (1 - e.age)); ctx.fillRect(L, 0, Rr - L, H);
        ctx.lineWidth = hair * 3; ctx.strokeStyle = rgba(C.red, 1 - e.age);
        ctx.beginPath(); ctx.moveTo(L, 0); ctx.lineTo(L, H); ctx.moveTo(Rr, 0); ctx.lineTo(Rr, H); ctx.stroke();
      } else if (e.type === 'pop') {
        ctx.globalAlpha = Math.min(1, (1 - e.age) * 1.6);
        const script = e.style === 'script';
        const size = script ? W * 0.06 : W * 0.026;
        text(ctx, e.text, clamp(e.x, 0.16, 0.84) * S, Math.max(size, e.y * S - e.age * W * 0.05), size,
          { family: script ? F.script : F.display, weight: script ? 700 : 800, color: e.color, halo: true });
        ctx.globalAlpha = 1;
      }
    }

    if (this.paused && this.phase === 'play') {
      ctx.fillStyle = rgba(C.paper, 0.92); ctx.fillRect(0, 0, W, H);
      text(ctx, '퍽을 찾는 중', W / 2, H / 2 - W * 0.01, W * 0.05, { family: F.display, weight: 900, halo: false });
      text(ctx, '퍽을 카메라에 보이게 두면 이어서 진행됩니다 · 시간은 멈춰 있습니다', W / 2, H / 2 + W * 0.04, fs, { weight: 500, color: C.inkSoft, halo: false });
    }
    ctx.restore();
  }

  /** 규칙 범례: 노란 퍽은 먹고, 나머지 색은 피한다 */
  _drawLegend(ctx, S, zt, fs) {
    const W = S, y = zt - W * 0.2, r = fs * 0.55;
    let x = W / 2 - fs * 9.5;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = C.yellow; ctx.fill(); ctx.lineWidth = Math.max(1, W / (ctx.canvas.clientWidth || W)); ctx.strokeStyle = C.ink; ctx.stroke();
    text(ctx, '먹기 +200', x + r * 1.8, y, fs * 0.9, { weight: 600, align: 'left', halo: false });
    x = W / 2 + fs * 1.2;
    PUCK_COLORS.forEach((c, i) => { ctx.beginPath(); ctx.arc(x + i * r * 1.5, y, r, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); });
    text(ctx, '피하기', x + PUCK_COLORS.length * r * 1.5 + r * 0.6, y, fs * 0.9, { weight: 600, align: 'left', halo: false });
  }

  _drawCircle(ctx, S, c, progress, hair) {
    const W = S, cx = c.x * S, cy = c.y * S, r = c.r * S;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = rgba(C.paper, 0.7); ctx.fill();
    ctx.lineWidth = hair; ctx.strokeStyle = C.ink; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, Math.max(2, r * 0.06), 0, Math.PI * 2); ctx.fillStyle = C.red; ctx.fill();
    if (progress > 0) {
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
      ctx.lineWidth = hair * 2.5; ctx.strokeStyle = C.red; ctx.stroke();
    }
  }

  /** 내 퍽: 레드 정원 + 한 겹 떨어진 잉크 헤어라인 고리 */
  _drawAvatar(ctx, S, now, puck, ghost, hair) {
    const W = S;
    const a = this.avatar;
    if (!a) {
      if (ghost) text(ctx, '퍽이 인식되면 여기에 표시됩니다', W / 2, (this.zoneTop + this.zoneH / 2) * S, Math.max(11, W * 0.016), { weight: 500, color: C.mute, halo: false });
      return;
    }
    const x = a.x * S, y = a.y * S, r = PUCK_R * S;
    // 궤적: 레드 헤어라인
    if (puck?.trail?.length > 1) {
      ctx.lineWidth = hair;
      for (let i = 1; i < puck.trail.length; i++) {
        const p0 = this.toZone(puck.trail[i - 1].x, puck.trail[i - 1].y), p1 = this.toZone(puck.trail[i].x, puck.trail[i].y);
        const alpha = Math.max(0, 1 - (now - puck.trail[i].t) / 700) * 0.5;
        if (alpha <= 0) continue;
        ctx.beginPath(); ctx.moveTo(p0.x * S, p0.y * S); ctx.lineTo(p1.x * S, p1.y * S);
        ctx.strokeStyle = rgba(C.red, alpha); ctx.stroke();
      }
    }
    const invuln = now < this.invulnUntil;
    if (invuln && Math.floor(now / 100) % 2 === 0) ctx.globalAlpha = 0.3;
    const predicted = puck?.state === 'predicted';
    // 콤보: 가는 방사형 선 (5+ 잉크, 10+ 레드, 20+ 이중)
    if (this.combo >= 5 && !ghost) {
      sparks(ctx, x, y, r * 2.0, r * (2.5 + 0.2 * Math.sin(now / 90)), this.combo >= 10 ? 12 : 8, this.combo >= 10 ? C.red : C.ink, hair, now / 500);
      if (this.combo >= 20) sparks(ctx, x, y, r * 2.9, r * 3.3, 12, C.ink, hair, -now / 400);
    }
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = ghost ? rgba(C.red, 0.3) : predicted ? rgba(C.red, 0.45) : C.red; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r * 1.5, 0, Math.PI * 2);
    ctx.lineWidth = hair; ctx.strokeStyle = predicted || ghost ? rgba(C.ink, 0.4) : C.ink; ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

export { font };
