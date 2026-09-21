//! LicenseHub Core를 이용한 Device-Bound 인증서 발행 예제.
//!
//! 이 예제는 실행할 때마다 테스트용 키를 새로 생성한다. 운영 환경에서는
//! Private Key를 파일, 환경변수 또는 Secret Manager에서 안전하게 로드하고
//! 예제처럼 화면에 출력하거나 소스 코드에 포함해서는 안 된다.

use licensehub_core::{CertificateRequest, Issuer};
use serde_json::json;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 실제 서비스에서는 이 키를 매 실행마다 생성하지 않는다.
    // 발급 전용 프로세스가 안전하게 로드한 Private Key를 사용해야 한다.
    let issuer = Issuer::generate("license-signing-key-v1");

    let request = CertificateRequest::new("LICENSE-2026-0001", 3, "DXi", "1.2.0")
        .issued_at("2026-09-21T10:00:00Z")
        .expires_at("2027-09-21T10:00:00Z")
        .verification_url("https://license.example.com/v1/verify")
        .device_id("example-device-id")
        .metadata(
            "activation_policy",
            json!({
                "max_activations": 1,
                "offline_grace_days": 7
            }),
        )
        .metadata("features", json!(["export", "batch-processing"]))
        .metadata(
            "customer",
            json!({
                "company_id": "COMPANY-001",
                "plan": "enterprise"
            }),
        );

    let certificate = issuer.issue(request)?;
    let public_key = issuer.verifying_key();

    println!("Certificate:");
    println!("{}", serde_json::to_string_pretty(&certificate)?);
    println!();
    println!("Public Key (hex):");
    println!("{}", hex_encode(&public_key.to_bytes()));

    Ok(())
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
