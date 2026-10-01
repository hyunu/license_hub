# LicenseGuard 배포용 검증 라이브러리

배포되는 응용 SW에 포함되는 검증 모듈(LicenseGuard)의 언어별 바인딩이다.
모두 **검증 기능만** 제공하며, 발급·개인키·GitHub 자격증명은 포함하지 않는다.

- 공통 기반: `core/include/licensehub_core.h` 의 `lh_verify_certificate` (C ABI)
- 공용 픽스처: `testdata/` (고정 키로 만든 L1/L2/L3 인증서, 공개키, Context)

## 지원 언어

| 언어 | 구현 | 실행 방법 |
|---|---|---|
| C | `c/verify_all.c` | `cd c && ./build.sh` |
| C++ | `cpp/licenseguard.hpp` | `cd cpp && ./build.sh` |
| C# | `csharp/LicenseGuard.cs` | `cd csharp && ./run.sh` |
| Python | `python/licenseguard.py` | `cd python && python3 verify_all.py` |
| Node.js | `nodejs/licenseguard.js` | `cd nodejs && ./run.sh` |
| Rust | `core/` 크레이트 자체 | `cargo test` (core) |

모든 바인딩은 동일한 픽스처로 다음을 검증한다.

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

## C 사용

`core/dist/<os>-<arch>/include/licensehub_core.h` 를 include 하고
네이티브 라이브러리를 링크한다.

```c
#include "licensehub_core.h"

uint32_t code;
int32_t status = lh_verify_certificate(cert, cert_len, pub, 32, ctx, ctx_len, &code);
if (status == 0 && code == LH_VALID) { /* 활성화 */ }
```

## C++ 사용

헤더 전용 래퍼 `cpp/licenseguard.hpp` 를 include 한다.

```cpp
#include "licenseguard.hpp"

auto result = licensehub::LicenseGuard::verify(cert_bytes, pub_bytes, context_json);
if (result.valid()) { /* 활성화 */ }
```

## C# 사용

`csharp/LicenseGuard.cs` 의 `LicenseGuard.Verify` 를 호출한다.
`run.sh` 가 네이티브 라이브러리 경로(`DYLD_LIBRARY_PATH`/`LD_LIBRARY_PATH`)를
설정하고 실행한다.

```csharp
var result = LicenseHub.LicenseGuard.Verify(certBytes, pubKeyBytes, ctxBytes);
if (result.Valid) { /* 활성화 */ }
```

## Python 사용

`python/licenseguard.py` 의 `LicenseGuard` 클래스를 사용한다.
기본 경로에서 네이티브 라이브러리를 자동으로 찾는다.

```python
from licenseguard import LicenseGuard

result = LicenseGuard().verify(cert_bytes, pub_bytes, ctx_bytes)
if result.valid:
    # 활성화
```

## Node.js 사용

`nodejs/licenseguard.js` 의 `LicenseGuard` 클래스를 사용한다.
`koffi` 의존성은 `run.sh` 가 자동 설치한다.

```js
const { LicenseGuard } = require('./licenseguard');
const result = new LicenseGuard().verify(certBuf, pubBuf, ctxBuf);
if (result.valid) { /* 활성화 */ }
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