// icons/icon.svg -> PNG 아이콘 + favicon.ico (Playwright Chromium 사용)
//  - favicon.ico: 16·32·48 크기를 한 파일에 (검색 결과 아이콘은 48의 배수를 쓰고, /favicon.ico 를 먼저 찾는 브라우저·검색엔진이 있음)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync(new URL('../icons/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
async function render(size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
const only = process.argv[2]; // 'ico' 이면 favicon.ico 만
if (only !== 'ico') {
  for (const size of [180, 192, 512]) {
    writeFileSync(new URL(`../icons/icon-${size}.png`, import.meta.url), await render(size));
    console.log('wrote icons/icon-%d.png', size);
  }
}
// ICO = 머리(6바이트) + 크기별 목록(16바이트씩) + PNG 그대로
const sizes = [16, 32, 48], pngs = [];
for (const s of sizes) pngs.push(await render(s));
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  head.writeUInt8(s, e); head.writeUInt8(s, e + 1); head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
  head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(pngs[i].length, e + 8); head.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
writeFileSync(new URL('../favicon.ico', import.meta.url), Buffer.concat([head, ...pngs]));
console.log('wrote favicon.ico (%s)', sizes.join('/'));
await browser.close();
