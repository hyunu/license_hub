use std::sync::{Arc, Mutex};

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use ed25519_dalek::{SigningKey, VerifyingKey};
use licensehub_core::envelope::{application_id, encrypt_license};
use licensehub_core::{CertificateRequest, Issuer};
use pkcs8::{DecodePublicKey, EncodePrivateKey, EncodePublicKey, LineEnding};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::auth::{
    create_session, hash_password, now_rfc3339, user_by_token, user_by_username, verify_password,
};
use crate::github::GitHubClient;
use crate::models::*;

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub issuer: Arc<Issuer>,
    pub github: Option<GitHubClient>,
}

type ApiError = (StatusCode, Json<Value>);

fn unauthorized() -> ApiError {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "unauthorized" })),
    )
}
fn bad_request(msg: &str) -> ApiError {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": msg })))
}
fn not_found(msg: &str) -> ApiError {
    (StatusCode::NOT_FOUND, Json(json!({ "error": msg })))
}
fn conflict(msg: &str) -> ApiError {
    (StatusCode::CONFLICT, Json(json!({ "error": msg })))
}
fn internal(msg: &str) -> ApiError {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": msg })),
    )
}

fn auth_user(state: &AppState, headers: &HeaderMap) -> Result<User, ApiError> {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(unauthorized)?;
    let db = state.db.lock().unwrap();
    user_by_token(&db, token).ok_or_else(unauthorized)
}

/// admin 역할만 통과시킨다. 서버에서 실제로 데이터를 삭제하는 작업처럼
/// 되돌릴 수 없는 동작에 사용한다.
fn require_admin(user: &User) -> Result<(), ApiError> {
    if user.role == "admin" {
        Ok(())
    } else {
        Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "admin role required" })),
        ))
    }
}

/// admin 역할 사용자 수를 센다. 마지막 admin 보호에 사용한다.
fn admin_count(db: &Connection) -> rusqlite::Result<i64> {
    db.query_row("SELECT COUNT(*) FROM users WHERE role = 'admin'", [], |r| {
        r.get(0)
    })
}

fn log_audit(
    state: &AppState,
    actor: &str,
    action: &str,
    target: Option<&str>,
    detail: Option<&str>,
) {
    let db = state.db.lock().unwrap();
    let _ = db.execute(
        "INSERT INTO audit_logs (actor, action, target, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![actor, action, target, detail, now_rfc3339()],
    );
}

fn meta_get(db: &Connection, key: &str) -> Option<String> {
    db.query_row("SELECT value FROM meta WHERE key = ?1", params![key], |r| {
        r.get(0)
    })
    .ok()
}
fn meta_set(db: &Connection, key: &str, value: &str) {
    let _ = db.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    );
}

// ---------------- Auth ----------------

pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(body): Json<LoginRequest>,
) -> Result<Json<Value>, ApiError> {
    let (id, username, hash, role) = {
        let db = state.db.lock().unwrap();
        user_by_username(&db, &body.username).ok_or_else(unauthorized)?
    };
    if !verify_password(&body.password, &hash) {
        return Err(unauthorized());
    }
    let token = {
        let db = state.db.lock().unwrap();
        create_session(&db, id).map_err(|e| internal(&e))?
    };
    log_audit(&state, &username, "login", None, None);
    Ok(Json(json!({
        "token": token,
        "user": { "id": id, "username": username, "role": role }
    })))
}

pub async fn me(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<User>, ApiError> {
    let user = auth_user(&state, &headers)?;
    Ok(Json(user))
}

pub async fn logout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let user = auth_user(&state, &headers)?;
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or_default();
    {
        let db = state.db.lock().unwrap();
        let _ = db.execute("DELETE FROM sessions WHERE token = ?1", params![token]);
    }
    log_audit(&state, &user.username, "logout", None, None);
    Ok(Json(json!({ "ok": true })))
}

// ---------------- Dashboard ----------------

pub async fn stats(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    auth_user(&state, &headers)?;
    let counts: (i64, i64, i64, i64, i64, i64, i64) = {
        let db = state.db.lock().unwrap();
        let one = |sql: &str| db.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap_or(0);
        (
            one("SELECT COUNT(*) FROM users"),
            one("SELECT COUNT(*) FROM licenses"),
            one("SELECT COUNT(*) FROM licenses WHERE status = 'active'"),
            one("SELECT COUNT(*) FROM licenses WHERE status = 'revoked'"),
            one("SELECT COUNT(*) FROM licenses WHERE status = 'blacklisted'"),
            one("SELECT COUNT(*) FROM certificates"),
            one("SELECT COUNT(*) FROM audit_logs"),
        )
    };
    Ok(Json(json!({
        "users": counts.0, "licenses": counts.1, "active": counts.2,
        "revoked": counts.3, "blacklisted": counts.4, "certificates": counts.5, "audit": counts.6
    })))
}

pub async fn public_key(State(state): State<Arc<AppState>>) -> Json<Value> {
    // 다운로드/조회 시점에 항상 개인키에서 파생한다(캐시를 신뢰하지 않음).
    let public_key = state.issuer.verifying_key();
    let raw = public_key.to_bytes();
    let pem = public_key
        .to_public_key_pem(LineEnding::LF)
        .unwrap_or_default();
    Json(json!({
        "key_id": "license-signing-key",
        "algorithm": "Ed25519",
        "hex": hex::encode(raw),
        "pem": pem
    }))
}

/// 공개키를 다운로드 파일(.pem)로 내려받는다.
/// 요청 시점에 개인키에서 추출하므로 저장·캐시된 값과 항상 일치한다.
pub async fn download_public_key(State(state): State<Arc<AppState>>) -> Result<Response, ApiError> {
    let public_key = state.issuer.verifying_key();
    let pem = public_key
        .to_public_key_pem(LineEnding::LF)
        .map_err(|e| internal(&e.to_string()))?;
    let mut hdrs = HeaderMap::new();
    hdrs.insert(
        header::CONTENT_TYPE,
        "application/x-pem-file".parse().unwrap(),
    );
    hdrs.insert(
        header::CONTENT_DISPOSITION,
        "attachment; filename=\"public-key.pem\"".parse().unwrap(),
    );
    Ok((hdrs, pem).into_response())
}

/// 라이선스가 사용한 공개키를 (key_id, pem) 형태로 반환한다.
/// 발급 시 certificates.public_key 에 보존해 두므로, 개인키가 교체되어도
/// 이전 인증서의 검증 공개키를 추출할 수 있다. 이력에 공개키가 없는
/// (이전 버전에서 발급된) 인증서는 현재 서명 키의 공개키로 대체한다.
fn license_public_key(state: &AppState, license_id: &str) -> Result<(String, String), ApiError> {
    let stored: Option<(String, String)> = {
        let db = state.db.lock().unwrap();
        db.query_row(
            "SELECT key_id, public_key FROM certificates
             WHERE license_id = ?1 ORDER BY id DESC LIMIT 1",
            params![license_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| internal(&e.to_string()))?
    };
    if let Some((key_id, public_key)) = stored.filter(|(_, p)| !p.is_empty()) {
        return Ok((key_id, public_key));
    }
    let pem = state
        .issuer
        .verifying_key()
        .to_public_key_pem(LineEnding::LF)
        .map_err(|e| internal(&e.to_string()))?;
    Ok((state.issuer.key_id().to_string(), pem))
}

/// 특정 라이선스의 최신 인증서가 서명될 때 사용한 공개키를 반환한다.
pub async fn certificate_public_key(
    State(state): State<Arc<AppState>>,
    Path(license_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (key_id, public_key) = license_public_key(&state, &license_id)?;
    Ok(Json(json!({
        "license_id": license_id,
        "key_id": key_id,
        "public_key": public_key,
    })))
}

// ---------------- Licenses ----------------

#[derive(Debug, Deserialize)]
pub struct LicenseQuery {
    pub status: Option<String>,
}

pub async fn list_licenses(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(q): Query<LicenseQuery>,
) -> Result<Json<Vec<License>>, ApiError> {
    auth_user(&state, &headers)?;
    let db = state.db.lock().unwrap();
    let mut stmt = match &q.status {
        Some(_) => db
            .prepare(&format!(
                "{LICENSE_SELECT} WHERE status = ?1 ORDER BY id DESC"
            ))
            .map_err(|e| internal(&e.to_string()))?,
        None => db
            .prepare(&format!("{LICENSE_SELECT} ORDER BY id DESC"))
            .map_err(|e| internal(&e.to_string()))?,
    };
    let rows = if let Some(status) = &q.status {
        stmt.query_map(params![status], map_license)
            .map_err(|e| internal(&e.to_string()))?
    } else {
        stmt.query_map([], map_license)
            .map_err(|e| internal(&e.to_string()))?
    };
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| internal(&e.to_string()))?);
    }
    Ok(Json(out))
}

const LICENSE_SELECT: &str = "SELECT id, license_id, product, version, level, holder, expires_at, status, metadata, target_language, application_public_key, created_at, \
(SELECT COUNT(*) FROM certificates WHERE certificates.license_id = licenses.license_id), \
(SELECT application_id FROM certificates WHERE certificates.license_id = licenses.license_id ORDER BY id DESC LIMIT 1), \
(SELECT encrypted_license FROM certificates WHERE certificates.license_id = licenses.license_id ORDER BY id DESC LIMIT 1), \
verification_url FROM licenses";

fn map_license(row: &rusqlite::Row) -> rusqlite::Result<License> {
    // Application ID는 사용자가 입력하지 않고 Application 공개키에서 파생한
    // 값만 담는다. UI에도 이 값만 노출한다.
    let application_id: Option<String> = row.get(13)?;
    let application_public_key: Option<String> = row.get(10)?;
    let encrypted_license: Option<String> = row.get(14)?;
    let verification_url: Option<String> = row.get(15)?;
    let encrypted = match encrypted_license {
        Some(raw) if !raw.trim().is_empty() => {
            let parsed: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
            Some(EncryptedLicenseInfo {
                schema_version: parsed
                    .get("schema_version")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0) as u32,
                key_id: parsed
                    .get("key_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string(),
                encrypted_for: application_id
                    .clone()
                    .or(application_public_key.clone())
                    .unwrap_or_default(),
            })
        }
        _ => None,
    };
    Ok(License {
        id: row.get(0)?,
        license_id: row.get(1)?,
        product: row.get(2)?,
        version: row.get(3)?,
        level: row.get(4)?,
        holder: row.get(5)?,
        expires_at: row.get(6)?,
        status: row.get(7)?,
        metadata: row.get(8)?,
        target_language: row.get(9)?,
        application_public_key,
        application_id,
        verification_url,
        created_at: row.get(11)?,
        certificates: row.get(12)?,
        encrypted_license: encrypted,
    })
}

pub async fn create_license(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<LicenseInput>,
) -> Result<Json<Value>, ApiError> {
    let user = auth_user(&state, &headers)?;
    if body.product.is_empty() || body.version.is_empty() || body.holder.is_empty() {
        return Err(bad_request("product, version, holder are required"));
    }
    if !(1..=2).contains(&body.level) {
        return Err(bad_request("level must be 1 or 2"));
    }
    let status = body.status.clone().unwrap_or_else(|| "active".into());

    // L2는 런타임에 라이선스 상태를 확인할 검증 서버 주소가 인증서에
    // 서명되어야 한다. 그 서버는 LicenseHub가 아니라 발급 시 지정한
    // 라이선스별 서버다. L1은 서버 검증이 없으므로 비워야 한다.
    let verification_url = body
        .verification_url
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    if body.level == 2 {
        let url = verification_url
            .as_deref()
            .ok_or_else(|| bad_request("level 2 requires verification_url"))?;
        if !(url.starts_with("https://") || url.starts_with("http://")) {
            return Err(bad_request(
                "verification_url must start with http:// or https://",
            ));
        }
    } else if verification_url.is_some() {
        return Err(bad_request("level 1 must not set verification_url"));
    }

    // Application 공개키는 사용자가 직접 넣거나, 비우면 서버가 생성한다.
    // 어느 쪽이든 라이선스를 암호화할 키는 반드시 존재해야 한다. 키가 없으면
    // 평문 인증서가 발급되어 소유자·만료일·등급이 그대로 노출된다.
    let provided = body
        .application_public_key
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty());
    let (application_public_key, generated_private_key) = match provided {
        Some(pem) => {
            if parse_application_public_key(pem).is_none() {
                return Err(bad_request(
                    "application_public_key must be an Ed25519 public key in PEM (SubjectPublicKeyInfo) form",
                ));
            }
            // 사용자가 공개키를 제공했다면 개인키는 알 수 없다. 해당 앱이
            // 이미 가지고 있는 키쌍이므로 여기서 새로 만들지 않는다.
            (Some(pem.to_string()), None)
        }
        None => {
            let pair = generate_application_keypair().map_err(|e| internal(&e.to_string()))?;
            (Some(pair.public_pem), Some(pair.private_pem))
        }
    };

    // license_id 를 비워두면 시스템이 자동 생성한다 (충돌 시 재생성).
    let auto = body
        .license_id
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .is_empty();
    let mut license_id = if auto {
        generate_license_id()
    } else {
        body.license_id.clone().unwrap().trim().to_string()
    };

    for _ in 0..8 {
        {
            let db = state.db.lock().unwrap();
            let res = db.execute(
                // 개인키는 이 응답으로 한 번만 내려주고 DB에는 남기지 않는다. 서버에
                // 계속 보관하면 데이터베이스 유출 시 그 앱과 같은 권한이 되므로,
                // 생성 시점에 받아 배포 대상 Application 에 심는 방식이 안전하다.
                "INSERT INTO licenses (license_id, product, version, level, holder, expires_at, status, metadata, target_language, application_public_key, verification_url, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![license_id, body.product, body.version, body.level, body.holder, body.expires_at, status, body.metadata, body.target_language, application_public_key, verification_url, now_rfc3339()],
            );
            if let Err(e) = res {
                if e.to_string().contains("UNIQUE") && auto {
                    license_id = generate_license_id();
                    continue;
                }
                return if e.to_string().contains("UNIQUE") {
                    Err(conflict("license_id already exists"))
                } else {
                    Err(internal(&e.to_string()))
                };
            }
        }
        break;
    }

    log_audit(
        &state,
        &user.username,
        "license.create",
        Some(&license_id),
        None,
    );
    let db = state.db.lock().unwrap();
    let lic = db
        .query_row(
            &format!("{LICENSE_SELECT} WHERE license_id = ?1"),
            params![license_id],
            map_license,
        )
        .map_err(|e| internal(&e.to_string()))?;
    drop(db);

    // 자동 생성했다면 개인키를 이 응답에서만 돌려준다. 목록 API 와 DB 에는
    // 절대 남지 않으므로, 이 시점에 받지 않으면 다시 받을 수 없다.
    let mut response = serde_json::to_value(&lic).map_err(|e| internal(&e.to_string()))?;
    if let (Some(object), Some(private_pem)) = (response.as_object_mut(), &generated_private_key) {
        object.insert(
            "application_private_key".into(),
            Value::String(private_pem.clone()),
        );
        object.insert("application_key_generated".into(), Value::Bool(true));
    }
    Ok(Json(response))
}

/// Application 키쌍(Z_Pri/Z_Pub)을 새로 만든다.
///
/// 사용자가 공개키를 직접 넣지 않았을 때 사용한다. 라이선스를 이 키쌍으로만
/// 암호화하므로, 한 앱용으로 발급된 라이선스는 다른 앱에서 복호화할 수 없다.
struct ApplicationKeyPair {
    public_pem: String,
    private_pem: String,
}

fn generate_application_keypair() -> Result<ApplicationKeyPair, String> {
    let mut seed = [0u8; 32];
    getrandom::fill(&mut seed).map_err(|e| format!("random source unavailable: {e}"))?;
    let signing = SigningKey::from_bytes(&seed);
    seed.fill(0);
    let public_pem = signing
        .verifying_key()
        .to_public_key_pem(LineEnding::LF)
        .map_err(|e| e.to_string())?;
    let private_pem = signing
        .to_pkcs8_pem(LineEnding::LF)
        .map_err(|e| e.to_string())?
        .to_string();
    Ok(ApplicationKeyPair {
        public_pem,
        private_pem,
    })
}

/// P를 암호화할 Application 공개키(AK2 = Z_Pub)를 파싱한다.
///
/// 이미지의 AK2에 해당한다. P 본문은 이 키로만 암호화되므로, 잘못된
/// 형식이 들어오면 LIC가 평문으로 발급될 위험이 있어 발급 전에 거절한다.
/// - 인자: pem: Ed25519 공개키 PEM(SubjectPublicKeyInfo)
/// - 리턴: Ok(공개키) 또는 None(형식 오류)
fn parse_application_public_key(pem: &str) -> Option<VerifyingKey> {
    VerifyingKey::from_public_key_pem(pem.trim()).ok()
}

/// 시스템이 자동으로 부여하는 License ID (예: XXXX-XXXX, 혼동 문자 제외).
fn generate_license_id() -> String {
    const CHARS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut bytes = [0u8; 8];
    let _ = getrandom::fill(&mut bytes);
    let s: String = bytes
        .iter()
        .map(|b| CHARS[(b % CHARS.len() as u8) as usize] as char)
        .collect();
    format!("{}-{}", &s[..4], &s[4..])
}

pub async fn license_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let user = auth_user(&state, &headers)?;
    let status = body.get("status").and_then(|v| v.as_str()).unwrap_or("");
    if !["active", "revoked", "blacklisted"].contains(&status) {
        return Err(bad_request(
            "status must be active, revoked, or blacklisted",
        ));
    }
    {
        let db = state.db.lock().unwrap();
        let n = db
            .execute(
                "UPDATE licenses SET status = ?1 WHERE id = ?2",
                params![status, id],
            )
            .map_err(|e| internal(&e.to_string()))?;
        if n == 0 {
            return Err(not_found("license not found"));
        }
    }
    log_audit(
        &state,
        &user.username,
        "license.status",
        Some(&format!("#{id}")),
        Some(status),
    );
    Ok(Json(json!({ "ok": true, "id": id, "status": status })))
}

/// 라이선스를 서버에서 삭제한다 (admin 전용).
///
/// 발급된 인증서와 Blacklist 항목도 함께 지운다. 폐기(revoke)와 달리
/// 되돌릴 수 없다.
pub async fn delete_license(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    let user = auth_user(&state, &headers)?;
    require_admin(&user)?;
    let license_id: String = {
        let db = state.db.lock().unwrap();
        let license_id = db
            .query_row(
                "SELECT license_id FROM licenses WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| internal(&e.to_string()))?
            .ok_or_else(|| not_found("license not found"))?;
        db.execute(
            "DELETE FROM certificates WHERE license_id = ?1",
            params![license_id],
        )
        .map_err(|e| internal(&e.to_string()))?;
        db.execute(
            "DELETE FROM blacklist WHERE license_id = ?1",
            params![license_id],
        )
        .map_err(|e| internal(&e.to_string()))?;
        db.execute("DELETE FROM licenses WHERE id = ?1", params![id])
            .map_err(|e| internal(&e.to_string()))?;
        license_id
    };
    log_audit(
        &state,
        &user.username,
        "license.delete",
        Some(&license_id),
        None,
    );
    Ok(Json(json!({ "ok": true, "license_id": license_id })))
}

pub async fn issue_certificate(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    let user = auth_user(&state, &headers)?;
    let lic: License = {
        let db = state.db.lock().unwrap();
        db.query_row(
            &format!("{LICENSE_SELECT} WHERE id = ?1"),
            params![id],
            map_license,
        )
        .map_err(|_| not_found("license not found"))?
    };
    if lic.status != "active" {
        return Err(bad_request("license is not active"));
    }
    let mut req =
        CertificateRequest::new(&lic.license_id, lic.level as u8, &lic.product, &lic.version)
            .expires_at(&lic.expires_at)
            .issued_at(now_rfc3339());

    // Application 공개키는 라이선스를 암호화하는 기준 키다. 키 없이 등록된
    // 기존 데이터도 여기서 거절하지 않고 새 키쌍을 만들어 이어서 쓸 수 있게
    // 한다. 키가 없으면 평문 인증서로 내려갈 수 없고, 소유자·만료일·등급이
    // 그대로 노출되기 때문이다. 개인키는 이 응답으로 한 번만 돌려준다.
    let mut generated_private_key: Option<String> = None;
    let application_public_key = match lic.application_public_key.as_deref() {
        Some(pem) if !pem.trim().is_empty() => parse_application_public_key(pem)
            .ok_or_else(|| bad_request("application_public_key is not a valid Ed25519 PEM"))?,
        _ => {
            let pair = generate_application_keypair().map_err(|e| internal(&e.to_string()))?;
            let parsed = parse_application_public_key(&pair.public_pem)
                .ok_or_else(|| internal("generated application key is not usable"))?;
            {
                let conn = state.db.lock().map_err(|e| internal(&e.to_string()))?;
                let updated = conn
                    .execute(
                        "UPDATE licenses SET application_public_key = ?2
                         WHERE license_id = ?1 AND (application_public_key IS NULL OR application_public_key = '')",
                        params![lic.license_id, pair.public_pem],
                    )
                    .map_err(|e| internal(&e.to_string()))?;
                if updated == 0 {
                    return Err(conflict("application key already exists for this license"));
                }
            }
            log_audit(
                &state,
                &user.username,
                "application.key.generate",
                Some(&lic.license_id),
                None,
            );
            generated_private_key = Some(pair.private_pem);
            parsed
        }
    };
    let app_id = application_id(&application_public_key);
    req = req.application_id(&app_id);
    let target_language = lic
        .target_language
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("any");
    req = req.target_language(target_language);

    if let Some(meta) = lic.metadata.as_deref()
        && !meta.trim().is_empty()
    {
        req = req.metadata("user_metadata", Value::String(meta.to_string()));
    }
    if lic.level == 2 {
        // 발급 시 지정한 라이선스별 검증 서버 주소를 인증서에 서명한다.
        // LicenseHub 자신을 가리키지 않도록 저장된 값을 그대로 쓴다.
        let url = lic
            .verification_url
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .ok_or_else(|| bad_request("level 2 requires verification_url on the license"))?;
        req = req.verification_url(url);
    }
    let cert = state
        .issuer
        .issue(req)
        .map_err(|e| bad_request(&e.to_string()))?;
    let cert_json = serde_json::to_string(&cert).map_err(|e| internal(&e.to_string()))?;

    // 라이선스를 Application 공개키로 암호화해 저장한다. 공개키는 생성 시점에
    // 이미 확인되므로 여기서는 암호화만 수행한다.
    let encrypted = encrypt_license(&cert, &application_public_key, &state.issuer)
        .map_err(|e| bad_request(&e.to_string()))?;
    let encrypted_json = serde_json::to_string(&encrypted).map_err(|e| internal(&e.to_string()))?;
    // 발급 시점의 공개키·key_id를 이력 DB에 함께 저장한다. 나중에 개인키가
    // 교체되어도 이 인증서를 검증할 공개키를 항상 추출할 수 있다.
    let sign_key_id = cert.key_id.clone();
    let sign_public_key = state
        .issuer
        .verifying_key()
        .to_public_key_pem(LineEnding::LF)
        .map_err(|e| internal(&e.to_string()))?;
    {
        let db = state.db.lock().unwrap();
        db.execute(
            "INSERT INTO certificates (certificate_id, license_id, level, cert_json, key_id, public_key, encrypted_license, application_id, target_language, issued_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![cert.certificate_id, lic.license_id, lic.level, cert_json, sign_key_id, sign_public_key, encrypted_json, app_id, target_language, now_rfc3339()],
        )
        .map_err(|e| internal(&e.to_string()))?;
    }
    log_audit(
        &state,
        &user.username,
        "certificate.issue",
        Some(&lic.license_id),
        Some(&cert.certificate_id),
    );
    let parsed: Value = serde_json::from_str(&cert_json).unwrap_or(Value::Null);
    let encrypted_value = serde_json::to_value(&encrypted).unwrap_or(Value::Null);
    Ok(Json(json!({
        "certificate": parsed,
        "certificate_id": cert.certificate_id,
        "encrypted_license": encrypted_value,
        "application_id": app_id,
        "target_language": target_language,
        // 키 없이 등록된 라이선스를 발급하면서 새 키를 만든 경우에만 참이다.
        // 개인키는 이 응답에서 한 번만 나오므로 배포 대상 앱에 바로 심어야 한다.
        "application_key_generated": generated_private_key.is_some(),
        "application_private_key": generated_private_key,
    })))
}

/// 암호화된 LIC(EncryptedLicense 엔벨로프)를 내려받는다.
///
/// 이미지의 최종 산출물이다. AK2로 암호화되어 있으므로 파일을 열어도 P의
/// 원문(Owner, 만료일 등)은 보이지 않는다.
pub async fn download_encrypted_license(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Response, ApiError> {
    auth_user(&state, &headers)?;
    let (license_id, envelope): (String, String) = {
        let db = state.db.lock().unwrap();
        db.query_row(
            "SELECT license_id, encrypted_license FROM certificates
             WHERE license_id = (SELECT license_id FROM licenses WHERE id = ?1)
               AND encrypted_license IS NOT NULL
             ORDER BY id DESC LIMIT 1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| internal(&e.to_string()))?
        .ok_or_else(|| not_found("no encrypted license has been issued for this license"))?
    };
    let mut hdrs = HeaderMap::new();
    hdrs.insert(header::CONTENT_TYPE, "application/json".parse().unwrap());
    hdrs.insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"{}.lic.json\"", license_id)
            .parse()
            .unwrap(),
    );
    Ok((hdrs, envelope).into_response())
}

/// 암호화된 LIC를 화면에서 확인할 수 있게 JSON으로 반환한다.
pub async fn get_encrypted_license(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    auth_user(&state, &headers)?;
    let envelope: String = {
        let db = state.db.lock().unwrap();
        db.query_row(
            "SELECT encrypted_license FROM certificates
             WHERE license_id = (SELECT license_id FROM licenses WHERE id = ?1)
               AND encrypted_license IS NOT NULL
             ORDER BY id DESC LIMIT 1",
            params![id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| internal(&e.to_string()))?
        .flatten()
        .ok_or_else(|| not_found("no encrypted license has been issued for this license"))?
    };
    let parsed: Value = serde_json::from_str(&envelope).unwrap_or(Value::Null);
    Ok(Json(parsed))
}

// ---------------- Users ----------------

pub async fn list_users(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<User>>, ApiError> {
    auth_user(&state, &headers)?;
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare("SELECT id, username, role, created_at FROM users ORDER BY id")
        .map_err(|e| internal(&e.to_string()))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(User {
                id: r.get(0)?,
                username: r.get(1)?,
                role: r.get(2)?,
                created_at: r.get(3)?,
            })
        })
        .map_err(|e| internal(&e.to_string()))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| internal(&e.to_string()))?);
    }
    Ok(Json(out))
}

pub async fn create_user(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<UserInput>,
) -> Result<Json<Value>, ApiError> {
    let user = auth_user(&state, &headers)?;
    if body.username.is_empty() || body.password.len() < 4 {
        return Err(bad_request(
            "username required and password must be at least 4 chars",
        ));
    }
    let role = body.role.clone().unwrap_or_else(|| "admin".into());
    let hash = hash_password(&body.password).map_err(|e| internal(&e))?;
    let username = body.username.clone();
    let db = state.db.lock().unwrap();
    let res = db.execute(
        "INSERT INTO users (username, password_hash, role, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![body.username, hash, role, now_rfc3339()],
    );
    drop(db);
    if let Err(e) = res {
        return if e.to_string().contains("UNIQUE") {
            Err(conflict("username already exists"))
        } else {
            Err(internal(&e.to_string()))
        };
    }
    log_audit(
        &state,
        &user.username,
        "user.create",
        Some(&username),
        Some(&role),
    );
    Ok(Json(
        json!({ "ok": true, "username": username, "role": role }),
    ))
}

/// 사용자 계정을 수정한다 (admin 전용).
///
/// 사용자명·역할·비밀번호를 바꿀 수 있고, 생략한 필드는 유지한다.
pub async fn update_user(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(body): Json<UserUpdate>,
) -> Result<Json<Value>, ApiError> {
    let actor = auth_user(&state, &headers)?;
    require_admin(&actor)?;

    let (current_username, current_role): (String, String) = {
        let db = state.db.lock().unwrap();
        db.query_row(
            "SELECT username, role FROM users WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| internal(&e.to_string()))?
        .ok_or_else(|| not_found("user not found"))?
    };

    let new_username = body
        .username
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or(&current_username)
        .to_string();
    let new_role = body
        .role
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or(&current_role)
        .to_string();
    if new_role != "admin" && new_role != "operator" {
        return Err(bad_request("role must be admin or operator"));
    }
    // 마지막 admin을 operator로 강등하면 관리 권한을 잃는다.
    if current_role == "admin" && new_role != "admin" {
        let db = state.db.lock().unwrap();
        let admins = admin_count(&db).map_err(|e| internal(&e.to_string()))?;
        if admins <= 1 {
            return Err(bad_request("cannot demote the last admin"));
        }
    }

    // 비밀번호는 값이 있을 때만 바꾼다.
    let new_hash = match body.password.as_deref() {
        Some(p) if !p.is_empty() => {
            if p.len() < 4 {
                return Err(bad_request("password must be at least 4 chars"));
            }
            Some(hash_password(p).map_err(|e| internal(&e))?)
        }
        _ => None,
    };

    {
        let db = state.db.lock().unwrap();
        db.execute(
            "UPDATE users SET username = ?2, role = ?3 WHERE id = ?1",
            params![id, new_username, new_role],
        )
        .map_err(|e| {
            if e.to_string().contains("UNIQUE") {
                conflict("username already exists")
            } else {
                internal(&e.to_string())
            }
        })?;
        if let Some(hash) = &new_hash {
            db.execute(
                "UPDATE users SET password_hash = ?2 WHERE id = ?1",
                params![id, hash],
            )
            .map_err(|e| internal(&e.to_string()))?;
            // 비밀번호가 바뀌면 기존 세션을 끊는다.
            db.execute("DELETE FROM sessions WHERE user_id = ?1", params![id])
                .map_err(|e| internal(&e.to_string()))?;
        }
    }
    log_audit(
        &state,
        &actor.username,
        "user.update",
        Some(&new_username),
        Some(&new_role),
    );
    Ok(Json(
        json!({ "ok": true, "username": new_username, "role": new_role }),
    ))
}

/// 사용자 계정을 서버에서 삭제한다 (admin 전용).
pub async fn delete_user(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    let actor = auth_user(&state, &headers)?;
    require_admin(&actor)?;
    if actor.id == id {
        return Err(bad_request("cannot delete your own account"));
    }

    let (username, role): (String, String) = {
        let db = state.db.lock().unwrap();
        db.query_row(
            "SELECT username, role FROM users WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| internal(&e.to_string()))?
        .ok_or_else(|| not_found("user not found"))?
    };
    {
        let db = state.db.lock().unwrap();
        if role == "admin" {
            let admins = admin_count(&db).map_err(|e| internal(&e.to_string()))?;
            if admins <= 1 {
                return Err(bad_request("cannot delete the last admin"));
            }
        }
        db.execute("DELETE FROM sessions WHERE user_id = ?1", params![id])
            .map_err(|e| internal(&e.to_string()))?;
        db.execute("DELETE FROM users WHERE id = ?1", params![id])
            .map_err(|e| internal(&e.to_string()))?;
    }
    log_audit(
        &state,
        &actor.username,
        "user.delete",
        Some(&username),
        Some(&role),
    );
    Ok(Json(json!({ "ok": true, "username": username })))
}

// ---------------- Blacklist ----------------

pub async fn list_blacklist(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<BlacklistEntry>>, ApiError> {
    auth_user(&state, &headers)?;
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare("SELECT license_id, reason, created_at FROM blacklist ORDER BY created_at DESC")
        .map_err(|e| internal(&e.to_string()))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(BlacklistEntry {
                license_id: r.get(0)?,
                reason: r.get(1)?,
                created_at: r.get(2)?,
            })
        })
        .map_err(|e| internal(&e.to_string()))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| internal(&e.to_string()))?);
    }
    Ok(Json(out))
}

pub async fn add_blacklist(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<BlacklistInput>,
) -> Result<Json<Value>, ApiError> {
    let user = auth_user(&state, &headers)?;
    if body.license_id.is_empty() {
        return Err(bad_request("license_id required"));
    }
    {
        let db = state.db.lock().unwrap();
        db.execute(
            "INSERT INTO blacklist (license_id, reason, created_at) VALUES (?1, ?2, ?3) ON CONFLICT(license_id) DO UPDATE SET reason = excluded.reason",
            params![body.license_id, body.reason, now_rfc3339()],
        )
        .map_err(|e| internal(&e.to_string()))?;
        let _ = db.execute(
            "UPDATE licenses SET status = 'blacklisted' WHERE license_id = ?1",
            params![body.license_id],
        );
    }
    log_audit(
        &state,
        &user.username,
        "blacklist.add",
        Some(&body.license_id),
        Some(&body.reason),
    );
    Ok(Json(json!({ "ok": true, "license_id": body.license_id })))
}

pub async fn remove_blacklist(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(license_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let user = auth_user(&state, &headers)?;
    require_admin(&user)?;
    {
        let db = state.db.lock().unwrap();
        db.execute(
            "DELETE FROM blacklist WHERE license_id = ?1",
            params![license_id],
        )
        .map_err(|e| internal(&e.to_string()))?;
        let _ = db.execute(
            "UPDATE licenses SET status = 'active' WHERE license_id = ?1",
            params![license_id],
        );
    }
    log_audit(
        &state,
        &user.username,
        "blacklist.remove",
        Some(&license_id),
        None,
    );
    Ok(Json(json!({ "ok": true })))
}

// ---------------- Audit ----------------

pub async fn list_audit(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<AuditEntry>>, ApiError> {
    auth_user(&state, &headers)?;
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare("SELECT id, actor, action, target, detail, created_at FROM audit_logs ORDER BY id DESC LIMIT 200")
        .map_err(|e| internal(&e.to_string()))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(AuditEntry {
                id: r.get(0)?,
                actor: r.get(1)?,
                action: r.get(2)?,
                target: r.get(3)?,
                detail: r.get(4)?,
                created_at: r.get(5)?,
            })
        })
        .map_err(|e| internal(&e.to_string()))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| internal(&e.to_string()))?);
    }
    Ok(Json(out))
}

// ---------------- Client 공개 엔드포인트 ----------------

/// SW Client가 license_id로 자신의 인증서를 내려받는 공개 엔드포인트.
/// GitHub 자격증명 없이 LicenseHub API를 통해 인증서를 받는다.
/// (L1 인증서는 이 방식으로 받아 오프라인 검증에 사용한다)
pub async fn claim_certificate(
    State(state): State<Arc<AppState>>,
    Path(license_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (status, cert_json): (String, String) = {
        let db = state.db.lock().unwrap();
        db.query_row(
            "SELECT l.status, c.cert_json
             FROM licenses l JOIN certificates c ON c.license_id = l.license_id
             WHERE l.license_id = ?1 ORDER BY c.id DESC LIMIT 1",
            params![license_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| not_found("no certificate for this license"))?
    };
    if status != "active" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "license not active", "status": status })),
        ));
    }
    let parsed: Value = serde_json::from_str(&cert_json).map_err(|e| internal(&e.to_string()))?;
    Ok(Json(parsed))
}

/// SW Client가 폐기 목록(Blacklist)을 받는 공개 엔드포인트.
/// GitHub blacklist.json 과 같은 형태를 반환한다.
pub async fn client_blacklist(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    let (version, ids) = {
        let db = state.db.lock().unwrap();
        let version = meta_get(&db, "blacklist.version")
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0);
        let mut stmt = db
            .prepare("SELECT license_id FROM blacklist ORDER BY license_id")
            .map_err(|e| internal(&e.to_string()))?;
        let ids: Vec<String> = stmt
            .query_map([], |r| r.get(0))
            .map_err(|e| internal(&e.to_string()))?
            .collect::<Result<_, _>>()
            .map_err(|e| internal(&e.to_string()))?;
        (version, ids)
    };
    Ok(Json(json!({
        "version": version,
        "updated_at": now_rfc3339(),
        "licenses": ids,
    })))
}

// ---------------- Verify (L2 서버 검증) ----------------

pub async fn verify(
    State(state): State<Arc<AppState>>,
    Json(body): Json<VerifyRequest>,
) -> Json<Value> {
    let db = state.db.lock().unwrap();
    let row: Option<(String, String)> = db
        .query_row(
            "SELECT status, expires_at FROM licenses WHERE license_id = ?1",
            params![body.license_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    let Some((status, expires_at)) = row else {
        return Json(
            json!({ "license_id": body.license_id, "status": "rejected", "reason": "unknown_license" }),
        );
    };
    if status != "active" {
        return Json(
            json!({ "license_id": body.license_id, "status": "rejected", "reason": status }),
        );
    }
    if expires_at.as_str() <= now_rfc3339().as_str() {
        return Json(
            json!({ "license_id": body.license_id, "status": "rejected", "reason": "expired" }),
        );
    }
    Json(json!({ "license_id": body.license_id, "status": "approved" }))
}

// ---------------- GitHub Sync ----------------

pub async fn sync_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    auth_user(&state, &headers)?;
    let (configured, repo) = match &state.github {
        Some(g) => (true, Some(g.repo_name())),
        None => (false, None),
    };
    Ok(Json(json!({ "configured": configured, "repo": repo })))
}

fn github_client(state: &AppState) -> Result<&GitHubClient, ApiError> {
    state
        .github
        .as_ref()
        .ok_or_else(|| bad_request("GitHub App is not configured"))
}

pub async fn sync_blacklist(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let user = auth_user(&state, &headers)?;
    let client = github_client(&state)?;
    let json = {
        let db = state.db.lock().unwrap();
        let version = meta_get(&db, "blacklist.version")
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0)
            + 1;
        let mut stmt = db
            .prepare("SELECT license_id FROM blacklist ORDER BY license_id")
            .map_err(|e| internal(&e.to_string()))?;
        let ids: Vec<String> = stmt
            .query_map([], |r| r.get(0))
            .map_err(|e| internal(&e.to_string()))?
            .collect::<Result<_, _>>()
            .map_err(|e| internal(&e.to_string()))?;
        let doc = json!({ "version": version, "updated_at": now_rfc3339(), "licenses": ids });
        meta_set(&db, "blacklist.version", &version.to_string());
        doc.to_string()
    };
    client.push_blacklist(&json).map_err(|e| internal(&e))?;
    log_audit(
        &state,
        &user.username,
        "sync.blacklist",
        Some("blacklist/blacklist.json"),
        None,
    );
    Ok(Json(
        json!({ "ok": true, "path": "blacklist/blacklist.json" }),
    ))
}

pub async fn sync_public_key(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let user = auth_user(&state, &headers)?;
    let client = github_client(&state)?;
    let pem = state
        .issuer
        .verifying_key()
        .to_public_key_pem(LineEnding::LF)
        .map_err(|e| internal(&e.to_string()))?;
    client.push_public_key(&pem).map_err(|e| internal(&e))?;
    log_audit(
        &state,
        &user.username,
        "sync.public_key",
        Some("keys/public-key.pem"),
        None,
    );
    Ok(Json(json!({ "ok": true, "path": "keys/public-key.pem" })))
}

pub async fn sync_certificates(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let user = auth_user(&state, &headers)?;
    let client = github_client(&state)?;
    let rows: Vec<(String, i64, String)> = {
        let db = state.db.lock().unwrap();
        let mut stmt = db
            .prepare("SELECT license_id, level, cert_json FROM certificates ORDER BY id")
            .map_err(|e| internal(&e.to_string()))?;
        let iter = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| internal(&e.to_string()))?;
        let mut out = Vec::new();
        for row in iter {
            out.push(row.map_err(|e| internal(&e.to_string()))?);
        }
        out
    };
    let mut pushed = 0;
    for (license_id, level, cert_json) in &rows {
        client
            .push_certificate(*level, license_id, cert_json)
            .map_err(|e| internal(&e))?;
        pushed += 1;
    }
    log_audit(
        &state,
        &user.username,
        "sync.certificates",
        None,
        Some(&format!("{pushed} certs")),
    );
    Ok(Json(json!({ "ok": true, "pushed": pushed })))
}

pub async fn sync_all(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    auth_user(&state, &headers)?;
    let _ = sync_blacklist(State(state.clone()), headers.clone()).await?;
    let _ = sync_public_key(State(state.clone()), headers.clone()).await?;
    sync_certificates(State(state), headers).await
}
