use std::env;

/// GitHub 동기화 연동 설정.
///
/// 인증 방식은 두 가지다.
/// - PAT: GITHUB_PAT (배포 저장소 전용 파인그레인 토큰, Contents write)
/// - GitHub App: GITHUB_APP_ID + GITHUB_INSTALLATION_ID + 개인키
#[derive(Debug, Clone)]
pub struct GitHubConfig {
    pub owner: String,
    pub repo: String,
    pub pat: Option<String>,
    pub app_id: Option<i64>,
    pub private_key: Option<String>,
    pub installation_id: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub bind: String,
    pub db_path: String,
    pub frontend_dist: String,
    pub signing_key_hex: Option<String>,
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
            admin_username: env("LICENSEHUB_ADMIN_USER", "admin"),
            admin_password: env("LICENSEHUB_ADMIN_PASSWORD", "admin123"),
            github: load_github(),
        }
    }
}

/// GITHUB_REPO 와 인증(PAT 또는 GitHub App)이 모두 있으면 연동 활성화.
fn load_github() -> Option<GitHubConfig> {
    let repo = env::var("GITHUB_REPO").ok()?;
    let mut parts = repo.splitn(2, '/');
    let owner = parts.next()?.to_string();
    let repo = parts.next()?.to_string();

    let pat = env::var("GITHUB_PAT").ok();

    let app_id = env::var("GITHUB_APP_ID").ok().and_then(|v| v.parse().ok());
    let installation_id = env::var("GITHUB_INSTALLATION_ID")
        .ok()
        .and_then(|v| v.parse().ok());
    let private_key = env::var("GITHUB_APP_PRIVATE_KEY").ok().or_else(|| {
        env::var("GITHUB_APP_PRIVATE_KEY_PATH")
            .ok()
            .and_then(|p| std::fs::read_to_string(p).ok())
    });

    // PAT가 있으면 그것만으로 충분. 없으면 GitHub App 자격증명이 모두 필요.
    let has_app = app_id.is_some() && installation_id.is_some() && private_key.is_some();
    if pat.is_none() && !has_app {
        return None;
    }

    Some(GitHubConfig {
        owner,
        repo,
        pat,
        app_id,
        private_key,
        installation_id,
    })
}
