// 휴대폰 카메라 연결 (운영자 테스트): 휴대폰은 촬영만, 화면(노트북·아이패드)은 영상을 받아 지금과 똑같이 인식·플레이한다.
// - 영상: WebRTC 로 휴대폰 -> 화면 기기에 직접(P2P) 보낸다. 같은 Wi-Fi면 서버를 거치지 않는다.
// - 연결 중개(시그널링): Firestore rtc/{코드} 문서 하나. 화면 기기(운영자 로그인)가 연결 제안(offer)을 쓰고,
//   코드를 아는 휴대폰이 답(answer)을 한 번 쓴다. 규칙은 firestore.rules 의 rtc 참고.
// - 끊기면 화면 기기가 세대(gen)를 올려 새 제안을 쓰고, 휴대폰은 그것을 보고 자동으로 다시 답한다.
// 이 파일에는 화면에 보이는 문구를 두지 않는다 (상태 이름만 알리고, 문구는 main.js·cam/phone.js 가 정한다).

/** 코드 글자: 헷갈리는 I·O·0·1 을 뺀 32자 (규칙의 [A-HJ-NP-Z2-9] 와 같음) */
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LEN = 6;
export const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
/** 연결 문서가 살아 있는 시간 (규칙은 3시간 안쪽만 받는다) */
export const ROOM_TTL = 2 * 60 * 60 * 1000;
/** 같은 Wi-Fi가 아니어도 서로의 공인 주소를 알 수 있게 (영상은 STUN 서버를 거치지 않는다) */
export const RTC_CONFIG = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

export function makeCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  return [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

/** 입력한 코드 정리: 소문자·띄어쓰기·하이픈 허용, 헷갈리는 글자는 바꿔 준다 (O->0 은 코드에 없으니 그대로 둠) */
export function normCode(s) {
  return String(s || '').toUpperCase().replace(/[\s-]/g, '');
}

// ---------------- 연결 중개 (시그널링) ----------------
// signal = { put({gen, offer, exp}), answer({gen, sdp}), watch(cb, onErr) -> 해제 함수, remove() }
// watch 의 cb 는 문서 내용 { gen, offer, exp(ms), answer? } 또는 null(문서 없음)

/** Firestore rtc/{code} (F = firebase-firestore 모듈, uid = 운영자. 휴대폰은 uid 없이 answer·watch 만 쓴다) */
export function firestoreSignal(F, db, code, uid = null) {
  const ref = F.doc(db, 'rtc', code);
  return {
    put: ({ gen, offer, exp }) => F.setDoc(ref, { host: uid, gen, offer, exp: F.Timestamp.fromMillis(exp) }),
    answer: (a) => F.updateDoc(ref, { answer: a }),
    watch: (cb, onErr) => F.onSnapshot(ref, (s) => {
      if (!s.exists()) return cb(null);
      const d = s.data();
      cb({ gen: d.gen, offer: d.offer, exp: d.exp?.toMillis ? d.exp.toMillis() : 0, answer: d.answer || null });
    }, onErr),
    remove: () => F.deleteDoc(ref).catch(() => {}),
  };
}

/**
 * 같은 브라우저 안의 탭끼리 (Firebase 를 연결하지 않은 개발·자동 테스트용): localStorage + BroadcastChannel.
 * Firestore 규칙과 같게, 답은 아직 답이 없고 세대가 맞을 때만 쓸 수 있다.
 */
export function localSignal(code) {
  const key = `rtc:${code}`;
  const bc = new BroadcastChannel('puck-rtc');
  const read = () => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
  const write = (d) => { if (d) localStorage.setItem(key, JSON.stringify(d)); else localStorage.removeItem(key); bc.postMessage(key); };
  const watchers = new Set();
  const notify = () => { const d = read(); watchers.forEach((cb) => cb(d)); };
  bc.onmessage = (e) => { if (e.data === key) notify(); };
  return {
    put: async (d) => { write({ gen: d.gen, offer: d.offer, exp: d.exp, answer: null }); notify(); },
    answer: async (a) => {
      const d = read();
      if (!d || d.answer || d.gen !== a.gen || d.exp < Date.now()) { const e = new Error('permission-denied'); e.code = 'permission-denied'; throw e; }
      write({ ...d, answer: a }); notify();
    },
    watch: (cb) => { watchers.add(cb); setTimeout(() => cb(read()), 0); return () => watchers.delete(cb); },
    remove: async () => { write(null); bc.close(); },
  };
}

// ---------------- 공통 ----------------

/** 후보 주소 모으기가 끝날 때까지 (또는 ms 뒤) 기다린다: 후보를 SDP 에 모두 담아 문서 한 번에 주고받는다 */
function iceDone(pc, ms = 2500) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', check); resolve(); }
    function check() { if (pc.iceGatheringState === 'complete') done(); }
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/** 받는 쪽 지연 줄이기: 재생 버퍼를 최소로 (지원하는 브라우저만) */
function lowLatency(receiver) {
  try { if ('jitterBufferTarget' in receiver) receiver.jitterBufferTarget = 0; } catch { /* 미지원 */ }
  try { receiver.playoutDelayHint = 0; } catch { /* 미지원 */ }
}

/** 보내는 쪽: 화질보다 프레임 수 우선 (퍽 움직임이 끊기지 않게), 같은 Wi-Fi 기준 넉넉한 비트레이트 */
async function tuneSender(sender) {
  try {
    const p = sender.getParameters();
    p.degradationPreference = 'maintain-framerate';
    if (p.encodings?.[0]) { p.encodings[0].maxBitrate = 4_000_000; p.encodings[0].maxFramerate = 30; }
    await sender.setParameters(p);
  } catch { /* 미지원이면 브라우저 기본값 */ }
}

/**
 * 영상 시작 화질 올리기 (Chrome·안드로이드가 보내는 쪽일 때): 휴대폰이 받는 연결 제안에 시작·최소 비트레이트를 적어
 * 처음 몇 초 동안 흐린 영상(320×180)에서 천천히 올라가지 않게 한다. Safari 는 이 값을 무시한다(해가 없음).
 */
export function boostBitrate(sdp, startKbps = 2500) {
  const lines = sdp.split('\r\n');
  const video = new Set();
  for (const l of lines) { const m = /^a=rtpmap:(\d+) (VP8|VP9|H264|AV1)\/90000/i.exec(l); if (m) video.add(m[1]); }
  const has = new Set(lines.filter((l) => l.startsWith('a=fmtp:')).map((l) => l.slice(7).split(' ')[0]));
  const params = `x-google-start-bitrate=${startKbps};x-google-min-bitrate=800;x-google-max-bitrate=4000`;
  const out = [];
  for (let l of lines) {
    const f = /^a=fmtp:(\d+) /.exec(l);
    if (f && video.has(f[1]) && !l.includes('x-google-start-bitrate')) l += `;${params}`;
    out.push(l);
    const r = /^a=rtpmap:(\d+) /.exec(l);
    if (r && video.has(r[1]) && !has.has(r[1])) out.push(`a=fmtp:${r[1]} ${params}`);
  }
  return out.join('\r\n');
}

const isDenied = (err) => err?.code === 'permission-denied' || /permission/i.test(String(err?.message || err));

// ---------------- 화면 기기 (노트북·아이패드) ----------------
/**
 * 상태(onState): 'preparing' 제안 준비 · 'waiting' 휴대폰 기다림 · 'connecting' 답을 받아 잇는 중 · 'connected' ·
 *                'lost' 끊김(곧 다시 기다림) · 'error'(두 번째 인자 = 오류)
 * onStream(MediaStream): 휴대폰 영상이 들어옴 (다시 연결될 때마다 새 스트림)
 * onStats({ rtt, buffer, decode, fps, width, height, path }): 2초마다 지연 측정 (ms)
 * onMessage(msg): 휴대폰이 보낸 알림 ({ t: 'info', facing, w, h })
 */
export class RemoteHost {
  constructor(signal, { rtcConfig = RTC_CONFIG, onState, onStream, onStats, onMessage } = {}) {
    Object.assign(this, { signal, rtcConfig, onState, onStream, onStats, onMessage });
    this.gen = 0; this.pc = null; this.dc = null; this.state = 'idle'; this.closed = false; this.everConnected = false;
  }

  async start() {
    this.unwatch = this.signal.watch((d) => this._onDoc(d), (err) => this._set('error', err));
    await this._arm();
  }

  send(msg) { if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(msg)); }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this._statT); clearTimeout(this._dropT);
    this.unwatch?.();
    this._closePc();
    return this.signal.remove();
  }

  _set(s, err) { this.state = s; this.onState?.(s, err); }

  _closePc() {
    const pc = this.pc; this.pc = null; this.dc = null;
    if (pc) { try { pc.close(); } catch { /* 이미 닫힘 */ } }
  }

  /** 새 연결 제안을 만들어 문서에 쓴다 (처음, 그리고 끊길 때마다) */
  async _arm() {
    if (this.closed) return;
    clearTimeout(this._dropT); clearInterval(this._statT);
    this._closePc();
    this._set('preparing');
    const pc = this.pc = new RTCPeerConnection(this.rtcConfig);
    pc.addTransceiver('video', { direction: 'recvonly' });
    const dc = this.dc = pc.createDataChannel('ctl');
    dc.onopen = () => { if (this.pc !== pc) return; this.everConnected = true; this._set('connected'); this._startStats(pc); };
    dc.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } this._onMsg(m); };
    dc.onclose = () => this._drop(pc);
    pc.ontrack = (e) => { if (this.pc !== pc) return; lowLatency(e.receiver); this.onStream?.(e.streams?.[0] || new MediaStream([e.track])); };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      const s = pc.connectionState;
      if (s === 'failed' || s === 'closed') this._drop(pc);
      else if (s === 'disconnected') {
        // 잠깐 끊겼다 돌아오는 경우가 많으니 3초 기다려 본다
        clearTimeout(this._dropT);
        this._dropT = setTimeout(() => { if (this.pc === pc && pc.connectionState !== 'connected') this._drop(pc); }, 3000);
      }
    };
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await iceDone(pc);
      if (this.pc !== pc || this.closed) return;
      this.gen += 1; this.answered = false;
      await this.signal.put({ gen: this.gen, offer: boostBitrate(pc.localDescription.sdp), exp: Date.now() + ROOM_TTL });
      if (this.pc === pc) this._set('waiting');
    } catch (err) {
      if (this.pc === pc) this._set('error', err);
    }
  }

  _drop(pc) {
    if (this.closed || pc !== this.pc) return;
    this._set('lost');
    this._arm();
  }

  _onDoc(d) {
    const pc = this.pc;
    if (!d || !pc || this.answered) return;
    const a = d.answer;
    if (a && a.gen === this.gen && pc.signalingState === 'have-local-offer') {
      this.answered = true;
      this._set('connecting');
      pc.setRemoteDescription({ type: 'answer', sdp: a.sdp }).catch((err) => { this._set('error', err); this._drop(pc); });
    }
  }

  _onMsg(m) {
    if (m.t === 'pong' && typeof m.at === 'number') this._rtt = performance.now() - m.at;
    else this.onMessage?.(m);
  }

  /** 2초마다: 왕복 시간(데이터 채널 ping) + 받는 쪽 버퍼·해독 시간 (WebRTC 통계) */
  _startStats(pc) {
    let prev = null;
    this._statT = setInterval(async () => {
      if (this.pc !== pc) return;
      this.send({ t: 'ping', at: performance.now() });
      let rep;
      try { rep = await pc.getStats(); } catch { return; }
      let inb = null, pair = null; const cands = new Map();
      rep.forEach((s) => {
        if (s.type === 'inbound-rtp' && s.kind === 'video') inb = s;
        else if (s.type === 'candidate-pair' && (s.nominated || s.selected) && s.state === 'succeeded') pair = s;
        else if (s.type === 'local-candidate' || s.type === 'remote-candidate') cands.set(s.id, s);
      });
      if (!inb) return;
      const cur = { jb: inb.jitterBufferDelay || 0, jn: inb.jitterBufferEmittedCount || 0, dt: inb.totalDecodeTime || 0, dn: inb.framesDecoded || 0 };
      const d = (k) => (prev ? cur[k] - prev[k] : cur[k]);
      const buffer = d('jn') > 0 ? (d('jb') / d('jn')) * 1000 : null;
      const decode = d('dn') > 0 ? (d('dt') / d('dn')) * 1000 : null;
      prev = cur;
      const rtt = this._rtt ?? (pair?.currentRoundTripTime != null ? pair.currentRoundTripTime * 1000 : null);
      const lc = pair && cands.get(pair.localCandidateId), rc = pair && cands.get(pair.remoteCandidateId);
      const path = !lc || !rc ? '' : (lc.candidateType === 'relay' || rc.candidateType === 'relay') ? 'relay' : (lc.candidateType === 'host' && rc.candidateType === 'host') ? 'lan' : 'p2p';
      this.onStats?.({ rtt, buffer, decode, fps: inb.framesPerSecond ?? null, width: inb.frameWidth ?? null, height: inb.frameHeight ?? null, path });
    }, 2000);
  }
}

/**
 * 화면에 보일 지연 추정 (ms): 편도 네트워크(왕복의 절반) + 받는 쪽 버퍼 + 해독 + 촬영·압축(측정 불가, 약 30ms 로 둠)
 * 측정값이 아직 없으면 null
 */
export function estimateDelay(s) {
  if (!s || s.rtt == null) return null;
  return Math.round(s.rtt / 2 + (s.buffer || 0) + (s.decode || 0) + 30);
}

// ---------------- 휴대폰 (카메라) ----------------
/**
 * 상태(onState): 'camera' 카메라 켜는 중 · 'waiting' 화면 기기의 제안을 기다림 · 'connecting' · 'connected' ·
 *                'lost' 끊김(화면 기기가 새 제안을 쓰면 자동으로 다시) · 'nocode' 코드 없음 · 'expired' 시간 지남 ·
 *                'busy' 다른 휴대폰이 이미 연결됨 · 'error'(두 번째 인자 = 오류)
 * onCommand(msg): 화면 기기가 보낸 명령 ({ t: 'flip' } 카메라 전환)
 */
export class RemotePhone {
  constructor(signal, { rtcConfig = RTC_CONFIG, onState, onCommand } = {}) {
    Object.assign(this, { signal, rtcConfig, onState, onCommand });
    this.gen = null; this.pc = null; this.dc = null; this.sender = null; this.stream = null; this.facing = 'environment';
    this.state = 'idle'; this._busy = false; this._last = undefined;
  }

  /** 카메라 켜기 (이미 연결돼 있으면 보내는 영상만 바꾼다: 다시 연결할 필요 없음) */
  async startCamera(facing = this.facing) {
    // iOS 는 카메라를 한 번에 하나만 열 수 있으므로 먼저 끈다
    this.stream?.getTracks().forEach((t) => t.stop());
    const video = { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
    this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    const track = this.stream.getVideoTracks()[0];
    try { track.contentHint = 'motion'; } catch { /* 미지원 */ }
    this.facing = track.getSettings().facingMode || facing;
    if (this.sender) { await this.sender.replaceTrack(track); try { this.sender.setStreams?.(this.stream); } catch { /* 미지원 */ } this._sendInfo(); }
    return this.stream;
  }

  listen() {
    this.unwatch = this.signal.watch((d) => this._onDoc(d), (err) => this._set('error', err));
  }

  close() {
    this.unwatch?.();
    if (this.pc) { try { this.pc.close(); } catch { /* 이미 닫힘 */ } }
    this.pc = null;
    this.stream?.getTracks().forEach((t) => t.stop());
  }

  _set(s, err) { if (s === this.state && !err) return; this.state = s; this.onState?.(s, err); }

  _onDoc(d) {
    this._last = d; this._seq = (this._seq || 0) + 1;
    if (this._busy) return; // 지금 답을 쓰는 중: 끝나면 마지막 문서로 다시 본다
    if (!d) return this._set('nocode');
    if (d.exp && d.exp < Date.now()) return this._set('expired');
    if (d.answer) {
      // 내 답이면 그대로, 남의 답이면(다른 휴대폰) 기다린다
      if (d.answer.gen !== this.gen || this.state === 'idle') this._set('busy');
      return;
    }
    if (d.gen !== this.gen || !this.pc || this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') this._answer(d);
  }

  async _answer(d) {
    if (!this.stream) return;
    this._busy = true;
    const seen = this._seq;
    if (this.pc) { try { this.pc.close(); } catch { /* 이미 닫힘 */ } }
    const pc = this.pc = new RTCPeerConnection(this.rtcConfig);
    this.gen = d.gen; this.sender = null;
    this._set('connecting');
    pc.ondatachannel = (e) => {
      const dc = this.dc = e.channel;
      dc.onopen = () => { if (this.pc === pc) { this._set('connected'); this._sendInfo(); } };
      dc.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'ping') dc.send(JSON.stringify({ t: 'pong', at: m.at }));
        else this.onCommand?.(m);
      };
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      const s = pc.connectionState;
      if (s === 'connected' && this.sender) tuneSender(this.sender);
      if (s === 'failed' || s === 'disconnected' || s === 'closed') this._set('lost');
      else if (s === 'connected' && this.dc?.readyState === 'open') this._set('connected');
    };
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: d.offer });
      const tr = pc.getTransceivers().find((t) => t.receiver?.track?.kind === 'video') || pc.getTransceivers()[0];
      tr.direction = 'sendonly';
      const track = this.stream.getVideoTracks()[0];
      await tr.sender.replaceTrack(track);
      try { tr.sender.setStreams?.(this.stream); } catch { /* 미지원 */ }
      this.sender = tr.sender;
      await pc.setLocalDescription(await pc.createAnswer());
      await iceDone(pc);
      if (this.pc !== pc) return;
      await this.signal.answer({ gen: d.gen, sdp: pc.localDescription.sdp });
    } catch (err) {
      if (this.pc === pc) {
        // 답을 못 씀: 다른 휴대폰이 먼저 답했거나 화면 기기가 새 제안으로 바꿈 -> 마지막 문서로 다시 판단
        if (isDenied(err)) { this.gen = null; this._set('waiting'); } else this._set('error', err);
      }
    } finally {
      this._busy = false;
      // 답을 쓰는 동안 문서가 바뀌었으면(새 제안·남의 답) 마지막 내용으로 다시 판단
      if (this._seq !== seen) this._onDoc(this._last);
    }
  }

  _sendInfo() {
    const t = this.stream?.getVideoTracks()[0];
    const s = t?.getSettings() || {};
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify({ t: 'info', facing: this.facing, w: s.width || 0, h: s.height || 0 }));
  }
}
