// 운영자 통계: 회원·출석·플레이를 한눈에 (회원 목록 + 활동 기록으로 계산). 화면 없는 순수 계산만.
// 계정이 없는 게스트의 플레이와 방문자 수는 여기서 셀 수 없다 -> Google 애널리틱스(analytics.js)에서 본다.
import { dayKey, cleanActivity } from './activity.js';
import { isBetaUser, AGE_GROUPS } from './account.js';

/** 오늘까지 최근 n일의 날짜 키 (오래된 날부터, 이 기기 시간대) */
export function lastDays(n, now = Date.now()) {
  const d = new Date(now), out = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - i, 12).getTime()));
  return out;
}

const joinDay = (u) => { const t = Number(u?.joinedAt || u?.createdAt); return Number.isFinite(t) && t > 0 ? dayKey(t) : null; };
const countBy = (keys) => { const m = new Map(); for (const k of keys) if (k != null && k !== '') m.set(k, (m.get(k) || 0) + 1); return m; };

/**
 * members: 회원 목록 (memberList), acts: 활동 기록 목록 (activityList).
 * 출석 = 그날 로그인한 채로 플레이 화면을 연 회원, 판 수 = 회원이 3초 넘게 한 판 (중간에 멈춘 판 포함).
 * days: 그래프에 쓸 최근 날 수
 */
export function memberStats(members = [], acts = [], now = Date.now(), days = 14) {
  const today = dayKey(now);
  const w7 = new Set(lastDays(7, now)), w30 = new Set(lastDays(30, now));
  const joins = members.map(joinDay), joinsBy = countBy(joins);
  const beta = members.filter(isBetaUser).length;
  const A = acts.map((a) => cleanActivity(a, a?.uid));
  const attended = (set) => A.filter((a) => Object.keys(a.days).some((k) => set.has(k))).length;
  const games = (set) => A.reduce((s, a) => s + Object.entries(a.days).reduce((t, [k, v]) => t + (set.has(k) ? v.n : 0), 0), 0);
  const modes = {};
  for (const a of A) for (const [m, n] of Object.entries(a.totals.modes)) modes[m] = (modes[m] || 0) + n;
  const ages = countBy(members.map((u) => u.ageGroup)), countries = countBy(members.map((u) => u.country));
  return {
    members: { total: members.length, beta, one: members.length - beta, today: joinsBy.get(today) || 0,
      d7: joins.filter((k) => w7.has(k)).length, d30: joins.filter((k) => w30.has(k)).length },
    attended: { today: attended(new Set([today])), d7: attended(w7), d30: attended(w30) },
    games: { total: A.reduce((s, a) => s + a.totals.games, 0), today: games(new Set([today])), d7: games(w7), d30: games(w30),
      sec: A.reduce((s, a) => s + a.totals.sec, 0) },
    daily: lastDays(days, now).map((k) => ({ day: k, joins: joinsBy.get(k) || 0, games: A.reduce((s, a) => s + (a.days[k]?.n || 0), 0), players: A.filter((a) => a.days[k]).length })),
    modes: Object.entries(modes).sort((x, y) => y[1] - x[1]),                 // [[모드 id, 판 수]] 많은 순
    ages: AGE_GROUPS.filter((g) => ages.get(g)).map((g) => [g, ages.get(g)]), // 연령대 순서대로
    countries: [...countries.entries()].sort((x, y) => y[1] - x[1]),          // [[국가 코드, 명]] 많은 순
  };
}
