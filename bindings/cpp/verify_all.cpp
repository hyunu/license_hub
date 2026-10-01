// LicenseGuard C++ 자가 테스트.
//
// 공용 픽스처(bindings/testdata)를 읽어 L1/L2/L3 유효 인증서와 변조된
// 인증서를 검증한다.
// 사용: verify_all <testdata 경로>

#include <fstream>
#include <iostream>
#include <iterator>
#include <string>
#include <vector>

#include "licenseguard.hpp"

static std::vector<uint8_t> read_file(const std::string &path) {
    std::ifstream in(path, std::ios::binary);
    return std::vector<uint8_t>(std::istreambuf_iterator<char>(in),
                                std::istreambuf_iterator<char>());
}

static int verify_pair(const std::string &base, const std::string &cert_name,
                       const std::string &ctx_name,
                       licensehub::VerificationCode expected) {
    auto certificate = read_file(base + "/" + cert_name);
    auto public_key = read_file(base + "/public_key.bin");
    auto context = read_file(base + "/" + ctx_name);
    auto context_str = std::string(context.begin(), context.end());

    auto result = licensehub::LicenseGuard::verify(certificate, public_key, context_str);
    bool pass = result.status == 0 &&
                static_cast<uint32_t>(expected) == result.code;
    std::cout << "  " << cert_name << ": status=" << result.status
              << " code=" << result.code << (pass ? "  PASS" : "  FAIL") << "\n";
    return pass ? 0 : 1;
}

int main(int argc, char **argv) {
    std::string base = (argc > 1) ? argv[1] : "../testdata";
    int fails = 0;

    std::cout << "LicenseGuard C++ self-test (fixtures: " << base << ")\n";
    fails += verify_pair(base, "l1.json", "context_l1.json", licensehub::VerificationCode::Valid);
    fails += verify_pair(base, "l2.json", "context_l2.json", licensehub::VerificationCode::Valid);
    fails += verify_pair(base, "l3.json", "context_l3.json", licensehub::VerificationCode::Valid);
    fails += verify_pair(base, "l1_tampered.json", "context_l1.json", licensehub::VerificationCode::InvalidSignature);

    if (fails != 0) {
        std::cout << "FAIL (" << fails << ")\n";
        return 1;
    }
    std::cout << "ALL PASS\n";
    return 0;
}