// 앱 오케스트레이션: 카메라 -> 영상처리 -> 추적 -> 게임 -> 렌더/HUD
import { Camera, describeCameraError } from './camera.js';
import { Vision, AutoCalibrator } from './vision.js';
import { Tracker } from './tracker.js';
import { Game, MODES, PLAY_MINUTES, rankKey } from './game.js';
import { Renderer, dodgeField } from './render.js';
import { Sfx } from './audio.js';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, loadScores, saveBest, clearScores } from './storage.js';
import { isLocked, tryUnlock } from './access.js';
import { createAccountStore, COUNTRIES, AGE_GROUPS, countryLabel, jerseyLabel, isAdmin } from './account.js';
import { MouseInput, MOUSE_SRC, pointerToUV, mouseVisionResult } from './mouse-input.js';
import { decideIdle, stepChoice, stepDwell, CHOICE_HOLD_S } from './idle-logic.js';
import { initI18n, bindLangButtons, onLangChange, tr, setLang, getLang, missing as i18nMissing } from './i18n.js';
import { createCommunityStore, courseSig, betterRecord, boardOf, TITLE_MAX } from './community.js';
import { initCommunity } from './community-ui.js';

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
  panelCommunity: $('#panel-community'),
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
const mouse = new MouseInput(); // 테스트 관리자: 카메라 없이 마우스로 플레이

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
  calib: { active: false, manual: false, target: 'puck', hold: 0, status: 'none', sample: null, circle: null }, // 가운데 원: 물체 학습 + 핸즈프리 시작
  choice: { side: null, hold: 0, tick: -1, armAt: 0 }, // 게임 종료 후 선택 (왼쪽 = 한 번 더, 오른쪽 = 모드 선택)
  challenge: null,    // 커뮤니티 코스 도전 중: { id, title, sig, holder: {uid, nick, avg, best}|null }
  communityStore: null, // Promise<커뮤니티 저장소>
};
let community = null;   // 커뮤니티 화면 (initCommunity 반환값)
const autoCal = new AutoCalibrator(3);

// 디버그/테스트용 훅 (브라우저 콘솔에서 상태 확인: __puckTrainer.tracker 등)
window.__puckTrainer = { settings, vision, tracker, game, app, mouse, i18n: { tr, setLang, getLang, missing: i18nMissing } };

// =============== 초기화 ===============
init();

function init() {
  initI18n();
  bindLangButtons();
  onLangChange(() => { renderModeList(); updateHud(true); refreshCalibUI(); if (!els.panelCommunity.classList.contains('hidden')) community?.refresh(); });
  applySettingsToUI();
  bindUI();
  setupAccessGate();
  const accountReady = setupAuth();
  app.communityStore = accountReady.then(() => createCommunityStore(app.account));
  setupCommunity();
  game.difficulty = settings.difficulty;
  game.playSeconds = settings.playMinutes * 60;
  game.resetState();
  renderModeList();
  initCourse();
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
  [els.rankMode, els.rankAge, els.rankScope, $('#rank-time')].forEach((e) => e.addEventListener('change', () => renderRank()));
  MODES.filter((m) => m.id !== 'free').forEach((m) => { const o = document.createElement('option'); o.value = m.id; o.textContent = m.name; els.rankMode.appendChild(o); });
  PLAY_MINUTES.forEach((min) => { const o = document.createElement('option'); o.value = String(min * 60); o.textContent = `${min}분`; $('#rank-time').appendChild(o); });
  AGE_GROUPS.forEach((g) => { const o = document.createElement('option'); o.value = g; o.textContent = g; els.rankAge.appendChild(o); });

  app.account = await createAccountStore();
  window.__puckTrainer.account = app.account;
  els.authNote.textContent = app.account.kind === 'firebase'
    ? '온라인 랭킹 — 모든 기기의 기록이 함께 집계됩니다.'
    : '기록은 이 기기에 저장됩니다. 여러 선수가 같은 기기로 겨룰 수 있어요.';
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
      await app.account.register({ nick, pin, country: $('#auth-country').value, team: $('#auth-team').value, age: $('#auth-age').value, number: $('#auth-number').value });
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
  if (u) els.authWho.innerHTML = `<b>${esc(u.nick)}</b>${u.number != null ? ` <span class="jersey">${jerseyLabel(u.number)}</span>` : ''} · ${esc(u.team)} · ${esc(countryLabel(u.country))} · ${esc(u.ageGroup)} (${u.age}세)`;
  $('#settings-account').textContent = u ? `로그인: ${[u.nick, jerseyLabel(u.number)].filter(Boolean).join(' ')} (${u.team}, ${u.ageGroup})` : '로그인하지 않음 (랭킹 미등록)';
  $('#btn-settings-logout').classList.toggle('hidden', !u);
  refreshMouseButton();
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
  $('#rank-time').value = String(game.playSeconds);
  open(els.panelRank);
  await renderRank();
}

async function renderRank() {
  if (!app.account) return;
  const timed = MODES.find((m) => m.id === els.rankMode.value)?.timed;
  $('#rank-time').classList.toggle('hidden', !timed);
  const mode = rankKey(els.rankMode.value, Number($('#rank-time').value) || 60); // 시간제 모드는 시간별 랭킹
  const u = app.account.current();
  els.rankBody.innerHTML = '<tr><td colspan="6" class="muted">불러오는 중…</td></tr>';
  try {
    const rows = await app.account.leaderboard(mode, rankFilters(), 100);
    els.rankBody.innerHTML = rows.length ? rows.map((r) => `<tr class="${u && r.uid === u.id ? 'me' : ''} ${r.rank <= 3 ? 'top' + r.rank : ''}">
      <td>${r.rank}</td><td>${esc(r.nick)}${r.number != null ? ` <span class="jersey">${jerseyLabel(r.number)}</span>` : ''}</td><td>${esc(r.team)}</td><td>${esc(countryLabel(r.country))}</td><td>${esc(r.ageGroup)}</td><td>${r.score}</td></tr>`).join('')
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
    const key = result.rankKey || result.mode.id;
    const { best, improved } = await app.account.submitScore(key, result.score);
    const all = await app.account.myRank(key, {});
    const age = await app.account.myRank(key, { ageGroup: u.ageGroup });
    const parts = [];
    if (all) parts.push(`전체 ${all.rank}위/${all.total}명`);
    if (age) parts.push(`${u.ageGroup} ${age.rank}위/${age.total}명`);
    els.resultRank.innerHTML = `<span class="script">${improved ? 'New best!' : `best ${best}`}</span> ${parts.join(' · ')} <button type="button" class="btn btn-ghost" id="btn-result-rank">랭킹 보기</button>`;
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
    if (ok) { form.classList.add('hidden'); els.btnCamera.classList.remove('hidden'); els.btnCamera.focus(); refreshMouseButton(); }
    else { err.classList.remove('hidden'); input.value = ''; input.focus(); }
  });
}

function bindUI() {
  els.btnCamera.addEventListener('click', startCamera);
  $('#btn-mouse').addEventListener('click', startMouse);
  els.btnStart.addEventListener('click', toggleRun);
  els.btnMode.addEventListener('click', () => { renderModeList(); open(els.panelMode); });
  els.btnSettings.addEventListener('click', () => open(els.panelSettings));
  els.btnCalib.addEventListener('click', () => { refreshCalibUI(); open(els.panelCalib); });
  els.btnFloorLock.addEventListener('click', toggleAreaEdit);
  $('#area-done').addEventListener('click', () => endAreaEdit());
  $('#area-auto').addEventListener('click', () => { settings.floorMode = 'auto'; vision.floorLocked = false; vision.floorAuto = null; $('#set-floorMode').value = 'auto'; applyFloorMode(); persist(); toast('흰 바닥 자동 감지 (사다리꼴). 바닥이 안 잡히면 화면 전체로 동작합니다'); endAreaEdit(false); });
  $('#area-full').addEventListener('click', () => { settings.floorMode = 'full'; $('#set-floorMode').value = 'full'; applyFloorMode(); persist(); toast('카메라 화면 전체가 게임 영역입니다'); endAreaEdit(false); });
  $('#area-reset').addEventListener('click', () => { settings.manualQuad = defaultTrapezoid(); positionHandles(); persist(); });
  els.btnFlip.addEventListener('click', flipCamera);
  $$('#time-seg button').forEach((b) => b.addEventListener('click', () => {
    if (game.running) game.stop('manual');
    settings.playMinutes = Number(b.dataset.min); persist();
    game.playSeconds = settings.playMinutes * 60; game.resetState();
    renderModeList(); updateHud();
  }));
  $('#set-autoStart').addEventListener('change', (e) => { settings.autoStart = e.target.checked; app.idleHold = 0; persist(); });
  $('#set-flipDepth').addEventListener('change', (e) => { settings.flipDepth = e.target.checked; game.arcade.flipY = settings.flipDepth; game.plane.flip = settings.flipDepth; persist(); });
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
  for (const key of ['whiteV', 'whiteC', 'puckTol', 'stickTol', 'floorWidthM', 'bgTransparency', 'puckOpacity']) {
    const input = $('#set-' + key), out = $('#out-' + key);
    input.addEventListener('input', () => { settings[key] = Number(input.value); out.value = input.value; persist(); game.arcade.floorWidthM = settings.floorWidthM; applyWash(); });
  }
  $('#set-floorMode').addEventListener('change', (e) => { settings.floorMode = e.target.value; if (app.areaEditing && settings.floorMode !== 'manual') endAreaEdit(false); applyFloorMode(); persist(); });
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
  $('#btn-replace-puck').addEventListener('click', () => { beginAutoCalibration('puck'); toast('새 물체를 원 안에 3초 두면 퍽이 교체됩니다'); });
  $('#setup-skip').addEventListener('click', () => cancelAutoCalibration());
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
  $('#btn-result-mode').addEventListener('click', () => { close(els.panelResult); renderModeList(); open(els.panelMode); });

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
      case 'a': case 'A': toggleAreaEdit(); break;
      case 'd': case 'D': settings.debug = !settings.debug; $('#set-debug').checked = settings.debug; els.debug.classList.toggle('hidden', !settings.debug); persist(); break;
      case 'Escape': closeAllPanels(); if (app.calib.manual) cancelAutoCalibration('자동 지정 취소'); break;
    }
  });
}

function closeAllPanels() { $$('.modal').forEach(close); }

function toggleFullscreen() {
  const doc = document;
  if (!doc.fullscreenElement && doc.documentElement.requestFullscreen) doc.documentElement.requestFullscreen().catch(() => {});
  else if (doc.exitFullscreen) doc.exitFullscreen().catch(() => {});
}

// =============== 테스트 관리자: 마우스 모드 (카메라 없이) ===============
function refreshMouseButton() {
  const show = isAdmin(app.account?.current()) && !els.btnCamera.classList.contains('hidden') && !app.started;
  $('#btn-mouse').classList.toggle('hidden', !show);
}

function startMouse() {
  if (!isAdmin(app.account?.current())) { toast('관리자 계정으로 로그인해야 합니다'); return; }
  sfx.unlock();
  sfx.enabled = settings.sound;
  app.mouseMode = true;
  mouse.enabled = true;
  vision.mirror = false;
  els.view.classList.remove('mirror');
  els.view.classList.add('mouse-mode');
  vision.setSourceSize(MOUSE_SRC.width, MOUSE_SRC.height);
  els.view.style.aspectRatio = `${MOUSE_SRC.width} / ${MOUSE_SRC.height}`;
  layout();
  els.splash.classList.add('hidden');
  $('#splash-diag').classList.add('hidden');
  app.started = true;
  app.startedAt = performance.now();
  app.lastFrameAt = performance.now();
  requestAnimationFrame(loop);
  openModeAfterStart();
}

// =============== 시작 준비: 1/2 플레이 공간 → 2/2 퍽 등록 → 모드 선택 ===============
function beginAreaSetup() {
  app.setup = 'area';
  toggleAreaEdit();
  $('#area-step').classList.remove('hidden');
}

function beginPuckSetup() {
  app.setup = 'puck';
  $('#area-step').classList.add('hidden');
  beginAutoCalibration('puck');
  $('#setup-bar').classList.remove('hidden');
  $('#setup-skip').classList.toggle('hidden', !(settings.puckModel.area > 0));
  els.toast.classList.add('hidden'); // 안내는 위 막대가 맡는다 (토스트와 겹치지 않게)
}

function finishSetup() {
  app.setup = null;
  $('#setup-bar').classList.add('hidden');
  $('#area-step').classList.add('hidden');
  openModeAfterStart();
}

/** 시작 준비가 끝나면: 바로 게임으로 가지 않고 모드 창을 연다 (게임 종류·시간 선택). 고른 뒤 원 안 안내가 이어진다 */
function openModeAfterStart() {
  app.afterStart = true;
  renderModeList();
  open(els.panelMode);
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
    $('#splash-diag').classList.add('hidden');
    app.started = true;
    app.startedAt = performance.now();
    requestWakeLock();
    requestAnimationFrame(loop);
    app.setup = 'area-wait'; // 첫 영상이 들어오면 1/2 영역 설정부터 (loop 에서 시작)
    if (document.documentElement.requestFullscreen && !navigator.standalone) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  } catch (err) {
    console.error(err);
    showSplashError(describeCameraError(err));
    els.btnCamera.disabled = false;
    els.btnCamera.textContent = '다시 시도';
    await showCameraDiagnostics(err);
  }
}

/** 카메라 실패 진단: 감지된 장치 목록 + 선택 재시도 + 환경 정보 */
async function showCameraDiagnostics(err) {
  const box = $('#splash-diag'), sel = $('#diag-camera'), info = $('#diag-info');
  box.classList.remove('hidden');
  let devices = [];
  try { devices = await camera.listDevices(); } catch { /* ignore */ }
  sel.innerHTML = '<option value="">자동 선택</option>';
  devices.forEach((d, i) => { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || `카메라 ${i + 1} (권한 허용 후 이름 표시)`; sel.appendChild(o); });
  if (settings.cameraId && devices.some((d) => d.deviceId === settings.cameraId)) sel.value = settings.cameraId;
  let permission = '알 수 없음';
  try { if (navigator.permissions?.query) permission = (await navigator.permissions.query({ name: 'camera' })).state; } catch { /* 미지원 */ }
  const lines = [
    `오류: ${err?.name || 'Error'} ${err?.message || ''}`,
    `시도 기록: ${(camera.attemptLog || []).join(' | ') || '-'}`,
    `카메라 권한 상태: ${permission}`,
    `감지된 카메라: ${devices.length}개${devices.length ? ' - ' + devices.map((d) => d.label || '(이름 숨김)').join(', ') : ''}`,
    `보안 컨텍스트(HTTPS): ${window.isSecureContext}`,
    `브라우저: ${navigator.userAgent}`,
  ];
  info.textContent = lines.join('\n');
  if (!sel.dataset.bound) {
    sel.dataset.bound = '1';
    $('#btn-retry-camera').addEventListener('click', () => { settings.cameraId = sel.value; persist(); els.splashError.classList.add('hidden'); startCamera(); });
    $('#btn-copy-diag').addEventListener('click', async () => { try { await navigator.clipboard.writeText(info.textContent); toast('진단 정보를 복사했습니다'); } catch { toast('복사 실패: 아래 내용을 직접 선택해 복사하세요'); } });
  }
}

async function flipCamera() {
  if (app.mouseMode) { toast('마우스 모드에서는 카메라를 쓰지 않습니다'); return; }
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
  if (rect.width > 0) {
    game.arcade.aspect = rect.height / rect.width;
    // 퍽 피하기 평면: 상단 HUD가 가리는 만큼 경기장을 내리고, 그 비율을 게임 판정에 전달
    const hud = $('#hud').getBoundingClientRect();
    renderer.topInset = clamp((hud.bottom - rect.top) / rect.height, 0, 0.4);
    const f = dodgeField(renderer.canvas.width, renderer.canvas.height, renderer.topInset);
    game.plane = { A: f.h / f.w, flip: settings.flipDepth };
    // 자유 연습 코스 편집 영역(DOM)을 캔버스의 평면 경기장에 맞춤
    const cw = renderer.canvas.width, chh = renderer.canvas.height, cf = $('#course-field');
    cf.style.left = `${(f.x / cw) * 100}%`; cf.style.top = `${(f.y / chh) * 100}%`;
    cf.style.width = `${(f.w / cw) * 100}%`; cf.style.height = `${(f.h / chh) * 100}%`;
    game.course.reach = Math.max(0.04, 22 / Math.max(1, f.w / renderer.dpr)); // 화면상 최소 22px
  }
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
  if (app.mouseMode) stepMouse(now);
  else if (video.readyState < 2) return;

  if (video.videoWidth && (video.videoWidth !== vision.srcW || video.videoHeight !== vision.srcH)) {
    // 휴대폰 회전 등으로 영상 크기가 바뀜
    vision.setSourceSize(video.videoWidth, video.videoHeight);
    els.view.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    layout();
  }

  let result = app.lastVision;
  if (!app.mouseMode && video.currentTime !== app.lastVideoTime) {
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
  // 시작 준비: 첫 영상 처리 뒤 잠깐(자동 바닥 감지가 잡힐 시간) 기다렸다가 영역 설정을 연다
  if (app.setup === 'area-wait' && now - app.startedAt > 700) beginAreaSetup();
  // 영상이 2초 넘게 멈추면 경고 (카메라 점유·절전 등)
  if (!app.mouseMode && !app.frozenWarned && !app.cameraLost && now - app.lastFrameAt > 2000) {
    app.frozenWarned = true;
    toast('카메라 영상이 멈췄습니다. 다른 앱이 카메라를 쓰고 있거나 화면이 가려졌을 수 있습니다.', 5000);
    if (game.running) game.stop('manual');
  }

  const dt = app.lastLoop ? Math.min(0.1, (now - app.lastLoop) / 1000) : 1 / 60;
  app.lastLoop = now;
  game.update(dt, tracker, now);
  updateCourseUI();
  const modeOpen = !els.panelMode.classList.contains('hidden');
  if (!modeOpen && app.modePick) { app.modePick = null; $('#mode-cursor').classList.add('hidden'); }
  if (app.calib.manual) updateAutoCalibration(dt);
  else if (!els.panelCommunity.classList.contains('hidden')) pauseIdle(); // 글을 읽고 쓰는 동안은 핸즈프리 시작을 멈춘다
  else if (!els.panelResult.classList.contains('hidden')) updateResultChoice(dt);
  else if (modeOpen) updateModeChoice(dt);
  else if (game.mode.id === 'free' && !game.running && app.started && !app.areaEditing && !app.calibTarget) updateCourseIdle(dt);
  else updateIdleCircle(dt);

  game.arcade.idleAutoStart = settings.autoStart;
  game.arcade.idleHold = app.idleHold;
  renderer.draw({ vision: result, puck: tracker, game, procSize: { PW: vision.PW, PH: vision.PH }, now, showCandidates: settings.debug, idleHold: app.idleHold, calib: app.calib, areaEditing: app.areaEditing });
  if (settings.debug && vision.debugImage) els.debug.getContext('2d').putImageData(vision.debugImage, 0, 0);

  if (now - app.hudAt > 100) { app.hudAt = now; updateHud(); updateChips(result); }
}

/**
 * 게임 종료 후 선택 (결과 화면이 떠 있는 동안): 퍽을 왼쪽 영역에 2초 두면 한 번 더, 오른쪽 영역에 두면 모드 선택.
 * 결과 창이 카메라를 가리므로 창 안의 트랙에 퍽의 좌우 위치를 점으로 보여준다.
 */
/** 마우스 모드 한 프레임: 포인터 -> 추적 좌표 -> Tracker (커서가 화면 밖이어도 마지막 자리를 유지) */
function stepMouse(now) {
  let meas = null;
  if (mouse.has) {
    meas = pointerToUV(mouse.x, mouse.y, {
      view: els.view, canvas: renderer.canvas, game, topInset: renderer.topInset, flipDepth: settings.flipDepth,
      modeList: els.modeList, modeOpen: !els.panelMode.classList.contains('hidden'),
      choiceTrack: $('#choice-track'), resultOpen: !els.panelResult.classList.contains('hidden'),
    });
  }
  app.lastVision = mouseVisionResult(vision.PW, vision.PH, meas);
  app.lastFrameAt = now;
  app.frames++;
  if (now - app.fpsAt > 1000) { app.fps = app.frames; app.frames = 0; app.fpsAt = now; }
  // 마우스는 튀지 않으므로 이상치 게이트를 거치지 않게 매 프레임 새로 획득한 것처럼 넣는다
  if (meas && tracker.pos) {
    const dt = tracker.lastTime ? Math.max(1e-3, Math.min(0.1, (now - tracker.lastTime) / 1000)) : 1 / 60;
    const dx = meas.u - tracker.pos.x, dy = meas.v - tracker.pos.y;
    tracker.vel = { x: dx / dt, y: dy / dt };
    tracker.pos = { x: meas.u - tracker.vel.x * dt, y: meas.v - tracker.vel.y * dt };
  }
  tracker.update(meas, now);
}

function pauseIdle() {
  const c = app.calib; c.active = false; c.hold = 0; app.idleHold = 0; autoCal.reset();
  $('#btn-replace-puck').classList.add('hidden');
  app.courseDwell = null;
}

function updateResultChoice(dt) {
  const c = app.calib; c.active = false; c.hold = 0; app.idleHold = 0; autoCal.reset();
  $('#btn-replace-puck').classList.add('hidden');
  const ch = app.choice;
  const enabled = settings.autoStart;
  $('#choice-track').classList.toggle('hidden', !enabled);
  const tracked = enabled && tracker.state === 'tracked' && !!tracker.pos;
  const u = tracker.pos ? tracker.pos.x : null;
  const fire = enabled ? stepChoice(ch, { u, tracked, dt, armed: performance.now() >= ch.armAt }) : null;
  if (!enabled) { ch.side = null; ch.hold = 0; }
  // 1초마다 틱
  if (ch.side && ch.hold > 0) { const remain = Math.ceil(CHOICE_HOLD_S - ch.hold); if (remain !== ch.tick) { ch.tick = remain; sfx.tick(); } } else ch.tick = -1;
  paintChoice(tracked ? u : null);
  if (!fire) return;
  ch.side = null; ch.hold = 0; paintChoice(null);
  if (fire === 'L') (els.btnNext.classList.contains('hidden') ? els.btnAgain : els.btnNext).click();
  else $('#btn-result-mode').click();
}

/**
 * 모드 선택 화면을 퍽으로 고르기: 퍽의 (좌우, 앞뒤) 위치를 카드 목록 위의 빨간 커서로 옮기고,
 * 카드 위에 2초 머물면 그 모드를 선택한다. 창이 열릴 때 커서가 올라가 있던 카드는 한 번 벗어났다가 다시 와야 한다
 * (결과 화면에서 퍽을 오른쪽에 둔 채 넘어왔을 때 엉뚱한 카드가 바로 선택되는 것을 방지).
 */
function updateModeChoice(dt) {
  const c = app.calib; c.active = false; c.hold = 0; app.idleHold = 0; autoCal.reset();
  $('#btn-replace-puck').classList.add('hidden');
  const cursor = $('#mode-cursor');
  const enabled = settings.autoStart;
  $('#mode-pick-hint').classList.toggle('hidden', !enabled);
  if (!app.modePick) app.modePick = { key: null, hold: 0, tick: -1, armAt: performance.now() + 800, blocked: undefined };
  const mp = app.modePick;
  const cards = $$('#mode-list .mode-card');
  const tracked = enabled && tracker.state === 'tracked' && !!tracker.pos;
  let idx = null;
  if (tracked) {
    const r = els.modeList.getBoundingClientRect();
    const u = clamp(tracker.pos.x, 0, 1), v = clamp(settings.flipDepth ? 1 - tracker.pos.y : tracker.pos.y, 0, 1);
    const cx = r.left + u * r.width, cy = r.top + v * r.height;
    cursor.style.left = `${cx}px`; cursor.style.top = `${cy}px`;
    cursor.classList.remove('hidden');
    const hit = cards.findIndex((card) => { const b = card.getBoundingClientRect(); return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom; });
    idx = hit >= 0 ? hit : null;
    if (mp.blocked === undefined) mp.blocked = idx;               // 열릴 때 올라가 있던 카드
    else if (mp.blocked !== null && idx !== mp.blocked) mp.blocked = null; // 한 번 벗어나면 해제
  } else cursor.classList.add('hidden');
  const armed = performance.now() >= mp.armAt;
  const key = tracked && armed && idx !== null && idx !== mp.blocked ? idx : null;
  const fire = stepDwell(mp, key, dt, CHOICE_HOLD_S);
  const pct = Math.min(100, (mp.hold / CHOICE_HOLD_S) * 100);
  cards.forEach((card, i) => { card.style.setProperty('--dwell', i === mp.key ? `${pct}%` : '0%'); card.classList.toggle('hover', i === idx); });
  if (mp.key !== null && mp.hold > 0) { const remain = Math.ceil(CHOICE_HOLD_S - mp.hold); if (remain !== mp.tick) { mp.tick = remain; sfx.tick(); if (idx !== null) cards[idx].scrollIntoView({ block: 'nearest' }); } } else mp.tick = -1;
  if (fire === null || fire === undefined) return;
  app.modePick = null;
  cursor.classList.add('hidden');
  cards[fire].click();
}

// =============== 자유 연습: 코스 만들기 (번호 1~10을 끌어다 놓기) ===============
function initCourse() {
  const slots = $('#course-slots');
  for (let n = 1; n <= 10; n++) {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'course-pt'; el.dataset.n = String(n); el.textContent = String(n);
    el.setAttribute('aria-label', `포인트 ${n}`);
    slots.appendChild(el);
    bindCoursePoint(el);
  }
  $('#course-clear').addEventListener('click', () => { settings.course = []; syncCourse(); toast('코스를 비웠습니다'); });
  $('#cycles-dec').addEventListener('click', () => setCycles(settings.courseCycles - 10));
  $('#cycles-inc').addEventListener('click', () => setCycles(settings.courseCycles + 10));
  setCycles(settings.courseCycles);
  syncCourse();
}

/** 목표 사이클 수: 10 단위로 10~100 */
function setCycles(n) {
  settings.courseCycles = clamp(Math.round(n / 10) * 10, 10, 100);
  game.course.cycles = settings.courseCycles;
  $('#cycles-out').value = String(settings.courseCycles);
  $('#cycles-dec').disabled = settings.courseCycles <= 10;
  $('#cycles-inc').disabled = settings.courseCycles >= 100;
  checkChallenge();
  persist(); updateHud();
}

/** 도전 중인 코스를 고치면(포인트 이동·사이클 수 변경) 기록을 비교할 수 없으므로 도전을 해제한다 */
function checkChallenge() {
  if (app.challenge && courseSig(settings.course, settings.courseCycles) !== app.challenge.sig) {
    app.challenge = null;
    toast('코스를 바꿔서 도전이 해제되었습니다');
  }
}

/** settings.course -> DOM 배치 + 게임 로직에 전달 (번호 순서) */
function syncCourse() {
  const field = $('#course-field'), slots = $('#course-slots');
  const els10 = $$('.course-pt').sort((a, b) => Number(a.dataset.n) - Number(b.dataset.n));
  for (const el of els10) {
    const p = settings.course.find((q) => q.n === Number(el.dataset.n));
    if (p) { field.appendChild(el); el.style.left = `${p.x * 100}%`; el.style.top = `${p.y * 100}%`; }
    else { el.style.left = ''; el.style.top = ''; slots.appendChild(el); }
  }
  game.course.points = [...settings.course].sort((a, b) => a.n - b.n);
  if (game.mode.id === 'free' && !game.running) game.resetState();
  checkChallenge();
  persist();
}

function bindCoursePoint(el) {
  el.addEventListener('pointerdown', (e) => {
    if (game.running) return;
    e.preventDefault();
    const layer = $('#course');
    const lr = layer.getBoundingClientRect();
    const move = (ev) => { el.style.left = `${ev.clientX - lr.left}px`; el.style.top = `${ev.clientY - lr.top}px`; };
    layer.appendChild(el); el.classList.add('dragging');
    try { el.setPointerCapture(e.pointerId); } catch { /* 일부 브라우저 */ }
    move(e);
    const up = (ev) => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      const fr = $('#course-field').getBoundingClientRect(), tr = $('#course-tray').getBoundingClientRect();
      const n = Number(el.dataset.n);
      const inField = ev.type === 'pointerup' && ev.clientX >= fr.left && ev.clientX <= fr.right && ev.clientY > tr.bottom && ev.clientY <= fr.bottom;
      settings.course = settings.course.filter((p) => p.n !== n);
      // 경기장 안에 놓으면 포인트 생성, 위쪽 띠(트레이)나 밖에 놓으면 되돌림
      if (inField) settings.course.push({ n, x: clamp((ev.clientX - fr.left) / fr.width, 0.03, 0.97), y: clamp((ev.clientY - fr.top) / fr.height, 0.03, 0.97) });
      syncCourse();
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
}

/** 코스 표시 상태: 자유 연습일 때만 보이고, 플레이 중에는 다음/완료 표시 */
function updateCourseUI() {
  const show = app.started && game.mode.id === 'free' && !app.calib.manual && !app.areaEditing;
  const layer = $('#course');
  layer.classList.toggle('hidden', !show);
  if (!show) return;
  layer.classList.toggle('running', game.running);
  const pts = game.course.points;
  const nextN = game.running && pts.length ? pts[game.courseIdx % pts.length].n : null;
  for (const el of $$('#course-field > .course-pt')) {
    const n = Number(el.dataset.n), order = pts.findIndex((p) => p.n === n);
    el.classList.toggle('next', n === nextN);
    el.classList.toggle('done', game.running && nextN !== null && order >= 0 && order < game.courseIdx);
    if (game.running || n !== (pts[0] && pts[0].n)) el.style.setProperty('--dwell', '0');
  }
}

/** 자유 연습 대기 중: 첫 포인트에 퍽을 2초 두면 시작 (핸즈프리). 가운데 원 대신 코스 편집 화면을 보여준다 */
function updateCourseIdle(dt) {
  const c = app.calib; c.active = false; c.hold = 0; app.idleHold = 0; autoCal.reset();
  $('#btn-replace-puck').classList.add('hidden');
  if (!app.courseDwell) app.courseDwell = { key: null, hold: 0, tick: -1 };
  const cd = app.courseDwell, pts = game.course.points;
  let key = null;
  if (settings.autoStart && pts.length && tracker.state === 'tracked' && tracker.pos && !$('.course-pt.dragging')) {
    const me = game.toPlane(tracker.pos.x, tracker.pos.y);
    if (Math.hypot(me.x - pts[0].x, me.y - pts[0].y * game.plane.A) < game.course.reach * 1.2) key = pts[0].n;
  }
  const fire = stepDwell(cd, key, dt, CHOICE_HOLD_S);
  const first = pts.length ? $(`#course-field > .course-pt[data-n="${pts[0].n}"]`) : null;
  if (first) first.style.setProperty('--dwell', String(Math.min(1, cd.hold / CHOICE_HOLD_S)));
  if (cd.key !== null && cd.hold > 0) { const remain = Math.ceil(CHOICE_HOLD_S - cd.hold); if (remain !== cd.tick) { cd.tick = remain; sfx.tick(); } } else cd.tick = -1;
  if (fire === null || fire === undefined) return;
  app.courseDwell = null;
  startRun();
}

function paintChoice(u) {
  const ch = app.choice, pct = Math.min(100, (ch.hold / CHOICE_HOLD_S) * 100);
  const dot = $('#choice-dot');
  dot.classList.toggle('hidden', u === null);
  if (u !== null) dot.style.left = `${clamp(u, 0, 1) * 100}%`;
  for (const [btn, side] of [[els.btnAgain, 'L'], [els.btnNext, 'L'], [$('#btn-result-mode'), 'R']]) {
    const on = ch.side === side;
    btn.querySelector('.choice-fill').style.width = on ? `${pct}%` : '0';
    btn.classList.toggle('filling', on && pct > 45);
  }
}

/**
 * 대기 중 가운데 원 (핸즈프리):
 *  - 인식 중인 퍽이 원 안에 있으면 3초 뒤 시작/재시작
 *  - 모르는 물체가 원 안에 있으면 3초 뒤 그 물체를 새 퍽으로 학습 (아무 바닥·아무 물체)
 */
function updateIdleCircle(dt) {
  const c = app.calib;
  const panelsOpen = ![els.panelSettings, els.panelCalib, els.panelMode, els.panelRank].every((p) => p.classList.contains('hidden'));
  const idle = app.started && !game.running && settings.autoStart && !panelsOpen && !app.calibTarget && !app.areaEditing;
  if (!idle) { c.active = false; c.hold = 0; app.idleHold = 0; autoCal.reset(); $('#btn-replace-puck').classList.add('hidden'); return; }
  c.active = true; c.manual = false; c.target = 'puck';
  c.circle = vision.calibCircle();
  c.registered = app.mouseMode ? { r: 224, g: 60, b: 49, area: 1 } : settings.puckModel.area > 0 ? settings.puckModel : null; // 마우스 모드: 커서가 곧 등록된 퍽
  const circle = c.circle;
  const mapping = app.lastVision?.floor?.mapping;
  let puckInCircle = false;
  if (tracker.state === 'tracked' && tracker.pos && mapping) {
    const [px, py] = mapping.toPx(tracker.pos.x, tracker.pos.y);
    puckInCircle = Math.hypot(px - circle.x, py - circle.y) < circle.r * 1.3;
  }
  if (puckInCircle) {
    // 알고 있는 퍽이 원 안에 있음 -> 시작 카운트다운
    autoCal.reset(); c.status = 'puck'; c.sample = null; c.hold = 0;
    app.idleHold += dt;
    const remain = Math.ceil(3 - app.idleHold);
    if (remain !== app.idleTick && remain > 0) { app.idleTick = remain; sfx.tick(); }
    if (app.idleHold >= 3) {
      app.idleHold = 0; app.idleTick = -1;
      close(els.panelResult);
      startRun({ handsFree: true });
    }
    return;
  }
  app.idleHold = 0; app.idleTick = -1;
  if (app.mouseMode) { autoCal.reset(); c.hold = 0; c.status = 'none'; c.sample = null; return; } // 마우스 모드: 물체 학습 없음
  const sample = vision.autoCalibSample();
  const registered = settings.puckModel.area > 0;
  const decision = decideIdle({ registered, puckInCircle: false, sample, model: settings.puckModel, tol: settings.puckTol });
  c.sample = sample;
  if (decision === 'learn' || decision === 'refresh') {
    // 등록된 퍽이 없으면 첫 물체 학습, 같은 색의 퍽이 추적만 안 되면 크기·색 갱신
    const done = autoCal.update(sample, dt);
    c.hold = autoCal.hold; c.status = decision === 'learn' ? autoCal.status : 'refresh';
    if (done) commitLearnedModel('puck', done, decision === 'refresh');
  } else {
    // mismatch / too_big / wait: 학습하지 않음
    autoCal.reset(); c.hold = 0; c.status = decision;
    if (decision === 'mismatch') c.mismatchFor = (c.mismatchFor || 0) + dt; else c.mismatchFor = 0;
  }
  // 다른 물체가 0.7초 이상 안정적으로 보이면 '이 물체로 교체' 버튼 표시
  $('#btn-replace-puck').classList.toggle('hidden', !(decision === 'mismatch' && c.mismatchFor > 0.7));
}

function commitLearnedModel(target, done, refresh = false) {
  const model = { r: done.r, g: done.g, b: done.b, area: done.area };
  $('#btn-replace-puck').classList.add('hidden');
  if (target === 'puck') {
    settings.puckModel = model; settings.puckTol = done.tol;
    vision.seedPuck(done.cx, done.cy, done.area); tracker.reset();
    $('#set-puckTol').value = done.tol; $('#out-puckTol').value = done.tol;
  } else {
    settings.stickModel = model; settings.stickTol = done.tol;
    $('#set-stickTol').value = done.tol; $('#out-stickTol').value = done.tol;
  }
  autoCal.reset();
  persist(); refreshCalibUI();
  sfx.target();
  if (app.setup === 'puck' && target === 'puck') { finishSetup(); toast(`퍽 등록 완료 · 크기 ${model.area}px · 게임을 고르세요`, 3500); return; }
  if (refresh) toast(`등록된 퍽을 다시 인식했습니다 (크기 ${model.area}px) · 원 안에 3초 더 두면 시작`, 3500);
  else toast(`${target === 'puck' ? '퍽' : '스틱'} 등록 완료 · rgb(${model.r},${model.g},${model.b}) · 크기 ${model.area}px${target === 'puck' ? ' · 원 안에 3초 더 두면 시작' : ''}`, 4000);
}

// =============== HUD ===============
function updateHud(force) {
  const who = app.account?.current();
  els.hudMode.textContent = game.mode.name + (app.versus ? ` · ${app.versus.names[app.versus.current]}` : who ? ` · ${who.nick}` : '');
  const ch = game.mode.id === 'free' ? app.challenge : null;
  els.hudInstruction.textContent = game.running ? game.instruction
    : !app.started ? '' : ch ? `도전 · ${ch.title}${ch.holder ? ` · 1위 평균 ${ch.holder.avg.toFixed(1)}s` : ''}` : '시작을 누르세요';
  $('#app').classList.toggle('playing', game.running);
  if (game.limit > 0) {
    const t = Math.ceil(game.running ? game.timeLeft : game.limit);
    els.hudTimer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    els.hudTimer.classList.toggle('urgent', game.running && t <= 5);
  } else {
    els.hudTimer.classList.remove('urgent');
    const e = game.running ? game.elapsed : 0;
    els.hudTimer.textContent = `${Math.floor(e / 60)}:${String(Math.floor(e % 60)).padStart(2, '0')}`;
  }
  els.hudScore.textContent = String(game.score);
  els.hudLives.textContent = game.running && game.mode.timed && game.hits > 0 ? `충돌 ${game.hits}` : '';
  // 자유 연습 코스: 사이클 진행(완료/목표)과 평균·가장 빠른 사이클 시간
  const courseOn = game.mode.id === 'free' && game.course.points.length > 0;
  $('.hud-right .hud-label').textContent = courseOn ? 'Cycle' : 'Score';
  els.hudLives.classList.toggle('info', courseOn);
  if (courseOn) {
    const lt = (game.running && game.stats.lapTimes) || [];
    els.hudScore.textContent = `${game.running ? game.stats.laps || 0 : 0}/${game.course.cycles}`;
    els.hudLives.textContent = lt.length ? `평균 ${(lt.reduce((a, b) => a + b, 0) / lt.length).toFixed(1)}s · 최고 ${Math.min(...lt).toFixed(1)}s` : '';
  }
  if (game.mode.id === 'arcade' && game.running) {
    const a = game.arcade;
    els.hudCombo.textContent = a.streak >= 2 ? `연속 ${a.streak}` : '';
  } else els.hudCombo.textContent = '';
  els.btnStart.textContent = game.running ? '중지' : '시작';
  els.btnStart.classList.toggle('stop', game.running);
  if (force) els.btnFloorLock.classList.toggle('active', vision.floorLocked);
}

function updateChips(result) {
  setChip(els.chipFloor, result.floor.mapping ? (result.floor.detected || result.floor.fallback || result.floor.mode === 'full' ? 'ok' : 'warn') : 'bad',
    result.floor.mode === 'manual' ? '영역(사다리꼴)' : result.floor.mode === 'full' || result.floor.fallback ? '영역(전체화면)' : vision.floorLocked ? '바닥(고정)' : '바닥(흰색)');
  const stickCtl = settings.controller === 'stick';
  if (app.mouseMode) {
    setChip(els.chipPuck, mouse.has ? 'ok' : 'warn', '마우스(조작)');
    setChip(els.chipStick, '', '스틱(마우스 모드)');
    els.chipFps.textContent = `${app.fps} fps`;
    return;
  }
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
  if (app.calib.manual) cancelAutoCalibration();
  app.calib.active = false;
  if (!app.lastVision?.floor?.mapping) { toast('바닥이 인식되지 않았습니다. 흰 바닥이 보이게 카메라를 조정하거나 설정에서 수동 지정하세요.'); return; }
  if (settings.controller === 'stick' && !settings.stickModel) { toast('조작 대상이 스틱입니다. 보정에서 스틱 색을 먼저 지정하세요.'); return; }
  if (game.mode.id !== 'free' && tracker.state === 'lost') { toast(settings.controller === 'stick' ? '스틱 블레이드가 인식(마름모 표시)된 뒤 시작하세요.' : '퍽이 인식(빨간 점 표시)된 뒤 시작하세요.'); }
  tracker.resetStats();
  game.start(tracker, opts);
  if (settings.puckOpacity < 100) toast(settings.puckOpacity === 0 ? '내 퍽 표시 0% — 화면에 퍽이 보이지 않습니다. 감각으로!' : `내 퍽 표시 ${settings.puckOpacity}%`, 2600);
  updateHud();
}

game.onEnd = (result) => {
  result.versus = !!app.versus;
  app.lastResult = result;
  const isBest = result.mode.id !== 'free' && result.reason !== 'manual' ? saveBest(result.rankKey || result.mode.id, result.score) : false;
  showResult(result, isBest);
  submitResult(result);
  renderShare(result);
  updateHud();
};

function showResult(result, isBest) {
  let title = result.mode.timed ? `${result.mode.name} · ${Math.round(result.limit / 60)}분` : result.mode.name;
  if (result.reason === 'time') title += ' — Time up';
  if (result.reason === 'done') title += ' — Complete';
  const body = [];
  if (isBest) body.push(`<div class="stat full winner"><small>New best</small><b>${result.score}</b></div>`);
  for (const [k, v] of result.items) { if (isBest && k === '점수') continue; body.push(`<div class="stat"><small>${k}</small><b>${v}</b></div>`); }

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
      els.btnAgain.querySelector('.choice-label').textContent = '다시 대결';
      app.versus = { names: vs.names, scores: [], current: 0 };
    }
  } else {
    els.btnNext.classList.add('hidden');
    els.btnAgain.classList.remove('hidden');
    els.btnAgain.querySelector('.choice-label').textContent = '한 번 더';
  }
  els.resultTitle.textContent = title;
  els.resultBody.innerHTML = body.join('');
  app.choice = { side: null, hold: 0, tick: -1, armAt: performance.now() + 800 }; // 결과가 뜬 직후 0.8초는 세지 않음
  paintChoice(null);
  open(els.panelResult);
}

// =============== 커뮤니티 ===============
function setupCommunity() {
  community = initCommunity({
    getUser: () => app.account?.current() || null,
    getStore: () => app.communityStore,
    toast,
    modeName: (id) => MODES.find((m) => m.id === id)?.name || id,
    countryLabel,
    shareDraft,
    onPractice: practicePost,
    onChallengeMode: challengeMode,
    onOpen: () => { close(els.panelMode); close(els.panelResult); },
  });
}

/** 지금 공유할 수 있는 것: 자유 연습의 현재 코스(+이 코스로 세운 내 기록), 방금 끝낸 게임의 점수 */
function shareDraft() {
  const sig = courseSig(settings.course, settings.courseCycles);
  const cr = settings.courseRecord && settings.courseRecord.sig === sig ? { avg: settings.courseRecord.avg, best: settings.courseRecord.best } : null;
  const r = app.lastResult;
  const ranked = r && r.mode.id !== 'free' && (r.reason === 'time' || r.reason === 'done') && !r.versus;
  return {
    course: settings.course.length >= 2 ? { points: settings.course.map((p) => ({ n: p.n, x: p.x, y: p.y })), cycles: settings.courseCycles, record: cr } : null,
    result: ranked ? { modeId: r.mode.id, seconds: r.mode.timed ? r.limit : 0, score: r.score } : null,
  };
}

/** 공유된 코스를 불러와 자유 연습으로 도전 (완주하면 그 글의 기록 게시판에 오른다) */
function practicePost(post) {
  if (game.running) game.stop('manual');
  app.challenge = null;
  app.versus = null;
  settings.course = post.course.map((p) => ({ n: p.n, x: p.x, y: p.y }));
  game.setMode('free');
  setCycles(post.cycles);
  syncCourse();
  const top = boardOf(post)[0] || null;
  app.challenge = { id: post.id, title: post.title, sig: courseSig(settings.course, settings.courseCycles), holder: top ? { uid: top.uid, nick: top.nick, avg: top.avg, best: top.best } : null };
  closeAllPanels();
  updateHud();
  toast(`'${post.title}' 도전 — ${game.course.points[0].n}번에 퍽을 2초 두면 시작`, 4000);
}

/** 기록 자랑 글의 '나도 도전': 같은 모드·같은 시간으로 맞춘다 */
function challengeMode(post) {
  const m = MODES.find((x) => x.id === post.modeId);
  if (!m) return;
  if (game.running) game.stop('manual');
  if (m.timed && PLAY_MINUTES.includes(post.seconds / 60)) { settings.playMinutes = post.seconds / 60; game.playSeconds = post.seconds; persist(); }
  app.versus = null;
  game.setMode(m.id);
  game.resetState();
  closeAllPanels();
  updateHud();
  toast(`${m.name} — ${post.score}점에 도전!`, 4000);
}

/** 결과 화면 아래: 커뮤니티에 공유하기 / 코스 도전 결과(기록 게시판 등록) */
async function renderShare(result) {
  const box = $('#result-share');
  box.classList.add('hidden'); box.innerHTML = '';
  if (result.versus || (result.reason !== 'time' && result.reason !== 'done')) return;
  const show = (html, btnLabel, onClick) => {
    box.innerHTML = `<div class="share-msg">${html}</div>${btnLabel ? `<button type="button" class="btn" id="btn-share">${btnLabel}</button>` : ''}`;
    if (btnLabel) $('#btn-share').addEventListener('click', onClick);
    box.classList.remove('hidden');
  };
  if (result.mode.id !== 'free') {
    show('<span>이 기록을 커뮤니티에 자랑해 보세요</span>', '기록 자랑하기', () => community.compose({ type: 'record' }));
    return;
  }
  const c = result.cycles;
  if (result.reason !== 'done' || !c || c.avg == null || game.course.points.length < 2) return;
  const rec = { avg: c.avg, best: c.best };
  const sig = courseSig(game.course.points, c.target);
  const prev = settings.courseRecord && settings.courseRecord.sig === sig ? settings.courseRecord : null;
  if (betterRecord(rec, prev)) { settings.courseRecord = { sig, avg: rec.avg, best: rec.best, at: Date.now() }; persist(); } // 이 코스의 내 최고 기록
  const ch = app.challenge && app.challenge.sig === sig ? app.challenge : null;
  if (!ch) {
    show('<span>이 코스와 기록을 커뮤니티에 공유해 보세요</span>', '코스 공유하기', () => community.compose({ type: 'course' }));
    return;
  }
  // ---- 코스 도전 결과 ----
  const s1 = (v) => `${v.toFixed(1)}s`;
  const u = app.account?.current();
  const openBoard = () => community.open('course');
  if (!u) {
    const h = ch.holder ? ` <span>1위</span> <b data-ugc>${esc(ch.holder.nick)}</b> <strong>평균 ${s1(ch.holder.avg)}</strong>` : '';
    show(`<span>이번 기록 평균 ${s1(rec.avg)}</span>${h} <span>로그인하면 기록 게시판에 올라갑니다</span>`, '기록 게시판 보기', openBoard);
    return;
  }
  try {
    const store = await app.communityStore;
    const r = await store.submitRecord(u, ch.id, rec);
    const ph = r.prevHolder;
    if (r.isHolder && r.improved && ph && ph.uid !== u.id) {
      sfx.target?.();
      const beatTitle = tr(`${tr(ch.title)} 기록 갱신!`);
      show(`<span class="script">New record!</span> <span>갈아치운 기록</span> <b data-ugc>${esc(ph.nick)}</b> <strong>평균 ${s1(ph.avg)} → ${s1(rec.avg)}</strong>`,
        '기록 갱신 자랑하기', () => community.compose({
          type: 'beat', title: beatTitle.length <= TITLE_MAX ? beatTitle : tr('기록 갱신!'),
          ref: { id: ch.id, title: ch.title, nick: ph.nick, avg: ph.avg },
          course: { points: game.course.points.map((p) => ({ n: p.n, x: p.x, y: p.y })), cycles: c.target, record: rec },
        }));
    } else if (r.isHolder && r.improved && !ph) {
      show(`<span class="script">First record!</span> <span>이 코스의 첫 기록 보유자가 되었습니다</span> <strong>평균 ${s1(rec.avg)}</strong>`, '기록 게시판 보기', openBoard);
    } else if (r.isHolder && r.improved) {
      show(`<span class="script">New best!</span> <span>내 기록을 고쳐 썼습니다 — 여전히 1위</span> <strong>평균 ${s1(rec.avg)}</strong>`, '기록 게시판 보기', openBoard);
    } else if (r.isHolder) {
      show(`<span>기록 보유자 유지 — 이번 평균 ${s1(rec.avg)}</span>`, '기록 게시판 보기', openBoard);
    } else {
      const top = ph || ch.holder;
      const gap = top ? ` <span>1위</span> <b data-ugc>${esc(top.nick)}</b> <strong>평균 ${s1(top.avg)}</strong> <span>까지 ${s1(Math.max(0, rec.avg - top.avg))}</span>` : '';
      show(`<span>${r.rank}위 / ${r.total}명</span>${r.improved ? ' <span>내 최고 기록 갱신</span>' : ''}${gap}`, '기록 게시판 보기', openBoard);
    }
    // 다음 도전을 위해 1위 정보를 새로 고침
    const fresh = await store.get(ch.id);
    const top = fresh ? boardOf(fresh)[0] : null;
    if (app.challenge === ch) ch.holder = top ? { uid: top.uid, nick: top.nick, avg: top.avg, best: top.best } : null;
  } catch (err) {
    show(`<span>기록 등록 실패: ${esc(err.message || err)}</span>`, null);
  }
}

function renderModeList() {
  const scores = loadScores();
  els.modeList.innerHTML = '';
  $$('#time-seg button').forEach((b) => b.classList.toggle('active', Number(b.dataset.min) === settings.playMinutes));
  // 3×3 배치: 1 2 3 / 4 (가운데 비움: 퍽 대기) 6 / 7 8 9(커뮤니티)
  const CELLS = [0, 1, 2, 3, 'wait', 4, 5, 6, 'community'];
  CELLS.forEach((cell, pos) => {
    const no = String(pos + 1).padStart(2, '0');
    if (cell === 'wait') { const w = document.createElement('div'); w.className = 'mode-wait'; w.innerHTML = '<i></i><span>puck</span>'; els.modeList.appendChild(w); return; }
    if (cell === 'community') {
      // 9번: 커뮤니티 (코스·기록 공유). 다른 카드처럼 퍽으로도 고를 수 있다
      const card = document.createElement('button');
      card.className = 'mode-card mode-community';
      card.innerHTML = `<span class="no">${no}</span><span class="time">Share</span><b>커뮤니티</b><em>Community</em><small>내가 만든 코스와 기록을 공유하고, 다른 사람의 코스에 도전해 기록을 겨뤄 보세요.</small>`;
      card.addEventListener('click', () => { close(els.panelMode); community.open(); });
      els.modeList.appendChild(card);
      return;
    }
    const m = MODES[cell], i = pos;
    const card = document.createElement('button');
    card.className = 'mode-card' + (m.id === game.mode.id ? ' selected' : '');
    const key = rankKey(m.id, game.playSeconds);
    const best = scores[key] !== undefined ? `<span class="best">best ${scores[key]}</span>` : '';
    const time = m.timed ? `${settings.playMinutes}분` : m.duration ? `${m.duration}초` : '자유';
    card.innerHTML = `<span class="no">${String(i + 1).padStart(2, '0')}</span><span class="time">${time}</span><b>${m.name}</b><em>${m.en}</em><small>${m.desc}</small>${best}`;
    card.addEventListener('click', () => {
      if (game.running) game.stop('manual');
      game.setMode(m.id);
      if (els.versusToggle.checked) {
        app.versus = { names: [els.p1.value.trim() || '플레이어 1', els.p2.value.trim() || '플레이어 2'], scores: [], current: 0 };
        if (m.id === 'free') { app.versus = null; toast('자유 연습은 대결 모드를 지원하지 않습니다'); }
      } else app.versus = null;
      close(els.panelMode);
      updateHud();
      if (app.afterStart) {
        app.afterStart = false;
        toast(app.mouseMode ? `${m.name} 선택됨 · 커서를 가운데 원에 3초 두거나 시작을 누르세요` : `${m.name} 선택됨 · 퍽을 가운데 원 안에 놓고 3초 기다리세요`, 5000);
      } else toast(`${m.name} 선택됨`);
    });
    els.modeList.appendChild(card);
  });
  els.p1.value = tr(settings.p1); els.p2.value = tr(settings.p2);
}

// =============== 영역 (원근 사다리꼴) ===============
function defaultTrapezoid() { return [[0.22, 0.18], [0.78, 0.18], [0.98, 0.96], [0.02, 0.96]]; }

/** 현재 영역(자동 감지 결과 포함)을 수동 사다리꼴로 가져와 편집 시작 */
function toggleAreaEdit() {
  if (app.areaEditing) { endAreaEdit(); return; }
  if (game.running) game.stop('manual');
  closeAllPanels();
  const q = app.lastVision?.floor?.quad;
  if (q && settings.floorMode !== 'manual') {
    settings.manualQuad = q.map(([x, y]) => [clamp(x / vision.PW, 0, 1), clamp(y / vision.PH, 0, 1)]);
  } else if (!settings.manualQuad) settings.manualQuad = defaultTrapezoid();
  settings.floorMode = 'manual';
  $('#set-floorMode').value = 'manual';
  persist();
  app.areaEditing = true;
  app.calib.active = false; app.idleHold = 0;
  applyFloorMode();
  $('#area-bar').classList.remove('hidden');
  els.btnFloorLock.classList.add('active');
  if (app.setup !== 'area') toast('모서리를 드래그해 바닥에 맞추세요 (뒤쪽 좁게, 앞쪽 넓게)', 4000); // 시작 준비 중에는 위 막대가 안내
}

function endAreaEdit(announce = true) {
  app.areaEditing = false;
  $('#area-bar').classList.add('hidden');
  els.handles.classList.add('hidden');
  els.btnFloorLock.classList.remove('active');
  persist();
  if (app.setup === 'area') { beginPuckSetup(); return; } // 시작 준비 중: 다음 단계 (퍽 등록)
  if (announce) toast('영역 저장됨. 퍽을 원 안에 두면 시작합니다');
}

function applyFloorMode() {
  const manual = settings.floorMode === 'manual';
  if (manual && !settings.manualQuad) {
    // 자동 감지 결과(사다리꼴)가 있으면 그대로, 없으면 기본 사다리꼴
    const q = app.lastVision?.floor?.quad;
    settings.manualQuad = q ? q.map(([x, y]) => [clamp(x / vision.PW, 0, 1), clamp(y / vision.PH, 0, 1)]) : defaultTrapezoid();
    persist();
  }
  // 핸들은 편집 중에만 표시 (플레이 중 터치 방해 방지)
  els.handles.classList.toggle('hidden', !(manual && app.areaEditing));
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
/** 보정 패널의 '원 안에 3초(자동)' 버튼: 지정 대상을 정해 명시적으로 학습 (스틱 포함) */
function beginAutoCalibration(target) {
  if (game.running) game.stop('manual');
  closeAllPanels();
  autoCal.reset();
  app.calib = { active: true, manual: true, target, hold: 0, status: 'none', sample: null, circle: vision.calibCircle() };
  app.calibTarget = null;
  $('#btn-replace-puck').classList.add('hidden');
  els.tapHint.classList.add('hidden');
  app.idleHold = 0;
}

function cancelAutoCalibration(msg) {
  app.calib = { active: false, manual: false, target: 'puck', hold: 0, status: 'none', sample: null, circle: null };
  autoCal.reset();
  if (app.setup === 'puck') { finishSetup(); toast(settings.puckModel.area > 0 ? '등록된 퍽을 그대로 씁니다 · 게임을 고르세요' : '퍽 등록을 건너뛰었습니다 · 게임을 고른 뒤 원 안에 퍽을 두면 등록됩니다', 4000); return; }
  if (msg) toast(msg);
}

function updateAutoCalibration(dt) {
  const c = app.calib;
  c.circle = vision.calibCircle();
  const sample = vision.autoCalibSample();
  const done = autoCal.update(sample, dt);
  c.hold = autoCal.hold; c.status = autoCal.status; c.sample = autoCal.sample;
  if (!done) return;
  const target = c.target;
  app.calib = { active: false, manual: false, target: 'puck', hold: 0, status: 'none', sample: null, circle: null };
  commitLearnedModel(target, done);
}

// =============== 보정 (터치로 색 지정) ===============
function beginCalibration(target) {
  if (app.calib.manual) cancelAutoCalibration();
  app.calibTarget = target;
  close(els.panelCalib);
  els.tapHint.textContent = target === 'puck' ? '화면에서 퍽을 터치하세요' : '화면에서 스틱 블레이드(테이프)를 터치하세요';
  els.tapHint.classList.remove('hidden');
  els.view.classList.add('calibrating');
}

function onViewTap(e) {
  if (app.calib.manual) { if (!e.target.classList.contains('handle')) cancelAutoCalibration('자동 지정 취소'); return; }
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
  $('#set-flipDepth').checked = settings.flipDepth;
  game.arcade.flipY = settings.flipDepth;
  els.debug.classList.toggle('hidden', !settings.debug);
  for (const key of ['whiteV', 'whiteC', 'puckTol', 'stickTol', 'floorWidthM', 'bgTransparency', 'puckOpacity']) {
    $('#set-' + key).value = settings[key]; $('#out-' + key).value = settings[key];
  }
  applyWash();
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

/** 배경 투명도 설정 -> 아케이드·퍽 피하기의 종이 배경 불투명도 */
function applyWash() {
  const alpha = clamp(1 - settings.bgTransparency / 100, 0, 1);
  game.arcade.wash = alpha;
  renderer.wash = alpha;
  // 내 퍽 표시 농도: 플레이 중 화면의 내 퍽을 흐리게/안 보이게 (감각으로 플레이하는 헤드업 훈련)
  const pa = clamp(settings.puckOpacity / 100, 0, 1);
  game.arcade.puckAlpha = pa;
  renderer.puckAlpha = pa;
}

function persist() { saveSettings(settings); }

// =============== 유틸 ===============
function open(panel) { panel.classList.remove('hidden'); els.toast.classList.add('hidden'); } // 창을 열면 떠 있던 안내(토스트)는 치운다
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
