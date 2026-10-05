// Application 키쌍(AK1/AK2) 생성 예제.
//
// Application 은 이 키쌍을 배포 시 함께 가지고 있어야 한다.
//   AK1(Z_Pri): LIC 복호화용 개인키 — 외부에 노출되면 안 된다
//   AK2(Z_Pub): LicenseHub 에 제출하는 공개키 — P를 암호화하는 데 쓰인다
//
// issuance 경로(P → LH_Pri 서명 → AK2 암호화 → LIC)를 확인하려면 이 예제로
// 만든 AK2 를 LicenseHub 관리 화면의 "AK2 (Z_Pub)" 입력란에 붙여 넣는다.
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use ed25519_dalek::SigningKey;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let z = SigningKey::generate(&mut rand_core::OsRng);

    // Ed25519 SubjectPublicKeyInfo: 고정 접두부 + 32바이트 공개키
    let spki_prefix: [u8; 12] = [
        0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
    ];
    let mut der = spki_prefix.to_vec();
    der.extend_from_slice(z.verifying_key().as_bytes());

    println!("# AK1 (Z_Pri) — Application 내부 보관. 이 값이 노출되면 LIC 를 복호화된다.");
    println!("AK1_PRIVATE_HEX={}", hex_encode(&z.to_bytes()));
    println!();
    println!("# AK2 (Z_Pub) — LicenseHub 발급 요청에 제출");
    println!("AK2_PUBLIC_PEM:");
    println!("-----BEGIN PUBLIC KEY-----");
    let encoded = B64.encode(&der);
    for chunk in encoded.as_bytes().chunks(64) {
        println!("{}", String::from_utf8_lossy(chunk));
    }
    println!("-----END PUBLIC KEY-----");
    Ok(())
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
