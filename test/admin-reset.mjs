// 운영자 임시 비밀번호 도구(tools/admin/reset-password.mjs) 검사: 가짜 Auth·Firestore 로 (실제 Firebase 에 접속하지 않음, firebase-admin 설치 없이)
// 사용: node test/admin-reset.mjs  (run.mjs 에서도 호출)
import { normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findMember, resetPassword, makeTempPassword, describe, dmText } from '../tools/admin/reset-password.mjs';

function fakes() {
  const docs = new Map(), calls = [];
  const db = {
    doc: (path) => ({
      async get() { return { exists: docs.has(path), data: () => docs.get(path) }; },
      async update(patch) { if (!docs.has(path)) throw Object.assign(new Error('no doc'), { code: 5 }); calls.push(['update', path, patch]); docs.set(path, { ...docs.get(path), ...patch }); },
    }),
  };
  const users = new Map();
  const auth = {
    async getUser(uid) { if (!users.has(uid)) throw Object.assign(new Error('nope'), { code: 'auth/user-not-found' }); return users.get(uid); },
    async updateUser(uid, p) { calls.push(['updateUser', uid, Object.keys(p)]); users.get(uid).password = p.password; },
    async revokeRefreshTokens(uid) { calls.push(['revoke', uid]); },
  };
  return { db, auth, docs, users, calls };
}

export async function checkAdminReset() {
  const logs = [];
  let ok = true;
  const check = (name, cond, info) => { logs.push(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ` ${JSON.stringify(info)}`}`); if (!cond) ok = false; };

  const f = fakes();
  f.docs.set('ids/bungae11', { uid: 'U1', email: 'id.bungae11@x' });
  f.docs.set('nicks/번개손', { uid: 'U1' });
  f.docs.set('users/U1', { loginId: 'bungae11', nick: '번개손', team: '서울 유스', age: 11, ageGroup: 'U12', country: 'KR', stick: 'L', memberNo: 7, joinedAt: Date.UTC(2026, 10, 2) });
  f.users.set('U1', { uid: 'U1', metadata: { lastSignInTime: 'Tue, 18 Nov 2026 10:00:00 GMT' } });
  f.docs.set('nicks/옛친구', { uid: 'U2' });
  f.docs.set('users/U2', { nick: '옛친구', team: 'B', age: 9, ageGroup: 'U10', memberNo: 2, joinedAt: { toMillis: () => Date.UTC(2026, 9, 1) } });
  f.users.set('U2', { uid: 'U2', metadata: {} });
  // 아이디 'acehero' 는 U3, 별명 'acehero' 는 U4: 서로 다른 회원
  f.docs.set('ids/acehero', { uid: 'U3' });
  f.docs.set('nicks/acehero', { uid: 'U4' });

  const byId = await findMember(f, { query: ' Bungae11 ' });
  const byNick = await findMember(f, { query: '번개손' });
  const legacy = await findMember(f, { query: '옛친구' });
  const none = await findMember(f, { query: 'nobody99' });
  const amb = await findMember(f, { query: 'AceHero' });
  const byUid = await findMember(f, { uid: 'U2' });
  check('AR1 find by ID (case/space ignored), by nickname, by uid; unknown -> null',
    byId?.uid === 'U1' && byId.by === 'id' && byNick?.uid === 'U1' && byNick.by === 'nick' && legacy?.uid === 'U2' && byUid?.by === 'uid' && none === null,
    { byId: byId?.by, byNick: byNick?.by, none });
  check('AR2 ID and nickname pointing to different members -> asks for --uid', amb?.ambiguous?.length === 2 && amb.ambiguous.map((h) => h.uid).join() === 'U3,U4', amb);

  const info = describe(byId).join('\n'), infoOld = describe(legacy).join('\n');
  check('AR3 account summary shows what to compare with the DM (team, age, stick, joined day, last login)',
    info.includes('bungae11') && info.includes('서울 유스 · 11세') && info.includes('KR · L') && info.includes('2026-11-02') && info.includes('2026-11-18') && info.includes('No.7')
    && infoOld.includes('예전 별명 계정') && infoOld.includes('2026-10-01'), { info, infoOld });

  const temps = Array.from({ length: 50 }, () => makeTempPassword());
  check('AR4 temp password: xxxx-xxxx-xxxx, easy-to-type letters/digits, different every time',
    temps.every((t) => /^[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{4}$/.test(t)) && new Set(temps).size === 50, temps.slice(0, 3));

  const temp = await resetPassword(f, 'U1', 'abcd-efgh-jkmn');
  check('AR5 reset: marks tempPw first, then sets the password, then signs out other devices',
    temp === 'abcd-efgh-jkmn' && f.users.get('U1').password === temp && f.docs.get('users/U1').tempPw === true
    && f.calls.map((c) => c[0]).join() === 'update,updateUser,revoke' && JSON.stringify(f.calls[0][2]) === '{"tempPw":true}', f.calls);
  let failed = null;
  try { await resetPassword(f, 'NOPE', 'abcd-efgh-jkmn'); } catch (e) { failed = e.message; }
  check('AR6 no profile -> nothing changes (password untouched)', !!failed && f.calls.length === 3, { failed, calls: f.calls.length });

  const dm = dmText(f.docs.get('users/U1'), temp), dmOld = dmText(f.docs.get('users/U2'), temp);
  check('AR7 DM text: ID (or nickname for old accounts) + temp password + change it right away',
    dm.includes('아이디 bungae11') && dm.includes(temp) && dm.includes('새 비밀번호') && dmOld.includes('별명 옛친구') && dmOld.includes('아이디도 새로'), { dm, dmOld });
  return { ok, logs };
}

if (process.argv[1] && normalize(process.argv[1]) === normalize(fileURLToPath(import.meta.url))) {
  const { ok, logs } = await checkAdminReset().catch((e) => ({ ok: false, logs: [`FAIL admin reset check threw: ${e.stack || e}`] }));
  for (const l of logs) console.log(l);
  process.exit(ok ? 0 : 1);
}
