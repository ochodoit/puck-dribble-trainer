// 온라인 커뮤니티 (Firestore). firebase-config.js 가 채워져 계정 저장소가 온라인일 때만 로드됨.
// 컬렉션: posts/{id} 글, posts/{id}/records/{uid} 도전 기록(한 사람당 하나: 코스는 평균 사이클, 기록 자랑은 점수), posts/{id}/cheers/{uid} 응원.
// 복합 인덱스 없이 동작하도록 단일 필드 조건만 쓰고, 거르기·정렬은 화면에서 한다 (arrangePosts).
import {
  buildPost, boardOf, betterRecord, STARTER_POSTS, arrangePosts, bragKey, canRecordOn,
  scoreBoardOf, scoreOutcome, scoreRejected, scoreRow,
} from './community.js';
import { writePublic } from './account.js';

const LIST_LIMIT = 60;
export const RECORD_LIMIT = 100; // 글 하나의 도전 기록은 상위 100개까지만 읽는다 (+ 내 기록)
export const CHEER_LIMIT = 50;   // 응원은 50개까지 읽고, 더 많으면 개수만 센다 (+ 내가 눌렀는지)

export class FirebaseCommunityStore {
  constructor(account) { this.kind = 'firebase'; this.account = account; }
  get F() { return this.account.F; }
  get db() { return this.account.db; }
  get me() { return this.account.user?.id || null; }

  /**
   * 글 하나의 도전 기록: 그 글의 순위 기준으로 상위 RECORD_LIMIT 개 (기록 자랑 = 점수 높은 순, 코스 = 평균 사이클 짧은 순).
   * 꽉 차서 내 기록이 빠졌을 수 있으면 내 것만 하나 더 읽는다 (글을 열 때마다 기록 전부를 읽지 않게)
   */
  async _records(id, type) {
    const { collection, query, orderBy, limit, getDocs, getDoc, doc } = this.F;
    const snap = await getDocs(query(collection(this.db, 'posts', id, 'records'), type === 'record' ? orderBy('score', 'desc') : orderBy('avg'), limit(RECORD_LIMIT)));
    const rows = snap.docs.map((d) => d.data());
    if (rows.length >= RECORD_LIMIT && this.me && !rows.some((r) => r.uid === this.me)) {
      const mine = await getDoc(doc(this.db, 'posts', id, 'records', this.me));
      if (mine.exists()) rows.push(mine.data());
    }
    return rows;
  }

  /**
   * 응원한 사람 목록 (화면은 개수와 '내가 눌렀는지'만 씀). CHEER_LIMIT 개까지는 그대로 읽고,
   * 더 많으면 개수는 count 로 세고 내 응원만 확인해 같은 모양(길이 = 개수, 내 id 포함)으로 돌려준다
   */
  async _cheers(id) {
    const { collection, query, limit, getDocs, getCountFromServer, getDoc, doc } = this.F;
    const col = collection(this.db, 'posts', id, 'cheers');
    const snap = await getDocs(query(col, limit(CHEER_LIMIT)));
    const ids = snap.docs.map((d) => d.id);
    if (ids.length < CHEER_LIMIT) return ids;
    const [n, mine] = await Promise.all([getCountFromServer(col), this.me && !ids.includes(this.me) ? getDoc(doc(this.db, 'posts', id, 'cheers', this.me)) : null]);
    const has = ids.includes(this.me) || !!mine?.exists();
    const count = Math.max(n.data().count, ids.length);
    return [...(has ? [this.me] : []), ...Array(Math.max(0, count - (has ? 1 : 0))).fill('')];
  }

  async _hydrate(docSnap) {
    const p = { id: docSnap.id, ...docSnap.data(), records: [], cheers: [] };
    const [recs, cheers] = await Promise.all([
      p.course || p.type === 'record' ? this._records(p.id, p.type) : null,
      this._cheers(p.id),
    ]);
    if (recs) p.records = recs;
    p.cheers = cheers;
    return p;
  }

  async _starters() {
    // 예시 코스는 글 목록 끝에 붙인다 (기록은 posts/{starter-id}/records, 응원은 posts/{starter-id}/cheers 에 쌓임)
    return Promise.all(STARTER_POSTS.map(async (s) => {
      const [records, cheers] = await Promise.all([this._records(s.id, 'course'), this._cheers(s.id)]);
      return { ...structuredClone(s), records, cheers };
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
    if (starter) return { ...structuredClone(starter), records: await this._records(id, 'course') };
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
    // 공개 글에는 정확한 나이를 쓰지 않는다 (나이대만). 기록 자랑을 새 기록으로 바꿀 때는 예전 글의 나이 칸도 지운다
    const { records, cheers, age, ...fields } = post;
    if (post.type === 'record') {
      const old = await this._myBrags(user, bragKey(post));
      if (old.length) {
        await writePublic((d) => this.F.updateDoc(this.F.doc(this.db, 'posts', old[0].id), d), { ...fields, age: this.F.deleteField() }, user.age);
        await Promise.all(old.slice(1).map((p) => this.F.deleteDoc(this.F.doc(this.db, 'posts', p.id)))); // 예전 중복 글 정리
        return { ...old[0], ...post, id: old[0].id, replaced: true };
      }
    }
    const ref = await writePublic((d) => this.F.addDoc(this.F.collection(this.db, 'posts'), d), fields, user.age);
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
      const { age, ...row } = scoreRow(user, score); // 공개 도전 기록에는 정확한 나이를 쓰지 않는다
      await writePublic((d) => this.F.setDoc(this.F.doc(this.db, 'posts', id, 'records', user.id), d), row, user.age);
      p.records = p.records.filter((r) => r.uid !== user.id).concat(row);
    }
    return scoreOutcome(p, user, Math.round(score), before, improved);
  }

  async cheer(user, id) {
    if (!user) throw new Error('로그인이 필요합니다');
    const ref = this.F.doc(this.db, 'posts', id, 'cheers', user.id);
    const snap = await this.F.getDoc(ref);
    if (snap.exists()) await this.F.deleteDoc(ref); else await this.F.setDoc(ref, { at: Date.now() });
    // 응원 수는 count 로 센다 (문서 전부를 읽지 않게)
    return (await this.F.getCountFromServer(this.F.collection(this.db, 'posts', id, 'cheers'))).data().count;
  }
}
