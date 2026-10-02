use base64::{Engine as _, engine::general_purpose::STANDARD};
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
    #[serde(default)]
    permissions: HashMap<String, String>,
    #[serde(default)]
    repository_selection: Option<String>,
    #[serde(default)]
    repositories: Vec<InstallationRepo>,
}

/// 발급된 설치 토큰과 그 권한·접근 저장소 정보.
struct InstallationTokenInfo {
    token: String,
    permissions: HashMap<String, String>,
    repository_selection: Option<String>,
    repositories: Vec<String>,
}

#[derive(Deserialize)]
struct ContentResp {
    sha: Option<String>,
}

#[derive(Deserialize)]
struct InstallationReposResp {
    repositories: Vec<InstallationRepo>,
}

#[derive(Deserialize)]
struct InstallationRepo {
    full_name: String,
}

#[derive(Deserialize)]
struct AppResp {
    permissions: HashMap<String, String>,
}

#[derive(Deserialize)]
struct InstallationResp {
    permissions: HashMap<String, String>,
}

/// GitHub Repository 동기화 클라이언트.
///
/// 인증은 PAT 또는 GitHub App 설치 토큰을 지원한다.
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

    fn is_pat_mode(&self) -> bool {
        self.config.pat.is_some()
    }

    /// API 요청에 쓰는 인증 토큰. PAT가 있으면 PAT, 없으면 App 설치 토큰.
    fn auth_token(&self) -> Result<String, String> {
        if let Some(pat) = &self.config.pat {
            return Ok(pat.clone());
        }
        self.app_installation_token().map(|t| t.token)
    }

    /// GitHub App 인증 JWT (max 10분) 를 만든다.
    fn app_jwt(&self) -> Result<String, String> {
        let app_id = self.config.app_id.ok_or("GITHUB_APP_ID not set")?;
        let now = OffsetDateTime::now_utc().unix_timestamp();
        let claims = AppJwtClaims {
            iss: app_id,
            iat: now,
            exp: now + 600,
        };
        let key = EncodingKey::from_rsa_pem(
            self.config
                .private_key
                .as_deref()
                .ok_or("GITHUB_APP_PRIVATE_KEY not set")?
                .as_bytes(),
        )
        .map_err(|e| format!("invalid GitHub App private key: {e}"))?;
        encode(&Header::new(Algorithm::RS256), &claims, &key)
            .map_err(|e| format!("failed to sign app jwt: {e}"))
    }

    /// GitHub App 설치 토큰을 발급받는다.
    fn app_installation_token(&self) -> Result<InstallationTokenInfo, String> {
        let jwt = self.app_jwt()?;
        let installation_id = self
            .config
            .installation_id
            .ok_or("GITHUB_INSTALLATION_ID not set")?;
        let url = format!("{API}/app/installations/{installation_id}/access_tokens");
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
        Ok(InstallationTokenInfo {
            token: body.token,
            permissions: body.permissions,
            repository_selection: body.repository_selection,
            repositories: body
                .repositories
                .iter()
                .map(|r| r.full_name.clone())
                .collect(),
        })
    }

    /// 설치 토큰이 대상 저장소에 접근 가능한지 확인.
    /// /installation/repositories 로 설치 내 저장소 포함 여부만 확인한다.
    /// 실제 쓰기 권한은 write 시도 결과로 판단한다.
    fn check_repo_access(&self, token: &str) -> Result<(), String> {
        let url = format!("{API}/installation/repositories");
        let resp = self
            .client
            .get(&url)
            .header("Accept", "application/vnd.github+json")
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .map_err(|e| format!("github repo check failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("github repo check error: {}", resp.status()));
        }
        let text = resp
            .text()
            .map_err(|e| format!("github repo check read body: {e}"))?;
        let body: InstallationReposResp = serde_json::from_str(&text)
            .map_err(|e| format!("github repo check parse: {e} body={text}"))?;

        let target = format!("{}/{}", self.config.owner, self.config.repo);
        if !body.repositories.iter().any(|r| r.full_name == target) {
            return Err(format!(
                "GitHub App이 저장소 '{target}'에 접근할 수 없습니다. \
                 앱이 그 저장소에 설치되어 있는지 확인하세요."
            ));
        }
        // push 필드는 설치 토큰의 실제 Contents 쓰기와 다를 수 있으므로 게이트로
        // 사용하지 않는다. 실제 쓰기 시도 결과로 판단한다.
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
        let token = self.auth_token()?;
        // /installation/repositories 는 GitHub App 전용이므로 PAT 모드에선 생략.
        if !self.is_pat_mode() {
            self.check_repo_access(&token)?;
        }
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
            let auth_mode = if self.is_pat_mode() {
                "PAT".to_string()
            } else {
                format!(
                    "App(토큰권한={:?}, 저장소선택={:?}, 토큰접근저장소={:?}, 앱권한={:?}, 설치권한={:?})",
                    self.app_installation_token()
                        .map(|t| t.permissions)
                        .unwrap_or_default(),
                    self.app_installation_token()
                        .map(|t| t.repository_selection)
                        .unwrap_or_default(),
                    self.app_installation_token()
                        .map(|t| t.repositories)
                        .unwrap_or_default(),
                    self.app_declared_permissions().unwrap_or_default(),
                    self.installation_effective_permissions()
                        .unwrap_or_default(),
                )
            };
            let repo_view = self.repo_view_status(&token);
            return Err(format!(
                "github write error: {} [인증: {auth_mode}] [동일토큰으로 저장소 조회: {repo_view}]",
                self.error_detail(resp)
            ));
        }
        Ok(())
    }

    /// 같은 토큰으로 GET /repos/{owner}/{repo} 를 호출한 결과.
    /// 200이면 토큰이 저장소를 볼 수 있음(그런데 쓰기 404), 404면 토큰이 저장소에
    /// 접근 불가(스코프/값 문제).
    fn repo_view_status(&self, token: &str) -> String {
        let url = format!("{API}/repos/{}/{}", self.config.owner, self.config.repo);
        match self
            .client
            .get(&url)
            .header("Accept", "application/vnd.github+json")
            .header("Authorization", format!("Bearer {token}"))
            .send()
        {
            Ok(r) => format!("{}", r.status()),
            Err(e) => format!("err({e})"),
        }
    }

    /// 앱이 선언한 권한(GET /app, 앱 JWT로 조회).
    fn app_declared_permissions(&self) -> Result<HashMap<String, String>, String> {
        let jwt = self.app_jwt()?;
        let url = format!("{API}/app");
        let resp = self
            .client
            .get(&url)
            .header("Accept", "application/vnd.github+json")
            .header("Authorization", format!("Bearer {jwt}"))
            .send()
            .map_err(|e| format!("github app info failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("github app info error: {}", resp.status()));
        }
        let body: AppResp = resp
            .json()
            .map_err(|e| format!("github app info parse: {e}"))?;
        Ok(body.permissions)
    }

    /// 설치가 실제로 승인한 권한(GET /app/installations/{id}).
    /// 이 값이 'read'면 설치가 write를 승인하지 않은 것이다.
    fn installation_effective_permissions(&self) -> Result<HashMap<String, String>, String> {
        let jwt = self.app_jwt()?;
        let installation_id = self
            .config
            .installation_id
            .ok_or("GITHUB_INSTALLATION_ID not set")?;
        let url = format!("{API}/app/installations/{installation_id}");
        let resp = self
            .client
            .get(&url)
            .header("Accept", "application/vnd.github+json")
            .header("Authorization", format!("Bearer {jwt}"))
            .send()
            .map_err(|e| format!("github installation info failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("github installation info error: {}", resp.status()));
        }
        let body: InstallationResp = resp
            .json()
            .map_err(|e| format!("github installation info parse: {e}"))?;
        Ok(body.permissions)
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
