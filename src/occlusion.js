// 스틱이 퍽을 가릴 때 (스틱 색을 지정한 경우): 퍽이 블레이드 바로 옆에서 사라지면 잠시 블레이드 자리로 퍽을 잇는다.
// 드리블 중 블레이드가 퍽 위를 덮으면 카메라에서 퍽이 안 보이지만, 퍽은 블레이드 밑에 붙어 함께 움직인다.
// 그래서 사라지기 직전의 '퍽 - 블레이드' 간격을 기억해 두고, 가려진 동안은 블레이드 + 그 간격을 퍽 자리로 쓴다.
// 좌표는 모두 정규화 바닥 좌표 (u, v: 0~1)

export const BRIDGE_NEAR = 0.15;      // 퍽과 블레이드가 이 거리(바닥 폭 기준) 안이면 '붙어 있음'
export const BRIDGE_RECENT_MS = 250;  // 퍽이 사라지기 직전 이 시간 안에 붙어 있었어야 블레이드로 잇는다 (멀리서 사라진 퍽은 잇지 않음)
export const BRIDGE_MAX_MS = 1500;    // 가장 오래 잇는 시간 (그 뒤로는 추적기의 예측·놓침 처리)
// 블레이드에 붙어 있던(또는 블레이드 밑에 가려진) 퍽: '블레이드 + 간격' 자리에서 이만큼 넘게 떨어진 애매한 조각
// (Vision 의 doubtful: 가늘고 긴 조각·작은 조각·떼어 낸 조각)은 퍽이 아니라 퍽과 같은 색 스틱 샤프트로 본다.
// 퍽 색과 스틱 테이프 색만 따라간다 (샤프트 색이 퍽과 같아도 샤프트 윗부분을 퍽으로 잡지 않게)
export const BRIDGE_TRUST = 0.05;

export class StickBridge {
  constructor() { this.reset(); }

  reset() {
    this.offset = null;        // 퍽 - 블레이드 간격 {u, v}
    this.nearAt = -Infinity;   // 마지막으로 붙어 있던 시각
    this.lostAt = null;        // 퍽이 사라진 시각 (보이는 동안 null)
    this.armed = false;        // 이번에 사라진 퍽을 블레이드로 이을지 (사라지는 순간에 정함)
    this.active = false;       // 지금 블레이드로 잇는 중
  }

  /**
   * 한 프레임. puck: {u, v, doubtful?} | null, stick: {u, v} | null (이번 프레임 측정). now: ms
   * 반환: 추적기에 넣을 측정값 — 퍽이 보이면 퍽 그대로, 가려졌으면 {u, v, bridged: true}, 둘 다 아니면 null
   */
  step(puck, stick, now) {
    // 블레이드에 붙어 있던(가려진) 퍽인데 이번 측정이 애매한 조각이고 블레이드 + 간격 자리에서 멀면: 샤프트로 보고 버린다
    if (puck?.doubtful && stick && this.offset && (this.active || now - this.nearAt <= BRIDGE_RECENT_MS)) {
      const eu = stick.u + this.offset.u, ev = stick.v + this.offset.v;
      if (Math.hypot(puck.u - eu, puck.v - ev) > BRIDGE_TRUST) puck = null;
    }
    if (puck) {
      this.lostAt = null; this.armed = false; this.active = false;
      if (stick) {
        const du = puck.u - stick.u, dv = puck.v - stick.v;
        if (Math.hypot(du, dv) < BRIDGE_NEAR) {
          // 붙어 다니는 동안의 간격 (조금씩 부드럽게 따라감)
          this.offset = this.offset && now - this.nearAt < 200
            ? { u: this.offset.u + (du - this.offset.u) * 0.5, v: this.offset.v + (dv - this.offset.v) * 0.5 }
            : { u: du, v: dv };
          this.nearAt = now;
        }
      }
      return puck;
    }
    // 퍽이 안 보임: 사라지는 순간 블레이드에 붙어 있었는지로 이을지 정한다
    if (this.lostAt === null) {
      this.lostAt = now;
      this.armed = !!this.offset && now - this.nearAt <= BRIDGE_RECENT_MS;
    }
    this.active = this.armed && !!stick && now - this.lostAt <= BRIDGE_MAX_MS;
    if (!this.active) return null;
    const u = Math.min(1, Math.max(0, stick.u + this.offset.u));
    const v = Math.min(1, Math.max(0, stick.v + this.offset.v));
    return { u, v, bridged: true };
  }
}
