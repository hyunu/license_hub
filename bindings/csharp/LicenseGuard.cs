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
    }
}