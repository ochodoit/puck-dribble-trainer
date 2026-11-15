// 앱 오케스트레이션: 카메라 -> 영상처리 -> 추적 -> 게임 -> 렌더/HUD
import { Camera, describeCameraError } from './camera.js';
import { Vision, AutoCalibrator } from './vision.js';
import { Tracker } from './tracker.js';
import { Game, MODES } from './game.js';
import { Renderer } from './render.js';
import { Sfx } from './audio.js';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, loadScores, saveBest, clearScores } from './storage.js';
import { isLocked, tryUnlock } from './access.js';
import { createAccountStore, COUNTRIES, AGE_GROUPS, countryLabel } from './account.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const els = {
  view: $('#view'), video: $('#video'), overlay: $('#overlay'), debug: $('#debug'),
  handles: $('#floor-handles'), tapHint: $('#tap-hint'),
  hudMode: $('#hud-mode'), hudInstruction: $('#hud-instruction'), hudTimer: $('#hud-timer'), hudScore: $('#hud-score'), hudLives: $('#hud-lives'), hudCombo: $('#hud-combo'),
  chipFloor: $('#chip-floor'), chipPuck: $('#chip-puck'), chipStick: $('#chip-stick'), chipFps: $('#chip-fps'),
  btnMode: $('#btn-mode'), btnFloorLock: $('#btn-floor-lock'), btnFlip: $('#btn-flip'), btnRank: $('#btn-rank'),
  authCard: $('#auth-card'), authForm: $('#auth-form'), authLogged: $('#auth-logged'), authWho: $('#auth-who'), authError: $('#auth-error'), authSubmit: $('#auth-submit'), authNote: $('#auth-store-note'),
  panelRank: $('#panel-rank'), rankMode: $('#rank-mode'), rankAge: $('#rank-age'), rankScope: $('#rank-scope'), rankBody: $('#rank-body'), rankMe: $('#rank-me'), resultRank: $('#result-rank'), btnCalib: $('#btn-calib'), btnSettings: $('#btn-settings'), btnStart: $('#btn-start'),
  splash: $('#splash'), btnCamera: $('#btn-camera'), splashError: $('#splash-error'),
  panelMode: $('#panel-mode'), modeList: $('#mode-list'), versusToggle: $('#versus-toggle'), versusNames: $('#versus-names'), p1: $('#p1-name'), p2: $('#p2-name'),
  panelSettings: $('#panel-settings'), selCamera: $('#sel-camera'),
  panelCalib: $('#panel-calib'), swatchPuck: $('#swatch-puck'), swatchStick: $('#swatch-stick'), calibPuckDesc: $('#calib-puck-desc'), calibStickDesc: $('#calib-stick-desc'),
  panelResult: $('#panel-result'), resultTitle: $('#result-title'), resultBody: $('#result-body'), btnAgain: $('#btn-result-again'), btnNext: $('#btn-result-next'),
  toast: $('#toast'),
};

const settings = loadSettings();
const camera = new Camera(els.video);
const vision = new Vision(settings.procWidth);
const tracker = new Tracker();
const sfx = new Sfx();
const game = new Game(sfx);
const renderer = new Renderer(els.overlay);

const app = {
  started: false,
  lastResult: null,
  calibTarget: null,      // 'puck' | 'stick' | null
  versus: null,           // { names:[a,b], scores:[], current:0 }
  fps: 0, frames: 0, fpsAt: 0,
  lastVideoTime: -1,
  hudAt: 0,
  account: null,      // 계정 저장소 (local | firebase)
  authTab: 'login',
  calib: { active: false, target: null, hold: 0, status: 'none', sample: null, circle: null }, // 자동 물체 지정
};
const autoCal = new AutoCalibrator(3);

// 디버그/테스트용 훅 (브라우저 콘솔에서 상태 확인: __puckTrainer.tracker 등)
window.__puckTrainer = { settings, vision, tracker, game, app };

// =============== 초기화 ===============
init();

function init() {
  applySettingsToUI();
  bindUI();
  setupAccessGate();
  setupAuth();
  game.difficulty = settings.difficulty;
  renderModeList();
  updateHud(true);
  if (!Camera.isSupported()) {
    showSplashError('이 브라우저는 카메라(getUserMedia)를 지원하지 않습니다. Safari 또는 Chrome을 사용하세요.');
    els.btnCamera.disabled = true;
  } else if (!window.isSecureContext) {
    showSplashError('카메라는 HTTPS 주소에서만 동작합니다. https:// 로 열어주세요.');
  }
}

// =============== 계정 / 랭킹 ===============
async function setupAuth() {
  const sel = $('#auth-country');
  COUNTRIES.forEach(([code, label]) => { const o = document.createElement('option'); o.value = code; o.textContent = label; sel.appendChild(o); });
  sel.value = 'KR';
  els.authCard.classList.remove('hidden');
  els.authNote.textContent = '계정 불러오는 중…';
  $$('.auth-tabs .tab').forEach((t) => t.addEventListener('click', () => setAuthTab(t.dataset.tab)));
  els.authForm.addEventListener('submit', onAuthSubmit);
  $('#auth-guest').addEventListener('click', () => { els.authForm.classList.add('hidden'); els.authNote.textContent = '게스트: 기록이 랭킹에 올라가지 않습니다.'; });
  $('#btn-logout').addEventListener('click', doLogout);
  $('#btn-settings-logout').addEventListener('click', doLogout);
  els.btnRank.addEventListener('click', () => openRank());
  [els.rankMode, els.rankAge, els.rankScope].forEach((e) => e.addEventListener('change', () => renderRank()));
  MODES.filter((m) => m.id !== 'free').forEach((m) => { const o = document.createElement('option'); o.value = m.id; o.textContent = `${m.icon} ${m.name}`; els.rankMode.appendChild(o); });
  AGE_GROUPS.forEach((g) => { const o = document.createElement('option'); o.value = g; o.textContent = g; els.rankAge.appendChild(o); });

  app.account = await createAccountStore();
  window.__puckTrainer.account = app.account;
  els.authNote.textContent = app.account.kind === 'firebase'
    ? '온라인 랭킹: 모든 기기의 기록이 함께 집계됩니다.'
    : '이 기기 안에서 등록·랭킹이 저장됩니다 (여러 선수가 같은 기기로 경쟁 가능). 온라인 공유 랭킹은 README의 Firebase 설정 참고.';
  refreshAuthUI();
}

function setAuthTab(tab) {
  app.authTab = tab;
  $$('.auth-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  $$('.reg-only').forEach((e) => e.classList.toggle('hidden', tab !== 'register'));
  els.authSubmit.textContent = tab === 'register' ? '가입하고 시작' : '로그인';
  els.authError.classList.add('hidden');
}

async function onAuthSubmit(e) {
  e.preventDefault();
  if (!app.account) return;
  const nick = $('#auth-nick').value, pin = $('#auth-pin').value;
  els.authSubmit.disabled = true;
  try {
    if (app.authTab === 'register') {
      await app.account.register({ nick, pin, country: $('#auth-country').value, team: $('#auth-team').value, age: $('#auth-age').value });
      toast(`환영합니다, ${app.account.current().nick}!`);
    } else {
      await app.account.login(nick, pin);
    }
    $('#auth-pin').value = '';
    els.authError.classList.add('hidden');
    refreshAuthUI();
  } catch (err) {
    els.authError.textContent = err.message || String(err);
    els.authError.classList.remove('hidden');
  } finally { els.authSubmit.disabled = false; }
}

function doLogout() {
  app.account?.logout();
  refreshAuthUI();
  toast('로그아웃했습니다');
}

function refreshAuthUI() {
  const u = app.account?.current();
  els.authLogged.classList.toggle('hidden', !u);
  els.authForm.classList.toggle('hidden', !!u);
  if (u) els.authWho.innerHTML = `<b>${esc(u.nick)}</b> · ${esc(u.team)} · ${esc(countryLabel(u.country))} · ${esc(u.ageGroup)} (${u.age}세)`;
  $('#settings-account').textContent = u ? `로그인: ${u.nick} (${u.team}, ${u.ageGroup})` : '로그인하지 않음 (랭킹 미등록)';
  $('#btn-settings-logout').classList.toggle('hidden', !u);
  if (!u) { setAuthTab(app.authTab); els.authForm.classList.remove('hidden'); }
}

function rankFilters() {
  const u = app.account?.current();
  const f = {};
  if (els.rankAge.value) f.ageGroup = els.rankAge.value;
  if (els.rankScope.value === 'country' && u) f.country = u.country;
  if (els.rankScope.value === 'team' && u) f.team = u.team;
  return f;
}

async function openRank(modeId) {
  if (modeId) els.rankMode.value = modeId;
  else if (game.mode.id !== 'free') els.rankMode.value = game.mode.id;
  open(els.panelRank);
  await renderRank();
}

async function renderRank() {
  if (!app.account) return;
  const mode = els.rankMode.value;
  const u = app.account.current();
  els.rankBody.innerHTML = '<tr><td colspan="6" class="muted">불러오는 중…</td></tr>';
  try {
    const rows = await app.account.leaderboard(mode, rankFilters(), 100);
    els.rankBody.innerHTML = rows.length ? rows.map((r) => `<tr class="${u && r.uid === u.id ? 'me' : ''} ${r.rank <= 3 ? 'top' + r.rank : ''}">
      <td>${r.rank}</td><td>${esc(r.nick)}</td><td>${esc(r.team)}</td><td>${esc(countryLabel(r.country))}</td><td>${esc(r.ageGroup)}</td><td>${r.score}</td></tr>`).join('')
      : '<tr><td colspan="6" class="muted">아직 기록이 없습니다. 게임을 끝까지 플레이하면 등록됩니다.</td></tr>';
    const me = u ? await app.account.myRank(mode, rankFilters()) : null;
    els.rankMe.textContent = u ? (me ? `내 순위: ${me.rank}위 / ${me.total}명 (최고 ${me.score}점)` : '이 조건에 내 기록이 없습니다') : '로그인하면 내 순위가 표시됩니다';
  } catch (err) {
    els.rankBody.innerHTML = `<tr><td colspan="6" class="error">랭킹을 불러오지 못했습니다: ${esc(err.message || err)}</td></tr>`;
  }
}

/** 게임 종료 시 기록 등록 + 결과 패널에 순위 표시 */
async function submitResult(result) {
  els.resultRank.classList.add('hidden');
  const u = app.account?.current();
  if (!u || result.mode.id === 'free' || result.reason === 'manual' || app.versus) return;
  try {
    const { best, improved } = await app.account.submitScore(result.mode.id, result.score);
    const all = await app.account.myRank(result.mode.id, {});
    const age = await app.account.myRank(result.mode.id, { ageGroup: u.ageGroup });
    const parts = [];
    if (all) parts.push(`전체 ${all.rank}위/${all.total}명`);
    if (age) parts.push(`${u.ageGroup} ${age.rank}위/${age.total}명`);
    els.resultRank.innerHTML = `${improved ? '🏆 개인 최고 기록 갱신!' : `개인 최고 ${best}점`} · ${parts.join(' · ')} <button type="button" class="btn btn-ghost" id="btn-result-rank">랭킹 보기</button>`;
    els.resultRank.classList.remove('hidden');
    $('#btn-result-rank').addEventListener('click', () => { close(els.panelResult); openRank(result.mode.id); });
  } catch (err) {
    els.resultRank.textContent = `기록 등록 실패: ${err.message || err}`;
    els.resultRank.classList.remove('hidden');
  }
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/** 접속 코드 게이트 (공개 호스팅에서 본인만 사용) */
function setupAccessGate() {
  const form = $('#pin-form'), input = $('#pin-input'), err = $('#pin-error');
  if (!isLocked()) return;
  form.classList.remove('hidden');
  els.btnCamera.classList.add('hidden');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = await tryUnlock(input.value);
    if (ok) { form.classList.add('hidden'); els.btnCamera.classList.remove('hidden'); els.btnCamera.focus(); }
    else { err.classList.remove('hidden'); input.value = ''; input.focus(); }
  });
}

function bindUI() {
  els.btnCamera.addEventListener('click', startCamera);
  els.btnStart.addEventListener('click', toggleRun);
  els.btnMode.addEventListener('click', () => { renderModeList(); open(els.panelMode); });
  els.btnSettings.addEventListener('click', () => open(els.panelSettings));
  els.btnCalib.addEventListener('click', () => { refreshCalibUI(); open(els.panelCalib); });
  els.btnFloorLock.addEventListener('click', toggleFloorLock);
  els.btnFlip.addEventListener('click', flipCamera);
  $('#set-autoStart').addEventListener('change', (e) => { settings.autoStart = e.target.checked; app.idleHold = 0; persist(); });
  $$('.btn-close').forEach((b) => b.addEventListener('click', () => close($('#' + b.dataset.close))));
  $$('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) close(m); }));

  // 모드/대결
  els.versusToggle.addEventListener('change', () => {
    els.versusNames.classList.toggle('hidden', !els.versusToggle.checked);
  });
  els.p1.addEventListener('change', () => { settings.p1 = els.p1.value.trim() || '플레이어 1'; saveSettings(settings); });
  els.p2.addEventListener('change', () => { settings.p2 = els.p2.value.trim() || '플레이어 2'; saveSettings(settings); });

  // 설정
  $('#set-mirror').addEventListener('change', (e) => { settings.mirror = e.target.checked; applyMirror(); persist(); });
  $('#set-debug').addEventListener('change', (e) => { settings.debug = e.target.checked; els.debug.classList.toggle('hidden', !settings.debug); persist(); });
  $('#set-sound').addEventListener('change', (e) => { settings.sound = e.target.checked; sfx.enabled = settings.sound; persist(); });
  for (const key of ['whiteV', 'whiteC', 'puckTol', 'stickTol', 'floorWidthM']) {
    const input = $('#set-' + key), out = $('#out-' + key);
    input.addEventListener('input', () => { settings[key] = Number(input.value); out.value = input.value; persist(); game.arcade.floorWidthM = settings.floorWidthM; });
  }
  $('#set-floorMode').addEventListener('change', (e) => { settings.floorMode = e.target.value; applyFloorMode(); persist(); });
  $('#set-procWidth').addEventListener('change', (e) => { settings.procWidth = Number(e.target.value); vision.setProcWidth(settings.procWidth); layout(); persist(); });
  $('#set-controller').addEventListener('change', (e) => {
    settings.controller = e.target.value; persist(); tracker.reset();
    if (settings.controller === 'stick' && !settings.stickModel) toast('보정에서 스틱 색을 먼저 지정하세요', 4000);
  });
  $('#set-difficulty').addEventListener('change', (e) => { settings.difficulty = e.target.value; game.difficulty = settings.difficulty; persist(); });
  els.selCamera.addEventListener('change', async () => {
    settings.cameraId = els.selCamera.value; persist();
    try { await startStream(); } catch (err) { toast(describeCameraError(err)); }
  });
  $('#btn-reset-settings').addEventListener('click', () => {
    const keep = { cameraId: settings.cameraId, p1: settings.p1, p2: settings.p2 };
    Object.assign(settings, structuredClone(DEFAULT_SETTINGS), keep);
    persist(); applySettingsToUI(); applyMirror(); applyFloorMode(); refreshCalibUI(); toast('설정을 초기화했습니다');
  });
  $('#btn-reset-scores').addEventListener('click', () => { clearScores(); renderModeList(); toast('기록을 초기화했습니다'); });

  // 보정
  $$('[data-calib]').forEach((b) => b.addEventListener('click', () => beginCalibration(b.dataset.calib)));
  $$('[data-autocalib]').forEach((b) => b.addEventListener('click', () => beginAutoCalibration(b.dataset.autocalib)));
  $$('[data-calib-reset]').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.calibReset;
    if (t === 'puck') settings.puckModel = structuredClone(DEFAULT_SETTINGS.puckModel);
    else settings.stickModel = null;
    persist(); refreshCalibUI(); toast(t === 'puck' ? '퍽: 기본(검정)으로 되돌림' : '스틱 추적 해제');
  }));
  els.view.addEventListener('pointerdown', onViewTap);

  // 결과
  els.btnAgain.addEventListener('click', () => { close(els.panelResult); app.versus = null; startRun(); });
  els.btnNext.addEventListener('click', () => { close(els.panelResult); startRun(); });

  // 바닥 수동 핸들
  bindFloorHandles();

  window.addEventListener('resize', layout);
  if (screen.orientation?.addEventListener) screen.orientation.addEventListener('change', () => setTimeout(layout, 200));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (game.running) game.stop('manual'); app.wasHidden = true; }
    else if (app.wasHidden) { app.wasHidden = false; app.lastLoop = 0; requestWakeLock(); toast('화면이 가려져 있는 동안 추적이 멈췄습니다. 앱을 항상 전면에 두세요.'); }
  });
  // 키보드(외장 키보드/TV·PC에서 사용): Space·Enter 시작/중지, R 초기화, F 전체화면, M 모드, D 디버그
  document.addEventListener('keydown', (e) => {
    if (!app.started || e.target.matches('input, select, textarea')) return;
    switch (e.key) {
      case ' ': case 'Enter': e.preventDefault(); closeAllPanels(); toggleRun(); break;
      case 'r': case 'R': if (game.running) game.stop('manual'); game.resetState(); closeAllPanels(); updateHud(); toast('초기화'); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case 'm': case 'M': renderModeList(); open(els.panelMode); break;
      case 'd': case 'D': settings.debug = !settings.debug; $('#set-debug').checked = settings.debug; els.debug.classList.toggle('hidden', !settings.debug); persist(); break;
      case 'Escape': closeAllPanels(); if (app.calib.active) cancelAutoCalibration('자동 지정 취소'); break;
    }
  });
}

function closeAllPanels() { $$('.modal').forEach(close); }

function toggleFullscreen() {
  const doc = document;
  if (!doc.fullscreenElement && doc.documentElement.requestFullscreen) doc.documentElement.requestFullscreen().catch(() => {});
  else if (doc.exitFullscreen) doc.exitFullscreen().catch(() => {});
}

// =============== 카메라 ===============
async function startCamera() {
  sfx.unlock();
  sfx.enabled = settings.sound;
  els.btnCamera.disabled = true;
  els.btnCamera.textContent = '카메라 연결 중…';
  try {
    await startStream();
    await populateCameras();
    els.splash.classList.add('hidden');
    app.started = true;
    app.startedAt = performance.now();
    requestWakeLock();
    requestAnimationFrame(loop);
    if (settings.puckModel.area === 0) { beginAutoCalibration('puck'); toast('퍽으로 쓸 물체를 가운데 원 안에 놓고 3초 기다리세요', 5000); }
    else toast('준비 완료. 퍽을 바꾸려면 보정 > 원 안에 3초');
    if (document.documentElement.requestFullscreen && !navigator.standalone) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  } catch (err) {
    console.error(err);
    showSplashError(describeCameraError(err));
    els.btnCamera.disabled = false;
    els.btnCamera.textContent = '다시 시도';
  }
}

async function flipCamera() {
  if (game.running) game.stop('manual');
  settings.facing = settings.facing === 'user' ? 'environment' : 'user';
  settings.cameraId = '';
  settings.mirror = settings.facing === 'user'; // 전면은 거울, 후면은 그대로
  $('#set-mirror').checked = settings.mirror;
  persist();
  try {
    await startStream();
    await populateCameras();
    toast(settings.facing === 'user' ? '전면 카메라 (거울 모드)' : '후면 카메라');
  } catch (err) { toast(describeCameraError(err)); }
}

async function requestWakeLock() {
  // 휴대폰 화면 꺼짐 방지 (지원 브라우저만)
  try {
    if (!('wakeLock' in navigator)) return;
    if (app.wakeLock && !app.wakeLock.released) return;
    app.wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* 저전력 모드 등에서 거부될 수 있음 */ }
}

async function startStream() {
  const { width, height, facing } = await camera.start(settings.cameraId, settings.facing);
  if (facing === 'user' || facing === 'environment') settings.facing = facing;
  const track = camera.stream.getVideoTracks()[0];
  track.addEventListener('ended', () => { app.cameraLost = true; toast('카메라 연결이 끊겼습니다. 설정에서 카메라를 다시 선택하세요.', 6000); if (game.running) game.stop('manual'); });
  app.cameraLost = false;
  app.lastFrameAt = performance.now();
  vision.setSourceSize(width, height);
  els.view.style.aspectRatio = `${width} / ${height}`;
  vision.floorAuto = null;
  applyMirror();
  layout();
}

async function populateCameras() {
  const devices = await camera.listDevices();
  els.selCamera.innerHTML = '';
  const def = document.createElement('option');
  def.value = ''; def.textContent = '기본(후면)';
  els.selCamera.appendChild(def);
  devices.forEach((d, i) => {
    const o = document.createElement('option');
    o.value = d.deviceId; o.textContent = d.label || `카메라 ${i + 1}`;
    els.selCamera.appendChild(o);
  });
  els.selCamera.value = settings.cameraId && devices.some((d) => d.deviceId === settings.cameraId) ? settings.cameraId : '';
}

function layout() {
  const rect = els.view.getBoundingClientRect();
  renderer.resize(rect.width, rect.height);
  if (rect.width > 0) game.arcade.aspect = rect.height / rect.width;
  els.debug.width = vision.PW; els.debug.height = vision.PH;
  positionHandles();
}

function applyMirror() {
  vision.mirror = settings.mirror;
  els.view.classList.toggle('mirror', settings.mirror);
}

// =============== 메인 루프 ===============
function loop(now) {
  if (!app.started) return;
  requestAnimationFrame(loop);
  const video = els.video;
  if (video.readyState < 2) return;

  if (video.videoWidth && (video.videoWidth !== vision.srcW || video.videoHeight !== vision.srcH)) {
    // 휴대폰 회전 등으로 영상 크기가 바뀜
    vision.setSourceSize(video.videoWidth, video.videoHeight);
    els.view.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    layout();
  }

  let result = app.lastVision;
  if (video.currentTime !== app.lastVideoTime) {
    app.lastVideoTime = video.currentTime;
    app.lastFrameAt = now;
    if (app.frozenWarned) { app.frozenWarned = false; toast('카메라 영상이 다시 들어옵니다'); }
    result = vision.process(video, settings);
    app.lastVision = result;
    app.frames++;
    if (now - app.fpsAt > 1000) { app.fps = app.frames; app.frames = 0; app.fpsAt = now; }

    // 조작 대상(퍽 또는 스틱 블레이드) 측정값 -> 정규화 바닥 좌표
    let meas = null;
    const m = result.floor.mapping;
    const obj = settings.controller === 'stick' ? result.stick : result.puck;
    if (m && obj) {
      const [u, v] = m.toUV(obj.x, obj.y);
      if (u > -0.05 && u < 1.05 && v > -0.05 && v < 1.05) meas = { u: clamp(u, 0, 1), v: clamp(v, 0, 1) };
    }
    tracker.update(meas, now);

  }
  if (!result) return;
  // 영상이 2초 넘게 멈추면 경고 (카메라 점유·절전 등)
  if (!app.frozenWarned && !app.cameraLost && now - app.lastFrameAt > 2000) {
    app.frozenWarned = true;
    toast('카메라 영상이 멈췄습니다. 다른 앱이 카메라를 쓰고 있거나 화면이 가려졌을 수 있습니다.', 5000);
    if (game.running) game.stop('manual');
  }

  const dt = app.lastLoop ? Math.min(0.1, (now - app.lastLoop) / 1000) : 1 / 60;
  app.lastLoop = now;
  game.update(dt, tracker, now);
  if (app.calib.active) updateAutoCalibration(dt); else updateHandsFree(dt);

  game.arcade.idleAutoStart = settings.autoStart;
  game.arcade.idleHold = app.idleHold;
  renderer.draw({ vision: result, puck: tracker, game, procSize: { PW: vision.PW, PH: vision.PH }, now, showCandidates: settings.debug, idleHold: app.idleHold, autoStart: settings.autoStart, calib: app.calib });
  if (settings.debug && vision.debugImage) els.debug.getContext('2d').putImageData(vision.debugImage, 0, 0);

  if (now - app.hudAt > 100) { app.hudAt = now; updateHud(); updateChips(result); }
}

/** 핸즈프리 시작: 대기 중 퍽을 가운데 원 안에 3초 두면 시작/재시작 (거치대에 둔 채로 플레이) */
function updateHandsFree(dt) {
  if (!settings.autoStart || game.running || app.calibTarget) { app.idleHold = 0; return; }
  // 설정/보정/모드 패널이 열려 있으면 대기 (결과 패널은 허용)
  if (![els.panelSettings, els.panelCalib, els.panelMode, els.panelRank].every((p) => p.classList.contains('hidden'))) { app.idleHold = 0; return; }
  const pos = tracker.pos;
  const inside = pos && tracker.state === 'tracked' && Math.abs(pos.x - 0.5) < 0.1 && Math.abs(pos.y - 0.5) < 0.25;
  if (!inside) { app.idleHold = 0; app.idleTick = -1; return; }
  app.idleHold += dt;
  const remain = Math.ceil(3 - app.idleHold);
  if (remain !== app.idleTick && remain > 0) { app.idleTick = remain; sfx.tick(); }
  if (app.idleHold >= 3) {
    app.idleHold = 0;
    close(els.panelResult);
    if (app.versus && app.versus.current === 1 && app.versus.scores.length === 1) { /* 2P 차례: 그대로 진행 */ }
    startRun({ handsFree: true });
  }
}

// =============== HUD ===============
function updateHud(force) {
  const who = app.account?.current();
  els.hudMode.textContent = game.mode.name + (app.versus ? ` · ${app.versus.names[app.versus.current]}` : who ? ` · ${who.nick}` : '');
  els.hudInstruction.textContent = game.running ? game.instruction : (app.started ? '시작을 누르세요' : '');
  if (game.mode.duration > 0) {
    const t = game.running ? game.timeLeft : game.mode.duration;
    els.hudTimer.textContent = `${Math.floor(t / 60)}:${String(Math.ceil(t % 60)).padStart(2, '0')}`;
    if (game.running && t <= 5) els.hudTimer.style.color = '#f59e0b'; else els.hudTimer.style.color = '';
  } else {
    const e = game.running ? game.elapsed : 0;
    els.hudTimer.textContent = `${Math.floor(e / 60)}:${String(Math.floor(e % 60)).padStart(2, '0')}`;
  }
  els.hudScore.textContent = String(game.score);
  els.hudLives.textContent = game.lives > 0 ? '❤️'.repeat(game.lives) : '';
  if (game.mode.id === 'arcade' && game.running) {
    const a = game.arcade;
    els.hudCombo.textContent = a.combo > 0 ? `COMBO ${a.combo}  ×${a.multiplier}` : '';
    els.hudCombo.className = 'hud-combo' + (a.combo >= 20 ? ' fever' : a.combo >= 10 ? ' gold' : '');
  } else els.hudCombo.textContent = '';
  els.btnStart.textContent = game.running ? '중지' : '시작';
  els.btnStart.classList.toggle('stop', game.running);
  if (force) els.btnFloorLock.classList.toggle('active', vision.floorLocked);
}

function updateChips(result) {
  setChip(els.chipFloor, result.floor.mapping ? (result.floor.detected || result.floor.fallback || result.floor.mode === 'full' ? 'ok' : 'warn') : 'bad',
    result.floor.mode === 'manual' ? '바닥(수동)' : result.floor.mode === 'full' || result.floor.fallback ? '영역(전체화면)' : vision.floorLocked ? '바닥(고정)' : '바닥(흰색)');
  const stickCtl = settings.controller === 'stick';
  setChip(els.chipPuck, result.puck ? 'ok' : (!stickCtl && tracker.state === 'predicted') ? 'warn' : 'bad', stickCtl ? '퍽' : '퍽(조작)');
  if (settings.stickModel) setChip(els.chipStick, result.stick ? 'ok' : 'bad', stickCtl ? '스틱(조작)' : '스틱');
  else setChip(els.chipStick, '', '스틱(미지정)');
  els.chipFps.textContent = app.frozenWarned || app.cameraLost ? '영상 없음' : `${app.fps} fps`;
}

function setChip(el, state, label) {
  el.classList.remove('ok', 'warn', 'bad');
  if (state) el.classList.add(state);
  el.lastChild.textContent = label;
}

// =============== 게임 제어 ===============
function toggleRun() {
  sfx.unlock();
  if (game.running) { game.stop('manual'); return; }
  startRun();
}

function startRun(opts = {}) {
  if (app.calib.active) cancelAutoCalibration();
  if (!app.lastVision?.floor?.mapping) { toast('바닥이 인식되지 않았습니다. 흰 바닥이 보이게 카메라를 조정하거나 설정에서 수동 지정하세요.'); return; }
  if (settings.controller === 'stick' && !settings.stickModel) { toast('조작 대상이 스틱입니다. 보정에서 스틱 색을 먼저 지정하세요.'); return; }
  if (game.mode.id !== 'free' && tracker.state === 'lost') { toast(settings.controller === 'stick' ? '스틱 블레이드가 인식(주황 마름모)된 뒤 시작하세요.' : '퍽을 바닥 위에 놓아 인식(파란 원)된 뒤 시작하세요.'); }
  tracker.resetStats();
  game.start(tracker, opts);
  updateHud();
}

game.onEnd = (result) => {
  app.lastResult = result;
  const isBest = result.mode.id !== 'free' && result.reason !== 'manual' ? saveBest(result.mode.id, result.score) : false;
  showResult(result, isBest);
  submitResult(result);
  updateHud();
};

function showResult(result, isBest) {
  let title = `${result.mode.name} 결과`;
  if (result.reason === 'lives') title = '생명 소진!';
  const body = [];
  if (isBest) body.push(`<div class="stat full winner"><small>신기록</small><b>🏆 ${result.score}</b></div>`);
  for (const [k, v] of result.items) body.push(`<div class="stat"><small>${k}</small><b>${v}</b></div>`);

  if (app.versus) {
    const vs = app.versus;
    vs.scores[vs.current] = result.score;
    if (vs.current === 0) {
      title = `${vs.names[0]} 완료 · 다음: ${vs.names[1]}`;
      els.btnNext.classList.remove('hidden');
      els.btnAgain.classList.add('hidden');
      vs.current = 1;
    } else {
      const [a, b] = vs.scores;
      const winner = a === b ? '무승부' : (a > b ? vs.names[0] : vs.names[1]) + ' 승리!';
      title = `대결 결과 · ${winner}`;
      body.unshift(`<div class="stat full winner"><small>${vs.names[0]} vs ${vs.names[1]}</small><b>${a} : ${b}</b></div>`);
      els.btnNext.classList.add('hidden');
      els.btnAgain.classList.remove('hidden');
      els.btnAgain.textContent = '다시 대결';
      app.versus = { names: vs.names, scores: [], current: 0 };
    }
  } else {
    els.btnNext.classList.add('hidden');
    els.btnAgain.classList.remove('hidden');
    els.btnAgain.textContent = '다시 하기';
  }
  els.resultTitle.textContent = title;
  els.resultBody.innerHTML = body.join('');
  $('#result-hint').classList.toggle('hidden', !settings.autoStart);
  open(els.panelResult);
}

function renderModeList() {
  const scores = loadScores();
  els.modeList.innerHTML = '';
  for (const m of MODES) {
    const card = document.createElement('button');
    card.className = 'mode-card' + (m.id === game.mode.id ? ' selected' : '');
    const best = scores[m.id] !== undefined ? `<div class="best">최고 기록: ${scores[m.id]}</div>` : '';
    card.innerHTML = `<b>${m.icon} ${m.name}${m.duration ? ` <small style="display:inline">· ${m.duration}초</small>` : ''}</b><small>${m.desc}</small>${best}`;
    card.addEventListener('click', () => {
      if (game.running) game.stop('manual');
      game.setMode(m.id);
      if (els.versusToggle.checked) {
        app.versus = { names: [els.p1.value.trim() || '플레이어 1', els.p2.value.trim() || '플레이어 2'], scores: [], current: 0 };
        if (m.id === 'free') { app.versus = null; toast('자유 연습은 대결 모드를 지원하지 않습니다'); }
      } else app.versus = null;
      close(els.panelMode);
      updateHud();
      toast(`${m.name} 선택됨`);
    });
    els.modeList.appendChild(card);
  }
  els.p1.value = settings.p1; els.p2.value = settings.p2;
}

// =============== 바닥 ===============
function toggleFloorLock() {
  if (settings.floorMode === 'manual') { toast('수동 바닥 모드에서는 모서리를 드래그해 조정하세요'); return; }
  if (settings.floorMode === 'full') { toast('게임 영역이 카메라 화면 전체입니다 (설정에서 변경)'); return; }
  vision.floorLocked = !vision.floorLocked;
  els.btnFloorLock.classList.toggle('active', vision.floorLocked);
  toast(vision.floorLocked ? '바닥 영역 고정됨' : '바닥 영역 자동 갱신');
}

function applyFloorMode() {
  const manual = settings.floorMode === 'manual';
  if (manual && !settings.manualQuad) {
    // 자동 감지 결과가 있으면 그대로 가져오고, 없으면 기본 사각형
    const f = vision.floorAuto;
    settings.manualQuad = f
      ? [[f.x0 / vision.PW, f.y0 / vision.PH], [f.x1 / vision.PW, f.y0 / vision.PH], [f.x1 / vision.PW, f.y1 / vision.PH], [f.x0 / vision.PW, f.y1 / vision.PH]]
      : [[0.1, 0.15], [0.9, 0.15], [0.95, 0.95], [0.05, 0.95]];
    persist();
  }
  els.handles.classList.toggle('hidden', !manual);
  els.btnFloorLock.classList.toggle('active', false);
  positionHandles();
}

function positionHandles() {
  if (settings.floorMode !== 'manual' || !settings.manualQuad) return;
  $$('#floor-handles .handle').forEach((h) => {
    const [u, v] = settings.manualQuad[Number(h.dataset.i)];
    h.style.left = `${u * 100}%`; h.style.top = `${v * 100}%`;
  });
}

function bindFloorHandles() {
  $$('#floor-handles .handle').forEach((h) => {
    const i = Number(h.dataset.i);
    h.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      h.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const r = els.view.getBoundingClientRect();
        const u = clamp((ev.clientX - r.left) / r.width, 0, 1), v = clamp((ev.clientY - r.top) / r.height, 0, 1);
        settings.manualQuad[i] = [u, v];
        positionHandles();
      };
      const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); persist(); };
      h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    });
  });
}

// =============== 보정 (가운데 원에 3초: 자동 물체 지정) ===============
function beginAutoCalibration(target) {
  if (game.running) game.stop('manual');
  closeAllPanels();
  autoCal.reset();
  app.calib = { active: true, target, hold: 0, status: 'none', sample: null, circle: vision.calibCircle() };
  app.calibTarget = null;
  els.tapHint.classList.add('hidden');
  app.idleHold = 0;
}

function cancelAutoCalibration(msg) {
  app.calib = { active: false, target: null, hold: 0, status: 'none', sample: null, circle: null };
  if (msg) toast(msg);
}

function updateAutoCalibration(dt) {
  const c = app.calib;
  c.circle = vision.calibCircle();
  const sample = vision.autoCalibSample();
  const done = autoCal.update(sample, dt);
  c.hold = autoCal.hold; c.status = autoCal.status; c.sample = autoCal.sample;
  if (!done) return;
  const model = { r: done.r, g: done.g, b: done.b, area: done.area };
  if (vision.isFloorLike(model, settings) && settings.floorMode === 'auto' && !app.lastVision?.floor?.fallback) {
    cancelAutoCalibration('바닥(흰색)과 구분되지 않는 색입니다. 다른 색의 물체를 쓰세요.');
    return;
  }
  if (c.target === 'puck') {
    settings.puckModel = model; settings.puckTol = done.tol;
    vision.seedPuck(done.cx, done.cy, done.area); tracker.reset();
    $('#set-puckTol').value = done.tol; $('#out-puckTol').value = done.tol;
  } else {
    settings.stickModel = model; settings.stickTol = done.tol;
    $('#set-stickTol').value = done.tol; $('#out-stickTol').value = done.tol;
  }
  persist(); refreshCalibUI();
  sfx.target();
  cancelAutoCalibration(`${c.target === 'puck' ? '퍽' : '스틱'} 인식 완료 · rgb(${model.r},${model.g},${model.b}) · 크기 ${model.area}px · 이제 움직여 보세요`);
}

// =============== 보정 (터치로 색 지정) ===============
function beginCalibration(target) {
  if (app.calib.active) cancelAutoCalibration();
  app.calibTarget = target;
  close(els.panelCalib);
  els.tapHint.textContent = target === 'puck' ? '화면에서 퍽을 터치하세요' : '화면에서 스틱 블레이드(테이프)를 터치하세요';
  els.tapHint.classList.remove('hidden');
  els.view.classList.add('calibrating');
}

function onViewTap(e) {
  if (app.calib.active) { if (!e.target.classList.contains('handle')) cancelAutoCalibration('자동 지정 취소'); return; }
  if (!app.calibTarget || !app.lastVision) return;
  if (e.target.classList.contains('handle')) return;
  const r = els.view.getBoundingClientRect();
  const nx = (e.clientX - r.left) / r.width, ny = (e.clientY - r.top) / r.height;
  const [px, py] = vision.toProc(nx, ny);
  const tol = app.calibTarget === 'puck' ? settings.puckTol : settings.stickTol;
  const sample = vision.sampleObject(px, py, tol);
  els.tapHint.classList.add('hidden');
  els.view.classList.remove('calibrating');
  const target = app.calibTarget; app.calibTarget = null;
  if (!sample) return;
  if (vision.isFloorLike(sample, settings)) {
    toast('바닥(흰색)과 구분되지 않는 색입니다. 다른 색의 물체/테이프를 사용하세요.');
    return;
  }
  const model = { r: sample.r, g: sample.g, b: sample.b, area: Math.max(4, Math.min(3000, sample.area)) };
  if (target === 'puck') { settings.puckModel = model; vision.seedPuck(px, py, model.area); tracker.reset(); }
  else settings.stickModel = model;
  persist(); refreshCalibUI();
  toast(`${target === 'puck' ? '퍽' : '스틱'} 색 지정 완료 (rgb ${model.r},${model.g},${model.b}, 크기 ${model.area}px)`);
}

function refreshCalibUI() {
  const pm = settings.puckModel;
  els.swatchPuck.style.background = `rgb(${pm.r},${pm.g},${pm.b})`;
  els.swatchPuck.classList.remove('none');
  els.calibPuckDesc.textContent = pm.area > 0 ? `지정됨 · rgb(${pm.r},${pm.g},${pm.b}) · ${pm.area}px` : '기본: 검정 (크기 자동)';
  const sm = settings.stickModel;
  if (sm) {
    els.swatchStick.style.background = `rgb(${sm.r},${sm.g},${sm.b})`;
    els.swatchStick.classList.remove('none');
    els.calibStickDesc.textContent = `지정됨 · rgb(${sm.r},${sm.g},${sm.b}) · ${sm.area}px`;
  } else {
    els.swatchStick.style.background = '';
    els.swatchStick.classList.add('none');
    els.calibStickDesc.textContent = '미지정 (퍽만 추적)';
  }
}

// =============== 설정 UI ===============
function applySettingsToUI() {
  $('#set-mirror').checked = settings.mirror;
  $('#set-debug').checked = settings.debug;
  $('#set-sound').checked = settings.sound;
  $('#set-autoStart').checked = settings.autoStart;
  els.debug.classList.toggle('hidden', !settings.debug);
  for (const key of ['whiteV', 'whiteC', 'puckTol', 'stickTol', 'floorWidthM']) {
    $('#set-' + key).value = settings[key]; $('#out-' + key).value = settings[key];
  }
  game.arcade.floorWidthM = settings.floorWidthM;
  $('#set-floorMode').value = settings.floorMode;
  $('#set-procWidth').value = String(settings.procWidth);
  $('#set-controller').value = settings.controller;
  $('#set-difficulty').value = settings.difficulty;
  els.p1.value = settings.p1; els.p2.value = settings.p2;
  refreshCalibUI();
  applyMirror();
  applyFloorMode();
}

function persist() { saveSettings(settings); }

// =============== 유틸 ===============
function open(panel) { panel.classList.remove('hidden'); }
function close(panel) { panel.classList.add('hidden'); }
function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }
function showSplashError(msg) { els.splashError.textContent = msg; els.splashError.classList.remove('hidden'); }

let toastTimer = 0;
function toast(msg, ms = 2600) {
  els.toast.textContent = msg;
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), ms);
}
