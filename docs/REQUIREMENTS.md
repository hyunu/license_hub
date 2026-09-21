# LicenseHub 요구사항 정의서

## 1. 문서 개요

### 1.1 목적

LicenseHub는 소프트웨어 및 라이브러리의 배포 과정에서 라이선스를 발급하고, 설치 환경에서 라이선스의 유효성을 검증하여 기능 활성화를 제어하는 시스템이다.

본 문서는 LicenseHub의 기능, 구성요소, 데이터 저장 정책, 인증서 형식, 보안 요구사항 및 운영 요구사항을 정의한다.

### 1.2 핵심 원칙

1. LicenseHub는 라이선스 발급, 인증서 생성, 전자서명 및 라이선스 상태 관리를 담당한다.
2. GitHub Repository는 인증서와 배포 상태 정보의 저장·배포 채널로 사용한다.
3. GitHub Repository는 LicenseHub의 내부 데이터베이스를 완전히 대체하지 않는다.
4. 인증서의 신뢰성은 GitHub의 존재 여부가 아니라 LicenseHub의 전자서명 검증으로 보장한다.
5. Client에는 GitHub Token, GitHub App Credential 또는 Private Key를 포함하지 않는다.
6. Private Key는 GitHub Repository에 저장하지 않는다.
7. 초기 GitHub Repository는 Private Repository로 운영한다.
8. 인증서 등급에 따라 Offline 검증, 서버 검증 및 Device Binding을 단계적으로 적용한다.

### 1.3 용어

| 용어 | 정의 |
|---|---|
| License | 특정 사용자, 제품 또는 장치에 소프트웨어 사용 권한을 부여하는 내부 관리 단위 |
| Certificate | License의 사용 권한과 검증 정보를 포함하고 Private Key로 서명된 배포 단위 |
| Client | 배포된 소프트웨어 또는 라이브러리에서 인증서를 검증하고 기능 활성화를 수행하는 모듈 |
| Core | 인증서 생성·서명·검증을 제공하는 공통 라이브러리 또는 서비스 모듈 |
| Device Binding | 인증서를 특정 PC 또는 장치의 식별 정보에 귀속하는 기능 |
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
- Device-Bound 인증서 발급 및 검증
- 인증서 체인 및 중첩 인증서 검증
- 발급·활성화·변경에 대한 감사 이력 관리

### 2.2 제외 또는 제한 범위

- Client 변조 및 역공학을 절대적으로 방지하는 기능
- GitHub를 내부 사용자·License·감사 데이터의 유일한 데이터베이스로 사용하는 기능
- Client에 GitHub 자격증명을 배포하는 기능

오프라인 환경의 검증 로직은 Client 내부에 포함되므로 역공학으로 제거될 가능성을 완전히 차단할 수 없다. 따라서 L1은 서명 검증 및 변조 탐지 중심으로 제공하고, 강한 사용 통제가 필요한 경우 L2 또는 L3를 사용해야 한다.

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
- 검증 모듈: 서명, Metadata, 만료, 상태 및 Device Binding 검증
- 인증서 체인 및 중첩 인증서 검증
- 응용 SW가 활성화 상태를 확인할 수 있는 API 제공

#### SW Client / SDK

- 인증서 로드 및 형식 검증
- 서명 및 Metadata 검증
- 만료일 검증
- L2/L3 서버 상태 검증
- Blacklist 캐시 조회
- Device Binding 검증
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
- LicenseHub 서버 상태 확인
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

### 4.3 L3 Device-Bound Certificate

L3는 특정 PC 또는 장치에 귀속되는 인증서다.

필수 검증 항목:

- L2의 모든 검증 항목
- 발급 시 포함된 Device 정보 확인
- 활성화 시 현재 Device 정보 계산
- 발급된 Device 정보와 현재 Device 정보 비교

특성:

- 지정된 장치에서만 활성화할 수 있어야 한다.
- Device 식별값은 원문 대신 해시 또는 안전한 파생값으로 저장할 수 있어야 한다.
- Device 식별 방식은 운영체제별로 확장 가능해야 한다.

검증 순서:

```text
Certificate -> Signature -> Metadata -> Server Verification
            -> Blacklist / Revocation -> Device Binding -> Activation
```

## 5. 인증서 요구사항

### 5.1 기본 구조

인증서는 다음 정보를 포함해야 한다.

```json
{
  "license_id": "XXXX-XXXX",
  "certificate_id": "CERT-XXXX",
  "level": 3,
  "product": "DXi",
  "version": "1.2.0",
  "issued_at": "2026-09-21T10:00:00Z",
  "expires_at": "2027-09-21T10:00:00Z",
  "device_id": "DEVICE-ID",
  "metadata": {
    "activation_policy": "..."
  },
  "issuer": "LicenseHub",
  "signature_algorithm": "Ed25519",
  "signature": "..."
}
```

`device_id`와 서버 검증 정보는 인증서 등급에 따라 선택적으로 포함한다.

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
- License별 제품, 버전, 등급, 대상 사용자, 유효기간 및 Device 정책을 관리해야 한다.
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
- L2/L3는 서버 검증 실패 시 온라인·오프라인 정책에 따라 동작을 결정해야 한다.
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
│   └── device-bound/
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
- 민감한 Device Metadata와 내부 식별자는 필요 이상으로 노출하지 않는다.
- 로그에 Token, Private Key, 전체 인증서 원문 등 민감정보를 기록하지 않는다.

### 9.3 Client 변조 대응

- 검증 모듈은 응용 SW의 핵심 모듈과 함께 배포해야 한다.
- 주요 기능 진입점에서 활성화 상태를 확인할 수 있어야 한다.
- Client SDK는 검증 결과를 위조하기 어렵도록 방어적 설계를 적용해야 한다.
- 단, 오프라인 Client는 완전한 역공학 방지가 불가능하므로 강한 통제가 필요한 제품은 L2/L3를 사용해야 한다.

## 10. 비기능 요구사항

### 10.1 무결성 및 일관성

- 인증서와 Blacklist는 서명 또는 동등한 무결성 검증을 제공해야 한다.
- 내부 DB 상태와 GitHub 저장 상태의 차이를 탐지할 수 있어야 한다.
- 발급 작업은 중복 발급 및 부분 실패를 안전하게 처리해야 한다.

### 10.2 가용성 및 장애 대응

- GitHub API 일시 장애에 대비한 재시도와 작업 상태 복구를 제공해야 한다.
- L1은 LicenseHub 서버 장애와 무관하게 검증 가능해야 한다.
- L2/L3의 서버 장애 시 허용 가능한 캐시 유효기간과 실패 정책을 정의해야 한다.
- 장애 및 복구 이벤트를 감사 로그에 남겨야 한다.

### 10.3 확장성

- 인증 방식, 제품, 인증서 등급 및 Device 식별 방식을 추가할 수 있어야 한다.
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
- L1, L2, L3 인증서 생성 및 검증
- Ed25519 기반 서명 또는 승인된 동등 알고리즘
- GitHub App 기반 Private Repository 연동
- Certificate, Blacklist, Manifest, Public Key 저장
- Certificate 다운로드
- L2/L3 Activation API
- Blacklist 캐시
- 기본 감사 로그
- 운영 Private Key를 위한 외부 Secret/KMS 연동 지점

## 12. 수용 기준

다음 조건을 만족하면 핵심 요구사항을 충족한 것으로 판단한다.

1. 서명이 변경된 인증서는 L1/L2/L3 모두에서 활성화되지 않는다.
2. Metadata 또는 제품·버전 정보가 변경된 인증서는 검증에 실패한다.
3. 만료된 인증서는 활성화되지 않는다.
4. L1은 서버 연결 없이 유효한 인증서를 검증할 수 있다.
5. L2는 Blacklist 또는 Revocation된 License를 활성화하지 않는다.
6. L3는 등록되지 않은 Device에서 활성화되지 않는다.
7. Client에는 GitHub 자격증명이 포함되지 않는다.
8. Private Key는 Repository, DB, 소스 코드 및 로그에 저장되지 않는다.
9. 인증서 발급과 GitHub 저장 실패 상태를 구분할 수 있다.
10. 인증서 변경 이력은 내부 감사 로그와 Git history에서 추적 가능하다.
11. 중첩 인증서의 모든 서명과 유효기간을 검증할 수 있다.
12. GitHub API 일시 장애에 대한 재시도 및 복구 동작을 확인할 수 있다.

## 13. 후속 결정이 필요한 항목

다음 항목은 구현 전에 별도로 확정해야 한다.

- Backend, Web UI 및 Client SDK의 기술 스택
- 운영 환경과 배포 방식
- 서명 알고리즘 및 키 회전 주기
- Device ID 산출 대상 운영체제와 하드웨어 정보
- L2/L3 서버 장애 시 허용할 Offline Grace Period
- 인증서 체인의 최대 깊이와 권한 위임 규칙
- Blacklist 캐시 만료 및 강제 갱신 정책
- License 발급·재발급·양도 정책
- 개인정보 및 Device Metadata 보관 기간
- SLA, 예상 발급량 및 동시 활성화 요청량
