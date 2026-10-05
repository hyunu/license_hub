//! L2 서버 검증 온라인 클라이언트.
//!
//! Core의 검증 로직 자체는 네트워크를 쓰지 않는다. 대신 이 모듈이 인증서에
//! 서명된 `server.verification_url`로 조회해 `server_status`를 채운 뒤
//! 검증을 수행한다. 즉 L2 검증의 "조회" 단계를 담당한다.
//!
//! 흐름:
//! ```text
//! LIC 복호화 → P에서 verification_url 획득
//!   → POST {verification_url} {"license_id": ...}
//!   → approved/rejected 를 ServerStatus 로 매핑
//!   → context.server_status 주입 → verify
//! ```
//!
//! 서버 응답 규약(계약):
//! - 요청: `POST {verification_url}` `Content-Type: application/json`
//! - 본문: `{"license_id":"<LICENSE-ID>"}`
//! - 응답(200): `{"status":"approved"}` 또는 `{"status":"rejected", ...}`
//! - 그 외 상태/형식은 실패로 간주한다.
//!
//! 요청 인증은 아직 없다. 서버가 존재하는 곳(`verification_url`)으로 그대로
//! 접속한다.

use ed25519_dalek::SigningKey;
use serde::Deserialize;
use std::time::Duration;
use zeroize::Zeroizing;

use crate::envelope::{EncryptedLicense, EnvelopeError, decrypt_license};
use crate::{ServerStatus, VerificationContext, VerificationError};

/// 온라인 검증 실패 사유.
#[derive(Debug, thiserror::Error)]
pub enum OnlineError {
    #[error("verification server request failed: {0}")]
    Network(String),
    #[error("verification server returned an invalid response")]
    InvalidResponse,
    #[error("level 2/3 certificate has no verification_url")]
    MissingVerificationUrl,
    #[error(transparent)]
    Envelope(#[from] EnvelopeError),
    #[error(transparent)]
    Verification(#[from] VerificationError),
}

/// 서버 응답 본문. `status`가 approved/rejected다.
#[derive(Debug, Deserialize)]
struct VerifyResponse {
    status: Option<String>,
}

/// `verification_url`로 `license_id`를 조회해 서버 상태를 얻는다.
///
/// 네트워크 오류나 예상 밖 응답은 Err로 반환한다. 호출자는 정책에 따라
/// 캐시를 쓰거나 실패로 처리한다.
pub fn fetch_server_status(
    verification_url: &str,
    license_id: &str,
) -> Result<ServerStatus, OnlineError> {
    let body = serde_json::json!({ "license_id": license_id });
    let response = ureq::post(verification_url)
        .set(crate::VERIFY_API_KEY_HEADER, crate::VERIFY_API_KEY)
        .timeout(Duration::from_secs(5))
        .send_json(body)
        .map_err(|e| OnlineError::Network(e.to_string()))?;
    let parsed: VerifyResponse = response
        .into_json()
        .map_err(|_| OnlineError::InvalidResponse)?;
    match parsed.status.as_deref() {
        Some("approved") => Ok(ServerStatus::Approved),
        Some("rejected") => Ok(ServerStatus::Rejected),
        _ => Err(OnlineError::InvalidResponse),
    }
}

/// L2 서버 상태를 확정한다. **Fail-Closed**.
///
/// 승인 응답을 받은 경우에만 `Some(Approved)`를 돌려준다. 오프라인·타임아웃·
/// 오류·예상 밖 응답은 모두 `None`이 되어 서버 검증 미충족으로 처리되고,
/// 결과적으로 라이선스가 비활성화된다. L2는 오프라인에서 무조건 비활성이다.
pub fn resolve_server_status(verification_url: &str, license_id: &str) -> Option<ServerStatus> {
    fetch_server_status(verification_url, license_id).ok()
}

/// LIC를 복호화하고, L2 이상이면 서버에 조회한 뒤 검증까지 수행한다.
///
/// L2는 서버에 도달하지 못하면 비활성화된다(Fail-Closed, `resolve_server_status`).
/// `base_context`에는 서버 상태만 제외한 검증 환경을 넣는다.
pub fn decrypt_verify_trusted_license_online(
    envelope: &EncryptedLicense,
    z_private_key: &SigningKey,
    base_context: &VerificationContext,
) -> Result<(), OnlineError> {
    let lh_public_key = crate::trusted::trusted_public_key();
    let certificate = decrypt_license(envelope, z_private_key, &lh_public_key)?;

    let mut context = base_context.clone();
    if certificate.level >= 2 {
        let url = certificate
            .server
            .as_ref()
            .map(|s| s.verification_url.as_str())
            .ok_or(OnlineError::MissingVerificationUrl)?;
        // 오프라인이면 None → ServerRequired → 검증 실패(비활성).
        context.server_status = resolve_server_status(url, &certificate.license_id);
    }
    crate::trusted::verify_trusted(&certificate, &context)?;
    Ok(())
}

//--------------------------------------------------------------------------------
// C ABI
//--------------------------------------------------------------------------------

/// 서버 상태 코드: 승인.
pub const LH_SERVER_APPROVED: u32 = 0;
/// 서버 상태 코드: 거부.
pub const LH_SERVER_REJECTED: u32 = 1;

/// `verification_url`로 `license_id`를 조회해 서버 상태를 반환한다.
///
/// 반환값 0은 조회 성공(결과는 result_code), -1은 인자 오류, -2는 네트워크
/// 오류 또는 응답 파싱 오류다. L2 검증에서 이 값을 얻어 context JSON의
/// `server_status`("approved"/"rejected")에 넣는다.
///
/// # Safety: url/license_id는 지정 길이만큼 유효한 읽기 버퍼여야 하고,
/// result_code는 u32를 쓸 수 있는 메모리를 가리켜야 한다.
#[allow(clippy::missing_safety_doc)]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lh_fetch_server_status(
    url: *const u8,
    url_len: usize,
    license_id: *const u8,
    license_id_len: usize,
    result_code: *mut u32,
) -> i32 {
    if url.is_null() || license_id.is_null() || result_code.is_null() {
        return -1;
    }
    let url_bytes = unsafe { std::slice::from_raw_parts(url, url_len) };
    let id_bytes = unsafe { std::slice::from_raw_parts(license_id, license_id_len) };
    let (Ok(url), Ok(license_id)) = (
        std::str::from_utf8(url_bytes),
        std::str::from_utf8(id_bytes),
    ) else {
        return -1;
    };
    match fetch_server_status(url, license_id) {
        Ok(ServerStatus::Approved) => {
            unsafe { *result_code = LH_SERVER_APPROVED };
            0
        }
        Ok(ServerStatus::Rejected) => {
            unsafe { *result_code = LH_SERVER_REJECTED };
            0
        }
        Err(_) => -2,
    }
}

const MAX_ONLINE_ENVELOPE_SIZE: usize = 128 * 1024;

/// L2 이상 LIC를 복호화하고, 서버에 조회한 뒤 검증한다 (Fail-Closed).
///
/// 오프라인이거나 서버 응답을 받지 못하면 비활성으로 처리된다. 즉 L2는
/// 서버에 도달하지 못하면 무조건 비활성화된다.
///
/// 반환값은 `lh_decrypt_verify_trusted_license`와 같다. 0은 처리 성공
/// (결과는 result_code), -1은 인자 오류, -2는 파싱·복호화 오류, -3은
/// 엔벨로프 서명·Application 불일치다.
///
/// # Safety: 모든 비-NULL 포인터는 지정 길이만큼 유효한 읽기 버퍼여야 하고,
/// result_code는 u32를 쓸 수 있는 메모리를 가리켜야 한다.
#[allow(clippy::missing_safety_doc)]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lh_decrypt_verify_trusted_license_online(
    envelope: *const u8,
    envelope_len: usize,
    z_private_key: *const u8,
    z_private_key_len: usize,
    context: *const u8,
    context_len: usize,
    result_code: *mut u32,
) -> i32 {
    if result_code.is_null()
        || envelope.is_null()
        || z_private_key.is_null()
        || (context_len > 0 && context.is_null())
        || envelope_len > MAX_ONLINE_ENVELOPE_SIZE
        || z_private_key_len != 32
        || context_len > crate::MAX_CONTEXT_SIZE
    {
        return -1;
    }
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let envelope_bytes = unsafe { std::slice::from_raw_parts(envelope, envelope_len) };
        let z_pri_bytes = Zeroizing::new(unsafe {
            std::slice::from_raw_parts(z_private_key, z_private_key_len)
                .try_into()
                .map_err(|_| -2i32)?
        });
        let context_bytes = if context_len == 0 {
            b"{}" as &[u8]
        } else {
            unsafe { std::slice::from_raw_parts(context, context_len) }
        };
        let parsed_envelope: EncryptedLicense =
            serde_json::from_slice(envelope_bytes).map_err(|_| -2i32)?;
        let ffi_context: crate::FfiVerificationContext =
            serde_json::from_slice(context_bytes).map_err(|_| -2i32)?;
        let z_pri = SigningKey::from_bytes(&z_pri_bytes);
        Ok::<_, i32>((parsed_envelope, z_pri, ffi_context.into_context()))
    }));

    match outcome {
        Ok(Ok((parsed_envelope, z_pri, context))) => {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                decrypt_verify_trusted_license_online(&parsed_envelope, &z_pri, &context)
            }));
            match result {
                Ok(Ok(())) => {
                    unsafe { *result_code = 0 };
                    0
                }
                Ok(Err(OnlineError::Envelope(EnvelopeError::Verification(error)))) => {
                    unsafe { *result_code = crate::verification_code(Err(error)) };
                    0
                }
                Ok(Err(OnlineError::Envelope(
                    EnvelopeError::InvalidSignature | EnvelopeError::ApplicationMismatch,
                ))) => -3,
                Ok(Err(_)) | Err(_) => -2,
            }
        }
        Ok(Err(status)) => status,
        Err(_) => -2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    // 로컬 TCP 리스너로 서버 응답을 흉내 내 매핑을 검증한다.
    fn serve_once(response_body: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf);
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response_body.len(),
                    response_body
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });
        format!("http://{addr}/verify")
    }

    #[test]
    fn maps_approved_response() {
        let url = serve_once(r#"{"status":"approved"}"#);
        assert!(matches!(
            fetch_server_status(&url, "LIC-1"),
            Ok(ServerStatus::Approved)
        ));
    }

    #[test]
    fn maps_rejected_response() {
        let url = serve_once(r#"{"status":"rejected","reason":"revoked"}"#);
        assert!(matches!(
            fetch_server_status(&url, "LIC-1"),
            Ok(ServerStatus::Rejected)
        ));
    }

    #[test]
    fn rejects_unknown_status() {
        let url = serve_once(r#"{"status":"maybe"}"#);
        assert!(matches!(
            fetch_server_status(&url, "LIC-1"),
            Err(OnlineError::InvalidResponse)
        ));
    }

    #[test]
    fn fails_closed_when_offline() {
        // 도달할 수 없는 주소 → None → L2 비활성.
        assert_eq!(
            resolve_server_status("http://127.0.0.1:1/verify", "LIC-1"),
            None
        );
    }

    #[test]
    fn sends_api_key_header() {
        use std::sync::mpsc;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 2048];
                let n = stream.read(&mut buf).unwrap_or(0);
                let _ = tx.send(String::from_utf8_lossy(&buf[..n]).to_lowercase());
                let body = r#"{"status":"approved"}"#;
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });
        let url = format!("http://{addr}/verify");
        let _ = fetch_server_status(&url, "LIC-1");
        let request = rx.recv().unwrap();
        assert!(request.contains(crate::VERIFY_API_KEY_HEADER));
        assert!(request.contains(crate::VERIFY_API_KEY));
    }
}
