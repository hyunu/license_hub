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

        if (fails != 0)
        {
            Console.WriteLine($"FAIL ({fails})");
            return 1;
        }
        Console.WriteLine("ALL PASS");
        return 0;
    }
}