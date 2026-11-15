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
  floorMode: 'auto',                          // 'auto'(흰 바닥) | 'manual'(모서리) | 'full'(카메라 화면 전체)
  procWidth: 240,                             // 인식 해상도(처리 폭 px): 240 | 320 | 400
  controller: 'puck',                         // 게임 조작 대상: 'puck' | 'stick'(퍽 없이 스틱 블레이드로)
  manualQuad: null,                           // [[u,v]x4] 정규화 좌표 (0-1)
  difficulty: 'normal',
  playMinutes: 1,                             // 시간제 모드 제한 시간: 1 | 3 | 5 (분)
  flipDepth: true,                            // 아케이드 앞뒤 방향: true = 카메라 쪽으로 밀면 화면 위로
  puckOpacity: 100,                           // 플레이 중 내 퍽 표시 농도(%): 100 = 또렷이, 0 = 안 보임 (10 단위, 헤드업 훈련)
  courseCycles: 10,                           // 자유 연습 목표 사이클 수 (10~100, 10 단위)
  course: [],                                 // 자유 연습 코스: [{n: 1~10, x: 0~1, y: 0~1}] (평면 경기장 비율)
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
  s.floorMode = ['auto', 'manual', 'full'].includes(s.floorMode) ? s.floorMode : 'auto';
  s.procWidth = [240, 320, 400].includes(s.procWidth) ? s.procWidth : d.procWidth;
  s.controller = s.controller === 'stick' ? 'stick' : 'puck';
  const quadOk = Array.isArray(s.manualQuad) && s.manualQuad.length === 4 &&
    s.manualQuad.every((pt) => Array.isArray(pt) && pt.length === 2 && pt.every((c) => Number.isFinite(c) && c >= 0 && c <= 1));
  if (!quadOk) { s.manualQuad = null; if (s.floorMode === 'manual') s.floorMode = 'auto'; }
  s.difficulty = ['easy', 'normal', 'hard'].includes(s.difficulty) ? s.difficulty : d.difficulty;
  s.floorWidthM = num(s.floorWidthM, 0.3, 20, d.floorWidthM);
  s.playMinutes = [1, 3, 5].includes(s.playMinutes) ? s.playMinutes : d.playMinutes;
  s.flipDepth = typeof s.flipDepth === 'boolean' ? s.flipDepth : d.flipDepth;
  s.bgTransparency = num(s.bgTransparency, 0, 100, d.bgTransparency);
  s.puckOpacity = Number.isInteger(s.puckOpacity) && s.puckOpacity >= 0 && s.puckOpacity <= 100 && s.puckOpacity % 10 === 0 ? s.puckOpacity : d.puckOpacity;
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
