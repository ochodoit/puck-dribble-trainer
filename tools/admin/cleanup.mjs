// 운영자 전용 정리 도구 (운영자 PC에서만 실행. 사이트에는 올라가지 않음). 준비는 reset-password.mjs 와 같다 (서비스 계정 키 + npm install).
//
//  1) age    공개 문서(랭킹 scores_*, 글 posts, 도전 기록 posts/*/records)에 남아 있는 정확한 나이(age) 칸 지우기.
//            게임은 2026-11-20 부터 공개 문서에 나이대(ageGroup)만 쓴다. 새 규칙을 게시하고 새 게임을 배포한 뒤 한 번 실행하세요.
//  2) legacy 아직 아이디를 만들지 않은 예전 계정(별명 + 숫자 6자리 비밀번호) 목록.
//            숫자 6자리 비밀번호는 대입에 약하므로, 목록의 회원에게 reset-password.mjs 로 임시 비밀번호를 주거나(로그인하면
//            아이디와 새 비밀번호를 만들게 됨) 오래 안 쓴 계정은 콘솔에서 로그인을 막으세요.
//
// 사용 (tools/admin 폴더에서):
//   node cleanup.mjs age --key C:\keys\키파일.json            몇 개인지 세기만 (바꾸지 않음)
//   node cleanup.mjs age --key C:\keys\키파일.json --apply    실제로 지우기 (나이대 ageGroup 은 그대로)
//   node cleanup.mjs legacy --key C:\keys\키파일.json         예전 계정 목록
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '-');

/** 정확한 나이 칸이 남은 공개 문서: { refs: [ref...], byCol: { 컬렉션: 개수 } } */
export async function findAgeDocs(db) {
  const refs = [], byCol = {};
  const scan = async (label, snap) => {
    for (const d of snap.docs) {
      if (d.data().age === undefined) continue;
      refs.push(d.ref); byCol[label] = (byCol[label] || 0) + 1;
    }
  };
  for (const col of await db.listCollections()) if (col.id.startsWith('scores_')) await scan(col.id, await col.get());
  await scan('posts', await db.collection('posts').get());
  await scan('posts/*/records', await db.collectionGroup('records').get());
  return { refs, byCol };
}

/** 나이 칸 지우기 (400개씩 묶어서). 반환: 지운 문서 수 */
export async function stripAge(db, refs, deleteValue) {
  for (let i = 0; i < refs.length; i += 400) {
    const b = db.batch();
    for (const r of refs.slice(i, i + 400)) b.update(r, { age: deleteValue });
    await b.commit();
  }
  return refs.length;
}

/** 아직 아이디가 없는 예전 계정: [{ uid, nick, memberNo, joined, lastSignIn, disabled }] (마지막 로그인 최근 순) */
export async function legacyAccounts({ db, auth }) {
  const snap = await db.collection('users').get();
  const out = [];
  for (const d of snap.docs) {
    const p = d.data();
    if (p.loginId) continue;
    let a = null;
    try { a = await auth.getUser(d.id); } catch (e) { if (e?.code !== 'auth/user-not-found') throw e; }
    out.push({ uid: d.id, nick: p.nick ?? '-', memberNo: p.memberNo ?? null, joined: day(p.joinedAt?.toMillis?.() ?? p.joinedAt ?? p.createdAt ?? null),
      lastSignIn: a?.metadata?.lastSignInTime ? day(Date.parse(a.metadata.lastSignInTime)) : '-', disabled: !!a?.disabled, noLogin: !a });
  }
  return out.sort((x, y) => (y.lastSignIn > x.lastSignIn ? 1 : y.lastSignIn < x.lastSignIn ? -1 : 0));
}

function parseArgs(argv) {
  const o = { cmd: '', key: '', apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--key') o.key = argv[++i] || '';
    else if (a === '--apply') o.apply = true;
    else if (!a.startsWith('--') && !o.cmd) o.cmd = a;
    else throw new Error(`모르는 옵션: ${a}`);
  }
  if (!['age', 'legacy'].includes(o.cmd)) throw new Error('할 일을 적어 주세요: age 또는 legacy');
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  let sdk;
  try { sdk = await Promise.all([import('firebase-admin/app'), import('firebase-admin/auth'), import('firebase-admin/firestore')]); }
  catch { throw new Error('firebase-admin 이 없습니다. 먼저 tools/admin 폴더에서 npm install 을 실행하세요 (Node 22 이상)'); }
  const [{ initializeApp, cert, applicationDefault }, { getAuth }, { getFirestore, FieldValue }] = sdk;
  const keyPath = o.key || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) throw new Error('서비스 계정 키 파일을 --key 로 주거나 GOOGLE_APPLICATION_CREDENTIALS 에 넣어 주세요');
  const key = JSON.parse(readFileSync(keyPath, 'utf8'));
  const app = initializeApp({ credential: o.key ? cert(key) : applicationDefault(), projectId: key.project_id });
  const ctx = { auth: getAuth(app), db: getFirestore(app) };
  console.log(`프로젝트: ${key.project_id}`);

  if (o.cmd === 'age') {
    const { refs, byCol } = await findAgeDocs(ctx.db);
    console.log(`정확한 나이가 남은 공개 문서: ${refs.length}개`);
    for (const [c, n] of Object.entries(byCol)) console.log(`  ${c}: ${n}`);
    if (!refs.length) return 0;
    if (!o.apply) { console.log('\n(세기만 했습니다. 지우려면 --apply 를 붙이세요)'); return 0; }
    console.log(`\n${await stripAge(ctx.db, refs, FieldValue.delete())}개 문서에서 나이 칸을 지웠습니다 (나이대는 그대로)`);
    return 0;
  }
  const list = await legacyAccounts(ctx);
  console.log(`아이디가 없는 예전 계정(숫자 6자리 비밀번호): ${list.length}개\n`);
  for (const a of list) console.log(`  ${a.nick.padEnd(12)} No.${a.memberNo ?? '-'}  가입 ${a.joined}  마지막 로그인 ${a.lastSignIn}${a.disabled ? '  (로그인 막힘)' : ''}${a.noLogin ? '  (로그인 계정 없음)' : ''}  uid ${a.uid}`);
  if (list.length) console.log('\n임시 비밀번호 주기: node reset-password.mjs <별명> --key ...  (로그인하면 아이디·새 비밀번호를 만들게 됩니다)');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().then((code) => process.exit(code ?? 0), (e) => { console.error(`오류: ${e.message || e}`); process.exit(1); });
}
