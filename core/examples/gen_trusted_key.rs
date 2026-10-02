//! K1(설명 서명 키) 공개키를 분산 상수로 변환하는 도구.
//!
//! 사용법:
//!   cargo run --example gen_trusted_key             # 새 키 쌍 생성 + 상수 출력
//!   cargo run --example gen_trusted_key <hex>       # 주어진 32바이트 공개키로 상수 출력
//!
//! 출력의 Rust 상수 블록(KEY_SHA256/ORDER/MASKS/PARTS)을 `src/trusted.rs`에
//! 복사하고, 생성된 개인키는 라이선스 서버의 LICENSEHUB_SIGNING_KEY로 설정한다.
//! 개인키는 저장소에 커밋하면 안 된다.

use licensehub_core::trusted::scatter;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let public_bytes: [u8; 32];
    let private_hex: Option<String>;

    if args.len() >= 2 {
        let bytes = hex_decode(&args[1]).expect("invalid hex input");
        assert_eq!(
            bytes.len(),
            32,
            "public key must be 32 bytes (64 hex chars)"
        );
        public_bytes = bytes.try_into().unwrap();
        private_hex = None;
        println!("// 입력된 공개키로 분산 상수를 생성 (개인키는 서버에 별도 보관)");
    } else {
        use ed25519_dalek::SigningKey;
        use rand_core::OsRng;
        let signing = SigningKey::generate(&mut OsRng);
        private_hex = Some(hex_encode(&signing.to_bytes()));
        public_bytes = signing.verifying_key().to_bytes();
        println!("// 새 K1 키 쌍 생성");
    }

    if let Some(h) = &private_hex {
        println!("// 개인키(서버 LICENSEHUB_SIGNING_KEY로 설정, 절대 커밋 금지): {h}");
    }

    let s = scatter(&public_bytes);

    println!("// 원본 공개키: {}", hex_encode(&public_bytes));
    println!("const KEY_SHA256: [u8; 32] = {:?};", s.sha256);
    println!("const ORDER: [usize; 4] = {:?};", s.order);
    println!("const MASKS: [[u8; 8]; 4] = {:?};", s.masks);
    println!("const PARTS: [[u8; 8]; 4] = {:?};", s.parts);
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0x0f) as usize] as char);
    }
    s
}

fn hex_decode(s: &str) -> Result<Vec<u8>, ()> {
    let s: String = s.chars().filter(|c| !c.is_whitespace()).collect();
    if !s.len().is_multiple_of(2) {
        return Err(());
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    let b = s.as_bytes();
    for i in (0..b.len()).step_by(2) {
        let hi = val(b[i]).ok_or(())?;
        let lo = val(b[i + 1]).ok_or(())?;
        out.push((hi << 4) | lo);
    }
    Ok(out)
}

fn val(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}
