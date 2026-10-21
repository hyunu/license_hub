# 배포·구축 절차 (Frontend / Backend)

이 문서는 LicenseHub의 프런트엔드(GitHub Pages)와 백엔드(Oracle VM)를
**처음부터 끝까지 구축하고, VM을 교체했을 때 빠짐없이 갱신**하기 위한
체크리스트 겸 운영 가이드다. 아래 항목을 순서대로 진행하면 된다.

> ⚠️ 이 문서의 대부분은 실제 운영 중 겪은 장애를 바탕으로 작성되었다.
> "이쯤이면 알아서 되겠지" 하면 같은 실수가 반복된다. **순서를 지키고,
> 각 단계의 검증 명령을 반드시 실행하라.**

---

## 0. 구성 개요

```text
브라우저
  │  https://hyunu.github.io/license_hub/          ← 프런트엔드 (GitHub Pages)
  ▼
GitHub Pages (정적 웹앱, VITE_API_BASE_URL 사용)
  │  https://<공인IP>.sslip.io/api/*               ← 백엔드 API
  ▼
Caddy (Oracle VM, :443, Let's Encrypt 자동 인증서)
  ├── /api/*, /*  ──▶ 127.0.0.1:8080  licensehub-web-backend (Rust, systemd)
  └── /mcp*       ──▶ 127.0.0.1:8090  licensehub-mcp (Node, systemd, MCP HTTP)
```

AI 에이전트(OpenCode, Cursor, Claude Desktop 등)는 ① 로컬 stdio MCP 또는
② 위 `/mcp` 원격 엔드포인트로 LicenseHub를 도구 호출한다.

배포 주체는 **전부 GitHub Actions**다. 로컬에서 SSH로 배포하지 않는다.

| 워크플로우 | 역할 | 트리거 |
|---|---|---|
| `provision.yml` | VM 1회 구축 (swap·Caddy·systemd·.env) | 수동 |
| `deploy-backend.yml` | 백엔드 빌드 + 배포 + 헬스체크 | 수동 / `core`·`web/backend` push |
| `pages.yml` | 프런트엔드 빌드 + GitHub Pages 배포 | `main` push |
| `ci.yml` | fmt / test / clippy | push / PR |

---

## 1. 새 VM 교체 시 사전 체크리스트 (가장 중요)

VM을 새로 만들었다면 **배포를 시작하기 전에** 아래 5가지를 모두 확인하고
GitHub에 반영한다. 순서대로 안 하면 아래 "3. 자주 겪는 장애"의 문제가 그대로
반복된다.

### 1-1. 공인 IP와 OS, 아키텍처 파악

OCI 콘솔 또는 VM에서 확인:

```sh
curl -4 ifconfig.me        # 공인 IP
uname -m                   # x86_64 | aarch64  ← 배포 타깃 결정
cat /etc/os-release | grep PRETTY_NAME
```

**아키텍처가 달라지면 반드시 `deploy-backend.yml`의 빌드 타깃을 바꾼다.**
- `x86_64` → `x86_64-unknown-linux-musl`
- `aarch64` → `aarch64-unknown-linux-musl`

(예: 이전 VM은 `aarch64`였고, 현재 VM은 `x86_64`+Ubuntu 26.04다.)

### 1-2. 도메인 결정 (PROXY_DOMAIN)

> **💡 가장 많이 틀린 지점: PROXY_DOMAIN에 순수 IP를 넣는 실수.**
> Caddy가 Let's Encrypt 인증서를 받으려면 **도메인**이어야 한다.
> 순수 IP는 인증서를 받을 수 없어 HTTPS가 `tlsv1 alert internal error`로 죽는다.

공인 도메인이 없으면 **sslip.io 와일드카드 DNS**를 쓴다.

```text
PROXY_DOMAIN = <공인IP>.sslip.io          예) 168.110.123.142.sslip.io
API_BASE_URL = https://<공인IP>.sslip.io  예) https://168.110.123.142.sslip.io
```

**도메인은 반드시 `IP.sslip.io` 형태여야 하며, IP만 넣으면 안 된다.**

### 1-3. GitHub 시크릿·변수 반영

```sh
# Variable (프런트엔드 빌드에 VITE_API_BASE_URL로 주입)
gh variable set API_BASE_URL --body "https://168.110.123.142.sslip.io"

# Secrets
gh secret set PROXY_DOMAIN    --body "168.110.123.142.sslip.io"
gh secret set SSH_HOST        --body "<새 VM 공인 IP>"
gh secret set SSH_USER        --body "ubuntu"     # Ubuntu / opc(Oracle Linux)
gh secret set SSH_PORT        --body "22"
gh secret set SSH_PRIVATE_KEY --body "$(cat <개인키 파일>)"
```

### 1-4. SSH 키 등록 (가장 많은 삽질 지점)

GitHub Actions는 `SSH_PRIVATE_KEY`의 **개인키**로만 VM에 접속한다.
그 개인키와 **한 쌍인 공개키가 VM의 `~/.ssh/authorized_keys`에 등록**돼 있어야
한다. Termius 등으로 로컬 SSH가 되더라도 **GitHub에 넣은 개인키와 VM의
공개키가 같은 쌍인지** 확인하라.

- 개인키에 **패스프레이즈가 있으면 안 된다** (GitHub Actions가 해석 불가).
- 키 내용은 `-----BEGIN OPENSSH PRIVATE KEY-----`로 시작해야 한다.

확인: 아래처럼 **일치 여부만** 출력해 검증할 수 있다.

```sh
# VM에서 개인키의 공개키와 authorized_keys 대조
ssh-keygen -y -f <개인키파일>          # 출력된 공개키가
cat ~/.ssh/authorized_keys             # 이 파일에 있는지 확인
```

### 1-5. 시크릿 전파 지연 주의

GitHub 시크릿을 갱신한 **직후**에 워크플로우를 돌리면 이전 값이 쓰일 수 있다.
갱신 후 **1~2분 기다린 뒤** 배포를 실행한다.

---

## 2. 구축 절차 (새 VM 순서)

### 2-1. 프로비저닝 (1회)

```
Actions 탭 → Provision Oracle Backend → Run workflow
```

`bootstrap.sh`(`web/deploy/ssh/bootstrap.sh`)가 다음을 수행한다:

1. 디렉터리 생성 (`/opt/licensehub/{bin,data,frontend}`)
2. **swap 2G 추가** (소형 인스턴스에서 `dnf`/`apt` OOM 방지 — 활성 swap이 없을 때만)
3. Caddy 설치 (apt/dnf 실패 시 정적 바이너리 다운로드, 3회 재시도)
4. `licensehub-web.service`(systemd) 등록
5. `/opt/licensehub/.env` 작성 (시크릿 주입)
6. Caddyfile 작성 (`PROXY_DOMAIN → 127.0.0.1:8080`)
7. **방화벽 허용** — firewalld / ufw / **iptables** 모두 처리 (80, 443)

**검증:** 프로비저닝 완료 후

```sh
curl -sS -o /dev/null -w "%{http_code}\n" http://<공인IP>/   # 308(→https) 기대
```

> iptables가 기본 REJECT 정책이면 80/443이 외부에서 닫힌다.
> bootstrap.sh가 `iptables -I INPUT -p tcp --dport 80/443 -j ACCEPT`를 넣는다.

### 2-2. 백엔드 배포

```
Actions 탭 → Deploy Backend to Oracle → Run workflow
```

동작: `cross`로 musl 정적 바이너리 빌드 → scp → `systemctl restart`
→ `curl http://127.0.0.1:8080/api/public-key` 헬스체크.

**검증 (외부 HTTPS):**

```sh
curl -sS https://<공인IP>.sslip.io/api/public-key   # HTTP 200 + JSON
```

### 2-3. 프런트엔드 (GitHub Pages) 재배포

`pages.yml`은 `main` **push 시에만** 동작한다. `workflow_dispatch`가 없으므로
`API_BASE_URL`을 바꿨다면 새 값으로 재빌드가 필요하고, 방법은 둘 중 하나:

- `main`에 아무 커밋(빈 커밋 포함)을 push → 자동 재배포
- `pages.yml`에 `workflow_dispatch` 추가 → Actions 탭에서 수동 재배포

**검증:** `https://hyunu.github.io/license_hub/` 에서 로그인 동작 확인.

---

### 2-4. MCP 서버(사이드카) 배포

AI 에이전트가 LicenseHub를 도구로 사용하기 위한 MCP 서버다. 백엔드와 같은 VM에 두고
Caddy로 `/mcp`만 노출한다. (현재 GitHub Actions 자동 배포 대상이 아니므로 수동 배포)

전제: VM에 **Node 18+**가 있어야 한다(`node -v`).

```sh
# 1) 코드 배치
sudo mkdir -p /opt/licensehub/tools
sudo cp -r tools/mcp /opt/licensehub/tools/mcp

# 2) 서비스 계정/환경파일
sudo useradd --system --no-create-home --shell /usr/sbin/nologin licensehub || true
sudo install -d -o root -g licensehub -m 750 /etc/licensehub
sudo cp /opt/licensehub/tools/mcp/deploy/mcp.env.example /etc/licensehub/mcp.env
sudo editor /etc/licensehub/mcp.env          # LICENSEHUB_URL 등

# 3) systemd
sudo cp /opt/licensehub/tools/mcp/deploy/licensehub-mcp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now licensehub-mcp
curl -sS http://127.0.0.1:8090/healthz
```

Caddy는 기존 사이트 블록에 `/mcp` 라우트를 추가한다
(`tools/mcp/deploy/Caddyfile.example`).

```caddyfile
licensehub.example.com {
    handle /mcp* {
        reverse_proxy 127.0.0.1:8090
    }
    handle {
        reverse_proxy 127.0.0.1:8080
    }
}
```

```sh
sudo systemctl reload caddy
```

**검증 (외부 HTTPS):**

```sh
curl -sS https://<도메인>/mcp -X POST \
  -H 'authorization: Bearer <token>' \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

**보안:**

- `MCP_REQUIRE_AUTH=1`을 유지한다.
- 토큰은 클라이언트가 `Authorization: Bearer`로 전달하고, 서버에 관리자 토큰을 고정하지 않는다.
- `/mcp` 외 경로는 외부에 노출하지 않는다(`MCP_HOST=127.0.0.1`).
- `generate_keypair` 출력(개인키)을 서버 로그에 남기지 않는다.

배포 워크플로 `deploy-mcp.yml`은 GitHub 시크릿 `MCP_ACCESS_KEY`,
`LICENSEHUB_ADMIN_USER`, `LICENSEHUB_ADMIN_PASSWORD`를 `/etc/licensehub/mcp.env`(640)에 주입한다.
클라이언트는 `MCP_ACCESS_KEY`만 사용하고, 백엔드 호출은 서버가 관리자 계정으로 로그인해 수행한다.

---

## 3. 자주 겪는 장애 (원인·대응)

| 증상 | 원인 | 대응 |
|---|---|---|
| scp `ssh: handshake failed: connection reset by peer` / SSH 배너 없음 | VM 과부하·OOM, sshd 미응답 | swap 추가(bootstrap이 자동), VM 재부팅 |
| `unable to authenticate, attempted methods [none]` | GitHub 개인키 ↔ VM 공개키 불일치, 사용자명 오류, 패스프레이즈 키 | 1-4 참고, 키쌍·사용자명 점검 |
| 배너 없음인데 ping은 정상 | 인스턴스가 죽거나 OOM 스래싱 | OCI에서 restart, 스펙 확인 |
| `dnf`/`apt` 가 `Killed` (OOM) | 인스턴스 RAM 부족 (소형 ARM 등) | `bootstrap.sh`가 swap 2G 자동 추가 |
| Caddy 정적 다운로드 404 | 인스턴스 네트워크/GitHub 접근 제한 | apt/dnf 우선, 다운로드는 3회 재시도 |
| `tlsv1 alert internal error` (443 연결은 됨) | **PROXY_DOMAIN이 순수 IP** — 인증서 발급 불가 | `IP.sslip.io` 형태로 수정 후 재프로비저닝 |
| 80/443 외부에서 `closed` | 호스트 iptables 기본 REJECT | bootstrap이 80/443 ACCEPT 삽입 |
| 프런트엔드가 옛 API 주소 사용 | `API_BASE_URL` 변경 후 프런트 재배포 안 함 | 2-3 재배포 |
| 로그에서 도메인이 `***`로 마스킹 | GitHub가 시크릿 값을 자동 마스킹 | 서버에서 `awk`/base64로 우회해 검증 |

---

## 4. 최종 상태 확인 명령 (통합 검증)

```sh
# 1) 프런트엔드
curl -sS -o /dev/null -w "pages: %{http_code}\n" https://hyunu.github.io/license_hub/

# 2) 백엔드 HTTPS (Caddy 인증서 확인 포함)
curl -sS https://<공인IP>.sslip.io/api/public-key

# 3) 프런트가 바라보는 API 주소 확인 (빌드 산출물)
#    dist/assets/*.js 에서 VITE_API_BASE_URL 값이 새 주소인지 확인
```

---

## 5. 참고

- `web/deploy/ssh/README.md` — SSH 자동 배포 상세
- `web/deploy/ssh/bootstrap.sh` — 프로비저닝 스크립트 (swap·Caddy·방화벽 포함)
- `web/deploy/ubuntu/` — systemd unit, env 예제
- `.github/workflows/*.yml` — 배포·CI 워크플로우
- 인스턴스 기본 계정: Ubuntu `ubuntu` / Oracle Linux `opc`