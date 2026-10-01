// LicenseGuard C++ 헤더 전용 래퍼.
//
// 하단의 C API(lh_verify_certificate)를 C++ 타입으로 감싸 호출 편의를
// 제공한다. 라이선스는 검증만 수행하며, 발급·개인키 기능은 포함하지 않는다.
//
// 사용: 아래 헤더를 include 하고 링크 시 네이티브 라이브러리를 연결한다.
//   g++ app.cpp -I<core/dist/*/include> <core/dist/*/lib/liblicensehub_core.a>

#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "licensehub_core.h"

namespace licensehub {

// lh_verify_certificate 의 검증 결과 코드. core/include/licensehub_core.h 의
// enum과 동일한 값을 유지해야 한다.
enum class VerificationCode : uint32_t {
    Valid = 0,
    InvalidFormat = 1,
    UnsupportedSchema = 2,
    UnsupportedAlgorithm = 3,
    InvalidSignature = 4,
    InvalidMetadata = 5,
    Expired = 6,
    NotYetValid = 7,
    ServerRequired = 8,
    ServerRejected = 9,
    Revoked = 10,
    Blacklisted = 11,
    DeviceMismatch = 12,
    ChainInvalid = 13,
    ChainTooDeep = 14,
    PolicyRejected = 15,
};

// lh_verify_certificate 의 결과.
// status: 0=요청 처리 성공, -1=인자 오류, -2=입력 파싱 오류.
struct VerifyResult {
    int32_t status;
    uint32_t code;

    // 유효한 라이선스인지 여부. 이 값이 true일 때만 기능을 활성화해야 한다.
    bool valid() const { return status == 0 && code == 0; }
    VerificationCode error() const { return static_cast<VerificationCode>(code); }
};

// 배포형 검증 모듈(LicenseGuard)의 C++ 인터페이스.
class LicenseGuard {
public:
    // certificate: 인증서 JSON 바이트
    // public_key: Ed25519 공개키 32바이트
    // context: 검증 환경 JSON (now, server_status, device_id 등)
    static VerifyResult verify(const std::vector<uint8_t> &certificate,
                               const std::vector<uint8_t> &public_key,
                               const std::string &context = "{}") {
        uint32_t code = UINT32_MAX;
        int32_t status = lh_verify_certificate(
            certificate.data(), certificate.size(),
            public_key.data(), public_key.size(),
            reinterpret_cast<const uint8_t *>(context.data()), context.size(),
            &code);
        return {status, code};
    }
};

}  // namespace licensehub