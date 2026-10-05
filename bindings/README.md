# LicenseGuard 배포용 검증 라이브러리

배포되는 응용 SW에 포함되는 검증 모듈(LicenseGuard)의 언어별 바인딩이다.
모두 **검증 기능만** 제공하며, 발급·개인키·GitHub 자격증명은 포함하지 않는다.

- 공통 기반: `core/include/licensehub_core.h` 의 `lh_verify_certificate` (C ABI)
- 공용 픽스처: `testdata/` (고정 키로 만든 L1/L2/L3 인증서, 공개키, Context)

## 지원 언어

| 언어 | 구현 | 실행 방법 |
|---|---|---|
| C | `c/verify_all.c` | `cd c && ./build.sh` |
| Rust | `core/` 크레이트 자체 | `cd core && cargo test` |

두 바인딩은 동일한 픽스처로 다음을 검증한다.

- L1 유효 인증서 → VALID
- L2 유효 인증서 → VALID
- L3 유효 인증서 → VALID
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