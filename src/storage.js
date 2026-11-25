// 설정/기록 저장 (localStorage)
const SETTINGS_KEY = 'puck-trainer.settings.v1';
const SCORES_KEY = 'puck-trainer.scores.v1';

export const DEFAULT_SETTINGS = {
  mirror: true,
  debug: false,
  sound: true,
  whiteV: 150,      // 바닥(흰색) 최소 밝기 (0-255)
  whiteC: 55,       // 바닥 채도 허용 (max-min 채널 차)
  puckTol: 95,      // 퍽 색 허용 오차 (RGB 거리)
  stickTol: 70,     // 스틱 색 허용 오차
  puckModel: { r: 0, g: 0, b: 0, area: 0 },   // area 0 = 바닥 크기 기준 자동
  stickModel: null,                           // null = 스틱 추적 안 함
  floorMode: 'manual',                        // 게임 영역 = 네 모서리로 맞춘 바닥 (예전 'auto'·'full' 은 불러올 때 'manual' 로 옮김)
  procWidth: 240,                             // 인식 해상도(처리 폭 px): 240 | 320 | 400. 게임 영역이 화면보다 작으면 영역만 이 픽셀 수만큼 더 촘촘히 읽는다
  camRate: 'auto',                            // 카메라 프레임: 'auto' (60으로 찍다가 기기·Wi-Fi 상태에 맞춰 30으로) | '60' 항상 | '30' 항상 (어두운 곳)
  controller: 'puck',                         // 게임 조작 대상: 'puck' | 'stick'(퍽 없이 스틱 블레이드로)
  manualQuad: null,                           // [[u,v]x4] 정규화 좌표 (0-1)
  difficulty: 'normal',
  playMinutes: 1,                             // 시간제 모드 제한 시간: 1 | 3 | 5 (분)
  flipDepth: true,                            // 앞뒤 방향(와이드 드리블을 뺀 모든 게임 공통): true = 카메라 쪽으로 밀면 화면 위로
  puckTransparency: 0,                        // 플레이 중 내 퍽 투명도(%): 0 = 또렷이, 100 = 안 보임 (1 단위). 화면의 퍽 표시와 카메라 속 진짜 퍽 모두
  figure8Dir: 'L-up',                         // 8자 드리블 방향: L|R(어느 콘 먼저) - up|down(콘을 위·아래 어느 쪽부터)
  invisible: false,                           // 투명 모드: 플레이 중 내 퍽을 아예 숨김 (손의 감각으로만). 랭킹·자랑은 일반과 따로
  courseCycles: 10,                           // 자유 연습 목표 사이클 수 (10~100, 10 단위)
  course: [],                                 // 자유 연습 코스: [{n: 1~10, x: 0~1, y: 0~1}] (영역 = 평면 경기장 비율, 화면에서 왼쪽 위가 0,0)
  courseRecord: null,                         // 현재 코스로 세운 내 최고 기록: {sig, avg, best, at} (커뮤니티 공유용)
  bgTransparency: 12,                         // 게임 배경 투명도(%): 0 = 종이색으로 완전히 덮음, 100 = 카메라 영상 그대로
  floorWidthM: 1.5,                           // 결과 리포트의 이동 거리(m) 환산용 게임 영역 실제 폭
  cameraId: '',
  facing: 'user',                             // 'user' 전면(기본: 화면을 보며 플레이) | 'environment' 후면
  autoStart: true,                            // 핸즈프리 시작: 퍽을 가운데 원에 3초 두면 시작/재시작
  p1: '플레이어 1',
  p2: '플레이어 2',
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    return sanitizeSettings({ ...structuredClone(DEFAULT_SETTINGS), ...JSON.parse(raw) });
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

const num = (v, min, max, def) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : def);
const isColorModel = (m) => m && typeof m === 'object' && [m.r, m.g, m.b].every((c) => Number.isFinite(c) && c >= 0 && c <= 255) && Number.isFinite(m.area) && m.area >= 0;

/** 손상되거나 범위를 벗어난 저장값을 기본값으로 되돌림 (오래된 버전/수동 편집 대비) */
export function sanitizeSettings(s) {
  const d = DEFAULT_SETTINGS;
  s.mirror = typeof s.mirror === 'boolean' ? s.mirror : d.mirror;
  s.debug = typeof s.debug === 'boolean' ? s.debug : d.debug;
  s.sound = typeof s.sound === 'boolean' ? s.sound : d.sound;
  s.whiteV = num(s.whiteV, 80, 240, d.whiteV);
  s.whiteC = num(s.whiteC, 10, 120, d.whiteC);
  s.puckTol = num(s.puckTol, 20, 200, d.puckTol);
  s.stickTol = num(s.stickTol, 20, 200, d.stickTol);
  s.puckModel = isColorModel(s.puckModel) ? { r: s.puckModel.r, g: s.puckModel.g, b: s.puckModel.b, area: s.puckModel.area } : structuredClone(d.puckModel);
  s.stickModel = isColorModel(s.stickModel) ? { r: s.stickModel.r, g: s.stickModel.g, b: s.stickModel.b, area: s.stickModel.area } : null;
  s.procWidth = [240, 320, 400].includes(s.procWidth) ? s.procWidth : d.procWidth;
  // 예전(잠깐 있던) camFps 저장값: 30 을 고른 사람만 '30' 고정으로, 나머지는 자동 (기본값이 먼저 섞여 오므로 camFps 가 있으면 그것으로)
  if ('camFps' in s) { s.camRate = s.camFps === 30 ? '30' : 'auto'; delete s.camFps; }
  s.camRate = ['auto', '60', '30'].includes(s.camRate) ? s.camRate : d.camRate;
  s.controller = s.controller === 'stick' ? 'stick' : 'puck';
  const quadOk = Array.isArray(s.manualQuad) && s.manualQuad.length === 4 &&
    s.manualQuad.every((pt) => Array.isArray(pt) && pt.length === 2 && pt.every((c) => Number.isFinite(c) && c >= 0 && c <= 1));
  // 게임 영역은 네 모서리 하나뿐: 예전 '화면 전체'는 화면 전체 틀로, 예전 '흰 바닥 자동'은 저장된 틀(없으면 처음 틀)로
  if (s.floorMode === 'full') s.manualQuad = [[0.02, 0.02], [0.98, 0.02], [0.98, 0.98], [0.02, 0.98]];
  else if (!quadOk) s.manualQuad = null;
  s.floorMode = 'manual';
  s.difficulty = ['easy', 'normal', 'hard'].includes(s.difficulty) ? s.difficulty : d.difficulty;
  s.floorWidthM = num(s.floorWidthM, 0.3, 20, d.floorWidthM);
  s.playMinutes = [1, 3, 5].includes(s.playMinutes) ? s.playMinutes : d.playMinutes;
  s.figure8Dir = ['L-up', 'L-down', 'R-up', 'R-down'].includes(s.figure8Dir) ? s.figure8Dir : d.figure8Dir;
  s.flipDepth = typeof s.flipDepth === 'boolean' ? s.flipDepth : d.flipDepth;
  s.bgTransparency = num(s.bgTransparency, 0, 100, d.bgTransparency);
  s.invisible = s.invisible === true;
  // 퍽 투명도 (예전 '내 퍽 표시 %' 설정은 100 - 값 으로 옮긴다)
  const step10 = (v) => Number.isInteger(v) && v >= 0 && v <= 100 && v % 10 === 0;
  // 예전 키가 남아 있으면 예전 형식으로 저장된 설정 (새 형식은 저장할 때 예전 키를 지움)
  const pct = (v) => Number.isInteger(v) && v >= 0 && v <= 100;
  s.puckTransparency = step10(s.puckOpacity) ? 100 - s.puckOpacity : pct(s.puckTransparency) ? s.puckTransparency : d.puckTransparency;
  delete s.puckOpacity;
  s.courseCycles = Number.isInteger(s.courseCycles) && s.courseCycles >= 10 && s.courseCycles <= 100 && s.courseCycles % 10 === 0 ? s.courseCycles : d.courseCycles;
  s.course = Array.isArray(s.course)
    ? s.course.filter((p) => p && Number.isInteger(p.n) && p.n >= 1 && p.n <= 10 && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)
      .filter((p, i, arr) => arr.findIndex((q) => q.n === p.n) === i).map((p) => ({ n: p.n, x: p.x, y: p.y }))
    : [];
  const cr = s.courseRecord;
  s.courseRecord = cr && typeof cr === 'object' && typeof cr.sig === 'string' && Number.isFinite(cr.avg) && cr.avg > 0 && Number.isFinite(cr.best) && cr.best > 0
    ? { sig: cr.sig, avg: cr.avg, best: cr.best, at: Number(cr.at) || 0 } : null;
  s.cameraId = typeof s.cameraId === 'string' ? s.cameraId : '';
  s.facing = s.facing === 'environment' ? 'environment' : 'user';
  s.autoStart = typeof s.autoStart === 'boolean' ? s.autoStart : d.autoStart;
  s.p1 = typeof s.p1 === 'string' && s.p1.trim() ? s.p1.slice(0, 10) : d.p1;
  s.p2 = typeof s.p2 === 'string' && s.p2.trim() ? s.p2.slice(0, 10) : d.p2;
  return s;
}

export function saveSettings(settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* 사생활 보호 모드 등 */ }
}

export function loadScores() {
  try { return JSON.parse(localStorage.getItem(SCORES_KEY) || '{}'); } catch { return {}; }
}

export function saveBest(modeId, score) {
  const scores = loadScores();
  const prev = scores[modeId];
  if (prev === undefined || score > prev) {
    scores[modeId] = score;
    try { localStorage.setItem(SCORES_KEY, JSON.stringify(scores)); } catch { /* ignore */ }
    return true;
  }
  return false;
}

export function clearScores() {
  try { localStorage.removeItem(SCORES_KEY); } catch { /* ignore */ }
}
