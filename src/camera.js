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

  /** facing: 'user'(전면, 화면을 보며 플레이) | 'environment'(후면) */
  async start(deviceId = '', facing = 'user') {
    this.stop();
    const base = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
    const video = deviceId ? { ...base, deviceId: { exact: deviceId } } : { ...base, facingMode: { ideal: facing } };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (err) {
      if (deviceId) {
        // 지정 장치 실패 시 방향 기준 카메라로 재시도
        stream = await navigator.mediaDevices.getUserMedia({ video: { ...base, facingMode: { ideal: facing } }, audio: false });
      } else {
        throw err;
      }
    }
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

export function describeCameraError(err) {
  const name = err?.name || '';
  if (!window.isSecureContext) {
    return '카메라는 HTTPS(또는 localhost)에서만 사용할 수 있습니다.\n배포된 주소(https://)로 열거나, README의 HTTPS 개발 서버 안내를 참고하세요.';
  }
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return '카메라 권한이 거부되었습니다.\n설정 > Safari > 카메라에서 허용으로 바꾼 뒤 페이지를 새로고침하세요.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return '사용 가능한 카메라를 찾지 못했습니다.';
  }
  if (name === 'NotReadableError') {
    return '다른 앱이 카메라를 사용 중입니다. 해당 앱을 종료한 뒤 다시 시도하세요.';
  }
  return `카메라를 시작할 수 없습니다. (${name || err?.message || '알 수 없는 오류'})`;
}
