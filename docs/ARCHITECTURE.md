# LicenseHub 전체 시스템 아키텍처

## 1. 개요

LicenseHub는 소프트웨어 및 라이브러리 배포 시 라이선스를 발급하고, 설치
환경에서 라이선스의 유효성을 검증하여 기능 활성화를 제어하는 시스템이다.

- 발급·서명·검증의 핵심 로직은 **Core**가 담당한다.
- 배포되는 응용 SW에 내장되는 검증 모듈은 **LicenseGuard**라 부른다.
- 인증서·Blacklist·Public Key의 저장과 배포는 **GitHub Repository**를
  이용한다.
- 내부 관리 데이터(User, License, 감사 이력)는 **내부 DB**에 보관한다.

## 2. 용어 정리

| 용어 | 정의 | 비고 |
|---|---|---|
| LicenseHub | 라이선스 발급·검증 전체 시스템 | |
| LicenseHub Core | 발급·서명·검증 공통 라이브러리 | Rust, 오프라인 순수 로직 |
| LicenseGuard | 응용 SW에 포함되는 검증 모듈 | 배포형, Core의 검증 기능만 포함 |
| 응용 SW (Application) | 최종 사용자에게 배포되는 제품 | LicenseGuard를 내장 |
| LicenseHub Backend/API | 서버 측 인증·발급·활성화 API | |
| LicenseHub Web App | 관리자/개발자용 UI | |
| GitHub Repository | 인증서·Blacklist·Public Key 배포 저장소 | 초기 Private |

### 2.1 용어 변경 검토: Client

기존 요구사항 문서의 **"Client"**는 배포되는 응용 SW에 포함되는 검증용
모듈을 가리켰다. 이 표현은 다음 이유로 명확하지 않다.

- 네트워크 Client, 앱 Client, API Client와 혼동될 수 있다.
- 검증·차단 기능이라는 역할이 이름에 드러나지 않는다.
- 배포되는 응용 SW 전체인지, 내장 모듈인지 구분이 모호하다.

권장 용어는 다음과 같이 구분한다.

```text
응용 SW (Application)         배포되는 제품 전체
├── 응용 SW 핵심 모듈          실제 기능
└── LicenseGuard              라이선스 검증·활성화 제어 모듈
```

- **LicenseGuard**: 배포형 검증 모듈의 이름. "보호·차단"의 의미를 전달하고
  제품명으로 사용하기에도 적합하다.
- 대안: `Verifier`, `LicenseVerifier`, `ActivationGuard`, `LicenseChecker`
- **Client**라는 표현은 "LicenseHub API를 호출하는 응용 SW"라는 일반적인
  의미로만 제한해 사용하거나, 문서에서는 `응용 SW`로 통일한다.

## 3. 전체 아키텍처

```text
Developer / Administrator
            |
            | GitHub OAuth / Email / SSO
            v
   LicenseHub Web App
            |
            | HTTPS / JSON API
            v
   LicenseHub Backend/API
   ├── User / Auth (OAuth, 권한)
   ├── License Management
   ├── Certificate Generator (Core 호출)
   ├── Activation Service
   ├── Audit / DB
   └── GitHub Repository Sync (GitHub App)
            |                            |
            | GitHub App                 | DB
            v                            v
   GitHub Repository           내부 DB (User/License/감사)
   ├── certificates/           GitHub에는 없는 관리 데이터
   ├── blacklist/
   ├── manifest/
   └── keys/public-key.pem

   응용 SW (배포본)
   ├── 응용 SW 핵심 모듈
   └── LicenseGuard
       ├── Certificate Load
       ├── Signature / Metadata / Expiration Verify (Core 기반)
       ├── Server Check (Backend API 호출)
       ├── Blacklist Cache
       └── Device Binding
```

## 4. 계층 구조

```text
┌─────────────────────────────────────────────────────────┐
│ Presentation Layer                                     │
│   LicenseHub Web App (관리·발급 UI)                     │
├─────────────────────────────────────────────────────────┤
│ Service Layer                                          │
│   LicenseHub Backend/API                               │
│   ├── Auth / User                                      │
│   ├── License / Activation / Revocation                │
│   └── GitHub Sync / Audit                              │
├─────────────────────────────────────────────────────────┤
│ Core Layer                                             │
│   licensehub-core (Rust)                               │
│   ├── Certificate Model / Schema                       │
│   ├── Canonicalization                                 │
│   ├── Ed25519 Sign / Verify                            │
│   ├── Issuer / Verifier / Chain                        │
│   └── C ABI (FFI)                                      │
├─────────────────────────────────────────────────────────┤
│ Distribution Layer                                     │
│   GitHub Repository (Certificate/Blacklist/Key)        │
│   LicenseGuard (응용 SW에 내장)                         │
├─────────────────────────────────────────────────────────┤
│ Data Layer                                             │
│   내부 DB (User/License/감사)                          │
│   외부 Key 저장소 (암호화된 Private Key)               │
└─────────────────────────────────────────────────────────┘
```

## 5. 구성 요소 상세

### 5.1 LicenseHub Core (Rust)

인증서의 생성·서명·파싱·검증을 제공하는 공통 모듈.

책임:

- 인증서 모델 및 Schema 검증
- 서명 대상 canonicalization
- Ed25519 서명 및 검증
- L1/L2/L3 등급별 검증 정책
- 중첩 인증서 및 체인 검증
- C ABI 제공

책임 제외:

- GitHub·HTTP·DB 접근
- OAuth·사용자 인증
- Private Key 보관·복호화
- 응용 SW의 실제 기능 차단

### 5.2 LicenseGuard (배포형 검증 모듈)

응용 SW에 포함되는 검증 모듈로, Core의 검증 기능만 사용한다.
현재 C/Rust 바인딩이 `bindings/`와 `core/` 크레이트에 구현되어 있다(7장).

- 인증서 로드 및 캐시
- 서명·Metadata·만료 검증
- L2/L3 서버 검증(Backend API 호출)
- Blacklist 다운로드 및 로컬 캐시
- Device Binding 비교
- 검증 결과에 따른 응용 SW 활성화 제어

LicenseGuard에는 GitHub Token, Private Key, 발급 기능이 포함되지 않는다.

### 5.3 LicenseHub Backend/API

- GitHub OAuth 기반 사용자 로그인
- 사용자·권한 관리
- License 생성·조회·변경·폐기
- 인증서 발급( Core 호출) 및 서명
- L2/L3 활성화 검증 API
- Blacklist/Revocation 처리
- GitHub Repository 동기화(GitHub App)
- 감사 로그

### 5.4 LicenseHub Web App

- 로그인
- License 관리 화면
- 인증서 발급·다운로드
- 발급 이력 및 감사 로그 조회
- Blacklist/Revocation 관리

### 5.5 GitHub Repository

역할:

- 인증서 저장·배포
- Blacklist 배포
- Public Key 배포
- Git history를 이용한 변경 이력 추적

구조:

```text
LicenseHub-Repository/
├── certificates/
│   ├── core/
│   ├── secure/
│   └── device-bound/
├── blacklist/
│   └── blacklist.json
├── manifest/
│   └── manifest.json
└── keys/
    └── public-key.pem
```

접근 정책:

- Private Repository 기본
- LicenseHub는 GitHub App(최소 권한)으로 접근
- Personal Access Token 사용 금지
- 응용 SW에 GitHub 자격증명 포함 금지

### 5.6 내부 DB

GitHub에 저장하지 않는 관리·운영 데이터.

- User
- License
- 인증서 발급 정보
- Issue / Activation History
- Internal Status
- Audit Information
- GitHub 동기화 상태

## 6. Core 사용 시각화

### 6.1 Core의 두 사용 맥락

Core는 같은 Rust 라이브러리가 두 곳에서 각각의 책임만 사용한다.

```text
┌──────────────────────────────────────────────────────────────┐
│  사용 맥락 1: 발급 (Backend, Rust API 직접 호출)              │
│                                                              │
│   Backend ──▶ Issuer::issue() ──▶ 서명된 인증서              │
│                                                              │
│   ※ Private Key가 필요한 경로. 발급 전용 프로세스에서만 사용. │
├──────────────────────────────────────────────────────────────┤
│  사용 맥락 2: 검증 (응용 SW 내 LicenseGuard)                  │
│                                                              │
│   Rust 계열     ──▶ verify()            ──▶ Ok / Err         │
│   C 계열         ──▶ lh_verify_certificate() (C ABI) ──▶ 코드 │
│                                                              │
│   ※ Public Key만 필요. 배포물에 포함 가능. 발급 기능 없음.    │
└──────────────────────────────────────────────────────────────┘
```

### 6.2 발급 경로 (Rust API)

```text
Web App / 관리자
      │  License 발급 요청 (제품, 등급, 기간, Device, Metadata)
      v
Backend
      │  1. CertificateRequest 빌더로 요청 구성
      │  2. Issuer::issue()
      │       ├─ ① 요청 정책 검증  (등급별 필수 필드)
      │       ├─ ② 인증서 조립      (schema, id, dates, server, device)
      │       ├─ ③ canonicalization (서명 대상 바이트 생성)
      │       └─ ④ Ed25519 서명     (개인키, Drop 시 자동 소멸)
      │  3. 내부 DB 기록
      │  4. GitHub Repository 저장 (certificates/)
      └──────▶ 서명된 인증서 반환 → 사용자 다운로드
```

```rust
// 사용 예 (core/examples/issue_certificate.rs)
let issuer = Issuer::generate("license-signing-key-v1");
let request = CertificateRequest::new("LICENSE-2026-0001", 3, "DXi", "1.2.0")
    .verification_url("https://license.example.com/v1/verify")
    .device_id("example-device-id");
let certificate = issuer.issue(request)?;  // ← Core 사용 지점
let public_key = issuer.verifying_key();    // ← 배포할 공개키
```

### 6.3 검증 경로 (Rust API - 응용 SW가 Rust인 경우)

```text
LicenseGuard (응용 SW 내장)
      │  certificate, public_key, context
      v
verify(&certificate, &public_key, &context)
      ├─ ① Chain Depth / Schema
      ├─ ② Signature Verify          (공개키)
      ├─ ③ Metadata / Expiration
      ├─ ④ Level Policy              (L2 서버 상태, L3 Device)
      ├─ ⑤ Revocation / Blacklist
      ├─ ⑥ 하위 인증서 재귀 검증
      │
      ├─▶ Ok(())        → 핵심 기능 활성화
      └─▶ Err(VerificationError) → 기능 차단 (Fail-Closed)
```

```rust
// 사용 예
let result = verify(&certificate, &public_key, &VerificationContext::default());
if result.is_ok() {
    // 응용 SW 핵심 기능 활성화
}
```

### 6.4 검증 경로 (C ABI - C 등)

```text
LicenseGuard (C...)
      │  인증서 JSON 바이트 / 공개키 32B / Context JSON
      v
lh_verify_certificate(cert, cert_len, pub, pub_len, ctx, ctx_len, &result_code)
      │
      ├─ 0  : 요청 처리 성공 → result_code 로 실제 결과 확인
      │        (0 = 유효, 1~15 = 실패 사유)
      ├─ -1 : 인자 오류 (null, 공개키 길이 불일치, 크기 초과)
      └─ -2 : 입력 파싱 오류
```

```c
// 사용 예 (설명용 의사코드, core/include/licensehub_core.h 참고)
uint32_t code;
int32_t status = lh_verify_certificate(
    cert_json, cert_len,
    public_key, 32,
    ctx_json, ctx_len,
    &code);
if (status == 0 && code == LH_VALID) {
    // 응용 SW 핵심 기능 활성화
}
```

### 6.5 등급별 Core 사용 위치

| 등급 | 발급 시 Core | 검증 시 Core | Core 밖 추가 책임 |
|---|---|---|---|
| L1 | `Issuer::issue` | `verify` | 없음 (완전 오프라인) |
| L2 | `Issuer::issue` + 서버 URL | `verify` + 서버 상태 | Backend 활성화 API, Blacklist 조회 |
| L3 | `Issuer::issue` + Device ID | `verify` + Device 비교 | 현재 장치 ID 수집, 서버 검증 |

### 6.6 사용 관점의 핵심 규칙

```text
Private Key  ──▶ Issuer          (서버 전용, 사용 후 자동 소멸)
Public Key   ──▶ verify / lh_verify_certificate (배포 가능)
GitHub       ──▶ 인증서·공개키 배포 채널 (신뢰 근거가 아님)
신뢰 판정    ──▶ 전자서명 검증 결과로만 결정
```

## 7. 배포용 검증 라이브러리 (bindings)

### 7.1 개요

Core의 C ABI(`lh_verify_certificate`)를 C에서 호출할 수 있도록 만든 배포용
검증 라이브러리다. Rust는 `core/` 크레이트를 직접 경로 의존성으로 사용한다.

- 검증 기능만 포함: 발급·개인키·GitHub 자격증명 없음
- 두 바인딩 모두 동일한 픽스처(`bindings/testdata`)로 검증
- 고정 테스트 키로 만든 L1/L2/L3 인증서를 공용으로 사용

### 7.2 지원 언어 및 진입점

| 언어 | 위치 | 진입점 | 실행 |
|---|---|---|---|
| Rust | `core` 크레이트 자체 | `verify()` | `cargo test` |
| C | `bindings/c` | `lh_verify_certificate` | `./build.sh` |

### 7.3 공용 테스트 픽스처

`bindings/testdata/` 에는 고정 개인키(`[7u8; 32]`)로 생성된 L1/L2/L3
인증서, 공개키(32바이트), 검증 Context가 있다. 각 언어 바인딩은 이
픽스처로 다음을 검증한다.

- L1/L2/L3 유효 인증서 → VALID (0)
- 변조 인증서 → INVALID_SIGNATURE (4)

픽스처 재생성: `cargo run --example generate_bindings_fixtures`

### 7.4 빌드·배포

1. 네이티브 라이브러리 빌드: `core/build.sh` → `core/dist/<os>-<arch>/`
2. 언어별 자가 테스트 실행(위 표)
3. 배포 패키지 생성: `packaging/package.sh` → `distribute/`

`packaging/package.sh` 는 응용 개발자에게 전달할 패키지를 생성한다.

```text
distribute/
├── c/          헤더 + 정적/공유 라이브러리 + 예제
└── rust/       배포 안내
```

각 패키지는 네이티브 라이브러리와 검증 래퍼만 포함하며, 개인키·발급 기능·
GitHub 자격증명·테스트 픽스처는 제외한다.

### 7.5 보안 특성

- 모든 바인딩은 공개키 검증만 수행
- 개인키, 발급 기능, GitHub 자격증명 미포함
- 검증 결과가 유효한 경우에만 기능 활성화 (Fail-Closed)

## 8. 인증서 등급

| 등급 | 이름 | 검증 내용 | 특성 |
|---|---|---|---|
| L1 | Core Certificate | 서명·Metadata·만료 | 오프라인, 서버 불필요 |
| L2 | Secure Certificate | L1 + 서버 검증 + Blacklist/Revocation | 복사돼도 서버가 통제 |
| L3 | Device-Bound Certificate | L2 + Device Binding | 지정 장치에서만 활성화 |

### 검증 흐름

```text
Certificate
    -> Schema / Version
    -> Signature Verify
    -> Metadata / Product / Version
    -> Expiration
    -> Level Policy (L2/L3 서버 상태, Blacklist, Revocation)
    -> Device Binding (L3)
    -> Child Certificates (Chain)
    -> Activation Allowed
```

## 9. 주요 데이터 흐름

### 9.1 인증서 발급

```text
Admin/Developer -> Web App/API 로그인
    -> License 발급 요청 (제품, 등급, 기간, Device 등)
    -> Backend 권한·정책 검증
    -> Core로 인증서 생성 + Private Key 서명
    -> 내부 DB 기록
    -> GitHub Repository 저장 (certificates/)
    -> 인증서 다운로드 제공
```

### 9.2 응용 SW 활성화 (L2)

```text
응용 SW 시작 -> LicenseGuard가 인증서 로드
    -> 서명·Metadata·만료 검증 (Core)
    -> Backend 활성화 API 호출 (서버 상태 확인)
    -> Blacklist 조회 및 로컬 캐시 갱신
    -> 유효하면 핵심 기능 활성화
```

### 9.3 License 폐기 / Blacklist

```text
Admin이 License 폐기
    -> Backend가 내부 DB 상태 변경
    -> blacklist.json 갱신 (버전 증가) -> GitHub 저장
    -> 응용 SW가 주기적으로 Blacklist 갱신
    -> 폐기된 License는 활성화 거부
```

## 10. 보안 경계

- Private Key는 GitHub·DB·소스 코드·로그에 저장하지 않는다.
- Private Key는 암호화 파일 + 외부 Secret으로 보호하며, 발급 전용
  프로세스에서만 메모리에 존재한다.
- LicenseGuard와 배포물에는 GitHub Token, App Credential, Private Key가
  없다.
- 인증서 신뢰성은 GitHub 존재 여부가 아니라 전자서명으로 보장한다.
- GitHub에 존재한다와 유효한 License는 다른 개념이다.
- 오프라인 검증(L1)은 역공학을 절대적으로 막지 못한다. 강한 통제가
  필요한 제품은 L2/L3를 사용한다.

## 11. 현재 구현 상태

```text
구현 완료
├── licensehub-core (Rust)
│   ├── 인증서 발급·서명 (L1/L2/L3)
│   ├── 검증 (서명/Metadata/만료/서버/Blacklist/Device/체인)
│   ├── C ABI (lh_verify_certificate)
│   ├── OS별 빌드 스크립트 (build.sh)
│   ├── 인증서 발급 예제 (examples/issue_certificate.rs)
│   └── 픽스처 생성 예제 (examples/generate_bindings_fixtures.rs)
├── 배포용 검증 라이브러리 (bindings/)
│   └── C (verify_all.c)
├── 요구사항 문서 (docs/REQUIREMENTS.md)
├── Core 설계 문서 (docs/CORE_DESIGN.md)
└── 아키텍처 문서 (본 문서)

계획
├── Schema 고정 및 Test Vector
├── 표준 Canonicalization 확정
├── 키 회전 및 Revocation 모델
├── LicenseHub Backend/API
├── LicenseHub Web App
├── GitHub App 연동
├── Java/Kotlin·Go·Swift·WASM 바인딩
└── Private Key Loader
```

## 12. 개발 순서 권장

```text
완료
├── Core 발급·검증·C ABI
└── 배포용 검증 라이브러리 (C/Rust)

계획
├── Phase 1  Core Schema·Canonicalization·Test Vector 안정화
├── Phase 2  키 회전·Revocation·Blacklist 모델
├── Phase 3  Backend/API + 내부 DB
├── Phase 4  GitHub App 연동 + Repository 구조
├── Phase 5  Web App
└── Phase 6  잔여 바인딩 (Java/Kotlin·Go·Swift·WASM)
```