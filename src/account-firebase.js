// 온라인 계정·랭킹 (Firebase Auth + Firestore). firebase-config.js 가 채워졌을 때만 로드됨.
// 별명 -> 가상 이메일(u-<hex>@puck-trainer.app), 6자리 비밀번호 -> Firebase Auth 비밀번호.
// 컬렉션: users/{uid} 프로필, nicks/{nickLower} 별명 고유성, scores_{mode}/{uid} 모드별 최고 기록.
import { validateProfile, ageGroupOf, matches } from './account.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1';
const normNick = (n) => String(n).trim().toLowerCase();
const nickEmail = (nick) => `u-${[...new TextEncoder().encode(normNick(nick))].map((b) => b.toString(16).padStart(2, '0')).join('')}@puck-trainer.app`;

export class FirebaseAccountStore {
  constructor(config) { this.kind = 'firebase'; this.config = config; this.user = null; }

  async ready() {
    const [{ initializeApp }, auth, fs] = await Promise.all([
      import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`),
    ]);
    this.A = auth; this.F = fs;
    this.app = initializeApp(this.config);
    this.auth = auth.getAuth(this.app);
    this.db = fs.getFirestore(this.app);
    await new Promise((resolve) => { const un = auth.onAuthStateChanged(this.auth, async (u) => { un(); if (u) await this._loadProfile(u.uid); resolve(); }); });
    return this;
  }

  current() { return this.user; }

  async _loadProfile(uid) {
    const snap = await this.F.getDoc(this.F.doc(this.db, 'users', uid));
    this.user = snap.exists() ? { id: uid, ...snap.data() } : null;
    return this.user;
  }

  async register({ nick, pin, country, team, age }) {
    const err = validateProfile({ nick, pin, country, team, age });
    if (err) throw new Error(err);
    const key = normNick(nick);
    const nickRef = this.F.doc(this.db, 'nicks', key);
    if ((await this.F.getDoc(nickRef)).exists()) throw new Error('이미 사용 중인 별명입니다');
    let cred;
    try { cred = await this.A.createUserWithEmailAndPassword(this.auth, nickEmail(nick), pin); }
    catch (e) { throw new Error(e.code === 'auth/email-already-in-use' ? '이미 사용 중인 별명입니다' : `가입 실패 (${e.code || e.message})`); }
    const uid = cred.user.uid;
    const profile = { nick: String(nick).trim(), nickLower: key, country, team: String(team).trim(), age: Number(age), ageGroup: ageGroupOf(age), createdAt: Date.now() };
    await this.F.setDoc(this.F.doc(this.db, 'users', uid), profile);
    await this.F.setDoc(nickRef, { uid });
    this.user = { id: uid, ...profile };
    return this.user;
  }

  async login(nick, pin) {
    try { await this.A.signInWithEmailAndPassword(this.auth, nickEmail(nick), pin); }
    catch (e) {
      if (['auth/user-not-found', 'auth/invalid-credential', 'auth/wrong-password', 'auth/invalid-login-credentials'].includes(e.code)) throw new Error('별명 또는 비밀번호가 맞지 않습니다');
      throw new Error(`로그인 실패 (${e.code || e.message})`);
    }
    return this._loadProfile(this.auth.currentUser.uid);
  }

  logout() { this.user = null; this.A.signOut(this.auth); }

  async updateProfile({ country, team, age }) {
    if (!this.user) throw new Error('로그인이 필요합니다');
    const patch = {};
    if (country) patch.country = country;
    if (team) patch.team = String(team).trim();
    if (age !== undefined) { patch.age = Number(age); patch.ageGroup = ageGroupOf(age); }
    await this.F.updateDoc(this.F.doc(this.db, 'users', this.user.id), patch);
    Object.assign(this.user, patch);
    return this.user;
  }

  async submitScore(mode, score) {
    if (!this.user) throw new Error('로그인이 필요합니다');
    const ref = this.F.doc(this.db, `scores_${mode}`, this.user.id);
    const prev = await this.F.getDoc(ref);
    const u = this.user;
    const entry = { uid: u.id, nick: u.nick, country: u.country, team: u.team, age: u.age, ageGroup: u.ageGroup, mode, score: Math.round(score), at: Date.now(), plays: 1 };
    let improved = true;
    if (prev.exists()) {
      const p = prev.data();
      entry.plays = (p.plays || 1) + 1;
      if (p.score >= entry.score) { improved = false; entry.score = p.score; entry.at = p.at; }
    }
    await this.F.setDoc(ref, entry);
    return { best: entry.score, improved, entry };
  }

  async leaderboard(mode, filters = {}, limit = 100) {
    // 단일 필드 인덱스만 사용(복합 인덱스 불필요): 상위 300개를 가져와 클라이언트에서 필터
    const q = this.F.query(this.F.collection(this.db, `scores_${mode}`), this.F.orderBy('score', 'desc'), this.F.limit(300));
    const snap = await this.F.getDocs(q);
    const rows = snap.docs.map((d) => d.data()).filter((s) => matches(s, filters));
    return rows.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));
  }

  async myRank(mode, filters = {}) {
    if (!this.user) return null;
    const rows = await this.leaderboard(mode, filters, 300);
    const me = rows.find((r) => r.uid === this.user.id);
    return me ? { rank: me.rank, total: rows.length, score: me.score } : null;
  }
}
