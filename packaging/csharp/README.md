# LicenseHub.LicenseGuard

LicenseGuard의 C# 검증 바인딩. Core의 C ABI(`lh_verify_certificate`)를
P/Invoke로 호출한다.

- 검증만 수행: 발급·개인키·GitHub 자격증명 미포함
- 플랫폼별 네이티브 라이브러리는 NuGet 패키지의 `runtimes/<rid>/native/` 에
  포함된다

## 사용

```csharp
var result = LicenseHub.LicenseGuard.Verify(certBytes, pubKeyBytes, ctxBytes);
if (result.Valid)
{
    // 응용 SW 핵심 기능 활성화
}
```

- `certBytes`: 인증서 JSON 바이트
- `pubKeyBytes`: Ed25519 공개키 32바이트
- `ctxBytes`: 검증 Context JSON (now, server_status, device_id 등)

검증 결과 코드는 `LicenseHub.VerificationCode` 상수를 참고한다.