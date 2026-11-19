// 온라인 계정·랭킹 (Firebase Auth + Firestore). firebase-config.js 가 채워졌을 때만 로드됨.
// 로그인 = 아이디 + 비밀번호(8자 이상, 영문+숫자), 랭킹에 보이는 이름 = 별명 (따로 정함. 별명은 공개되므로 로그인에 쓰지 않는다).
// 아이디 -> 가상 이메일 id.<아이디>@<이 프로젝트의 Firebase 도메인>, 비밀번호 -> Firebase Auth 비밀번호.
// 예전 계정(별명 + 숫자 6자리): 로그인 주소가 u-<별명 hex>@<도메인> (더 예전은 @puck-trainer.app).
//   별명 + 예전 비밀번호로 로그인하면 아이디·새 비밀번호를 만들 때까지 로그인 전으로 둔다 (needsUpgrade, upgradeLogin).
//   로그인 주소를 아이디 주소로 바꾸지 못하면(프로젝트 설정) ids/{아이디} 에 적힌 예전 주소로 로그인한다.
// 비밀번호를 잊으면: 가상 이메일이라 재설정 메일을 받을 수 없다. 운영자가 tools/admin/reset-password.mjs 로 임시 비밀번호를 주고
//   users/{uid}.tempPw = true 를 적는다. 그 계정은 로그인한 뒤 새 비밀번호를 정할 때까지 로그인 전으로 둔다 (resetTempPassword).
// 컬렉션: users/{uid} 프로필(= 정회원), nicks/{nickLower} 별명 고유성, ids/{아이디} 아이디 고유성·로그인 주소, scores_{mode}/{uid} 모드별 최고 기록,
//         codes/{CODE} 가입 코드(오픈베타·1회용·회원의 초대 코드), meta/members 회원 수(정회원 번호), config/site 게스트 안내·베타 종료일,
//         config/lottery 의견 추첨 결과, admins/{uid} 운영자(콘솔에서 만듦),
//         feedback/{uid} 개발자에게 (베타 종료일 전에 보내면 3개월 이용권 추첨 대상)
import {
  validateProfile, ageGroupOf, matches, jerseyOf, normCode, CODE_RE, codeStatus, codeInfo, codeError, makeCode, toMs, NOT_READY,
  betaState, isActiveMember, isBetaUser, LAPSED, validateFeedback, validateEdit, INVITE_MAX, COUPON_MONTHS,
  SCORE_MAX, RANK_FIELDS, rankGroup, rankIdx, rankIdxFields, activeFilters, competitionRanks,
  LOGIN_ID_RE, NICK_RE, normLoginId, validateLoginId, validateNewPassword, BAD_LOGIN_MSG, USE_ID_MSG, ID_TAKEN, NEED_TEMP_MSG, SAME_PW_MSG, RELOGIN_MSG,
  PendingPlays, PLAYS_FLUSH, PLAYS_STEP_MAX,
} from './account.js';
import { cleanActivity, addActivity } from './activity.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1';
const normNick = (n) => String(n).trim().toLowerCase();
const nickLocal = (nick) => `u-${[...new TextEncoder().encode(normNick(nick))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
// 예전 로그인 주소의 도메인. 우리가 가진 도메인이 아니라서(누구나 살 수 있음) 새 계정에는 쓰지 않는다.
// 새 계정은 이 프로젝트의 Firebase 도메인(authDomain)을 쓴다: 아무도 그 주소로 메일을 받을 수 없어 비밀번호 재설정 메일로 계정을 뺏을 수 없다.
const LEGACY_DOMAIN = 'puck-trainer.app';
/** 리더보드를 다시 읽지 않는 시간 (랭킹 화면에서 조건을 바꿔 보는 동안) */
const BOARD_TTL = 60 * 1000;
const BAD_LOGIN = ['auth/user-not-found', 'auth/invalid-credential', 'auth/wrong-password', 'auth/invalid-login-credentials', 'auth/invalid-email'];

export class FirebaseAccountStore {
  constructor(config) {
    this.kind = 'firebase'; this.config = config; this.user = null; this.site = {}; this._boards = new Map(); this._mine = null;
    // 로그인했지만 아직 못 들어온 계정: { nick, admin, kind, loginId, temp }
    //   kind 'id' = 예전 계정이라 아이디·새 비밀번호를 만들어야 함, 'password' = 임시 비밀번호라 새 비밀번호를 정해야 함
    this.upgrade = null;
    this.pending = new PendingPlays(); // 아직 쓰지 않은 판수
  }

  async ready() {
    const [{ initializeApp }, auth, fs] = await Promise.all([
      import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`),
    ]);
    this.A = auth; this.F = fs;
    this.app = initializeApp(this.config);
    this.auth = auth.getAuth(this.app);
    this.db = fs.getFirestore(this.app);
    await this.getSiteConfig(); // 베타 종료일 (정회원 유지 판단)
    await new Promise((resolve) => { const un = auth.onAuthStateChanged(this.auth, async (u) => { un(); if (u) await this._settle(); resolve(); }); });
    // 저장돼 있던 로그인으로 들어왔는데 아이디·새 비밀번호를 정해야 하면: 로그인이 오래됐으면 비밀번호를 바꿀 수 없으니(requires-recent-login)
    // 정하는 칸을 보여 주는 대신 로그인부터 다시 하게 한다
    if (this.upgrade && !this._recentLogin()) this._staleLogout();
    return this;
  }

  /** 마지막 로그인이 비밀번호를 바꿀 수 있을 만큼 최근인가 (Firebase 는 약 5분. 여유를 두고 4분) */
  _recentLogin(now = Date.now()) {
    const t = Date.parse(this.auth.currentUser?.metadata?.lastSignInTime || '');
    return Number.isFinite(t) ? now - t < 4 * 60 * 1000 : true;
  }
  /** 오래된 로그인: 내보내고 다시 로그인하게 한다 */
  _staleLogout() { this.user = null; this.upgrade = null; this._mine = null; this.A.signOut(this.auth); }
  /** 비밀번호 바꾸기 (아이디 만들기·임시 비밀번호): 로그인이 오래됐으면 내보내고 다시 로그인하라고 알린다 */
  async _setPassword(cu, password) {
    try { await this.A.updatePassword(cu, String(password)); }
    catch (e) {
      if (e.code === 'auth/requires-recent-login') { this._staleLogout(); throw new Error(RELOGIN_MSG); }
      throw new Error(`비밀번호를 바꾸지 못했습니다 (${e.code || e.message})`);
    }
  }

  /** 로그인한 계정의 프로필을 읽고, 아이디가 없는 예전 계정·임시 비밀번호 계정이면 새 비밀번호를 정할 때까지 로그인 전으로 둔다 */
  async _settle() {
    const u = await this._loadProfile(this.auth.currentUser.uid);
    if (u && (!u.loginId || u.tempPw)) {
      this.upgrade = { nick: u.nick, admin: !!u.admin, kind: u.loginId ? 'password' : 'id', loginId: u.loginId || null, temp: !!u.tempPw };
      this.user = null; return null;
    }
    this.upgrade = null;
    return u;
  }
  /** 예전 계정이 아이디를 만들어야 하거나(kind 'id') 임시 비밀번호를 바꿔야 하면(kind 'password') { nick, admin, kind, loginId }, 아니면 null */
  needsUpgrade() { return this.upgrade; }

  current() { return this.user; }
  _doc(...path) { return this.F.doc(this.db, ...path); }
  _domain(legacy = false) { return legacy || !this.config.authDomain ? LEGACY_DOMAIN : this.config.authDomain; }
  /** 예전 계정: 별명 -> 로그인용 가상 이메일 (legacy = 더 예전 도메인) */
  _email(nick, legacy = false) { return `${nickLocal(nick)}@${this._domain(legacy)}`; }
  /** 아이디 -> 로그인용 가상 이메일 */
  _idEmail(id) { return `id.${normLoginId(id)}@${this._domain()}`; }

  async _loadProfile(uid) {
    const snap = await this.F.getDoc(this._doc('users', uid));
    if (!snap.exists()) { this.user = null; return null; }
    let admin = false, feedbackAt = null;
    try { admin = (await this.F.getDoc(this._doc('admins', uid))).exists(); } catch { admin = false; }
    try { const fb = await this.F.getDoc(this._doc('feedback', uid)); feedbackAt = fb.exists() ? toMs(fb.data().at) : null; } catch { feedbackAt = null; }
    const d = snap.data();
    this.user = { id: uid, ...d, until: toMs(d.until), feedbackAt, admin };
    return this.user;
  }

  /** 지금 로그인한 계정의 정회원 등급 상태 (account.js betaState 참고) */
  memberState(now = Date.now()) { return betaState(this.user, this.site.betaEndsAt, now); }

  async checkCode(code) {
    const key = normCode(code);
    if (!CODE_RE.test(key)) return { code: key, status: 'format' };
    try {
      const snap = await this.F.getDoc(this._doc('codes', key));
      return codeInfo(key, snap.exists() ? snap.data() : null, Date.now(), this.site.betaEndsAt);
    } catch { return { code: key, status: 'error' }; }
  }

  /**
   * 내 초대 코드 (3명까지). 없으면 처음 한 번 만든다 — 정회원(베타 기간 중·유지·이용권)만.
   * 코드 문서와 프로필의 invite 칸을 한 묶음으로 쓴다 (규칙: 한 사람당 하나, 3명, 추가 없음)
   */
  async myInvite() {
    if (!this.user) return null;
    const uid = this.user.id, end = this.site.betaEndsAt;
    if (this.user.invite) {
      const s = await this.F.getDoc(this._doc('codes', this.user.invite));
      if (s.exists()) return codeInfo(this.user.invite, s.data(), Date.now(), end);
    }
    if (!isActiveMember(this.memberState())) return null;
    for (let i = 0; i < 6; i++) {
      const code = makeCode(), ref = this._doc('codes', code);
      if ((await this.F.getDoc(ref)).exists()) continue;
      const data = { type: 'invite', uses: 0, maxUses: INVITE_MAX, expiresAt: null, off: false, note: '', createdAt: Date.now(), by: uid, nick: this.user.nick };
      const b = this.F.writeBatch(this.db);
      b.set(ref, data);
      b.update(this._doc('users', uid), { invite: code });
      await b.commit();
      this.user.invite = code;
      return codeInfo(code, data, Date.now(), end);
    }
    throw new Error('코드를 만들지 못했습니다. 다시 시도하세요');
  }

  /** 가입 = 정회원. 쓸 수 있는 코드가 있어야 하며, 코드 사용·회원 번호·프로필·별명을 한 트랜잭션으로 쓴다 (규칙이 함께 검사) */
  /**
   * 가입 = 정회원. 쓸 수 있는 코드가 있어야 하며, 코드 사용·회원 번호·프로필·별명·아이디를 한 트랜잭션으로 쓴다 (규칙이 함께 검사).
   * 로그인 계정은 아이디 주소(id.<아이디>@…)로 만든다 — 같은 아이디는 Firebase Auth 와 ids/{아이디} 가 둘 다 막는다
   */
  async register({ loginId, password, nick, country, team, age, number, code, stick }) {
    const err = validateProfile({ loginId, password, nick, country, team, age, number, stick });
    if (err) throw new Error(err);
    const ckey = normCode(code);
    if (!ckey) throw new Error(codeError('none'));
    if (!CODE_RE.test(ckey)) throw new Error(codeError('format'));
    const key = normNick(nick), lid = normLoginId(loginId);
    const nickRef = this._doc('nicks', key), idRef = this._doc('ids', lid), codeRef = this._doc('codes', ckey), metaRef = this._doc('meta', 'members');
    if (await this._idTaken(idRef)) throw new Error(ID_TAKEN);
    if ((await this.F.getDoc(nickRef)).exists()) throw new Error('이미 사용 중인 별명입니다');
    const info = await this.checkCode(ckey);
    if (info.status !== 'ok') throw new Error(codeError(info.status, info));
    if (!(await this.F.getDoc(metaRef)).exists()) throw new Error(NOT_READY);
    let cred;
    try { cred = await this.A.createUserWithEmailAndPassword(this.auth, this._idEmail(lid), String(password)); }
    catch (e) { throw new Error(e.code === 'auth/email-already-in-use' ? ID_TAKEN : `가입 실패 (${e.code || e.message})`); }
    const uid = cred.user.uid;
    try {
      const profile = await this.F.runTransaction(this.db, async (tx) => {
        const [m, c, n, i] = await Promise.all([tx.get(metaRef), tx.get(codeRef), tx.get(nickRef), tx.get(idRef)]);
        if (i.exists()) throw new Error(ID_TAKEN);
        if (n.exists()) throw new Error('이미 사용 중인 별명입니다');
        if (!m.exists()) throw new Error(NOT_READY);
        const cd = c.exists() ? c.data() : null;
        const st = codeStatus(cd, Date.now(), this.site.betaEndsAt);
        if (st !== 'ok') throw new Error(codeError(st, cd));
        const no = (m.data().count || 0) + 1, now = Date.now();
        const p = {
          loginId: lid, nick: String(nick).trim(), nickLower: key, number: jerseyOf(number), country, team: String(team).trim(), age: Number(age), ageGroup: ageGroupOf(age), stick, createdAt: now,
          code: ckey, via: cd.type, beta: cd.type === 'beta', memberNo: no, joinedAt: now,
        };
        tx.set(this._doc('users', uid), p);
        tx.set(nickRef, { uid });
        tx.set(idRef, { uid, email: cred.user.email });
        tx.update(codeRef, { uses: (cd.uses || 0) + 1, lastAt: this.F.serverTimestamp() });
        tx.update(metaRef, { count: no });
        return p;
      });
      this.upgrade = null;
      this.user = { id: uid, ...profile, feedbackAt: null, admin: false };
      return this.user;
    } catch (e) {
      // 프로필을 못 만들었으면 방금 만든 로그인 계정도 지운다 (같은 아이디·별명으로 다시 가입할 수 있게)
      try { await this.A.deleteUser(cred.user); } catch { this.A.signOut(this.auth); }
      throw new Error(e.code === 'permission-denied' ? codeError('format') : e.message || String(e));
    }
  }

  /**
   * 아이디가 이미 쓰이는지 (ids/{아이디}). 서버 규칙이 이 읽기를 막으면(규칙을 아직 게시하지 않았거나 반영 전)
   * Firestore 의 영어 오류 대신 알아볼 수 있는 말로 알린다
   */
  async _idTaken(idRef) {
    try { return (await this.F.getDoc(idRef)).exists(); }
    catch (e) { throw new Error(e.code === 'permission-denied' ? '서버 준비가 아직 끝나지 않아 아이디를 확인하지 못했습니다. 잠시 뒤 다시 해 보세요' : `아이디를 확인하지 못했습니다 (${e.code || e.message})`); }
  }

  /** 로그인 시도 하나: 되면 true, 아이디·비밀번호가 틀리면 false, 그 밖의 오류(요청이 너무 많음 등)는 던진다 */
  async _try(email, password) {
    try { await this.A.signInWithEmailAndPassword(this.auth, email, String(password)); return true; }
    catch (e) { if (BAD_LOGIN.includes(e.code)) return false; throw new Error(`로그인 실패 (${e.code || e.message})`); }
  }

  /**
   * 로그인: 아이디 + 비밀번호.
   * 예전 계정(아이디 없음)은 별명 + 숫자 6자리로 들어오고, 아이디·새 비밀번호를 만들 때까지 current() 가 null (needsUpgrade() 가 { nick }).
   * 아이디를 만든 계정이 별명으로 들어오면 내보내고 아이디로 로그인하라고 알린다
   */
  async login(id, password) {
    const lid = normLoginId(id);
    if (LOGIN_ID_RE.test(lid)) {
      if (await this._try(this._idEmail(lid), password)) return this._settle();
      // 아이디를 만든 예전 계정: 로그인 주소를 아이디 주소로 못 바꿨으면 ids/{아이디} 에 적힌 주소로
      let email = null;
      try { const s = await this.F.getDoc(this._doc('ids', lid)); email = s.exists() ? s.data().email : null; } catch { email = null; }
      if (email && email !== this._idEmail(lid) && await this._try(email, password)) return this._settle();
    }
    const nick = String(id ?? '').trim();
    if (NICK_RE.test(nick)) {
      const tries = [this._email(nick), this._email(nick, true)].filter((e, i, a) => a.indexOf(e) === i);
      for (const email of tries) {
        if (!(await this._try(email, password))) continue;
        const u = await this._settle();
        if (u || this.upgrade?.loginId) { this.logout(); throw new Error(USE_ID_MSG); }
        return null; // 아이디 만들기 (needsUpgrade)
      }
    }
    throw new Error(BAD_LOGIN_MSG);
  }

  /**
   * 예전 계정: 아이디와 새 비밀번호 만들기 (별명 + 예전 비밀번호로 로그인한 뒤 한 번).
   * 비밀번호를 먼저 바꾸고(실패하면 아무것도 안 바뀜), ids/{아이디} 와 프로필의 loginId 를 한 묶음으로 쓴 뒤,
   * 로그인 주소를 아이디 주소로 바꿔 본다 (프로젝트 설정상 안 되면 ids 에 적힌 예전 주소로 로그인됨)
   */
  async upgradeLogin(loginId, password) {
    const cu = this.auth.currentUser, up = this.upgrade;
    if (!up || !cu) throw new Error('먼저 별명과 예전 비밀번호로 로그인하세요');
    if (up.kind === 'password') throw new Error(NEED_TEMP_MSG);
    const err = validateLoginId(loginId, up.nick) || validateNewPassword(password, { id: loginId, nick: up.nick, admin: up.admin });
    if (err) throw new Error(err);
    const lid = normLoginId(loginId), idRef = this._doc('ids', lid);
    if (await this._idTaken(idRef)) throw new Error(ID_TAKEN);
    if (up.temp && await this._samePassword(cu, password)) throw new Error(SAME_PW_MSG);
    await this._setPassword(cu, password);
    const b = this.F.writeBatch(this.db);
    b.set(idRef, { uid: cu.uid, email: cu.email });
    b.update(this._doc('users', cu.uid), up.temp ? { loginId: lid, tempPw: this.F.deleteField() } : { loginId: lid });
    try { await b.commit(); }
    catch (e) { throw new Error(e.code === 'permission-denied' ? ID_TAKEN : `아이디를 만들지 못했습니다 (${e.code || e.message})`); }
    try { await this.A.updateEmail(cu, this._idEmail(lid)); } catch { /* 그대로: ids 의 주소로 로그인 */ }
    return this._settle();
  }

  /** 지금 로그인한 계정의 비밀번호가 password 와 같은지 (임시 비밀번호를 그대로 쓰지 못하게) */
  async _samePassword(cu, password) {
    try { await this.A.reauthenticateWithCredential(cu, this.A.EmailAuthProvider.credential(cu.email, String(password))); return true; }
    catch { return false; }
  }

  /**
   * 임시 비밀번호(운영자가 줌)로 로그인한 뒤 새 비밀번호 정하기.
   * 비밀번호를 먼저 바꾸고 tempPw 표시를 지운다 (표시를 못 지우면 다음 로그인 때 한 번 더 정하게 됨)
   */
  async resetTempPassword(password) {
    const cu = this.auth.currentUser, up = this.upgrade;
    if (!cu || up?.kind !== 'password') throw new Error(NEED_TEMP_MSG);
    const err = validateNewPassword(password, { id: up.loginId, nick: up.nick, admin: up.admin });
    if (err) throw new Error(err);
    if (await this._samePassword(cu, password)) throw new Error(SAME_PW_MSG);
    await this._setPassword(cu, password);
    try { await this.F.updateDoc(this._doc('users', cu.uid), { tempPw: this.F.deleteField() }); }
    catch (e) { throw new Error(`비밀번호는 바뀌었지만 마무리하지 못했습니다. 새 비밀번호로 다시 로그인하세요 (${e.code || e.message})`); }
    return this._settle();
  }

  logout() {
    // 모아 둔 판수를 먼저 보내고 로그인 계정에서 나간다 (화면은 바로 로그아웃 상태로)
    const u = this.user;
    const flush = u && Object.keys(this.pending.of(u.id)).length ? this.flushPlays(null, u).catch(() => {}) : null;
    this.user = null; this.upgrade = null;
    const out = () => { if (!this.user && !this.upgrade) { this._mine = null; this.A.signOut(this.auth); } };
    if (flush) flush.finally(out); else out();
  }

  /** 비밀번호 바꾸기 (내 정보·운영자 화면): 지금 비밀번호로 다시 확인한 뒤 새 비밀번호로 (회원 8자 이상 영문+숫자, 운영자는 12자 이상도) */
  async changePassword(current, next) {
    const cu = this.auth.currentUser;
    if (!this.user || !cu) throw new Error('로그인이 필요합니다');
    const err = validateNewPassword(next, { id: this.user.loginId, nick: this.user.nick, admin: !!this.user.admin });
    if (err) throw new Error(err);
    if (String(next) === String(current)) throw new Error('새 비밀번호가 지금 비밀번호와 같습니다');
    try { await this.A.reauthenticateWithCredential(cu, this.A.EmailAuthProvider.credential(cu.email, String(current))); }
    catch (e) { throw new Error(BAD_LOGIN.includes(e.code) ? '지금 비밀번호가 맞지 않습니다' : `확인 실패 (${e.code || e.message})`); }
    try { await this.A.updatePassword(cu, String(next)); }
    catch (e) { throw new Error(`비밀번호를 바꾸지 못했습니다 (${e.code || e.message})`); }
    return true;
  }

  async updateProfile({ country, team, age, number, stick }) {
    if (!this.user) throw new Error('로그인이 필요합니다');
    const err = validateEdit({ team, age, number, stick });
    if (err) throw new Error(err);
    const patch = {};
    if (stick !== undefined) patch.stick = stick;
    if (number !== undefined) patch.number = jerseyOf(number);
    if (country) patch.country = country;
    if (team) patch.team = String(team).trim();
    if (age !== undefined) { patch.age = Number(age); patch.ageGroup = ageGroupOf(age); }
    await this.F.updateDoc(this._doc('users', this.user.id), patch);
    Object.assign(this.user, patch);
    return this.user;
  }

  // ---- 랭킹 ----
  // 읽기를 아끼려고 순위는 count 쿼리로 센다 (일치하는 기록 1,000개당 읽기 1건). 연령대·국가·팀 안의 순위는
  // 기록 문서의 색인 칸(ags·cts·tms, account.js rankIdx)의 범위로 센다: 칸 하나의 범위라 복합 색인이 필요 없다.
  // 그래서 게임 한 판 끝(회원): 내 기록 1 + 전체 순위 2 + 연령대 순위 2 ≈ 읽기 5건 (예전: 상위 300개를 두 번 ≈ 600건)
  _scoreCol(mode) { return this.F.collection(this.db, `scores_${mode}`); }
  /** 묶음(연령대·국가·팀) 안의 범위 조건: 색인 칸이 lo(포함, op '>=') 또는 lo 초과(op '>')부터 그 묶음의 끝까지 */
  _groupWhere(key, value, lo = 0, op = '>=') {
    const { where } = this.F, field = RANK_FIELDS[key], g = rankGroup(key, value);
    return [where(field, op, rankIdx(g, lo)), where(field, '<=', rankIdx(g, SCORE_MAX))];
  }
  async _count(mode, ...cons) { return (await this.F.getCountFromServer(this.F.query(this._scoreCol(mode), ...cons))).data().count; }
  /** score 보다 높은 기록 수 (key 가 있으면 그 묶음 안에서) */
  _above(mode, score, key = null, value = null) {
    return key ? this._count(mode, ...this._groupWhere(key, value, score, '>')) : this._count(mode, this.F.where('score', '>', score));
  }
  /** 기록 수 (key 가 있으면 그 묶음 안에서) */
  _total(mode, key = null, value = null) { return key ? this._count(mode, ...this._groupWhere(key, value)) : this._count(mode); }

  /** 내 기록 문서를 기억해 둔다 (같은 판의 순위 계산·내 정보에서 다시 읽지 않게). data = null 이면 기록 없음 */
  _remember(mode, data) {
    if (!this._mine || this._mine.uid !== this.user?.id) this._mine = { uid: this.user?.id, docs: new Map() };
    this._mine.docs.set(mode, data ? { ...data, t: null } : null);
  }
  /** 내 기록 문서 (기억해 둔 것이 있으면 읽지 않음). 색인 칸이 없거나 틀리면 채워 둔다 */
  async _myScore(mode) {
    if (this._mine?.uid === this.user.id && this._mine.docs.has(mode)) return this._mine.docs.get(mode);
    const snap = await this.F.getDoc(this._doc(`scores_${mode}`, this.user.id));
    const data = snap.exists() ? snap.data() : null;
    this._remember(mode, data);
    if (data) this._fixIdx(mode, data);
    return data;
  }
  /**
   * 예전에 쓴 내 기록 문서에 순위 색인 칸 채우기 (규칙: 색인 칸만 바꾸는 수정은 본인이 할 수 있음).
   * 색인 칸이 없는 문서는 연령대·국가·팀 순위에서 빠지므로, 내 정보를 열거나 순위를 볼 때 조용히 채운다
   */
  _fixIdx(mode, d) {
    const want = rankIdxFields(d);
    if (d.uid !== this.user?.id || Object.keys(want).every((f) => d[f] === want[f])) return;
    this.F.updateDoc(this._doc(`scores_${mode}`, d.uid), want).then(() => {
      const c = this._mine?.docs.get(mode);
      if (c) Object.assign(c, want);
    }).catch(() => {});
  }
  _dropBoards(mode) { for (const k of this._boards.keys()) if (k.startsWith(`${mode}|`)) this._boards.delete(k); }

  /** 기록 문서 하나 (작성자 칸은 지금 프로필로: 규칙이 프로필과 같은지 본다). t = 서버 시간 (규칙이 2초에 한 번만 받음) */
  _entry(u, mode, score, at, plays) {
    const e = { uid: u.id, nick: u.nick, number: u.number ?? null, country: u.country, team: u.team, age: u.age, ageGroup: u.ageGroup, mode, score, at, plays, t: this.F.serverTimestamp() };
    return Object.assign(e, rankIdxFields(e));
  }
  /** 내 기록 문서 (uid 를 직접 받음: 로그아웃하는 중에도 쓸 수 있게) */
  async _scoreDoc(uid, mode) {
    if (this._mine?.uid === uid && this._mine.docs.has(mode)) return this._mine.docs.get(mode);
    const snap = await this.F.getDoc(this._doc(`scores_${mode}`, uid));
    const data = snap.exists() ? snap.data() : null;
    if (this.user?.id === uid) this._remember(mode, data);
    return data;
  }

  /**
   * 한 판 등록. 최고 기록이 오를 때만 기록 문서를 쓰고 (모아 둔 판수도 함께 더함),
   * 못 넘은 판은 판수만 기기에 모아 둔다 (PLAYS_FLUSH 판이 모이면 한 번에 씀). 반환: { best, improved, entry }
   */
  async submitScore(mode, score) {
    if (!this.user) throw new Error('로그인이 필요합니다');
    if (!isActiveMember(this.memberState())) throw new Error(LAPSED);
    await this._flushing; // 판수를 쓰는 중이면 끝난 뒤에 (같은 판수를 두 번 더하지 않게)
    const u = this.user, s = Math.round(score), ref = this._doc(`scores_${mode}`, u.id);
    for (let attempt = 0; ; attempt++) {
      const prev = await this._myScore(mode);
      if (prev && prev.score >= s) {
        const n = this.pending.add(u.id, mode);
        if (n >= PLAYS_FLUSH) this.flushPlays(mode).catch(() => {});
        return { best: prev.score, improved: false, entry: { ...prev, plays: (prev.plays || 1) + n } };
      }
      const add = Math.min(this.pending.get(u.id, mode), PLAYS_STEP_MAX - 1);
      const entry = this._entry(u, mode, s, Date.now(), (prev ? prev.plays || 1 : 0) + add + 1);
      try { await this.F.setDoc(ref, entry); }
      catch (err) {
        // 다른 기기에서 기록·판수가 바뀌었으면 기억해 둔 문서가 낡았다: 다시 읽고 한 번 더
        if (err?.code !== 'permission-denied' || attempt) throw err;
        this._mine?.docs.delete(mode);
        continue;
      }
      if (add) this.pending.take(u.id, mode, add);
      this._remember(mode, entry);
      this._dropBoards(mode);
      return { best: s, improved: true, entry };
    }
  }

  /**
   * 모아 둔 판수를 기록 문서에 쓴다 (mode 를 주면 그 게임만, 한 번에 PLAYS_STEP_MAX 판까지). 점수·기록 시각은 그대로.
   * 기록 문서가 없으면(운영자가 지움) 모아 둔 판수는 버린다. 한 번에 하나씩 돈다. 반환: 쓴 판수
   */
  flushPlays(mode = null, u = this.user) {
    const run = Promise.resolve(this._flushing).then(() => this._flush(mode, u));
    this._flushing = run.catch(() => {});
    return run;
  }
  async _flush(mode, u) {
    if (!u) return 0;
    let done = 0;
    for (const [m, n] of Object.entries(this.pending.of(u.id))) {
      if (mode && m !== mode) continue;
      const prev = await this._scoreDoc(u.id, m);
      if (!prev) { this.pending.take(u.id, m, n); continue; }
      const add = Math.min(n, PLAYS_STEP_MAX);
      const entry = this._entry(u, m, prev.score, prev.at, (prev.plays || 1) + add);
      try { await this.F.setDoc(this._doc(`scores_${m}`, u.id), entry); }
      catch (err) {
        if (err?.code !== 'permission-denied') throw err;
        if (this._mine?.uid === u.id) this._mine.docs.delete(m); // 낡은 문서였을 수 있다: 다음에 다시 읽고 시도
        continue;
      }
      this.pending.take(u.id, m, add);
      if (this.user?.id === u.id) this._remember(m, entry);
      done += add;
    }
    return done;
  }

  /**
   * 리더보드 (점수 높은 순, 같은 점수는 같은 순위). 필터 하나는 서버에서 색인 칸으로 거르고,
   * 겹친 조건(연령대 + 국가·팀)은 그 묶음의 상위 300개를 받아 화면에서 거른다. 1분 동안은 다시 읽지 않는다
   */
  async leaderboard(mode, filters = {}, limit = 100) {
    const keys = activeFilters(filters);
    const n = keys.length > 1 ? Math.max(limit, 300) : limit; // 받아 올 개수 (겹친 조건은 항상 300개: 랭킹 표와 내 순위가 같이 씀)
    const key = `${mode}|${keys.map((k) => `${k}=${rankGroup(k, filters[k])}`).join('&')}|${n}`;
    let hit = this._boards.get(key);
    if (!hit || Date.now() - hit.at >= BOARD_TTL) {
      const { query, orderBy, limit: lim, getDocs } = this.F;
      let q;
      if (!keys.length) q = query(this._scoreCol(mode), orderBy('score', 'desc'), lim(n));
      else {
        const k = ['team', 'country', 'ageGroup'].find((x) => keys.includes(x)); // 가장 좁은 묶음으로 서버에서 거름
        q = query(this._scoreCol(mode), ...this._groupWhere(k, filters[k]), orderBy(RANK_FIELDS[k], 'desc'), lim(n));
      }
      const snap = await getDocs(q);
      hit = { at: Date.now(), rows: competitionRanks(snap.docs.map((d) => d.data()).filter((s) => matches(s, filters))) };
      this._boards.set(key, hit);
    }
    return hit.rows.slice(0, limit);
  }

  /** 내 순위 { rank, total, score } (이 조건에 내 기록이 없으면 null) */
  async myRank(mode, filters = {}) {
    if (!this.user) return null;
    const mine = await this._myScore(mode);
    if (!mine || !matches(mine, filters)) return null;
    const keys = activeFilters(filters);
    if (keys.length > 1) { // 겹친 조건: 그 묶음의 상위 300개 안에서
      const rows = await this.leaderboard(mode, filters, 300);
      const me = rows.find((r) => r.uid === this.user.id);
      return me ? { rank: me.rank, total: rows.length, score: me.score } : null;
    }
    const [k] = keys;
    const [above, total] = await Promise.all([this._above(mode, mine.score, k, filters[k]), this._total(mode, k, filters[k])]);
    return { rank: above + 1, total: Math.max(total, above + 1), score: mine.score };
  }

  /** 게스트 점수가 정회원 랭킹에 있었다면 몇 위였을까 (같은 점수는 앞에 둠) — account.js rankAmong 과 같은 값 */
  async wouldRank(mode, score) {
    const [above, total] = await Promise.all([this._above(mode, Math.round(score)), this._total(mode)]);
    return { rank: above + 1, total: total + 1 };
  }

  // ---- 내 정보 (활동 기록은 activity/{uid}: 본인만 읽고 씀) ----
  /** 내 게임별 최고 기록. keys: 확인할 랭킹 키 목록 (scores_{key}/{uid} 를 한 번에 읽음) */
  async myScores(keys = []) {
    if (!this.user) return [];
    const uid = this.user.id;
    const snaps = await Promise.all(keys.map((k) => this.F.getDoc(this._doc(`scores_${k}`, uid)).catch(() => null)));
    snaps.forEach((s, i) => { if (!s) return; const d = s.exists() ? s.data() : null; this._remember(keys[i], d); if (d) this._fixIdx(keys[i], d); });
    // 판수 = 기록 문서의 판수 + 아직 쓰지 않고 기기에 모아 둔 판수
    return snaps.map((s, i) => (s && s.exists() ? { mode: keys[i], score: s.data().score, at: s.data().at, plays: (s.data().plays || 1) + this.pending.get(uid, keys[i]) } : null)).filter(Boolean);
  }
  /** 이 게임에서 내 순위: { world: { rank, total }, country: { rank }, team: { rank } } (내 국가·팀 기록이 없으면 null) */
  async rankSummary(mode) {
    const u = this.user;
    if (!u) return null;
    const mine = await this._myScore(mode);
    if (!mine) return null;
    const part = async (k) => (u[k] && matches(mine, { [k]: u[k] }) ? { rank: (await this._above(mode, mine.score, k, u[k])) + 1 } : null);
    const [above, total, country, team] = await Promise.all([this._above(mode, mine.score), this._total(mode), part('country'), part('team')]);
    return { world: { rank: above + 1, total: Math.max(total, above + 1) }, country, team };
  }
  async getActivity() {
    if (!this.user) return null;
    const uid = this.user.id;
    if (this._act?.uid === uid) return this._act.data;
    const snap = await this.F.getDoc(this._doc('activity', uid));
    const data = cleanActivity(snap.exists() ? snap.data() : null, uid);
    this._act = { uid, data };
    return data;
  }
  /** 활동 더하기 (entry 가 없으면 오늘 출석만) */
  async recordActivity(entry = null) {
    if (!this.user) return null;
    const uid = this.user.id;
    const a = addActivity(await this.getActivity(), entry);
    await this.F.setDoc(this._doc('activity', uid), a);
    this._act = { uid, data: a };
    return a;
  }

  // ---- 운영자 (규칙이 admins/{uid} 로 다시 검사) ----
  _needAdmin() { if (!this.user?.admin) throw new Error('운영자만 할 수 있습니다'); }
  _expiry(ms) { return ms == null ? null : this.F.Timestamp.fromMillis(ms); }

  async issueCode({ type = 'one', maxUses = 0, expiresAt = null, note = '' } = {}) {
    this._needAdmin();
    for (let i = 0; i < 6; i++) {
      const code = makeCode();
      const ref = this._doc('codes', code);
      if ((await this.F.getDoc(ref)).exists()) continue;
      const data = { type, uses: 0, maxUses: type === 'one' ? 1 : Math.max(0, Math.floor(Number(maxUses) || 0)), expiresAt: this._expiry(expiresAt), off: false, note: String(note || '').slice(0, 60), createdAt: Date.now(), by: this.user.id };
      await this.F.setDoc(ref, data);
      return { code, ...data, expiresAt: toMs(data.expiresAt) };
    }
    throw new Error('코드를 만들지 못했습니다. 다시 시도하세요');
  }

  /** 운영자가 만든 코드(오픈베타·1회용)만. 회원들의 초대 코드는 넣지 않는다 (단일 필드 색인만 쓰도록 정렬은 화면에서) */
  async listCodes() {
    this._needAdmin();
    const snap = await this.F.getDocs(this.F.query(this.F.collection(this.db, 'codes'), this.F.where('type', 'in', ['beta', 'one']), this.F.limit(300)));
    return snap.docs.map((d) => ({ code: d.id, ...d.data(), expiresAt: toMs(d.data().expiresAt), lastAt: toMs(d.data().lastAt) }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 100);
  }

  async updateCode(code, patch) {
    this._needAdmin();
    const p = {};
    if ('off' in patch) p.off = !!patch.off;
    if ('note' in patch) p.note = String(patch.note || '').slice(0, 60);
    if ('expiresAt' in patch) p.expiresAt = this._expiry(patch.expiresAt);
    if ('maxUses' in patch) p.maxUses = Math.max(0, Math.floor(Number(patch.maxUses) || 0));
    await this.F.updateDoc(this._doc('codes', normCode(code)), p);
    return { code: normCode(code), ...patch };
  }

  async membersInfo() {
    const snap = await this.F.getDoc(this._doc('meta', 'members'));
    return { ready: snap.exists(), count: snap.exists() ? snap.data().count || 0 : 0 };
  }

  /** 가입 준비(처음 한 번): 코드 없이 가입했던 예전 계정에 가입 순서대로 번호를 매기고 베타 멤버로 표시, 회원 수 문서를 만든다 */
  async initMembers() {
    this._needAdmin();
    const metaRef = this._doc('meta', 'members');
    if ((await this.F.getDoc(metaRef)).exists()) return { assigned: 0, ...(await this.membersInfo()) };
    const snap = await this.F.getDocs(this.F.collection(this.db, 'users'));
    const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    let no = Math.max(0, ...all.map((u) => (Number.isInteger(u.memberNo) ? u.memberNo : 0)));
    const legacy = all.filter((u) => !Number.isInteger(u.memberNo)).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    for (let i = 0; i < legacy.length; i += 400) {
      const batch = this.F.writeBatch(this.db);
      for (const u of legacy.slice(i, i + 400)) batch.update(this._doc('users', u.id), { memberNo: ++no, beta: true });
      await batch.commit();
    }
    await this.F.setDoc(metaRef, { count: no });
    if (this.user) await this._loadProfile(this.user.id);
    return { assigned: legacy.length, ready: true, count: no };
  }

  async getSiteConfig() {
    try {
      const snap = await this.F.getDoc(this._doc('config', 'site'));
      const d = snap.exists() ? snap.data() : {};
      this.site = { ...d, betaEndsAt: toMs(d.betaEndsAt) };
      return this.site;
    } catch { return this.site || {}; }
  }

  async setSiteConfig(patch) {
    this._needAdmin();
    const p = { ...patch };
    if ('betaEndsAt' in p) p.betaEndsAt = this._expiry(p.betaEndsAt);
    await this.F.setDoc(this._doc('config', 'site'), p, { merge: true });
    return this.getSiteConfig();
  }

  // ---- 개발자에게 (한 사람당 문서 하나, 다시 보내면 고쳐짐. 처음 보낸 시각(at)은 서버 시간으로 남고 바뀌지 않음) ----
  _fb(d) { return { ...d, at: toMs(d.at), updatedAt: toMs(d.updatedAt) }; }

  async getMyFeedback() {
    if (!this.user) return null;
    const snap = await this.F.getDoc(this._doc('feedback', this.user.id));
    return snap.exists() ? this._fb(snap.data()) : null;
  }

  async sendFeedback({ good, fix }) {
    if (!this.user) throw new Error('로그인이 필요합니다');
    const err = validateFeedback({ good, fix });
    if (err) throw new Error(err);
    const u = this.user, ref = this._doc('feedback', u.id);
    const data = { uid: u.id, nick: u.nick, memberNo: Number.isInteger(u.memberNo) ? u.memberNo : null, good: String(good || '').trim(), fix: String(fix || '').trim(), updatedAt: this.F.serverTimestamp() };
    if ((await this.F.getDoc(ref)).exists()) await this.F.updateDoc(ref, data);
    else await this.F.setDoc(ref, { ...data, at: this.F.serverTimestamp() });
    const out = this._fb((await this.F.getDoc(ref)).data());
    this.user.feedbackAt = out.at;
    return out;
  }

  async listFeedback() {
    this._needAdmin();
    const snap = await this.F.getDocs(this.F.query(this.F.collection(this.db, 'feedback'), this.F.orderBy('updatedAt', 'desc'), this.F.limit(300)));
    return snap.docs.map((d) => this._fb(d.data()));
  }

  /**
   * 운영자: 전체 회원 목록 (가입 번호 순, 의견 보낸 시각·유지 여부 포함).
   * 베타 링크로 가입한 베타 멤버뿐 아니라 1회용 코드로 가입한 정회원, 코드 없이 가입했던 예전 계정까지 모두
   */
  async memberList() {
    this._needAdmin();
    const [us, fb] = await Promise.all([
      this.F.getDocs(this.F.query(this.F.collection(this.db, 'users'), this.F.limit(1000))),
      this.listFeedback(),
    ]);
    const at = new Map(fb.map((f) => [f.uid, f.at]));
    return us.docs.map((d) => ({ id: d.id, ...d.data(), until: toMs(d.data().until), feedbackAt: at.get(d.id) ?? null })).sort((a, b) => (a.memberNo || 0) - (b.memberNo || 0));
  }

  /** 운영자: 베타 멤버만 (베타 링크로 가입 또는 예전 계정) */
  async betaMembers() { return (await this.memberList()).filter(isBetaUser); }

  /** 운영자: 모든 회원의 활동 기록 activity/{uid} (출석·판 수·훈련 시간 통계용. 규칙: 운영자만 목록 읽기) */
  async activityList() {
    this._needAdmin();
    const snap = await this.F.getDocs(this.F.query(this.F.collection(this.db, 'activity'), this.F.limit(2000)));
    return snap.docs.map((d) => cleanActivity(d.data(), d.id));
  }

  /** 운영자: 코드 하나 지우기 */
  async deleteCode(code) {
    this._needAdmin();
    await this.F.deleteDoc(this._doc('codes', normCode(code)));
  }

  /** 운영자: 개발자에게 온 의견 하나 지우기 (그 멤버의 '의견 보냄' 기록도 함께 사라짐) */
  async deleteFeedback(uid) {
    this._needAdmin();
    await this.F.deleteDoc(this._doc('feedback', uid));
  }

  /**
   * 운영자: 베타 멤버(가입 정보) 지우기 — 프로필·의견·별명·아이디 문서를 지운다.
   * 로그인 계정(Firebase Auth)은 브라우저에서 지울 수 없어 콘솔에 남는다.
   */
  async deleteMember(uid) {
    this._needAdmin();
    if (uid === this.user?.id) throw new Error('지금 로그인한 운영자 계정은 지울 수 없습니다');
    const snap = await this.F.getDoc(this._doc('users', uid));
    const nickLower = snap.exists() ? snap.data().nickLower : null, loginId = snap.exists() ? snap.data().loginId : null;
    const b = this.F.writeBatch(this.db);
    b.delete(this._doc('users', uid));
    b.delete(this._doc('feedback', uid));
    if (nickLower) b.delete(this._doc('nicks', nickLower));
    if (loginId) b.delete(this._doc('ids', loginId));
    b.delete(this._doc('activity', uid));
    await b.commit();
  }

  /** 운영자: 베타가 끝나도 정회원으로 유지 (기한 없음) */
  async keepMember(uid, kept = true) {
    this._needAdmin();
    await this.F.updateDoc(this._doc('users', uid), { kept: !!kept });
    if (this.user?.id === uid) this.user.kept = !!kept;
    return { id: uid, kept: !!kept };
  }

  /** 운영자: 이용권 주기(until = 기한 ms) / 거두기(until = null). 규칙이 베타 종료 뒤 until 까지 정회원으로 본다 */
  async grantCoupon(uid, until) {
    this._needAdmin();
    const patch = { until: until ? this.F.Timestamp.fromMillis(until) : null, coupon: until ? `${COUPON_MONTHS}m` : null };
    await this.F.updateDoc(this._doc('users', uid), patch);
    if (this.user?.id === uid) Object.assign(this.user, { until: until ?? null, coupon: patch.coupon });
    return { id: uid, until: until ?? null };
  }

  /** 의견 추첨 결과 config/lottery (공개: 당첨 발표용 별명·번호만) */
  async getLottery() {
    const snap = await this.F.getDoc(this._doc('config', 'lottery'));
    if (!snap.exists()) return null;
    const d = snap.data();
    return { ...d, at: toMs(d.at), until: toMs(d.until) };
  }
  async saveLottery(data) {
    this._needAdmin();
    await this.F.setDoc(this._doc('config', 'lottery'), data);
    return data;
  }
}
