// 단위 정사각형(0..1) <-> 사각형(quad) 호모그래피
// quad: [[x,y],[x,y],[x,y],[x,y]] (좌상, 우상, 우하, 좌하)

function solveLinear(A, b) {
  // 가우스 소거 (8x8)
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** src 4점 -> dst 4점 호모그래피 3x3 (row-major 배열 9개) */
export function homography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solveLinear(A, b);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

const UNIT = [[0, 0], [1, 0], [1, 1], [0, 1]];

/** 바닥 사각형에 대한 변환 쌍 생성 */
export function makeFloorMapping(quad) {
  const toPx = homography(UNIT, quad);
  const toUV = homography(quad, UNIT);
  if (!toPx || !toUV) return null;
  return {
    quad,
    toPx: (u, v) => applyH(toPx, u, v),
    toUV: (x, y) => applyH(toUV, x, y),
    inside(x, y, margin = 0) {
      const [u, v] = applyH(toUV, x, y);
      return u >= -margin && u <= 1 + margin && v >= -margin && v <= 1 + margin;
    },
  };
}

/** 사각형의 축정렬 바운딩 박스 */
export function quadBounds(quad) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of quad) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
}

/**
 * 볼록 사각형을 변마다 안쪽으로 e 만큼 옮긴 사각형 (이웃한 두 변을 옮긴 직선의 교점이 새 꼭짓점).
 * 변이 거의 나란해 교점을 못 구하면 원래 사각형
 */
export function insetQuad(quad, e) {
  let a2 = 0;
  for (let k = 0; k < 4; k++) { const [x1, y1] = quad[k], [x2, y2] = quad[(k + 1) % 4]; a2 += x1 * y2 - x2 * y1; }
  const s = a2 >= 0 ? 1 : -1; // 꼭짓점 도는 방향에 맞춰 안쪽 법선
  const lines = quad.map(([x1, y1], k) => {
    const [x2, y2] = quad[(k + 1) % 4], L = Math.hypot(x2 - x1, y2 - y1) || 1;
    const nx = (-(y2 - y1) / L) * s, ny = ((x2 - x1) / L) * s;
    return { nx, ny, c: nx * x1 + ny * y1 + e }; // 안쪽: nx·x + ny·y >= c
  });
  const out = [];
  for (let k = 0; k < 4; k++) {
    const a = lines[(k + 3) % 4], b = lines[k], det = a.nx * b.ny - a.ny * b.nx;
    if (Math.abs(det) < 1e-9) return quad;
    out.push([(a.c * b.ny - a.ny * b.c) / det, (a.nx * b.c - a.c * b.nx) / det]);
  }
  return out;
}

/** 볼록 사각형의 각 행(y)별 x 범위 (스캔라인) -> Int16Array [xmin,xmax] * h */
export function quadScanlines(quad, h) {
  const out = new Int16Array(h * 2);
  out.fill(-1);
  const b = quadBounds(quad);
  const yStart = Math.max(0, Math.floor(b.y0));
  const yEnd = Math.min(h - 1, Math.ceil(b.y1));
  for (let y = yStart; y <= yEnd; y++) {
    let xmin = Infinity, xmax = -Infinity;
    const yc = y + 0.5;
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = quad[i];
      const [bx, by] = quad[(i + 1) % 4];
      if ((yc >= ay && yc < by) || (yc >= by && yc < ay)) {
        const t = (yc - ay) / (by - ay);
        const x = ax + t * (bx - ax);
        xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
      }
    }
    if (xmin <= xmax) { out[y * 2] = Math.max(0, Math.round(xmin)); out[y * 2 + 1] = Math.round(xmax); }
  }
  return out;
}
