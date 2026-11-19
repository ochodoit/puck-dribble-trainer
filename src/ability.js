// 능력치 (육각형): 게임 6개 = 능력 6개. 화면 없는 순수 계산만 (그리기는 ability-ui.js).
//  - 능력치 = 이 달 내 최고 기록 ÷ 같은 나이대 1등 기록 × 100 (0~100). 나이대 기록이 ABILITY_MIN_GROUP 개보다 적으면 전체 1등 기준
//  - 기준 기록 = 보통 난이도·일반(투명 아님) 랭킹 키. 시간제 게임(1·3·5분)은 그 나이대 기록이 가장 많은 시간을 쓴다
//  - 이 달 기록이 없는 게임은 그 전 가장 가까운 달 기록을 이어서 보여 준다 (carried)
//  - 비교선 = 같은 기준의 상위 10% 기록 (기록 수 × 0.1 번째, 올림)
import { dayKey, keyInfo } from './activity.js';

/** 육각형 꼭짓점 순서 (위에서부터 시계 방향). key = 기록이 없을 때 기준을 볼 기본 랭킹 키 */
export const ABILITIES = [
  { id: 'speed', name: '스피드', mode: 'quick', key: 'quick' },
  { id: 'react', name: '반응', mode: 'reaction', key: 'reaction' },
  { id: 'control', name: '컨트롤', mode: 'figure8', key: 'figure8' },
  { id: 'wide', name: '와이드', mode: 'wide', key: 'wide@60' },
  { id: 'vision', name: '시야', mode: 'obstacle', key: 'obstacle@60' },
  { id: 'sense', name: '센스', mode: 'arcade', key: 'arcade@60' },
];
export const ABILITY_MIN_GROUP = 5;
export const TOP_SHARE = 0.1;

export const monthKey = (ms = Date.now()) => dayKey(ms).slice(0, 7);
export function prevMonthKey(mk) {
  const [y, m] = mk.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** 능력치에 쓰는 기록인지: 그 게임의 보통 난이도·일반 모드 */
export function isStatKey(key, modeId) {
  const k = keyInfo(key);
  return k.modeId === modeId && k.level === 'normal' && !k.invisible;
}

/**
 * 월별 게임별 최고 점수 { 'YYYY-MM': { 랭킹 키: 점수 } }.
 * 저장해 둔 월별 기록(totals.months) + 최근 10판(recent) + 최고 기록 문서(best: [{ mode, score, at }])를 합친다
 * (월별 기록을 쌓기 전의 달도 남아 있는 만큼 채워진다)
 */
export function monthBests(act, best = []) {
  const out = {};
  const put = (mk, key, s) => {
    if (!Number.isFinite(s)) return;
    const m = out[mk] || (out[mk] = {});
    if (!(key in m) || s > m[key]) m[key] = s;
  };
  for (const [mk, keys] of Object.entries(act?.totals?.months || {})) for (const [k, s] of Object.entries(keys || {})) put(mk, k, s);
  for (const [k, list] of Object.entries(act?.recent || {})) for (const r of list || []) if (Number.isFinite(r?.at)) put(monthKey(r.at), k, r.s);
  for (const b of best || []) if (b && Number.isFinite(b.at)) put(monthKey(b.at), b.mode, b.score);
  return out;
}

/** 이 달의 이 게임 기록 { mk, scores, carried }. 없으면 그 전 가장 가까운 달 (carried = true). 아무 기록도 없으면 null */
function monthScores(months, mk, modeId) {
  const pick = (m) => Object.fromEntries(Object.entries(months[m] || {}).filter(([k]) => isStatKey(k, modeId)));
  for (const m of [mk, ...Object.keys(months).filter((x) => x < mk).sort().reverse()]) {
    const scores = pick(m);
    if (Object.keys(scores).length) return { mk: m, scores, carried: m !== mk };
  }
  return null;
}

/** 기준(나이대 1등·상위 10%)을 불러와야 하는 랭킹 키 */
export function abilityKeys(months, now = Date.now()) {
  const cur = monthKey(now), prev = prevMonthKey(cur), keys = new Set();
  for (const ab of ABILITIES) {
    const a = monthScores(months, cur, ab.mode), b = monthScores(months, prev, ab.mode);
    if (!a) keys.add(ab.key);
    for (const x of [a, b]) if (x) Object.keys(x.scores).forEach((k) => keys.add(k));
  }
  return [...keys];
}

/** 점수 높은 순 기록들 -> 기준 { scope, total, top, top10 } (total = 전체 기록 수. 받은 기록은 위에서부터 일부일 수 있음) */
export function refOf(sortedScores, total = sortedScores.length, scope = 'group') {
  if (!sortedScores.length || !total) return null;
  const n = Math.max(1, Math.ceil(total * TOP_SHARE));
  return { scope, total, top: sortedScores[0], top10: sortedScores[Math.min(n, sortedScores.length) - 1] };
}

/** 점수 -> 능력치 (기준 1등 = 100) */
export function statOf(score, ref) {
  if (!ref || !(ref.top > 0) || !Number.isFinite(score)) return null;
  return Math.max(0, Math.min(100, Math.round((100 * score) / ref.top)));
}

const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/**
 * 능력치 계산. refs: { 랭킹 키: { scope, total, top, top10 } | null }
 * 반환: { month, prevMonth, list: [{ id, name, mode, key, value, prev, delta, top10, score, carried, scope, total }],
 *         ovr(이번 달 종합), delta(지난달과 둘 다 있는 능력의 평균 변화), top10Ovr(상위 10% 종합), weakest }
 */
export function computeAbilities(months, refs, now = Date.now()) {
  const cur = monthKey(now), prev = prevMonthKey(cur);
  // 고를 기준: 그 묶음 기록이 가장 많은 키, 같으면 짧은 시간
  const choose = (scores) => Object.keys(scores).filter((k) => refs[k]?.top > 0)
    .sort((a, b) => (refs[b].total - refs[a].total) || (keyInfo(a).seconds - keyInfo(b).seconds))[0] || null;
  const list = ABILITIES.map((ab) => {
    const a = monthScores(months, cur, ab.mode), b = monthScores(months, prev, ab.mode);
    const key = a ? choose(a.scores) : null;
    const ref = refs[key || ab.key] || null;
    const value = key ? statOf(a.scores[key], ref) : null;
    let p = null;
    if (b) { const kb = key && key in b.scores ? key : choose(b.scores); p = kb ? statOf(b.scores[kb], refs[kb]) : null; }
    return {
      // 이번 달 기록이 없어 지난달 기록을 이어 보여 주는 중이면 변화는 없음 (같은 기록끼리 비교)
      ...ab, key: key || ab.key, value, prev: p, delta: value != null && p != null && !(a.carried && a.mk === b?.mk) ? value - p : null,
      top10: ref ? statOf(ref.top10, ref) : null, score: key ? a.scores[key] : null, carried: !!(key && a.carried),
      scope: ref?.scope || null, total: ref?.total || 0,
    };
  });
  const played = list.filter((x) => x.value != null);
  const both = list.filter((x) => x.delta != null);
  const weakest = list.find((x) => x.value == null) || played.slice().sort((x, y) => x.value - y.value)[0] || null;
  return {
    month: cur, prevMonth: prev, list,
    ovr: avg(played.map((x) => x.value)),
    prevOvr: avg(list.filter((x) => x.prev != null).map((x) => x.prev)),
    delta: both.length ? avg(both.map((x) => x.delta)) : null,
    top10Ovr: avg(list.filter((x) => x.top10 != null).map((x) => x.top10)),
    weakest,
  };
}

/**
 * 능력치 불러오기 (기준 읽기 + 계산 + 나이대 안 내 위치). store: abilityRef(key, ageGroup)·abilityRank(key, score, ageGroup, scope) 가 있는 계정 저장소.
 * best = 게임별 최고 기록 [{ mode, score, at }] (내 위치는 최고 기록으로: 랭킹과 같은 값)
 */
export async function loadAbilities(store, { act, best = [], ageGroup = null, now = Date.now() }) {
  const months = monthBests(act, best);
  const refs = {};
  await Promise.all(abilityKeys(months, now).map(async (k) => { try { refs[k] = await store.abilityRef(k, ageGroup); } catch { refs[k] = null; } }));
  const res = computeAbilities(months, refs, now);
  await Promise.all(res.list.map(async (x) => {
    const b = (best || []).find((r) => r.mode === x.key), ref = refs[x.key];
    if (!b || !ref || x.value == null) return;
    try {
      const rank = await store.abilityRank(x.key, b.score, ageGroup, ref.scope);
      x.rank = rank; x.of = Math.max(ref.total, rank);
      x.pct = Math.max(1, Math.round((rank / x.of) * 100));
    } catch { /* 위치 없이 보여 줌 */ }
  }));
  return res;
}
