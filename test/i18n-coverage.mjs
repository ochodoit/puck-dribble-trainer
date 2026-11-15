// 번역 누락 검사: 소스(index.html, src/*.js)의 한국어 문구가 영어 사전으로 모두 번역되는지 확인한다.
// 사용: node test/i18n-coverage.mjs  (run.mjs 에서도 호출)
import { readFile, readdir } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const HANGUL = /[ㄱ-ㆎ가-힣]/;

// 번역 대상이 아닌 문구 (개발자 콘솔 경고, 언어 이름, 기호 설명 등)
const SKIP = [
  /저장소를 열지 못해 기기 내 저장소를 사용합니다/, // console.warn
  /^한국어$/, /^언어 · Language$/,
  /^퍽 드리블$/,                                  // 홈 화면 앱 이름(meta)
  /^\[\\p\{L\}/, /가-힣/,                          // 정규식
  /^· /, /^승리!$/,                               // 다른 문구 뒤에 이어 붙는 조각 (이어 붙은 전체 문구로 번역됨)
];

/** ${...} 를 (중괄호 짝을 맞춰) 숫자 7로 바꾼다. `cond ? '...' : ''` 꼴의 덧붙는 조각은 빈 문자열로 */
function fillTemplate(s) {
  let out = '', i = 0;
  while (i < s.length) {
    if (s[i] === '$' && s[i + 1] === '{') {
      let depth = 1; i += 2; const from = i;
      while (i < s.length && depth > 0) { if (s[i] === '{') depth++; else if (s[i] === '}') depth--; i++; }
      out += /: ''\s*$/.test(s.slice(from, i - 1)) ? '' : '7';
    } else out += s[i++];
  }
  return out;
}

export async function collectStrings() {
  const found = new Map(); // 문구 -> 출처
  const add = (s, src) => {
    s = s.replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\"/g, '"');
    // HTML 조각은 태그를 기준으로 나눠 텍스트만
    for (let part of s.split(/<[^>]*>/)) {
      part = part.replace(/&[a-z]+;/g, ' ').trim();
      if (part && HANGUL.test(part) && !SKIP.some((re) => re.test(part))) found.set(part, src);
    }
  };
  let html = await readFile(join(ROOT, 'index.html'), 'utf8');
  html = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  for (const m of html.matchAll(/>([^<>]+)</g)) add(m[1].replace(/\s+/g, ' '), 'index.html');
  for (const m of html.matchAll(/(?:placeholder|aria-label|title|data-label)="([^"]+)"/g)) add(m[1], 'index.html@attr');
  for (const f of (await readdir(join(ROOT, 'src'))).filter((x) => x.endsWith('.js') && !x.startsWith('i18n'))) {
    let code = await readFile(join(ROOT, 'src', f), 'utf8');
    code = code.replace(/\/\*[\s\S]*?\*\//g, '');
    code = code.split('\n').map((l) => (/['"`].*\/\//.test(l) ? l.replace(/\s\/\/ [^'"`]*$/, '') : l.split('//')[0])).join('\n');
    for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) add(m[1], f);
    for (const m of code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) add(m[1], f);
    for (const m of code.matchAll(/`((?:[^`\\]|\\.)*)`/g)) add(fillTemplate(m[1]), f);
  }
  return found;
}

export async function checkCoverage() {
  const { tr, setLang } = await import('../src/i18n.js');
  setLang('en');
  const strings = await collectStrings();
  const missing = [];
  for (const [s, src] of strings) {
    const out = tr(s);
    if (HANGUL.test(out)) missing.push({ src, s, out });
  }
  setLang('ko');
  return { total: strings.size, missing };
}

if (process.argv[1] && normalize(process.argv[1]) === normalize(fileURLToPath(import.meta.url))) {
  const { total, missing } = await checkCoverage();
  for (const m of missing) console.log(`MISSING [${m.src}] ${JSON.stringify(m.s)}${m.out !== m.s ? ` -> ${JSON.stringify(m.out)}` : ''}`);
  console.log(`${missing.length ? 'FAIL' : 'PASS'} i18n coverage: ${total - missing.length}/${total} strings translated`);
  process.exit(missing.length ? 1 : 0);
}
