// 오버레이 캔버스 렌더링 — 영상 위에 얇은 잉크 선(종이색 헤일로)과 알약 라벨, 포인트 레드
import { PUCK_R, FLYER_R, WIDE_DRILLS, WIDE_BAND, WIDE_END, WIDE_HOLD_R, GATE_DRAW_R, F8_HOLD_R, F8_HOLD_SEC } from './game.js';
import { C, F, rgba, inkStroke, text, pill, sparks, alphaLayer } from './theme.js';

/** 퍽 피하기의 평면 경기장 사각형 (캔버스 px). topInset: 상단 HUD가 가리는 높이 비율 */
export function dodgeField(W, H, topInset = 0) {
  const m = W * 0.05;
  const top = Math.max(m, topInset * H + m * 0.5);
  return { x: m, y: top, w: W - 2 * m, h: Math.max(10, H - top - m) };
}

/** 평면 판 대신 카메라 영상 위 실제 바닥에 원근대로 그리는 모드 */
export const FLOOR_MODES = new Set(['wide', 'quick']);

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.topInset = 0;
    this.wash = 0.88;   // 평면 경기장 종이 배경의 불투명도
    this.puckAlpha = 1; // 플레이 중 내 퍽 표시 농도 (1 = 또렷이, 0 = 안 보임)
  }

  resize(cssW, cssH) {
    const w = Math.round(cssW * this.dpr), h = Math.round(cssH * this.dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
  }

  /**
   * vision: Vision 결과, puck: Tracker, game: Game, procSize: {PW,PH}, now: ms
   */
  draw({ vision, puck, game, procSize, now, showCandidates, idleHold = 0, calib = null, areaEditing = false, areaDragging = false, cover = null, setupTest = null, peek = false, pick = null }) {
    const { ctx, canvas } = this;
    this.peek = peek; // 설정의 투명도 슬라이더를 끄는 동안: 게임 전이어도 플레이 중처럼 (내 퍽 투명도 적용)
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const sx = W / procSize.PW, sy = H / procSize.PH;
    const toC = (px, py) => [px * sx, py * sy];
    // 퍽 투명도: 카메라 영상 속 진짜 퍽을 둘레 바닥색으로 덮는다 (맨 아래 층 — 목표·영역 그림은 그 위에)
    if (cover && cover.alpha > 0.001) {
      const [cx, cy] = toC(cover.x, cover.y), rr = cover.r * sx * 2.4;
      const col = `${Math.round(cover.rgb.r)},${Math.round(cover.rgb.g)},${Math.round(cover.rgb.b)}`;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
      g.addColorStop(0, `rgba(${col},${cover.alpha})`); g.addColorStop(0.62, `rgba(${col},${cover.alpha})`); g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.fill();
    }
    const floor = vision?.floor;
    const mapping = floor?.mapping;
    const uvToC = (u, v) => { const [px, py] = mapping.toPx(u, v); return toC(px, py); };
    const unit = Math.min(W, H);                 // 크기 기준
    const fs = Math.max(11 * this.dpr, unit * 0.03);        // 본문 글자 (CSS 11px 이상)
    const hair = Math.max(this.dpr, unit * 0.0014);   // 헤어라인 (화면상 약 1px)
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const pa = game.running || peek ? this.puckAlpha : 1; // 내 퍽 표시 농도: 대기·등록 화면에서는 항상 또렷이
    // 지금 그리는 화면: 'setup'(영역·등록·움직여 보기) · 'arcade' · 'floor'(바닥 위에 원근대로) · 'flat'(평면 판)
    // pick: 보정 '터치로 지정' 중 ('puck'|'stick') — 게임 화면 대신 카메라 영상을 보여 줘야 화면에서 물체를 누를 수 있다
    const playing = mapping && !areaEditing && !(calib?.active && calib.circle && !calib.plane) && !setupTest && !pick; // calib.plane: 8자 대기 원은 흰 훈련 화면 위에
    const view = !playing ? 'setup' : game.mode.id === 'arcade' ? 'arcade' : FLOOR_MODES.has(game.mode.id) ? 'floor' : 'flat';

    // ---- 게임 영역 (평면 판 모드에서는 그리지 않음: 평면 판이 곧 영역이라 뒤에 비치는 사다리꼴은 헷갈리기만 한다) ----
    if (floor?.quad && view !== 'flat') {
      const full = floor.mode === 'full' || floor.fallback;
      ctx.beginPath();
      floor.quad.forEach(([x, y], i) => { const [cx, cy] = toC(x, y); i ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy); });
      ctx.closePath();
      if (full) { ctx.lineWidth = hair; ctx.strokeStyle = rgba(C.ink, 0.25); ctx.stroke(); }
      else {
        ctx.setLineDash(floor.locked || floor.mode !== 'auto' ? [] : [unit * 0.018, unit * 0.012]);
        inkStroke(ctx, hair * 1.3, floor.detected ? C.ink : C.red);
        ctx.setLineDash([]);
      }
    }
    // 원근 격자: 영역 편집 중에는 또렷하게, 평소에는 은은하게
    if (mapping && (view === 'setup' || view === 'arcade') && (areaEditing || floor.mode === 'manual' || (floor.mode === 'auto' && !floor.fallback))) {
      const strong = areaEditing;
      const N = strong ? 6 : 4;
      ctx.lineWidth = strong ? hair : hair * 0.6; ctx.strokeStyle = rgba(C.ink, strong ? 0.55 : 0.16);
      for (let i = 1; i < N; i++) {
        const t = i / N;
        ctx.beginPath(); let [ax, ay] = uvToC(t, 0); ctx.moveTo(ax, ay); [ax, ay] = uvToC(t, 1); ctx.lineTo(ax, ay); ctx.stroke();
        ctx.beginPath(); [ax, ay] = uvToC(0, t); ctx.moveTo(ax, ay); [ax, ay] = uvToC(1, t); ctx.lineTo(ax, ay); ctx.stroke();
      }
      // 영역 편집 중 화면 글자는 두지 않는다 (휴대폰에서 바닥을 가림). 안내는 맨 위 한 줄 막대가 맡는다
    }

    // ---- 가운데 원: 물체 등록 / 핸즈프리 시작 ----
    if (calib?.active && calib.circle && !calib.plane) {
      this._drawCalib(ctx, calib, toC, sx, unit, fs, hair, idleHold);
      if (mapping && !calib.manual) { this._drawStick(ctx, vision.stick, toC, unit, hair); this._drawPuck(ctx, puck, uvToC, unit, hair, now, PUCK_R * this._floorPx(uvToC)); }
      return;
    }

    if (!mapping) return;
    // 영역 편집 중·터치로 지정 중에는 게임 화면을 그리지 않는다 (바닥 영상과 격자만 보이게).
    // 아케이드·퍽 피하기·8자처럼 배경이 흰 화면(배경 투명도 0 고정)인 게임에서도 카메라 속 퍽·스틱이 보여야 누를 수 있다
    if (areaEditing || pick) return;
    // 시작 준비 3/3 움직여 보기: 네 모서리 표적 + 내 퍽만
    if (setupTest) {
      this._drawSetupTest(ctx, setupTest, uvToC, unit, hair, fs);
      this._drawPuck(ctx, puck, uvToC, unit, hair, now, PUCK_R * this._floorPx(uvToC));
      return;
    }

    // ---- 아케이드: 화면 공간 렌더 ----
    if (game.mode.id === 'arcade') {
      game.arcade.draw(ctx, W, H, now, puck);
      this._cameraPuck(ctx, vision, toC, unit, hair, pa);
      return;
    }

    // ---- 와이드 드리블·퀵 핸즈: 카메라 영상 위 실제 바닥에 원근대로 (내 퍽 = 영상 속 진짜 퍽 자리) ----
    if (view === 'floor') {
      (game.mode.id === 'wide' ? this._drawWide : this._drawQuick).call(this, ctx, W, H, game, puck, now, uvToC);
    } else {
      // ---- 나머지 모드는 평면 경기장에서 (위에서 내려다본 판 = 영역 전체. 판정도 같은 평면 좌표) ----
      const drawField = {
        free: this._drawCourse, obstacle: this._drawDodge,
        figure8: this._drawFigure8, reaction: this._drawReaction,
      }[game.mode.id] || this._drawCourse;
      drawField.call(this, ctx, W, H, game, puck, now, { calib, idleHold });
    }

    // ---- 디버그: 퍽 후보 (카메라 좌표) ----
    if (showCandidates && vision.puckCandidates) {
      for (const c of vision.puckCandidates) {
        const [x0, y0] = toC(c.minx, c.miny), [x1, y1] = toC(c.maxx + 1, c.maxy + 1);
        ctx.strokeStyle = C.red; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        text(ctx, `${c.area} · ${c.score.toFixed(2)}`, x0, y0 - 3, fs * 0.6, { weight: 500, color: C.ink, align: 'left', baseline: 'bottom' });
      }
    }
  }

  /** 카메라 영상 속 실제 퍽 자리: 작은 레드 고리 (평면 경기장과 영상의 관계를 보여 준다) */
  _cameraPuck(ctx, vision, toC, unit, hair, pa) {
    // 배경이 흰 화면으로 다 덮이면(배경 투명도 0) 카메라 속 자리를 알려 줄 필요가 없다 (빨간 고리가 피할 퍽처럼 보이지 않게)
    if (!vision.puck || pa <= 0.001 || this.wash >= 0.999) return;
    const [cx, cy] = toC(vision.puck.x, vision.puck.y);
    ctx.beginPath(); ctx.arc(cx, cy, unit * 0.012, 0, Math.PI * 2); ctx.lineWidth = hair; ctx.strokeStyle = rgba(C.red, 0.7 * pa); ctx.stroke();
  }

  _floorPx(uvToC) { const a = uvToC(1, 0.5), b = uvToC(0, 0.5); return Math.hypot(a[0] - b[0], a[1] - b[1]); }

  /** 평면 경기장 바탕 (모든 평면 모드 공통): 안쪽은 영상이 은은하게 비치는 종이 워시, 바깥은 종이, 네 변 헤어라인, 앞뒤 방향 안내 */
  _field(ctx, W, H, game, { label = '', topHint = true } = {}) {
    const dpr = this.dpr, hair = Math.max(1, dpr), fs = Math.max(11 * dpr, W * 0.017);
    const f = dodgeField(W, H, this.topInset), S = f.w, A = game.plane.A;
    const P = (x, y) => [f.x + x * S, f.y + y * S];
    ctx.fillStyle = rgba(C.paper, this.wash); ctx.fillRect(f.x, f.y, f.w, f.h);
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, W, f.y); ctx.fillRect(0, f.y + f.h, W, H - f.y - f.h); ctx.fillRect(0, f.y, f.x, f.h); ctx.fillRect(f.x + f.w, f.y, W - f.x - f.w, f.h);
    ctx.lineWidth = hair; ctx.strokeStyle = C.ink; ctx.strokeRect(f.x, f.y, f.w, f.h);
    if (label) text(ctx, label, f.x + W * 0.012, f.y + fs * 0.95, fs * 0.66, { weight: 600, color: C.mute, align: 'left', halo: false });
    const flip = game.plane.flip;
    if (topHint) text(ctx, flip ? '↑ 카메라쪽 · 밀기' : '↑ 몸쪽 · 당기기', f.x + f.w / 2, f.y + fs * 0.95, fs * 0.7, { weight: 500, color: C.mute, halo: false });
    text(ctx, flip ? '↓ 몸쪽 · 당기기' : '↓ 카메라쪽 · 밀기', f.x + f.w / 2, f.y + f.h - fs * 0.95, fs * 0.7, { weight: 500, color: C.mute, halo: false });
    return { f, S, A, P, hair, fs, dpr };
  }

  /**
   * 나: 잉크 정원(반지름 PUCK_R = 목표 판정에 쓰는 크기 그대로. 바깥 고리 없음), 궤적은 헤어라인.
   * 플레이 중에는 설정한 농도로 (퍽 투명도). before(ctx, me): 같은 농도로 먼저 그릴 것 (자유 연습의 목표까지 선)
   */
  _drawMe(ctx, game, puck, now, { P, S, hair }, before = null) {
    const me = puck.pos ? game.toPlane(puck.pos.x, puck.pos.y) : null;
    alphaLayer(ctx, game.running || this.peek ? this.puckAlpha : 1, (ctx) => {
      if (before) before(ctx, me);
      if (puck.trail.length > 1) {
        ctx.lineWidth = hair;
        for (let i = 1; i < puck.trail.length; i++) {
          const alpha = Math.max(0, 1 - (now - puck.trail[i].t) / 700) * 0.45;
          if (alpha <= 0) continue;
          const a = game.toPlane(puck.trail[i - 1].x, puck.trail[i - 1].y), b = game.toPlane(puck.trail[i].x, puck.trail[i].y);
          const [ax, ay] = P(a.x, a.y), [bx, by] = P(b.x, b.y);
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.strokeStyle = rgba(C.ink, alpha); ctx.stroke();
        }
      }
      if (!me) return;
      const [cx, cy] = P(me.x, me.y), r = PUCK_R * S;
      const predicted = puck.state === 'predicted';
      // 충돌 직후 무적 시간(퍽 피하기·8자 콘)에는 깜빡임
      if (game.running && now < game.invulnUntil && Math.floor(now / 100) % 2 === 0) ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = predicted ? rgba(C.ink, 0.45) : C.ink; ctx.fill();
      ctx.globalAlpha = 1;
    });
    return me;
  }

  /** 평면 경기장 이펙트: 글자(pop) · 테두리 번쩍(flash) · 지나간 목표 자리에 퍼지는 고리(ring). script: 필기체 글자 크기(가로 대비) */
  _fieldEffects(ctx, game, K, W, script = 0.05) {
    const { f, S, A, P, hair } = K;
    for (const e of game.effects) {
      if (e.type === 'pop') {
        const [cx, cy] = P(Math.min(0.88, Math.max(0.12, e.x)), Math.min(A, Math.max(0.07, e.y)));
        ctx.globalAlpha = Math.min(1, (1 - e.age) * 1.6);
        const sc = e.style === 'script';
        text(ctx, e.text, cx, cy - e.age * W * 0.04, sc ? W * script : W * 0.026, { family: sc ? F.script : F.display, weight: sc ? 700 : 800, color: e.color });
        ctx.globalAlpha = 1;
      } else if (e.type === 'flash') {
        if (K.rect) K.rect({ x: 0.5, y: A / 2, w: 1, h: A }); else { ctx.beginPath(); ctx.rect(f.x, f.y, f.w, f.h); }
        ctx.fillStyle = rgba(C.red, 0.1 * (1 - e.age)); ctx.fill();
        ctx.lineWidth = hair * 3; ctx.strokeStyle = rgba(C.red, 1 - e.age); ctx.stroke();
      } else if (e.type === 'ring') {
        const [cx, cy] = P(e.x, e.y), k = (1 + e.age * 1.4) * (K.pxPerX ? K.pxPerX(e.x, e.y) : S);
        ctx.beginPath(); ctx.arc(cx, cy, e.r * k, 0, Math.PI * 2);
        ctx.lineWidth = hair * 1.5; ctx.strokeStyle = rgba(C.ink, 0.7 * (1 - e.age)); ctx.stroke();
      }
    }
  }

  /** 지금 가야 할 목표: 진한 정원 + 맥박 고리 (8자 게이트 = 빨강, 반응 타겟 = 잉크) */
  _nextDot(ctx, cx, cy, r, pulse, hair, color = C.red) {
    ctx.beginPath(); ctx.arc(cx, cy, r * (1.35 + 0.15 * pulse), 0, Math.PI * 2); ctx.lineWidth = hair; ctx.strokeStyle = rgba(color, 0.3 + 0.3 * pulse); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  }

  /** 자유 연습 코스 평면: 번호 포인트(DOM)가 놓인 경기장에 경로선·다음 목표·내 퍽을 그린다 */
  _drawCourse(ctx, W, H, game, puck, now) {
    ctx.save();
    // 위쪽 방향 안내는 대기 중 번호 띠가 덮으므로 플레이 중에만
    const K = this._field(ctx, W, H, game, { topHint: game.running });
    const { f, S, A, P, hair, fs } = K;
    const pts = game.course.points;
    // 경로: 번호 순서대로 잇는 헤어라인 (마지막에서 처음으로 돌아가는 선은 더 옅게)
    if (pts.length > 1) {
      ctx.lineWidth = hair; ctx.strokeStyle = rgba(C.ink, 0.4);
      ctx.beginPath(); pts.forEach((p, i) => { const [x, y] = P(p.x, p.y * A); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
      if (pts.length > 2) { ctx.strokeStyle = rgba(C.ink, 0.15); ctx.beginPath(); let [x, y] = P(pts[pts.length - 1].x, pts[pts.length - 1].y * A); ctx.moveTo(x, y); [x, y] = P(pts[0].x, pts[0].y * A); ctx.lineTo(x, y); ctx.stroke(); }
    }
    // 다음 목표: 레드 고리
    if (game.running && pts.length) {
      const tg = pts[game.courseIdx % pts.length];
      const [tx, ty] = P(tg.x, tg.y * A);
      const rr = game.course.reach * S * (1.05 + 0.12 * Math.sin(now / 160));
      ctx.beginPath(); ctx.arc(tx, ty, rr, 0, Math.PI * 2); ctx.lineWidth = hair * 1.5; ctx.strokeStyle = C.red; ctx.stroke();
    }
    // 내 퍽에서 목표까지의 선 + 궤적 + 내 퍽
    this._drawMe(ctx, game, puck, now, K, (ctx, me) => {
      if (!me || !game.running || !pts.length) return;
      const tg = pts[game.courseIdx % pts.length];
      const [tx, ty] = P(tg.x, tg.y * A), [mx, my] = P(me.x, me.y);
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(tx, ty); ctx.lineWidth = hair; ctx.strokeStyle = rgba(C.red, 0.45); ctx.stroke();
    });
    // 안내
    if (!game.running) {
      const msg = pts.length ? `${pts[0].n}번에 퍽을 2초 두거나 시작을 누르세요 — 목표 ${game.course.cycles} 사이클` : '위의 번호를 끌어다 놓아 코스를 만드세요';
      text(ctx, msg, f.x + f.w / 2, f.y + f.h * 0.55, fs, { weight: 600, color: C.inkSoft, halo: true });
    }
    this._fieldEffects(ctx, game, K, W, 0.05);
    ctx.restore();
  }

  /**
   * 바닥 위 경기장 (와이드 드리블·퀵 핸즈): 카메라 영상은 그대로 두고, 구역을 실제 바닥에 원근대로 그린다.
   * 평면 좌표(가로 1 × 세로 A) → 바닥 uv → 화면. 판정과 같은 좌표라 그린 사각 구역이 곧 판정 범위.
   * 동그라미(대기 원·내 퍽)는 세로 비율 A가 실제 바닥 비율과 달라 찌그러지므로, 그 자리의 가로 축척(pxPerX)으로 둥글게 그린다.
   * f: 바닥 영역을 감싸는 화면 사각형 (안내 글자 자리)
   */
  _floorField(ctx, W, H, game, uvToC) {
    const dpr = this.dpr, hair = Math.max(1, dpr), fs = Math.max(11 * dpr, W * 0.017);
    const A = game.plane.A, flip = game.plane.flip;
    const P = (x, y) => uvToC(x, flip ? 1 - y / A : y / A);
    const path = (pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => { const [cx, cy] = P(x, y); if (i) ctx.lineTo(cx, cy); else ctx.moveTo(cx, cy); }); ctx.closePath(); };
    const rect = (z) => path([[z.x - z.w / 2, z.y - z.h / 2], [z.x + z.w / 2, z.y - z.h / 2], [z.x + z.w / 2, z.y + z.h / 2], [z.x - z.w / 2, z.y + z.h / 2]]);
    const pxPerX = (x, y) => { const a = P(x - 0.01, y), b = P(x + 0.01, y); return Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.02; };
    const cs = [P(0, 0), P(1, 0), P(1, A), P(0, A)], xs = cs.map((c) => c[0]), ys = cs.map((c) => c[1]);
    const f = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    // 배경 투명도 (와이드 = 0 이면 흰 화면, 아니면 칠하지 않음 · 퀵 핸즈 = 설정대로): 카메라 영상 위에 종이색. 바닥 틀은 그 위에 다시 그린다
    if (this.wash > 0.001) {
      ctx.fillStyle = rgba(C.paper, this.wash); ctx.fillRect(0, 0, W, H);
      path([[0, 0], [1, 0], [1, A], [0, A]]); ctx.lineWidth = hair; ctx.strokeStyle = rgba(C.ink, 0.25 + 0.5 * this.wash); ctx.stroke();
    }
    return { f, S: this._floorPx(uvToC), A, P, hair, fs, dpr, path, rect, pxPerX };
  }

  /** 바닥 위 경기장의 내 퍽: 카메라 속 진짜 퍽 자리에 잉크 정원 (그 자리의 바닥 축척대로 — 먼 쪽은 작게). 궤적은 헤어라인 */
  _drawMeFloor(ctx, game, puck, now, { hair }, uvToC) {
    if (!puck.pos) return;
    alphaLayer(ctx, game.running || this.peek ? this.puckAlpha : 1, (ctx) => {
      if (puck.trail.length > 1) {
        ctx.lineWidth = hair;
        for (let i = 1; i < puck.trail.length; i++) {
          const alpha = Math.max(0, 1 - (now - puck.trail[i].t) / 700) * 0.45;
          if (alpha <= 0) continue;
          const [ax, ay] = uvToC(puck.trail[i - 1].x, puck.trail[i - 1].y), [bx, by] = uvToC(puck.trail[i].x, puck.trail[i].y);
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.strokeStyle = rgba(C.ink, alpha); ctx.stroke();
        }
      }
      const { x: u, y: v } = puck.pos;
      const [cx, cy] = uvToC(u, v), [ax, ay] = uvToC(u - 0.01, v), [bx, by] = uvToC(u + 0.01, v);
      const r = Math.max(3 * this.dpr, PUCK_R * Math.hypot(bx - ax, by - ay) / 0.02); // 그 자리의 바닥 가로 축척 (u = 평면 x)
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = puck.state === 'predicted' ? rgba(C.ink, 0.45) : C.ink; ctx.fill();
      ctx.lineWidth = hair; ctx.strokeStyle = rgba(C.paper, 0.9); ctx.stroke(); // 어두운 바닥에서도 보이게 얇은 종이색 가장자리
    });
  }

  /**
   * 가운데 시작 원 (와이드 드리블 훈련 시작·8자 드리블 시작): 퍽을 둔 채로 3초.
   * k = 0..1 채운 정도. 채우는 동안 가운데에 3·2·1, 비어 있으면 점선 + 안내
   */
  _drawHoldCircle(ctx, [cx, cy], r, k, hair, fs, live) {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = rgba(C.paper, 0.82); ctx.fill();
    if (k > 0) {
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, k)); ctx.closePath();
      ctx.fillStyle = rgba(C.red, 0.8); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.lineWidth = hair * 2;
    if (k > 0) ctx.strokeStyle = C.red; else { ctx.setLineDash([r * 0.2, r * 0.14]); ctx.strokeStyle = rgba(C.red, 0.7); }
    ctx.stroke(); ctx.setLineDash([]);
    if (!live) return;
    if (k > 0) text(ctx, String(Math.max(1, Math.ceil(3 - k * 3))), cx, cy + r * 0.04, r * 1.1, { family: F.display, weight: 900, color: C.ink, halo: true });
    else pill(ctx, '퍽을 가운데 원에 3초 두세요', cx, cy - r - fs * 1.3, fs * 0.8, { weight: 600 });
  }

  /**
   * 와이드 드리블 평면: 숫자·칸 없이 구역만. 지금 가야 할 구역 = 진한 빨강, 그다음 구역 = 옅은 빨강 (8자 드리블과 같은 규칙).
   * 훈련 1은 좌우 끝 구역, 훈련 2·3은 판을 10칸으로 나눈 자리 순서 (칸은 그리지 않는다)
   */
  _drawWide(ctx, W, H, game, puck, now, uvToC) {
    ctx.save();
    const running = game.running && game.wide;
    const stage = running ? game.wide.stage : 0;
    const K = this._floorField(ctx, W, H, game, uvToC);
    const { f, A, hair, fs } = K;
    const yc = A / 2, bh = WIDE_BAND * A;
    // 훈련 번호: 바닥 영역 왼쪽 위 (위쪽 점수판에 가리지 않게)
    text(ctx, `DRILL ${stage + 1}/${WIDE_DRILLS.length}`, f.x, Math.max(f.y - fs * 0.9, this.topInset * H + fs * 0.9), fs * 0.7, { weight: 700, color: C.ink, align: 'left', halo: true });

    // 구역만 그린다: 지금 가야 할 곳 = 진한 빨강(맥박), 그다음 = 옅은 빨강.
    // 훈련 시작 전 = 가운데 대기 동그라미(3초 동안 차오름). 게임 전에는 훈련 1의 시작 화면 미리보기
    const zones = running ? game.zones : [
      { x: 0.5, y: yc, r: WIDE_HOLD_R, hold: true, progress: 0 },
      { x: WIDE_END.x, y: yc, w: WIDE_END.w, h: bh, active: false },
    ];
    const pulse = 0.5 + 0.5 * Math.sin(now / 200);
    for (const z of [...zones].sort((a, b) => a.active - b.active)) { // 그다음 구역을 먼저, 지금 구역을 위에
      if (z.hold) {
        // 가운데 대기 동그라미: 퍽을 둔 채로 3·2·1 (시계 방향으로 차오름). 시작 원처럼 둥글게, 크기는 그 자리의 바닥 축척대로
        this._drawHoldCircle(ctx, K.P(z.x, z.y), z.r * K.pxPerX(z.x, z.y), z.progress || 0, hair, fs, running);
        continue;
      }
      K.rect(z); // 실제 바닥 위의 구역 (원근대로: 먼 쪽은 좁게)
      if (z.active) {
        ctx.fillStyle = rgba(C.red, 0.5 + 0.14 * pulse); ctx.fill();
        ctx.lineWidth = hair * 2; ctx.strokeStyle = C.red; ctx.stroke();
      } else {
        ctx.fillStyle = rgba(C.red, 0.16); ctx.fill();
        ctx.lineWidth = hair * 1.2; ctx.strokeStyle = rgba(C.red, 0.6); ctx.stroke();
      }
    }

    this._drawMeFloor(ctx, game, puck, now, K, uvToC);
    if (!game.running) {
      const min = Math.round(game.playSeconds / 60);
      text(ctx, `시작하면 훈련 3가지를 ${min}분씩 이어서 합니다`, f.x + f.w / 2, f.y + f.h * 0.42, fs, { weight: 600, color: C.inkSoft, halo: true });
      WIDE_DRILLS.forEach((d, i) => text(ctx, d.label, f.x + f.w / 2, f.y + f.h * 0.42 + fs * (1.9 + i * 1.45), fs * 0.85, { weight: 500, color: C.mute, halo: true }));
      text(ctx, '훈련마다 퍽을 가운데에 3초 두면 시작', f.x + f.w / 2, f.y + f.h * 0.42 + fs * (1.9 + WIDE_DRILLS.length * 1.45 + 0.4), fs * 0.85, { weight: 600, color: C.red, halo: true });
    }
    this._fieldEffects(ctx, game, K, W, 0.045);
    ctx.restore();
  }

  /** 퍽 피하기 평면: 빨간 정원 = 피할 퍽, 잉크 정원 = 나 */
  _drawDodge(ctx, W, H, game, puck, now) {
    ctx.save();
    const K = this._field(ctx, W, H, game, { label: 'FIELD' });
    const { f, S, A, P, hair, fs, dpr } = K;

    // 날아오는 퍽 (경기장 안에서만 보이게 클립)
    ctx.save(); ctx.beginPath(); ctx.rect(f.x, f.y, f.w, f.h); ctx.clip();
    for (const fl of game.flyers || []) {
      if (now < fl.launchAt) continue;
      const [cx, cy] = P(fl.x, fl.y);
      ctx.globalAlpha = fl.hit ? 0.3 : 1;
      ctx.beginPath(); ctx.arc(cx, cy, FLYER_R * S, 0, Math.PI * 2); ctx.fillStyle = C.red; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, FLYER_R * S * 0.62, 0, Math.PI * 2); ctx.lineWidth = hair; ctx.strokeStyle = rgba(C.paper, 0.4); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    // 출발 경고: 테두리 위의 작은 레드 삼각형 (진행 방향)
    for (const fl of game.flyers || []) {
      if (now >= fl.launchAt) continue;
      const [cx, cy] = P(Math.min(1, Math.max(0, fl.x)), Math.min(A, Math.max(0, fl.y)));
      const sz = Math.max(7 * dpr, W * 0.011);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.atan2(fl.vy, fl.vx));
      ctx.globalAlpha = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(now / 60));
      ctx.beginPath(); ctx.moveTo(sz * 1.3, 0); ctx.lineTo(-sz * 0.2, -sz * 0.8); ctx.lineTo(-sz * 0.2, sz * 0.8); ctx.closePath(); ctx.fillStyle = C.red; ctx.fill();
      ctx.restore();
    }

    const me = this._drawMe(ctx, game, puck, now, K);
    if (!me) {
      text(ctx, '퍽이 인식되면 여기에 표시됩니다', f.x + f.w / 2, f.y + f.h / 2, fs * 0.9, { weight: 500, color: C.mute, halo: false });
    }
    if (!game.running) {
      // 범례
      const y = f.y + f.h * 0.3, r = fs * 0.55;
      ctx.beginPath(); ctx.arc(f.x + f.w / 2 - fs * 5.2, y, r, 0, Math.PI * 2); ctx.fillStyle = C.red; ctx.fill();
      text(ctx, '사방에서 오는 빨간 퍽 — 피하기', f.x + f.w / 2 - fs * 5.2 + r * 1.8, y, fs * 0.9, { weight: 600, align: 'left', halo: false });
    }
    this._fieldEffects(ctx, game, K, W, 0.055);
    ctx.restore();
  }

  /**
   * 8자 드리블 평면: 두 콘(위에서 본 충돌 범위 + 콘 모양), 게이트 = 다음 진한 빨강 · 그다음 옅은 빨강 · 나머지 옅은 잉크 고리(코스 모양).
   * 게이트는 평면 좌표 그대로 — 화면의 위·아래 = 8자 방향의 위로·아래로
   */
  _drawFigure8(ctx, W, H, game, puck, now, { calib = null, idleHold = 0 } = {}) {
    ctx.save();
    const K = this._field(ctx, W, H, game);
    const { S, P, hair, fs } = K;
    for (const c of game.cones) {
      const [cx, cy] = P(c.x, c.y), r = c.r * S, hit = now < c.hitUntil;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = hit ? rgba(C.red, 0.18) : rgba(C.ink, 0.06); ctx.fill();
      ctx.lineWidth = hair; ctx.strokeStyle = hit ? C.red : rgba(C.ink, 0.45); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - r * 0.62, cy + r * 0.55); ctx.lineTo(cx + r * 0.62, cy + r * 0.55); ctx.lineTo(cx + r * 0.1, cy - r * 0.78); ctx.lineTo(cx - r * 0.1, cy - r * 0.78); ctx.closePath();
      ctx.fillStyle = hit ? C.red : C.ink; ctx.fill();
      ctx.fillStyle = C.paper; ctx.fillRect(cx - r * 0.34, cy - r * 0.2, r * 0.68, r * 0.17);
    }
    const wps = game.waypoints;
    if (wps.length) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 180);
      const i1 = game.wpIndex % wps.length, i2 = (game.wpIndex + 1) % wps.length;
      const rg = GATE_DRAW_R * S;
      wps.forEach((wp, i) => {
        if (i === i1 || i === i2) return;
        const [cx, cy] = P(wp.x, wp.y);
        ctx.beginPath(); ctx.arc(cx, cy, rg, 0, Math.PI * 2); ctx.lineWidth = hair; ctx.strokeStyle = rgba(C.ink, 0.3); ctx.stroke();
      });
      const [ax, ay] = P(wps[i1].x, wps[i1].y), [bx, by] = P(wps[i2].x, wps[i2].y);
      // 다음 -> 그다음: 옅은 빨강 점선으로 방향만 (가운데에서 어느 쪽 고리로 도는지 알 수 있게)
      const d = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / d, uy = (by - ay) / d;
      if (d > rg * 3) {
        ctx.beginPath(); ctx.moveTo(ax + ux * rg * 1.6, ay + uy * rg * 1.6); ctx.lineTo(bx - ux * rg * 1.3, by - uy * rg * 1.3);
        ctx.setLineDash([rg * 0.3, rg * 0.3]); ctx.lineWidth = hair; ctx.strokeStyle = rgba(C.red, 0.45); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.beginPath(); ctx.arc(bx, by, rg, 0, Math.PI * 2); ctx.fillStyle = rgba(C.red, 0.22); ctx.fill(); ctx.lineWidth = hair; ctx.strokeStyle = rgba(C.red, 0.6); ctx.stroke();
      this._nextDot(ctx, ax, ay, rg, pulse, hair);
    }
    // 시작 대기: 가운데 원에 퍽을 둔 채로 3·2·1 (원이 시계 방향으로 차오름) -> 다 세면 시작
    if (game.running && game.f8Hold) this._drawHoldCircle(ctx, P(game.center.x, game.center.y), F8_HOLD_R * S, game.f8Hold.t / F8_HOLD_SEC, hair, fs, true);
    // 대기 중 핸즈프리 시작도 같은 흰 훈련 화면의 가운데 원에서 (카메라 화면으로 바꾸지 않는다)
    else if (!game.running && calib?.active && calib.plane) this._drawHoldCircle(ctx, P(game.center.x, game.center.y), F8_HOLD_R * S, Math.min(1, idleHold / 3), hair, fs, true);
    this._drawMe(ctx, game, puck, now, K);
    this._fieldEffects(ctx, game, K, W, 0.05);
    ctx.restore();
  }

  /** 퀵 핸즈 평면: 가운데 박스. 박스 안 = 옅은 빨강 맥박, 밖으로 나가면 빨강 점선 경고, 시작 전은 잉크 점선 */
  _drawQuick(ctx, W, H, game, puck, now, uvToC) {
    ctx.save();
    const K = this._floorField(ctx, W, H, game, uvToC);
    const { f, hair, fs } = K;
    const unit = Math.min(W, H);
    const pulse = 0.5 + 0.5 * Math.sin(now / 250);
    for (const z of game.zones) {
      K.rect(z); // 실제 바닥 위의 박스 (원근대로)
      if (game.running && z.warn) { ctx.fillStyle = rgba(C.red, 0.24); ctx.fill(); ctx.setLineDash([unit * 0.012, unit * 0.01]); ctx.lineWidth = hair * 2; ctx.strokeStyle = C.red; ctx.stroke(); ctx.setLineDash([]); }
      else if (game.running) { ctx.fillStyle = rgba(C.red, 0.16 + 0.1 * pulse); ctx.fill(); ctx.lineWidth = hair * 2.2; ctx.strokeStyle = C.red; ctx.stroke(); }
      else { ctx.fillStyle = rgba(C.paper, 0.3); ctx.fill(); ctx.setLineDash([unit * 0.012, unit * 0.01]); inkStroke(ctx, hair * 1.4, C.ink); ctx.setLineDash([]); }
    }
    this._drawMeFloor(ctx, game, puck, now, K, uvToC);
    if (!game.running) text(ctx, game.mode.desc, f.x + f.w / 2, f.y + f.h / 2, fs, { weight: 600, color: C.inkSoft, halo: true });
    this._fieldEffects(ctx, game, K, W, 0.05);
    ctx.restore();
  }

  /** 반응 타겟 평면: 진한 잉크 정원 하나. 나타날 때 큰 고리가 0.3초 동안 줄어들며 자리를 잡는다 */
  _drawReaction(ctx, W, H, game, puck, now) {
    ctx.save();
    const K = this._field(ctx, W, H, game);
    const { f, S, P, hair, fs } = K;
    const pulse = 0.5 + 0.5 * Math.sin(now / 180);
    for (const t of game.targets) {
      const [cx, cy] = P(t.x, t.y), r = t.r * S;
      const age = (now - t.born) / 1000;
      if (age >= 0 && age < 0.3) {
        const k = 1 - age / 0.3;
        ctx.beginPath(); ctx.arc(cx, cy, r * (1 + 2.2 * k), 0, Math.PI * 2); ctx.lineWidth = hair * 1.5; ctx.strokeStyle = rgba(C.ink, 0.15 + 0.7 * k); ctx.stroke();
      }
      this._nextDot(ctx, cx, cy, r, pulse, hair, C.ink);
    }
    this._drawMe(ctx, game, puck, now, K);
    if (!game.running) text(ctx, game.mode.desc, f.x + f.w / 2, f.y + f.h / 2, fs, { weight: 600, color: C.inkSoft, halo: true });
    this._fieldEffects(ctx, game, K, W, 0.05);
    ctx.restore();
  }

  /** 퍽 마커: 종이 헤일로 + 잉크 고리 + 레드 중심점 */
  _drawPuck(ctx, puck, uvToC, unit, hair, now, rFloor) {
    if (!puck.pos) return;
    const [cx, cy] = uvToC(puck.pos.x, puck.pos.y);
    const r = Math.max(unit * 0.02, rFloor * 1.5);
    const predicted = puck.state === 'predicted';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    if (predicted) ctx.setLineDash([hair * 3, hair * 3]);
    inkStroke(ctx, hair * 1.2, C.ink);
    ctx.setLineDash([]);
    // 레드 중심점: 예전(반지름 화면의 0.6%)보다 두 배 크게 — 대기 화면에서도 퍽 자리가 잘 보이게
    ctx.beginPath(); ctx.arc(cx, cy, Math.max(4 * this.dpr, unit * 0.013), 0, Math.PI * 2); ctx.fillStyle = C.red; ctx.fill();
    if (puck.speed > 1.2) sparks(ctx, cx, cy, r * 1.25, r * 1.6, 8, rgba(C.ink, 0.7), hair, now / 300);
  }

  /** 스틱 블레이드: 잉크 마름모 */
  _drawStick(ctx, stick, toC, unit, hair) {
    if (!stick) return;
    const [cx, cy] = toC(stick.x, stick.y);
    const s = unit * 0.02;
    ctx.beginPath(); ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s, cy); ctx.lineTo(cx, cy + s); ctx.lineTo(cx - s, cy); ctx.closePath();
    ctx.fillStyle = rgba(C.paper, 0.55); ctx.fill();
    inkStroke(ctx, hair * 1.3, C.ink);
    const [bx0, by0] = toC(stick.bbox[0], stick.bbox[1]);
    const [bx1, by1] = toC(stick.bbox[2] + 1, stick.bbox[3] + 1);
    ctx.setLineDash([unit * 0.008, unit * 0.008]); ctx.lineWidth = hair * 0.7; ctx.strokeStyle = rgba(C.ink, 0.5);
    ctx.strokeRect(bx0, by0, bx1 - bx0, by1 - by0); ctx.setLineDash([]);
  }

  /** 시작 준비 3/3: 바닥 네 모서리 근처 표적 (원근대로 찌그러진 원 = 실제 판정 범위). 닿으면 빨강 + 체크 */
  _drawSetupTest(ctx, t, uvToC, unit, hair, fs) {
    for (const g of t.targets) {
      ctx.beginPath();
      for (let k = 0; k <= 36; k++) {
        const a = (k / 36) * Math.PI * 2;
        const [x, y] = uvToC(g.x + Math.cos(a) * t.r, g.y + Math.sin(a) * t.r);
        if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = g.hit ? rgba(C.red, 0.6) : rgba(C.paper, 0.5); ctx.fill();
      ctx.setLineDash(g.hit ? [] : [unit * 0.012, unit * 0.009]);
      inkStroke(ctx, hair * 1.6, g.hit ? C.red : C.ink);
      ctx.setLineDash([]);
      const [cx, cy] = uvToC(g.x, g.y);
      if (g.hit) text(ctx, '✓', cx, cy, fs * 1.5, { weight: 900, color: C.paper, halo: false });
    }
  }

  /** 가운데 원 UI */
  _drawCalib(ctx, calib, toC, sx, unit, fs, hair, idleHold) {
    const c = calib.circle;
    const [cx, cy] = toC(c.x, c.y); const r = c.r * sx;
    const starting = calib.status === 'puck';
    const mismatch = calib.status === 'mismatch';
    const learning = calib.status === 'ok' || calib.status === 'refresh';
    // 원 안은 칠하지 않는다: 영상 속 퍽이 흐릿해 보이지 않게 (인식은 오버레이가 아닌 원본 영상으로 하지만, 눈으로도 또렷이)
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.setLineDash(starting || learning ? [] : [unit * 0.014, unit * 0.012]);
    inkStroke(ctx, hair * 1.5, mismatch ? C.red : C.ink);
    ctx.setLineDash([]);

    const prog = starting ? idleHold / 3 : calib.hold / 3;
    if (prog > 0) {
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.13, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, prog));
      ctx.lineWidth = unit * 0.009; ctx.strokeStyle = C.red; ctx.stroke();
      text(ctx, String(Math.max(1, Math.ceil(3 - prog * 3))), cx, cy, r * 1.1, { family: F.display, weight: 900 });
    }
    if (calib.sample?.status === 'ok' && !starting) {
      const [ox, oy] = toC(calib.sample.cx, calib.sample.cy);
      ctx.beginPath(); ctx.arc(ox, oy, unit * 0.014, 0, Math.PI * 2); ctx.fillStyle = `rgb(${calib.sample.r},${calib.sample.g},${calib.sample.b})`; ctx.fill();
      inkStroke(ctx, hair, C.ink);
    }
    if (mismatch && calib.registered) {
      const m = calib.registered, px = cx + r * 1.5, py = cy - r * 0.85;
      ctx.beginPath(); ctx.arc(px, py, unit * 0.022, 0, Math.PI * 2); ctx.fillStyle = `rgb(${m.r},${m.g},${m.b})`; ctx.fill(); inkStroke(ctx, hair, C.ink);
      text(ctx, '등록된 퍽', px, py + unit * 0.045, fs * 0.72, { weight: 600 });
    }

    const label = starting ? `퍽 인식됨 — ${Math.max(1, Math.ceil(3 - idleHold))}초 후 시작`
      : mismatch ? '등록된 퍽과 다른 물체입니다'
      : calib.status === 'blocked' ? '퍽을 원 밖으로 뺐다가 다시'
      : calib.status === 'refresh' ? '등록된 퍽 다시 인식 중 — 가만히'
      : calib.status === 'too_big' ? '너무 커요 — 카메라에서 더 멀리'
      : calib.status === 'ok' ? '퍽 등록 중 — 가만히'
      : calib.sample?.scattered ? '바닥 무늬만 보여요 — 물체를 원 안에'
      : (calib.target === 'stick' ? '스틱 테이프를 원 안에' : calib.registered ? '등록된 퍽을 원 안에' : '퍽을 원 안에');
    pill(ctx, label, cx, cy - r - fs * 1.6, fs, mismatch ? { bg: C.red, fg: C.paper, border: null } : starting ? { bg: C.ink, fg: C.paper, border: null } : {});
    const sub = calib.manual ? '배경과 다른 색이면 무엇이든'
      : starting ? '움직이면 취소됩니다'
      : calib.status === 'blocked' ? '그러면 3초 뒤 시작'
      : mismatch ? '등록된 퍽을 놓거나, 아래 버튼으로 교체하세요'
      : calib.registered ? '3초 두면 시작' : '공 · 뚜껑 · 퍽 — 배경과 색만 다르면 됩니다';
    pill(ctx, sub, cx, cy + r + fs * 1.5, fs * 0.74, { weight: 500, border: null, alpha: 0.85 });
  }
}

