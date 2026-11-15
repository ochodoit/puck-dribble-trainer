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
// 테스트는 외부 웹폰트 없이 동작해야 함 (폴백 글꼴): 폰트 요청은 빈 응답으로 대체
const newCtx = async (opts) => { const c = await browser.newContext(opts); await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' })); return c; };
let failed = false;

// ---- 1) 영상처리/게임 로직 ----
{
  const hctx = await newCtx({});
  const page = await hctx.newPage();
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
  const context = await newCtx({ viewport: { width: 1180, height: 820 }, permissions: ['camera'], deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}/index.html`);
  // 접속 코드 게이트: 틀린 코드는 거부, 맞는 코드(1234)로 해제
  if (await page.isVisible('#pin-form')) {
    await page.fill('#pin-input', '0000'); await page.click('#pin-form button');
    await page.waitForTimeout(200);
    const rejected = await page.isVisible('#pin-error') && await page.isHidden('#btn-camera');
    await page.fill('#pin-input', '1234'); await page.click('#pin-form button');
    await page.waitForSelector('#btn-camera:visible', { timeout: 3000 });
    const remembered = await page.evaluate(() => !!localStorage.getItem('puck-trainer.access.v1'));
    console.log(`${rejected && remembered ? 'PASS' : 'FAIL'} access code gate (wrong rejected, right unlocks and is remembered)`);
    if (!(rejected && remembered)) failed = true;
  } else { console.log('FAIL access code gate not shown'); failed = true; }
  // 회원가입 (별명 + 6자리 비밀번호 + 국가/팀/나이)
  await page.waitForFunction(() => window.__puckTrainer?.account);
  await page.click('.auth-tabs .tab[data-tab="register"]');
  await page.fill('#auth-nick', '번개손'); await page.fill('#auth-pin', '12345');
  await page.selectOption('#auth-country', 'KR'); await page.fill('#auth-team', '서울 유스'); await page.fill('#auth-age', '11');
  await page.evaluate(() => document.querySelector('#auth-form').requestSubmit());
  await page.waitForTimeout(200);
  const pinErr = await page.isHidden('#auth-logged'); // 5자리는 브라우저 검증(pattern)에서 막혀 가입되지 않아야 함
  await page.fill('#auth-pin', '123456');
  await page.evaluate(() => document.querySelector('#auth-form').requestSubmit());
  await page.waitForSelector('#auth-logged:not(.hidden)');
  const who = await page.textContent('#auth-who');
  console.log(`${pinErr && who.includes('번개손') && who.includes('U12') ? 'PASS' : 'FAIL'} register with nickname + 6-digit pin (${who.trim()})`);
  if (!(pinErr && who.includes('번개손'))) failed = true;
  await page.click('#btn-camera');
  await page.waitForFunction(() => document.querySelector('#splash').classList.contains('hidden'), null, { timeout: 10000 });
  await page.waitForTimeout(2300);
  // 대기 중에는 항상 가운데 원이 켜져 있고(물체 학습 + 핸즈프리 시작), 탭해도 꺼지지 않음
  const idleOn = await page.evaluate(() => { const c = window.__puckTrainer.app.calib; return c.active && !c.manual && c.target === 'puck'; });
  await page.mouse.click(300, 300);
  await page.waitForTimeout(100);
  const stillOn = await page.evaluate(() => window.__puckTrainer.app.calib.active);
  console.log(`${idleOn && stillOn ? 'PASS' : 'FAIL'} idle circle active while waiting (learn object / hands-free start)`);
  if (!(idleOn && stillOn)) failed = true;
  // 보정 패널의 '원 안에 3초(자동)' 버튼은 수동 모드로 전환되고 탭으로 취소됨
  await page.click('#btn-calib'); await page.click('[data-autocalib="stick"]');
  const manualOn = await page.evaluate(() => { const c = window.__puckTrainer.app.calib; return c.active && c.manual && c.target === 'stick'; });
  await page.mouse.click(300, 300); await page.waitForTimeout(100);
  const manualOff = await page.evaluate(() => !window.__puckTrainer.app.calib.manual);
  console.log(`${manualOn && manualOff ? 'PASS' : 'FAIL'} manual auto-calibration for stick, tap cancels`);
  if (!(manualOn && manualOff)) failed = true;
  const fps = await page.textContent('#chip-fps');
  const fpsNum = parseInt(fps, 10);
  console.log(`${fpsNum > 0 ? 'PASS' : 'FAIL'} app processing frames (${fps.trim()})`);
  if (!(fpsNum > 0)) failed = true;
  await page.click('#btn-mode');
  // 게임 시간 3분 선택 -> 타이머 3:00, 다시 1분
  await page.click('#time-seg button[data-min="3"]');
  const t3 = (await page.textContent('#hud-timer')).trim();
  await page.click('#time-seg button[data-min="1"]');
  const t1 = (await page.textContent('#hud-timer')).trim();
  console.log(`${t3 === '3:00' && t1 === '1:00' ? 'PASS' : 'FAIL'} play time selector 1/3/5 min (${t3} -> ${t1})`);
  if (!(t3 === '3:00' && t1 === '1:00')) failed = true;
  await page.click('.mode-card:nth-child(2)');
  await page.waitForFunction(() => document.querySelector('#panel-mode').classList.contains('hidden'));
  const modeText = await page.textContent('#hud-mode');
  console.log(`${modeText.includes('퍽 피하기') ? 'PASS' : 'FAIL'} mode switch (${modeText.trim()})`);
  if (!modeText.includes('퍽 피하기')) failed = true;
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
  // 영역 편집: 버튼 -> 사다리꼴 핸들 4개 + 편집 바, 완료 -> 저장
  await page.click('#btn-floor-lock');
  await page.waitForSelector('#area-bar:not(.hidden)');
  const handlesVisible = await page.$$eval('#floor-handles .handle', (hs) => hs.filter((h) => h.offsetParent !== null).length);
  const h0 = await page.$('#floor-handles .handle[data-i="0"]');
  const hb = await h0.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down(); await page.mouse.move(hb.x + 60, hb.y + 40, { steps: 5 }); await page.mouse.up();
  await page.click('#area-done');
  const savedQuad = await page.evaluate(() => JSON.parse(localStorage.getItem('puck-trainer.settings.v1')));
  const areaOk = handlesVisible === 4 && savedQuad.floorMode === 'manual' && Array.isArray(savedQuad.manualQuad) && savedQuad.manualQuad[0][0] > 0.05;
  console.log(`${areaOk ? 'PASS' : 'FAIL'} area edit mode (4 handles, drag, saved as manual trapezoid ${JSON.stringify(savedQuad.manualQuad?.[0])})`);
  if (!areaOk) failed = true;
  const handlesHidden = await page.$$eval('#floor-handles .handle', (hs) => hs.every((h) => h.offsetParent === null));
  console.log(`${handlesHidden ? 'PASS' : 'FAIL'} handles hidden after done`);
  if (!handlesHidden) failed = true;

  // 배경 투명도 슬라이더 -> 아케이드·퍽 피하기 배경 불투명도에 반영되고 저장됨
  await page.click('#btn-settings');
  await page.evaluate(() => { const el = document.querySelector('#set-bgTransparency'); el.value = '60'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const wash = await page.evaluate(() => ({ a: window.__puckTrainer.game.arcade.wash, saved: JSON.parse(localStorage.getItem('puck-trainer.settings.v1')).bgTransparency, out: document.querySelector('#out-bgTransparency').value }));
  await page.evaluate(() => { const el = document.querySelector('#set-bgTransparency'); el.value = '10'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('[data-close="panel-settings"]');
  const washOk = Math.abs(wash.a - 0.4) < 1e-9 && wash.saved === 60 && wash.out === '60';
  console.log(`${washOk ? 'PASS' : 'FAIL'} background transparency slider (60% -> wash ${wash.a})`);
  if (!washOk) failed = true;

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
  // 기록 등록 + 랭킹 패널: 게임이 끝까지 진행된 결과를 흉내내어 onEnd 호출
  await page.evaluate(() => { const g = window.__puckTrainer.game; g.setMode('wide'); g.onEnd({ mode: g.mode, score: 17, reason: 'time', elapsed: 30, items: [['반복 횟수', 17]] }); });
  await page.waitForSelector('#result-rank:not(.hidden)');
  const rankTxt = await page.textContent('#result-rank');
  console.log(`${rankTxt.includes('1위/1명') && rankTxt.includes('U12') ? 'PASS' : 'FAIL'} score submitted and rank shown (${rankTxt.trim().slice(0, 60)})`);
  if (!rankTxt.includes('1위/1명')) failed = true;
  await page.click('#btn-result-rank');
  await page.waitForSelector('#panel-rank:not(.hidden)');
  await page.waitForFunction(() => document.querySelector('#rank-body').textContent.includes('번개손'));
  await page.selectOption('#rank-age', 'U16');
  await page.waitForFunction(() => document.querySelector('#rank-body').textContent.includes('아직 기록이 없습니다'));
  await page.selectOption('#rank-age', 'U12');
  await page.waitForFunction(() => document.querySelector('#rank-body').textContent.includes('번개손'));
  console.log('PASS leaderboard panel filters by age group');
  await page.click('[data-close="panel-rank"]'); // 결과 패널은 '랭킹 보기'를 누를 때 이미 닫힘
  // 로그아웃 후 로그인
  await page.click('#btn-settings'); await page.click('#btn-settings-logout'); await page.click('[data-close="panel-settings"]');
  const loggedOut = await page.evaluate(() => !window.__puckTrainer.account.current());
  const relogin = await page.evaluate(async () => { try { await window.__puckTrainer.account.login('번개손', '123456'); return !!window.__puckTrainer.account.current(); } catch { return false; } });
  console.log(`${loggedOut && relogin ? 'PASS' : 'FAIL'} logout and login again`);
  if (!(loggedOut && relogin)) failed = true;

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
  // 드롭다운 대비: select/option 의 글자색과 배경색 밝기 차이가 충분해야 함 (흰 바탕 흰 글씨 회귀 방지)
  const contrast = await page.evaluate(() => {
    const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g); if (!m) return null; const [r, g, b, a] = m.map(Number); if (a === 0) return null; return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
    const bad = [];
    document.querySelectorAll('select').forEach((sel) => {
      const cs = getComputedStyle(sel); const l1 = lum(cs.color), l2 = lum(cs.backgroundColor);
      if (l1 !== null && l2 !== null && Math.abs(l1 - l2) < 0.4) bad.push(`${sel.id}: ${cs.color} on ${cs.backgroundColor}`);
      sel.querySelectorAll('option').forEach((o) => { const oc = getComputedStyle(o); const a = lum(oc.color), b = lum(oc.backgroundColor); if (a !== null && b !== null && Math.abs(a - b) < 0.4) bad.push(`${sel.id} option: ${oc.color} on ${oc.backgroundColor}`); });
    });
    return { bad, scheme: getComputedStyle(document.documentElement).colorScheme, n: document.querySelectorAll('select').length };
  });
  console.log(`${contrast.bad.length === 0 ? 'PASS' : 'FAIL'} dropdown text/background contrast (${contrast.n} selects, scheme=${contrast.scheme}) ${contrast.bad.join('; ')}`);
  if (contrast.bad.length) failed = true;
  await page.click('#btn-start');
  await page.waitForSelector('#panel-result:not(.hidden)');
  const resultText = await page.textContent('#result-body');
  console.log(`${resultText.includes('최고 콤보') && resultText.includes('DEKE') ? 'PASS' : 'FAIL'} arcade result report`);
  // 핸즈프리 재시작: 결과 패널이 열린 채로 퍽이 가운데 원 안에 3초 머물면 자동 시작 (측정값을 중앙으로 고정)
  await page.evaluate(() => { const t = window.__puckTrainer.tracker; const orig = Object.getPrototypeOf(t).update; t.update = function (meas, now) { return orig.call(this, { u: 0.5, v: 0.5 }, now); }; });
  await page.waitForTimeout(1500);
  const notYet = (await page.textContent('#btn-start')).trim() === '시작';
  await page.waitForTimeout(2300);
  const autoStarted = (await page.textContent('#btn-start')).trim() === '중지' && (await page.isHidden('#panel-result'));
  const arcadePhase = await page.evaluate(() => window.__puckTrainer.game.arcade.phase);
  console.log(`${notYet && autoStarted && arcadePhase === 'play' ? 'PASS' : 'FAIL'} hands-free restart from result panel after 3s hold (phase=${arcadePhase})`);
  if (!(notYet && autoStarted && arcadePhase === 'play')) failed = true;
  await page.evaluate(() => { const t = window.__puckTrainer.tracker; delete t.update; });
  await page.click('#btn-start');
  await page.waitForTimeout(200);
  if (await page.isVisible('#panel-result')) await page.click('[data-close="panel-result"]');
  // 전면/후면 전환 버튼: 스트림 재시작, 오류 없음, 설정 저장
  await page.click('#btn-flip');
  await page.waitForTimeout(1200);
  const flipped = await page.evaluate(() => JSON.parse(localStorage.getItem('puck-trainer.settings.v1')).facing);
  const fpsAfterFlip = parseInt(await page.textContent('#chip-fps'), 10);
  console.log(`${flipped === 'environment' && fpsAfterFlip >= 0 ? 'PASS' : 'FAIL'} camera flip restarts stream (facing=${flipped})`);
  if (flipped !== 'environment') failed = true;
  if (errors.length) { console.error('FAIL console errors:', errors); failed = true; } else console.log('PASS no console errors');
  await context.close();
}

// ---- 3) 휴대폰 세로 화면 (390x844): 레이아웃 깨짐 없이 로드/시작, 영상 크기 변화 대응 ----
{
  const context = await newCtx({ viewport: { width: 390, height: 844 }, permissions: ['camera'], deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}/index.html`);
  if (await page.isVisible('#pin-form')) { await page.fill('#pin-input', '1234'); await page.tap('#pin-form button'); await page.waitForSelector('#btn-camera:visible'); }
  await page.waitForFunction(() => window.__puckTrainer?.account);
  await page.tap('#auth-guest');
  await page.tap('#btn-camera');
  await page.waitForFunction(() => document.querySelector('#splash').classList.contains('hidden'), null, { timeout: 10000 });
  await page.waitForTimeout(1500);
  const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const controlsVisible = await page.evaluate(() => { const r = document.querySelector('#btn-start').getBoundingClientRect(); return r.bottom <= window.innerHeight && r.width > 0; });
  console.log(`${noHScroll && controlsVisible ? 'PASS' : 'FAIL'} phone portrait layout (no overflow, controls visible)`);
  if (!(noHScroll && controlsVisible)) failed = true;
  await page.tap('#btn-settings');
  await page.selectOption('#set-floorMode', 'full');
  await page.tap('[data-close="panel-settings"]');
  await page.tap('#btn-start');
  await page.waitForTimeout(600);
  const running = (await page.textContent('#btn-start')).trim() === '중지';
  const aspect = await page.evaluate(() => { const c = document.querySelector('#overlay'); return c.height / c.width; });
  console.log(`${running && aspect > 0.5 ? 'PASS' : 'FAIL'} arcade runs on phone (canvas aspect ${aspect.toFixed(2)})`);
  if (!running) failed = true;
  await page.screenshot({ path: join(ROOT, 'test', 'screenshot-phone.png') });
  if (errors.length) { console.error('FAIL phone console errors:', errors); failed = true; } else console.log('PASS phone: no console errors');
  await context.close();
}

// ---- 4) 카메라 실패 진단: getUserMedia 가 NotReadableError 를 내면 진단 블록·카메라 목록·재시도가 보여야 함 ----
{
  const context = await newCtx({ viewport: { width: 1180, height: 820 }, permissions: ['camera'] });
  await context.addInitScript(() => {
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let calls = 0;
    navigator.mediaDevices.getUserMedia = (c) => { calls++; if (calls <= 3) { const e = new Error('Could not start video source'); e.name = 'NotReadableError'; return Promise.reject(e); } return orig(c); };
  });
  const page = await context.newPage();
  await page.goto(`${base}/index.html`);
  if (await page.isVisible('#pin-form')) { await page.fill('#pin-input', '1234'); await page.click('#pin-form button'); await page.waitForSelector('#btn-camera:visible'); }
  await page.waitForFunction(() => window.__puckTrainer?.account);
  await page.click('#auth-guest');
  await page.click('#btn-camera');
  await page.waitForSelector('#splash-diag:not(.hidden)', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('#diag-info').textContent.length > 0); // 진단 내용은 비동기로 채워짐
  const errText = await page.textContent('#splash-error');
  const diag = await page.textContent('#diag-info');
  const options = await page.$$eval('#diag-camera option', (o) => o.length);
  const ok = errText.includes('다른 프로그램') && diag.includes('NotReadableError') && diag.includes('시도 기록') && options >= 2;
  console.log(`${ok ? 'PASS' : 'FAIL'} camera failure shows diagnostics (${options - 1} device(s), ${errText.trim().slice(0, 40)}…)`);
  if (!ok) failed = true;
  // 재시도(4번째 호출부터 성공) -> 앱 시작
  await page.click('#btn-retry-camera');
  await page.waitForFunction(() => document.querySelector('#splash').classList.contains('hidden'), null, { timeout: 10000 });
  console.log('PASS retry after failure starts the camera');
  await context.close();
}

await browser.close();
server.close();
console.log(failed ? '\nSOME TESTS FAILED' : '\nALL TESTS PASSED');
process.exit(failed ? 1 : 0);
