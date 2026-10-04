#!/usr/bin/env bash
set -euo pipefail

# LicenseHub 백엔드 환경 프로비저닝 (멱등).
# Ubuntu(apt)와 Oracle Linux(dnf)를 모두 지원한다.
# /opt/licensehub/.env 가 먼저 준비되어 있어야 한다.
# 사용: sudo bash bootstrap.sh [PROXY_DOMAIN]

DOMAIN="${1:-licensehub.duckdns.org}"
export DEBIAN_FRONTEND=noninteractive

echo "==> 디렉터리 생성"
mkdir -p /opt/licensehub/bin /opt/licensehub/data /opt/licensehub/frontend

echo "==> 스왑 설정 (소형 인스턴스 OOM 방지)"
if ! swapon --show | grep -q .; then
    if [ ! -f /swapfile ]; then
        if command -v fallocate >/dev/null 2>&1; then
            fallocate -l 2G /swapfile
        else
            dd if=/dev/zero of=/swapfile bs=1M count=2048
        fi
        chmod 600 /swapfile
    fi
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "    swap 활성화: $(swapon --show | tail -1)"
else
    echo "    이미 swap 있음"
fi

echo "==> 패키지 매니저 감지"
if command -v dnf >/dev/null 2>&1; then
    PKG=dnf
elif command -v apt-get >/dev/null 2>&1; then
    PKG=apt-get
else
    echo "지원하지 않는 배포판 (dnf/apt-get 없음)" >&2
    exit 1
fi
echo "    package manager: ${PKG}"

echo "==> caddy 설치"
if ! command -v caddy >/dev/null 2>&1; then
    if [ "$PKG" = dnf ]; then
        # Oracle Linux / RHEL: COPR repo 시도
        # 소형 인스턴스에서 dnf가 OOM으로 죽거나 멈추지 않도록 제한 시간을 건다.
        timeout 300 dnf install -y 'dnf-command(copr)' >/dev/null 2>&1 || true
        timeout 300 dnf copr enable -y '@caddy/caddy' >/dev/null 2>&1 || true
        timeout 300 dnf install -y caddy >/dev/null 2>&1 || true
    else
        apt-get update -y >/dev/null
        timeout 300 apt-get install -y caddy >/dev/null 2>&1 || true
    fi
fi

# 패키지 설치가 안 됐으면 정적 바이너리 + 공식 systemd unit으로 설치
if ! command -v caddy >/dev/null 2>&1; then
    echo "    caddy 패키지 설치 실패 → 정적 바이너리 설치"
    case "$(uname -m)" in
        aarch64|arm64) A=arm64 ;;
        *) A=amd64 ;;
    esac
    echo "    arch: $(uname -m) → caddy_2.8.4_linux_${A}.tar.gz"
    URL="https://github.com/caddyserver/caddy/releases/download/v2.8.4/caddy_2.8.4_linux_${A}.tar.gz"
    OK=0
    for i in 1 2 3; do
        if curl -fsSL "${URL}" -o /tmp/caddy.tgz; then
            OK=1
            break
        fi
        echo "    다운로드 실패(${i}/3), 3초 후 재시도"
        sleep 3
    done
    [ "${OK}" = 1 ] || { echo "caddy 다운로드 실패" >&2; exit 1; }
    tar -xzf /tmp/caddy.tgz -C /tmp caddy
    mv /tmp/caddy /usr/local/bin/caddy
    curl -fsSL "https://raw.githubusercontent.com/caddyserver/caddy/master/dist/init/linux-systemd/caddy.service" -o /etc/systemd/system/caddy.service
    mkdir -p /etc/caddy /var/lib/caddy
    systemctl daemon-reload
fi
command -v caddy >/dev/null 2>&1 || { echo "caddy 설치 실패" >&2; exit 1; }

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

echo "==> 방화벽 (존재 시)"
if command -v firewall-cmd >/dev/null 2>&1; then
    # Oracle Linux (firewalld)
    firewall-cmd --permanent --add-service=http >/dev/null 2>&1 || true
    firewall-cmd --permanent --add-service=https >/dev/null 2>&1 || true
    firewall-cmd --reload >/dev/null 2>&1 || true
fi
if command -v ufw >/dev/null 2>&1; then
    # Ubuntu (ufw)
    ufw allow 80,443/tcp >/dev/null 2>&1 || true
fi

systemctl enable caddy
systemctl restart caddy

echo "==> 완료. 바이너리는 deploy 단계에서 /opt/licensehub/bin/ 에 배치된다."
echo "    백엔드 서비스 시작: sudo systemctl start licensehub-web"