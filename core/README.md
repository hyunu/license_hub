# LicenseHub Core

Rust로 구현된 인증서 발급·서명·검증 라이브러리다.

## 빌드

Core 디렉터리에서 다음 명령을 실행한다.

```sh
./build.sh
```

빌드 스크립트는 현재 실행 중인 OS와 CPU 아키텍처를 감지하고 Cargo의
release 산출물을 다음 위치에 모은다.

```text
core/dist/{os}-{arch}/
├── include/
│   └── licensehub_core.h
└── lib/
    ├── native shared library
    └── native static library
```

예시:

```text
macOS:  core/dist/macos-arm64/lib/liblicensehub_core.dylib
Linux:  core/dist/linux-x86_64/lib/liblicensehub_core.so
Windows: core/dist/windows-x86_64/lib/licensehub_core.dll
```

정적 라이브러리도 함께 생성된다.

```text
macOS/Linux: liblicensehub_core.a
Windows:     licensehub_core.lib
```

Cargo는 `cdylib`와 `staticlib`의 확장자를 target OS에 맞춰 생성한다. 다른
OS용 빌드는 해당 Rust target toolchain을 설치한 뒤 `cargo build --target`
방식으로 수행하며, 현재 `build.sh`는 호스트 OS 패키징용이다.

## 직접 빌드

패키징 없이 Cargo 산출물만 생성하려면 다음을 사용한다.

```sh
cargo build --release
```

산출물은 `core/target/release/`에 생성된다.

## 인증서 발행 예제

Core API를 이용해 Secure(L2) 인증서를 발행하는 예제를 실행할 수 있다.

```sh
cargo run --example issue_certificate
```

예제는 다음을 수행한다.

- L2 Secure 인증서 생성
- 제품, 버전, 유효기간 설정
- 검증 서버 URL 설정
- `activation_policy`, `features`, `customer` Metadata 추가
- 인증서 JSON 출력
- 검증용 Public Key 출력

예제에서 생성되는 Private Key는 테스트용으로만 사용되며 출력되지 않는다.
운영 환경에서는 Private Key를 외부 Secret 저장소에서 안전하게 로드해야 한다.
