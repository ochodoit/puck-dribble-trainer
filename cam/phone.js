// 휴대폰 카메라 페이지: 코드(주소의 #코드 또는 직접 입력)로 노트북·아이패드와 연결해 카메라 영상만 보낸다.
import { RemotePhone, firestoreSignal, localSignal, normCode, CODE_RE, RTC_CONFIG } from '../src/remote-cam.js';
import { firebaseConfig } from '../src/firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1';
const $ = (s) => document.querySelector(s);
const els = {
  preview: $('#preview'), start: $('#start'), code: $('#code'), go: $('#btn-go'), err: $('#start-error'),
  bar: $('#bar'), dot: $('#dot'), status: $('#status'), chip: $('#code-chip'),
  tools: $('#tools'), flip: $('#btn-flip'), grid: $('#btn-grid'), gridBox: $('#grid'), dimBtn: $('#btn-dim'), dim: $('#dim'),
};

const STATUS = {
  camera: ['카메라 켜는 중…', ''],
  waiting: ['노트북·아이패드를 기다리는 중… (노트북에서 QR 창을 열어 두세요)', 'warn'],
  connecting: ['연결하는 중…', 'warn'],
  connected: ['연결됨 · 이제 노트북·아이패드 화면을 보며 플레이하세요', 'on'],
  lost: ['연결이 끊겼습니다. 노트북·아이패드와 같은 Wi-Fi인지 확인하세요 (다시 준비되면 자동으로 이어집니다)', 'bad'],
  nocode: ['코드를 찾지 못했습니다. 노트북 화면의 코드를 다시 확인하세요', 'bad'],
  expired: ['코드 시간이 지났습니다. 노트북에서 QR 창을 다시 여세요', 'bad'],
  busy: ['다른 휴대폰이 이미 연결되어 있습니다', 'bad'],
  error: ['연결 오류', 'bad'],
};

let phone = null;
let wakeLock = null;

// 주소의 #코드 (QR) 를 칸에 채워 둔다
const fromHash = normCode(decodeURIComponent(location.hash.slice(1)));
if (CODE_RE.test(fromHash)) els.code.value = fromHash;
els.code.addEventListener('input', () => { els.code.value = normCode(els.code.value).slice(0, 6); els.err.classList.add('hidden'); });
els.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
els.go.addEventListener('click', go);

async function go() {
  const code = normCode(els.code.value);
  if (!CODE_RE.test(code)) return showError('코드 6자리를 확인하세요 (영문 대문자와 숫자 2~9)');
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return showError('이 브라우저는 카메라 연결을 지원하지 않습니다. Safari(아이폰) 또는 Chrome(안드로이드)으로 여세요.');
  if (!window.isSecureContext) return showError('카메라는 https 주소에서만 쓸 수 있습니다.');
  els.go.disabled = true;
  els.go.textContent = '카메라 켜는 중…';
  try {
    const signal = await makeSignal(code);
    phone = new RemotePhone(signal, { rtcConfig: firebaseConfig ? RTC_CONFIG : { iceServers: [] }, onState, onCommand });
    const stream = await phone.startCamera('environment');
    els.preview.srcObject = stream;
    try { await els.preview.play(); } catch { /* muted + playsinline 이면 보통 통과 */ }
    history.replaceState(null, '', `#${code}`);
    els.start.classList.add('hidden');
    els.bar.classList.remove('hidden');
    els.tools.classList.remove('hidden');
    $('#rotate').classList.remove('hidden');
    document.body.classList.add('live');
    els.chip.textContent = code;
    onState('waiting');
    phone.listen();
    keepAwake();
  } catch (err) {
    console.error(err);
    phone?.close(); phone = null;
    els.go.disabled = false;
    els.go.textContent = '카메라 켜고 연결';
    const n = err?.name || '';
    showError(n === 'NotAllowedError' || n === 'SecurityError'
      ? '카메라 권한이 거부되었습니다. 주소창의 aA(또는 자물쇠) > 웹 사이트 설정 > 카메라 "허용" 후 다시 누르세요.'
      : `시작하지 못했습니다 (${n || 'Error'}${err?.message ? ': ' + err.message : ''})`);
  }
}

/** Firebase 를 연결했으면 Firestore, 아니면(개발·자동 테스트) 같은 브라우저 안의 탭끼리 */
async function makeSignal(code) {
  if (!firebaseConfig) return localSignal(code);
  const [{ initializeApp }, F] = await Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-firestore.js`)]);
  const app = initializeApp(firebaseConfig, 'cam');
  return firestoreSignal(F, F.getFirestore(app), code);
}

function onState(s, err) {
  const [text, tone] = STATUS[s] || [s, ''];
  let msg = text;
  if (s === 'error' && err) msg = /permission/i.test(String(err.code || err.message)) ? '연결 권한이 없습니다. 코드가 맞는지, 노트북의 QR 창이 열려 있는지 확인하세요' : `${text}: ${err.message || err}`;
  els.status.textContent = msg;
  els.dot.className = `dot ${tone}`;
  document.title = s === 'connected' ? '● 연결됨 · 휴대폰 카메라' : '휴대폰 카메라 · 퍽 드리블 트레이너';
}

/** 노트북에서 온 명령 */
function onCommand(m) {
  if (m.t === 'flip') flip();
}

async function flip() {
  if (!phone) return;
  els.flip.disabled = true;
  try {
    const stream = await phone.startCamera(phone.facing === 'user' ? 'environment' : 'user');
    els.preview.srcObject = stream;
    els.preview.classList.toggle('mirror', phone.facing === 'user');
  } catch (err) {
    els.status.textContent = `카메라를 바꾸지 못했습니다 (${err?.name || 'Error'})`;
  } finally { els.flip.disabled = false; }
}
els.flip.addEventListener('click', flip);
els.grid.addEventListener('click', () => els.gridBox.classList.toggle('hidden'));
els.dimBtn.addEventListener('click', () => els.dim.classList.remove('hidden'));
els.dim.addEventListener('click', () => els.dim.classList.add('hidden'));

/** 화면 꺼짐 방지: 휴대폰 화면이 꺼지면 카메라도 멈춘다 */
async function keepAwake() {
  try {
    if (!('wakeLock' in navigator) || (wakeLock && !wakeLock.released)) return;
    wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* 저전력 모드 등 */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && phone) keepAwake();
});

function showError(text) {
  els.err.textContent = text;
  els.err.classList.remove('hidden');
}
