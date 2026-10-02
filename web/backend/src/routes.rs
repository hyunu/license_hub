use std::sync::{Arc, Mutex};

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use ed25519_dalek::VerifyingKey;
use licensehub_core::{CertificateRequest, Issuer};
use pkcs8::{EncodePublicKey, LineEnding};
use rusqlite::{Connection, params};
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
    pub public_key: VerifyingKey,
    pub verify_url: String,
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
    let raw = state.public_key.to_bytes();
    let pem = state
        .public_key
        .to_public_key_pem(LineEnding::LF)
        .unwrap_or_default();
    Json(json!({
        "key_id": "license-signing-key",
        "algorithm": "Ed25519",
        "hex": hex::encode(raw),
        "pem": pem
    }))
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
            .prepare("SELECT id, license_id, product, version, level, holder, device_id, expires_at, status, created_at FROM licenses WHERE status = ?1 ORDER BY id DESC")
            .map_err(|e| internal(&e.to_string()))?,
        None => db
            .prepare("SELECT id, license_id, product, version, level, holder, device_id, expires_at, status, created_at FROM licenses ORDER BY id DESC")
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

fn map_license(row: &rusqlite::Row) -> rusqlite::Result<License> {
    Ok(License {
        id: row.get(0)?,
        license_id: row.get(1)?,
        product: row.get(2)?,
        version: row.get(3)?,
        level: row.get(4)?,
        holder: row.get(5)?,
        device_id: row.get(6)?,
        expires_at: row.get(7)?,
        status: row.get(8)?,
        created_at: row.get(9)?,
    })
}

pub async fn create_license(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<LicenseInput>,
) -> Result<Json<License>, ApiError> {
    let user = auth_user(&state, &headers)?;
    if body.license_id.is_empty()
        || body.product.is_empty()
        || body.version.is_empty()
        || body.holder.is_empty()
    {
        return Err(bad_request(
            "license_id, product, version, holder are required",
        ));
    }
    if !(1..=3).contains(&body.level) {
        return Err(bad_request("level must be 1, 2, or 3"));
    }
    let status = body.status.clone().unwrap_or_else(|| "active".into());
    if body.level == 3 && body.device_id.as_deref().unwrap_or("").is_empty() {
        return Err(bad_request("level 3 requires device_id"));
    }
    let license_id = body.license_id.clone();
    let db = state.db.lock().unwrap();
    let res = db.execute(
        "INSERT INTO licenses (license_id, product, version, level, holder, device_id, expires_at, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![body.license_id, body.product, body.version, body.level, body.holder, body.device_id, body.expires_at, status, now_rfc3339()],
    );
    drop(db);
    if let Err(e) = res {
        return if e.to_string().contains("UNIQUE") {
            Err(conflict("license_id already exists"))
        } else {
            Err(internal(&e.to_string()))
        };
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
            "SELECT id, license_id, product, version, level, holder, device_id, expires_at, status, created_at FROM licenses WHERE license_id = ?1",
            params![license_id],
            map_license,
        )
        .map_err(|e| internal(&e.to_string()))?;
    Ok(Json(lic))
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

pub async fn issue_certificate(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    let user = auth_user(&state, &headers)?;
    let lic: License = {
        let db = state.db.lock().unwrap();
        db.query_row(
            "SELECT id, license_id, product, version, level, holder, device_id, expires_at, status, created_at FROM licenses WHERE id = ?1",
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
            .expires_at(&lic.expires_at);
    if lic.level >= 2 {
        req = req.verification_url(&state.verify_url);
    }
    if lic.level == 3 {
        let device = lic.device_id.as_deref().unwrap_or("");
        if device.is_empty() {
            return Err(bad_request("level 3 license requires device_id"));
        }
        req = req.device_id(device);
    }
    let cert = state
        .issuer
        .issue(req)
        .map_err(|e| bad_request(&e.to_string()))?;
    let cert_json = serde_json::to_string(&cert).map_err(|e| internal(&e.to_string()))?;
    {
        let db = state.db.lock().unwrap();
        db.execute(
            "INSERT INTO certificates (certificate_id, license_id, level, cert_json, issued_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![cert.certificate_id, lic.license_id, lic.level, cert_json, now_rfc3339()],
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
    Ok(Json(
        json!({ "certificate": parsed, "certificate_id": cert.certificate_id }),
    ))
}

pub async fn download_certificate(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Response, ApiError> {
    auth_user(&state, &headers)?;
    let (license_id, cert_json): (String, String) = {
        let db = state.db.lock().unwrap();
        db.query_row(
            "SELECT license_id, cert_json FROM certificates WHERE license_id = (SELECT license_id FROM licenses WHERE id = ?1) ORDER BY id DESC LIMIT 1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| not_found("no certificate issued"))?
    };
    let mut hdrs = HeaderMap::new();
    hdrs.insert(header::CONTENT_TYPE, "application/json".parse().unwrap());
    hdrs.insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"{}.json\"", license_id)
            .parse()
            .unwrap(),
    );
    Ok((hdrs, cert_json).into_response())
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

// ---------------- Verify (L2/L3 서버 검증) ----------------

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
        .public_key
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
