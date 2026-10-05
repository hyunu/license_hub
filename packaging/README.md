# LicenseHub 배포 패키징

응용 개발자에게 배포할 검증용 라이브러리(LicenseGuard)의 패키지를 생성한다.

## 실행

```sh
./package.sh
```

스크립트는 다음 순서로 진행한다.

1. `core/build.sh` 로 네이티브 라이브러리 빌드
2. C / Rust 패키지를 `distribute/` 아래에 생성

## 산출물 구조

```text
distribute/
├── c/                          헤더 + 정적/공유 라이브러리 (플랫폼별)
│   ├── include/
│   │   └── licensehub_core.h
│   ├── lib/<os>-<arch>/        .a / .dylib / .so / .dll
│   └── examples/verify_example.c
└── rust/
    └── README.md               crates.io 배포 안내
```

## 생성 규칙

| 언어 | 내용 | 제외 |
|---|---|---|
| C | 헤더 + 라이브러리 + 예제 | Core 소스, 테스트 픽스처 |
| Rust | 게시 안내 (crates.io) | — |

## 스테이징 디렉터리

- `distribute/` 는 `package.sh` 실행 시 채워지는 생성 산출물이며 저장소에
  커밋하지 않는다.

## 선행 요구사항

- Rust/Cargo
- C 컴파일러

## 추가 플랫폼 지원

`core/dist/<os>-<arch>/` 에 라이브러리를 추가하면(예: `cargo build --target`)
다음 실행에서 해당 플랫폼도 패키지에 포함된다.