// 디자인 토큰 (캔버스용). CSS 변수와 같은 값을 유지할 것 — style.css :root 참고.
// 컨셉: 종이 바탕 + 잉크 블랙 + 포인트 레드 한 색. 보조로 옐로는 '수집 아이템'에만 사용.
export const C = {
  paper: '#F4F1EA',   // 따뜻한 종이색
  paper2: '#EAE5D9',
  ink: '#161616',     // 잉크 블랙
  inkSoft: '#4A4741',
  mute: '#8C877C',
  red: '#E03C31',     // PANTONE 179 C — 포인트 컬러 (플레이어의 퍽, 핵심 행동, 경고)
  yellow: '#FFC72C',  // PANTONE 123 C — 수집 아이템 전용
};

export const F = {
  display: '"Fraunces", "Noto Serif KR", Georgia, serif',           // 굵은 세리프: 숫자·제목
  sans: '"Poppins", "Noto Sans KR", system-ui, -apple-system, sans-serif',
  script: '"Caveat", "Nanum Pen Script", cursive',                   // 필기체 악센트 (항상 레드)
};

export function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export const font = (family, size, weight = 700) => `${weight} ${Math.round(size)}px ${family}`;

/** 현재 경로를 종이색 헤일로 + 잉크 선으로 그린다 (영상 위에서도 읽히는 얇은 선) */
export function inkStroke(ctx, width, color = C.ink, halo = 2.2) {
  if (halo) { ctx.save(); ctx.setLineDash([]); ctx.lineWidth = width * (1 + halo); ctx.strokeStyle = rgba(C.paper, 0.9); ctx.stroke(); ctx.restore(); }
  ctx.lineWidth = width; ctx.strokeStyle = color; ctx.stroke();
}

/** 헤일로가 있는 텍스트 */
export function text(ctx, str, x, y, size, { family = F.sans, weight = 600, color = C.ink, align = 'center', baseline = 'middle', halo = true } = {}) {
  ctx.font = font(family, size, weight);
  ctx.textAlign = align; ctx.textBaseline = baseline;
  if (halo) { ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, Math.min(size * 0.2, 4 + size * 0.05)); ctx.strokeStyle = rgba(C.paper, 0.92); ctx.strokeText(str, x, y); }
  ctx.fillStyle = color; ctx.fillText(str, x, y);
}

/** 알약형 라벨: 종이 바탕 + 잉크 테두리 (inverse면 잉크/레드 바탕 + 종이 글자) */
export function pill(ctx, str, x, y, size, { bg = C.paper, fg = C.ink, border = C.ink, weight = 600, family = F.sans, align = 'center', alpha = 0.94 } = {}) {
  ctx.font = font(family, size, weight);
  const w = ctx.measureText(str).width + size * 1.5, h = size * 1.9;
  const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.beginPath(); ctx.roundRect(left, y - h / 2, w, h, h / 2);
  ctx.fillStyle = bg === C.paper ? rgba(C.paper, alpha) : bg; ctx.fill();
  if (border) { ctx.lineWidth = Math.max(1.2, size * 0.09); ctx.strokeStyle = border; ctx.stroke(); }
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(str, left + w / 2, y + size * 0.04);
  return { w, h };
}

/** 방사형 짧은 선 (일러스트의 '튀는' 모션 표시) */
export function sparks(ctx, x, y, r0, r1, n, color, width, phase = 0) {
  ctx.lineWidth = width; ctx.strokeStyle = color; ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0); ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1); ctx.stroke();
  }
}

let _layer = null;
/**
 * drawFn(ctx)이 그리는 내용을 통째로 alpha(0~1)만큼만 보이게 합성한다.
 * 내 퍽 표시(본체·고리·궤적·스파크)를 한 덩어리로 흐리게 하거나 숨길 때 사용 — 헤드업 훈련용.
 * alpha 1이면 그대로 그리고, 0이면 아무것도 그리지 않는다.
 */
export function alphaLayer(ctx, alpha, drawFn) {
  if (alpha >= 0.999) { drawFn(ctx); return; }
  if (alpha <= 0.001) return;
  const cv = ctx.canvas;
  if (!_layer) _layer = document.createElement('canvas');
  if (_layer.width !== cv.width || _layer.height !== cv.height) { _layer.width = cv.width; _layer.height = cv.height; }
  const lc = _layer.getContext('2d');
  lc.setTransform(1, 0, 0, 1, 0, 0);
  lc.clearRect(0, 0, _layer.width, _layer.height);
  lc.globalAlpha = 1; lc.lineJoin = 'round'; lc.lineCap = 'round'; lc.setLineDash([]);
  drawFn(lc);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.drawImage(_layer, 0, 0);
  ctx.restore();
}
