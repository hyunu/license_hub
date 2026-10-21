# LicenseHub LicenseGuard — C#

검증 전용 바인딩이다. 발급·서명 개인키 기능은 포함하지 않는다.

## 설치

```sh
dotnet add package LicenseHub.LicenseGuard
```

네이티브 라이브러리는 패키지의 `runtimes/<rid>/native/` 에 포함된다.
지원 RID: `win-x64`, `linux-x64`, `linux-arm64`, `osx-x64`, `osx-arm64`.

## 사용 (운영 경로)

```csharp
using LicenseHub.LicenseGuard;

byte[] licenseBytes = File.ReadAllBytes("license.lic.json");
byte[] appPri = File.ReadAllBytes("app_pri.raw"); // Ed25519 seed 32바이트

var context = "{\"now\":\"2026-06-01T00:00:00Z\",\"product\":\"my-app\",\"version\":\"1.0.0\"}";
var result = LicenseGuard.DecryptVerifyTrustedLicense(licenseBytes, appPri, context);

if (result.Valid)
{
    // 핵심 로직 활성화
}
else
{
    // 비활성 유지 (fail-closed)
}
```

L2는 `DecryptVerifyTrustedLicenseOnline` 을 사용한다.

## 키 형식

- App 공개키: SPKI PEM (발급 요청)
- App 개인키: PKCS8 PEM → **raw 32바이트 seed** 로 변환해 전달
- C ABI는 PEM을 받지 않는다.

```sh
openssl pkey -in app_pri.pem -outform DER | tail -c 32 > app_pri.raw
```

## 패키징

네이티브 라이브러리를 `runtimes/<rid>/native/` 에 둔 뒤:

```sh
dotnet pack -c Release -o dist
```
