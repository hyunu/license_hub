using System;
using System.IO;
using LicenseHub;

internal static class Program
{
    private static int Main(string[] args)
    {
        string baseDir = args.Length > 0
            ? args[0]
            : Path.Combine(Directory.GetCurrentDirectory(), "..", "testdata");

        byte[] publicKey = File.ReadAllBytes(Path.Combine(baseDir, "public_key.bin"));

        (string cert, string ctx, uint expected)[] checks =
        {
            ("l1.json", "context_l1.json", VerificationCode.Valid),
            ("l2.json", "context_l2.json", VerificationCode.Valid),
            ("l3.json", "context_l3.json", VerificationCode.Valid),
            ("l1_tampered.json", "context_l1.json", VerificationCode.InvalidSignature),
        };

        int fails = 0;
        Console.WriteLine($"LicenseGuard C# self-test (fixtures: {baseDir})");
        foreach (var (cert, ctx, expected) in checks)
        {
            VerifyResult result = LicenseGuard.Verify(
                File.ReadAllBytes(Path.Combine(baseDir, cert)),
                publicKey,
                File.ReadAllBytes(Path.Combine(baseDir, ctx)));

            bool pass = result.Status == 0 && result.Code == expected;
            Console.WriteLine($"  {cert,-18} status={result.Status} code={result.Code}  {(pass ? "PASS" : "FAIL")}");
            if (!pass) fails++;
        }

        // LH-REQ-008: 암호화 엔벨로프를 Z_Pri로 복호화.
        {
            VerifyResult env = LicenseGuard.DecryptLicense(
                File.ReadAllBytes(Path.Combine(baseDir, "envelope.json")),
                File.ReadAllBytes(Path.Combine(baseDir, "z_private_key.bin")),
                publicKey);
            bool pass = env.Status == 0 && env.Code == VerificationCode.Valid;
            Console.WriteLine($"  {"envelope.json",-18} status={env.Status} code={env.Code}  {(pass ? "PASS" : "FAIL")}");
            if (!pass) fails++;
        }

        // 제품 경로는 내장 LK2를 신뢰하고 별도 test issuer 서명은 거부한다.
        {
            VerifyResult trusted = LicenseGuard.DecryptVerifyTrusted(
                File.ReadAllBytes(Path.Combine(baseDir, "envelope.json")),
                File.ReadAllBytes(Path.Combine(baseDir, "z_private_key.bin")),
                File.ReadAllBytes(Path.Combine(baseDir, "context_l1.json")));
            bool pass = trusted.Status == -3;
            Console.WriteLine($"  embedded_lk2: status={trusted.Status}  {(pass ? "PASS (untrusted fixture rejected)" : "FAIL")}");
            if (!pass) fails++;
        }

        // LH-REQ-012: Challenge-Response 검증.
        {
            int status = LicenseGuard.VerifyChallenge(
                File.ReadAllBytes(Path.Combine(baseDir, "z_public_key.bin")),
                File.ReadAllBytes(Path.Combine(baseDir, "challenge.json")),
                File.ReadAllBytes(Path.Combine(baseDir, "challenge_signature.b64")));
            bool pass = status == 0;
            Console.WriteLine($"  {"challenge",-18} status={status}  {(pass ? "PASS" : "FAIL")}");
            if (!pass) fails++;
        }

        // LH-REQ-013: Application ID 파생.
        {
            string appId = LicenseGuard.ApplicationId(
                File.ReadAllBytes(Path.Combine(baseDir, "z_public_key.bin")));
            bool pass = appId.Length == 43;
            Console.WriteLine($"  {"application_id",-18} {appId}  {(pass ? "PASS" : "FAIL")}");
            if (!pass) fails++;
        }

        if (fails != 0)
        {
            Console.WriteLine($"FAIL ({fails})");
            return 1;
        }
        Console.WriteLine("ALL PASS");
        return 0;
    }
}
