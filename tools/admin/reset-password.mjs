// 운영자 전용: 비밀번호를 잊은 회원에게 임시 비밀번호 주기 (운영자 PC에서만 실행. 사이트에는 올라가지 않음)
//
// 회원은 가상 이메일로 로그인해서 비밀번호 찾기 메일을 받을 수 없다. 그래서 운영자가
//   1) 인스타 DM으로 받은 정보(아이디나 별명, 팀, 나이, 가입한 때)를 이 도구가 보여 주는 계정 정보와 맞춰 보고
//   2) 임시 비밀번호를 만들어 DM으로 보낸다.
// 회원이 임시 비밀번호로 로그인하면 게임이 바로 새 비밀번호를 정하게 한다 (users/{uid}.tempPw).
// 다른 기기에 로그인돼 있던 세션은 끊긴다 (revokeRefreshTokens, 늦어도 1시간 안에).
//
// 준비 (한 번):
//   1) Firebase 콘솔 > 프로젝트 설정 > 서비스 계정 > "새 비공개 키 생성" -> JSON 파일을 저장소 밖(예: C:\keys\)에 저장.
//      이 키는 프로젝트 전체 권한이다. 저장소에 넣거나 누구에게도 보내지 말 것.
//   2) cd tools/admin && npm install   (Node 22 이상)
// 사용:
//   node reset-password.mjs <아이디 또는 별명> --key C:\keys\키파일.json            계정 확인 후 물어보고 재설정
//   node reset-password.mjs <아이디 또는 별명> --key ... --check                   확인만 (바꾸지 않음)
//   node reset-password.mjs --uid <uid> --key ...                                  uid 로 찾기
//   (--key 대신 환경 변수 GOOGLE_APPLICATION_CREDENTIALS 에 키 파일 경로를 넣어도 됨. --yes = 묻지 않고 재설정)
import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** 게임의 아이디 규칙과 같음 (src/account.js LOGIN_ID_RE) */
export const LOGIN_ID_RE = /^[a-z][a-z0-9_]{3,19}$/;
// 휴대폰으로 옮겨 치기 쉬운 글자만 (헷갈리는 0·o·1·l·i 빼고)
const TEMP_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

/** 임시 비밀번호: xxxx-xxxx-xxxx (소문자·숫자 12자, 약 59비트) */
export function makeTempPassword(rand = randomInt) {
  const g = () => Array.from({ length: 4 }, () => TEMP_CHARS[rand(TEMP_CHARS.length)]).join('');
  return `${g()}-${g()}-${g()}`;
}

const toMs = (v) => (v == null ? null : typeof v === 'number' ? v : typeof v.toMillis === 'function' ? v.toMillis() : v instanceof Date ? v.getTime() : null);
const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '-');

/**
 * 회원 찾기: uid, 아이디(ids/{아이디}), 별명(nicks/{별명 소문자}) 순서.
 * 돌려줌: { uid, by, profile, authUser, admin } 또는 없으면 null. 아이디와 별명이 서로 다른 회원을 가리키면 둘 다 알려 준다(ambiguous)
 */
export async function findMember({ auth, db }, { query = '', uid = '' } = {}) {
  const q = String(query).trim(), lower = q.toLowerCase();
  const hits = [];
  if (uid) hits.push({ uid: String(uid).trim(), by: 'uid' });
  else {
    if (LOGIN_ID_RE.test(lower)) {
      const s = await db.doc(`ids/${lower}`).get();
      if (s.exists) hits.push({ uid: s.data().uid, by: 'id' });
    }
    if (lower && !lower.includes('/')) {
      const s = await db.doc(`nicks/${lower}`).get();
      if (s.exists && !hits.some((h) => h.uid === s.data().uid)) hits.push({ uid: s.data().uid, by: 'nick' });
    }
  }
  if (!hits.length) return null;
  if (hits.length > 1) return { ambiguous: hits };
  const { uid: id, by } = hits[0];
  const snap = await db.doc(`users/${id}`).get();
  let authUser = null;
  try { authUser = await auth.getUser(id); } catch (e) { if (e?.code !== 'auth/user-not-found') throw e; }
  const admin = (await db.doc(`admins/${id}`).get()).exists;
  return { uid: id, by, profile: snap.exists ? snap.data() : null, authUser, admin };
}

/** 운영자가 DM 내용과 맞춰 볼 계정 정보 (줄 목록) */
export function describe(m) {
  const p = m.profile || {}, a = m.authUser;
  return [
    `찾은 방법     ${{ uid: 'uid', id: '아이디', nick: '별명' }[m.by]}`,
    `uid           ${m.uid}`,
    `아이디        ${p.loginId || '(없음: 예전 별명 계정)'}`,
    `별명          ${p.nick ?? '-'}`,
    `회원 번호     ${Number.isInteger(p.memberNo) ? `No.${p.memberNo}` : '-'}`,
    `팀 · 나이     ${p.team ?? '-'} · ${p.age ?? '-'}세 (${p.ageGroup ?? '-'})`,
    `국가 · 스틱   ${p.country ?? '-'} · ${p.stick ?? '-'}   등번호 ${p.number ?? '-'}`,
    `가입한 날     ${day(toMs(p.joinedAt ?? p.createdAt))}`,
    `마지막 로그인 ${a?.metadata?.lastSignInTime ? day(Date.parse(a.metadata.lastSignInTime)) : '-'}`,
    `상태          ${[m.admin ? '운영자 계정' : '', p.tempPw ? '임시 비밀번호 받음(아직 안 바꿈)' : '', a?.disabled ? '로그인 막힘(disabled)' : '', !a ? '로그인 계정 없음' : '', !m.profile ? '프로필 없음' : ''].filter(Boolean).join(', ') || '보통'}`,
  ];
}

/**
 * 임시 비밀번호로 바꾸기: tempPw 표시를 먼저 적고(실패하면 비밀번호는 그대로) 비밀번호를 바꾼 뒤 다른 기기 세션을 끊는다
 */
export async function resetPassword({ auth, db }, uid, temp = makeTempPassword()) {
  await db.doc(`users/${uid}`).update({ tempPw: true });
  await auth.updateUser(uid, { password: temp });
  await auth.revokeRefreshTokens(uid);
  return temp;
}

/** 회원에게 보낼 DM 문구 */
export function dmText(profile, temp) {
  const how = profile?.loginId ? `아이디 ${profile.loginId}` : `별명 ${profile?.nick ?? ''} (예전 계정이라 로그인하면 아이디도 새로 만들어요)`;
  return [
    '[퍽 드리블 트레이너] 임시 비밀번호를 보내 드려요.',
    `${how} + 임시 비밀번호 ${temp} 로 로그인하세요.`,
    '로그인하면 바로 나만 아는 새 비밀번호를 정하게 돼요. 새 비밀번호는 누구에게도 알려 주지 마세요.',
    '새 비밀번호를 정한 뒤 이 메시지는 지워 주세요.',
  ].join('\n');
}

function parseArgs(argv) {
  const o = { query: '', uid: '', key: '', check: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--uid') o.uid = argv[++i] || '';
    else if (a === '--key') o.key = argv[++i] || '';
    else if (a === '--check') o.check = true;
    else if (a === '--yes' || a === '-y') o.yes = true;
    else if (!a.startsWith('--') && !o.query) o.query = a;
    else throw new Error(`모르는 옵션: ${a}`);
  }
  if (!o.query && !o.uid) throw new Error('아이디나 별명(또는 --uid)을 적어 주세요');
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  let sdk;
  try { sdk = await Promise.all([import('firebase-admin/app'), import('firebase-admin/auth'), import('firebase-admin/firestore')]); }
  catch { throw new Error('firebase-admin 이 없습니다. 먼저 tools/admin 폴더에서 npm install 을 실행하세요 (Node 22 이상)'); }
  const [{ initializeApp, cert, applicationDefault }, { getAuth }, { getFirestore }] = sdk;
  const keyPath = o.key || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) throw new Error('서비스 계정 키 파일을 --key 로 주거나 GOOGLE_APPLICATION_CREDENTIALS 에 넣어 주세요');
  const key = JSON.parse(readFileSync(keyPath, 'utf8'));
  const app = initializeApp({ credential: o.key ? cert(key) : applicationDefault(), projectId: key.project_id });
  const ctx = { auth: getAuth(app), db: getFirestore(app) };
  console.log(`프로젝트: ${key.project_id}`);

  const m = await findMember(ctx, o);
  if (!m) { console.log('그런 아이디·별명의 회원이 없습니다. 철자를 확인하거나 운영자 화면의 회원 목록에서 찾아보세요.'); return 1; }
  if (m.ambiguous) {
    console.log('아이디와 별명이 서로 다른 회원을 가리킵니다. --uid 로 골라 주세요:');
    for (const h of m.ambiguous) console.log(`  ${h.by === 'id' ? '아이디' : '별명'} 일치: --uid ${h.uid}`);
    return 1;
  }
  console.log(describe(m).join('\n'));
  if (!m.authUser || !m.profile) { console.log('\n로그인 계정이나 프로필이 없어 재설정할 수 없습니다.'); return 1; }
  if (o.check) { console.log('\n(--check: 확인만 했습니다)'); return 0; }
  if (m.admin) console.log('\n주의: 운영자 계정입니다. 새 비밀번호는 12자 이상이어야 합니다.');

  if (!o.yes) {
    const { createInterface } = await import('node:readline/promises');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ans = (await rl.question('\nDM 내용과 맞으면 y 를 누르세요. 임시 비밀번호를 만들까요? (y/N) ')).trim().toLowerCase();
    rl.close();
    if (ans !== 'y' && ans !== 'yes') { console.log('취소했습니다'); return 1; }
  }
  const temp = await resetPassword(ctx, m.uid);
  console.log('\n임시 비밀번호를 만들었습니다. 아래 문구를 그 회원에게 DM으로 보내세요:\n');
  console.log(dmText(m.profile, temp));
  console.log('\n(임시 비밀번호는 여기에만 보입니다. 따로 저장하지 마세요)');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().then((code) => process.exit(code ?? 0), (e) => { console.error(`오류: ${e.message || e}`); process.exit(1); });
}
