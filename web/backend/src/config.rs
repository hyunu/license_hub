use std::env;

/// GitHub App 연동 설정.
///
/// GitHub App은 LicenseHub가 인증서/Blacklist/공개키를 GitHub Repository에
/// 동기화할 때 사용한다. 개발 환경에서는 개인 액세스 토큰 대신 GitHub App
/// 자격증명(앱 ID, 설치 ID, 앱 Private Key)을 사용해야 한다.
#[derive(Debug, Clone)]
pub struct GitHubConfig {
    pub owner: String,
    pub repo: String,
    pub app_id: i64,
    pub private_key: String,
    pub installation_id: i64,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub bind: String,
    pub db_path: String,
    pub frontend_dist: String,
    pub signing_key_hex: Option<String>,
    pub verify_url: String,
    pub admin_username: String,
    pub admin_password: String,
    pub github: Option<GitHubConfig>,
}

fn env(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_string())
}

impl Config {
    pub fn from_env() -> Self {
        Config {
            bind: env("BIND_ADDR", "127.0.0.1:8080"),
            db_path: env("LICENSEHUB_DB", "data/licensehub.db"),
            frontend_dist: env("FRONTEND_DIST", "../frontend/dist"),
            signing_key_hex: env::var("LICENSEHUB_SIGNING_KEY").ok(),
            verify_url: env("LICENSEHUB_VERIFY_URL", "http://127.0.0.1:8080/api/verify"),
            admin_username: env("LICENSEHUB_ADMIN_USER", "admin"),
            admin_password: env("LICENSEHUB_ADMIN_PASSWORD", "admin123"),
            github: load_github(),
        }
    }
}

/// GITHUB_REPO=owner/repo 와 GitHub App 자격증명이 모두 있으면 연동 활성화.
fn load_github() -> Option<GitHubConfig> {
    let repo = env::var("GITHUB_REPO").ok()?;
    let mut parts = repo.splitn(2, '/');
    let owner = parts.next()?.to_string();
    let repo = parts.next()?.to_string();

    let app_id: i64 = env::var("GITHUB_APP_ID").ok()?.parse().ok()?;
    let installation_id: i64 = env::var("GITHUB_INSTALLATION_ID").ok()?.parse().ok()?;
    let private_key = env::var("GITHUB_APP_PRIVATE_KEY").ok().or_else(|| {
        env::var("GITHUB_APP_PRIVATE_KEY_PATH")
            .ok()
            .and_then(|p| std::fs::read_to_string(p).ok())
    })?;

    Some(GitHubConfig {
        owner,
        repo,
        app_id,
        private_key,
        installation_id,
    })
}
