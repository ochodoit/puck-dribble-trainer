// 앱 오케스트레이션: 카메라 -> 영상처리 -> 추적 -> 게임 -> 렌더/HUD
import { isDevHost } from './guard.js'; // 맨 먼저: 공식 주소·내 컴퓨터가 아니면 여기서 멈춤 (복제 사이트·iframe 막기)
import { Camera, CameraRateAuto, describeCameraError } from './camera.js';
import { Vision, AutoCalibrator } from './vision.js';
import { Tracker } from './tracker.js';
import { StickBridge } from './occlusion.js';
import { placementCheck } from './placement.js';
import { Game, MODES, PLAY_MINUTES, rankKey, levelLabel, PUCK_R, F8_HOLD_R } from './game.js';
import { C, rgba } from './theme.js';
import { Renderer, dodgeField, FLOOR_MODES, FLOOR_FLIP_MODES } from './render.js';
import { Sfx } from './audio.js';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, loadScores, saveBest, clearScores } from './storage.js';
import { createAccountStore, COUNTRIES, AGE_GROUPS, countryLabel, jerseyLabel, isAdmin, normCode, codeLabel, codeError, codeStatus, memberBadge, memberNoLabel, instaId, instaDmLink, betaState, isActiveMember, FEEDBACK_MAX, LAPSED, stickLabel, LOTTERY_WINNERS, lotteryPool, drawLottery, couponUntil, passName, EXT_PASS } from './account.js';
import { MouseInput, MOUSE_SRC, pointerToUV, mouseVisionResult } from './mouse-input.js';
import { makeFloorMapping } from './geometry.js';
import { clock, clockNow } from './clock.js';
import { initMe } from './me-ui.js';
import { initMembers } from './members-ui.js';
import { dayKey } from './activity.js';
import { decideIdle, stepChoice, stepDwell, inCardCore, choiceSide, CHOICE_HOLD_S } from './idle-logic.js';
import { initI18n, bindLangButtons, onLangChange, tr, setLang, getLang, missing as i18nMissing, redirecting, langUrl, savedLang, rememberLang } from './i18n.js';
import { createCommunityStore, courseSig, betterRecord, boardOf, bragKey, postAge, canRecordOn, TITLE_MAX } from './community.js';
import { initCommunity } from './community-ui.js';
import { memberStats } from './stats.js';
import { initAnalytics, track } from './analytics.js';
import { initInstall } from './install.js';

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
  panelMode: $('#panel-mode'), modeList: $('#mode-list'), versusToggle: $('#versus-toggle'), invisibleToggle: $('#invisible-toggle'), versusNames: $('#versus-names'), p1: $('#p1-name'), p2: $('#p2-name'),
  panelSettings: $('#panel-settings'), selCamera: $('#sel-camera'), tpPreview: $('#set-preview'),
  panelCalib: $('#panel-calib'), swatchPuck: $('#swatch-puck'), swatchStick: $('#swatch-stick'), calibPuckDesc: $('#calib-puck-desc'), calibStickDesc: $('#calib-stick-desc'),
  panelCommunity: $('#panel-community'),
  panelResult: $('#panel-result'), resultTitle: $('#result-title'), resultBody: $('#result-body'), btnAgain: $('#btn-result-again'), btnNext: $('#btn-result-next'),
  toast: $('#toast'),
};

const settings = loadSettings();
const camera = new Camera(els.video);
const camRateAuto = new CameraRateAuto(); // '카메라 프레임: 자동' — 이 기기가 60을 다 인식하지 못하면 30으로
const vision = new Vision(settings.procWidth);
const tracker = new Tracker();
const stickBridge = new StickBridge(); // 스틱이 퍽을 가린 동안 블레이드로 퍽 자리를 잇는다 (스틱 지정 시)
const sfx = new Sfx();
const game = new Game(sfx);
game.onModeChange = () => applyDepthDirection(); // 앞뒤 방향은 게임마다 다르다 (depthFlip) — 모드를 바꾸는 즉시
const renderer = new Renderer(els.overlay);
const mouse = new MouseInput(); // 카메라 없이 체험: 마우스 포인터나 손가락이 퍽 (누구나)

const app = {
  started: false,
  lastResult: null,
  calibTarget: null,      // 'puck' | 'stick' | null
  versus: null,           // { names:[a,b], scores:[], current:0 }
  fps: 0, frames: 0, fpsAt: 0, procMs: 0, // 초당 인식 프레임, 프레임당 인식 시간(ms)
  lastVideoTime: -1,
  hudAt: 0,
  account: null,      // 계정 저장소 (local | firebase)
  authTab: 'login',
  authStick: null,   // 회원가입 스틱 선택: 'L' | 'R'
  cornerDrag: false, // 영역 편집: 모서리를 끄는 중
  paused: false,     // 옵션 창이 떠서 멈춘 상태
  cover: null,       // 퍽 투명도: 카메라 속 진짜 퍽을 덮는 자리 {x, y, r, rgb, alpha, at} (처리 픽셀 좌표)
  calib: { active: false, manual: false, target: 'puck', hold: 0, status: 'none', sample: null, circle: null }, // 가운데 원: 물체 학습 + 핸즈프리 시작
  calibFromMode: false, // 모드 창에서 시작한 보정이면 끝난 뒤 모드 창으로 돌아간다
  areaReturnMode: false, // 화면 방향이 바뀌어 영역 편집을 열 때 모드 창이 열려 있었으면, 저장 뒤 모드 창으로
  choice: { side: null, hold: 0, tick: -1, armAt: 0 }, // 게임 종료 후 선택 (왼쪽 = 한 번 더, 오른쪽 = 모드 선택)
  challenge: null,    // 커뮤니티 코스 도전 중: { id, title, sig, holder: {uid, nick, avg, best}|null }
  scoreChallenge: null, // 기록 자랑 글의 '나도 연습하기' 중: { id, title, key, score, nick, author, limit }
  communityStore: null, // Promise<커뮤니티 저장소>
  invite: null,         // 초대 링크(?c=코드)로 받은 가입 코드
};
let community = null;   // 커뮤니티 화면 (initCommunity 반환값)
const autoCal = new AutoCalibrator(3);
// init() 안에서 바로 쓰므로 init() 호출보다 위에 둔다 (const는 선언 전에 못 씀)
const INVITE_KEY = 'puck-trainer.invite.v1';
// 설정 창의 슬라이더 (바닥 밝기·채도는 뺐다: 영역을 네 모서리로 정한 뒤로는 인식에 쓰이지 않는다)
const SLIDER_KEYS = ['puckTol', 'stickTol', 'floorWidthM', 'bgTransparency', 'puckTransparency'];

// 디버그/테스트용 훅 (브라우저 콘솔에서 상태 확인: __puckTrainer.tracker 등).
// 내 컴퓨터(localhost)에서 열었을 때만 만든다. 공개 사이트에서는 콘솔로 게임 상태를 바꿔 기록을 조작하는 데 쓰일 수 있어서
if (isDevHost(location)) window.__puckTrainer = { settings, vision, tracker, game, app, mouse, i18n: { tr, setLang, getLang, missing: i18nMissing } };

// =============== 초기화 ===============
if (!redirecting) init(); // 예전에 고른 다른 언어 주소로 옮겨 가는 중이면 시작하지 않음

function init() {
  initAnalytics(); // 방문·플레이 통계 (공식 주소에서만, 개인정보 없이)
  initInstall(); // 바로가기 만들기 버튼 + 오프라인 실행 (서비스 워커, 공식 주소에서만)
  initI18n();
  bindLangButtons(document, pickLang);
  showLangHint();
  onLangChange(() => { renderModeList(); updateHud(true); refreshCalibUI(); if (!els.panelCommunity.classList.contains('hidden')) community?.refresh(); });
  applySettingsToUI();
  bindUI();
  app.invite = readInvite();
  const accountReady = setupAuth();
  app.communityStore = accountReady.then(() => createCommunityStore(app.account));
  setupCommunity();
  setupFeedback();
  game.difficulty = settings.difficulty;
  game.playSeconds = settings.playMinutes * 60;
  game.invisible = settings.invisible;
  game.figure8Dir = settings.figure8Dir;
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
  $$('#auth-stick button').forEach((b) => b.addEventListener('click', () => {
    app.authStick = b.dataset.stick;
    $$('#auth-stick button').forEach((x) => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-checked', String(on)); });
  }));
  els.authForm.addEventListener('submit', onAuthSubmit);
  $('#auth-forgot').addEventListener('click', () => showForgot($('#auth-forgot-box').classList.contains('hidden')));
  $('#auth-guest').addEventListener('click', () => {
    els.authForm.classList.add('hidden'); els.authNote.textContent = '게스트: 기록이 랭킹에 올라가지 않습니다.';
    if (!app.started && !els.btnCamera.disabled) startCamera(); // 게스트로 시작 = 바로 카메라 시작
  });
  $('#btn-logout').addEventListener('click', doLogout);
  $('#auth-cancel').addEventListener('click', doLogout); // 예전 계정: 아이디를 만들지 않고 나가기
  $('#btn-settings-logout').addEventListener('click', doLogout);
  // 랭킹 기록: 최고 기록을 못 넘은 판의 판수는 모아 두었다가, 화면을 떠날 때(탭 전환·앱 닫기) 한 번에 쓴다
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') app.account?.flushPlays?.().catch(() => {}); });
  $('#btn-settings-login').addEventListener('click', openLogin);
  $('#btn-me').addEventListener('click', openMe);
  $('#btn-me-splash').addEventListener('click', openMe);
  els.btnRank.addEventListener('click', () => openRank());
  [els.rankMode, els.rankAge, els.rankScope, $('#rank-time'), $('#rank-variant'), $('#rank-level')].forEach((e) => e.addEventListener('change', () => renderRank()));
  MODES.filter((m) => m.id !== 'free').forEach((m) => { const o = document.createElement('option'); o.value = m.id; o.textContent = m.name; els.rankMode.appendChild(o); });
  PLAY_MINUTES.forEach((min) => { const o = document.createElement('option'); o.value = String(min * 60); o.textContent = `${min}분`; $('#rank-time').appendChild(o); });
  AGE_GROUPS.forEach((g) => { const o = document.createElement('option'); o.value = g; o.textContent = g; els.rankAge.appendChild(o); });

  app.account = await createAccountStore();
  if (window.__puckTrainer) window.__puckTrainer.account = app.account;
  app.site = await app.account.getSiteConfig().catch(() => ({})); // 게스트 안내 · 베타 종료일
  els.authNote.textContent = app.account.kind === 'firebase'
    ? '온라인 랭킹 — 모든 기기의 기록이 함께 집계됩니다.'
    : '기록은 이 기기에 저장됩니다. 여러 선수가 같은 기기로 겨룰 수 있어요.';
  refreshAuthUI();
  setupAdmin();
  setupMe();
  setupMembers();
  showInvite();
}

// =============== 초대 링크 · 가입 코드 ===============
/** 주소의 ?c=코드 를 읽어 기억하고 주소에서는 지운다 (새로고침해도 가입 칸에 남게) */
function readInvite() {
  let code = null;
  try {
    const url = new URL(location.href);
    const c = url.searchParams.get('c');
    if (c) {
      code = normCode(c);
      localStorage.setItem(INVITE_KEY, code);
      url.searchParams.delete('c');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    } else code = localStorage.getItem(INVITE_KEY);
  } catch { /* 저장 불가 */ }
  return code || null;
}

/**
 * 언어 버튼: 첫 화면에서는 그 언어의 주소(/ 또는 /en/)로 옮겨 간다 (검색엔진이 언어마다 따로 본다).
 * 게임을 시작한 뒤(설정 창)에는 그 자리에서 바꾼다 — 카메라·진행 중인 판이 끊기지 않게
 */
function pickLang(l) {
  if (app.started) { setLang(l); return; }
  if (l === getLang()) return;
  rememberLang(l);
  location.assign(langUrl(l));
}

/** 처음 온 사람의 브라우저 언어가 이 페이지와 다르면 다른 언어 주소를 한 줄로 알려 준다 (직접 고른 적이 있으면 숨김) */
function showLangHint() {
  const hint = $('#lang-hint');
  if (!hint) return;
  const nav = /^ko\b/i.test(navigator.language || '') ? 'ko' : 'en';
  hint.classList.toggle('hidden', !!savedLang() || nav === getLang());
}

function forgetInvite() {
  app.invite = null;
  try { localStorage.removeItem(INVITE_KEY); } catch { /* ignore */ }
  $('#invite-card').classList.add('hidden');
}

const shortDate = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}월 ${d.getDate()}일`; };

/** 초대 카드: 코드 종류·상태에 따라 '오픈베타 초대 링크예요', '○○님의 초대 링크예요' 등. 쓸 수 있으면 회원가입 칸을 열고 코드를 채운다 */
async function showInvite() {
  const card = $('#invite-card');
  card.classList.add('hidden');
  if (!app.invite || !app.account || app.account.current() || app.account.needsUpgrade?.()) return;
  const info = await app.account.checkCode(app.invite);
  const ok = info.status === 'ok', end = app.site?.betaEndsAt;
  const left = info.maxUses > 0 ? `남은 자리 ${Math.max(0, info.maxUses - info.uses)}명` : '';
  const until = end ? `정회원 기간 ${shortDate(end)}까지` : '';
  const line = (...parts) => parts.filter(Boolean).join(' · ');
  let title, sub;
  if (ok && info.type === 'beta') { title = '오픈베타 초대 링크예요'; sub = line(info.expiresAt ? `${shortDate(info.expiresAt)}까지 가입하면 바로 정회원` : '지금 가입하면 바로 정회원', left); }
  else if (ok && info.type === 'invite') { title = info.nick ? `${info.nick}님의 초대 링크예요` : '친구 초대 링크예요'; sub = line('가입하면 바로 정회원', until, left); }
  else if (ok) { title = '정회원 초대 코드예요'; sub = line('가입하면 바로 정회원이 됩니다', until); }
  else {
    title = info.status === 'expired' ? '마감된 링크예요' : info.status === 'error' ? codeError('error') : info.status === 'full' ? (info.type === 'beta' ? '오픈베타 인원이 다 찼어요' : codeError('full', info)) : '쓸 수 없는 코드예요';
    sub = '정회원 친구에게 초대 링크를 받거나, 게스트로 한 판을 끝내고 결과 화면의 가입 방법을 보세요';
  }
  $('#invite-title').textContent = title;
  $('#invite-sub').textContent = sub;
  card.classList.toggle('bad', !ok);
  card.classList.remove('hidden');
  if (ok) { setAuthTab('register'); $('#auth-code').value = codeLabel(info.code); }
}

/**
 * 로그인 칸 모드: login(아이디 + 비밀번호), register(아이디·비밀번호·확인·별명·프로필),
 * upgrade(로그인했지만 아직 못 들어온 계정: 탭·게스트 버튼을 숨기고 로그아웃 버튼만)
 *   - 예전 별명 계정(kind 'id'): 아이디·새 비밀번호 만들기
 *   - 임시 비밀번호 계정(kind 'password', 운영자가 재설정): 새 비밀번호만 정하기 (아이디 칸 숨김)
 */
function setAuthTab(tab) {
  app.authTab = tab;
  const reg = tab === 'register', up = tab === 'upgrade';
  const pend = up ? app.account?.needsUpgrade?.() : null, temp = pend?.kind === 'password';
  $$('.auth-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  $$('.reg-only').forEach((e) => e.classList.toggle('hidden', !reg));
  $$('.login-only').forEach((e) => e.classList.toggle('hidden', tab !== 'login'));
  $$('.upgrade-only').forEach((e) => e.classList.toggle('hidden', !up));
  $$('.upgrade-id-only').forEach((e) => e.classList.toggle('hidden', !up || temp));
  $$('.upgrade-pw-only').forEach((e) => e.classList.toggle('hidden', !temp));
  $('#auth-id-label').classList.toggle('hidden', temp);
  $('#auth-id').required = !temp;
  if (tab !== 'login') showForgot(false);
  $$('.new-pw').forEach((e) => e.classList.toggle('hidden', !reg && !up));
  $('#auth-tabs').classList.toggle('hidden', up);
  $('#auth-guest').classList.toggle('hidden', up);
  if (up) $('#auth-upgrade-nick').textContent = pend?.nick || '';
  if (temp) $('#auth-temp-id').textContent = pend.loginId || '';
  els.authSubmit.textContent = reg ? '가입하고 시작' : temp ? '새 비밀번호 정하기' : up ? '아이디 만들기' : '로그인';
  $('#auth-id').placeholder = up || reg ? '4~20자, 영문 소문자로 시작' : '예: puckking07';
  $('#auth-pin').setAttribute('autocomplete', reg || up ? 'new-password' : 'current-password');
  $('#auth-pin').placeholder = up ? (pend?.admin ? '새 비밀번호 (12자 이상, 영문+숫자)' : '새 비밀번호 (8자 이상, 영문+숫자)') : reg ? '8자 이상, 영문+숫자' : '영문·숫자 비밀번호';
  els.authError.classList.add('hidden');
}

/** 로그인 칸의 '비밀번호를 잊었어요': 메일로 찾을 수 없으니 공식 인스타 DM으로 운영자에게 (임시 비밀번호를 받음) */
function showForgot(on) {
  const box = $('#auth-forgot-box');
  box.classList.toggle('hidden', !on);
  $('#auth-forgot').setAttribute('aria-expanded', String(on));
  if (!on) return;
  const sns = instaId(app.site?.snsAccount);
  $('#auth-forgot-dm').innerHTML = sns
    ? `<a class="btn btn-primary" href="${esc(instaDmLink(sns))}" target="_blank" rel="noopener">인스타 DM 보내기</a> <span data-ugc>@${esc(sns)}</span>`
    : '<span class="muted">공식 인스타 주소를 아직 정하지 않았습니다. 가입 코드를 받은 곳으로 문의해 주세요.</span>';
  track('forgot_password');
}

async function onAuthSubmit(e) {
  e.preventDefault();
  if (!app.account) return;
  const loginId = $('#auth-id').value, password = $('#auth-pin').value, tab = app.authTab;
  const fail = (msg) => { els.authError.textContent = msg; els.authError.classList.remove('hidden'); };
  if ((tab === 'register' || tab === 'upgrade') && password !== $('#auth-pin2').value) { fail('비밀번호가 서로 다릅니다'); return; }
  els.authSubmit.disabled = true;
  try {
    if (tab === 'register') {
      await app.account.register({ loginId, password, nick: $('#auth-nick').value, country: $('#auth-country').value, team: $('#auth-team').value, age: $('#auth-age').value, number: $('#auth-number').value, code: $('#auth-code').value, stick: app.authStick });
      forgetInvite();
      $('#auth-code').value = '';
      toast(`환영합니다, ${app.account.current().nick}! ${memberBadge(app.account.current())}`, 4000);
      track('sign_up', { method: ['beta', 'invite'].includes(app.account.current()?.via) ? app.account.current().via : 'one' });
    } else if (tab === 'upgrade' && app.account.needsUpgrade?.()?.kind === 'password') {
      await app.account.resetTempPassword(password);
      toast('새 비밀번호로 바꿨습니다. 다음부터 새 비밀번호로 로그인하세요', 4000);
      track('login', { method: 'temp' });
    } else if (tab === 'upgrade') {
      await app.account.upgradeLogin(loginId, password);
      toast('아이디를 만들었습니다. 다음부터 아이디로 로그인하세요', 4000);
      track('login', { method: 'upgrade' });
    } else {
      await app.account.login(loginId, password);
      if (app.account.needsUpgrade?.()) { // 예전 별명 계정(아이디·새 비밀번호) 또는 임시 비밀번호(새 비밀번호)를 정해야 로그인 완료
        $('#auth-id').value = '';
        setAuthTab('upgrade');
      } else track('login', { method: 'id' });
    }
    $('#auth-pin').value = ''; $('#auth-pin2').value = '';
    els.authError.classList.add('hidden');
    refreshAuthUI();
    if (app.authTab === 'upgrade') (app.account.needsUpgrade?.()?.kind === 'password' ? $('#auth-pin') : $('#auth-id')).focus();
  } catch (err) {
    // 로그인이 오래돼 내보내졌으면(다시 로그인해야 함) 로그인 칸으로 돌아가 안내한다
    if (tab === 'upgrade' && !app.account.needsUpgrade?.()) refreshAuthUI();
    fail(err.message || String(err));
  } finally { els.authSubmit.disabled = false; }
}

function doLogout() {
  app.account?.logout();
  refreshAuthUI();
  toast('로그아웃했습니다');
}

/** 게임 중(게스트) 로그인: 첫 화면의 로그인 카드를 로그인 창으로 잠시 옮겨 쓴다 (닫으면 제자리로) */
function openLogin() {
  const card = $('#auth-card');
  if (!app.authHome) app.authHome = { parent: card.parentNode, next: card.nextSibling };
  $('#login-slot').appendChild(card);
  card.classList.remove('hidden');
  setAuthTab('login');
  close(els.panelSettings);
  open($('#panel-login'));
  $('#auth-id').focus();
}
function restoreAuthCard() {
  const h = app.authHome;
  if (!h) return;
  h.parent.insertBefore($('#auth-card'), h.next);
  app.authHome = null;
}

function refreshAuthUI() {
  const u = app.account?.current();
  els.authLogged.classList.toggle('hidden', !u);
  els.authForm.classList.toggle('hidden', !!u);
  if (u) els.authWho.innerHTML = `<b>${esc(u.nick)}</b>${u.number != null ? ` <span class="jersey">${jerseyLabel(u.number)}</span>` : ''} <span class="member-badge">${esc(memberBadge(u))}</span>${u.stick ? ' · ' + stickLabel(u.stick) : ''} · ${esc(u.team)} · ${esc(countryLabel(u.country))} · ${esc(u.ageGroup)} (${u.age}세)${betaChipHtml()}`;
  $('#settings-account').textContent = u ? `로그인: ${[u.nick, jerseyLabel(u.number)].filter(Boolean).join(' ')} (${u.team}, ${u.ageGroup})${u.stick ? ' · ' + stickLabel(u.stick) : ''}` : '로그인하지 않음 (랭킹 미등록)';
  $('#btn-settings-logout').classList.toggle('hidden', !u);
  $('#btn-settings-login').classList.toggle('hidden', !!u || !app.account); // 게스트로 플레이 중에도 설정에서 로그인
  if (u && !$('#panel-login').classList.contains('hidden')) close($('#panel-login'));
  noteAttendance(); // 게임 중에 로그인한 날도 출석
  $('#btn-admin').classList.toggle('hidden', !isAdmin(u));
  $('#btn-settings-admin').classList.toggle('hidden', !isAdmin(u));
  refreshMouseButton();
  if (!u) {
    const up = !!app.account?.needsUpgrade?.();
    setAuthTab(up ? 'upgrade' : app.authTab === 'upgrade' ? 'login' : app.authTab);
    els.authForm.classList.remove('hidden');
  }
  else $('#invite-card').classList.add('hidden');
}

/**
 * 정회원 기간 칩: 베타 기간 중 '정회원 ○월 ○일까지 · 의견 보내고 3개월 이용권 추첨', 보냈으면 '추첨 응모 완료',
 * 이용권 당첨 '3개월 이용권 · ○월 ○일까지', 운영자 유지 '정회원 유지', 베타가 끝났으면 '베타 종료'
 */
function betaChipHtml() {
  const u = app.account?.current();
  const st = app.account?.memberState?.() || 'guest';
  const end = app.site?.betaEndsAt;
  if (u?.until && (st === 'beta' || st === 'coupon')) return ` <span class="beta-chip ok">${passName(u)} · ${shortDate(u.until)}까지</span>`;
  if (st === 'beta' && end && u?.feedbackAt) return ` <span class="beta-chip ok">정회원 ${shortDate(end)}까지 · 이용권 추첨 응모 완료</span>`;
  if (st === 'beta' && end) return ` <button type="button" class="beta-chip" data-feedback>정회원 ${shortDate(end)}까지 · 의견 보내고 3개월 이용권 추첨</button>`;
  if (st === 'kept' && end) return ' <span class="beta-chip ok">정회원 유지</span>';
  if (st === 'lapsed') return ' <span class="beta-chip bad">베타 종료 · 정회원 기간 끝남</span>';
  return '';
}
/** 로그인했지만 베타가 끝나 정회원이 유지되지 않은 계정인가 (랭킹·글쓰기 막힘) */
const lapsedNow = () => !!app.account?.current() && !isActiveMember(app.account.memberState());

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
  $('#rank-variant').value = settings.invisible ? 'inv' : '';
  $('#rank-level').value = settings.difficulty;
  open(els.panelRank);
  await renderRank();
}

async function renderRank() {
  if (!app.account) return;
  const rm = MODES.find((m) => m.id === els.rankMode.value);
  $('#rank-time').classList.toggle('hidden', !rm?.timed);
  $('#rank-level').classList.toggle('hidden', !rm?.levels);
  // 시간제 모드는 시간별, 투명 모드는 따로, 난이도가 있는 모드(아케이드·퍽 피하기)는 난이도별로 따로
  const mode = rankKey(els.rankMode.value, Number($('#rank-time').value) || 60, $('#rank-variant').value === 'inv', $('#rank-level').value);
  const u = app.account.current();
  els.rankBody.innerHTML = '<tr><td colspan="6" class="muted">불러오는 중…</td></tr>';
  try {
    const rows = await app.account.leaderboard(mode, rankFilters(), 100);
    els.rankBody.innerHTML = rows.length ? rows.map((r) => `<tr class="${u && r.uid === u.id ? 'me' : ''} ${r.rank <= 3 ? 'top' + r.rank : ''}">
      <td>${r.rank}</td><td>${esc(r.nick)}${r.number != null ? ` <span class="jersey">${jerseyLabel(r.number)}</span>` : ''}</td><td>${esc(r.team)}</td><td>${esc(countryLabel(r.country))}</td><td>${esc(r.ageGroup)}</td><td>${num(r.score)}</td></tr>`).join('')
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
  $('#result-guest').classList.add('hidden');
  const u = app.account?.current();
  if (result.mode.id === 'free' || result.reason === 'manual' || app.versus) return;
  if (app.mouseMode) { renderTrialNotice(); return; }
  if (!u) { renderGuestNotice(result); return; }
  if (lapsedNow()) { renderGuestNotice(result, true); return; }
  try {
    const key = result.rankKey || result.mode.id;
    const { best, improved } = await app.account.submitScore(key, result.score);
    const all = await app.account.myRank(key, {});
    const age = await app.account.myRank(key, { ageGroup: u.ageGroup });
    const parts = [];
    if (all) parts.push(`전체 ${all.rank}위/${all.total}명`);
    if (age) parts.push(`${u.ageGroup} ${age.rank}위/${age.total}명`);
    els.resultRank.innerHTML = `<span class="script">${improved && Number(result.score) > 0 ? 'New best!' : `best ${best}`}</span> ${parts.join(' · ')} <button type="button" class="btn btn-ghost" id="btn-result-rank">랭킹 보기</button>`;
    els.resultRank.classList.remove('hidden');
    $('#btn-result-rank').addEventListener('click', () => { close(els.panelResult); openRank(result.mode.id); });
  } catch (err) {
    els.resultRank.textContent = `기록 등록 실패: ${err.message || err}`;
    els.resultRank.classList.remove('hidden');
  }
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
/** 저장된 숫자 칸을 HTML에 넣을 때: 숫자가 아니면 0 (조작된 문서로 HTML이 끼어들지 못하게) */
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

/**
 * 게스트 결과 화면: 정회원이었다면 몇 위였을지 + 정회원이 되는 방법 (SNS에 영상을 올리라는 조건은 없음).
 *   - 운영자가 공개 가입 코드(오픈베타 코드)를 걸어 두었고 아직 쓸 수 있으면 [정회원 가입하기] (가입 칸을 열고 코드를 채움).
 *     마감일이 지나거나 인원이 차면 저절로 아래 안내로 돌아간다
 *   - 그 밖에는 정회원 친구의 초대 링크, 또는 보호자가 공식 인스타 DM으로 가입 코드 요청
 * lapsed: 베타가 끝나 정회원이 유지되지 않은 계정 (기록이 랭킹에 안 올라감 + DM 문의)
 */
async function renderGuestNotice(result, lapsed = false) {
  const box = $('#result-guest');
  if (!app.account) return;
  const key = result.rankKey || result.mode.id;
  const [r, cfg] = await Promise.all([
    app.account.wouldRank(key, result.score).catch(() => null),
    app.account.getSiteConfig().catch(() => ({})),
  ]);
  const join = !lapsed && cfg.joinCode ? await app.account.checkCode(cfg.joinCode).catch(() => null) : null;
  const canJoin = join?.status === 'ok' && join.type === 'beta';
  if (app.lastResult !== result || (!lapsed && app.account.current())) return; // 그새 다음 게임이 끝났거나 로그인함
  const sns = instaId(cfg.snsAccount);
  const html = [];
  if (lapsed) {
    html.push(`<p class="guest-rank"><b>${LAPSED}</b></p>`);
    html.push('<p>이번 기록은 랭킹에 올라가지 않아요. 정회원 등급은 공식 인스타 DM으로 문의해 주세요.</p>');
  } else {
    if (r) html.push(`<p class="guest-rank"><b>정회원이었다면 지금 전체 ${r.rank}위 / ${r.total}명</b></p>`);
    if (canJoin) {
      html.push('<p>지금은 누구나 정회원으로 가입할 수 있어요.</p>');
      html.push('<div class="guest-dm"><button type="button" class="btn btn-primary" id="guest-join">정회원 가입하기</button></div>');
      html.push('<p class="muted">보호자와 함께 가입해 주세요</p>');
    } else {
      html.push('<details class="guest-how"><summary>정회원이 되려면</summary>');
      html.push('<p>정회원 친구에게 초대 링크를 받으면 바로 가입할 수 있어요.</p>');
      if (sns) html.push('<p>초대 링크가 없으면 보호자가 공식 인스타 DM으로 가입 코드를 요청해 주세요.</p>');
      html.push('<p class="muted">보호자와 함께 해 주세요</p>');
      html.push('</details>');
    }
  }
  if (sns && !canJoin) html.push(`<div class="guest-dm"><a class="btn btn-primary" id="guest-dm" href="${esc(instaDmLink(sns))}" target="_blank" rel="noopener">인스타 DM 보내기</a> <span data-ugc>@${esc(sns)}</span></div>`);
  if (!lapsed && !canJoin) html.push('<p class="muted">받은 코드는 첫 화면 회원가입의 가입 코드 칸에 넣으세요.</p>');
  box.innerHTML = html.join('');
  if (canJoin) $('#guest-join').addEventListener('click', () => openJoin(join.code));
  box.classList.remove('hidden');
}

/** 게스트 결과 화면의 [정회원 가입하기]: 결과 창을 닫고 회원가입 칸을 열어 공개 가입 코드를 채운다 */
function openJoin(code) {
  close(els.panelResult);
  openLogin();
  setAuthTab('register');
  $('#auth-code').value = codeLabel(code);
  track('join_click', { from: 'result' });
}

// =============== 내 정보 ===============
let meUI = null;
// =============== 운영자: 회원 현황 ===============
let membersUI = null;
function setupMembers() {
  membersUI = initMembers({
    $, $$, esc, tr, open, close, toast, app, MODES, PLAY_MINUTES, rankKey, timeLabel, levelLabel,
    AGE_GROUPS, countryLabel, jerseyLabel, memberBadge, stickLabel, memberNoLabel, joinLabel, shortDate,
  });
  $('#adm-open-members').addEventListener('click', () => { if (isAdmin(app.account?.current())) membersUI.open(); });
}

function setupMe() {
  meUI = initMe({
    $, $$, esc, tr, open, close, toast, app, MODES, PLAY_MINUTES, rankKey, timeLabel, levelLabel,
    COUNTRIES, countryLabel, jerseyLabel, memberBadge, stickLabel, boardOf, shortDate, refreshAuthUI, openLogin,
    codeLabel, inviteLink, copyText,
  });
}
function openMe() { if (meUI) meUI.open(); }

/** 출석: 로그인한 채로 플레이 화면을 연 날 (하루 한 번만 기록. 카메라 없이 체험은 제외) */
function noteAttendance() {
  const u = app.account?.current();
  if (!u || !app.started || app.mouseMode || app.attendedDay === `${u.id}:${dayKey()}`) return;
  app.attendedDay = `${u.id}:${dayKey()}`;
  app.account.recordActivity(null).catch(() => { app.attendedDay = null; });
}

/** 한 판 끝: 출석·훈련 시간·이동 거리·터치를 더하고, 끝까지 한 판이면 그 게임의 최근 기록에 점수를 남긴다 */
function recordPlay(result) {
  const u = app.account?.current();
  if (!u || app.mouseMode || app.versus || !(result.elapsed >= 3)) return;
  const done = result.reason !== 'manual' && result.mode.id !== 'free';
  app.account.recordActivity({
    key: done ? result.rankKey || result.mode.id : null, score: done ? result.score : null,
    sec: result.elapsed, dist: (tracker.distance || 0) * settings.floorWidthM, touches: tracker.touches || 0, mode: result.mode.id,
  }).then(() => { app.attendedDay = `${u.id}:${dayKey()}`; }).catch(() => {});
}

/**
 * 방문·플레이 통계(GA4)에 한 판: 게임 이름·회원/게스트·끝까지 했는지·플레이 초·점수 (3초 미만은 빼고).
 * 카메라 없이 체험한 판은 진짜 판 수에 섞이지 않게 trial_game 으로 따로 센다 (운영자 테스트는 안 셈)
 */
function trackPlay(result) {
  if (!(result.elapsed >= 3)) return;
  if (app.mouseMode) {
    if (!isAdmin(app.account?.current())) track('trial_game', { mode: result.mode.name, completed: result.reason === 'manual' ? 'no' : 'yes', play_seconds: Math.round(result.elapsed) });
    return;
  }
  track('game_end', {
    mode: result.mode.name, member: app.account?.current() ? 'member' : 'guest',
    completed: result.reason === 'manual' ? 'no' : 'yes', play_seconds: Math.round(result.elapsed), score: Math.round(Number(result.score) || 0),
  });
}

// =============== 운영자 화면 ===============
function setupAdmin() {
  const openAdmin = () => { open($('#panel-admin')); renderAdmin(); };
  $('#adm-stats-refresh').addEventListener('click', () => { app.adminActs = null; renderAdmin(); });
  $('#btn-admin').addEventListener('click', openAdmin);
  $('#btn-settings-admin').addEventListener('click', () => { close(els.panelSettings); openAdmin(); });
  $('#adm-init').addEventListener('click', () => adminDo(async () => {
    const r = await app.account.initMembers();
    toast(`가입 준비 완료 · 기존 가입자 ${r.assigned}명에게 번호를 매겼습니다`, 4000);
    refreshAuthUI();
  }));
  $('#adm-pw-save').addEventListener('click', () => adminDo(async () => {
    const ids = ['#adm-pw-now', '#adm-pw-new', '#adm-pw-new2'];
    const msg = $('#adm-pw-msg'), btn = $('#adm-pw-save');
    const say = (text, bad) => { msg.textContent = text; msg.classList.toggle('bad', !!bad); msg.classList.remove('hidden'); };
    msg.classList.add('hidden');
    btn.disabled = true;
    try {
      if (!$('#adm-pw-now').value || !$('#adm-pw-new').value) throw new Error('지금 비밀번호와 새 비밀번호를 입력하세요');
      if ($('#adm-pw-new').value !== $('#adm-pw-new2').value) throw new Error('새 비밀번호가 서로 다릅니다');
      await app.account.changePassword($('#adm-pw-now').value, $('#adm-pw-new').value);
      ids.forEach((s) => { $(s).value = ''; });
      say('운영자 비밀번호를 바꿨습니다. 다음 로그인부터 새 비밀번호를 쓰세요');
      toast('운영자 비밀번호를 바꿨습니다. 다음 로그인부터 새 비밀번호를 쓰세요', 4000);
    } catch (e) {
      say(e.message || String(e), true); // 실패도 버튼 옆에 (창 맨 위 오류 칸은 스크롤 밖일 수 있음)
    } finally { btn.disabled = false; }
  }));
  $('#adm-one').addEventListener('click', () => adminDo(async () => {
    const c = await app.account.issueCode({ type: 'one', note: $('#adm-one-note').value });
    $('#adm-one-note').value = '';
    showIssued($('#adm-one-out'), c);
  }));
  $('#adm-beta').addEventListener('click', () => adminDo(async () => {
    const date = $('#adm-beta-date').value;
    if (!date) throw new Error('마감일을 고르세요');
    const c = await app.account.issueCode({ type: 'beta', expiresAt: endOfDay(date), maxUses: $('#adm-beta-max').value, note: $('#adm-beta-note').value });
    showIssued($('#adm-beta-out'), c);
  }));
  $('#adm-save-config').addEventListener('click', () => adminDo(async () => {
    const raw = $('#adm-sns').value.trim(), sns = instaId(raw);
    if (raw && !sns) throw new Error('인스타 계정 아이디를 확인하세요 (영문·숫자·밑줄·점)');
    const joinCode = normCode($('#adm-join-code').value);
    if (joinCode) { // 공개 가입 코드: 지금 쓸 수 있는 오픈베타 코드만 (1회용·친구 초대 코드를 걸면 첫 사람만 가입하고 끝남)
      const info = await app.account.checkCode(joinCode);
      if (info.status !== 'ok') throw new Error(codeError(info.status, info));
      if (info.type !== 'beta') throw new Error('공개 가입 코드에는 오픈베타 코드만 넣을 수 있어요');
    }
    app.site = await app.account.setSiteConfig({ snsAccount: sns, joinCode: joinCode || null });
    app.adminConfigLoaded = false;
    toast('게스트 안내를 저장했습니다');
  }));
  $('#adm-save-beta-end').addEventListener('click', () => adminDo(async () => {
    const date = $('#adm-beta-end').value;
    app.site = await app.account.setSiteConfig({ betaEndsAt: date ? endOfDay(date) : null });
    app.adminConfigLoaded = false;
    refreshAuthUI();
    toast(date ? `베타 종료일을 ${shortDate(endOfDay(date))}로 저장했습니다` : '베타 종료일을 지웠습니다');
  }));
  $('#adm-betas').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const row = b.closest('tr');
    if (b.dataset.act === 'delete') {
      const note = app.account.kind === 'firebase' ? `\n${tr('로그인 계정은 Firebase 콘솔(Authentication)에서 따로 지워야 같은 별명으로 다시 가입할 수 있습니다')}` : '';
      if (confirmDelete(`${row.dataset.nick}: ${tr('회원의 가입 정보와 의견을 지웁니다')}${note}`)) {
        adminDo(async () => { await app.account.deleteMember(row.dataset.uid); toast('회원을 지웠습니다'); });
      }
      return;
    }
    if (b.dataset.act === 'coupon' || b.dataset.act === 'uncoupon') {
      const until = b.dataset.act === 'coupon' ? couponUntil(app.site?.betaEndsAt ?? null) : null;
      adminDo(async () => { await app.account.grantCoupon(row.dataset.uid, until); refreshAuthUI(); });
      return;
    }
    adminDo(async () => { await app.account.keepMember(row.dataset.uid, b.dataset.act === 'keep'); refreshAuthUI(); });
  });
  // 의견 추첨: 베타 종료일 전에 의견을 보낸 회원 중 n명 -> 확정하면 3개월 이용권
  $('#adm-lot-draw').addEventListener('click', () => adminDo(async () => {
    const pool = lotteryPool(await app.account.memberList(), app.site?.betaEndsAt ?? null);
    if (!pool.length) throw new Error('추첨할 회원이 없습니다 (베타 종료일 전에 의견을 보낸 회원)');
    app.lotDraft = drawLottery(pool, Number($('#adm-lot-n').value) || LOTTERY_WINNERS).map((u) => ({ id: u.id, nick: u.nick, memberNo: Number.isInteger(u.memberNo) ? u.memberNo : null }));
  }));
  $('#adm-lot-ok').addEventListener('click', () => {
    const d = app.lotDraft;
    if (!d?.length) return;
    const until = couponUntil(app.site?.betaEndsAt ?? null);
    if (!window.confirm(tr(`당첨자 ${d.length}명에게 3개월 이용권(${ymd(until)}까지)을 줍니다. 진행할까요?`))) return;
    adminDo(async () => {
      for (const w of d) await app.account.grantCoupon(w.id, until);
      const prev = await app.account.getLottery();
      await app.account.saveLottery({ at: Date.now(), until, winners: [...(prev?.winners || []), ...d] });
      app.lotDraft = null;
      refreshAuthUI();
      toast(`당첨자 ${d.length}명에게 3개월 이용권을 줬습니다`, 4000);
    });
  });
  $('#adm-lot-copy').addEventListener('click', () => {
    const ws = app.lotWinners || [];
    copyText(`${tr('3개월 이용권 당첨')}: ${ws.map((w) => `${w.nick}${w.memberNo != null ? ` (${memberNoLabel(w.memberNo)})` : ''}`).join(', ')}`, '당첨자 목록을 복사했습니다');
  });
  $('#adm-feedback').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act="delete-fb"]');
    if (!b) return;
    const art = b.closest('article');
    if (confirmDelete(`${art.dataset.nick}: ${tr('이 의견을 지웁니다 (이 멤버가 의견을 보낸 기록도 사라집니다)')}`)) {
      adminDo(async () => { await app.account.deleteFeedback(art.dataset.uid); toast('의견을 지웠습니다'); });
    }
  });
  $('#adm-codes').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const code = b.closest('tr').dataset.code;
    if (b.dataset.act === 'copy') copyText(inviteLink(code));
    else if (b.dataset.act === 'code') copyText(codeLabel(code), '코드를 복사했습니다');
    else if (b.dataset.act === 'delete') {
      if (confirmDelete(`${codeLabel(code)}: ${tr('이 코드를 지웁니다 (이미 가입한 사람은 그대로)')}`)) adminDo(async () => { await app.account.deleteCode(code); toast('코드를 지웠습니다'); });
    }
    else adminDo(() => app.account.updateCode(code, { off: b.dataset.act === 'off' }));
  });
  $('#adm-codes').addEventListener('change', (e) => {
    const inp = e.target.closest('input[data-act="expiry"]');
    if (inp && inp.value) adminDo(() => app.account.updateCode(inp.closest('tr').dataset.code, { expiresAt: endOfDay(inp.value) }));
  });
}

/** 지우기 전 확인 (되돌릴 수 없음) */
function confirmDelete(what) { return window.confirm(`${what}\n\n${tr('지우면 되돌릴 수 없습니다. 지울까요?')}`); }

/** 운영자 작업 실행 -> 오류는 화면 위에, 끝나면 목록 새로고침 */
async function adminDo(fn) {
  const err = $('#adm-error');
  err.classList.add('hidden');
  try { await fn(); } catch (e) { err.textContent = e.message || String(e); err.classList.remove('hidden'); }
  await renderAdmin();
}

/** 'YYYY-MM-DD' -> 그날 23:59:59 (이 기기 시간대) */
function endOfDay(date) { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d, 23, 59, 59, 999).getTime(); }
const ymd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const inviteLink = (code) => `${location.origin}${location.pathname}?c=${codeLabel(code)}`;

function copyText(text, msg = '링크를 복사했습니다') {
  const done = () => toast(msg);
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => toast(text, 6000));
  else toast(text, 6000);
}

function showIssued(box, c) {
  const link = inviteLink(c.code);
  box.innerHTML = `<b>${esc(codeLabel(c.code))}</b> <button type="button" class="btn" data-copy="code">코드 복사</button> <input type="text" readonly value="${esc(link)}" aria-label="초대 링크" /> <button type="button" class="btn" data-copy="link">링크 복사</button>`;
  box.querySelector('[data-copy="code"]').addEventListener('click', () => copyText(codeLabel(c.code), '코드를 복사했습니다'));
  box.querySelector('[data-copy="link"]').addEventListener('click', () => copyText(link));
  box.querySelector('input').addEventListener('focus', (e) => e.target.select());
  box.classList.remove('hidden');
}

const STATUS_LABEL = { ok: '사용 가능', off: '꺼짐', expired: '마감', full: '다 씀', missing: '-' };
const BETA_LABEL = { beta: '베타 기간', kept: '유지', coupon: '이용권', lapsed: '종료' };
/** 어떻게 가입했나: 오픈베타 링크 · 친구 초대 · 1회용 코드(SNS 인증) · 코드가 생기기 전 예전 가입 */
const joinLabel = (u) => (!u.code ? '예전 가입' : u.via === 'beta' || u.beta ? '오픈베타 링크' : u.via === 'invite' ? '친구 초대' : '1회용 코드');

/**
 * 운영자: 회원 목록(가입 경로·의견·정회원 상태)과 개발자에게 온 의견.
 * 무료 정회원은 가입 경로와 상관없이 베타 종료일까지. 그 뒤에는 '정회원 유지'(기한 없음)와 '3개월 이용권' 회원만 정회원
 */
async function renderAdminBeta(a) {
  const [all, fbs] = await Promise.all([a.memberList(), a.listFeedback()]);
  const end = app.site?.betaEndsAt ?? null;
  const st = all.map((u) => betaState(u, end));
  const n = (k) => st.filter((x) => x === k).length;
  const by = (label) => all.filter((u) => joinLabel(u) === label).length;
  const sum = [`회원 ${all.length}명`, `오픈베타 링크 ${by('오픈베타 링크')}명`, `친구 초대 ${by('친구 초대')}명`, `1회용 코드 ${by('1회용 코드')}명`];
  if (by('예전 가입')) sum.push(`예전 가입 ${by('예전 가입')}명`);
  sum.push(`유지 ${n('kept')}명`, `이용권 ${all.filter((u) => u.until).length}명`, `종료 ${n('lapsed')}명`);
  if (!end) sum.push('종료일을 아직 정하지 않았습니다');
  $('#adm-beta-sum').textContent = sum.join(' · ');
  $('#adm-betas').innerHTML = all.length ? all.map((u, i) => {
    const keep = u.kept ? '<button type="button" class="btn btn-ghost" data-act="unkeep">유지 취소</button>' : '<button type="button" class="btn btn-ghost" data-act="keep">정회원 유지</button>';
    const coupon = u.until ? '<button type="button" class="btn btn-ghost" data-act="uncoupon">이용권 취소</button>' : '<button type="button" class="btn btn-ghost" data-act="coupon">3개월 이용권</button>';
    const del = '<button type="button" class="btn btn-ghost btn-del" data-act="delete">삭제</button>';
    const state = `${BETA_LABEL[st[i]] || ''}${u.until ? ` · ${st[i] === 'coupon' ? '' : '이용권 '}${ymd(u.until)}까지` : ''}`;
    return `<tr data-uid="${esc(u.id)}" data-nick="${esc(u.nick)}" data-state="${st[i]}" class="${st[i] === 'lapsed' ? 'dim' : ''}"><td>${memberNoLabel(u.memberNo)}</td><td data-ugc>${esc(u.nick)}</td>
      <td><span data-ugc>${esc(u.loginId || '-')}</span>${u.tempPw ? ' <span class="chip-temp">임시 비밀번호</span>' : ''}</td>
      <td>${joinLabel(u)}</td><td>${u.feedbackAt ? ymd(u.feedbackAt) : '-'}</td><td>${state}</td><td class="adm-acts">${keep}${coupon}${del}</td></tr>`;
  }).join('') : '<tr><td colspan="7" class="muted">회원이 없습니다</td></tr>';
  $('#adm-feedback').innerHTML = fbs.length ? fbs.map((f) => `<article class="fb-item" data-uid="${esc(f.uid)}" data-nick="${esc(f.nick)}">
    <header><b data-ugc>${esc(f.nick)}</b> <span>${memberNoLabel(f.memberNo)}</span> <time>${f.updatedAt ? ymd(f.updatedAt) : ''}</time><button type="button" class="btn btn-ghost btn-del" data-act="delete-fb">삭제</button></header>
    ${f.good ? `<p><em>좋았던 점</em><span data-ugc>${esc(f.good)}</span></p>` : ''}${f.fix ? `<p><em>고쳤으면 하는 점</em><span data-ugc>${esc(f.fix)}</span></p>` : ''}</article>`).join('')
    : '<p class="muted">아직 온 의견이 없습니다</p>';
  return all;
}

/** 운영자: 의견 추첨 · 3개월 이용권 (추첨 대상 수, 추첨 결과(확정 전), 확정된 당첨자) */
async function renderAdminLottery(a, members) {
  const end = app.site?.betaEndsAt ?? null;
  const pool = lotteryPool(members, end);
  const lot = await a.getLottery().catch(() => null);
  app.lotWinners = lot?.winners || [];
  $('#adm-lot-sum').textContent = [`추첨 대상 ${pool.length}명`, `이용권 ${members.filter((u) => u.until).length}명`, `지금 확정하면 ${ymd(couponUntil(end))}까지`].join(' · ');
  const list = (ws) => '<ol class="adm-lot">' + ws.map((w) => `<li><span>${memberNoLabel(w.memberNo)}</span> <b data-ugc>${esc(w.nick)}</b></li>`).join('') + '</ol>';
  const out = [];
  if (app.lotDraft?.length) out.push(`<p><b>추첨 결과 ${app.lotDraft.length}명 · 아직 확정 전</b></p>${list(app.lotDraft)}`);
  if (lot?.winners?.length) out.push(`<p><b>확정된 당첨자 ${lot.winners.length}명</b> · ${ymd(lot.at)} · ${ymd(lot.until)}까지</p>${list(lot.winners)}`);
  $('#adm-lot-out').innerHTML = out.join('') || '<p class="muted">아직 추첨하지 않았습니다</p>';
  $('#adm-lot-ok').classList.toggle('hidden', !app.lotDraft?.length);
  $('#adm-lot-copy').classList.toggle('hidden', !lot?.winners?.length);
}

/**
 * 운영자 통계 (회원 기준): 전체·새 가입, 출석한 회원, 회원 판 수·훈련 시간, 최근 14일 그래프, 게임별·연령대·국가.
 * 활동 기록은 회원 수만큼 읽으므로 1분 동안은 다시 읽지 않는다 ('새로 고침' 버튼은 바로 다시 읽음)
 */
async function renderAdminStats(a, members) {
  const box = $('#adm-stats');
  try {
    if (!app.adminActs || Date.now() - app.adminActs.at > 60000) app.adminActs = { at: Date.now(), rows: await a.activityList() };
    const s = memberStats(members, app.adminActs.rows);
    const hm = (sec) => { const m = Math.round(sec / 60), h = Math.floor(m / 60), mm = m % 60; return h ? `${h}시간 ${mm}분` : `${mm}분`; };
    const tile = (v, label, sub) => '<div class="me-stat"><b>' + v + '</b><span>' + label + '</span>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>';
    box.innerHTML = [
      tile(s.members.total, '전체 회원', `오픈베타 ${s.members.beta} · 초대 ${s.members.invite} · 1회용 ${s.members.one}`),
      tile(s.members.d7, '최근 7일 가입', `오늘 ${s.members.today} · 30일 ${s.members.d30}`),
      tile(s.attended.today, '오늘 출석한 회원', `7일 ${s.attended.d7} · 30일 ${s.attended.d30}`),
      tile(s.games.today, '오늘 회원 판 수', `7일 ${s.games.d7} · 누적 ${s.games.total}`),
      tile(hm(s.games.sec), '회원 누적 훈련 시간', ''),
    ].join('');
    $('#adm-chart').innerHTML = statsChart(s.daily);
    const chips = (rows, label) => rows.map(([k, n]) => '<span class="adm-chip"><span>' + esc(label(k)) + '</span> <b>' + n + '</b></span>').join(' ');
    const modeName = (id) => MODES.find((m) => m.id === id)?.name || id;
    $('#adm-stats-more').innerHTML = [
      ['게임별 판 수', s.modes.length ? chips(s.modes, modeName) : '<span class="muted">이번 업데이트부터 쌓입니다</span>'],
      ['연령대', chips(s.ages, (g) => g)],
      ['국가', chips(s.countries, countryLabel)],
    ].map(([h, body]) => '<p class="adm-line"><b class="adm-line-h">' + h + '</b> ' + body + '</p>').join('');
  } catch (e) {
    box.innerHTML = '<p class="error">' + esc(tr('통계를 불러오지 못했습니다')) + ': ' + esc(e.message || String(e)) + '</p>';
  }
}

/** 최근 14일 막대 그래프 (SVG): 막대 = 회원 판 수, 빨간 점 = 그날 가입 (숫자) */
function statsChart(daily) {
  const W = 300, H = 104, top = 14, base = 74, step = W / daily.length, bw = Math.min(14, step * 0.62);
  const max = Math.max(1, ...daily.map((d) => d.games));
  const bars = daily.map((d, i) => {
    const x = i * step + (step - bw) / 2, h = d.games ? Math.max(2, ((base - top) * d.games) / max) : 0, cx = i * step + step / 2;
    const label = i % 2 === daily.length % 2 ? '' : '<text class="ax" x="' + cx + '" y="' + (H - 3) + '">' + Number(d.day.slice(5, 7)) + '/' + Number(d.day.slice(8)) + '</text>';
    const val = d.games ? '<text class="v" x="' + cx + '" y="' + (base - h - 3) + '">' + d.games + '</text>' : '';
    const join = d.joins ? '<circle cx="' + cx + '" cy="' + (base + 9) + '" r="4.5"/><text class="j" x="' + cx + '" y="' + (base + 11.4) + '">' + d.joins + '</text>' : '';
    return '<rect x="' + x.toFixed(1) + '" y="' + (base - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2"/>' + val + join + label;
  }).join('');
  const cap = tr('최근 14일: 막대 = 회원 판 수, 빨간 점 = 가입');
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(cap) + '"><line x1="0" x2="' + W + '" y1="' + base + '" y2="' + base + '"/>' + bars + '</svg>'
    + '<p class="adm-legend muted">' + esc(cap) + '</p>';
}

async function renderAdmin() {
  if (!isAdmin(app.account?.current())) { close($('#panel-admin')); return; }
  const a = app.account;
  try {
    const m = await a.membersInfo();
    $('#adm-members').textContent = m.ready ? `가입을 받고 있습니다 · 정회원 ${m.count}명` : '아직 가입을 받을 수 없습니다. 아래 버튼을 한 번 눌러 기존 가입자에게 번호를 매기고 가입을 여세요.';
    $('#adm-init').classList.toggle('hidden', m.ready);
    if (!app.adminConfigLoaded) {
      const cfg = await a.getSiteConfig();
      $('#adm-join-code').value = cfg.joinCode ? codeLabel(cfg.joinCode) : ''; $('#adm-sns').value = cfg.snsAccount || '';
      $('#adm-beta-end').value = cfg.betaEndsAt ? ymd(cfg.betaEndsAt) : '';
      app.adminConfigLoaded = true;
    }
    const members = await renderAdminBeta(a);
    await renderAdminLottery(a, members);
    await renderAdminStats(a, members);
    const rows = await a.listCodes();
    $('#adm-codes').innerHTML = rows.length ? rows.map((c) => {
      const st = codeStatus(c);
      const exp = c.type === 'beta'
        ? `<input type="date" data-act="expiry" value="${c.expiresAt ? ymd(c.expiresAt) : ''}" aria-label="마감일" />`
        : (c.expiresAt ? ymd(c.expiresAt) : '-');
      return `<tr data-code="${esc(c.code)}" class="${st === 'ok' ? '' : 'dim'}"><td><b>${esc(codeLabel(c.code))}</b></td><td>${c.type === 'beta' ? '오픈베타' : '1회용'}</td>
        <td>${c.uses || 0}/${c.maxUses ? c.maxUses : '∞'}</td><td>${exp}</td><td data-ugc>${esc(c.note || '')}</td><td>${STATUS_LABEL[st]}</td>
        <td class="adm-acts"><button type="button" class="btn btn-ghost" data-act="code">코드 복사</button><button type="button" class="btn btn-ghost" data-act="copy">링크 복사</button><button type="button" class="btn btn-ghost" data-act="${c.off ? 'on' : 'off'}">${c.off ? '켜기' : '끄기'}</button><button type="button" class="btn btn-ghost btn-del" data-act="delete">삭제</button></td></tr>`;
    }).join('') : '<tr><td colspan="7" class="muted">아직 만든 코드가 없습니다</td></tr>';
  } catch (e) {
    $('#adm-error').textContent = `운영자 정보를 불러오지 못했습니다: ${e.message || e}`;
    $('#adm-error').classList.remove('hidden');
  }
}

function bindUI() {
  els.btnCamera.addEventListener('click', startCamera);
  $('#btn-mouse').addEventListener('click', startMouse);
  $('#btn-remote').addEventListener('click', openRemote);
  $('[data-close="panel-remote"]').addEventListener('click', cancelRemote);
  els.btnStart.addEventListener('click', toggleRun);
  els.btnMode.addEventListener('click', () => { renderModeList(); open(els.panelMode); });
  els.btnSettings.addEventListener('click', () => { refreshAuthUI(); refreshVisualLocks(); open(els.panelSettings); requestAnimationFrame(() => drawTransparencyPreview(app.lastVision)); }); // 계정 줄·운영자 버튼은 열 때 새로. 카메라 전에도 미리보기
  // 모드 창의 '설정': 모드 창 위에 설정 창을 연다 (닫으면 모드 창으로 돌아옴)
  $('#btn-mode-settings').addEventListener('click', () => els.btnSettings.click());
  // 모드 창의 '퍽·스틱 등록': 모드 창 위에 보정 창을 열고, 등록(또는 취소)이 끝나면 모드 창으로 돌아온다 (backToModeAfterCalib)
  $('#btn-mode-calib').addEventListener('click', () => els.btnCalib.click());
  els.btnCalib.addEventListener('click', () => { refreshCalibUI(); open(els.panelCalib); });
  els.btnFloorLock.addEventListener('click', toggleAreaEdit);
  $('#area-done').addEventListener('click', () => endAreaEdit());
  $('#area-reset').addEventListener('click', () => { settings.manualQuad = defaultQuad(); positionHandles(); persist(); });
  // 시작 준비 2/3·3/3 막대의 버튼
  $('#setup-back').addEventListener('click', () => beginAreaSetup());
  $('#test-repuck').addEventListener('click', () => beginPuckSetup());
  $('#test-area').addEventListener('click', () => beginAreaSetup());
  $('#test-skip').addEventListener('click', () => {
    // 움직여 보기를 건너뛰어도, 영역 모양만으로 카메라가 너무 낮아 보이면 알려 준다
    const pc = checkPlacement();
    finishSetup();
    if (pc?.verdict === 'raise') toast('카메라가 낮아 보여요 · 먼 쪽에서 퍽을 놓칠 수 있으니 더 높이(1~1.5m) 두세요', 6000);
  });
  els.btnFlip.addEventListener('click', flipCamera);
  $$('#time-seg button').forEach((b) => b.addEventListener('click', () => {
    if (game.running) game.stop('manual');
    settings.playMinutes = Number(b.dataset.min); persist();
    game.playSeconds = settings.playMinutes * 60; game.resetState();
    renderModeList(); updateHud(); syncScoreChallenge();
  }));
  // 난이도 (아케이드·퍽 피하기): 모드 창에서 시간과 함께 고른다. 랭킹은 난이도별로 따로
  $$('#level-seg button').forEach((b) => b.addEventListener('click', () => {
    if (game.running) game.stop('manual');
    settings.difficulty = b.dataset.level; game.difficulty = settings.difficulty; persist();
    renderModeList(); updateHud(); syncScoreChallenge();
  }));
  // 8자 드리블 방향: 게임 화면에서 먼저 갈 콘(왼쪽·오른쪽) × 도는 방향(시계·반시계). 게임 중에도 멈추지 않고 바뀐다
  const setFigure8 = (dir) => {
    if (dir === settings.figure8Dir) return;
    settings.figure8Dir = dir; persist();
    game.setFigure8Dir(dir);
    toast(`${dir[0] === 'L' ? '왼쪽 먼저' : '오른쪽 먼저'} · ${f8Rot(dir) === 'cw' ? '↻ 시계방향' : '↺ 반시계방향'}`);
    updateHud();
  };
  $$('#f8-side button').forEach((b) => b.addEventListener('click', () => setFigure8(f8Dir(b.dataset.side, f8Rot(settings.figure8Dir)))));
  $$('#f8-rot button').forEach((b) => b.addEventListener('click', () => setFigure8(f8Dir(settings.figure8Dir[0], b.dataset.rot))));
  els.invisibleToggle.addEventListener('change', () => {
    if (game.running) game.stop('manual');
    settings.invisible = els.invisibleToggle.checked; persist();
    game.invisible = settings.invisible; applyWash();
    renderModeList(); updateHud(); syncScoreChallenge();
    toast(settings.invisible ? '투명 모드 — 플레이 중 내 퍽이 보이지 않습니다. 손의 감각으로만 피하세요' : '투명 모드 끔');
  });
  $('#set-autoStart').addEventListener('change', (e) => { settings.autoStart = e.target.checked; app.idleHold = 0; persist(); });
  $('#set-reverseDepth').addEventListener('change', (e) => { settings.reverseDepth = e.target.checked; applyDepthDirection(); persist(); });
  $$('.btn-close').forEach((b) => b.addEventListener('click', () => close($('#' + b.dataset.close))));

  // 모드/대결
  els.versusToggle.addEventListener('change', () => {
    els.versusNames.classList.toggle('hidden', !els.versusToggle.checked);
  });
  els.p1.addEventListener('change', () => { settings.p1 = els.p1.value.trim() || '플레이어 1'; saveSettings(settings); });
  els.p2.addEventListener('change', () => { settings.p2 = els.p2.value.trim() || '플레이어 2'; saveSettings(settings); });

  // 설정
  $('#set-mirror').addEventListener('change', (e) => { settings.mirror = e.target.checked; applyMirror(); persist(); });
  $('#set-sound').addEventListener('change', (e) => { settings.sound = e.target.checked; sfx.enabled = settings.sound; persist(); });
  // 인식 세부 조정을 펼치면 미리보기를 바로 그린다 (그 뒤로는 설정 창이 열려 있는 동안 매 영상마다)
  $('.settings-adv').addEventListener('toggle', () => drawMaskPreview(app.lastVision));
  for (const key of SLIDER_KEYS) {
    const input = $('#set-' + key), out = $('#out-' + key);
    input.addEventListener('input', () => { settings[key] = Number(input.value); out.value = input.value; persist(); game.arcade.floorWidthM = settings.floorWidthM; applyWash(); refreshVisualLocks(); drawTransparencyPreview(app.lastVision); });
    if (key === 'bgTransparency' || key === 'puckTransparency') {
      // 끄는 동안만 설정 창 대신 실제 화면 (손을 떼면 다시 설정 창)
      const label = input.closest('label'), on = () => setTpPeek(true, label), off = () => setTpPeek(false);
      input.addEventListener('pointerdown', on);
      input.addEventListener('touchstart', on, { passive: true });
      for (const ev of ['pointerup', 'touchend', 'touchcancel', 'change']) input.addEventListener(ev, off);
      for (const ev of ['pointerup', 'touchend']) window.addEventListener(ev, off); // 슬라이더 밖에서 손을 떼도
    }
  }
  $('#set-procWidth').addEventListener('change', (e) => { settings.procWidth = Number(e.target.value); vision.setProcWidth(settings.procWidth); layout(); persist(); });
  $('#set-camRate').addEventListener('change', (e) => { settings.camRate = e.target.value; applyCamRate(); persist(); });
  $('#set-controller').addEventListener('change', (e) => {
    settings.controller = e.target.value; persist(); tracker.reset();
    if (settings.controller === 'stick' && !settings.stickModel) toast('보정에서 스틱 색을 먼저 지정하세요', 4000);
  });
  els.selCamera.addEventListener('change', async () => {
    if (app.remoteMode) { toast('휴대폰 카메라를 쓰는 중입니다'); return; }
    settings.cameraId = els.selCamera.value; persist();
    try { await startStream(); } catch (err) { toast(describeCameraError(err)); }
  });
  $('#btn-reset-settings').addEventListener('click', () => {
    if (!confirm('설정을 처음 값으로 되돌릴까요? (맞춰 둔 영역과 등록한 퍽도 처음으로)')) return;
    const keep = { cameraId: settings.cameraId, p1: settings.p1, p2: settings.p2 };
    Object.assign(settings, structuredClone(DEFAULT_SETTINGS), keep);
    game.figure8Dir = settings.figure8Dir; game.difficulty = settings.difficulty; renderModeList();
    persist(); applySettingsToUI(); applyMirror(); applyFloorMode(); refreshCalibUI(); toast('설정을 초기화했습니다');
  });
  $('#btn-reset-scores').addEventListener('click', () => {
    if (!confirm('이 기기에 저장된 최고 기록을 모두 지울까요? (온라인 랭킹 기록은 그대로)')) return;
    clearScores(); renderModeList(); toast('기록을 초기화했습니다');
  });

  // 보정
  $$('[data-calib]').forEach((b) => b.addEventListener('click', () => beginCalibration(b.dataset.calib)));
  $$('[data-autocalib]').forEach((b) => b.addEventListener('click', () => beginAutoCalibration(b.dataset.autocalib)));
  $('#btn-replace-puck').addEventListener('click', () => { beginAutoCalibration('puck'); toast('새 물체를 원 안에 3초'); });
  $('#setup-skip').addEventListener('click', () => cancelAutoCalibration());
  $$('[data-calib-reset]').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.calibReset;
    if (t === 'puck') settings.puckModel = structuredClone(DEFAULT_SETTINGS.puckModel);
    else settings.stickModel = null;
    persist(); refreshCalibUI(); toast(t === 'puck' ? '퍽: 기본(검정)으로 되돌림' : '스틱 추적 해제');
  }));
  els.view.addEventListener('pointerdown', onViewTap);

  // 결과
  els.btnAgain.addEventListener('click', () => { close(els.panelResult); if (els.btnAgain.dataset.rematch !== '1') app.versus = null; startRun(); });
  els.btnNext.addEventListener('click', () => { close(els.panelResult); startRun(); });
  $('#btn-result-mode').addEventListener('click', () => { close(els.panelResult); renderModeList(); open(els.panelMode); });

  // 바닥 수동 핸들
  bindFloorHandles();

  window.addEventListener('resize', () => { if (app.mouseMode) applyMouseSource(); layout(); });
  if (screen.orientation?.addEventListener) screen.orientation.addEventListener('change', () => setTimeout(layout, 200));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (game.running) game.stop('manual'); app.wasHidden = true; }
    else if (app.wasHidden) { app.wasHidden = false; app.lastLoop = 0; requestWakeLock(); toast('화면이 가려져 있는 동안 추적이 멈췄습니다. 앱을 항상 전면에 두세요.'); }
  });
  // 키보드(외장 키보드/TV·PC에서 사용): Space·Enter 시작/중지, R 초기화, F 전체화면, M 모드, D 디버그
  document.addEventListener('keydown', (e) => {
    if (!app.started || e.target.matches('input, select, textarea')) return;
    if (optionPanelOpen()) return; // 옵션 창이 떠 있는 동안은 게임 단축키를 받지 않음
    switch (e.key) {
      case ' ': case 'Enter': e.preventDefault(); closeAllPanels(); toggleRun(); break;
      case 'r': case 'R': if (game.running) game.stop('manual'); game.resetState(); closeAllPanels(); updateHud(); toast('초기화'); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case 'm': case 'M': renderModeList(); open(els.panelMode); break;
      case 'a': case 'A': if (app.setup && app.setup !== 'area') beginAreaSetup(); else toggleAreaEdit(); break;
      case 'd': case 'D': settings.debug = !settings.debug; els.debug.classList.toggle('hidden', !settings.debug); persist(); break; // 개발용 (게임 중에는 숨김)
      case 'Escape': closeAllPanels(); if (app.calibTarget) endPick(); else if (app.calib.manual) cancelAutoCalibration('자동 지정 취소'); else if (app.setup === 'test') finishSetup(); break;
    }
  });
}

/**
 * 8자 방향 'L-up' 등 <-> 화면에서 고르는 (먼저 갈 콘, 시계·반시계).
 * 첫 콘을 도는 방향 기준: 왼쪽 콘을 위로 돌면 반시계, 아래로 돌면 시계 / 오른쪽 콘은 위로 돌면 시계.
 */
function f8Rot(dir) { return dir === 'L-down' || dir === 'R-up' ? 'cw' : 'ccw'; }
function f8Dir(side, rot) { return `${side}-${(side === 'L') === (rot === 'ccw') ? 'up' : 'down'}`; }

// 이 창들이 떠 있으면 뒤의 모든 것(게임 시계·퍽 추적·핸즈프리 시작)이 멈춘다
const OPTION_PANELS = ['panel-settings', 'panel-admin', 'panel-calib', 'panel-rank', 'panel-login', 'panel-community', 'panel-me'];
function optionPanelOpen() { return OPTION_PANELS.some((id) => !document.getElementById(id).classList.contains('hidden')); }

function closeAllPanels() { $$('.modal').forEach(close); }

function toggleFullscreen() {
  const doc = document;
  if (!doc.fullscreenElement && doc.documentElement.requestFullscreen) doc.documentElement.requestFullscreen().catch(() => {});
  else if (doc.exitFullscreen) doc.exitFullscreen().catch(() => {});
}

// =============== 카메라 없이 체험 (마우스·터치, 누구나) ===============
// 처음 온 사람이 카메라·퍽 없이 먼저 해 보게: 마우스 포인터나 손가락이 곧 퍽 (src/mouse-input.js).
// 기록·랭킹·출석에는 안 들어가고, 결과 화면에서 카메라로 해 보라고 권한다. 운영자 테스트도 같은 모드를 쓴다.
// 첫 화면 보조 버튼: 체험과 휴대폰 카메라(QR 연결)는 모두에게 보인다(QR 은 누르면 로그인 확인)
function refreshMouseButton() {
  const onSplash = !els.btnCamera.classList.contains('hidden') && !app.started;
  $('#trial-start').classList.toggle('hidden', !onSplash);
  $('#remote-start').classList.toggle('hidden', !onSplash);
}

/** 체험 화면 비율: 세로로 든 휴대폰이면 세로(9:16), 아니면 가로(16:9). 카메라 영상처럼 화면을 채우고, 돌리면 따라 바뀐다 */
function applyMouseSource() {
  const portrait = innerHeight > innerWidth;
  const w = portrait ? MOUSE_SRC.height : MOUSE_SRC.width, h = portrait ? MOUSE_SRC.width : MOUSE_SRC.height;
  if (vision.srcW === w && vision.srcH === h) return;
  vision.setSourceSize(w, h);
  els.view.style.aspectRatio = `${w} / ${h}`;
}

function startMouse() {
  sfx.unlock();
  sfx.enabled = settings.sound;
  app.mouseMode = true;
  mouse.enabled = true;
  vision.mirror = false;
  els.view.classList.remove('mirror');
  els.view.classList.add('mouse-mode');
  applyMouseSource();
  layout();
  els.splash.classList.add('hidden');
  $('#splash-diag').classList.add('hidden');
  app.started = true;
  app.startedAt = clockNow();
  app.lastFrameAt = clockNow();
  requestAnimationFrame(loop);
  openModeAfterStart();
  if (!isAdmin(app.account?.current())) track('trial_start', { input: matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse' });
  toast('체험 모드 · 마우스나 손가락이 퍽이에요. 기록은 저장되지 않아요', 4000);
}

/** 체험 결과 화면: 기록은 저장 안 됨 + 카메라로 해 보기 (첫 화면으로 = 새로고침, 로그인은 그대로) */
function renderTrialNotice() {
  els.resultRank.innerHTML = '체험 기록은 저장되지 않아요. 카메라로 진짜 퍽을 움직여 보세요! <button type="button" class="btn btn-primary" id="btn-trial-camera">카메라로 하기</button>';
  els.resultRank.classList.remove('hidden');
  $('#btn-trial-camera').addEventListener('click', () => { track('trial_to_camera'); location.reload(); });
}

// =============== 휴대폰 카메라 (QR 연결, 로그인한 회원) ===============
// 휴대폰은 촬영만 하고 영상을 WebRTC 로 이 기기에 보낸다. 받은 영상을 내 카메라 자리(els.video)에 넣으므로
// 영역·퍽 등록·인식·게임은 카메라 모드와 똑같다. 연결 중개는 Firestore rtc/{코드} (src/remote-cam.js).
// 연결 문서를 쓰려면 로그인해야 한다 (규칙: 프로필이 있는 계정만 만든다 — 아무나 쓰게 열면 무료 쓰기 한도를 다른 사람이 써 버릴 수 있음).
// 중계(TURN) 서버가 없으므로 휴대폰과 이 기기가 같은 Wi-Fi 여야 잘 이어진다 (화면에 안내)
let remote = null; // { host, code, mod }

function setRemoteStatus(text, tone = '') {
  const el = $('#remote-status');
  el.textContent = text;
  el.className = `remote-status ${tone}`;
}

async function openRemote() {
  if (!app.account?.current()) {
    toast('휴대폰 카메라 연결은 로그인한 뒤에 쓸 수 있습니다. 아래에서 로그인하세요', 4500);
    const card = $('#auth-card');
    if (card && !card.classList.contains('hidden')) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#auth-id')?.focus({ preventScroll: true }); }
    return;
  }
  if (!window.RTCPeerConnection) { toast('이 브라우저는 휴대폰 카메라 연결을 지원하지 않습니다'); return; }
  sfx.unlock();
  sfx.enabled = settings.sound;
  open($('#panel-remote'));
  if (remote) return; // 이미 열어 둔 연결 (창만 다시 보여 준다)
  setRemoteStatus('연결 준비 중…');
  try {
    const [mod, { default: qrcode }] = await Promise.all([import('./remote-cam.js'), import('./vendor/qrcode.mjs')]);
    const code = mod.makeCode();
    const fb = app.account?.kind === 'firebase';
    const signal = fb ? mod.firestoreSignal(app.account.F, app.account.db, code, app.account.auth.currentUser?.uid) : mod.localSignal(code);
    const host = new mod.RemoteHost(signal, {
      rtcConfig: fb ? mod.RTC_CONFIG : { iceServers: [] },
      onState: onRemoteState, onStream: onRemoteStream, onStats: onRemoteStats, onMessage: onRemoteMessage,
    });
    remote = { host, code, mod };
    const camUrl = new URL('../cam/', import.meta.url);
    drawQR(qrcode, `${camUrl.href}#${code}`);
    $('#remote-url').textContent = `${camUrl.host}${camUrl.pathname}`;
    $('#remote-code').textContent = code;
    await host.start();
  } catch (err) {
    console.error(err);
    setRemoteStatus(`연결을 준비하지 못했습니다: ${err?.message || err}`, 'bad');
  }
}

/** QR 그리기: 흰 바탕 + 검정 칸, 둘레 여백 4칸 */
function drawQR(qrcode, text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), cv = $('#remote-qr'), quiet = 4;
  const cell = Math.max(2, Math.floor(264 / (n + quiet * 2)));
  const size = cell * (n + quiet * 2);
  cv.width = size; cv.height = size;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, size, size);
  g.fillStyle = '#161616';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
}

/** 창을 닫으면: 아직 게임을 시작하지 않았으면 연결을 끝낸다 (시작한 뒤에는 연결을 그대로 둔다) */
function cancelRemote() {
  if (!remote || app.started) return;
  remote.host.close();
  remote = null;
}

function onRemoteState(s, err) {
  if (err) console.error(err);
  // 연결되면 '카메라 프레임' 설정을 휴대폰에 알린다 (자동이면 휴대폰이 Wi-Fi 상태를 보고 60·30을 고른다)
  if (s === 'connected') remote?.host.send({ t: 'rate', mode: settings.camRate });
  if (!app.started) {
    const msg = {
      preparing: ['연결 준비 중…'],
      waiting: ['휴대폰으로 QR을 찍어 연결하세요'],
      connecting: ['휴대폰과 연결하는 중…'],
      connected: ['연결됨 · 영상을 받는 중…', 'ok'],
      // 휴대폰이 답했는데 영상 길이 안 열리면(다른 Wi-Fi·LTE) 끊김으로 온다
      lost: ['연결되지 않았습니다. 휴대폰과 이 기기가 같은 Wi-Fi인지 확인하세요 · 다시 기다리는 중…', 'bad'],
    }[s];
    if (s === 'error') {
      // 권한 오류 = 로그인이 풀렸거나 규칙이 아직 게시되지 않음 (자세한 내용은 콘솔)
      const denied = /permission/i.test(String(err?.code || err?.message));
      setRemoteStatus(denied ? '연결을 준비할 권한이 없습니다. 로그인을 확인하고 창을 닫았다가 다시 여세요' : `연결 오류: ${err?.message || err}`, 'bad');
    } else if (msg) setRemoteStatus(msg[0], msg[1]);
    return;
  }
  if (s === 'lost') {
    app.cameraLost = true; // 영상 멈춤 경고 대신 이 안내를 쓴다
    $('#remote-badge').classList.add('hidden');
    if (game.running) game.stop('manual');
    toast('휴대폰 연결이 끊겼습니다. 휴대폰 화면을 켜 두면 자동으로 다시 연결됩니다', 6000);
  }
}

async function onRemoteStream(stream) {
  try {
    const { width, height } = await camera.attach(stream);
    app.remoteMode = true;
    app.cameraLost = false;
    app.lastFrameAt = clockNow();
    vision.setSourceSize(width, height);
    els.view.style.aspectRatio = `${width} / ${height}`;
    if (!app.started) {
      // 휴대폰이 플레이어를 바라보고 놓이므로 거울처럼 보이게 (설정에서 끌 수 있음)
      settings.mirror = true;
      $('#set-mirror').checked = true;
    }
    applyMirror();
    layout();
    if (app.started) { toast('휴대폰 카메라가 다시 연결되었습니다'); return; }
    close($('#panel-remote'));
    els.splash.classList.add('hidden');
    $('#splash-diag').classList.add('hidden');
    app.started = true;
    app.startedAt = clockNow();
    requestWakeLock();
    requestAnimationFrame(loop);
    setSetup('area-wait'); // 카메라 모드와 같이 1/3 영역 설정부터
  } catch (err) {
    console.error(err);
    if (!app.started) setRemoteStatus(`영상을 받지 못했습니다: ${err?.message || err}`, 'bad');
    else toast('휴대폰 영상을 받지 못했습니다');
  }
}

function onRemoteStats(s) {
  const ms = remote?.mod.estimateDelay(s);
  const badge = $('#remote-badge');
  if (ms == null || !app.started) return;
  badge.textContent = `📱 ${ms}ms${s.fps ? ` · ${Math.round(s.fps)}fps` : ''}`;
  badge.title = `지연 추정: 네트워크 ${Math.round((s.rtt || 0) / 2)} + 버퍼 ${Math.round(s.buffer || 0)} + 해독 ${Math.round(s.decode || 0)} + 촬영·압축 약 30 (ms)`;
  badge.classList.toggle('slow', ms > 150);
  badge.classList.remove('hidden');
}

/**
 * 카메라 화면이 가로 <-> 세로로 바뀜 (휴대폰·아이패드를 돌림). 영상 크기·비율은 loop 가 이미 맞췄다. 여기서는
 *  - 등록한 퍽·스틱 크기(처리 화면 픽셀 면적)를 새 방향으로 환산한다: 처리 화면 폭은 그대로(예: 240)인데 영상 폭이 짧은 변의
 *    1배(세로) <-> 16/9배(가로)로 바뀌므로, 같은 퍽이 가로에서는 약 1/3 면적으로 보인다 -> 다시 등록하지 않아도 된다
 *  - 게임 영역(네 모서리)은 화면 비율 기준이라 돌리기 전 자리에 남으므로, 게임을 멈추고 영역 편집만 바로 연다
 *    (퍽 등록·움직여 보기는 다시 하지 않음. 영역을 저장하면 하던 화면으로)
 */
function onOrientationFlip(oldAr, newAr) {
  const widthPerShort = (ar) => (ar >= 1 ? ar : 1);
  const k2 = (widthPerShort(oldAr) / widthPerShort(newAr)) ** 2;
  if (settings.puckModel.area > 0) settings.puckModel.area = Math.max(4, Math.round(settings.puckModel.area * k2));
  if (settings.stickModel?.area > 0) settings.stickModel.area = Math.max(4, Math.round(settings.stickModel.area * k2));
  vision.lastPuck = null; vision.lastStick = null; tracker.reset(); stickBridge.reset();
  persist();
  if (app.mouseMode || !app.started) return;
  if (game.running) game.stop('manual');
  if (app.setup) {
    // 시작 준비 중: 영역 단계가 아니면 영역부터 다시 (퍽 등록 원은 새 크기로 알아서 맞춰진다)
    if (app.setup !== 'area' && app.setup !== 'area-wait') beginAreaSetup();
    toast('화면 방향이 바뀌었어요 · 게임 영역을 다시 맞춰 주세요', 5000);
    return;
  }
  if (settings.floorMode !== 'manual') { toast('화면 방향이 바뀌었어요', 3000); return; }
  app.areaReturnMode = modeIsOpen();
  if (!app.areaEditing) toggleAreaEdit();
  toast('화면 방향이 바뀌었어요 · 게임 영역을 다시 맞춰 주세요', 5000);
}

function onRemoteMessage(m) {
  // 휴대폰 카메라를 바꾸면 영상 크기가 바뀔 수 있다 (loop 가 알아서 맞춘다)
  if (m.t === 'info') {
    app.remoteFacing = m.facing;
    app.remoteLink = { fps: m.fps || 0, mode: m.mode || 'auto' }; // 휴대폰이 지금 보내는 단계 (설정 창에 보인다)
  }
}

window.addEventListener('pagehide', () => { if (remote) remote.host.close(); });

// =============== 시작 준비: 1/3 영역 → 2/3 퍽 등록 → 3/3 움직여 보기 → 모드 선택 ===============
// 준비 중에는 HUD·아래 버튼·인식 칩을 숨기고, 맨 위 한 줄 막대만 안내한다 (휴대폰에서 화면을 가리지 않게)
function setSetup(step) {
  app.setup = step;
  $('#app').classList.toggle('setting-up', !!step);
  $('#area-step').classList.toggle('hidden', step !== 'area');
  $('#setup-bar').classList.toggle('hidden', step !== 'puck');
  $('#test-bar').classList.toggle('hidden', step !== 'test');
  if (step !== 'test') app.test = null;
  els.toast.classList.add('hidden'); // 안내는 위 막대가 맡는다 (토스트와 겹치지 않게)
}

/** 보정(가운데 원) 상태만 조용히 끈다 (준비 단계를 오갈 때) */
function quietCalibReset() {
  app.calib = { active: false, manual: false, target: 'puck', hold: 0, status: 'none', sample: null, circle: null };
  autoCal.reset();
}

function beginAreaSetup() {
  if (app.calib.manual) quietCalibReset();
  setSetup('area');
  if (!app.areaEditing) toggleAreaEdit();
}

function beginPuckSetup() {
  setSetup('puck');
  beginAutoCalibration('puck');
  $('#setup-skip').classList.toggle('hidden', !(settings.puckModel.area > 0));
}

// 3/3 움직여 보기: 바닥 네 모서리 근처의 표적에 퍽을 가져가 끝까지 잘 잡히는지 확인
const TEST_TARGETS = [[0.15, 0.15], [0.85, 0.15], [0.85, 0.85], [0.15, 0.85]];
const TEST_R = 0.13; // 표적 반지름 (바닥 좌표)
function beginTestSetup() {
  quietCalibReset();
  setSetup('test');
  // meas: 카메라 위치 점검용 — 표적에 닿았을 때 퍽 크기(먼 쪽·가까운 쪽), 먼 쪽 절반에 있는 동안 놓친 영상 수
  app.test = { targets: TEST_TARGETS.map(([x, y]) => ({ x, y, hit: false })), r: TEST_R, lostFor: 0, lastV: null, frameAt: -1,
    meas: { far: [], near: [], farFrames: 0, farMissed: 0 } };
  $('#test-hint').textContent = '퍽을 네 모서리 표적에';
  paintTest();
}

/**
 * 카메라 위치 점검 결과 -> 안내 글 (모드 창 위 안내).
 * 높이세요 / 지금이 최소(더 낮추지 말 것) / 좋아요 / 여유 있음(화면을 가리면 조금 낮춰도 됨)
 */
const PLACEMENT_ADVICE = {
  raise: '준비 완료 · 먼 쪽 바닥에서 퍽이 작게 보여요. 카메라를 더 높이(1~1.5m) 두고 영역을 다시 맞추면 더 정확해요',
  minimum: '준비 완료 · 전체가 잡혀요. 지금 높이가 최소라 더 낮추지 마세요 (높일수록 더 정확해요)',
  good: '준비 완료 · 카메라 위치 좋아요. 게임을 고르세요',
  room: '준비 완료 · 아주 잘 보여요. 카메라가 화면(TV)을 가리면 조금 낮춰도 돼요',
};

/** 지금 영역·등록된 퍽으로 카메라 위치 점검 (measured: 3/3 에서 잰 값, 없으면 어림만). 마우스 모드·미등록이면 null */
function checkPlacement(measured = null) {
  const m = app.lastVision?.floor?.mapping;
  if (app.mouseMode || !m || !(settings.puckModel.area > 0)) return null;
  const r = placementCheck({ mapping: m, puckArea: settings.puckModel.area, PW: vision.PW, measured });
  app.placement = r; // 테스트·문제 확인용
  return r;
}

function paintTest() {
  const t = app.test; if (!t) return;
  $('#test-count').textContent = `${t.targets.filter((g) => g.hit).length} / ${t.targets.length}`;
}

function updateSetupTest(dt, now) {
  const t = app.test; if (!t) return;
  app.calib.active = false; app.idleHold = 0;
  const seen = tracker.state === 'tracked' && !!tracker.pos;
  t.lostFor = seen ? 0 : t.lostFor + dt;
  if (seen) t.lastV = tracker.pos.y;
  // 카메라 위치 점검: 새 영상마다 한 번, 퍽이 먼 쪽 절반(화면 위쪽)에 있는 동안 놓친 비율
  const res = app.lastVision;
  if (res && app.lastFrameAt !== t.frameAt) {
    t.frameAt = app.lastFrameAt;
    const v = seen ? tracker.pos.y : t.lastV;
    if (v != null && v < 0.35) { t.meas.farFrames++; if (!res.puck) t.meas.farMissed++; }
  }
  if (seen) {
    for (const g of t.targets) {
      if (!g.hit && Math.hypot(tracker.pos.x - g.x, tracker.pos.y - g.y) < t.r) {
        g.hit = true; sfx.tick(); paintTest();
        if (res?.puck) (g.y < 0.5 ? t.meas.far : t.meas.near).push(res.puck.area); // 그 자리에서 퍽이 보인 크기
      }
    }
  }
  if (t.targets.every((g) => g.hit)) {
    // 네 모서리 모두 잡힘 -> 바로 모드 창 (카메라 높이 점검 결과는 모드 창 위 안내로)
    const pc = checkPlacement(t.meas);
    const advice = pc ? PLACEMENT_ADVICE[pc.verdict] : null;
    sfx.target();
    finishSetup();
    toast(advice || '준비 완료 · 게임을 고르세요', advice ? 6000 : 2500);
    return;
  }
  const farLost = t.meas.farFrames > 40 && t.meas.farMissed / t.meas.farFrames > 0.35 && t.lastV != null && t.lastV < 0.35;
  const hint = t.lostFor > 1.2 ? (farLost ? '먼 쪽에서 자꾸 놓쳐요 · 카메라를 더 높이' : '퍽이 안 보여요 · 퍽 다시 등록') : '퍽을 네 모서리 표적에';
  if ($('#test-hint').textContent !== hint) $('#test-hint').textContent = hint;
}

function finishSetup() {
  quietCalibReset();
  setSetup(null);
  openModeAfterStart();
}

/**
 * 시작 준비가 끝나면: 바로 게임으로 가지 않고 모드 창을 연다 (게임 종류·시간 선택). 고른 뒤 원 안 안내가 이어진다.
 * 이때 퍽은 마지막 표적(바닥 모서리) 자리에 있어 커서가 모서리 카드(아케이드 등) 위에 놓이므로,
 * 퍽으로 고르기는 가운데 칸(puck)에 한 번 둔 뒤에야 켠다 (modeNeedCenter) — 아케이드가 저절로 골라져 시작되지 않게
 */
function openModeAfterStart() {
  app.afterStart = true;
  app.modeNeedCenter = true;
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
    track('camera_start');
    els.splash.classList.add('hidden');
    $('#splash-diag').classList.add('hidden');
    app.started = true;
    app.startedAt = clockNow();
    noteAttendance();
    requestWakeLock();
    requestAnimationFrame(loop);
    setSetup('area-wait'); // 첫 영상이 들어오면 1/3 영역 설정부터 (loop 에서 시작)
    if (document.documentElement.requestFullscreen && !navigator.standalone) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  } catch (err) {
    console.error(err);
    track('camera_error', { error: String(err?.name || 'Error').slice(0, 40) });
    showSplashError(describeCameraError(err));
    els.btnCamera.disabled = false;
    els.btnCamera.textContent = '다시 시도';
    await showCameraDiagnostics(err);
  }
}

/** 카메라 실패 진단: 감지된 장치 목록 + 선택 재시도. 환경 정보는 화면에 안 보이고 '진단 정보 복사'로만 (카메라가 하나도 없으면 상자째 숨김) */
async function showCameraDiagnostics(err) {
  const box = $('#splash-diag'), sel = $('#diag-camera'), info = $('#diag-info');
  let devices = [];
  try { devices = await camera.listDevices(); } catch { /* ignore */ }
  box.classList.toggle('hidden', !devices.length);
  info.classList.add('hidden');
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
    $('#btn-copy-diag').addEventListener('click', async () => { try { await navigator.clipboard.writeText(info.textContent); toast('진단 정보를 복사했습니다'); } catch { info.classList.remove('hidden'); toast('복사 실패: 아래 내용을 직접 선택해 복사하세요'); } });
  }
}

async function flipCamera() {
  if (app.mouseMode) { toast('체험 모드에서는 카메라를 쓰지 않아요'); return; }
  if (app.remoteMode) { remote?.host.send({ t: 'flip' }); toast('휴대폰 카메라를 전환합니다'); return; }
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
  const { width, height, facing } = await camera.start(settings.cameraId, settings.facing, settings.camRate === '30' ? 30 : 60);
  camRateAuto.reset();
  if (facing === 'user' || facing === 'environment') settings.facing = facing;
  const track = camera.stream.getVideoTracks()[0];
  track.addEventListener('ended', () => { app.cameraLost = true; toast('카메라 연결이 끊겼습니다. 설정에서 카메라를 다시 선택하세요.', 6000); if (game.running) game.stop('manual'); });
  app.cameraLost = false;
  app.lastFrameAt = clockNow();
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
    game.plane = { A: f.h / f.w, flip: depthFlip() };
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

/** 들어온 카메라 프레임 하나 인식: 걸린 시간(ms, 부드럽게 평균)과 초당 처리 프레임(fps)을 화면 칩에 보이려고 잰다 */
function processFrame(video) {
  const t0 = performance.now();
  const r = vision.process(video, settings);
  const ms = performance.now() - t0;
  app.procMs = app.procMs ? app.procMs + (ms - app.procMs) * 0.1 : ms;
  countFrame();
  return r;
}

/** 초당 처리 프레임 수: 1초마다 그동안 처리한 프레임 수 (게임 시계가 아닌 실제 시간으로 — 설정 창이 열려 멈춘 동안에도) */
function countFrame() {
  const t = performance.now();
  app.frames++;
  if (t - app.fpsAt >= 1000) {
    // 1.5초 안쪽 구간만 '이 기기가 따라가는 속도'로 믿는다 (창이 열려 멈췄던 구간 제외)
    app.fpsFresh = t - app.fpsAt < 1500;
    app.fps = t - app.fpsAt < 2000 ? Math.round((app.frames * 1000) / (t - app.fpsAt)) : app.frames;
    app.frames = 0; app.fpsAt = t;
  }
}

/** '카메라 프레임' 설정 적용: 직접 연결 카메라는 바로 바꾸고, 휴대폰 카메라 연결이면 휴대폰에 알린다 (휴대폰이 Wi-Fi 상태를 보고 정함) */
function applyCamRate() {
  camRateAuto.reset();
  app.fpsFresh = false;
  if (app.remoteMode) remote?.host.send({ t: 'rate', mode: settings.camRate });
  else if (!app.mouseMode) camera.setFrameRate(settings.camRate === '30' ? 30 : 60);
}

/** 자동: 1초마다 이 기기가 카메라 프레임을 따라가는지 보고, 60을 다 인식하지 못하면 카메라를 30으로 (게임 중 화면만 볼 때 — 설정 창 미리보기는 빼고) */
function autoCameraRate(now) {
  if (!app.fpsFresh) return;
  app.fpsFresh = false;
  if (settings.camRate !== 'auto' || app.remoteMode || app.mouseMode) return;
  const next = camRateAuto.update(now, camera.frameRate(), app.fps);
  if (next) camera.setFrameRate(next);
}

/** 화면 칩: '58 fps · 3.1ms' + 마우스를 올리면 카메라가 보내는 fps, 영역을 읽는 해상도 */
function fpsChipText() {
  if (app.frozenWarned || app.cameraLost) return '영상 없음';
  if (app.mouseMode || !(app.procMs > 0)) return `${app.fps} fps`;
  return `${app.fps} fps · ${app.procMs < 10 ? app.procMs.toFixed(1) : Math.round(app.procMs)}ms`;
}

function fpsChipTitle() {
  const r = vision.roi, cam = camera.frameRate();
  const parts = [`인식 ${app.fps} fps, 프레임당 ${app.procMs ? app.procMs.toFixed(1) : '-'}ms`];
  if (app.remoteMode && app.remoteLink?.fps) parts.push(app.remoteLink.mode === 'auto' ? `휴대폰 연결 ${app.remoteLink.fps}fps (Wi-Fi 상태에 맞춰 자동)` : `휴대폰 연결 ${app.remoteLink.fps}fps (고정)`);
  else if (cam) parts.push(camRateAuto.lowered && settings.camRate === 'auto' ? `카메라 ${Math.round(cam)} fps (이 기기에 맞춰 자동으로 낮춤)` : `카메라 ${Math.round(cam)} fps`);
  if (r) parts.push(`영역 ${r.W}×${r.H}px로 읽음 (×${r.sx.toFixed(2)})`);
  return parts.join(' · ');
}

// =============== 메인 루프 ===============
function loop(raw) {
  if (!app.started) return;
  requestAnimationFrame(loop);
  // 설정·운영자·보정·랭킹·로그인·커뮤니티 창이 떠 있으면 뒤의 모든 것을 멈춘다 (게임 시간·날아오는 퍽·대기 원 모두)
  if (optionPanelOpen()) {
    if (clock.pausedAt == null) { clock.pausedAt = raw; app.paused = true; pauseIdle(); updateHud(); }
    previewWhilePaused(raw - clock.offset);
    return;
  }
  if (clock.pausedAt != null) { clock.offset += raw - clock.pausedAt; clock.pausedAt = null; app.paused = false; }
  const now = raw - clock.offset; // 멈춘 시간을 뺀 게임 시계 (clockNow() 와 같은 기준)
  const video = els.video;
  if (app.mouseMode) stepMouse(now);
  else if (video.readyState < 2) return;

  if (video.videoWidth && (video.videoWidth !== vision.srcW || video.videoHeight !== vision.srcH)) {
    // 휴대폰 회전 등으로 영상 크기가 바뀜 (휴대폰 카메라는 연결 속도에 따라 해상도만 바뀌기도 한다 — 그때는 비율이 그대로)
    const oldAr = vision.srcW && vision.srcH ? vision.srcW / vision.srcH : null;
    vision.setSourceSize(video.videoWidth, video.videoHeight);
    els.view.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    layout();
    const ar = video.videoWidth / video.videoHeight;
    if (oldAr && (oldAr > 1) !== (ar > 1)) onOrientationFlip(oldAr, ar);
  }

  let result = app.lastVision;
  if (!app.mouseMode && video.currentTime !== app.lastVideoTime) {
    app.lastVideoTime = video.currentTime;
    app.lastFrameAt = now;
    // 연결이 끊긴 뒤 늦게 들어온 마지막 프레임으로 '끊겼습니다' 안내를 덮지 않게 (다시 이어지면 따로 알림)
    if (app.frozenWarned) { app.frozenWarned = false; if (!app.cameraLost) toast('카메라 영상이 다시 들어옵니다'); }
    result = processFrame(video);
    app.lastVision = result;
    autoCameraRate(performance.now());

    // 조작 대상(퍽 또는 스틱 블레이드) 측정값 -> 정규화 바닥 좌표
    const m = result.floor.mapping;
    const toUV = (obj) => {
      if (!m || !obj) return null;
      const [u, v] = m.toUV(obj.x, obj.y);
      return u > -0.05 && u < 1.05 && v > -0.05 && v < 1.05 ? { u: clamp(u, 0, 1), v: clamp(v, 0, 1) } : null;
    };
    let meas;
    if (settings.controller === 'stick') meas = toUV(result.stick);
    else if (settings.stickModel) {
      // 스틱이 지정돼 있으면: 블레이드 바로 옆에서 퍽이 사라졌을 때(스틱에 가림) 잠시 블레이드 자리로 퍽을 잇는다.
      // 애매한 조각(가늘고 긴 샤프트 토막 등)이 블레이드 + 간격 자리에서 멀면 퍽으로 보지 않는다 (occlusion.js BRIDGE_TRUST)
      const pu = toUV(result.puck);
      if (pu && result.puck.doubtful) pu.doubtful = true;
      meas = stickBridge.step(pu, toUV(result.stick), now);
      if (meas?.bridged && m) { const [bx, by] = m.toPx(meas.u, meas.v); vision.holdPuckAt(bx, by); }
    } else meas = toUV(result.puck);
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
  if (!modeOpen) app.modeNeedCenter = false; // 시작 준비 직후의 '가운데 칸 먼저'는 그 모드 창에서만
  if (app.calib.manual) updateAutoCalibration(dt);
  else if (app.setup === 'test') updateSetupTest(dt, now);
  else if (!els.panelCommunity.classList.contains('hidden')) pauseIdle(); // 글을 읽고 쓰는 동안은 핸즈프리 시작을 멈춘다
  else if (!els.panelResult.classList.contains('hidden')) updateResultChoice(dt);
  else if (modeOpen) updateModeChoice(dt);
  else if (game.mode.id === 'free' && !game.running && app.started && !app.areaEditing && !app.calibTarget) updateCourseIdle(dt);
  else updateIdleCircle(dt);

  game.arcade.idleAutoStart = settings.autoStart;
  game.arcade.idleHold = app.idleHold;
  applyWash(); // 게임마다 다른 배경·퍽 투명도 규칙 (모드가 바뀌어도 바로)
  updatePuckCover(result, now);
  renderer.draw({ vision: result, puck: tracker, game, procSize: { PW: vision.PW, PH: vision.PH }, now, showCandidates: settings.debug && !game.running, idleHold: app.idleHold, calib: app.calib, areaEditing: app.areaEditing, areaDragging: app.cornerDrag, cover: app.cover, setupTest: app.setup === 'test' ? app.test : null, pick: app.calibTarget });
  drawTransparencyPreview(result);
  if (settings.debug && vision.debugImage) els.debug.getContext('2d').putImageData(vision.debugImage, 0, 0);

  if (now - app.hudAt > 100) { app.hudAt = now; updateHud(); updateChips(result); }
}

/**
 * 게임 종료 후 선택 (결과 화면이 떠 있는 동안): 퍽을 왼쪽 영역에 2초 두면 한 번 더, 오른쪽 영역에 두면 모드 선택.
 * 결과 창이 카메라를 가리므로 창 안의 트랙에 퍽의 좌우 위치를 점으로 보여준다.
 */
/** 체험(마우스·터치) 한 프레임: 포인터 -> 추적 좌표 -> Tracker (커서가 화면 밖이거나 손가락을 떼도 마지막 자리를 유지) */
function stepMouse(now) {
  let meas = null;
  // 마우스 모드도 카메라와 같이 네 모서리로 정한 바닥을 쓴다 (게임은 모두 평면 경기장이라 맵이 비틀리지 않음).
  // 바닥은 대기 화면의 퍽 등록·시작 원 자리(영역 가운데)와 영역 편집 격자에 쓰인다
  const q = settings.floorMode === 'manual' && settings.manualQuad ? settings.manualQuad : null;
  const floorMap = q ? makeFloorMapping(q.map(([u, v]) => [u * vision.PW, v * vision.PH])) : null;
  if (mouse.has) {
    meas = pointerToUV(mouse.x, mouse.y, {
      floorMap, PW: vision.PW, PH: vision.PH,
      view: els.view, canvas: renderer.canvas, game, topInset: renderer.topInset, cursorFlip: !settings.reverseDepth,
      // 퀵 핸즈·반응 타겟 화면: 내 퍽을 영상 속 퍽과 위아래 반대 자리에 그리므로 커서도 그 자리로 (대기 중 가운데 원은 진짜 자리)
      puckFlip: renderer.view === 'floor' && FLOOR_FLIP_MODES.has(game.mode.id) && game.plane.flip,
      modeList: els.modeList, modeOpen: !els.panelMode.classList.contains('hidden'),
      choiceTrack: $('#choice-track'), resultOpen: !els.panelResult.classList.contains('hidden'),
    });
  }
  app.lastVision = mouseVisionResult(vision.PW, vision.PH, meas, floorMap);
  vision.useArea(app.lastVision.floor.mapping, { area: 0, widthM: settings.floorWidthM }); // 마우스: 등록된 퍽 크기 대신 영역 폭으로
  app.lastFrameAt = now;
  countFrame();
  // 마우스는 튀지 않으므로 이상치 게이트를 거치지 않게 매 프레임 새로 획득한 것처럼 넣는다
  if (meas && tracker.pos) {
    const dt = tracker.lastTime ? Math.max(1e-3, Math.min(0.1, (now - tracker.lastTime) / 1000)) : 1 / 60;
    const dx = meas.u - tracker.pos.x, dy = meas.v - tracker.pos.y;
    tracker.vel = { x: dx / dt, y: dy / dt };
    tracker.pos = { x: meas.u - tracker.vel.x * dt, y: meas.v - tracker.vel.y * dt };
  }
  tracker.update(meas, now);
}

/**
 * 퍽 투명도: 플레이 중 카메라 영상에 비치는 진짜 퍽을 둘레 바닥색으로 덮는다 (투명도 100% = 완전히 가림).
 * 검출이 잠깐 끊겨도(스틱에 가림·흔들림) 예측 위치로 0.6초 동안 계속 덮는다.
 */
function updatePuckCover(result, now, force = false) {
  const pa = renderer.puckAlpha;
  if ((!game.running && !force) || app.mouseMode || pa >= 0.999 || settings.controller !== 'puck') { app.cover = null; return; }
  let x = null, y = null;
  if (result.puck) { x = result.puck.x; y = result.puck.y; }
  // 멈춘 동안(설정 미리보기)은 추적기가 멈춰 있으니 그 자리로 덮지 않는다 — 검출만, 끊기면 아래 0.6초 유지
  else if (!force && tracker.pos && tracker.state !== 'lost' && result.floor?.mapping) [x, y] = result.floor.mapping.toPx(tracker.pos.x, tracker.pos.y);
  const prev = app.cover;
  if (x == null) { if (!(prev && now - prev.at < 600)) app.cover = null; else prev.alpha = 1 - pa; return; }
  const area = result.puck?.area || settings.puckModel.area || 40;
  const r = Math.max(3, Math.sqrt(area / Math.PI));
  const ring = vision.ringColor(x, y, r * 2.2, r * 3.4);
  const rgb = !ring ? prev?.rgb || { r: 236, g: 233, b: 226 }
    : prev ? { r: prev.rgb.r + (ring.r - prev.rgb.r) * 0.3, g: prev.rgb.g + (ring.g - prev.rgb.g) * 0.3, b: prev.rgb.b + (ring.b - prev.rgb.b) * 0.3 } : ring;
  app.cover = { x, y, r: prev ? Math.max(r, prev.r * 0.92) : r, rgb, alpha: 1 - pa, at: now };
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
  // 중지 버튼으로 멈춘 결과는 퍽으로 고르지 않는다 (멈추자마자 다시 시작되는 일 방지) — 버튼만
  const enabled = settings.autoStart && !ch.manual;
  $('#choice-track').classList.toggle('hidden', !enabled);
  $('#result-choice').classList.toggle('no-puck', !enabled);
  const tracked = enabled && tracker.state === 'tracked' && !!tracker.pos;
  const u = tracker.pos ? tracker.pos.x : null;
  // 결과가 뜰 때 퍽이 있던 쪽은 한 번 벗어났다가 와야 센다 (게임이 끝난 자리에 퍽이 있어 저절로 고르는 일 방지)
  const armed = performance.now() >= ch.armAt;
  const raw = tracked && u !== null ? choiceSide(u) : null;
  if (ch.blocked === undefined) ch.blocked = raw; // 결과가 뜬 첫 프레임의 자리 (1.5초 안에 옮긴 쪽은 막지 않음)
  if (ch.blocked && tracked && raw !== ch.blocked) ch.blocked = null;
  const hint = ch.blocked ? '가운데로 옮겼다가 다시' : '퍽을 왼쪽·오른쪽에 2초';
  if ($('#choice-hint').textContent !== hint) $('#choice-hint').textContent = hint;
  const fire = enabled ? stepChoice(ch, { u, tracked, dt, armed: armed && !ch.blocked }) : null;
  if (!enabled) { ch.side = null; ch.hold = 0; }
  // 1초마다 틱
  if (ch.side && ch.hold > 0) { const remain = Math.ceil(CHOICE_HOLD_S - ch.hold); if (remain !== ch.tick) { ch.tick = remain; sfx.tick(); } } else ch.tick = -1;
  paintChoice(tracked ? u : null);
  if (!fire) return;
  ch.side = null; ch.hold = 0; paintChoice(null);
  if (fire === 'R') { $('#btn-result-mode').click(); return; }
  if (!els.btnNext.classList.contains('hidden')) { els.btnNext.click(); return; }
  // 퍽으로 '한 번 더': 결과를 닫고 가운데 원으로 (원에 3초 = 바로 시작, 카운트다운 한 번만)
  close(els.panelResult);
  toast('퍽을 가운데 원에 3초 두면 시작', 3000);
}

/**
 * 모드 선택 화면을 퍽으로 고르기: 퍽의 (좌우, 앞뒤) 위치를 카드 목록 위의 빨간 커서로 옮기고,
 * 카드 안쪽에 2초 머물면 그 모드를 선택한다(테두리 근처는 어느 카드도 아님). 창이 열릴 때 커서가 올라가 있던 카드는 한 번 벗어났다가 다시 와야 한다
 * (결과 화면에서 퍽을 오른쪽에 둔 채 넘어왔을 때 엉뚱한 카드가 바로 선택되는 것을 방지).
 * 시작 준비 직후(modeNeedCenter)에는 퍽을 가운데 칸(puck)에 한 번 둔 뒤에야 고른다 (가운데 칸이 빨갛게 표시되고 안내가 바뀜)
 */
const PICK_HINT = '퍽을 카드 가운데에 2초 두면 선택';
const PICK_HINT_CENTER = '퍽을 가운데(puck) 칸에 두었다가 카드에 2초';
function updateModeChoice(dt) {
  const c = app.calib; c.active = false; c.hold = 0; app.idleHold = 0; autoCal.reset();
  $('#btn-replace-puck').classList.add('hidden');
  const cursor = $('#mode-cursor');
  const enabled = settings.autoStart;
  const hintEl = $('#mode-pick-hint'), waitCell = $('#mode-list .mode-wait');
  hintEl.classList.toggle('hidden', !enabled);
  const hintKey = app.modeNeedCenter ? 'center' : 'card';
  if (hintEl.dataset.k !== hintKey) { hintEl.dataset.k = hintKey; hintEl.textContent = app.modeNeedCenter ? PICK_HINT_CENTER : PICK_HINT; }
  waitCell?.classList.toggle('need', enabled && !!app.modeNeedCenter);
  if (!app.modePick) app.modePick = { key: null, hold: 0, tick: -1, armAt: performance.now() + 800, blocked: undefined };
  const mp = app.modePick;
  const cards = $$('#mode-list .mode-card');
  const tracked = enabled && tracker.state === 'tracked' && !!tracker.pos;
  let idx = null;
  if (tracked) {
    const r = els.modeList.getBoundingClientRect();
    const u = clamp(tracker.pos.x, 0, 1), v = clamp(!settings.reverseDepth ? 1 - tracker.pos.y : tracker.pos.y, 0, 1); // 기본: 카메라 쪽으로 밀면 커서가 위로
    const cx = r.left + u * r.width, cy = r.top + v * r.height;
    cursor.style.left = `${cx}px`; cursor.style.top = `${cy}px`;
    cursor.classList.remove('hidden');
    const hit = cards.findIndex((card) => inCardCore(card.getBoundingClientRect(), cx, cy)); // 테두리 근처는 고르지 않음
    idx = hit >= 0 ? hit : null;
    if (mp.blocked === undefined) mp.blocked = idx;               // 열릴 때 올라가 있던 카드
    else if (mp.blocked !== null && idx !== mp.blocked) mp.blocked = null; // 한 번 벗어나면 해제
    if (app.modeNeedCenter && waitCell && inCardCore(waitCell.getBoundingClientRect(), cx, cy)) app.modeNeedCenter = false; // 가운데 칸에 왔으면 이제 고를 수 있음
  } else cursor.classList.add('hidden');
  const armed = performance.now() >= mp.armAt && !app.modeNeedCenter;
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
  const show = app.started && game.mode.id === 'free' && !app.calib.manual && !app.areaEditing && !app.calibTarget;
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
  // 8자 드리블: 등록된 퍽이 있으면 시작 원과 퍽 인식을 흰 훈련 화면(평면 경기장)의 가운데 원에서 한다
  c.plane = game.mode.id === 'figure8' && !!c.registered;
  const circle = c.circle;
  const mapping = app.lastVision?.floor?.mapping;
  let puckInCircle = false;
  if (tracker.state === 'tracked' && tracker.pos && mapping) {
    if (c.plane) {
      const me = game.toPlane(tracker.pos.x, tracker.pos.y);
      puckInCircle = Math.hypot(me.x - game.center.x, me.y - game.center.y) < F8_HOLD_R * 1.25;
    } else {
      const [px, py] = mapping.toPx(tracker.pos.x, tracker.pos.y);
      puckInCircle = Math.hypot(px - circle.x, py - circle.y) < circle.r * 1.3;
    }
  }
  if (tracker.state === 'tracked' && tracker.pos && !puckInCircle) app.idleBlocked = false;
  if (puckInCircle && app.idleBlocked) {
    // 중지 버튼으로 멈춘 직후: 퍽이 원 안에 그대로 있어도 바로 다시 시작하지 않는다
    autoCal.reset(); c.status = 'blocked'; c.sample = null; c.hold = 0; app.idleHold = 0; app.idleTick = -1;
    return;
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
  // 8자 흰 화면 시작 원: 카메라 원 안의 물체 학습은 하지 않는다 (퍽 교체는 다른 게임 화면이나 보정에서)
  if (c.plane) { autoCal.reset(); c.hold = 0; c.status = 'none'; c.sample = null; $('#btn-replace-puck').classList.add('hidden'); return; }
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
  let boosted = false;
  if (target === 'puck') {
    if (!app.mouseMode) track('puck_registered');
    // 아주 작게 보이는 퍽은 인식 해상도를 올려 따라간다 (면적·자리는 새 해상도로 환산)
    const k = boostForSmallPuck(model.area);
    if (k !== 1) { boosted = true; model.area = Math.round(model.area * k * k); }
    settings.puckModel = model; settings.puckTol = done.tol;
    vision.seedPuck(done.cx * k, done.cy * k, model.area); tracker.reset(); stickBridge.reset();
    $('#set-puckTol').value = done.tol; $('#out-puckTol').value = done.tol;
  } else {
    settings.stickModel = model; settings.stickTol = done.tol;
    $('#set-stickTol').value = done.tol; $('#out-stickTol').value = done.tol;
  }
  autoCal.reset();
  persist(); refreshCalibUI();
  sfx.target();
  if (app.setup === 'puck' && target === 'puck') { beginTestSetup(); return; }
  if (app.calibFromMode) { backToModeAfterCalib(); toast(target === 'puck' ? '퍽 등록 완료' : '스틱 등록 완료', 3000); return; }
  if (refresh) toast('등록된 퍽을 다시 인식했어요 · 원에 3초 더 두면 시작', 3500);
  else if (boosted) toast('퍽 등록 완료 · 퍽이 작게 보여 인식 해상도를 400으로 올렸어요', 4000);
  else toast(target === 'puck' ? '퍽 등록 완료 · 원에 3초 더 두면 시작' : '스틱 등록 완료', 3500);
}

// =============== HUD ===============
function updateHud(force) {
  const who = app.account?.current();
  els.hudMode.textContent = game.mode.name + (game.mode.levels && settings.difficulty !== 'normal' ? ` · ${levelLabel(settings.difficulty)}` : '') + (settings.invisible ? ' · 투명' : '') + (app.versus ? ` · ${app.versus.names[app.versus.current]}` : who ? ` · ${who.nick}` : '');
  const ch = game.mode.id === 'free' ? app.challenge : null;
  const sc = game.mode.id !== 'free' ? app.scoreChallenge : null;
  els.hudInstruction.textContent = game.running ? (app.paused ? '일시정지 · 창을 닫으면 이어서 합니다' : game.instruction)
    : !app.started ? '' : ch ? `도전 · ${ch.title}${ch.holder ? ` · 1위 평균 ${ch.holder.avg.toFixed(1)}s` : ''}`
      : sc ? `도전 · ${sc.nick} · ${sc.score}점` : settings.autoStart && !app.mouseMode ? '퍽을 원에 3초 또는 시작' : '시작을 누르세요';
  $('#app').classList.toggle('playing', game.running);
  $('#app').classList.toggle('hide-cursor', !!app.mouseMode && game.running && renderer.puckAlpha < 1);
  const f8 = game.mode.id === 'figure8' && app.started && !app.areaEditing && !app.setup;
  $('#f8-dir').classList.toggle('hidden', !f8);
  if (f8) {
    const side = settings.figure8Dir[0], rot = f8Rot(settings.figure8Dir);
    $$('#f8-side button').forEach((b) => { const on = b.dataset.side === side; b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on)); });
    $$('#f8-rot button').forEach((b) => { const on = b.dataset.rot === rot; b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on)); });
  }
  if (game.limit > 0) {
    // 여러 훈련을 잇는 모드(와이드)는 지금 훈련의 남은 시간
    const t = Math.ceil(game.mode.stages ? (game.running ? game.stageLeft : game.playSeconds) : game.running ? game.timeLeft : game.limit);
    els.hudTimer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    els.hudTimer.classList.toggle('urgent', game.running && t <= 5);
  } else {
    els.hudTimer.classList.remove('urgent');
    const e = game.running ? game.elapsed : 0;
    els.hudTimer.textContent = `${Math.floor(e / 60)}:${String(Math.floor(e % 60)).padStart(2, '0')}`;
  }
  els.hudScore.textContent = String(game.score);
  els.hudLives.textContent = game.running && game.mode.timed && game.hits > 0 ? `충돌 ${game.hits}` : '';
  if (game.mode.stages) els.hudLives.textContent = game.mode.id === 'quick' ? `세트 ${(game.running ? game.quickSet : 0) + 1}/${game.mode.stages}` : `훈련 ${game.stage + 1}/${game.mode.stages}`;
  // 자유 연습 코스: 사이클 진행(완료/목표)과 평균·가장 빠른 사이클 시간
  const courseOn = game.mode.id === 'free' && game.course.points.length > 0;
  $('.hud-right .hud-label').textContent = courseOn ? 'Cycle' : 'Score';
  els.hudLives.classList.toggle('info', courseOn || !!game.mode.stages);
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
    setChip(els.chipPuck, mouse.has ? 'ok' : 'warn', '퍽(마우스·터치)');
    setChip(els.chipStick, '', '스틱(체험 모드)');
    els.chipFps.textContent = fpsChipText();
    return;
  }
  setChip(els.chipPuck, result.puck ? 'ok' : (!stickCtl && (tracker.state === 'predicted' || stickBridge.active)) ? 'warn' : 'bad', stickCtl ? '퍽' : '퍽(조작)');
  if (settings.stickModel) setChip(els.chipStick, result.stick ? 'ok' : 'bad', stickCtl ? '스틱(조작)' : '스틱');
  else setChip(els.chipStick, '', '스틱(미지정)');
  els.chipFps.textContent = fpsChipText();
  els.chipFps.title = fpsChipTitle();
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
  if (!app.lastVision?.floor?.mapping) { toast('게임 영역이 없어요 · 영역 버튼으로 네 모서리를 맞추세요'); return; }
  if (settings.controller === 'stick' && !settings.stickModel) { toast('조작 대상이 스틱입니다. 보정에서 스틱 색을 먼저 지정하세요.'); return; }
  if (game.mode.id !== 'free' && tracker.state === 'lost') { toast(settings.controller === 'stick' ? '스틱 블레이드가 인식(마름모 표시)된 뒤 시작하세요.' : '퍽이 인식(빨간 점 표시)된 뒤 시작하세요.'); }
  tracker.resetStats();
  game.start(tracker, opts);
  if (!app.mouseMode) track('game_start', { mode: game.mode.name, member: app.account?.current() ? 'member' : 'guest' });
  if (settings.invisible) toast('투명 모드 — 화면에 내 퍽이 보이지 않습니다. 손의 감각으로!', 2600);
  else if (visualRules().puck > 0) { const pt = visualRules().puck; toast(pt === 100 ? '내 퍽 투명도 100% — 화면에 퍽이 보이지 않습니다. 감각으로 영역에 들어가세요!' : `내 퍽 투명도 ${pt}%`, 2600); }
  updateHud();
}

game.onEnd = (result) => {
  result.versus = !!app.versus;
  app.lastResult = result;
  // 0점은 최고 기록으로 치지 않는다 (처음 한 판을 바로 멈췄을 때 'New best 0' 방지)
  const isBest = result.mode.id !== 'free' && result.reason !== 'manual' && Number(result.score) > 0 ? saveBest(result.rankKey || result.mode.id, result.score) : false;
  app.idleBlocked = result.reason === 'manual';
  showResult(result, isBest);
  submitResult(result);
  recordPlay(result);
  trackPlay(result);
  renderShare(result);
  updateHud();
};

function showResult(result, isBest) {
  let title = result.mode.timed ? `${result.mode.name} · ${timeLabel(result.mode, result.seconds || result.limit)}` : result.mode.name;
  if (result.level && result.level !== 'normal') title += ` · ${levelLabel(result.level)}`;
  if (result.invisible) title += ' · 투명';
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
      els.btnAgain.dataset.rematch = '1';
      app.versus = { names: vs.names, scores: [], current: 0 };
    }
  } else {
    els.btnNext.classList.add('hidden');
    els.btnAgain.classList.remove('hidden');
    els.btnAgain.querySelector('.choice-label').textContent = '한 번 더';
    els.btnAgain.dataset.rematch = '';
  }
  els.resultTitle.textContent = title;
  els.resultBody.innerHTML = body.join('');
  // 결과가 뜬 직후 1.5초는 세지 않음. blocked: 그때 퍽이 있던 쪽 (한 번 벗어나야 셈). manual: 중지로 끝남 (퍽 선택 없음)
  app.choice = { side: null, hold: 0, tick: -1, armAt: performance.now() + 1500, blocked: undefined, manual: result.reason === 'manual' };
  paintChoice(null);
  open(els.panelResult);
}

// =============== 커뮤니티 ===============
// =============== 개발자에게 (커뮤니티) ===============
// 한 사람당 하나, 다시 보내면 고쳐짐. 베타 종료일 전에 보내면 3개월 이용권 추첨 대상 (30명, 운영자 화면에서 추첨)
function setupFeedback() {
  const form = $('#fb-form');
  ['fb-good', 'fb-fix'].forEach((id) => $(`#${id}`).addEventListener('input', () => countFeedback(id)));
  $('#comm-feedback').addEventListener('click', () => openFeedback());
  $('#comm-write').addEventListener('click', () => form.classList.add('hidden'));
  $('#fb-cancel').addEventListener('click', () => form.classList.add('hidden'));
  els.authWho.addEventListener('click', (e) => { if (e.target.closest('[data-feedback]')) openFeedback(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!app.account?.current()) return;
    const err = $('#fb-error');
    err.classList.add('hidden');
    const u = app.account.current();
    const entered = !u.feedbackAt && !u.until && app.account.memberState() === 'beta'; // 처음 보냄 = 추첨 응모
    $('#fb-submit').disabled = true;
    try {
      await app.account.sendFeedback({ good: $('#fb-good').value, fix: $('#fb-fix').value });
      form.classList.add('hidden');
      toast(entered ? '보내 주셔서 고마워요! 3개월 이용권 추첨에 응모되었어요' : '보내 주셔서 고마워요!', 4000);
      refreshAuthUI();
    } catch (ex) {
      err.textContent = ex.message || String(ex);
      err.classList.remove('hidden');
    } finally { $('#fb-submit').disabled = false; }
  });
}

function countFeedback(id) { $(`#${id}-count`).textContent = `${$(`#${id}`).value.length}/${FEEDBACK_MAX}`; }

async function openFeedback() {
  if (!app.account?.current()) { toast('개발자에게 보내려면 로그인하세요 (첫 화면에서 로그인)'); return; }
  close(els.panelSettings);
  await community.open();
  const st = app.account.memberState(), end = app.site?.betaEndsAt;
  $('#fb-intro').textContent = {
    beta: end ? `베타 기간(${shortDate(end)}까지)에 개선할 점이나 오류를 보내 주신 분 중 30명을 추첨해 3개월 이용권을 드려요. 좋았던 점, 고쳤으면 하는 점을 자유롭게 적어 주세요.`
      : '개선할 점이나 오류를 보내 주신 분 중 30명을 추첨해 3개월 이용권을 드려요. 좋았던 점, 고쳤으면 하는 점을 자유롭게 적어 주세요.',
    kept: '좋았던 점, 고쳤으면 하는 점을 자유롭게 적어 주세요. 언제든 고쳐서 다시 보낼 수 있어요.',
    coupon: app.account.current()?.coupon === EXT_PASS ? '이용 기간이 연장된 정회원이에요. 의견은 언제든 고쳐서 다시 보낼 수 있어요.'
      : '3개월 이용권으로 정회원이에요. 의견은 언제든 고쳐서 다시 보낼 수 있어요.',
    lapsed: '베타 기간이 끝나 정회원 기간이 끝났어요. 의견은 계속 보낼 수 있고, 등급은 공식 인스타 DM으로 문의해 주세요.',
  }[st] || '좋았던 점, 고쳤으면 하는 점을 자유롭게 적어 주세요.';
  $('#fb-error').classList.add('hidden');
  let prev = null;
  try { prev = await app.account.getMyFeedback(); } catch { prev = null; }
  $('#fb-good').value = prev?.good || '';
  $('#fb-fix').value = prev?.fix || '';
  ['fb-good', 'fb-fix'].forEach(countFeedback);
  $('#fb-submit').textContent = prev ? '고쳐서 보내기' : '보내기';
  const form = $('#fb-form');
  form.classList.remove('hidden');
  form.scrollIntoView({ block: 'nearest' });
  $('#fb-good').focus();
}

function setupCommunity() {
  community = initCommunity({
    getUser: () => app.account?.current() || null,
    blocked: () => (lapsedNow() ? LAPSED : null), // 베타가 끝나 정회원이 유지되지 않은 계정: 글쓰기·응원 막음
    getStore: () => app.communityStore,
    toast,
    modeName: (id) => MODES.find((m) => m.id === id)?.name || id,
    modes: MODES.map(({ id, name, stages }) => ({ id, name, stages })),
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
  // 기록 자랑은 보통 난이도 기록만 (글의 비교 키 bragKey 에 난이도가 없음)
  const ranked = r && r.mode.id !== 'free' && (r.reason === 'time' || r.reason === 'done') && !r.versus && (r.level || 'normal') === 'normal';
  return {
    course: settings.course.length >= 2 ? { points: settings.course.map((p) => ({ n: p.n, x: p.x, y: p.y })), cycles: settings.courseCycles, record: cr } : null,
    result: ranked ? { modeId: r.mode.id, seconds: r.mode.timed ? r.seconds || r.limit : 0, score: r.score, invisible: !!r.invisible } : null,
  };
}

/** 공유된 코스를 불러와 자유 연습으로 도전 (완주하면 그 글의 기록 게시판에 오른다) */
function practicePost(post) {
  if (game.running) game.stop('manual');
  app.challenge = null;
  app.scoreChallenge = null;
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

/**
 * 기록 자랑 글의 '나도 연습하기': 같은 모드·같은 시간·같은 투명 여부로 맞춘다.
 * 끝까지 플레이하면 글쓴이와 나이가 같거나 어린 선수의 점수만 그 글의 도전 기록에 오른다 (나이가 많아도 플레이는 가능)
 */
function challengeMode(post) {
  const m = MODES.find((x) => x.id === post.modeId);
  if (!m) return;
  if (game.running) game.stop('manual');
  if (m.timed && PLAY_MINUTES.includes(post.seconds / 60)) { settings.playMinutes = post.seconds / 60; game.playSeconds = post.seconds; }
  settings.invisible = post.invisible === true; game.invisible = settings.invisible; applyWash();
  settings.difficulty = 'normal'; game.difficulty = 'normal'; // 기록 자랑 글은 보통 난이도 기록
  persist();
  app.versus = null;
  app.challenge = null;
  game.setMode(m.id);
  game.resetState();
  const u = app.account?.current();
  app.scoreChallenge = { id: post.id, title: post.title, key: bragKey(post), score: post.score, nick: post.nick, author: post.uid, limit: postAge(post) };
  closeAllPanels();
  renderModeList();
  updateHud();
  const label = `${m.name}${m.timed ? ` · ${timeLabel(m, game.playSeconds)}` : ''}${settings.invisible ? ' · 투명' : ''}`;
  const rule = u && u.id === post.uid ? '내 글이라 도전 기록에는 오르지 않습니다'
    : u && !canRecordOn(u, post) ? `기록 등록은 ${postAge(post)}세 이하만 (연습만 가능)`
      : !u ? '로그인하면 도전 기록에 오릅니다' : '';
  const head = `${label} — ${post.score}점에 도전!`;
  toast(rule ? `${head} · ${rule}` : head, 4500);
}

/** 모드·시간·투명 여부를 바꿔서 도전 중인 기록 자랑 글과 달라지면 도전을 해제한다 */
function syncScoreChallenge() {
  const sc = app.scoreChallenge;
  if (!sc) return;
  if (rankKey(game.mode.id, game.playSeconds, settings.invisible, settings.difficulty) !== sc.key) {
    app.scoreChallenge = null;
    toast('모드를 바꿔서 기록 자랑 도전이 해제되었습니다');
    updateHud();
  }
}

/** 결과 화면 아래: 커뮤니티에 공유하기 / 코스 도전 결과(기록 게시판 등록) */
async function renderShare(result) {
  const box = $('#result-share');
  box.classList.add('hidden'); box.innerHTML = '';
  if (result.versus || app.mouseMode || (result.reason !== 'time' && result.reason !== 'done')) return; // 체험 기록은 자랑·도전 기록에도 안 올림
  // 버튼 하나 또는 둘 (둘째: [라벨, 동작])
  const show = (html, btnLabel, onClick, second) => {
    box.innerHTML = `<div class="share-msg">${html}</div><div class="share-btns">${second ? `<button type="button" class="btn btn-ghost" id="btn-share-2">${second[0]}</button>` : ''}${btnLabel ? `<button type="button" class="btn" id="btn-share">${btnLabel}</button>` : ''}</div>`;
    if (btnLabel) $('#btn-share').addEventListener('click', onClick);
    if (second) $('#btn-share-2').addEventListener('click', second[1]);
    box.classList.remove('hidden');
  };
  if (result.mode.id !== 'free') {
    const sc = app.scoreChallenge && app.scoreChallenge.key === result.rankKey ? app.scoreChallenge : null;
    if (sc) { await renderScoreChallenge(result, sc, show); return; }
    if ((result.level || 'normal') !== 'normal') { show('<span>기록 자랑은 보통 난이도 기록만 올릴 수 있어요</span>'); return; }
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
  const openBoard = () => community.open({ filter: 'course', select: ch.id });
  if (!u || lapsedNow()) {
    const h = ch.holder ? ` <span>1위</span> <b data-ugc>${esc(ch.holder.nick)}</b> <strong>평균 ${s1(ch.holder.avg)}</strong>` : '';
    show(`<span>이번 기록 평균 ${s1(rec.avg)}</span>${h} <span>${u ? LAPSED : '로그인하면 기록 게시판에 올라갑니다'}</span>`, '기록 게시판 보기', openBoard);
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

/**
 * 기록 자랑 글 도전 결과: 글쓴이와 나이가 같거나 어린 선수면 그 글의 도전 기록에 등록하고 순위를 보여준다.
 * 나이가 많거나 글쓴이 본인이면 플레이만 하고 등록하지 않는다.
 */
async function renderScoreChallenge(result, sc, show) {
  const u = app.account?.current();
  const brag = () => community.compose({ type: 'record' });
  const openBoard = () => community.open({ filter: 'record', select: sc.id });
  const target = `<span>도전</span> <b data-ugc>${esc(sc.nick)}</b> <strong>${num(sc.score)}점</strong>`;
  if (!u || lapsedNow()) {
    show(`${target} <span>${u ? LAPSED : '로그인하면 도전 기록에 올라갑니다'}</span>`, '도전 기록 보기', openBoard);
    return;
  }
  try {
    const store = await app.communityStore;
    const r = await store.submitScore(u, sc.id, result.score);
    if (!r.eligible) {
      const why = r.reason === 'author'
        ? '<span>내 자랑 글이라 도전 기록에는 오르지 않습니다 — 더 높은 점수는 기록 자랑하기로 글을 바꾸세요</span>'
        : `<span>이 글의 도전 기록은 ${r.limit}세 이하만 올라갑니다 (나: ${u.age}세) — 연습으로만 남습니다</span>`;
      show(`${target} ${why}`, '기록 자랑하기', brag, ['도전 기록 보기', openBoard]);
      return;
    }
    const ph = r.prevHolder;
    let html;
    if (r.isHolder && r.improved && ph && ph.uid !== u.id) {
      sfx.target?.();
      html = `<span class="script">New record!</span> <span>1위를 넘었습니다</span> <b data-ugc>${esc(ph.nick)}</b> <strong>${num(ph.score)}점 → ${num(result.score)}점</strong>`;
    } else {
      html = `${target} <span>도전 기록 ${r.rank}위 / ${r.total}명</span>${r.improved ? ' <span>내 최고 기록 갱신</span>' : ''}`;
    }
    show(html, '기록 자랑하기', brag, ['도전 기록 보기', openBoard]);
  } catch (err) {
    show(`<span>도전 기록 등록 실패: ${esc(err.message || err)}</span>`, '기록 자랑하기', brag);
  }
}

/** 시간제 모드의 시간 표시: '1분', 여러 훈련을 잇는 모드는 '1분 × 3' */
function timeLabel(m, seconds) {
  const min = `${Math.round(seconds / 60)}분`;
  return m?.stages ? `${min} × ${m.stages}` : min;
}

function renderModeList() {
  const scores = loadScores();
  els.modeList.innerHTML = '';
  $$('#time-seg button').forEach((b) => b.classList.toggle('active', Number(b.dataset.min) === settings.playMinutes));
  $$('#level-seg button').forEach((b) => b.classList.toggle('active', b.dataset.level === settings.difficulty));
  els.invisibleToggle.checked = settings.invisible;
  // 3×3 배치: 1 2 3 / 4 (가운데 비움: 퍽 대기) 6 / 7 8 9(커뮤니티)
  const CELLS = [0, 1, 2, 3, 'wait', 4, 5, 6, 'community'];
  CELLS.forEach((cell, pos) => {
    const no = String(pos + 1).padStart(2, '0');
    if (cell === 'wait') { const w = document.createElement('div'); w.className = 'mode-wait'; w.innerHTML = '<i></i><span>puck</span>'; els.modeList.appendChild(w); return; }
    if (cell === 'community') {
      // 9번: 커뮤니티 (코스·기록 공유). 다른 카드처럼 퍽으로도 고를 수 있다
      const card = document.createElement('button');
      card.className = 'mode-card mode-community';
      card.innerHTML = `<span class="no">${no}</span><span class="time">Share</span><b>커뮤니티</b><em>Community</em><small>코스와 기록을 공유하고 도전하세요.</small>`;
      card.addEventListener('click', () => { close(els.panelMode); community.open(); });
      els.modeList.appendChild(card);
      return;
    }
    const m = MODES[cell], i = pos;
    const card = document.createElement('button');
    card.className = 'mode-card' + (m.id === game.mode.id ? ' selected' : '');
    const key = rankKey(m.id, game.playSeconds, settings.invisible, settings.difficulty);
    const best = scores[key] !== undefined ? `<span class="best">best ${scores[key]}</span>` : '';
    const time = m.timed ? timeLabel(m, settings.playMinutes * 60) : m.duration ? `${m.duration}초` : '자유';
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
      syncScoreChallenge();
      if (app.afterStart) {
        app.afterStart = false;
        toast(app.mouseMode ? `${m.name} 선택됨 · 가운데 원에 3초 머무르거나 시작을 누르세요` : `${m.name} 선택됨 · 퍽을 가운데 원 안에 놓고 3초 기다리세요`, 5000);
      } else toast(`${m.name} 선택됨`);
    });
    els.modeList.appendChild(card);
  });
  els.p1.value = tr(settings.p1); els.p2.value = tr(settings.p2);
}

// =============== 영역 (원근 사다리꼴) ===============
// 처음 틀(초기화): 화면 가운데 아래쪽의 사다리꼴 (뒤쪽 좁게, 앞쪽 넓게). 여기서 네 모서리를 끌어 실제 바닥에 맞춘다
function defaultQuad() { return [[0.25, 0.3], [0.75, 0.3], [0.85, 0.8], [0.15, 0.8]]; }

/** 영역 편집 시작: 저장된 틀이 있으면 그대로 (화면 끝에 붙어 있어도), 없으면 처음 틀 */
function toggleAreaEdit() {
  if (app.areaEditing) { endAreaEdit(); return; }
  if (game.running) game.stop('manual');
  closeAllPanels();
  if (!settings.manualQuad) settings.manualQuad = defaultQuad();
  settings.floorMode = 'manual';
  persist();
  app.areaEditing = true;
  $('#app').classList.add('area-editing');
  app.calib.active = false; app.idleHold = 0;
  applyFloorMode();
  $('#area-bar').classList.remove('hidden');
  els.btnFloorLock.classList.add('active');
}

function endAreaEdit(announce = true) {
  app.areaEditing = false;
  $('#app').classList.remove('area-editing');
  $('#area-bar').classList.add('hidden');
  els.handles.classList.add('hidden');
  els.btnFloorLock.classList.remove('active');
  persist();
  if (app.setup === 'area') { beginPuckSetup(); return; } // 시작 준비 중: 다음 단계 (퍽 등록)
  // 화면 방향이 바뀌어 연 영역 편집: 그때 모드 창이 열려 있었으면 다시 연다
  if (app.areaReturnMode) { app.areaReturnMode = false; if (!game.running) { renderModeList(); open(els.panelMode); } }
  if (announce) toast('영역 저장됨');
}

function applyFloorMode() {
  const manual = settings.floorMode === 'manual';
  if (manual && !settings.manualQuad) { settings.manualQuad = defaultQuad(); persist(); }
  // 핸들은 편집 중에만 표시 (플레이 중 터치 방해 방지)
  els.handles.classList.toggle('hidden', !(manual && app.areaEditing));
  positionHandles();
}

function positionHandles() {
  if (settings.floorMode !== 'manual' || !settings.manualQuad) return;
  $$('#floor-handles .handle').forEach((h) => {
    const [u, v] = settings.manualQuad[Number(h.dataset.i)];
    h.style.left = `clamp(24px, ${u * 100}%, calc(100% - 24px))`; h.style.top = `clamp(24px, ${v * 100}%, calc(100% - 24px))`;
  });
}

function bindFloorHandles() {
  $$('#floor-handles .handle').forEach((h) => {
    const i = Number(h.dataset.i);
    h.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      h.setPointerCapture(e.pointerId);
      app.cornerDrag = true;
      const move = (ev) => {
        const r = els.view.getBoundingClientRect();
        const u = clamp((ev.clientX - r.left) / r.width, 0, 1), v = clamp((ev.clientY - r.top) / r.height, 0, 1);
        settings.manualQuad[i] = [u, v];
        positionHandles();
      };
      const up = () => { app.cornerDrag = false; h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); persist(); };
      h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    });
  });
}

// =============== 보정 (가운데 원에 3초: 자동 물체 지정) ===============
/** 보정 패널의 '원 안에 3초(자동)' 버튼: 지정 대상을 정해 명시적으로 학습 (스틱 포함) */
function beginAutoCalibration(target) {
  if (game.running) game.stop('manual');
  app.calibFromMode = modeIsOpen();
  closeAllPanels();
  autoCal.reset();
  app.calib = { active: true, manual: true, target, hold: 0, status: 'none', sample: null, circle: vision.calibCircle(1, target) };
  app.calibTarget = null;
  $('#btn-replace-puck').classList.add('hidden');
  els.tapHint.classList.add('hidden');
  app.idleHold = 0;
}

function cancelAutoCalibration(msg) {
  app.calib = { active: false, manual: false, target: 'puck', hold: 0, status: 'none', sample: null, circle: null };
  autoCal.reset();
  if (app.setup === 'puck') {
    if (settings.puckModel.area > 0) { beginTestSetup(); return; } // 등록된 퍽을 그대로 쓰고 3/3 움직여 보기
    finishSetup(); toast('퍽 등록을 건너뛰었어요 · 게임을 고른 뒤 원에 퍽을 3초', 4000); return;
  }
  backToModeAfterCalib();
  if (msg) toast(msg);
}

const modeIsOpen = () => !els.panelMode.classList.contains('hidden');
/** 모드 창에서 시작한 보정(원 안에 3초·터치로 지정)이 끝나면 — 등록했든 취소했든 — 모드 창을 다시 연다.
 *  (예전: 모드 창을 닫고 보정한 뒤 모드 창을 또 열어야 했다). 안내(토스트)는 이 뒤에 띄운다: 창을 열면 떠 있던 안내가 치워진다 */
function backToModeAfterCalib() {
  if (!app.calibFromMode) return;
  app.calibFromMode = false;
  if (app.setup || game.running || app.calibTarget || app.calib.manual) return;
  renderModeList(); open(els.panelMode);
}

function updateAutoCalibration(dt) {
  const c = app.calib;
  c.circle = vision.calibCircle(1, c.target);
  const sample = vision.autoCalibSample(c.target);
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
  // 게임 중이면 멈춘다: 지정하는 동안은 게임 화면(흰 배경) 대신 카메라 영상을 보여 주고, 날아오는 퍽·시간도 멈춰야 한다
  if (game.running) game.stop('manual');
  app.calibFromMode = modeIsOpen();
  app.calibTarget = target;
  close(els.panelCalib);
  if (app.calibFromMode) close(els.panelMode); // 화면(영상)을 터치해야 하므로 모드 창도 잠시 치운다 (끝나면 다시 엶)
  $('#btn-replace-puck').classList.add('hidden');
  els.tapHint.textContent = target === 'puck' ? '화면에서 퍽을 터치하세요' : '화면에서 스틱 블레이드(테이프)를 터치하세요';
  els.tapHint.classList.remove('hidden');
  els.view.classList.add('calibrating');
}

/** 터치로 지정 끝 (지정했거나 Esc 로 취소) */
function endPick() {
  app.calibTarget = null;
  els.tapHint.classList.add('hidden');
  els.view.classList.remove('calibrating');
  backToModeAfterCalib(); // 결과 안내(토스트)는 부르는 쪽이 이 뒤에 띄운다
}

/** 퍽이 처리 해상도에서 이 면적(px)보다 작게 보이면 인식 해상도를 올린다 (멀리 둔 노트북 웹캠·작은 공) */
const SMALL_PUCK_AREA = 20;
/** 아주 작게 보이는 퍽: 인식 해상도를 400 으로 올려 더 많은 픽셀로 따라가게. 반환: 좌표 배율 (그대로면 1) */
function boostForSmallPuck(area) {
  if (app.mouseMode || !(area > 0) || area >= SMALL_PUCK_AREA || settings.procWidth >= 400) return 1;
  const before = vision.PW;
  settings.procWidth = 400; vision.setProcWidth(400); layout();
  $('#set-procWidth').value = '400';
  return vision.PW / before;
}

function onViewTap(e) {
  if (app.calib.manual) { if (!app.setup && !e.target.classList.contains('handle')) cancelAutoCalibration('자동 지정 취소'); return; }
  if (!app.calibTarget || !app.lastVision) return;
  if (e.target.classList.contains('handle')) return;
  const r = els.view.getBoundingClientRect();
  const nx = (e.clientX - r.left) / r.width, ny = (e.clientY - r.top) / r.height;
  const [px, py] = vision.toProc(nx, ny);
  const tol = app.calibTarget === 'puck' ? settings.puckTol : settings.stickTol;
  // 누른 자리 근처에서 바닥과 색이 다른 물체로 붙어(손가락이 조금 빗나가도) 그 물체 한가운데 색을 잰다
  const sample = vision.sampleObject(px, py, tol);
  const target = app.calibTarget;
  endPick();
  if (!sample) return;
  if (!sample.snapped && vision.isFloorLike(sample, settings)) {
    toast('바닥(흰색)과 구분되지 않는 색입니다. 다른 색의 물체/테이프를 사용하세요.');
    return;
  }
  const model = { r: sample.r, g: sample.g, b: sample.b, area: Math.max(4, Math.min(3000, sample.area)) };
  let sx = sample.snapped ? sample.cx : px, sy = sample.snapped ? sample.cy : py, boosted = false;
  if (target === 'puck') {
    const k = boostForSmallPuck(model.area);
    if (k !== 1) { boosted = true; model.area = Math.round(model.area * k * k); sx *= k; sy *= k; }
    settings.puckModel = model; vision.seedPuck(sx, sy, model.area); tracker.reset(); stickBridge.reset();
  } else settings.stickModel = model;
  // 주변 바닥과의 색 차이에 맞춘 허용 오차 (원 안에 3초 자동 지정과 같은 기준)
  if (sample.snapped && sample.tol) {
    const key = target === 'puck' ? 'puckTol' : 'stickTol';
    settings[key] = sample.tol; $(`#set-${key}`).value = sample.tol; $(`#out-${key}`).value = sample.tol;
  }
  persist(); refreshCalibUI();
  toast(boosted ? '퍽 색 지정 완료 · 퍽이 작게 보여 인식 해상도를 400으로 올렸어요' : `${target === 'puck' ? '퍽' : '스틱'} 색 지정 완료`, boosted ? 3500 : undefined);
}

function refreshCalibUI() {
  const pm = settings.puckModel;
  els.swatchPuck.style.background = `rgb(${pm.r},${pm.g},${pm.b})`;
  els.swatchPuck.classList.remove('none');
  els.calibPuckDesc.textContent = pm.area > 0 ? '등록됨' : '기본: 검정';
  const sm = settings.stickModel;
  if (sm) {
    els.swatchStick.style.background = `rgb(${sm.r},${sm.g},${sm.b})`;
    els.swatchStick.classList.remove('none');
    els.calibStickDesc.textContent = '등록됨';
  } else {
    els.swatchStick.style.background = '';
    els.swatchStick.classList.add('none');
    els.calibStickDesc.textContent = '미지정 (퍽만 추적)';
  }
}

// =============== 설정 UI ===============
function applySettingsToUI() {
  $('#set-mirror').checked = settings.mirror;
  $('#set-sound').checked = settings.sound;
  $('#set-autoStart').checked = settings.autoStart;
  $('#set-reverseDepth').checked = settings.reverseDepth;
  applyDepthDirection();
  els.invisibleToggle.checked = settings.invisible;
  game.invisible = settings.invisible;
  els.debug.classList.toggle('hidden', !settings.debug);
  for (const key of SLIDER_KEYS) {
    $('#set-' + key).value = settings[key]; $('#out-' + key).value = settings[key];
  }
  applyWash();
  game.arcade.floorWidthM = settings.floorWidthM;
  $('#set-procWidth').value = String(settings.procWidth);
  $('#set-camRate').value = settings.camRate;
  $('#set-controller').value = settings.controller;
  els.p1.value = settings.p1; els.p2.value = settings.p2;
  refreshCalibUI();
  applyMirror();
  applyFloorMode();
}

/**
 * 설정 창의 투명도 미리보기: 실시간 카메라 영상 위에 게임과 같은 순서로 그린다 —
 * 영상 속 진짜 퍽 가리기(내 퍽 투명도만큼) → 종이 배경(배경 투명도) → 빨간 목표 → 내 퍽(내 퍽 투명도).
 * 슬라이더를 움직이면 applyWash() 가 값을 바꾸고, 다음 프레임에 바로 보인다 (설정 창이 열려 있을 때만 그림)
 */
function drawTransparencyPreview(result) {
  const cv = els.tpPreview;
  if (!cv || els.panelSettings.classList.contains('hidden')) return;
  const v = els.video, dpr = Math.min(2, window.devicePixelRatio || 1);
  if (v.videoWidth && v.videoHeight) {
    const ar = `${v.videoWidth} / ${v.videoHeight}`;
    if (cv.dataset.ar !== ar) { cv.dataset.ar = ar; cv.style.aspectRatio = ar; }
  }
  const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
  if (!w || !h) return;
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const ctx = cv.getContext('2d');
  const live = !app.mouseMode && v.readyState >= 2;
  if (live) { ctx.save(); if (settings.mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); } ctx.drawImage(v, 0, 0, w, h); ctx.restore(); }
  else { ctx.fillStyle = '#8b9099'; ctx.fillRect(0, 0, w, h); }
  const pa = renderer.puckAlpha;
  // 영상 속 진짜 퍽을 둘레 바닥색으로 덮기 (게임 중 퍽 투명도와 같은 방식)
  const p = result?.puck;
  if (live && p && pa < 0.999 && settings.controller === 'puck') {
    const r = Math.max(3, Math.sqrt((p.area || settings.puckModel.area || 40) / Math.PI));
    const ring = vision.ringColor(p.x, p.y, r * 2.2, r * 3.4) || { r: 236, g: 233, b: 226 };
    const col = `${Math.round(ring.r)},${Math.round(ring.g)},${Math.round(ring.b)}`;
    const cx = p.x * (w / vision.PW), cy = p.y * (h / vision.PH), rr = r * (w / vision.PW) * 2.4;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
    g.addColorStop(0, `rgba(${col},${1 - pa})`); g.addColorStop(0.62, `rgba(${col},${1 - pa})`); g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = rgba(C.paper, renderer.wash); ctx.fillRect(0, 0, w, h); // 평면 판의 종이 배경
  ctx.beginPath(); ctx.arc(w * 0.72, h * 0.4, w * 0.045, 0, Math.PI * 2); ctx.fillStyle = C.red; ctx.fill(); // 목표 하나
  // 내 퍽: 지금 보이는 자리 — 평면 판 게임은 판에서와 같은 자리, 바닥 위 게임은 영역 안 자리
  // (와이드는 영상 속 진짜 퍽 자리, 퀵 핸즈·반응 타겟은 위아래 반대). 못 찾으면 왼쪽 아래
  const obj = settings.controller === 'stick' ? result?.stick : p, m = result?.floor?.mapping;
  let uv = null, pos = { x: 0.3, y: 0.62 };
  if (obj && m) { const [u, v] = m.toUV(obj.x, obj.y); if (u > -0.05 && u < 1.05 && v > -0.05 && v < 1.05) uv = { x: u, y: v }; }
  else if (tracker.pos && tracker.state !== 'lost') uv = tracker.pos;
  if (uv && m && FLOOR_MODES.has(game.mode.id)) {
    const [px, py] = m.toPx(uv.x, FLOOR_FLIP_MODES.has(game.mode.id) && game.plane.flip ? 1 - uv.y : uv.y);
    pos = { x: px / vision.PW, y: py / vision.PH };
  } else if (uv) pos = { x: uv.x, y: game.plane.flip ? 1 - uv.y : uv.y };
  ctx.globalAlpha = pa;
  ctx.beginPath(); ctx.arc(pos.x * w, pos.y * h, Math.max(4 * dpr, PUCK_R * w), 0, Math.PI * 2); ctx.fillStyle = C.ink; ctx.fill();
  ctx.globalAlpha = 1;
}

/** 설정 창이 열려 모든 것이 멈춘 동안에도 투명도·인식 미리보기는 실시간으로: 영상에서 퍽만 찾고, 게임·추적·대기 원은 그대로 멈춰 둔다 */
function previewWhilePaused(now) {
  if (els.panelSettings.classList.contains('hidden')) return;
  const video = els.video;
  if (!app.mouseMode && video.readyState >= 2 && video.currentTime !== app.lastVideoTime) {
    app.lastVideoTime = video.currentTime;
    app.lastVision = processFrame(video);
    app.fpsFresh = false; // 설정 창 미리보기(더 무거움) 동안의 속도로는 카메라를 바꾸지 않는다
  }
  drawTransparencyPreview(app.lastVision);
  drawMaskPreview(app.lastVision);
  if ($('.settings-adv')?.open) $('#proc-live').textContent = app.mouseMode ? '' : fpsChipTitle();
  if (app.tpPeek) drawPeek(now);
}

/**
 * 설정 창 '인식 세부 조정'의 인식 미리보기: 인식에 쓰는 영상(처리 해상도 그대로) 위에 퍽(빨강)·스틱(초록)으로 잡힌 픽셀을 칠하고,
 * 퍽으로 고른 덩어리에 동그라미. 허용 오차 슬라이더를 움직이면 칠해지는 곳이 바로 바뀐다.
 * 설정 창 안에서만 그리므로 게임 화면은 가리지 않는다
 */
let maskImg = null;
function drawMaskPreview(result) {
  const cv = $('#mask-preview'), adv = $('.settings-adv');
  if (!cv || !adv?.open || els.panelSettings.classList.contains('hidden')) return;
  const { PW, PH } = vision;
  if (cv.width !== PW || cv.height !== PH) { cv.width = PW; cv.height = PH; }
  const ctx = cv.getContext('2d');
  if (!maskImg || maskImg.width !== PW || maskImg.height !== PH) maskImg = new ImageData(PW, PH);
  if (app.mouseMode || !vision.paintMaskPreview(maskImg, !!settings.stickModel)) { ctx.fillStyle = '#8b9099'; ctx.fillRect(0, 0, PW, PH); return; }
  ctx.putImageData(maskImg, 0, 0);
  const q = result?.floor?.quad;
  if (q) { ctx.beginPath(); q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(22,22,22,0.7)'; ctx.stroke(); }
  const p = result?.puck;
  if (p) { ctx.beginPath(); ctx.arc(p.x, p.y, Math.sqrt(p.area / Math.PI) + 3, 0, Math.PI * 2); ctx.lineWidth = 1.5; ctx.strokeStyle = '#161616'; ctx.stroke(); }
}

/**
 * 투명도 슬라이더를 끄는 동안 (휴대폰에서 손가락으로 드래그할 때): 설정 창은 비우고 끄는 슬라이더 한 줄만 남긴 채,
 * 뒤의 실제 게임 화면을 바뀐 투명도로 그린다. 게임 시계·추적은 멈춘 그대로 두고, 내 퍽 자리는 영상에서 바로 찾는다
 */
function setTpPeek(on, label = null) {
  if (!!app.tpPeek === on) return;
  app.tpPeek = on;
  els.panelSettings.classList.toggle('tp-peek', on);
  $$('#panel-settings .tp-sliders label').forEach((l) => l.classList.toggle('peeking', on && l === label));
  game.arcade.peek = on;
  if (on) requestAnimationFrame(() => { if (app.tpPeek) drawPeek(performance.now() - clock.offset); }); // 카메라 전에도 한 번
}

function drawPeek(now) {
  const result = app.lastVision;
  if (!result) return;
  const m = result.floor?.mapping, obj = settings.controller === 'stick' ? result.stick : result.puck;
  let pos = null;
  if (m && obj) { const [u, v] = m.toUV(obj.x, obj.y); if (u > -0.05 && u < 1.05 && v > -0.05 && v < 1.05) pos = { x: clamp(u, 0, 1), y: clamp(v, 0, 1) }; }
  // 검출이 잠깐 끊겨도(스틱에 가림·흔들림) 0.6초 동안은 마지막 자리 (게임 중 퍽 가리기와 같은 기준)
  if (pos) app.peekPos = { pos, at: now };
  const held = !pos && app.peekPos && now - app.peekPos.at < 600 ? app.peekPos.pos : null;
  const puck = { pos: pos || held || tracker.pos, state: pos ? 'tracked' : 'predicted', trail: [], speed: 0, touches: 0 };
  if (game.mode.id === 'arcade' && puck.pos) game.arcade.avatar = game.arcade.toZone(puck.pos.x, puck.pos.y);
  updatePuckCover(result, now, true);
  renderer.draw({ vision: result, puck, game, procSize: { PW: vision.PW, PH: vision.PH }, now, cover: app.cover, peek: true });
}

/**
 * 게임마다 배경·퍽 투명도 규칙 (bg·puck: 실제로 쓰는 투명도 %, bgLock·puckLock: 이 게임에서 설정을 못 바꾸는지)
 *  - 아케이드·퍽 피하기·8자 드리블·자유 연습: 배경 0 고정 (흰 화면), 퍽만 조절
 *  - 와이드 드리블: 배경 0~100 그대로 (슬라이더대로 카메라가 비침 — 끄는 동안 실제 화면에서 바로 보임).
 *    배경 0 이면 퍽 0~100, 배경을 1 이상 주면 퍽 투명도 0 고정 (영상 속 진짜 퍽이 보이므로)
 *  - 퀵 핸즈: 배경만 조절, 퍽 투명도 0 고정
 *  - 반응 타겟 (퀵 핸즈처럼 영역 안에서 배경을 보며): 둘 다 조절
 */
function visualRules(modeId = game.mode.id) {
  const bgSet = settings.bgTransparency, puckSet = settings.puckTransparency;
  switch (modeId) {
    case 'arcade': case 'obstacle': case 'figure8': case 'free':
      return { bg: 0, puck: puckSet, bgLock: true, puckLock: false };
    case 'wide':
      return bgSet > 0 ? { bg: bgSet, puck: 0, bgLock: false, puckLock: true } : { bg: 0, puck: puckSet, bgLock: false, puckLock: false };
    case 'quick':
      return { bg: bgSet, puck: 0, bgLock: false, puckLock: true };
    default:
      return { bg: bgSet, puck: puckSet, bgLock: false, puckLock: false };
  }
}

/** 배경·퍽 투명도 -> 종이 배경 불투명도와 내 퍽 표시 농도 (게임마다 규칙은 visualRules). 매 프레임 불러 모드가 바뀌어도 바로 맞춘다 */
function applyWash() {
  const v = visualRules();
  const alpha = clamp(1 - v.bg / 100, 0, 1);
  game.arcade.wash = alpha;
  renderer.wash = alpha;
  // 내 퍽 표시 농도: 플레이 중 화면의 내 퍽을 흐리게/안 보이게 (감각으로 플레이하는 헤드업 훈련). 투명 모드는 항상 0
  const pa = settings.invisible ? 0 : clamp(1 - v.puck / 100, 0, 1);
  game.arcade.puckAlpha = pa;
  renderer.puckAlpha = pa;
}

/** 설정 창: 지금 게임에서 못 바꾸는 투명도 슬라이더는 잠그고 이유를 적는다 */
function refreshVisualLocks() {
  const v = visualRules(), name = game.mode.name;
  const bgIn = $('#set-bgTransparency'), puckIn = $('#set-puckTransparency');
  bgIn.disabled = v.bgLock; puckIn.disabled = v.puckLock;
  bgIn.closest('label').classList.toggle('locked', v.bgLock);
  puckIn.closest('label').classList.toggle('locked', v.puckLock);
  const note = $('#visual-note');
  const msg = v.bgLock ? `${name}: 배경 투명도 0 고정 (흰 화면) · 퍽 투명도만 조절`
    : game.mode.id === 'quick' ? `${name}: 배경 투명도만 조절 · 퍽 투명도 0 고정`
      : game.mode.id === 'wide' ? (v.puckLock ? `${name}: 배경 투명도를 주면 퍽 투명도 0 고정` : `${name}: 배경 투명도 0 일 때만 퍽 투명도 조절`)
        : '';
  note.textContent = msg; note.classList.toggle('hidden', !msg);
}

/**
 * 게임마다 앞뒤(위아래) 방향: true = 판정 평면의 위아래를 카메라 영상과 반대로 (퍽을 카메라 쪽으로 밀면 화면 위로).
 *  - 아케이드 (아래쪽 플레이 존): 카메라 쪽으로 밀면 위로 (퍽들이 내려오는 쪽)
 *  - 퍽 피하기·8자 드리블 (흰 화면): 카메라 쪽으로 밀면 위로 (판 위쪽 = 카메라쪽, 아래쪽 = 몸쪽)
 *  - 자유 연습 (흰 화면): 퍽 피하기와 같음 — 카메라 쪽으로 밀면 위로
 *  - 퀵 핸즈·반응 타겟 (영역 안, 배경이 보임): 화면(영상)은 그대로 두고 내 퍽만 위아래 반대로 — 카메라 쪽으로 밀면 위로
 *  - 와이드 드리블: 영상 속 진짜 퍽 자리 그대로 (렌더러가 평면의 뒤집기를 되돌려 그리므로 이 값과 상관없음)
 * 설정 '위아래 반대로'(reverseDepth)를 켜면 와이드 드리블을 뺀 모든 게임이 반대로 바뀐다
 */
function depthFlip(modeId = game.mode.id) {
  // init() 중에도 불리므로 모듈 상수(const) 대신 여기서 바로 정한다 (선언 전에 쓰면 앱이 시작하지 않음)
  const base = modeId !== 'wide'; // 와이드 드리블을 뺀 모든 게임: 카메라 쪽으로 밀면 위로
  return settings.reverseDepth ? !base : base;
}

/** 지금 모드의 앞뒤 방향을 게임에 적용 (모드를 바꿀 때·설정을 바꿀 때·화면 크기가 바뀔 때) */
function applyDepthDirection() {
  game.arcade.flipY = depthFlip('arcade');
  game.plane.flip = depthFlip();
}

function persist() { saveSettings(settings); }

// =============== 유틸 ===============
function open(panel) { panel.classList.remove('hidden'); els.toast.classList.add('hidden'); } // 창을 열면 떠 있던 안내(토스트)는 치운다
function close(panel) { panel.classList.add('hidden'); if (panel.id === 'panel-login') restoreAuthCard(); }
function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }
function showSplashError(msg) { els.splashError.textContent = msg; els.splashError.classList.remove('hidden'); }

let toastTimer = 0;
function toast(msg, ms = 2600) {
  els.toast.textContent = msg;
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), ms);
}
