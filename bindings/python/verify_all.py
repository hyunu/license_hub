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

    # LH-REQ-008: 암호화 엔벨로프를 Z_Pri로 복호화.
    env = guard.decrypt_license(
        (BASE / "envelope.json").read_bytes(),
        (BASE / "z_private_key.bin").read_bytes(),
        public_key,
    )
    pass_ = env.status == 0 and env.code == VerificationCode.VALID
    print(f"  {'envelope.json':<18} status={env.status} code={env.code}  "
          f"{'PASS' if pass_ else 'FAIL'}")
    if not pass_:
        fails += 1

    # LH-REQ-012: Challenge-Response 검증.
    chal_status = guard.verify_challenge(
        (BASE / "z_public_key.bin").read_bytes(),
        (BASE / "challenge.json").read_bytes(),
        (BASE / "challenge_signature.b64").read_bytes(),
    )
    pass_ = chal_status == 0
    print(f"  {'challenge':<18} status={chal_status}  {'PASS' if pass_ else 'FAIL'}")
    if not pass_:
        fails += 1

    # LH-REQ-013: Application ID 파생 (SHA-256 → URL-safe Base64, 패딩 없음 43자).
    app_id = guard.application_id((BASE / "z_public_key.bin").read_bytes())
    pass_ = len(app_id) == 43
    print(f"  {'application_id':<18} {app_id}  {'PASS' if pass_ else 'FAIL'}")
    if not pass_:
        fails += 1

    if fails:
        print(f"FAIL ({fails})")
        return 1
    print("ALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())