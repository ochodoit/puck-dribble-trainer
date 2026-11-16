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
// 기본은 한국어 화면 (영어 화면 테스트는 locale 을 따로 준다)
const newCtx = async (opts) => { const c = await browser.newContext({ locale: 'ko-KR', ...opts }); await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' })); return c; };
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
  await page.selectOption('#auth-country', 'KR'); await page.fill('#auth-team', '서울 유스'); await page.fill('#auth-age', '11'); await page.fill('#auth-number', '87');
  await page.evaluate(() => document.querySelector('#auth-form').requestSubmit());
  await page.waitForTimeout(200);
  const pinErr = await page.isHidden('#auth-logged'); // 5자리는 브라우저 검증(pattern)에서 막혀 가입되지 않아야 함
  await page.fill('#auth-pin', '123456');
  await page.evaluate(() => document.querySelector('#auth-form').requestSubmit());
  await page.waitForSelector('#auth-logged:not(.hidden)');
  const who = await page.textContent('#auth-who');
  console.log(`${pinErr && who.includes('번개손') && who.includes('U12') && who.includes('#87') ? 'PASS' : 'FAIL'} register with nickname + 6-digit pin + jersey number (${who.trim()})`);
  if (!(pinErr && who.includes('번개손') && who.includes('#87'))) failed = true;
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
  // 모드 화면 3×3: 가운데(5번)는 비어 있고 9번은 커뮤니티
  await page.click('#btn-mode');
  const grid = await page.evaluate(() => { const kids = [...document.querySelector('#mode-list').children]; return { n: kids.length, mid: kids[4].className, last: kids[8].className, lastText: kids[8].textContent, cards: document.querySelectorAll('#mode-list .mode-card').length, cols: getComputedStyle(document.querySelector('#mode-list')).gridTemplateColumns.split(' ').length }; });
  const gridOk = grid.n === 9 && grid.mid === 'mode-wait' && /mode-community/.test(grid.last) && /커뮤니티/.test(grid.lastText) && grid.cards === 8 && grid.cols === 3;
  console.log(`${gridOk ? 'PASS' : 'FAIL'} mode grid 3x3 with empty center and community in cell 9 (${JSON.stringify(grid)})`);
  if (!gridOk) failed = true;
  // 자유 연습(8번 칸) 선택 -> 코스 편집: 번호 3, 1을 끌어다 놓기 -> 저장, 번호 순서 정렬
  await page.click('#mode-list > :nth-child(8)');
  await page.waitForSelector('#course:not(.hidden)');
  const fieldBox = await (await page.$('#course-field')).boundingBox();
  const dragPt = async (n, fx, fy) => { const b = await (await page.$(`.course-pt[data-n="${n}"]`)).boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(fieldBox.x + fieldBox.width * fx, fieldBox.y + fieldBox.height * fy, { steps: 6 }); await page.mouse.up(); };
  await dragPt(3, 0.75, 0.6); await dragPt(1, 0.25, 0.6);
  const course = await page.evaluate(() => ({ saved: JSON.parse(localStorage.getItem('puck-trainer.settings.v1')).course, game: window.__puckTrainer.game.course.points.map((p) => p.n), inField: document.querySelectorAll('#course-field > .course-pt').length, inTray: document.querySelectorAll('#course-slots > .course-pt').length }));
  const courseOk = course.saved.length === 2 && course.game.join(',') === '1,3' && course.inField === 2 && course.inTray === 8 && Math.abs(course.saved.find((p) => p.n === 3).x - 0.75) < 0.03;
  console.log(`${courseOk ? 'PASS' : 'FAIL'} course builder: drag numbers onto the field (${JSON.stringify(course.game)}, field ${course.inField}, tray ${course.inTray})`);
  if (!courseOk) failed = true;
  // 트레이로 되돌리면 삭제
  await dragPt(3, 0.5, 0.02);
  const afterRemove = await page.evaluate(() => window.__puckTrainer.game.course.points.map((p) => p.n).join(','));
  await dragPt(3, 0.75, 0.6);
  console.log(`${afterRemove === '1' ? 'PASS' : 'FAIL'} course builder: dropping on the tray removes the point`);
  if (afterRemove !== '1') failed = true;
  // 목표 사이클 수: − / + 로 10~100 (10 단위), 범위를 넘지 않고 저장됨
  const cyc = async () => page.evaluate(() => ({ out: document.querySelector('#cycles-out').value, game: window.__puckTrainer.game.course.cycles, saved: JSON.parse(localStorage.getItem('puck-trainer.settings.v1')).courseCycles, decOff: document.querySelector('#cycles-dec').disabled, incOff: document.querySelector('#cycles-inc').disabled }));
  const c0 = await cyc();
  await page.click('#cycles-inc'); await page.click('#cycles-inc');
  const c1 = await cyc();
  for (let i = 0; i < 12; i++) await page.evaluate(() => document.querySelector('#cycles-inc').click());
  const c2 = await cyc();
  for (let i = 0; i < 12; i++) await page.evaluate(() => document.querySelector('#cycles-dec').click());
  const c3 = await cyc();
  const hudIdle = (await page.textContent('#hud-score')).trim();
  const cycOk = c0.out === '10' && c0.decOff && c1.out === '30' && c1.game === 30 && c1.saved === 30 && c2.out === '100' && c2.incOff && c3.out === '10' && c3.game === 10 && hudIdle === '0/10';
  console.log(`${cycOk ? 'PASS' : 'FAIL'} course cycles stepper 10..100 (${c0.out} -> ${c1.out} -> ${c2.out} -> ${c3.out}, hud ${hudIdle})`);
  if (!cycOk) failed = true;
  // 플레이: 1번 -> 3번 순서로 퍽을 옮기면 포인트 통과 + 한 바퀴
  const toUV = (p) => page.evaluate(([x, y]) => { const g = window.__puckTrainer.game; const t = window.__puckTrainer.tracker; const v = g.plane.flip ? 1 - y : y; const orig = Object.getPrototypeOf(t).update; t.update = function (m, now) { return orig.call(this, { u: x, v }, now); }; }, p);
  await page.evaluate(() => { window.__puckTrainer.settings.autoStart = false; });
  await toUV([0.5, 0.9]);
  await page.click('#btn-start'); await page.waitForTimeout(300);
  const saved2 = await page.evaluate(() => JSON.parse(localStorage.getItem('puck-trainer.settings.v1')).course);
  const p1 = saved2.find((p) => p.n === 1), p3 = saved2.find((p) => p.n === 3);
  await toUV([p1.x, p1.y]); await page.waitForTimeout(500);
  const nextIs3 = await page.evaluate(() => document.querySelector('.course-pt.next')?.dataset.n);
  await toUV([p3.x, p3.y]); await page.waitForTimeout(500);
  const lap = await page.evaluate(() => ({ reached: window.__puckTrainer.game.stats.reached, laps: window.__puckTrainer.game.stats.laps }));
  console.log(`${nextIs3 === '3' && lap.reached === 2 && lap.laps === 1 ? 'PASS' : 'FAIL'} course play: points in order and lap (next=${nextIs3}, ${JSON.stringify(lap)})`);
  if (!(nextIs3 === '3' && lap.reached === 2 && lap.laps === 1)) failed = true;
  await page.waitForTimeout(250);
  const hudPlay = { score: (await page.textContent('#hud-score')).trim(), info: (await page.textContent('#hud-lives')).trim(), label: (await page.textContent('.hud-right .hud-label')).trim() };
  const hudOk = hudPlay.score === '1/10' && /평균 \d+\.\ds · 최고 \d+\.\ds/.test(hudPlay.info) && hudPlay.label === 'Cycle';
  console.log(`${hudOk ? 'PASS' : 'FAIL'} course HUD shows cycle progress, average and fastest (${JSON.stringify(hudPlay)})`);
  if (!hudOk) failed = true;
  await page.screenshot({ path: join(ROOT, 'test', 'screenshot-course.png') });
  await page.click('#btn-start');
  await page.waitForSelector('#panel-result:not(.hidden)');
  const resCourse = await page.textContent('#result-body');
  const resOk = resCourse.includes('완료 사이클') && resCourse.includes('1 / 10') && resCourse.includes('평균 사이클') && resCourse.includes('가장 빠른 사이클');
  console.log(`${resOk ? 'PASS' : 'FAIL'} course result shows cycles done, average and fastest cycle`);
  if (!resOk) failed = true;
  await page.evaluate(() => { delete window.__puckTrainer.tracker.update; window.__puckTrainer.settings.autoStart = true; });
  await page.click('[data-close="panel-result"]');
  // 다시 아케이드로
  await page.click('#btn-mode'); await page.click('#mode-list > :nth-child(1)');

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

  // 내 퍽 표시 슬라이더 (10 단위, 0~100) -> 아케이드·평면 렌더러에 반영되고 저장됨
  await page.click('#btn-settings');
  const sliderAttr = await page.evaluate(() => { const el = document.querySelector('#set-puckOpacity'); return { min: el.min, max: el.max, step: el.step, value: el.value }; });
  await page.evaluate(() => { const el = document.querySelector('#set-puckOpacity'); el.value = '30'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const po = await page.evaluate(() => ({ a: window.__puckTrainer.game.arcade.puckAlpha, saved: JSON.parse(localStorage.getItem('puck-trainer.settings.v1')).puckOpacity, out: document.querySelector('#out-puckOpacity').value }));
  await page.evaluate(() => { const el = document.querySelector('#set-puckOpacity'); el.value = '100'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('[data-close="panel-settings"]');
  const poOk = sliderAttr.min === '0' && sliderAttr.max === '100' && sliderAttr.step === '10' && sliderAttr.value === '100' && Math.abs(po.a - 0.3) < 1e-9 && po.saved === 30 && po.out === '30';
  console.log(`${poOk ? 'PASS' : 'FAIL'} puck opacity slider 0..100 step 10 (30% -> alpha ${po.a})`);
  if (!poOk) failed = true;

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
  console.log(`${resultText.includes('터치') && resultText.includes('Quick hands') ? 'PASS' : 'FAIL'} arcade result report`);
  // 게임 종료 후 선택: 결과 창이 열린 채로 퍽을 왼쪽에 2초 두면 한 번 더, 오른쪽에 두면 모드 선택
  const forceU = (u) => page.evaluate((uu) => { const t = window.__puckTrainer.tracker; const orig = Object.getPrototypeOf(t).update; t.update = function (meas, now) { return orig.call(this, { u: uu, v: 0.5 }, now); }; }, u);
  await forceU(0.5);
  await page.waitForTimeout(3200);
  const centerNoop = (await page.isVisible('#panel-result')) && (await page.textContent('#btn-start')).trim() === '시작';
  await forceU(0.15);
  await page.waitForTimeout(900);
  const fillPct = await page.evaluate(() => parseFloat(document.querySelector('#btn-result-again .choice-fill').style.width) || 0);
  const dotLeft = await page.evaluate(() => parseFloat(document.querySelector('#choice-dot').style.left));
  await page.waitForTimeout(1900);
  const again = (await page.textContent('#btn-start')).trim() === '중지' && (await page.isHidden('#panel-result'));
  console.log(`${centerNoop && fillPct > 5 && fillPct < 100 && Math.abs(dotLeft - 15) < 2 && again ? 'PASS' : 'FAIL'} result choice: puck left 2s -> play again (center no-op=${centerNoop}, fill ${fillPct.toFixed(0)}%, dot ${dotLeft}%)`);
  if (!(centerNoop && again)) failed = true;
  await page.click('#btn-start'); // 중지 -> 결과 창
  await page.waitForSelector('#panel-result:not(.hidden)');
  await forceU(0.85);
  await page.waitForTimeout(3200);
  const toMode = (await page.isVisible('#panel-mode')) && (await page.isHidden('#panel-result')) && (await page.textContent('#btn-start')).trim() === '시작';
  console.log(`${toMode ? 'PASS' : 'FAIL'} result choice: puck right 2s -> mode selection`);
  if (!toMode) failed = true;
  // 모드 선택 화면도 퍽으로: 열릴 때 커서가 올라가 있던 카드는 선택되지 않고(위에서 3.2초 대기 후에도 창이 열려 있음),
  // 다른 카드로 옮겨 2초 머물면 그 모드가 선택됨. (기본 방향: 카메라 쪽으로 밀면 위 -> v 0.9 = 맨 윗줄)
  const forceUV = (u, v) => page.evaluate(([uu, vv]) => { const t = window.__puckTrainer.tracker; const orig = Object.getPrototypeOf(t).update; t.update = function (meas, now) { return orig.call(this, { u: uu, v: vv }, now); }; }, [u, v]);
  const cursorShown = await page.isVisible('#mode-cursor');
  await forceUV(0.85, 0.9); // 맨 윗줄 세 번째 카드 = 와이드 드리블
  await page.waitForTimeout(900);
  const dwell = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelectorAll('#mode-list .mode-card')[2]).getPropertyValue('--dwell')) || 0);
  await page.waitForTimeout(1800);
  const picked = (await page.isHidden('#panel-mode')) && (await page.textContent('#hud-mode')).includes('와이드');
  console.log(`${cursorShown && dwell > 5 && picked ? 'PASS' : 'FAIL'} mode panel pick by puck (cursor=${cursorShown}, dwell ${dwell.toFixed(0)}%, mode=${(await page.textContent('#hud-mode')).trim()})`);
  if (!(cursorShown && picked)) failed = true;
  await page.evaluate(() => { const t = window.__puckTrainer.tracker; delete t.update; });
  if (await page.isVisible('#panel-mode')) await page.click('[data-close="panel-mode"]');
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

// ---- 5) 영어 화면 + 커뮤니티: 언어 전환, 코스 도전 -> 기록 게시판 -> 기록 갱신 공유, 코스·기록 글쓰기 ----
{
  const context = await newCtx({ locale: 'en-US', viewport: { width: 1180, height: 820 }, permissions: ['camera'], deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const ok = (cond, name, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!cond) failed = true; };
  const tick = (ms = 80) => page.waitForTimeout(ms);
  // 화면에 남아 있는 한국어 (사용자가 쓴 글 data-ugc 제외)
  const leftover = () => page.evaluate(() => {
    const H = /[ㄱ-ㆎ가-힣]/, out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const el = n.nodeType === 3 ? n.parentElement : n;
      if (el.closest('[data-ugc], script, style')) continue;
      if (n.nodeType === 3) { if (H.test(n.nodeValue)) out.push(n.nodeValue.trim().slice(0, 60)); }
      else for (const a of ['placeholder', 'title', 'aria-label', 'data-label']) if (H.test(n.getAttribute(a) || '')) out.push(`@${a}=${n.getAttribute(a)}`);
    }
    return out;
  });
  await page.goto(`${base}/index.html`);
  await tick();
  const first = await page.evaluate(() => ({ lang: document.documentElement.lang, lead: document.querySelector('.lead').textContent, ph: document.querySelector('#pin-input').placeholder, on: document.querySelector('.lang-row [data-lang].active')?.dataset.lang, visible: !!document.querySelector('.lang-row [data-lang="ko"]').offsetParent }));
  ok(first.lang === 'en' && /stickhandling/.test(first.lead) && first.ph === 'Access code' && first.on === 'en' && first.visible, 'English browser opens in English with language buttons on the first screen', JSON.stringify(first));
  await page.click('.lang-row [data-lang="ko"]'); await tick();
  const ko = await page.evaluate(() => ({ lang: document.documentElement.lang, lead: document.querySelector('.lead').textContent, ph: document.querySelector('#pin-input').placeholder, btn: document.querySelector('#pin-form button').textContent }));
  ok(ko.lang === 'ko' && /스틱핸들링/.test(ko.lead) && ko.ph === '접속 코드' && ko.btn === '확인', '한국어 button restores the Korean screen', JSON.stringify(ko));
  await page.click('.lang-row [data-lang="en"]'); await tick();
  await page.reload(); await tick();
  ok(await page.evaluate(() => document.documentElement.lang === 'en' && document.querySelector('#pin-form button').textContent === 'OK'), 'language choice is remembered after reload');
  await page.fill('#pin-input', '1234'); await page.click('#pin-form button');
  await page.waitForSelector('#btn-camera:visible');
  await page.waitForFunction(() => window.__puckTrainer?.account);
  await page.click('.auth-tabs .tab[data-tab="register"]');
  await page.fill('#auth-nick', 'Ace'); await page.fill('#auth-pin', '123456');
  await page.selectOption('#auth-country', 'US'); await page.fill('#auth-team', 'Blades'); await page.fill('#auth-age', '25');
  await page.evaluate(() => document.querySelector('#auth-form').requestSubmit());
  await page.waitForSelector('#auth-logged:not(.hidden)'); await tick();
  const who = await page.textContent('#auth-who');
  ok(/Ace/.test(who) && /USA/.test(who) && /Adult \(age 25\)/.test(who), 'profile line is shown in English', who.trim());
  ok((await leftover()).length === 0, 'no Korean left on the English first screen', JSON.stringify(await leftover()));
  await page.click('#btn-camera');
  await page.waitForFunction(() => window.__puckTrainer.app.started && window.__puckTrainer.app.lastVision, null, { timeout: 15000 });
  await page.evaluate(() => { window.__puckTrainer.settings.autoStart = false; });
  await tick(300);
  // 모든 패널을 열어 남은 한국어가 없는지 확인
  const left = [];
  for (const [btn, panel] of [['#btn-mode', 'panel-mode'], ['#btn-settings', 'panel-settings'], ['#btn-calib', 'panel-calib'], ['#btn-rank', 'panel-rank']]) {
    await page.click(btn); await page.waitForSelector(`#${panel}:not(.hidden)`); await tick(150);
    left.push(...(await leftover()));
    await page.click(`[data-close="${panel}"]`);
  }
  const hud = await page.evaluate(() => ({ mode: document.querySelector('#hud-mode').textContent, start: document.querySelector('#btn-start').textContent, ctl: [...document.querySelectorAll('#controls .btn')].map((b) => b.textContent).join('|') }));
  ok(left.length === 0 && /^Arcade/.test(hud.mode) && hud.start === 'Start' && hud.ctl === 'Mode|Area|Calibrate|Settings|Ranking|Start', 'stage, HUD and every panel are in English', JSON.stringify({ left, hud }));

  // ---- 커뮤니티: 9번 칸 ----
  await page.click('#btn-mode'); await page.waitForSelector('#panel-mode:not(.hidden)');
  await page.click('#mode-list .mode-community');
  await page.waitForSelector('#panel-community:not(.hidden)'); await page.waitForSelector('#comm-list .post');
  const feed = await page.evaluate(() => ({ modeHidden: document.querySelector('#panel-mode').classList.contains('hidden'), n: document.querySelectorAll('#comm-list .post').length, titles: [...document.querySelectorAll('#comm-list .post h3')].map((h) => h.textContent), svg: document.querySelectorAll('#comm-list .course-svg').length, note: document.querySelector('#comm-note').textContent }));
  ok(feed.modeHidden && feed.n === 3 && feed.titles.includes('Side-to-side wide') && feed.svg === 3 && /this device only/.test(feed.note), 'cell 9 opens the community with starter courses', JSON.stringify(feed.titles));
  ok((await leftover()).length === 0, 'community panel is in English', JSON.stringify(await leftover()));
  // 코스 도전: 불러오기 -> 자유 연습
  await page.click('#comm-list .post[data-id="starter-wide"] [data-act="practice"]');
  await tick(200);
  const ch = await page.evaluate(() => { const t = window.__puckTrainer; return { closed: document.querySelector('#panel-community').classList.contains('hidden'), mode: t.game.mode.id, pts: t.game.course.points.length, cycles: t.game.course.cycles, id: t.app.challenge?.id, hud: document.querySelector('#hud-instruction').textContent, toast: document.querySelector('#toast').textContent }; });
  ok(ch.closed && ch.mode === 'free' && ch.pts === 2 && ch.cycles === 10 && ch.id === 'starter-wide' && /^Challenge · Side-to-side wide/.test(ch.hud) && /Challenge: 'Side-to-side wide'/.test(ch.toast), 'practice loads the shared course as a challenge', JSON.stringify(ch));
  // 완주: 마지막 한 사이클만 실제로 돌고 나머지는 기록을 채워 둔다
  const toUV = (p) => page.evaluate(([x, y]) => { const g = window.__puckTrainer.game; const t = window.__puckTrainer.tracker; const v = g.plane.flip ? 1 - y : y; const orig = Object.getPrototypeOf(t).update; t.update = function (m, now) { return orig.call(this, { u: x, v }, now); }; }, p);
  const finish = async (lapTimes) => {
    const pts = await page.evaluate(() => window.__puckTrainer.game.course.points);
    await toUV([0.5, 0.95]);
    await page.click('#btn-start'); await tick(300);
    await page.evaluate((lt) => { const g = window.__puckTrainer.game; g.stats.laps = lt.length; g.stats.lapTimes = lt; }, lapTimes);
    for (const p of pts) { await toUV([p.x, p.y]); await tick(450); }
    await page.waitForSelector('#panel-result:not(.hidden)');
    await page.waitForSelector('#result-share:not(.hidden)');
    await page.evaluate(() => { delete window.__puckTrainer.tracker.update; });
    return page.evaluate(() => ({ msg: document.querySelector('#result-share .share-msg').textContent.replace(/\s+/g, ' ').trim(), btn: document.querySelector('#btn-share')?.textContent }));
  };
  const run1 = await finish(Array(9).fill(4));
  ok(/First record!/.test(run1.msg) && /first record holder/.test(run1.msg) && run1.btn === 'View record board', 'finishing a challenge puts the first record on the board', JSON.stringify(run1));
  await page.click('#btn-share');
  await page.waitForSelector('#panel-community:not(.hidden)'); await tick(200);
  const board1 = await page.evaluate(() => ({ resultHidden: document.querySelector('#panel-result').classList.contains('hidden'), rows: [...document.querySelectorAll('.post[data-id="starter-wide"] .post-board li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()) }));
  ok(board1.resultHidden && board1.rows.length === 1 && /^1\s*Ace\s*avg \d\.\ds\s*best \d\.\ds$/.test(board1.rows[0]), 'record board lists the holder', JSON.stringify(board1.rows));
  // 다른 선수가 같은 코스로 기록을 갈아치움
  await page.evaluate(async () => { const a = window.__puckTrainer.account; a.logout(); await a.register({ nick: 'Bee', pin: '654321', country: 'CA', team: 'Hive', age: 12 }); });
  await page.click('#comm-list .post[data-id="starter-wide"] [data-act="practice"]'); await tick(200);
  const holder = await page.evaluate(() => window.__puckTrainer.app.challenge.holder);
  const run2 = await finish(Array(9).fill(1));
  ok(holder.nick === 'Ace' && /New record!/.test(run2.msg) && /Record beaten: Ace avg \d\.\ds → \d\.\ds/.test(run2.msg) && run2.btn === 'Share new record', 'a faster player beats the record and can share it', JSON.stringify(run2));
  await page.click('#btn-share');
  await page.waitForSelector('#comm-form:not(.hidden)');
  const draft = await page.evaluate(() => ({ title: document.querySelector('#comm-title').value, typeHidden: document.querySelector('#comm-type').classList.contains('hidden'), pv: document.querySelector('#comm-preview').textContent.replace(/\s+/g, ' ').trim(), off: document.querySelector('#comm-submit').disabled }));
  await page.fill('#comm-body', 'Who is next?');
  await page.click('#comm-submit'); await tick(250);
  const beat = await page.evaluate(() => { const p = document.querySelector('#comm-list .post'); return { cls: p.className, tag: p.querySelector('.post-tag').textContent, head: p.querySelector('.post-head').textContent.replace(/\s+/g, ' '), beat: p.querySelector('.beat-line').textContent.replace(/\s+/g, ' ').trim(), formHidden: document.querySelector('#comm-form').classList.contains('hidden'), n: document.querySelectorAll('#comm-list .post').length, board: [...document.querySelectorAll('.post[data-id="starter-wide"] .post-board li b')].map((b) => b.textContent).join('>') }; });
  ok(draft.title === 'Side-to-side wide: new record!' && draft.typeHidden && !draft.off && /Record beaten:\s*Ace/.test(draft.pv) && /post-beat/.test(beat.cls) && beat.tag === 'New record' && /Bee/.test(beat.head) && /Record beaten:\s*Ace\s*avg \d\.\ds → \d\.\ds/.test(beat.beat) && beat.formHidden && beat.n === 4 && beat.board === 'Bee>Ace',
    'record-beating post is published and the board order changes', JSON.stringify({ draft, beat }));
  // 내 코스 공유 (현재 코스 + 내 기록)
  await page.click('#comm-write'); await page.waitForSelector('#comm-form:not(.hidden)');
  const pv = await page.evaluate(() => ({ active: document.querySelector('#comm-type .active')?.dataset.type, pv: document.querySelector('#comm-preview').textContent.replace(/\s+/g, ' ').trim() }));
  await page.fill('#comm-title', 'My wide course'); await page.click('#comm-submit'); await tick(150);
  const needBody = await page.evaluate(() => ({ err: document.querySelector('#comm-error').textContent, hidden: document.querySelector('#comm-error').classList.contains('hidden') }));
  await page.fill('#comm-body', 'Builds reach on the backhand side.'); await page.click('#comm-submit'); await tick(250);
  const mine = await page.evaluate(() => { const p = document.querySelector('#comm-list .post'); return { title: p.querySelector('h3').textContent, body: p.querySelector('.post-body').textContent, row: p.querySelector('.post-board li')?.textContent.replace(/\s+/g, ' ').trim(), del: !!p.querySelector('[data-act="delete"]'), stored: JSON.parse(localStorage.getItem('puck-trainer.community.v1')).length }; });
  ok(pv.active === 'course' && /2 points · 10 cycles/.test(pv.pv) && /My record · avg \d\.\ds · best/.test(pv.pv) && !needBody.hidden && /Describe what practicing/.test(needBody.err) && mine.title === 'My wide course' && /backhand/.test(mine.body) && /^1\s*Bee\s*Author\s*avg/.test(mine.row) && mine.del && mine.stored === 5,
    'sharing my course posts the note and my cycle record', JSON.stringify({ pv, needBody, mine }));
  // 응원 + 삭제(두 번 눌러야 삭제)
  await page.click('#comm-list .post [data-act="cheer"]'); await tick(150);
  const cheers = await page.textContent('#comm-list .post [data-act="cheer"] span');
  await page.click('#comm-list .post [data-act="delete"]'); await tick(50);
  const sure = await page.textContent('#comm-list .post [data-act="delete"]');
  await page.click('#comm-list .post [data-act="delete"]'); await tick(200);
  const afterDel = await page.evaluate(() => [...document.querySelectorAll('#comm-list .post h3')].map((h) => h.textContent));
  ok(cheers === '1' && sure === 'Really delete?' && afterDel.length === 4 && !afterDel.includes('My wide course'), 'cheer and two-step delete', JSON.stringify({ cheers, sure, afterDel }));
  // 코스를 고치면 도전 해제
  await page.click('[data-close="panel-community"]');
  await page.click('#cycles-inc'); await tick(100);
  const cancelled = await page.evaluate(() => ({ ch: window.__puckTrainer.app.challenge, toast: document.querySelector('#toast').textContent }));
  ok(cancelled.ch === null && /challenge cancelled/.test(cancelled.toast), 'changing the course cancels the challenge', cancelled.toast);
  // 기록 자랑: 아케이드를 끝까지 -> 결과 화면에서 공유 -> '나도 도전'
  await page.click('#btn-mode'); await page.waitForSelector('#panel-mode:not(.hidden)');
  await page.click('#mode-list .mode-card:nth-child(1)'); await tick(100);
  await page.click('#btn-start'); await tick(300);
  await page.evaluate(() => { const g = window.__puckTrainer.game; g.score = 1230; if (g.arcade) g.arcade.score = 1230; g.stop('time'); });
  await page.waitForSelector('#result-share:not(.hidden)');
  const shareBtn = await page.textContent('#btn-share');
  await page.click('#btn-share'); await page.waitForSelector('#comm-form:not(.hidden)');
  const recPv = await page.evaluate(() => ({ active: document.querySelector('#comm-type .active')?.dataset.type, pv: document.querySelector('#comm-preview').textContent.replace(/\s+/g, ' ').trim() }));
  await page.fill('#comm-title', 'Finally!'); await page.click('#comm-submit'); await tick(250);
  const rec = await page.evaluate(() => { const p = document.querySelector('#comm-list .post'); return { cls: p.className, score: p.querySelector('.post-score b').textContent, sub: p.querySelector('.post-score span').textContent, act: p.querySelector('[data-act="mode"]').textContent }; });
  await page.click('#comm-filter [data-filter="course"]'); await tick(200);
  const onlyCourses = await page.evaluate(() => [...document.querySelectorAll('#comm-list .post')].every((p) => p.classList.contains('post-course')) && document.querySelectorAll('#comm-list .post').length === 3);
  await page.click('#comm-filter [data-filter="record"]'); await tick(200);
  const onlyRecords = await page.evaluate(() => document.querySelectorAll('#comm-list .post').length === 2 && !document.querySelector('#comm-list .post.post-course'));
  await page.evaluate(() => { window.__puckTrainer.game.setMode('wide'); });
  await page.click('#comm-list .post-record [data-act="mode"]'); await tick(150);
  const took = await page.evaluate(() => ({ mode: window.__puckTrainer.game.mode.id, closed: document.querySelector('#panel-community').classList.contains('hidden'), toast: document.querySelector('#toast').textContent }));
  ok(shareBtn === 'Share record' && recPv.active === 'record' && /Arcade · 1 min/.test(recPv.pv) && /post-record/.test(rec.cls) && Number(rec.score) > 0 && rec.sub === 'Arcade · 1 min' && rec.act === 'Take it on' && onlyCourses && onlyRecords && took.mode === 'arcade' && took.closed && /Arcade — beat \d+ points!/.test(took.toast),
    'record brag from the result screen, filters, and "Take it on"', JSON.stringify({ shareBtn, recPv, rec, onlyCourses, onlyRecords, took }));
  // 글쓰기는 로그인 필요
  await page.evaluate(() => window.__puckTrainer.account.logout());
  await page.click('#btn-mode'); await page.click('#mode-list .mode-community'); await page.waitForSelector('#panel-community:not(.hidden)'); await tick(150);
  await page.click('#comm-write'); await tick(100);
  const guest = await page.evaluate(() => ({ form: document.querySelector('#comm-form').classList.contains('hidden'), toast: document.querySelector('#toast').textContent, note: document.querySelector('#comm-note').textContent }));
  ok(guest.form && /Log in to post/.test(guest.toast) && /Log in to post or submit records/.test(guest.note), 'guests can read but must log in to post', guest.toast);
  await page.screenshot({ path: join(ROOT, 'test', 'screenshot-community.png') });
  const miss = await page.evaluate(() => [...window.__puckTrainer.i18n.missing]);
  ok(miss.length === 0, 'no untranslated text was shown during the English session', JSON.stringify(miss));
  if (errors.length) { console.error('FAIL console errors:', errors); failed = true; } else console.log('PASS no console errors (English + community)');
  await context.close();
}

// ---- 6) 번역 누락 검사: 소스의 모든 한국어 문구가 영어 사전에 있어야 함 ----
{
  const { checkCoverage } = await import('./i18n-coverage.mjs');
  const { total, missing } = await checkCoverage();
  for (const m of missing) console.log(`  MISSING [${m.src}] ${JSON.stringify(m.s)}`);
  console.log(`${missing.length ? 'FAIL' : 'PASS'} i18n coverage: ${total - missing.length}/${total} source strings have an English translation`);
  if (missing.length) failed = true;
}

await browser.close();
server.close();
console.log(failed ? '\nSOME TESTS FAILED' : '\nALL TESTS PASSED');
process.exit(failed ? 1 : 0);
