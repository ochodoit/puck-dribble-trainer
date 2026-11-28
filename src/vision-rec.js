// 운영자용 인식 녹화 (데이터 쌓기 2단계): 운영자 화면에서 켜면, 카메라로 하는 게임 중 '판(영역) 부분만' 낮은 해상도로 잘라
// 최근 10초를 이 기기 메모리에 계속 담아 두고(서버로 보내지 않음), 이상한 순간이 생기면 그 앞 10초 + 뒤 2초를 '장면' 하나로 남긴다.
//   이상한 순간: 퍽이 튐(다른 물체로 옮겨 감), 퍽을 놓침, 충돌(감점), 확실하지 않아 넘긴 충돌, 결과 화면의 '인식이 이상했어요'
// 장면은 운영자 화면에서 파일(JSON: 프레임 사진 + 프레임마다 인식 결과)로 내려받아 test/clip.html 에서 프레임마다 보고,
// 지금 인식으로 다시 돌려 볼 수 있다 (같은 영상 -> 고친 인식이 실제로 나아졌는지).

export const REC_PRE_MS = 10000;  // 이상한 순간 앞으로 남기는 시간
export const REC_POST_MS = 2000;  // 뒤로 더 담는 시간
export const REC_MAX_CLIPS = 6;   // 기기 메모리에 두는 장면 수 (오래된 것부터 버림)
export const REC_MAX_W = 360;     // 잘라 담는 판 사진의 최대 폭 (px)
export const REC_KEY = 'puck-trainer.rec.v1';
/** 장면 이유 -> 화면 글 */
export const REC_REASONS = { jump: '퍽이 튐', lost: '퍽을 놓침', hit: '충돌', unsure: '넘긴 충돌', report: '이상했어요' };

export class VisionRecorder {
  constructor() {
    this.enabled = false;
    this.clips = [];
    this.onClip = null; // 장면이 하나 생길 때 (운영자 화면 목록 새로 고침)
    this.reset();
  }

  /** 새 게임: 담아 둔 프레임을 비운다 (장면 목록은 그대로) */
  reset() { this.ring = []; this.pending = null; this.meta = null; }

  /** 프레임 하나 (게임 중, 카메라로 처리한 프레임마다). entry: { t (ms), img (Blob | Promise<Blob> | null), c (자른 자리), r (인식 결과) } */
  push(entry) {
    this.ring.push(entry);
    // 앞 10초 + 뒤 2초를 담는 동안에도 앞부분이 잘리지 않게 (12초 남짓 담아 두고, 장면을 담는 중이면 그 시작 앞으로는 지우지 않는다)
    let keepFrom = entry.t - REC_PRE_MS - REC_POST_MS - 500;
    if (this.pending) keepFrom = Math.min(keepFrom, this.pending.from);
    let k = 0;
    while (k < this.ring.length && this.ring[k].t < keepFrom) k++;
    if (k) this.ring.splice(0, k);
    if (this.pending && entry.t >= this.pending.until) this._finish();
  }

  /** 이상한 순간 (t: ms). 이미 장면을 담는 중이면 이유·표시만 더한다 */
  trigger(reason, t) {
    if (this.pending) {
      if (!this.pending.reasons.includes(reason)) this.pending.reasons.push(reason);
      this.pending.marks.push({ t, reason });
      return;
    }
    this.pending = { reasons: [reason], marks: [{ t, reason }], from: t - REC_PRE_MS, until: t + REC_POST_MS };
  }

  /** 게임이 끝남: 담는 중인 장면을 지금까지로 마무리 */
  flush() { return this.pending ? this._finish() : null; }

  /** '인식이 이상했어요' (게임이 끝난 뒤): 담아 둔 마지막 10초를 장면으로. t 를 주지 않으면 마지막으로 담은 프레임 시각 */
  report(t) {
    if (!this.ring.length) return null;
    const at = t ?? this.ring[this.ring.length - 1].t;
    this.trigger('report', at);
    this.pending.until = at;
    return this._finish();
  }

  _finish() {
    const p = this.pending;
    this.pending = null;
    if (!p) return null;
    const frames = this.ring.filter((e) => e.t >= p.from && e.t <= p.until);
    if (!frames.length) return null;
    const clip = { id: `${frames[0].t.toFixed(0)}-${p.reasons[0]}`, at: Date.now(), reasons: p.reasons, marks: p.marks, meta: this.meta, frames };
    this.clips.push(clip);
    while (this.clips.length > REC_MAX_CLIPS) this.clips.shift();
    this.onClip?.(clip);
    return clip;
  }

  clear() { this.clips = []; }
}

/** Blob -> data URL (내려받을 파일에 사진을 글자로 담는다) */
function blobToDataUrl(blob) {
  return new Promise((res) => {
    if (!blob) { res(null); return; }
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => res(null);
    fr.readAsDataURL(blob);
  });
}

/**
 * 장면 -> 내려받을 JSON 글자. 사진은 data URL, 시각은 장면 첫 프레임부터의 ms.
 * meta: { app, mode, rankKey, settings(인식 설정 — 등록한 퍽·스틱 색, 허용 오차, 해상도, 영역 네 모서리), src: { PW, PH }, mirror:false (사진은 인식 방향 그대로) }
 */
export async function clipToJson(clip) {
  const t0 = clip.frames[0]?.t || 0;
  const frames = [];
  for (const f of clip.frames) frames.push({ t: Math.round(f.t - t0), img: await blobToDataUrl(await f.img), c: f.c || null, r: f.r || null });
  return JSON.stringify({
    v: 1, kind: 'puck-trainer-clip', at: new Date(clip.at).toISOString(), reasons: clip.reasons,
    marks: clip.marks.map((m) => ({ t: Math.round(m.t - t0), reason: m.reason })), meta: clip.meta || null, frames,
  });
}

/** 파일 이름: puck-clip-20261128-153012-jump.json */
export function clipFileName(clip) {
  const d = new Date(clip.at), p = (n) => String(n).padStart(2, '0');
  return `puck-clip-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${clip.reasons[0] || 'clip'}.json`;
}

/**
 * 프레임 하나의 인식 결과 요약 (장면 파일에 담는 것, 숫자 몇 개):
 *  p: 인식이 고른 퍽 [x, y, 면적, 애매한 조각 0/1] (처리 좌표) | null
 *  s: 블레이드 [x, y] | null
 *  m: 추적기에 넣은 측정 [u, v, 블레이드로 이음 0/1, 애매함 0/1] | null
 *  k: 추적기 [u, v, 상태(t 추적 · p 예측 · l 놓침), 확실 0/1, 블레이드로 이음 0/1]
 *  g: 게임 [원점수, 감점 수, 넘긴 충돌 수]
 */
export function frameSummary(result, meas, tracker, game) {
  const r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;
  const p = result?.puck, s = result?.stick, k = tracker?.pos;
  return {
    p: p ? [r2(p.x), r2(p.y), r2(p.area), p.doubtful ? 1 : 0] : null,
    s: s ? [r2(s.x), r2(s.y)] : null,
    m: meas ? [r3(meas.u), r3(meas.v), meas.bridged ? 1 : 0, meas.doubtful ? 1 : 0] : null,
    k: [k ? r3(k.x) : null, k ? r3(k.y) : null, (tracker?.state || 'lost')[0], tracker?.confident ? 1 : 0, tracker?.bridged ? 1 : 0],
    g: game ? [Math.round(game.score || 0), game.hits || 0, game.unsure || 0] : null,
  };
}
