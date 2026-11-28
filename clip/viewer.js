// 장면 보기 (운영자 도구): 운영자 화면에서 내려받은 인식 녹화 장면(JSON, src/vision-rec.js clipToJson)을 프레임마다 본다.
//  - 사진 = 그때 인식이 읽은 판 부분 (거울 모드면 이미 좌우를 바꾼 방향)
//  - 녹화된 인식: 퍽(확실 빨강 · 확실하지 않음 주황 · 블레이드로 이은 자리 보라), 스틱 블레이드(초록), 게임이 쓴 자리(고리)
//  - '지금 인식으로 다시 보기': 같은 사진을 지금의 인식(src/vision.js)으로 다시 돌려, 퍽(빨강)·스틱(초록)으로 잡힌 픽셀을 칠한다
//    (인식을 고친 뒤 같은 장면에서 정말 나아졌는지 확인)
import { Vision } from '../src/vision.js';
import { makeFloorMapping } from '../src/geometry.js';

const $ = (s) => document.querySelector(s);
const REASONS = { jump: '퍽이 튐', lost: '퍽을 놓침', hit: '충돌', unsure: '넘긴 충돌', report: '이상했어요' };
const S = { clip: null, imgs: [], i: 0, playing: false, t0: 0, f0: 0, vision: null, full: null, mask: null, mapping: null };
const cv = $('#cv'), ctx = cv.getContext('2d');

$('#file').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  $('#err').textContent = '';
  try { await load(JSON.parse(await f.text())); } catch (err) { $('#err').textContent = `장면 파일을 읽지 못했습니다: ${err.message || err}`; }
});
$('#seek').addEventListener('input', (e) => { stop(); show(Number(e.target.value)); });
$('#prev').addEventListener('click', () => { stop(); show(S.i - 1); });
$('#next').addEventListener('click', () => { stop(); show(S.i + 1); });
$('#play').addEventListener('click', () => (S.playing ? stop() : play()));
$('#rerun').addEventListener('change', () => show(S.i));
document.addEventListener('keydown', (e) => {
  if (!S.clip || e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  if (e.key === 'ArrowLeft') { stop(); show(S.i - 1); e.preventDefault(); }
  if (e.key === 'ArrowRight') { stop(); show(S.i + 1); e.preventDefault(); }
  if (e.key === ' ') { S.playing ? stop() : play(); e.preventDefault(); }
});

async function load(clip) {
  if (clip?.kind !== 'puck-trainer-clip' || !Array.isArray(clip.frames) || !clip.frames.length) throw new Error('장면 파일이 아닙니다');
  stop();
  S.clip = clip; S.i = 0;
  S.imgs = await Promise.all(clip.frames.map((f) => new Promise((res) => {
    if (!f.img) { res(null); return; }
    const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = f.img;
  })));
  const m = clip.meta || {}, st = m.settings || {}, PW = m.src?.PW || st.procWidth || 240, PH = m.src?.PH || Math.round(PW * 9 / 16);
  S.mapping = Array.isArray(st.manualQuad) ? makeFloorMapping(st.manualQuad.map(([u, v]) => [u * PW, v * PH])) : null;
  // 다시 보기용: 처리 해상도 2배 캔버스에 잘라 둔 판 사진을 제자리에 놓고 지금 인식으로 돌린다
  S.full = document.createElement('canvas'); S.full.width = PW * 2; S.full.height = PH * 2;
  S.vision = new Vision(PW); S.vision.mirror = false; S.vision.setSourceSize(S.full.width, S.full.height);
  S.mask = new ImageData(S.vision.PW, S.vision.PH);
  $('#seek').max = String(clip.frames.length - 1);
  $('#marks').innerHTML = (clip.marks || []).map((k) => `<button type="button" data-t="${Number(k.t)}">${esc(REASONS[k.reason] || k.reason)} · ${(Number(k.t) / 1000).toFixed(1)}s</button>`).join('');
  $('#marks').onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) { stop(); show(frameAt(Number(b.dataset.t))); } };
  $('#main').hidden = false;
  show(0);
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function frameAt(t) { const f = S.clip.frames; let k = 0; while (k + 1 < f.length && f[k + 1].t <= t) k++; return k; }

function play() {
  if (!S.clip) return;
  if (S.i >= S.clip.frames.length - 1) S.i = 0;
  S.playing = true; $('#play').textContent = '멈춤';
  S.t0 = performance.now(); S.f0 = S.clip.frames[S.i].t;
  const step = () => {
    if (!S.playing) return;
    const k = frameAt(S.f0 + (performance.now() - S.t0));
    if (k !== S.i) show(k);
    if (k >= S.clip.frames.length - 1) { stop(); return; }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function stop() { S.playing = false; $('#play').textContent = '재생'; }

function show(i) {
  if (!S.clip) return;
  i = Math.max(0, Math.min(S.clip.frames.length - 1, i));
  S.i = i;
  const f = S.clip.frames[i], im = S.imgs[i], c = f.c;
  $('#seek').value = String(i);
  $('#pos').textContent = `${i + 1} / ${S.clip.frames.length} · ${(f.t / 1000).toFixed(2)}s`;
  const W = 720, H = im ? Math.round((W * im.height) / im.width) : 400;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  ctx.fillStyle = '#222'; ctx.fillRect(0, 0, W, H);
  if (im) ctx.drawImage(im, 0, 0, W, H);
  if (!c) { info(f, null); return; }
  const kx = W / (c[2] - c[0]), ky = H / (c[3] - c[1]);
  const X = (x) => (x - c[0]) * kx, Y = (y) => (y - c[1]) * ky;
  let now = null;
  if ($('#rerun').checked && im) now = rerun(im, c, W, H, X, Y, kx);
  const r = f.r || {};
  // 녹화된 인식: 퍽 (추적기 상태로 색), 스틱 블레이드, 게임이 쓴 자리
  if (r.s) { ctx.save(); ctx.translate(X(r.s[0]), Y(r.s[1])); ctx.rotate(Math.PI / 4); ctx.strokeStyle = '#16a34a'; ctx.lineWidth = 3; ctx.strokeRect(-8, -8, 16, 16); ctx.restore(); }
  const k = r.k || [];
  const col = k[4] ? '#7c3aed' : k[3] ? '#c8102e' : '#f59e0b';
  if (r.p) { ctx.beginPath(); ctx.arc(X(r.p[0]), Y(r.p[1]), Math.max(4, Math.sqrt(r.p[2] / Math.PI) * kx), 0, Math.PI * 2); ctx.lineWidth = 3; ctx.strokeStyle = col; ctx.setLineDash(r.p[3] ? [6, 4] : []); ctx.stroke(); ctx.setLineDash([]); }
  if (S.mapping && k[0] != null && k[1] != null) {
    const [px, py] = S.mapping.toPx(k[0], k[1]);
    ctx.beginPath(); ctx.arc(X(px), Y(py), 14, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(X(px) - 20, Y(py)); ctx.lineTo(X(px) + 20, Y(py)); ctx.moveTo(X(px), Y(py) - 20); ctx.lineTo(X(px), Y(py) + 20); ctx.stroke();
  }
  info(f, now);
}

/** 같은 사진을 지금 인식으로 다시 돌려 퍽·스틱으로 잡힌 픽셀을 칠한다. 반환: 지금 인식이 고른 퍽 */
function rerun(im, c, W, H, X, Y, kx) {
  const st = S.clip.meta?.settings || {}, fx = S.full.getContext('2d'), s = S.full.width / S.vision.PW;
  fx.fillStyle = '#808080'; fx.fillRect(0, 0, S.full.width, S.full.height);
  fx.drawImage(im, c[0] * s, c[1] * s, (c[2] - c[0]) * s, (c[3] - c[1]) * s);
  const res = S.vision.process(S.full, { ...st, floorMode: st.manualQuad ? 'manual' : st.floorMode || 'full', debug: false });
  if (S.vision.paintMaskPreview(S.mask, !!st.stickModel)) {
    const tmp = document.createElement('canvas'); tmp.width = S.mask.width; tmp.height = S.mask.height;
    tmp.getContext('2d').putImageData(S.mask, 0, 0);
    ctx.save(); ctx.globalAlpha = 0.6; ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, c[0], c[1], c[2] - c[0], c[3] - c[1], 0, 0, W, H);
    ctx.restore();
  }
  if (res.puck) { ctx.beginPath(); ctx.arc(X(res.puck.x), Y(res.puck.y), Math.max(4, Math.sqrt(res.puck.area / Math.PI) * kx) + 5, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff'; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]); }
  return res;
}

function info(f, now) {
  const r = f.r || {}, k = r.k || [], g = r.g || [], m = S.clip.meta || {};
  const st = { t: '추적', p: '예측', l: '놓침' }[k[2]] || '-';
  const rows = [
    ['장면', `${(S.clip.reasons || []).map((x) => REASONS[x] || x).join(', ')} · ${m.mode || ''} (${m.rankKey || ''})`],
    ['인식이 고른 퍽', r.p ? `(${r.p[0]}, ${r.p[1]}) 면적 ${r.p[2]}${r.p[3] ? ' · 애매한 조각' : ''}` : '없음'],
    ['스틱 블레이드', r.s ? `(${r.s[0]}, ${r.s[1]})` : '없음'],
    ['추적기에 넣은 값', r.m ? `(${r.m[0]}, ${r.m[1]})${r.m[2] ? ' · 블레이드로 이음' : ''}${r.m[3] ? ' · 애매함' : ''}` : '없음'],
    ['추적기', `${st}${k[3] ? ' · 확실' : ''}${k[4] ? ' · 블레이드로 이은 자리' : ''}`],
    ['게임', g.length ? `원점수 ${g[0]} · 감점 ${g[1]} · 넘긴 충돌 ${g[2]}` : '-'],
  ];
  if (now) rows.push(['지금 인식', now.puck ? `퍽 (${now.puck.x.toFixed(1)}, ${now.puck.y.toFixed(1)}) 면적 ${now.puck.area.toFixed(1)}${now.puck.doubtful ? ' · 애매한 조각' : ''} · 지운 가는 줄 ${S.vision.thinRemoved}px` : '퍽 없음']);
  $('#info').innerHTML = rows.map(([a, b]) => `<div><b>${esc(a)}</b> ${esc(b)}</div>`).join('');
}
