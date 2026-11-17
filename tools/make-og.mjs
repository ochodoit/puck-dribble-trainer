// 공유 미리보기 이미지(Open Graph, 1200×630) 만들기 — 카카오톡·인스타·검색 결과에 보이는 그림 (Playwright Chromium 사용)
// 사용: node tools/make-og.mjs  ->  icons/og-image.png (한국어), icons/og-image-en.png (영어)
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');

const art = `data:image/png;base64,${readFileSync(new URL('../icons/hero-art.png', import.meta.url)).toString('base64')}`;
const SUB = {
  ko: '카메라로 하는 하키 스틱핸들링 훈련 게임',
  en: 'Hockey stickhandling training with your camera',
};
const TAG = { ko: '무료 · 앱 설치 없이 · 아이패드 · 휴대폰 · 노트북', en: 'Free · No app to install · iPad · Phone · Laptop' };

const html = (lang) => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@700&family=Fraunces:opsz,wght@9..144,900&family=Noto+Sans+KR:wght@500;700&family=Poppins:wght@500;600&display=block" rel="stylesheet">
<style>
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #F4F1EA; }
  .art { position: absolute; right: -30px; bottom: -6px; width: 960px; mix-blend-mode: multiply; }
  .t { position: absolute; left: 64px; top: 58px; font-family: Fraunces, serif; font-weight: 900; font-size: 112px; line-height: 0.95; letter-spacing: -0.035em; color: #161616; }
  .t span { display: block; font-family: Caveat, cursive; font-weight: 700; color: #E03C31; font-size: 104px; letter-spacing: 0; margin: 2px 0 0 250px; }
  .sub { position: absolute; left: 68px; top: 300px; font-family: "Noto Sans KR", Poppins, sans-serif; font-weight: 700; font-size: 34px; color: #161616; }
  .tag { position: absolute; left: 68px; top: 352px; font-family: "Noto Sans KR", Poppins, sans-serif; font-weight: 500; font-size: 23px; color: #4A4741; }
  .url { position: absolute; left: 64px; bottom: 34px; font-family: Poppins, sans-serif; font-weight: 600; font-size: 24px; color: #161616; border: 2px solid #161616; border-radius: 999px; padding: 4px 18px; background: #F4F1EA; }
</style></head><body>
<img class="art" src="${art}" alt="">
<div class="t">Puck Dribble<span>Trainer</span></div>
<div class="sub">${SUB[lang]}</div>
<div class="tag">${TAG[lang]}</div>
<div class="url">puck-trainer.com</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
for (const [lang, file] of [['ko', 'og-image.png'], ['en', 'og-image-en.png']]) {
  await page.setContent(html(lang), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  writeFileSync(new URL(`../icons/${file}`, import.meta.url), await page.screenshot({ type: 'png' }));
  console.log('wrote icons/%s', file);
}
await browser.close();
