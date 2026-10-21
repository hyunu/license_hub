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

## 다른 MCP 클라이언트

Claude Desktop 등 `mcpServers` 형식을 쓰는 클라이언트:

```json
{
  "mcpServers": {
    "licensehub": {
      "command": "node",
      "args": ["/절대경로/tools/mcp/licensehub-mcp.js"],
      "env": {
        "LICENSEHUB_URL": "https://licensehub.example.com",
        "LICENSEHUB_TOKEN": "<token>"
      }
    }
  }
}
```

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
