// 온라인 랭킹(account-firebase.js)의 순위 계산 검사: 가짜 Firestore(메모리)로 순위·읽기 수·쿼리 모양을 확인한다.
// - 순위는 count 쿼리로 세고, 연령대·국가·팀은 색인 칸(ags·cts·tms)의 범위로 센다
// - 모든 쿼리가 복합 색인 없이 되는 모양인지 (칸 하나의 범위·정렬, 또는 같음(==) 조건만)
// - 회원 게임 한 판 끝의 읽기 수
// 사용: node test/rank-firebase.mjs  (run.mjs 에서도 호출)
import { normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 메모리 Firestore: 이 앱이 쓰는 함수만. reads = 요금이 매겨지는 읽기 수 */
function fakeFirestore() {
  const docs = new Map(); // 'col/id' -> data
  const F = {
    docs, reads: 0, queries: [], denyIdx: false,
    collection: (_db, name) => ({ name, cons: [] }),
    doc: (_db, ...path) => ({ path: path.join('/') }),
    where: (field, op, value) => ({ t: 'where', field, op, value }),
    orderBy: (field, dir = 'asc') => ({ t: 'order', field, dir }),
    limit: (n) => ({ t: 'limit', n }),
    query: (col, ...cons) => ({ name: col.name, cons: [...col.cons, ...cons] }),
    serverTimestamp: () => 'SERVER_TIME',
    async getDoc(ref) { F.reads += 1; const d = docs.get(ref.path); return { exists: () => !!d, data: () => (d ? { ...d } : undefined) }; },
    async setDoc(ref, d) {
      if (F.denyIdx && ('ags' in d || 'cts' in d || 'tms' in d)) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
      docs.set(ref.path, { ...d });
    },
    async updateDoc(ref, d) { docs.set(ref.path, { ...docs.get(ref.path), ...d }); },
    async getDocs(q) { const rows = run(q); F.reads += Math.max(1, rows.length); return { docs: rows.map((r) => ({ data: () => ({ ...r }) })) }; },
    async getCountFromServer(q) { const n = run(q).length; F.reads += Math.max(1, Math.ceil(n / 1000)); return { data: () => ({ count: n }) }; },
  };
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const test = (v, op, x) => (op === '==' ? v === x : op === '>' ? v > x : op === '>=' ? v >= x : op === '<' ? v < x : op === '<=' ? v <= x : false);
  function run(q) {
    const wh = q.cons.filter((c) => c.t === 'where'), ord = q.cons.filter((c) => c.t === 'order'), lim = q.cons.find((c) => c.t === 'limit');
    // 복합 색인이 필요한 모양이면 실제 Firestore처럼 실패 (같음 조건만 있거나, 범위·정렬이 칸 하나뿐이어야 함)
    const fields = new Set([...wh.map((c) => c.field), ...ord.map((c) => c.field)]);
    const onlyEq = wh.every((c) => c.op === '==') && !ord.length;
    if (!onlyEq && fields.size > 1) throw new Error(`query needs a composite index: ${JSON.stringify(q.cons)}`);
    F.queries.push(q);
    let rows = [...docs].filter(([p]) => p.startsWith(`${q.name}/`)).map(([, d]) => d);
    for (const c of wh) rows = rows.filter((d) => c.field in d && test(d[c.field], c.op, c.value));
    for (const c of ord) rows = rows.filter((d) => c.field in d);
    if (ord.length) rows.sort((a, b) => ord.reduce((r, c) => r || (c.dir === 'desc' ? -cmp(a[c.field], b[c.field]) : cmp(a[c.field], b[c.field])), 0));
    return lim ? rows.slice(0, lim.n) : rows;
  }
  return F;
}

export async function checkRanks() {
  const { FirebaseAccountStore } = await import('../src/account-firebase.js');
  const { rankIdxFields, rankIdx } = await import('../src/account.js');
  const logs = [];
  let ok = true;
  const check = (name, cond, detail) => { logs.push(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' ' + JSON.stringify(detail) : ''}`); if (!cond) ok = false; };

  const MODE = 'arcade@60';
  const F = fakeFirestore();
  const put = (uid, score, ageGroup, country, team, legacy = false) => {
    const d = { uid, nick: uid, number: null, country, team, age: 11, ageGroup, mode: MODE, score, at: 1, plays: 1, t: 'x' };
    F.docs.set(`scores_${MODE}/${uid}`, legacy ? d : { ...d, ...rankIdxFields(d) });
  };
  put('ace', 900, '성인', 'KR', 'Hawks');
  put('a', 500, 'U12', 'KR', 'Seoul Youth');
  put('b', 400, 'U12', 'KR', 'seoul youth'); // 팀 이름 대소문자만 다름 = 같은 팀
  put('c', 400, 'U14', 'US', 'Hawks');       // b 와 같은 점수
  put('d', 300, 'U12', 'US', 'Hawks', true);  // 예전 문서: 색인 칸 없음
  const storeFor = (u) => Object.assign(new FirebaseAccountStore({}), { F, db: {}, site: {}, user: u });
  const me = { id: 'me', nick: 'me', number: 7, country: 'KR', team: 'Seoul Youth', age: 11, ageGroup: 'U12' };
  const st = storeFor(me);

  check('R1 rank index sorts inside its group: "U12|1000000450", team in lower case, no country = no field',
    rankIdx('U12', 450) === 'U12|1000000450' && rankIdx('U12', 2e6) === 'U12|1001000000' && rankIdx('U12', 450) > rankIdx('U12', 99) && rankIdx('U12', 0) > 'U12|'
    && JSON.stringify(rankIdxFields({ ageGroup: 'U12', team: 'Seoul Y', score: 5 })) === '{"ags":"U12|1000000005","tms":"seoul y|1000000005"}');

  // 회원 게임 한 판 끝: 기록 등록 + 전체 순위 + 연령대 순위
  F.reads = 0;
  const sub = await st.submitScore(MODE, 450);
  const all = await st.myRank(MODE, {});
  const age = await st.myRank(MODE, { ageGroup: 'U12' });
  const gameReads = F.reads;
  const saved = F.docs.get(`scores_${MODE}/me`);
  check('R2 member game end: score saved with rank index, overall and age-group rank by counting (ties share a rank, old docs without the index are left out of group ranks)',
    sub.improved && saved.ags === 'U12|1000000450' && saved.cts === 'KR|1000000450' && saved.tms === 'seoul youth|1000000450'
    && all.rank === 3 && all.total === 6 && age.rank === 2 && age.total === 3, { all, age });
  check('R3 member game end reads about 5 documents (was up to ~600: the top 300 twice)', gameReads <= 5, { gameReads });

  F.reads = 0;
  const guest = await storeFor(null).wouldRank(MODE, 400);
  check('R4 guest would-be rank by counting (same as rankAmong: ties go first), 2 reads', guest.rank === 4 && guest.total === 7 && F.reads === 2, { guest, reads: F.reads });

  F.reads = 0;
  const sum = await st.rankSummary(MODE);
  check('R5 My info rank: overall, my country, my team (team ignores case), 4 count reads (my score is remembered)',
    sum.world.rank === 3 && sum.world.total === 6 && sum.country.rank === 3 && sum.team.rank === 2 && F.reads === 4, { sum, reads: F.reads });

  F.reads = 0;
  const top = await st.leaderboard(MODE, {}, 100);
  const top2 = await st.leaderboard(MODE, {}, 100);
  check('R6 ranking list: highest first, ties share a rank, read once then cached for a minute',
    top.map((r) => `${r.uid}:${r.rank}`).join(',') === 'ace:1,a:2,me:3,b:4,c:4,d:6' && top2.length === 6 && F.reads === 6, { list: top.map((r) => `${r.uid}:${r.rank}`), reads: F.reads });

  const u12 = await st.leaderboard(MODE, { ageGroup: 'U12' }, 100);
  const combo = await st.leaderboard(MODE, { ageGroup: 'U12', team: 'SEOUL YOUTH' }, 100);
  const comboMe = await st.myRank(MODE, { ageGroup: 'U12', team: 'SEOUL YOUTH' });
  const otherAge = await st.myRank(MODE, { ageGroup: 'U14' });
  check('R7 filtered lists use the index field (age group; age group + team filtered on screen), my rank under combined filters',
    u12.map((r) => r.uid).join(',') === 'a,me,b' && combo.map((r) => `${r.uid}:${r.rank}`).join(',') === 'a:1,me:2,b:3' && comboMe.rank === 2 && comboMe.total === 3 && otherAge === null,
    { u12: u12.map((r) => r.uid), combo: combo.map((r) => r.uid), comboMe, otherAge });

  // 예전 문서의 주인이 내 정보를 열면 색인 칸이 채워지고, 그다음부터 연령대 순위에 들어간다
  const sd = storeFor({ id: 'd', nick: 'd', country: 'US', team: 'Hawks', age: 11, ageGroup: 'U12' });
  await sd.myScores([MODE, 'wide@60']);
  await new Promise((r) => setTimeout(r, 0));
  const dDoc = F.docs.get(`scores_${MODE}/d`);
  const dAge = await sd.myRank(MODE, { ageGroup: 'U12' });
  check('R8 an old score doc gets its rank index when its owner opens My info, then counts in group ranks',
    dDoc.ags === 'U12|1000000300' && dDoc.tms === 'hawks|1000000300' && dDoc.plays === 1 && dAge.rank === 4 && dAge.total === 4, { dAge });

  // 새 규칙을 게시하기 전(색인 칸을 거절): 색인 칸 없이 다시 써서 기록 등록은 된다
  F.denyIdx = true;
  const sn = storeFor({ id: 'new', nick: 'new', country: 'KR', team: 'X', age: 11, ageGroup: 'U12' });
  const subN = await sn.submitScore(MODE, 100);
  F.denyIdx = false;
  const nDoc = F.docs.get(`scores_${MODE}/new`);
  check('R9 before the new rules are published the score is still saved (without the index fields)', subN.best === 100 && nDoc.score === 100 && !('ags' in nDoc));

  check('R10 no query needs a composite index (single-field range/order or equality only)', F.queries.length > 0, { queries: F.queries.length });
  return { ok, logs };
}

if (process.argv[1] && normalize(process.argv[1]) === normalize(fileURLToPath(import.meta.url))) {
  try {
    const { ok, logs } = await checkRanks();
    for (const l of logs) console.log(l);
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.log(`FAIL online ranking check threw: ${err.stack || err}`);
    process.exit(1);
  }
}
