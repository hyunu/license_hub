# licensehub-core (Rust)

Rust 응용 SW는 `licensehub-core` 크레이트를 경로 의존성 또는 crates.io
게시본으로 사용한다. 이 배포 폴더에는 소스 아카이브를 제공한다.

## 경로 의존성 사용

```toml
[dependencies]
licensehub-core = { path = "../licensehub-core" }
```

## 사용

```rust
use licensehub_core::{verify, Certificate, VerificationContext};
use ed25519_dalek::VerifyingKey;

let cert: Certificate = serde_json::from_str(&cert_json)?;
let public_key = VerifyingKey::from_bytes(&key_bytes)?;
if verify(&cert, &public_key, &VerificationContext::default()).is_ok() {
    // 응용 SW 핵심 기능 활성화
}
```

## 게시

crates.io 배포를 위해 다음을 수행한다.

```sh
cd core
cargo publish
```

- 검증 기능(`verify`)만 공개 API로 사용한다.
- `Issuer`(발급·개인키)는 서버 전용이며 Client 배포물에 포함하지 않는다.