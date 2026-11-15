// 오버레이 캔버스 렌더링
import { PUCK_R, FLYER_R } from './game.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
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
  draw({ vision, puck, game, procSize, now, showCandidates, idleHold = 0, autoStart = false, calib = null }) {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const sx = W / procSize.PW, sy = H / procSize.PH;
    const toC = (px, py) => [px * sx, py * sy];
    const floor = vision?.floor;
    const mapping = floor?.mapping;
    const uvToC = (u, v) => { const [px, py] = mapping.toPx(u, v); return toC(px, py); };
    const unit = Math.min(W, H); // 크기 기준
    const fontPx = Math.round(unit * 0.035);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    // ---- 바닥 ----
    if (floor?.polygon?.length > 2 && floor.mode === 'auto') {
      ctx.beginPath();
      floor.polygon.forEach(([x, y], i) => { const [cx, cy] = toC(x, y); i ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy); });
      ctx.closePath();
      ctx.fillStyle = 'rgba(56,189,248,0.06)';
      ctx.fill();
    }
    if (floor?.quad) {
      ctx.beginPath();
      floor.quad.forEach(([x, y], i) => { const [cx, cy] = toC(x, y); i ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy); });
      ctx.closePath();
      const full = floor.mode === 'full' || floor.fallback;
      ctx.lineWidth = unit * (full ? 0.003 : 0.005);
      ctx.setLineDash(floor.locked || floor.mode !== 'auto' || full ? [] : [unit * 0.02, unit * 0.012]);
      ctx.strokeStyle = full ? 'rgba(56,189,248,0.35)' : floor.detected ? 'rgba(56,189,248,0.9)' : 'rgba(245,158,11,0.9)';
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // 자동 물체 지정 (가운데 원에 3초)
    if (calib?.active) {
      const c = vision && calib.circle;
      if (c) {
        const [cx, cy] = toC(c.x, c.y); const r = c.r * sx;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(2,6,23,0.25)'; ctx.fill();
        ctx.setLineDash([unit * 0.015, unit * 0.01]); ctx.lineWidth = unit * 0.006; ctx.strokeStyle = calib.status === 'ok' ? '#22c55e' : '#f59e0b'; ctx.stroke(); ctx.setLineDash([]);
        if (calib.hold > 0) {
          ctx.beginPath(); ctx.arc(cx, cy, r * 1.15, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, calib.hold / 3));
          ctx.lineWidth = unit * 0.012; ctx.strokeStyle = '#22c55e'; ctx.stroke();
        }
        if (calib.sample?.status === 'ok') {
          const [ox, oy] = toC(calib.sample.cx, calib.sample.cy);
          ctx.beginPath(); ctx.arc(ox, oy, unit * 0.012, 0, Math.PI * 2); ctx.fillStyle = `rgb(${calib.sample.r},${calib.sample.g},${calib.sample.b})`; ctx.fill();
          ctx.lineWidth = unit * 0.003; ctx.strokeStyle = '#fff'; ctx.stroke();
        }
        const label = calib.status === 'too_big' ? '물체가 너무 큽니다. 카메라에서 더 멀리' : calib.status === 'ok' ? `인식 중… ${Math.max(0, 3 - calib.hold).toFixed(1)}초 가만히` : (calib.target === 'stick' ? '스틱 블레이드(테이프)를 원 안에 놓으세요' : '퍽으로 쓸 물체(공·뚜껑 등)를 원 안에 놓으세요');
        ctx.font = `700 ${fontPx}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.lineWidth = unit * 0.008; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.strokeText(label, cx, cy - r * 1.3);
        ctx.fillStyle = '#fff'; ctx.fillText(label, cx, cy - r * 1.3);
        ctx.font = `${Math.round(fontPx * 0.8)}px system-ui, sans-serif`; ctx.textBaseline = 'top';
        const sub = '배경과 색이 다르면 무엇이든 됩니다 · 화면을 터치하면 취소';
        ctx.strokeText(sub, cx, cy + r * 1.3); ctx.fillStyle = '#e5e7eb'; ctx.fillText(sub, cx, cy + r * 1.3);
      }
      return;
    }

    if (!mapping) return;

    // 아케이드: 화면 공간 렌더 (바닥 사각형 위 오브젝트 대신)
    if (game.mode.id === 'arcade') {
      // 실제 퍽 위치를 작은 점으로 표시해 매핑 관계를 보여줌
      if (vision.puck) { const [cx, cy] = toC(vision.puck.x, vision.puck.y); ctx.beginPath(); ctx.arc(cx, cy, unit * 0.006, 0, Math.PI * 2); ctx.fillStyle = 'rgba(56,189,248,0.8)'; ctx.fill(); }
      game.arcade.draw(ctx, W, H, now, puck);
      return;
    }

    const floorPxW = Math.hypot(...sub(uvToC(1, 0.5), uvToC(0, 0.5))); // 캔버스 상 바닥 폭
    const R = (r) => r * floorPxW; // 정규화 반지름 -> 캔버스 px (가로 기준)

    // 핸즈프리 시작 원 (대기 중)
    if (!game.running && autoStart) {
      const [cx, cy] = uvToC(0.5, 0.5);
      const r = R(0.1);
      ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(34,197,94,0.12)'; ctx.fill();
      ctx.lineWidth = unit * 0.005; ctx.strokeStyle = 'rgba(34,197,94,0.9)'; ctx.stroke();
      if (idleHold > 0) {
        ctx.beginPath(); ctx.ellipse(cx, cy, r * 1.2, r * 0.72, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, idleHold / 3));
        ctx.lineWidth = unit * 0.01; ctx.strokeStyle = '#22c55e'; ctx.stroke();
      }
      ctx.font = `600 ${fontPx}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.lineWidth = unit * 0.006; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      const label = idleHold > 0 ? String(Math.ceil(3 - idleHold)) : '퍽을 원 안에 3초 두면 시작';
      ctx.strokeText(label, cx, cy - r * 0.8); ctx.fillStyle = '#fff'; ctx.fillText(label, cx, cy - r * 0.8);
    }

    // ---- 구역 ----
    for (const z of game.zones) {
      const corners = [[z.x - z.w / 2, z.y - z.h / 2], [z.x + z.w / 2, z.y - z.h / 2], [z.x + z.w / 2, z.y + z.h / 2], [z.x - z.w / 2, z.y + z.h / 2]];
      ctx.beginPath();
      corners.forEach(([u, v], i) => { const [cx, cy] = uvToC(clamp01(u), clamp01(v)); i ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy); });
      ctx.closePath();
      const pulse = 0.5 + 0.5 * Math.sin(now / 250);
      if (z.warn) { ctx.fillStyle = 'rgba(239,68,68,0.18)'; ctx.strokeStyle = 'rgba(239,68,68,0.9)'; }
      else if (z.active) { ctx.fillStyle = `rgba(34,197,94,${0.12 + 0.1 * pulse})`; ctx.strokeStyle = 'rgba(34,197,94,0.95)'; }
      else { ctx.fillStyle = 'rgba(148,163,184,0.06)'; ctx.strokeStyle = 'rgba(148,163,184,0.5)'; }
      ctx.fill(); ctx.lineWidth = unit * 0.005; ctx.stroke();
    }

    // ---- 8자 게이트 ----
    game.waypoints.forEach((wp, i) => {
      const [cx, cy] = uvToC(wp.x, wp.y);
      const isNext = i === game.wpIndex;
      const r = R(0.09) * (isNext ? 1 + 0.08 * Math.sin(now / 180) : 0.8);
      ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = isNext ? 'rgba(34,197,94,0.25)' : 'rgba(148,163,184,0.08)';
      ctx.fill();
      ctx.lineWidth = unit * 0.004;
      ctx.strokeStyle = isNext ? '#22c55e' : 'rgba(148,163,184,0.5)';
      ctx.stroke();
      ctx.fillStyle = isNext ? '#fff' : 'rgba(226,232,240,0.6)';
      ctx.font = `700 ${fontPx}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), cx, cy);
    });

    // ---- 타겟 ----
    for (const t of game.targets) {
      const [cx, cy] = uvToC(t.x, t.y);
      const age = (now - t.born) / 1000;
      const r = R(t.r) * (1 + 0.06 * Math.sin(age * 6));
      ctx.lineWidth = unit * 0.006;
      for (let k = 0; k < 3; k++) {
        const rr = r * (1 - k * 0.3);
        ctx.beginPath(); ctx.ellipse(cx, cy, rr, rr * 0.6, 0, 0, Math.PI * 2);
        ctx.strokeStyle = k === 1 ? 'rgba(255,255,255,0.9)' : 'rgba(34,197,94,0.95)';
        ctx.stroke();
      }
      ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(34,197,94,0.12)'; ctx.fill();
    }

    // ---- 콘 ----
    for (const c of game.cones) {
      const [cx, cy] = uvToC(c.x, c.y);
      const r = R(c.r);
      const hit = now < c.hitUntil;
      const h = r * 2.2;
      // 그림자/베이스
      ctx.beginPath(); ctx.ellipse(cx, cy, r * 1.15, r * 0.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill();
      // 본체
      const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
      grad.addColorStop(0, hit ? '#fca5a5' : '#fb923c');
      grad.addColorStop(0.5, hit ? '#ef4444' : '#f97316');
      grad.addColorStop(1, hit ? '#b91c1c' : '#c2410c');
      ctx.beginPath();
      ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.lineTo(cx + r * 0.12, cy - h); ctx.lineTo(cx - r * 0.12, cy - h);
      ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.45, 0, 0, Math.PI); ctx.fillStyle = hit ? '#b91c1c' : '#c2410c'; ctx.fill();
      // 띠
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(cx - r * 0.55, cy - h * 0.55, r * 1.1, h * 0.12);
      // 충돌 반경(은은하게)
      ctx.beginPath(); ctx.ellipse(cx, cy, R(c.r + PUCK_R), R(c.r + PUCK_R) * 0.6, 0, 0, Math.PI * 2);
      ctx.strokeStyle = hit ? 'rgba(239,68,68,0.8)' : 'rgba(251,146,60,0.25)'; ctx.lineWidth = unit * 0.003; ctx.stroke();
    }

    // ---- 날아오는 빨간 퍽 (퍽 피하기 서바이벌) ----
    for (const f of game.flyers || []) {
      if (now < f.launchAt) {
        // 출발 지점 경고: 바닥 가장자리에 깜빡이는 삼각형
        const ex = Math.min(0.99, Math.max(0.01, f.x)), ey = Math.min(0.99, Math.max(0.01, f.y));
        const [cx, cy] = uvToC(ex, ey);
        const ang = Math.atan2(f.vy, f.vx);
        const blink = 0.5 + 0.5 * Math.sin(now / 60);
        const sz = unit * 0.03;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
        ctx.beginPath(); ctx.moveTo(sz, 0); ctx.lineTo(-sz * 0.7, -sz * 0.7); ctx.lineTo(-sz * 0.7, sz * 0.7); ctx.closePath();
        ctx.fillStyle = `rgba(239,68,68,${0.35 + 0.6 * blink})`; ctx.fill();
        ctx.lineWidth = unit * 0.003; ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.restore();
        continue;
      }
      const [cx, cy] = uvToC(f.x, f.y);
      if (cx < -W * 0.2 || cx > W * 1.2 || cy < -H * 0.2 || cy > H * 1.2) continue;
      const r = R(FLYER_R);
      // 속도 방향 잔상
      const [tx, ty] = uvToC(f.x - f.vx * 0.12, f.y - f.vy * 0.12);
      const g = ctx.createLinearGradient(tx, ty, cx, cy);
      g.addColorStop(0, 'rgba(239,68,68,0)'); g.addColorStop(1, 'rgba(239,68,68,0.55)');
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(cx, cy);
      ctx.strokeStyle = g; ctx.lineWidth = r * 1.2; ctx.stroke();
      // 본체
      ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.18, r, r * 0.7, 0, 0, Math.PI * 2); ctx.fillStyle = '#7f1d1d'; ctx.fill();
      const rg = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.1, cx, cy, r);
      rg.addColorStop(0, '#fca5a5'); rg.addColorStop(0.5, '#ef4444'); rg.addColorStop(1, '#991b1b');
      ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.7, 0, 0, Math.PI * 2); ctx.fillStyle = rg; ctx.fill();
      ctx.lineWidth = unit * 0.003; ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.stroke();
      if (f.hit) { ctx.beginPath(); ctx.ellipse(cx, cy, r * 1.5, r * 1.05, 0, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(239,68,68,0.6)'; ctx.stroke(); }
    }

    // ---- 스틱 ----
    const stick = vision.stick;
    if (stick) {
      const [cx, cy] = toC(stick.x, stick.y);
      const s = unit * 0.022;
      ctx.beginPath();
      ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s, cy); ctx.lineTo(cx, cy + s); ctx.lineTo(cx - s, cy); ctx.closePath();
      ctx.fillStyle = 'rgba(245,158,11,0.35)'; ctx.fill();
      ctx.lineWidth = unit * 0.004; ctx.strokeStyle = '#f59e0b'; ctx.stroke();
      const [bx0, by0] = toC(stick.bbox[0], stick.bbox[1]);
      const [bx1, by1] = toC(stick.bbox[2] + 1, stick.bbox[3] + 1);
      ctx.setLineDash([unit * 0.01, unit * 0.008]);
      ctx.strokeStyle = 'rgba(245,158,11,0.5)'; ctx.lineWidth = unit * 0.002;
      ctx.strokeRect(bx0, by0, bx1 - bx0, by1 - by0);
      ctx.setLineDash([]);
    }

    // ---- 퍽 궤적 ----
    if (puck.trail.length > 1) {
      for (let i = 1; i < puck.trail.length; i++) {
        const a = puck.trail[i - 1], b = puck.trail[i];
        const alpha = Math.max(0, 1 - (now - b.t) / 900) * 0.7;
        if (alpha <= 0) continue;
        const [ax, ay] = uvToC(a.x, a.y), [bx, by] = uvToC(b.x, b.y);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
        ctx.strokeStyle = `rgba(56,189,248,${alpha})`; ctx.lineWidth = unit * 0.006 * (i / puck.trail.length) + 1;
        ctx.stroke();
      }
    }

    // ---- 퍽 ----
    if (puck.pos) {
      const [cx, cy] = uvToC(puck.pos.x, puck.pos.y);
      const r = Math.max(unit * 0.012, R(PUCK_R));
      const predicted = puck.state === 'predicted';
      ctx.beginPath(); ctx.ellipse(cx, cy, r * 1.9, r * 1.9 * 0.7, 0, 0, Math.PI * 2);
      ctx.fillStyle = predicted ? 'rgba(245,158,11,0.18)' : 'rgba(56,189,248,0.22)'; ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.7, 0, 0, Math.PI * 2);
      ctx.lineWidth = unit * 0.005; ctx.strokeStyle = predicted ? '#f59e0b' : '#38bdf8'; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, unit * 0.004, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    }

    // ---- 디버그: 퍽 후보 ----
    if (showCandidates && vision.puckCandidates) {
      ctx.font = `${Math.round(fontPx * 0.6)}px system-ui`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      for (const c of vision.puckCandidates) {
        const [x0, y0] = toC(c.minx, c.miny), [x1, y1] = toC(c.maxx + 1, c.maxy + 1);
        ctx.strokeStyle = 'rgba(239,68,68,0.8)'; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        ctx.fillStyle = '#fca5a5'; ctx.fillText(`${c.area} ${c.score.toFixed(2)}`, x0, y0 - 2);
      }
    }

    // ---- 이펙트 ----
    for (const e of game.effects) {
      if (e.type === 'pop') {
        const [cx, cy] = uvToC(clamp01(e.x), clamp01(e.y));
        const a = 1 - e.age;
        ctx.globalAlpha = a;
        ctx.font = `800 ${Math.round(fontPx * 1.3)}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = unit * 0.008; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.strokeText(e.text, cx, cy - e.age * unit * 0.08);
        ctx.fillStyle = e.color; ctx.fillText(e.text, cx, cy - e.age * unit * 0.08);
        ctx.globalAlpha = 1;
      } else if (e.type === 'flash') {
        ctx.fillStyle = `rgba(239,68,68,${0.35 * (1 - e.age)})`;
        ctx.fillRect(0, 0, W, H);
      }
    }
  }
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
function clamp01(x) { return Math.min(1, Math.max(0, x)); }
