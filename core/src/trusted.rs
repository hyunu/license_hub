//! K1(설명 서명 키) 공개키를 분산 저장하고 런타임에 재조립한다.
//!
//! 응용SW 핵심로직 방어(X)에 쓰는 신뢰 공개키다. 평문 32바이트 키를
//! 바이너리에 그대로 두면 정적 분석(문자열 검색, 단순 비교)으로 쉽게
//! 찾거나 교체할 수 있다. 여기서는 키를 4조각으로 쪼개 각 조각을
//! 마스크(XOR)로 감싸고 저장 순서도 섞어 둔 뒤, 사용 시점에만 재조립한다.
//!
//! 보안 한계: 재조립 후 메모리에 키가 잠시 나타나므로 동적 분석으로 추출할
//! 수 있다. 이를 줄이기 위해 재조립 버퍼는 사용 직후 0으로 덮어쓴다(Zeroize).
//! `verify_trusted`는 키를 함수 밖으로 노출하지 않아 가장 짧은 수명을 보장한다.
//! 변경 시 `cargo run --example gen_trusted_key` 로 새 상수를 생성한다.

use ed25519_dalek::VerifyingKey;
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

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
/// 키를 직접 찾기 어렵다. 반환된 공개키는 호출자의 책임 하에 사용하며,
/// 내부 임시 버퍼는 사용 직후 0으로 덮어쓴다.
pub fn trusted_public_key() -> VerifyingKey {
    let mut key = reconstruct();
    let vk = VerifyingKey::from_bytes(&key).expect("trusted key is not a valid Ed25519 key");
    key.zeroize();
    vk
}

/// 분산 저장된 K1 공개키로 인증서(X)를 검증한다.
///
/// 키를 함수 밖으로 노출하지 않고 재조립·검증·파기한다. 검증에 필요한
/// 시점에만 키가 메모리에 존재하며, 반환 전에 0으로 덮어쓴다.
pub fn verify_trusted(
    certificate: &crate::Certificate,
    context: &crate::VerificationContext,
) -> Result<(), crate::VerificationError> {
    let mut key = reconstruct();
    let vk = match VerifyingKey::from_bytes(&key) {
        Ok(vk) => vk,
        Err(_) => {
            key.zeroize();
            return Err(crate::VerificationError::InvalidFormat);
        }
    };
    let result = crate::verify(certificate, &vk, context);
    key.zeroize();
    result
}

/// 분산 조각을 재조립하고 무결성 해시를 확인한다.
/// 호출자는 반환 버퍼를 사용 후 반드시 zeroize 해야 한다.
fn reconstruct() -> [u8; 32] {
    let mut key = [0u8; 32];
    for (i, &slot) in ORDER.iter().enumerate() {
        for b in 0..8 {
            key[slot * 8 + b] = PARTS[i][b] ^ MASKS[i][b];
        }
    }
    let digest = Sha256::digest(key);
    assert_eq!(
        digest.as_slice(),
        &KEY_SHA256,
        "trusted key integrity check failed"
    );
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

    #[test]
    fn verify_trusted_rejects_cert_signed_by_other_key() {
        use crate::{CertificateRequest, Issuer, VerificationError};

        // 내장 K1이 아닌 다른 키로 서명한 인증서는 verify_trusted가 거부한다.
        // (내장 K1 개인키는 저장소에 두지 않으므로 유효 케이스는 C ABI
        // /바인딩 경로로만 확인한다.)
        let signing = SigningKey::generate(&mut OsRng);
        let issuer = Issuer::from_bytes("other", &signing.to_bytes());
        let x = issuer
            .issue(CertificateRequest::new("EX-2", 1, "Other", "1.0.0"))
            .unwrap();
        let result = verify_trusted(&x, &crate::VerificationContext::default());
        assert!(matches!(result, Err(VerificationError::InvalidSignature)));
    }

    #[test]
    fn host_identity_is_compared_against_signed_info() {
        use crate::{CertificateRequest, Issuer, VerificationContext, VerificationError, verify};

        // 코어가 호스트 앱의 특이점(제품명·버전)을 서명된 정보(X)와 대조한다.
        // verify_trusted도 동일한 verify()를 거치므로 같은 규칙이 적용된다.
        let signing = SigningKey::generate(&mut OsRng);
        let issuer = Issuer::from_bytes("k1", &signing.to_bytes());
        let x = issuer
            .issue(CertificateRequest::new(
                "EX-1",
                1,
                "ExodusSimEngine",
                "1.0.0",
            ))
            .unwrap();
        let key = signing.verifying_key();

        // (1) 호스트 특이점이 X의 서명된 설명과 일치 → 유효
        let ctx = VerificationContext {
            product: Some("ExodusSimEngine".into()),
            version: Some("1.0.0".into()),
            ..Default::default()
        };
        assert!(verify(&x, &key, &ctx).is_ok());

        // (2) 다른 앱(B)이 코어를 끼워 쓰면 특이점 불일치 → 거부
        let ctx_b = VerificationContext {
            product: Some("OtherApp".into()),
            ..Default::default()
        };
        assert!(matches!(
            verify(&x, &key, &ctx_b),
            Err(VerificationError::PolicyRejected)
        ));

        // (3) 개발 편의: 제품명만 대조(version 생략)하면 리빌드와 무관하게 동작
        let ctx_dev = VerificationContext {
            product: Some("ExodusSimEngine".into()),
            version: None,
            ..Default::default()
        };
        assert!(verify(&x, &key, &ctx_dev).is_ok());
    }

    #[test]
    fn product_id_from_project_file_is_compared() {
        use crate::{CertificateRequest, Issuer, VerificationContext, VerificationError, verify};

        // X에 프로젝트 파일 고유값(product_id)을 서명 데이터로 포함해 발급한다.
        let signing = SigningKey::generate(&mut OsRng);
        let issuer = Issuer::from_bytes("k1", &signing.to_bytes());
        let x = issuer
            .issue(
                CertificateRequest::new("EX-1", 1, "ExodusSimEngine", "1.0.0")
                    .metadata("product_id", serde_json::json!("{9F1A-4D2B}")),
            )
            .unwrap();
        let key = signing.verifying_key();

        // 호스트가 등록한 product_id가 서명된 값과 일치 → 유효
        let ctx = VerificationContext {
            product_id: Some("{9F1A-4D2B}".into()),
            ..Default::default()
        };
        assert!(verify(&x, &key, &ctx).is_ok());

        // 다른 고유값(다른 앱)이면 거부
        let ctx_other = VerificationContext {
            product_id: Some("{0000-0000}".into()),
            ..Default::default()
        };
        assert!(matches!(
            verify(&x, &key, &ctx_other),
            Err(VerificationError::PolicyRejected)
        ));
    }
}
