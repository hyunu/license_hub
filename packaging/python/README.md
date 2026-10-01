# licensehub-licenseguard

LicenseGuard의 Python 검증 바인딩. Core의 C ABI(`lh_verify_certificate`)를
ctypes로 호출한다.

- 검증만 수행: 발급·개인키·GitHub 자격증명 미포함
- 플랫폼별 네이티브 라이브러리는 패키지 내부 `native/<os>-<arch>/` 에 번들

## 설치

```sh
pip install licensehub_licenseguard-<version>-<platform>.whl
```

## 사용

```python
from licensehub_licenseguard import LicenseGuard

result = LicenseGuard().verify(cert_bytes, pub_bytes, ctx_bytes)
if result.valid:
    # 응용 SW 핵심 기능 활성화
```

검증 결과 코드는 `VerificationCode` 상수를 참고한다.