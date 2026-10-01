use argon2::password_hash::{PasswordHash, PasswordHasher, SaltString, rand_core::OsRng};
use argon2::{Argon2, PasswordVerifier};
use rusqlite::Connection;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use crate::models::User;

/// argon2id 로 비밀번호를 해시한다.
pub fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| e.to_string())
}

/// 평문 비밀번호를 저장된 해시와 비교한다.
pub fn verify_password(password: &str, hash: &str) -> bool {
    let parsed = match PasswordHash::new(hash) {
        Ok(p) => p,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

/// 로그인 세션 토큰을 발급하고 sessions 테이블에 저장한다.
pub fn create_session(db: &Connection, user_id: i64) -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    let token = hex::encode(bytes);
    let now = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO sessions (token, user_id, created_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![token, user_id, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(token)
}

/// 세션 토큰으로 사용자를 조회한다.
pub fn user_by_token(db: &Connection, token: &str) -> Option<User> {
    db.query_row(
        "SELECT u.id, u.username, u.role, u.created_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token = ?1",
        rusqlite::params![token],
        |row| {
            Ok(User {
                id: row.get(0)?,
                username: row.get(1)?,
                role: row.get(2)?,
                created_at: row.get(3)?,
            })
        },
    )
    .ok()
}

pub fn user_by_username(db: &Connection, username: &str) -> Option<(i64, String, String, String)> {
    db.query_row(
        "SELECT id, username, password_hash, role FROM users WHERE username = ?1",
        rusqlite::params![username],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )
    .ok()
}

pub fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_hash_roundtrip() {
        let hash = hash_password("secret").unwrap();
        assert!(verify_password("secret", &hash));
        assert!(!verify_password("wrong", &hash));
    }

    #[test]
    fn session_token_is_unique() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(crate::db::SCHEMA).unwrap();
        conn.execute(
            "INSERT INTO users (username, password_hash, role, created_at) VALUES ('u', 'h', 'admin', 'now')",
            [],
        )
        .unwrap();
        let a = create_session(&conn, 1).unwrap();
        let b = create_session(&conn, 1).unwrap();
        assert_ne!(a, b);
    }
}
