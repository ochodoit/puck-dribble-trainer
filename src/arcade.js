// 아케이드: 웹캠으로 추적한 퍽의 (X, Y)를 화면 하단 플레이 존에 매핑하는 체감형 스틱핸들링 게임
// 좌표계: 화면 폭 = 1 단위, 높이 = aspect (H/W). 좌우 테두리 안쪽이 경기장 레인, 플레이 존은 하단 30%.
// 규칙: 검정 퍽들이 같은 속도로, 서로 겹치지 않게 내려온다. coin(노란 원)만 먹고, 검정 퍽은 피한다. 빨간 원 = 나.
//       일부 퍽은 내 퍽이 있는 줄을 겨냥해 떨어지므로 가만히 있으면 맞는다.
//       제한 시간(Game이 관리) 동안의 점수로 겨룬다. 목숨 없음 — 충돌은 감점 + 콤보 초기화.
import { C, F, rgba, text, sparks, font, alphaLayer } from './theme.js';

export const ZONE_RATIO = 0.30;      // 화면 높이 중 플레이 존 비율
export const FIELD_MARGIN = 0.05;    // 좌우 테두리 위치 (화면 폭 비율)
export const PUCK_R = 0.022;         // 내 퍽 반지름 (화면 폭 단위)
export const HIT_PENALTY = 100;      // 충돌 감점
export const FEVER_BONUS = 300;      // 20콤보마다 보너스
// 점수: 터치(좌우 방향 전환)가 중심. 가만히 있으면 점수가 나지 않는다.
export const TOUCH_POINTS = 10;      // 터치 1번
export const TOUCH_MIN_TRAVEL = 0.08; // 직전 터치에서 경기장 폭의 8% 이상 움직여야 터치로 인정 (제자리 흔들기 방지)
const TOUCH_TURN = 0.012;            // 이만큼 되돌아와야 방향 전환으로 본다 (추적 떨림 무시, 화면 폭 단위)
export const STREAK_GAP_S = 1.2;     // 터치 사이 간격이 이 안이면 연속 터치
export const STREAK_EVERY = 10;      // 연속 터치 10번마다
export const QUICK_HANDS = 100;      //   +100 "Quick hands"
export const DODGE_POINTS = 50;      // 나를 겨냥한 퍽을 피함
const THREAT_S = 0.8;                // 이 시간 안에 내 퍽에 닿을 줄에 있던 퍽 = 나를 겨냥한 퍽
const STILL_MS = 1500;               // 이만큼 멈춰 있으면 콤보 초기화
const STILL_MOVE = 0.02;             // 이 거리 넘게 움직여야 '움직였다' (화면 폭 단위)
const INVULN_MS = 1500;              // 피격 후 무적
const COUNTDOWN_S = 3;               // 헤드업 카운트다운 (페이스오프 서클에 정지)
const PAUSE_AFTER_LOST_MS = 600;     // 추적 끊김이 이 시간을 넘으면 일시정지 (시간도 멈춤)

// 피해야 하는 퍽의 색: 모두 잉크 블랙. 레드 = 나, 옐로 = 먹는 coin.
export const PUCK_COLORS = [C.ink];

// speed: 낙하 속도(화면 폭/초) — 한 판 내내 일정. 난이도는 '개수'로만 올라간다.
// 난이도별로 '개수'(interval: 퍽이 나오는 간격, 짧을수록 많음)와 '속도'가 다르다.
// 개수는 모든 난이도에서 이전의 2배 (간격 절반). aim: 내 퍽 줄을 겨냥해 떨어지는 퍽의 비율
const DIFF = {
  easy:   { speed: 0.18, interval: 0.65, minInterval: 0.30, aim: 0.30 },   // 느리게
  normal: { speed: 0.26, interval: 0.42, minInterval: 0.18, aim: 0.35 },
  hard:   { speed: 0.36, interval: 0.20, minInterval: 0.08, aim: 0.40 },   // 빠르고 촘촘하게
};
const AIM_SPREAD = 0.04;                // 겨냥한 퍽이 내 퍽 x에서 벗어나는 범위 (화면 폭 단위)
export const FALL_R = [0.013, 0.021];   // 내려오는 퍽 반지름 범위 (이전의 절반)
export const COIN_R = 0.013;            // coin 반지름 (이전의 절반)
const SPAWN_GAP = 0.012;                // 퍽끼리 최소 간격 (겹치지 않게)

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export class Arcade {
  constructor(sfx) {
    this.sfx = sfx;
    this.aspect = 0.75;
    this.floorWidthM = 1.5;
    this.flipY = true;     // true: 카메라 쪽으로 밀면 화면 위로(퍽들이 내려오는 쪽), 몸쪽으로 당기면 아래로
    this.wash = 0.88;      // 경기장 종이 배경의 불투명도 (1 = 카메라 영상 완전히 가림, 0 = 영상 그대로)
    this.puckAlpha = 1;    // 플레이 중 내 퍽 표시 농도 (1 = 또렷이, 0 = 안 보임: 화면이 아닌 감각으로 플레이)
    this.phase = 'idle';   // idle | countdown | play
    this.reset();
  }

  reset() {
    this.score = 0;
    this.combo = 0; this.maxCombo = 0;
    this.touches = 0; this.quickHands = 0; this.streak = 0; this.maxStreak = 0; this.lastTouchAt = 0;
    this.passed = 0; this.items = 0; this.hits = 0;
    this.elapsed = 0;
    this.tDir = 0; this.tExt = null; this.tAnchor = null; // 터치 판정: 현재 방향, 그 방향의 끝점, 직전 터치 지점
    this.moveRef = null; this.lastMoveAt = 0;           // 멈춤 판정
    this.level = 0;
    this.obstacles = []; this.pickups = []; this.effects = [];
    this.spawnTimer = 0.8; this.pickupTimer = 2.5; this.pickupSide = 1;
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

    // 터치(좌우 방향 전환)와 멈춤 판정
    if (this.avatar && tracked) { this._updateTouch(this.avatar.x, now); this._updateStill(this.avatar, now); }

    // 난이도 진행: 1000점마다 레벨 +1 -> 퍽이 더 자주 나온다 (속도는 그대로)
    this.level = Math.floor(this.score / 1000);
    const vy = this.speed;

    this.spawnTimer -= dt;
    // 자리가 없으면(겹칠 위치뿐이면) 잠깐 뒤에 다시 시도
    if (this.spawnTimer <= 0) this.spawnTimer = this._spawnPuck(vy, this.avatar) ? this.interval() * rand(0.8, 1.2) : 0.04;
    this.pickupTimer -= dt;
    if (this.pickupTimer <= 0) {
      const lo = FIELD_MARGIN + 0.08, hi = 1 - FIELD_MARGIN - 0.08, mid = 0.5;
      // 좌우 번갈아 -> 8자 경로 유도
      const x = this._freeX(COIN_R, this.pickupSide > 0 ? mid + 0.1 : lo, this.pickupSide > 0 ? hi : mid - 0.1);
      if (x === null) this.pickupTimer = 0.05;
      else {
        this.pickups.push({ x, y: -COIN_R, r: COIN_R, vy, born: now });
        this.pickupSide *= -1;
        this.pickupTimer = rand(2.2, 3.6);
      }
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
      if (!o.hit && d <= touch && canHit) this._onHit(o, now);
      // 나를 겨냥한 퍽: 0.8초 안에 닿을 거리 위에서, 내 퍽과 같은 줄(닿는 폭 안)에 있었던 적이 있음
      const ahead = a.y - o.y;
      if (!o.threat && ahead > 0 && ahead < o.vy * THREAT_S && Math.abs(a.x - o.x) < touch) o.threat = true;
      // 통과: 퍽 전체가 내 퍽 아래로 지나감. 겨냥당했는데 맞지 않은 퍽만 '피했다'로 인정
      if (!o.passed && o.y - o.r > a.y + PUCK_R) {
        o.passed = true;
        if (!o.hit && o.threat) {
          this.passed++;
          this._combo(now);
          this._addScore(DODGE_POINTS, o.x, o.y - o.r - 0.03, `회피 +${DODGE_POINTS}`);
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

    this.instruction = this.combo >= 20 ? 'FEVER ×3' : this.combo >= 5 ? `콤보 ${this.combo} ×${this.multiplier}` : 'coin은 먹고, 검정 퍽은 피하고, 좌우로 터치';
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

  /**
   * 반지름 r인 원을 맨 위(y = -r)에 놓을 때, 이미 내려오고 있는 퍽·coin과 겹치지 않는 무작위 x.
   * 모든 퍽의 속도가 같으므로 출발할 때 안 겹치면 끝까지 겹치지 않는다. 자리가 없으면 null.
   */
  _freeX(r, lo = FIELD_MARGIN + r, hi = 1 - FIELD_MARGIN - r) {
    const others = [...this.obstacles, ...this.pickups];
    for (let tries = 0; tries < 16; tries++) {
      const x = rand(lo, hi);
      if (others.every((o) => Math.hypot(x - o.x, -r - o.y) >= r + o.r + SPAWN_GAP)) return x;
    }
    return null;
  }

  /**
   * 검정 퍽 하나를 맨 위에서 떨어뜨린다 (속도는 모두 같고, 서로 겹치지 않음).
   * 일부(난이도별 aim 비율)는 내 퍽이 있는 x 근처를 겨냥해, 가만히 있으면 맞도록 한다.
   */
  _spawnPuck(vy, avatar) {
    const r = rand(FALL_R[0], FALL_R[1]);
    const lo = FIELD_MARGIN + r, hi = 1 - FIELD_MARGIN - r;
    const aimed = avatar && Math.random() < (this.diff || DIFF.normal).aim;
    let x = aimed ? this._freeX(r, clamp(avatar.x - AIM_SPREAD, lo, hi), clamp(avatar.x + AIM_SPREAD, lo, hi)) : null;
    if (x === null) x = this._freeX(r, lo, hi);
    if (x === null) return null;
    const color = PUCK_COLORS[Math.floor(Math.random() * PUCK_COLORS.length)];
    const o = { x, y: -r, r, vy, color, minDist: Infinity, passed: false, hit: false, threat: false };
    this.obstacles.push(o);
    return o;
  }

  /**
   * 터치 판정: 좌우로 움직이다 방향을 바꾸는 순간이 터치. 직전 터치 지점에서 경기장 폭의 8% 넘게 움직였어야 인정.
   * 연속 터치(간격 1.2초 이내) 10번마다 Quick hands 보너스.
   */
  _updateTouch(x, now) {
    if (this.tAnchor === null) { this.tAnchor = x; this.tExt = x; this.tDir = 0; return; }
    if (this.tDir === 0) {
      if (Math.abs(x - this.tAnchor) > TOUCH_TURN) { this.tDir = Math.sign(x - this.tAnchor); this.tExt = x; }
      return;
    }
    if ((x - this.tExt) * this.tDir > 0) { this.tExt = x; return; }           // 같은 방향으로 계속
    if ((this.tExt - x) * this.tDir < TOUCH_TURN) return;                       // 아직 되돌아오지 않음
    // 방향 전환
    const travel = Math.abs(this.tExt - this.tAnchor) / (1 - 2 * FIELD_MARGIN);
    const at = this.tExt;
    this.tAnchor = this.tExt; this.tDir = -this.tDir; this.tExt = x;
    if (travel < TOUCH_MIN_TRAVEL) return;
    this.touches++;
    this.streak = this.lastTouchAt && now - this.lastTouchAt <= STREAK_GAP_S * 1000 ? this.streak + 1 : 1;
    this.maxStreak = Math.max(this.maxStreak, this.streak);
    this.lastTouchAt = now;
    this._combo(now);
    this._addScore(TOUCH_POINTS, at, this.avatar.y - 0.05, `+${TOUCH_POINTS}`);
    if (this.streak % STREAK_EVERY === 0) {
      this.quickHands++;
      this._addScore(QUICK_HANDS, this.avatar.x, this.avatar.y - 0.1, `Quick hands +${QUICK_HANDS}`, C.red, 'script');
      this.sfx?.deke?.();
    }
  }

  /** 1.5초 넘게 멈춰 있으면 콤보와 연속 터치 초기화 */
  _updateStill(a, now) {
    if (!this.moveRef || Math.hypot(a.x - this.moveRef.x, a.y - this.moveRef.y) > STILL_MOVE) { this.moveRef = { x: a.x, y: a.y }; this.lastMoveAt = now; return; }
    if (now - this.lastMoveAt > STILL_MS && (this.combo > 0 || this.streak > 0)) {
      if (this.combo >= 2) this._pop(a.x, a.y - 0.08, '멈춤 — 콤보 초기화', C.inkSoft, 900);
      this.combo = 0; this.streak = 0;
    }
  }

  /** 충돌: 목숨 대신 감점 + 콤보 초기화 + 1.5초 무적 */
  _onHit(o, now) {
    o.hit = true;
    this.hits++;
    this.combo = 0; this.streak = 0;
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
      score: this.score, maxCombo: this.maxCombo, touches: this.touches, quickHands: this.quickHands, maxStreak: this.maxStreak, passed: this.passed, items: this.items, hits: this.hits,
      elapsed: this.elapsed, distanceM: distM, level: this.level,
      items_: [
        ['점수', this.score], ['최고 콤보', this.maxCombo], ['터치', this.touches], ['Quick hands', this.quickHands], ['최고 연속 터치', this.maxStreak],
        ['피한 퍽', this.passed], ['Coin', this.items], ['충돌', this.hits],
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
    // coin: 동전 모양 (톱니 테두리 + 안쪽 고리 + 가운데 'coin' 글자)
    for (const p of this.pickups) drawCoin(ctx, p.x * S, p.y * S, p.r * S, hair);

    // 내 퍽: 플레이 중에는 설정한 농도로 (카운트다운 동안은 항상 또렷이 — 원 안에 놓아야 하므로)
    alphaLayer(ctx, this.phase === 'play' ? this.puckAlpha : 1, (c) => this._drawAvatar(c, S, now, puck, false, hair));

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

  /** 규칙 범례: coin은 먹고, 검정 퍽은 피한다 */
  _drawLegend(ctx, S, zt, fs) {
    const W = S, y = zt - W * 0.2, r = fs * 0.55;
    let x = W / 2 - fs * 9.5;
    drawCoin(ctx, x, y, r * 1.5, Math.max(1, W / (ctx.canvas.clientWidth || W)));
    text(ctx, '먹기 +200', x + r * 2.4, y, fs * 0.9, { weight: 600, align: 'left', halo: false });
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

/**
 * 동전: 옐로 원판 + 잉크 외곽선, 테두리의 톱니(짧은 방사선), 안쪽 고리, 가운데 'coin' 글자.
 * 퍽(색만 다른 민무늬 원)과 한눈에 구분되도록 한다.
 */
export function drawCoin(ctx, x, y, r, hair) {
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = C.yellow; ctx.fill();
  ctx.lineWidth = hair; ctx.strokeStyle = C.ink; ctx.stroke();
  // 톱니 테두리
  ctx.lineWidth = Math.max(0.75, hair * 0.75); ctx.strokeStyle = rgba(C.ink, 0.7); ctx.lineCap = 'butt';
  const n = 20;
  ctx.beginPath();
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; ctx.moveTo(x + Math.cos(a) * r * 0.84, y + Math.sin(a) * r * 0.84); ctx.lineTo(x + Math.cos(a) * r * 0.97, y + Math.sin(a) * r * 0.97); }
  ctx.stroke();
  // 안쪽 고리
  ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, Math.PI * 2); ctx.lineWidth = Math.max(0.75, hair * 0.75); ctx.strokeStyle = C.ink; ctx.stroke();
  // 글자: 작아도 원 안에
  ctx.font = font(F.sans, r * 0.66, 700); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = C.ink;
  ctx.fillText('coin', x, y + r * 0.03);
  ctx.restore();
}

export { font };
