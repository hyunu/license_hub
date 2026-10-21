# LicenseHub 통합 가이드 (AI·개발자용)

이 문서는 **응용 프로그램에 LicenseHub 라이선스 검증을 붙이는 전체 절차**를 다룬다.
AI 에이전트용 요약은 `AGENTS.md`에 있고, 이 문서는 실행 가능한 상세 예제를 제공한다.

- 대상: 응용 프로그램을 만드는 개발자 또는 코딩 에이전트
- 전제: LicenseHub 백엔드에 접근 가능하고, 라이선스를 발급할 권한(관리자 토큰)이 있음
- 관련 파일: `AGENTS.md`, `docs/openapi.yaml`, `tools/licensehub.sh`, `core/include/licensehub_core.h`

---

## 0. 큰 그림

```
[LicenseHub 발급 서버]                         [응용 프로그램]
  라이선스 생성 (P)                              App_Pri 보관
       │                                              │
  LH_Pri 로 서명                                     │
       │                                              │
  App_Pub 로 암호화  ── 라이선스 파일(.lic.json) ──▶  복호화 (App_Pri)
                                                      서명 검증 (내장 LH_Pub)
                                                      자격 대조 (context)
                                                           │
                                                    통과할 때만 핵심 로직 활성화
```

- 발급(LicenseHub)과 검증(응용 프로그램)은 분리되어 있다.
- 응용 프로그램은 **발급 서버에 접속하지 않아도** L1(오프라인) 검증이 가능하다.
- L2(온라인)는 검증 시 서버 상태를 추가로 확인하며, 서버 미응답 시 비활성이다.

## 1. 준비물

- `LICENSEHUB_URL`: 백엔드 주소 (예: `https://licensehub.example.com`)
- 관리자 자격 증명 (또는 로그인으로 받은 Bearer 토큰)
- 응용 프로그램에 포함할 **LicenseGuard 검증 모듈** (`bindings/` 또는 `core/dist/`)

`tools/licensehub.sh`를 쓰면 아래 HTTP 호출을 명령으로 실행할 수 있다.
의존성은 `curl`, `jq`다.

```sh
export LICENSEHUB_URL=https://licensehub.example.com
export LICENSEHUB_USER=admin
export LICENSEHUB_PASS='********'
TOKEN=$(tools/licensehub.sh login | jq -r .token)
export LICENSEHUB_TOKEN=$TOKEN
```

> 코딩 에이전트가 발급 절차를 **도구 호출**로 수행하려면 MCP 서버를 연결한다.
> §10 "MCP로 연결하기"를 참고한다. 발급 흐름과 키 형식 규칙은 HTTP와 동일하다.

## 2. 발급 절차 (HTTP)

### 2.1 로그인

```sh
curl -sS -X POST "$LICENSEHUB_URL/api/auth/login" \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"********"}'
```

응답:

```json
{ "token": "<bearer>", "user": { "id": 1, "username": "admin", "role": "admin" } }
```

이후 요청에는 `Authorization: Bearer <bearer>`를 붙인다.
오류는 `{"error":"..."}` 형태이며, 상태 코드는 400/401/404/409/500이다.

### 2.2 App 키쌍 마련

두 가지 방법이 있다.

**(A) 서버가 생성 (권장·자동)**
`application_public_key`를 **생략**한다.
LicenseHub가 Ed25519 키쌍을 만들고, 생성 응답에 `application_private_key`(PKCS8 PEM)를
**한 번만** 넣어 준다.

**(B) 로컬 생성 (수동)**
```sh
cargo run -p licensehub-core --example gen_app_key
# AK1_PRIVATE_HEX=...   (32바이트 seed = App_Pri)
# AK2_PUBLIC_PEM:       (SPKI PEM = App_Pub)
```
`AK2_PUBLIC_PEM`을 `application_public_key`로 제출한다.

> 어느 방법이든 **App_Pri는 그 앱만 보관**한다. 서버는 저장하지 않는다.

### 2.3 라이선스 생성

```sh
curl -sS -X POST "$LICENSEHUB_URL/api/licenses" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "product": "my-app",
    "version": "1.0.0",
    "level": 1,
    "holder": "ACME",
    "expires_at": "2027-01-01T00:00:00Z",
    "target_language": "c"
  }'
```

- `level=1`(오프라인): `verification_url`을 넣지 않는다.
- `level=2`(온라인): `verification_url`이 필수이고 `http(s)://`로 시작해야 한다.
- `application_public_key`를 생략하면 응답에 `application_private_key`가 포함된다.
- 응답의 숫자 `id`를 기억한다(문자열 `license_id`와 다르다).

응답 예:

```json
{
  "id": 7,
  "license_id": "LIC-XXXX",
  "product": "my-app",
  "version": "1.0.0",
  "level": 1,
  "status": "active",
  "expires_at": "2027-01-01T00:00:00Z",
  "application_private_key": "-----BEGIN PRIVATE KEY-----\n..."
}
```

### 2.4 인증서 발급 + 라이선스 생성

```sh
curl -sS -X POST "$LICENSEHUB_URL/api/licenses/7/issue" \
  -H "Authorization: Bearer $TOKEN"
```

응답:

```json
{
  "certificate": { "...": "..." },
  "certificate_id": "CERT-...",
  "encrypted_license": { "...": "..." },
  "application_id": "...",
  "target_language": "c",
  "application_key_generated": true,
  "application_private_key": "-----BEGIN PRIVATE KEY-----\n..."
}
```

- `encrypted_license`가 응용 프로그램에 배포할 **라이선스 파일 본문**이다.
- `application_private_key`가 있으면 지금 안전하게 저장한다(다시 나오지 않는다).
- `application_key_generated`는 이 발급 시점에 키를 새로 만들었는지를 뜻한다.

### 2.5 라이선스 파일 내려받기

```sh
# JSON 으로
curl -sS "$LICENSEHUB_URL/api/licenses/7/license" -H "Authorization: Bearer $TOKEN"

# 파일로
curl -sS "$LICENSEHUB_URL/api/licenses/7/license/download" \
  -H "Authorization: Bearer $TOKEN" -o license.lic.json
```

## 3. 키 형식과 변환 (흔한 실수)

| 항목 | HTTP API | C ABI |
|---|---|---|
| App 공개키 (`App_Pub`) | SPKI **PEM** | **raw 32 bytes** |
| App 개인키 (`App_Pri`) | PKCS8 **PEM** | **raw 32 bytes** (seed) |
| LH 서명 공개키 (`LH_Pub`) | PEM / hex | 검증 모듈에 내장(LK2) |

- C ABI(`lh_decrypt_verify_trusted_license`)는 **PEM을 받지 않는다.** 정확히 32바이트를 요구한다.
- PEM ↔ raw 변환은 다음처럼 한다.

```python
# pip install cryptography
from cryptography.hazmat.primitives import serialization

priv = serialization.load_pem_private_key(open("app_pri.pem", "rb").read(), password=None)
seed = priv.private_bytes(
    serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption()
)  # 32 bytes — C ABI 의 z_private_key

pub_pem = priv.public_key().public_bytes(
    serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
).decode()  # 발급 요청의 application_public_key

raw_pub = priv.public_key().public_bytes(
    serialization.Encoding.Raw, serialization.PublicFormat.Raw
)  # 32 bytes — lh_application_id / lh_verify_challenge 용
```

CLI로 변환하려면:

```sh
# PKCS8 PEM -> raw 32바이트 seed
openssl pkey -in app_pri.pem -outform DER | tail -c 32 > app_pri.raw
# SPKI PEM -> raw 32바이트 공개키
openssl pkey -pubin -in app_pub.pem -outform DER | tail -c 32 > app_pub.raw
```

## 4. 응용 프로그램 통합 (C ABI)

```c
#include <stdint.h>
#include "licensehub_core.h"

int activate(const uint8_t *lic, size_t lic_len,
             const uint8_t *app_pri,            /* raw 32 bytes */
             const char *context_json)
{
    uint32_t code = 0;
    int32_t rc = lh_decrypt_verify_trusted_license(
        lic, lic_len,
        app_pri, 32,
        (const uint8_t *)context_json, strlen(context_json),
        &code);

    if (rc == 0 && code == LH_VALID) {
        return 1;   /* 핵심 로직 활성화 */
    }
    return 0;       /* 비활성 유지 (fail-closed) */
}
```

- L2(온라인)는 `lh_decrypt_verify_trusted_license_online(...)`을 쓴다.
  이 함수는 인증서에 서명된 `server.verification_url`로 상태를 조회하고,
  서버에 닿지 않거나 `approved`가 아니면 실패한다.
- 컨텍스트는 **JSON**으로 넘긴다. 사용 가능한 필드는 다음과 같다.

| 필드 | 의미 |
|---|---|
| `now` | 검증 시각 (RFC 3339 UTC). 운영에서는 현재 시각을 넣는다. |
| `product` | 인증서 제품과 일치해야 함 |
| `version` | 인증서 버전과 일치해야 함 |
| `product_id` | 인증서 `metadata["product_id"]`와 일치해야 함 |
| `executable_name` | 인증서 `metadata["executable_name"]`과 일치해야 함 |
| `application_id` | 응용 공개키에서 파생한 애플리케이션 식별자 |
| `target_language` | 인증서 Target Language와 일치해야 함 |
| `server_status` | `"approved"` 또는 `"rejected"` (L2) |
| `blacklisted` / `revoked` | 호출자가 채우는 상태 |
| `max_chain_depth` | 중첩 인증서 검증 최대 깊이 (기본 3) |

예(L1):

```json
{"now":"2026-06-01T00:00:00Z","product":"my-app","version":"1.0.0"}
```

예(L2):

```json
{"now":"2026-06-01T00:00:00Z","server_status":"approved"}
```

## 5. 검증 코드

`result_code`가 `LH_VALID`(0)일 때만 성공이다. 그 외 값은 모두 실패로 취급한다.

| 코드 | 의미 |
|---|---|
| `LH_VALID` | 유효 |
| `LH_INVALID_FORMAT` | 형식 오류 |
| `LH_UNSUPPORTED_SCHEMA` | 지원하지 않는 스키마 |
| `LH_UNSUPPORTED_ALGORITHM` | 지원하지 않는 알고리즘 |
| 그 외 | 서명/만료/자격/체인/블랙리스트 등 실패 |

## 6. L2 온라인 검증 (서버 간)

L2 인증서는 런타임에 라이선스 상태를 확인한다.
`lh_decrypt_verify_trusted_license_online`이 내부에서 아래 호출을 수행한다.

```text
POST {verification_url}
헤더: x-licensehub-key: <core 에 정의된 고정 키>
본문: {"license_id":"LIC-XXXX"}
응답: {"license_id":"LIC-XXXX","status":"approved"} 또는 {"status":"rejected","reason":"..."}
```

- 응용 프로그램이 이 호출을 직접 구현할 필요는 없다.
- 서버가 꺼져 있거나 응답이 없으면 **비활성**이다(연결 실패 시 비활성).

## 7. 보안 체크리스트

- [ ] `LH_Pri`는 발급 서버에만 있고, 클라이언트·저장소·로그에 없다
- [ ] `App_Pri`는 파일/OS 보호 저장소에 있고, 로그·커밋·채팅에 없다
- [ ] 라이선스 파일은 암호문 그대로 배포했다
- [ ] 검증 실패 시 핵심 로직이 켜지지 않는다
- [ ] PEM ↔ raw 32바이트 변환이 정확하다
- [ ] L2에서 서버 미응답 시 비활성이다
- [ ] 검증 결과를 상수로 하드코딩하지 않았다

## 8. 자주 막히는 지점

| 증상 | 원인 / 해결 |
|---|---|
| C ABI가 `-1` 반환 | `app_pri`가 32바이트가 아님(PEM을 그대로 넘김). raw seed로 변환 |
| 발급 응답에 `application_private_key` 없음 | `application_public_key`를 직접 제공했거나 이미 키가 있음 |
| L2가 항상 실패 | `verification_url` 누락, 서버 미기동, `server_status` 미설정 |
| `level 2 requires verification_url` | L2인데 URL을 안 넣음 |
| `level 1 must not set verification_url` | L1인데 URL을 넣음 |
| 인증서 발급 400 | 라이선스 상태가 `active`가 아님, 또는 공개키 PEM 형식 오류 |

## 9. 참고

- `AGENTS.md` — 에이전트용 요약 절차
- `docs/openapi.yaml` — API 스펙
- `core/include/licensehub_core.h` — C ABI 전체 시그니처와 검증 코드
- `bindings/README.md` — 검증 모듈 바인딩
- `tools/mcp/README.md` — MCP 서버 상세(클라이언트별 설정·원격 호스팅·문제 해결)
- `docs/ARCHITECTURE.md`, `docs/CORE_DESIGN.md` — 설계 배경

## 10. MCP로 연결하기 (에이전트)

HTTP API를 직접 호출하는 대신, 에이전트가 **MCP 도구 호출**로 라이선스를 발급·조회할 수 있다.
`tools/mcp/licensehub-mcp.js`는 표준 MCP 서버이므로 OpenCode, Cursor, Claude Desktop,
VS Code 등 MCP를 지원하는 모든 클라이언트에서 동작한다.

| 방식 | 적합한 경우 |
|---|---|
| HTTP(`tools/licensehub.sh`) | 스크립트·자동화. 토큰과 요청을 직접 제어 |
| MCP(stdio / 원격 HTTP) | 코딩 에이전트가 발급·조회·상태 확인을 도구로 수행 |

> MCP 서버는 **같은 절차를 다른 인터페이스로 제공할 뿐**이다.
> 발급 흐름(키쌍 → 생성 → 발급 → 내려받기)과 키 형식 규칙은 §2·§3과 동일하다.
> 서버 구현·배포 상세는 `tools/mcp/README.md`를 참고한다.

### 10.1 준비물

§1의 `LICENSEHUB_URL`과 `LICENSEHUB_TOKEN`을 그대로 쓴다.

```sh
export LICENSEHUB_URL=https://<백엔드주소>
export LICENSEHUB_TOKEN=$(tools/licensehub.sh login | jq -r .token)
```

- MCP 서버 실행에 **Node 18+**가 필요하다(`fetch` 사용).
- 원격 모드에서는 서버가 관리자 자격증명으로 백엔드에 로그인하므로, 클라이언트에는
  토큰 대신 **액세스 키**만 넣는다(§10.4).

### 10.2 도구 목록

| 도구(원래 이름) | OpenCode 노출 이름 | 설명 |
|---|---|---|
| `generate_keypair` | `licensehub_generate_keypair` | App 키쌍(Ed25519) 로컬 생성. 개인키는 네트워크로 나가지 않음 |
| `public_key` | `licensehub_public_key` | 발급 서버 공개키 조회 |
| `list_licenses` | `licensehub_list_licenses` | 라이선스 목록 |
| `create_license` | `licensehub_create_license` | 라이선스 생성 (공개키 생략 시 서버가 키쌍 생성) |
| `issue_license` | `licensehub_issue_license` | 인증서 발급 + 암호화 라이선스 생성 |
| `download_license` | `licensehub_download_license` | 암호화 라이선스 조회/파일 저장 |
| `verify_license` | `licensehub_verify_license` | 서버 기준 라이선스 상태 확인(승인/거부) |

- `verify_license`는 **LicenseHub 서버 기준 상태 확인**이다.
  오프라인 암호문 검증(복호화·서명·자격 대조)은 응용 프로그램이 `core` C ABI로 수행한다.
- 클라이언트마다 표기만 다르고(`licensehub_create_license` 등) 동작은 같다.

### 10.3 로컬(stdio) 연결

**OpenCode** — 프로젝트 `opencode.jsonc` 또는 전역 `~/.config/opencode/opencode.jsonc`의 `mcp.servers`:

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

- `cwd`는 워크스페이스가 되므로 프로젝트 등록이면 `command`의 상대 경로가 그대로 동작한다.
- **전역/다른 프로젝트**에서는 `command`/`args`에 **절대경로**를 넣어야 한다.
- 비밀값은 파일에 쓰지 말고 `{env:NAME}`으로 주입한다.

CLI로 등록:

```sh
opencode mcp add licensehub --global \
  --env LICENSEHUB_URL="$LICENSEHUB_URL" \
  --env 'LICENSEHUB_TOKEN={env:LICENSEHUB_TOKEN}' \
  -- node /ABSOLUTE/PATH/license_hub/tools/mcp/licensehub-mcp.js
```

**Cursor** — `.cursor/mcp.json` 또는 `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "licensehub": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/license_hub/tools/mcp/licensehub-mcp.js"],
      "env": {
        "LICENSEHUB_URL": "https://licensehub.example.com",
        "LICENSEHUB_TOKEN": "{env:LICENSEHUB_TOKEN}"
      }
    }
  }
}
```

**Claude Desktop** — `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "licensehub": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/license_hub/tools/mcp/licensehub-mcp.js"],
      "env": {
        "LICENSEHUB_URL": "https://licensehub.example.com",
        "LICENSEHUB_TOKEN": "{env:LICENSEHUB_TOKEN}"
      }
    }
  }
}
```

- Cursor·Claude Desktop는 셸 환경변수를 물려받지 않을 수 있어 `env`에 값을 직접 넣는 편이 확실하다.
  (비밀값이 들어가므로 이 파일은 저장소에 커밋하지 않는다.)
- `node`를 못 찾으면 `command`에 절대경로(`which node` 결과)를 넣는다.
- 클라이언트를 재시작해야 서버가 새로 뜬다.

### 10.4 원격(Streamable HTTP) 연결

백엔드와 같은 VM에 MCP를 사이드카로 두고 Caddy가 `/mcp`로 노출하는 구성이다.

```text
인터넷 ──https──▶ Caddy ──/mcp──▶ 127.0.0.1:8090  MCP HTTP
                        └──/*───▶ 127.0.0.1:8080  LicenseHub 백엔드
```

서버 측 실행:

```sh
cd tools/mcp
LICENSEHUB_URL=https://licensehub.example.com \
MCP_PORT=8090 \
node licensehub-mcp.js --http
```

| 변수 | 기본 | 설명 |
|---|---|---|
| `MCP_HOST` | `127.0.0.1` | 바인딩 주소(외부 직접 노출 금지) |
| `MCP_PORT` | `8090` | 포트 |
| `MCP_PATH` | `/mcp` | MCP 엔드포인트 경로 |
| `MCP_REQUIRE_AUTH` | `1` | `0`이면 인증 생략(로컬 테스트 전용) |
| `MCP_ACCESS_KEY` | — | 설정 시 클라이언트는 이 키로만 접근 |
| `LICENSEHUB_ADMIN_USER` / `LICENSEHUB_ADMIN_PASSWORD` | — | 액세스 키 모드의 백엔드 로그인 계정 |

- **패스스루**(기본): `MCP_ACCESS_KEY`가 없으면 클라이언트의 `Authorization: Bearer <백엔드 토큰>`을
  그대로 백엔드에 전달한다.
- **전용 액세스 키**(권장): `MCP_ACCESS_KEY`가 있으면 클라이언트는 이 키로만 접근하고,
  서버는 관리자 자격증명으로 백엔드에 로그인해 토큰을 발급·캐시한다.
  관리자 비밀번호는 서버 밖으로 나가지 않는다.

클라이언트 설정 — OpenCode:

```jsonc
{
  "mcp": {
    "servers": {
      "licensehub": {
        "type": "remote",
        "url": "https://licensehub.example.com/mcp",
        "headers": { "Authorization": "Bearer {env:MCP_ACCESS_KEY}" }
      }
    }
  }
}
```

Cursor:

```json
{
  "mcpServers": {
    "licensehub": {
      "url": "https://licensehub.example.com/mcp",
      "headers": { "Authorization": "Bearer <access-key>" }
    }
  }
}
```

엔드포인트: `POST /mcp`(JSON-RPC), `GET /healthz`(헬스체크), `GET`·`DELETE /mcp`는 405(SSE 미지원).

### 10.5 연결 확인

```sh
opencode mcp list          # ✓ licensehub connected
```

에이전트에게 `licensehub_public_key`를 호출하게 해서 JSON이 오면 URL/토큰까지 정상이다.
`licensehub_generate_keypair`는 네트워크가 필요 없어 URL 없이도 동작한다.

직접 확인:

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node tools/mcp/licensehub-mcp.js
```

### 10.6 문제 해결

| 증상 | 원인 / 해결 |
|---|---|
| `✗ licensehub failed` | `node` 또는 스크립트 경로 오류. 절대경로와 `node --check` 확인 |
| `LICENSEHUB_URL 이 설정되지 않았습니다` | 클라이언트가 env를 못 물려받음. 같은 셸에서 export 후 재시작 |
| `LICENSEHUB_TOKEN 이 설정되지 않았습니다` | 토큰 미주입. `{env:LICENSEHUB_TOKEN}` 또는 export 확인 |
| `401: unauthorized` | 토큰 만료/오타. 다시 로그인 |
| `401` (원격 모드) | 액세스 키 불일치. `MCP_ACCESS_KEY`와 클라이언트 값 확인 |
| 데스크톱 앱에서 env 미적용 | 셸 프로필(`~/.zshrc`)에 export 하거나, 설정 파일에 URL을 직접 기입(토큰은 env 유지) |
| `node`를 못 찾음 | `command`/`args`에 `which node` 결과의 절대경로 사용 |

### 10.7 원격 모드 주의

- `download_license`의 `save_path`는 **원격에서 비활성**이다(서버 파일시스템에 쓰지 않도록).
  반환된 JSON을 클라이언트에서 저장한다.
- `generate_keypair`는 서버에서 키를 만들어 네트워크로 반환하므로, 원격에서는
  **클라이언트 측 생성**을 권장한다(예: `openssl genpkey -algorithm ED25519`).
- SSE 스트림은 제공하지 않는다(스펙상 405 허용). 세션 ID도 발급하지 않는 무상태 서버다.
- `App_Pri`(개인키)는 도구 출력에 포함될 수 있다. 로그·대화·저장소에 남기지 않고
  파일/OS 보호 저장소에만 보관한다.
