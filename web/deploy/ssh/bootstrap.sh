#!/usr/bin/env bash
set -euo pipefail

# LicenseHub 백엔드 환경 프로비저닝 (멱등).
# /opt/licensehub/.env 가 먼저 준비되어 있어야 한다.
# 사용: sudo bash bootstrap.sh [PROXY_DOMAIN]

DOMAIN="${1:-licensehub.duckdns.org}"
export DEBIAN_FRONTEND=noninteractive

echo "==> 디렉터리 생성"
mkdir -p /opt/licensehub/bin /opt/licensehub/data /opt/licensehub/frontend

echo "==> 패키지 설치 (caddy)"
if ! command -v caddy >/dev/null 2>&1; then
    apt-get update -y
    apt-get install -y caddy
fi

echo "==> systemd 서비스 등록"
cat > /etc/systemd/system/licensehub-web.service <<'EOF'
[Unit]
Description=LicenseHub Web Backend
After=network.target

[Service]
WorkingDirectory=/opt/licensehub
EnvironmentFile=/opt/licensehub/.env
ExecStart=/opt/licensehub/bin/licensehub-web-backend
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable licensehub-web

echo "==> Caddy 리버스프록시 (${DOMAIN})"
cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
    reverse_proxy 127.0.0.1:8080
}
EOF
systemctl enable caddy
systemctl restart caddy

echo "==> 완료. 바이너리는 deploy 단계에서 /opt/licensehub/bin/ 에 배치된다."
echo "    백엔드 서비스 시작: sudo systemctl start licensehub-web"