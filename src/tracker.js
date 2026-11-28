// 퍽 추적: 정규화 바닥 좌표(u,v)에서 알파-베타(등속 예측) 필터 + 이상치 게이트, 속도, 드리블(방향 전환) 카운트
const COAST_MS = 400;         // 미검출 시 예측 유지 시간 (영역 가장자리에서 사라짐 = 밖으로 나감)
const OCCLUDED_MS = 1500;     // 영역 안쪽에서 사라지면(스틱·발에 가림) 마지막 자리 근처에 이만큼 더 둔다 — 게임 화면에서 퍽이 사라지지 않게
const EDGE = 0.06;            // 이보다 가장자리에 가까운 곳에서 사라지면 영역 밖으로 나간 것으로 봄
const REACQUIRE_MS = 250;     // 이만큼 넘게 안 보였다가 가까운 곳에서 다시 보이면 이상치 판정 없이 그 자리로 (가림이 풀린 자리)
const REACQUIRE_DIST = 0.3;   // 그 '가까운 곳'의 범위 (바닥 폭 기준)
const DIR_THRESHOLD = 0.35;   // 방향 전환 인정 최소 속도 (바닥폭/초)
const DEADBAND = 0.004;       // 정지 시 이 이하 움직임은 무시 (미세 떨림 억제)
const OUTLIER_FRAMES = 3;     // 튀는 측정값을 몇 프레임 연속이면 진짜 이동으로 받아들일지
// 확실한 자리(감점 판정에 씀): 영상에서 퍽 자체를 직접 본 측정이 이만큼 이어져야 한다. 처음 잡았을 때·튄 자리로 옮긴 뒤·가림이 풀린 뒤에는
// 다시 이만큼 기다린다 (퍽이 가려진 순간 스틱을 퍽으로 잡아 튄 자리로 콘·날아오는 퍽에 '닿았다'고 감점하지 않게)
export const CONFIRM_MS = 150;

export class Tracker {
  constructor() { this.reset(); }

  reset() {
    this.pos = null;
    this.vel = { x: 0, y: 0 };
    this.speed = 0;
    this.state = 'lost';      // 'tracked' | 'predicted' | 'lost'
    this.lastSeen = 0;
    this.lastTime = 0;
    this.trail = [];
    this.dirX = 0;
    this.touches = 0;
    this.distance = 0;        // 누적 이동 거리 (바닥폭 단위)
    this.frames = 0;          // 추적률 계산용
    this.trackedFrames = 0;
    this.outliers = 0;        // 연속 이상치 수
    this.rejected = 0;        // 통계: 무시한 측정값 수
    this.lastInside = false;  // 마지막으로 본 자리가 영역 안쪽인지
    this.seen = false;        // 이번 자리가 영상에서 퍽 자체를 직접 본 것인지 (블레이드로 이은 자리·애매한 조각·예측·튄 값 무시 중이면 false)
    this.seenSince = 0;       // 직접 본 측정이 끊기지 않고 이어진 첫 시각 (튀어서 옮기면 다시 셈)
    this.confident = false;   // 확실한 자리: 직접 본 측정이 CONFIRM_MS 이상 이어짐 (감점 판정은 이때만)
    this.bridged = false;     // 이번 자리가 블레이드로 이은 자리(가려진 퍽 추정)인지 — 화면에는 흐리게
    this.jumps = 0;           // 통계: 튀는 값이 이어져 자리를 옮긴 횟수 (다른 물체로 옮겨 갔을 수 있는 순간 — 인식 기록·녹화)
  }

  resetStats() { this.touches = 0; this.distance = 0; this.dirX = 0; this.frames = 0; this.trackedFrames = 0; this.rejected = 0; }

  get trackRate() { return this.frames ? this.trackedFrames / this.frames : 0; }

  /** 다음 프레임 예측 위치 */
  predict(dt) { return this.pos ? { x: this.pos.x + this.vel.x * dt, y: this.pos.y + this.vel.y * dt } : null; }

  /** 측정값이 예측에서 이만큼 넘게 벗어나면 이상치 (속도가 빠를수록 넓게) */
  gate(dt) { return 0.07 + 2.5 * this.speed * dt; }

  /**
   * meas: {u,v, bridged?, doubtful?} | null, now: ms.
   * bridged: 블레이드로 이은 자리 (StickBridge), doubtful: 애매한 조각 (Vision — 가려져 작아진·가늘고 긴·떼어 낸 조각).
   * 둘 다 자리로는 쓰되 '직접 본 퍽'으로 세지 않는다 (확실한 자리 confident 는 직접 본 측정만)
   */
  update(meas, now) {
    const dt = this.lastTime ? Math.min(0.1, (now - this.lastTime) / 1000) : 1 / 30;
    this.lastTime = now;
    let used = false, jumped = false; // 이번 측정을 자리로 썼는지, 튀어서 자리를 옮겼는지

    if (meas && (!this.pos || this.state === 'lost')) {
      // 새로 획득
      this.pos = { x: meas.u, y: meas.v };
      this.vel = { x: 0, y: 0 };
      this.outliers = 0;
      this.state = 'tracked';
      this.lastSeen = now;
      used = true; jumped = true;
    } else if (meas) {
      const pred = this.predict(dt);
      const ix = meas.u - pred.x, iy = meas.v - pred.y;
      const innovation = Math.hypot(ix, iy);
      if (now - this.lastSeen > REACQUIRE_MS && innovation < REACQUIRE_DIST) {
        // 가려졌던 퍽이 다시 보임: 그사이 움직였어도 바로 그 자리로 (몇 프레임씩 이상치로 버리면 화면의 퍽이 늦게 따라온다)
        this.pos = { x: meas.u, y: meas.v };
        this.vel = { x: 0, y: 0 };
        this.outliers = 0;
        this.state = 'tracked';
        this.lastSeen = now;
        used = true; jumped = true;
      } else if (innovation > this.gate(dt) && this.outliers < OUTLIER_FRAMES) {
        // 한두 프레임 튀는 값(다른 물체·조각 오검출): 무시하고 예측으로 유지
        this.outliers++; this.rejected++;
        this._coast(dt, now);
        this.state = this.outliers >= 2 ? 'predicted' : 'tracked';
      } else {
        used = true;
        if (this.outliers >= OUTLIER_FRAMES) {
          // 같은 곳으로 계속 측정됨 -> 진짜 이동(재획득): 속도 초기화 후 점프
          this.pos = { x: meas.u, y: meas.v };
          this.vel = { x: 0, y: 0 };
          jumped = true; this.jumps++;
        } else {
          const slow = this.speed < 0.15;
          const moved = Math.hypot(meas.u - this.pos.x, meas.v - this.pos.y);
          if (slow && moved < DEADBAND) {
            // 정지 상태 미세 떨림: 위치 유지, 속도 감쇠
            this.vel.x *= 0.6; this.vel.y *= 0.6;
          } else {
            // 알파-베타 필터: 예측 + 잔차 보정 (느릴수록 더 부드럽게)
            const alpha = slow ? 0.45 : 0.7, beta = slow ? 0.15 : 0.35;
            const nx = pred.x + alpha * ix, ny = pred.y + alpha * iy;
            if (dt > 0) { this.vel.x += (beta * ix) / dt; this.vel.y += (beta * iy) / dt; }
            this.distance += Math.hypot(nx - this.pos.x, ny - this.pos.y);
            this.pos.x = nx; this.pos.y = ny;
          }
        }
        this.outliers = 0;
        this.state = 'tracked';
        this.lastSeen = now;
      }
    } else if (this.pos && now - this.lastSeen < (this.lastInside ? OCCLUDED_MS : COAST_MS)) {
      // 안 보이는 동안: 예측 자리(속도는 금방 줄어 멈춤)에 흐리게 둔다. 'predicted' 는 게임 판정(충돌·득점)에 쓰이지 않는다
      this._coast(dt, now);
      this.state = 'predicted';
    } else {
      this.state = 'lost';
      this.pos = null;
      this.vel = { x: 0, y: 0 };
      this.outliers = 0;
    }

    this.speed = Math.hypot(this.vel.x, this.vel.y);
    // 확실한 자리: 직접 본 측정이 끊기지 않고(튀어서 옮기지 않고) CONFIRM_MS 넘게 이어졌는지
    const seenNow = used && !meas.bridged && !meas.doubtful;
    if (!seenNow) this.seenSince = 0;
    else if (jumped || !this.seen) this.seenSince = now;
    this.seen = seenNow;
    this.bridged = used && !!meas.bridged;
    this.confident = seenNow && this.state === 'tracked' && now - this.seenSince >= CONFIRM_MS;
    // 마지막으로 본 자리가 영역 안쪽이었는지 (사라졌을 때 가림인지, 밖으로 나간 것인지 가르는 데 씀)
    if (this.state === 'tracked' && this.pos) {
      const { x, y } = this.pos;
      this.lastInside = x > EDGE && x < 1 - EDGE && y > EDGE && y < 1 - EDGE;
    }
    this.frames++;
    if (this.state === 'tracked') this.trackedFrames++;

    // 드리블(좌우 방향 전환) 카운트
    if (this.state === 'tracked') {
      const sign = this.vel.x > DIR_THRESHOLD ? 1 : this.vel.x < -DIR_THRESHOLD ? -1 : 0;
      if (sign !== 0) {
        if (this.dirX !== 0 && sign !== this.dirX) { this.touches++; this.lastTouch = now; }
        this.dirX = sign;
      }
    }

    if (this.pos) {
      this.trail.push({ x: this.pos.x, y: this.pos.y, t: now });
      if (this.trail.length > 40) this.trail.shift();
    } else if (this.trail.length) {
      this.trail = this.trail.filter((p) => now - p.t < 600);
    }
  }

  _coast(dt) {
    this.pos.x += this.vel.x * dt * 0.6;
    this.pos.y += this.vel.y * dt * 0.6;
    this.vel.x *= 0.85; this.vel.y *= 0.85;
  }
}
