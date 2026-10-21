# LicenseHub Core 배포 가이드 (C / Rust / Python / C#)

LicenseGuard 검증 모듈은 **네이티브 라이브러리**로 배포된다. 플랫폼별 산출물을
받아 쓰거나, 각 언어 패키지를 설치한다.

> **정적 링크를 기본으로 쓴다.** 공유 라이브러리(`LD_PRELOAD`,
> `DYLD_INSERT_LIBRARIES`, DLL 교체)는 검증 함수를 가로챌 수 있는 접점을 만든다.
> 정적 라이브러리는 검증 코드를 응용 바이너리 안으로 넣어 그 접점을 없앤다.
> 자세한 배경은 §10 참고.

## 1. 지원 플랫폼

플랫폼 키는 `<os>-<arch>` 형식이다. C SDK 안의 디렉터리 이름과 같다.

| OS | 아키텍처 | 플랫폼 키 | 공유 | 정적 | Python wheel 태그 | .NET RID |
|---|---|---|---|---|---|---|
| Linux | x86_64 | `linux-x86_64` | `.so` | `.a` | `linux_x86_64` | `linux-x64` |
| Linux | arm64 | `linux-arm64` | `.so` | `.a` | `linux_aarch64` | `linux-arm64` |
| macOS | x86_64 | `macos-x86_64` | `.dylib` | `.a` | `macosx_10_12_x86_64` | `osx-x64` |
| macOS | arm64 | `macos-arm64` | `.dylib` | `.a` | `macosx_11_0_arm64` | `osx-arm64` |
| Windows | x86_64 | `windows-x86_64` | `.dll` | `.lib` | `win_amd64` | `win-x64` |

## 2. 릴리스 산출물 받기

`Release Core SDK` 워크플로가 만든다.

- 수동: Actions → Release Core SDK → Run workflow (version 입력, 예: `0.1.0`)
- 태그: `git tag v0.1.0 && git push origin v0.1.0`

릴리스에 첨부되는 파일:

```text
licensehub-core-<version>.zip          # C SDK
  c/include/licensehub_core.h
  c/lib/<platform>/shared/...          # .so/.dylib/.dll
  c/lib/<platform>/static/...          # .a / licensehub_core_static.lib
  c/lib/<platform>/pkgconfig/...       # licensehub_core.pc, licensehub_core_static.pc
  c/share/cmake/LicenseHubCore/...     # find_package(LicenseHubCore)
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

### 3.1 정적 링크 (권장)

```sh
# pkg-config
export PKG_CONFIG_PATH=<sdk>/c/lib/linux-x86_64/pkgconfig
cc app.c $(pkg-config --cflags --libs --static licensehub_core_static) -o app
```

```cmake
# CMake
find_package(LicenseHubCore REQUIRED)      # -DCMAKE_PREFIX_PATH=<sdk>/c
target_link_libraries(app PRIVATE LicenseHubCore::LicenseHubCoreStatic)
```

`pkg-config --libs --static`가 플랫폼별 시스템 라이브러리(macOS: Security,
CoreFoundation, libiconv / Linux: pthread, dl, m)를 함께 넘긴다.

### 3.2 공유 링크

```sh
cc app.c -I <sdk>/c/include \
  -L <sdk>/c/lib/linux-x86_64/shared -llicensehub_core -o app
```

`ldd app`(Linux) / `otool -L app`(macOS)로 `liblicensehub_core`가 런타임
의존성으로 남아 있는지 확인한다. 남아 있다면 정적 링크가 아니다.

### 3.3 pkg-config 없이

```sh
cc app.c -I <sdk>/c/include \
  <sdk>/c/lib/linux-x86_64/static/liblicensehub_core.a -lpthread -ldl -lm -o app
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
# core/dist/<os>-<arch>/include, lib/<os>-<arch>/{shared,static,pkgconfig}
#   + share/cmake/LicenseHubCore

# Python wheel
python bindings/python/build_wheel.py \
  --platform macos-arm64 --plat-name macosx_11_0_arm64 \
  --lib core/dist/macos-arm64/lib/macos-arm64/shared/liblicensehub_core.dylib --out dist

# C# nupkg (runtimes/<rid>/native 를 먼저 채운 뒤)
dotnet pack bindings/csharp -c Release -o dist
```

로컬 산출물은 릴리스 C SDK와 같은 레이아웃이다. 로컬 빌드로 통합 코드를
작성하면 릴리스 산출물에서도 경로가 그대로 맞는다.

## 10. 보안

### 10.1 정적 링크 vs 공유 링크

검증 모듈을 공유 라이브러리로 쓰면 다음 접점이 생긴다.

| 접점 | 예시 | 정적 링크 시 |
|---|---|---|
| 전역 심볼 가로채기 | `LD_PRELOAD` / `DYLD_INSERT_LIBRARIES` | 사라짐 |
| 라이브러리 파일 교체 | `LD_LIBRARY_PATH`, 패키지 디렉터리 쓰기 | 사라짐 |
| Windows DLL 하이재킹 | `DllImport("licensehub_core")` | 사라짐 (C/C++ 한정) |
| 바이너리 분기 패치 | NOP 패치 | 남음 |

정적 링크는 위 1~3을 없애지만 4(바이너리 패치)는 남는다. 바이너리 패치까지
막으려면 **L2(온라인)** 로 서버가 승인 시점에 핵심 로직 키를 내려주는 구조가
필요하다. 오프라인(L1)에서는 검증 결과가 본질적으로 "플래그"이므로 우회
비용을 올리는 것(정적 링크, 검사 분산 배치, 무결성 자기검사)이 최선이다.

- Python(`ctypes`)과 C#(`DllImport`)은 구조적으로 동적 로딩이라 정적 링크가
  불가능하다. 네이티브 파일 교체를 막을 수 없으므로, 이 언어들은 취급
  등급이 낮은 로직에 쓰거나 L2를 함께 쓴다.

### 10.2 키 관리

- `LH_Pri`(발급 서버 서명 개인키)는 배포물에 포함하지 않는다.
- `App_Pri`는 파일/OS 보호 저장소에만 두고, 로그·커밋에 남기지 않는다.
- 검증 실패 시 핵심 로직을 켜지 않는다. L2는 서버 미응답 시 비활성이다.
