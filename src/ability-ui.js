// 능력치 카드 그리기 (육각형 + 종합 + 능력별 표). 내 정보와 운영자 회원 기록 창이 같이 쓴다. 계산은 ability.js.
//  - 빨강 채움 = 이번 달, 잉크 점선 = 지난달, 종이색 면 = 같은 나이대 상위 10%
import { loadAbilities } from './ability.js';

const CX = 170, CY = 150, R = 104;
const ang = (i) => ((i * 60 - 90) * Math.PI) / 180;
const at = (i, v) => { const r = (R * Math.max(0, Math.min(100, v || 0))) / 100; return [CX + r * Math.cos(ang(i)), CY + r * Math.sin(ang(i))]; };
const poly = (vals) => vals.map((v, i) => at(i, v).map((n) => n.toFixed(1)).join(',')).join(' ');

function hexSvg(res) {
  const L = res.list;
  const rings = [25, 50, 75, 100].map((v) => `<polygon class="ab-ring${v === 100 ? ' out' : ''}" points="${poly(L.map(() => v))}" />`).join('');
  const axes = L.map((_, i) => { const [x, y] = at(i, 100); return `<line class="ab-axis" x1="${CX}" y1="${CY}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" />`; }).join('');
  const top = L.some((x) => x.top10 != null) ? `<polygon class="ab-top" points="${poly(L.map((x) => x.top10))}" />` : '';
  const prev = L.some((x) => x.prev != null) ? `<polygon class="ab-prev" points="${poly(L.map((x) => x.prev))}" />` : '';
  const cur = L.some((x) => x.value != null) ? `<polygon class="ab-cur" points="${poly(L.map((x) => x.value))}" />` : '';
  const dots = L.map((x, i) => { if (x.value == null) return ''; const [px, py] = at(i, x.value); return `<circle class="ab-dot" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.6" />`; }).join('');
  const labels = L.map((x, i) => {
    const [lx, ly] = at(i, 122), c = Math.cos(ang(i));
    const anchor = c > 0.2 ? 'start' : c < -0.2 ? 'end' : 'middle';
    const y = i === 0 ? ly - 4 : i === 3 ? ly + 12 : ly + 4;
    return `<text x="${lx.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}"><tspan class="ab-n">${x.name}</tspan> <tspan class="ab-v${x.value == null ? ' none' : ''}">${x.value == null ? '-' : x.value}</tspan></text>`;
  }).join('');
  return `<svg class="ab-hex" viewBox="0 0 340 300" role="img" aria-label="능력치 육각형">${rings}${axes}${top}${prev}${cur}${dots}${labels}</svg>`;
}

/** 종합 변화: 처음이면 '이번 달 첫 능력치', 같으면 '지난달과 같아요' */
function deltaHtml(d) {
  if (d == null) return '<p class="ab-delta muted">이번 달 첫 능력치</p>';
  if (!d) return '<p class="ab-delta">지난달과 같아요</p>';
  const n = d > 0 ? `+${d}` : `−${-d}`;
  return `<p class="ab-delta">지난달보다 ${n}</p>`;
}

/** 능력치 카드 HTML. opts: { esc, gameName(modeId), ageGroup } */
export function abilityHtml(res, { esc, gameName, ageGroup }) {
  const L = res.list, group = ageGroup || '나이대';
  const legend = `<div class="ab-legend"><span><i class="sw cur"></i>이번 달</span>${L.some((x) => x.prev != null) ? '<span><i class="sw prev"></i>지난달</span>' : ''}<span><i class="sw top"></i>${esc(group)} 상위 10%</span></div>`;
  const sign = (d) => (d > 0 ? `<span class="ab-up">+${d}</span>` : d < 0 ? `<span class="ab-down">−${-d}</span>` : '<span class="muted">0</span>');
  const rows = L.map((x) => {
    // 내 위치: 기록이 적으면(20개 미만) 순위로, 많으면 상위 %로
    const who = x.scope === 'all' ? '전체' : esc(group);
    const where = !x.rank ? '-' : x.of < 20 ? `${who} ${x.rank}위 / ${x.of}명` : `${who} 상위 ${x.pct}%`;
    const val = x.value == null ? '<span class="muted">-</span>' : `${x.value}${x.carried ? ' <small class="muted">지난 기록</small>' : ''}`;
    return `<tr><td><b>${x.name}</b></td><td class="muted">${esc(gameName(x.mode))}</td><td class="num">${val}</td><td class="num">${x.delta == null ? '<span class="muted">-</span>' : sign(x.delta)}</td><td>${where}</td></tr>`;
  }).join('');
  const played = L.some((x) => x.value != null);
  const head = played
    ? `<div class="ab-ovr"><b>${res.ovr}</b><span>종합</span></div>`
      + deltaHtml(res.delta)
      + (res.top10Ovr != null ? `<p class="muted ab-sub">${esc(group)} 상위 10% 종합 ${res.top10Ovr}</p>` : '')
    : '<p class="muted">게임을 끝까지 하면 능력치가 생겨요. 게임 6개가 능력 6개예요</p>';
  const w = res.weakest;
  const hint = !w ? '' : w.value == null
    ? `<p class="ab-hint">아직 안 한 능력: ${w.name} · 추천 게임: ${esc(gameName(w.mode))}</p>`
    : `<p class="ab-hint">가장 약한 능력: ${w.name} · 추천 게임: ${esc(gameName(w.mode))}</p>`;
  const note = L.some((x) => x.scope === 'all') ? '<p class="muted ab-note">나이대 기록이 5개보다 적은 게임은 전체 1등을 100으로 봅니다</p>' : '';
  return `<div class="ab-card"><div class="ab-fig">${hexSvg(res)}${legend}</div>`
    + `<div class="ab-side">${head}<table class="ab-table"><thead><tr><th>능력</th><th>게임</th><th class="num">능력치</th><th class="num">지난달 대비</th><th>위치</th></tr></thead><tbody>${rows}</tbody></table>${hint}${note}</div></div>`
    + '<p class="muted ab-note">능력치 = 이번 달 내 최고 기록 ÷ 같은 나이대 1등 기록 × 100 (보통 난이도·일반 모드)</p>';
}

/** 불러와서 그리기. box: 그릴 칸. opts: { store, act, best, ageGroup, esc, tr, gameName } */
export async function renderAbility(box, { store, act, best, ageGroup, esc, tr, gameName }) {
  if (!box) return null;
  if (!store?.abilityRef) { box.innerHTML = ''; return null; }
  box.innerHTML = `<p class="muted">${esc(tr('불러오는 중…'))}</p>`;
  let res;
  try { res = await loadAbilities(store, { act, best, ageGroup }); } catch { box.innerHTML = '<p class="muted">능력치를 불러오지 못했습니다</p>'; return null; }
  box.innerHTML = abilityHtml(res, { esc, gameName, ageGroup });
  return res;
}
