// 계정·랭킹 저장소. 기본은 기기 내(localStorage) 저장, firebase-config.js 가 채워지면 온라인(Firestore) 저장소로 전환.
// 로그인: 별명 + 6자리 숫자 비밀번호. 프로필: 국가, 팀 이름, 나이(연령대 자동 계산).

import { cleanActivity, addActivity } from './activity.js';

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
export const PIN_RE = /^\d{6}$/;
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
// 코드 종류: beta(베타 링크, 여러 명·마감일), one(1회용, 운영자가 SNS 인증한 게스트에게 발급)
// 헷갈리는 글자(0/O, 1/I/L)를 뺀 31자
export const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_RE = /^[0-9A-Z]{4,20}$/;
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

/** 코드를 지금 쓸 수 있는가: ok | missing | off | expired | full */
export function codeStatus(c, now = Date.now()) {
  if (!c) return 'missing';
  if (c.off) return 'off';
  const exp = toMs(c.expiresAt);
  if (exp != null && now >= exp) return 'expired';
  if (c.maxUses > 0 && (c.uses || 0) >= c.maxUses) return 'full';
  return 'ok';
}
/** 가입 화면용 코드 정보 (운영자 메모는 넣지 않음) */
export function codeInfo(code, c, now = Date.now()) {
  return { code, status: codeStatus(c, now), type: c?.type || null, uses: c?.uses || 0, maxUses: c?.maxUses || 0, expiresAt: toMs(c?.expiresAt) };
}
export function codeError(status, c) {
  switch (status) {
    case 'none': return '가입 코드가 필요합니다';
    case 'format': return '가입 코드를 확인하세요';
    case 'expired': return '마감된 코드입니다';
    case 'full': return c?.maxUses === 1 ? '이미 사용된 코드입니다' : '인원이 다 찬 코드입니다';
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

// ---- 베타 기간이 끝날 때 정회원 유지: 커뮤니티 [개발자에게]로 의견을 보낸 베타 멤버만 ----
export const FEEDBACK_MAX = 500;
/** 베타 멤버였던 계정인가 (코드 없이 가입했던 예전 계정 포함) */
export const isBetaUser = (u) => !!u && (!!u.beta || !u.code);
/**
 * 정회원 등급 상태
 *  guest(로그인 안 함) | member(정회원) | beta(베타 멤버, 마감 전·의견 아직) | kept(마감 전에 의견을 보냄 또는 운영자가 유지) | lapsed(마감까지 의견 없음)
 */
export function betaState(u, betaEndsAt, now = Date.now()) {
  if (!u) return 'guest';
  if (!isBetaUser(u)) return 'member';
  const end = toMs(betaEndsAt);
  const fb = toMs(u.feedbackAt);
  if (u.kept || (fb != null && (end == null || fb < end))) return 'kept';
  if (end == null || now < end) return 'beta';
  return 'lapsed';
}
/** 랭킹 등록·글쓰기·응원을 할 수 있는 상태인가 */
export const isActiveMember = (st) => st === 'member' || st === 'beta' || st === 'kept';
export const LAPSED = '베타 기간이 끝나 정회원 등급이 유지되지 않았습니다';
export function validateFeedback({ good, fix } = {}) {
  const g = String(good || '').trim(), f = String(fix || '').trim();
  if (!g && !f) return '좋았던 점이나 고쳤으면 하는 점을 적어 주세요';
  if (g.length > FEEDBACK_MAX || f.length > FEEDBACK_MAX) return `각 칸은 ${FEEDBACK_MAX}자까지 쓸 수 있습니다`;
  return null;
}

/** 스틱 방향: 'L' 레프트 | 'R' 라이트 */
export const STICKS = ['L', 'R'];
export const stickLabel = (s) => (s === 'L' ? '레프트' : s === 'R' ? '라이트' : '');

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

export function validateProfile({ nick, pin, country, team, age, number, stick }) {
  if (!NICK_RE.test(String(nick || '').trim())) return '별명은 2~12자 (한글·영문·숫자·_-.)';
  if (RESERVED_NICK_RE.test(String(nick).trim())) return '쓸 수 없는 별명입니다 (운영자로 보이는 이름)';
  if (!PIN_RE.test(String(pin || ''))) return '비밀번호는 숫자 6자리';
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
    this.user = null;
    const nick = this._get(this.SESSION, null);
    if (nick) { const u = this._users()[normNick(nick)]; if (u) this.user = this._public(u); }
  }

  _get(k, def) { try { const v = this.storage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } }
  _set(k, v) { try { this.storage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }
  _users() { return this._get(this.USERS, {}); }
  _scores() { return this._get(this.SCORES, []); }
  _codes() { return this._get(this.CODES, {}); }
  _public(u) {
    return {
      id: u.id, nick: u.nick, number: Number.isInteger(u.number) ? u.number : null, country: u.country, team: u.team, age: u.age, ageGroup: u.ageGroup,
      stick: STICKS.includes(u.stick) ? u.stick : null, joinedAt: u.joinedAt || u.createdAt || null,
      memberNo: Number.isInteger(u.memberNo) ? u.memberNo : null, beta: !!u.beta, code: u.code || null, via: u.via || null,
      kept: !!u.kept, feedbackAt: this._get(this.FEEDBACK, {})[u.id]?.at ?? null,
      admin: ADMIN_NICKS.includes(normNick(u.nick)),
    };
  }
  /** 지금 로그인한 계정의 정회원 등급 상태 (betaState 참고) */
  memberState(now = Date.now()) { return betaState(this.user, this._get(this.CONFIG, {}).betaEndsAt, now); }
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
    return codeInfo(key, this._codes()[key] || null);
  }

  async register({ nick, pin, country, team, age, number, code, stick }) {
    const err = validateProfile({ nick, pin, country, team, age, number, stick });
    if (err) throw new Error(err);
    const ckey = normCode(code);
    if (!ckey) throw new Error(codeError('none'));
    if (!CODE_RE.test(ckey)) throw new Error(codeError('format'));
    const users = this._users();
    const key = normNick(nick);
    if (users[key]) throw new Error('이미 사용 중인 별명입니다');
    const codes = this._codes();
    const c = codes[ckey] || null;
    const st = codeStatus(c);
    if (st !== 'ok') throw new Error(codeError(st, c));
    if (!this._get(this.META, null)) this._numberLegacy(); // 기기 내 저장소는 운영자 준비 없이 바로 번호를 매긴다
    const meta = this._get(this.META, { count: 0 });
    meta.count += 1;
    c.uses = (c.uses || 0) + 1; c.lastAt = Date.now();
    const now = Date.now();
    const u = {
      id: key, nick: String(nick).trim(), number: jerseyOf(number), pinHash: await hashPin(nick, pin), country, team: String(team).trim(), age: Number(age), ageGroup: ageGroupOf(age), stick, createdAt: now,
      code: ckey, via: c.type, beta: c.type === 'beta', memberNo: meta.count, joinedAt: now,
    };
    users[key] = u;
    this._set(this.CODES, codes);
    this._set(this.META, meta);
    this._set(this.USERS, users);
    this._set(this.SESSION, u.nick);
    this.user = this._public(u);
    return this.user;
  }

  // ---- 운영자 ----
  async issueCode({ type = 'one', maxUses = 0, expiresAt = null, note = '' } = {}) {
    this._needAdmin();
    const codes = this._codes();
    let code = makeCode();
    while (codes[code]) code = makeCode();
    return this._putCode(code, { type, uses: 0, maxUses: type === 'one' ? 1 : Math.max(0, Math.floor(Number(maxUses) || 0)), expiresAt: expiresAt ?? null, off: false, note: String(note || '').slice(0, 60), createdAt: Date.now(), by: this.user.id });
  }

  async listCodes() {
    this._needAdmin();
    return Object.entries(this._codes()).map(([code, c]) => ({ code, ...c, expiresAt: toMs(c.expiresAt) })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
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

  /** 운영자: 베타 멤버 목록 (의견 보낸 시각·유지 여부 포함) */
  async betaMembers() {
    this._needAdmin();
    return Object.values(this._users()).map((u) => this._public(u)).filter(isBetaUser).sort((a, b) => (a.memberNo || 0) - (b.memberNo || 0));
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

  /** 운영자: 의견을 못 보낸 베타 멤버도 정회원으로 유지 */
  async keepMember(uid, kept = true) {
    this._needAdmin();
    const users = this._users();
    if (!users[uid]) throw new Error('없는 계정입니다');
    users[uid].kept = !!kept;
    this._set(this.USERS, users);
    if (this.user?.id === uid) this.user = this._public(users[uid]);
    return this._public(users[uid]);
  }

  async login(nick, pin) {
    const users = this._users();
    const u = users[normNick(nick)];
    if (!u) throw new Error('등록되지 않은 별명입니다');
    if (u.pinHash !== await hashPin(nick, pin)) throw new Error('비밀번호가 맞지 않습니다');
    this._set(this.SESSION, u.nick);
    this.user = this._public(u);
    return this.user;
  }

  logout() { this.user = null; try { this.storage.removeItem(this.SESSION); } catch { /* ignore */ } }

  /** 비밀번호 바꾸기 (운영자 화면): 지금 비밀번호를 확인하고 새 비밀번호(12자 이상)로 */
  async changePassword(current, next) {
    if (!this.user) throw new Error('로그인이 필요합니다');
    const err = validateStrongPassword(next);
    if (err) throw new Error(err);
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

  /** 모드별 최고 기록만 유지. 반환: { best, improved, entry } */
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
