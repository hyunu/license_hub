#!/usr/bin/env python3
"""LicenseGuard Python 자가 테스트.

공용 픽스처(bindings/testdata)를 읽어 L1/L2/L3 유효 인증서와 변조된
인증서를 검증한다.
"""

from __future__ import annotations

import pathlib
import sys

from licenseguard import LicenseGuard, VerificationCode

BASE = pathlib.Path(__file__).resolve().parent.parent / "testdata"


def main() -> int:
    guard = LicenseGuard()
    public_key = (BASE / "public_key.bin").read_bytes()

    checks = [
        ("l1.json", "context_l1.json", VerificationCode.VALID),
        ("l2.json", "context_l2.json", VerificationCode.VALID),
        ("l3.json", "context_l3.json", VerificationCode.VALID),
        ("l1_tampered.json", "context_l1.json", VerificationCode.INVALID_SIGNATURE),
    ]

    fails = 0
    print(f"LicenseGuard Python self-test (fixtures: {BASE})")
    for cert_name, ctx_name, expected in checks:
        result = guard.verify(
            (BASE / cert_name).read_bytes(),
            public_key,
            (BASE / ctx_name).read_bytes(),
        )
        pass_ = result.status == 0 and result.code == expected
        print(
            f"  {cert_name:<18} status={result.status} "
            f"code={result.code} ({VerificationCode.name(result.code)})  "
            f"{'PASS' if pass_ else 'FAIL'}"
        )
        if not pass_:
            fails += 1

    if fails:
        print(f"FAIL ({fails})")
        return 1
    print("ALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())