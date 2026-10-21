# LicenseHub MCP 서버

에이전트가 LicenseHub를 **도구 호출**로 직접 사용하게 해 주는 MCP(Model Context Protocol) 서버다.
외부 의존성이 없고 Node 18+ 표준 라이브러리만 사용한다(`npm install` 불필요).

- 진입점: `tools/mcp/licensehub-mcp.js`
- 전송: stdio (newline-delimited JSON-RPC)
- 표준: MCP `initialize` / `tools/list` / `tools/call`

## 도구

| 도구(원래 이름) | OpenCode 노출 이름 | 설명 |
|---|---|---|
| `generate_keypair` | `licensehub_generate_keypair` | App 키쌍(Ed25519) 로컬 생성. 개인키는 네트워크로 나가지 않음 |
| `public_key` | `licensehub_public_key` | 발급 서버 공개키 조회 |
| `list_licenses` | `licensehub_list_licenses` | 라이선스 목록 |
| `create_license` | `licensehub_create_license` | 라이선스 생성 (공개키 생략 시 서버가 키쌍 생성) |
| `issue_license` | `licensehub_issue_license` | 인증서 발급 + 암호화 라이선스 생성 |
| `download_license` | `licensehub_download_license` | 암호화 라이선스 조회/파일 저장 |
| `verify_license` | `licensehub_verify_license` | 서버 기준 라이선스 상태 확인(승인/거부) |

> `verify_license`는 **LicenseHub 서버 기준 상태 확인**이다.
> 오프라인 암호문 검증(복호화·서명·자격 대조)은 응용 프로그램이 `core` C ABI로 수행한다.

## 환경변수

| 변수 | 필수 | 설명 |
|---|---|---|
| `LICENSEHUB_URL` | ✅ | 예: `https://licensehub.example.com` |
| `LICENSEHUB_TOKEN` | 발급/조회 시 | 로그인으로 받은 Bearer 토큰 |
| `LICENSEHUB_VERIFY_KEY` | 선택 | L2 검증 키. 기본값은 `core/src/lib.rs`의 `VERIFY_API_KEY`와 동일 |

## 연결 절차 (OpenCode)

### 1) 백엔드 주소와 토큰 준비

```sh
export LICENSEHUB_URL=https://<백엔드주소>     # 예: https://168.110.123.142.sslip.io
export LICENSEHUB_USER=admin
export LICENSEHUB_PASS='********'
export LICENSEHUB_TOKEN=$(tools/licensehub.sh login | jq -r .token)
```

토큰만 직접 받으려면:

```sh
export LICENSEHUB_TOKEN=$(curl -sS -X POST "$LICENSEHUB_URL/api/auth/login" \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"********"}' | jq -r .token)
```

### 2) MCP 서버 등록 (전역)

모든 프로젝트에서 쓰려면 `~/.config/opencode/opencode.jsonc`에 추가한다.
전역 설정에서는 작업 디렉터리가 LicenseHub 저장소가 아니므로 **절대경로**를 써야 한다.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "licensehub": {
        "type": "local",
        "command": ["node", "/ABSOLUTE/PATH/license_hub/tools/mcp/licensehub-mcp.js"],
        "environment": {
          "LICENSEHUB_URL": "{env:LICENSEHUB_URL}",
          "LICENSEHUB_TOKEN": "{env:LICENSEHUB_TOKEN}"
        }
      }
    }
  }
}
```

CLI로 등록:

```sh
opencode mcp add licensehub --global \
  --env LICENSEHUB_URL="$LICENSEHUB_URL" \
  --env 'LICENSEHUB_TOKEN={env:LICENSEHUB_TOKEN}' \
  -- node /ABSOLUTE/PATH/license_hub/tools/mcp/licensehub-mcp.js
```

### 3) OpenCode 재시작 및 확인

환경변수를 물려받도록 **같은 셸에서** OpenCode를 다시 실행한 뒤:

```sh
opencode mcp list          # ✓ licensehub connected
```

에이전트에게 `licensehub_public_key`를 호출하게 해서 JSON이 오면 URL/토큰까지 정상이다.
`licensehub_generate_keypair`는 네트워크가 필요 없어 URL 없이도 동작한다.

### 4) 동작 확인

```sh
curl -sS "$LICENSEHUB_URL/api/public-key" | jq .
```

## 문제 해결

| 증상 | 원인 / 해결 |
|---|---|
| `✗ licensehub failed` | `node` 또는 스크립트 경로 오류. 절대경로와 `node --check` 확인 |
| `LICENSEHUB_URL 이 설정되지 않았습니다` | OpenCode가 env를 못 물려받음. 같은 셸에서 export 후 재시작 |
| `LICENSEHUB_TOKEN 이 설정되지 않았습니다` | 토큰 미주입. `{env:LICENSEHUB_TOKEN}` 또는 export 확인 |
| `401: unauthorized` | 토큰 만료/오타. 다시 로그인 |
| 데스크톱 앱에서 env 미적용 | 셸 프로필(`~/.zshrc`)에 export 하거나, 설정 파일에 URL을 직접 기입(토큰은 env 유지) |

## OpenCode V2 설정

프로젝트(또는 전역) `opencode.jsonc`의 `mcp.servers`에 추가한다.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "licensehub": {
        "type": "local",
        "command": ["node", "tools/mcp/licensehub-mcp.js"],
        "environment": {
          "LICENSEHUB_URL": "https://licensehub.example.com",
          "LICENSEHUB_TOKEN": "{env:LICENSEHUB_TOKEN}"
        }
      }
    }
  }
}
```

- `cwd`는 기본적으로 워크스페이스이므로 `command`의 상대 경로가 그대로 동작한다.
- 비밀값은 파일에 쓰지 말고 `{env:NAME}`으로 주입한다.
- 연결 확인: `opencode mcp list`

CLI로 추가하려면(로컬 서버는 `--` 뒤에 명령):

```sh
opencode mcp add licensehub \
  --env LICENSEHUB_URL=https://licensehub.example.com \
  --env LICENSEHUB_TOKEN="$LICENSEHUB_TOKEN" \
  -- node tools/mcp/licensehub-mcp.js
```

## 다른 MCP 클라이언트 (Cursor, Claude Desktop 등)

이 서버는 **OpenCode 전용이 아니다.** 표준 MCP stdio 서버이므로 MCP를 지원하는
클라이언트(Cursor, Claude Desktop, VS Code/Copilot, Windsurf, Cline 등)에서 모두 쓸 수 있다.
차이는 **설정 파일 위치와 형식**뿐이다.

### Cursor

Cursor는 `mcpServers` 형식을 쓴다.

- 프로젝트: `.cursor/mcp.json`
- 전역: `~/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "licensehub": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/license_hub/tools/mcp/licensehub-mcp.js"],
      "env": {
        "LICENSEHUB_URL": "https://licensehub.example.com",
        "LICENSEHUB_TOKEN": "<token>"
      }
    }
  }
}
```

- Cursor Settings → MCP 에서 서버를 켜고(초록 점) 도구가 노출되는지 확인한다.
- `node`를 못 찾으면 `command`에 절대경로(`which node` 결과)를 넣는다.
- Cursor는 셸 환경변수를 물려받지 않을 수 있으므로, 위처럼 `env`에 값을 직접 넣는 편이 확실하다.
  (비밀값이 들어가므로 이 파일을 저장소에 커밋하지 않는다.)
- 일부 클라이언트는 `${env:NAME}` 보간을 지원하지만 동작이 다를 수 있어, 확실하지 않으면 `env`에 직접 쓴다.

### Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "licensehub": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/license_hub/tools/mcp/licensehub-mcp.js"],
      "env": {
        "LICENSEHUB_URL": "https://licensehub.example.com",
        "LICENSEHUB_TOKEN": "<token>"
      }
    }
  }
}
```

### 공통 주의

- 서버 실행에는 **Node 18+**가 필요하다(`fetch` 사용).
- **전역/다른 프로젝트**에서 쓰려면 `args`에 반드시 **절대경로**를 넣는다.
- 클라이언트를 재시작해야 서버가 새로 뜬다.
- 도구 이름은 클라이언트마다 표기만 다르고(`licensehub_create_license` 등) 동작은 같다.


## 원격 호스팅 (Streamable HTTP)

현재 백엔드 서버(VPS)에서 MCP를 함께 제공하는 권장 구성이다.
Node 사이드카를 `127.0.0.1:8090`에 두고 Caddy가 `/mcp`로 노출한다.

```text
인터넷 ──https──▶ Caddy ──/mcp──▶ 127.0.0.1:8090  MCP HTTP
                        └──/*───▶ 127.0.0.1:8080  LicenseHub 백엔드
```

### 실행

```sh
cd tools/mcp
LICENSEHUB_URL=https://licensehub.example.com \
MCP_PORT=8090 \
node licensehub-mcp.js --http
```

### HTTP 모드 환경변수

| 변수 | 기본 | 설명 |
|---|---|---|
| `MCP_HOST` | `127.0.0.1` | 바인딩 주소(외부 직접 노출 금지) |
| `MCP_PORT` | `8090` | 포트 |
| `MCP_PATH` | `/mcp` | MCP 엔드포인트 경로 |
| `MCP_REQUIRE_AUTH` | `1` | `0`이면 인증 생략(로컬 테스트 전용) |
| `MCP_ACCESS_KEY` | — | 설정 시 클라이언트는 이 키로만 접근. 백엔드 호출은 서버 측 관리자 자격증명으로 로그인 |
| `LICENSEHUB_ADMIN_USER` | — | `MCP_ACCESS_KEY` 모드의 백엔드 로그인 계정 |
| `LICENSEHUB_ADMIN_PASSWORD` | — | 위 계정의 비밀번호 |

### 인증 모드

- **패스스루**(기본): `MCP_ACCESS_KEY`가 없으면 클라이언트의
  `Authorization: Bearer <backend token>`을 그대로 백엔드에 전달한다.
- **전용 액세스 키**(권장, 원격): `MCP_ACCESS_KEY`가 있으면 클라이언트는 이 키로만 접근하고,
  서버는 `LICENSEHUB_ADMIN_USER/PASSWORD`로 백엔드에 로그인해 토큰을 발급·캐시한다.
  관리자 비밀번호는 서버 밖으로 나가지 않는다.

### 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/mcp` | JSON-RPC (initialize / tools/list / tools/call) |
| `GET` | `/healthz` | 헬스체크 |
| `GET`·`DELETE` | `/mcp` | 405 (SSE 미지원) |

### 인증 (Bearer 패스스루)

- 요청의 `Authorization: Bearer <token>`을 **그대로 LicenseHub 백엔드 호출에 전달**한다.
- 서버에 관리자 토큰을 고정하지 않는다.
- 토큰이 없으면 `401` + `WWW-Authenticate: Bearer`.

### 배포 파일

- `tools/mcp/deploy/licensehub-mcp.service` — systemd 유닛
- `tools/mcp/deploy/Caddyfile.example` — `/mcp` 라우팅
- `tools/mcp/deploy/mcp.env.example` — 환경변수 예시

설치 예:

```sh
sudo cp -r tools/mcp /opt/licensehub/tools/mcp
sudo useradd --system --no-create-home --shell /usr/sbin/nologin licensehub || true
sudo install -d -o root -g licensehub -m 750 /etc/licensehub
sudo cp tools/mcp/deploy/mcp.env.example /etc/licensehub/mcp.env
sudo editor /etc/licensehub/mcp.env
sudo cp tools/mcp/deploy/licensehub-mcp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now licensehub-mcp
curl -sS http://127.0.0.1:8090/healthz
```

Caddy는 `Caddyfile.example`의 `handle /mcp*` 블록을 기존 사이트에 추가한 뒤
`sudo systemctl reload caddy`.

### 원격 클라이언트 설정

OpenCode:

```jsonc
{
  "mcp": {
    "servers": {
      "licensehub": {
        "type": "remote",
        "url": "https://licensehub.example.com/mcp",
        "headers": { "Authorization": "Bearer {env:LICENSEHUB_TOKEN}" }
      }
    }
  }
}
```

Cursor (`.cursor/mcp.json` 또는 `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "licensehub": {
      "url": "https://licensehub.example.com/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

### 원격 모드 주의

- `download_license`의 `save_path`는 **원격에서 비활성**이다(서버 파일시스템에 쓰지 않도록).
  반환된 JSON을 클라이언트에서 저장한다.
- `generate_keypair`는 서버에서 키를 만들어 네트워크로 반환하므로, 원격에서는
  **클라이언트 측 생성**을 권장한다(예: `openssl genpkey -algorithm ED25519`).
- SSE 스트림은 제공하지 않는다(스펙상 405 허용). 세션 ID도 발급하지 않는 무상태 서버다.

## 직접 실행·확인

```sh
export LICENSEHUB_URL=https://licensehub.example.com
export LICENSEHUB_TOKEN=<token>

printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
| node tools/mcp/licensehub-mcp.js
```

## 에이전트 사용 예(개념)

1. `generate_keypair` → `public_key_pem`, `private_key_hex`(32B)
2. `create_license` (`application_public_key` = 위 PEM, level/만료/소유자 지정)
3. `issue_license` (숫자 `id`)
4. `download_license` (`save_path`로 라이선스 파일 저장)
5. 응용 프로그램에서 `lh_decrypt_verify_trusted_license(..., private_key_raw_32B, ...)`로 검증

## 보안

- `private_key_pem`/`private_key_hex`는 **도구 출력에 포함**된다. 에이전트 로그·대화에 남기지 말고
  파일/OS 보호 저장소에만 저장한다.
- `LICENSEHUB_TOKEN`은 환경변수로만 주입하고 저장소에 커밋하지 않는다.
- `LH_Pri`(발급 서버 서명 개인키)는 이 서버가 다루지 않는다.
