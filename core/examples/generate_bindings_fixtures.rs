//! 배포용 검증 라이브러리(C/C++/C#/Python/Node.js)가 공유할 테스트 픽스처를
//! 생성하는 예제.
//!
//! 고정 개인키([7u8; 32])로 L1/L2/L3 인증서와 공개키를 만들어
//! `bindings/testdata/` 아래에 저장한다. 각 언어 바인딩은 이 파일들을
//! 읽어 서로 같은 인증서를 검증한다.
//!
//! 실행: `cargo run --example generate_bindings_fixtures`

use licensehub_core::{CertificateRequest, Issuer};
use std::fs;
use std::path::Path;

const TEST_KEY: [u8; 32] = [7u8; 32];

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let out_dir = Path::new("../bindings/testdata");
    fs::create_dir_all(out_dir)?;

    let issuer = Issuer::from_bytes("fixture-key", &TEST_KEY);
    let public_key = issuer.verifying_key().to_bytes();
    fs::write(out_dir.join("public_key.bin"), public_key)?;

    let l1 = issuer.issue(
        CertificateRequest::new("fixture-l1", 1, "DXi", "1.2.0")
            .issued_at("2026-01-01T00:00:00Z")
            .expires_at("2027-01-01T00:00:00Z"),
    )?;
    fs::write(out_dir.join("l1.json"), serde_json::to_vec_pretty(&l1)?)?;

    let l2 = issuer.issue(
        CertificateRequest::new("fixture-l2", 2, "DXi", "1.2.0")
            .issued_at("2026-01-01T00:00:00Z")
            .expires_at("2027-01-01T00:00:00Z")
            .verification_url("https://license.example.com/v1/verify"),
    )?;
    fs::write(out_dir.join("l2.json"), serde_json::to_vec_pretty(&l2)?)?;

    let l3 = issuer.issue(
        CertificateRequest::new("fixture-l3", 3, "DXi", "1.2.0")
            .issued_at("2026-01-01T00:00:00Z")
            .expires_at("2027-01-01T00:00:00Z")
            .verification_url("https://license.example.com/v1/verify")
            .device_id("device-a"),
    )?;
    fs::write(out_dir.join("l3.json"), serde_json::to_vec_pretty(&l3)?)?;

    let mut tampered = l1.clone();
    tampered.product = "Tampered".into();
    fs::write(
        out_dir.join("l1_tampered.json"),
        serde_json::to_vec_pretty(&tampered)?,
    )?;

    fs::write(
        out_dir.join("context_l1.json"),
        br#"{"now":"2026-06-01T00:00:00Z"}"#,
    )?;
    fs::write(
        out_dir.join("context_l2.json"),
        br#"{"now":"2026-06-01T00:00:00Z","server_status":"approved"}"#,
    )?;
    fs::write(
        out_dir.join("context_l3.json"),
        br#"{"now":"2026-06-01T00:00:00Z","server_status":"approved","device_id":"device-a"}"#,
    )?;

    println!("Fixture directory: {}", out_dir.canonicalize()?.display());
    println!("L1/L2/L3/tampered certificates and public key written.");
    Ok(())
}
