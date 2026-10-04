//! 배포용 검증 라이브러리(C/C++/C#/Python/Node.js)가 공유할 테스트 픽스처를
//! 생성하는 예제.
//!
//! 고정 개인키([7u8; 32])로 L1/L2/L3 인증서와 공개키를 만들어
//! `bindings/testdata/` 아래에 저장한다. 각 언어 바인딩은 이 파일들을
//! 읽어 서로 같은 인증서를 검증한다.
//!
//! 추가로 Application 보호(LH-REQ) 픽스처도 생성한다:
//! - `envelope.json`: L1 인증서를 Application 공개키로 암호화한 엔벨로프
//! - `z_private_key.bin` / `z_public_key.bin`: Application 키쌍(Z_Pri/Z_Pub)
//! - `challenge.json` / `challenge_signature.b64`: Challenge-Response 픽스처
//!
//! 실행: `cargo run --example generate_bindings_fixtures`

use ed25519_dalek::SigningKey;
use licensehub_core::{CertificateRequest, Issuer, envelope};
use std::fs;
use std::path::Path;

const TEST_KEY: [u8; 32] = [7u8; 32];
const Z_PRIVATE_KEY: [u8; 32] = [21u8; 32];

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

    // ---- Application 보호(LH-REQ) 픽스처 ----
    let z_pri = SigningKey::from_bytes(&Z_PRIVATE_KEY);
    let z_pub = z_pri.verifying_key();
    fs::write(out_dir.join("z_private_key.bin"), z_pri.to_bytes())?;
    fs::write(out_dir.join("z_public_key.bin"), z_pub.to_bytes())?;

    // L1 인증서를 Application 공개키로 암호화한 엔벨로프.
    let envelope = envelope::encrypt_license(&l1, &z_pub, &issuer)?;
    fs::write(
        out_dir.join("envelope.json"),
        serde_json::to_vec_pretty(&envelope)?,
    )?;

    // Challenge-Response: 고정 Challenge(세션 고정)에 Z_Pri로 서명.
    let challenge = envelope::Challenge {
        nonce: "c2hhMjU2LWNoYWxsZW5nZS1ub25jZS0wMDMxNA".into(),
        session: "fixture-session".into(),
    };
    let challenge_sig = envelope::sign_challenge(&z_pri, &challenge);
    fs::write(
        out_dir.join("challenge.json"),
        serde_json::to_vec_pretty(&challenge)?,
    )?;
    fs::write(
        out_dir.join("challenge_signature.b64"),
        challenge_sig.as_bytes(),
    )?;
    envelope::verify_challenge(&z_pub, &challenge, &challenge_sig)
        .expect("fixture challenge signature must verify");

    println!("Fixture directory: {}", out_dir.canonicalize()?.display());
    println!("L1/L2/L3/tampered, envelope, app keys, and challenge written.");
    Ok(())
}
