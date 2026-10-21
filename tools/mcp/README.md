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
