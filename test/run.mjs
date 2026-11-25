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
  const file = join(ROOT, path.endsWith('/') ? path + 'index.html' : path); // /en/, /guide/ 처럼 폴더 주소는 그 안의 index.html
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
/** 카메라 시작 직후의 준비 과정(1/3 영역 -> 2/3 퍽 등록 -> 3/3 움직여 보기 -> 모드 창)을 건너뛰어 대기 화면으로 */
const skipSetup = async (page, touch = false) => {
  await page.waitForSelector('#area-step:not(.hidden)', { timeout: 8000 });
  if (touch) await page.tap('#area-done'); else await page.click('#area-done');
  await page.waitForSelector('#setup-bar:not(.hidden)');
  await page.keyboard.press('Escape');
  // 등록된 퍽이 있으면 3/3 움직여 보기가 이어진다 -> Esc 로 건너뛰기
  if (await page.evaluate(() => window.__puckTrainer?.app.setup === 'test')) await page.keyboard.press('Escape');
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
  const fillReg = async (pw = 'puck2026', pw2 = pw) => {
    await page.fill('#auth-id', 'Bungae11'); await page.fill('#auth-pin', pw); await page.fill('#auth-pin2', pw2); await page.fill('#auth-nick', '번개손');
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
  const invOk = !inv.bad && inv.title === '오픈베타 초대 링크예요' && /까지 가입하면 바로 정회원$/.test(inv.sub) && inv.code === 'BETA-2026' && inv.codeShown && inv.reg && inv.search === '';
  console.log(`${invOk ? 'PASS' : 'FAIL'} open beta invite link opens sign-up with the code filled in (${JSON.stringify(inv)})`);
  if (!invOk) failed = true;
  // 회원가입 (아이디 + 비밀번호 + 확인 + 별명 + 국가/팀/나이 + 가입 코드). 숫자만 쓴 비밀번호, 확인이 다른 비밀번호는 막힘
  const regErr = async () => { await page.evaluate(() => document.querySelector('#auth-form').requestSubmit()); await page.waitForTimeout(150); return { err: (await page.textContent('#auth-error')).trim(), out: await page.isHidden('#auth-logged') }; };
  await fillReg('12345678');
  const weak = await regErr();
  await fillReg('puck2026', 'puck2027');
  const differ = await regErr();
  await fillReg('bungae11x9');
  const hasId = await regErr();
  const shownLogin = await page.evaluate(() => ({ nick: !!document.querySelector('#auth-nick').offsetParent, pin2: !!document.querySelector('#auth-pin2').offsetParent }));
  const pinErr = weak.out && weak.err === '비밀번호에 영문과 숫자를 함께 넣으세요' && differ.out && differ.err === '비밀번호가 서로 다릅니다'
    && hasId.out && hasId.err === '비밀번호에 아이디나 별명을 넣지 마세요' && shownLogin.nick && shownLogin.pin2;
  console.log(`${pinErr ? 'PASS' : 'FAIL'} sign-up refuses a digits-only password, a mismatched confirmation and a password containing the ID (${JSON.stringify({ weak, differ, hasId, shownLogin })})`);
  if (!pinErr) failed = true;
  await fillReg();
  await page.evaluate(() => document.querySelector('#auth-form').requestSubmit());
  await page.waitForSelector('#auth-logged:not(.hidden)');
  const who = await page.textContent('#auth-who');
  const afterJoin = await page.evaluate(() => ({ card: document.querySelector('#invite-card').classList.contains('hidden'), kept: localStorage.getItem('puck-trainer.invite.v1') }));
  const joinOk = pinErr && who.includes('번개손') && who.includes('U12') && who.includes('#87') && who.includes('베타 멤버 No.0001') && afterJoin.card && afterJoin.kept === null;
  console.log(`${joinOk ? 'PASS' : 'FAIL'} register with ID + password + nickname + jersey number + beta code -> beta member No.0001 (${who.trim()})`);
  if (!joinOk) failed = true;
  await page.click('#btn-camera');
  await page.waitForFunction(() => document.querySelector('#splash').classList.contains('hidden'), null, { timeout: 10000 });
  // 시작 준비: 1/3 영역(완료) -> 2/3 퍽 등록(등록된 퍽이 없으면 Esc로 건너뛰면 바로 모드 창) -> 모드 창이 열림(닫기)
  // 준비 중에는 HUD·아래 버튼·인식 칩을 숨기고, 영역 막대에는 초기화·완료만
  await page.waitForSelector('#area-step:not(.hidden)', { timeout: 5000 });
  const setupUi = await page.evaluate(() => ({ cls: document.querySelector('#app').classList.contains('setting-up'), hud: getComputedStyle(document.querySelector('#hud')).display,
    ctl: getComputedStyle(document.querySelector('#controls')).display, btns: [...document.querySelectorAll('#area-bar button')].filter((b) => b.offsetParent !== null).map((b) => b.id).join(','),
    quad: JSON.stringify(window.__puckTrainer.settings.manualQuad), mode: window.__puckTrainer.settings.floorMode }));
  await page.click('#area-done');
  await page.waitForSelector('#setup-bar:not(.hidden)');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#panel-mode:not(.hidden)');
  const setupOk = await page.evaluate(() => window.__puckTrainer.app.setup === null && document.querySelector('#setup-bar').classList.contains('hidden') && !document.querySelector('#app').classList.contains('setting-up'))
    && setupUi.cls && setupUi.hud === 'none' && setupUi.ctl === 'none' && setupUi.btns === 'area-reset,area-done' && setupUi.mode === 'manual' && setupUi.quad === JSON.stringify([[0.25, 0.3], [0.75, 0.3], [0.85, 0.8], [0.15, 0.8]]);
  console.log(`${setupOk ? 'PASS' : 'FAIL'} start setup: area (drag + reset only, starting frame, HUD hidden) -> puck registration -> mode window (${JSON.stringify(setupUi)})`);
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
  // 화면 칩: 초당 인식 프레임 + 프레임당 인식 시간. 카메라에는 60fps 를 바란다 (가짜 카메라는 되는 만큼)
  const cam = await page.evaluate(() => { const t = document.querySelector('#video').srcObject?.getVideoTracks()[0]; const c = t?.getConstraints().frameRate; return { want: typeof c === 'number' ? c : c?.ideal, got: t?.getSettings().frameRate }; });
  const chipOk = /^\d+ fps · \d+(\.\d)?ms$/.test(fps.trim()) && cam.want === 60 && cam.got > 0;
  console.log(`${chipOk ? 'PASS' : 'FAIL'} fps chip shows processing time, camera asked for 60fps (${fps.trim()}, ${JSON.stringify(cam)})`);
  if (!chipOk) failed = true;
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
  // 게임 영역은 네 모서리로 맞춘 바닥 하나뿐: 가짜 카메라에서도 바로 시작 가능해야 함
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
  // 퍽 피하기처럼 배경이 흰 화면(투명도 0 고정)인 게임이어도, 지정하는 동안은 흰 칠 없이 카메라 영상이 보여야 퍽을 누를 수 있다
  const overlayAlpha = () => page.evaluate(() => { const c = document.querySelector('#overlay'); return c.getContext('2d').getImageData(Math.round(c.width * 0.31), Math.round(c.height * 0.57), 1, 1).data[3]; });
  await page.evaluate(() => { window.__puckTrainer.settings.autoStart = false; }); // 대기 원 없이 게임 화면 그대로
  await page.waitForTimeout(150);
  const whiteBefore = await overlayAlpha();
  await page.click('#btn-calib');
  await page.click('[data-calib="puck"]');
  const hintVisible = await page.isVisible('#tap-hint');
  await page.waitForTimeout(150);
  const whileAlpha = await overlayAlpha();
  await page.mouse.click(600, 400);
  await page.waitForTimeout(200);
  const hintHidden = !(await page.isVisible('#tap-hint'));
  await page.evaluate(() => { window.__puckTrainer.settings.autoStart = true; });
  console.log(`${hintVisible && hintHidden ? 'PASS' : 'FAIL'} calibration tap flow`);
  if (!(hintVisible && hintHidden)) failed = true;
  const pickClear = whiteBefore > 200 && whileAlpha < 40;
  console.log(`${pickClear ? 'PASS' : 'FAIL'} tap-to-pick shows the camera, not the white game screen (overlay alpha ${whiteBefore} -> ${whileAlpha})`);
  if (!pickClear) failed = true;
  // 모드 화면 3×3: 가운데(5번)는 비어 있고 9번은 커뮤니티
  await page.click('#btn-mode');
  const grid = await page.evaluate(() => { const kids = [...document.querySelector('#mode-list').children]; return { n: kids.length, mid: kids[4].className, last: kids[8].className, lastText: kids[8].textContent, cards: document.querySelectorAll('#mode-list .mode-card').length, cols: getComputedStyle(document.querySelector('#mode-list')).gridTemplateColumns.split(' ').length }; });
  const gridOk = grid.n === 9 && grid.mid === 'mode-wait' && /mode-community/.test(grid.last) && /커뮤니티/.test(grid.lastText) && grid.cards === 8 && grid.cols === 3;
  console.log(`${gridOk ? 'PASS' : 'FAIL'} mode grid 3x3 with empty center and community in cell 9 (${JSON.stringify(grid)})`);
  if (!gridOk) failed = true;
  // 모드 창 머리의 '퍽·스틱 등록'·'설정'(닫기 왼쪽): 각각 모드 창 위에 보정 창·설정 창을 열고, 닫으면 모드 창으로
  const modeBtns = await page.evaluate(() => [...document.querySelectorAll('#panel-mode .head-actions .btn')].map((b) => b.textContent.trim()).join(','));
  await page.click('#btn-mode-calib');
  const calibOverMode = await page.evaluate(() => !document.querySelector('#panel-calib').classList.contains('hidden') && !document.querySelector('#panel-mode').classList.contains('hidden'));
  await page.click('[data-close="panel-calib"]');
  const calibBack = await page.evaluate(() => document.querySelector('#panel-calib').classList.contains('hidden') && !document.querySelector('#panel-mode').classList.contains('hidden'));
  await page.click('#btn-mode-settings');
  const overMode = await page.evaluate(() => !document.querySelector('#panel-settings').classList.contains('hidden') && !document.querySelector('#panel-mode').classList.contains('hidden'));
  await page.click('[data-close="panel-settings"]');
  const backMode = await page.evaluate(() => document.querySelector('#panel-settings').classList.contains('hidden') && !document.querySelector('#panel-mode').classList.contains('hidden'));
  const modeSetOk = modeBtns === '퍽·스틱 등록,설정,닫기' && calibOverMode && calibBack && overMode && backMode;
  console.log(`${modeSetOk ? 'PASS' : 'FAIL'} mode window has Register puck/stick and Settings left of Close; each opens over it and closing returns to the modes (${JSON.stringify({ modeBtns, calibOverMode, calibBack, overMode, backMode })})`);
  if (!modeSetOk) failed = true;
  // 자유 연습(8번 칸) 선택 -> 코스 편집: 번호 3, 1을 영역(실제 바닥) 안에 끌어다 놓기 -> 저장, 번호 순서 정렬.
  // 퀵 핸즈처럼 영역 안에서 배경을 보며 하므로 번호는 바닥 위 자리(원근대로)에 놓인다:
  // 영역 안 비율 -> 화면 자리는 앱의 바닥 사상으로 구한다 (평면 경기장을 영역에 그대로 그림)
  await page.click('#mode-list > :nth-child(8)');
  await page.waitForSelector('#course:not(.hidden)');
  const fieldBox = await (await page.$('#course-field')).boundingBox(); // 맨 위 번호 띠(트레이) 자리
  const floorPt = (fx, fy) => page.evaluate(([x, y]) => {
    const T = window.__puckTrainer, m = T.app.lastVision.floor.mapping, r = document.querySelector('#view').getBoundingClientRect();
    const [px, py] = m.toPx(x, y);
    return [r.left + (px / T.vision.PW) * r.width, r.top + (py / T.vision.PH) * r.height];
  }, [fx, fy]);
  const dragTo = async (n, [tx, ty]) => { const b = await (await page.$(`.course-pt[data-n="${n}"]`)).boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(tx, ty, { steps: 6 }); await page.mouse.up(); };
  const dragPt = async (n, fx, fy) => dragTo(n, await floorPt(fx, fy));
  await dragPt(3, 0.75, 0.6); await dragPt(1, 0.25, 0.6);
  await page.waitForTimeout(100);
  const course = await page.evaluate(() => {
    const T = window.__puckTrainer, r = document.querySelector('#course > .course-pt[data-n="3"]')?.getBoundingClientRect();
    return { saved: JSON.parse(localStorage.getItem('puck-trainer.settings.v1')).course, game: T.game.course.points.map((p) => p.n), inField: document.querySelectorAll('#course > .course-pt').length, inTray: document.querySelectorAll('#course-slots > .course-pt').length,
      at3: r ? [r.left + r.width / 2, r.top + r.height / 2] : null };
  });
  const want3 = await floorPt(0.75, 0.6), s3 = course.saved.find((p) => p.n === 3);
  const courseOk = course.saved.length === 2 && course.game.join(',') === '1,3' && course.inField === 2 && course.inTray === 8 && Math.abs(s3.x - 0.75) < 0.03 && Math.abs(s3.y - 0.6) < 0.03
    && !!course.at3 && Math.hypot(course.at3[0] - want3[0], course.at3[1] - want3[1]) < 3;
  console.log(`${courseOk ? 'PASS' : 'FAIL'} course builder: drag numbers onto the floor area ${JSON.stringify({ ...course, want3 })}`);
  if (!courseOk) failed = true;
  // 트레이로 되돌리면 삭제
  await dragTo(3, [fieldBox.x + fieldBox.width * 0.5, fieldBox.y + fieldBox.height * 0.02]);
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

  // 영역 편집: 버튼 -> 사다리꼴 핸들 4개 + 맨 위 한 줄 막대(초기화·완료만), HUD·아래 버튼은 숨김. 완료 -> 저장
  // 화면 끝에 붙은 틀(예전 '화면 전체')도 그대로 두고, 손잡이만 화면 안에 보이게 한다
  await page.evaluate(() => { window.__puckTrainer.settings.manualQuad = [[0, 0], [1, 0], [1, 1], [0, 1]]; });
  await page.click('#btn-floor-lock');
  await page.waitForSelector('#area-bar:not(.hidden)');
  const startQuad = await page.evaluate(() => JSON.stringify(window.__puckTrainer.settings.manualQuad));
  const inView = await page.$$eval('#floor-handles .handle', (hs) => { const v = document.querySelector('#view').getBoundingClientRect(); return hs.every((h) => { const r = h.getBoundingClientRect(); return r.left >= v.left && r.right <= v.right && r.top >= v.top && r.bottom <= v.bottom; }); });
  const areaUi = await page.evaluate(() => ({ btns: [...document.querySelectorAll('#area-bar button')].filter((b) => b.offsetParent !== null).map((b) => b.id).join(','), hud: getComputedStyle(document.querySelector('#hud')).display, ctl: getComputedStyle(document.querySelector('#controls')).display }));
  const edgeKept = startQuad === JSON.stringify([[0, 0], [1, 0], [1, 1], [0, 1]]) && areaUi.btns === 'area-reset,area-done' && areaUi.hud === 'none' && areaUi.ctl === 'none';
  console.log(`${edgeKept && inView ? 'PASS' : 'FAIL'} area edit keeps a frame at the screen edge, handles fully on screen, only reset + done, HUD hidden (${startQuad} ${JSON.stringify(areaUi)})`);
  if (!(edgeKept && inView)) failed = true;
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
  // 다시 열면 맞춰 둔 틀을 그대로 쓰고, '초기화'는 처음 틀(가운데 아래 사다리꼴)로 되돌린다
  await page.click('#btn-floor-lock');
  await page.waitForSelector('#area-bar:not(.hidden)');
  const kept = await page.evaluate(() => window.__puckTrainer.settings.manualQuad[0][0]);
  await page.click('#area-reset');
  const reset = await page.evaluate(() => JSON.stringify(window.__puckTrainer.settings.manualQuad));
  await page.click('#area-done');
  const keptOk = Math.abs(kept - savedQuad.manualQuad[0][0]) < 1e-6 && reset === JSON.stringify([[0.25, 0.3], [0.75, 0.3], [0.85, 0.8], [0.15, 0.8]]);
  console.log(`${keptOk ? 'PASS' : 'FAIL'} area edit keeps the fitted frame; reset returns to the starting frame (${kept.toFixed(3)})`);
  if (!keptOk) failed = true;

  // 배경 투명도 슬라이더: 아케이드는 배경 0 고정(흰 화면) — 슬라이더가 잠기고 이유가 보이며, 설정값이 있어도 배경은 불투명 그대로.
  // 배경을 조절하는 게임(반응 타겟)에서는 불투명도에 바로 반영되고 저장됨
  const setTp = (id, v) => page.evaluate(([id, v]) => { const el = document.querySelector('#set-' + id); el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, [id, v]);
  const bgState = () => page.evaluate(() => { const el = document.querySelector('#set-bgTransparency'), n = document.querySelector('#visual-note'); return { mode: window.__puckTrainer.game.mode.id, disabled: el.disabled, locked: el.closest('label').classList.contains('locked'), note: n.classList.contains('hidden') ? '' : n.textContent }; });
  const modeBeforeBg = await page.evaluate(() => window.__puckTrainer.game.mode.id);
  await page.click('#btn-settings');
  const bgArc = await bgState();
  await page.click('[data-close="panel-settings"]');
  await page.evaluate(() => window.__puckTrainer.game.setMode('reaction'));
  await page.click('#btn-settings');
  const bgRx = await bgState();
  await setTp('bgTransparency', 60);
  const wash = await page.evaluate(() => ({ a: window.__puckTrainer.game.arcade.wash, saved: JSON.parse(localStorage.getItem('puck-trainer.settings.v1')).bgTransparency, out: document.querySelector('#out-bgTransparency').value }));
  await setTp('bgTransparency', 10);
  await page.click('[data-close="panel-settings"]');
  await page.evaluate((m) => window.__puckTrainer.game.setMode(m), modeBeforeBg);
  await page.waitForTimeout(200); // 매 프레임 applyWash: 아케이드로 돌아오면 배경 투명도 10 이 저장돼 있어도 흰 화면
  const washArc = await page.evaluate(() => window.__puckTrainer.game.arcade.wash);
  const washOk = bgArc.mode === 'arcade' && bgArc.disabled && bgArc.locked && bgArc.note !== '' && !bgRx.disabled && !bgRx.locked && bgRx.note === ''
    && Math.abs(wash.a - 0.4) < 1e-9 && wash.saved === 60 && wash.out === '60' && washArc === 1;
  console.log(`${washOk ? 'PASS' : 'FAIL'} background transparency slider (reaction 60% -> wash ${wash.a}; arcade locked at 0 -> wash ${washArc}) ${JSON.stringify({ bgArc, bgRx })}`);
  if (!washOk) failed = true;

  // 내 퍽 투명도 슬라이더 (1 단위, 0~100, 0 = 또렷이) -> 아케이드·평면 렌더러에 반영되고 저장됨
  await page.click('#btn-settings');
  const sliderAttr = await page.evaluate(() => { const el = document.querySelector('#set-puckTransparency'); return { min: el.min, max: el.max, step: el.step, value: el.value }; });
  await page.evaluate(() => { const el = document.querySelector('#set-puckTransparency'); el.value = '73'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const po = await page.evaluate(() => ({ a: window.__puckTrainer.game.arcade.puckAlpha, saved: JSON.parse(localStorage.getItem('puck-trainer.settings.v1')).puckTransparency, out: document.querySelector('#out-puckTransparency').value }));
  await page.evaluate(() => { const el = document.querySelector('#set-puckTransparency'); el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  // 투명도 미리보기: 설정 창이 열려 게임이 멈춘 동안에도 카메라 영상이 흐르고, 배경 투명도 슬라이더대로 바로 바뀐다
  // (아케이드는 배경 0 고정이라, 배경을 조절하는 반응 타겟에서 본다)
  await page.click('[data-close="panel-settings"]');
  await page.evaluate(() => window.__puckTrainer.game.setMode('reaction'));
  await page.click('#btn-settings');
  const tpSample = () => page.evaluate(() => { const c = document.querySelector('#set-preview'); const d = c.getContext('2d').getImageData(Math.round(c.width * 0.08), Math.round(c.height * 0.1), 1, 1).data; return { w: c.width, h: c.height, rgb: [d[0], d[1], d[2]], t: window.__puckTrainer.app.lastVideoTime, paused: window.__puckTrainer.app.paused }; });
  const bgWas = await page.evaluate(() => document.querySelector('#set-bgTransparency').value);
  await setTp('bgTransparency', 0); await page.waitForTimeout(150); const tp0 = await tpSample();
  await setTp('bgTransparency', 100); await page.waitForTimeout(500); const tp100 = await tpSample();
  await setTp('bgTransparency', bgWas);
  const paper = [0xf4, 0xf1, 0xea];
  const tpOk = tp0.w > 100 && tp0.h > 50 && tp0.rgb.every((c, i) => Math.abs(c - paper[i]) <= 3) && tp100.rgb.some((c, i) => Math.abs(c - paper[i]) > 30) && tp100.t > tp0.t && tp100.paused;
  console.log(`${tpOk ? 'PASS' : 'FAIL'} settings preview shows the live camera under the background wash while the game is paused ${JSON.stringify({ tp0, tp100 })}`);
  if (!tpOk) failed = true;
  await page.click('[data-close="panel-settings"]');
  await page.evaluate((m) => window.__puckTrainer.game.setMode(m), modeBeforeBg);
  // 휴대폰: 투명도 슬라이더를 끄는 동안만 설정 창 대신 실제 게임 화면 (끄는 슬라이더 한 줄만 남고, 배경 투명도가 바로 보인다)
  const modeWas = await page.evaluate(() => window.__puckTrainer.game.mode.id);
  await page.evaluate(() => window.__puckTrainer.game.setMode('reaction'));
  await page.evaluate(() => document.querySelectorAll('.panel.modal:not(.hidden) .btn-close').forEach((x) => x.click()));
  await page.click('#btn-settings');
  const peekSt = () => page.evaluate(() => {
    const P = document.querySelector('#panel-settings'), c = document.querySelector('#overlay'), x = c.getContext('2d');
    const a = [[0.35, 0.35], [0.4, 0.65], [0.6, 0.35], [0.65, 0.65]].map(([u, v]) => x.getImageData(Math.round(c.width * u), Math.round(c.height * v), 1, 1).data[3]);
    return { peek: P.classList.contains('tp-peek'), card: getComputedStyle(P.querySelector('.modal-card')).visibility, label: getComputedStyle(document.querySelector('#set-bgTransparency').closest('label')).visibility, other: getComputedStyle(document.querySelector('#set-puckTransparency').closest('label')).visibility, a, paused: window.__puckTrainer.app.paused };
  });
  const bgWas2 = await page.evaluate(() => document.querySelector('#set-bgTransparency').value);
  await page.evaluate(() => document.querySelector('#set-bgTransparency').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  await setTp('bgTransparency', 0); await page.waitForTimeout(250); const pk0 = await peekSt();
  await setTp('bgTransparency', 100); await page.waitForTimeout(250); const pk100 = await peekSt();
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup')));
  await page.waitForTimeout(100); const pkUp = await peekSt();
  await setTp('bgTransparency', bgWas2);
  await page.click('[data-close="panel-settings"]');
  await page.evaluate((m) => window.__puckTrainer.game.setMode(m), modeWas);
  await page.evaluate(() => document.querySelectorAll('.panel.modal:not(.hidden) .btn-close').forEach((x) => x.click()));
  const pkOk = pk0.peek && pk0.card === 'hidden' && pk0.label === 'visible' && pk0.other === 'hidden' && pk0.paused
    && pk0.a.every((v) => v >= 250) && pk100.a.filter((v) => v <= 10).length >= 2
    && !pkUp.peek && pkUp.card === 'visible' && pkUp.other === 'visible';
  console.log(`${pkOk ? 'PASS' : 'FAIL'} dragging a transparency slider hides the settings card and shows the real game screen behind it ${JSON.stringify({ pk0, pk100, pkUp })}`);
  if (!pkOk) failed = true;
  const poOk = sliderAttr.min === '0' && sliderAttr.max === '100' && sliderAttr.step === '1' && sliderAttr.value === '0' && Math.abs(po.a - 0.27) < 1e-9 && po.saved === 73 && po.out === '73';
  console.log(`${poOk ? 'PASS' : 'FAIL'} puck transparency slider 0..100 step 1 (73% -> alpha ${po.a})`);
  if (!poOk) failed = true;

  // 노트북 웹캠 흐름: 조작 대상 스틱(미지정이면 시작 거부) + 해상도 변경 (영역은 화면 끝까지 맞춘 틀)
  await page.click('#btn-settings');
  await page.evaluate(() => { document.querySelector('.settings-adv').open = true; }); // 인식 세부 조정은 접혀 있음
  await page.waitForTimeout(300);
  // 인식 미리보기: 설정 창 안에서 인식 해상도 그대로 그려지고, 쓰이지 않는 바닥 밝기·채도 칸과 화면 마스크 스위치는 없다
  const adv = await page.evaluate(() => { const c = document.querySelector('#mask-preview'), d = c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data; return { w: c.width, pw: window.__puckTrainer.vision.PW, drawn: d[3] === 255, gone: !document.querySelector('#set-whiteV') && !document.querySelector('#set-whiteC') && !document.querySelector('#set-debug'), hints: document.querySelectorAll('.settings-adv .hint').length }; });
  const advOk = adv.w === adv.pw && adv.drawn && adv.gone && adv.hints === 6;
  console.log(`${advOk ? 'PASS' : 'FAIL'} detection fine-tuning: live preview inside settings, hint per control, unused floor sliders removed (${JSON.stringify(adv)})`);
  if (!advOk) failed = true;
  // 인식 세부 조정에 지금 인식 상태(fps·ms·영역을 읽는 해상도)가 바로 보인다
  const live = (await page.textContent('#proc-live')).trim();
  const liveOk = /^인식 \d+ fps, 프레임당 [\d.]+ms( · 카메라 \d+ fps)? · 영역 \d+×\d+px로 읽음 \(×\d\.\d\d\)$/.test(live);
  console.log(`${liveOk ? 'PASS' : 'FAIL'} settings show live detection speed and area read size (${live})`);
  if (!liveOk) failed = true;
  await page.selectOption('#set-procWidth', '320');
  const rateDefault = await page.inputValue('#set-camRate');
  await page.selectOption('#set-camRate', '30');
  const fps30 = await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 200)); const c = document.querySelector('#video').srcObject?.getVideoTracks()[0].getConstraints().frameRate; return typeof c === 'number' ? c : c?.ideal; });
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
  console.log(`${fullRun ? 'PASS' : 'FAIL'} game runs at 320px`);
  if (!fullRun) failed = true;
  await page.click('#btn-start');
  await page.click('[data-close="panel-result"]');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('puck-trainer.settings.v1')));
  const camOk = rateDefault === 'auto' && saved.camRate === '30' && fps30 === 30;
  console.log(`${saved.floorMode === 'manual' && saved.procWidth === 320 && camOk ? 'PASS' : 'FAIL'} webcam settings persisted (camera frame ${rateDefault} -> ${saved.camRate}, camera fps ${fps30})`);
  if (!(saved.floorMode === 'manual' && saved.procWidth === 320 && camOk)) failed = true;
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
  // 게스트 결과: 정회원이었다면 몇 위 + 친구 초대 / 보호자가 공식 계정 DM으로 코드 요청 (SNS 영상 조건 없음)
  await page.evaluate(() => localStorage.setItem('puck-trainer.site.v1', JSON.stringify({ hashtag: '퍽챌린지', snsAccount: 'puck.official' })));
  const guestEnd = (score) => page.evaluate((s) => { const g = window.__puckTrainer.game; g.setMode('wide'); g.onEnd({ mode: g.mode, score: s, reason: 'time', elapsed: 180, limit: 180, seconds: 60, rankKey: 'wide@60', items: [['점수', s]] }); }, score);
  const guestBox = () => page.evaluate(() => ({ text: document.querySelector('#result-guest').textContent, dm: document.querySelector('#guest-dm')?.getAttribute('href') || '', join: !!document.querySelector('#guest-join'), rank: !document.querySelector('#result-rank').classList.contains('hidden') }));
  await guestEnd(9);
  await page.waitForSelector('#result-guest:not(.hidden)');
  const guest = await guestBox();
  const guestOk = guest.text.includes('정회원이었다면 지금 전체 2위 / 2명') && guest.text.includes('보호자가 공식 인스타 DM으로 가입 코드를 요청') && guest.text.includes('보호자와 함께')
    && !/SNS|영상|#퍽챌린지/.test(guest.text) && guest.dm === 'https://ig.me/m/puck.official' && !guest.join && !guest.rank;
  console.log(`${guestOk ? 'PASS' : 'FAIL'} guest result: would-be rank + invite link or a parent DMs the official account for a code, no social video required (${guest.dm} ${guest.text.slice(0, 60)}…)`);
  if (!guestOk) failed = true;
  await page.click('[data-close="panel-result"]');
  // 공개 가입 코드(오픈베타)를 걸면 결과 화면에 [정회원 가입하기] -> 회원가입 칸이 열리고 코드가 채워짐. 1회용 코드를 걸면 버튼이 안 나옴
  await page.evaluate(() => localStorage.setItem('puck-trainer.site.v1', JSON.stringify({ snsAccount: 'puck.official', joinCode: 'BETA2026' })));
  await guestEnd(8);
  await page.waitForSelector('#guest-join');
  const joinBox = await guestBox();
  await page.click('#guest-join');
  await page.waitForSelector('#panel-login:not(.hidden)');
  const joinForm = await page.evaluate(() => ({ result: !document.querySelector('#panel-result').classList.contains('hidden'), tab: document.querySelector('.auth-tabs .tab.active')?.dataset.tab, code: document.querySelector('#auth-code').value }));
  await page.click('[data-close="panel-login"]');
  await page.evaluate(() => { window.__puckTrainer.account._putCode('ONEUSE22', { type: 'one', maxUses: 1, expiresAt: null }); localStorage.setItem('puck-trainer.site.v1', JSON.stringify({ snsAccount: 'puck.official', joinCode: 'ONEUSE22' })); });
  await guestEnd(7);
  await page.waitForFunction(() => !document.querySelector('#result-guest').classList.contains('hidden') && document.querySelector('#guest-dm'));
  const oneBox = await guestBox();
  await page.click('[data-close="panel-result"]');
  await page.evaluate(() => { localStorage.setItem('puck-trainer.site.v1', JSON.stringify({ snsAccount: 'puck.official' })); const k = 'puck-trainer.codes.v1', c = JSON.parse(localStorage.getItem(k)); delete c.ONEUSE22; localStorage.setItem(k, JSON.stringify(c)); }); // 아래 운영자 코드 목록 수가 그대로이게
  const guestJoinOk = joinBox.join && joinBox.text.includes('지금은 누구나 정회원으로 가입할 수 있어요') && !joinBox.dm && !joinForm.result && joinForm.tab === 'register' && joinForm.code === 'BETA-2026' && !oneBox.join && !!oneBox.dm;
  console.log(`${guestJoinOk ? 'PASS' : 'FAIL'} guest result: public open-beta code shows [Join as a member], which opens sign-up with the code filled; a one-time code is never shown (${JSON.stringify({ joinForm, one: oneBox.join })})`);
  if (!guestJoinOk) failed = true;
  // 운영자 화면 (관리자 별명): 1회용 코드 만들기 -> 목록, 끄기
  await page.evaluate(async () => { const a = window.__puckTrainer.account; await a.register({ loginId: 'opsadmin', password: 'ops12345', nick: 'test123', country: 'KR', team: 'Ops', age: 30, code: 'BETA2026' , stick: 'L' }); });
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
  // 베타 종료일 -> '정회원 ○월 ○일까지 · 의견 보내고 3개월 이용권 추첨' 칩 -> [개발자에게] 보내면 추첨 응모, 운영자 화면에 의견이 보임
  const endDay = await page.evaluate(() => { const d = new Date(Date.now() + 7 * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  await page.fill('#adm-beta-end', endDay);
  await page.click('#adm-save-beta-end');
  await page.waitForFunction(() => !document.querySelector('#adm-beta-sum').textContent.includes('아직 정하지'));
  const betaRows = await page.evaluate(() => document.querySelectorAll('#adm-betas tr[data-uid]').length);
  const sum1 = await page.textContent('#adm-beta-sum');
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
  await page.waitForFunction(() => document.querySelector('#adm-lot-sum').textContent.includes('추첨 대상 1명'));
  // 의견 추첨 -> 확정(확인 창) -> 당첨자에게 3개월 이용권
  await page.click('#adm-lot-draw');
  await page.waitForSelector('#adm-lot-ok:not(.hidden)');
  const draft = await page.textContent('#adm-lot-out');
  page.once('dialog', (d) => d.accept());
  await page.click('#adm-lot-ok');
  await page.waitForFunction(() => document.querySelector('#adm-lot-out').textContent.includes('확정된 당첨자 1명'));
  const won = await page.evaluate(() => ({ row: document.querySelector('#adm-betas tr[data-nick="test123"] td:nth-child(6)').textContent, id: document.querySelector('#adm-betas tr[data-nick="test123"] td:nth-child(3)').textContent, sum: document.querySelector('#adm-beta-sum').textContent,
    ok: document.querySelector('#adm-lot-ok').classList.contains('hidden'), copy: !document.querySelector('#adm-lot-copy').classList.contains('hidden') }));
  await page.click('[data-close="panel-admin"]');
  const chipWin = await page.evaluate(() => document.querySelector('#auth-who .beta-chip')?.textContent || '');
  const fbOk = betaRows === 2 && sum1.includes('오픈베타 링크 2명') && chip1.includes('의견 보내고 3개월 이용권 추첨') && intro.includes('30명을 추첨해 3개월 이용권') && toastFb.includes('추첨에 응모되었어요')
    && chip2.includes('이용권 추첨 응모 완료');
  console.log(`${fbOk ? 'PASS' : 'FAIL'} beta end date -> member sends [To the developer] feedback -> entered in the 3-month pass draw, operator reads it (${JSON.stringify({ betaRows, chip1, chip2, toastFb, sum1 })})`);
  if (!fbOk) failed = true;
  const lotOk = draft.includes('추첨 결과 1명') && draft.includes('test123') && won.row.includes('이용권') && won.id === 'opsadmin' && won.sum.includes('이용권 1명') && won.ok && won.copy && chipWin.startsWith('3개월 이용권 ·');
  console.log(`${lotOk ? 'PASS' : 'FAIL'} operator draws among feedback senders, confirms -> winner gets a 3-month pass (${JSON.stringify({ draft: draft.slice(0, 40), won, chipWin })})`);
  if (!lotOk) failed = true;
  // 운영자 > 회원 현황: 팀·상태로 거르기 -> 회원을 누르면 회원 기록 창(출석률·달력·훈련 시간·게임별 판 수·게임별 기록) -> '‹ 회원 현황'으로 돌아감
  const seedTeam = await page.evaluate(() => {
    const users = JSON.parse(localStorage.getItem('puck-trainer.users.v1') || '{}'), bolt = users['번개손'];
    const day = (ago) => { const d = new Date(Date.now() - ago * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const acts = JSON.parse(localStorage.getItem('puck-trainer.activity.v1') || '{}');
    acts['번개손'] = { uid: '번개손', days: { [day(0)]: { n: 2, s: 300 }, [day(3)]: { n: 1, s: 120 }, [day(5)]: { n: 0, s: 0 } },
      totals: { games: 3, sec: 420, dist: 35, touches: 40, modes: { arcade: 2, wide: 1 } }, recent: { 'arcade@60': [{ s: 10, at: Date.now() - 3 * 864e5 }, { s: 14, at: Date.now() }] }, updatedAt: Date.now() };
    localStorage.setItem('puck-trainer.activity.v1', JSON.stringify(acts));
    return bolt.team.toLowerCase();
  });
  await page.click('#btn-settings'); await page.click('#btn-settings-admin');
  await page.waitForSelector('#panel-admin:not(.hidden)');
  await page.click('#adm-open-members');
  await page.waitForFunction(() => document.querySelectorAll('#mem-rows tr[data-uid]').length === 2);
  const memRows = () => page.evaluate(() => [...document.querySelectorAll('#mem-rows tr[data-uid]')].map((r) => r.dataset.nick));
  const allNicks = await memRows();
  await page.selectOption('#mem-team', seedTeam);
  const byTeam = await memRows();
  await page.selectOption('#mem-team', '');
  await page.selectOption('#mem-state', 'coupon');
  const byState = await memRows();
  await page.selectOption('#mem-state', '');
  await page.selectOption('#mem-act', 'today');
  const byAct = await memRows();
  const memSum = await page.textContent('#mem-sum');
  await page.click('#mem-reset');
  await page.click('#mem-rows tr[data-nick="번개손"]');
  await page.waitForSelector('#panel-member:not(.hidden)');
  await page.waitForFunction(() => !document.querySelector('#mm-scores').textContent.includes('불러오는 중'));
  const mm = await page.evaluate(() => ({
    card: document.querySelector('#mm-card').textContent, att: document.querySelector('#mm-att').textContent, totals: document.querySelector('#mm-totals').textContent,
    calOn: document.querySelectorAll('#mm-cal td.on').length, bars: document.querySelectorAll('#mm-chart rect').length, modes: document.querySelector('#mm-modes').textContent,
    scores: document.querySelectorAll('#mm-scores tr').length, spark: !!document.querySelector('#mm-scores svg.spark'),
  }));
  await page.waitForSelector('#mm-ability .ab-card');
  const mmAb = await page.evaluate(() => { const b = document.querySelector('#mm-ability'); return { hex: !!b.querySelector('svg.ab-hex'), cur: !!b.querySelector('polygon.ab-cur'), top: !!b.querySelector('polygon.ab-top'), rows: b.querySelectorAll('.ab-table tbody tr').length, text: b.textContent }; });
  await page.click('#mm-back');
  const backToList = await page.evaluate(() => document.querySelector('#panel-member').classList.contains('hidden') && !document.querySelector('#panel-members').classList.contains('hidden'));
  await page.click('[data-close="panel-members"]'); await page.click('[data-close="panel-admin"]');
  const memOk = allNicks.length === 2 && byTeam.join() === '번개손' && byState.join() === 'test123' && byAct.includes('번개손') && memSum.includes('오늘 출석')
    && mm.card.includes('번개손') && mm.att.includes('최근 30일 출석률') && /\d+%/.test(mm.att) && mm.totals.includes('3판') && mm.totals.includes('7분') && mm.totals.includes('훈련한 날')
    && mm.calOn >= 1 && mm.bars === 28 && mm.modes.includes('게임별 판 수') && mm.scores >= 1 && mm.spark && backToList
    && mmAb.hex && mmAb.cur && mmAb.top && mmAb.rows === 6 && mmAb.text.includes('센스') && mmAb.text.includes('종합');
  console.log(`${memOk ? 'PASS' : 'FAIL'} operator members: filter by team/status/activity, click a member -> record window (stats hexagon, attendance rate, calendar, training time, 28-day chart, game records), back to list (${JSON.stringify({ allNicks, byTeam, byState, byAct, mm, mmAb: { ...mmAb, text: mmAb.text.slice(0, 80) }, backToList })})`);
  if (!memOk) failed = true;
  // 남은 일수 계산 (stats.js): 유지 = 무기한, 베타 종료일 미정 = 미정, 베타 종료일·이용권 기한 중 늦은 날까지, 연장은 줄이지 않음, '남은 일수' 정렬
  const acc = await page.evaluate(async () => {
    const S = await import('/src/stats.js');
    const now = new Date(2026, 10, 19, 12).getTime(), d = (y, m, dd) => new Date(y, m - 1, dd).getTime();
    const beta = d(2026, 11, 26); // 11/26 0시에 끝남 = 11/25까지
    const A = (u, b = beta) => S.accessInfo(u, b, now);
    const rows = [{ u: { id: 'a', kept: true } }, { u: { id: 'b' } }, { u: { id: 'c', until: d(2027, 2, 1) } }];
    const plan = S.extendPlan(rows, '2026-12-31', beta, now);
    const sorted = S.sortMembers([{ u: { memberNo: 1 }, access: A({ kept: true }) }, { u: { memberNo: 2 }, access: A({}) }, { u: { memberNo: 3 }, access: A({}, d(2026, 11, 1)) }, { u: { memberNo: 4 }, access: A({}, null) }], 'left').map((r) => r.u.memberNo).join();
    return { kept: A({ kept: true }).kind, open: A({}, null).kind, beta: A({}), coupon: A({ until: d(2027, 1, 10) }), ended: A({}, d(2026, 11, 19)).kind, today: A({}, d(2026, 11, 20)).left,
      until: S.untilOfDay('2026-12-31') === new Date(2026, 11, 31, 23, 59, 59, 999).getTime(), plan: { apply: plan.apply.map((r) => r.u.id).join(), later: plan.later.map((r) => r.u.id).join(), kept: plan.kept.map((r) => r.u.id).join(), until: plan.until === new Date(2026, 11, 31, 23, 59, 59, 999).getTime() }, sorted };
  });
  const accOk = acc.kept === 'forever' && acc.open === 'open' && acc.beta.kind === 'until' && acc.beta.lastDay === '2026-11-25' && acc.beta.left === 6
    && acc.coupon.lastDay === '2027-01-09' && acc.coupon.left === 51 && acc.ended === 'ended' && acc.today === 0 && acc.until
    && acc.plan.apply === 'b' && acc.plan.later === 'c' && acc.plan.kept === 'a' && acc.plan.until && acc.sorted === '3,2,4,1';
  console.log(`${accOk ? 'PASS' : 'FAIL'} days left: kept = no end, no beta end = not set, later of beta end and pass, extend never shortens, sort by days left (${JSON.stringify(acc)})`);
  if (!accOk) failed = true;
  // 회원 현황: '남은 일수' 칸, 마지막 칸 '총 훈련 시간'(숫자 칸 제목 오른쪽 정렬) -> 왼쪽 칸 체크(기록 창은 안 열림) -> 모두 선택 -> 달력 날짜 -> 연장
  //  (이미 그 뒤까지인 이용권 회원은 그대로) -> 남은 일수·기록 창의 이용 기간이 바뀜
  await page.click('#btn-settings'); await page.click('#btn-settings-admin');
  await page.waitForSelector('#panel-admin:not(.hidden)');
  await page.click('#adm-open-members');
  await page.waitForFunction(() => document.querySelectorAll('#mem-rows tr[data-uid]').length === 2);
  const extBefore = await page.evaluate(() => {
    const ths = [...document.querySelectorAll('.mem-table thead th')];
    const cell = (nick, i) => document.querySelector(`#mem-rows tr[data-nick="${nick}"] td:nth-child(${i})`)?.textContent.trim();
    const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return { head: ths.map((t) => t.textContent.trim()), align: ths.map((t) => getComputedStyle(t).textAlign).join(), bolt: cell('번개손', 7), admin: cell('test123', 7),
      btn: document.querySelector('#mem-ext-go').disabled, date: document.querySelector('#mem-ext-date').value, today, min: document.querySelector('#mem-ext-date').min, sel: document.querySelector('#mem-sel').textContent };
  });
  await page.click('#mem-rows tr[data-nick="번개손"] .mem-pick input');
  const pick1 = await page.evaluate(() => ({ closed: document.querySelector('#panel-member').classList.contains('hidden'), sel: document.querySelector('#mem-sel').textContent,
    picked: document.querySelector('#mem-rows tr[data-nick="번개손"]').classList.contains('picked'), all: document.querySelector('#mem-all').indeterminate, btn: document.querySelector('#mem-ext-go').disabled }));
  await page.check('#mem-all');
  const sel2 = await page.textContent('#mem-sel');
  const extKey = await page.evaluate(() => { const d = new Date(Date.now() + 40 * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  await page.fill('#mem-ext-date', extKey);
  let extAsk = '';
  page.once('dialog', (d) => { extAsk = d.message(); d.accept(); });
  await page.click('#mem-ext-go');
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('늘렸습니다'));
  await page.waitForFunction(() => document.querySelectorAll('#mem-rows tr[data-uid]').length === 2 && !document.querySelector('#mem-rows .mem-pick input:checked'));
  const extAfter = await page.evaluate((key) => {
    const u = JSON.parse(localStorage.getItem('puck-trainer.users.v1'))['번개손'], [y, m, d] = key.split('-').map(Number);
    const row = (nick, i) => document.querySelector(`#mem-rows tr[data-nick="${nick}"] td:nth-child(${i})`).textContent.trim();
    return { ok: u.until === new Date(y, m - 1, d, 23, 59, 59, 999).getTime(), coupon: u.coupon, bolt: row('번개손', 7), tag: row('번개손', 6), admin: row('test123', 7),
      sel: document.querySelector('#mem-sel').textContent, toast: document.querySelector('#toast').textContent };
  }, extKey);
  await page.click('#mem-rows tr[data-nick="번개손"] td:nth-child(3)');
  await page.waitForSelector('#panel-member:not(.hidden)');
  const extCard = await page.textContent('#mm-card');
  await page.click('#mm-back');
  await page.click('[data-close="panel-members"]'); await page.click('[data-close="panel-admin"]');
  // 다음 테스트(베타 종료 뒤 무료 정회원)를 위해 번개손의 연장을 되돌린다
  await page.evaluate(() => { const k = 'puck-trainer.users.v1', us = JSON.parse(localStorage.getItem(k)); delete us['번개손'].until; delete us['번개손'].coupon; localStorage.setItem(k, JSON.stringify(us)); });
  const md = extKey.slice(5).replace('-', '.');
  const extOk = extBefore.head.length === 11 && extBefore.head[6] === '남은 일수' && extBefore.head[10] === '총 훈련 시간'
    && extBefore.align === 'center,left,left,left,left,left,right,left,right,right,right' && /^\d+일 ~\d\d\.\d\d$/.test(extBefore.bolt) && /^\d+일 ~\d\d\.\d\d$/.test(extBefore.admin)
    // 달력 기본값은 오늘 뒤의 날(한 달 뒤), 오늘보다 앞은 못 고름. 예전엔 '연도 > 올해'처럼 비교해서 연말(40일 뒤가 다음 해)이면 틀렸다
    && extBefore.btn && /^\d{4}-\d\d-\d\d$/.test(extBefore.date) && extBefore.date > extBefore.today && extBefore.min === extBefore.today && extBefore.sel === '선택한 회원 없음'
    && pick1.closed && pick1.sel === '1명 선택' && pick1.picked && pick1.all && !pick1.btn && sel2 === '2명 선택'
    && extAsk.includes(`1명의 이용 기간을 ${extKey.replace(/-/g, '.')}까지로 늘립니다.`) && extAsk.includes('이미 그 뒤까지인 1명은 그대로입니다.')
    && extAfter.ok && extAfter.coupon === 'ext' && extAfter.bolt === `40일 ~${md}` && extAfter.tag.includes(`연장 ~${md}`) && extAfter.admin === extBefore.admin
    && extAfter.sel === '선택한 회원 없음' && extAfter.toast.includes('1명의 이용 기간을') && extCard.includes(`이용 기간 ${extKey.replace(/-/g, '.')}까지 · 40일 남음`);
  console.log(`${extOk ? 'PASS' : 'FAIL'} operator members: days-left column, last column 'total training time', tick members (row does not open), select all, pick a calendar date -> extend (a longer pass stays) (${JSON.stringify({ extBefore, pick1, sel2, extAsk, extAfter, extCard: extCard.slice(-60) })})`);
  if (!extOk) failed = true;
  // 능력치 (ability.js): 월별 최고 기록 저장(13달), 나이대 1등 = 100, 상위 10% 선, 지난달 대비, 이번 달 기록이 없으면 지난 기록을 이어서
  const ab = await page.evaluate(async () => {
    const A = await import('/src/ability.js'), V = await import('/src/activity.js');
    const now = new Date(2026, 10, 19, 12).getTime(), oct = new Date(2026, 9, 5, 12).getTime(), sep = new Date(2026, 8, 5, 12).getTime();
    let act = V.addActivity({ uid: 'x' }, { key: 'quick', score: 40, sec: 20, mode: 'quick' }, oct);
    act = V.addActivity(act, { key: 'quick', score: 30, sec: 20, mode: 'quick' }, oct);
    for (const [key, score] of [['quick', 50], ['arcade@60', 30], ['arcade@180', 80], ['arcade@60-hard', 99]]) act = V.addActivity(act, { key, score, sec: 60, mode: key.split('@')[0] }, now);
    const stored = V.cleanActivity(act, 'x').totals.months;
    const mk = (i) => { const d = new Date(2025, i, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
    const trimmed = Object.keys(V.cleanActivity({ totals: { months: Object.fromEntries(Array.from({ length: 15 }, (_, i) => [mk(i), { quick: i }])) } }, 'y').totals.months).sort();
    const months = A.monthBests(act, [{ mode: 'reaction', score: 12, at: sep }]);
    const refs = { quick: { scope: 'group', total: 10, top: 100, top10: 80 }, 'arcade@60': { scope: 'group', total: 8, top: 60, top10: 45 }, 'arcade@180': { scope: 'group', total: 2, top: 100, top10: 100 },
      reaction: { scope: 'all', total: 3, top: 24, top10: 24 }, 'wide@60': null, 'obstacle@60': { scope: 'group', total: 6, top: 500, top10: 400 }, figure8: null };
    const res = A.computeAbilities(months, refs, now), by = Object.fromEntries(res.list.map((x) => [x.id, x]));
    const pick = (x) => ({ key: x.key, value: x.value, prev: x.prev, delta: x.delta, top10: x.top10, carried: x.carried, scope: x.scope });
    return { stored, trimmed: [trimmed.length, trimmed[0]], keys: A.abilityKeys(months, now).sort(), speed: pick(by.speed), sense: pick(by.sense), react: pick(by.react), vision: pick(by.vision), control: pick(by.control),
      ovr: res.ovr, delta: res.delta, top10Ovr: res.top10Ovr, weakest: res.weakest?.id, ref: A.refOf([90, 80, 70, 60, 50], 25, 'group'), order: res.list.map((x) => x.mode).join() };
  });
  const abOk = JSON.stringify(Object.fromEntries(Object.entries(ab.stored).sort())) === JSON.stringify({ '2026-10': { quick: 40 }, '2026-11': { quick: 50, 'arcade@60': 30, 'arcade@180': 80, 'arcade@60-hard': 99 } })
    && ab.trimmed[0] === 13 && ab.trimmed[1] === '2025-03' && ab.keys.join() === 'arcade@180,arcade@60,figure8,obstacle@60,quick,reaction,wide@60'
    && ab.speed.value === 50 && ab.speed.prev === 40 && ab.speed.delta === 10 && ab.speed.top10 === 80
    && ab.sense.key === 'arcade@60' && ab.sense.value === 50 && ab.sense.top10 === 75 && ab.sense.prev === null && ab.sense.delta === null
    && ab.react.value === 50 && ab.react.carried && ab.react.delta === null && ab.react.scope === 'all'
    && ab.vision.value === null && ab.vision.key === 'obstacle@60' && ab.vision.top10 === 80 && ab.control.value === null && ab.control.top10 === null
    && ab.ovr === 50 && ab.delta === 10 && ab.top10Ovr === 84 && ab.weakest === 'control' && ab.ref.top === 90 && ab.ref.top10 === 70
    && ab.order === 'quick,reaction,figure8,wide,obstacle,arcade';
  console.log(`${abOk ? 'PASS' : 'FAIL'} stats hexagon math: monthly bests kept 13 months, age-group #1 = 100, top-10% line, change vs last month, earlier record carried when this month has none (${JSON.stringify(ab)})`);
  if (!abOk) failed = true;
  // 내 정보 > 친구 초대: 내 초대 링크(3명) -> 다른 탭에서 그 링크로 들어오면 '○○님의 초대 링크예요' + 가입하면 바로 정회원
  await page.click('#btn-me');
  await page.waitForFunction(() => document.querySelector('#me-invite input')?.value.includes('?c='));
  const myInv = await page.evaluate(() => ({ text: document.querySelector('#me-invite').textContent, link: document.querySelector('#me-invite input').value }));
  await page.waitForSelector('#me-ability .ab-card');
  const meAb = await page.evaluate(() => ({ hex: !!document.querySelector('#me-ability svg.ab-hex'), labels: document.querySelectorAll('#me-ability svg text').length, text: document.querySelector('#me-ability').textContent.slice(0, 60) }));
  const meAbOk = meAb.hex && meAb.labels === 6;
  console.log(`${meAbOk ? 'PASS' : 'FAIL'} My info shows the stats hexagon card (${JSON.stringify(meAb)})`);
  if (!meAbOk) failed = true;
  await page.click('[data-close="panel-me"]');
  const p2 = await context.newPage();
  await p2.goto(`${base}/index.html`);
  await p2.evaluate(() => window.__puckTrainer.account.logout()); // 같은 브라우저: 로그인 기록을 지우고 초대 링크로
  await p2.goto(myInv.link);
  await p2.waitForSelector('#invite-card:not(.hidden)');
  const card2 = await p2.evaluate(() => ({ title: document.querySelector('#invite-title').textContent, sub: document.querySelector('#invite-sub').textContent, code: document.querySelector('#auth-code').value }));
  await p2.fill('#auth-id', 'friend01'); await p2.fill('#auth-pin', 'friend123'); await p2.fill('#auth-pin2', 'friend123'); await p2.fill('#auth-nick', '친구1');
  await p2.selectOption('#auth-country', 'KR'); await p2.fill('#auth-team', '서울 유스'); await p2.fill('#auth-age', '12');
  await p2.click('#auth-stick [data-stick="R"]');
  await p2.evaluate(() => document.querySelector('#auth-form').requestSubmit());
  await p2.waitForSelector('#auth-logged:not(.hidden)');
  const who2 = await p2.textContent('#auth-who');
  const used = await p2.evaluate(async (c) => (await window.__puckTrainer.account.checkCode(c)).uses, card2.code);
  await p2.close();
  const invLinkOk = /\?c=[2-9A-Z]{4}-[2-9A-Z]{4}$/.test(myInv.link) && myInv.text.includes('0/3명 가입 · 남은 자리 3명') && card2.title === 'test123님의 초대 링크예요'
    && card2.sub.includes('가입하면 바로 정회원') && card2.sub.includes('남은 자리 3명') && myInv.link.endsWith(card2.code) && who2.includes('친구1') && who2.includes('정회원 No.') && used === 1;
  console.log(`${invLinkOk ? 'PASS' : 'FAIL'} My info -> my invite link (3 people) -> a friend opens it, sees who invited them and joins as a member (${JSON.stringify({ myInv, card2, who2: who2.trim().slice(0, 40), used })})`);
  if (!invLinkOk) failed = true;
  const relogin = await page.evaluate(async () => {
    const a = window.__puckTrainer.account; a.logout();
    let byNick = '';
    try { await a.login('번개손', 'puck2026'); } catch (e) { byNick = e.message; }
    try { await a.login('BUNGAE11', 'puck2026'); return { ok: !!a.current(), byNick }; } catch (e) { return { ok: false, byNick, err: e.message }; }
  });
  const reloginOk = loggedOut && relogin.ok && relogin.byNick === '아이디 또는 비밀번호가 맞지 않습니다';
  console.log(`${reloginOk ? 'PASS' : 'FAIL'} logout and login again with the ID (case-insensitive); the public nickname does not log in (${JSON.stringify(relogin)})`);
  if (!reloginOk) failed = true;
  // 예전 계정(별명 + 숫자 6자리): 로그인하면 아이디 만들기 화면 (그 전에는 로그인 전) -> 만들면 아이디로만 로그인
  await page.evaluate(async () => {
    const { hashPin } = await import('/src/account.js');
    const k = 'puck-trainer.users.v1', users = JSON.parse(localStorage.getItem(k));
    users['옛친구'] = { id: '옛친구', nick: '옛친구', number: null, pinHash: await hashPin('옛친구', '135790'), country: 'KR', team: '옛팀', age: 20, ageGroup: '성인', stick: 'L', createdAt: 1, code: 'BETA2026', via: 'beta', beta: true, memberNo: 9, joinedAt: 1 };
    localStorage.setItem(k, JSON.stringify(users));
  });
  await page.evaluate(() => window.__puckTrainer.account.logout());
  await page.click('#btn-settings'); await page.click('#btn-settings-login'); // 게임 중 로그인 창
  await page.waitForSelector('#panel-login:not(.hidden)');
  await page.fill('#auth-id', '옛친구'); await page.fill('#auth-pin', '135790');
  await page.evaluate(() => document.querySelector('#auth-form').requestSubmit());
  await page.waitForSelector('#auth-cancel:not(.hidden)');
  const upForm = await page.evaluate(() => ({ tabs: document.querySelector('#auth-tabs').classList.contains('hidden'), guest: document.querySelector('#auth-guest').classList.contains('hidden'),
    nick: document.querySelector('#auth-upgrade-nick').textContent, pin2: !!document.querySelector('#auth-pin2').offsetParent, btn: document.querySelector('#auth-submit').textContent,
    cur: window.__puckTrainer.account.current(), logged: !document.querySelector('#auth-logged').classList.contains('hidden') }));
  await page.fill('#auth-id', 'oldfriend'); await page.fill('#auth-pin', 'newpass12'); await page.fill('#auth-pin2', 'newpass12');
  await page.evaluate(() => document.querySelector('#auth-form').requestSubmit());
  await page.waitForSelector('#panel-login.hidden', { state: 'attached' });
  const upWho = await page.textContent('#auth-who');
  const upAfter = await page.evaluate(async () => {
    const a = window.__puckTrainer.account; a.logout();
    let byNick = '', oldPin = '';
    try { await a.login('옛친구', 'newpass12'); } catch (e) { byNick = e.message; }
    try { await a.login('oldfriend', '135790'); } catch (e) { oldPin = e.message; }
    await a.login('oldfriend', 'newpass12');
    const who = a.current()?.nick; a.logout();
    await a.login('bungae11', 'puck2026');
    return { byNick, oldPin, who };
  });
  const upOk = upForm.tabs && upForm.guest && upForm.nick === '옛친구' && upForm.pin2 && upForm.btn === '아이디 만들기' && upForm.cur === null && !upForm.logged
    && upWho.includes('옛친구') && upAfter.byNick === '이제 아이디로 로그인하세요 (아이디를 잊었으면 운영자에게 문의하세요)' && upAfter.oldPin === '아이디 또는 비밀번호가 맞지 않습니다' && upAfter.who === '옛친구';
  console.log(`${upOk ? 'PASS' : 'FAIL'} old nickname + 6-digit account: login opens "create ID", then only the ID + new password works (${JSON.stringify({ upForm, upWho: upWho.trim().slice(0, 30), upAfter })})`);
  if (!upOk) failed = true;
  // 내 정보 > 비밀번호 바꾸기: 확인이 다르면 안내, 맞으면 바뀌고 새 비밀번호로만 로그인
  await page.click('#btn-me');
  await page.waitForSelector('#me-body:not(.hidden)');
  await page.click('#me-pw-toggle');
  const pwOpen = await page.evaluate(() => ({ form: !document.querySelector('#me-pw').classList.contains('hidden'), user: document.querySelector('#me-pw-user').value, ph: document.querySelector('#me-pw-new').placeholder }));
  await page.fill('#me-pw-cur', 'puck2026'); await page.fill('#me-pw-new', 'puck2027'); await page.fill('#me-pw-new2', 'puck2028');
  await page.click('#me-pw-save');
  const pwMismatch = await page.textContent('#me-pw-msg');
  await page.fill('#me-pw-cur', 'wrong999'); await page.fill('#me-pw-new2', 'puck2027');
  await page.click('#me-pw-save');
  await page.waitForFunction(() => document.querySelector('#me-pw-msg').textContent.includes('지금 비밀번호'));
  await page.fill('#me-pw-cur', 'puck2026');
  await page.click('#me-pw-save');
  await page.waitForSelector('#me-pw.hidden', { state: 'attached' });
  const pwToast = await page.textContent('#toast');
  const pwCleared = await page.evaluate(() => document.querySelector('#me-pw-cur').value === '' && document.querySelector('#me-pw-new').value === '');
  await page.click('[data-close="panel-me"]');
  const pwAfter = await page.evaluate(async () => {
    const a = window.__puckTrainer.account; a.logout();
    let oldPw = ''; try { await a.login('bungae11', 'puck2026'); } catch (e) { oldPw = e.message; }
    await a.login('bungae11', 'puck2027'); const ok = a.current()?.nick === '번개손';
    await a.changePassword('puck2027', 'puck2026'); // 다음 검사를 위해 되돌림
    return { oldPw, ok };
  });
  const pwOk = pwOpen.form && pwOpen.user === 'bungae11' && pwOpen.ph === '8자 이상, 영문+숫자' && pwMismatch === '새 비밀번호가 서로 다릅니다' && pwToast.includes('비밀번호를 바꿨습니다') && pwCleared
    && pwAfter.oldPw === '아이디 또는 비밀번호가 맞지 않습니다' && pwAfter.ok;
  console.log(`${pwOk ? 'PASS' : 'FAIL'} My info > change password: mismatch and wrong current are shown, then only the new password logs in (${JSON.stringify({ pwOpen, pwMismatch, pwToast, pwCleared, pwAfter })})`);
  if (!pwOk) failed = true;
  // 비밀번호를 잊었어요 -> 인스타 DM 안내. 운영자가 임시 비밀번호를 주면: 로그인 -> 새 비밀번호만 정하는 화면(아이디 칸 없음) -> 임시 비밀번호는 못 씀 -> 정하면 로그인
  await page.evaluate(async () => { const a = window.__puckTrainer.account; await a._setTempPassword('bungae11', 'abcd-efgh-2345'); a.logout(); });
  await page.click('#btn-settings'); await page.click('#btn-settings-login');
  await page.waitForSelector('#panel-login:not(.hidden)');
  const fgHidden = await page.evaluate(() => document.querySelector('#auth-forgot-box').classList.contains('hidden'));
  await page.click('#auth-forgot');
  const forgot = await page.evaluate(() => ({ open: !document.querySelector('#auth-forgot-box').classList.contains('hidden'), exp: document.querySelector('#auth-forgot').getAttribute('aria-expanded'),
    text: document.querySelector('#auth-forgot-box').textContent, dm: document.querySelector('#auth-forgot-dm a')?.getAttribute('href') || '' }));
  await page.fill('#auth-id', 'bungae11'); await page.fill('#auth-pin', 'abcd-efgh-2345');
  await page.evaluate(() => document.querySelector('#auth-form').requestSubmit());
  await page.waitForSelector('#auth-cancel:not(.hidden)');
  const tForm = await page.evaluate(() => ({ idHidden: document.querySelector('#auth-id-label').classList.contains('hidden'), hint: !document.querySelector('.upgrade-pw-only').classList.contains('hidden'),
    idHint: !document.querySelector('.upgrade-id-only').classList.contains('hidden'), tempId: document.querySelector('#auth-temp-id').textContent, btn: document.querySelector('#auth-submit').textContent,
    pin2: !!document.querySelector('#auth-pin2').offsetParent, forgot: !!document.querySelector('#auth-forgot').offsetParent, cur: window.__puckTrainer.account.current(), focus: document.activeElement?.id }));
  await page.fill('#auth-pin', 'abcd-efgh-2345'); await page.fill('#auth-pin2', 'abcd-efgh-2345');
  await page.evaluate(() => document.querySelector('#auth-form').requestSubmit());
  await page.waitForSelector('#auth-error:not(.hidden)');
  const tSame = await page.textContent('#auth-error');
  await page.fill('#auth-pin', 'puck2026'); await page.fill('#auth-pin2', 'puck2026');
  await page.evaluate(() => document.querySelector('#auth-form').requestSubmit());
  await page.waitForSelector('#panel-login.hidden', { state: 'attached' });
  const tDone = await page.evaluate(() => ({ who: document.querySelector('#auth-who').textContent.trim().slice(0, 20), toast: document.querySelector('#toast').textContent,
    flag: !!JSON.parse(localStorage.getItem('puck-trainer.users.v1'))['번개손'].tempPw, cur: window.__puckTrainer.account.current()?.loginId }));
  const tOk = fgHidden && forgot.open && forgot.exp === 'true' && forgot.text.includes('메일') && forgot.dm === 'https://ig.me/m/puck.official'
    && tForm.idHidden && tForm.hint && !tForm.idHint && tForm.tempId === 'bungae11' && tForm.btn === '새 비밀번호 정하기' && tForm.pin2 && !tForm.forgot && tForm.cur === null && tForm.focus === 'auth-pin'
    && tSame === '지금(임시) 비밀번호와 다른 비밀번호를 정하세요' && tDone.who.includes('번개손') && tDone.toast.includes('새 비밀번호로 바꿨습니다') && !tDone.flag && tDone.cur === 'bungae11';
  console.log(`${tOk ? 'PASS' : 'FAIL'} forgot password -> Instagram DM guide; temp password login asks only for a new password (not the temp one), then logs in (${JSON.stringify({ fgHidden, forgot: { ...forgot, text: forgot.text.slice(0, 30) }, tForm, tSame, tDone })})`);
  if (!tOk) failed = true;
  // 베타 종료일이 지난 무료 정회원(번개손): 결과가 랭킹에 안 올라가고 안내 + 프로필 줄에 '베타 종료'
  await page.evaluate(() => { const k = 'puck-trainer.site.v1'; localStorage.setItem(k, JSON.stringify({ ...JSON.parse(localStorage.getItem(k)), betaEndsAt: Date.now() - 1000 })); });
  await page.evaluate(() => { const g = window.__puckTrainer.game; g.setMode('wide'); g.onEnd({ mode: g.mode, score: 99, reason: 'time', elapsed: 180, limit: 180, seconds: 60, rankKey: 'wide@60', items: [['점수', 99]] }); });
  await page.waitForSelector('#result-guest:not(.hidden)');
  const lapsed = await page.evaluate(() => ({ text: document.querySelector('#result-guest').textContent, rank: !document.querySelector('#result-rank').classList.contains('hidden'),
    best: JSON.parse(localStorage.getItem('puck-trainer.scores-ranked.v1')).filter((x) => x.mode === 'wide@60' && x.nick === '번개손').map((x) => x.score) }));
  await page.click('[data-close="panel-result"]');
  await page.click('#btn-settings'); await page.click('[data-close="panel-settings"]');
  const chip3 = await page.evaluate(() => document.querySelector('#auth-who .beta-chip')?.textContent || '');
  const lapsedOk = lapsed.text.includes('베타 기간이 끝나 정회원 기간이 끝났습니다') && lapsed.text.includes('인스타 DM') && !lapsed.rank && !lapsed.best.includes(99) && chip3.includes('베타 종료');
  console.log(`${lapsedOk ? 'PASS' : 'FAIL'} beta ended: free member's score not ranked, notice + Instagram DM, profile says beta ended (${JSON.stringify({ ...lapsed, text: lapsed.text.slice(0, 40), chip3 })})`);
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
  // 게임 종료 후 선택. 중지 버튼으로 끝낸 결과는 퍽으로 고르지 않는다 (버튼만 — 멈추자마자 다시 시작되는 일 방지)
  const forceU = (u, v = 0.5) => page.evaluate(([uu, vv]) => { const t = window.__puckTrainer.tracker; const orig = Object.getPrototypeOf(t).update; t.update = function (meas, now) { return orig.call(this, { u: uu, v: vv }, now); }; }, [u, v]);
  const btnText = async () => (await page.textContent('#btn-start')).trim();
  await forceU(0.15);
  await page.waitForTimeout(3600);
  const manualNoop = (await page.isVisible('#panel-result')) && (await page.isHidden('#choice-track')) && (await btnText()) === '시작';
  console.log(`${manualNoop ? 'PASS' : 'FAIL'} result after the stop button: no puck choice (puck on the left does nothing)`);
  if (!manualNoop) failed = true;
  // 시간이 끝난 결과: 열릴 때 퍽이 있던 쪽(오른쪽)은 한 번 벗어나야 센다
  await page.click('[data-close="panel-result"]');
  await forceU(0.85);
  await page.click('#btn-start'); await page.waitForTimeout(300);
  await page.evaluate(() => window.__puckTrainer.game.stop('time'));
  await page.waitForSelector('#panel-result:not(.hidden)');
  await page.waitForTimeout(3800);
  const blockedStay = (await page.isVisible('#panel-result')) && (await page.isHidden('#panel-mode'));
  // 가운데는 아무 일 없음 -> 왼쪽 2초: 결과를 닫고 가운데 원으로 -> 원에 3초 두면 바로 시작 (카운트다운 한 번)
  await forceU(0.5);
  await page.waitForTimeout(3200);
  const centerNoop = (await page.isVisible('#panel-result')) && (await btnText()) === '시작';
  await forceU(0.15);
  await page.waitForTimeout(900);
  const fillPct = await page.evaluate(() => parseFloat(document.querySelector('#btn-result-again .choice-fill').style.width) || 0);
  const dotLeft = await page.evaluate(() => parseFloat(document.querySelector('#choice-dot').style.left));
  await page.waitForTimeout(1900);
  const toIdle = (await page.isHidden('#panel-result')) && (await btnText()) === '시작';
  await forceU(0.5);
  await page.waitForTimeout(3700);
  const again = (await btnText()) === '중지';
  const choiceOk = blockedStay && centerNoop && fillPct > 5 && fillPct < 100 && Math.abs(dotLeft - 15) < 2 && toIdle && again;
  console.log(`${choiceOk ? 'PASS' : 'FAIL'} result choice: side under the puck at open is ignored; puck left 2s -> back to the circle, 3s in the circle -> play again (${JSON.stringify({ blockedStay, centerNoop, fill: Math.round(fillPct), dotLeft, toIdle, again })})`);
  if (!choiceOk) failed = true;
  // 중지한 뒤 퍽이 원 안에 그대로 있으면 다시 시작하지 않고, 원 밖으로 뺐다가 넣으면 시작
  await page.click('#btn-start'); // 중지 (퍽은 원 안)
  await page.waitForSelector('#panel-result:not(.hidden)');
  await page.click('[data-close="panel-result"]');
  await page.waitForTimeout(3600);
  const held = await page.evaluate(() => ({ status: window.__puckTrainer.app.calib.status, running: window.__puckTrainer.game.running }));
  await forceU(0.85); await page.waitForTimeout(400);
  await forceU(0.5); await page.waitForTimeout(3700);
  const rearm = (await btnText()) === '중지';
  console.log(`${held.status === 'blocked' && !held.running && rearm ? 'PASS' : 'FAIL'} after the stop button the puck left in the circle does not restart until taken out and put back (${JSON.stringify({ ...held, rearm })})`);
  if (!(held.status === 'blocked' && !held.running && rearm)) failed = true;
  // 시간이 끝난 결과에서 오른쪽에 2초 -> 모드 선택
  await page.evaluate(() => window.__puckTrainer.game.stop('time'));
  await page.waitForSelector('#panel-result:not(.hidden)');
  await forceU(0.85);
  await page.waitForTimeout(4200);
  const toMode = (await page.isVisible('#panel-mode')) && (await page.isHidden('#panel-result')) && (await btnText()) === '시작';
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
  await page.tap('#auth-guest'); // 게스트로 시작 = 바로 카메라 시작
  await page.waitForFunction(() => document.querySelector('#splash').classList.contains('hidden'), null, { timeout: 10000 });
  await skipSetup(page, true);
  await page.waitForTimeout(500);
  const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const controlsVisible = await page.evaluate(() => { const r = document.querySelector('#btn-start').getBoundingClientRect(); return r.bottom <= window.innerHeight && r.width > 0; });
  const rotateHint = await page.isVisible('#rotate-hint');
  console.log(`${noHScroll && controlsVisible && rotateHint ? 'PASS' : 'FAIL'} phone portrait layout (no overflow, controls visible, turn-sideways hint)`);
  if (!(noHScroll && controlsVisible && rotateHint)) failed = true;
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
  await page.click('#auth-guest'); // 게스트로 시작 = 카메라 시작 (실패 -> 진단)
  await page.waitForSelector('#splash-diag:not(.hidden)', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('#diag-info').textContent.length > 0); // 진단 내용은 비동기로 채워짐
  const errText = await page.textContent('#splash-error');
  const diag = await page.textContent('#diag-info');
  const options = await page.$$eval('#diag-camera option', (o) => o.length);
  const diagHidden = await page.$eval('#diag-info', (e) => e.classList.contains('hidden')); // 기술 정보는 화면에 안 보이고 복사로만
  const ok = errText.includes('다른 프로그램') && !errText.includes('NotReadableError') && diagHidden && diag.includes('NotReadableError') && diag.includes('시도 기록') && options >= 2;
  console.log(`${ok ? 'PASS' : 'FAIL'} camera failure shows a plain message, camera list and retry; technical details only in the copy (${options - 1} device(s), ${errText.trim().slice(0, 40)}…)`);
  if (!ok) failed = true;
  // 재시도(4번째 호출부터 성공) -> 앱 시작
  await page.click('#btn-retry-camera');
  await page.waitForFunction(() => document.querySelector('#splash').classList.contains('hidden'), null, { timeout: 10000 });
  console.log('PASS retry after failure starts the camera');
  await context.close();
}

// ---- 4-1) 카메라가 아예 없을 때: '연결된 카메라를 찾지 못했습니다.' 한 줄만, 진단 상자는 숨김 ----
{
  const context = await newCtx({ viewport: { width: 1180, height: 820 }, permissions: ['camera'] });
  await context.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => { const e = new Error('Requested device not found'); e.name = 'NotFoundError'; return Promise.reject(e); };
    navigator.mediaDevices.enumerateDevices = async () => [];
  });
  const page = await context.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => window.__puckTrainer?.account);
  await page.click('#auth-guest');
  await page.waitForSelector('#splash-error:not(.hidden)', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('#diag-info').textContent.length > 0); // 진단(복사용)까지 끝난 뒤
  const errText = (await page.textContent('#splash-error')).trim();
  const boxHidden = await page.$eval('#splash-diag', (e) => e.classList.contains('hidden'));
  const ok = errText === '연결된 카메라를 찾지 못했습니다.' && boxHidden;
  console.log(`${ok ? 'PASS' : 'FAIL'} no camera: one plain line, no diagnostics box (${errText}, box hidden ${boxHidden})`);
  if (!ok) failed = true;
  await context.close();
}

// ---- 4-2) 카메라 없이 체험 (누구나): 손가락이 퍽, 세로 휴대폰은 세로 판, 기록·자랑 없이 '카메라로 하기' 안내 ----
{
  const context = await newCtx({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => window.__puckTrainer?.account);
  await page.waitForSelector('#trial-start:not(.hidden)');
  const note = await page.textContent('#trial-start');
  await page.tap('#btn-mouse');
  await page.waitForSelector('#panel-mode:not(.hidden)');
  const started = await page.evaluate(() => ({ trial: window.__puckTrainer.app.mouseMode, splash: document.querySelector('#splash').classList.contains('hidden') }));
  const card = page.locator('#mode-list .mode-card', { hasText: /아케이드/ }).first();
  await card.tap();
  await page.tap('#btn-start');
  await page.waitForFunction(() => window.__puckTrainer.game.running);
  const vb = await page.locator('#view').boundingBox();
  for (const [x, y] of [[0.3, 0.7], [0.6, 0.8], [0.5, 0.75]]) { await page.touchscreen.tap(vb.x + vb.width * x, vb.y + vb.height * y); await page.waitForTimeout(80); }
  const play = await page.evaluate(() => ({ has: window.__puckTrainer.mouse.has, state: window.__puckTrainer.tracker.state, portrait: document.querySelector('#view').getBoundingClientRect().height > document.querySelector('#view').getBoundingClientRect().width }));
  await page.evaluate(() => window.__puckTrainer.game.stop('time'));
  await page.waitForSelector('#panel-result:not(.hidden)');
  await page.waitForSelector('#btn-trial-camera');
  const res = await page.evaluate(() => ({ rank: document.querySelector('#result-rank').textContent, share: document.querySelector('#result-share').classList.contains('hidden'), guest: document.querySelector('#result-guest').classList.contains('hidden') }));
  const ok = note.includes('기록은 저장되지 않아요') && started.trial && started.splash && play.has && play.state !== 'lost' && play.portrait
    && res.rank.includes('체험 기록은 저장되지 않아요') && res.share && res.guest && errors.length === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'} camera-free trial: anyone can start it, a finger moves the puck on a portrait board, the result offers the camera instead of saving or sharing (${JSON.stringify({ ...started, ...play, ...res, errors })})`);
  if (!ok) failed = true;
  // 카메라로 하기 -> 첫 화면으로 돌아옴 (체험 끝)
  await Promise.all([page.waitForNavigation(), page.tap('#btn-trial-camera')]);
  await page.waitForFunction(() => window.__puckTrainer?.account);
  const back = await page.evaluate(() => !window.__puckTrainer.app.mouseMode && !document.querySelector('#splash').classList.contains('hidden'));
  console.log(`${back ? 'PASS' : 'FAIL'} 'play with camera' after a trial goes back to the start screen`);
  if (!back) failed = true;
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
  // 언어별 주소: 첫 주소(/)는 영어 브라우저에서도 한국어 (검색엔진이 한국어 페이지를 보도록) + 'English version' 안내
  await page.goto(`${base}/index.html`);
  await tick();
  const root = await page.evaluate(() => ({ lang: document.documentElement.lang, cam: document.querySelector('#btn-camera').textContent, hint: !document.querySelector('#lang-hint').classList.contains('hidden'), href: document.querySelector('#lang-hint a').getAttribute('href') }));
  ok(root.lang === 'ko' && root.cam === '카메라 시작' && root.hint && root.href === '/en/', 'the first address stays Korean for an English browser and shows an English version link', JSON.stringify(root));
  await page.goto(`${base}/en/`);
  await tick();
  const first = await page.evaluate(() => ({ lang: document.documentElement.lang, lead: document.querySelector('.lead').textContent, cam: document.querySelector('#btn-camera').textContent, ph: document.querySelector('#auth-code').placeholder, on: document.querySelector('.lang-row [data-lang].active')?.dataset.lang, visible: !!document.querySelector('.lang-row [data-lang="ko"]').offsetParent, title: document.title, hint: !document.querySelector('#lang-hint').classList.contains('hidden') }));
  ok(first.lang === 'en' && /stickhandling/.test(first.lead) && first.cam === 'Start camera' && first.ph === 'e.g. K7MP-Q2XD' && first.on === 'en' && first.visible && /^Puck Dribble Trainer/.test(first.title) && !first.hint, 'the English address /en/ opens in English with language buttons on the first screen', JSON.stringify(first));
  await Promise.all([page.waitForURL((u) => new URL(u).pathname === '/'), page.click('.lang-row [data-lang="ko"]')]); await tick();
  const ko = await page.evaluate(() => ({ path: location.pathname, lang: document.documentElement.lang, lead: document.querySelector('.lead').textContent, cam: document.querySelector('#btn-camera').textContent, tab: document.querySelector('.auth-tabs .tab[data-tab="register"]').textContent, hint: !document.querySelector('#lang-hint').classList.contains('hidden') }));
  ok(ko.lang === 'ko' && /스틱 ?핸들링/.test(ko.lead) && ko.cam === '카메라 시작' && ko.tab === '회원가입' && !ko.hint, '한국어 button goes to the Korean address (no hint once chosen)', JSON.stringify(ko));
  await Promise.all([page.waitForURL((u) => new URL(u).pathname === '/en/'), page.click('.lang-row [data-lang="en"]')]); await tick();
  await page.reload(); await tick();
  ok(await page.evaluate(() => location.pathname === '/en/' && document.documentElement.lang === 'en' && document.querySelector('#btn-camera').textContent === 'Start camera'), 'English address stays English after reload');
  await page.goto(`${base}/index.html?c=ace1-2345`);
  await page.waitForURL((u) => new URL(u).pathname === '/en/'); await tick();
  ok(await page.evaluate(() => document.documentElement.lang === 'en' && window.__puckTrainer.app.invite === 'ACE12345'), 'a remembered English choice opens the English address (invite code kept)');
  await page.waitForFunction(() => window.__puckTrainer?.account);
  await page.evaluate(() => { const a = window.__puckTrainer.account; a._putCode('ACE12345', { type: 'one' }); a._putCode('TEAMBETA', { type: 'beta', maxUses: 0 }); });
  await page.click('.auth-tabs .tab[data-tab="register"]');
  await page.fill('#auth-id', 'aceplayer'); await page.fill('#auth-pin', 'ace12345'); await page.fill('#auth-pin2', 'ace12345'); await page.fill('#auth-nick', 'Ace'); await page.fill('#auth-code', 'ace1-2345');
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
  await page.evaluate(async () => { const a = window.__puckTrainer.account; a.logout(); await a.register({ loginId: 'beeplayer', password: 'bee12345', nick: 'Bee', country: 'CA', team: 'Hive', age: 12, code: 'TEAMBETA' , stick: 'L' }); });
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
  await page.evaluate(async () => { const a = window.__puckTrainer.account; a.logout(); await a.register({ loginId: 'oldplayer', password: 'old12345', nick: 'Old', country: 'US', team: 'Elders', age: 30, code: 'TEAMBETA' , stick: 'L' }); });
  await page.click(`#comm-list .post[data-id="${bragId}"] .post-foot [data-act="mode"]`); await tick(150);
  const oldToast = await page.textContent('#toast');
  const oldRun = await playArcade(2000);
  await page.evaluate(async () => { const a = window.__puckTrainer.account; a.logout(); await a.register({ loginId: 'kidplayer', password: 'kid12345', nick: 'Kid', country: 'KR', team: 'Cubs', age: 10, code: 'TEAMBETA' , stick: 'L' }); });
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

// ---- 6) 검색엔진·AI 검색용 파일: 최신인지, 페이지마다 검색 정보, 안내 페이지가 오류 없이 열리는지 ----
{
  const { checkSite } = await import('./site-check.mjs');
  const r = await checkSite();
  r.logs.forEach((l) => console.log(l));
  if (!r.ok) failed = true;
  const ctx = await newCtx({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const seen = [], broken = [];
  for (const p of ['/guide/', '/games/', '/faq/', '/en/guide/', '/en/games/', '/en/faq/', '/404.html']) {
    const res = await page.goto(`${base}${p}`);
    const info = await page.evaluate(() => ({ h1: document.querySelector('h1')?.textContent || '', links: [...document.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute('href')), font: getComputedStyle(document.body).fontFamily }));
    seen.push(`${p}:${res.status()}:${info.h1.slice(0, 18)}`);
    for (const l of new Set(info.links)) { const r2 = await page.request.get(`${base}${l}`); if (r2.status() !== 200) broken.push(`${p} -> ${l} ${r2.status()}`); }
    if (res.status() !== 200 || !info.h1 || !/Poppins|Noto Sans KR/.test(info.font)) broken.push(`${p} ${res.status()} ${info.h1}`);
  }
  console.log(`${broken.length || errors.length ? 'FAIL' : 'PASS'} guide pages open without errors and every internal link works (${seen.join(' · ')})${broken.length ? ' ' + JSON.stringify(broken) : ''}${errors.length ? ' errors: ' + JSON.stringify(errors) : ''}`);
  if (broken.length || errors.length) failed = true;
  await ctx.close();
}

// ---- 7) 번역 누락 검사: 소스의 모든 한국어 문구가 영어 사전에 있어야 함 ----
{
  const { checkCoverage } = await import('./i18n-coverage.mjs');
  const { total, missing } = await checkCoverage();
  for (const m of missing) console.log(`  MISSING [${m.src}] ${JSON.stringify(m.s)}`);
  console.log(`${missing.length ? 'FAIL' : 'PASS'} i18n coverage: ${total - missing.length}/${total} source strings have an English translation`);
  if (missing.length) failed = true;
}

// ---- 8) 온라인 랭킹 순위 계산 (가짜 Firestore): count 쿼리·순위 색인 칸·읽기 수·복합 색인 없는 쿼리 ----
{
  const { checkRanks } = await import('./rank-firebase.mjs');
  const { ok, logs } = await checkRanks().catch((e) => ({ ok: false, logs: [`FAIL online ranking check threw: ${e.stack || e}`] }));
  for (const l of logs) console.log(l);
  if (!ok) failed = true;
}

// ---- 8b) 운영자 임시 비밀번호 도구 (가짜 Auth·Firestore): 회원 찾기·임시 비밀번호·재설정 순서·DM 문구 ----
{
  const { checkAdminReset } = await import('./admin-reset.mjs');
  const { ok, logs } = await checkAdminReset().catch((e) => ({ ok: false, logs: [`FAIL admin reset check threw: ${e.stack || e}`] }));
  for (const l of logs) console.log(l);
  if (!ok) failed = true;
}
// ---- 8c) 운영자 정리 도구 (가짜 Firestore·Auth): 공개 문서의 나이 칸 지우기·예전 6자리 계정 목록 ----
{
  const { checkAdminCleanup } = await import('./admin-cleanup.mjs');
  const { ok, logs } = await checkAdminCleanup().catch((e) => ({ ok: false, logs: [`FAIL admin cleanup check threw: ${e.stack || e}`] }));
  for (const l of logs) console.log(l);
  if (!ok) failed = true;
}

// ---- 9) 시작 준비 3단계(영역 -> 퍽 등록 -> 네 모서리 움직여 보기)와 난이도별 랭킹 (휴대폰 가로 = TV 미러링 화면) ----
{
  const context = await newCtx({ viewport: { width: 844, height: 390 }, permissions: ['camera'], deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const ok = (cond, name, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!cond) failed = true; };
  const tick = (ms = 80) => page.waitForTimeout(ms);
  // 예전 설정 옮기기: '화면 전체' -> 화면 전체 틀(네 모서리), 투명도는 1 단위 그대로
  await page.goto(`${base}/index.html`);
  await page.evaluate(() => localStorage.setItem('puck-trainer.settings.v1', JSON.stringify({ floorMode: 'full', puckTransparency: 33 })));
  await page.reload();
  await page.waitForFunction(() => window.__puckTrainer?.account);
  const mig = await page.evaluate(() => { const s = window.__puckTrainer.settings; return { mode: s.floorMode, quad: JSON.stringify(s.manualQuad), pt: s.puckTransparency }; });
  ok(mig.mode === 'manual' && mig.quad === JSON.stringify([[0.02, 0.02], [0.98, 0.02], [0.98, 0.98], [0.02, 0.98]]) && mig.pt === 33, 'old full-view setting becomes a full-frame four-corner area; transparency keeps 1% steps', JSON.stringify(mig));
  // 첫 화면: 카메라 시작이 로그인 칸보다 위, 게스트로 시작 = 바로 카메라
  const order = await page.evaluate(() => document.querySelector('#btn-camera').getBoundingClientRect().top < document.querySelector('#auth-card').getBoundingClientRect().top);
  ok(order, 'start camera button sits above the login card');
  await page.tap('#auth-guest');
  await page.waitForFunction(() => document.querySelector('#splash').classList.contains('hidden'), null, { timeout: 10000 });
  await page.waitForSelector('#area-step:not(.hidden)', { timeout: 8000 });
  // 등록된 퍽이 있으면 2/3 에서 '등록된 퍽 쓰기'가 보이고, 화면을 터치해도 준비가 취소되지 않는다
  await page.evaluate(() => { window.__puckTrainer.settings.puckModel = { r: 20, g: 24, b: 39, area: 60 }; });
  await page.tap('#area-done');
  await page.waitForSelector('#setup-bar:not(.hidden)');
  const skipShown = await page.isVisible('#setup-skip');
  const vb = await (await page.$('#view')).boundingBox();
  await page.mouse.click(vb.x + vb.width * 0.3, vb.y + vb.height * 0.6); await tick(150);
  const stillPuck = await page.evaluate(() => window.__puckTrainer.app.setup === 'puck' && window.__puckTrainer.app.calib.manual);
  ok(skipShown && stillPuck, 'puck step: "use registered puck" shown, tapping the screen does not cancel setup');
  // 2/3 '영역 다시' -> 1/3, 다시 완료 -> 2/3, '등록된 퍽 쓰기' -> 3/3 움직여 보기
  await page.tap('#setup-back'); await page.waitForSelector('#area-step:not(.hidden)');
  const backArea = await page.evaluate(() => window.__puckTrainer.app.setup === 'area' && window.__puckTrainer.app.areaEditing && !window.__puckTrainer.app.calib.manual);
  await page.tap('#area-done'); await page.waitForSelector('#setup-bar:not(.hidden)');
  await page.tap('#setup-skip'); await page.waitForSelector('#test-bar:not(.hidden)');
  const t0 = await page.evaluate(() => ({ count: document.querySelector('#test-count').textContent, cls: document.querySelector('#app').classList.contains('setting-up'), hud: getComputedStyle(document.querySelector('#hud')).display, mode: !document.querySelector('#panel-mode').classList.contains('hidden') }));
  ok(backArea && t0.count === '0 / 4' && t0.cls && t0.hud === 'none' && !t0.mode, 'setup steps go back and forth; registered puck leads to the 3/3 test step (0 / 4, HUD hidden, no mode window yet)', JSON.stringify(t0));
  // '퍽 다시' -> 2/3 퍽 등록, Esc -> 3/3 다시
  await page.tap('#test-repuck'); await page.waitForSelector('#setup-bar:not(.hidden)');
  const repuck = await page.evaluate(() => window.__puckTrainer.app.setup === 'puck' && window.__puckTrainer.app.calib.manual);
  await page.keyboard.press('Escape'); await page.waitForSelector('#test-bar:not(.hidden)');
  ok(repuck, '"redo puck" in the test step goes back to puck registration');
  // 퍽 추적 끊김 -> 안내, 네 모서리 표적을 차례로 -> 4 / 4 -> 모드 창
  await tick(1600);
  const lostHint = await page.textContent('#test-hint');
  const forceUV = (u, v) => page.evaluate(([uu, vv]) => { const t = window.__puckTrainer.tracker; const orig = Object.getPrototypeOf(t).update; t.update = function (meas, now) { return orig.call(this, { u: uu, v: vv }, now); }; }, [u, v]);
  const counts = [];
  for (const [u, v] of [[0.5, 0.5], [0.14, 0.16], [0.86, 0.14], [0.85, 0.86], [0.16, 0.85]]) { await forceUV(u, v); await tick(350); counts.push(await page.textContent('#test-count')); }
  await page.waitForSelector('#panel-mode:not(.hidden)', { timeout: 3000 });
  const done = await page.evaluate(() => ({ setup: window.__puckTrainer.app.setup, cls: document.querySelector('#app').classList.contains('setting-up'), bar: document.querySelector('#test-bar').classList.contains('hidden') }));
  ok(/퍽이 안 보여요/.test(lostHint) && counts.join(',') === '0 / 4,1 / 4,2 / 4,3 / 4,4 / 4' && done.setup === null && !done.cls && done.bar, 'test step: lost-puck hint, four corner targets count up, then the mode window opens', JSON.stringify({ lostHint, counts, done }));
  // 시작 준비 직후 모드 창: 마지막 표적(왼쪽 앞) 자리 = 아케이드 카드 위. 가운데 칸(puck)에 한 번 두기 전에는 퍽으로 고르지 않는다
  // (카드를 벗어났다 돌아와 2초 넘게 있어도 아케이드가 골라져 시작되지 않음). 가운데 칸에 오면 그때부터 고를 수 있다
  const need0 = await page.evaluate(() => ({ need: document.querySelector('#mode-list .mode-wait').classList.contains('need'), flag: window.__puckTrainer.app.modeNeedCenter }));
  await forceUV(0.3, 0.85); await tick(400); await forceUV(0.16, 0.85); await tick(2600);
  const stay = await page.evaluate(() => ({ open: !document.querySelector('#panel-mode').classList.contains('hidden'), running: window.__puckTrainer.game.running, hold: window.__puckTrainer.app.modePick?.hold || 0 }));
  await forceUV(0.5, 0.5); await tick(300);
  const armed = await page.evaluate(() => ({ flag: window.__puckTrainer.app.modeNeedCenter, need: document.querySelector('#mode-list .mode-wait').classList.contains('need') }));
  ok(need0.need && need0.flag && stay.open && !stay.running && stay.hold === 0 && !armed.flag && !armed.need, 'after setup the mode window waits: the puck picks no card until it visits the middle (puck) square', JSON.stringify({ need0, stay, armed }));
  // 난이도: 모드 창 제목 줄에서 고르면 HUD·결과·랭킹 키가 난이도별로 나뉜다 (아케이드·퍽 피하기만)
  await page.tap('#level-seg [data-level="hard"]');
  const lv = await page.evaluate(() => ({ set: window.__puckTrainer.settings.difficulty, game: window.__puckTrainer.game.difficulty, active: document.querySelector('#level-seg .active')?.dataset.level, saved: JSON.parse(localStorage.getItem('puck-trainer.settings.v1')).difficulty }));
  await page.tap('#mode-list .mode-card:nth-child(1)'); await page.waitForSelector('#panel-mode', { state: 'hidden' });
  const hudMode = await page.textContent('#hud-mode');
  await page.evaluate(() => { window.__puckTrainer.settings.autoStart = false; });
  await page.tap('#btn-start'); await tick(300);
  await page.evaluate(() => window.__puckTrainer.game.stop('time'));
  await page.waitForSelector('#panel-result:not(.hidden)');
  const res = await page.evaluate(() => ({ key: window.__puckTrainer.app.lastResult.rankKey, level: window.__puckTrainer.app.lastResult.level, title: document.querySelector('#result-title').textContent, best: /New best/.test(document.querySelector('#result-body').textContent) }));
  ok(lv.set === 'hard' && lv.game === 'hard' && lv.active === 'hard' && lv.saved === 'hard' && /어려움/.test(hudMode) && res.key === 'arcade@60-hard' && res.level === 'hard' && /어려움/.test(res.title) && !res.best,
    'difficulty picked in the mode window: saved, shown in HUD and result, ranked separately (arcade@60-hard); a 0 score is not a new best', JSON.stringify({ lv, hudMode, res }));
  await page.tap('[data-close="panel-result"]');
  await page.tap('#btn-rank'); await page.waitForSelector('#panel-rank:not(.hidden)');
  const rk1 = await page.evaluate(() => ({ shown: !document.querySelector('#rank-level').classList.contains('hidden'), value: document.querySelector('#rank-level').value }));
  await page.selectOption('#rank-mode', 'figure8'); await tick(150);
  const rk2 = await page.evaluate(() => !document.querySelector('#rank-level').classList.contains('hidden'));
  ok(rk1.shown && rk1.value === 'hard' && !rk2, 'ranking filter has a difficulty choice for arcade/dodge only', JSON.stringify({ rk1, rk2 }));
  await page.tap('[data-close="panel-rank"]');
  // 설정: 게임 영역·난이도 칸은 없고, 인식 세부 조정은 접혀 있다. 기록 초기화는 확인을 묻는다 (취소하면 그대로)
  await page.tap('#btn-settings'); await page.waitForSelector('#panel-settings:not(.hidden)');
  const st = await page.evaluate(() => ({ floor: !!document.querySelector('#set-floorMode'), diff: !!document.querySelector('#set-difficulty'), adv: document.querySelector('.settings-adv') && !document.querySelector('.settings-adv').open }));
  let asked = '';
  page.once('dialog', (d) => { asked = d.message(); d.dismiss(); });
  await page.evaluate(() => localStorage.setItem('puck-trainer.scores.v1', JSON.stringify({ 'arcade@60': 5 })));
  await page.evaluate(() => document.querySelector('#btn-reset-scores').click()); await tick(150);
  const kept = await page.evaluate(() => localStorage.getItem('puck-trainer.scores.v1'));
  ok(!st.floor && !st.diff && st.adv && /최고 기록/.test(asked) && /arcade@60/.test(kept || ''), 'settings: no area/difficulty fields, detection tuning folded, clearing scores asks first', JSON.stringify({ st, asked, kept }));
  await page.tap('[data-close="panel-settings"]');
  // 휴대폰 가로(TV 미러링) 보정 창: 버튼이 창 밖으로 나가지 않는다
  await page.tap('#btn-calib'); await page.waitForSelector('#panel-calib:not(.hidden)');
  const calibFit = await page.evaluate(() => { const c = document.querySelector('#panel-calib .modal-card').getBoundingClientRect(); return [...document.querySelectorAll('#panel-calib .calib-item .btn')].every((b) => { const r = b.getBoundingClientRect(); return r.left >= c.left - 1 && r.right <= c.right + 1 && r.width > 40; }); });
  ok(calibFit, 'calibration panel buttons stay inside the card on a phone in landscape');
  await page.tap('[data-close="panel-calib"]');
  ok(errors.length === 0, 'setup/difficulty: no console errors', errors.join(' | '));
  await context.close();
}

await browser.close();
server.close();
console.log(failed ? '\nSOME TESTS FAILED' : '\nALL TESTS PASSED');
process.exit(failed ? 1 : 0);
