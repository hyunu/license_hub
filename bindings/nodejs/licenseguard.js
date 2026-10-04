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
        this._verifyTrusted = lib.func(
            'lh_verify_trusted_certificate',
            'int',
            ['uint8_t *', 'size_t', 'uint8_t *', 'size_t', 'uint32_t *']
        );
        this._trustedKey = lib.func(
            'lh_trusted_public_key',
            'int',
            ['uint8_t *', 'size_t *']
        );
        this._decrypt = lib.func(
            'lh_decrypt_license',
            'int',
            ['uint8_t *', 'size_t', 'uint8_t *', 'size_t', 'uint8_t *', 'size_t', 'uint32_t *']
        );
        this._verifyChallenge = lib.func(
            'lh_verify_challenge',
            'int',
            ['uint8_t *', 'size_t', 'uint8_t *', 'size_t', 'uint8_t *', 'size_t']
        );
        this._appId = lib.func(
            'lh_application_id',
            'int',
            ['uint8_t *', 'size_t', 'uint8_t *', 'size_t']
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

    // 코어 내장 신뢰 공개키(K1)로 X(설명 인증서)를 검증한다.
    verifyTrusted(certificate, context) {
        const code = new Uint32Array(1);
        const status = this._verifyTrusted(
            certificate, certificate.length,
            context, context.length,
            code
        );
        return new VerifyResult(status, code[0]);
    }

    // 코어 내장 K1 공개키(32바이트)를 재조립해 반환한다.
    trustedPublicKey() {
        const out = new Uint8Array(32);
        const cap = new BigUint64Array(1);
        cap[0] = 32n;
        const status = this._trustedKey(out, cap);
        if (status !== 0 || Number(cap[0]) !== 32) {
            throw new Error(`trusted_public_key failed: status=${status}`);
        }
        return Buffer.from(out);
    }

    // LH-REQ-008: 암호화 엔벨로프를 Z_Pri로 복호화·검증한다.
    // status=0 성공, -1 인자 오류, -2 파싱/복호화 오류, -3 서명/App 불일치.
    decryptLicense(envelope, zPrivateKey, lhPublicKey) {
        const code = new Uint32Array(1);
        const status = this._decrypt(
            envelope, envelope.length,
            zPrivateKey, zPrivateKey.length,
            lhPublicKey, lhPublicKey.length,
            code
        );
        return new VerifyResult(status, code[0]);
    }

    // LH-REQ-012: Challenge-Response 서명을 검증한다.
    // 0 성공, -1 인자 오류, -2 파싱 오류, 1 서명 불일치.
    verifyChallenge(zPublicKey, challengeJson, signatureB64) {
        return this._verifyChallenge(
            zPublicKey, zPublicKey.length,
            challengeJson, challengeJson.length,
            signatureB64, signatureB64.length
        );
    }

    // LH-REQ-013: Application 공개키에서 Application ID(SHA-256)를 파생한다.
    applicationId(zPublicKey) {
        const out = new Uint8Array(64);
        const status = this._appId(zPublicKey, zPublicKey.length, out, out.length);
        if (status !== 0) {
            throw new Error(`application_id failed: status=${status}`);
        }
        let len = 0;
        while (len < out.length && out[len] !== 0) len++;
        return Buffer.from(out.subarray(0, len)).toString('ascii');
    }
}

module.exports = { LicenseGuard, VerificationCode };