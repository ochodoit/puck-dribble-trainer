// 오버레이 캔버스 렌더링 — 영상 위에 얇은 잉크 선(종이색 헤일로)과 알약 라벨, 포인트 레드
import { PUCK_R, FLYER_R } from './game.js';
import { C, F, rgba, inkStroke, text, pill, sparks } from './theme.js';

/** 퍽 피하기의 평면 경기장 사각형 (캔버스 px). topInset: 상단 HUD가 가리는 높이 비율 */
export function dodgeField(W, H, topInset = 0) {
  const m = W * 0.05;
  const top = Math.max(m, topInset * H + m * 0.5);
  return { x: m, y: top, w: W - 2 * m, h: Math.max(10, H - top - m) };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.topInset = 0;
    this.wash = 0.88;   // 평면 경기장 종이 배경의 불투명도
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
  draw({ vision, puck, game, procSize, now, showCandidates, idleHold = 0, calib = null, areaEditing = false }) {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const sx = W / procSize.PW, sy = H / procSize.PH;
    const toC = (px, py) => [px * sx, py * sy];
    const floor = vision?.floor;
    const mapping = floor?.mapping;
    const uvToC = (u, v) => { const [px, py] = mapping.toPx(u, v); return toC(px, py); };
    const unit = Math.min(W, H);                 // 크기 기준
    const fs = Math.max(11 * this.dpr, unit * 0.03);        // 본문 글자 (CSS 11px 이상)
    const hair = Math.max(this.dpr, unit * 0.0014);   // 헤어라인 (화면상 약 1px)
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    // ---- 게임 영역 ----
    if (floor?.quad) {
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
    if (mapping && (areaEditing || floor.mode === 'manual' || (floor.mode === 'auto' && !floor.fallback))) {
      const strong = areaEditing;
      const N = strong ? 6 : 4;
      ctx.lineWidth = strong ? hair : hair * 0.6; ctx.strokeStyle = rgba(C.ink, strong ? 0.55 : 0.16);
      for (let i = 1; i < N; i++) {
        const t = i / N;
        ctx.beginPath(); let [ax, ay] = uvToC(t, 0); ctx.moveTo(ax, ay); [ax, ay] = uvToC(t, 1); ctx.lineTo(ax, ay); ctx.stroke();
        ctx.beginPath(); [ax, ay] = uvToC(0, t); ctx.moveTo(ax, ay); [ax, ay] = uvToC(1, t); ctx.lineTo(ax, ay); ctx.stroke();
      }
      if (strong) {
        let [tx, ty] = uvToC(0.5, 0); pill(ctx, '뒤쪽 · 멀리 — 좁게', tx, ty - fs * 1.4, fs * 0.85);
        [tx, ty] = uvToC(0.5, 1); pill(ctx, '앞쪽 · 카메라 — 넓게', tx, ty - fs * 1.4, fs * 0.85);
        if (puck.pos) { const [px, py] = uvToC(puck.pos.x, puck.pos.y); pill(ctx, `바닥 좌표 ${puck.pos.x.toFixed(2)}, ${puck.pos.y.toFixed(2)}`, px, py - fs * 2.2, fs * 0.8, { bg: C.ink, fg: C.paper, border: null }); }
      }
    }

    // ---- 가운데 원: 물체 등록 / 핸즈프리 시작 ----
    if (calib?.active && calib.circle) {
      this._drawCalib(ctx, calib, toC, sx, unit, fs, hair, idleHold);
      if (mapping && !calib.manual) { this._drawStick(ctx, vision.stick, toC, unit, hair); this._drawPuck(ctx, puck, uvToC, unit, hair, now, PUCK_R * this._floorPx(uvToC)); }
      return;
    }

    if (!mapping) return;

    // ---- 아케이드: 화면 공간 렌더 ----
    if (game.mode.id === 'arcade') {
      game.arcade.draw(ctx, W, H, now, puck);
      // 실제 퍽 위치를 작은 고리로 표시해 매핑 관계를 보여줌
      if (vision.puck) { const [cx, cy] = toC(vision.puck.x, vision.puck.y); ctx.beginPath(); ctx.arc(cx, cy, unit * 0.012, 0, Math.PI * 2); ctx.lineWidth = hair; ctx.strokeStyle = rgba(C.red, 0.7); ctx.stroke(); }
      return;
    }

    // ---- 자유 연습: 직접 만든 코스를 평면에서 ----
    if (game.mode.id === 'free') {
      this._drawCourse(ctx, W, H, game, puck, now);
      if (vision.puck) { const [cx, cy] = toC(vision.puck.x, vision.puck.y); ctx.beginPath(); ctx.arc(cx, cy, unit * 0.012, 0, Math.PI * 2); ctx.lineWidth = hair; ctx.strokeStyle = rgba(C.red, 0.7); ctx.stroke(); }
      return;
    }

    // ---- 퍽 피하기: 바닥 원근이 아니라 평면에서 ----
    if (game.mode.id === 'obstacle') {
      this._drawDodge(ctx, W, H, game, puck, now);
      if (vision.puck) { const [cx, cy] = toC(vision.puck.x, vision.puck.y); ctx.beginPath(); ctx.arc(cx, cy, unit * 0.012, 0, Math.PI * 2); ctx.lineWidth = hair; ctx.strokeStyle = rgba(C.red, 0.7); ctx.stroke(); }
      return;
    }

    const floorPxW = this._floorPx(uvToC);
    const R = (r) => r * floorPxW; // 정규화 반지름 -> 캔버스 px (가로 기준)

    // ---- 구역 ----
    for (const z of game.zones) {
      const corners = [[z.x - z.w / 2, z.y - z.h / 2], [z.x + z.w / 2, z.y - z.h / 2], [z.x + z.w / 2, z.y + z.h / 2], [z.x - z.w / 2, z.y + z.h / 2]];
      ctx.beginPath();
      corners.forEach(([u, v], i) => { const [cx, cy] = uvToC(clamp01(u), clamp01(v)); i ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy); });
      ctx.closePath();
      const pulse = 0.5 + 0.5 * Math.sin(now / 250);
      if (z.warn) { ctx.fillStyle = rgba(C.red, 0.16); ctx.fill(); ctx.setLineDash([unit * 0.012, unit * 0.01]); inkStroke(ctx, hair * 1.6, C.red); ctx.setLineDash([]); }
      else if (z.active) { ctx.fillStyle = rgba(C.red, 0.1 + 0.08 * pulse); ctx.fill(); inkStroke(ctx, hair * 1.8, C.red); }
      else { ctx.fillStyle = rgba(C.paper, 0.22); ctx.fill(); ctx.setLineDash([unit * 0.012, unit * 0.01]); inkStroke(ctx, hair, C.ink); ctx.setLineDash([]); }
    }

    // ---- 8자 게이트: 종이 원반 + 세리프 숫자, 다음 게이트는 레드 ----
    game.waypoints.forEach((wp, i) => {
      const [cx, cy] = uvToC(wp.x, wp.y);
      const isNext = i === game.wpIndex;
      const r = R(0.075) * (isNext ? 1 + 0.06 * Math.sin(now / 180) : 0.82);
      ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.62, 0, 0, Math.PI * 2);
      ctx.fillStyle = isNext ? C.red : rgba(C.paper, 0.85); ctx.fill();
      ctx.lineWidth = hair * 1.2; ctx.strokeStyle = C.ink; ctx.stroke();
      text(ctx, String(i + 1), cx, cy + fs * 0.05, fs * (isNext ? 1.25 : 1), { family: F.display, weight: 900, color: isNext ? C.paper : C.ink, halo: false });
    });

    // ---- 타겟: 잉크 동심원 + 레드 중심 ----
    for (const t of game.targets) {
      const [cx, cy] = uvToC(t.x, t.y);
      const age = (now - t.born) / 1000;
      const r = R(t.r) * (1 + 0.05 * Math.sin(age * 6));
      ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.62, 0, 0, Math.PI * 2); ctx.fillStyle = rgba(C.paper, 0.45); ctx.fill(); inkStroke(ctx, hair * 1.4);
      ctx.beginPath(); ctx.ellipse(cx, cy, r * 0.62, r * 0.62 * 0.62, 0, 0, Math.PI * 2); ctx.lineWidth = hair; ctx.strokeStyle = C.ink; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx, cy, r * 0.22, r * 0.22 * 0.62, 0, 0, Math.PI * 2); ctx.fillStyle = C.red; ctx.fill();
    }

    // ---- 콘: 잉크 삼각형 + 종이 띠 ----
    for (const c of game.cones) {
      const [cx, cy] = uvToC(c.x, c.y);
      const r = R(c.r), h = r * 2.2;
      const hit = now < c.hitUntil;
      ctx.beginPath(); ctx.ellipse(cx, cy, r * 1.25, r * 0.5, 0, 0, Math.PI * 2); ctx.fillStyle = rgba(C.paper, 0.6); ctx.fill(); ctx.lineWidth = hair; ctx.strokeStyle = C.ink; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - r * 0.85, cy); ctx.lineTo(cx + r * 0.85, cy); ctx.lineTo(cx + r * 0.14, cy - h); ctx.lineTo(cx - r * 0.14, cy - h); ctx.closePath();
      ctx.fillStyle = hit ? C.red : C.ink; ctx.fill();
      ctx.fillStyle = C.paper; ctx.fillRect(cx - r * 0.5, cy - h * 0.55, r, h * 0.12);
    }

    this._drawStick(ctx, vision.stick, toC, unit, hair);

    // ---- 퍽 궤적 + 마커 ----
    if (puck.trail.length > 1) {
      for (let i = 1; i < puck.trail.length; i++) {
        const a = puck.trail[i - 1], b = puck.trail[i];
        const alpha = Math.max(0, 1 - (now - b.t) / 900) * 0.6;
        if (alpha <= 0) continue;
        const [ax, ay] = uvToC(a.x, a.y), [bx, by] = uvToC(b.x, b.y);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
        ctx.strokeStyle = rgba(C.red, alpha); ctx.lineWidth = hair * 1.4; ctx.stroke();
      }
    }
    this._drawPuck(ctx, puck, uvToC, unit, hair, now, R(PUCK_R));

    // ---- 디버그: 퍽 후보 ----
    if (showCandidates && vision.puckCandidates) {
      for (const c of vision.puckCandidates) {
        const [x0, y0] = toC(c.minx, c.miny), [x1, y1] = toC(c.maxx + 1, c.maxy + 1);
        ctx.strokeStyle = C.red; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        text(ctx, `${c.area} · ${c.score.toFixed(2)}`, x0, y0 - 3, fs * 0.6, { weight: 500, color: C.ink, align: 'left', baseline: 'bottom' });
      }
    }

    // ---- 이펙트 ----
    for (const e of game.effects) {
      if (e.type === 'pop') {
        const [cx, cy] = uvToC(clamp01(e.x), clamp01(e.y));
        ctx.globalAlpha = Math.min(1, (1 - e.age) * 1.6);
        const script = e.style === 'script';
        text(ctx, e.text, cx, cy - e.age * unit * 0.07, script ? fs * 2.6 : fs * 1.35, { family: script ? F.script : F.display, weight: script ? 700 : 800, color: e.color });
        ctx.globalAlpha = 1;
      } else if (e.type === 'flash') {
        const bw = unit * 0.016;
        ctx.lineWidth = bw; ctx.strokeStyle = rgba(C.red, 1 - e.age); ctx.strokeRect(bw / 2, bw / 2, W - bw, H - bw);
      }
    }
  }

  _floorPx(uvToC) { const a = uvToC(1, 0.5), b = uvToC(0, 0.5); return Math.hypot(a[0] - b[0], a[1] - b[1]); }

  /** 자유 연습 코스 평면: 번호 포인트(DOM)가 놓인 경기장에 경로선·다음 목표·내 퍽을 그린다 */
  _drawCourse(ctx, W, H, game, puck, now) {
    const dpr = this.dpr, hair = Math.max(1, dpr), fs = Math.max(11 * dpr, W * 0.017);
    const f = dodgeField(W, H, this.topInset), S = f.w, A = game.plane.A;
    const P = (x, y) => [f.x + x * S, f.y + y * S];
    ctx.save();
    ctx.fillStyle = rgba(C.paper, this.wash); ctx.fillRect(f.x, f.y, f.w, f.h);
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, W, f.y); ctx.fillRect(0, f.y + f.h, W, H - f.y - f.h); ctx.fillRect(0, f.y, f.x, f.h); ctx.fillRect(f.x + f.w, f.y, W - f.x - f.w, f.h);
    ctx.lineWidth = hair; ctx.strokeStyle = C.ink; ctx.strokeRect(f.x, f.y, f.w, f.h);
    const flip = game.plane.flip;
    text(ctx, flip ? '↓ 몸쪽 · 당기기' : '↓ 카메라쪽 · 밀기', f.x + f.w / 2, f.y + f.h - fs * 0.95, fs * 0.7, { weight: 500, color: C.mute, halo: false });

    const pts = game.course.points;
    // 경로: 번호 순서대로 잇는 헤어라인 (마지막에서 처음으로 돌아가는 선은 더 옅게)
    if (pts.length > 1) {
      ctx.lineWidth = hair; ctx.strokeStyle = rgba(C.ink, 0.4);
      ctx.beginPath(); pts.forEach((p, i) => { const [x, y] = P(p.x, p.y * A); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
      if (pts.length > 2) { ctx.strokeStyle = rgba(C.ink, 0.15); ctx.beginPath(); let [x, y] = P(pts[pts.length - 1].x, pts[pts.length - 1].y * A); ctx.moveTo(x, y); [x, y] = P(pts[0].x, pts[0].y * A); ctx.lineTo(x, y); ctx.stroke(); }
    }
    const me = puck.pos ? game.toPlane(puck.pos.x, puck.pos.y) : null;
    // 다음 목표: 레드 고리 + 내 퍽에서 목표까지의 선
    if (game.running && pts.length) {
      const tg = pts[game.courseIdx % pts.length];
      const [tx, ty] = P(tg.x, tg.y * A);
      const rr = game.course.reach * S * (1.05 + 0.12 * Math.sin(now / 160));
      ctx.beginPath(); ctx.arc(tx, ty, rr, 0, Math.PI * 2); ctx.lineWidth = hair * 1.5; ctx.strokeStyle = C.red; ctx.stroke();
      if (me) { const [mx, my] = P(me.x, me.y); ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(tx, ty); ctx.lineWidth = hair; ctx.strokeStyle = rgba(C.red, 0.45); ctx.stroke(); }
    }
    // 궤적 + 내 퍽 (잉크 정원 + 고리)
    if (puck.trail.length > 1) {
      ctx.lineWidth = hair;
      for (let i = 1; i < puck.trail.length; i++) {
        const a = game.toPlane(puck.trail[i - 1].x, puck.trail[i - 1].y), b = game.toPlane(puck.trail[i].x, puck.trail[i].y);
        const alpha = Math.max(0, 1 - (now - puck.trail[i].t) / 700) * 0.45;
        if (alpha <= 0) continue;
        const [ax, ay] = P(a.x, a.y), [bx, by] = P(b.x, b.y);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.strokeStyle = rgba(C.ink, alpha); ctx.stroke();
      }
    }
    if (me) {
      const [cx, cy] = P(me.x, me.y), r = PUCK_R * S * 0.8;
      const predicted = puck.state === 'predicted';
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = predicted ? rgba(C.ink, 0.45) : C.ink; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.5, 0, Math.PI * 2); ctx.lineWidth = hair; ctx.strokeStyle = predicted ? rgba(C.ink, 0.4) : C.ink; ctx.stroke();
    }
    // 안내
    if (!game.running) {
      const msg = pts.length ? `${pts[0].n}번에 퍽을 2초 두거나 시작을 누르세요` : '위의 번호를 끌어다 놓아 코스를 만드세요';
      text(ctx, msg, f.x + f.w / 2, f.y + f.h * 0.55, fs, { weight: 600, color: C.inkSoft, halo: true });
    }
    for (const e of game.effects) {
      if (e.type !== 'pop') continue;
      const [cx, cy] = P(Math.min(0.86, Math.max(0.14, e.x)), Math.min(A, Math.max(0.08, e.y)));
      ctx.globalAlpha = Math.min(1, (1 - e.age) * 1.6);
      const script = e.style === 'script';
      text(ctx, e.text, cx, cy - e.age * W * 0.04, script ? W * 0.05 : W * 0.026, { family: script ? F.script : F.display, weight: script ? 700 : 800, color: e.color });
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /** 퍽 피하기 평면: 종이색 경기장 + 네 변 헤어라인. 빨간 정원 = 피할 퍽, 잉크 정원 = 나 */
  _drawDodge(ctx, W, H, game, puck, now) {
    const dpr = this.dpr, hair = Math.max(1, dpr), fs = Math.max(11 * dpr, W * 0.017);
    const f = dodgeField(W, H, this.topInset), S = f.w, A = game.plane.A;
    const P = (x, y) => [f.x + x * S, f.y + y * S];
    ctx.save();
    // 종이 워시: 경기장 안쪽은 영상이 은은하게, 바깥은 종이로 덮는다
    ctx.fillStyle = rgba(C.paper, this.wash); ctx.fillRect(f.x, f.y, f.w, f.h);
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, W, f.y); ctx.fillRect(0, f.y + f.h, W, H - f.y - f.h); ctx.fillRect(0, f.y, f.x, f.h); ctx.fillRect(f.x + f.w, f.y, W - f.x - f.w, f.h);
    ctx.lineWidth = hair; ctx.strokeStyle = C.ink; ctx.strokeRect(f.x, f.y, f.w, f.h);
    text(ctx, 'FIELD', f.x + W * 0.012, f.y + fs * 0.95, fs * 0.66, { weight: 600, color: C.mute, align: 'left', halo: false });
    const flip = game.plane.flip;
    text(ctx, flip ? '↑ 카메라쪽 · 밀기' : '↑ 몸쪽 · 당기기', f.x + f.w / 2, f.y + fs * 0.95, fs * 0.7, { weight: 500, color: C.mute, halo: false });
    text(ctx, flip ? '↓ 몸쪽 · 당기기' : '↓ 카메라쪽 · 밀기', f.x + f.w / 2, f.y + f.h - fs * 0.95, fs * 0.7, { weight: 500, color: C.mute, halo: false });

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

    // 나: 잉크 정원 + 한 겹 떨어진 헤어라인 고리, 궤적은 헤어라인
    const me = puck.pos ? game.toPlane(puck.pos.x, puck.pos.y) : null;
    if (puck.trail.length > 1) {
      ctx.lineWidth = hair;
      for (let i = 1; i < puck.trail.length; i++) {
        const a = game.toPlane(puck.trail[i - 1].x, puck.trail[i - 1].y), b = game.toPlane(puck.trail[i].x, puck.trail[i].y);
        const alpha = Math.max(0, 1 - (now - puck.trail[i].t) / 700) * 0.45;
        if (alpha <= 0) continue;
        const [ax, ay] = P(a.x, a.y), [bx, by] = P(b.x, b.y);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.strokeStyle = rgba(C.ink, alpha); ctx.stroke();
      }
    }
    if (me) {
      const [cx, cy] = P(me.x, me.y), r = PUCK_R * S;
      const predicted = puck.state === 'predicted';
      if (game.running && now < game.invulnUntil && Math.floor(now / 100) % 2 === 0) ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = predicted ? rgba(C.ink, 0.45) : C.ink; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.5, 0, Math.PI * 2); ctx.lineWidth = hair; ctx.strokeStyle = predicted ? rgba(C.ink, 0.4) : C.ink; ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      text(ctx, '퍽이 인식되면 여기에 표시됩니다', f.x + f.w / 2, f.y + f.h / 2, fs * 0.9, { weight: 500, color: C.mute, halo: false });
    }
    if (!game.running) {
      // 범례
      const y = f.y + f.h * 0.3, r = fs * 0.55;
      ctx.beginPath(); ctx.arc(f.x + f.w / 2 - fs * 5.2, y, r, 0, Math.PI * 2); ctx.fillStyle = C.red; ctx.fill();
      text(ctx, '사방에서 오는 빨간 퍽 — 피하기', f.x + f.w / 2 - fs * 5.2 + r * 1.8, y, fs * 0.9, { weight: 600, align: 'left', halo: false });
    }

    // 이펙트
    for (const e of game.effects) {
      if (e.type === 'pop') {
        const [cx, cy] = P(Math.min(0.86, Math.max(0.14, e.x)), Math.min(A, Math.max(0.06, e.y)));
        ctx.globalAlpha = Math.min(1, (1 - e.age) * 1.6);
        const script = e.style === 'script';
        text(ctx, e.text, cx, cy - e.age * W * 0.04, script ? W * 0.055 : W * 0.026, { family: script ? F.script : F.display, weight: script ? 700 : 800, color: e.color });
        ctx.globalAlpha = 1;
      } else if (e.type === 'flash') {
        ctx.fillStyle = rgba(C.red, 0.1 * (1 - e.age)); ctx.fillRect(f.x, f.y, f.w, f.h);
        ctx.lineWidth = hair * 3; ctx.strokeStyle = rgba(C.red, 1 - e.age); ctx.strokeRect(f.x, f.y, f.w, f.h);
      }
    }
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
    ctx.beginPath(); ctx.arc(cx, cy, Math.max(2.5, unit * 0.006), 0, Math.PI * 2); ctx.fillStyle = C.red; ctx.fill();
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

  /** 가운데 원 UI */
  _drawCalib(ctx, calib, toC, sx, unit, fs, hair, idleHold) {
    const c = calib.circle;
    const [cx, cy] = toC(c.x, c.y); const r = c.r * sx;
    const starting = calib.status === 'puck';
    const mismatch = calib.status === 'mismatch';
    const learning = calib.status === 'ok' || calib.status === 'refresh';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = rgba(C.paper, 0.28); ctx.fill();
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
      : calib.status === 'refresh' ? `등록된 퍽 다시 인식 중 ${Math.max(0, 3 - calib.hold).toFixed(1)}초`
      : calib.status === 'too_big' ? '물체가 너무 큽니다 — 카메라에서 더 멀리'
      : calib.status === 'ok' ? `퍽 등록 중 ${Math.max(0, 3 - calib.hold).toFixed(1)}초 — 가만히`
      : calib.sample?.scattered ? '바닥 무늬만 보입니다 — 물체를 원 안에'
      : (calib.target === 'stick' ? '스틱 블레이드(테이프)를 원 안에 놓으세요' : calib.registered ? '등록된 퍽을 원 안에 놓으세요' : '퍽으로 쓸 물체를 원 안에 놓으세요');
    pill(ctx, label, cx, cy - r - fs * 1.6, fs, mismatch ? { bg: C.red, fg: C.paper, border: null } : starting ? { bg: C.ink, fg: C.paper, border: null } : {});
    const sub = calib.manual ? '배경과 색이 다르면 무엇이든 됩니다 · 화면을 터치하면 취소'
      : starting ? '움직이면 취소됩니다'
      : mismatch ? '등록된 퍽을 놓거나, 아래 버튼으로 교체하세요'
      : calib.registered ? '3초 두면 시작' : '공 · 뚜껑 · 퍽 — 배경과 색만 다르면 됩니다';
    pill(ctx, sub, cx, cy + r + fs * 1.5, fs * 0.74, { weight: 500, border: null, alpha: 0.85 });
  }
}

function clamp01(x) { return Math.min(1, Math.max(0, x)); }
