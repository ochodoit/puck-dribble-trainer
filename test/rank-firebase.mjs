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
    docs, reads: 0, writes: 0, queries: [],
    collection: (_db, name) => ({ name, cons: [] }),
    doc: (_db, ...path) => ({ path: path.join('/') }),
    where: (field, op, value) => ({ t: 'where', field, op, value }),
    orderBy: (field, dir = 'asc') => ({ t: 'order', field, dir }),
    limit: (n) => ({ t: 'limit', n }),
    query: (col, ...cons) => ({ name: col.name, cons: [...col.cons, ...cons] }),
    serverTimestamp: () => 'SERVER_TIME',
    async getDoc(ref) { F.reads += 1; const d = docs.get(ref.path); return { exists: () => !!d, data: () => (d ? { ...d } : undefined) }; },
    async setDoc(ref, d) { F.writes += 1; docs.set(ref.path, { ...d }); },
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
  const { rankIdxFields, rankIdx, PendingPlays } = await import('../src/account.js');
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

  // 능력치 기준: 나이대 기록이 5개보다 적으면 전체 1등 기준, 5개 이상이면 그 나이대 1등·상위 10%(기록 수 × 0.1 번째). 10분 동안 다시 읽지 않음
  {
    const putQ = (uid, score, ageGroup) => { const d = { uid, nick: uid, number: null, country: 'KR', team: 'T', age: 11, ageGroup, mode: 'quick', score, at: 1, plays: 1, t: 'x' }; F.docs.set(`scores_quick/${uid}`, { ...d, ...rankIdxFields(d) }); };
    putQ('q0', 90, '성인');
    [60, 55, 50, 45, 40, 35, 30, 25, 20, 15, 10].forEach((s, i) => putQ(`q${i + 1}`, s, 'U12'));
    const sa = storeFor(me);
    F.reads = 0;
    const all = await sa.abilityRef('quick', 'U8');
    const readsAll = F.reads; F.reads = 0;
    const grp = await sa.abilityRef('quick', 'U12');
    const readsGrp = F.reads; F.reads = 0;
    await sa.abilityRef('quick', 'U12');
    const readsAgain = F.reads;
    const rankG = await sa.abilityRank('quick', 52, 'U12', 'group'), rankA = await sa.abilityRank('quick', 52, 'U12', 'all');
    check('R14 stats base: age group #1 = 100 and the top-10% line (fewer than 5 records -> overall), a few reads, cached; my place in the group by counting',
      all.scope === 'all' && all.total === 12 && all.top === 90 && all.top10 === 60 && readsAll === 4
      && grp.scope === 'group' && grp.total === 11 && grp.top === 60 && grp.top10 === 55 && readsGrp === 3 && readsAgain === 0 && rankG === 3 && rankA === 4,
      { all, grp, readsAll, readsGrp, readsAgain, rankG, rankA });
  }

  // 최고 기록이 오를 때만 기록 문서를 쓰고, 못 넘은 판의 판수는 기기에 모았다가 10판마다·다음 최고 기록 때·로그아웃할 때 한 번에 쓴다
  const mem = new Map();
  const ls = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  let signedOut = false;
  const sp = Object.assign(storeFor({ id: 'p', nick: 'p', country: 'KR', team: 'X', age: 11, ageGroup: 'U12' }), { pending: new PendingPlays(ls), A: { signOut: () => { signedOut = true; } }, auth: {} });
  const pDoc = () => F.docs.get(`scores_${MODE}/p`);
  F.writes = 0;
  await sp.submitScore(MODE, 200);                                  // 첫 기록: 씀 (1판)
  for (let i = 0; i < 3; i++) await sp.submitScore(MODE, 100);      // 못 넘음: 쓰지 않고 3판 모아 둠
  const s1 = { writes: F.writes, plays: pDoc().plays, shown: (await sp.myScores([MODE]))[0].plays };
  await sp.submitScore(MODE, 250);                                  // 최고 기록: 모아 둔 3판 + 이번 판
  const d2 = pDoc(), s2 = { writes: F.writes, plays: d2.plays, score: d2.score };
  for (let i = 0; i < 10; i++) await sp.submitScore(MODE, 10);      // 10판째에 판수만 한 번 씀 (점수·기록 시각 그대로)
  await sp._flushing;
  const d3 = pDoc(), s3 = { writes: F.writes, plays: d3.plays, score: d3.score, sameAt: d3.at === d2.at, ags: d3.ags };
  for (let i = 0; i < 2; i++) await sp.submitScore(MODE, 10);
  sp.logout();                                                      // 로그아웃: 남은 2판을 쓰고 나서 로그인 계정에서 나감
  await sp._flushing; await new Promise((r) => setTimeout(r, 0));
  const s4 = { writes: F.writes, plays: pDoc().plays, left: mem.get('puck-trainer.pending-plays.v1'), signedOut, user: sp.user };
  check('R9 score doc is written only for a new best; other games pile up and are written every 10 games, with the next best, and at logout',
    s1.writes === 1 && s1.plays === 1 && s1.shown === 4 && s2.writes === 2 && s2.plays === 5 && s2.score === 250
    && s3.writes === 3 && s3.plays === 15 && s3.score === 250 && s3.sameAt && s3.ags === 'U12|1000000250'
    && s4.writes === 4 && s4.plays === 17 && s4.left === '{}' && s4.signedOut && s4.user === null, { s1, s2, s3, s4 });

  // 로그인 (가짜 Firebase Auth): 아이디 + 비밀번호, 예전 별명 계정 -> 아이디 만들기 (로그인 주소를 못 바꾸면 ids 의 주소로)
  {
    const L = await import('../src/account.js');
    const FA = fakeFirestore();
    FA.writeBatch = () => { const ops = []; return { set: (r, d) => ops.push(() => FA.docs.set(r.path, { ...d })), update: (r, d) => ops.push(() => FA.docs.set(r.path, { ...FA.docs.get(r.path), ...d })), commit: async () => ops.forEach((f) => f()) }; };
    const accounts = new Map(); // 로그인 주소 -> { uid, password }
    const auth = { currentUser: null };
    const bad = () => Object.assign(new Error('bad'), { code: 'auth/invalid-credential' });
    const A = {
      async signInWithEmailAndPassword(_a, email, pw) { const x = accounts.get(email); if (!x || x.password !== pw) throw bad(); auth.currentUser = { uid: x.uid, email }; },
      async updatePassword(cu, pw) { accounts.get(cu.email).password = pw; },
      async updateEmail() { throw Object.assign(new Error('no'), { code: 'auth/operation-not-allowed' }); }, // 이메일 열거 보호가 켜진 프로젝트
      signOut() { auth.currentUser = null; },
    };
    const sa = Object.assign(new FirebaseAccountStore({ authDomain: 'demo.firebaseapp.com' }), { F: FA, A, auth, db: {}, site: {} });
    accounts.set(sa._email('옛친구'), { uid: 'old1', password: '135790' });
    FA.docs.set('users/old1', { nick: '옛친구', nickLower: '옛친구', country: 'KR', team: 'T', age: 20, ageGroup: '성인' });
    accounts.set('id.newbie@demo.firebaseapp.com', { uid: 'new1', password: 'newb1234' });
    FA.docs.set('users/new1', { loginId: 'newbie', nick: '뉴비', nickLower: '뉴비', country: 'KR', team: 'T', age: 12, ageGroup: 'U14' });
    FA.docs.set('ids/newbie', { uid: 'new1', email: 'id.newbie@demo.firebaseapp.com' });
    const msg = async (f) => { try { await f(); return 'ok'; } catch (e) { return e.message; } };
    const r = {};
    r.newbie = await msg(() => sa.login('NewBie', 'newb1234')) === 'ok' && sa.current()?.nick === '뉴비';
    sa.logout();
    r.nickOfNew = await msg(() => sa.login('뉴비', 'newb1234'));
    r.legacy = await msg(() => sa.login('옛친구', '135790'));
    r.waiting = { cur: sa.current(), up: sa.needsUpgrade() };
    r.weak = await msg(() => sa.upgradeLogin('oldfriend', '12345678'));
    r.taken = await msg(() => sa.upgradeLogin('newbie', 'newpass12')); // 가입할 때 생긴 ids/newbie 가 있다
    r.upgrade = await msg(() => sa.upgradeLogin('oldfriend', 'newpass12'));
    r.ids = FA.docs.get('ids/oldfriend'); r.profile = FA.docs.get('users/old1').loginId; r.cur = sa.current()?.loginId;
    sa.logout();
    r.byId = await msg(() => sa.login('oldfriend', 'newpass12')) === 'ok' && sa.current()?.nick === '옛친구';
    sa.logout();
    r.byNick = await msg(() => sa.login('옛친구', 'newpass12'));
    r.afterNick = { cur: sa.current(), signedIn: !!auth.currentUser };
    r.oldPin = await msg(() => sa.login('oldfriend', '135790'));
    check('R11 login: ID + password; old nickname account must create an ID (kept logged out until then), then only the ID works',
      r.newbie && r.nickOfNew === L.BAD_LOGIN_MSG && r.legacy === 'ok' && r.waiting.cur === null && r.waiting.up?.nick === '옛친구'
      && r.weak === '비밀번호에 영문과 숫자를 함께 넣으세요' && r.taken === L.ID_TAKEN && r.upgrade === 'ok'
      && r.ids?.uid === 'old1' && r.ids?.email === sa._email('옛친구') && r.profile === 'oldfriend' && r.cur === 'oldfriend'
      && r.byId && r.byNick === L.USE_ID_MSG && r.afterNick.cur === null && !r.afterNick.signedIn && r.oldPin === L.BAD_LOGIN_MSG, r);

    // 임시 비밀번호 (운영자가 tools/admin/reset-password.mjs 로 줌 = 비밀번호를 바꾸고 users/{uid}.tempPw = true)
    const DEL = '__DELETE_FIELD__';
    const patch = (prev, d) => { const o = { ...prev }; for (const [k, v] of Object.entries(d)) { if (v === DEL) delete o[k]; else o[k] = v; } return o; };
    FA.deleteField = () => DEL;
    FA.updateDoc = async (ref, d) => { FA.docs.set(ref.path, patch(FA.docs.get(ref.path), d)); };
    FA.writeBatch = () => { const ops = []; return { set: (rf, d) => ops.push(() => FA.docs.set(rf.path, { ...d })), update: (rf, d) => ops.push(() => FA.docs.set(rf.path, patch(FA.docs.get(rf.path), d))), commit: async () => ops.forEach((f) => f()) }; };
    A.EmailAuthProvider = { credential: (email, password) => ({ email, password }) };
    A.reauthenticateWithCredential = async (cu, c) => { if (accounts.get(cu.email)?.password !== c.password) throw bad(); };
    const giveTemp = (email, uid, temp) => { accounts.get(email).password = temp; FA.docs.set(`users/${uid}`, { ...FA.docs.get(`users/${uid}`), tempPw: true }); };
    const t = {};
    sa.logout();
    giveTemp('id.newbie@demo.firebaseapp.com', 'new1', 'abcd-efgh-2345');
    t.login = await msg(() => sa.login('newbie', 'abcd-efgh-2345'));
    t.waiting = { cur: sa.current(), up: sa.needsUpgrade() };
    t.notId = await msg(() => sa.upgradeLogin('newbie2', 'fresh2026'));
    t.weak = await msg(() => sa.resetTempPassword('12345678'));
    t.same = await msg(() => sa.resetTempPassword('abcd-efgh-2345'));
    t.reset = await msg(() => sa.resetTempPassword('fresh2026'));
    t.after = { nick: sa.current()?.nick, flag: 'tempPw' in FA.docs.get('users/new1'), pw: accounts.get('id.newbie@demo.firebaseapp.com').password };
    sa.logout();
    t.relogin = await msg(() => sa.login('newbie', 'fresh2026')) === 'ok' && sa.current()?.nick === '뉴비';
    t.wrongCur = await msg(() => sa.changePassword('nope1234', 'fresh2027'));
    t.sameCur = await msg(() => sa.changePassword('fresh2026', 'fresh2026'));
    t.change = await msg(() => sa.changePassword('fresh2026', 'fresh2027'));
    t.changed = accounts.get('id.newbie@demo.firebaseapp.com').password;
    sa.logout();
    // 아이디를 만든 예전 계정(로그인 주소는 예전 별명 주소): 별명 + 임시 비밀번호로는 못 들어오고 아이디로
    giveTemp(sa._email('옛친구'), 'old1', 'temp-oldf-2345');
    t.nickTemp = await msg(() => sa.login('옛친구', 'temp-oldf-2345'));
    t.idTemp = await msg(() => sa.login('oldfriend', 'temp-oldf-2345')) === 'ok' && sa.needsUpgrade()?.kind === 'password';
    sa.logout();
    // 아이디가 없는 예전 계정이 임시 비밀번호를 받음: 아이디 만들기에서 새 비밀번호도 정하고 tempPw 도 지운다
    accounts.set(sa._email('옛둘'), { uid: 'old2', password: 'x' });
    FA.docs.set('users/old2', { nick: '옛둘', nickLower: '옛둘', country: 'KR', team: 'T', age: 30, ageGroup: '성인' });
    giveTemp(sa._email('옛둘'), 'old2', 'temp-two2-2345');
    t.old2 = await msg(() => sa.login('옛둘', 'temp-two2-2345'));
    t.old2up = sa.needsUpgrade();
    t.old2same = await msg(() => sa.upgradeLogin('oldtwo', 'temp-two2-2345'));
    t.old2ok = await msg(() => sa.upgradeLogin('oldtwo', 'second2026'));
    t.old2doc = FA.docs.get('users/old2');
    check('R12 temp password: login stays out until a new password is set (not the temp one), the flag is cleared, then the new password works; members change passwords with the current one',
      t.login === 'ok' && t.waiting.cur === null && t.waiting.up?.kind === 'password' && t.waiting.up?.loginId === 'newbie'
      && t.notId === L.NEED_TEMP_MSG && t.weak === '비밀번호에 영문과 숫자를 함께 넣으세요' && t.same === L.SAME_PW_MSG && t.reset === 'ok'
      && t.after.nick === '뉴비' && !t.after.flag && t.after.pw === 'fresh2026' && t.relogin
      && t.wrongCur === '지금 비밀번호가 맞지 않습니다' && t.sameCur === '새 비밀번호가 지금 비밀번호와 같습니다' && t.change === 'ok' && t.changed === 'fresh2027'
      && t.nickTemp === L.USE_ID_MSG && t.idTemp
      && t.old2 === 'ok' && t.old2up?.kind === 'id' && t.old2same === L.SAME_PW_MSG && t.old2ok === 'ok' && t.old2doc.loginId === 'oldtwo' && !('tempPw' in t.old2doc), t);

    // 오래된 로그인 (저장돼 있던 로그인으로 아이디 만들기 칸이 뜬 경우): Firebase 가 비밀번호 바꾸기를 막는다(requires-recent-login)
    // -> 내보내고 다시 로그인하라고 알린다. 아무것도 바뀌지 않고, 다시 로그인하면 바로 이어서 된다
    sa.logout();
    accounts.set(sa._email('옛셋'), { uid: 'old3', password: '246810' });
    FA.docs.set('users/old3', { nick: '옛셋', nickLower: '옛셋', country: 'KR', team: 'T', age: 15, ageGroup: 'U16' });
    const s = {};
    s.login = await msg(() => sa.login('옛셋', '246810'));
    const realUpdate = A.updatePassword;
    A.updatePassword = async () => { throw Object.assign(new Error('old'), { code: 'auth/requires-recent-login' }); };
    s.stale = await msg(() => sa.upgradeLogin('oldthree', 'third2026'));
    s.after = { cur: sa.current(), up: sa.needsUpgrade(), signedIn: !!auth.currentUser, ids: FA.docs.get('ids/oldthree') ?? null, pw: accounts.get(sa._email('옛셋')).password };
    A.updatePassword = realUpdate;
    s.again = await msg(() => sa.login('옛셋', '246810'));
    s.ok = await msg(() => sa.upgradeLogin('oldthree', 'third2026'));
    s.loginId = sa.current()?.loginId;
    // 저장돼 있던 로그인이 얼마나 오래됐는지 (페이지를 열 때 오래됐으면 정하는 칸 대신 로그인부터)
    const at = (msAgo) => ({ metadata: { lastSignInTime: new Date(Date.now() - msAgo).toUTCString() } });
    const recent = (cu) => { const keep = auth.currentUser; auth.currentUser = cu; const r = sa._recentLogin(); auth.currentUser = keep; return r; };
    s.fresh = recent(at(60 * 1000)); s.old = recent(at(10 * 60 * 1000)); s.unknown = recent({});
    check('R13 stale login: changing the password is refused -> logged out with a re-login notice, nothing changed; after logging in again the ID is created. Old saved logins (4+ min) ask to log in first',
      s.login === 'ok' && s.stale === L.RELOGIN_MSG && s.after.cur === null && s.after.up === null && !s.after.signedIn && s.after.ids === null && s.after.pw === '246810'
      && s.again === 'ok' && s.ok === 'ok' && s.loginId === 'oldthree' && s.fresh === true && s.old === false && s.unknown === true, s);
  }

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
