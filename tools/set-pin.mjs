// 접속 코드 변경: node tools/set-pin.mjs 1234   (빈 문자열이면 잠금 해제: node tools/set-pin.mjs "")
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const pin = process.argv[2];
if (pin === undefined) { console.error('사용법: node tools/set-pin.mjs <PIN>  (잠금 해제: "")'); process.exit(1); }
const hash = pin === '' ? '' : createHash('sha256').update(pin.trim()).digest('hex');
const file = new URL('../src/access.js', import.meta.url);
const src = readFileSync(file, 'utf8').replace(/export const PIN_HASH = '[0-9a-f]*';/, `export const PIN_HASH = '${hash}';`);
writeFileSync(file, src);
console.log(pin === '' ? '잠금을 해제했습니다.' : `접속 코드를 설정했습니다 (해시 ${hash.slice(0, 8)}…). 커밋 후 배포하세요.`);
