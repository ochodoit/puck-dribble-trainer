// 내 정보: 출석·최근 기록·누적 훈련 통계 (계정에 저장하는 활동 기록). 화면 없는 순수 계산만.
// 활동 기록 한 사람당 하나:
//   { uid, days: { 'YYYY-MM-DD': { n: 판 수, s: 훈련 초 } }, totals: { games, sec, dist(m), touches, modes: { 모드 id: 판 수 } },
//     recent: { 랭킹 키: [{ s: 점수, at: ms }, … 최근 RECENT_MAX 판] }, updatedAt }
// 출석 = 그날 로그인한 채로 플레이 화면을 연 날 (days 에 그날 키가 있음)

export const RECENT_MAX = 10;     // 게임별 최근 기록 개수
export const DAYS_MAX = 3650;     // 출석 기록은 최근 10년까지만 남김
export const RECENT_KEYS_MAX = 40; // 최근 기록을 남기는 게임(랭킹 키) 수 상한
const MODE_RE = /^[a-z0-9]{2,16}$/;  // totals.modes 의 모드 id

/** 이 기기 시간대 기준 날짜 키: 'YYYY-MM-DD' */
export function dayKey(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const num = (v, def = 0) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : def);

export function emptyActivity(uid) {
  return { uid, days: {}, totals: { games: 0, sec: 0, dist: 0, touches: 0, modes: {} }, recent: {}, updatedAt: 0 };
}

/** 저장된 값을 믿지 않고 모양을 맞춘다 (빠진 칸은 0, 이상한 값은 버림) */
export function cleanActivity(raw, uid) {
  const a = emptyActivity(uid);
  if (!raw || typeof raw !== 'object') return a;
  for (const [k, v] of Object.entries(raw.days || {})) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k) && v && typeof v === 'object') a.days[k] = { n: Math.floor(num(v.n)), s: Math.round(num(v.s)) };
  }
  const t = raw.totals || {};
  a.totals = { games: Math.floor(num(t.games)), sec: Math.round(num(t.sec)), dist: num(t.dist), touches: Math.floor(num(t.touches)), modes: {} };
  for (const [k, v] of Object.entries(t.modes && typeof t.modes === 'object' ? t.modes : {}).slice(0, 20)) if (MODE_RE.test(k) && num(v) > 0) a.totals.modes[k] = Math.floor(num(v));
  for (const [k, list] of Object.entries(raw.recent || {})) {
    if (!/^[a-z0-9@-]{2,32}$/.test(k) || !Array.isArray(list)) continue;
    const rows = list.filter((r) => r && Number.isFinite(r.s) && Number.isFinite(r.at)).map((r) => ({ s: r.s, at: r.at })).slice(-RECENT_MAX);
    if (rows.length) a.recent[k] = rows;
  }
  a.updatedAt = num(raw.updatedAt);
  return a;
}

/**
 * 활동 하나를 더한 새 기록. entry = null 이면 출석만 (그날을 표시).
 * entry: { key: 랭킹 키 | null(점수 없는 연습·중간에 멈춤), score, sec, dist(m), touches, mode: 모드 id(게임별 판 수) }
 */
export function addActivity(act, entry = null, now = Date.now()) {
  const a = cleanActivity(act, act?.uid);
  const day = dayKey(now);
  const d = a.days[day] || (a.days[day] = { n: 0, s: 0 });
  if (entry) {
    const sec = Math.round(num(entry.sec));
    d.n += 1; d.s += sec;
    a.totals.games += 1; a.totals.sec += sec;
    a.totals.dist = Math.round((a.totals.dist + num(entry.dist)) * 10) / 10;
    a.totals.touches += Math.floor(num(entry.touches));
    if (MODE_RE.test(String(entry.mode || ''))) a.totals.modes[entry.mode] = (a.totals.modes[entry.mode] || 0) + 1;
    if (entry.key && Number.isFinite(entry.score)) {
      const list = a.recent[entry.key] || (a.recent[entry.key] = []);
      list.push({ s: entry.score, at: now });
      if (list.length > RECENT_MAX) list.splice(0, list.length - RECENT_MAX);
      const keys = Object.keys(a.recent);
      if (keys.length > RECENT_KEYS_MAX) { // 가장 오래 안 한 게임부터 정리
        keys.sort((x, y) => a.recent[x].at(-1).at - a.recent[y].at(-1).at).slice(0, keys.length - RECENT_KEYS_MAX).forEach((k) => delete a.recent[k]);
      }
    }
  }
  const dayKeys = Object.keys(a.days);
  if (dayKeys.length > DAYS_MAX) dayKeys.sort().slice(0, dayKeys.length - DAYS_MAX).forEach((k) => delete a.days[k]);
  a.updatedAt = now;
  return a;
}

const prevDay = (key) => { const [y, m, d] = key.split('-').map(Number); return dayKey(new Date(y, m - 1, d - 1, 12).getTime()); };

/** 연속 출석: 오늘(아직 안 했으면 어제)부터 거꾸로 이어진 날 수 */
export function streak(days, today = dayKey()) {
  let k = days[today] ? today : prevDay(today);
  let n = 0;
  while (days[k]) { n++; k = prevDay(k); }
  return n;
}

/** 출석 요약: 연속, 이번 달, 전체 */
export function attendanceSummary(days, today = dayKey()) {
  const month = today.slice(0, 7);
  const keys = Object.keys(days);
  return { streak: streak(days, today), month: keys.filter((k) => k.startsWith(month)).length, total: keys.length };
}

/** 달력: year, month(1~12) -> 주별 칸 [[null|'YYYY-MM-DD' × 7], …] (일요일 시작) */
export function monthGrid(year, month) {
  const first = new Date(year, month - 1, 1).getDay();
  const days = new Date(year, month, 0).getDate();
  const cells = Array(first).fill(null);
  for (let d = 1; d <= days; d++) cells.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** 랭킹 키 -> { modeId, seconds, invisible }: 'arcade@180-inv' -> arcade, 180, true */
export function keyInfo(key) {
  const m = /^([a-z0-9]+)(?:@(\d+))?(-inv)?$/.exec(String(key));
  return m ? { modeId: m[1], seconds: m[2] ? Number(m[2]) : 0, invisible: !!m[3] } : { modeId: String(key), seconds: 0, invisible: false };
}

/** 최근 점수 -> 작은 그래프(SVG polyline 점들). 값이 하나면 가운데 점 하나 */
export function sparkPoints(values, w = 120, h = 28, pad = 3) {
  if (!values.length) return [];
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  return values.map((v, i) => [values.length > 1 ? pad + i * step : w / 2, hi === lo ? h / 2 : h - pad - ((v - lo) / span) * (h - pad * 2)]);
}

/** 초 -> { h, m } (훈련 시간 표시용) */
export function hoursMinutes(sec) { const m = Math.round(num(sec) / 60); return { h: Math.floor(m / 60), m: m % 60 }; }
