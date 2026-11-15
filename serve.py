#!/usr/bin/env python3
"""로컬 HTTPS 개발 서버.

아이패드 Safari는 HTTPS(또는 localhost)에서만 카메라를 허용합니다.
같은 Wi-Fi의 아이패드에서 테스트하려면 이 스크립트로 자체 서명 인증서를 만들어 HTTPS로 서빙하세요.

    python3 serve.py            # https://0.0.0.0:8443
    python3 serve.py 9000       # 포트 변경
    python3 serve.py --http     # 인증서 없이 HTTP (localhost 테스트용)

아이패드에서 https://<컴퓨터 IP>:8443 접속 후 인증서 경고를 "계속" 하면 됩니다.
"""
import http.server
import os
import socket
import ssl
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
CERT_DIR = os.path.join(ROOT, '.certs')
CERT = os.path.join(CERT_DIR, 'dev.crt')
KEY = os.path.join(CERT_DIR, 'dev.key')


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.webmanifest': 'application/manifest+json',
        '.svg': 'image/svg+xml',
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):  # 조용한 로그
        sys.stderr.write('%s %s\n' % (self.address_string(), fmt % args))


def ensure_cert():
    if os.path.exists(CERT) and os.path.exists(KEY):
        return True
    os.makedirs(CERT_DIR, exist_ok=True)
    try:
        subprocess.run([
            'openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825',
            '-keyout', KEY, '-out', CERT, '-subj', '/CN=puck-trainer.local',
            '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:%s' % local_ip(),
        ], check=True, capture_output=True)
        return True
    except (OSError, subprocess.CalledProcessError) as e:
        print('인증서 생성 실패 (openssl 필요):', e, file=sys.stderr)
        return False


def local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        return s.getsockname()[0]
    except OSError:
        return '127.0.0.1'
    finally:
        s.close()


def print_qr(url):
    """qrcode 패키지가 설치되어 있으면 터미널에 QR 코드 출력 (pip install qrcode)"""
    try:
        import qrcode  # type: ignore
    except ImportError:
        return False
    qr = qrcode.QRCode(border=1)
    qr.add_data(url)
    qr.make(fit=True)
    qr.print_ascii(invert=True)
    return True


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    use_http = '--http' in sys.argv
    port = int(args[0]) if args else (8080 if use_http else 8443)
    try:
        httpd = http.server.ThreadingHTTPServer(('0.0.0.0', port), Handler)
    except OSError as e:
        print('포트 %d 를 열 수 없습니다 (%s). 다른 포트로 실행하세요: python3 serve.py 9443' % (port, e), file=sys.stderr)
        sys.exit(1)
    scheme = 'http'
    if not use_http and ensure_cert():
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(CERT, KEY)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
        scheme = 'https'
    ip = local_ip()
    url = '%s://%s:%d' % (scheme, ip, port)
    line = '=' * 64
    print(line)
    print(' 퍽 드리블 트레이너 서버 실행 중')
    print(line)
    print(' 이 컴퓨터에서 열기 : %s://localhost:%d' % (scheme, port))
    print('')
    print(' 휴대폰 / 아이패드에서 열기 (같은 Wi-Fi):')
    print('')
    print('      %s' % url)
    print('')
    print(' 위 주소를 휴대폰 브라우저 주소창에 그대로 입력하세요. (%s 가 이 컴퓨터의 IP입니다)' % ip)
    if scheme == 'https':
        print(' 인증서 경고가 뜨면: iPhone Safari "세부사항 보기 > 이 웹 사이트 방문", Android Chrome "고급 > 이동"')
    else:
        print(' 주의: http 모드에서는 휴대폰 카메라가 허용되지 않습니다. 휴대폰 테스트는 --http 없이 실행하세요.')
    print(' 안 열리면: 1) 휴대폰과 컴퓨터가 같은 Wi-Fi인지  2) 방화벽에서 Python 허용(개인 네트워크)  3) 공유기 AP 격리 해제')
    if ip.startswith('127.'):
        print(' 경고: 네트워크 IP를 찾지 못했습니다. Wi-Fi/이더넷 연결을 확인하세요.')
    if not print_qr(url):
        print(' (pip install qrcode 를 설치하면 여기 QR 코드가 표시됩니다)')
    print(line)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
