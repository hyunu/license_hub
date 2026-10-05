mod auth;
mod config;
mod db;
mod github;
mod models;
mod routes;

use std::sync::{Arc, Mutex};

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::http::Method;
use axum::routing::{get, post};
use licensehub_core::Issuer;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;

use crate::config::Config;
use crate::github::GitHubClient;
use crate::routes::AppState;

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("licensehub=info".parse().unwrap()),
        )
        .init();

    let config = Config::from_env();
    let conn = db::open(&config.db_path).expect("failed to open database");
    seed_admin(&conn, &config);

    // 서명 키: 운영에서는 LICENSEHUB_SIGNING_KEY(64자 hex)로 고정해야 인증서가
    // 재시작 후에도 검증된다. 미설정 시 임시 키를 생성한다(개발 전용).
    let issuer = match &config.signing_key_hex {
        Some(hex) => {
            let bytes: [u8; 32] = hex::decode(hex)
                .ok()
                .and_then(|v| v.try_into().ok())
                .unwrap_or_else(|| panic!("LICENSEHUB_SIGNING_KEY must be 64 hex characters"));
            Issuer::from_bytes("license-signing-key", &bytes)
        }
        None => {
            tracing::warn!(
                "LICENSEHUB_SIGNING_KEY is not set. Using an ephemeral key; issued certificates will not survive restart."
            );
            Issuer::generate("license-signing-key")
        }
    };
    let github = config.github.clone().map(GitHubClient::new);

    let state = Arc::new(AppState {
        db: Arc::new(Mutex::new(conn)),
        issuer: Arc::new(issuer),
        verify_url: config.verify_url.clone(),
        github,
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers(Any);

    let api = Router::new()
        .route("/api/auth/login", post(routes::login))
        .route("/api/auth/logout", post(routes::logout))
        .route("/api/me", get(routes::me))
        .route("/api/stats", get(routes::stats))
        .route("/api/public-key", get(routes::public_key))
        .route("/api/public-key/download", get(routes::download_public_key))
        .route(
            "/api/certificates/{license_id}/public-key",
            get(routes::certificate_public_key),
        )
        .route(
            "/api/certificates/{license_id}/public-key/download",
            get(routes::download_certificate_public_key),
        )
        .route("/api/verify", post(routes::verify))
        .route("/api/claim/{license_id}", get(routes::claim_certificate))
        .route("/api/client/blacklist", get(routes::client_blacklist))
        .route(
            "/api/licenses",
            get(routes::list_licenses).post(routes::create_license),
        )
        .route("/api/licenses/{id}/issue", post(routes::issue_certificate))
        .route(
            "/api/licenses/{id}/download",
            get(routes::download_certificate),
        )
        .route(
            "/api/licenses/{id}/license",
            get(routes::get_encrypted_license),
        )
        .route(
            "/api/licenses/{id}/license/download",
            get(routes::download_encrypted_license),
        )
        .route(
            "/api/licenses/{id}/application-public-key/download",
            get(routes::download_application_public_key),
        )
        .route("/api/licenses/{id}/status", post(routes::license_status))
        .route(
            "/api/users",
            get(routes::list_users).post(routes::create_user),
        )
        .route(
            "/api/blacklist",
            get(routes::list_blacklist).post(routes::add_blacklist),
        )
        .route(
            "/api/blacklist/{license_id}",
            axum::routing::delete(routes::remove_blacklist),
        )
        .route("/api/audit", get(routes::list_audit))
        .route("/api/sync/status", get(routes::sync_status))
        .route("/api/sync/blacklist", post(routes::sync_blacklist))
        .route("/api/sync/public-key", post(routes::sync_public_key))
        .route("/api/sync/certificates", post(routes::sync_certificates))
        .route("/api/sync/all", post(routes::sync_all));

    let app = Router::new()
        .merge(api)
        .fallback_service(ServeDir::new(&config.frontend_dist))
        .layer(DefaultBodyLimit::max(1_000_000))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let bind = config.bind.clone();
    let rt = tokio::runtime::Runtime::new().expect("failed to build runtime");
    rt.block_on(async move {
        let listener = tokio::net::TcpListener::bind(&bind)
            .await
            .expect("failed to bind");
        tracing::info!("LicenseHub admin web app listening on {bind}");
        axum::serve(listener, app).await.expect("server error");
    });
}

/// 초기 관리자 계정을 시드한다.
fn seed_admin(conn: &rusqlite::Connection, config: &Config) {
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
        .unwrap_or(0);
    if count > 0 {
        return;
    }
    let hash = auth::hash_password(&config.admin_password).expect("failed to hash admin password");
    conn.execute(
        "INSERT INTO users (username, password_hash, role, created_at) VALUES (?1, ?2, 'admin', ?3)",
        rusqlite::params![config.admin_username, hash, auth::now_rfc3339()],
    )
    .expect("failed to seed admin user");
    tracing::info!(
        "Seeded admin user '{}' (password from LICENSEHUB_ADMIN_PASSWORD, default admin123)",
        config.admin_username
    );
}
