use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub role: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct License {
    pub id: i64,
    pub license_id: String,
    pub product: String,
    pub version: String,
    pub level: i64,
    pub holder: String,
    pub expires_at: String,
    pub status: String,
    pub metadata: Option<String>,
    /// P의 Target Language (이미지 1.1). C/C++/C#/Python 등.
    pub target_language: Option<String>,
    /// Application 공개키(Z_Pub, PEM). 라이선스를 이 키로 암호화한다.
    pub application_public_key: Option<String>,
    /// Application 공개키에서 파생한 Application ID.
    pub application_id: Option<String>,
    /// L2에서 런타임에 라이선스 상태를 확인할 검증 서버 주소.
    /// 발급 시 인증서에 서명되어 들어간다. L1은 없다.
    pub verification_url: Option<String>,
    pub created_at: String,
    pub certificates: i64,
    /// 암호화된 LIC 존재 여부 (AK2 등록 + 발급 완료).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encrypted_license: Option<EncryptedLicenseInfo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EncryptedLicenseInfo {
    pub schema_version: u32,
    pub key_id: String,
    /// AK2 로 암호화되었음을 UI에서 확인할 수 있는 표시용 값.
    pub encrypted_for: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BlacklistEntry {
    pub license_id: String,
    pub reason: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuditEntry {
    pub id: i64,
    pub actor: String,
    pub action: String,
    pub target: Option<String>,
    pub detail: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct LicenseInput {
    /// 비워두면 시스템이 자동으로 생성한다.
    #[serde(default)]
    pub license_id: Option<String>,
    pub product: String,
    pub version: String,
    pub level: i64,
    /// P의 Owner.
    pub holder: String,
    pub expires_at: String,
    pub status: Option<String>,
    /// P의 Target Language (이미지 1.1). 비우면 "any".
    #[serde(default)]
    pub target_language: Option<String>,
    /// P를 암호화할 Application 공개키(AK2 = Z_Pub, PEM). 이미지 1.1의 AK2.
    #[serde(default)]
    pub application_public_key: Option<String>,
    /// L2에서 런타임에 라이선스 상태를 확인할 검증 서버 주소.
    /// L2면 필수, L1이면 비워야 한다.
    #[serde(default)]
    pub verification_url: Option<String>,
    /// 사용자 메타정보(자유 텍스트)
    #[serde(default)]
    pub metadata: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UserInput {
    pub username: String,
    pub password: String,
    pub role: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct BlacklistInput {
    pub license_id: String,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
pub struct VerifyRequest {
    pub license_id: String,
}
