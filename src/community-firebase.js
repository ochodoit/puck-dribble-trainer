// 온라인 커뮤니티 (Firestore). firebase-config.js 가 채워져 계정 저장소가 온라인일 때만 로드됨.
// 컬렉션: posts/{id} 글, posts/{id}/records/{uid} 코스 도전 기록(한 사람당 하나), posts/{id}/cheers/{uid} 응원.
// 주의: 실제 Firebase 프로젝트에 연결해 검증하지 않은 코드. 연결 후 firestore.rules 와 함께 동작을 확인할 것.
import { buildPost, boardOf, betterRecord, STARTER_POSTS } from './community.js';

export class FirebaseCommunityStore {
  constructor(account) { this.kind = 'firebase'; this.account = account; }
  get F() { return this.account.F; }
  get db() { return this.account.db; }

  async _hydrate(docSnap) {
    const p = { id: docSnap.id, ...docSnap.data(), records: [], cheers: [] };
    const [recs, cheers] = await Promise.all([
      p.course ? this.F.getDocs(this.F.collection(this.db, 'posts', p.id, 'records')) : null,
      this.F.getDocs(this.F.collection(this.db, 'posts', p.id, 'cheers')),
    ]);
    if (recs) p.records = recs.docs.map((d) => d.data());
    p.cheers = cheers.docs.map((d) => d.id);
    return p;
  }

  async list(filter = 'all') {
    const q = this.F.query(this.F.collection(this.db, 'posts'), this.F.orderBy('at', 'desc'), this.F.limit(40));
    const snap = await this.F.getDocs(q);
    const posts = await Promise.all(snap.docs.map((d) => this._hydrate(d)));
    // 예시 코스는 글 목록 끝에 붙인다 (기록은 posts/{starter-id}/records 에 쌓임)
    const starters = await Promise.all(STARTER_POSTS.map(async (s) => {
      const recs = await this.F.getDocs(this.F.collection(this.db, 'posts', s.id, 'records'));
      return { ...structuredClone(s), records: recs.docs.map((d) => d.data()) };
    }));
    return [...posts, ...starters].filter((p) => filter === 'all' || (filter === 'course' ? p.type === 'course' : p.type !== 'course'));
  }

  async get(id) {
    const starter = STARTER_POSTS.find((s) => s.id === id);
    if (starter) {
      const recs = await this.F.getDocs(this.F.collection(this.db, 'posts', id, 'records'));
      return { ...structuredClone(starter), records: recs.docs.map((d) => d.data()) };
    }
    const snap = await this.F.getDoc(this.F.doc(this.db, 'posts', id));
    return snap.exists() ? this._hydrate(snap) : null;
  }

  async create(user, data) {
    const { error, post } = buildPost(user, data);
    if (error) throw new Error(error);
    const { records, cheers, ...fields } = post;
    const ref = await this.F.addDoc(this.F.collection(this.db, 'posts'), fields);
    return { ...post, id: ref.id };
  }

  async remove(user, id) {
    const p = await this.get(id);
    if (!p) return false;
    if (!user || p.uid !== user.id || p.official) throw new Error('내가 쓴 글만 지울 수 있습니다');
    await this.F.deleteDoc(this.F.doc(this.db, 'posts', id));
    return true;
  }

  async submitRecord(user, id, rec) {
    if (!user) throw new Error('로그인이 필요합니다');
    const p = await this.get(id);
    if (!p || !p.course) throw new Error('글을 찾을 수 없습니다');
    const record = { avg: Math.round(rec.avg * 1000) / 1000, best: Math.round(Math.min(rec.best, rec.avg) * 1000) / 1000 };
    if (!(record.avg > 0) || !(record.best > 0)) throw new Error('기록이 올바르지 않습니다');
    const before = boardOf(p);
    const prevHolder = before[0] || null;
    const mine = before.find((r) => r.uid === user.id) || null;
    const improved = betterRecord(record, mine);
    if (improved) {
      if (p.uid === user.id && !p.official) { await this.F.updateDoc(this.F.doc(this.db, 'posts', id), { record }); p.record = record; }
      else {
        const row = { uid: user.id, nick: user.nick, team: user.team, country: user.country, ...record, at: Date.now() };
        await this.F.setDoc(this.F.doc(this.db, 'posts', id, 'records', user.id), row);
        p.records = p.records.filter((r) => r.uid !== user.id).concat(row);
      }
    }
    const after = boardOf(p);
    const me = after.find((r) => r.uid === user.id);
    return {
      improved, rank: me ? me.rank : null, total: after.length, prevHolder,
      isHolder: !!me && me.rank === 1,
      beatAuthor: p.uid !== user.id && !!p.record && betterRecord(record, p.record),
    };
  }

  async cheer(user, id) {
    if (!user) throw new Error('로그인이 필요합니다');
    const ref = this.F.doc(this.db, 'posts', id, 'cheers', user.id);
    const snap = await this.F.getDoc(ref);
    if (snap.exists()) await this.F.deleteDoc(ref); else await this.F.setDoc(ref, { at: Date.now() });
    const all = await this.F.getDocs(this.F.collection(this.db, 'posts', id, 'cheers'));
    return all.size;
  }
}
