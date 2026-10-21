# AGENTS.md — LicenseHub를 AI 에이전트가 사용하는 방법

이 문서는 **AI 코딩 에이전트**가 LicenseHub를 이해하고 적용하기 위한 정본 안내다.
사용자가 다음과 같이 지시하면 이 문서의 §3 절차를 그대로 따른다.

> "라이선스허브에서 키를 발급받아 주요 로직을 보호해라."

---

## 1. 한 줄 개념

LicenseHub는 응용 프로그램의 **핵심 로직**을 보호하기 위해, 발급 서버가 서명한 **라이선스 파일**을
응용 프로그램의 **공개키로 암호화**해 주는 시스템이다.
응용 프로그램은 시작 시 **자기 개인키로 복호화 → 발급 서버 서명 검증 → 자격 대조**를 통과했을 때만
핵심 로직을 켠다. 하나라도 실패하면 켜지 않는다(fail-closed).

## 2. 절대 규칙 (위반 금지)

- `LH_Pri`(발급 서버 서명 개인키)는 **절대** 클라이언트·저장소·로그·프롬프트에 넣지 않는다.
- 발급된 `App_Pri`(응용 개인키)는 **파일 또는 OS 보호 저장소**에만 둔다. 로그·커밋·채팅 금지.
- 검증 결과를 상수로 하드코딩하거나, 검증을 생략한 경로를 만들지 않는다.
- L2(온라인)는 서버 미응답 시 **비활성**이다. 연결 실패를 통과로 처리하지 않는다.
- 라이선스 파일은 암호문 그대로 둔다. 열어서 수정하지 않는다.

## 3. 표준 절차 (HTTP)

기본 URL은 `LICENSEHUB_URL`(예: `https://licensehub.example.com`)이다.

### 3.1 로그인
`POST /api/auth/login`

```json
{ "username": "<admin>", "password": "<password>" }
```

응답 `200`: `{ "token": "...", "user": { "id": 1, "username": "...", "role": "admin" } }`
이후 요청에는 `Authorization: Bearer <token>` 헤더를 붙인다.

### 3.2 앱 키쌍 마련

- **(권장·자동)** `application_public_key`를 **생략**하면 LicenseHub가 키쌍을 만들고,
  발급 응답에서 `application_private_key`(PKCS8 PEM)를 **한 번만** 돌려준다.
- **(수동)** 로컬에서 Ed25519 키쌍을 만들고 `application_public_key`(SPKI PEM)만 제출한다.
  ```sh
  cargo run -p licensehub-core --example gen_app_key
  # AK1_PRIVATE_HEX (32바이트 seed) / AK2_PUBLIC_PEM (SPKI PEM)
  ```

### 3.3 라이선스 생성
`POST /api/licenses`

```json
{
  "product": "my-app",
  "version": "1.0.0",
  "level": 1,
  "holder": "ACME",
  "expires_at": "2027-01-01T00:00:00Z",
  "application_public_key": "<SPKI PEM — 생략 가능>",
  "target_language": "c",
  "metadata": "optional"
}
```

- `level=1`(오프라인)에서는 `verification_url`을 **넣지 않는다**.
- `level=2`(온라인)에서는 `verification_url`이 **필수**이며 `http(s)://`로 시작해야 한다.
- 응답의 숫자 `id`를 다음 단계에서 쓴다(`license_id` 문자열과 다르다).

### 3.4 인증서 발급 + 라이선스 생성
`POST /api/licenses/{id}/issue`

응답 `200`:

```json
{
  "certificate": { "...": "..." },
  "certificate_id": "...",
  "encrypted_license": { "...": "..." },
  "application_id": "...",
  "target_language": "c",
  "application_key_generated": true,
  "application_private_key": "-----BEGIN PRIVATE KEY-----\n..."
}
```

- `application_private_key`가 있으면 **즉시 안전하게 저장**한다(다시 나오지 않는다).
- `encrypted_license`가 앱에 배포할 **라이선스 파일**이다.

### 3.5 라이선스 파일 내려받기
- `GET /api/licenses/{id}/license` → JSON(암호문)
- `GET /api/licenses/{id}/license/download` → 파일

### 3.6 (선택) 발급 서버 공개키
`GET /api/public-key` → `{ "key_id": "...", "algorithm": "Ed25519", "hex": "...", "pem": "..." }`

## 4. 키 형식 (가장 자주 틀리는 부분)

| 용도 | HTTP API | C ABI |
|---|---|---|
| App 공개키 (`App_Pub`) | SPKI **PEM** | **raw 32 bytes** |
| App 개인키 (`App_Pri`) | PKCS8 **PEM** (발급 응답) | **raw 32 bytes** (seed) |
| LH 서명 공개키 (`LH_Pub`) | PEM/hex | 검증 모듈에 내장(LK2) |

- **C ABI는 PEM을 받지 않는다.** PEM과 32바이트 사이 변환이 필요하다.
- App 공개키 PEM의 DER 끝 32바이트가 raw 공개키이고, PKCS8 개인키 DER의 32바이트 seed가 raw 개인키다.
- 변환을 직접 하지 않으려면 저장소의 바인딩(래퍼)을 사용한다.

## 5. 앱 코드 통합 (C ABI)

```c
#include "licensehub_core.h"

/* lic_bytes : 라이선스 파일(암호문) 그대로
   app_pri   : App 개인키 raw 32 bytes
   context   : {"now":"<RFC3339>"}  (L2면 server_status 포함) */
uint32_t code = 0;
int32_t rc = lh_decrypt_verify_trusted_license(
    lic_bytes, lic_len,
    app_pri, 32,
    context_json, context_len,
    &code);

if (rc == 0 && code == LH_VALID) {
    /* 핵심 로직 활성화 */
} else {
    /* 비활성 유지 (fail-closed) */
}
```

- L2면 `lh_decrypt_verify_trusted_license_online(...)`을 쓴다(서버 미응답 시 자동 비활성).
- 컨텍스트(JSON) 예: `{"now":"2026-06-01T00:00:00Z"}`, L2: `{"now":"...","server_status":"approved"}`.
- 컨텍스트 필드: `now`, `product`, `version`, `product_id`, `executable_name`,
  `application_id`, `target_language`, `server_status`(`approved`/`rejected`),
  `blacklisted`, `revoked`, `max_chain_depth`.
- 검증 코드는 `LH_VALID=0`이며, 그 외 값은 전부 실패로 취급한다.

## 6. 자가 점검 체크리스트

- [ ] `application_private_key`를 파일/보호 저장소에 안전하게 저장했는가
- [ ] 라이선스 파일(암호문)을 수정 없이 앱에 포함했는가
- [ ] 검증 실패 시 핵심 로직이 **켜지지 않는** 경로인가
- [ ] PEM ↔ raw 32바이트 변환을 올바르게 했는가
- [ ] L2에서 서버 미응답 시 비활성인가
- [ ] 개인키·토큰이 저장소/로그에 없는가

## 7. 저장소 지도

- `core/include/licensehub_core.h` — C ABI 진입점과 검증 코드
- `core/src/` — 발급·암호화(`envelope.rs`), 검증(`trusted.rs`), L2(`online.rs`)
- `bindings/` — 배포용 검증 라이브러리(C, Rust)와 `testdata/` 픽스처
- `web/backend/src/routes.rs` — REST API 구현
- `tools/licensehub.sh` — 로그인·생성·발급·내려받기 CLI
- `tools/mcp/` — MCP 서버(도구 호출로 발급·조회). 설정은 `tools/mcp/README.md`
- `docs/INTEGRATION.md` — 단계별 상세 가이드
- `docs/openapi.yaml` — 기계 판독용 API 계약

## 8. 관련 문서

- `docs/INTEGRATION.md` — 상세 절차와 예제
- `docs/openapi.yaml` — API 스펙
- `docs/ARCHITECTURE.md`, `docs/CORE_DESIGN.md` — 설계 배경

## 9. MCP 도구 (에이전트가 직접 호출)

`tools/mcp/licensehub-mcp.js`를 MCP 서버로 등록하면 다음 도구를 쓸 수 있다.
OpenCode에서는 `<서버>_<도구>` 이름으로 노출된다(서버 이름이 `licensehub`이면 `licensehub_create_license`).

- `generate_keypair` — App 키쌍(Ed25519) 생성
- `public_key` — 발급 서버 공개키 조회
- `list_licenses` — 라이선스 목록
- `create_license` — 라이선스 생성
- `issue_license` — 인증서 발급 + 암호화 라이선스 생성
- `download_license` — 암호화 라이선스 조회/파일 저장
- `verify_license` — 서버 기준 라이선스 상태 확인

표준 MCP stdio 서버이므로 OpenCode·Cursor·Claude Desktop 등 MCP를 지원하는 클라이언트에서 모두 쓸 수 있다.
설정 예시(OpenCode V2 `mcp.servers`, Cursor/Claude Desktop `mcpServers`)는 `tools/mcp/README.md`에 있다.
원격 호스팅은 `node tools/mcp/licensehub-mcp.js --http`(Streamable HTTP)로 실행하고 Caddy `/mcp` 뒤에 둔다.
배포 예시는 `tools/mcp/deploy/`에 있다.

`licensehub_core_manifest`, `licensehub_core_module`, `licensehub_integration_snippet`, `licensehub_verify_local_module` 도구를 제공한다. 에이전트는 라이선스 발급 → 검증 코어 다운로드(SHA-256 검증, 기본 정적 링크) → fail-closed 통합 코드 생성 → 로컬 스모크 테스트 순서로 진행할 수 있다. 자세한 절차는 `tools/mcp/README.md` 를 참고한다.

```sh
export LICENSEHUB_URL=https://<백엔드주소>
export LICENSEHUB_TOKEN=$(tools/licensehub.sh login | jq -r .token)
```

- 로컬(stdio): `mcp.servers.licensehub` → `command: ["node", "<경로>/tools/mcp/licensehub-mcp.js"]`
- 원격(HTTP): `mcp.servers.licensehub` → `type: "remote"`, `url: "<백엔드주소>/mcp"`, `headers: { "Authorization": "Bearer <access-key>" }`
- 전역/다른 프로젝트에서는 `command`/`args`에 **절대경로**를 쓴다.
- 연결 확인: `opencode mcp list` → `licensehub connected`
