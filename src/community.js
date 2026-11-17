// 커뮤니티: 직접 만든 코스(사이클)와 기록을 공유하고, 같은 코스로 기록을 겨룬다.
// 기본은 기기 내(localStorage) 저장. firebase-config.js 가 채워지면 온라인 저장소(community-firebase.js)로 전환.
//
// 글 종류
//  - course : 자유 연습에서 만든 코스 + 무엇이 좋아지는지 설명 + 글쓴이의 사이클 기록. 다른 사람이 같은 코스로 도전해 기록 게시판에 오른다.
//  - record : 게임(아케이드 등) 점수 자랑. 한 사람이 모드(모드·시간·투명)마다 하나만 — 다시 올리면 그 글이 새 기록으로 바뀐다.
//             다른 사람이 '나도 연습하기'로 같은 모드를 플레이하면, 글쓴이와 나이가 같거나 어린 선수의 점수만 도전 기록에 오른다.
//  - beat   : 다른 사람의 코스 기록을 갈아치웠다는 글 (원본 코스로 이어진다).

export const TITLE_MAX = 30;
export const BODY_MAX = 200;
export const POST_TYPES = ['course', 'record', 'beat'];
export const BOARD_TOP = 5;     // 글을 눌렀을 때 보여주는 상위 기록 수

/** 기록 자랑의 비교 키: 모드 + 시간 + 투명 모드 (game.js 의 rankKey 와 같은 규칙: arcade@60, arcade@60-inv, wide) */
export const bragKey = (p) => `${p.modeId}${p.seconds ? `@${p.seconds}` : ''}${p.invisible ? '-inv' : ''}`;

/** 글이 속한 게임 모드: 코스·기록 갱신 글은 자유 연습 */
export const postMode = (p) => (p.type === 'record' ? p.modeId : 'free');

// 나이가 없는 예전 글은 연령대의 가장 많은 나이로 본다 (U8 = 7세 이하 …)
const AGE_GROUP_MAX = { U8: 7, U10: 9, U12: 11, U14: 13, U16: 15, U18: 17, '성인': 39, '시니어': 99 };
/** 기록 자랑 글쓴이의 나이 (이 나이 이하만 도전 기록이 오른다). 알 수 없으면 null = 제한 없음 */
export function postAge(p) {
  if (Number.isInteger(p?.age)) return p.age;
  return AGE_GROUP_MAX[p?.ageGroup] ?? null;
}
/** 이 선수의 점수가 이 자랑 글의 도전 기록에 오를 수 있는가: 로그인 + 글쓴이와 나이가 같거나 어림 */
export function canRecordOn(user, post) {
  if (!user) return false;
  const limit = postAge(post);
  return limit === null || (Number.isFinite(user.age) && user.age <= limit);
}

/**
 * 글 목록 거르기·정렬 (두 저장소 공통).
 * opts: { type: 'all'|'course'|'record', mode: ''|모드 id, sort: 'recent'|'cheers' } (예전처럼 문자열이면 type)
 */
export function arrangePosts(posts, opts = {}) {
  const o = typeof opts === 'string' ? { type: opts } : opts;
  const type = o.type || 'all', mode = o.mode || '', sort = o.sort || 'recent';
  const out = posts.filter((p) => (type === 'all' || (type === 'course' ? p.type === 'course' : p.type !== 'course'))
    && (!mode || postMode(p) === mode));
  const cheers = (p) => (p.cheers || []).length;
  return out.sort(sort === 'cheers' ? (a, b) => cheers(b) - cheers(a) || b.at - a.at : (a, b) => b.at - a.at);
}

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
    age: Number.isInteger(user.age) ? user.age : null,
    records: [], cheers: [],
  };
  if (type === 'record') {
    if (!data.modeId || !Number.isFinite(data.score)) return { error: '자랑할 기록이 없습니다' };
    post.modeId = String(data.modeId); post.seconds = Number(data.seconds) || 0; post.score = Math.round(data.score);
    post.invisible = data.invisible === true;
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

/** 기록 자랑의 도전 기록: 글쓴이 점수 + 도전자 점수(한 사람당 최고 하나)를 높은 순으로. 같은 점수는 먼저 세운 기록이 위 */
export function scoreBoardOf(post) {
  const rows = [{ uid: post.uid, nick: post.nick, number: post.number ?? null, team: post.team, country: post.country, age: post.age ?? null, score: post.score, at: post.at, author: true }];
  for (const r of post.records || []) {
    if (!Number.isFinite(r.score) || r.uid === post.uid) continue;
    const i = rows.findIndex((x) => x.uid === r.uid);
    if (i < 0) rows.push({ ...r });
    else if (r.score > rows[i].score) rows[i] = { ...r };
  }
  rows.sort((a, b) => b.score - a.score || a.at - b.at);
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

/** 글 종류에 맞는 기록 게시판 (코스 = 평균 사이클 순, 기록 자랑 = 점수 순). 기록 갱신 글은 원본 코스 글의 게시판을 쓴다 */
export const boardFor = (post) => (post.type === 'record' ? scoreBoardOf(post) : boardOf(post));
/** 도전한 사람 수 (글쓴이 제외) */
export const challengerCount = (post) => boardFor(post).filter((r) => !r.author).length;

/**
 * 기록 자랑 도전 기록 등록 결과 (저장 후 게시판 기준).
 * 반환: { eligible, limit, improved, rank, total, prevHolder, isHolder, beatAuthor, challengers }
 */
export function scoreOutcome(post, user, score, before, improved) {
  const after = scoreBoardOf(post);
  const me = after.find((r) => r.uid === user.id);
  return {
    eligible: true, limit: postAge(post), improved, rank: me ? me.rank : null, total: after.length, prevHolder: before[0] || null,
    isHolder: !!me && me.rank === 1, beatAuthor: score > post.score, challengers: after.length - 1,
  };
}

/** 등록할 수 없을 때(나이·글쓴이 본인)의 결과 */
export function scoreRejected(post, user, reason) {
  const board = scoreBoardOf(post);
  return { eligible: false, reason, limit: postAge(post), improved: false, rank: null, total: board.length, prevHolder: board[0] || null, isHolder: false, beatAuthor: false, challengers: board.length - 1, myAge: user?.age ?? null };
}

export const scoreRow = (user, score) => ({
  uid: user.id, nick: user.nick, number: Number.isInteger(user.number) ? user.number : null, team: user.team, country: user.country,
  age: Number.isInteger(user.age) ? user.age : null, score: Math.round(score), at: Date.now(),
});

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

  /**
   * 글 목록. opts: { type: 'all'|'course'|'record'(기록 자랑 + 기록 갱신), mode: 모드 id, sort: 'recent'|'cheers' }
   * (예전처럼 문자열 하나면 type)
   */
  async list(opts = 'all') { return arrangePosts(this._load(), opts); }

  async get(id) { return this._load().find((p) => p.id === id) || null; }

  /** 내가 이 모드(모드·시간·투명)로 올린 기록 자랑 글 (모드마다 하나) */
  async myBrag(user, key) {
    if (!user) return null;
    return this._load().filter((p) => p.type === 'record' && p.uid === user.id && bragKey(p) === key).sort((a, b) => b.at - a.at)[0] || null;
  }

  /** 글 올리기. 기록 자랑은 모드마다 하나: 이미 있으면 그 글을 새 기록으로 바꾼다 (응원·도전 기록은 유지) -> { ...post, replaced: true } */
  async create(user, data) {
    const { error, post } = buildPost(user, data);
    if (error) throw new Error(error);
    const posts = this._load();
    if (post.type === 'record') {
      const old = posts.filter((p) => p.type === 'record' && p.uid === user.id && bragKey(p) === bragKey(post)).sort((a, b) => b.at - a.at);
      if (old.length) {
        const keep = old[0];
        const { records, cheers, ...fields } = post;
        Object.assign(keep, fields);
        const drop = new Set(old.slice(1).map((p) => p.id)); // 예전에 여러 개 올라가 있었다면 하나만 남긴다
        this._save(posts.filter((p) => !drop.has(p.id)));
        return { ...keep, replaced: true };
      }
    }
    post.id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    posts.push(post);
    this._save(posts);
    return post;
  }

  /**
   * 기록 자랑 도전 기록 등록 ('나도 연습하기' 후 같은 모드를 끝까지 플레이).
   * 글쓴이와 나이가 같거나 어린 선수만, 한 사람당 최고 점수 하나. 글쓴이 본인은 등록하지 않는다(글을 다시 올리면 바뀜).
   */
  async submitScore(user, id, score) {
    if (!user) throw new Error('로그인이 필요합니다');
    if (!Number.isFinite(score) || score < 0) throw new Error('기록이 올바르지 않습니다');
    const posts = this._load();
    const p = posts.find((x) => x.id === id);
    if (!p || p.type !== 'record') throw new Error('글을 찾을 수 없습니다');
    if (p.uid === user.id) return scoreRejected(p, user, 'author');
    if (!canRecordOn(user, p)) return scoreRejected(p, user, 'age');
    const before = scoreBoardOf(p);
    const mine = (p.records || []).find((r) => r.uid === user.id);
    const improved = !mine || Math.round(score) > mine.score;
    if (improved) {
      p.records = (p.records || []).filter((r) => r.uid !== user.id);
      p.records.push(scoreRow(user, score));
      this._save(posts);
    }
    return scoreOutcome(p, user, Math.round(score), before, improved);
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
