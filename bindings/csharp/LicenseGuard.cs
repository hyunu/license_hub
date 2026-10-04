using System;
using System.Runtime.InteropServices;

namespace LicenseHub
{
    // lh_verify_certificate 의 검증 결과 코드.
    // core/include/licensehub_core.h 의 enum과 동일한 값을 유지해야 한다.
    public static class VerificationCode
    {
        public const uint Valid = 0;
        public const uint InvalidFormat = 1;
        public const uint UnsupportedSchema = 2;
        public const uint UnsupportedAlgorithm = 3;
        public const uint InvalidSignature = 4;
        public const uint InvalidMetadata = 5;
        public const uint Expired = 6;
        public const uint NotYetValid = 7;
        public const uint ServerRequired = 8;
        public const uint ServerRejected = 9;
        public const uint Revoked = 10;
        public const uint Blacklisted = 11;
        public const uint DeviceMismatch = 12;
        public const uint ChainInvalid = 13;
        public const uint ChainTooDeep = 14;
        public const uint PolicyRejected = 15;

        public static string Name(uint code) => code switch
        {
            Valid => "VALID",
            InvalidFormat => "INVALID_FORMAT",
            UnsupportedSchema => "UNSUPPORTED_SCHEMA",
            UnsupportedAlgorithm => "UNSUPPORTED_ALGORITHM",
            InvalidSignature => "INVALID_SIGNATURE",
            InvalidMetadata => "INVALID_METADATA",
            Expired => "EXPIRED",
            NotYetValid => "NOT_YET_VALID",
            ServerRequired => "SERVER_REQUIRED",
            ServerRejected => "SERVER_REJECTED",
            Revoked => "REVOKED",
            Blacklisted => "BLACKLISTED",
            DeviceMismatch => "DEVICE_MISMATCH",
            ChainInvalid => "CHAIN_INVALID",
            ChainTooDeep => "CHAIN_TOO_DEEP",
            PolicyRejected => "POLICY_REJECTED",
            _ => "UNKNOWN",
        };
    }

    // lh_verify_certificate 의 결과.
    // Status: 0=요청 처리 성공, -1=인자 오류, -2=입력 파싱 오류.
    public readonly record struct VerifyResult(int Status, uint Code)
    {
        public bool Valid => Status == 0 && Code == VerificationCode.Valid;
    }

    // 배포형 검증 모듈(LicenseGuard)의 C# 인터페이스.
    public static class LicenseGuard
    {
        // DllImport("licensehub_core") 는 플랫폼별로
        //   macOS: liblicensehub_core.dylib
        //   Linux: liblicensehub_core.so
        //   Windows: licensehub_core.dll
        // 을 자동으로 찾는다.
        [DllImport("licensehub_core", CallingConvention = CallingConvention.Cdecl)]
        private static extern int lh_verify_certificate(
            byte[] certificate,
            nuint certificateLen,
            byte[] publicKey,
            nuint publicKeyLen,
            byte[] context,
            nuint contextLen,
            out uint resultCode);

        [DllImport("licensehub_core", CallingConvention = CallingConvention.Cdecl)]
        private static extern int lh_verify_trusted_certificate(
            byte[] certificate,
            nuint certificateLen,
            byte[] context,
            nuint contextLen,
            out uint resultCode);

        [DllImport("licensehub_core", CallingConvention = CallingConvention.Cdecl)]
        private static extern int lh_trusted_public_key(byte[] outKey, ref nuint outLen);

        [DllImport("licensehub_core", CallingConvention = CallingConvention.Cdecl)]
        private static extern int lh_decrypt_license(
            byte[] envelope,
            nuint envelopeLen,
            byte[] zPrivateKey,
            nuint zPrivateKeyLen,
            byte[] lhPublicKey,
            nuint lhPublicKeyLen,
            out uint resultCode);

        [DllImport("licensehub_core", CallingConvention = CallingConvention.Cdecl)]
        private static extern int lh_verify_challenge(
            byte[] zPublicKey,
            nuint zPublicKeyLen,
            byte[] challenge,
            nuint challengeLen,
            byte[] signatureB64,
            nuint signatureB64Len);

        [DllImport("licensehub_core", CallingConvention = CallingConvention.Cdecl)]
        private static extern int lh_application_id(
            byte[] zPublicKey,
            nuint zPublicKeyLen,
            byte[] outKey,
            nuint outLen);

        public static VerifyResult Verify(byte[] certificate, byte[] publicKey, byte[] context)
        {
            uint code;
            int status = lh_verify_certificate(
                certificate, (nuint)certificate.Length,
                publicKey, (nuint)publicKey.Length,
                context, (nuint)context.Length,
                out code);
            return new VerifyResult(status, code);
        }

        // 코어 내장 신뢰 공개키(K1)로 X(설명 인증서)를 검증한다.
        public static VerifyResult VerifyTrusted(byte[] certificate, byte[] context)
        {
            uint code;
            int status = lh_verify_trusted_certificate(
                certificate, (nuint)certificate.Length,
                context, (nuint)context.Length,
                out code);
            return new VerifyResult(status, code);
        }

        // 코어 내장 K1 공개키(32바이트)를 재조립해 반환한다.
        public static byte[] TrustedPublicKey()
        {
            byte[] outKey = new byte[32];
            nuint len = 32;
            int status = lh_trusted_public_key(outKey, ref len);
            if (status != 0 || len != 32)
            {
                throw new InvalidOperationException($"trusted_public_key failed: status={status}");
            }
            return outKey;
        }

        // LH-REQ-008: 암호화 엔벨로프를 Z_Pri로 복호화·검증한다.
        // Status=0 성공, -1 인자 오류, -2 파싱/복호화 오류, -3 서명/App 불일치.
        public static VerifyResult DecryptLicense(byte[] envelope, byte[] zPrivateKey, byte[] lhPublicKey)
        {
            uint code;
            int status = lh_decrypt_license(
                envelope, (nuint)envelope.Length,
                zPrivateKey, (nuint)zPrivateKey.Length,
                lhPublicKey, (nuint)lhPublicKey.Length,
                out code);
            return new VerifyResult(status, code);
        }

        // LH-REQ-012: Challenge-Response 서명을 검증한다.
        // 0 성공, -1 인자 오류, -2 파싱 오류, 1 서명 불일치.
        public static int VerifyChallenge(byte[] zPublicKey, byte[] challenge, byte[] signatureB64)
        {
            return lh_verify_challenge(
                zPublicKey, (nuint)zPublicKey.Length,
                challenge, (nuint)challenge.Length,
                signatureB64, (nuint)signatureB64.Length);
        }

        // LH-REQ-013: Application 공개키에서 Application ID(SHA-256)를 파생한다.
        public static string ApplicationId(byte[] zPublicKey)
        {
            byte[] outKey = new byte[64];
            int status = lh_application_id(zPublicKey, (nuint)zPublicKey.Length, outKey, (nuint)outKey.Length);
            if (status != 0)
            {
                throw new InvalidOperationException($"application_id failed: status={status}");
            }
            int len = Array.IndexOf(outKey, (byte)0);
            return System.Text.Encoding.ASCII.GetString(outKey, 0, len >= 0 ? len : outKey.Length);
        }
    }
}