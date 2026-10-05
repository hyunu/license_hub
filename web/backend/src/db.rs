use rusqlite::Connection;
use std::path::Path;

/// SQLite 스키마. 내부 관리 데이터(User, License, 감사)는 GitHub에 저장하지
/// 않고 이 DB에 보관한다. GitHub에는 배포용 인증서/Blacklist/공개키만 저장한다.
pub const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS licenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_id TEXT NOT NULL UNIQUE,
    product TEXT NOT NULL,
    version TEXT NOT NULL,
    level INTEGER NOT NULL,
    holder TEXT NOT NULL,
    device_id TEXT,
    expires_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    metadata TEXT,
    target_language TEXT,
    application_public_key TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS certificates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    certificate_id TEXT NOT NULL UNIQUE,
    license_id TEXT NOT NULL,
    level INTEGER NOT NULL,
    cert_json TEXT NOT NULL,
    key_id TEXT,
    public_key TEXT,
    encrypted_license TEXT,
    application_id TEXT,
    target_language TEXT,
    issued_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS blacklist (
    license_id TEXT PRIMARY KEY,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    detail TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#;

pub fn open(path: &str) -> rusqlite::Result<Connection> {
    if let Some(parent) = Path::new(path).parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let conn = Connection::open(path)?;
    conn.execute_batch(SCHEMA)?;
    migrate(&conn)?;
    Ok(conn)
}

/// 기존 DB에 추가된 컬럼을 안전하게 반영한다 (CREATE IF NOT EXISTS만으론
/// 기존 테이블에 컬럼이 생기지 않으므로 ALTER TABLE로 보완).
fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    if !has_column(conn, "licenses", "metadata") {
        conn.execute_batch("ALTER TABLE licenses ADD COLUMN metadata TEXT;")?;
    }
    if !has_column(conn, "licenses", "target_language") {
        conn.execute_batch("ALTER TABLE licenses ADD COLUMN target_language TEXT;")?;
    }
    if !has_column(conn, "licenses", "application_public_key") {
        conn.execute_batch("ALTER TABLE licenses ADD COLUMN application_public_key TEXT;")?;
    }
    if !has_column(conn, "certificates", "key_id") {
        conn.execute_batch("ALTER TABLE certificates ADD COLUMN key_id TEXT;")?;
    }
    if !has_column(conn, "certificates", "public_key") {
        conn.execute_batch("ALTER TABLE certificates ADD COLUMN public_key TEXT;")?;
    }
    if !has_column(conn, "certificates", "encrypted_license") {
        conn.execute_batch("ALTER TABLE certificates ADD COLUMN encrypted_license TEXT;")?;
    }
    if !has_column(conn, "certificates", "application_id") {
        conn.execute_batch("ALTER TABLE certificates ADD COLUMN application_id TEXT;")?;
    }
    if !has_column(conn, "certificates", "target_language") {
        conn.execute_batch("ALTER TABLE certificates ADD COLUMN target_language TEXT;")?;
    }
    Ok(())
}

fn has_column(conn: &Connection, table: &str, column: &str) -> bool {
    conn.prepare(&format!("PRAGMA table_info({table})"))
        .map(|mut stmt| {
            stmt.query_map([], |r| r.get::<_, String>(1))
                .map(|rows| rows.filter_map(Result::ok).any(|c| c == column))
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_creates_tables() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(n >= 7, "expected at least 7 tables, found {n}");
    }
}
