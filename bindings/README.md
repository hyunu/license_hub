# LicenseGuard 배포용 검증 라이브러리

배포되는 응용 SW에 포함되는 검증 모듈(LicenseGuard)의 언어별 바인딩이다.
모두 **검증 기능만** 제공하며, 발급·개인키·GitHub 자격증명은 포함하지 않는다.

- 공통 기반: `core/include/licensehub_core.h` 의 `lh_verify_certificate` (C ABI)
- 공용 픽스처: `testdata/` (고정 키로 만든 L1/L2 인증서, 공개키, Context)

## 지원 언어

| 언어 | 구현 | 실행 방법 |
|---|---|---|
| C | `c/verify_all.c` | `cd c && ./build.sh` |
| Rust | `core/` 크레이트 자체 | `cd core && cargo test` |

두 바인딩은 동일한 픽스처로 다음을 검증한다.

- L1 유효 인증서 → VALID
- L2 유효 인증서 → VALID
- 변조된 인증서 → INVALID_SIGNATURE

## 사전 준비

네이티브 라이브러리를 먼저 빌드한다.

```sh
cd core
./build.sh
```

그러면 `core/dist/<os>-<arch>/` 아래에 플랫폼별 라이브러리와 헤더가 생긴다.

```text
core/dist/macos-arm64/
├── include/licensehub_core.h
└── lib/
    ├── liblicensehub_core.dylib   (macOS)
    └── liblicensehub_core.a
```

## C 사용

`core/dist/<os>-<arch>/include/licensehub_core.h` 를 include 하고
네이티브 라이브러리를 링크한다.

```c
#include "licensehub_core.h"

uint32_t code;
int32_t status = lh_verify_certificate(cert, cert_len, pub, 32, ctx, ctx_len, &code);
if (status == 0 && code == LH_VALID) { /* 활성화 */ }
```

## L2 서버 검증 (온라인 조회)

L2/L3 인증서는 런타임에 서버 상태를 확인해야 한다. 서버 주소는 인증서의
`server.verification_url`에 서명되어 있고, 그 주소로 `license_id`를 조회한다.

```text
POST {verification_url}   {"license_id":"<LICENSE-ID>"}
헤더: x-licensehub-key: <고정 API 키>
응답 200: {"status":"approved"} 또는 {"status":"rejected"}
```

요청에는 `core`에 정의된 고정 API 키가 `x-licensehub-key` 헤더로 들어간다.
서버가 키를 확인하지 못하면 401을 돌려주고, 가드는 이를 실패로 처리해
비활성화한다.

L2는 **오프라인에서 무조건 비활성**이다. 서버에 도달하지 못하거나 승인
응답을 받지 못하면 검증이 실패한다(Fail-Closed).

C에서는 `lh_fetch_server_status`가 이 조회를 수행한다.

```c
uint32_t srv;
int32_t rc = lh_fetch_server_status(url, url_len, license_id, id_len, &srv);
if (rc == 0) {
    /* srv == LH_SERVER_STATUS_APPROVED / REJECTED */
    /* context JSON 의 server_status 를 "approved"/"rejected" 로 채운다 */
}
```

Rust에서는 `online` 기능의 헬퍼를 쓴다. 이 기능은 기본으로 꺼져 있으므로
`licensehub-core = { path = "...", features = ["online"] }` 로 켠다. C 배포
라이브러리는 `core/build.sh` 가 `--features online` 으로 빌드한다.

```rust
use licensehub_core::online;

// 인증서의 verification_url 과 license_id 로 조회
let status = online::fetch_server_status(url, license_id)?;

// 복호화 → 조회 → 검증까지 한 번에
online::decrypt_verify_trusted_license_online(&envelope, &z_pri, &context)?;
```

네트워크 의존 없이 Core만 쓰려면 `online` 을 켜지 않는다(기본값).

## Rust 사용

Rust 응용 SW는 `licensehub_core` 크레이트를 경로 의존성으로 사용한다.
발급 기능 없이 검증만 쓰려면 `verify` 함수와 `VerificationContext`를 사용한다.

```rust
use licensehub_core::{verify, VerificationContext};

let cert: licensehub_core::Certificate = serde_json::from_str(cert_json)?;
let public_key = VerifyingKey::from_bytes(&key_bytes)?;
let result = verify(&cert, &public_key, &VerificationContext::default());
if result.is_ok() {
    // 핵심 기능 활성화
}
```

## 검증 결과 코드

`0=유효`, `1~15=실패 사유`. 언어별 enum/상수는
`core/include/licensehub_core.h` 의 `lh_verification_code` 와 동일한 값을
유지해야 한다.

## 픽스처 재생성

픽스처를 다시 만들려면 core에서 다음을 실행한다.

```sh
cargo run --example generate_bindings_fixtures
```