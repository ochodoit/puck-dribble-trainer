// IndexNow: 배포가 끝나면 바뀐 페이지 주소를 검색엔진에 바로 알린다 (다음 수집을 기다리지 않게).
//   - 네이버 서치어드바이저와 IndexNow 공용 주소(api.indexnow.org → Bing 등 참여 검색엔진에 함께 전달)로 보낸다
//   - 소유 증명은 사이트 루트의 <키>.txt (키는 tools/site-content.mjs 의 VERIFY.indexnow, 파일은 build-site.mjs 가 만든다)
// 사용: node tools/indexnow.mjs --all              모든 페이지 (처음 한 번, 또는 손으로 다시 알릴 때)
//       node tools/indexnow.mjs <바뀐 파일...>       배포 작업이 git diff 로 넘긴 파일 중 페이지 파일만 골라 알림
//       --dry                                       보내지 않고 보낼 주소만 보여 줌
// 알림이 실패해도 배포를 막지 않도록 항상 0 으로 끝난다 (실패는 경고로만 남긴다)
import { normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE, VERIFY, PAGES } from './site-content.mjs';
import { pathOf } from './build-site.mjs';

export const ENDPOINTS = ['https://searchadvisor.naver.com/indexnow', 'https://api.indexnow.org/indexnow'];
const LANGS = ['ko', 'en'];

/** 페이지 파일(저장소 기준 경로) → 주소. 예: 'guide/index.html' → 'https://puck-trainer.com/guide/' */
export function pageFiles() {
  const map = new Map();
  for (const slug of ['', ...PAGES.map((p) => p.slug)]) for (const lang of LANGS) map.set(`${pathOf(lang, slug).slice(1)}index.html`, SITE + pathOf(lang, slug));
  return map;
}

/** 바뀐 파일 목록에서 알릴 주소만 (페이지가 아닌 파일은 뺀다, 순서는 사이트맵 순서) */
export function urlsForFiles(files) {
  const changed = new Set(files.map((f) => f.replace(/\\/g, '/').replace(/^\.\//, '')));
  return [...pageFiles()].filter(([file]) => changed.has(file)).map(([, u]) => u);
}

/** IndexNow 요청 본문 */
export function payload(urlList) {
  const host = new URL(SITE).host;
  return { host, key: VERIFY.indexnow, keyLocation: `${SITE}/${VERIFY.indexnow}.txt`, urlList };
}

async function ping(urlList) {
  const body = JSON.stringify(payload(urlList));
  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body, signal: AbortSignal.timeout(20000) });
      // 200 = 받음, 202 = 받음(키 확인은 나중에). 그 밖(400 형식, 403 키 불일치, 422 다른 도메인, 429 너무 잦음)은 경고
      const ok = res.status === 200 || res.status === 202;
      console.log(`${ok ? 'OK  ' : 'WARN'} ${endpoint} ${res.status} ${ok ? '' : (await res.text().catch(() => '')).slice(0, 200)}`);
      if (!ok) console.log(`::warning title=IndexNow::${endpoint} 응답 ${res.status}`);
    } catch (e) {
      console.log(`WARN ${endpoint} ${e.message}`);
      console.log(`::warning title=IndexNow::${endpoint} 요청 실패 (${e.message})`);
    }
  }
}

if (process.argv[1] && normalize(process.argv[1]) === normalize(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const urls = args.includes('--all') ? [...pageFiles().values()] : urlsForFiles(args.filter((a) => !a.startsWith('--')));
  if (!urls.length) { console.log('IndexNow: 바뀐 페이지가 없어 알리지 않습니다'); process.exit(0); }
  console.log(`IndexNow: ${urls.length}개 페이지\n${urls.map((u) => '  ' + u).join('\n')}`);
  if (!dry) await ping(urls);
}
