// 계정·랭킹 저장소. 기본은 기기 내(localStorage) 저장, firebase-config.js 가 채워지면 온라인(Firestore) 저장소로 전환.
// 로그인: 아이디 + 비밀번호(8자 이상, 영문+숫자). 랭킹에 보이는 이름은 따로 정하는 별명. 프로필: 국가, 팀 이름, 나이(연령대 자동 계산).

import { cleanActivity, addActivity } from './activity.js';
import { refOf, ABILITY_MIN_GROUP } from './ability.js';

export const COUNTRIES = [
  ['KR', '🇰🇷 대한민국'], ['US', '🇺🇸 미국'], ['CA', '🇨🇦 캐나다'], ['JP', '🇯🇵 일본'], ['CN', '🇨🇳 중국'],
  ['SE', '🇸🇪 스웨덴'], ['FI', '🇫🇮 핀란드'], ['CZ', '🇨🇿 체코'], ['SK', '🇸🇰 슬로바키아'], ['RU', '🇷🇺 러시아'],
  ['DE', '🇩🇪 독일'], ['CH', '🇨🇭 스위스'], ['LV', '🇱🇻 라트비아'], ['NO', '🇳🇴 노르웨이'], ['DK', '🇩🇰 덴마크'],
  ['FR', '🇫🇷 프랑스'], ['GB', '🇬🇧 영국'], ['AU', '🇦🇺 호주'], ['KZ', '🇰🇿 카자흐스탄'], ['TW', '🇹🇼 대만'],
  ['TH', '🇹🇭 태국'], ['PH', '🇵🇭 필리핀'], ['SG', '🇸🇬 싱가포르'], ['HK', '🇭🇰 홍콩'], ['AE', '🇦🇪 UAE'], ['XX', '🏳️ 기타'],
];
export const countryLabel = (code) => (COUNTRIES.find(([c]) => c === code) || ['', code || '-'])[1];

// 하키 연령대 (만 나이 기준)
export const AGE_GROUPS = ['U8', 'U10', 'U12', 'U14', 'U16', 'U18', '성인', '시니어'];
export function ageGroupOf(age) {
  const a = Number(age);
  if (!Number.isFinite(a)) return '성인';
  if (a <= 7) return 'U8';
  if (a <= 9) return 'U10';
  if (a <= 11) return 'U12';
  if (a <= 13) return 'U14';
  if (a <= 15) return 'U16';
  if (a <= 17) return 'U18';
  if (a <= 39) return '성인';
  return '시니어';
}

export const NICK_RE = /^[\p{L}\p{N}_\-. ]{2,12}$/u;
/** 예전 계정의 비밀번호 (별명 + 숫자 6자리로 가입하던 때). 새 가입에는 쓰지 않는다 */
export const PIN_RE = /^\d{6}$/;

// ---------- 로그인 아이디 · 비밀번호 ----------
// 로그인은 아이디 + 비밀번호, 랭킹에 보이는 이름은 별명 (셋 다 따로). 별명은 공개되므로 로그인에 쓰지 않는다.
/** 아이디: 4~20자, 영문 소문자로 시작, 영문 소문자·숫자·_ (대문자로 넣어도 소문자로 바꿔 씀). firestore.rules 의 ids 와 같음 */
export const LOGIN_ID_RE = /^[a-z][a-z0-9_]{3,19}$/;
export const normLoginId = (s) => String(s ?? '').trim().toLowerCase();
export const PW_MIN = 8;
export function validateLoginId(id, nick = null) {
  const s = normLoginId(id);
  if (!LOGIN_ID_RE.test(s)) return '아이디는 4~20자 (영문 소문자로 시작, 영문·숫자·_)';
  if (nick != null && s === String(nick).trim().toLowerCase()) return '아이디는 별명과 다르게 정하세요 (별명은 랭킹에 공개됩니다)';
  return null;
}
/** 비밀번호: 8~64자, 영문과 숫자를 함께. 아이디·별명이 들어가면 안 됨 */
export function validatePassword(pw, { id = null, nick = null } = {}) {
  const s = String(pw ?? '');
  if (s.length < PW_MIN || s.length > 64) return '비밀번호는 8~64자';
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) return '비밀번호에 영문과 숫자를 함께 넣으세요';
  const low = s.toLowerCase(), lid = normLoginId(id), ln = String(nick ?? '').trim().toLowerCase();
  if ((lid && low.includes(lid)) || (ln.length >= 4 && low.includes(ln))) return '비밀번호에 아이디나 별명을 넣지 마세요';
  return null;
}
export const BAD_LOGIN_MSG = '아이디 또는 비밀번호가 맞지 않습니다';
export const USE_ID_MSG = '이제 아이디로 로그인하세요 (아이디를 잊었으면 운영자에게 문의하세요)';
export const ID_TAKEN = '이미 사용 중인 아이디입니다';
/** 운영자가 임시 비밀번호를 준 계정: 로그인한 뒤 새 비밀번호를 정해야 들어갈 수 있다 */
export const NEED_TEMP_MSG = '먼저 운영자에게 받은 임시 비밀번호로 로그인하세요';
export const SAME_PW_MSG = '지금(임시) 비밀번호와 다른 비밀번호를 정하세요';
/** 비밀번호를 바꾸려면 최근(Firebase 기준 약 5분 안)에 로그인했어야 한다. 오래된 로그인이면 내보내고 다시 로그인하게 한다 */
export const RELOGIN_MSG = '보안을 위해 한 번 더 로그인해 주세요. 로그인하고 바로(5분 안에) 이어서 정하면 됩니다';
/** 회원 비밀번호 검사: 8자 이상 영문+숫자, 운영자는 12자 이상도 함께 */
export function validateNewPassword(pw, { id = null, nick = null, admin = false } = {}) {
  return validatePassword(pw, { id, nick }) || (admin ? validateStrongPassword(pw) : null);
}
/** 운영자처럼 보이는 별명은 쓸 수 없음 (firestore.rules 의 validNick 과 같은 목록) */
export const RESERVED_NICK_RE = /(운영자|관리자|admin|official|퍽 ?트레이너|puck ?trainer)/i;
/** 운영자 비밀번호: 12~64자 (숫자만 써도 됨). 같은 글자 반복·1234567890 으로 시작하는 것은 안 됨 */
export const STRONG_PW_MIN = 12;
export function validateStrongPassword(pw) {
  const s = String(pw ?? '');
  if (s.length < STRONG_PW_MIN || s.length > 64) return '새 비밀번호는 12~64자';
  if (/^(.)\1*$/.test(s) || /^(0123456789|1234567890)/.test(s)) return '너무 쉬운 비밀번호입니다';
  return null;
}

/** 등번호(선택): 비어 있으면 null, 아니면 0~99 정수. 형식이 틀리면 NaN */
export function jerseyOf(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const s = String(v).trim();
  return /^\d{1,2}$/.test(s) ? Number(s) : NaN;
}
// 운영자(관리자): 운영자 화면, 카메라 없이 마우스로 플레이.
// 온라인 저장소는 Firestore admins/{uid} 문서로 정하고(콘솔에서 만듦), 기기 내 저장소는 아래 별명으로 정한다.
export const ADMIN_NICKS = ['test123'];
export const isAdmin = (user) => !!user?.admin;
/** 화면 표시용: '#87' (등번호가 없으면 빈 문자열) */
export const jerseyLabel = (n) => (Number.isInteger(n) ? `#${n}` : '');

// ---------- 가입 코드 · 정회원 ----------
// 정회원 = 가입 코드로 가입한 계정. 코드가 없으면 게스트로 플레이(랭킹·글쓰기 없음).
// 코드 종류: beta(오픈베타 링크, 여러 명·마감일·인원 상한), one(1회용, 운영자가 SNS 인증한 게스트에게 발급),
//           invite(정회원의 초대 코드: 한 사람당 하나, 3명까지, 추가 없음)
// 헷갈리는 글자(0/O, 1/I/L)를 뺀 31자
export const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_RE = /^[0-9A-Z]{4,20}$/;
/** 정회원 한 사람이 초대할 수 있는 인원 (초대 코드는 한 사람당 하나, 추가 지급 없음) */
export const INVITE_MAX = 3;
/** 입력값 -> 저장 형태 (대문자, 글자·숫자만): ' k7mp-q2xd ' -> 'K7MPQ2XD' */
export const normCode = (s) => String(s ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
/** 화면 표시용: 'K7MPQ2XD' -> 'K7MP-Q2XD' */
export const codeLabel = (s) => { const n = normCode(s); return n.length === 8 ? `${n.slice(0, 4)}-${n.slice(4)}` : n; };
export function makeCode() {
  const pick = () => {
    if (globalThis.crypto?.getRandomValues) { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % CODE_CHARS.length; }
    return Math.floor(Math.random() * CODE_CHARS.length);
  };
  let s = '';
  for (let i = 0; i < 8; i++) s += CODE_CHARS[pick()];
  return s;
}
/** 숫자·Firestore Timestamp·Date -> 밀리초 (없으면 null) */
export const toMs = (v) => (v == null ? null : typeof v === 'number' ? v : typeof v.toMillis === 'function' ? v.toMillis() : v instanceof Date ? v.getTime() : Number(v));

/**
 * 코드를 지금 쓸 수 있는가: ok | missing | off | expired | full
 * 초대 코드(invite)는 베타 종료일(betaEndsAt)이 지나면 마감 (무료 정회원이 베타 종료일까지라서)
 */
export function codeStatus(c, now = Date.now(), betaEndsAt = null) {
  if (!c) return 'missing';
  if (c.off) return 'off';
  const exp = toMs(c.expiresAt), end = toMs(betaEndsAt);
  if (exp != null && now >= exp) return 'expired';
  if (c.type === 'invite' && end != null && now >= end) return 'expired';
  if (c.maxUses > 0 && (c.uses || 0) >= c.maxUses) return 'full';
  return 'ok';
}
/** 가입 화면용 코드 정보 (운영자 메모는 넣지 않음). nick: 초대 코드를 준 정회원의 별명 */
export function codeInfo(code, c, now = Date.now(), betaEndsAt = null) {
  return { code, status: codeStatus(c, now, betaEndsAt), type: c?.type || null, uses: c?.uses || 0, maxUses: c?.maxUses || 0, expiresAt: toMs(c?.expiresAt), nick: c?.type === 'invite' ? String(c.nick || '') : '' };
}
export function codeError(status, c) {
  switch (status) {
    case 'none': return '가입 코드가 필요합니다';
    case 'format': return '가입 코드를 확인하세요';
    case 'expired': return '마감된 코드입니다';
    case 'full': return c?.maxUses === 1 ? '이미 사용된 코드입니다' : c?.type === 'invite' ? '초대 인원(3명)이 다 찬 코드입니다' : '인원이 다 찬 코드입니다';
    case 'off': return '쓸 수 없는 코드입니다';
    case 'error': return '코드를 확인하지 못했습니다. 잠시 뒤 다시 시도하세요';
    default: return '없는 코드입니다';
  }
}
export const NOT_READY = '아직 가입을 받을 준비가 되지 않았습니다 (운영자 준비 필요)';

/** 정회원 번호: 7 -> 'No.0007' */
export const memberNoLabel = (n) => (Number.isInteger(n) ? `No.${String(n).padStart(4, '0')}` : '');
/** 프로필 배지: '베타 멤버 No.0007' / '정회원 No.0123'. 코드 없이 가입한 예전 계정은 베타 멤버 */
export function memberBadge(u) {
  if (!u) return '';
  const kind = u.beta || !u.code ? '베타 멤버' : '정회원';
  const no = memberNoLabel(u.memberNo);
  return no ? `${kind} ${no}` : kind;
}

/** 게스트 점수가 정회원 랭킹에 있었다면 몇 위였을까 (같은 점수는 앞에 둠) */
export function rankAmong(rows, score) {
  return { rank: rows.filter((r) => r.score > score).length + 1, total: rows.length + 1 };
}

/** 인스타 계정 아이디만 남긴다: '@abc', 'instagram.com/abc/' -> 'abc' (형식이 아니면 '') */
export function instaId(s) {
  const id = String(s || '').trim().replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, '').replace(/^@+/, '').replace(/[/?#].*$/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(id) ? id : '';
}
/** 게스트 -> 공식 인스타 계정 DM 열기 (플레이 인증 후 정회원 코드를 받는 곳) */
export const instaDmLink = (s) => (instaId(s) ? `https://ig.me/m/${instaId(s)}` : '');

// ---- 베타 기간: 무료 정회원은 가입 경로(오픈베타·초대·1회용 코드)와 상관없이 베타 종료일까지 ----
// 베타가 끝나면 구독으로 바뀐다. 그 뒤에도 정회원인 계정: 운영자가 유지(kept)한 계정, 이용권 기한(until)이 남은 계정.
// 커뮤니티 [개발자에게]로 베타 종료일 전에 의견을 보낸 회원 중 30명을 추첨해 3개월 이용권을 준다 (운영자 화면)
export const FEEDBACK_MAX = 500;
/** 베타 멤버였던 계정인가: 오픈베타 링크로 가입 또는 코드 없이 가입했던 예전 계정 (배지·통계용) */
export const isBetaUser = (u) => !!u && (!!u.beta || !u.code);
/**
 * 정회원 등급 상태
 *  guest(로그인 안 함) | beta(베타 기간 중 정회원) | kept(운영자가 유지, 기한 없음) | coupon(베타 종료 뒤 이용권 기한 안) | lapsed(베타 종료)
 */
export function betaState(u, betaEndsAt, now = Date.now()) {
  if (!u) return 'guest';
  if (u.kept) return 'kept';
  const end = toMs(betaEndsAt);
  if (end == null || now < end) return 'beta';
  const until = toMs(u.until);
  if (until != null && now < until) return 'coupon';
  return 'lapsed';
}
/** 랭킹 등록·글쓰기·응원을 할 수 있는 상태인가 */
export const isActiveMember = (st) => st === 'beta' || st === 'kept' || st === 'coupon';
export const LAPSED = '베타 기간이 끝나 정회원 기간이 끝났습니다';

// ---- 의견 추첨 · 3개월 이용권 ----
export const LOTTERY_WINNERS = 30;
export const COUPON_MONTHS = 3;
/** ms 에 n달 더하기 (이 기기 시간대, 달 끝을 넘으면 그 달 마지막 날: 12월 31일 + 2달 = 2월 28일) */
export function addMonths(ms, n) {
  const d = new Date(ms), day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return d.getTime();
}
/** 운영자가 회원 현황에서 달력으로 이용 기간을 늘린 계정의 이용권 종류 (coupon 칸). 추첨 이용권은 '3m' */
export const EXT_PASS = 'ext';
/** 이용권 이름: 달력으로 연장한 기간이면 '이용 기간 연장', 아니면 의견 추첨 '3개월 이용권' */
export const passName = (u) => (u?.coupon === EXT_PASS ? '이용 기간 연장' : `${COUPON_MONTHS}개월 이용권`);
/** 이용권 기한: 베타 종료일(이미 지났거나 정하지 않았으면 지금)부터 3개월 */
export function couponUntil(betaEndsAt, now = Date.now()) {
  const end = toMs(betaEndsAt);
  return addMonths(end != null && end > now ? end : now, COUPON_MONTHS);
}
/** 추첨 대상: 베타 종료일 전에(종료일이 없으면 언제든) 의견을 보냈고, 아직 이용권이 없는 회원 */
export function lotteryPool(members = [], betaEndsAt = null) {
  const end = toMs(betaEndsAt);
  return members.filter((u) => { const fb = toMs(u.feedbackAt); return fb != null && (end == null || fb < end) && toMs(u.until) == null; });
}
/** 0 이상 n 미만 정수 (crypto 난수) */
function randomIndex(n) {
  if (globalThis.crypto?.getRandomValues) { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; }
  return Math.floor(Math.random() * n);
}
/** 무작위로 n명 뽑기 (뽑힌 순서도 무작위). rand(k) = 0..k-1 */
export function drawLottery(pool = [], n = LOTTERY_WINNERS, rand = randomIndex) {
  const a = pool.slice();
  const k = Math.max(0, Math.min(Math.floor(Number(n) || 0), a.length));
  for (let i = 0; i < k; i++) { const j = i + rand(a.length - i); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, k);
}
export function validateFeedback({ good, fix } = {}) {
  const g = String(good || '').trim(), f = String(fix || '').trim();
  if (!g && !f) return '좋았던 점이나 고쳤으면 하는 점을 적어 주세요';
  if (g.length > FEEDBACK_MAX || f.length > FEEDBACK_MAX) return `각 칸은 ${FEEDBACK_MAX}자까지 쓸 수 있습니다`;
  return null;
}

/** 스틱 방향: 'L' 레프트 | 'R' 라이트 */
export const STICKS = ['L', 'R'];
export const stickLabel = (s) => (s === 'L' ? '레프트' : s === 'R' ? '라이트' : '');

// ---- 랭킹 기록 쓰기 줄이기: 최고 기록이 오를 때만 쓰고, 판수는 모아서 ----
// 최고 기록을 못 넘은 판은 기록 문서를 쓰지 않고 판수만 기기에 모아 둔다.
// 모인 판수는 다음 최고 기록 때 함께, 또는 PLAYS_FLUSH 판이 모이면, 또는 화면을 떠날 때·로그아웃할 때 한 번에 쓴다.
export const PLAYS_FLUSH = 10;
/** 한 번에 더할 수 있는 판수 (firestore.rules scoreOk 와 같음) */
export const PLAYS_STEP_MAX = 50;
/** 기기에 모아 둔 판수: { uid: { 랭킹 키: 판수 } } (storage = localStorage) */
export class PendingPlays {
  constructor(storage = globalThis.localStorage, key = 'puck-trainer.pending-plays.v1') { this.storage = storage; this.key = key; }
  _all() { try { const v = this.storage?.getItem(this.key); return v ? JSON.parse(v) || {} : {}; } catch { return {}; } }
  _save(all) { try { this.storage?.setItem(this.key, JSON.stringify(all)); } catch { /* 저장 불가: 판수 몇 판이 빠질 뿐 */ } }
  get(uid, mode) { const n = this._all()[uid]?.[mode]; return Number.isInteger(n) && n > 0 ? n : 0; }
  /** 이 계정에 모인 { 랭킹 키: 판수 } */
  of(uid) { const m = this._all()[uid] || {}; return Object.fromEntries(Object.entries(m).filter(([, n]) => Number.isInteger(n) && n > 0)); }
  add(uid, mode, n = 1) {
    const all = this._all();
    const m = (all[uid] ||= {});
    m[mode] = this.get(uid, mode) + n;
    this._save(all);
    return m[mode];
  }
  /** n 판을 덜어 낸다 (쓰기에 성공한 뒤) */
  take(uid, mode, n) {
    const all = this._all(), left = this.get(uid, mode) - n;
    if (!all[uid]) return 0;
    if (left > 0) all[uid][mode] = left; else delete all[uid][mode];
    if (!Object.keys(all[uid]).length) delete all[uid];
    this._save(all);
    return Math.max(0, left);
  }
}

// ---- 순위 색인 (온라인 랭킹의 읽기를 아끼려고 순위를 Firestore count 쿼리로 센다) ----
// 연령대·국가·팀 안의 순위는 기록 문서의 색인 칸(ags·cts·tms = '묶음|10자리 점수')의 범위로 센다.
// 칸 하나의 범위만 쓰므로 복합 색인 없이 Firestore 기본 색인으로 된다. 규칙(firestore.rules rankIdxOk)과 같은 모양.
/** 점수 최댓값 (규칙 scoreOk 와 같음) */
export const SCORE_MAX = 1000000;
const RANK_BASE = 1000000000;
/** 필터 -> 색인 칸 */
export const RANK_FIELDS = { ageGroup: 'ags', country: 'cts', team: 'tms' };
/** 묶음 값: 팀은 대소문자를 가리지 않는다 (matches 와 같음) */
export const rankGroup = (key, v) => (key === 'team' ? String(v).toLowerCase() : String(v));
/** 묶음 + 점수 -> 그 묶음 안에서 점수순으로 정렬되는 문자열. 예: ('U12', 1234) -> 'U12|1000001234' */
export const rankIdx = (group, score) => `${group}|${RANK_BASE + Math.max(0, Math.min(SCORE_MAX, Math.round(Number(score) || 0)))}`;
/** 기록 문서에 붙이는 순위 색인 칸 { ags, cts, tms } (값이 없는 묶음은 뺀다) */
export function rankIdxFields(e) {
  const f = {};
  for (const [k, field] of Object.entries(RANK_FIELDS)) if (e[k] != null && e[k] !== '') f[field] = rankIdx(rankGroup(k, e[k]), e.score);
  return f;
}
/** 쓰는 필터 (연령대·국가·팀 중 값이 있는 것) */
export const activeFilters = (f = {}) => Object.keys(RANK_FIELDS).filter((k) => f[k]);
/** 점수 높은 순 행에 순위 매기기: 같은 점수는 같은 순위 (1, 2, 2, 4) — count 로 센 '내 순위'와 맞춘다 */
export function competitionRanks(rows) {
  let last = null, rank = 0;
  return rows.map((r, i) => { if (r.score !== last) { rank = i + 1; last = r.score; } return { ...r, rank }; });
}

/** 리더보드(점수 높은 순) -> 내 순위 요약: 전체·내 국가·내 팀. 기록이 없으면 null */
export function rankSummaryOf(rows, u) {
  if (!u) return null;
  const pos = (f) => {
    const rs = rows.filter((r) => matches(r, f));
    const i = rs.findIndex((r) => r.uid === u.id);
    return i >= 0 ? { rank: i + 1, total: rs.length } : null;
  };
  const world = pos({});
  return world ? { world, country: u.country ? pos({ country: u.country }) : null, team: u.team ? pos({ team: u.team }) : null } : null;
}

/** 가입 값 확인: 아이디·비밀번호(로그인용)와 별명(랭킹에 공개)은 따로 */
export function validateProfile({ loginId, password, nick, country, team, age, number, stick }) {
  const idErr = validateLoginId(loginId);
  if (idErr) return idErr;
  if (!NICK_RE.test(String(nick || '').trim())) return '별명은 2~12자 (한글·영문·숫자·_-.)';
  if (RESERVED_NICK_RE.test(String(nick).trim())) return '쓸 수 없는 별명입니다 (운영자로 보이는 이름)';
  const sameErr = validateLoginId(loginId, nick);
  if (sameErr) return sameErr;
  const pwErr = validatePassword(password, { id: loginId, nick });
  if (pwErr) return pwErr;
  if (!country) return '국가를 선택하세요';
  if (!String(team || '').trim() || String(team).trim().length > 20) return '팀 이름은 1~20자';
  const a = Number(age);
  if (!Number.isInteger(a) || a < 3 || a > 99) return '나이는 3~99 사이 숫자';
  if (Number.isNaN(jerseyOf(number))) return '등번호는 0~99 사이 숫자';
  if (!STICKS.includes(stick)) return '스틱(레프트·라이트)을 선택하세요';
  return null;
}

export async function hashPin(nick, pin) {
  const text = `${String(nick).trim().toLowerCase()}:${pin}:puck-trainer`;
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // 비보안 컨텍스트(HTTP) 폴백: FNV-1a 32bit x2
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) { h1 = Math.imul(h1 ^ text.charCodeAt(i), 0x01000193) >>> 0; h2 = Math.imul(h2 ^ text.charCodeAt(i), 0x811c9dc5) >>> 0; }
  return `fnv-${h1.toString(16)}${h2.toString(16)}`;
}

const normNick = (n) => String(n).trim().toLowerCase();

/** 기기 내 저장소 (localStorage). 같은 기기를 쓰는 여러 선수가 등록해 경쟁할 수 있음 */
export class LocalAccountStore {
  constructor(storage = globalThis.localStorage) {
    this.kind = 'local';
    this.storage = storage;
    this.USERS = 'puck-trainer.users.v1';
    this.SCORES = 'puck-trainer.scores-ranked.v1';
    this.SESSION = 'puck-trainer.session.v1';
    this.CODES = 'puck-trainer.codes.v1';     // { CODE: { type, uses, maxUses, expiresAt, off, note, createdAt } }
    this.META = 'puck-trainer.members.v1';    // { count } 정회원 번호
    this.CONFIG = 'puck-trainer.site.v1';     // 게스트 안내(공식 인스타 등) · 베타 종료일
    this.FEEDBACK = 'puck-trainer.feedback.v1'; // { uid: { uid, nick, memberNo, good, fix, at, updatedAt } } 개발자에게
    this.ACTIVITY = 'puck-trainer.activity.v1'; // { uid: 활동 기록 } 출석·최근 기록·누적 (activity.js)
    this.LOTTERY = 'puck-trainer.lottery.v1';   // { at, until, winners: [{ id, nick, memberNo }] } 의견 추첨
    this.user = null;
    // 로그인했지만 아직 못 들어온 계정: { id, nick, admin, kind, loginId }
    //   kind 'id' = 예전 계정(별명 + 숫자 6자리)이라 아이디·새 비밀번호를 만들어야 함, 'password' = 운영자가 준 임시 비밀번호라 새 비밀번호를 정해야 함
    this.upgrade = null;
    const nick = this._get(this.SESSION, null);
    if (nick) { const u = this._users()[normNick(nick)]; if (u) this._signIn(u); }
  }
  /** 로그인 상태로: 아이디가 없는 예전 계정·임시 비밀번호 계정은 새 비밀번호를 정할 때까지 로그인 전으로 둔다 */
  _signIn(u) {
    if (u.loginId && !u.tempPw) { this.upgrade = null; this.user = this._public(u); this._set(this.SESSION, u.nick); return this.user; }
    this.user = null;
    this.upgrade = { id: u.id, nick: u.nick, admin: ADMIN_NICKS.includes(normNick(u.nick)), kind: u.loginId ? 'password' : 'id', loginId: u.loginId || null };
    try { this.storage.removeItem(this.SESSION); } catch { /* ignore */ }
    return null;
  }
  /** 예전 계정이 아이디를 만들어야 하거나(kind 'id') 임시 비밀번호를 바꿔야 하면(kind 'password') { nick, admin, kind, loginId }, 아니면 null */
  needsUpgrade() { return this.upgrade; }

  _get(k, def) { try { const v = this.storage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } }
  _set(k, v) { try { this.storage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }
  _users() { return this._get(this.USERS, {}); }
  _scores() { return this._get(this.SCORES, []); }
  _codes() { return this._get(this.CODES, {}); }
  _public(u) {
    return {
      id: u.id, loginId: u.loginId || null, nick: u.nick, number: Number.isInteger(u.number) ? u.number : null, country: u.country, team: u.team, age: u.age, ageGroup: u.ageGroup,
      stick: STICKS.includes(u.stick) ? u.stick : null, joinedAt: u.joinedAt || u.createdAt || null,
      memberNo: Number.isInteger(u.memberNo) ? u.memberNo : null, beta: !!u.beta, code: u.code || null, via: u.via || null,
      kept: !!u.kept, tempPw: !!u.tempPw, feedbackAt: this._get(this.FEEDBACK, {})[u.id]?.at ?? null,
      invite: u.invite || null, until: toMs(u.until), coupon: u.coupon || null,
      admin: ADMIN_NICKS.includes(normNick(u.nick)),
    };
  }
  /** 지금 로그인한 계정의 정회원 등급 상태 (betaState 참고) */
  memberState(now = Date.now()) { return betaState(this.user, this._betaEnd(), now); }
  _betaEnd() { return this._get(this.CONFIG, {}).betaEndsAt ?? null; }
  _needAdmin() { if (!isAdmin(this.user)) throw new Error('운영자만 할 수 있습니다'); }
  /** 코드를 그대로 저장 (운영자 발급과 테스트 준비에 씀) */
  _putCode(code, data) {
    const codes = this._codes();
    const key = normCode(code);
    codes[key] = { type: 'one', uses: 0, maxUses: 1, expiresAt: null, off: false, note: '', createdAt: Date.now(), ...codes[key], ...data };
    this._set(this.CODES, codes);
    return { code: key, ...codes[key] };
  }

  async ready() { return this; }
  current() { return this.user; }

  async checkCode(code) {
    const key = normCode(code);
    if (!CODE_RE.test(key)) return { code: key, status: 'format' };
    return codeInfo(key, this._codes()[key] || null, Date.now(), this._betaEnd());
  }

  /**
   * 내 초대 코드 (3명까지). 없으면 처음 한 번 만든다 — 정회원(베타 기간 중·유지·이용권)만.
   * 반환: codeInfo + { code } 또는 null (만들 수 없음)
   */
  async myInvite() {
    if (!this.user) return null;
    const users = this._users(), u = users[this.user.id];
    const codes = this._codes(), end = this._betaEnd();
    if (u.invite && codes[u.invite]) return codeInfo(u.invite, codes[u.invite], Date.now(), end);
    if (!isActiveMember(this.memberState())) return null;
    let code = makeCode();
    while (codes[code]) code = makeCode();
    const c = this._putCode(code, { type: 'invite', uses: 0, maxUses: INVITE_MAX, expiresAt: null, off: false, note: '', createdAt: Date.now(), by: u.id, nick: u.nick });
    u.invite = code;
    this._set(this.USERS, users);
    this.user = this._public(u);
    return codeInfo(code, c, Date.now(), end);
  }

  _byLoginId(users, lid) { return Object.values(users).find((u) => u.loginId === lid) || null; }

  async register({ loginId, password, nick, country, team, age, number, code, stick }) {
    const err = validateProfile({ loginId, password, nick, country, team, age, number, stick });
    if (err) throw new Error(err);
    const ckey = normCode(code);
    if (!ckey) throw new Error(codeError('none'));
    if (!CODE_RE.test(ckey)) throw new Error(codeError('format'));
    const users = this._users();
    const key = normNick(nick), lid = normLoginId(loginId);
    if (this._byLoginId(users, lid)) throw new Error(ID_TAKEN);
    if (users[key]) throw new Error('이미 사용 중인 별명입니다');
    const codes = this._codes();
    const c = codes[ckey] || null;
    const st = codeStatus(c, Date.now(), this._betaEnd());
    if (st !== 'ok') throw new Error(codeError(st, c));
    if (!this._get(this.META, null)) this._numberLegacy(); // 기기 내 저장소는 운영자 준비 없이 바로 번호를 매긴다
    const meta = this._get(this.META, { count: 0 });
    meta.count += 1;
    c.uses = (c.uses || 0) + 1; c.lastAt = Date.now();
    const now = Date.now();
    const u = {
      id: key, loginId: lid, nick: String(nick).trim(), number: jerseyOf(number), pinHash: await hashPin(nick, password), country, team: String(team).trim(), age: Number(age), ageGroup: ageGroupOf(age), stick, createdAt: now,
      code: ckey, via: c.type, beta: c.type === 'beta', memberNo: meta.count, joinedAt: now,
    };
    users[key] = u;
    this._set(this.CODES, codes);
    this._set(this.META, meta);
    this._set(this.USERS, users);
    return this._signIn(u);
  }

  // ---- 운영자 ----
  async issueCode({ type = 'one', maxUses = 0, expiresAt = null, note = '' } = {}) {
    this._needAdmin();
    const codes = this._codes();
    let code = makeCode();
    while (codes[code]) code = makeCode();
    return this._putCode(code, { type, uses: 0, maxUses: type === 'one' ? 1 : Math.max(0, Math.floor(Number(maxUses) || 0)), expiresAt: expiresAt ?? null, off: false, note: String(note || '').slice(0, 60), createdAt: Date.now(), by: this.user.id });
  }

  /** 운영자가 만든 코드(오픈베타·1회용)만. 회원들의 초대 코드는 넣지 않는다 */
  async listCodes() {
    this._needAdmin();
    return Object.entries(this._codes()).filter(([, c]) => c.type !== 'invite').map(([code, c]) => ({ code, ...c, expiresAt: toMs(c.expiresAt) })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  async updateCode(code, patch) {
    this._needAdmin();
    const codes = this._codes(); const key = normCode(code);
    if (!codes[key]) throw new Error(codeError('missing'));
    for (const k of ['off', 'note', 'expiresAt', 'maxUses']) if (k in patch) codes[key][k] = patch[k];
    this._set(this.CODES, codes);
    return { code: key, ...codes[key] };
  }

  async membersInfo() {
    const meta = this._get(this.META, null);
    return { ready: !!meta, count: meta?.count || 0 };
  }

  /** 가입 준비: 코드 없이 가입했던 예전 계정에 가입 순서대로 번호를 매기고 베타 멤버로 표시 */
  async initMembers() {
    this._needAdmin();
    if (this._get(this.META, null)) return { assigned: 0, ...(await this.membersInfo()) };
    const assigned = this._numberLegacy();
    if (this.user) this.user = this._public(this._users()[this.user.id]);
    return { assigned, ...(await this.membersInfo()) };
  }

  _numberLegacy() {
    const users = this._users();
    const all = Object.values(users);
    let no = Math.max(0, ...all.map((u) => (Number.isInteger(u.memberNo) ? u.memberNo : 0)));
    const legacy = all.filter((u) => !Number.isInteger(u.memberNo)).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    for (const u of legacy) { u.memberNo = ++no; u.beta = true; }
    this._set(this.USERS, users);
    this._set(this.META, { count: no });
    return legacy.length;
  }

  async getSiteConfig() { return this._get(this.CONFIG, {}); }
  async setSiteConfig(patch) {
    this._needAdmin();
    const cfg = { ...this._get(this.CONFIG, {}), ...patch };
    this._set(this.CONFIG, cfg);
    return cfg;
  }

  // ---- 개발자에게 (한 사람당 하나, 다시 보내면 고쳐짐. 처음 보낸 시각이 베타 마감 전이면 정회원 유지) ----
  async getMyFeedback() { return this.user ? this._get(this.FEEDBACK, {})[this.user.id] || null : null; }

  async sendFeedback({ good, fix }) {
    if (!this.user) throw new Error('로그인이 필요합니다');
    const err = validateFeedback({ good, fix });
    if (err) throw new Error(err);
    const all = this._get(this.FEEDBACK, {});
    const now = Date.now(), u = this.user, prev = all[u.id];
    all[u.id] = { uid: u.id, nick: u.nick, memberNo: u.memberNo, good: String(good || '').trim(), fix: String(fix || '').trim(), at: prev?.at ?? now, updatedAt: now };
    this._set(this.FEEDBACK, all);
    this.user = this._public(this._users()[u.id]);
    return all[u.id];
  }

  async listFeedback() {
    this._needAdmin();
    return Object.values(this._get(this.FEEDBACK, {})).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** 운영자: 전체 회원 목록 (가입 번호 순, 의견 보낸 시각·유지 여부 포함) — 베타 멤버·1회용 코드 정회원·예전 계정 모두 */
  async memberList() {
    this._needAdmin();
    return Object.values(this._users()).map((u) => this._public(u)).sort((a, b) => (a.memberNo || 0) - (b.memberNo || 0));
  }

  /** 운영자: 베타 멤버만 (베타 링크로 가입 또는 예전 계정) */
  async betaMembers() { return (await this.memberList()).filter(isBetaUser); }

  /** 운영자: 모든 회원의 활동 기록 (출석·판 수·훈련 시간 통계용) */
  async activityList() {
    this._needAdmin();
    return Object.entries(this._get(this.ACTIVITY, {})).map(([uid, a]) => cleanActivity(a, uid));
  }

  /** 운영자: 회원 한 명의 게임별 최고 기록 [{ mode: 랭킹 키, score, at, plays }] */
  async memberScores(uid, keys = []) {
    this._needAdmin();
    const want = new Set(keys);
    return this._scores().filter((s) => s.uid === uid && (!keys.length || want.has(s.mode))).map((s) => ({ mode: s.mode, score: s.score, at: s.at, plays: s.plays || 1 }));
  }

  /** 운영자: 코드 하나 지우기 */
  async deleteCode(code) {
    this._needAdmin();
    const codes = this._codes();
    delete codes[normCode(code)];
    this._set(this.CODES, codes);
  }

  /** 운영자: 개발자에게 온 의견 하나 지우기 (그 멤버의 '의견 보냄' 기록도 함께 사라짐) */
  async deleteFeedback(uid) {
    this._needAdmin();
    const all = this._get(this.FEEDBACK, {});
    delete all[uid];
    this._set(this.FEEDBACK, all);
  }

  /** 운영자: 베타 멤버(가입 정보) 지우기 — 프로필과 의견을 지우고 별명을 다시 쓸 수 있게 한다 */
  async deleteMember(uid) {
    this._needAdmin();
    if (uid === this.user?.id) throw new Error('지금 로그인한 운영자 계정은 지울 수 없습니다');
    const users = this._users();
    delete users[uid];
    this._set(this.USERS, users);
    const act = this._get(this.ACTIVITY, {}); delete act[uid]; this._set(this.ACTIVITY, act);
    await this.deleteFeedback(uid);
  }

  /** 운영자: 베타가 끝나도 정회원으로 유지 (기한 없음) */
  async keepMember(uid, kept = true) {
    this._needAdmin();
    const users = this._users();
    if (!users[uid]) throw new Error('없는 계정입니다');
    users[uid].kept = !!kept;
    this._set(this.USERS, users);
    if (this.user?.id === uid) this.user = this._public(users[uid]);
    return this._public(users[uid]);
  }

  /** 운영자: 이용권 주기(until = 기한 ms) / 거두기(until = null). kind = 이용권 종류 (추첨 '3m', 달력 연장 EXT_PASS) */
  async grantCoupon(uid, until, kind = `${COUPON_MONTHS}m`) {
    this._needAdmin();
    const users = this._users();
    if (!users[uid]) throw new Error('없는 계정입니다');
    users[uid].until = until ?? null;
    users[uid].coupon = until ? kind : null;
    this._set(this.USERS, users);
    if (this.user?.id === uid) this.user = this._public(users[uid]);
    return this._public(users[uid]);
  }
  /** 의견 추첨 결과 (없으면 null) */
  async getLottery() { return this._get(this.LOTTERY, null); }
  async saveLottery(data) { this._needAdmin(); this._set(this.LOTTERY, data); return data; }

  /**
   * 로그인: 아이디 + 비밀번호. 아이디가 없는 예전 계정은 별명 + 숫자 6자리로 들어온 뒤 아이디·새 비밀번호를 만든다
   * (그때까지 current() 는 null, needsUpgrade() 가 { nick }). 아이디를 만든 계정은 별명으로 들어올 수 없다
   */
  async login(id, password) {
    const users = this._users();
    const byId = this._byLoginId(users, normLoginId(id));
    if (byId) {
      if (byId.pinHash !== await hashPin(byId.nick, password)) throw new Error(BAD_LOGIN_MSG);
      return this._signIn(byId);
    }
    const old = users[normNick(id)];
    if (!old || old.pinHash !== await hashPin(old.nick, password)) throw new Error(BAD_LOGIN_MSG);
    // 아이디가 있는 계정: 예전 계정에서 옮긴 것이면 아이디로 로그인하라고 알리고, 처음부터 아이디로 가입한 계정은 별명으로 찾지 않는다 (온라인 저장소와 같음)
    if (old.loginId) throw new Error(old.fromNick ? USE_ID_MSG : BAD_LOGIN_MSG);
    return this._signIn(old);
  }

  /** 예전 계정: 아이디와 새 비밀번호 만들기 (별명 + 예전 비밀번호로 로그인한 뒤 한 번) */
  async upgradeLogin(loginId, password) {
    const up = this.upgrade;
    if (!up) throw new Error('먼저 별명과 예전 비밀번호로 로그인하세요');
    if (up.kind === 'password') throw new Error(NEED_TEMP_MSG);
    const err = validateLoginId(loginId, up.nick) || validateNewPassword(password, { id: loginId, nick: up.nick, admin: up.admin });
    if (err) throw new Error(err);
    const users = this._users(), lid = normLoginId(loginId);
    if (this._byLoginId(users, lid)) throw new Error(ID_TAKEN);
    const u = users[up.id];
    if (u.tempPw && u.pinHash === await hashPin(u.nick, password)) throw new Error(SAME_PW_MSG);
    u.loginId = lid;
    u.fromNick = true; // 예전 별명 계정에서 옮김
    u.pinHash = await hashPin(u.nick, password);
    delete u.tempPw; // 임시 비밀번호를 받은 예전 계정이었으면 이제 끝
    this._set(this.USERS, users);
    return this._signIn(u);
  }

  /** 임시 비밀번호(운영자가 줌)로 로그인한 뒤 새 비밀번호 정하기 */
  async resetTempPassword(password) {
    const up = this.upgrade;
    if (up?.kind !== 'password') throw new Error(NEED_TEMP_MSG);
    const err = validateNewPassword(password, { id: up.loginId, nick: up.nick, admin: up.admin });
    if (err) throw new Error(err);
    const users = this._users(), u = users[up.id];
    if (u.pinHash === await hashPin(u.nick, password)) throw new Error(SAME_PW_MSG);
    u.pinHash = await hashPin(u.nick, password);
    delete u.tempPw;
    this._set(this.USERS, users);
    return this._signIn(u);
  }

  /** 운영자 재설정 흉내 (기기 내 저장소 테스트용. 실제 서비스는 tools/admin/reset-password.mjs): 임시 비밀번호를 주고 다음 로그인 때 바꾸게 함 */
  async _setTempPassword(idOrNick, temp) {
    const users = this._users();
    const u = this._byLoginId(users, normLoginId(idOrNick)) || users[normNick(idOrNick)];
    if (!u) throw new Error('그런 회원이 없습니다');
    u.pinHash = await hashPin(u.nick, temp);
    u.tempPw = true;
    this._set(this.USERS, users);
    return u.id;
  }

  logout() { this.user = null; this.upgrade = null; try { this.storage.removeItem(this.SESSION); } catch { /* ignore */ } }

  /** 비밀번호 바꾸기 (내 정보·운영자 화면): 지금 비밀번호를 확인하고 새 비밀번호로 (회원 8자 이상 영문+숫자, 운영자는 12자 이상도) */
  async changePassword(current, next) {
    if (!this.user) throw new Error('로그인이 필요합니다');
    const err = validateNewPassword(next, { id: this.user.loginId, nick: this.user.nick, admin: isAdmin(this.user) });
    if (err) throw new Error(err);
    if (String(next) === String(current)) throw new Error('새 비밀번호가 지금 비밀번호와 같습니다');
    const users = this._users(); const u = users[this.user.id];
    if (u.pinHash !== await hashPin(u.nick, current)) throw new Error('지금 비밀번호가 맞지 않습니다');
    u.pinHash = await hashPin(u.nick, next);
    this._set(this.USERS, users);
    return true;
  }

  async updateProfile({ country, team, age, number, stick }) {
    if (!this.user) throw new Error('로그인이 필요합니다');
    const err = validateEdit({ team, age, number, stick });
    if (err) throw new Error(err);
    const users = this._users(); const u = users[this.user.id];
    if (stick !== undefined) u.stick = stick;
    if (number !== undefined) u.number = jerseyOf(number);
    if (country) u.country = country;
    if (team) u.team = String(team).trim();
    if (age !== undefined) { u.age = Number(age); u.ageGroup = ageGroupOf(age); }
    this._set(this.USERS, users);
    this.user = this._public(u);
    return this.user;
  }

  /** 모아 둔 판수 쓰기 (기기 내 저장소는 판마다 바로 쓰므로 할 일 없음) */
  async flushPlays() { return 0; }

  /** 모드별 최고 기록만 유지 (기기 안이라 쓰기 비용이 없어 판수도 판마다 바로 더함). 반환: { best, improved, entry } */
  async submitScore(mode, score) {
    if (!this.user) throw new Error('로그인이 필요합니다');
    if (!isActiveMember(this.memberState())) throw new Error(LAPSED);
    const scores = this._scores();
    const i = scores.findIndex((s) => s.uid === this.user.id && s.mode === mode);
    const u = this.user;
    const entry = { uid: u.id, nick: u.nick, number: u.number ?? null, country: u.country, team: u.team, age: u.age, ageGroup: u.ageGroup, mode, score: Math.round(score), at: Date.now(), plays: 1 };
    let improved = true;
    if (i >= 0) {
      const prev = scores[i];
      entry.plays = (prev.plays || 1) + 1;
      if (prev.score >= entry.score) { improved = false; entry.score = prev.score; entry.at = prev.at; }
      scores[i] = entry;
    } else scores.push(entry);
    this._set(this.SCORES, scores);
    return { best: entry.score, improved, entry };
  }

  async leaderboard(mode, filters = {}, limit = 100) {
    const rows = this._scores().filter((s) => s.mode === mode && matches(s, filters));
    rows.sort((a, b) => b.score - a.score || a.at - b.at);
    return rows.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));
  }

  async myRank(mode, filters = {}) {
    if (!this.user) return null;
    const rows = await this.leaderboard(mode, filters, 100000);
    const me = rows.find((r) => r.uid === this.user.id);
    return me ? { rank: me.rank, total: rows.length, score: me.score } : null;
  }

  async wouldRank(mode, score) { return rankAmong(await this.leaderboard(mode, {}, 100000), score); }

  // ---- 내 정보 ----
  /** 내 게임별 최고 기록: [{ mode: 랭킹 키, score, at, plays }] */
  async myScores() {
    if (!this.user) return [];
    return this._scores().filter((s) => s.uid === this.user.id).map((s) => ({ mode: s.mode, score: s.score, at: s.at, plays: s.plays || 1 }));
  }
  /** 이 게임에서 내 순위: { world, country, team } 각 { rank, total } */
  async rankSummary(mode) { return rankSummaryOf(await this.leaderboard(mode, {}, 100000), this.user); }
  /** 능력치 기준 (ability.js): 이 게임 나이대 1등·상위 10% 점수. 나이대 기록이 적으면 전체 기준 */
  async abilityRef(mode, ageGroup) {
    let rows = ageGroup ? await this.leaderboard(mode, { ageGroup }, 100000) : [], scope = 'group';
    if (rows.length < ABILITY_MIN_GROUP) { rows = await this.leaderboard(mode, {}, 100000); scope = 'all'; }
    return refOf(rows.map((r) => r.score), rows.length, scope);
  }
  /** 이 점수가 그 기준(나이대 또는 전체) 안에서 몇 위인지 (같은 점수는 같은 순위) */
  async abilityRank(mode, score, ageGroup, scope = 'group') {
    const rows = await this.leaderboard(mode, scope === 'group' && ageGroup ? { ageGroup } : {}, 100000);
    return rows.filter((r) => r.score > score).length + 1;
  }
  async getActivity() { return this.user ? cleanActivity(this._get(this.ACTIVITY, {})[this.user.id], this.user.id) : null; }
  /** 활동 더하기 (entry 가 없으면 오늘 출석만). activity.js 의 addActivity */
  async recordActivity(entry = null) {
    if (!this.user) return null;
    const all = this._get(this.ACTIVITY, {});
    const a = addActivity(cleanActivity(all[this.user.id], this.user.id), entry);
    all[this.user.id] = a;
    this._set(this.ACTIVITY, all);
    return a;
  }
}

/** 프로필 수정 값 확인 (넘긴 칸만) */
export function validateEdit({ team, age, number, stick } = {}) {
  if (team !== undefined && (!String(team).trim() || String(team).trim().length > 20)) return '팀 이름은 1~20자';
  if (age !== undefined) { const a = Number(age); if (!Number.isInteger(a) || a < 3 || a > 99) return '나이는 3~99 사이 숫자'; }
  if (number !== undefined && Number.isNaN(jerseyOf(number))) return '등번호는 0~99 사이 숫자';
  if (stick !== undefined && !STICKS.includes(stick)) return '스틱(레프트·라이트)을 선택하세요';
  return null;
}

export function matches(s, { ageGroup, country, team } = {}) {
  if (ageGroup && s.ageGroup !== ageGroup) return false;
  if (country && s.country !== country) return false;
  if (team && String(s.team).toLowerCase() !== String(team).toLowerCase()) return false;
  return true;
}

/** 설정에 따라 저장소 선택: firebase-config.js 에 값이 있으면 온라인, 아니면 기기 내 */
export async function createAccountStore() {
  try {
    const { firebaseConfig } = await import('./firebase-config.js');
    if (firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId) {
      const { FirebaseAccountStore } = await import('./account-firebase.js');
      const store = new FirebaseAccountStore(firebaseConfig);
      await store.ready();
      return store;
    }
  } catch (err) {
    console.warn('온라인 랭킹 저장소를 열지 못해 기기 내 저장소를 사용합니다:', err);
  }
  return new LocalAccountStore();
}
