# LicenseHub Core 배포 가이드 (C / Rust / Python / C#)

LicenseGuard 검증 모듈은 **네이티브 라이브러리**로 배포된다. 플랫폼별 산출물을
받아 쓰거나, 각 언어 패키지를 설치한다.

## 1. 지원 플랫폼

| OS | 아키텍처 | C 라이브러리 | Python wheel 태그 | .NET RID |
|---|---|---|---|---|
| Linux | x86_64 | `.so` | `linux_x86_64` | `linux-x64` |
| Linux | arm64 | `.so` | `linux_aarch64` | `linux-arm64` |
| macOS | x86_64 | `.dylib` | `macosx_10_12_x86_64` | `osx-x64` |
| macOS | arm64 | `.dylib` | `macosx_11_0_arm64` | `osx-arm64` |
| Windows | x86_64 | `.dll` | `win_amd64` | `win-x64` |

## 2. 릴리스 산출물 받기

`Release Core SDK` 워크플로가 만든다.

- 수동: Actions → Release Core SDK → Run workflow (version 입력, 예: `0.1.0`)
- 태그: `git tag v0.1.0 && git push origin v0.1.0`

릴리스에 첨부되는 파일:

```text
licensehub-core-<version>.zip          # C SDK
  c/include/licensehub_core.h
  c/lib/<platform>/...                 # 플랫폼별 .so/.dylib/.dll
  c/examples/verify_example.c
  c/examples/decrypt_verify_example.c

licensehub_licenseguard-<version>-py3-none-<plat>.whl   # Python (플랫폼별)
LicenseHub.LicenseGuard.<version>.nupkg                 # C# (모든 RID 포함)
```

## 3. C

```c
#include "licensehub_core.h"

uint32_t code = 0;
int32_t rc = lh_decrypt_verify_trusted_license(
    lic_bytes, lic_len,
    app_pri_raw32, 32,
    context_json, context_len,
    &code);

if (rc == 0 && code == LH_VALID) {
    /* 핵심 로직 활성화 */
} else {
    /* 비활성 유지 (fail-closed) */
}
```

빌드 예:

```sh
cc app.c -I c/include -L c/lib/linux-x86_64 -llicensehub_core -o app
```

## 4. Rust

```toml
[dependencies]
licensehub-core = { git = "https://github.com/hyunu/license_hub", package = "licensehub-core" }
# 또는 path 의존성
```

```rust
use licensehub_core::{envelope, trusted, VerificationContext};

let ctx = VerificationContext::default();
let envelope: envelope::EncryptedLicense = serde_json::from_slice(&lic_bytes)?;
let cert = envelope::decrypt_license(&envelope, &app_pri, &lh_pub)?;
trusted::verify_trusted(&cert, &ctx)?;   // 실패 시 Err
```

Rust 앱은 네이티브 라이브러리 대신 크레이트를 직접 사용한다.

## 5. Python

```sh
pip install licensehub_licenseguard-0.1.0-py3-none-macosx_11_0_arm64.whl
```

```python
from licensehub_licenseguard import LicenseGuard

guard = LicenseGuard()
result = guard.decrypt_verify_trusted_license(
    open("license.lic.json", "rb").read(),
    open("app_pri.raw", "rb").read(),        # 32바이트
    b'{"now":"2026-06-01T00:00:00Z","product":"my-app","version":"1.0.0"}',
)
if result.valid:
    ...  # 활성화
```

- L2: `decrypt_verify_trusted_license_online`
- 저수준(도구/테스트): `decrypt_license(envelope, app_pri, lh_public_key)`
- `application_id(public_key_raw32)`

## 6. C#

```sh
dotnet add package LicenseHub.LicenseGuard
```

```csharp
using LicenseHub.LicenseGuard;

var result = LicenseGuard.DecryptVerifyTrustedLicense(
    File.ReadAllBytes("license.lic.json"),
    File.ReadAllBytes("app_pri.raw"),        // 32바이트
    "{\"now\":\"2026-06-01T00:00:00Z\",\"product\":\"my-app\",\"version\":\"1.0.0\"}");

if (result.Valid) { /* 활성화 */ }
```

- L2: `DecryptVerifyTrustedLicenseOnline`
- 저수준: `DecryptLicense(envelope, app_pri, lhPublicKey)`
- `GetApplicationId(publicKey)`

C# 네이티브 라이브러리는 패키지의 `runtimes/<rid>/native/` 에서 자동 로드된다.

## 7. 키 형식 (공통)

| 항목 | HTTP API | C ABI / 바인딩 |
|---|---|---|
| App 공개키 | SPKI **PEM** | **raw 32바이트** |
| App 개인키 | PKCS8 **PEM** | **raw 32바이트 seed** |
| LH 서명 공개키 | PEM/hex | 검증 모듈에 내장(LK2) |

PEM → raw 변환:

```sh
openssl pkey -in app_pri.pem -outform DER | tail -c 32 > app_pri.raw
```

## 8. 검증 Context

`now`, `product`, `version`, `product_id`, `executable_name`,
`application_id`, `target_language`, `server_status`(`approved`/`rejected`),
`blacklisted`, `revoked`, `max_chain_depth`.

## 9. 로컬 빌드

```sh
cd core && ./build.sh
# core/dist/<os>-<arch>/include, lib

# Python wheel
python bindings/python/build_wheel.py \
  --platform macos-arm64 --plat-name macosx_11_0_arm64 \
  --lib core/dist/macos-arm64/lib/liblicensehub_core.dylib --out dist

# C# nupkg (runtimes/<rid>/native 를 먼저 채운 뒤)
dotnet pack bindings/csharp -c Release -o dist
```

## 10. 보안

- `LH_Pri`(발급 서버 서명 개인키)는 배포물에 포함하지 않는다.
- `App_Pri`는 파일/OS 보호 저장소에만 두고, 로그·커밋에 남기지 않는다.
- 검증 실패 시 핵심 로직을 켜지 않는다. L2는 서버 미응답 시 비활성이다.
