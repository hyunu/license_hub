# LicenseHub 요구사항 — 이미지 기준

`docs/요구사항.png`을 시스템 구성과 RS-1~9의 **기준 자료**로 삼아 텍스트로
정리한 문서다. 그림이나 이 문서와 상충하는 설계 제안은 확정 요구사항으로
간주하지 않는다.

## 1. 시스템 구성

| 기호 | 구성 |
|---|---|
| P | Application ID, Target Language, Version, Level, Owner, Expired Date, Meta Data를 포함하는 License Payload |
| X | DLL/공유 라이브러리로 배포되는 LicenseHub 검증 모듈 |
| Y | 실제 보호 대상인 응용 SW 핵심 로직 |
| Z | X와 Y를 포함해 실행되는 응용 프로그램 |
| LH_Pri (LK1) | P에 서명하는 LicenseHub 개인키 |
| LH_Pub (LK2) | X에 내장되어 서명을 검증하는 LicenseHub 공개키 |
| Z_Pub (AK2) | LicenseHub가 LIC를 해당 Application용으로 암호화할 때 사용하는 공개키 |
| Z_Pri (AK1) | 해당 Application이 보유하고 LIC 복호화에 사용하는 개인키 |
| LIC | P의 LH_Pri 서명 결과를 Z_Pub으로 암호화한 License |

### 1.1 발급 흐름

```text
P (Application ID, Target Language, Version, Level, Owner,
   Expired Date, Meta Data)
    │
    ├── Sign(LH_Pri / LK1)
    ▼
Signed P
    │
    ├── Encrypt(Z_Pub / AK2)
    ▼
LIC (암호화된 License)
```

License 발급 요청에는 P와 대상 Application의 AK2를 제공한다. Base64는
암호화가 아니다. 최종 LIC는 원문을 드러내지 않도록 암호화한 결과여야 한다.

### 1.2 실행·검증 흐름

```text
APP-001 시작
    │ AK1 + LIC
    ▼
X: AK1으로 LIC 복호화
    │
    ├── LK2 (LH_Pub 내장)로 P의 LH_Pri 서명 검증
    ├── P의 Application ID / 실행 환경 메타데이터 검증
    └── 유효하면 활성화 결과를 Y에 전달
             │
             ▼
        Y 활성화
```

APP-002에는 APP-001용 AK1이 없으므로 APP-001의 LIC를 재사용할 수 없어야 한다.
X는 P에서 선언한 Application 정체성과 실제 실행 중인 Z의 정보를 비교한다.

## 2. RS-1~9

| ID | 요구사항 | 구현 해석 / 확인 사항 |
|---|---|---|
| RS-1 | X는 LicenseHub 시스템을 통해 제공한다. Y에 통합 빌드할 수 있도록 참조 코드와 함께 제공한다. | X의 공개 API와 C ABI/바인딩을 제공한다. |
| RS-2 | X는 C/Rust 등의 언어로 제공한다. Y와 결합해 활성화하는 원칙이다. | Y 통합 언어와 ABI 호환성을 지원한다. 특정 언어 강제 여부는 제공 범위에서 결정한다. |
| RS-3 | X는 P의 데이터를 이용해 Y의 실행 정보를 확인해야 한다. APP-001용 License는 APP-002에서 사용되지 않아야 한다. | 서명된 Application ID와 실행 파일/모듈 등 측정값을 비교한다. ID 문자열만 단독 비교하지 않는다. |
| RS-4 | LK2(LH_Pub)는 X 배포 시 역공학이 어려운 형태로 내장한다. 실행 시 조립해 사용하고 즉시 메모리에서 해제한다. | X는 외부에서 전달된 LH_Pub을 신뢰 앵커로 받지 않는다. 메모리 최소 보유와 zeroize를 적용한다. |
| RS-5 | LIC는 LicenseHub를 통해 발급한다. 발급 시 P와 AK2를 제공한다. | 서버 측에서 P를 LH_Pri로 서명한 뒤 AK2 대상 LIC로 암호화한다. |
| RS-6 | Y 시작 시 AK1과 LIC를 전달해 Y를 활성화한다. 전달값은 X에서 검증한다. | X가 복호화·서명·메타데이터 검증에 실패하면 비활성 상태를 반환한다. |
| RS-7 | X는 Z 프로젝트의 언어/플랫폼별 규칙에 따라 Application ID를 도출해야 한다. 임의 입력에만 의존하지 말고 생성 규칙을 명확히 정의한다. | C# assembly identity 등 언어별 project/package identity를 조사하고 표준화한다. 사용자 수동 ID 입력을 기본 경로로 삼지 않는다. |
| RS-8 | AK1은 추출하기 어렵게 사용·조합하고 사용 후 메모리에서 해제한다. | 가능한 경우 OS/TPM 보안 저장소를 사용한다. 010의 저장소 연동은 현재 범위에서 제외한다. 일시 메모리 버퍼는 사용 후 zeroize한다. |
| RS-9 | License 원문을 쉽게 식별할 수 없어야 하며, Base64 이상의 암호화/난독화가 필요하다. | 암호화가 기밀성을 제공해야 한다. Base64/난독화만을 암호화로 취급하지 않는다. |

## 3. 이미지에서 직접 도출되지 않은 제안

다음은 별도 합의 전까지 RS-1~9의 필수조건이 아니다: Challenge-Response,
Activation Token, 매 실행 Session Binding, 원격 증명(Remote Attestation),
완전한 클라이언트 변조 방지. 기존 요구사항 문서에 추가된 항목은 이미지의
요구사항과 구분해 검토해야 한다.

## 4. 핵심 보안 한계

순수 클라이언트 DLL/EXE 내부의 검증 코드는 충분한 권한을 가진 공격자가
패치할 수 있다. 따라서 소프트웨어만으로 변조·우회를 절대적으로 방지한다고
보장하지 않는다. 이 한계는 RS-1~9의 의도(정상 제품 간 License 재사용 방지)를
구현하는 것과 별도로 명시한다.
