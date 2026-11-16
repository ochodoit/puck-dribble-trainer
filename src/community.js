// 커뮤니티: 직접 만든 코스(사이클)와 기록을 공유하고, 같은 코스로 기록을 겨룬다.
// 기본은 기기 내(localStorage) 저장. firebase-config.js 가 채워지면 온라인 저장소(community-firebase.js)로 전환.
//
// 글 종류
//  - course : 자유 연습에서 만든 코스 + 무엇이 좋아지는지 설명 + 글쓴이의 사이클 기록. 다른 사람이 같은 코스로 도전해 기록 게시판에 오른다.
//  - record : 게임(아케이드 등) 점수 자랑.
//  - beat   : 다른 사람의 코스 기록을 갈아치웠다는 글 (원본 코스로 이어진다).

export const TITLE_MAX = 30;
export const BODY_MAX = 200;
export const POST_TYPES = ['course', 'record', 'beat'];

const r3 = (v) => Math.round(v * 1000) / 1000;
const cleanPoints = (pts) => (Array.isArray(pts) ? pts : [])
  .filter((p) => p && Number.isInteger(p.n) && p.n >= 1 && p.n <= 10 && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)
  .filter((p, i, arr) => arr.findIndex((q) => q.n === p.n) === i)
  .map((p) => ({ n: p.n, x: r3(p.x), y: r3(p.y) }))
  .sort((a, b) => a.n - b.n);

/** 코스 서명: 포인트 배치와 목표 사이클 수가 같아야 같은 코스 (기록을 공정하게 비교하기 위함) */
export function courseSig(points, cycles) {
  return cleanPoints(points).map((p) => `${p.n}:${p.x.toFixed(3)},${p.y.toFixed(3)}`).join('|') + `@${cycles}`;
}

const isTime = (v) => Number.isFinite(v) && v > 0 && v < 3600;
const cleanRecord = (r) => (r && isTime(r.avg) && isTime(r.best) ? { avg: r3(r.avg), best: r3(Math.min(r.best, r.avg)) } : null);

/** 사이클 기록 비교: 평균 사이클 시간이 짧을수록 좋고, 같으면 가장 빠른 사이클로 가른다 */
export function betterRecord(a, b) {
  if (!a) return false;
  if (!b) return true;
  return a.avg < b.avg || (a.avg === b.avg && a.best < b.best);
}

/** 글 내용 검증 + 정리. 문제가 있으면 { error }, 없으면 { post } (저장할 필드만) */
export function buildPost(user, data) {
  if (!user) return { error: '로그인이 필요합니다' };
  const type = data?.type;
  if (!POST_TYPES.includes(type)) return { error: '글 종류를 선택하세요' };
  const title = String(data.title || '').trim();
  const body = String(data.body || '').trim();
  if (!title) return { error: '제목을 입력하세요' };
  if (title.length > TITLE_MAX) return { error: `제목은 ${TITLE_MAX}자까지` };
  if (body.length > BODY_MAX) return { error: `내용은 ${BODY_MAX}자까지` };
  const post = {
    type, title, body, at: Date.now(),
    uid: user.id, nick: user.nick, number: Number.isInteger(user.number) ? user.number : null, team: user.team, country: user.country, ageGroup: user.ageGroup,
    records: [], cheers: [],
  };
  if (type === 'record') {
    if (!data.modeId || !Number.isFinite(data.score)) return { error: '자랑할 기록이 없습니다' };
    post.modeId = String(data.modeId); post.seconds = Number(data.seconds) || 0; post.score = Math.round(data.score);
    return { post };
  }
  const course = cleanPoints(data.course);
  const cycles = Number(data.cycles);
  if (course.length < 2) return { error: '코스에 포인트를 2개 이상 놓으세요' };
  if (!Number.isInteger(cycles) || cycles < 10 || cycles > 100 || cycles % 10) return { error: '사이클 수가 올바르지 않습니다' };
  post.course = course; post.cycles = cycles; post.record = cleanRecord(data.record);
  if (type === 'course' && !body) return { error: '이 코스를 연습하면 무엇이 좋아지는지 적어 주세요' };
  if (type === 'beat') {
    if (!post.record || !data.ref?.id) return { error: '갈아치운 기록이 없습니다' };
    post.ref = { id: String(data.ref.id), title: String(data.ref.title || '').slice(0, TITLE_MAX), nick: String(data.ref.nick || '').slice(0, 12), avg: Number(data.ref.avg) || 0 };
  }
  return { post };
}

/** 기록 게시판: 글쓴이 기록 + 도전자 기록을 평균 사이클 순으로 (한 사람당 최고 기록 하나) */
export function boardOf(post) {
  const rows = [];
  if (post.record) rows.push({ uid: post.uid, nick: post.nick, team: post.team, country: post.country, avg: post.record.avg, best: post.record.best, at: post.at, author: true });
  for (const r of post.records || []) {
    const i = rows.findIndex((x) => x.uid === r.uid);
    if (i < 0) rows.push({ ...r });
    else if (betterRecord(r, rows[i])) rows[i] = { ...r, author: rows[i].author };
  }
  rows.sort((a, b) => a.avg - b.avg || a.best - b.best || a.at - b.at);
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

/** 처음부터 들어 있는 예시 코스 (누구나 바로 연습해 볼 수 있게). 기록은 비어 있어 첫 완주자가 기록 보유자가 된다 */
export const STARTER_POSTS = [
  { id: 'starter-wide', title: '좌우 와이드', body: '몸 앞에서 좌우 끝까지 넓게 움직이는 기본 코스. 리치와 손목 롤이 좋아집니다.',
    course: [{ n: 1, x: 0.14, y: 0.6 }, { n: 2, x: 0.86, y: 0.6 }], cycles: 10 },
  { id: 'starter-triangle', title: '삼각 컨트롤', body: '앞·좌·우 세 점을 도는 코스. 퍽을 당겼다 미는 앞뒤 컨트롤과 방향 전환이 좋아집니다.',
    course: [{ n: 1, x: 0.5, y: 0.3 }, { n: 2, x: 0.82, y: 0.78 }, { n: 3, x: 0.18, y: 0.78 }], cycles: 10 },
  { id: 'starter-zigzag', title: '지그재그 5포인트', body: '좌우로 엇갈린 다섯 점을 순서대로. 빠른 손과 시선 올리기(헤드업) 연습에 좋습니다.',
    course: [{ n: 1, x: 0.12, y: 0.38 }, { n: 2, x: 0.32, y: 0.8 }, { n: 3, x: 0.5, y: 0.38 }, { n: 4, x: 0.68, y: 0.8 }, { n: 5, x: 0.88, y: 0.38 }], cycles: 10 },
].map((p, i) => ({ ...p, type: 'course', official: true, uid: 'official', nick: 'Puck Trainer', team: '', country: '', ageGroup: '', at: 1700000000000 - i * 1000, record: null, records: [], cheers: [] }));

/** 기기 내 저장소. 같은 기기를 쓰는 선수들끼리 글과 기록을 공유한다 */
export class LocalCommunityStore {
  constructor(storage = globalThis.localStorage) {
    this.kind = 'local';
    this.storage = storage;
    this.KEY = 'puck-trainer.community.v1';
  }

  _load() {
    let posts = null;
    try { const v = this.storage.getItem(this.KEY); posts = v ? JSON.parse(v) : null; } catch { posts = null; }
    if (!Array.isArray(posts)) posts = structuredClone(STARTER_POSTS); // 처음 열면 예시 코스를 넣어 둔다
    return posts;
  }
  _save(posts) { try { this.storage.setItem(this.KEY, JSON.stringify(posts)); } catch { /* ignore */ } }

  /** 최신 글부터. filter: 'all' | 'course' | 'record'(기록 자랑 + 기록 갱신) */
  async list(filter = 'all') {
    const posts = this._load().filter((p) => filter === 'all' || (filter === 'course' ? p.type === 'course' : p.type !== 'course'));
    return posts.sort((a, b) => b.at - a.at);
  }

  async get(id) { return this._load().find((p) => p.id === id) || null; }

  async create(user, data) {
    const { error, post } = buildPost(user, data);
    if (error) throw new Error(error);
    post.id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const posts = this._load();
    posts.push(post);
    this._save(posts);
    return post;
  }

  async remove(user, id) {
    const posts = this._load();
    const p = posts.find((x) => x.id === id);
    if (!p) return false;
    if (!user || p.uid !== user.id || p.official) throw new Error('내가 쓴 글만 지울 수 있습니다');
    this._save(posts.filter((x) => x.id !== id));
    return true;
  }

  /**
   * 코스 도전 기록 등록 (한 사람당 최고 기록만 유지).
   * 반환: { improved, rank, total, prevHolder, isHolder, beatAuthor }
   *  - prevHolder: 등록 전 1위 (없으면 null) / isHolder: 등록 후 내가 1위 / beatAuthor: 글쓴이 기록보다 좋음
   */
  async submitRecord(user, id, rec) {
    if (!user) throw new Error('로그인이 필요합니다');
    const record = cleanRecord(rec);
    if (!record) throw new Error('기록이 올바르지 않습니다');
    const posts = this._load();
    const p = posts.find((x) => x.id === id);
    if (!p || !p.course) throw new Error('글을 찾을 수 없습니다');
    const before = boardOf(p);
    const prevHolder = before[0] || null;
    const mine = before.find((r) => r.uid === user.id) || null;
    const improved = betterRecord(record, mine);
    if (improved) {
      if (p.uid === user.id) p.record = record; // 글쓴이 본인이 자기 기록을 고침
      else {
        p.records = (p.records || []).filter((r) => r.uid !== user.id);
        p.records.push({ uid: user.id, nick: user.nick, team: user.team, country: user.country, ...record, at: Date.now() });
      }
      this._save(posts);
    }
    const after = boardOf(p);
    const me = after.find((r) => r.uid === user.id);
    return {
      improved, rank: me ? me.rank : null, total: after.length, prevHolder,
      isHolder: !!me && me.rank === 1,
      beatAuthor: p.uid !== user.id && !!p.record && betterRecord(record, p.record),
    };
  }

  /** 응원(한 사람당 한 번, 다시 누르면 취소). 반환: 응원 수 */
  async cheer(user, id) {
    if (!user) throw new Error('로그인이 필요합니다');
    const posts = this._load();
    const p = posts.find((x) => x.id === id);
    if (!p) throw new Error('글을 찾을 수 없습니다');
    p.cheers = p.cheers || [];
    p.cheers = p.cheers.includes(user.id) ? p.cheers.filter((u) => u !== user.id) : [...p.cheers, user.id];
    this._save(posts);
    return p.cheers.length;
  }
}

/** 계정 저장소가 온라인(firebase)이면 커뮤니티도 온라인으로, 아니면 기기 내 */
export async function createCommunityStore(account) {
  if (account?.kind === 'firebase') {
    try {
      const { FirebaseCommunityStore } = await import('./community-firebase.js');
      return new FirebaseCommunityStore(account);
    } catch (err) {
      console.warn('온라인 커뮤니티 저장소를 열지 못해 기기 내 저장소를 사용합니다:', err);
    }
  }
  return new LocalCommunityStore();
}
