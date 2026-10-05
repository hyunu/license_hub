# LicenseHub 백엔드 배포 가이드 (Oracle Cloud)

Oracle Cloud 인스턴스에서 백엔드를 실행하고, 무료 HTTPS로 공개하는 절차다.
**Ubuntu 이미지와 Oracle Linux 이미지를 모두 지원한다.**

| | Ubuntu | Oracle Linux |
|---|---|---|
| 기본 SSH 계정 | `ubuntu` | `opc` |
| 패키지 매니저 | `apt-get` | `dnf` |
| OS 방화벽 | `ufw` | `firewalld` |

`bootstrap.sh`가 OS를 자동 감지해 처리한다.

## 요약

- **Tailscale**은 인스턴스 *관리/운영 접근* 전용이다. VCN 포트 오픈 없이
  tailnet에 합류해 SSH·테스트·서비스 관리를 안전하게 한다.
- **백엔드 API는 방문자 브라우저(GitHub Pages 프론트)에서 접근해야 하므로
  공개 HTTPS URL이 필요하다.** Tailscale IP만으로는 프론트가 연결할 수 없다.
  → Oracle 자체에서 **Caddy + DuckDNS + Let's Encrypt**로 무료 HTTPS를
  구성한다(6.1, 권장).

## 1. Tailscale 설치·합류

```sh
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
# 로그인 URL이 출력되면 브라우저에서 인증
tailscale ip -4        # 이 인스턴스의 100.x.y.z 주소 확인
```

직접 연결 속도를 위해 VCN에 인바운드 UDP 41641을 열 수도 있다(선택). 없으면
DERP 릴레이로 동작하며 접근 자체는 가능하다.

## 2. 백엔드 빌드

Ubuntu 인스턴스에서(또는 로컬에서 크로스 빌드 후 복사):

```sh
# Ubuntu 인스턴스에서 빌드하는 경우
apt update && apt install -y build-essential pkg-config
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

cd license_hub/web/backend
cargo build --release
```

## 3. 배포 디렉터리 구성

```sh
sudo mkdir -p /opt/licensehub/data /opt/licensehub/bin /opt/licensehub/frontend
sudo cp target/release/licensehub-web-backend /opt/licensehub/bin/
# 프론트를 백엔드가 서빙하려면(선택) 빌드 산출물을 복사:
#   (로컬) cd web/frontend && npm ci && npm run build
#   sudo cp -r web/frontend/dist/* /opt/licensehub/frontend/
```

## 4. 환경 설정

`/opt/licensehub/.env` 생성:

```sh
# 도메인이 없다면 sslip.io: https://<공인IP>.sslip.io (무계정)
PUBLIC_URL=https://146.56.111.99.sslip.io

BIND_ADDR=0.0.0.0:8080
LICENSEHUB_DB=/opt/licensehub/data/licensehub.db
FRONTEND_DIST=/opt/licensehub/frontend

# 반드시 64자 hex 개인키를 설정 (재시작 후에도 인증서 검증 유지)
LICENSEHUB_SIGNING_KEY=<64-char-hex>

LICENSEHUB_ADMIN_USER=admin
LICENSEHUB_ADMIN_PASSWORD=<강한 비밀번호>

# GitHub App 연동 (선택)
#GITHUB_REPO=owner/repo
#GITHUB_APP_ID=123456
#GITHUB_INSTALLATION_ID=654321
#GITHUB_APP_PRIVATE_KEY_PATH=/opt/licensehub/app.pem
```

> 개인키 생성: `openssl rand -hex 32` 로 64자 hex를 만들어 안전하게 보관한다.

## 5. systemd 서비스 등록

`/etc/systemd/system/licensehub-web.service`:

```ini
[Unit]
Description=LicenseHub Web Backend
After=network.target tailscaled.service

[Service]
WorkingDirectory=/opt/licensehub
EnvironmentFile=/opt/licensehub/.env
ExecStart=/opt/licensehub/bin/licensehub-web-backend
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now licensehub-web
sudo systemctl status licensehub-web
```

## 6. 공개 HTTPS 노출

프론트(방문자 브라우저)가 백엔드에 접근하려면 **공개 HTTPS URL**이 필요하다.
GitHub로는 백엔드를 호스팅할 수 없으므로 Oracle 인스턴스에서 직접 HTTPS를
구성한다. 세 가지 방법 중 하나를 선택한다.

### 6.1 Oracle 자체 무료 HTTPS (Caddy + Let's Encrypt)

Oracle 인스턴스에서 완전 무료로 HTTPS를 구성한다. 도메인 구매가 필요 없다.
호스트명은 **Oracle 공인 IP를 가리키는 무료 이름**을 사용한다.

- **무료 인증서**: Caddy가 Let's Encrypt 인증서를 자동 발급·갱신
- VCN에서 **인바운드 443**(및 ACME용 80)만 오픈

#### 방법 A: sslip.io (계정·도메인 불필요, 권장)

`<공인IP>.sslip.io` 가 그 IP로 해석된다. 인스턴스 공인 IP를 확인:

```sh
curl -4 ifconfig.me   # 예: 146.56.111.99 → 호스트명은 146.56.111.99.sslip.io
```

```sh
# Caddy 설치
sudo apt install -y caddy

# /etc/caddy/Caddyfile — 공인 IP를 붙인 호스트명 사용
echo '
146.56.111.99.sslip.io {
    reverse_proxy 127.0.0.1:8080
}
' | sudo tee /etc/caddy/Caddyfile

sudo systemctl enable --now caddy
```

- 최종 URL: `https://146.56.111.99.sslip.io`
- Caddy가 이 호스트명으로 Let's Encrypt 인증서를 자동 발급한다.
- **주의**: 공인 IP가 바뀌면 호스트명도 바뀐다 → Oracle **예약 공인 IP
  (Reserved Public IP)**를 쓰면 IP가 유지된다.

#### 방법 B: DuckDNS (무료 계정, IP가 바뀌어도 이름 유지)

```sh
# 1) duckdns.org 가입 → 무료 서브도메인(예: licensehub) + 토큰
#    인스턴스 공인 IP를 A 레코드로 등록. 자동 갱신은 크론으로:
curl "https://www.duckdns.org/update?domains=licensehub&token=<TOKEN>&ip="

# 2) Caddy 설치
sudo apt install -y caddy

# 3) /etc/caddy/Caddyfile
echo '
licensehub.duckdns.org {
    reverse_proxy 127.0.0.1:8080
}
' | sudo tee /etc/caddy/Caddyfile

sudo systemctl enable --now caddy
```

- 최종 URL: `https://licensehub.duckdns.org`
- 공인 IP가 바뀌면 DuckDNS 레코드만 갱신하면 이름이 유지된다.

공통:

- **VCN 보안목록**: 인바운드 `TCP 443`과 `TCP 80`(ACME 검증용) 오픈.
- 최종 URL을 프론트 `API_BASE_URL`에 사용한다. L2/L3 검증 서버 주소는
  라이선스 발급 시 입력하므로 여기서 정하지 않는다.

### 6.2 Tailscale Funnel

Tailscale을 쓰면 VCN 포트를 열지 않고 공개 HTTPS를 얻는다.

```sh
sudo tailscale funnel 8080
# 출력되는 공개 HTTPS URL 확인 (https://<머신>.<tailnet>.ts.net)
tailscale funnel status
```

- Funnel은 Tailscale이 443에서 TLS를 종료하고 터널 안의 8080으로 전달한다.
- 이 URL을 프론트 `API_BASE_URL`에 사용한다. L2/L3 검증 서버 주소는
  라이선스 발급 시 입력하므로 여기서 정하지 않는다.
- Funnel은 백엔드를 공개 인터넷에 노출하므로 API 인증(Bearer 토큰)이
  보호의 핵심이다.
- 계획에 따라 Funnel 제공 여부가 다를 수 있다(무료/유료 확인).

### 대안: 도메인 + 리버스프록시 (Caddy)

자신의 도메인이 있다면 위 6.1과 동일하게 Caddy를 쓰면 된다.

```sh
# /etc/caddy/Caddyfile
api.yourdomain.com {
    reverse_proxy 127.0.0.1:8080
}
```

이 경우 VCN 인바운드 443/80만 연다.

### 대안: Cloudflare Tunnel (무료 HTTPS, 도메인 불필요)

GitHub는 백엔드 호스팅을 제공하지 않으므로, 무료 HTTPS가 필요하면
Cloudflare Tunnel이 가장 간단하다.

```sh
# Ubuntu에 cloudflared 설치
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

# 임시 공개 HTTPS URL 생성 (도메인 없이 가능)
cloudflared tunnel --url http://127.0.0.1:8080
# 출력: https://xxxx-xxxx.trycloudflare.com
```

- 도메인을 붙이려면 `cloudflared tunnel login` + named tunnel 설정(무료).
- 생성된 `https://...trycloudflare.com` 을 `PUBLIC_URL`과 프론트
  `API_BASE_URL`에 사용한다.
- 임시 터널은 프로세스가 살아있는 동안 유지된다. 상시 운영은 named tunnel 권장.

## 7. Ubuntu 방화벽 확인

Oracle Ubuntu 이미지는 기본적으로 OS 방화벽이 꺼져 있지만 확인한다.

```sh
sudo ufw status            # inactive 면 그대로 둠
sudo iptables -L INPUT -n  # 기본 정책/규칙 확인
```

Funnel 경유 트래픽은 Tailscale 인터페이스로 들어오므로 8080 인바운드 규칙이
따로 필요 없다. OS 방화벽이 켜져 있다면 tailscale 인터페이스만 허용:

```sh
sudo ufw allow in on tailscale0 to any port 8080 proto tcp
```

## 8. 접근 확인

```sh
# (운영자) Tailscale IP로 내부 확인 — 다른 tailnet 장치에서
curl http://100.x.y.z:8080/api/public-key

# (공개) Funnel HTTPS URL로 확인 — 어느 브라우저에서나
curl https://<머신>.<tailnet>.ts.net/api/public-key
```

## 9. GitHub Pages 프론트와 연결

프론트는 Pages(HTTPS)에 배포되어 있다. `API_BASE_URL`은 반드시 **공개 HTTPS
주소**여야 한다. HTTP 주소를 넣으면 브라우저가 혼합 콘텐츠로 차단하고,
Tailscale IP는 방문자 브라우저에서 접근 불가다.

- 저장소 **Variables → `API_BASE_URL=https://<머신>.<tailnet>.ts.net`**
- 프론트 빌드 워크플로우(`.github/workflows/pages.yml`)가 `VITE_API_BASE_URL`
  로 주입한다.
- `API_BASE_URL`을 설정하지 않으면 프론트는 데모 모드로 동작한다.

## 보안 참고

- **Tailscale** = 관리·운영 접근. **Funnel(공개 HTTPS)** = 서비스 접근. 분리.
- `/api/auth/login` 은 비밀번호(argon2), 나머지 API는 Bearer 토큰 인증.
- `/api/verify` 는 L2/L3 검증용 공개 상태. 필요한 경우 리버스프록시에서 제한.
- 공개 HTTPS를 쓰므로 관리자 비밀번호(`LICENSEHUB_ADMIN_PASSWORD`)를 반드시
  강하게 설정한다.