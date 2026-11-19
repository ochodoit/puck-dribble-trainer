// 운영자 통계: 회원·출석·플레이를 한눈에 (회원 목록 + 활동 기록으로 계산). 화면 없는 순수 계산만.
// 계정이 없는 게스트의 플레이와 방문자 수는 여기서 셀 수 없다 -> Google 애널리틱스(analytics.js)에서 본다.
import { dayKey, cleanActivity, attendanceSummary } from './activity.js';
import { isBetaUser, AGE_GROUPS, betaState, toMs } from './account.js';

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
  const beta = members.filter(isBetaUser).length, invite = members.filter((u) => u.via === 'invite').length;
  const A = acts.map((a) => cleanActivity(a, a?.uid));
  const attended = (set) => A.filter((a) => Object.keys(a.days).some((k) => set.has(k))).length;
  const games = (set) => A.reduce((s, a) => s + Object.entries(a.days).reduce((t, [k, v]) => t + (set.has(k) ? v.n : 0), 0), 0);
  const modes = {};
  for (const a of A) for (const [m, n] of Object.entries(a.totals.modes)) modes[m] = (modes[m] || 0) + n;
  const ages = countBy(members.map((u) => u.ageGroup)), countries = countBy(members.map((u) => u.country));
  return {
    members: { total: members.length, beta, invite, one: members.length - beta - invite, today: joinsBy.get(today) || 0,
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

// ---------- 운영자: 회원 현황 (회원 한 명씩) ----------
// 출석률 = 출석한 날 / 가입한 날부터 오늘까지의 날 수 (가입일·오늘 포함). 최근 30일 출석률은 가입이 30일이 안 됐으면 가입 후 날 수로 나눈다.
const DAY = 864e5;
/** 날짜 키 -> 그날 낮 12시 (날 수 세기용, 시간대·서머타임에 흔들리지 않게) */
const noonOf = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 12).getTime(); };
/** 날짜 키 a 부터 b 까지 날 수 (둘 다 포함) */
export const daysBetween = (a, b) => Math.round((noonOf(b) - noonOf(a)) / DAY) + 1;
const pct = (n, d) => (d > 0 ? Math.round((100 * n) / d) : 0);

/**
 * 정회원 이용 기간 (남은 일수). 정회원인 동안 = 베타 종료일 전, 또는 이용권 기한(until) 전 (규칙과 같음).
 * { kind, end(ms, 이 순간부터 끝), lastDay(마지막으로 쓸 수 있는 날 키), left(오늘 뒤로 남은 날: 0 = 오늘까지) }
 *  kind: 'forever'(운영자 유지, 기한 없음) | 'open'(베타 종료일을 아직 안 정함) | 'until'(기한 있음) | 'ended'(끝남)
 */
export function accessInfo(u, betaEndsAt = null, now = Date.now()) {
  if (u?.kept) return { kind: 'forever', end: null, lastDay: null, left: null };
  const beta = toMs(betaEndsAt), until = toMs(u?.until);
  if (beta == null) return { kind: 'open', end: null, lastDay: null, left: null };
  const end = Math.max(beta, until ?? -Infinity);
  if (now >= end) return { kind: 'ended', end, lastDay: dayKey(end - 1), left: -1 };
  const lastDay = dayKey(end - 1);
  return { kind: 'until', end, lastDay, left: daysBetween(dayKey(now), lastDay) - 1 };
}

/** 달력에서 고른 날(YYYY-MM-DD)까지 쓸 수 있게 하는 기한: 그날 23:59:59.999 (이 기기 시간대, 베타 종료일과 같은 방식) */
export function untilOfDay(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

/**
 * 이용 기간 연장 계획: 고른 회원들을 key 날까지로 늘린다. 줄이지는 않는다.
 * { until, apply(늘어나는 회원 줄), later(이미 그날 이후까지라 그대로), kept(유지 회원이라 기한 없음) }
 */
export function extendPlan(rows = [], key, betaEndsAt = null, now = Date.now()) {
  const until = untilOfDay(key), out = { until, apply: [], later: [], kept: [] };
  for (const r of rows) {
    const a = accessInfo(r.u, betaEndsAt, now);
    if (a.kind === 'forever') out.kept.push(r);
    else if (a.end != null && a.end >= until) out.later.push(r);
    else out.apply.push(r);
  }
  return out;
}

/** 회원 상태 (거르기용): 정회원 등급(beta·kept·coupon·lapsed)에 더해 임시 비밀번호·아이디 없음(예전 계정) */
export const MEMBER_STATES = ['beta', 'kept', 'coupon', 'lapsed', 'temp', 'noid'];
/** 활동 (거르기용): 오늘 출석 · 7일 안 · 30일 안 · 30일 넘게 안 옴 · 한 번도 안 옴 */
export const ACTIVITY_KINDS = ['today', 'd7', 'd30', 'idle', 'never'];

/**
 * 회원 한 명의 한 줄 요약 (회원 목록 memberList 의 u + 활동 기록 act).
 * { u, id, state, since(가입 후 날 수), days(출석일), rate(가입 후 출석률 %), att30, span30, rate30, lastDay, idle(마지막 출석 뒤 지난 날, 없으면 null),
 *   activity(ACTIVITY_KINDS 중 하나), games, sec, games7, sec7, team(소문자, 거르기용), access(accessInfo: 남은 일수) }
 */
export function memberRow(u, act, now = Date.now(), betaEndsAt = null) {
  const a = cleanActivity(act, u.id), today = dayKey(now);
  const keys = Object.keys(a.days).filter((k) => k <= today).sort();
  const joined = Number(u.joinedAt || u.createdAt);
  // 가입일과 첫 출석일 중 이른 날부터 센다 (가입일을 모르는 예전 계정은 첫 출석일부터. 출석률이 100%를 넘지 않게)
  const joinKey = Number.isFinite(joined) && joined > 0 ? dayKey(joined) : null;
  const start = [joinKey, keys[0]].filter(Boolean).sort()[0] || today;
  const since = Math.max(1, daysBetween(start <= today ? start : today, today));
  const w30 = new Set(lastDays(30, now)), w7 = new Set(lastDays(7, now));
  const att30 = keys.filter((k) => w30.has(k)).length, span30 = Math.min(30, since);
  const lastDay = keys.length ? keys[keys.length - 1] : null;
  const idle = lastDay ? daysBetween(lastDay, today) - 1 : null;
  const activity = idle == null ? 'never' : idle === 0 ? 'today' : idle < 7 ? 'd7' : idle < 30 ? 'd30' : 'idle';
  const sum = (set, f) => keys.reduce((t, k) => t + (set.has(k) ? a.days[k][f] : 0), 0);
  return {
    u, id: u.id, state: betaState(u, betaEndsAt, now), since, days: keys.length, rate: pct(keys.length, since),
    att30, span30, rate30: pct(att30, span30), lastDay, idle, activity,
    games: a.totals.games, sec: a.totals.sec, games7: sum(w7, 'n'), sec7: sum(w7, 's'),
    team: String(u.team || '').trim().toLowerCase(), access: accessInfo(u, betaEndsAt, now),
  };
}

/** 모든 회원의 한 줄 요약 (활동 기록이 없는 회원도 빠짐없이) */
export function memberRows(members = [], acts = [], now = Date.now(), betaEndsAt = null) {
  const byUid = new Map(acts.map((a) => [a?.uid, a]));
  return members.map((u) => memberRow(u, byUid.get(u.id), now, betaEndsAt));
}

/** 팀 목록 (대소문자가 달라도 한 팀): [[소문자 키, 보이는 이름, 명]] 많은 순 */
export function teamsOf(members = []) {
  const m = new Map();
  for (const u of members) {
    const name = String(u.team || '').trim();
    if (!name) continue;
    const k = name.toLowerCase(), e = m.get(k);
    if (e) e[2] += 1; else m.set(k, [k, name, 1]);
  }
  return [...m.values()].sort((x, y) => y[2] - x[2] || x[1].localeCompare(y[1]));
}

/**
 * 상태 거르기: 유지(kept)·이용권(until 이 남음)은 베타 기간 중에도 그 표시가 있는 회원,
 * 베타 기간·종료는 지금의 정회원 등급, 임시 비밀번호·아이디 없음은 계정 상태
 */
export function stateMatch(r, state, now = Date.now()) {
  const u = r.u, until = Number(u.until);
  if (state === 'kept') return !!u.kept;
  if (state === 'coupon') return Number.isFinite(until) && until > now;
  if (state === 'temp') return !!u.tempPw;
  if (state === 'noid') return !u.loginId;
  return r.state === state;
}

/**
 * 거르기. f: { q(별명·아이디·팀 글자), team(소문자 키), ageGroup, country, state(MEMBER_STATES), activity(ACTIVITY_KINDS), via('beta'|'invite'|'one'|'old') }.
 * 빈 칸은 거르지 않는다
 */
export function filterMembers(rows = [], f = {}) {
  const q = String(f.q || '').trim().toLowerCase();
  const via = (u) => (!u.code ? 'old' : u.via === 'beta' || u.beta ? 'beta' : u.via === 'invite' ? 'invite' : 'one');
  return rows.filter((r) => {
    const u = r.u;
    if (q && ![u.nick, u.loginId, u.team].some((v) => String(v || '').toLowerCase().includes(q))) return false;
    if (f.team && r.team !== f.team) return false;
    if (f.ageGroup && u.ageGroup !== f.ageGroup) return false;
    if (f.country && u.country !== f.country) return false;
    if (f.state && !stateMatch(r, f.state)) return false;
    if (f.activity === 'd7') { if (!['today', 'd7'].includes(r.activity)) return false; } // 7일 안 = 오늘 포함
    else if (f.activity === 'd30') { if (!['today', 'd7', 'd30'].includes(r.activity)) return false; }
    else if (f.activity && r.activity !== f.activity) return false;
    if (f.via && via(u) !== f.via) return false;
    return true;
  });
}

/** 정렬: 'no'(가입 번호) · 'left'(남은 일수 적은 순: 끝남 → 곧 끝남 → 미정 → 무기한) · 'recent'(최근 출석) · 'games'(판 수) · 'time'(훈련 시간) · 'rate'(30일 출석률) · 'nick' */
export function sortMembers(rows = [], by = 'no') {
  const no = (r) => r.u.memberNo ?? 1e9;
  const left = (r) => (r.access?.left ?? (r.access?.kind === 'open' ? 1e8 : 1e9));
  const cmp = {
    no: (a, b) => no(a) - no(b),
    left: (a, b) => left(a) - left(b) || no(a) - no(b),
    recent: (a, b) => (b.lastDay || '').localeCompare(a.lastDay || '') || no(a) - no(b),
    games: (a, b) => b.games - a.games || no(a) - no(b),
    time: (a, b) => b.sec - a.sec || no(a) - no(b),
    rate: (a, b) => b.rate30 - a.rate30 || b.att30 - a.att30 || no(a) - no(b),
    nick: (a, b) => String(a.u.nick).localeCompare(String(b.u.nick)),
  }[by] || ((a, b) => no(a) - no(b));
  return [...rows].sort(cmp);
}

/** 거른 회원들의 합계: { n, today, d7, rate30(평균 %), games, sec } */
export function membersSummary(rows = []) {
  const n = rows.length;
  return {
    n, today: rows.filter((r) => r.activity === 'today').length, d7: rows.filter((r) => ['today', 'd7'].includes(r.activity)).length,
    rate30: n ? Math.round(rows.reduce((t, r) => t + r.rate30, 0) / n) : 0,
    games: rows.reduce((t, r) => t + r.games, 0), sec: rows.reduce((t, r) => t + r.sec, 0),
  };
}

/**
 * 회원 한 명의 기록 한눈에 (운영자 회원 기록 창): memberRow 에 더해
 * att(연속·이번 달·전체 출석), firstDay, playDays(판을 한 날), secPerDay(판을 한 날 평균 훈련 초), gamesPerDay,
 * daily(최근 days 일 { day, n, s }), modes([[모드 id, 판 수]] 많은 순)
 */
export function memberDetail(u, act, now = Date.now(), betaEndsAt = null, days = 28) {
  const row = memberRow(u, act, now, betaEndsAt), a = cleanActivity(act, u.id);
  const keys = Object.keys(a.days).sort(), play = keys.filter((k) => a.days[k].n > 0);
  return {
    ...row, att: attendanceSummary(a.days, dayKey(now)), firstDay: keys[0] || null, playDays: play.length,
    secPerDay: play.length ? Math.round(play.reduce((t, k) => t + a.days[k].s, 0) / play.length) : 0,
    gamesPerDay: play.length ? Math.round((10 * play.reduce((t, k) => t + a.days[k].n, 0)) / play.length) / 10 : 0,
    daily: lastDays(days, now).map((k) => ({ day: k, n: a.days[k]?.n || 0, s: a.days[k]?.s || 0, on: !!a.days[k] })),
    modes: Object.entries(a.totals.modes).sort((x, y) => y[1] - x[1]),
    totals: a.totals, recent: a.recent, rawDays: a.days,
  };
}
