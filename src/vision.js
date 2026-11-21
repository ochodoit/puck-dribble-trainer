// 영상 처리: 흰 바닥 영역, 퍽, 스틱 인식 (의존성 없는 순수 JS)
import { makeFloorMapping, quadBounds, quadScanlines } from './geometry.js';

const FLOOR_EMA = 0.15;        // 자동 바닥 영역 스무딩 계수
const FLOOR_ON_FRAMES = 10;    // 흰 바닥으로 전환하기 위한 연속 검출 프레임
const FLOOR_OFF_FRAMES = 90;   // 전체 화면으로 되돌리기 위한 연속 미검출 프레임 (~3초)
const ROW_RATIO = 0.10;        // 바닥으로 인정할 행/열의 흰색 비율
const MIN_FLOOR_SPAN = 0.25;   // 바닥 최소 크기(프레임 대비)
const PUCK_DIAMETER_M = 0.076; // 하키 퍽 지름 (등록 전 퍽 크기 추정)
const CIRCLE_PUCK_RATIO = 2;   // 가운데 원 지름 = 퍽 지름 × 2
const SPLIT_MAX_FRAMES = 45;   // 같은 색 물체에 붙은 퍽을 떼어 내는 것만으로 이어 가는 최대 프레임 (~1.5초)
// 이보다 가늘고 긴 조각(짧은 축/긴 축)은 '애매한 조각': 퍽과 같은 색 스틱 샤프트 토막일 수 있다.
// 퍽은 비스듬히 봐도 옆면(두께)이 보여 0.5 아래로 잘 안 내려가고, 샤프트 토막은 보통 0.4 아래
const THIN_ELONG = 0.4;

export class Vision {
  constructor(procWidth = 240) {
    this.PW = procWidth;
    this.PH = Math.round(procWidth * 3 / 4);
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.mirror = true;
    this.frame = null;          // 마지막 ImageData (보정용 샘플링)
    this.floorAuto = null;      // EMA 적용된 자동 바닥 사다리꼴 {y0,y1,tl,tr,bl,br} (뒤쪽은 좁고 앞쪽은 넓은 원근)
    this.areaCenter = null;     // 게임 영역(바닥) 가운데 (처리 px). 퍽 등록·시작 원 자리
    this.floorLocked = false;
    this.floorPolygon = [];     // 자동 감지 윤곽 (표시용)
    this.floorOnCount = 0; this.floorOffCount = 0;
    this.floorFallback = false; // 흰 바닥이 없어 카메라 화면 전체를 쓰는 중
    this.lastPuck = null;       // {x,y,area,vx,vy,missed} 추적 게이트 (proc px)
    this.splitRun = 0;          // 같은 색 큰 덩어리에서 퍽을 떼어 내 이어 온 연속 프레임 수
    this.lastStick = null;
    this.debugImage = null;
    this._alloc();
  }

  _alloc() {
    const n = this.PW * this.PH;
    this.canvas.width = this.PW;
    this.canvas.height = this.PH;
    this.whiteMask = new Uint8Array(n);
    this.puckMask = new Uint8Array(n);
    this.stickMask = new Uint8Array(n);
    this.stack = new Int32Array(n);
    this.colCount = new Uint16Array(this.PW);
    this.rowCount = new Uint16Array(this.PH);
  }

  setSourceSize(vw, vh) {
    if (!vw || !vh) return;
    this.srcW = vw; this.srcH = vh;
    const ph = Math.max(60, Math.round(this.PW * vh / vw));
    if (ph !== this.PH) {
      this.PH = ph;
      this._alloc();
      this.floorAuto = null;
    }
  }

  /** 인식 해상도 변경 (노트북 웹캠처럼 퍽이 작게 보일 때 320/400으로 올림) */
  setProcWidth(pw) {
    if (pw === this.PW) return;
    const oldW = this.PW, oldH = this.PH;
    this.PW = pw;
    this.PH = this.srcW ? Math.max(60, Math.round(pw * this.srcH / this.srcW)) : Math.round(pw * 3 / 4);
    this._alloc();
    // 기억해 둔 바닥·퍽·스틱 자리는 새 해상도로 환산 (지우면 자동 바닥이 다시 잡힐 때까지 영역이 잠깐 전체 화면으로 바뀐다)
    const kx = pw / oldW, ky = this.PH / oldH;
    const f = this.floorAuto;
    if (f) { for (const k of ['x0', 'x1', 'tl', 'tr', 'bl', 'br']) f[k] *= kx; for (const k of ['y0', 'y1']) f[k] *= ky; }
    const p = this.lastPuck;
    if (p) { p.x *= kx; p.y *= ky; p.vx *= kx; p.vy *= ky; p.area *= kx * ky; }
    if (this.lastStick) { this.lastStick.x *= kx; this.lastStick.y *= ky; }
    this.frame = null; this.scan = null; // 옛 해상도 영상은 다음 프레임에 새로
  }

  /** 화면(정규화 0-1) 좌표 -> 처리 픽셀 좌표 */
  toProc(nx, ny) { return [nx * this.PW, ny * this.PH]; }

  /** 매 프레임 호출. settings: {whiteV, whiteC, puckTol, stickTol, puckModel, stickModel, floorMode, manualQuad, debug} */
  process(video, settings) {
    const { PW, PH, ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.mirror) ctx.setTransform(-1, 0, 0, 1, PW, 0);
    ctx.drawImage(video, 0, 0, PW, PH);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const frame = ctx.getImageData(0, 0, PW, PH);
    this.frame = frame;
    const d = frame.data;

    // ---- 1) 흰 바닥 마스크 + 행/열 히스토그램 ----
    const white = this.whiteMask;
    const colCount = this.colCount; colCount.fill(0);
    const rowCount = this.rowCount; rowCount.fill(0);
    const wv = settings.whiteV, wc = settings.whiteC;
    for (let y = 0, i = 0, p = 0; y < PH; y++) {
      let rc = 0;
      for (let x = 0; x < PW; x++, i++, p += 4) {
        const r = d[p], g = d[p + 1], b = d[p + 2];
        const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
        const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
        if (mx >= wv && (mx - mn) <= wc) { white[i] = 1; colCount[x]++; rc++; } else white[i] = 0;
      }
      rowCount[y] = rc;
    }

    // ---- 2) 바닥 영역 결정 ----
    let floorDetected = false;
    let quad = null;
    if (settings.floorMode === 'full') {
      // 카메라 화면 전체를 게임 영역으로 (흰 바닥 없이 노트북 웹캠 앞에서 플레이)
      const mx = PW * 0.02, my = PH * 0.02;
      quad = [[mx, my], [PW - mx, my], [PW - mx, PH - my], [mx, PH - my]];
      floorDetected = true;
      this.floorPolygon = [];
    } else if (settings.floorMode === 'manual' && settings.manualQuad) {
      quad = settings.manualQuad.map(([u, v]) => [u * PW, v * PH]);
      floorDetected = true;
      this.floorPolygon = [];
    } else {
      const bbox = this._autoFloorBBox();
      if (bbox) {
        floorDetected = true;
        this.floorOffCount = 0; this.floorOnCount++;
        if (!this.floorLocked) {
          if (!this.floorAuto) { if (this.floorOnCount >= FLOOR_ON_FRAMES) this.floorAuto = bbox; }
          else {
            const f = this.floorAuto, a = FLOOR_EMA;
            for (const k of ['y0', 'y1', 'tl', 'tr', 'bl', 'br']) f[k] += (bbox[k] - f[k]) * a;
          }
        }
      } else {
        this.floorOnCount = 0; this.floorOffCount++;
        // 흰 바닥이 3초 넘게 안 보이면(매트·일반 바닥) 전체 화면으로 복귀
        if (this.floorAuto && !this.floorLocked && this.floorOffCount >= FLOOR_OFF_FRAMES) { this.floorAuto = null; this.floorPolygon = []; }
      }
      if (this.floorAuto) {
        const f = this.floorAuto;
        quad = [[f.tl, f.y0], [f.tr, f.y0], [f.br, f.y1], [f.bl, f.y1]];
        this.floorPolygon = this._floorOutline({ x0: Math.min(f.tl, f.bl), x1: Math.max(f.tr, f.br), y0: f.y0, y1: f.y1 });
        this.floorFallback = false;
      } else {
        // 폴백: 흰 바닥 없이도 바로 플레이 (카메라 화면 전체)
        const mx = PW * 0.02, my = PH * 0.02;
        quad = [[mx, my], [PW - mx, my], [PW - mx, PH - my], [mx, PH - my]];
        this.floorPolygon = [];
        this.floorFallback = true;
      }
    }

    const mapping = quad ? makeFloorMapping(quad) : null;
    this.useArea(mapping, { area: settings.puckModel?.area || 0, widthM: settings.floorWidthM || 0 });
    this.scan = mapping ? quadScanlines(quad, PH) : null; // 게임 영역 행별 x 범위 (가운데 원의 배경색을 영역 안에서만 재는 데도 씀)
    const result = {
      floor: { quad, mapping, detected: floorDetected, locked: this.floorLocked, polygon: this.floorPolygon, mode: settings.floorMode, fallback: settings.floorMode === 'auto' && this.floorFallback },
      puck: null,
      stick: null,
      puckCandidates: [],
    };
    if (!mapping) {
      this.lastPuck = null;
      if (settings.debug) this._buildDebug(null);
      return result;
    }

    // ---- 3) 바닥 내부에서 퍽/스틱 색 마스크 ----
    const bounds = quadBounds(quad);
    const scan = this.scan;
    const pm = settings.puckModel, sm = settings.stickModel;
    const pMatch = makeMatcher(pm, settings.puckTol);
    const sMatch = sm ? makeMatcher(sm, settings.stickTol) : null;
    const puckMask = this.puckMask, stickMask = this.stickMask;
    puckMask.fill(0);
    if (sm) stickMask.fill(0);
    const y0 = Math.max(0, Math.floor(bounds.y0)), y1 = Math.min(PH - 1, Math.ceil(bounds.y1));
    for (let y = y0; y <= y1; y++) {
      const xa = scan[y * 2], xb = scan[y * 2 + 1];
      if (xa < 0) continue;
      const xEnd = Math.min(PW - 1, xb);
      for (let x = xa, i = y * PW + xa, p = i * 4; x <= xEnd; x++, i++, p += 4) {
        const r = d[p], g = d[p + 1], b = d[p + 2];
        if (matchPixel(pMatch, r, g, b)) puckMask[i] = 1;
        if (sMatch && matchPixel(sMatch, r, g, b)) stickMask[i] = 1;
      }
    }

    const floorW = Math.max(10, bounds.x1 - bounds.x0);

    // ---- 4) 스틱 블롭 선택 (퍽보다 먼저: 타격 시 탐색 범위 확대에 사용) ----
    if (sm) {
      const expS = sm.area > 0 ? sm.area : Math.max(20, 0.785 * Math.pow(floorW * 0.05, 2));
      const minS = Math.max(5, expS * 0.2);
      const scomps = mergeClose(this._components(stickMask, bounds, Math.max(3, Math.floor(minS * 0.5))), 2);
      let sbest = null, sbestScore = 0;
      for (const c of scomps) {
        if (c.area < minS) continue;
        const cx = c.sx / c.area, cy = c.sy / c.area;
        let prox = 1;
        if (this.lastStick) {
          const dx = cx - this.lastStick.x, dy = cy - this.lastStick.y;
          prox = Math.exp(-Math.sqrt(dx * dx + dy * dy) / (0.2 * PW));
        }
        const s = c.area * (0.4 + 0.6 * prox);
        if (s > sbestScore) { sbestScore = s; sbest = c; c.cx = cx; c.cy = cy; }
      }
      if (sbest) {
        result.stick = {
          x: sbest.cx, y: sbest.cy, area: sbest.area,
          bottomX: sbest.bxsum / sbest.bxn, bottomY: sbest.maxy,
          bbox: [sbest.minx, sbest.miny, sbest.maxx, sbest.maxy],
        };
        this.lastStick = { x: sbest.cx, y: sbest.cy };
      } else {
        this.lastStick = null;
      }
    }

    // ---- 5) 퍽 블롭 선택 ----
    const calibrated = pm.area > 0;
    const expArea = calibrated ? pm.area : Math.max(6, 0.785 * Math.pow(floorW * 0.03, 2));
    // 보정된 경우 크기 범위를 좁혀 신발·바지 등 큰 어두운 물체를 배제
    const minA = Math.max(3, expArea * 0.25);
    // 스틱·발에 반쯤 가린 퍽: 마지막으로 본 자리 바로 근처에서는 작은 조각(원래 크기의 10%~)도 퍽으로 받는다
    const minNear = Math.max(2, expArea * 0.1);
    let maxA = expArea * (calibrated ? 3 : 4.5);
    const areaScale = calibrated ? 1.5 : 2.2;
    const last = this.lastPuck;
    // 빠르게 움직이면 모션 블러로 덩어리가 길어지므로 면적 상한을 넓힘 (추적 끊김 -> 마커 튐 방지)
    if (last) { const sp = Math.hypot(last.vx, last.vy) / PW; maxA *= 1 + Math.min(1.5, sp / 0.02); }
    const comps = mergeClose(this._components(puckMask, bounds, Math.max(2, Math.floor((last ? minNear : minA) * 0.6))), 2);

    // 추적 게이트: 예측 위치 + 탐색 반경. 스틱이 퍽 근처면(타격 직후) 반경 확대
    let predX = 0, predY = 0, sigma = 0.12 * PW, reacquiring = false;
    if (last) {
      reacquiring = last.missed > 0;
      const k = Math.min(last.missed, 6);
      predX = last.x + last.vx * (1 + k) * 0.8;
      predY = last.y + last.vy * (1 + k) * 0.8;
      const speed = Math.hypot(last.vx, last.vy);
      const stickNear = result.stick && Math.hypot(result.stick.x - last.x, result.stick.y - last.y) < 0.18 * PW;
      if (stickNear || speed > 0.025 * PW) sigma *= 2.4;
      sigma *= 1 + 0.25 * k;
    }

    const nearR = Math.max(4, 0.05 * PW);
    // 같은 색 큰 물체(검정 스케이트·신발·검정 테이프)에 퍽이 닿으면 한 덩어리가 되어 '너무 큼'으로 걸러진다 -> 예측 자리에 걸친 큰 덩어리를 기억
    const padP = last ? 2 * Math.sqrt(last.area / Math.PI) : 0;
    let bigNear = false;
    let best = null, bestScore = 0;
    for (const c of comps) {
      const cx = c.sx / c.area, cy = c.sy / c.area;
      const near = !!last && Math.hypot(cx - predX, cy - predY) < nearR;
      if (c.area > maxA && last && predX >= c.minx - padP && predX <= c.maxx + padP && predY >= c.miny - padP && predY <= c.maxy + padP) bigNear = true;
      if (c.area < (near ? minNear : minA) || c.area > maxA) continue;
      // 놓친 뒤 재획득: 마지막으로 본 퍽과 크기가 비슷한 것만 허용 (바로 그 자리면 가려져 작아진 조각도)
      if (last && reacquiring) {
        const ratio = c.area / last.area;
        if (ratio < (near ? 0.15 : 0.4) || ratio > 2.5) continue;
      }
      const bw = c.maxx - c.minx + 1, bh = c.maxy - c.miny + 1;
      const fill = Math.min(1, c.area / (bw * bh));
      const aspect = Math.min(bw, bh) / Math.max(bw, bh);
      let prox = 1;
      if (last) {
        const dx = cx - predX, dy = cy - predY;
        prox = Math.exp(-Math.sqrt(dx * dx + dy * dy) / sigma);
      }
      const areaFit = 1 - Math.min(1, Math.abs(Math.log(c.area / expArea)) / areaScale);
      const score = fill * (0.5 + 0.5 * aspect) * (0.35 + 0.65 * prox) * (0.3 + 0.7 * areaFit);
      c.cx = cx; c.cy = cy; c.score = score;
      result.puckCandidates.push(c);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    // 히스테리시스: 추적 중이면 예측 위치 근처의 후보를 멀리 있는 고득점 후보보다 우선 (한 프레임 점프 방지)
    if (best && last && !reacquiring) {
      const dBest = Math.hypot(best.cx - predX, best.cy - predY);
      if (dBest > sigma) {
        let near = null, nearScore = 0;
        for (const c of result.puckCandidates) {
          const dd = Math.hypot(c.cx - predX, c.cy - predY);
          if (dd <= sigma * 0.8 && c.score > nearScore) { near = c; nearScore = c.score; }
        }
        if (near && nearScore >= bestScore * 0.45) { best = near; bestScore = nearScore; }
      }
    }
    // 퍽이 같은 색 큰 덩어리에 붙어 사라졌으면(못 찾았거나, 찾은 게 예측 자리에서 먼 다른 물체면) 그 덩어리 안에서 퍽 모양 부분만 떼어 낸다.
    // 붙은 채로 너무 오래(1.5초) 이것만으로 이어지면 그만둔다 (퍽을 집어 갔는데 스케이트 앞코를 퍽으로 계속 잡는 일 방지)
    let split = false;
    if (bigNear && calibrated && this.splitRun < SPLIT_MAX_FRAMES && (!best || bestScore < 0.18 || Math.hypot(best.cx - predX, best.cy - predY) > sigma * 0.8)) {
      const sp = this._splitFromBlob(predX, predY, last.area);
      if (sp) { best = sp; bestScore = Math.max(0.18, sp.score); split = true; result.puckCandidates.push(sp); }
    }
    this.splitRun = split ? this.splitRun + 1 : best && bestScore >= 0.18 ? 0 : this.splitRun;
    if (best && bestScore >= 0.18) {
      // 애매한 조각(doubtful): 떼어 낸 부분, 가려져 작아진 조각, 가늘고 긴 조각. 스틱 테이프를 지정했으면 StickBridge 가
      // 블레이드 + 간격 자리에서 먼 애매한 조각은 퍽으로 보지 않는다 (퍽과 같은 색 샤프트를 퍽으로 따라가는 일 방지).
      // 빠르게 움직여 번진 퍽은 길쭉한 방향이 움직이는 방향과 같으므로 가늘어도 애매하다고 하지 않는다
      const shape = split ? null : blobShape(best);
      let thin = false;
      if (shape && shape.elong < THIN_ELONG) {
        const blur = !!last && Math.hypot(last.vx, last.vy) > 0.02 * PW && Math.abs(Math.cos(shape.angle - Math.atan2(last.vy, last.vx))) > 0.9;
        thin = !blur;
      }
      result.puck = { x: best.cx, y: best.cy, area: best.area, w: best.maxx - best.minx + 1, h: best.maxy - best.miny + 1, score: bestScore, split,
        elong: shape ? shape.elong : 1, doubtful: split || best.area < minA || thin };
      // 가려져 작아진 조각·떼어 낸 부분은 퍽 크기 기억을 바꾸지 않는다 (다시 다 보일 때 '크기가 다르다'고 거부하지 않게)
      const partial = best.area < minA || split;
      if (last && last.missed === 0) {
        const vx = best.cx - last.x, vy = best.cy - last.y;
        this.lastPuck = { x: best.cx, y: best.cy, area: partial ? last.area : last.area + (best.area - last.area) * 0.3, vx: last.vx + (vx - last.vx) * 0.6, vy: last.vy + (vy - last.vy) * 0.6, missed: 0 };
      } else {
        this.lastPuck = { x: best.cx, y: best.cy, area: partial && last ? last.area : best.area, vx: 0, vy: 0, missed: 0 };
      }
    } else if (last) {
      last.missed++;
      last.vx *= 0.8; last.vy *= 0.8;
      if (last.missed > 15) this.lastPuck = null;
    }

    if (settings.debug) this._buildDebug(sm);
    else this.debugImage = null;
    return result;
  }

  /** 흰 바닥 영역을 원근 사다리꼴로 추정: 위쪽 띠와 아래쪽 띠의 좌/우 끝(중앙값) */
  _autoFloorBBox() {
    const { PW, PH, rowCount, colCount, whiteMask } = this;
    const rowMin = PW * ROW_RATIO, colMin = PH * ROW_RATIO;
    let y0 = -1, y1 = -1, x0 = -1, x1 = -1;
    for (let y = 0; y < PH; y++) if (rowCount[y] >= rowMin) { y0 = y; break; }
    for (let y = PH - 1; y >= 0; y--) if (rowCount[y] >= rowMin) { y1 = y; break; }
    for (let x = 0; x < PW; x++) if (colCount[x] >= colMin) { x0 = x; break; }
    for (let x = PW - 1; x >= 0; x--) if (colCount[x] >= colMin) { x1 = x; break; }
    if (y0 < 0 || x0 < 0) return null;
    if ((y1 - y0) < PH * MIN_FLOOR_SPAN || (x1 - x0) < PW * MIN_FLOOR_SPAN) return null;
    const extents = (ya, yb) => {
      const lefts = [], rights = [];
      for (let y = ya; y <= yb; y++) {
        if (rowCount[y] < rowMin) continue;
        const row = y * PW; let lx = -1, rx = -1, run = 0;
        for (let x = x0; x <= x1; x++) { if (whiteMask[row + x]) { if (++run >= 3) { lx = x - 2; break; } } else run = 0; }
        run = 0;
        for (let x = x1; x >= x0; x--) { if (whiteMask[row + x]) { if (++run >= 3) { rx = x + 2; break; } } else run = 0; }
        if (lx >= 0 && rx > lx) { lefts.push(lx); rights.push(rx); }
      }
      if (lefts.length < 2) return null;
      lefts.sort((a, b) => a - b); rights.sort((a, b) => a - b);
      return [lefts[Math.floor(lefts.length / 2)], rights[Math.floor(rights.length / 2)] + 1];
    };
    const band = Math.max(3, Math.round((y1 - y0) * 0.12));
    const top = extents(y0, y0 + band), bot = extents(y1 - band, y1);
    let tl = x0, tr = x1 + 1, bl = x0, br = x1 + 1;
    if (top && top[1] - top[0] >= PW * 0.2) { tl = top[0]; tr = top[1]; }
    if (bot && bot[1] - bot[0] >= PW * 0.2) { bl = bot[0]; br = bot[1]; }
    return { x0, y0, x1: x1 + 1, y1: y1 + 1, tl, tr, bl, br };
  }

  /** 자동 감지 바닥의 좌/우 윤곽선 (행마다 첫/마지막 흰색 런) */
  _floorOutline(f) {
    const { PW, whiteMask } = this;
    const left = [], right = [];
    const ys = Math.max(0, Math.floor(f.y0)), ye = Math.min(this.PH - 1, Math.ceil(f.y1) - 1);
    const xs = Math.max(0, Math.floor(f.x0)), xe = Math.min(PW - 1, Math.ceil(f.x1) - 1);
    const step = Math.max(2, Math.floor((ye - ys) / 24));
    for (let y = ys; y <= ye; y += step) {
      const row = y * PW;
      let lx = -1, run = 0;
      for (let x = xs; x <= xe; x++) {
        if (whiteMask[row + x]) { if (++run >= 3) { lx = x - 2; break; } } else run = 0;
      }
      if (lx < 0) continue;
      let rx = -1; run = 0;
      for (let x = xe; x >= xs; x--) {
        if (whiteMask[row + x]) { if (++run >= 3) { rx = x + 2; break; } } else run = 0;
      }
      if (rx < 0) continue;
      left.push([lx, y]); right.push([rx, y]);
    }
    return left.concat(right.reverse());
  }

  /** 4-연결 컴포넌트 라벨링 (mask를 소비: 방문한 픽셀은 2로 표시) */
  _components(mask, bounds, minArea) {
    const { PW, PH, stack } = this;
    const comps = [];
    const bx0 = Math.max(0, Math.floor(bounds.x0)), bx1 = Math.min(PW - 1, Math.ceil(bounds.x1));
    const by0 = Math.max(0, Math.floor(bounds.y0)), by1 = Math.min(PH - 1, Math.ceil(bounds.y1));
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        const start = y * PW + x;
        if (mask[start] !== 1) continue;
        let sp = 0;
        stack[sp++] = start;
        mask[start] = 2;
        const c = { area: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, minx: x, maxx: x, miny: y, maxy: y, bxsum: 0, bxn: 0 };
        while (sp > 0) {
          const i = stack[--sp];
          const px = i % PW, py = (i - px) / PW;
          c.area++; c.sx += px; c.sy += py; c.sxx += px * px; c.syy += py * py; c.sxy += px * py;
          if (px < c.minx) c.minx = px; if (px > c.maxx) c.maxx = px;
          if (py < c.miny) c.miny = py;
          if (py > c.maxy) { c.maxy = py; c.bxsum = px; c.bxn = 1; } else if (py === c.maxy) { c.bxsum += px; c.bxn++; }
          if (px > 0 && mask[i - 1] === 1) { mask[i - 1] = 2; stack[sp++] = i - 1; }
          if (px < PW - 1 && mask[i + 1] === 1) { mask[i + 1] = 2; stack[sp++] = i + 1; }
          if (py > 0 && mask[i - PW] === 1) { mask[i - PW] = 2; stack[sp++] = i - PW; }
          if (py < PH - 1 && mask[i + PW] === 1) { mask[i + PW] = 2; stack[sp++] = i + PW; }
        }
        if (c.area >= minArea) comps.push(c);
      }
    }
    return comps;
  }

  /**
   * 같은 색 큰 물체에 붙은 퍽 떼어 내기: 예측 자리(px,py) 둘레에서 '퍽 크기 원은 퍽 색으로 꽉 차고, 바로 바깥 고리는 대부분 비어 있는' 곳을 찾는다.
   * 스케이트·신발 안쪽은 고리까지 꽉 차서, 덩어리 가장자리는 원이 반쯤 비어서 걸러진다. 같은 점수면 예측 자리에 가까운 쪽.
   * 반환: 퍽 후보 {cx, cy, area, minx..maxy, score, split:true} | null
   */
  _splitFromBlob(px, py, area) {
    const { PW, PH, puckMask } = this;
    const rP = Math.max(1.5, Math.sqrt(area / Math.PI));
    const rIn = rP * 0.85, r1 = rP * 1.35, r2 = rP * 1.9, R2 = Math.ceil(r2);
    const disc = [], ring = [];
    for (let dy = -R2; dy <= R2; dy++) for (let dx = -R2; dx <= R2; dx++) {
      const q = dx * dx + dy * dy;
      if (q <= rIn * rIn) disc.push(dy * PW + dx); else if (q >= r1 * r1 && q <= r2 * r2) ring.push(dy * PW + dx);
    }
    const S = Math.max(3, Math.round(rP * 2)); // 탐색 반경: 퍽 지름만큼
    const x0 = Math.max(R2, Math.round(px - S)), x1 = Math.min(PW - 1 - R2, Math.round(px + S));
    const y0 = Math.max(R2, Math.round(py - S)), y1 = Math.min(PH - 1 - R2, Math.round(py + S));
    let best = null;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dd = Math.hypot(x - px, y - py);
      if (dd > S) continue;
      const i = y * PW + x;
      let inD = 0; for (const o of disc) if (puckMask[i + o]) inD++;
      const dc = inD / disc.length;
      if (dc < 0.7) continue;
      let inR = 0; for (const o of ring) if (puckMask[i + o]) inR++;
      const rc = inR / ring.length;
      if (rc > 0.55) continue;
      const score = dc - rc - 0.15 * dd / S;
      if (score >= 0.4 && (!best || score > best.score)) best = { x, y, score };
    }
    if (!best) return null;
    // 고른 자리 둘레(퍽 반지름 1.1배) 안의 퍽 색 픽셀로 중심·크기를 다시 잰다
    const rr = rP * 1.1, RR = Math.ceil(rr);
    let n = 0, sx = 0, sy = 0, minx = PW, maxx = 0, miny = PH, maxy = 0;
    for (let y = Math.max(0, best.y - RR); y <= Math.min(PH - 1, best.y + RR); y++) for (let x = Math.max(0, best.x - RR); x <= Math.min(PW - 1, best.x + RR); x++) {
      if ((x - best.x) ** 2 + (y - best.y) ** 2 > rr * rr || !puckMask[y * PW + x]) continue;
      n++; sx += x; sy += y;
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
    }
    if (!n) return null;
    return { cx: sx / n, cy: sy / n, area: n, minx, maxx, miny, maxy, score: best.score * 0.6, split: true };
  }

  /**
   * 보정 '터치로 지정': 누른 자리 근처에서 주변 바닥과 색이 다른 물체를 찾아 그 색·크기를 잰다.
   *  - 손가락이 조금 빗나가도(작은 퍽) 가장 가까운 물체로 붙는다
   *  - 색은 바닥과 섞인 가장자리 대신 물체 한가운데(배경과 가장 다른 쪽) 픽셀의 평균
   *  - 크기는 추적할 때와 같은 색 판정으로 잰 면적
   * 반환: { r,g,b, area, cx,cy, snapped:true, tol, dist, bg } — 근처에 물체가 없으면 누른 자리 색 그대로 { r,g,b, area, snapped:false }
   */
  sampleObject(px, py, tol) {
    if (!this.frame) return null;
    const { PW, PH } = this;
    const cx = Math.round(Math.min(PW - 1, Math.max(0, px)));
    const cy = Math.round(Math.min(PH - 1, Math.max(0, py)));
    const snapped = this._pickBlob(cx, cy);
    if (snapped) return snapped;
    return { ...this._sampleAt(cx, cy, tol), snapped: false };
  }

  /** 누른 자리 근처(손가락 오차 반경)에서 배경과 색이 다른 가장 가까운 덩어리. 없으면 null */
  _pickBlob(cx, cy) {
    const { PW, PH } = this; const d = this.frame.data;
    const R = Math.max(5, Math.round(Math.min(PW, PH) * 0.05)); // 손가락 오차: 이 안에 닿는 물체로 붙는다
    const W = R * 3;                                             // 물체 전체를 담는 창 (반폭)
    // 배경: 누른 자리 둘레 고리의 중앙값 (스틱·발이 고리 일부를 덮어도 바닥색)
    const ra = (R * 2.4) ** 2, rb = (R * 3.4) ** 2, RB = Math.ceil(R * 3.4);
    const ring = [];
    for (let y = Math.max(0, cy - RB); y <= Math.min(PH - 1, cy + RB); y++) for (let x = Math.max(0, cx - RB); x <= Math.min(PW - 1, cx + RB); x++) {
      const q = (x - cx) ** 2 + (y - cy) ** 2;
      if (q >= ra && q <= rb) ring.push((y * PW + x) * 4);
    }
    if (ring.length < 12) return null;
    const bg = medianColor(d, ring);
    const th = Math.max(36, Math.min(90, 2.8 * distQuantile(d, ring, bg, 0.5)));
    const x0 = Math.max(0, cx - W), x1 = Math.min(PW - 1, cx + W), y0 = Math.max(0, cy - W), y1 = Math.min(PH - 1, cy + W);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const mask = new Uint8Array(w * h);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const p = (y * PW + x) * 4;
      if (Math.hypot(d[p] - bg.r, d[p + 1] - bg.g, d[p + 2] - bg.b) > th) mask[(y - y0) * w + (x - x0)] = 1;
    }
    const blobs = mergeBlobs(labelBlobs(mask, w, h), 1);
    // 누른 자리에서 가장 가까운 덩어리 (거의 같은 거리면 큰 쪽)
    let best = null, bestD = Infinity;
    for (const b of blobs) {
      let dm = Infinity;
      for (const j of b.px) { const lx = j % w, ly = (j - lx) / w; const q = (lx + x0 - cx) ** 2 + (ly + y0 - cy) ** 2; if (q < dm) dm = q; }
      dm = Math.sqrt(dm);
      if (dm > R) continue;
      if (dm < bestD - 1.5 || (Math.abs(dm - bestD) <= 1.5 && b.px.length > best.px.length)) { best = b; bestD = dm; }
    }
    if (!best || best.px.length < 2) return null;
    const toP = (j) => { const lx = j % w, ly = (j - lx) / w; return ((ly + y0) * PW + lx + x0) * 4; };
    const col = coreColor(d, best.px, toP, bg);
    const dist = Math.hypot(col.r - bg.r, col.g - bg.g, col.b - bg.b);
    const tolS = Math.round(Math.min(120, Math.max(45, dist * 0.5)));
    // 크기: 추적과 같은 색 판정으로 덩어리에서 흘려 채운 면적. 같은 색 큰 물체(신발 등)에 붙어 새면 덩어리 면적으로
    const m = makeMatcher(col, tolS);
    const seeds = best.px.map((j) => toP(j) / 4).filter((i) => matchPixel(m, d[i * 4], d[i * 4 + 1], d[i * 4 + 2]));
    const blobArea = best.px.length;
    const clipped = best.minx === 0 || best.miny === 0 || best.maxx === w - 1 || best.maxy === h - 1; // 창보다 큰 물체 (스틱 블레이드)
    let area = seeds.length ? this._floodArea(seeds, m, 4000) : 0;
    if (!(area > 0) || (!clipped && area > blobArea * 4)) area = blobArea;
    return { r: col.r, g: col.g, b: col.b, area, cx: best.sx / blobArea + x0, cy: best.sy / blobArea + y0, snapped: true, tol: tolS, dist, bg };
  }

  /** seeds(픽셀 번호)에서 시작해 색 판정 m 에 맞는 이웃으로 흘려 채운 면적 (cap 까지) */
  _floodArea(seeds, m, cap) {
    const { PW, PH } = this; const d = this.frame.data;
    const visited = new Uint8Array(PW * PH), stack = this.stack;
    let sp = 0, area = 0;
    for (const s of seeds) if (!visited[s]) { visited[s] = 1; stack[sp++] = s; }
    while (sp > 0 && area < cap) {
      const i = stack[--sp], p = i * 4;
      if (!matchPixel(m, d[p], d[p + 1], d[p + 2])) continue;
      area++;
      const x = i % PW, y = (i - x) / PW;
      if (x > 0 && !visited[i - 1]) { visited[i - 1] = 1; stack[sp++] = i - 1; }
      if (x < PW - 1 && !visited[i + 1]) { visited[i + 1] = 1; stack[sp++] = i + 1; }
      if (y > 0 && !visited[i - PW]) { visited[i - PW] = 1; stack[sp++] = i - PW; }
      if (y < PH - 1 && !visited[i + PW]) { visited[i + PW] = 1; stack[sp++] = i + PW; }
    }
    return area;
  }

  /** 예전 방식: 누른 자리 5×5 평균색 + 같은 색으로 흘려 채운 면적 (근처에 뚜렷한 물체가 없을 때) */
  _sampleAt(cx, cy, tol) {
    const { PW, PH } = this;
    const d = this.frame.data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = cy - 2; y <= cy + 2; y++) {
      if (y < 0 || y >= PH) continue;
      for (let x = cx - 2; x <= cx + 2; x++) {
        if (x < 0 || x >= PW) continue;
        const p = (y * PW + x) * 4;
        r += d[p]; g += d[p + 1]; b += d[p + 2]; n++;
      }
    }
    r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
    // 같은 색 영역을 flood fill로 측정 (임시 마스크)
    const tol2 = tol * tol;
    const visited = new Uint8Array(PW * PH);
    const stack = this.stack;
    let sp = 0, area = 0;
    const start = cy * PW + cx;
    stack[sp++] = start; visited[start] = 1;
    const match = (i) => {
      const p = i * 4;
      const dr = d[p] - r, dg = d[p + 1] - g, db = d[p + 2] - b;
      return dr * dr + dg * dg + db * db <= tol2;
    };
    while (sp > 0 && area < 4000) {
      const i = stack[--sp];
      if (!match(i)) continue;
      area++;
      const x = i % PW, y = (i - x) / PW;
      if (x > 0 && !visited[i - 1]) { visited[i - 1] = 1; stack[sp++] = i - 1; }
      if (x < PW - 1 && !visited[i + 1]) { visited[i + 1] = 1; stack[sp++] = i + 1; }
      if (y > 0 && !visited[i - PW]) { visited[i - PW] = 1; stack[sp++] = i - PW; }
      if (y < PH - 1 && !visited[i + PW]) { visited[i + PW] = 1; stack[sp++] = i + PW; }
    }
    return { r, g, b, area };
  }

  /**
   * 게임 영역(바닥)이 정해지면 그 가운데를 기억한다: 퍽 등록·핸즈프리 시작 원이 영역 한가운데에 오게.
   * mapping: 바닥 사상 (없으면 화면 가운데). 카메라는 process() 가, 마우스 테스트 모드는 main 이 부른다
   */
  useArea(mapping, hint = null) {
    const c = mapping ? mapping.toPx(0.5, 0.5) : null;
    this.areaCenter = c && Number.isFinite(c[0]) && Number.isFinite(c[1]) ? c : null;
    // 영역 한가운데 줄의 바닥 폭(px): 원근 때문에 위·아래 변이 아니라 가운데에서 잰다 (퍽 크기 추정용)
    let w = 0;
    if (this.areaCenter) {
      const a = mapping.toPx(0.4, 0.5), b = mapping.toPx(0.6, 0.5);
      w = Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.2;
    }
    this.areaWidthPx = Number.isFinite(w) && w > 0 ? w : 0;
    this.puckHint = hint; // { area: 등록된 퍽 면적(px, 0 = 미등록), widthM: 영역 실제 폭(m) }
  }

  /**
   * 퍽이 영역 한가운데에서 보일 반지름(처리 px) 추정.
   * 등록된 퍽이 있으면 그 면적으로, 없으면 영역 폭 × (퍽 지름 7.6cm / 영역 실제 폭) — 실제 폭을 모르면 영역 폭의 3%
   */
  expectedPuckR() {
    const h = this.puckHint;
    if (h && h.area > 0) return Math.sqrt(h.area / Math.PI);
    const w = this.areaWidthPx || this.PW * 0.96;
    const frac = h && h.widthM > 0 ? PUCK_DIAMETER_M / h.widthM : 0.03;
    return (w * frac) / 2;
  }

  /**
   * 가운데 원 (퍽 등록·핸즈프리 시작): 게임 영역의 한가운데(원근 기준 바닥 가운데). 원이 화면 밖으로 나가지 않게 안쪽으로.
   * 크기는 퍽 지름의 약 2배 (지정한 영역 기준 — 화면이 아니라 퍽에 맞춰 작게). 너무 작으면 놓기 어렵고, 예전 크기(짧은 변의 9.5%)보다는 크지 않게.
   * scale: 인식할 때는 그린 원보다 조금 넓게 본다 (원 가장자리에 걸쳐도 됨) — 자리는 같고 반지름만
   */
  calibCircle(scale = 1, target = 'puck') {
    const { PW, PH } = this, m = Math.min(PW, PH);
    // 스틱 블레이드 테이프는 퍽보다 훨씬 길어서 예전 크기 그대로
    const r0 = target === 'stick' ? m * 0.095 : Math.min(m * 0.095, Math.max(5, m * 0.03, CIRCLE_PUCK_RATIO * this.expectedPuckR()));
    const [cx, cy] = this.areaCenter || [PW / 2, PH / 2];
    const x = Math.min(PW - r0, Math.max(r0, cx)), y = Math.min(PH - r0, Math.max(r0, cy));
    return { x, y, r: r0 * scale };
  }

  /** (x, y) 둘레 고리(r1~r2)의 바닥색. 퍽·스틱처럼 튀는 색은 두 번째 평균에서 뺀다 (진짜 퍽을 덮는 색) */
  ringColor(x, y, r1, r2) {
    if (!this.frame) return null;
    const { PW, PH } = this; const d = this.frame.data;
    const a = r1 * r1, b = r2 * r2;
    const x0 = Math.max(0, Math.floor(x - r2)), x1 = Math.min(PW - 1, Math.ceil(x + r2));
    const y0 = Math.max(0, Math.floor(y - r2)), y1 = Math.min(PH - 1, Math.ceil(y + r2));
    const px = [];
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
      const q = (xx - x) ** 2 + (yy - y) ** 2;
      if (q < a || q > b) continue;
      const p = (yy * PW + xx) * 4; px.push(d[p], d[p + 1], d[p + 2]);
    }
    if (px.length < 9) return null;
    const mean = (keep) => { let r = 0, g = 0, bl = 0, n = 0; for (let i = 0; i < px.length; i += 3) if (keep(i)) { r += px[i]; g += px[i + 1]; bl += px[i + 2]; n++; } return n ? { r: r / n, g: g / n, b: bl / n, n } : null; };
    const m1 = mean(() => true);
    const m2 = mean((i) => (px[i] - m1.r) ** 2 + (px[i + 1] - m1.g) ** 2 + (px[i + 2] - m1.b) ** 2 < 60 * 60);
    const m = m2 && m2.n >= 6 ? m2 : m1;
    return { r: Math.round(m.r), g: Math.round(m.g), b: Math.round(m.b) };
  }

  /**
   * 가운데 원 안에서 주변 배경(고리 영역)과 색이 다른 픽셀 덩어리를 찾는다.
   * 반환: { status: 'none'|'too_big'|'ok', r,g,b, area, cx, cy, bg:{r,g,b}, dist }
   */
  autoCalibSample(target = 'puck') {
    if (!this.frame) return { status: 'none' };
    const { PW, PH } = this; const d = this.frame.data;
    const c = this.calibCircle(1.3, target); // 그린 원보다 조금 넓게 (원에 걸친 퍽도 인식)
    // 배경 고리는 예전(큰) 원 크기 바깥에서 잰다: 원보다 큰 물체가 고리까지 덮어 '너무 큼'을 놓치지 않게
    const ringR = Math.min(PW, PH) * 0.19;
    const r2 = c.r * c.r, ring0 = (ringR * 1.1) ** 2, ring1 = (ringR * 1.5) ** 2;
    const x0 = Math.max(0, Math.floor(c.x - ringR * 1.5)), x1 = Math.min(PW - 1, Math.ceil(c.x + ringR * 1.5));
    const y0 = Math.max(0, Math.floor(c.y - ringR * 1.5)), y1 = Math.min(PH - 1, Math.ceil(c.y + ringR * 1.5));
    // 배경색: 고리의 '중앙값' (평균이면 고리에 걸친 다리·스틱·영역 밖 벽 색이 섞여 바닥색이 틀어지고, 그러면 바닥까지 물체로 보여 인식이 안 된다).
    // 게임 영역(바닥) 안쪽 고리만 쓴다. 영역이 작아 고리가 거의 밖이면 원 바로 바깥의 영역 안쪽까지, 그래도 모자라면 고리 전체
    const inArea = [], outArea = [], nearIn = [], near0 = (c.r * 1.1) ** 2;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = x - c.x, dy = y - c.y, q = dx * dx + dy * dy;
      if (q < near0 || q > ring1) continue;
      const inside = this._inArea(x, y), p = (y * PW + x) * 4;
      if (q < ring0) { if (inside) nearIn.push(p); continue; }
      (inside ? inArea : outArea).push(p);
    }
    const ring = inArea.length >= 40 ? inArea : inArea.length + nearIn.length >= 40 ? inArea.concat(nearIn) : inArea.concat(outArea);
    if (!ring.length) return { status: 'none' };
    const bgc = medianColor(d, ring);
    // 임계값: 바닥 질감(고리 픽셀이 중앙값에서 떨어진 거리의 중앙값)에 비례. 다리 등 섞인 물체에는 흔들리지 않는다
    const th = Math.max(42, Math.min(90, 2.8 * distQuantile(d, ring, bgc, 0.5)));
    const TH2 = th * th;
    // 원 안: 배경과 충분히 다른 픽셀을 후보 마스크로
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const mask = new Uint8Array(w * h);
    let inside = 0, cand = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = x - c.x, dy = y - c.y;
      if (dx * dx + dy * dy > r2) continue;
      inside++;
      const p = (y * PW + x) * 4;
      const er = d[p] - bgc.r, eg = d[p + 1] - bgc.g, eb = d[p + 2] - bgc.b;
      if (er * er + eg * eg + eb * eb < TH2) continue;
      mask[(y - y0) * w + (x - x0)] = 1; cand++;
    }
    const bgOut = { r: bgc.r, g: bgc.g, b: bgc.b };
    // 아주 작게 보이는 퍽(멀리 둔 카메라·작은 공)도 받도록 최소 크기는 원 넓이의 0.4% (240px 해상도에서 5~6px)
    const minObj = Math.max(5, Math.round(inside * 0.004));
    if (cand < minObj) return { status: 'none', bg: bgOut, th };
    if (cand > inside * 0.85) return { status: 'too_big', bg: bgOut, th };
    // 후보 픽셀을 연결 성분으로 묶고(바닥 무늬·점은 작은 조각으로 흩어짐), 반사광 등으로 갈라진 조각(간격 2px 이하)은 병합해
    // 가장 큰 덩어리를 물체로 본다
    const blobs = mergeBlobs(labelBlobs(mask, w, h), 2);
    blobs.sort((a, b) => b.px.length - a.px.length);
    const best = blobs[0];
    if (!best || best.px.length < minObj) return { status: 'none', bg: bgOut, th, scattered: true };
    const n = best.px.length;
    // 밀집도: 균일한 원판이면 위치 표준편차 ≈ 0.5*sqrt(area/π)·√2 (2차원)
    const mx = best.sx / n, my = best.sy / n;
    const spread = Math.sqrt(Math.max(0, best.sxx / n - mx * mx) + Math.max(0, best.syy / n - my * my));
    const expected = Math.SQRT2 * 0.5 * Math.sqrt(n / Math.PI);
    if (spread > expected * 2.2) return { status: 'none', bg: bgOut, th, scattered: true };
    // 물체 색: 바닥과 섞인 가장자리를 빼고 한가운데(배경과 가장 다른 쪽) 픽셀의 평균 — 작은 퍽일수록 가장자리 비중이 커서 색이 바닥 쪽으로 틀어진다
    const toP = (j) => { const lx = j % w, ly = (j - lx) / w; return ((ly + y0) * PW + lx + x0) * 4; };
    const model = coreColor(d, best.px, toP, bgc);
    const dist = Math.hypot(model.r - bgc.r, model.g - bgc.g, model.b - bgc.b);
    return { status: 'ok', r: model.r, g: model.g, b: model.b, area: n, cx: mx + x0, cy: my + y0, bg: bgOut, dist, th, pieces: blobs.length };
  }

  /** 처리 좌표 (x,y) 가 게임 영역(바닥 사다리꼴) 안인지. 영역을 아직 모르면 true */
  _inArea(x, y) {
    const s = this.scan;
    if (!s || y < 0 || y >= this.PH) return true;
    const xa = s[y * 2];
    return xa >= 0 && x >= xa && x <= s[y * 2 + 1];
  }

  /**
   * 스틱이 퍽을 가린 동안: 추적 게이트를 블레이드로 추정한 퍽 자리에 붙들어 둔다.
   * 가림이 풀리면 그 근처에서 바로 다시 잡고, 그사이 '놓침'이 쌓여 게이트가 사라지지 않게
   */
  holdPuckAt(px, py) {
    const l = this.lastPuck;
    if (!l) return;
    l.x = px; l.y = py; l.vx = 0; l.vy = 0; l.missed = Math.min(l.missed, 6);
  }

  /** 보정 터치 위치를 추적 시작점으로 사용 (같은 색의 다른 물체에 처음부터 붙는 것을 방지) */
  seedPuck(px, py, area) {
    this.lastPuck = { x: px, y: py, area: Math.max(3, area), vx: 0, vy: 0, missed: 0 };
  }

  /** 색이 바닥(흰색)과 구분되는지 */
  isFloorLike(model, settings) {
    const mx = Math.max(model.r, model.g, model.b), mn = Math.min(model.r, model.g, model.b);
    return mx >= settings.whiteV - 15 && (mx - mn) <= settings.whiteC + 10;
  }

  _buildDebug(stickModel) {
    const { PW, PH } = this;
    if (!this.debugImage || this.debugImage.width !== PW || this.debugImage.height !== PH) {
      this.debugImage = new ImageData(PW, PH);
    }
    const o = this.debugImage.data;
    for (let i = 0, p = 0; i < PW * PH; i++, p += 4) {
      let r = 0, g = 0, b = 0, a = 0;
      if (this.whiteMask[i]) { r = 40; g = 90; b = 160; a = 120; }
      if (this.puckMask[i]) { r = 255; g = 60; b = 60; a = 230; }
      if (stickModel && this.stickMask[i]) { r = 60; g = 255; b = 90; a = 230; }
      o[p] = r; o[p + 1] = g; o[p + 2] = b; o[p + 3] = a;
    }
  }
}

/**
 * 색 매처 생성. 채도가 높은 색(주황·파랑 테이프 등)은 조명 밝기에 따라 RGB가 크게 변하므로
 * 정규화 색도(r/(r+g+b), g/(r+g+b))로 비교해 허용 폭을 넓힌다. 어두운 색(검정 퍽)은 RGB 거리 사용.
 */
export function makeMatcher(model, tol) {
  const { r, g, b } = model;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const sat = mx > 0 ? (mx - mn) / mx : 0;
  if (sat > 0.35 && mx > 60) {
    const sum = r + g + b;
    const tolC = tol * 0.6;
    return {
      chroma: true,
      nr: (r / sum) * 255, ng: (g / sum) * 255,
      tol2: tolC * tolC,
      minV: Math.max(35, mx * 0.3),
      minChroma: Math.max(12, (mx - mn) * 0.4),
    };
  }
  return { chroma: false, r, g, b, tol2: tol * tol };
}

export function matchPixel(m, r, g, b) {
  if (!m.chroma) {
    const dr = r - m.r, dg = g - m.g, db = b - m.b;
    return dr * dr + dg * dg + db * db <= m.tol2;
  }
  const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
  const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
  if (mx < m.minV || (mx - mn) < m.minChroma) return false;
  const sum = r + g + b;
  const dr = (r / sum) * 255 - m.nr, dg = (g / sum) * 255 - m.ng;
  return dr * dr + dg * dg <= m.tol2;
}

/**
 * 덩어리 모양 (2차 모멘트): elong = 짧은 축 / 긴 축 (원·퍽 1에 가깝고, 가늘고 길수록 0), angle = 긴 축 방향(라디안).
 * 모멘트가 없는 덩어리(떼어 낸 조각 등)는 null
 */
export function blobShape(c) {
  if (!c || c.sxx === undefined || !(c.area > 0)) return null;
  const n = c.area, mx = c.sx / n, my = c.sy / n;
  // 픽셀 한 칸의 폭(분산 1/12)을 더해 1~2px 짜리 조각이 '무한히 가늘게' 잡히지 않게
  const cxx = c.sxx / n - mx * mx + 1 / 12, cyy = c.syy / n - my * my + 1 / 12, cxy = c.sxy / n - mx * my;
  const t = (cxx + cyy) / 2, d = Math.sqrt(((cxx - cyy) / 2) ** 2 + cxy * cxy);
  const l1 = t + d, l2 = Math.max(1e-6, t - d);
  return { elong: Math.sqrt(l2 / l1), angle: 0.5 * Math.atan2(2 * cxy, cxx - cyy) };
}

/** 반사광 등으로 조각난 덩어리 병합: bbox 간격이 gap 이하인 컴포넌트를 합침 */
export function mergeClose(comps, gap) {
  if (comps.length < 2 || comps.length > 40) return comps;
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < comps.length; i++) {
      for (let j = i + 1; j < comps.length; j++) {
        const a = comps[i], c = comps[j];
        if (a.minx > c.maxx + gap || c.minx > a.maxx + gap || a.miny > c.maxy + gap || c.miny > a.maxy + gap) continue;
        a.area += c.area; a.sx += c.sx; a.sy += c.sy;
        if (a.sxx !== undefined && c.sxx !== undefined) { a.sxx += c.sxx; a.syy += c.syy; a.sxy += c.sxy; }
        a.minx = Math.min(a.minx, c.minx); a.maxx = Math.max(a.maxx, c.maxx);
        a.miny = Math.min(a.miny, c.miny);
        if (c.maxy > a.maxy) { a.maxy = c.maxy; a.bxsum = c.bxsum; a.bxn = c.bxn; }
        else if (c.maxy === a.maxy) { a.bxsum += c.bxsum; a.bxn += c.bxn; }
        comps.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return comps;
}

/** 픽셀들(idx = RGBA 배열 위치)의 채널별 중앙값 색. 섞인 물체가 절반 미만이면 바닥색 그대로 */
export function medianColor(d, idx) {
  const hr = new Uint32Array(256), hg = new Uint32Array(256), hb = new Uint32Array(256);
  for (const p of idx) { hr[d[p]]++; hg[d[p + 1]]++; hb[d[p + 2]]++; }
  const half = idx.length / 2;
  const med = (hst) => { let s = 0; for (let v = 0; v < 256; v++) { s += hst[v]; if (s >= half) return v; } return 255; };
  return { r: med(hr), g: med(hg), b: med(hb) };
}

/** 픽셀들이 색 c 에서 떨어진 거리(RGB)의 분위수 (q: 0~1) */
export function distQuantile(d, idx, c, q) {
  if (!idx.length) return 0;
  const hst = new Uint32Array(443);
  for (const p of idx) hst[Math.min(442, Math.round(Math.hypot(d[p] - c.r, d[p + 1] - c.g, d[p + 2] - c.b)))]++;
  const want = idx.length * q;
  let s = 0;
  for (let v = 0; v < 443; v++) { s += hst[v]; if (s >= want) return v; }
  return 442;
}

function blobStats(px, w) {
  const b = { px, sx: 0, sy: 0, sxx: 0, syy: 0, minx: 1e9, maxx: -1, miny: 1e9, maxy: -1 };
  for (const j of px) {
    const x = j % w, y = (j - x) / w;
    b.sx += x; b.sy += y; b.sxx += x * x; b.syy += y * y;
    if (x < b.minx) b.minx = x; if (x > b.maxx) b.maxx = x; if (y < b.miny) b.miny = y; if (y > b.maxy) b.maxy = y;
  }
  return b;
}

/** 0/1 마스크(w×h)를 4-연결 덩어리로 묶는다 (mask 를 소비). 덩어리: { px:[지역 번호], sx,sy,sxx,syy, minx..maxy } */
export function labelBlobs(mask, w, h) {
  const stack = new Int32Array(w * h), blobs = [];
  for (let i = 0; i < w * h; i++) {
    if (mask[i] !== 1) continue;
    const px = [];
    let sp = 0; stack[sp++] = i; mask[i] = 2;
    while (sp > 0) {
      const j = stack[--sp]; px.push(j);
      const x = j % w, y = (j - x) / w;
      if (x > 0 && mask[j - 1] === 1) { mask[j - 1] = 2; stack[sp++] = j - 1; }
      if (x < w - 1 && mask[j + 1] === 1) { mask[j + 1] = 2; stack[sp++] = j + 1; }
      if (y > 0 && mask[j - w] === 1) { mask[j - w] = 2; stack[sp++] = j - w; }
      if (y < h - 1 && mask[j + w] === 1) { mask[j + w] = 2; stack[sp++] = j + w; }
    }
    blobs.push(blobStats(px, w));
  }
  return blobs;
}

/** bbox 간격이 gap 이하인 덩어리를 합친다 (반사광·스틱 자루로 갈라진 조각) */
export function mergeBlobs(blobs, gap) {
  let merged = true;
  while (merged && blobs.length > 1 && blobs.length <= 60) {
    merged = false;
    outer: for (let a = 0; a < blobs.length; a++) for (let b = a + 1; b < blobs.length; b++) {
      const A = blobs[a], B = blobs[b];
      if (A.minx > B.maxx + gap || B.minx > A.maxx + gap || A.miny > B.maxy + gap || B.miny > A.maxy + gap) continue;
      for (const k of ['sx', 'sy', 'sxx', 'syy']) A[k] += B[k];
      A.px = A.px.concat(B.px);
      A.minx = Math.min(A.minx, B.minx); A.maxx = Math.max(A.maxx, B.maxx); A.miny = Math.min(A.miny, B.miny); A.maxy = Math.max(A.maxy, B.maxy);
      blobs.splice(b, 1); merged = true; break outer;
    }
  }
  return blobs;
}

/**
 * 덩어리의 '가운데 색': 배경에서 가장 먼 쪽(상위 10% 기준의 70% 이상) 픽셀의 평균.
 * 가장자리는 바닥과 섞여 색이 흐리므로 빼고, 그늘처럼 약하게 다른 부분이 붙어 있어도 진짜 물체 색을 고른다
 */
export function coreColor(d, px, toP, bg) {
  const n = px.length, dist = new Float32Array(n), pos = new Int32Array(n);
  for (let k = 0; k < n; k++) { const p = toP(px[k]); pos[k] = p; dist[k] = Math.hypot(d[p] - bg.r, d[p + 1] - bg.g, d[p + 2] - bg.b); }
  const sorted = Float32Array.from(dist).sort();
  const cut = n >= 4 ? sorted[Math.min(n - 1, Math.floor(n * 0.9))] * 0.7 : 0;
  let r = 0, g = 0, b = 0, m = 0;
  for (let k = 0; k < n; k++) if (dist[k] >= cut) { const p = pos[k]; r += d[p]; g += d[p + 1]; b += d[p + 2]; m++; }
  return { r: Math.round(r / m), g: Math.round(g / m), b: Math.round(b / m) };
}

/** 가운데 원 안의 물체가 3초간 같은 색·크기로 머물면 확정 */
export class AutoCalibrator {
  constructor(holdSec = 3) { this.holdSec = holdSec; this.reset(); }
  reset() { this.hold = 0; this.avg = null; this.status = 'none'; this.sample = null; }
  /** sample: vision.autoCalibSample() 결과. 반환: 확정된 모델 또는 null */
  update(sample, dt) {
    this.status = sample.status;
    this.sample = sample;
    if (sample.status !== 'ok') { this.hold = Math.max(0, this.hold - dt * 2); if (this.hold === 0) this.avg = null; return null; }
    if (!this.avg) { this.avg = { r: sample.r, g: sample.g, b: sample.b, area: sample.area }; this.hold = 0; return null; }
    const a = this.avg;
    const colorDiff = Math.hypot(sample.r - a.r, sample.g - a.g, sample.b - a.b);
    const areaRatio = sample.area / a.area;
    // 작은 물체는 한두 픽셀만 달라져도 크기 비율이 크게 흔들리므로 허용 폭을 넓힌다 (가만히 있는데 셈이 자꾸 처음부터 되는 것 방지)
    const small = a.area < 30;
    if (colorDiff > (small ? 50 : 35) || areaRatio < (small ? 0.45 : 0.6) || areaRatio > (small ? 2.2 : 1.6)) { this.avg = { r: sample.r, g: sample.g, b: sample.b, area: sample.area }; this.hold = 0; return null; }
    a.r += (sample.r - a.r) * 0.2; a.g += (sample.g - a.g) * 0.2; a.b += (sample.b - a.b) * 0.2; a.area += (sample.area - a.area) * 0.2;
    this.hold += dt;
    if (this.hold < this.holdSec) return null;
    const tol = Math.round(Math.min(120, Math.max(45, sample.dist * 0.5)));
    return { r: Math.round(a.r), g: Math.round(a.g), b: Math.round(a.b), area: Math.round(a.area), tol, cx: sample.cx, cy: sample.cy, bg: sample.bg };
  }
}
