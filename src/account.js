// 계정·랭킹 저장소. 기본은 기기 내(localStorage) 저장, firebase-config.js 가 채워지면 온라인(Firestore) 저장소로 전환.
// 로그인: 별명 + 6자리 숫자 비밀번호. 프로필: 국가, 팀 이름, 나이(연령대 자동 계산).

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

/** 등번호(선택): 비어 있으면 null, 아니면 0~99 정수. 형식이 틀리면 NaN */
export function jerseyOf(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const s = String(v).trim();
  return /^\d{1,2}$/.test(s) ? Number(s) : NaN;
}
/** 화면 표시용: '#87' (등번호가 없으면 빈 문자열) */
// 테스트 관리자: 이 별명으로 로그인하면 카메라 없이 마우스로 플레이할 수 있다 (별명은 가입 순서대로 한 사람만 가질 수 있음)
export const ADMIN_NICKS = ['test123'];
export const isAdmin = (user) => !!user && ADMIN_NICKS.includes(String(user.nickLower || user.nick || '').trim().toLowerCase());
export const jerseyLabel = (n) => (Number.isInteger(n) ? `#${n}` : '');

export function validateProfile({ nick, pin, country, team, age, number }) {
  if (!NICK_RE.test(String(nick || '').trim())) return '별명은 2~12자 (한글·영문·숫자·_-.)';
  if (!PIN_RE.test(String(pin || ''))) return '비밀번호는 숫자 6자리';
  if (!country) return '국가를 선택하세요';
  if (!String(team || '').trim() || String(team).trim().length > 20) return '팀 이름은 1~20자';
  const a = Number(age);
  if (!Number.isInteger(a) || a < 3 || a > 99) return '나이는 3~99 사이 숫자';
  if (Number.isNaN(jerseyOf(number))) return '등번호는 0~99 사이 숫자';
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
    this.user = null;
    const nick = this._get(this.SESSION, null);
    if (nick) { const u = this._users()[normNick(nick)]; if (u) this.user = this._public(u); }
  }

  _get(k, def) { try { const v = this.storage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } }
  _set(k, v) { try { this.storage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }
  _users() { return this._get(this.USERS, {}); }
  _scores() { return this._get(this.SCORES, []); }
  _public(u) { return { id: u.id, nick: u.nick, number: Number.isInteger(u.number) ? u.number : null, country: u.country, team: u.team, age: u.age, ageGroup: u.ageGroup }; }

  async ready() { return this; }
  current() { return this.user; }

  async register({ nick, pin, country, team, age, number }) {
    const err = validateProfile({ nick, pin, country, team, age, number });
    if (err) throw new Error(err);
    const users = this._users();
    const key = normNick(nick);
    if (users[key]) throw new Error('이미 사용 중인 별명입니다');
    const u = { id: key, nick: String(nick).trim(), number: jerseyOf(number), pinHash: await hashPin(nick, pin), country, team: String(team).trim(), age: Number(age), ageGroup: ageGroupOf(age), createdAt: Date.now() };
    users[key] = u;
    this._set(this.USERS, users);
    this._set(this.SESSION, u.nick);
    this.user = this._public(u);
    return this.user;
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

  async updateProfile({ country, team, age, number }) {
    if (!this.user) throw new Error('로그인이 필요합니다');
    if (number !== undefined && Number.isNaN(jerseyOf(number))) throw new Error('등번호는 0~99 사이 숫자');
    const users = this._users(); const u = users[this.user.id];
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
