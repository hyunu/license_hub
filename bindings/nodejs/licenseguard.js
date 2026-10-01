'use strict';

const koffi = require('koffi');
const path = require('path');
const os = require('os');

// lh_verify_certificate 의 검증 결과 코드.
// core/include/licensehub_core.h 의 enum과 동일한 값을 유지해야 한다.
const VerificationCode = {
    VALID: 0,
    INVALID_FORMAT: 1,
    UNSUPPORTED_SCHEMA: 2,
    UNSUPPORTED_ALGORITHM: 3,
    INVALID_SIGNATURE: 4,
    INVALID_METADATA: 5,
    EXPIRED: 6,
    NOT_YET_VALID: 7,
    SERVER_REQUIRED: 8,
    SERVER_REJECTED: 9,
    REVOKED: 10,
    BLACKLISTED: 11,
    DEVICE_MISMATCH: 12,
    CHAIN_INVALID: 13,
    CHAIN_TOO_DEEP: 14,
    POLICY_REJECTED: 15,

    name(code) {
        const names = {
            0: 'VALID', 1: 'INVALID_FORMAT', 2: 'UNSUPPORTED_SCHEMA',
            3: 'UNSUPPORTED_ALGORITHM', 4: 'INVALID_SIGNATURE', 5: 'INVALID_METADATA',
            6: 'EXPIRED', 7: 'NOT_YET_VALID', 8: 'SERVER_REQUIRED', 9: 'SERVER_REJECTED',
            10: 'REVOKED', 11: 'BLACKLISTED', 12: 'DEVICE_MISMATCH',
            13: 'CHAIN_INVALID', 14: 'CHAIN_TOO_DEEP', 15: 'POLICY_REJECTED',
        };
        return names[code] || 'UNKNOWN';
    },
};

function defaultLibPath() {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const plat = { darwin: 'macos', linux: 'linux', win32: 'windows' }[process.platform];
    const arch = os.arch();
    const libName = {
        macos: 'liblicensehub_core.dylib',
        linux: 'liblicensehub_core.so',
        windows: 'licensehub_core.dll',
    }[plat];
    return path.join(repoRoot, 'core', 'dist', `${plat}-${arch}`, 'lib', libName);
}

class VerifyResult {
    constructor(status, code) {
        this.status = status;
        this.code = code;
    }
    get valid() {
        return this.status === 0 && this.code === VerificationCode.VALID;
    }
    toString() {
        return `VerifyResult(status=${this.status}, code=${this.code}, name=${VerificationCode.name(this.code)})`;
    }
}

// 배포형 검증 모듈(LicenseGuard)의 Node.js 인터페이스.
class LicenseGuard {
    constructor(libPath) {
        const lib = koffi.load(libPath || defaultLibPath());
        this._verify = lib.func(
            'lh_verify_certificate',
            'int',
            ['uint8_t *', 'size_t', 'uint8_t *', 'size_t', 'uint8_t *', 'size_t', 'uint32_t *']
        );
    }

    // certificate: 인증서 JSON 바이트(Buffer)
    // publicKey: Ed25519 공개키 32바이트(Buffer)
    // context: 검증 Context JSON 바이트(Buffer)
    verify(certificate, publicKey, context) {
        const code = new Uint32Array(1);
        const status = this._verify(
            certificate, certificate.length,
            publicKey, publicKey.length,
            context, context.length,
            code
        );
        return new VerifyResult(status, code[0]);
    }
}

module.exports = { LicenseGuard, VerificationCode };