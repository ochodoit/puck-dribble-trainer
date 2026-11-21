// 휴대폰 카메라 연결 E2E: 같은 브라우저 안의 두 탭(노트북 = 로그인한 회원 화면, 휴대폰 = /cam/)을 localSignal 로 잇는다.
// 사용: node test/remote-cam.mjs   (Firebase 없이 localSignal 로 돌므로 실제 데이터에 쓰지 않는다)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const SHOT = process.argv[2]; // 화면 사진 파일 앞부분 (선택)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path.endsWith('/') ? path + 'index.html' : path);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try { const data = await readFile(file); res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1280, height: 800 } });
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
await ctx.route(/\/src\/firebase-config\.js(\?|$)/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'export const firebaseConfig = null;\n' }));
await ctx.route(/gstatic\.com\/firebasejs|googletagmanager|google-analytics/, (r) => r.abort());

let failed = false;
const check = (ok, name, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ' + detail : ''}`); if (!ok) failed = true; };
const errors = [];

const host = await ctx.newPage();
host.on('pageerror', (e) => errors.push('host: ' + e.message));
host.on('console', (m) => { if (m.type() === 'error') errors.push('host console: ' + m.text()); });
await host.goto(`${base}/index.html`);
await host.waitForFunction(() => window.__puckTrainer?.account);

// 게스트에게도 버튼과 같은 Wi-Fi 안내가 보이고, 누르면 창 대신 로그인 안내 (연결 문서는 로그인한 회원만 쓴다). 마우스 모드는 운영자만
await host.waitForSelector('#remote-start:not(.hidden)', { timeout: 8000 });
const guest = await host.evaluate(() => ({ wifi: document.querySelector('#remote-start').textContent.includes('같은 Wi-Fi'), mouse: document.querySelector('#btn-mouse').classList.contains('hidden') }));
await host.click('#btn-remote');
await host.waitForTimeout(300);
const guestPanel = await host.isVisible('#panel-remote');
check(guest.wifi && guest.mouse && !guestPanel, 'guests see the phone-camera button with the same-Wi-Fi note; clicking asks to log in (no panel); mouse mode stays operator-only', JSON.stringify({ ...guest, guestPanel }));

// 일반 회원 가입 (운영자 아님) 후 새로고침 -> 바로 연결 창
await host.evaluate(async () => { const a = window.__puckTrainer.account; a._putCode('BETA2026', { type: 'beta', maxUses: 0, expiresAt: Date.now() + 7 * 864e5 }); await a.register({ loginId: 'camplayer', password: 'cam12345', nick: 'CamPlayer', country: 'KR', team: 'Cam', age: 12, code: 'BETA2026', stick: 'L' }); });
await host.reload();
await host.waitForFunction(() => window.__puckTrainer?.account?.current());
await host.waitForSelector('#btn-remote:not(.hidden)', { timeout: 8000 });
check(await host.isHidden('#btn-mouse'), 'a regular member gets the phone camera, not the operator mouse mode');

await host.click('#btn-remote');
await host.waitForSelector('#panel-remote:not(.hidden)');
await host.waitForFunction(() => /^[A-HJ-NP-Z2-9]{6}$/.test(document.querySelector('#remote-code').textContent), null, { timeout: 8000 });
await host.waitForFunction(() => document.querySelector('#remote-status').textContent.includes('QR'), null, { timeout: 8000 });
const code = await host.textContent('#remote-code');
console.log('INFO offer size (bytes):', await host.evaluate((c) => JSON.parse(localStorage.getItem('rtc:' + c)).offer.length, code));
const panel = await host.evaluate(() => {
  const cv = document.querySelector('#remote-qr');
  const g = cv.getContext('2d'); const d = g.getImageData(0, 0, cv.width, cv.height).data;
  let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 50) dark++;
  return { url: document.querySelector('#remote-url').textContent, status: document.querySelector('#remote-status').textContent, w: cv.width, darkShare: dark / (d.length / 4) };
});
check(panel.url.endsWith('/cam/') && panel.darkShare > 0.2 && panel.darkShare < 0.6, 'QR panel: code, address, QR drawn', JSON.stringify({ code, ...panel }));
if (SHOT) await host.screenshot({ path: `${SHOT}-host-qr.png` });

// 휴대폰 탭: QR 주소(#코드)로 열고 '카메라 켜고 연결'
const phone = await ctx.newPage();
await phone.setViewportSize({ width: 390, height: 844 });
phone.on('pageerror', (e) => errors.push('phone: ' + e.message));
phone.on('console', (m) => { if (m.type() === 'error') errors.push('phone console: ' + m.text()); });
await phone.goto(`${base}/cam/#${code}`);
const prefilled = await phone.inputValue('#code');
check(prefilled === code, 'phone page prefilled code from QR link', prefilled);
if (SHOT) await phone.screenshot({ path: `${SHOT}-phone-start.png` });
const t0 = Date.now();
await phone.click('#btn-go');

// 노트북: 영상을 받으면 QR 창이 닫히고 1/3 영역 설정이 시작된다
await host.waitForSelector('#area-step:not(.hidden)', { timeout: 20000 });
const connectMs = Date.now() - t0;
const hostState = await host.evaluate(() => { const t = window.__puckTrainer; const v = document.querySelector('video'); return { started: t.app.started, remote: t.app.remoteMode, vw: v.videoWidth, vh: v.videoHeight, panelHidden: document.querySelector('#panel-remote').classList.contains('hidden'), mirror: t.vision.mirror, src: t.vision.srcW + 'x' + t.vision.srcH }; });
check(hostState.started && hostState.remote && hostState.vw > 0 && hostState.panelHidden && hostState.mirror, 'host receives phone video and starts setup', JSON.stringify({ connectMs, ...hostState }));
await phone.waitForFunction(() => document.querySelector('#dot').classList.contains('on'), null, { timeout: 8000 });
const phoneStatus = await phone.textContent('#status');
check(phoneStatus.includes('연결됨'), 'phone shows connected', phoneStatus);
if (SHOT) await phone.screenshot({ path: `${SHOT}-phone-live.png` });

// 영상 프레임이 실제로 흐르는가 (인식 루프가 처리한 프레임 수)
const f1 = await host.evaluate(() => document.querySelector('video').currentTime);
await host.waitForTimeout(1500);
const f2 = await host.evaluate(() => document.querySelector('video').currentTime);
check(f2 > f1, 'video frames keep flowing', `${f1.toFixed(2)} -> ${f2.toFixed(2)}`);

const dims = [];
for (let i = 0; i < 8; i++) { dims.push(await host.evaluate(() => { const v = document.querySelector('video'); return v.videoWidth + 'x' + v.videoHeight; })); await host.waitForTimeout(1000); }
console.log('INFO resolution over 8s:', dims.join(' '));
// 영역 설정 끝내고 지연 표시 확인
await host.click('#area-done').catch(() => {});
await host.waitForFunction(() => { const b = document.querySelector('#remote-badge'); return !b.classList.contains('hidden') && /ms/.test(b.textContent); }, null, { timeout: 10000 });
const badge = await host.evaluate(() => ({ text: document.querySelector('#remote-badge').textContent, title: document.querySelector('#remote-badge').title }));
check(/^📱 \d+ms/.test(badge.text), 'latency badge shows estimate', JSON.stringify(badge));
if (SHOT) await host.screenshot({ path: `${SHOT}-host-live.png` });

// 노트북의 카메라 전환 버튼 -> 휴대폰이 카메라를 바꾼다 (가짜 카메라는 하나라 같은 장치로 다시 열림)
const before = await phone.evaluate(() => document.querySelector('#preview').srcObject?.id);
await host.evaluate(() => document.querySelector('#btn-flip').click());
await phone.waitForFunction((id) => document.querySelector('#preview').srcObject?.id !== id, before, { timeout: 8000 });
check(true, 'host flip button switches the phone camera');

// 끊김 -> 자동 재연결: 휴대폰 탭을 닫았다가 같은 주소로 다시 연다
await phone.close();
await host.waitForFunction(() => document.querySelector('#toast').textContent.includes('휴대폰 연결이 끊겼습니다'), null, { timeout: 25000 });
check(true, 'host notices the phone left');
const phone2 = await ctx.newPage();
phone2.on('pageerror', (e) => errors.push('phone2: ' + e.message));
await phone2.goto(`${base}/cam/#${code}`);
await phone2.click('#btn-go');
await host.waitForFunction(() => document.querySelector('#toast').textContent.includes('다시 연결'), null, { timeout: 20000 });
await phone2.waitForFunction(() => document.querySelector('#dot').classList.contains('on'), null, { timeout: 8000 });
check(true, 'phone reconnects with the same code');

// 다른 휴대폰이 같은 코드로 들어오면: 이미 연결됨
const phone3 = await ctx.newPage();
await phone3.goto(`${base}/cam/#${code}`);
await phone3.click('#btn-go');
await phone3.waitForFunction(() => document.querySelector('#status').textContent.includes('다른 휴대폰'), null, { timeout: 8000 });
check(true, 'second phone is told another phone is connected');
// 없는 코드
const phone4 = await ctx.newPage();
await phone4.goto(`${base}/cam/#ZZZZZZ`);
await phone4.click('#btn-go');
await phone4.waitForFunction(() => document.querySelector('#status').textContent.includes('찾지 못했습니다'), null, { timeout: 8000 });
check(true, 'unknown code is reported');

check(errors.length === 0, 'no page errors', errors.join(' | '));
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
