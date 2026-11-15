// 카메라 제어 (getUserMedia)
export class Camera {
  constructor(videoEl) {
    this.video = videoEl;
    this.stream = null;
    this.deviceId = '';
  }

  static isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /**
   * facing: 'user'(전면, 화면을 보며 플레이) | 'environment'(후면)
   * 지정 장치 -> 방향 기준 -> 아무 카메라 순으로 재시도하고, 각 시도는 15초 안에 응답이 없으면 실패로 처리.
   */
  async start(deviceId = '', facing = 'user') {
    this.stop();
    const base = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
    const attempts = [];
    if (deviceId) attempts.push({ ...base, deviceId: { exact: deviceId } });
    attempts.push({ ...base, facingMode: { ideal: facing } });
    attempts.push(true); // 제약 없이 (노트북 내장 카메라 등)
    let stream = null, lastErr = null;
    this.attemptLog = [];
    for (const video of attempts) {
      try {
        stream = await withTimeout(navigator.mediaDevices.getUserMedia({ video, audio: false }), 15000);
        break;
      } catch (err) {
        lastErr = err;
        this.attemptLog.push(`${err?.name || 'Error'}: ${err?.message || ''}`);
        // 권한 거부는 재시도해도 같으므로 바로 중단
        if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError' || err?.name === 'PermissionDeniedError') break;
      }
    }
    if (!stream) throw lastErr || new Error('카메라 스트림을 얻지 못했습니다');
    this.stream = stream;
    this.video.srcObject = stream;
    const track = stream.getVideoTracks()[0];
    const ts = track.getSettings();
    this.deviceId = ts.deviceId || deviceId;
    this.facing = ts.facingMode || facing;
    await new Promise((resolve) => {
      if (this.video.readyState >= 2) return resolve();
      this.video.onloadedmetadata = () => resolve();
    });
    try { await this.video.play(); } catch { /* autoplay 정책: muted+playsinline이면 보통 통과 */ }
    return { width: this.video.videoWidth, height: this.video.videoHeight, facing: this.facing };
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }

  async listDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput');
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { const e = new Error('카메라가 응답하지 않습니다'); e.name = 'TimeoutError'; reject(e); }, ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function platformHint() {
  const ua = navigator.userAgent;
  const isMac = /Mac OS X/.test(ua) && !/iPhone|iPad/.test(ua);
  const isWin = /Windows/.test(ua);
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const isSafari = /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua);
  return { isMac, isWin, isIOS, isAndroid, isSafari };
}

/** 오류 이름 + 플랫폼별 해결 순서 */
export function describeCameraError(err) {
  const name = err?.name || '';
  const p = platformHint();
  const detail = `(${name || 'Error'}${err?.message ? ': ' + err.message : ''})`;
  if (!window.isSecureContext) {
    return '카메라는 HTTPS(또는 localhost)에서만 사용할 수 있습니다.\n배포된 주소(https://)로 열거나, README의 HTTPS 개발 서버 안내를 참고하세요.';
  }
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    const steps = p.isIOS ? '설정 > Safari > 카메라를 "허용"으로 바꾼 뒤 새로고침하세요.'
      : p.isSafari ? 'Safari 메뉴 > 이 웹 사이트 설정 > 카메라를 "허용"으로 바꾸세요.'
      : '주소창 왼쪽의 자물쇠(또는 카메라) 아이콘 > 카메라 "허용"으로 바꾸고 새로고침하세요.';
    const os = p.isWin ? '\nWindows: 설정 > 개인 정보 및 보안 > 카메라에서 "카메라 액세스"와 "앱이 카메라에 액세스하도록 허용"을 켜세요 (데스크톱 앱 항목에 브라우저 포함).'
      : p.isMac ? '\nmacOS: 시스템 설정 > 개인정보 보호 및 보안 > 카메라에서 사용 중인 브라우저를 켜세요.' : '';
    return `카메라 권한이 거부되었습니다. ${detail}\n${steps}${os}`;
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return `연결된 카메라를 찾지 못했습니다. ${detail}\n노트북 카메라 가림막(프라이버시 셔터)이나 Fn 카메라 끄기 키가 눌려 있지 않은지, 장치 관리자에서 카메라가 사용 중지되지 않았는지 확인하세요.`;
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError' || name === 'TimeoutError') {
    return `카메라를 열 수 없습니다. 다른 프로그램이 카메라를 쓰고 있을 가능성이 큽니다. ${detail}\nZoom·Teams·카카오톡·카메라 앱·OBS 등을 완전히 종료하고(트레이 아이콘까지), 브라우저의 다른 탭에서 카메라를 쓰고 있지 않은지 확인한 뒤 "다시 시도"를 누르세요.${p.isWin ? '\n그래도 안 되면 Windows 설정 > 개인 정보 및 보안 > 카메라에서 접근을 켜고, 브라우저를 완전히 껐다 켜세요.' : ''}`;
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return `선택한 카메라를 쓸 수 없습니다. ${detail}\n아래 목록에서 다른 카메라를 고른 뒤 다시 시도하세요.`;
  }
  return `카메라를 시작할 수 없습니다. ${detail}\n아래 목록에서 카메라를 직접 고르거나, 브라우저를 Chrome/Edge 최신 버전으로 바꿔 보세요.`;
}
