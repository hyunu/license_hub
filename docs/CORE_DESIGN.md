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
- C보다 런타임 메모리 오류 위험이 낮다.
- Windows, Linux, macOS용 네이티브 라이브러리로 빌드할 수 있다.
- C ABI를 제공할 수 있다.

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

### 5.3 보호 목적과 체인 설계

**목적**: 코어로직(라이브러리)이 승인된 응용SW A에서만 동작하게 하고, 코어를 복사해 무분별하게 다른 응용SW를 만드는 재사용을 막는다.

**원칙**:
- 라이선스(앱 정보)와 서명은 **한 인증서에 함께** 둔다. 분리하면 클라이언트가 둘을 결합해야 하고 위조 여지가 생긴다.
- **공개키는 인증서에 넣지 않고 별도 신뢰 경로**로 배포한다. 인증서에 넣으면 공격자가 라이선스+서명+공개키를 함께 교체할 수 있기 때문이다.

**X / Y 케이스**:

| | X | Y |
|---|---|---|
| 내용 | `A설명`(제품명·버전·빌드해시) + K1 서명 | `A공개키` + K2 서명 |
| 검증 키 | 코어 내장 K1 (분산 저장) | A에 배포된 CA 인증서(K2) |
| 용도 | 응용SW 핵심로직 방어 | 응용SW 활성화 / 서브CA 승인 |

- 케이스1 = X만, 케이스2 = Y만, 케이스3 = X+Y
- X는 제품 정품성·코어 방어(제품 단위), Y는 설치/키 단위 활성화. "특정 설치/장치 전용"은 X만으로 불가능하며 L3 장치 바인딩이나 Y(설치 고유 키)와 조합해야 한다.

**체인의 두 축**:
1. **등급 체인** (`Certificate.children`): 응용SW 활성화(2차) → 코어로직 활성화(1차). 자식 인증서 하나라도 실패하면 전체 실패(`ChainInvalid`) → 코어로직 차단. `max_chain_depth`(기본 3).
2. **키 체인** (루트 키 → 서명 키): 루트가 서명 키 공개키를 승인(키 인증서). 키 회전·위조 방지용. 현재는 미구현이며, 구현 시 `Certificate.public_key` 필드와 2단계 검증이 필요하다.

**위협 모델**: 순수 클라이언트(오프라인)로는 **전체 설치본 복제를 막을 수 없다.** 클라이언트 방식이 막는 것은 (a) 라이선스 파일 단독 공유, (b) 코어로직의 다른 앱 재사용(무분별한 재사용)이다. 결정적 공격자(패치/우회)까지는 하드웨어 앵커(TPM)나 서버 활성화가 필요하다.

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

### 6.3 내장 신뢰 공개키 (K1, 분산 저장)

응용SW 핵심로직 방어(X) 용도의 신뢰 공개키는 평문 상수로 두지 않는다. `core/src/trusted.rs`가 32바이트 키를 4조각으로 쪼개 각 조각을 마스크(XOR)로 감싸고 저장 순서를 섞은 뒤, 사용 시점에만 재조립한다.

- 내부 `trusted::trusted_public_key()`: 재조립 후 무결성 해시(`KEY_SHA256`)를 확인한다. 외부 ABI로 LK2를 반환하지 않는다.
- `trusted::verify_trusted(cert, ctx)`: **키를 함수 밖으로 노출하지 않고** 재조립 → 검증 → 파기한다. X 케이스는 이 경로를 사용해 키가 검증 순간에만 메모리에 존재한다.
- `Issuer::issue_x(AppIdentity)`: 응용SW 정체성(제품명·버전·product_id·executable_name)을 입력받아 X를 **K1 개인키로 서명**한다. 발급 직후 내장 K1 공개키로 자체 검증해, K1이 아닌 키로 발급하면 오류를 돌려준다.
- 키 파기: 재조립 버퍼는 사용 직후 `zeroize`로 0으로 덮어쓴다. 외부에서 LK2를 추출하는 `lh_trusted_public_key` ABI는 제공하지 않는다.
- `gen_trusted_key` 예제: 새 K1 키 쌍을 생성하거나 주어진 공개키로 분산 상수를 출력한다. 개인키는 라이선스 서버의 `LICENSEHUB_SIGNING_KEY`로 설정하며 저장소에 커밋하지 않는다.
- C ABI: `lh_verify_trusted_certificate`와 `lh_decrypt_verify_trusted_license`로 LK2를 호출자에게 노출하지 않고 X 검증 및 LIC 검증을 제공한다.

보안 한계: 재조립 후 검증 순간의 메모리 스냅샷에는 키가 잠깐 존재할 수 있어 동적 분석으로 추출 가능하다. 정적 분석·지속 보존을 막는 장치이며 절대적 보호는 아니다.

### 6.4 호스트 특이점 대조 (X의 응용SW 바인딩)

X(설명 인증서)가 "코어로직이 승인된 응용SW A에서만 동작"하도록 하기 위해, 코어는 호스트 앱이 제공한 특이점(제품명·버전)을 서명된 정보와 대조한다. `VerificationContext.product/version`을 채워 `verify`(및 `verify_trusted`)를 호출하면 불일치 시 `PolicyRejected`로 거부한다(fail closed).

- 서명 검증: K1(내장 분산 키)로 X의 무결성 확인
- 호스트 대조: `context.product/version` vs X의 서명된 `product/version`
- 고유값 대조: 프로젝트 파일의 `product_id`(GUID 등)를 X의 `metadata["product_id"]`에 서명으로 포함하고, 호스트가 등록한 값과 대조. 불일치 시 `PolicyRejected`
- 실행 파일 이름 대조: X의 `metadata["executable_name"]`과 호스트가 측정한 실행 파일 이름(`host_executable_name()`, 확장자 제거 basename)을 대조. 실행 파일 이름은 리빌드해도 불변이라 개발 무중단
- 모듈 이름 대조: 응용SW 로직을 DLL/공유 라이브러리로 분리한 경우 `current_exe()`는 호스트 .exe를 반환하므로, **lh_core가 포함된 모듈**의 이름(`host_module_name()`: POSIX `dladdr`/Windows `GetModuleHandleEx`)으로 바인딩한다. 단독 exe면 exe 이름, DLL 로드면 그 DLL 이름
- 개발 편의: 빌드해시를 쓰지 않으므로 리빌드와 무관. 버전을 생략하면 제품명만 대조해 개발 중 주버전 내 수정도 허용
- 재사용 방지: 코어를 다른 앱 B에 임베드하면 B의 제품명/고유값/실행 파일 이름 ≠ X → 거부

### 6.5 바인딩 정체성의 선택

호스트 바인딩에 쓰는 "특이점"은 위협 모델과 개발 편의의 균형으로 결정한다.

| 정체성 | 출처 | 리빌드 | 복사 내성 | 비고 |
|---|---|---|---|---|
| 제품명/버전 | 프로젝트 파일 | 불변 | 낮음(위장 가능) | 개발 무중단, 기본 |
| `product_id`(GUID) | 프로젝트 파일 | 불변 | 낮음 | 앱 단위 구분 강화 |
| 실행 파일 이름 | `current_exe()` | 불변 | 중간 | 단독 exe용 |
| **모듈(DLL) 이름** | `dladdr`/`GetModuleHandleEx` | 불변 | 중간 | 응용SW 로직을 DLL로 분리 시 |
| 설치 토큰 | 최초 실행 시 생성 | 불변 | 라이선스 단독 공유는 차단 | 플랫폼 독립, "설치 전용" |
| 기기 ID | OS별 API | 불변 | 높음(하드웨어 귀속) | "장치 전용", OS별 구현 필요 |

원칙: **순수 클라이언트로는 전체 설치본 복제를 막을 수 없다.** 클라이언트 바인딩이 막는 것은 "라이선스 파일 단독 공유" 또는 "코어로직의 다른 앱 재사용"까지다. 전체 복제까지 막으려면 하드웨어 앵커(TPM 등)나 서버 활성화가 필요하다.

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
- `product_id`(프로젝트 고유값), `executable_name`(실행 파일/모듈 이름) — X 호스트 바인딩
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
3. C 헤더

구현 현황:

- 완료: Rust(`verify`/`verify_trusted`), C ABI(`lh_verify_certificate`,
  `lh_verify_trusted_certificate`, `lh_decrypt_verify_trusted_license`),
  C 헤더 — `bindings/c` 참고
- 완료: K1 내장 신뢰 공개키(분산 저장·zeroize), 호스트 바인딩 검증
  (`product_id`/`executable_name`/모듈 이름)

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
- `product_id`(고유값) 불일치
- `executable_name`/모듈 이름 불일치
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

Rust에서 발급한 인증서를 C 검증기가 동일하게 검증해야 한다.

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
- C 헤더 배포
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
