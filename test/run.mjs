// 합성 프레임 인식 테스트 + 앱 로드/흐름 검사 (Playwright, 가짜 카메라)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path === '/' ? 'index.html' : path);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
let failed = false;

// ---- 1) 영상처리/게임 로직 ----
{
  const page = await browser.newPage();
  page.on('pageerror', (e) => { console.error('PAGEERROR', e.message); failed = true; });
  await page.goto(`${base}/test/harness.html`);
  const out = await page.evaluate(() => window.runTests());
  out.logs.forEach((l) => console.log(l));
  if (!out.ok) failed = true;
  await page.evaluate(() => window.renderArcadeDemo());
  await page.locator('#arcade').screenshot({ path: join(ROOT, 'test', 'arcade-demo.png') });
  await page.close();
}

// ---- 2) 실제 앱: 로드 -> 카메라 시작(가짜 장치) -> 모드 선택 -> 시작/중지, 콘솔 오류 없음 ----
{
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, permissions: ['camera'], deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}/index.html`);
  await page.click('#btn-camera');
  await page.waitForFunction(() => document.querySelector('#splash').classList.contains('hidden'), null, { timeout: 10000 });
  await page.waitForTimeout(2300);
  const fps = await page.textContent('#chip-fps');
  const fpsNum = parseInt(fps, 10);
  console.log(`${fpsNum > 0 ? 'PASS' : 'FAIL'} app processing frames (${fps.trim()})`);
  if (!(fpsNum > 0)) failed = true;
  await page.click('#btn-mode');
  await page.click('.mode-card:nth-child(3)');
  await page.waitForFunction(() => document.querySelector('#panel-mode').classList.contains('hidden'));
  const modeText = await page.textContent('#hud-mode');
  console.log(`${modeText.includes('장애물') ? 'PASS' : 'FAIL'} mode switch (${modeText.trim()})`);
  if (!modeText.includes('장애물')) failed = true;
  // 수동 바닥 지정으로 바꾸면 가짜 카메라에서도 시작 가능해야 함
  await page.click('#btn-settings');
  await page.selectOption('#set-floorMode', 'manual');
  await page.click('[data-close="panel-settings"]');
  await page.waitForTimeout(300);
  await page.click('#btn-start');
  await page.waitForTimeout(600);
  const running = await page.textContent('#btn-start');
  console.log(`${running.trim() === '중지' ? 'PASS' : 'FAIL'} game starts in manual floor mode`);
  if (running.trim() !== '중지') failed = true;
  await page.click('#btn-start');
  await page.waitForSelector('#panel-result:not(.hidden)');
  console.log('PASS result panel shown after stop');
  // 보정 흐름: 퍽 터치 지정
  await page.click('#btn-result-again'); // 다시 시작
  await page.waitForTimeout(200);
  await page.click('#btn-start'); // 중지
  await page.click('[data-close="panel-result"]');
  await page.click('#btn-calib');
  await page.click('[data-calib="puck"]');
  const hintVisible = await page.isVisible('#tap-hint');
  await page.mouse.click(600, 400);
  await page.waitForTimeout(200);
  const hintHidden = !(await page.isVisible('#tap-hint'));
  console.log(`${hintVisible && hintHidden ? 'PASS' : 'FAIL'} calibration tap flow`);
  if (!(hintVisible && hintHidden)) failed = true;
  // 노트북 웹캠 흐름: 게임 영역 전체 화면 + 조작 대상 스틱(미지정이면 시작 거부) + 해상도 변경
  await page.click('#btn-settings');
  await page.selectOption('#set-floorMode', 'full');
  await page.selectOption('#set-procWidth', '320');
  await page.selectOption('#set-controller', 'stick');
  await page.click('[data-close="panel-settings"]');
  await page.waitForTimeout(400);
  await page.click('#btn-start');
  await page.waitForTimeout(300);
  const refused = (await page.textContent('#btn-start')).trim() === '시작' && (await page.textContent('#toast')).includes('스틱');
  console.log(`${refused ? 'PASS' : 'FAIL'} stick controller requires calibration before start`);
  if (!refused) failed = true;
  await page.click('#btn-settings');
  await page.selectOption('#set-controller', 'puck');
  await page.click('[data-close="panel-settings"]');
  await page.click('#btn-start');
  await page.waitForTimeout(500);
  const fullRun = (await page.textContent('#btn-start')).trim() === '중지';
  console.log(`${fullRun ? 'PASS' : 'FAIL'} game runs with full-frame area at 320px`);
  if (!fullRun) failed = true;
  await page.click('#btn-start');
  await page.click('[data-close="panel-result"]');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('puck-trainer.settings.v1')));
  console.log(`${saved.floorMode === 'full' && saved.procWidth === 320 ? 'PASS' : 'FAIL'} webcam settings persisted`);
  // 아케이드 모드: 시작 -> 카운트다운 화면
  await page.click('#btn-mode');
  await page.click('.mode-card:nth-child(1)');
  await page.waitForFunction(() => document.querySelector('#panel-mode').classList.contains('hidden'));
  await page.click('#btn-start');
  await page.waitForTimeout(700);
  const btnTxt = (await page.textContent('#btn-start')).trim(), instrTxt = (await page.textContent('#hud-instruction')).trim();
  const arcadeRunning = btnTxt === '중지' && (instrTxt.includes('원') || instrTxt.includes('시선'));
  console.log(`${arcadeRunning ? 'PASS' : 'FAIL'} arcade mode starts with head-up countdown (${btnTxt} / ${instrTxt})`);
  if (!arcadeRunning) failed = true;
  await page.screenshot({ path: join(ROOT, 'test', 'screenshot.png') });
  await page.click('#btn-start');
  await page.waitForSelector('#panel-result:not(.hidden)');
  const resultText = await page.textContent('#result-body');
  console.log(`${resultText.includes('최고 콤보') && resultText.includes('DEKE') ? 'PASS' : 'FAIL'} arcade result report`);
  if (errors.length) { console.error('FAIL console errors:', errors); failed = true; } else console.log('PASS no console errors');
  await context.close();
}

await browser.close();
server.close();
console.log(failed ? '\nSOME TESTS FAILED' : '\nALL TESTS PASSED');
process.exit(failed ? 1 : 0);
