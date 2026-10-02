use base64::{Engine as _, engine::general_purpose::STANDARD};
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

use crate::config::GitHubConfig;

const API: &str = "https://api.github.com";

#[derive(Serialize)]
struct AppJwtClaims {
    iss: i64,
    iat: i64,
    exp: i64,
}

#[derive(Deserialize)]
struct InstallTokenResp {
    token: String,
}

#[derive(Deserialize)]
struct ContentResp {
    sha: Option<String>,
}

/// GitHub Repository 동기화 클라이언트.
///
/// GitHub App 자격증명으로 설치 토큰을 발급받아 인증서/Blacklist/공개키를
/// Repository에 push한다. Personal Access Token은 사용하지 않는다.
pub struct GitHubClient {
    config: GitHubConfig,
    client: reqwest::blocking::Client,
}

impl GitHubClient {
    pub fn new(config: GitHubConfig) -> Self {
        let client = reqwest::blocking::Client::builder()
            .user_agent("licensehub-web")
            .build()
            .expect("failed to build http client");
        Self { config, client }
    }

    /// GitHub App 인증 JWT (max 10분) 를 만든다.
    fn app_jwt(&self) -> Result<String, String> {
        let now = OffsetDateTime::now_utc().unix_timestamp();
        let claims = AppJwtClaims {
            iss: self.config.app_id,
            iat: now,
            exp: now + 600,
        };
        let key = EncodingKey::from_rsa_pem(self.config.private_key.as_bytes())
            .map_err(|e| format!("invalid GitHub App private key: {e}"))?;
        encode(&Header::new(Algorithm::RS256), &claims, &key)
            .map_err(|e| format!("failed to sign app jwt: {e}"))
    }

    /// GitHub App 설치 토큰을 발급받는다.
    fn installation_token(&self) -> Result<String, String> {
        let jwt = self.app_jwt()?;
        let url = format!(
            "{API}/app/installations/{}/access_tokens",
            self.config.installation_id
        );
        let resp = self
            .client
            .post(url)
            .header("Accept", "application/vnd.github+json")
            .header("Authorization", format!("Bearer {jwt}"))
            .send()
            .map_err(|e| format!("github token request failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("github token error: {}", resp.status()));
        }
        let body: InstallTokenResp = resp
            .json()
            .map_err(|e| format!("github token parse: {e}"))?;
        Ok(body.token)
    }

    /// 설치 토큰이 대상 저장소에 접근 가능한지 확인한다.
    /// 404는 "저장소가 없거나 앱이 설치되어 있지 않음"을 의미한다.
    fn check_repo_access(&self, token: &str) -> Result<(), String> {
        let url = format!("{API}/repos/{}/{}", self.config.owner, self.config.repo);
        let resp = self
            .client
            .get(&url)
            .header("Accept", "application/vnd.github+json")
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .map_err(|e| format!("github repo check failed: {e}"))?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(format!(
                "GitHub repository {}/{} is not accessible (404). \
                 Check GITHUB_REPO and make sure the GitHub App is installed on that repository.",
                self.config.owner, self.config.repo
            ));
        }
        if !resp.status().is_success() {
            return Err(format!("github repo check error: {}", resp.status()));
        }
        Ok(())
    }

    /// GitHub 오류 응답에서 상태 코드 + 본문을 추출한다.
    /// 404/403이어도 GitHub 본문에 실제 사유(예: Resource not accessible)가 있다.
    fn error_detail(&self, resp: reqwest::blocking::Response) -> String {
        let status = resp.status();
        let body = resp.text().unwrap_or_default();
        format!("{status} {body}")
    }

    /// Repository의 한 파일을 새로 쓰거나 갱신한다.
    fn write_file(&self, path: &str, content_b64: &str, message: &str) -> Result<(), String> {
        let token = self.installation_token()?;
        self.check_repo_access(&token)?;
        let repo_path = format!("{}/{}/{}", self.config.owner, self.config.repo, path);

        let get_url = format!("{API}/repos/{repo_path}");
        let existing_sha: Option<String> = {
            let resp = self
                .client
                .get(&get_url)
                .header("Accept", "application/vnd.github+json")
                .header("Authorization", format!("Bearer {token}"))
                .send()
                .map_err(|e| format!("github read failed: {e}"))?;
            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                None
            } else if resp.status().is_success() {
                let body: ContentResp = resp.json().map_err(|e| format!("github parse: {e}"))?;
                body.sha
            } else {
                return Err(format!("github read error: {}", resp.status()));
            }
        };

        let mut body = serde_json::json!({ "message": message, "content": content_b64 });
        if let Some(sha) = existing_sha {
            body["sha"] = serde_json::json!(sha);
        }

        let put_url = format!("{API}/repos/{repo_path}");
        let resp = self
            .client
            .put(put_url)
            .header("Accept", "application/vnd.github+json")
            .header("Authorization", format!("Bearer {token}"))
            .json(&body)
            .send()
            .map_err(|e| format!("github write failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("github write error: {}", self.error_detail(resp)));
        }
        Ok(())
    }

    pub fn repo_name(&self) -> String {
        format!("{}/{}", self.config.owner, self.config.repo)
    }

    /// Blacklist JSON을 blacklist/blacklist.json 에 push한다.
    pub fn push_blacklist(&self, json: &str) -> Result<(), String> {
        self.write_file(
            "blacklist/blacklist.json",
            &STANDARD.encode(json),
            "Update LicenseHub blacklist",
        )
    }

    /// 공개키 PEM을 keys/public-key.pem 에 push한다.
    pub fn push_public_key(&self, pem: &str) -> Result<(), String> {
        self.write_file(
            "keys/public-key.pem",
            &STANDARD.encode(pem),
            "Update LicenseHub public key",
        )
    }

    /// 인증서 JSON을 등급별 경로(certificates/{dir}/{license_id}.json)에 push한다.
    pub fn push_certificate(&self, level: i64, license_id: &str, json: &str) -> Result<(), String> {
        let dir = match level {
            1 => "core",
            2 => "secure",
            _ => "device-bound",
        };
        self.write_file(
            &format!("certificates/{dir}/{license_id}.json"),
            &STANDARD.encode(json),
            &format!("Add certificate for {license_id}"),
        )
    }
}
