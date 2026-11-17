// 온라인 커뮤니티 (Firestore). firebase-config.js 가 채워져 계정 저장소가 온라인일 때만 로드됨.
// 컬렉션: posts/{id} 글, posts/{id}/records/{uid} 도전 기록(한 사람당 하나: 코스는 평균 사이클, 기록 자랑은 점수), posts/{id}/cheers/{uid} 응원.
// 복합 인덱스 없이 동작하도록 단일 필드 조건만 쓰고, 거르기·정렬은 화면에서 한다 (arrangePosts).
import {
  buildPost, boardOf, betterRecord, STARTER_POSTS, arrangePosts, bragKey, canRecordOn,
  scoreBoardOf, scoreOutcome, scoreRejected, scoreRow,
} from './community.js';

const LIST_LIMIT = 60;

export class FirebaseCommunityStore {
  constructor(account) { this.kind = 'firebase'; this.account = account; }
  get F() { return this.account.F; }
  get db() { return this.account.db; }

  async _hydrate(docSnap) {
    const p = { id: docSnap.id, ...docSnap.data(), records: [], cheers: [] };
    const [recs, cheers] = await Promise.all([
      p.course || p.type === 'record' ? this.F.getDocs(this.F.collection(this.db, 'posts', p.id, 'records')) : null,
      this.F.getDocs(this.F.collection(this.db, 'posts', p.id, 'cheers')),
    ]);
    if (recs) p.records = recs.docs.map((d) => d.data());
    p.cheers = cheers.docs.map((d) => d.id);
    return p;
  }

  async _starters() {
    // 예시 코스는 글 목록 끝에 붙인다 (기록은 posts/{starter-id}/records, 응원은 posts/{starter-id}/cheers 에 쌓임)
    return Promise.all(STARTER_POSTS.map(async (s) => {
      const [recs, cheers] = await Promise.all([
        this.F.getDocs(this.F.collection(this.db, 'posts', s.id, 'records')),
        this.F.getDocs(this.F.collection(this.db, 'posts', s.id, 'cheers')),
      ]);
      return { ...structuredClone(s), records: recs.docs.map((d) => d.data()), cheers: cheers.docs.map((d) => d.id) };
    }));
  }

  /** opts: { type, mode, sort } — community.js 의 arrangePosts 참고 */
  async list(opts = 'all') {
    const o = typeof opts === 'string' ? { type: opts } : opts;
    const { collection, query, orderBy, limit, where, getDocs } = this.F;
    const col = collection(this.db, 'posts');
    // 모드를 고르면 그 모드 글만 가져온다 (단일 필드 조건 = 자동 인덱스). 그 밖에는 최신 글부터
    const q = o.mode === 'free' ? query(col, where('type', 'in', ['course', 'beat']), limit(LIST_LIMIT))
      : o.mode ? query(col, where('modeId', '==', o.mode), limit(LIST_LIMIT))
      : query(col, orderBy('at', 'desc'), limit(LIST_LIMIT));
    const snap = await getDocs(q);
    const posts = await Promise.all(snap.docs.map((d) => this._hydrate(d)));
    const withStarters = !o.mode || o.mode === 'free' ? [...posts, ...await this._starters()] : posts;
    return arrangePosts(withStarters, o);
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

  async _myBrags(user, key) {
    const snap = await this.F.getDocs(this.F.query(this.F.collection(this.db, 'posts'), this.F.where('uid', '==', user.id)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => p.type === 'record' && bragKey(p) === key).sort((a, b) => b.at - a.at);
  }

  /** 내가 이 모드(모드·시간·투명)로 올린 기록 자랑 글 (모드마다 하나) */
  async myBrag(user, key) {
    if (!user) return null;
    return (await this._myBrags(user, key))[0] || null;
  }

  /** 기록 자랑은 모드마다 하나: 이미 있으면 그 글을 새 기록으로 바꾼다 (응원·도전 기록은 유지) */
  async create(user, data) {
    const { error, post } = buildPost(user, data);
    if (error) throw new Error(error);
    const { records, cheers, ...fields } = post;
    if (post.type === 'record') {
      const old = await this._myBrags(user, bragKey(post));
      if (old.length) {
        await this.F.updateDoc(this.F.doc(this.db, 'posts', old[0].id), fields);
        await Promise.all(old.slice(1).map((p) => this.F.deleteDoc(this.F.doc(this.db, 'posts', p.id)))); // 예전 중복 글 정리
        return { ...old[0], ...post, id: old[0].id, replaced: true };
      }
    }
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

  /** 기록 자랑 도전 기록 (글쓴이와 나이가 같거나 어린 선수만, 한 사람당 최고 점수 하나). 규칙은 firestore.rules 에서도 검사 */
  async submitScore(user, id, score) {
    if (!user) throw new Error('로그인이 필요합니다');
    if (!Number.isFinite(score) || score < 0) throw new Error('기록이 올바르지 않습니다');
    const p = await this.get(id);
    if (!p || p.type !== 'record') throw new Error('글을 찾을 수 없습니다');
    if (p.uid === user.id) return scoreRejected(p, user, 'author');
    if (!canRecordOn(user, p)) return scoreRejected(p, user, 'age');
    const before = scoreBoardOf(p);
    const mine = p.records.find((r) => r.uid === user.id);
    const improved = !mine || Math.round(score) > mine.score;
    if (improved) {
      const row = scoreRow(user, score);
      await this.F.setDoc(this.F.doc(this.db, 'posts', id, 'records', user.id), row);
      p.records = p.records.filter((r) => r.uid !== user.id).concat(row);
    }
    return scoreOutcome(p, user, Math.round(score), before, improved);
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
