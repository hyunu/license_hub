# LicenseHub Core 설계서

## 1. 목적

LicenseHub Core는 인증서의 생성, 서명, 파싱 및 검증을 제공하는 공통 모듈이다. GitHub API, DB, HTTP 서버, OAuth 및 UI는 Core의 책임 범위에 포함하지 않는다.

Core는 서버의 인증서 발급 기능과 배포된 SW Client의 인증서 검증 기능에서 공통으로 사용할 수 있어야 하며, 여러 프로그래밍 언어에서 호출할 수 있는 안정적인 API를 제공해야 한다.

## 2. 설계 원칙

1. 인증서 검증 규칙은 모든 지원 언어에서 동일해야 한다.
2. 서명 대상 데이터의 canonicalization 규칙을 고정한다.
3. Core는 네트워크와 저장소에 의존하지 않는 순수 모듈로 유지한다.
4. Private Key는 Client 배포물에 포함하지 않는다.
5. 발급과 검증 기능을 논리적으로 분리한다.
6. 검증 실패 시 안전하게 비활성화하는 Fail-Closed 정책을 적용한다.
7. 외부 언어에는 안정적인 C ABI를 제공하고, 언어별 Wrapper를 별도로 둔다.
8. 인증서 Schema와 검증 결과 코드는 하위 호환성을 고려하여 버전 관리한다.

## 3. 기술 방향

### 3.1 구현 언어

Core는 Rust로 구현한다.

Rust를 사용하는 이유:

- 메모리 안전성이 필요한 인증·검증 로직에 적합하다.
- C/C++보다 런타임 메모리 오류 위험이 낮다.
- Windows, Linux, macOS용 네이티브 라이브러리로 빌드할 수 있다.
- C ABI와 WebAssembly를 제공할 수 있다.
- C#, Java, Python, Go, Swift 등에서 연동할 수 있다.

### 3.2 모듈 구성

```text
licensehub-core/
├── model          인증서 및 Metadata 자료구조
├── canonical      서명 대상 canonicalization
├── crypto         키, 서명, 서명 검증
├── certificate    인증서 생성 및 파싱
├── verify         등급별 검증 파이프라인
├── chain          중첩·체인 인증서 검증
├── ffi            외부 언어용 C ABI
└── test-vectors   언어 간 호환성 테스트 데이터
```

발급 기능과 검증 기능은 API 수준에서 분리한다.

```text
Issuer
├── certificate builder
├── canonicalization
└── signing

Verifier
├── parsing
├── signature verification
├── metadata / expiration
├── blacklist / revocation result handling
├── device binding
└── certificate chain
```

## 4. 책임 경계

### 4.1 Core가 담당하는 기능

- 인증서 형식 및 Schema 검증
- 인증서 생성용 자료구조 조립
- canonicalization
- Private Key를 이용한 서명
- Public Key를 이용한 서명 검증
- Metadata 및 유효기간 검증
- Device Binding 값 검증
- 중첩 인증서와 인증서 체인 검증
- 검증 결과 코드 반환

### 4.2 Core가 담당하지 않는 기능

- GitHub Repository 접근
- Blacklist 다운로드 및 캐시 저장
- LicenseHub API 호출
- OAuth 및 사용자 인증
- DB 접근
- Private Key 외부 Secret 조회
- 운영자 권한 승인
- 응용 SW의 실제 기능 차단 로직

Blacklist와 서버 상태는 호출자가 가져와 Core에 검증 입력으로 전달한다. 이를 통해 Core를 네트워크에 독립적으로 유지한다.

## 5. 인증서 모델

### 5.1 기본 형식

```json
{
  "schema_version": 1,
  "certificate_id": "CERT-XXXX",
  "license_id": "XXXX-XXXX",
  "level": 3,
  "product": "DXi",
  "version": "1.2.0",
  "issued_at": "2026-09-21T10:00:00Z",
  "expires_at": "2027-09-21T10:00:00Z",
  "issuer": "LicenseHub",
  "server": {
    "verification_url": "https://license.example.com/v1/verify"
  },
  "device": {
    "binding_type": "device-id",
    "value": "BASE64URL-ENCODED-HASH"
  },
  "metadata": {
    "activation_policy": "..."
  },
  "children": [],
  "signature_algorithm": "Ed25519",
  "key_id": "license-signing-key-v1",
  "signature": "BASE64URL-ENCODED-SIGNATURE"
}
```

필드 정책:

- `schema_version`: 필수. 인증서 Schema 버전이다.
- `certificate_id`: 필수. 개별 인증서 식별자다.
- `license_id`: 필수. 내부 License와 연결되는 공개 식별자다.
- `level`: `1`, `2`, `3` 중 하나다.
- `issued_at`, `expires_at`: RFC 3339 UTC 형식만 허용한다.
- `server`: L2 이상에서 필수다.
- `device`: L3에서 필수이며 L1/L2에서는 없어야 한다.
- `children`: 중첩 인증서가 없으면 빈 배열이어야 한다.
- `signature`: 모든 필드 검증 후 마지막에 검증한다.

### 5.2 서명 대상

`signature` 필드와 전송 과정에서 파생되는 값은 서명 대상에서 제외한다. 나머지 필드를 canonicalization한 결과를 서명한다.

```text
signing_payload = Canonicalize(certificate without signature)
signature = Sign(private_key, signing_payload)
```

canonicalization은 다음을 보장해야 한다.

- 객체 키 정렬
- 고정된 UTF-8 인코딩
- 공백 제거
- 숫자 표현 정규화
- UTC 날짜 표현 정규화
- 배열 순서 보존
- 허용되지 않은 추가 필드 처리 규칙

구현 전에 JSON Canonicalization Scheme(JCS) 사용 여부를 확정하고, 모든 언어에서 동일한 Test Vector를 통과시켜야 한다.

## 6. 서명 및 키 처리

### 6.1 알고리즘

초기 Core는 Ed25519를 우선 검토한다. 최종 알고리즘은 사용 대상 플랫폼과 외부 키 관리 방식의 지원 여부를 확인한 뒤 확정한다.

- 서명 결과가 작고 빠르다.
- 검증 키를 Client에 배포하기 적합하다.
- 서명과 검증 API가 단순하다.

알고리즘은 인증서의 `signature_algorithm`으로 식별하며, 허용 목록 밖의 알고리즘은 거부한다.

### 6.2 Private Key 사용

Core는 Private Key를 안전하게 보관하지 않는다. 발급 애플리케이션이 외부에서 키를 공급하고, Core는 서명 작업에 사용한다.

초기 운영 방식:

```text
Encrypted Private Key File
        +
External Secret / Passphrase
        |
        v
LicenseHub Issuer Process
        |
        v
Core sign()
```

요구사항:

- 암호화된 키 파일과 복호화 Secret을 동일한 저장소에 두지 않는다.
- Secret을 소스 코드, GitHub Repository, Container Image, 로그에 저장하지 않는다.
- 서명 프로세스는 전용 OS 사용자로 실행한다.
- 서명 완료 후 불필요한 키 자료를 메모리에서 즉시 폐기하도록 한다.
- 키 로딩 실패 시 발급을 중단한다.
- Private Key는 Client SDK와 배포 패키지에 포함하지 않는다.

이 방식은 초기 단계의 저장 방식이며, 향후 KMS/HSM 또는 별도 Signing Service로 교체할 수 있도록 `Signer` 추상화를 둔다.

```text
trait Signer {
    fn sign(&self, payload: &[u8]) -> Result<Signature>;
    fn key_id(&self) -> &str;
}
```

## 7. 검증 파이프라인

검증은 순서가 고정된 파이프라인으로 구현한다.

```text
Input Size / Encoding
        |
Schema / Version
        |
Parse Fields
        |
Canonicalization
        |
Signature Verification
        |
Metadata / Product / Version
        |
Expiration
        |
Level Policy
        |
Server Status / Blacklist / Revocation
        |
Device Binding
        |
Child Certificates
        |
Activation Allowed
```

원칙:

- 하나라도 실패하면 최종 결과는 실패다.
- 검증 순서를 호출자가 임의로 생략할 수 없도록 단일 검증 API를 제공한다.
- L1은 서버 상태 검증을 수행하지 않는다.
- L2는 서버 검증 결과를 필수로 요구한다.
- L3는 서버 검증과 Device Binding을 모두 요구한다.
- 만료일은 로컬 시간 조작의 영향을 고려한 정책을 별도로 정의한다.
- 실패 원인은 진단 가능해야 하지만 개인키, 내부 경로 및 Secret은 노출하지 않는다.

## 8. 검증 입력과 출력

### 8.1 입력

```text
certificate_bytes
public_key
verification_context
```

`verification_context`에는 다음 값을 포함할 수 있다.

- 현재 시각
- 제품 및 버전
- 현재 Device Binding 값
- 서버 검증 결과
- Blacklist/Revocation 결과
- 허용된 정책 및 최대 체인 깊이

### 8.2 출력

검증 결과는 성공 여부와 고정된 오류 코드를 함께 반환한다.

```text
VALID
INVALID_FORMAT
UNSUPPORTED_SCHEMA
UNSUPPORTED_ALGORITHM
INVALID_SIGNATURE
INVALID_METADATA
EXPIRED
NOT_YET_VALID
SERVER_REQUIRED
SERVER_REJECTED
REVOKED
BLACKLISTED
DEVICE_MISMATCH
CHAIN_INVALID
CHAIN_TOO_DEEP
POLICY_REJECTED
INTERNAL_ERROR
```

오류 코드는 언어별 문자열이 아니라 안정적인 정수 또는 명시된 enum 값으로도 제공한다.

## 9. 다국어 API

### 9.1 외부 인터페이스

Rust 내부 자료구조를 직접 노출하지 않고 C ABI를 제공한다.

```c
int lh_verify_certificate(
    const uint8_t *certificate,
    size_t certificate_len,
    const uint8_t *public_key,
    size_t public_key_len,
    const uint8_t *device_id,
    size_t device_id_len,
    const uint8_t *context,
    size_t context_len,
    uint32_t *result_code
);
```

FFI 원칙:

- 소유권이 모호한 포인터를 반환하지 않는다.
- 호출자가 전달한 버퍼의 수명만 사용한다.
- Rust panic이 FFI 경계를 넘어가지 않도록 한다.
- 버퍼 길이를 항상 함께 전달한다.
- 문자열 대신 UTF-8 바이트와 길이를 사용한다.
- ABI 버전을 별도로 제공한다.

### 9.2 지원 순서

1. Rust 내부 API
2. C ABI
3. C/C++ 헤더
4. C# P/Invoke Wrapper
5. Python `cffi` Wrapper
6. Java/Kotlin JNI 또는 JNA Wrapper
7. Go cgo Wrapper
8. Swift 및 WebAssembly 지원

## 10. 보안 요구사항

- 인증서 입력 크기, Metadata 크기 및 체인 깊이에 제한을 둔다.
- 검증 과정에서 외부 URL을 직접 호출하지 않는다.
- URL 검증과 서버 통신은 Backend 또는 Client Adapter의 책임으로 둔다.
- 서명 비교 및 검증은 검증된 암호 라이브러리를 사용한다.
- 자체 암호 알고리즘이나 자체 난수 생성기를 구현하지 않는다.
- 인증서의 알 수 없는 필드는 Schema 정책에 따라 거부하거나 명시적으로 무시한다.
- 중첩 인증서 순환 참조를 감지한다.
- 검증 실패 시 부분적으로 활성화된 상태를 반환하지 않는다.
- 개인키를 포함한 로그와 오류 출력을 금지한다.

## 11. 테스트 전략

### 11.1 단위 테스트

- 유효한 인증서 생성 및 검증
- Signature 변경
- Metadata 변경
- 만료 및 미래 발급일
- 제품·버전 불일치
- L1/L2/L3별 필수 필드
- Device 불일치
- Blacklist 및 Revocation 결과
- 잘못된 Schema와 알고리즘
- 최대 체인 깊이 및 순환 참조

### 11.2 호환성 테스트

언어별 Wrapper는 동일한 Test Vector를 사용해야 한다.

```text
test-vectors/
├── valid-l1.json
├── valid-l2.json
├── valid-l3.json
├── invalid-signature.json
├── expired.json
└── device-mismatch.json
```

Rust에서 발급한 인증서를 C#, Python, Java 및 Go 검증기가 동일하게 검증해야 한다.

### 11.3 보안 테스트

- 인증서 입력 크기 제한
- 비정상 JSON 중첩
- 서명 알고리즘 변경
- 키 ID 혼동
- 체인 순환 참조
- FFI 버퍼 길이 오류
- Null 포인터 및 빈 입력
- Panic이 FFI 밖으로 전파되는지 여부

## 12. 단계별 구현 계획

### Phase 1: 포맷과 암호화 기반

- Certificate Schema 확정
- canonicalization 방식 확정
- 서명 알고리즘 확정
- Rust 내부 model 및 crypto 모듈 구현
- Test Vector 작성

### Phase 2: 검증기

- L1 검증 파이프라인 구현
- L2/L3 검증 Context 구현
- Device Binding 구현
- 중첩 인증서 검증 구현
- 오류 코드 고정

### Phase 3: 발급기

- Certificate Builder 구현
- `Signer` 추상화 구현
- 암호화 Private Key Loader 구현
- 발급·서명 테스트 구현

### Phase 4: FFI 및 Wrapper

- C ABI 구현
- C/C++ 헤더 배포
- C# 및 Python Wrapper 구현
- 언어 간 Test Vector 검증

## 13. 확정이 필요한 사항

- JSON Canonicalization Scheme(JCS) 사용 여부
- Ed25519와 다른 알고리즘의 최종 선택
- 인증서의 알 수 없는 필드 처리 정책
- 인증서 최대 크기 및 중첩 최대 깊이
- Device ID 생성 규칙과 OS별 구현
- 서명 시점에 Private Key를 메모리에 유지하는 범위
- 암호화 Private Key 파일의 포맷과 외부 Secret 공급 방식
- C ABI의 초기 지원 운영체제 및 CPU 아키텍처
