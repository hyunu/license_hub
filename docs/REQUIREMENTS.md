# LicenseHub 요구사항 정의서

## 1. 문서 개요

### 1.1 목적

LicenseHub는 소프트웨어 및 라이브러리의 배포 과정에서 라이선스를 발급하고, 설치 환경에서 라이선스의 유효성을 검증하여 기능 활성화를 제어하는 시스템이다.

본 문서는 LicenseHub의 기능, 구성요소, 데이터 저장 정책, 인증서 형식, 보안 요구사항 및 운영 요구사항을 정의한다.

> **요구사항 기준:** Application 보호 설계의 원본은 [`요구사항.png`](요구사항.png)이며,
> 이미지의 RS-1~9를 옮긴 [`IMAGE_REQUIREMENTS.md`](IMAGE_REQUIREMENTS.md)가 그 기준을
> 텍스트로 정리한다. 아래 13.5절의 확장 LH-REQ는 이미지에 직접 표시되지 않은
> 추가 제안이 포함되어 있으므로, 이미지 기준과 구분해 검토한다.

### 1.2 핵심 원칙

1. LicenseHub는 라이선스 발급, 인증서 생성, 전자서명 및 라이선스 상태 관리를 담당한다.
2. GitHub Repository는 인증서와 배포 상태 정보의 저장·배포 채널로 사용한다.
3. GitHub Repository는 LicenseHub의 내부 데이터베이스를 완전히 대체하지 않는다.
4. 인증서의 신뢰성은 GitHub의 존재 여부가 아니라 LicenseHub의 전자서명 검증으로 보장한다.
5. Client에는 GitHub Token, GitHub App Credential 또는 Private Key를 포함하지 않는다.
6. Private Key는 GitHub Repository에 저장하지 않는다.
7. 초기 GitHub Repository는 Private Repository로 운영한다.
8. 인증서 등급에 따라 Offline 검증과 서버 검증을 단계적으로 적용한다.

### 1.3 용어

| 용어 | 정의 |
|---|---|
| License | 특정 사용자, 제품 또는 장치에 소프트웨어 사용 권한을 부여하는 내부 관리 단위 |
| Certificate | License의 사용 권한과 검증 정보를 포함하고 Private Key로 서명된 배포 단위 |
| Client | 배포된 소프트웨어 또는 라이브러리에서 인증서를 검증하고 기능 활성화를 수행하는 모듈 |
| Core | 인증서 생성·서명·검증을 제공하는 공통 라이브러리 또는 서비스 모듈 |
| Blacklist | 사용이 금지된 License 또는 Certificate 목록 |
| Revocation | 발급된 License 또는 Certificate의 효력을 취소하는 행위 |

## 2. 시스템 범위

### 2.1 포함 범위

- LicenseHub Web Application
- LicenseHub Backend/API
- 인증서 생성 및 서명 Core 모듈
- 인증서 검증 Core 모듈 및 Client SDK
- 사용자 및 License 관리
- GitHub OAuth 기반 사용자 로그인
- GitHub App 기반 Private Repository 연동
- 인증서 저장, 다운로드 및 배포
- License 상태 확인, Blacklist 및 Revocation 처리
- 인증서 체인 및 중첩 인증서 검증
- 발급·활성화·변경에 대한 감사 이력 관리

### 2.2 제외 또는 제한 범위

- Client 변조 및 역공학을 절대적으로 방지하는 기능
- GitHub를 내부 사용자·License·감사 데이터의 유일한 데이터베이스로 사용하는 기능
- Client에 GitHub 자격증명을 배포하는 기능

오프라인 환경의 검증 로직은 Client 내부에 포함되므로 역공학으로 제거될 가능성을 완전히 차단할 수 없다. 따라서 L1은 서명 검증 및 변조 탐지 중심으로 제공하고, 강한 사용 통제가 필요한 경우 L2를 사용해야 한다.

## 3. 전체 아키텍처

```text
Developer / Administrator
            |
            v
       LicenseHub
  Web UI / Backend / Core
            |
        GitHub App
            |
            v
  Private GitHub Repository
            ^
            |
       LicenseHub API
            |
            v
       SW Client / SDK
```

### 3.1 주요 구성요소

#### LicenseHub Web Application

- 사용자 로그인
- License 발급 요청 및 관리
- 인증서 조회 및 다운로드
- License 상태 및 발급 이력 조회
- 관리자용 폐기·Blacklist 관리

#### LicenseHub Backend/API

- 사용자 및 권한 관리
- License 생성·조회·변경·폐기
- 인증서 발급 요청 검증
- 인증서 생성 및 서명 호출
- 활성화 및 서버 검증 API 제공
- GitHub Repository 동기화
- 감사 로그 기록

#### Core 모듈

Core는 발급 모듈과 검증 모듈로 구성한다.

- 발급 모듈: 인증서 생성, canonicalization, 서명
- 검증 모듈: 서명, Metadata, 만료 및 상태 검증
- 인증서 체인 및 중첩 인증서 검증
- 응용 SW가 활성화 상태를 확인할 수 있는 API 제공

#### SW Client / SDK

- 인증서 로드 및 형식 검증
- 서명 및 Metadata 검증
- 만료일 검증
- L2 서버 상태 검증
- Blacklist 캐시 조회
- 검증 결과에 따른 응용 SW 활성화 제어

## 4. 인증서 등급 요구사항

### 4.1 L1 Core Certificate

L1은 시스템 구축 또는 초기 라이브러리 활성화를 위한 기본 인증서다.

필수 검증 항목:

- Certificate 형식 검증
- LicenseHub Public Key를 이용한 Signature 검증
- Metadata 검증
- `expires_at` 검증

특성:

- 서버 연결 없이 검증 가능해야 한다.
- 인증서 자체만으로 활성화할 수 있어야 한다.
- Blacklist와 실시간 Revocation은 보장하지 않는다.

검증 순서:

```text
Certificate -> Signature -> Metadata -> Expiration -> Activation
```

### 4.2 L2 Secure Certificate

L2는 서버 기반 검증을 추가하여 발급 후 License 상태를 통제하는 인증서다.

필수 검증 항목:

- L1의 모든 검증 항목
- 인증서에 포함된 검증 서버 주소 확인
- 검증 서버 상태 확인 (주소는 발급 시 라이선스별로 입력하며 LicenseHub가 아니다)
- Blacklist 확인
- Revocation 상태 확인

특성:

- 인증서가 복사되더라도 서버에서 사용 여부를 통제할 수 있어야 한다.
- 서버 일시 장애 시 정책에 따라 캐시된 상태를 사용할 수 있어야 한다.

검증 순서:

```text
Certificate -> Signature -> Metadata -> Server Verification
            -> Blacklist / Revocation -> Activation
```

## 5. 인증서 요구사항

### 5.1 기본 구조

인증서는 다음 정보를 포함해야 한다.

```json
{
  "license_id": "XXXX-XXXX",
  "certificate_id": "CERT-XXXX",
  "level": 2,
  "product": "DXi",
  "version": "1.2.0",
  "issued_at": "2026-09-21T10:00:00Z",
  "expires_at": "2027-09-21T10:00:00Z",
  "server": { "verification_url": "https://license.example.com/v1/verify" },
  "metadata": {
    "activation_policy": "..."
  },
  "issuer": "LicenseHub",
  "signature_algorithm": "Ed25519",
  "signature": "..."
}
```

서버 검증 정보는 인증서 등급에 따라 선택적으로 포함한다.

### 5.2 서명 및 직렬화

- 서명 대상 필드와 제외 필드를 명시적으로 정의해야 한다.
- Metadata와 서명 대상 데이터는 deterministic canonicalization을 적용해야 한다.
- 날짜·문자열·숫자·배열·객체의 직렬화 규칙을 정의해야 한다.
- 서명 알고리즘과 키 포맷은 설정값으로 관리하되, 운영 환경에서는 승인된 알고리즘만 허용해야 한다.
- 서명 검증 실패 시 인증서를 유효하지 않은 것으로 처리해야 한다.
- 인증서 발급 시 사용한 Private Key의 식별자 또는 Key ID를 포함할 수 있어야 한다.

### 5.3 인증서 체인 및 중첩 인증서

- 인증서는 하나 이상의 하위 인증서를 포함할 수 있어야 한다.
- 상위 인증서는 하위 인증서의 발급 범위 또는 사용 권한을 제한할 수 있어야 한다.
- 모든 인증서의 서명, 유효기간, 발급자 및 권한 범위를 검증해야 한다.
- 체인 중간의 인증서가 폐기되면 하위 인증서도 정책에 따라 사용할 수 없어야 한다.
- 무한 중첩을 방지하기 위해 최대 체인 깊이를 설정해야 한다.

## 6. 주요 기능 요구사항

### 6.1 사용자 인증 및 권한

- GitHub OAuth를 통한 로그인을 지원해야 한다.
- LicenseHub 내부 User ID는 GitHub Account ID와 분리해야 한다.
- 향후 Email, Company SSO, Google, Microsoft 인증을 추가할 수 있도록 인증 계층을 분리해야 한다.
- 사용자, 관리자, 발급자 등 역할별 권한을 분리해야 한다.
- License 발급·폐기·조회 권한을 최소 권한 원칙으로 관리해야 한다.

### 6.2 License 관리

- License를 생성, 조회, 수정, 폐기할 수 있어야 한다.
- License별 제품, 버전, 등급, 대상 사용자 및 유효기간을 관리해야 한다.
- 하나의 License에서 인증서 재발급 이력을 관리해야 한다.
- 폐기된 License는 새 인증서 발급 대상이 될 수 없어야 한다.
- 모든 상태 변경을 감사 로그에 기록해야 한다.

### 6.3 인증서 발급

발급 흐름은 다음과 같다.

```text
Login -> License 발급 요청 -> 권한·정책 검증 -> 인증서 생성
      -> Private Key 서명 -> DB 기록 -> GitHub 저장 -> 다운로드 제공
```

- 발급 요청의 권한과 License 상태를 검증해야 한다.
- 인증서 생성 및 서명은 LicenseHub Backend 또는 신뢰된 Core 서비스에서 수행해야 한다.
- Private Key는 애플리케이션 로그, DB, GitHub에 노출되지 않아야 한다.
- 발급 결과는 내부 DB와 GitHub Repository에 일관되게 기록해야 한다.
- GitHub 저장 실패 시 발급 상태를 성공으로 확정하지 않거나 복구 가능한 대기 상태로 관리해야 한다.

### 6.4 활성화 및 검증

- Client는 GitHub에 존재한다는 사실만으로 인증서를 신뢰해서는 안 된다.
- Client는 항상 서명 검증을 먼저 수행해야 한다.
- 검증 실패 원인을 구분된 결과 코드로 반환해야 한다.
- 응용 SW의 핵심 기능은 검증 결과가 유효한 경우에만 활성화되어야 한다.
- L2는 서버 검증 실패 시 온라인·오프라인 정책에 따라 동작을 결정해야 한다.
- 검증 모듈은 응용 SW의 주요 기능 지점에서 호출할 수 있어야 한다.

### 6.5 Blacklist 및 Revocation

Blacklist는 다음과 같은 구조로 관리할 수 있다.

```json
{
  "version": 15,
  "updated_at": "2026-09-21T10:00:00Z",
  "licenses": ["XXXX-0001", "XXXX-0017", "XXXX-0032"]
}
```

- License 또는 Certificate를 폐기하고 Blacklist에 등록할 수 있어야 한다.
- Client는 Blacklist를 주기적으로 조회할 수 있어야 한다.
- Client는 Blacklist를 로컬 캐시할 수 있어야 한다.
- Blacklist 데이터에도 서명 또는 무결성 검증 수단을 적용해야 한다.
- Blacklist 버전과 갱신 시각을 제공해야 한다.
- 서버가 일시적으로 unavailable인 경우 캐시 사용 정책을 적용해야 한다.

## 7. GitHub Repository 요구사항

### 7.1 접근 정책

- 초기 Repository는 Private이어야 한다.
- LicenseHub 서버는 GitHub App을 통해 Repository에 접근해야 한다.
- GitHub Personal Access Token을 개발자에게 받아 서버 자격증명으로 사용해서는 안 된다.
- GitHub App에는 필요한 Repository에 한정하여 최소 권한을 부여해야 한다.
- 기본 권한은 Repository Contents Read/Write 및 Repository Metadata Read로 제한한다.
- SW Client에는 GitHub App Credential 또는 Token을 포함하지 않는다.

### 7.2 Repository 구조

```text
LicenseHub-Repository/
├── certificates/
│   ├── core/
│   │   └── {license-id}.json
│   ├── secure/
│   │   └── {license-id}.json
│       └── {license-id}.json
├── blacklist/
│   └── blacklist.json
├── manifest/
│   └── manifest.json
└── keys/
    └── public-key.pem
```

- 인증서 파일 경로는 인증서 등급별로 구분해야 한다.
- Public Key는 Client가 검증에 사용할 수 있도록 배포해야 한다.
- Private Key는 어떠한 경우에도 Repository에 저장하지 않는다.
- Git commit history를 통해 인증서 생성·변경·삭제 이력을 추적할 수 있어야 한다.
- 향후 공개 배포 데이터가 필요할 경우 Public Repository를 별도로 구성할 수 있어야 한다.

### 7.3 GitHub 동기화

- Repository 변경은 LicenseHub의 작업과 연결된 commit으로 기록해야 한다.
- GitHub API 오류, rate limit, 네트워크 오류에 대한 재시도 정책을 제공해야 한다.
- 동일 파일에 대한 동시 변경을 감지하고 충돌을 처리해야 한다.
- Repository 데이터는 서명 및 Schema 검증을 통과한 경우에만 Client에 제공해야 한다.

## 8. 내부 데이터베이스 요구사항

내부 DB는 GitHub에 저장하지 않는 관리·운영 데이터를 보관한다.

- User
- License
- Certificate 발급 정보
- Issue History
- Activation History
- Internal Status
- Audit Information
- GitHub 동기화 상태 및 오류 정보

GitHub Repository에는 Client가 실제 검증에 필요한 Certificate, Blacklist, Manifest, Public Key 및 Revocation 정보만 저장해야 한다.

## 9. 보안 요구사항

### 9.1 키 관리

- Certificate Signing Private Key는 KMS, HSM 또는 동등한 보안 저장소에서 관리해야 한다.
- Private Key는 소스 코드, 환경설정 파일, DB, GitHub 및 로그에 저장하지 않는다.
- 운영·스테이징·개발 키를 분리해야 한다.
- 키 교체를 지원해야 하며, 기존 인증서 검증을 위한 Public Key 버전 관리가 가능해야 한다.
- Private Key 접근은 최소 권한으로 제한하고 감사 로그를 남겨야 한다.

### 9.2 API 및 사용자 보안

- 모든 외부 통신은 HTTPS를 사용해야 한다.
- OAuth callback 및 세션을 안전하게 관리해야 한다.
- 발급, 폐기, 활성화 API에 인증·인가를 적용해야 한다.
- API rate limiting과 비정상 요청 탐지 기능을 제공해야 한다.
- 내부 식별자는 필요 이상으로 노출하지 않는다.
- 로그에 Token, Private Key, 전체 인증서 원문 등 민감정보를 기록하지 않는다.

### 9.3 Client 변조 대응

- 검증 모듈은 응용 SW의 핵심 모듈과 함께 배포해야 한다.
- 주요 기능 진입점에서 활성화 상태를 확인할 수 있어야 한다.
- Client SDK는 검증 결과를 위조하기 어렵도록 방어적 설계를 적용해야 한다.
- 단, 오프라인 Client는 완전한 역공학 방지가 불가능하므로 강한 통제가 필요한 제품은 L2를 사용해야 한다.

## 10. 비기능 요구사항

### 10.1 무결성 및 일관성

- 인증서와 Blacklist는 서명 또는 동등한 무결성 검증을 제공해야 한다.
- 내부 DB 상태와 GitHub 저장 상태의 차이를 탐지할 수 있어야 한다.
- 발급 작업은 중복 발급 및 부분 실패를 안전하게 처리해야 한다.

### 10.2 가용성 및 장애 대응

- GitHub API 일시 장애에 대비한 재시도와 작업 상태 복구를 제공해야 한다.
- L1은 LicenseHub 서버 장애와 무관하게 검증 가능해야 한다.
- L2의 서버 장애 시 허용 가능한 캐시 유효기간과 실패 정책을 정의해야 한다.
- 장애 및 복구 이벤트를 감사 로그에 남겨야 한다.

### 10.3 확장성

- 인증 방식, 제품 및 인증서 등급을 추가할 수 있어야 한다.
- Public Repository를 별도로 추가할 수 있어야 한다.
- 인증서 서명 알고리즘과 Public Key 버전을 교체할 수 있어야 한다.
- 다중 제품 및 제품별 License 정책을 지원해야 한다.

### 10.4 관측성

- 발급, 검증, 활성화, 폐기 및 GitHub 동기화 결과를 추적할 수 있어야 한다.
- 요청 ID 또는 작업 ID로 Web UI, Backend, DB 및 GitHub commit을 연결할 수 있어야 한다.
- 오류 코드와 운영자가 확인할 수 있는 진단 정보를 제공해야 한다.

## 11. 초기 릴리스 범위

초기 버전은 다음 범위로 구현한다.

- GitHub OAuth 로그인
- 사용자 및 License 기본 관리
- L1, L2 인증서 생성 및 검증
- Ed25519 기반 서명 또는 승인된 동등 알고리즘
- GitHub App 기반 Private Repository 연동
- Certificate, Blacklist, Manifest, Public Key 저장
- Certificate 다운로드
- L2 Activation API
- Blacklist 캐시
- 기본 감사 로그
- 운영 Private Key를 위한 외부 Secret/KMS 연동 지점

## 12. 수용 기준

다음 조건을 만족하면 핵심 요구사항을 충족한 것으로 판단한다.

1. 서명이 변경된 인증서는 L1/L2 모두에서 활성화되지 않는다.
2. Metadata 또는 제품·버전 정보가 변경된 인증서는 검증에 실패한다.
3. 만료된 인증서는 활성화되지 않는다.
4. L1은 서버 연결 없이 유효한 인증서를 검증할 수 있다.
5. L2는 Blacklist 또는 Revocation된 License를 활성화하지 않는다.
7. Client에는 GitHub 자격증명이 포함되지 않는다.
8. Private Key는 Repository, DB, 소스 코드 및 로그에 저장되지 않는다.
9. 인증서 발급과 GitHub 저장 실패 상태를 구분할 수 있다.
10. 인증서 변경 이력은 내부 감사 로그와 Git history에서 추적 가능하다.
11. 중첩 인증서의 모든 서명과 유효기간을 검증할 수 있다.
12. GitHub API 일시 장애에 대한 재시도 및 복구 동작을 확인할 수 있다.

## 13.5 추가 Application 보호 요구 후보 (이미지 RS-1~9와 구분)

> 본 절은 이미지 RS-1~9를 다른 문장과 알고리즘으로 확장한 **추가 제안**이다.
> 이미지의 명시 요구와 상충하거나 이미지에 없는 항목(Challenge-Response,
> Activation Token, RS-10~14 등)은 사용자 승인 전까지 규범 요구사항이 아니다.
> 이미지 기준은 [`IMAGE_REQUIREMENTS.md`](IMAGE_REQUIREMENTS.md)를 따른다.

### 13.5.1 시스템 구성

| 구성 | 역할 |
|---|---|
| P (License Payload) | 라이선스 원문 및 발급 조건 |
| X (License Hub 검증 모듈) | 라이선스 복호화, 서명 검증, Application 검증 |
| Y (Application 핵심 로직) | 실제 보호 대상이 되는 핵심 기능 |
| Z (Application) | X/Y를 포함하여 실제 실행되는 응용 프로그램 |
| LH_Pri | License Hub의 라이선스 발급용 개인키 |
| LH_Pub | License Hub의 서명 검증용 공개키 |
| Z_Pub | 특정 Application의 라이선스 암호화용 공개키 |
| Z_Pri | 특정 Application만 보유하는 개인키 |

기본 실행 관계:

```text
License Hub
    │
    │ P 생성
    ▼
[License Payload]
    │
    │ LH_Pri로 서명
    ▼
[Signed Payload]
    │
    │ Z_Pub으로 암호화
    ▼
[Encrypted License]
    │
    ▼
Application Z
    ├── Z_Pri
    ├── License X
    └── Core Logic Y
            │
            ▼
      라이선스 검증 성공 → Y 활성화
```

### 13.5.2 라이선스 발급 요구사항

**LH-REQ-001 — License Payload 구성**
다음을 포함하는 Payload를 생성해야 한다.

- 필수: Application ID, Target Language, Version, License Level, Owner,
  Expired Date, Meta Data
- 선택: Product ID, Feature ID, Issue Date, License ID, Build ID, Platform,
  Architecture, Maximum Instance, Application Public Key Hash

**LH-REQ-002 — Application ID는 라이선스의 핵심 식별자**
Application ID는 단순 문자열(예: `APP-001`)만 비교해서는 안 된다.
실제 검증에는 다음 Binding 정보가 함께 포함되어야 한다.

```text
Application ID
        +
Application Public Key
        +
Application Code/Package Identity
```

Application ID는 식별자이고, **공개키 기반의 암호학적 증명이 실제 인증 수단**이다.

### 13.5.3 라이선스 서명 요구사항

**LH-REQ-003 — License Payload 서명**

```text
P → Canonicalization → Hash → Sign(LH_Pri) → Signature
검증: LH_Pub + P + Signature → Verify
```

**LH-REQ-004 — 개인키의 외부 노출 금지**
LH_Pri는 Application, DLL, License 파일, SDK, Source Code, 설치 패키지에
포함되어서는 안 된다. 배포되는 것은 **LH_Pub뿐**이어야 한다.

### 13.5.4 라이선스 원문 보호 요구사항

**LH-REQ-005 — License Payload 암호화**
서명된 Payload는 Application의 Z_Pub으로 암호화해야 한다.
최종 배포 License에서 다음 정보가 직접 노출되어서는 안 된다.

- Application ID, Owner, Expired Date, Level, Meta Data, Feature, Version

```text
P → LH_Pri 서명 → Signed P → Z_Pub 암호화 → Encrypted License
```

**LH-REQ-006 — 라이선스 원문 직접 배포 금지**
`license.json` / `license.xml` / `license.ini` 형태의 원문+서명만으로는
요구사항을 만족하지 못한다. 최종 License는 **원문을 식별할 수 없는 암호문**
형태여야 한다.

**LH-REQ-007 — Base64는 암호화 수단이 아님**
`원문 → Base64`는 보안 요구사항을 충족하지 못한다. 반드시
`원문 → 암호화 → Binary Ciphertext → Base64` 순서로 처리한다.

### 13.5.5 암호화 방식 요구사항

**LH-REQ-008 — Hybrid Encryption**
License Payload 전체를 공개키 알고리즘으로 직접 암호화하기보다
AES-256-GCM + 공개키 래핑을 권장한다.

```text
License Payload
      │
      ▼
AES-256-GCM ──► Encrypted Payload
                 AES Session Key
                      │
                      ▼ Z_Pub
                 Encrypted AES Key

License {
    Version, KeyID, EncryptedKey, Nonce, Ciphertext,
    AuthenticationTag, Signature
}
```

### 13.5.6 Application 개인키 요구사항

**LH-REQ-009 — Application별 키쌍**
각 Application은 고유한 Key Pair를 가져야 한다. `Z_Pub_001`으로 암호화된
License는 `Z_Pri_002`로 복호화할 수 없어야 한다.

**LH-REQ-010 — Application 개인키 보호**
Z_Pri는 가능한 OS 보안 저장소에 저장한다.

- Windows: Windows Certificate Store, CNG Key Storage, TPM, DPAPI
- 형태: `Z_Pri → TPM/OS Key Store`

**LH-REQ-011 — Private Key Export 방지**
`app.key` / `private.pem` / `config.json` / `license.key` 등 일반 파일로
존재해서는 안 되며, 소스코드에 `const char* PRIVATE_KEY = "...";` 형태로도
저장하지 않는다.

### 13.5.7 License Hub 검증 순서

X는 다음 순서로 검증하며, **하나라도 실패하면 Deactivated** 상태가 된다.

```text
① License 수신 → ② 구조 검증 → ③ Application Key 확인 → ④ 복호화
→ ⑤ LH_Pub 서명 검증 → ⑥ Application ID → ⑦ Version → ⑧ Level
→ ⑨ Owner → ⑩ Expiration → ⑪ Meta Data → ⑫ Application Binding → ⑬ Activated
```

### 13.5.8 실행 중 Application 검증

**LH-REQ-012 — Challenge-Response**
X는 Application 실행 시 임의의 Challenge(Nonce)를 생성하고, Z가 Z_Pri로
서명한 값을 X가 등록된 Z_Pub으로 검증한다. License 파일만 복사한 공격자는
정상적인 Z_Pri가 없으므로 활성화할 수 없다.

```text
X ── Random Nonce ──► Z ── Sign(Z_Pri, Nonce + SessionInfo) ──► X ── Z_Pub 검증 ──► PASS
```

### 13.5.9 Application ID 생성 요구사항

**LH-REQ-013 — 언어별 Application ID 규칙 표준화**
C/C++/Rust/C# 등 언어에 따라 임의로 생성하지 않는다. C# 프로젝트 GUID에만
의존해서는 안 된다. 권장 구성:

```text
Application Identity
    ├── Application ID
    ├── Public Key
    ├── Product ID
    └── Build/Package Identity
```

필요 시 `Application ID = SHA-256(Application Public Key)` 방식으로 파생해
공개된 ID 자체를 특정 Application Key에 연결할 수 있다.

### 13.5.10 LH_Pub 내장 요구사항

**LH-REQ-014 — LH_Pub 내장**
X는 LH_Pub을 자체적으로 보유해야 하며, Application에서 전달받는 공개키를
그대로 사용해서는 안 된다(공격자의 키로 검증 우회 방지).

**LH-REQ-015 — LH_Pub 추출 난이도 향상**
일반 문자열(`const char* pubkey = "MIIBIjAN..."`) 형태를 피하고, 분할 +
런타임 조합 + 메모리 상 일시 복원을 적용할 수 있다. 단, 이는 RE 난이도를
높이는 **보조수단**이다.

**LH-REQ-016 — LH_Pub 메모리 최소 보유**
복원된 LH_Pub은 검증에 필요한 최소 시간 동안만 메모리에 존재하고, 검증
완료 후 Secure Zeroization한다. 공개키이므로 핵심 보안 요소는 아니며,
**LH_Pri 보호가 훨씬 중요하다.**

### 13.5.11 AK1 (Z_Pri) 보호 요구사항

**LH-REQ-017 — AK1 추출 난이도**
AK1을 단순 DLL/EXE 내부 문자열로 저장해서는 안 된다. 권장 우선순위:

1. TPM / Hardware-backed Key
2. OS Secure Key Store
3. OS Protected Key
4. 소프트웨어 암호화 저장
5. 난독화된 Binary 내장 (최후의 수단)

### 13.5.12 재사용·Replay 방지

**LH-REQ-018 — License Copy 방지**
APP-001용 License를 APP-002에 복사하면 반드시 실패해야 한다.
`Z_Pri_001` ↔ `License_001`은 PASS, `Z_Pri_002` ↔ `License_001`은 FAIL.

**LH-REQ-019 — Session Binding / Replay 방지**
검증에 Random Nonce, Session ID, Application Identity, Timestamp 등을
포함하며, Challenge-Response는 **매 실행 시 새로 생성**해야 한다.

### 13.5.13 만료 검증

**LH-REQ-020 — 만료 검증**
`Current Date > Expired Date → Deactivated`. 시스템 시간 롤백에 대비해 높은
보안 수준이 필요하면 별도 시간 검증 정책(서버 시간, TPM 시간 등)을 둔다.

### 13.5.14 Y 핵심 로직 보호

**LH-REQ-021 — Y는 검증 성공 후에만 활성화 (Activation Token)**

`if (LicenseValid()) return TRUE;` 같은 구조는 Patch에 취약하다.
X가 검증 후 **짧은 수명의 Activation Token**을 발급하고, Y는 Token 없이는
핵심 API를 실행하지 않는다. Token은 Application ID, Session ID, Feature,
Expiration, Nonce에 바인딩한다.

**사용 주체 (명확화)**
Activation Token은 **응용SW(Z) 내부에서만 사용하는 프로세스 내(In-process)
수단**이다. 외부 서버·파일·다른 응용SW가 사용하지 않는다.

- **발급자**: X(LicenseGuard — 응용SW에 내장되는 검증 코어)가 라이선스 검증
  성공 후 생성한다.
- **소비자**: Y(보호 대상 핵심로직)가 핵심 API 실행 전에 Token 존재·유효성을
  확인한다. Token 없이는 핵심 API를 실행하지 않는다.
- **전달 경로**: X → Y (Z 내부). 저장·전송·외부 노출 대상이 아니다. 짧은
  수명, 메모리 내 일시 보유.
- **목적**: 검증(X)과 기능 게이트(Y)를 분리해, X의 검증 함수를 패치하는
  것만으로는 핵심 기능이 열리지 않게 한다.

> 구현 상태: 2026-10-06 세션에서 호출처·테스트·C ABI가 전무해 **코드에서
> 제거됨**. 현재 `core`에 Activation Token 구현은 없다. 재도입 시 위 규약으로
> X→Y 내부 전달을 구현한다.

**LH-REQ-022 — DLL 단독 실행 방지**
X/Y DLL을 다른 Application에서 직접 로딩해도 핵심 기능이 실행되지 않아야
한다. APP-002가 동일 DLL을 로딩하면 FAIL이어야 한다.

### 13.5.15 무결성 검증

**LH-REQ-023 — Application 무결성 검증**
가능한 경우 실행 파일/패키지 무결성을 검증한다.

```text
Application Code → Hash → Registered Build Identity → Compare
```

OS Code Signing / Package Identity를 활용하되, Application Private Key와
결합해 사용하는 것이 좋다.

### 13.5.16 오류 처리

**LH-REQ-024 — 오류 원인 비노출**
내부적으로 ERR_SIGNATURE / ERR_DECRYPT / ERR_APPLICATION / ERR_EXPIRED /
ERR_VERSION / ERR_OWNER / ERR_FEATURE / ERR_KEY 등을 관리할 수 있으나,
Application에는 가급적 `LICENSE_INVALID` 정도로만 반환한다.

### 13.5.17 로그 요구사항

**LH-REQ-025 — 보안 이벤트 로그**
License Load, Validation, Signature, Application Binding, Activation,
Deactivation, Expiration, Invalid License를 로그에 남긴다. 단, License
Plaintext, Private Key, Decrypted Secret, AES Key는 로그에 남기지 않는다.

### 13.5.18 메모리 보안

**LH-REQ-026 — Plaintext 최소 보유**
복호화된 Payload와 키는 필요한 최소 시간 동안만 메모리에 존재해야 한다.
`Decrypt → Validate → 필요한 결과만 추출 → Plaintext 제거`.

### 13.5.19 언어 요구사항

**LH-REQ-027 — X/Y 구현 언어**
X와 Y는 메모리 안전성·바이너리 보안성을 고려해 C/C++ 또는 Rust로 구현할
수 있어야 한다. Rust의 목적은 Memory Safety, Buffer Overflow 방지,
Use-after-free 방지, Undefined Behavior 감소이며, 라이선스 보호 자체는
암호화/인증/Binding 구조로 보장한다.

### 13.5.20 보안 수준별 요구사항

| 등급 | 요구사항 |
|---|---|
| 기본 | License 서명 |
| 중간 | License 암호화 + 서명 |
| 높음 | Application별 Public/Private Key |
| 높음 | Application Private Key 보호 |
| 매우 높음 | Challenge-Response |
| 매우 높음 | OS/TPM Hardware-backed Key |
| 매우 높음 | Application Code/Package Identity Binding |
| 최고 | Remote Attestation / 서버 기반 검증 |

### 13.5.21 추가 RS 요구사항 (RS-10 ~ RS-14)

| ID | 핵심 요구사항 |
|---|---|
| RS-10 | License는 Application별 공개키에 암호학적으로 종속되어야 한다. |
| RS-11 | Application Private Key는 일반 파일/소스코드에 평문으로 저장되지 않아야 한다. |
| RS-12 | X는 License 검증뿐 아니라 Application이 해당 Private Key를 실제 보유하고 있음을 Challenge-Response로 검증해야 한다. |
| RS-13 | Y의 핵심 기능은 License 검증 결과 자체가 아닌, **X(LicenseGuard)가 검증 성공 후 발급한 Activation Token**(응용SW 내부 X→Y)이 있어야 실행한다. |
| RS-14 | 동일한 License 파일을 다른 Application으로 복사하여 사용할 수 없어야 한다. |

### 13.5.22 가장 중요한 보완점

- **Z_Pri(AK1)를 APP-001 내부에 평문으로 두지 않는다.** 단순 EXE/DLL 내장은
  공격자가 AK1을 추출할 수 있어 약점이다. 최종 설계는
  `APP-001 → AK1 → OS Secure Storage → TPM` 방향으로 구성한다.
- **LH_Pub 난독화보다 Z_Pri 보호가 훨씬 중요하다.** LH_Pub은 공개키라
  노출돼도 원칙적으로 보안이 깨지지 않지만, Z_Pri가 노출되면 APP-001의
  신원을 다른 프로그램이 사칭할 수 있다.

## 14. 후속 결정이 필요한 항목

다음 항목은 구현 전에 별도로 확정해야 한다.

- Backend, Web UI 및 Client SDK의 기술 스택
- 운영 환경과 배포 방식
- 서명 알고리즘 및 키 회전 주기
- L2 서버 장애 시 허용할 Offline Grace Period
- 인증서 체인의 최대 깊이와 권한 위임 규칙
- Blacklist 캐시 만료 및 강제 갱신 정책
- License 발급·재발급·양도 정책
- 개인정보 보관 기간
- SLA, 예상 발급량 및 동시 활성화 요청량

Application 보호(LH-REQ) 추가 확정 항목:

- Application별 키쌍(Z_Pub/Z_Pri)의 발급·배포·폐기 절차
- Z_Pri 저장 방식 (TPM / OS Key Store / 보호 저장소 중 선택)
- Application ID 파생 규칙 (SHA-256(Public Key) 방식 채택 여부)
- Activation Token 구조·수명·갱신 주기, X→Y 내부 전달 경로(및 C ABI 노출 여부)
- Challenge-Response 세부 규칙 (Nonce 크기, SessionInfo 구성)
- X/Y 모듈의 난독화 수준과 LH_Pub 분산 저장 방식
