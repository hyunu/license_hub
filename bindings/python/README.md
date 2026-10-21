# LicenseHub LicenseGuard — Python

검증 전용 바인딩이다. 발급·서명 개인키 기능은 포함하지 않는다.

## 설치

플랫폼별 wheel 을 설치한다. wheel 안에 네이티브 라이브러리가 함께 들어 있다.

```sh
pip install licensehub_licenseguard-0.1.0-py3-none-macosx_11_0_arm64.whl
```

개발 중에는 소스에서 바로 사용할 수 있다(네이티브 라이브러리 경로 지정).

```python
from licensehub_licenseguard import LicenseGuard
guard = LicenseGuard("/path/to/liblicensehub_core.dylib")
```

## 사용 (운영 경로)

```python
import json
from licensehub_licenseguard import LicenseGuard

guard = LicenseGuard()
license_bytes = open("license.lic.json", "rb").read()
app_pri = open("app_pri.raw", "rb").read()   # Ed25519 seed 32바이트

context = json.dumps({
    "now": "2026-06-01T00:00:00Z",
    "product": "my-app",
    "version": "1.0.0",
}).encode()

result = guard.decrypt_verify_trusted_license(license_bytes, app_pri, context)
if result.valid:
    ...  # 핵심 로직 활성화
else:
    ...  # 비활성 유지 (fail-closed)
```

L2(온라인)는 `decrypt_verify_trusted_license_online` 을 사용한다.
서버 미응답 시 비활성이다.

## Context 필드

`now`, `product`, `version`, `product_id`, `executable_name`,
`application_id`, `target_language`, `server_status`("approved"/"rejected"),
`blacklisted`, `revoked`.

## 키 형식

- App 공개키: SPKI PEM (발급 요청)
- App 개인키: PKCS8 PEM (서버 응답) → **raw 32바이트 seed** 로 변환해 전달
- C ABI는 PEM을 받지 않는다.

```sh
openssl pkey -in app_pri.pem -outform DER | tail -c 32 > app_pri.raw
```

## wheel 빌드

```sh
python build_wheel.py --platform macos-arm64 \
  --plat-name macosx_11_0_arm64 \
  --lib ../../core/dist/macos-arm64/lib/liblicensehub_core.dylib --out dist
```
