//! LicenseHub의 인증서 발급 및 검증 Core.
//!
//! 이 모듈은 GitHub, HTTP, DB에 직접 접근하지 않는다. 외부 계층이 서버
//! 검증 결과, Blacklist, Revocation 상태를 `VerificationContext`로 전달하면
//! Core는 동일한 규칙으로 인증서의 활성화 가능 여부를 판정한다.
//!
//! Private Key의 보관과 복호화는 이 모듈의 책임이 아니다. `Issuer`는
//! 호출자가 공급한 키를 사용해 서명만 수행하며, 이 모듈을 Client에
//! 포함할 때는 반드시 공개키 검증 기능만 배포해야 한다.

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::slice;
use thiserror::Error;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use zeroize::Zeroize;

pub mod trusted;

/// 현재 프로세스(호스트 앱)의 실행 파일 이름을 반환한다.
///
/// 확장자를 제거한 basename을 돌려주므로 Windows(`app.exe`)·Linux·macOS
/// 어디서나 같은 값이 된다. 실행 파일 이름은 리빌드해도 불변이라 개발 중
/// 바인딩 검증이 깨지지 않는다. 실행 경로를 얻을 수 없는 환경에서는
/// `None`을 반환한다.
pub fn host_executable_name() -> Option<String> {
    let path = std::env::current_exe().ok()?;
    let name = path.file_name()?.to_str()?;
    Some(strip_extension(name))
}

/// lh_core가 포함된 모듈(공유 라이브러리/DLL 또는 실행 파일)의 이름을
/// 반환한다.
///
/// `current_exe()`는 프로세스의 메인 실행 파일만 반환하지만, 이 함수는
/// **lh_core 코드가 실제로 로드된 모듈**을 찾는다. 따라서 응용SW 로직을
/// DLL/공유 라이브러리로 분리했을 때 그 DLL의 이름으로 바인딩할 수 있다.
/// - 단독 실행 파일 → 실행 파일 이름
/// - DLL/플러그인 로드 → 그 DLL 이름
pub fn host_module_name() -> Option<String> {
    // 이 함수 자신의 주소가 속한 모듈을 OS에 물어본다.
    let addr = host_module_name as *const () as *mut core::ffi::c_void;
    #[cfg(target_os = "windows")]
    let raw = windows_module_path(addr);
    #[cfg(not(target_os = "windows"))]
    let raw = posix_module_path(addr);
    let raw = raw?;
    let name = raw.rsplit('/').next()?.rsplit('\\').next()?;
    Some(strip_extension(name))
}

/// 파일 이름에서 확장자를 제거한다 (`app.exe` → `app`).
fn strip_extension(name: &str) -> String {
    name.rsplit_once('.')
        .map(|(stem, _)| stem.to_string())
        .unwrap_or_else(|| name.to_string())
}

/// POSIX(Linux/macOS)에서 주소가 속한 공유 라이브러리/실행 파일 경로를 얻는다.
#[cfg(not(target_os = "windows"))]
fn posix_module_path(addr: *mut core::ffi::c_void) -> Option<String> {
    use std::ffi::CStr;
    use std::os::raw::c_char;

    #[repr(C)]
    struct DlInfo {
        dli_fname: *const c_char,
        dli_fbase: *mut core::ffi::c_void,
        dli_sname: *const c_char,
        dli_saddr: *mut core::ffi::c_void,
    }
    unsafe extern "C" {
        fn dladdr(addr: *mut core::ffi::c_void, info: *mut DlInfo) -> i32;
    }
    let mut info = DlInfo {
        dli_fname: std::ptr::null(),
        dli_fbase: std::ptr::null_mut(),
        dli_sname: std::ptr::null(),
        dli_saddr: std::ptr::null_mut(),
    };
    if unsafe { dladdr(addr, &mut info) } == 0 {
        return None;
    }
    if info.dli_fname.is_null() {
        return None;
    }
    let path = unsafe { CStr::from_ptr(info.dli_fname) }
        .to_str()
        .ok()?
        .to_string();
    Some(path)
}

/// Windows에서 주소가 속한 모듈(DLL/실행 파일)의 경로를 얻는다.
#[cfg(target_os = "windows")]
fn windows_module_path(addr: *mut core::ffi::c_void) -> Option<String> {
    unsafe extern "system" {
        fn GetModuleHandleExW(
            flags: u32,
            module_name: *const u16,
            module: *mut *mut core::ffi::c_void,
        ) -> i32;
        fn GetModuleFileNameW(module: *mut core::ffi::c_void, filename: *mut u16, size: u32)
        -> u32;
    }
    const GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS: u32 = 0x0000_0004;
    const GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT: u32 = 0x0000_0002;
    let mut hmod: *mut core::ffi::c_void = std::ptr::null_mut();
    let ok = unsafe {
        GetModuleHandleExW(
            GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
            addr as *const u16,
            &mut hmod,
        )
    };
    if ok == 0 {
        return None;
    }
    let mut buf = [0u16; 1024];
    let len = unsafe { GetModuleFileNameW(hmod, buf.as_mut_ptr(), buf.len() as u32) };
    if len == 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&buf[..len as usize]))
}

// 인증서 구조를 변경할 때 버전을 올린다. 검증기는 알 수 없는 버전을
// 보수적으로 거부하여 새 형식을 구버전 Client가 잘못 해석하지 않게 한다.
const CURRENT_SCHEMA_VERSION: u32 = 1;

// 인증서에 알고리즘 이름이 있어도 이 허용 목록 검사를 우회해서는 안 된다.
// 현재는 Ed25519만 지원하며, 알고리즘 추가 시 명시적인 구현과 테스트가 필요하다.
const ALGORITHM: &str = "Ed25519";

// FFI 경계에서 받아들이는 인증서·검증 Context의 최대 크기. 발급 정상 인증서
// (Metadata와 하위 인증서 포함)는 이 크기를 넘지 않는다. 제한을 두지 않으면
// 공격자가 거대한 JSON을 전달해 호출 프로세스의 메모리를 고갈시킬 수 있다.
const MAX_CERTIFICATE_SIZE: usize = 64 * 1024;
const MAX_CONTEXT_SIZE: usize = 16 * 1024;

/// LicenseHub가 발급하는 서명된 인증서.
///
/// `signature`를 제외한 모든 필드는 canonicalization된 뒤 서명된다.
/// 따라서 JSON 공백, 객체 필드 순서와 같은 표현 차이는 서명 결과에
/// 영향을 주지 않지만, 실제 값의 변경은 항상 서명 검증 실패로 이어진다.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Certificate {
    /// 인증서 JSON Schema 버전.
    pub schema_version: u32,
    /// 개별 인증서의 식별자.
    pub certificate_id: String,
    /// 내부 License와 연결되는 식별자.
    pub license_id: String,
    /// 인증서 등급. 1은 Offline, 2는 Server Secure, 3은 Device-Bound다.
    pub level: u8,
    /// 인증서가 허용하는 제품 식별자.
    pub product: String,
    /// 인증서가 허용하는 제품 버전.
    pub version: String,
    /// 발급 시각. RFC 3339 형식의 UTC 값을 사용한다.
    pub issued_at: String,
    /// 만료 시각. 검증 시 현재 시각이 이 값 이상이면 만료로 처리한다.
    pub expires_at: String,
    /// 인증서 발급자 식별자.
    pub issuer: String,
    /// L2/L3에서 사용할 서버 검증 정보.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server: Option<ServerInfo>,
    /// L3에서 사용할 장치 바인딩 정보.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device: Option<DeviceBinding>,
    /// 제품별 정책과 기능 목록을 담는 확장 영역.
    ///
    /// 이 값도 서명 대상에 포함된다. 다만 현재 Core는 Metadata의
    /// JSON 무결성만 보장하며, 업무 의미의 검증은 상위 정책 계층이 담당한다.
    #[serde(default)]
    pub metadata: BTreeMap<String, Value>,
    /// 중첩 인증서 목록. 모든 하위 인증서도 독립적으로 검증해야 한다.
    #[serde(default)]
    pub children: Vec<Certificate>,
    /// 서명 알고리즘 식별자. 현재 `Ed25519`만 허용한다.
    pub signature_algorithm: String,
    /// 서명에 사용한 키 버전 식별자.
    pub key_id: String,
    /// canonical payload의 URL-safe Base64 서명.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub signature: String,
}

/// L2/L3 서버 검증 API의 위치.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ServerInfo {
    /// 실제 네트워크 요청은 Core가 수행하지 않는다.
    pub verification_url: String,
}

/// 인증서를 특정 장치에 귀속시키는 정보.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DeviceBinding {
    /// Device ID를 계산한 방식.
    pub binding_type: String,
    /// 원본 Device ID가 아닌 해시된 값.
    pub value: String,
}

/// 인증서 발급 요청을 구성하는 Builder.
///
/// 등급별 필수 필드 조합은 `Issuer::issue`에서 최종 검증한다. 따라서
/// Builder 단계에서는 조합을 유연하게 만들고, 서명 직전에 잘못된 요청을
/// 차단한다.
#[derive(Debug, Clone)]
pub struct CertificateRequest {
    license_id: String,
    level: u8,
    product: String,
    version: String,
    issued_at: String,
    expires_at: String,
    verification_url: Option<String>,
    device_id: Option<String>,
    metadata: BTreeMap<String, Value>,
    children: Vec<Certificate>,
}

impl CertificateRequest {
    //--------------------------------------------------------------------------------
    // 발급 요청을 생성한다.
    //
    // 인증서 발급에 필요한 최소 정보(라이선스 ID, 등급, 제품, 버전)로 요청을
    // 만든다. 날짜 기본값은 테스트·예제용이므로 운영 발급자는 issued_at과
    // expires_at을 반드시 명시해야 한다.
    // - 인자: license_id: 라이선스 식별자
    //         level: 인증서 등급 (1=Offline, 2=Secure, 3=Device-Bound)
    //         product: 제품 식별자
    //         version: 제품 버전
    // - 리턴: CertificateRequest 빌더 인스턴스
    //--------------------------------------------------------------------------------
    pub fn new(
        license_id: impl Into<String>,
        level: u8,
        product: impl Into<String>,
        version: impl Into<String>,
    ) -> Self {
        Self {
            license_id: license_id.into(),
            level,
            product: product.into(),
            version: version.into(),
            issued_at: "2026-01-01T00:00:00Z".into(),
            expires_at: "2027-01-01T00:00:00Z".into(),
            verification_url: None,
            device_id: None,
            metadata: BTreeMap::new(),
            children: Vec::new(),
        }
    }

    //--------------------------------------------------------------------------------
    // 발급 시각을 설정한다.
    // - 인자: value: RFC 3339 UTC 형식의 발급 시각
    // - 리턴: self (체이닝용)
    //--------------------------------------------------------------------------------
    pub fn issued_at(mut self, value: impl Into<String>) -> Self {
        self.issued_at = value.into();
        self
    }

    //--------------------------------------------------------------------------------
    // 만료 시각을 설정한다.
    // - 인자: value: RFC 3339 UTC 형식의 만료 시각
    // - 리턴: self (체이닝용)
    //--------------------------------------------------------------------------------
    pub fn expires_at(mut self, value: impl Into<String>) -> Self {
        self.expires_at = value.into();
        self
    }

    //--------------------------------------------------------------------------------
    // L2/L3 서버 검증 URL을 설정한다.
    // - 인자: value: 검증 서버의 HTTPS URL
    // - 리턴: self (체이닝용)
    //--------------------------------------------------------------------------------
    pub fn verification_url(mut self, value: impl Into<String>) -> Self {
        self.verification_url = Some(value.into());
        self
    }

    //--------------------------------------------------------------------------------
    // L3에 사용할 원본 Device ID를 설정한다.
    //
    // 원본 값은 인증서에 저장되지 않고 SHA-256 해시만 기록된다.
    // - 인자: value: 장치 식별을 위한 원본 ID
    // - 리턴: self (체이닝용)
    //--------------------------------------------------------------------------------
    pub fn device_id(mut self, value: impl Into<String>) -> Self {
        self.device_id = Some(value.into());
        self
    }

    //--------------------------------------------------------------------------------
    // 임의의 JSON Metadata를 추가한다.
    //
    // 모든 Metadata는 서명 대상에 포함되므로 발급 후 값·순서를 변경하면
    // 서명 검증에 실패한다. Private Key, Token, 원본 Hardware ID 같은
    // 민감정보는 포함하지 않는다.
    // - 인자: key: Metadata 키
    //         value: 임의의 JSON 값
    // - 리턴: self (체이닝용)
    //--------------------------------------------------------------------------------
    pub fn metadata(mut self, key: impl Into<String>, value: Value) -> Self {
        self.metadata.insert(key.into(), value);
        self
    }

    //--------------------------------------------------------------------------------
    // 중첩 인증서(하위 인증서)를 설정한다.
    // - 인자: children: 하위 인증서 목록
    // - 리턴: self (체이닝용)
    //--------------------------------------------------------------------------------
    pub fn children(mut self, children: Vec<Certificate>) -> Self {
        self.children = children;
        self
    }
}

/// 인증서 생성과 서명을 담당하는 발급자.
///
/// 이 객체는 Private Key를 메모리에 보관하므로 서버의 발급 전용 프로세스
/// 에서만 사용해야 한다. Client SDK나 배포 대상 응용 프로그램에는
/// `Issuer`를 포함하지 않고 공개키 검증 기능만 포함해야 한다.
pub struct Issuer {
    // ed25519-dalek은 zeroize feature 활성 시 SigningKey의 secret_key를
    // Drop 시점에 0으로 덮어쓴다(ZeroizeOnDrop). 따라서 Issuer가 해제되면
    // 개인키가 메모리에서 소멸된다.
    signing_key: SigningKey,
    key_id: String,
}

impl Issuer {
    //--------------------------------------------------------------------------------
    // 운영체제 CSPRNG로 새 Ed25519 키를 생성하여 발급자를 만든다.
    // - 인자: key_id: 서명 키 버전 식별자 (Public Key 선택·회전에 사용)
    // - 리턴: Issuer 인스턴스
    //--------------------------------------------------------------------------------
    pub fn generate(key_id: impl Into<String>) -> Self {
        Self {
            signing_key: SigningKey::generate(&mut OsRng),
            key_id: key_id.into(),
        }
    }

    //--------------------------------------------------------------------------------
    // 외부에서 안전하게 로드한 개인키로 발급자를 만든다.
    //
    // 키 파일 복호화와 Secret 조회는 이 함수의 책임이 아니다.
    // - 인자: key_id: 서명 키 버전 식별자
    //         bytes: Ed25519 개인키 32바이트
    // - 리턴: Issuer 인스턴스
    //--------------------------------------------------------------------------------
    pub fn from_bytes(key_id: impl Into<String>, bytes: &[u8; 32]) -> Self {
        Self {
            signing_key: SigningKey::from_bytes(bytes),
            key_id: key_id.into(),
        }
    }

    // 서명 키 버전 식별자를 반환한다.
    pub fn key_id(&self) -> &str {
        &self.key_id
    }

    //--------------------------------------------------------------------------------
    // 배포 대상 응용 SW에 내장할 검증용 공개키를 반환한다.
    // - 인자: 없음
    // - 리턴: Ed25519 VerifyingKey
    //--------------------------------------------------------------------------------
    pub fn verifying_key(&self) -> VerifyingKey {
        self.signing_key.verifying_key()
    }

    //--------------------------------------------------------------------------------
    // 요청을 검증하고 인증서를 생성한 뒤 서명한다.
    //
    // 순서: 요청 정책 검증 -> 인증서 조립 -> canonicalization -> Ed25519 서명.
    // 서명 필드는 빈 상태로 payload를 만들고, 결과를 마지막에 기록한다.
    // - 인자: request: 발급 요청 빌더
    // - 리턴: Ok(서명된 인증서) 또는 Err(IssueError)
    //--------------------------------------------------------------------------------
    pub fn issue(&self, request: CertificateRequest) -> Result<Certificate, IssueError> {
        validate_request(&request)?;
        let mut certificate = Certificate {
            schema_version: CURRENT_SCHEMA_VERSION,
            certificate_id: random_id(),
            license_id: request.license_id,
            level: request.level,
            product: request.product,
            version: request.version,
            issued_at: request.issued_at,
            expires_at: request.expires_at,
            issuer: "LicenseHub".into(),
            server: request
                .verification_url
                .map(|verification_url| ServerInfo { verification_url }),
            device: request.device_id.map(|device_id| DeviceBinding {
                binding_type: "device-id-sha256".into(),
                value: hash_device_id(&device_id),
            }),
            metadata: request.metadata,
            children: request.children,
            signature_algorithm: ALGORITHM.into(),
            key_id: self.key_id.clone(),
            signature: String::new(),
        };
        let payload = signing_payload(&certificate).map_err(IssueError::Serialization)?;
        certificate.signature = URL_SAFE_NO_PAD.encode(self.signing_key.sign(&payload).to_bytes());
        Ok(certificate)
    }
}

/// 인증서 발급 단계에서 발생하는 오류.
#[derive(Debug, Error, PartialEq)]
pub enum IssueError {
    #[error("invalid certificate request: {0}")]
    InvalidRequest(String),
    #[error("serialization failed: {0}")]
    Serialization(String),
}

/// L2/L3 서버 검증 결과.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerStatus {
    Approved,
    Rejected,
}

/// 검증 시점의 외부 환경과 정책 정보.
///
/// Core는 네트워크에 연결하지 않으므로 서버 승인 여부와 Blacklist 결과를
/// 호출자가 채워서 전달한다. `now`도 호출자가 지정하므로 테스트에서
/// 시간을 고정할 수 있고, 제품 정책에 따라 시간 기준을 통제할 수 있다.
#[derive(Debug, Clone)]
pub struct VerificationContext {
    /// 현재 검증 시각.
    pub now: String,
    /// 설정된 경우 인증서 제품과 일치해야 한다.
    pub product: Option<String>,
    /// 설정된 경우 인증서 버전과 일치해야 한다.
    pub version: Option<String>,
    /// 설정된 경우 인증서 metadata["product_id"]와 일치해야 한다.
    /// 프로젝트 파일의 고유값(GUID 등)으로 앱 단위 바인딩을 강화한다.
    pub product_id: Option<String>,
    /// 설정된 경우 인증서 metadata["executable_name"]과 일치해야 한다.
    /// 실행 파일 이름으로 앱 단위 바인딩을 강화한다. `host_executable_name()`
    /// 으로 실제 실행 파일 이름을 측정해 채울 수 있다.
    pub executable_name: Option<String>,
    /// L3 검증에 사용할 현재 장치의 원본 ID.
    pub device_id: Option<String>,
    /// L2/L3 서버 검증 결과.
    pub server_status: Option<ServerStatus>,
    /// License 또는 Certificate가 Blacklist에 포함되었는지 여부.
    pub blacklisted: bool,
    /// License 또는 Certificate가 폐기되었는지 여부.
    pub revoked: bool,
    /// 중첩 인증서 검증을 제한하는 최대 깊이.
    pub max_chain_depth: usize,
}

//--------------------------------------------------------------------------------
// 기본 검증 Context를 생성한다.
//
// 기본 시각은 예제·테스트용이며, 운영 검증기는 현재 시각을 명시해야 한다.
// - 인자: 없음
// - 리턴: VerificationContext 인스턴스
//--------------------------------------------------------------------------------
impl Default for VerificationContext {
    fn default() -> Self {
        Self {
            now: "2026-06-01T00:00:00Z".into(),
            product: None,
            version: None,
            product_id: None,
            executable_name: None,
            device_id: None,
            server_status: None,
            blacklisted: false,
            revoked: false,
            max_chain_depth: 3,
        }
    }
}

impl VerificationContext {
    //--------------------------------------------------------------------------------
    // 지정한 시각을 기준으로 기본 검증 Context를 만든다.
    // - 인자: value: 검증 기준 시각 (RFC 3339 UTC)
    // - 리턴: VerificationContext 인스턴스
    //--------------------------------------------------------------------------------
    pub fn at(value: impl Into<String>) -> Self {
        Self {
            now: value.into(),
            ..Self::default()
        }
    }
    //--------------------------------------------------------------------------------
    // L2/L3 서버 검증 결과를 설정한다.
    // - 인자: status: 서버 승인(Approved) 또는 거부(Rejected) 상태
    // - 리턴: self (체이닝용)
    //--------------------------------------------------------------------------------
    pub fn server(mut self, status: ServerStatus) -> Self {
        self.server_status = Some(status);
        self
    }
    //--------------------------------------------------------------------------------
    // 현재 장치의 원본 ID를 설정한다. L3 검증에서 해시 비교에 사용된다.
    // - 인자: value: 현재 장치 식별을 위한 원본 ID
    // - 리턴: self (체이닝용)
    //--------------------------------------------------------------------------------
    pub fn device_id(mut self, value: impl Into<String>) -> Self {
        self.device_id = Some(value.into());
        self
    }
    //--------------------------------------------------------------------------------
    // 제품 정책을 설정한다. 설정되면 인증서 제품과 일치해야 한다.
    // - 인자: value: 기대하는 제품 식별자
    // - 리턴: self (체이닝용)
    //--------------------------------------------------------------------------------
    pub fn product(mut self, value: impl Into<String>) -> Self {
        self.product = Some(value.into());
        self
    }
    //--------------------------------------------------------------------------------
    // 버전 정책을 설정한다. 설정되면 인증서 버전과 일치해야 한다.
    // - 인자: value: 기대하는 제품 버전
    // - 리턴: self (체이닝용)
    //--------------------------------------------------------------------------------
    pub fn version(mut self, value: impl Into<String>) -> Self {
        self.version = Some(value.into());
        self
    }
    //--------------------------------------------------------------------------------
    // 라이선스가 Blacklist에 포함되었음을 설정한다.
    // - 인자: 없음
    // - 리턴: self (체이닝용)
    //--------------------------------------------------------------------------------
    pub fn blacklisted(mut self) -> Self {
        self.blacklisted = true;
        self
    }
    //--------------------------------------------------------------------------------
    // 라이선스 또는 인증서가 폐기되었음을 설정한다.
    // - 인자: 없음
    // - 리턴: self (체이닝용)
    //--------------------------------------------------------------------------------
    pub fn revoked(mut self) -> Self {
        self.revoked = true;
        self
    }
}

/// 인증서 검증 실패 사유.
///
/// 각 오류는 Client가 활성화를 거부할 수 있도록 안정적인 의미를 가진다.
/// 오류 메시지는 진단용이며, 외부 언어 연동에서는 오류 종류를 기준으로
/// 처리하는 것을 권장한다.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum VerificationError {
    #[error("invalid certificate format")]
    InvalidFormat,
    #[error("unsupported schema version")]
    UnsupportedSchema,
    #[error("unsupported signature algorithm")]
    UnsupportedAlgorithm,
    #[error("invalid signature")]
    InvalidSignature,
    #[error("invalid metadata")]
    InvalidMetadata,
    #[error("certificate has expired")]
    Expired,
    #[error("certificate is not yet valid")]
    NotYetValid,
    #[error("server verification is required")]
    ServerRequired,
    #[error("server rejected certificate")]
    ServerRejected,
    #[error("certificate is revoked")]
    Revoked,
    #[error("license is blacklisted")]
    Blacklisted,
    #[error("device does not match certificate")]
    DeviceMismatch,
    #[error("certificate chain is invalid")]
    ChainInvalid,
    #[error("certificate chain is too deep")]
    ChainTooDeep,
    #[error("product or version does not match")]
    PolicyRejected,
}

//--------------------------------------------------------------------------------
// 인증서 전체를 검증한다.
//
// 순서: 체인 깊이·Schema -> 서명 알고리즘·서명 -> 발급일·만료일·제품 ->
// 등급별 서버·Device -> Revocation·Blacklist -> 하위 인증서 재귀 검증.
// 하나라도 실패하면 Err를 반환하며, 호출자는 성공한 경우에만 응용 SW의
// 핵심 기능을 활성화해야 한다.
// - 인자: certificate: 검증할 인증서
//         public_key: 검증용 공개키
//         context: 서버 상태, Device, 정책 등 검증 환경
// - 리턴: Ok(()) 또는 Err(VerificationError)
//--------------------------------------------------------------------------------
pub fn verify(
    certificate: &Certificate,
    public_key: &VerifyingKey,
    context: &VerificationContext,
) -> Result<(), VerificationError> {
    verify_at_depth(certificate, public_key, context, 0)
}

//--------------------------------------------------------------------------------
// 체인 깊이를 추적하며 인증서를 재귀 검증한다.
//
// depth가 max_chain_depth를 초과하면 ChainTooDeep으로 거부해 매우 깊은
// 입력으로 인한 스택·CPU 고갈을 방지한다.
// - 인자: certificate: 검증할 인증서
//         public_key: 검증용 공개키
//         context: 검증 환경
//         depth: 현재 체인 깊이 (루트는 0)
// - 리턴: Ok(()) 또는 Err(VerificationError)
//--------------------------------------------------------------------------------
fn verify_at_depth(
    certificate: &Certificate,
    public_key: &VerifyingKey,
    context: &VerificationContext,
    depth: usize,
) -> Result<(), VerificationError> {
    // 재귀 호출마다 깊이를 확인하여 악의적으로 매우 깊은 JSON을 전달하는
    // 입력이 스택과 CPU를 고갈시키지 못하게 한다.
    if depth > context.max_chain_depth {
        return Err(VerificationError::ChainTooDeep);
    }
    if certificate.schema_version != CURRENT_SCHEMA_VERSION {
        return Err(VerificationError::UnsupportedSchema);
    }
    if certificate.signature_algorithm != ALGORITHM {
        return Err(VerificationError::UnsupportedAlgorithm);
    }
    if certificate.level == 0 || certificate.level > 3 {
        return Err(VerificationError::InvalidFormat);
    }
    if certificate.product.is_empty() || certificate.license_id.is_empty() {
        return Err(VerificationError::InvalidMetadata);
    }
    // JSON을 그대로 다시 직렬화하지 않고 발급 때와 동일한 canonical
    // payload를 재생성해야 필드 순서 차이로 검증이 깨지지 않는다.
    let payload = signing_payload(certificate).map_err(|_| VerificationError::InvalidFormat)?;
    let signature_bytes = URL_SAFE_NO_PAD
        .decode(&certificate.signature)
        .map_err(|_| VerificationError::InvalidSignature)?;
    let signature =
        Signature::from_slice(&signature_bytes).map_err(|_| VerificationError::InvalidSignature)?;
    public_key
        .verify(&payload, &signature)
        .map_err(|_| VerificationError::InvalidSignature)?;
    let issued_at = parse_time(&certificate.issued_at).ok_or(VerificationError::InvalidMetadata)?;
    let expires_at =
        parse_time(&certificate.expires_at).ok_or(VerificationError::InvalidMetadata)?;
    let now = parse_time(&context.now).ok_or(VerificationError::InvalidMetadata)?;
    if expires_at <= issued_at {
        return Err(VerificationError::InvalidMetadata);
    }
    if now < issued_at {
        return Err(VerificationError::NotYetValid);
    }
    if now >= expires_at {
        return Err(VerificationError::Expired);
    }
    if context
        .product
        .as_deref()
        .is_some_and(|product| product != certificate.product)
        || context
            .version
            .as_deref()
            .is_some_and(|version| version != certificate.version)
    {
        return Err(VerificationError::PolicyRejected);
    }
    // 프로젝트 파일 고유값(product_id)이 설정되면 인증서의 서명된
    // metadata["product_id"]와 비교한다. X(설명 인증서)의 앱 단위 바인딩을
    // 강화하는 검증으로, 불일치 시 실패한다.
    if let Some(pid) = context.product_id.as_deref() {
        let cert_pid = certificate
            .metadata
            .get("product_id")
            .and_then(Value::as_str)
            .unwrap_or("");
        if pid != cert_pid {
            return Err(VerificationError::PolicyRejected);
        }
    }
    // 실행 파일 이름이 설정되면 인증서의 서명된 metadata["executable_name"]과
    // 비교한다. 호스트가 측정한 실제 실행 파일 이름과 서명 정보를 대조해
    // "코어로직이 이 앱의 실행 파일에서만 동작"함을 강제한다.
    if let Some(exe) = context.executable_name.as_deref() {
        let cert_exe = certificate
            .metadata
            .get("executable_name")
            .and_then(Value::as_str)
            .unwrap_or("");
        if exe != cert_exe {
            return Err(VerificationError::PolicyRejected);
        }
    }
    // 등급 필드와 부가 필드의 조합을 확인한다. 예를 들어 L1에 server나
    // device 정보가 붙어 있으면 발급 정책 위반으로 간주한다.
    match certificate.level {
        1 if certificate.server.is_some() || certificate.device.is_some() => {
            return Err(VerificationError::InvalidMetadata);
        }
        2 => {
            if certificate.server.is_none() || certificate.device.is_some() {
                return Err(VerificationError::InvalidMetadata);
            }
            check_server(context)?;
        }
        3 => {
            if certificate.server.is_none() || certificate.device.is_none() {
                return Err(VerificationError::InvalidMetadata);
            }
            check_server(context)?;
            let expected = context.device_id.as_deref().map(hash_device_id);
            if expected.as_deref()
                != certificate
                    .device
                    .as_ref()
                    .map(|device| device.value.as_str())
            {
                return Err(VerificationError::DeviceMismatch);
            }
        }
        _ => {}
    }
    // 상태 검증은 서명 검증 이후에 수행한다. 저장소에 파일이 존재하더라도
    // 폐기·Blacklist 상태이면 유효한 License로 취급하지 않는다.
    if context.revoked {
        return Err(VerificationError::Revoked);
    }
    if context.blacklisted {
        return Err(VerificationError::Blacklisted);
    }
    // 하위 인증서 하나라도 실패하면 전체 체인을 실패로 처리한다.
    for child in &certificate.children {
        match verify_at_depth(child, public_key, context, depth + 1) {
            Ok(()) => {}
            Err(VerificationError::ChainTooDeep) => return Err(VerificationError::ChainTooDeep),
            Err(_) => return Err(VerificationError::ChainInvalid),
        }
    }
    Ok(())
}

//--------------------------------------------------------------------------------
// L2/L3의 서버 검증 상태를 확인한다.
// - 인자: context: 서버 상태가 포함된 검증 환경
// - 리턴: Ok(()) 또는 Err(ServerRequired/ServerRejected)
//--------------------------------------------------------------------------------
fn check_server(context: &VerificationContext) -> Result<(), VerificationError> {
    match context.server_status {
        None => Err(VerificationError::ServerRequired),
        Some(ServerStatus::Rejected) => Err(VerificationError::ServerRejected),
        Some(ServerStatus::Approved) => Ok(()),
    }
}

//--------------------------------------------------------------------------------
// 발급 요청의 등급·필수 필드 조합을 서명 전에 검증한다.
//
// 잘못된 조합은 서명 후 되돌릴 수 없으므로 Fail-Closed로 처리한다.
// - 인자: request: 발급 요청
// - 리턴: Ok(()) 또는 Err(IssueError::InvalidRequest)
//--------------------------------------------------------------------------------
fn validate_request(request: &CertificateRequest) -> Result<(), IssueError> {
    // 잘못된 조합을 서명하기 전에 차단한다. 서명된 뒤에는 잘못된 정책을
    // 단순 데이터 오류로 되돌릴 수 없으므로 발급 단계에서 Fail-Closed한다.
    if !(1..=3).contains(&request.level) {
        return Err(IssueError::InvalidRequest(
            "level must be 1, 2, or 3".into(),
        ));
    }
    if request.license_id.is_empty() || request.product.is_empty() || request.version.is_empty() {
        return Err(IssueError::InvalidRequest(
            "license, product, and version are required".into(),
        ));
    }
    if request.level == 1 && (request.verification_url.is_some() || request.device_id.is_some()) {
        return Err(IssueError::InvalidRequest(
            "level 1 cannot contain server or device binding".into(),
        ));
    }
    if request.level >= 2 && request.verification_url.is_none() {
        return Err(IssueError::InvalidRequest(
            "server verification URL is required".into(),
        ));
    }
    if request.level == 2 && request.device_id.is_some() {
        return Err(IssueError::InvalidRequest(
            "level 2 cannot contain device binding".into(),
        ));
    }
    if request.level == 3 && request.device_id.is_none() {
        return Err(IssueError::InvalidRequest(
            "device binding is required".into(),
        ));
    }
    Ok(())
}

//--------------------------------------------------------------------------------
// 서명 대상 canonical payload를 생성한다.
//
// signature 필드를 제외한 인증서를 Value로 변환하고 객체 키를 정렬한
// 바이트열을 만든다. 발급자와 검증자가 같은 규칙을 쓰므로 필드 순서와
// 공백 차이는 서명 결과에 영향을 주지 않는다.
// - 인자: certificate: 서명할 인증서
// - 리턴: Ok(canonical 바이트열) 또는 Err(직렬화 오류 메시지)
//--------------------------------------------------------------------------------
fn signing_payload(certificate: &Certificate) -> Result<Vec<u8>, String> {
    // 서명 필드는 자기 자신을 서명할 수 없으므로 payload에서 제외한다.
    // 나머지 필드는 Value로 변환한 뒤 재귀적으로 정렬한다.
    let mut value = serde_json::to_value(certificate).map_err(|error| error.to_string())?;
    if let Value::Object(ref mut object) = value {
        object.remove("signature");
    }
    let mut output = Vec::new();
    write_canonical(&value, &mut output)?;
    Ok(output)
}

//--------------------------------------------------------------------------------
// JSON Value를 재귀적으로 canonical 직렬화한다.
//
// 객체 키는 BTreeMap으로 정렬하고 배열 순서는 유지한다. 이 규칙은 언어별
// 구현 간 동일 바이트열 생성을 위한 호환성 계약이다.
// - 인자: value: 직렬화할 JSON 값
//         output: 결과를 쌓을 출력 버퍼
// - 리턴: Ok(()) 또는 Err(직렬화 오류 메시지)
//--------------------------------------------------------------------------------
fn write_canonical(value: &Value, output: &mut Vec<u8>) -> Result<(), String> {
    // 객체 키 순서를 BTreeMap으로 정렬하고 배열 순서는 유지한다. 이 규칙은
    // 발급자와 검증자가 서로 다른 언어로 구현되어도 같은 바이트열을 만들기
    // 위한 핵심 호환성 규칙이다.
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {
            output.extend(serde_json::to_vec(value).map_err(|error| error.to_string())?)
        }
        Value::Array(values) => {
            output.push(b'[');
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    output.push(b',');
                }
                write_canonical(value, output)?;
            }
            output.push(b']');
        }
        Value::Object(object) => {
            output.push(b'{');
            let sorted: BTreeMap<&String, &Value> = object.iter().collect();
            for (index, (key, value)) in sorted.iter().enumerate() {
                if index > 0 {
                    output.push(b',');
                }
                output.extend(serde_json::to_vec(key).map_err(|error| error.to_string())?);
                output.push(b':');
                write_canonical(value, output)?;
            }
            output.push(b'}');
        }
    }
    Ok(())
}

//--------------------------------------------------------------------------------
// RFC 3339 형식의 시간 문자열을 파싱한다.
// - 인자: value: RFC 3339 UTC 시간 문자열
// - 리턴: Option<OffsetDateTime> (형식이 틀리면 None)
//--------------------------------------------------------------------------------
fn parse_time(value: &str) -> Option<OffsetDateTime> {
    OffsetDateTime::parse(value, &Rfc3339).ok()
}
//--------------------------------------------------------------------------------
// 원본 Device ID의 SHA-256 해시를 URL-safe Base64로 생성한다.
//
// 원문이 인증서에 저장되지 않도록 하며, 민감한 Hardware ID 정보도 보호된다.
// - 인자: value: 원본 Device ID
// - 리턴: URL-safe Base64 해시 문자열
//--------------------------------------------------------------------------------
fn hash_device_id(value: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(value.as_bytes()))
}
//--------------------------------------------------------------------------------
// 운영체제 난수원으로 인증서 식별자를 생성한다.
// - 인자: 없음
// - 리턴: URL-safe Base64 식별자 문자열
//--------------------------------------------------------------------------------
fn random_id() -> String {
    let mut bytes = [0u8; 12];
    getrandom::fill(&mut bytes).expect("operating system random source unavailable");
    URL_SAFE_NO_PAD.encode(bytes)
}

#[derive(Debug, Deserialize, Default)]
struct FfiVerificationContext {
    // C ABI에서는 포인터로 Rust 구조체를 노출하지 않고 JSON Context를
    // 받아 ABI를 단순하게 유지한다. 누락된 값은 검증 정책의 기본값을 쓴다.
    now: Option<String>,
    product: Option<String>,
    version: Option<String>,
    product_id: Option<String>,
    executable_name: Option<String>,
    device_id: Option<String>,
    server_status: Option<String>,
    #[serde(default)]
    blacklisted: bool,
    #[serde(default)]
    revoked: bool,
    max_chain_depth: Option<usize>,
}

impl FfiVerificationContext {
    //--------------------------------------------------------------------------------
    // FFI용 평면 JSON Context를 내부 검증 Context로 변환한다.
    // - 인자: self: 역직렬화된 FFI Context
    // - 리턴: VerificationContext 인스턴스
    //--------------------------------------------------------------------------------
    fn into_context(self) -> VerificationContext {
        let server_status = match self.server_status.as_deref() {
            Some("approved") => Some(ServerStatus::Approved),
            Some("rejected") => Some(ServerStatus::Rejected),
            _ => None,
        };
        VerificationContext {
            now: self
                .now
                .unwrap_or_else(|| VerificationContext::default().now),
            product: self.product,
            version: self.version,
            product_id: self.product_id,
            executable_name: self.executable_name,
            device_id: self.device_id,
            server_status,
            blacklisted: self.blacklisted,
            revoked: self.revoked,
            max_chain_depth: self.max_chain_depth.unwrap_or(3),
        }
    }
}

//--------------------------------------------------------------------------------
// JSON 인증서를 C ABI를 통해 검증한다.
//
// 반환값 0은 요청이 처리되었음을 의미하고, 실제 인증 결과는 result_code에
// 기록된다. -1은 포인터·길이 오류, -2는 JSON/공개키 파싱 오류다. 인증서가
// 유효하지 않아도 호출 자체는 성공(0)이며 result_code에 실패 코드가 담긴다.
//
// # Safety: 모든 비-NULL 포인터는 전달된 길이만큼 유효한 읽기 버퍼를
// 가리켜야 하고, result_code는 u32 하나를 쓸 수 있는 메모리를 가리켜야 한다.
// - 인자: certificate: 인증서 JSON 바이트 포인터
//         certificate_len: 인증서 버퍼 길이
//         public_key: Ed25519 공개키 32바이트 포인터
//         public_key_len: 공개키 길이 (32)
//         context: 검증 Context JSON 포인터 (비어 있으면 기본값)
//         context_len: Context 버퍼 길이
//         result_code: 검증 결과 코드를 기록할 출력 포인터
// - 리턴: 0 처리 성공 / -1 인자 오류 / -2 입력 파싱 오류
//--------------------------------------------------------------------------------
// 안전 조건은 위 배너 주석의 # Safety 단락에 문서화되어 있다.
#[allow(clippy::missing_safety_doc)]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lh_verify_certificate(
    certificate: *const u8,
    certificate_len: usize,
    public_key: *const u8,
    public_key_len: usize,
    context: *const u8,
    context_len: usize,
    result_code: *mut u32,
) -> i32 {
    // FFI 호출자는 Rust의 타입 시스템 밖에 있으므로 먼저 포인터와 공개키
    // 길이를 확인한다. 이 검사를 통과하기 전에는 어떤 포인터도 역참조하지
    // 않는다.
    if result_code.is_null()
        || certificate.is_null()
        || public_key.is_null()
        || (context_len > 0 && context.is_null())
        || public_key_len != 32
        || certificate_len > MAX_CERTIFICATE_SIZE
        || context_len > MAX_CONTEXT_SIZE
    {
        return -1;
    }
    // panic이 C 호출자까지 전파되면 프로세스가 정의되지 않은 상태가 될 수
    // 있으므로 FFI 경계에서 잡고 입력 오류로 변환한다.
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        let certificate_bytes = unsafe { slice::from_raw_parts(certificate, certificate_len) };
        let public_key_bytes = unsafe { slice::from_raw_parts(public_key, public_key_len) };
        let context_bytes = if context_len == 0 {
            b"{}" as &[u8]
        } else {
            unsafe { slice::from_raw_parts(context, context_len) }
        };
        // 인증서와 Context 모두 외부 입력이므로 파싱 결과를 검증기에 전달하기
        // 전에 고정된 Rust 타입으로 역직렬화한다.
        let certificate: Certificate =
            serde_json::from_slice(certificate_bytes).map_err(|_| -2i32)?;
        let public_key: [u8; 32] = public_key_bytes.try_into().map_err(|_| -2i32)?;
        let public_key = VerifyingKey::from_bytes(&public_key).map_err(|_| -2i32)?;
        let ffi_context: FfiVerificationContext =
            serde_json::from_slice(context_bytes).map_err(|_| -2i32)?;
        Ok::<u32, i32>(verification_code(verify(
            &certificate,
            &public_key,
            &ffi_context.into_context(),
        )))
    }));
    match outcome {
        Ok(Ok(code)) => {
            unsafe { *result_code = code };
            0
        }
        Ok(Err(status)) => status,
        Err(_) => -2,
    }
}

//--------------------------------------------------------------------------------
// 코어에 내장된 신뢰 공개키(K1, 분산 저장)를 재조립해 호출자 버퍼에 복사한다.
//
// X(설명 인증서) 검증용 신뢰 앵커다. 평문 키 상수를 두지 않으므로 정적 분석
// 으로 키를 직접 찾기 어렵다.
// - 인자: out: 32바이트를 기록할 출력 버퍼
//         out_len: 입력 시 버퍼 용량, 반환 시 실제 기록 크기(32)
// - 리턴: 0 성공 / -1 인자 오류(버퍼 부족 포함) / -2 무결성 실패
//--------------------------------------------------------------------------------
#[allow(clippy::missing_safety_doc)]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lh_trusted_public_key(out: *mut u8, out_len: *mut usize) -> i32 {
    if out.is_null() || out_len.is_null() {
        return -1;
    }
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        let mut key = trusted::trusted_public_key().to_bytes();
        let capacity = unsafe { *out_len };
        if capacity < key.len() {
            key.zeroize();
            unsafe { *out_len = key.len() };
            return Err(-1i32);
        }
        unsafe {
            std::ptr::copy_nonoverlapping(key.as_ptr(), out, key.len());
            *out_len = key.len();
        }
        key.zeroize();
        Ok::<(), i32>(())
    }));
    match outcome {
        Ok(Ok(())) => 0,
        Ok(Err(status)) => status,
        Err(_) => -2,
    }
}

//--------------------------------------------------------------------------------
// 코어에 내장된 신뢰 공개키(K1)로 인증서(X)를 검증한다. 공개키를 인자로
// 받지 않는 점만 `lh_verify_certificate`와 다르며, 응용SW 핵심로직 방어용이다.
// - 인자: certificate: JSON 인증서 버퍼
//         certificate_len: 인증서 길이
//         context: 검증 Context JSON (비어 있으면 기본값)
//         context_len: Context 버퍼 길이
//         result_code: 검증 결과 코드를 기록할 출력 포인터
// - 리턴: 0 처리 성공 / -1 인자 오류 / -2 입력 파싱 또는 무결성 오류
//--------------------------------------------------------------------------------
#[allow(clippy::missing_safety_doc)]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn lh_verify_trusted_certificate(
    certificate: *const u8,
    certificate_len: usize,
    context: *const u8,
    context_len: usize,
    result_code: *mut u32,
) -> i32 {
    if result_code.is_null()
        || certificate.is_null()
        || (context_len > 0 && context.is_null())
        || certificate_len > MAX_CERTIFICATE_SIZE
        || context_len > MAX_CONTEXT_SIZE
    {
        return -1;
    }
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        let certificate_bytes = unsafe { slice::from_raw_parts(certificate, certificate_len) };
        let context_bytes = if context_len == 0 {
            b"{}" as &[u8]
        } else {
            unsafe { slice::from_raw_parts(context, context_len) }
        };
        let certificate: Certificate =
            serde_json::from_slice(certificate_bytes).map_err(|_| -2i32)?;
        let ffi_context: FfiVerificationContext =
            serde_json::from_slice(context_bytes).map_err(|_| -2i32)?;
        Ok::<u32, i32>(verification_code(trusted::verify_trusted(
            &certificate,
            &ffi_context.into_context(),
        )))
    }));
    match outcome {
        Ok(Ok(code)) => {
            unsafe { *result_code = code };
            0
        }
        Ok(Err(status)) => status,
        Err(_) => -2,
    }
}

//--------------------------------------------------------------------------------
// 검증 결과를 안정적인 정수 코드로 변환한다.
//
// C, C#, Python 등 외부 호출자가 언어별 예외 문자열에 의존하지 않도록
// 코드를 고정하며, include/licensehub_core.h의 enum과 일치해야 한다.
// - 인자: result: verify()의 검증 결과
// - 리턴: u32 코드 (0=유효, 1~15=실패 사유)
//--------------------------------------------------------------------------------
fn verification_code(result: Result<(), VerificationError>) -> u32 {
    // C, C#, Python 등의 호출자가 언어별 예외 문자열에 의존하지 않도록
    // 검증 결과를 안정적인 정수 코드로 변환한다. 이 값은 헤더 파일의
    // enum과 함께 버전 관리해야 한다.
    match result {
        Ok(()) => 0,
        Err(VerificationError::InvalidFormat) => 1,
        Err(VerificationError::UnsupportedSchema) => 2,
        Err(VerificationError::UnsupportedAlgorithm) => 3,
        Err(VerificationError::InvalidSignature) => 4,
        Err(VerificationError::InvalidMetadata) => 5,
        Err(VerificationError::Expired) => 6,
        Err(VerificationError::NotYetValid) => 7,
        Err(VerificationError::ServerRequired) => 8,
        Err(VerificationError::ServerRejected) => 9,
        Err(VerificationError::Revoked) => 10,
        Err(VerificationError::Blacklisted) => 11,
        Err(VerificationError::DeviceMismatch) => 12,
        Err(VerificationError::ChainInvalid) => 13,
        Err(VerificationError::ChainTooDeep) => 14,
        Err(VerificationError::PolicyRejected) => 15,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn core_certificate_is_issued_and_verified() {
        let issuer = Issuer::generate("test-key");
        let certificate = issuer
            .issue(
                CertificateRequest::new("license-1", 1, "DXi", "1.2.0")
                    .expires_at("2030-01-01T00:00:00Z"),
            )
            .unwrap();
        assert!(
            verify(
                &certificate,
                &issuer.verifying_key(),
                &VerificationContext::at("2027-01-01T00:00:00Z")
            )
            .is_ok()
        );
    }

    #[test]
    fn tampering_expiration_and_signature_is_rejected() {
        let issuer = Issuer::generate("test-key");
        let mut certificate = issuer
            .issue(CertificateRequest::new("license-1", 1, "DXi", "1.2.0"))
            .unwrap();
        certificate.product = "Tampered".into();
        assert_eq!(
            verify(
                &certificate,
                &issuer.verifying_key(),
                &VerificationContext::default()
            ),
            Err(VerificationError::InvalidSignature)
        );
        let expired = issuer
            .issue(
                CertificateRequest::new("license-1", 1, "DXi", "1.2.0")
                    .issued_at("2025-01-01T00:00:00Z")
                    .expires_at("2026-01-01T00:00:00Z"),
            )
            .unwrap();
        assert_eq!(
            verify(
                &expired,
                &issuer.verifying_key(),
                &VerificationContext::at("2027-01-01T00:00:00Z")
            ),
            Err(VerificationError::Expired)
        );
    }

    #[test]
    fn secure_and_device_bound_policies_are_enforced() {
        let issuer = Issuer::generate("test-key");
        let secure = issuer
            .issue(
                CertificateRequest::new("license-1", 2, "DXi", "1.2.0")
                    .verification_url("https://license.example/verify"),
            )
            .unwrap();
        assert_eq!(
            verify(
                &secure,
                &issuer.verifying_key(),
                &VerificationContext::default()
            ),
            Err(VerificationError::ServerRequired)
        );
        assert!(
            verify(
                &secure,
                &issuer.verifying_key(),
                &VerificationContext::default().server(ServerStatus::Approved)
            )
            .is_ok()
        );
        let bound = issuer
            .issue(
                CertificateRequest::new("license-1", 3, "DXi", "1.2.0")
                    .verification_url("https://license.example/verify")
                    .device_id("device-a"),
            )
            .unwrap();
        assert_eq!(
            verify(
                &bound,
                &issuer.verifying_key(),
                &VerificationContext::default()
                    .server(ServerStatus::Approved)
                    .device_id("device-b")
            ),
            Err(VerificationError::DeviceMismatch)
        );
    }

    #[test]
    fn chain_status_and_json_round_trip_are_supported() {
        let issuer = Issuer::from_bytes("test-key", &[7u8; 32]);
        let child = issuer
            .issue(CertificateRequest::new("child", 1, "DXi", "1.2.0"))
            .unwrap();
        let parent = issuer
            .issue(CertificateRequest::new("parent", 1, "DXi", "1.2.0").children(vec![child]))
            .unwrap();
        let decoded: Certificate =
            serde_json::from_str(&serde_json::to_string(&parent).unwrap()).unwrap();
        assert!(
            verify(
                &decoded,
                &issuer.verifying_key(),
                &VerificationContext::default()
            )
            .is_ok()
        );
        assert_eq!(
            verify(
                &decoded,
                &issuer.verifying_key(),
                &VerificationContext {
                    max_chain_depth: 0,
                    ..VerificationContext::default()
                }
            ),
            Err(VerificationError::ChainTooDeep)
        );
        assert_eq!(
            verify(
                &decoded,
                &issuer.verifying_key(),
                &VerificationContext::default().blacklisted()
            ),
            Err(VerificationError::Blacklisted)
        );
    }

    #[test]
    fn c_abi_handles_valid_and_null_input() {
        let issuer = Issuer::from_bytes("test-key", &[9u8; 32]);
        let certificate = issuer
            .issue(CertificateRequest::new("license-1", 1, "DXi", "1.2.0"))
            .unwrap();
        let certificate_bytes = serde_json::to_vec(&certificate).unwrap();
        let public_key = issuer.verifying_key().to_bytes();
        let context = br#"{"now":"2026-06-01T00:00:00Z","max_chain_depth":3}"#;
        let mut result = u32::MAX;
        let status = unsafe {
            lh_verify_certificate(
                certificate_bytes.as_ptr(),
                certificate_bytes.len(),
                public_key.as_ptr(),
                public_key.len(),
                context.as_ptr(),
                context.len(),
                &mut result,
            )
        };
        assert_eq!((status, result), (0, 0));
        let status = unsafe {
            lh_verify_certificate(
                std::ptr::null(),
                0,
                std::ptr::null(),
                0,
                std::ptr::null(),
                0,
                &mut result,
            )
        };
        assert_eq!(status, -1);
    }

    #[test]
    fn c_abi_rejects_oversized_inputs() {
        let mut result = u32::MAX;
        let large = vec![0u8; 70_000];
        let context = br#"{"now":"2026-06-01T00:00:00Z","max_chain_depth":3}"#;

        let status = unsafe {
            lh_verify_certificate(
                large.as_ptr(),
                MAX_CERTIFICATE_SIZE + 1,
                large.as_ptr(),
                32,
                context.as_ptr(),
                context.len(),
                &mut result,
            )
        };
        assert_eq!(status, -1);

        let status = unsafe {
            lh_verify_certificate(
                large.as_ptr(),
                4,
                large.as_ptr(),
                32,
                large.as_ptr(),
                MAX_CONTEXT_SIZE + 1,
                &mut result,
            )
        };
        assert_eq!(status, -1);
    }
}
