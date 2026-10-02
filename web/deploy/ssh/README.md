# SSH 자동 배포 및 환경 구축

SSH 접근만 있으면 GitHub Actions로 Oracle(Ubuntu) 인스턴스에 백엔드를
자동 배포하고 환경을 구축할 수 있다.

## 준비 (1회)

### 1. SSH 접근 제공

인스턴스의 SSH 키를 GitHub Secrets에 등록한다.

- **SSH_HOST** — 공인 IP 또는 도메인
- **SSH_USER** — 인스턴스 기본 계정
  - **Oracle Linux**: `opc`
  - Ubuntu: `ubuntu`
- **SSH_PORT** — 22
- **SSH_PRIVATE_KEY** — 인스턴스 접속용 개인키 (PEM, 전체 내용)

필요한 비밀 시크릿:

- **LICENSEHUB_SIGNING_KEY** — 64자 hex 개인키
- **LICENSEHUB_VERIFY_URL** — 공개 HTTPS 검증 URL
  - 도메인이 없으면 sslip.io: `https://<공인IP>.sslip.io/api/verify`
  - 예: `https://146.56.111.99.sslip.io/api/verify`
- **LICENSEHUB_ADMIN_USER** / **LICENSEHUB_ADMIN_PASSWORD**
- **PROXY_DOMAIN** — Caddy가 HTTPS를 받을 호스트명
  - 예: `146.56.111.99.sslip.io` (sslip.io) 또는 `licensehub.duckdns.org`

선택(웹앱의 GitHub 동기화 탭용). 인증 방식은 **PAT** 또는 **GitHub App** 중 하나:

- **GH_DEPLOY_PAT** — 배포 저장소 전용 파인그레인 PAT (Contents: Read and write).
  GitHub App이 저장소에 쓰기 404로 안 되는 경우 이 방식이 확실히 동작한다.
- GitHub App 방식:
  - **LH_GITHUB_REPO** — push할 저장소 (예: `hyunu/licensehub-distribution`)
  - **LH_GITHUB_APP_ID** — GitHub App ID (Developer settings)
  - **LH_GITHUB_INSTALLATION_ID** — 앱 설치 번호 (설치 URL의 숫자)
  - **LH_GITHUB_APP_PRIVATE_KEY** — GitHub App 개인키 PEM 전체. 프로비저닝이
    `/opt/licensehub/app.pem`으로 저장하고 `.env`에 경로를 기록한다.

### 2. 1회 환경 구축 (프로비저닝)

Actions 탭 → **Provision Oracle Backend** → Run workflow.

다음을 자동으로 수행한다.

- `/opt/licensehub/{bin,data,frontend}` 디렉터리 생성
- `/opt/licensehub/.env` 작성 (시크릿 주입, 로그에는 값 숨김)
- `caddy` 설치 + `licensehub-web.service`(systemd) 등록
- Caddy 리버스프록시 (`licensehub.duckdns.org → 127.0.0.1:8080`, Let's Encrypt 자동)
- `bootstrap.sh` 참고: `web/deploy/ssh/bootstrap.sh`

### 3. 백엔드 배포

- **자동**: `main` 브랜치에서 `core/` 또는 `web/backend/` 변경 push 시
- **수동**: Actions 탭 → **Deploy Backend to Oracle** → Run workflow

동작: CI에서 release 빌드 → scp로 `/opt/licensehub/bin/` 전송 →
`systemctl restart licensehub-web` → 헬스체크(`/api/public-key`).

## VCN 보안목록

| 방향 | 프로토콜/포트 | 목적 |
|---|---|---|
| 인바운드 | TCP 22 | SSH (선택, Tailscale 쓰면 닫아도 됨) |
| 인바운드 | TCP 443 | HTTPS (Caddy/Let's Encrypt) |
| 인바운드 | TCP 80 | ACME(Let's Encrypt) 검증용 |

## 수동 배포 (테스트용)

```sh
cd web/deploy/ssh
HOST=146.56.111.99 USER=opc KEY=~/.ssh/id_ed25519 ./deploy.sh
```

## 동작 흐름

```text
push/수동 → GitHub Actions
    → cargo build --release (backend)
    → scp binary → /opt/licensehub/bin/
    → ssh: systemctl restart licensehub-web
    → 헬스체크 /api/public-key

1회: Provision workflow
    → /opt/licensehub/.env (시크릿)
    → caddy + systemd + Caddyfile
```

## 참고

- 배포는 `workflow_dispatch`로 수동 실행할 수도 있어, push 트리거를 원하지
  않으면 `deploy-backend.yml`의 `push:` 부분을 제거하면 된다.
- 시크릿 값에 `$` 기호가 있으면 `.env` 작성 시 변수 해석될 수 있으므로
  비밀번호 등은 `$` 없이 구성한다.
- Tailscale을 관리용으로 함께 쓰면 SSH(22)를 VCN에서 닫고 tailnet으로만
  관리할 수 있다.