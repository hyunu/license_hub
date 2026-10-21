using System;
using System.Runtime.InteropServices;
using System.Text;

namespace LicenseHub.LicenseGuard
{
    /// <summary>Core 의 enum lh_verification_code 와 동일한 값.</summary>
    public enum VerificationCode : uint
    {
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
    }

    /// <summary>검증 결과.</summary>
    public readonly struct VerifyResult
    {
        public VerifyResult(int status, uint code)
        {
            Status = status;
            Code = code;
        }

        /// <summary>0=요청 처리 성공, 그 외는 인자/파싱/서명 오류.</summary>
        public int Status { get; }

        /// <summary>enum lh_verification_code.</summary>
        public uint Code { get; }

        public bool Valid => Status == 0 && Code == (uint)VerificationCode.Valid;

        public override string ToString() =>
            $"VerifyResult(status={Status}, code={Code}, name={(VerificationCode)Code})";
    }

    /// <summary>
    /// LicenseGuard 검증 모듈의 C# 바인딩.
    /// 네이티브 라이브러리는 NuGet 패키지의 runtimes/&lt;rid&gt;/native/ 에서 로드된다.
    /// </summary>
    public static class LicenseGuard
    {
        private const string Lib = "licensehub_core";

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl, EntryPoint = "lh_verify_certificate")]
        private static extern int VerifyCertificateNative(
            byte[] certificate, UIntPtr certificateLen,
            byte[] publicKey, UIntPtr publicKeyLen,
            byte[] context, UIntPtr contextLen,
            out uint resultCode);

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl, EntryPoint = "lh_decrypt_verify_trusted_license")]
        private static extern int DecryptVerifyNative(
            byte[] envelope, UIntPtr envelopeLen,
            byte[] appPrivateKey, UIntPtr appPrivateKeyLen,
            byte[] context, UIntPtr contextLen,
            out uint resultCode);

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl, EntryPoint = "lh_decrypt_verify_trusted_license_online")]
        private static extern int DecryptVerifyOnlineNative(
            byte[] envelope, UIntPtr envelopeLen,
            byte[] appPrivateKey, UIntPtr appPrivateKeyLen,
            byte[] context, UIntPtr contextLen,
            out uint resultCode);

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl, EntryPoint = "lh_decrypt_license")]
        private static extern int DecryptLicenseNative(
            byte[] envelope, UIntPtr envelopeLen,
            byte[] appPrivateKey, UIntPtr appPrivateKeyLen,
            byte[] lhPublicKey, UIntPtr lhPublicKeyLen,
            out uint resultCode);

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl, EntryPoint = "lh_application_id")]
        private static extern int ApplicationIdNative(
            byte[] publicKey, UIntPtr publicKeyLen,
            byte[] output, UIntPtr outputLen);

        /// <summary>인증서 JSON + Ed25519 공개키(32바이트) + Context JSON(저수준).</summary>
        public static VerifyResult VerifyCertificate(byte[] certificate, byte[] publicKey, byte[] contextJson)
        {
            uint code;
            int status = VerifyCertificateNative(
                certificate, (UIntPtr)certificate.Length,
                publicKey, (UIntPtr)publicKey.Length,
                contextJson, (UIntPtr)contextJson.Length,
                out code);
            return new VerifyResult(status, code);
        }

        /// <summary>저수준: 호출자가 제공한 LH 공개키로 엔벨로프를 복호화·검증한다(테스트/도구용).</summary>
        public static VerifyResult DecryptLicense(byte[] envelope, byte[] appPrivateKey, byte[] lhPublicKey)
        {
            if (appPrivateKey.Length != 32)
                throw new ArgumentException("appPrivateKey must be 32 raw bytes", nameof(appPrivateKey));
            uint code;
            int status = DecryptLicenseNative(
                envelope, (UIntPtr)envelope.Length,
                appPrivateKey, (UIntPtr)appPrivateKey.Length,
                lhPublicKey, (UIntPtr)lhPublicKey.Length,
                out code);
            return new VerifyResult(status, code);
        }

        /// <summary>암호화 라이선스 + App 개인키(32바이트) + Context JSON (L1).</summary>
        public static VerifyResult DecryptVerifyTrustedLicense(byte[] envelope, byte[] appPrivateKey, byte[] contextJson)
        {
            if (appPrivateKey.Length != 32)
                throw new ArgumentException("appPrivateKey must be 32 raw bytes", nameof(appPrivateKey));
            uint code;
            int status = DecryptVerifyNative(
                envelope, (UIntPtr)envelope.Length,
                appPrivateKey, (UIntPtr)appPrivateKey.Length,
                contextJson, (UIntPtr)contextJson.Length,
                out code);
            return new VerifyResult(status, code);
        }

        /// <summary>L2: 복호화·서명 검증 후 인증서의 verification_url 로 상태를 확인한다.</summary>
        public static VerifyResult DecryptVerifyTrustedLicenseOnline(byte[] envelope, byte[] appPrivateKey, byte[] contextJson)
        {
            if (appPrivateKey.Length != 32)
                throw new ArgumentException("appPrivateKey must be 32 raw bytes", nameof(appPrivateKey));
            uint code;
            int status = DecryptVerifyOnlineNative(
                envelope, (UIntPtr)envelope.Length,
                appPrivateKey, (UIntPtr)appPrivateKey.Length,
                contextJson, (UIntPtr)contextJson.Length,
                out code);
            return new VerifyResult(status, code);
        }

        public static VerifyResult DecryptVerifyTrustedLicense(byte[] envelope, byte[] appPrivateKey, string contextJson) =>
            DecryptVerifyTrustedLicense(envelope, appPrivateKey, Encoding.UTF8.GetBytes(contextJson));

        public static VerifyResult DecryptVerifyTrustedLicenseOnline(byte[] envelope, byte[] appPrivateKey, string contextJson) =>
            DecryptVerifyTrustedLicenseOnline(envelope, appPrivateKey, Encoding.UTF8.GetBytes(contextJson));

        /// <summary>응용 공개키(32바이트)에서 애플리케이션 식별자를 계산한다.</summary>
        public static string GetApplicationId(byte[] publicKey)
        {
            if (publicKey.Length != 32)
                throw new ArgumentException("publicKey must be 32 raw bytes", nameof(publicKey));

            var output = new byte[64];
            int status = ApplicationIdNative(
                publicKey, (UIntPtr)publicKey.Length,
                output, (UIntPtr)output.Length);
            if (status != 0)
                throw new InvalidOperationException($"lh_application_id failed: {status}");

            int end = Array.IndexOf(output, (byte)0);
            if (end < 0) end = output.Length;
            return Encoding.ASCII.GetString(output, 0, end);
        }
    }
}
