// 사용 가이드 그림 (인라인 SVG). 안내 페이지는 CSP 로 style 속성·<style> 을 막으므로 모양은 속성(fill·stroke…)만 쓰고,
// 글꼴·크기 맞춤은 pages.css 의 .art 규칙이 맡는다. 글자는 모두 매개변수로 받는다 (영어 페이지에 한글이 남지 않게)
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const INK = '#161616', RED = '#E03C31', PAPER = '#F4F1EA', PAPER2 = '#EAE5D9', MUTE = '#8C877C';
const line = `fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;

/** 48×48 선 아이콘 */
const ICONS = {
  camera: `<path d="M24 18v14M24 32l-9 12M24 32l9 12M24 32v12" ${line}/><rect x="15" y="6" width="18" height="12" rx="3" ${line}/><circle cx="24" cy="12" r="3" fill="${RED}"/>`,
  area: `<path d="M15 12h18l9 26H6z" ${line}/><circle cx="15" cy="12" r="3" fill="${RED}"/><circle cx="33" cy="12" r="3" fill="${RED}"/><circle cx="42" cy="38" r="3" fill="${RED}"/><circle cx="6" cy="38" r="3" fill="${RED}"/>`,
  circle: `<circle cx="24" cy="24" r="16" ${line} stroke-dasharray="4 4"/><ellipse cx="24" cy="25" rx="7" ry="4.5" fill="${INK}"/><path d="M24 4v4" ${line}/>`,
  play: `<path d="M8 40c6-2 10-10 14-18" ${line}/><path d="M22 22l16-14" ${line}/><path d="M6 41h10" ${line}/><ellipse cx="34" cy="38" rx="6" ry="3.5" fill="${RED}"/>`,
  laptop: `<rect x="10" y="10" width="28" height="19" rx="2" ${line}/><path d="M5 35h38l-3 4H8z" ${line}/>`,
  webcam: `<circle cx="24" cy="18" r="10" ${line}/><circle cx="24" cy="18" r="3.5" fill="${RED}"/><path d="M24 28v8M16 40h16" ${line}/>`,
  tv: `<rect x="5" y="9" width="38" height="25" rx="2" ${line}/><path d="M17 40h14M24 34v6" ${line}/>`,
  phone: `<rect x="15" y="5" width="18" height="38" rx="4" ${line}/><path d="M22 38h4" ${line}/>`,
  tablet: `<rect x="8" y="6" width="32" height="36" rx="4" ${line}/><path d="M21 37h6" ${line}/>`,
  cable: `<path d="M4 30h9c5 0 5-12 11-12s6 12 11 12h9" ${line}/><rect x="2" y="26" width="6" height="8" rx="1" fill="${INK}"/><rect x="40" y="26" width="6" height="8" rx="1" fill="${INK}"/>`,
  wifi: `<path d="M8 20c9-8 23-8 32 0M14 26c6-5 14-5 20 0M20 32c2-2 6-2 8 0" ${line}/><circle cx="24" cy="37" r="2.5" fill="${RED}"/>`,
  color: `<circle cx="18" cy="24" r="11" fill="${INK}"/><circle cx="30" cy="24" r="11" ${line} fill="${PAPER}"/><path d="M21 33l6-18" stroke="${RED}" stroke-width="2.5" stroke-linecap="round"/>`,
  skate: `<path d="M10 10h12v12l14 4c4 1 6 4 6 7v1H10z" ${line}/><path d="M8 40h34" ${line}/><path d="M14 34v6M36 34v6" ${line}/><ellipse cx="44" cy="40" rx="3" ry="2" fill="${RED}"/>`,
  objects: `<path d="M18 8h8v6l4 4v22H14V18l4-4z" ${line}/><ellipse cx="38" cy="38" rx="6" ry="3.5" fill="${INK}"/>`,
  stick: `<path d="M38 4L18 34" ${line}/><path d="M18 34h-12" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><ellipse cx="14" cy="40" rx="7" ry="3.5" fill="${MUTE}" fill-opacity="0.55"/>`,
  lift: `<path d="M24 40V14M16 22l8-8 8 8" ${line}/><ellipse cx="24" cy="8" rx="7" ry="3.5" fill="${RED}"/>`,
  safety: `<path d="M24 5l15 6v11c0 10-7 17-15 21C16 39 9 32 9 22V11z" ${line}/><path d="M17 24l5 5 9-10" stroke="${RED}" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  eye: `<path d="M4 24c6-9 13-13 20-13s14 4 20 13c-6 9-13 13-20 13S10 33 4 24z" ${line}/><circle cx="24" cy="24" r="6" fill="${RED}"/>`,
};
export const icon = (name, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true">${ICONS[name] || ''}</svg>`;

/**
 * 카메라 옆모습 그림: 삼각대 위 카메라(1~1.5m) → 비스듬한 시야 → 바닥 위 플레이 영역 → 선수.
 * t: { height, min, tilt, area, you }
 */
export function cameraDiagram(t, label) {
  return `<svg class="art art-camera" viewBox="0 0 360 214" role="img" aria-label="${esc(label)}">
  <path d="M120 182L66 70 302 182z" fill="${RED}" fill-opacity="0.09"/>
  <path d="M66 70L120 182M66 70L302 182" fill="none" stroke="${RED}" stroke-width="1.6" stroke-dasharray="5 4"/>
  <path d="M8 182h344" stroke="${INK}" stroke-width="2"/>
  <path d="M120 182h182" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
  <ellipse cx="196" cy="178" rx="10" ry="4" fill="${INK}"/>
  <path d="M60 82v48M60 130l-14 52M60 130l14 52M60 130v52" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
  <rect x="50" y="62" width="22" height="16" rx="3" fill="${PAPER}" stroke="${INK}" stroke-width="2" transform="rotate(25 61 70)"/>
  <circle cx="66" cy="73" r="3" fill="${RED}"/>
  <path d="M24 70v112M18 70h12M18 182h12" stroke="${INK}" stroke-width="1.5"/>
  <text x="16" y="128" class="t-strong" text-anchor="middle" transform="rotate(-90 16 128)">${esc(t.height)}</text>
  <text x="34" y="200" class="t-small" text-anchor="start">${esc(t.min)}</text>
  <text x="142" y="167" class="t-red">${esc(t.tilt)}</text>
  <text x="211" y="204" class="t-strong" text-anchor="middle">${esc(t.area)}</text>
  <circle cx="330" cy="98" r="9" fill="none" stroke="${INK}" stroke-width="2"/>
  <path d="M330 107v38M330 145l-10 36M330 145l10 36M330 118l-14 14M330 118l6 14" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
  <path d="M316 132l-26 44h-14" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="330" y="80" class="t-small" text-anchor="middle">${esc(t.you)}</text>
</svg>`;
}

/**
 * 카메라 높이별 위치 오차 막대 그래프. rows: [[높이 글자, 오차(cm)|null, 실패 글자?, 추천?]], t: { unit, best, title }
 */
export function heightChart(rows, t) {
  const x0 = 64, wMax = 200, maxV = 12, rowH = 30, top = 10;
  const h = top + rows.length * rowH + 6;
  const parts = [];
  rows.forEach(([label, v, fail, best], i) => {
    const y = top + i * rowH;
    if (best) parts.push(`<rect x="2" y="${y}" width="356" height="${rowH - 4}" rx="8" fill="${RED}" fill-opacity="0.08"/>`);
    parts.push(`<text x="54" y="${y + 18}" class="t-strong" text-anchor="end">${esc(label)}</text>`);
    if (v != null) {
      const w = Math.max(6, Math.round((v / maxV) * wMax));
      parts.push(`<rect x="${x0}" y="${y + 6}" width="${w}" height="14" rx="4" fill="${best ? RED : INK}"/>`);
      parts.push(`<text x="${x0 + w + 8}" y="${y + 18}" class="t-num">${v}${esc(t.unit)}</text>`);
      if (best) parts.push(`<text x="350" y="${y + 18}" class="t-red" text-anchor="end">${esc(t.best)}</text>`);
    } else {
      parts.push(`<path d="M${x0} ${y + 13}h${wMax}" stroke="${RED}" stroke-width="2" stroke-dasharray="4 5"/>`);
      const tw = [...fail].reduce((w, ch) => w + (/[ㄱ-힣]/.test(ch) ? 12.5 : 6.8), 26); // 글자 폭 어림 (한글은 넓게)
      parts.push(`<rect x="${x0 + 4}" y="${y + 3}" width="${Math.min(260, Math.round(tw))}" height="20" rx="10" fill="${PAPER}"/>`);
      parts.push(`<text x="${x0 + 12}" y="${y + 18}" class="t-red">✕ ${esc(fail)}</text>`);
    }
  });
  return `<svg class="art art-chart" viewBox="0 0 360 ${h}" role="img" aria-label="${esc(t.title)}">${parts.join('')}</svg>`;
}

/** 퍽 색 견본: floor 'light'|'dark', puck 'black'|'orange'|'white'|'twotone'|'rainbow', ok */
export function puckSwatch({ floor, puck, ok }) {
  const fl = floor === 'dark' ? '#30343c' : '#ECEAE4';
  const disc = (fill, extra = '') => `<ellipse cx="60" cy="52" rx="24" ry="11" fill="${fill}"${extra}/><path d="M36 46v6c0 6 11 11 24 11s24-5 24-11v-6" fill="${fill}"${extra}/><ellipse cx="60" cy="46" rx="24" ry="11" fill="${fill}"${extra}/>`;
  let p = '';
  if (puck === 'black') p = disc('#16181d');
  else if (puck === 'orange') p = disc('#f97316');
  else if (puck === 'white') p = disc('#F8F6F1', ` stroke="#d9d5cb" stroke-width="1"`);
  else if (puck === 'twotone') p = disc('#16181d') + `<ellipse cx="60" cy="46" rx="14" ry="6.5" fill="#F8F6F1"/>`;
  else if (puck === 'rainbow') {
    const cols = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7'];
    p = cols.map((c, k) => { const a0 = (k / 6) * Math.PI * 2, a1 = ((k + 1) / 6) * Math.PI * 2, r = 19;
      return `<path d="M60 46L${(60 + r * Math.cos(a0)).toFixed(1)} ${(46 + r * Math.sin(a0)).toFixed(1)}A${r} ${r} 0 0 1 ${(60 + r * Math.cos(a1)).toFixed(1)} ${(46 + r * Math.sin(a1)).toFixed(1)}z" fill="${c}"/>`; }).join('');
  }
  const badge = ok
    ? `<circle cx="102" cy="16" r="11" fill="${INK}"/><path d="M96 16l4 4 7-8" fill="none" stroke="${PAPER}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<circle cx="102" cy="16" r="11" fill="${RED}"/><path d="M97 11l10 10M107 11l-10 10" stroke="${PAPER}" stroke-width="2.4" stroke-linecap="round"/>`;
  return `<svg class="art art-swatch" viewBox="0 0 120 80" aria-hidden="true"><rect x="2" y="2" width="116" height="76" rx="12" fill="${fl}" stroke="${INK}" stroke-width="1.5"/>${p}${badge}</svg>`;
}

export const PALETTE = { INK, RED, PAPER, PAPER2, MUTE };
