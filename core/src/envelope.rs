//! Application별 암호화 라이선스 엔벨로프와 실행 시 보호 요소.
//!
//! 요구사항 LH-REQ-005~008(License Payload 암호화)을 구현한다.
//! 발급된 인증서(서명된 Payload)를 Application 공개키(Z_Pub)로 암호화해
//! 배포하고, Application이 자신의 개인키(Z_Pri)로만 복호화하도록 한다.
//!
//! 구조(LH-REQ-008 Hybrid Encryption):
//!
//! ```text
//! Payload ──AES-256-GCM──► Ciphertext(+Tag)
//!                          AES 키 = SHA-256(X25519 공유비밀 || EphemeralPub)
//!                          X25519 공유비밀 = Z_Pub × EphemeralPri (ECDH)
//! 엔벨로프 전체를 LH_Pri로 서명 → 변조·위조 차단
//! ```
//!
//! Base64는 전송을 위한 인코딩일 뿐 암호화 수단이 아니다(LH-REQ-007).
//! 공개키(EPK)는 공개 정보이므로 엔벨로프에 포함하고, 복호화에 필요한
//! 개인키는 Application(Z)만 보유한다.

use aes_gcm::aead::{Aead, Nonce};
use aes_gcm::{Aes256Gcm, KeyInit};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use curve25519_dalek::MontgomeryPoint;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::slice;
use thiserror::Error;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use zeroize::{Zeroize, Zeroizing};

use crate::Certificate;
use crate::Issuer;

/// 암호화된 License 엔벨로프의 스키마 버전.
const ENVELOPE_SCHEMA_VERSION: u32 = 1;
/// AES-GCM 논스 길이(96비트).
const NONCE_LEN: usize = 12;
/// Application 키쌍 암호화 라이선스(엔벨로프) 최대 허용 크기.
const MAX_ENVELOPE_SIZE: usize = 128 * 1024;
/// Application 개인키가 실제로 보유하고 있음을 증명하는 Challenge 크기.
const MAX_CHALLENGE_SIZE: usize = 4096;

/// AES-256-GCM 논스(96비트)를 생성한다.
fn random_nonce() -> [u8; NONCE_LEN] {
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::fill(&mut nonce).expect("operating system random source unavailable");
    nonce
}

//--------------------------------------------------------------------------------
// Application 식별자(LH-REQ-013)
//--------------------------------------------------------------------------------

/// Application Public Key에서 안정적인 Application ID를 파생한다.
///
/// `SHA-256(Z_Pub)`이므로 공개된 ID 자체가 특정 Application Key에 연결된다.
/// 문자열 비교만으로 판정하지 않고, 서명·복호화 가능 여부가 실제 인증 수단이다.
pub fn application_id(public_key: &VerifyingKey) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(public_key.to_bytes()))
}

//--------------------------------------------------------------------------------
// EncryptedLicense
//--------------------------------------------------------------------------------

/// Application 공개키(Z_Pub)로 암호화된 라이선스 엔벨로프(LH-REQ-008).
///
/// `signature`를 제외한 모든 필드가 LH_Pri로 서명된다. 원문 Payload는
/// Ciphertext 안에만 존재하므로 Application ID, Owner, Expired Date, Level,
/// Meta Data 등이 외부에 직접 노출되지 않는다(LH-REQ-005).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EncryptedLicense {
    /// 엔벨로프 스키마 버전.
    pub schema_version: u32,
    /// 서명(LH_Pri)에 사용한 License Hub 키 버전.
    pub key_id: String,
    /// 암호화에 사용한 Application의 ID (`SHA-256(Z_Pub)`).
    pub app_id: String,
    /// X25519 Ephemeral 공개키(URL-safe Base64). 복호화 시점 공유비밀 생성에 사용.
    pub ephemeral_public_key: String,
    /// AES-256-GCM 논스(URL-safe Base64).
    pub nonce: String,
    /// 암호문(URL-safe Base64). 내부에 AES-GCM 인증 태그가 포함된다.
    pub ciphertext: String,
    /// 엔벨로프 전체(위 필드)에 대한 LH_Pri 서명(URL-safe Base64).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub signature: String,
}

/// 암호화된 라이선스 발급·복호화에서 발생하는 오류.
#[derive(Debug, Error, PartialEq)]
pub enum EnvelopeError {
    #[error("encryption failed: {0}")]
    Encrypt(String),
    #[error("decryption failed: {0}")]
    Decrypt(String),
    #[error("invalid envelope format")]
    InvalidFormat,
    #[error("invalid signature")]
    InvalidSignature,
    #[error("application mismatch")]
    ApplicationMismatch,
    #[error("serialization failed: {0}")]
    Serialization(String),
}

/// Ed25519 키의 X25519 몽고메리 포인트를 반환한다.
///
/// 같은 키쌍을 서명(Challenge-Response)과 ECDH(암호화)에 재사용한다.
fn to_montgomery(public_key: &VerifyingKey) -> MontgomeryPoint {
    public_key.to_montgomery()
}

/// X25519 공유비밀에서 AES-256 키를 파생한다.
fn derive_aes_key(
    shared_secret: &MontgomeryPoint,
    ephemeral_pub: &MontgomeryPoint,
) -> Zeroizing<[u8; 32]> {
    let mut material = Zeroizing::new(Vec::with_capacity(64));
    material.extend_from_slice(shared_secret.as_bytes());
    material.extend_from_slice(ephemeral_pub.as_bytes());
    Zeroizing::new(Sha256::digest(&material[..]).into())
}

/// 서명 대상 canonical payload(엔벨로프에서 signature 제외).
fn envelope_payload(envelope: &EncryptedLicense) -> Result<Vec<u8>, EnvelopeError> {
    let mut value =
        serde_json::to_value(envelope).map_err(|e| EnvelopeError::Serialization(e.to_string()))?;
    if let serde_json::Value::Object(ref mut object) = value {
        object.remove("signature");
    }
    let mut output = Vec::new();
    crate::write_canonical(&value, &mut output).map_err(EnvelopeError::Serialization)?;
    Ok(output)
}

/// 서명된 인증서(Payload)를 Application 공개키로 암호화한다.
///
/// 발급자는 `certificate`를 JSON 직렬화한 뒤 AES-256-GCM으로 암호화하고,
/// 엔벨로프 전체를 `issuer`(LH_Pri)로 서명한다.
/// - 인자: certificate: 발급·서명된 인증서 (또는 서명된 Payload JSON)
///   z_public_key: 대상 Application의 공개키(Z_Pub)
///   issuer: License Hub 발급자(LH_Pri)
/// - 리턴: Ok(암호화된 엔벨로프) 또는 Err(EnvelopeError)
pub fn encrypt_license(
    certificate: &Certificate,
    z_public_key: &VerifyingKey,
    issuer: &Issuer,
) -> Result<EncryptedLicense, EnvelopeError> {
    // 같은 키쌍을 서명과 ECDH에 재사용하되, 복호화 측이 Z_Pri로 동일한
    // 공유비밀을 만들 수 있도록 Ephemeral 키쌍을 생성한다.
    let payload =
        serde_json::to_vec(certificate).map_err(|e| EnvelopeError::Serialization(e.to_string()))?;
    let ephemeral = SigningKey::generate(&mut OsRng);
    let ephemeral_scalar = ephemeral.to_scalar_bytes();
    let z_pub_mont = to_montgomery(z_public_key);
    // 양쪽 모두 자신의 개인키 스칼라에 X25519 클램프(mul_clamped)를 적용해
    // 같은 공유비밀을 만들 수 있다.
    let shared = z_pub_mont.mul_clamped(ephemeral_scalar);
    let epk_mont = to_montgomery(&ephemeral.verifying_key());
    let aes_key = derive_aes_key(&shared, &epk_mont);

    let mut nonce_bytes = random_nonce();
    let cipher = Aes256Gcm::new_from_slice(&aes_key[..])
        .map_err(|e| EnvelopeError::Encrypt(e.to_string()))?;
    let ciphertext = cipher
        .encrypt(
            Nonce::<Aes256Gcm>::from_slice(&nonce_bytes),
            payload.as_ref(),
        )
        .map_err(|_| EnvelopeError::Encrypt("AES-GCM encryption failed".into()))?;

    let mut envelope = EncryptedLicense {
        schema_version: ENVELOPE_SCHEMA_VERSION,
        key_id: issuer.key_id().to_string(),
        app_id: application_id(z_public_key),
        ephemeral_public_key: URL_SAFE_NO_PAD.encode(epk_mont.as_bytes()),
        nonce: URL_SAFE_NO_PAD.encode(nonce_bytes),
        ciphertext: URL_SAFE_NO_PAD.encode(&ciphertext),
        signature: String::new(),
    };
    let payload = envelope_payload(&envelope)?;
    envelope.signature = URL_SAFE_NO_PAD.encode(issuer.signing_key().sign(&payload).to_bytes());

    nonce_bytes.zeroize();
    let mut shared_bytes = shared.to_bytes();
    shared_bytes.zeroize();
    Ok(envelope)
}

/// Application 개인키(Z_Pri)로 엔벨로프를 검증·복호화한다.
///
/// 순서: 서명(LH_Pub) 검증 → App ID 일치 확인 → ECDH 공유비밀 생성 →
/// AES-256-GCM 복호화 → 원문 인증서 복원.
/// - 인자: envelope: 암호화된 엔벨로프
///   z_private_key: Application 개인키(Z_Pri, Ed25519)
///   lh_public_key: License Hub 공개키(LH_Pub)
/// - 리턴: Ok(복호화된 인증서) 또는 Err(EnvelopeError)
pub fn decrypt_license(
    envelope: &EncryptedLicense,
    z_private_key: &SigningKey,
    lh_public_key: &VerifyingKey,
) -> Result<Certificate, EnvelopeError> {
    if envelope.schema_version != ENVELOPE_SCHEMA_VERSION {
        return Err(EnvelopeError::InvalidFormat);
    }
    // 1) 엔벨로프 서명 검증 (LH_Pub). Application이 전달받은 공개키를 그대로
    //    쓰지 않고 내장된 LH_Pub으로 검증한다(LH-REQ-014).
    let payload = envelope_payload(envelope)?;
    let sig_bytes = URL_SAFE_NO_PAD
        .decode(&envelope.signature)
        .map_err(|_| EnvelopeError::InvalidSignature)?;
    let signature =
        Signature::from_slice(&sig_bytes).map_err(|_| EnvelopeError::InvalidSignature)?;
    lh_public_key
        .verify(&payload, &signature)
        .map_err(|_| EnvelopeError::InvalidSignature)?;

    // 2) Application ID 일치 확인 (Z_Pri ↔ Z_Pub 쌍 증명의 첫 단계).
    let derived_app_id = application_id(&z_private_key.verifying_key());
    if derived_app_id != envelope.app_id {
        return Err(EnvelopeError::ApplicationMismatch);
    }

    // 3) ECDH로 공유비밀 생성 → AES 키 파생 → 복호화.
    let epk_bytes = URL_SAFE_NO_PAD
        .decode(&envelope.ephemeral_public_key)
        .map_err(|_| EnvelopeError::InvalidFormat)?;
    let epk: [u8; 32] = epk_bytes
        .try_into()
        .map_err(|_| EnvelopeError::InvalidFormat)?;
    let epk_mont = MontgomeryPoint(epk);
    let z_scalar = z_private_key.to_scalar_bytes();
    let shared = epk_mont.mul_clamped(z_scalar);
    let aes_key = derive_aes_key(&shared, &epk_mont);

    let nonce_bytes = URL_SAFE_NO_PAD
        .decode(&envelope.nonce)
        .map_err(|_| EnvelopeError::InvalidFormat)?;
    let ciphertext = URL_SAFE_NO_PAD
        .decode(&envelope.ciphertext)
        .map_err(|_| EnvelopeError::InvalidFormat)?;

    let cipher = Aes256Gcm::new_from_slice(&aes_key[..])
        .map_err(|e| EnvelopeError::Decrypt(e.to_string()))?;
    let plaintext = cipher
        .decrypt(
            Nonce::<Aes256Gcm>::from_slice(&nonce_bytes),
            ciphertext.as_ref(),
        )
        .map_err(|_| EnvelopeError::Decrypt("AES-GCM authentication failed".into()))?;

    let mut shared_bytes = shared.to_bytes();
    shared_bytes.zeroize();
    // Zeroizing은 Drop 시점에 plaintext를 0으로 덮어쓴다(LH-REQ-026).
    let cert = serde_json::from_slice::<Certificate>(&plaintext)
        .map_err(|e| EnvelopeError::Decrypt(e.to_string()))?;
    Ok(cert)
}

/// 엔벨로프를 복호화한 뒤 인증서를 전체 검증한다.
///
/// 복호화(LH-REQ-008)와 검증(LH-REQ-003, 010, 018)을 한 호출로 묶는다.
/// - 인자: envelope: 암호화된 엔벨로프
///   z_private_key: Application 개인키(Z_Pri)
///   lh_public_key: License Hub 공개키(LH_Pub)
///   context: 검증 Context
/// - 리턴: Ok(()) 또는 Err(EnvelopeError)
pub fn decrypt_and_verify(
    envelope: &EncryptedLicense,
    z_private_key: &SigningKey,
    lh_public_key: &VerifyingKey,
    context: &crate::VerificationContext,
) -> Result<(), EnvelopeError> {
    let certificate = decrypt_license(envelope, z_private_key, lh_public_key)?;
    crate::verify(&certificate, lh_public_key, context)
        .map_err(|e| EnvelopeError::Decrypt(e.to_string()))?;
    Ok(())
}

//--------------------------------------------------------------------------------
// Challenge-Response (LH-REQ-012, LH-REQ-019)
//--------------------------------------------------------------------------------

/// 실행 시 Application이 Z_Pri를 실제 보유하고 있음을 증명하기 위한 Challenge.
///
/// 매 실행마다 새 Nonce를 생성하므로 동일한 인증 결과의 재사용(Replay)을
/// 막는다(LH-REQ-019).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Challenge {
    /// URL-safe Base64 임의 Nonce.
    pub nonce: String,
    /// 세션 식별자(세션 ID 또는 SessionInfo 직렬화 값).
    pub session: String,
}

/// 무작위 Nonce를 포함한 새 Challenge를 생성한다.
pub fn generate_challenge(session: impl Into<String>) -> Challenge {
    let mut nonce = [0u8; 32];
    getrandom::fill(&mut nonce).expect("operating system random source unavailable");
    Challenge {
        nonce: URL_SAFE_NO_PAD.encode(nonce),
        session: session.into(),
    }
}

/// Application이 Z_Pri로 Challenge에 서명한다(응답).
pub fn sign_challenge(z_private_key: &SigningKey, challenge: &Challenge) -> String {
    let payload = challenge_payload(challenge);
    URL_SAFE_NO_PAD.encode(z_private_key.sign(&payload).to_bytes())
}

/// 등록된 Z_Pub으로 Challenge 응답을 검증한다.
///
/// 서명이 유효하면 해당 Application이 정확히 그 Z_Pri를 보유한 것이다.
pub fn verify_challenge(
    z_public_key: &VerifyingKey,
    challenge: &Challenge,
    signature_b64: &str,
) -> Result<(), EnvelopeError> {
    let payload = challenge_payload(challenge);
    let sig_bytes = URL_SAFE_NO_PAD
        .decode(signature_b64)
        .map_err(|_| EnvelopeError::InvalidSignature)?;
    let signature =
        Signature::from_slice(&sig_bytes).map_err(|_| EnvelopeError::InvalidSignature)?;
    z_public_key
        .verify(&payload, &signature)
        .map_err(|_| EnvelopeError::InvalidSignature)
}

/// Challenge 서명 대상 canonical payload.
fn challenge_payload(challenge: &Challenge) -> Vec<u8> {
    let mut output = Vec::new();
    output.extend_from_slice(b"lh-challenge-v1");
    output.extend_from_slice(challenge.nonce.as_bytes());
    output.push(0);
    output.extend_from_slice(challenge.session.as_bytes());
    output
}

//--------------------------------------------------------------------------------
// Activation Token (LH-REQ-021)
//--------------------------------------------------------------------------------

/// X가 라이선스 검증 성공 후 Y에 전달하는 짧은 수명의 활성화 토큰.
///
/// Y는 이 토큰이 유효하지 않으면 핵심 기능을 실행하지 않는다. 토큰은
/// Application ID·Session·Feature·Expiration·Nonce에 바인딩된다.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActivationToken {
    /// 토큰이 유효한 Application ID.
    pub app_id: String,
    /// 세션 식별자.
    pub session_id: String,
    /// 활성화할 기능 식별자.
    pub feature: String,
    /// 발급 시각(RFC 3339 UTC).
    pub issued_at: String,
    /// 만료 시각(RFC 3339 UTC).
    pub expires_at: String,
    /// Replay 방지용 Nonce.
    pub nonce: String,
}

/// 활성화 토큰 검증 실패 사유.
#[derive(Debug, Error, PartialEq)]
pub enum TokenError {
    #[error("invalid token format")]
    InvalidFormat,
    #[error("token has expired")]
    Expired,
    #[error("token is not yet valid")]
    NotYetValid,
    #[error("token application or session does not match")]
    BindingMismatch,
}

/// 새 활성화 토큰을 생성한다.
pub fn issue_activation_token(
    app_id: impl Into<String>,
    session_id: impl Into<String>,
    feature: impl Into<String>,
    issued_at: impl Into<String>,
    expires_at: impl Into<String>,
) -> ActivationToken {
    let mut nonce = [0u8; 16];
    getrandom::fill(&mut nonce).expect("operating system random source unavailable");
    ActivationToken {
        app_id: app_id.into(),
        session_id: session_id.into(),
        feature: feature.into(),
        issued_at: issued_at.into(),
        expires_at: expires_at.into(),
        nonce: URL_SAFE_NO_PAD.encode(nonce),
    }
}

/// 활성화 토큰을 검증한다.
///
/// - 인자: token: 검증할 토큰
///   app_id: 현재 Application ID
///   session_id: 현재 세션 ID
///   now: 검증 기준 시각(RFC 3339 UTC)
/// - 리턴: Ok(()) 또는 Err(TokenError)
pub fn validate_activation_token(
    token: &ActivationToken,
    app_id: &str,
    session_id: &str,
    now: &str,
) -> Result<(), TokenError> {
    if token.app_id.is_empty() || token.feature.is_empty() {
        return Err(TokenError::InvalidFormat);
    }
    let issued =
        OffsetDateTime::parse(&token.issued_at, &Rfc3339).map_err(|_| TokenError::InvalidFormat)?;
    let expires = OffsetDateTime::parse(&token.expires_at, &Rfc3339)
        .map_err(|_| TokenError::InvalidFormat)?;
    let now = OffsetDateTime::parse(now, &Rfc3339).map_err(|_| TokenError::InvalidFormat)?;
    if expires <= issued {
        return Err(TokenError::InvalidFormat);
    }
    if now < issued {
        return Err(TokenError::NotYetValid);
    }
    if now >= expires {
        return Err(TokenError::Expired);
    }
    if token.app_id != app_id || token.session_id != session_id {
        return Err(TokenError::BindingMismatch);
    }
    Ok(())
}

//--------------------------------------------------------------------------------
// C ABI
//--------------------------------------------------------------------------------

/// 암호화된 License를 C ABI로 복호화·검증한다.
///
/// 반환값 0은 요청 처리 성공(결과는 result_code), -1은 인자 오류, -2는
/// 입력 파싱·복호화 오류, -3은 Application 불일치·서명 오류다.
///
/// # Safety: 모든 비-NULL 포인터는 전달된 길이만큼 유효한 읽기 버퍼를
/// 가리켜야 하고, result_code는 u32를 쓸 수 있는 메모리를 가리켜야 한다.
#[allow(clippy::missing_safety_doc)]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lh_decrypt_license(
    envelope: *const u8,
    envelope_len: usize,
    z_private_key: *const u8,
    z_private_key_len: usize,
    lh_public_key: *const u8,
    lh_public_key_len: usize,
    result_code: *mut u32,
) -> i32 {
    if result_code.is_null()
        || envelope.is_null()
        || z_private_key.is_null()
        || lh_public_key.is_null()
        || envelope_len > MAX_ENVELOPE_SIZE
        || z_private_key_len != 32
        || lh_public_key_len != 32
    {
        return -1;
    }
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        let envelope_bytes = unsafe { slice::from_raw_parts(envelope, envelope_len) };
        let z_pri_bytes = unsafe { slice::from_raw_parts(z_private_key, z_private_key_len) };
        let lh_pub_bytes = unsafe { slice::from_raw_parts(lh_public_key, lh_public_key_len) };
        let envelope: EncryptedLicense =
            serde_json::from_slice(envelope_bytes).map_err(|_| -2i32)?;
        let z_pri: [u8; 32] = z_pri_bytes.try_into().map_err(|_| -2i32)?;
        let lh_pub: [u8; 32] = lh_pub_bytes.try_into().map_err(|_| -2i32)?;
        let z_pri = SigningKey::from_bytes(&z_pri);
        let lh_pub = VerifyingKey::from_bytes(&lh_pub).map_err(|_| -2i32)?;
        let certificate = decrypt_license(&envelope, &z_pri, &lh_pub).map_err(|e| match e {
            EnvelopeError::InvalidFormat
            | EnvelopeError::Serialization(_)
            | EnvelopeError::Decrypt(_) => -2,
            EnvelopeError::InvalidSignature | EnvelopeError::ApplicationMismatch => -3,
            EnvelopeError::Encrypt(_) => -2,
        })?;
        Ok::<Certificate, i32>(certificate)
    }));
    match outcome {
        Ok(Ok(_certificate)) => {
            unsafe { *result_code = 0 };
            0
        }
        Ok(Err(status)) => status,
        Err(_) => -2,
    }
}

/// Challenge-Response 서명을 검증한다(LH-REQ-012).
///
/// - 인자: z_public_key: Application 공개키(Z_Pub) 32바이트
///   challenge: Challenge JSON 바이트
///   challenge_len: Challenge 길이
///   signature_b64: 서명(URL-safe Base64) 바이트
///   signature_b64_len: 서명 길이
/// - 리턴: 0 성공 / -1 인자 오류 / -2 파싱 오류 / 1 서명 불일치
#[allow(clippy::missing_safety_doc)]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lh_verify_challenge(
    z_public_key: *const u8,
    z_public_key_len: usize,
    challenge: *const u8,
    challenge_len: usize,
    signature_b64: *const u8,
    signature_b64_len: usize,
) -> i32 {
    if z_public_key.is_null()
        || challenge.is_null()
        || signature_b64.is_null()
        || z_public_key_len != 32
        || challenge_len > MAX_CHALLENGE_SIZE
        || signature_b64_len > MAX_CHALLENGE_SIZE
    {
        return -1;
    }
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        let z_pub_bytes = unsafe { slice::from_raw_parts(z_public_key, z_public_key_len) };
        let challenge_bytes = unsafe { slice::from_raw_parts(challenge, challenge_len) };
        let sig_bytes = unsafe { slice::from_raw_parts(signature_b64, signature_b64_len) };
        let z_pub: [u8; 32] = z_pub_bytes.try_into().map_err(|_| -2i32)?;
        let z_pub = VerifyingKey::from_bytes(&z_pub).map_err(|_| -2i32)?;
        let challenge: Challenge = serde_json::from_slice(challenge_bytes).map_err(|_| -2i32)?;
        let sig = std::str::from_utf8(sig_bytes).map_err(|_| -2i32)?;
        match verify_challenge(&z_pub, &challenge, sig) {
            Ok(()) => Ok(0i32),
            Err(_) => Ok(1i32),
        }
    }));
    match outcome {
        Ok(Ok(code)) => code,
        Ok(Err(status)) => status,
        Err(_) => -2,
    }
}

/// Application 공개키(Z_Pub)에서 Application ID를 파생한다.
/// - 인자: z_public_key: 32바이트 공개키, out: 최대 64바이트 출력 버퍼
/// - 리턴: 0 성공 / -1 인자 오류
#[allow(clippy::missing_safety_doc)]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lh_application_id(
    z_public_key: *const u8,
    z_public_key_len: usize,
    out: *mut u8,
    out_len: usize,
) -> i32 {
    if z_public_key.is_null() || out.is_null() || z_public_key_len != 32 || out_len < 64 {
        return -1;
    }
    let z_pub_bytes = unsafe { slice::from_raw_parts(z_public_key, z_public_key_len) };
    let z_pub: [u8; 32] = match z_pub_bytes.try_into() {
        Ok(v) => v,
        Err(_) => return -1,
    };
    let z_pub = match VerifyingKey::from_bytes(&z_pub) {
        Ok(v) => v,
        Err(_) => return -1,
    };
    let id = application_id(&z_pub);
    let bytes = id.as_bytes();
    if bytes.len() > out_len {
        return -1;
    }
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), out, bytes.len());
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::CertificateRequest;

    fn test_issuer() -> Issuer {
        Issuer::from_bytes("test-lh-key", &[42u8; 32])
    }

    fn test_app_keys() -> (SigningKey, VerifyingKey) {
        let signing = SigningKey::from_bytes(&[7u8; 32]);
        let verifying = signing.verifying_key();
        (signing, verifying)
    }

    fn test_certificate(issuer: &Issuer) -> Certificate {
        issuer
            .issue(
                CertificateRequest::new("license-1", 1, "DXi", "1.2.0")
                    .expires_at("2030-01-01T00:00:00Z"),
            )
            .unwrap()
    }

    #[test]
    fn encrypted_license_round_trip_passes() {
        let issuer = test_issuer();
        let (z_pri, z_pub) = test_app_keys();
        let cert = test_certificate(&issuer);
        let envelope = encrypt_license(&cert, &z_pub, &issuer).unwrap();
        let decrypted = decrypt_license(&envelope, &z_pri, &issuer.verifying_key()).unwrap();
        assert_eq!(decrypted, cert);
    }

    #[test]
    fn encrypted_license_plaintext_is_not_exposed() {
        let issuer = test_issuer();
        let (_, z_pub) = test_app_keys();
        let cert = test_certificate(&issuer);
        let envelope = encrypt_license(&cert, &z_pub, &issuer).unwrap();
        let json = serde_json::to_string(&envelope).unwrap();
        // 원문 식별 정보(Owner/Level/Product)가 암호문 밖에 없어야 한다(LH-REQ-005).
        assert!(!json.contains("DXi"));
        assert!(!json.contains("license-1"));
        assert!(!json.contains("\"level\":1"));
        assert!(!json.contains("expires_at"));
    }

    #[test]
    fn wrong_application_private_key_is_rejected() {
        let issuer = test_issuer();
        let (_, z_pub) = test_app_keys();
        let cert = test_certificate(&issuer);
        let envelope = encrypt_license(&cert, &z_pub, &issuer).unwrap();
        let other_pri = SigningKey::from_bytes(&[99u8; 32]);
        assert_eq!(
            decrypt_license(&envelope, &other_pri, &issuer.verifying_key()),
            Err(EnvelopeError::ApplicationMismatch)
        );
    }

    #[test]
    fn tampered_envelope_signature_is_rejected() {
        let issuer = test_issuer();
        let (z_pri, z_pub) = test_app_keys();
        let cert = test_certificate(&issuer);
        let mut envelope = encrypt_license(&cert, &z_pub, &issuer).unwrap();
        envelope.app_id = "tampered".into();
        assert_eq!(
            decrypt_license(&envelope, &z_pri, &issuer.verifying_key()),
            Err(EnvelopeError::InvalidSignature)
        );
    }

    #[test]
    fn application_id_is_sha256_of_public_key() {
        let (_, z_pub) = test_app_keys();
        let expected = URL_SAFE_NO_PAD.encode(Sha256::digest(z_pub.to_bytes()));
        assert_eq!(application_id(&z_pub), expected);
    }

    #[test]
    fn challenge_response_round_trip_passes() {
        let (z_pri, z_pub) = test_app_keys();
        let challenge = generate_challenge("session-1");
        let sig = sign_challenge(&z_pri, &challenge);
        assert!(verify_challenge(&z_pub, &challenge, &sig).is_ok());
    }

    #[test]
    fn challenge_response_fails_with_wrong_key() {
        let (z_pri, _) = test_app_keys();
        let other_pub = SigningKey::from_bytes(&[5u8; 32]).verifying_key();
        let challenge = generate_challenge("session-1");
        let sig = sign_challenge(&z_pri, &challenge);
        assert_eq!(
            verify_challenge(&other_pub, &challenge, &sig),
            Err(EnvelopeError::InvalidSignature)
        );
    }

    #[test]
    fn activation_token_validates_within_lifetime() {
        let token = issue_activation_token(
            "app-1",
            "sess-1",
            "core",
            "2026-01-01T00:00:00Z",
            "2026-01-01T01:00:00Z",
        );
        assert!(
            validate_activation_token(&token, "app-1", "sess-1", "2026-01-01T00:30:00Z").is_ok()
        );
        assert_eq!(
            validate_activation_token(&token, "app-1", "sess-1", "2026-01-01T01:30:00Z"),
            Err(TokenError::Expired)
        );
        assert_eq!(
            validate_activation_token(&token, "app-2", "sess-1", "2026-01-01T00:30:00Z"),
            Err(TokenError::BindingMismatch)
        );
    }
}
