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

// 인증서 구조를 변경할 때 버전을 올린다. 검증기는 알 수 없는 버전을
// 보수적으로 거부하여 새 형식을 구버전 Client가 잘못 해석하지 않게 한다.
const CURRENT_SCHEMA_VERSION: u32 = 1;

// 인증서에 알고리즘 이름이 있어도 이 허용 목록 검사를 우회해서는 안 된다.
// 현재는 Ed25519만 지원하며, 알고리즘 추가 시 명시적인 구현과 테스트가 필요하다.
const ALGORITHM: &str = "Ed25519";

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
    /// License, 등급, 제품, 버전으로 발급 요청을 생성한다.
    ///
    /// 날짜 기본값은 테스트와 예제용이다. 운영 발급자는 `issued_at`과
    /// `expires_at`을 명시적으로 설정해야 한다.
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

    /// 발급 시각을 설정한다.
    pub fn issued_at(mut self, value: impl Into<String>) -> Self {
        self.issued_at = value.into();
        self
    }

    /// 만료 시각을 설정한다.
    pub fn expires_at(mut self, value: impl Into<String>) -> Self {
        self.expires_at = value.into();
        self
    }

    /// L2/L3 서버 검증 URL을 설정한다.
    pub fn verification_url(mut self, value: impl Into<String>) -> Self {
        self.verification_url = Some(value.into());
        self
    }

    /// L3에 사용할 원본 Device ID를 설정한다.
    ///
    /// 원본 값은 인증서에 저장되지 않고 SHA-256 해시만 저장된다.
    pub fn device_id(mut self, value: impl Into<String>) -> Self {
        self.device_id = Some(value.into());
        self
    }

    /// 임의의 JSON Metadata를 추가한다.
    ///
    /// 모든 Metadata는 인증서 서명 전에 포함되므로 발급 후 변경할 수 없다.
    pub fn metadata(mut self, key: impl Into<String>, value: Value) -> Self {
        self.metadata.insert(key.into(), value);
        self
    }

    /// 중첩 인증서를 설정한다.
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
    signing_key: SigningKey,
    key_id: String,
}

impl Issuer {
    /// 운영체제 CSPRNG로 새 Ed25519 키를 생성한다.
    pub fn generate(key_id: impl Into<String>) -> Self {
        Self {
            signing_key: SigningKey::generate(&mut OsRng),
            key_id: key_id.into(),
        }
    }

    /// 외부에서 안전하게 로드된 32바이트 개인키로 발급자를 생성한다.
    ///
    /// 키 파일 복호화, Secret 조회, 키 저장은 이 함수에서 수행하지 않는다.
    pub fn from_bytes(key_id: impl Into<String>, bytes: &[u8; 32]) -> Self {
        Self {
            signing_key: SigningKey::from_bytes(bytes),
            key_id: key_id.into(),
        }
    }

    /// Client에 배포할 공개 검증키를 반환한다.
    pub fn verifying_key(&self) -> VerifyingKey {
        self.signing_key.verifying_key()
    }

    /// 요청을 검증하고 인증서를 생성한 뒤 서명한다.
    ///
    /// 처리 순서는 `요청 정책 검증 -> 인증서 조립 -> canonicalization ->
    /// Ed25519 서명`이다. 서명 필드는 빈 상태로 payload를 만든 뒤 서명하고,
    /// 결과를 마지막에 인증서에 기록한다.
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

impl Default for VerificationContext {
    fn default() -> Self {
        Self {
            now: "2026-06-01T00:00:00Z".into(),
            product: None,
            version: None,
            device_id: None,
            server_status: None,
            blacklisted: false,
            revoked: false,
            max_chain_depth: 3,
        }
    }
}

impl VerificationContext {
    /// 지정한 시각을 기준으로 기본 검증 Context를 만든다.
    pub fn at(value: impl Into<String>) -> Self {
        Self {
            now: value.into(),
            ..Self::default()
        }
    }
    /// 서버 검증 결과를 설정한다.
    pub fn server(mut self, status: ServerStatus) -> Self {
        self.server_status = Some(status);
        self
    }
    /// 현재 장치 ID를 설정한다.
    pub fn device_id(mut self, value: impl Into<String>) -> Self {
        self.device_id = Some(value.into());
        self
    }
    /// 제품 정책을 설정한다.
    pub fn product(mut self, value: impl Into<String>) -> Self {
        self.product = Some(value.into());
        self
    }
    /// 버전 정책을 설정한다.
    pub fn version(mut self, value: impl Into<String>) -> Self {
        self.version = Some(value.into());
        self
    }
    /// Blacklist 상태를 설정한다.
    pub fn blacklisted(mut self) -> Self {
        self.blacklisted = true;
        self
    }
    /// Revocation 상태를 설정한다.
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

/// 인증서 전체를 검증한다.
///
/// 검증은 다음 순서로 수행된다.
///
/// 1. 체인 깊이와 Schema 버전 확인
/// 2. 서명 알고리즘 및 Ed25519 서명 확인
/// 3. 발급일·만료일 및 제품 정책 확인
/// 4. 등급별 서버 상태와 Device Binding 확인
/// 5. Revocation·Blacklist 확인
/// 6. 모든 하위 인증서 재귀 검증
///
/// 하나라도 실패하면 `Err`를 반환한다. 호출자는 성공한 경우에만 응용
/// 프로그램의 핵심 기능을 활성화해야 한다.
pub fn verify(
    certificate: &Certificate,
    public_key: &VerifyingKey,
    context: &VerificationContext,
) -> Result<(), VerificationError> {
    verify_at_depth(certificate, public_key, context, 0)
}

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

fn check_server(context: &VerificationContext) -> Result<(), VerificationError> {
    match context.server_status {
        None => Err(VerificationError::ServerRequired),
        Some(ServerStatus::Rejected) => Err(VerificationError::ServerRejected),
        Some(ServerStatus::Approved) => Ok(()),
    }
}

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

/// RFC 3339 시간만 허용하여 날짜 비교 기준을 하나로 통일한다.
fn parse_time(value: &str) -> Option<OffsetDateTime> {
    OffsetDateTime::parse(value, &Rfc3339).ok()
}
/// 원본 Device ID를 인증서에 저장하지 않기 위한 파생값을 만든다.
///
/// 해시만으로도 동일 장치 비교는 가능하지만, Hardware ID 자체가 민감한
/// 정보일 수 있으므로 호출자는 입력값과 Metadata를 별도로 보호해야 한다.
fn hash_device_id(value: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(value.as_bytes()))
}
/// 운영체제 난수원으로 인증서 식별자를 생성한다.
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
    device_id: Option<String>,
    server_status: Option<String>,
    #[serde(default)]
    blacklisted: bool,
    #[serde(default)]
    revoked: bool,
    max_chain_depth: Option<usize>,
}

impl FfiVerificationContext {
    /// FFI용 평면 JSON을 내부 검증 Context로 변환한다.
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
            device_id: self.device_id,
            server_status,
            blacklisted: self.blacklisted,
            revoked: self.revoked,
            max_chain_depth: self.max_chain_depth.unwrap_or(3),
        }
    }
}

/// JSON 인증서를 C ABI를 통해 검증한다.
///
/// 반환값 `0`은 요청이 처리되었다는 의미이고, 실제 인증 결과는
/// `result_code`에 기록된다. `-1`은 포인터·길이 오류, `-2`는 JSON 또는
/// 공개키 파싱 오류다. 인증서가 유효하지 않은 경우에도 함수 호출 자체는
/// 성공했으므로 반환값은 `0`, `result_code`는 유효하지 않은 코드가 된다.
///
/// # Safety
/// All non-null pointers must reference readable buffers of the supplied
/// lengths. `result_code` must reference writable memory for one `u32`.
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
}
