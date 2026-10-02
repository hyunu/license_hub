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
    pub device_id: Option<String>,
    pub expires_at: String,
    pub status: String,
    pub metadata: Option<String>,
    pub created_at: String,
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
    pub holder: String,
    pub device_id: Option<String>,
    pub expires_at: String,
    pub status: Option<String>,
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
