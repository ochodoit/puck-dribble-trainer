// 운영자 정리 도구(tools/admin/cleanup.mjs) 검사: 가짜 Firestore·Auth 로 (실제 Firebase 에 접속하지 않음, firebase-admin 설치 없이)
// 사용: node test/admin-cleanup.mjs  (run.mjs 에서도 호출)
import { normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findAgeDocs, stripAge, legacyAccounts } from '../tools/admin/cleanup.mjs';

function fakeDb(docs) {
  const DEL = Symbol('del'), commits = [];
  const snapOf = (paths) => ({ docs: paths.map((p) => ({ id: p.split('/').pop(), ref: { path: p }, data: () => ({ ...docs.get(p) }) })) });
  const direct = (prefix) => [...docs.keys()].filter((p) => p.startsWith(prefix + '/') && !p.slice(prefix.length + 1).includes('/'));
  const db = {
    DEL, commits,
    async listCollections() { return [...new Set([...docs.keys()].map((p) => p.split('/')[0]))].map((id) => ({ id, get: async () => snapOf(direct(id)) })); },
    collection: (name) => ({ get: async () => snapOf(direct(name)) }),
    collectionGroup: (name) => ({ get: async () => snapOf([...docs.keys()].filter((p) => { const s = p.split('/'); return s.length >= 2 && s[s.length - 2] === name; })) }),
    batch() {
      const ops = [];
      return {
        update(ref, patch) { ops.push([ref.path, patch]); },
        async commit() { commits.push(ops.length); for (const [p, patch] of ops) { const d = { ...docs.get(p) }; for (const [k, v] of Object.entries(patch)) { if (v === DEL) delete d[k]; else d[k] = v; } docs.set(p, d); } },
      };
    },
  };
  return db;
}

export async function checkAdminCleanup() {
  const logs = [];
  let ok = true;
  const check = (name, cond, info) => { logs.push(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ` ${JSON.stringify(info)}`}`); if (!cond) ok = false; };

  const docs = new Map([
    ['scores_arcade@60/u1', { uid: 'u1', age: 11, ageGroup: 'U12', score: 5 }],
    ['scores_arcade@60/u2', { uid: 'u2', ageGroup: 'U12', score: 4 }],             // 이미 나이 없음
    ['scores_quick/u1', { uid: 'u1', age: 11, ageGroup: 'U12', score: 9 }],
    ['posts/p1', { uid: 'u1', age: 11, ageGroup: 'U12', title: 't' }],
    ['posts/p1/records/u3', { uid: 'u3', age: 30, score: 7 }],
    ['posts/p1/cheers/u3', { at: 1 }],
    ['users/u1', { loginId: 'one', nick: '원', age: 11, ageGroup: 'U12' }],           // 프로필 나이는 그대로 (공개 문서가 아님)
    ['users/u2', { nick: '옛둘', age: 20, ageGroup: '성인', memberNo: 2, joinedAt: Date.UTC(2026, 9, 1) }],
    ['users/u3', { nick: '옛셋', age: 30, ageGroup: '성인', memberNo: 3 }],
  ]);
  for (let i = 0; i < 450; i++) docs.set(`scores_wide@60/b${i}`, { uid: `b${i}`, age: 15, ageGroup: 'U16', score: i });
  const db = fakeDb(docs);
  const { refs, byCol } = await findAgeDocs(db);
  check('AC1 finds the exact age left in public docs only (rankings, posts, challenge records), not in private profiles',
    refs.length === 454 && byCol['scores_arcade@60'] === 1 && byCol.scores_quick === 1 && byCol['scores_wide@60'] === 450 && byCol.posts === 1 && byCol['posts/*/records'] === 1 && !refs.some((r) => r.path.startsWith('users/')), { n: refs.length, byCol });
  const n = await stripAge(db, refs, db.DEL);
  const left = [...docs].filter(([p, d]) => !p.startsWith('users/') && 'age' in d).length;
  check('AC2 strip removes only the age field (age group kept), in batches of 400; profiles untouched',
    n === 454 && left === 0 && docs.get('scores_quick/u1').ageGroup === 'U12' && docs.get('scores_quick/u1').score === 9 && docs.get('users/u1').age === 11 && db.commits.join() === '400,54', { n, left, commits: db.commits });

  const auth = { async getUser(uid) { if (uid === 'u3') throw Object.assign(new Error('x'), { code: 'auth/user-not-found' }); return { metadata: { lastSignInTime: 'Tue, 18 Nov 2026 10:00:00 GMT' }, disabled: false }; } };
  const legacy = await legacyAccounts({ db, auth });
  check('AC3 legacy list: accounts without a login ID (old nickname + 6-digit password), with last sign-in; accounts with an ID are left out',
    legacy.length === 2 && legacy.every((a) => a.uid !== 'u1') && legacy.find((a) => a.uid === 'u2').lastSignIn === '2026-11-18' && legacy.find((a) => a.uid === 'u2').joined === '2026-10-01' && legacy.find((a) => a.uid === 'u3').noLogin, legacy);
  return { ok, logs };
}

if (process.argv[1] && normalize(process.argv[1]) === normalize(fileURLToPath(import.meta.url))) {
  const { ok, logs } = await checkAdminCleanup().catch((e) => ({ ok: false, logs: [`FAIL admin cleanup check threw: ${e.stack || e}`] }));
  for (const l of logs) console.log(l);
  process.exit(ok ? 0 : 1);
}
