//! K1(설명 서명 키) 공개키를 분산 저장하고 런타임에 재조립한다.
//!
//! 응용SW 핵심로직 방어(X)에 쓰는 신뢰 공개키다. 평문 32바이트 키를
//! 바이너리에 그대로 두면 정적 분석(문자열 검색, 단순 비교)으로 쉽게
//! 찾거나 교체할 수 있다. 여기서는 키를 4조각으로 쪼개 각 조각을
//! 마스크(XOR)로 감싸고 저장 순서도 섞어 둔 뒤, 사용 시점에만 재조립한다.
//!
//! 보안 한계: 재조립 후 메모리에 키가 잠시 나타나므로 동적 분석으로 추출할
//! 수 있다. 정적 패치의 난이도를 높이는 장치이며 절대적 보호는 아니다.
//! 변경 시 `cargo run --example gen_trusted_key` 로 새 상수를 생성한다.

use ed25519_dalek::VerifyingKey;
use sha2::{Digest, Sha256};

// 재조립된 키가 빌드 시점의 원본과 같은지 확인하는 무결성 해시.
// 값이 다르면 저장본이 훼손된 것이므로 검증을 거부한다(fail closed).
// 원본 공개키: dcfd3f10fa7598eb23e58c652906a617b176142663cf3f8d6f4447636783ae67
const KEY_SHA256: [u8; 32] = [
    182, 57, 219, 163, 149, 202, 43, 214, 67, 221, 254, 106, 241, 126, 210, 238, 75, 51, 151, 163,
    230, 44, 126, 114, 166, 164, 20, 18, 133, 4, 63, 127,
];

// PARTS[i]가 원본 키의 어느 8바이트 슬롯에 해당하는지의 순서.
const ORDER: [usize; 4] = [3, 2, 1, 0];

// 조각별 마스크. 재조립 시 PARTS[i] ^ MASKS[i] 로 원본 바이트를 복원한다.
const MASKS: [[u8; 8]; 4] = [
    [185, 52, 77, 102, 18, 169, 161, 130],
    [137, 173, 80, 64, 152, 135, 99, 148],
    [137, 64, 206, 123, 251, 221, 21, 34],
    [124, 163, 26, 37, 68, 17, 114, 138],
];

// 마스킹된 조각들. 원본 32바이트를 8바이트씩 4조각으로 나눈 뒤 각 조각을
// 마스크로 감싸고 ORDER에 적힌 순서로 저장했다.
const PARTS: [[u8; 8]; 4] = [
    [214, 112, 10, 5, 117, 42, 15, 229],
    [56, 219, 68, 102, 251, 72, 92, 25],
    [170, 165, 66, 30, 210, 219, 179, 53],
    [160, 94, 37, 53, 190, 100, 234, 97],
];

/// 분산 저장된 K1 공개키를 재조립해 반환한다.
///
/// 무결성 검증 실패 시 panic 한다. 평문 키 상수를 두지 않아 정적 분석으로
/// 키를 직접 찾기 어렵다.
pub fn trusted_public_key() -> VerifyingKey {
    let key = assemble();
    let digest = Sha256::digest(key);
    assert_eq!(
        digest.as_slice(),
        &KEY_SHA256,
        "trusted key integrity check failed"
    );
    VerifyingKey::from_bytes(&key).expect("trusted key is not a valid Ed25519 key")
}

fn assemble() -> [u8; 32] {
    let mut key = [0u8; 32];
    for (i, &slot) in ORDER.iter().enumerate() {
        for b in 0..8 {
            key[slot * 8 + b] = PARTS[i][b] ^ MASKS[i][b];
        }
    }
    key
}

/// 분산 저장 상수 묶음. `gen_trusted_key` 도구가 이 값을 생성해
/// `trusted.rs`에 복사한다.
pub struct ScatteredKey {
    pub parts: [[u8; 8]; 4],
    pub masks: [[u8; 8]; 4],
    pub order: [usize; 4],
    pub sha256: [u8; 32],
}

/// (도구/테스트용) 주어진 공개키를 분산 상수로 변환한다.
///
/// `gen_trusted_key` 예제가 이 값을 사용해 `trusted.rs`에 복사할 상수 블록을
/// 출력한다. 마스크와 순서는 매 호출마다 새로 생성되므로, 실제로는 한 번
/// 생성한 상수를 고정해 사용해야 한다.
pub fn scatter(key: &[u8; 32]) -> ScatteredKey {
    use rand_core::{OsRng, RngCore};

    let mut rng = OsRng;
    let mut masks = [[0u8; 8]; 4];
    for m in masks.iter_mut() {
        rng.fill_bytes(m);
    }
    let mut order = [0usize, 1, 2, 3];
    for i in (1..4).rev() {
        let j = (rng.next_u64() as usize) % (i + 1);
        order.swap(i, j);
    }
    let mut parts = [[0u8; 8]; 4];
    for (i, &slot) in order.iter().enumerate() {
        for b in 0..8 {
            parts[i][b] = key[slot * 8 + b] ^ masks[i][b];
        }
    }
    let digest = Sha256::digest(key);
    let mut sha256 = [0u8; 32];
    sha256.copy_from_slice(digest.as_slice());
    ScatteredKey {
        parts,
        masks,
        order,
        sha256,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;
    use rand_core::OsRng;

    #[test]
    fn scatter_roundtrip_reassembles_original_key() {
        let signing = SigningKey::generate(&mut OsRng);
        let key = signing.verifying_key().to_bytes();
        let s = scatter(&key);
        let mut rebuilt = [0u8; 32];
        for (i, &slot) in s.order.iter().enumerate() {
            for b in 0..8 {
                rebuilt[slot * 8 + b] = s.parts[i][b] ^ s.masks[i][b];
            }
        }
        assert_eq!(rebuilt, key);
        assert_eq!(Sha256::digest(rebuilt).as_slice(), &s.sha256);
    }

    #[test]
    fn trusted_public_key_is_valid_and_integrity_holds() {
        let vk = trusted_public_key();
        // 무결성 검증이 panic 없이 통과했고 유효한 Ed25519 키다.
        assert_eq!(vk.to_bytes().len(), 32);
        // 재조립 키의 해시가 KEY_SHA256과 일치하는지 재확인.
        assert_eq!(Sha256::digest(vk.to_bytes()).as_slice(), &KEY_SHA256);
    }

    #[test]
    fn scattered_key_signs_and_verifies_x() {
        use crate::{CertificateRequest, Issuer, verify};

        // 분산 저장된 공개키로 X(설명 인증서)를 발급·검증하는 흐름.
        let signing = SigningKey::generate(&mut OsRng);
        let s = scatter(&signing.verifying_key().to_bytes());
        let mut rebuilt = [0u8; 32];
        for (i, &slot) in s.order.iter().enumerate() {
            for b in 0..8 {
                rebuilt[slot * 8 + b] = s.parts[i][b] ^ s.masks[i][b];
            }
        }
        let trusted = VerifyingKey::from_bytes(&rebuilt).unwrap();

        // X = A설명 + K1 서명
        let issuer = Issuer::from_bytes("k1", &signing.to_bytes());
        let x = issuer
            .issue(CertificateRequest::new(
                "EX-1",
                1,
                "ExodusSimEngine",
                "1.0.0",
            ))
            .unwrap();

        let ctx = crate::VerificationContext::default();
        verify(&x, &trusted, &ctx).unwrap();
    }
}
