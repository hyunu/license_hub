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

/// LIC를 복호화하고, L2 이상이면 서버에 조회한 뒤 검증까지 수행한다.
///
/// `base_context`에는 서버 상태만 제외한 검증 환경을 넣는다. 네트워크
/// 조회는 인증서의 `verification_url`과 `license_id`로 수행한다.
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
        context.server_status = Some(fetch_server_status(url, &certificate.license_id)?);
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
}
