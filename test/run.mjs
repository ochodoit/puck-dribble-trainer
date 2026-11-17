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
// 테스트는 실제 Firebase(운영 데이터)에 절대 쓰지 않는다: firebase-config.js 를 null 로 바꿔 기기 내 저장소로 동작
const newCtx = async (opts) => {
  const c = await browser.newContext({ locale: 'ko-KR', ...opts });
  await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await c.route(/\/src\/firebase-config\.js(\?|$)/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'export const firebaseConfig = null;\n' }));
  await c.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  return c;
};
let failed = false;
/** 카메라 시작 직후의 준비 과정(1/2 플레이 공간 -> 2/2 퍽 등록 -> 모드 창)을 건너뛰어 대기 화면으로 */
const skipSetup = async (page, touch = false) => {
  await page.waitForSelector('#area-step:not(.hidden)', { timeout: 8000 });
  if (touch) await page.tap('#area-done'); else await page.click('#area-done');
  await page.waitForSelector('#setup-bar:not(.hidden)');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#panel-mode:not(.hidden)');
  if (touch) await page.tap('[data-close="panel-mode"]'); else await page.click('[data-close="panel-mode"]');
};

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
  await page.waitForFunction(() => window.__puckTrainer?.account);
  // 접속 코드 화면은 없어짐: 첫 화면에 바로 카메라 시작 버튼
  const noGate = (await page.$('#pin-form')) === null && await page.isVisible('#btn-camera');
  console.log(`${noGate ? 'PASS' : 'FAIL'} no access-code gate: camera button is on the first screen`);
  if (!noGate) failed = true;
  // 가입 코드 없이는 정회원 가입이 안 됨
  const fillReg = async (pin = '123456') => {
    await page.fill('#auth-nick', '번개손'); await page.fill('#auth-pin', pin);
    await page.selectOption('#auth-country', 'KR'); await page.fill('#auth-team', '서울 유스'); await page.fill('#auth-age', '11'); await page.fill('#auth-number', '87');
    await page.click('#auth-stick [data-stick="L"]');
  };
  await page.click('.auth-tabs .tab[data-tab="register"]');
  await fillReg();
  await page.evaluate(() => document.querySelector('#auth-form').requestSubmit());
  await page.waitForSelector('#auth-error:not(.hidden)');
  const noCodeErr = (await page.textContent('#auth-error')).trim();
  console.log(`${noCodeErr === '가입 코드가 필요합니다' && await page.isHidden('#auth-logged') ? 'PASS' : 'FAIL'} sign-up without a code is refused (${noCodeErr})`);
  if (noCodeErr !== '가입 코드가 필요합니다') failed = true;
  // 초대 링크(?c=코드): 마감된 코드는 안내만, 베타 링크는 회원가입 칸을 열고 코드를 채움. 주소의 ?c= 는 지움
  await page.evaluate(() => { const a = window.__puckTrainer.account; a._putCode('OLDCODE1', { type: 'one', expiresAt: Date.now() - 1000 }); a._putCode('BETA2026', { type: 'beta', maxUses: 0, expiresAt: Date.now() + 7 * 864e5 }); });
  const inviteState = () => page.evaluate(() => ({ bad: document.querySelector('#invite-card').classList.contains('bad'), title: document.querySelector('#invite-title').textContent, sub: document.querySelector('#invite-sub').textContent,
    code: document.querySelector('#auth-code').value, codeShown: !!document.querySelector('#auth-code').offsetParent, search: location.search, reg: document.querySelector('.auth-tabs .tab[data-tab="register"]').classList.contains('active') }));
  await page.goto(`${base}/index.html?c=oldc-ode1`);
  await page.waitForSelector('#invite-card:not(.hidden)');
  const expired = await inviteState();
  console.log(`${expired.bad && expired.title === '마감된 링크예요' && !expired.reg && expired.search === '' ? 'PASS' : 'FAIL'} expired invite link shows a notice, no sign-up (${JSON.stringify(expired)})`);
  if (!(expired.bad && expired.title === '마감된 링크예요')) failed = true;
  await page.goto(`${base}/index.html?c=beta-2026`);
  await page.waitForSelector('#invite-card:not(.hidden)');
  const inv = await inviteState();
  const invOk = !inv.bad && inv.title === '베타 초대 링크예요' && /까지 가입하면 바로 정회원$/.test(inv.sub) && inv.code === 'BETA-2026' && inv.codeShown && inv.reg && inv.search === '';
  console.log(`${invOk ? 'PASS' : 'FAIL'} beta invite link opens sign-up with the code filled in (${JSON.stringify(inv)})`);
  if (!invOk) failed = true;
  // 회원가입 (별명 + 6자리 비밀번호 + 국가/팀/나이 + 가입 코드)
  await fillReg('12345');
  await page.evaluate(() => document.querySelector('#auth-form').requestSubmit());
  await page.waitForTimeout(200);
  const pinErr = await page.isHidden('#auth-logged'); // 5자리는 브라우저 검증(pattern)에서 막혀 가입되지 않아야 함
  await page.fill('#auth-pin', '123456');
  await page.evaluate(() => document.querySelector('#auth-form').requestSubmit());
  await page.waitForSelector('#auth-logged:not(.hidden)');
  const who = await page.textContent('#auth-who');
  const afterJoin = await page.evaluate(() => ({ card: document.querySelector('#invite-card').classList.contains('hidden'), kept: localStorage.getItem('puck-trainer.invite.v1') }));
  const joinOk = pinErr && who.includes('번개손') && who.includes('U12') && who.includes('#87') && who.includes('베타 멤버 No.0001') && afterJoin.card && afterJoin.kept === null;
  console.log(`${joinOk ? 'PASS' : 'FAIL'} register with nickname + 6-digit pin + jersey number + beta code -> beta member No.0001 (${who.trim()})`);
  if (!joinOk) failed = true;
  await page.click('#btn-camera');
  await page.waitForFunction(() => document.querySelector('#splash').classList.contains('hidden'), null, { timeout: 10000 });
  // 시작 준비: 1/2 플레이 공간(완료) -> 2/2 퍽 등록(Esc로 건너뛰기) -> 모드 창이 열림(닫기)
  await page.waitForSelector('#area-step:not(.hidden)', { timeout: 5000 });
  await page.click('#area-done');
  await page.waitForSelector('#setup-bar:not(.hidden)');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#panel-mode:not(.hidden)');
  const setupOk = await page.evaluate(() => window.__puckTrainer.app.setup === null && document.querySelector('#setup-bar').classList.contains('hidden'));
  console.log(`${setupOk ? 'PASS' : 'FAIL'} start setup: play area -> puck registration -> mode window`);
  if (!setupOk) failed = true;
  await page.click('[data-close="panel-mode"]');
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
  // 화면 전체 영역(모서리가 화면 끝)에서 편집을 시작하면 가운데 틀(0.3~0.7)에서 시작해 바깥으로 넓힌다
  await page.evaluate(() => { const s = document.querySelector('#set-floorMode'); s.value = 'full'; s.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(300);
  await page.click('#btn-floor-lock');
  await page.waitForSelector('#area-bar:not(.hidden)');
  const startQuad = await page.evaluate(() => JSON.stringify(window.__puckTrainer.settings.manualQuad));
  const inView = await page.$$eval('#floor-handles .handle', (hs) => { const v = document.querySelector('#view').getBoundingClientRect(); return hs.every((h) => { const r = h.getBoundingClientRect(); return r.left >= v.left && r.right <= v.right && r.top >= v.top && r.bottom <= v.bottom; }); });
  const centered = startQuad === JSON.stringify([[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]]);
  console.log(`${centered && inView ? 'PASS' : 'FAIL'} area edit from full screen starts with a center frame, handles fully on screen (${startQuad})`);
  if (!(centered && inView)) failed = true;
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
  // 다시 열면 맞춰 둔 틀을 그대로 쓰고, '가운데 틀로'는 가운데 틀로 되돌린다
  await page.click('#btn-floor-lock');
  await page.waitForSelector('#area-bar:not(.hidden)');
  const kept = await page.evaluate(() => window.__puckTrainer.settings.manualQuad[0][0]);
  await page.click('#area-reset');
  const reset = await page.evaluate(() => JSON.stringify(window.__puckTrainer.settings.manualQuad));
  await page.click('#area-done');
  const keptOk = Math.abs(kept - savedQuad.manualQuad[0][0]) < 1e-6 && reset === JSON.stringify([[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]]);
  console.log(`${keptOk ? 'PASS' : 'FAIL'} area edit keeps the fitted frame; reset returns to the center frame (${kept.toFixed(3)})`);
  if (!keptOk) failed = true;

  // 배경 투명도 슬라이더 -> 아케이드·퍽 피하기 배경 불투명도에 반영되고 저장됨
  await page.click('#btn-settings');
  await page.evaluate(() => { const el = document.querySelector('#set-bgTransparency'); el.value = '60'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const wash = await page.evaluate(() => ({ a: window.__puckTrainer.game.arcade.wash, saved: JSON.parse(localStorage.getItem('puck-trainer.settings.v1')).bgTransparency, out: document.querySelector('#out-bgTransparency').value }));
  await page.evaluate(() => { const el = document.querySelector('#set-bgTransparency'); el.value = '10'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('[data-close="panel-settings"]');
  const washOk = Math.abs(wash.a - 0.4) < 1e-9 && wash.saved === 60 && wash.out === '60';
  console.log(`${washOk ? 'PASS' : 'FAIL'} background transparency slider (60% -> wash ${wash.a})`);
  if (!washOk) failed = true;

  // 내 퍽 투명도 슬라이더 (10 단위, 0~100, 0 = 또렷이) -> 아케이드·평면 렌더러에 반영되고 저장됨
  await page.click('#btn-settings');
  const sliderAttr = await page.evaluate(() => { const el = document.querySelector('#set-puckTransparency'); return { min: el.min, max: el.max, step: el.step, value: el.value }; });
  await page.evaluate(() => { const el = document.querySelector('#set-puckTransparency'); el.value = '70'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const po = await page.evaluate(() => ({ a: window.__puckTrainer.game.arcade.puckAlpha, saved: JSON.parse(localStorage.getItem('puck-trainer.settings.v1')).puckTransparency, out: document.querySelector('#out-puckTransparency').value }));
  await page.evaluate(() => { const el = document.querySelector('#set-puckTransparency'); el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('[data-close="panel-settings"]');
  const poOk = sliderAttr.min === '0' && sliderAttr.max === '100' && sliderAttr.step === '10' && sliderAttr.value === '0' && Math.abs(po.a - 0.3) < 1e-9 && po.saved === 70 && po.out === '70';
  console.log(`${poOk ? 'PASS' : 'FAIL'} puck transparency slider 0..100 step 10 (70% -> alpha ${po.a})`);
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
  await page.evaluate(() => { const g = window.__puckTrainer.game; g.setMode('wide'); g.onEnd({ mode: g.mode, score: 17, reason: 'time', elapsed: 180, limit: 180, seconds: 60, rankKey: 'wide@60', items: [['점수', 17]] }); });
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
  // 게스트 결과: 정회원이었다면 몇 위 + 인스타 플레이 인증 안내 + 공식 계정 DM 버튼 (운영자가 저장한 안내)
  await page.evaluate(() => localStorage.setItem('puck-trainer.site.v1', JSON.stringify({ hashtag: '퍽챌린지', snsAccount: 'puck.official' })));
  await page.evaluate(() => { const g = window.__puckTrainer.game; g.setMode('wide'); g.onEnd({ mode: g.mode, score: 9, reason: 'time', elapsed: 180, limit: 180, seconds: 60, rankKey: 'wide@60', items: [['점수', 9]] }); });
  await page.waitForSelector('#result-guest:not(.hidden)');
  const guest = await page.evaluate(() => ({ text: document.querySelector('#result-guest').textContent, dm: document.querySelector('#guest-dm')?.getAttribute('href') || '', rank: !document.querySelector('#result-rank').classList.contains('hidden') }));
  const guestOk = guest.text.includes('정회원이었다면 지금 전체 2위 / 2명') && guest.text.includes('#퍽챌린지 @puck.official') && guest.text.includes('보호자와 함께') && guest.text.includes('DM') && guest.dm === 'https://ig.me/m/puck.official' && !guest.rank;
  console.log(`${guestOk ? 'PASS' : 'FAIL'} guest result: would-be rank + share play on Instagram, DM the official account for a code (${guest.dm} ${guest.text.slice(0, 60)}…)`);
  if (!guestOk) failed = true;
  await page.click('[data-close="panel-result"]');
  // 운영자 화면 (관리자 별명): 1회용 코드 만들기 -> 목록, 끄기
  await page.evaluate(async () => { const a = window.__puckTrainer.account; await a.register({ nick: 'test123', pin: '123456', country: 'KR', team: 'Ops', age: 30, code: 'BETA2026' , stick: 'L' }); });
  await page.click('#btn-settings');
  const adminBtn = await page.isVisible('#btn-settings-admin');
  await page.click('#btn-settings-admin');
  await page.waitForSelector('#panel-admin:not(.hidden)');
  await page.fill('#adm-one-note', '인스타 @abc');
  await page.click('#adm-one');
  await page.waitForSelector('#adm-one-out:not(.hidden)');
  const issued = await page.evaluate(() => ({ code: document.querySelector('#adm-one-out b').textContent, link: document.querySelector('#adm-one-out input').value, rows: document.querySelectorAll('#adm-codes tr').length, members: document.querySelector('#adm-members').textContent }));
  await page.click(`#adm-codes tr[data-code="${issued.code.replace('-', '')}"] button[data-act="off"]`);
  await page.waitForFunction((c) => document.querySelector(`#adm-codes tr[data-code="${c}"]`)?.textContent.includes('꺼짐'), issued.code.replace('-', ''));
  const adminOk = adminBtn && /^[2-9A-Z]{4}-[2-9A-Z]{4}$/.test(issued.code) && issued.link.endsWith(`/index.html?c=${issued.code}`) && issued.rows === 3 && issued.members.includes('정회원 2명');
  console.log(`${adminOk ? 'PASS' : 'FAIL'} operator panel: issue a one-time code link, list codes, turn one off (${JSON.stringify(issued)})`);
  if (!adminOk) failed = true;
  // 베타 종료일 -> 베타 멤버에게 '의견 보내고 정회원 유지' 칩 -> [개발자에게] 보내면 '정회원 유지', 운영자 화면에 의견이 보임
  const endDay = await page.evaluate(() => { const d = new Date(Date.now() + 7 * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  await page.fill('#adm-beta-end', endDay);
  await page.click('#adm-save-beta-end');
  await page.waitForFunction(() => document.querySelector('#adm-beta-sum').textContent.includes('기다리는 중 2명'));
  const betaRows = await page.evaluate(() => document.querySelectorAll('#adm-betas tr[data-uid]').length);
  await page.click('[data-close="panel-admin"]');
  const chip1 = await page.evaluate(() => document.querySelector('#auth-who [data-feedback]')?.textContent || '');
  await page.evaluate(() => document.querySelector('#auth-who [data-feedback]').click());
  await page.waitForSelector('#fb-form:not(.hidden)');
  const intro = await page.textContent('#fb-intro');
  await page.fill('#fb-good', '8자 방향을 고를 수 있어서 좋아요');
  await page.fill('#fb-fix', '어두우면 퍽을 놓쳐요');
  await page.click('#fb-submit');
  await page.waitForSelector('#fb-form.hidden', { state: 'attached' });
  const toastFb = await page.textContent('#toast');
  const chip2 = await page.evaluate(() => document.querySelector('#auth-who .beta-chip')?.textContent || '');
  await page.click('[data-close="panel-community"]');
  await page.click('#btn-settings'); await page.click('#btn-settings-admin');
  await page.waitForFunction(() => document.querySelector('#adm-feedback').textContent.includes('어두우면 퍽을 놓쳐요'));
  const sum2 = await page.textContent('#adm-beta-sum');
  await page.click('[data-close="panel-admin"]');
  const fbOk = betaRows === 2 && chip1.includes('의견 보내고 정회원 유지') && intro.includes('끝나기 전에 보내 주시면') && toastFb.includes('정회원 등급이 유지됩니다')
    && chip2 === '정회원 유지' && sum2.includes('유지 1명') && sum2.includes('기다리는 중 1명');
  console.log(`${fbOk ? 'PASS' : 'FAIL'} beta end date -> beta member sends [To the developer] feedback -> membership kept, operator reads it (${JSON.stringify({ betaRows, chip1, chip2, toastFb, sum2 })})`);
  if (!fbOk) failed = true;
  const relogin = await page.evaluate(async () => { const a = window.__puckTrainer.account; a.logout(); try { await a.login('번개손', '123456'); return !!a.current(); } catch { return false; } });
  console.log(`${loggedOut && relogin ? 'PASS' : 'FAIL'} logout and login again`);
  if (!(loggedOut && relogin)) failed = true;
  // 베타 종료일이 지났는데 의견을 안 보낸 베타 멤버(번개손): 결과가 랭킹에 안 올라가고 안내 + 프로필 줄에 '베타 종료'
  await page.evaluate(() => { const k = 'puck-trainer.site.v1'; localStorage.setItem(k, JSON.stringify({ ...JSON.parse(localStorage.getItem(k)), betaEndsAt: Date.now() - 1000 })); });
  await page.evaluate(() => { const g = window.__puckTrainer.game; g.setMode('wide'); g.onEnd({ mode: g.mode, score: 99, reason: 'time', elapsed: 180, limit: 180, seconds: 60, rankKey: 'wide@60', items: [['점수', 99]] }); });
  await page.waitForSelector('#result-guest:not(.hidden)');
  const lapsed = await page.evaluate(() => ({ text: document.querySelector('#result-guest').textContent, rank: !document.querySelector('#result-rank').classList.contains('hidden'),
    best: JSON.parse(localStorage.getItem('puck-trainer.scores-ranked.v1')).filter((x) => x.mode === 'wide@60' && x.nick === '번개손').map((x) => x.score) }));
  await page.click('[data-close="panel-result"]');
  await page.click('#btn-settings'); await page.click('[data-close="panel-settings"]');
  const chip3 = await page.evaluate(() => document.querySelector('#auth-who .beta-chip')?.textContent || '');
  const lapsedOk = lapsed.text.includes('베타 기간이 끝나 정회원 등급이 유지되지 않았습니다') && lapsed.text.includes('인스타 DM') && !lapsed.rank && !lapsed.best.includes(99) && chip3.includes('베타 종료');
  console.log(`${lapsedOk ? 'PASS' : 'FAIL'} beta ended without feedback: score not ranked, notice + Instagram DM, profile says beta ended (${JSON.stringify({ ...lapsed, text: lapsed.text.slice(0, 40), chip3 })})`);
  if (!lapsedOk) failed = true;
  await page.evaluate(() => { const k = 'puck-trainer.site.v1'; const c = JSON.parse(localStorage.getItem(k)); delete c.betaEndsAt; localStorage.setItem(k, JSON.stringify(c)); });
  // 8자 드리블 방향: 게임 화면에서 고르면(오른쪽 먼저 · 반시계 = 오른쪽 콘을 아래로) 저장되고, 고른 방향의 코스가 미리 보인다
  await page.click('#btn-mode');
  await page.click('#mode-list > :nth-child(4)'); // 8자 드리블
  await page.waitForSelector('#f8-dir:not(.hidden)');
  await page.click('#f8-side [data-side="R"]'); await page.click('#f8-rot [data-rot="ccw"]');
  const f8 = await page.evaluate(() => { const g = window.__puckTrainer.game; return { saved: JSON.parse(localStorage.getItem('puck-trainer.settings.v1')).figure8Dir, mode: g.mode.id, first: g.waypoints[1], dir: g.figure8Dir, A: g.plane.A }; });
  // 게이트는 평면 경기장 좌표 (세로 = 경기장 비율 A배): 오른쪽 콘(0.7)의 아래쪽(경기장 높이의 78%)
  const f8Ok = f8.saved === 'R-down' && f8.dir === 'R-down' && f8.mode === 'figure8' && f8.first?.x === 0.7 && Math.abs(f8.first?.y / f8.A - 0.78) < 1e-9;
  console.log(`${f8Ok ? 'PASS' : 'FAIL'} figure 8 direction picked on the game screen (right first, counterclockwise) and previewed (${JSON.stringify(f8)})`);
  if (!f8Ok) failed = true;

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
  const reportOk = resultText.includes('터치') && resultText.includes('Coin') && resultText.includes('충돌') && !resultText.includes('Quick hands');
  console.log(`${reportOk ? 'PASS' : 'FAIL'} arcade result report (touches, coins, hits; no bonus rows)`);
  if (!reportOk) failed = true;
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
  // 두 카드 사이 테두리(맨 윗줄 1번과 2번 사이)에 머물면 아무 카드도 골라지지 않음
  await forceUV(0.333, 0.9);
  await page.waitForTimeout(2500);
  const edge = await page.evaluate(() => ({ open: !document.querySelector('#panel-mode').classList.contains('hidden'), hover: document.querySelectorAll('#mode-list .mode-card.hover').length }));
  const edgeOk = edge.open && edge.hover === 0;
  console.log(`${edgeOk ? 'PASS' : 'FAIL'} mode panel: puck on the border between two cards picks nothing (${JSON.stringify(edge)})`);
  if (!edgeOk) failed = true;
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
  await page.waitForFunction(() => window.__puckTrainer?.account);
  await page.tap('#auth-guest');
  await page.tap('#btn-camera');
  await page.waitForFunction(() => document.querySelector('#splash').classList.contains('hidden'), null, { timeout: 10000 });
  await skipSetup(page, true);
  await page.waitForTimeout(500);
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
  const first = await page.evaluate(() => ({ lang: document.documentElement.lang, lead: document.querySelector('.lead').textContent, cam: document.querySelector('#btn-camera').textContent, ph: document.querySelector('#auth-code').placeholder, on: document.querySelector('.lang-row [data-lang].active')?.dataset.lang, visible: !!document.querySelector('.lang-row [data-lang="ko"]').offsetParent }));
  ok(first.lang === 'en' && /stickhandling/.test(first.lead) && first.cam === 'Start camera' && first.ph === 'e.g. K7MP-Q2XD' && first.on === 'en' && first.visible, 'English browser opens in English with language buttons on the first screen', JSON.stringify(first));
  await page.click('.lang-row [data-lang="ko"]'); await tick();
  const ko = await page.evaluate(() => ({ lang: document.documentElement.lang, lead: document.querySelector('.lead').textContent, cam: document.querySelector('#btn-camera').textContent, tab: document.querySelector('.auth-tabs .tab[data-tab="register"]').textContent }));
  ok(ko.lang === 'ko' && /스틱 ?핸들링/.test(ko.lead) && ko.cam === '카메라 시작' && ko.tab === '회원가입', '한국어 button restores the Korean screen', JSON.stringify(ko));
  await page.click('.lang-row [data-lang="en"]'); await tick();
  await page.reload(); await tick();
  ok(await page.evaluate(() => document.documentElement.lang === 'en' && document.querySelector('#btn-camera').textContent === 'Start camera'), 'language choice is remembered after reload');
  await page.waitForFunction(() => window.__puckTrainer?.account);
  await page.evaluate(() => { const a = window.__puckTrainer.account; a._putCode('ACE12345', { type: 'one' }); a._putCode('TEAMBETA', { type: 'beta', maxUses: 0 }); });
  await page.click('.auth-tabs .tab[data-tab="register"]');
  await page.fill('#auth-nick', 'Ace'); await page.fill('#auth-pin', '123456'); await page.fill('#auth-code', 'ace1-2345');
  await page.selectOption('#auth-country', 'US'); await page.fill('#auth-team', 'Blades'); await page.fill('#auth-age', '25');
  await page.click('#auth-stick [data-stick="R"]');
  await page.evaluate(() => document.querySelector('#auth-form').requestSubmit());
  await page.waitForSelector('#auth-logged:not(.hidden)'); await tick();
  const who = await page.textContent('#auth-who');
  ok(/Ace/.test(who) && /USA/.test(who) && /Adult \(age 25\)/.test(who) && /Member No\.0001/.test(who) && /Right/.test(who), 'profile line is shown in English (incl. stick)', who.trim());
  ok((await leftover()).length === 0, 'no Korean left on the English first screen', JSON.stringify(await leftover()));
  await page.click('#btn-camera');
  await page.waitForFunction(() => window.__puckTrainer.app.started && window.__puckTrainer.app.lastVision, null, { timeout: 15000 });
  // 시작 준비(플레이 공간 -> 퍽 등록) 화면도 영어
  await page.waitForSelector('#area-step:not(.hidden)', { timeout: 8000 }); await tick(150);
  const setupLeft = await leftover();
  await page.click('#area-done'); await page.waitForSelector('#setup-bar:not(.hidden)'); await tick(150);
  setupLeft.push(...(await leftover()));
  await page.keyboard.press('Escape'); await page.waitForSelector('#panel-mode:not(.hidden)');
  await page.click('[data-close="panel-mode"]');
  ok(setupLeft.length === 0, 'start setup screens are in English', JSON.stringify(setupLeft));
  await page.evaluate(() => { window.__puckTrainer.settings.autoStart = false; });
  await tick(300);
  // 모든 패널을 열어 남은 한국어가 없는지 확인
  const left = [];
  for (const [btn, panel] of [['#btn-mode', 'panel-mode'], ['#btn-settings', 'panel-settings'], ['#btn-calib', 'panel-calib'], ['#btn-rank', 'panel-rank'], ['#btn-me', 'panel-me']]) {
    await page.click(btn); await page.waitForSelector(`#${panel}:not(.hidden)`); await tick(panel === 'panel-me' ? 600 : 150); // 내 정보는 기록·순위를 불러온 뒤
    left.push(...(await leftover()));
    await page.click(`[data-close="${panel}"]`);
  }
  const hud = await page.evaluate(() => ({ mode: document.querySelector('#hud-mode').textContent, start: document.querySelector('#btn-start').textContent, ctl: [...document.querySelectorAll('#controls .btn')].map((b) => b.textContent).join('|') }));
  ok(left.length === 0 && /^Arcade/.test(hud.mode) && hud.start === 'Start' && hud.ctl === 'Mode|Area|Calibrate|Settings|Ranking|My info|Start', 'stage, HUD and every panel are in English', JSON.stringify({ left, hud }));

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
  const board1 = await page.evaluate(() => ({ resultHidden: document.querySelector('#panel-result').classList.contains('hidden'), selected: document.querySelector('#comm-list .post.selected')?.dataset.id, count: document.querySelector('#comm-detail .detail-count')?.textContent.replace(/\s+/g, ' ').trim(), rows: [...document.querySelectorAll('#comm-detail .detail-board li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()) }));
  ok(board1.resultHidden && board1.selected === 'starter-wide' && /^1\s*challenged$/.test(board1.count) && board1.rows.length === 1 && /^1\s*Ace\s*avg \d\.\ds\s*best \d\.\ds$/.test(board1.rows[0]), 'record board opens on the right with the holder', JSON.stringify(board1));
  // 글을 다시 누르면 선택 해제, 또 누르면 다시 상위 5위
  await page.click('#comm-list .post[data-id="starter-wide"] h3'); await tick(100);
  const unsel = await page.evaluate(() => ({ sel: document.querySelectorAll('#comm-list .post.selected').length, empty: document.querySelector('#comm-detail .detail-empty')?.textContent }));
  await page.click('#comm-list .post[data-id="starter-wide"] h3'); await tick(100);
  const resel = await page.evaluate(() => document.querySelectorAll('#comm-detail .detail-board li').length);
  ok(unsel.sel === 0 && /Tap a post to see/.test(unsel.empty || '') && resel === 1, 'tapping a post toggles its top 5 panel', JSON.stringify({ unsel, resel }));
  // 다른 선수가 같은 코스로 기록을 갈아치움
  await page.evaluate(async () => { const a = window.__puckTrainer.account; a.logout(); await a.register({ nick: 'Bee', pin: '654321', country: 'CA', team: 'Hive', age: 12, code: 'TEAMBETA' , stick: 'L' }); });
  await page.click('#comm-list .post[data-id="starter-wide"] [data-act="practice"]'); await tick(200);
  const holder = await page.evaluate(() => window.__puckTrainer.app.challenge.holder);
  const run2 = await finish(Array(9).fill(1));
  ok(holder.nick === 'Ace' && /New record!/.test(run2.msg) && /Record beaten: Ace avg \d\.\ds → \d\.\ds/.test(run2.msg) && run2.btn === 'Share new record', 'a faster player beats the record and can share it', JSON.stringify(run2));
  await page.click('#btn-share');
  await page.waitForSelector('#comm-form:not(.hidden)');
  const draft = await page.evaluate(() => ({ title: document.querySelector('#comm-title').value, typeHidden: document.querySelector('#comm-type').classList.contains('hidden'), pv: document.querySelector('#comm-preview').textContent.replace(/\s+/g, ' ').trim(), off: document.querySelector('#comm-submit').disabled }));
  await page.fill('#comm-body', 'Who is next?');
  await page.click('#comm-submit'); await tick(250);
  const beat = await page.evaluate(() => { const p = document.querySelector('#comm-list .post'); return { cls: p.className, tag: p.querySelector('.post-tag').textContent, head: p.querySelector('.post-head').textContent.replace(/\s+/g, ' '), beat: p.querySelector('.beat-line').textContent.replace(/\s+/g, ' ').trim(), formHidden: document.querySelector('#comm-form').classList.contains('hidden'), n: document.querySelectorAll('#comm-list .post').length, board: [...document.querySelectorAll('#comm-detail .detail-board li b')].map((b) => b.textContent).join('>') }; });
  ok(draft.title === 'Side-to-side wide: new record!' && draft.typeHidden && !draft.off && /Record beaten:\s*Ace/.test(draft.pv) && /post-beat/.test(beat.cls) && beat.tag === 'New record' && /Bee/.test(beat.head) && /Record beaten:\s*Ace\s*avg \d\.\ds → \d\.\ds/.test(beat.beat) && beat.formHidden && beat.n === 4 && beat.board === 'Bee>Ace',
    'record-beating post is published and the board order changes', JSON.stringify({ draft, beat }));
  // 내 코스 공유 (현재 코스 + 내 기록)
  await page.click('#comm-write'); await page.waitForSelector('#comm-form:not(.hidden)');
  const pv = await page.evaluate(() => ({ active: document.querySelector('#comm-type .active')?.dataset.type, pv: document.querySelector('#comm-preview').textContent.replace(/\s+/g, ' ').trim() }));
  await page.fill('#comm-title', 'My wide course'); await page.click('#comm-submit'); await tick(150);
  const needBody = await page.evaluate(() => ({ err: document.querySelector('#comm-error').textContent, hidden: document.querySelector('#comm-error').classList.contains('hidden') }));
  await page.fill('#comm-body', 'Builds reach on the backhand side.'); await page.click('#comm-submit'); await tick(250);
  const mine = await page.evaluate(() => { const p = document.querySelector('#comm-list .post'); return { title: p.querySelector('h3').textContent, body: p.querySelector('.post-body').textContent, row: document.querySelector('#comm-detail .detail-board li')?.textContent.replace(/\s+/g, ' ').trim(), del: !!p.querySelector('[data-act="delete"]'), stored: JSON.parse(localStorage.getItem('puck-trainer.community.v1')).length }; });
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
  // 기록 자랑: 아케이드를 끝까지 -> 결과 화면에서 공유 -> '나도 연습하기'
  const playArcade = async (score) => {
    await page.click('#btn-start'); await tick(300);
    await page.evaluate((s) => { const g = window.__puckTrainer.game; g.score = s; if (g.arcade) g.arcade.score = s; g.stop('time'); }, score);
    await page.waitForSelector('#result-share:not(.hidden)');
    await tick(200); // 도전 기록 등록(비동기) 결과까지
    return page.evaluate(() => ({ msg: document.querySelector('#result-share .share-msg').textContent.replace(/\s+/g, ' ').trim(), btn: document.querySelector('#btn-share')?.textContent, btn2: document.querySelector('#btn-share-2')?.textContent }));
  };
  const bragPosts = () => page.evaluate(() => JSON.parse(localStorage.getItem('puck-trainer.community.v1')).filter((p) => p.type === 'record').map((p) => ({ id: p.id, uid: p.uid, score: p.score, age: p.age, cheers: (p.cheers || []).length, records: (p.records || []).map((r) => `${r.nick}:${r.score}`) })));
  await page.click('#btn-mode'); await page.waitForSelector('#panel-mode:not(.hidden)');
  await page.click('#mode-list .mode-card:nth-child(1)'); await tick(100);
  const shareBtn = (await playArcade(1230)).btn;
  await page.click('#btn-share'); await page.waitForSelector('#comm-form:not(.hidden)'); await tick(150);
  const recPv = await page.evaluate(() => ({ active: document.querySelector('#comm-type .active')?.dataset.type, pv: document.querySelector('#comm-preview').textContent.replace(/\s+/g, ' ').trim(), replace: !!document.querySelector('#comm-preview .replace-note'), submit: document.querySelector('#comm-submit').textContent }));
  await page.fill('#comm-title', 'Finally!'); await page.click('#comm-submit'); await tick(250);
  const rec = await page.evaluate(() => { const p = document.querySelector('#comm-list .post'); return { cls: p.className, score: p.querySelector('.post-score b').textContent, sub: p.querySelector('.post-score span').textContent, act: p.querySelector('.post-foot [data-act="mode"]').textContent, sum: p.querySelector('.post-sum').textContent.replace(/\s+/g, ' ').trim(), detail: document.querySelector('#comm-detail .detail-rule')?.textContent.replace(/\s+/g, ' ').trim() }; });
  ok(shareBtn === 'Share record' && recPv.active === 'record' && /Arcade · 1 min/.test(recPv.pv) && !recPv.replace && recPv.submit === 'Post' && /post-record/.test(rec.cls) && rec.score === '1230' && rec.sub === 'Arcade · 1 min' && rec.act === 'Try it too'
    && /^0 challenged\s*#1\s*Bee\s*1230 pts\s*Age 12 & under\s*Top 5 ›$/.test(rec.sum) && /^Only age 12 and under get on the board/.test(rec.detail || ''),
  'record brag from the result screen shows challengers, leader and age limit', JSON.stringify({ shareBtn, recPv, rec }));
  // 종류 거르기
  await page.click('#comm-filter [data-filter="course"]'); await tick(200);
  const onlyCourses = await page.evaluate(() => [...document.querySelectorAll('#comm-list .post')].every((p) => p.classList.contains('post-course')) && document.querySelectorAll('#comm-list .post').length === 3);
  await page.click('#comm-filter [data-filter="record"]'); await tick(200);
  const onlyRecords = await page.evaluate(() => document.querySelectorAll('#comm-list .post').length === 2 && !document.querySelector('#comm-list .post.post-course'));
  await page.click('#comm-filter [data-filter="all"]'); await tick(200);
  // 모드 거르기: 아케이드만 / 자유 연습(코스) / 다시 모든 모드
  const modeOpts = await page.evaluate(() => [...document.querySelectorAll('#comm-mode option')].map((o) => o.textContent));
  await page.selectOption('#comm-mode', 'arcade'); await tick(200);
  const arcadeOnly = await page.evaluate(() => [...document.querySelectorAll('#comm-list .post h3')].map((h) => h.textContent));
  await page.selectOption('#comm-mode', 'obstacle'); await tick(200);
  const dodgeEmpty = await page.evaluate(() => document.querySelectorAll('#comm-list .post').length === 0 && !!document.querySelector('#comm-list .comm-empty'));
  await page.selectOption('#comm-mode', 'free'); await tick(200);
  const freeN = await page.evaluate(() => [...document.querySelectorAll('#comm-list .post')].filter((p) => !p.classList.contains('post-record')).length + document.querySelectorAll('#comm-list .post-record').length * 100);
  await page.selectOption('#comm-mode', ''); await tick(200);
  ok(onlyCourses && onlyRecords && modeOpts[0] === 'All modes' && modeOpts.includes('Arcade') && arcadeOnly.join() === 'Finally!' && dodgeEmpty && freeN === 4,
    'community filters by kind and by game mode', JSON.stringify({ onlyCourses, onlyRecords, modeOpts, arcadeOnly, dodgeEmpty, freeN }));
  // 응원 많은 순
  await page.click('#comm-list .post[data-id="starter-wide"] [data-act="cheer"]'); await tick(200);
  await page.click('#comm-sort [data-sort="cheers"]'); await tick(200);
  const byCheers = await page.evaluate(() => ({ first: document.querySelector('#comm-list .post')?.dataset.id, active: document.querySelector('#comm-sort .active')?.dataset.sort }));
  await page.click('#comm-sort [data-sort="recent"]'); await tick(200);
  const byRecent = await page.evaluate(() => document.querySelector('#comm-list .post h3')?.textContent);
  ok(byCheers.first === 'starter-wide' && byCheers.active === 'cheers' && byRecent === 'Finally!', 'community sorts by most cheers and back to newest', JSON.stringify({ byCheers, byRecent }));
  // 내 자랑 글로 '나도 연습하기' -> 같은 모드로 바뀌고, 내 글이라 도전 기록에는 오르지 않음
  await page.evaluate(() => { window.__puckTrainer.game.setMode('wide'); });
  const bragId = (await bragPosts())[0].id;
  await page.click(`#comm-list .post[data-id="${bragId}"] .post-foot [data-act="mode"]`); await tick(150);
  const took = await page.evaluate(() => ({ mode: window.__puckTrainer.game.mode.id, closed: document.querySelector('#panel-community').classList.contains('hidden'), toast: document.querySelector('#toast').textContent, hud: document.querySelector('#hud-instruction').textContent }));
  ok(took.mode === 'arcade' && took.closed && /^Arcade · 1 min — beat 1230 points! · your own post/.test(took.toast) && /Challenge · Bee · 1230 pts/.test(took.hud), '"Try it too" switches to the same mode and time', JSON.stringify(took));
  // 기록 자랑은 모드마다 하나: 더 높은 점수로 다시 자랑하면 그 글이 바뀐다 (응원은 그대로)
  const own = await playArcade(1500);
  await page.click('#btn-share'); await page.waitForSelector('#comm-form:not(.hidden)'); await tick(300);
  const replPv = await page.evaluate(() => ({ note: document.querySelector('#comm-preview .replace-note')?.textContent.replace(/\s+/g, ' ').trim(), submit: document.querySelector('#comm-submit').textContent }));
  await page.fill('#comm-title', 'Even better'); await page.click('#comm-submit'); await tick(300);
  const replaced = { toast: await page.textContent('#toast'), posts: await bragPosts(), first: await page.evaluate(() => document.querySelector('#comm-list .post h3').textContent) };
  ok(/your own brag/.test(own.msg) && own.btn === 'Share record' && /^You already have a brag for this mode Finally! 1230 pts/.test(replPv.note || '') && replPv.submit === 'Replace my brag'
    && /Brag updated with the new record/.test(replaced.toast) && replaced.posts.length === 1 && replaced.posts[0].id === bragId && replaced.posts[0].score === 1500 && replaced.posts[0].cheers === 0 && replaced.first === 'Even better',
  'only one brag per mode: posting again replaces it', JSON.stringify({ own, replPv, replaced }));
  // 나이 규칙: 글쓴이(12세)보다 많은 선수는 플레이만, 같거나 어린 선수만 도전 기록에 오른다
  await page.evaluate(async () => { const a = window.__puckTrainer.account; a.logout(); await a.register({ nick: 'Old', pin: '111111', country: 'US', team: 'Elders', age: 30, code: 'TEAMBETA' , stick: 'L' }); });
  await page.click(`#comm-list .post[data-id="${bragId}"] .post-foot [data-act="mode"]`); await tick(150);
  const oldToast = await page.textContent('#toast');
  const oldRun = await playArcade(2000);
  await page.evaluate(async () => { const a = window.__puckTrainer.account; a.logout(); await a.register({ nick: 'Kid', pin: '222222', country: 'KR', team: 'Cubs', age: 10, code: 'TEAMBETA' , stick: 'L' }); });
  await page.click('#btn-share-2'); await page.waitForSelector('#panel-community:not(.hidden)'); await tick(200);
  await page.click(`#comm-list .post[data-id="${bragId}"] .post-foot [data-act="mode"]`); await tick(150);
  const kidRun = await playArcade(900);
  await page.click('#btn-share-2'); await page.waitForSelector('#panel-community:not(.hidden)'); await tick(250);
  const board = await page.evaluate((id) => ({
    selected: document.querySelector('#comm-list .post.selected')?.dataset.id,
    count: document.querySelector('#comm-detail .detail-count')?.textContent.replace(/\s+/g, ' ').trim(),
    rows: [...document.querySelectorAll('#comm-detail .detail-board li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()),
    me: document.querySelector('#comm-detail .detail-board li.me b')?.textContent,
    sum: document.querySelector(`#comm-list .post[data-id="${id}"] .post-sum .cnt`)?.textContent,
  }), bragId);
  const stored = (await bragPosts())[0];
  ok(/records only for age 12 and under/.test(oldToast) && /only players aged 12 and under get on this board \(you: 30\)/.test(oldRun.msg) && oldRun.btn2 === 'View challenge board'
    && /Challenge board #2 of 2/.test(kidRun.msg) && board.selected === bragId && /^1\s*challenged$/.test(board.count) && board.rows.length === 2
    && /^1\s*Bee\s*Author\s*1500 pts$/.test(board.rows[0]) && /^2\s*Kid\s*900 pts$/.test(board.rows[1]) && board.me === 'Kid' && board.sum === '1 challenged' && stored.records.join() === 'Kid:900',
  'age rule: older players only practice, younger players get on the top 5', JSON.stringify({ oldToast, oldRun, kidRun, board, stored }));
  await page.click('[data-close="panel-community"]');
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
