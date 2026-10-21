"""LicenseGuard Python 바인딩 자체 검사.

네이티브 라이브러리가 없어도 실행 가능해야 한다(코드 계약만 검증).
"""

from __future__ import annotations

import pathlib
import re
import sys
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "bindings" / "python"))

from licensehub_licenseguard import VerificationCode  # noqa: E402

HEADER_PATH = REPO_ROOT / "core" / "include" / "licensehub_core.h"


def header_codes() -> dict:
    """헤더의 enum lh_verification_code 를 {이름: 값} 으로 읽는다."""
    text = HEADER_PATH.read_text(encoding="utf-8")
    match = re.search(
        r"enum\s+lh_verification_code\s*\{(?P<body>.*?)\}", text, re.DOTALL
    )
    assert match, "헤더에서 enum lh_verification_code 를 찾지 못했습니다"
    codes = {}
    for line in match.group("body").splitlines():
        line = line.split("//")[0].strip()
        if "=" not in line:
            continue
        name, _, value = line.partition("=")
        name = name.strip().rstrip(",")
        value = value.strip().rstrip(",")
        if name.isidentifier() and value.isdigit():
            codes[name] = int(value)
    return codes


class VerificationCodeContractTest(unittest.TestCase):
    def test_codes_match_c_header(self) -> None:
        expected = {
            name[len("LH_") :]: value for name, value in header_codes().items()
        }
        actual = {
            name: value
            for name, value in vars(VerificationCode).items()
            if name.isupper() and isinstance(value, int)
        }
        self.assertEqual(
            actual,
            expected,
            "VerificationCode 가 C 헤더와 다릅니다 "
            "(tools/check_abi_codes.py 로도 확인 가능)",
        )

    def test_valid_is_zero(self) -> None:
        self.assertEqual(VerificationCode.VALID, 0)

    def test_codes_are_contiguous(self) -> None:
        values = sorted(
            value
            for name, value in vars(VerificationCode).items()
            if name.isupper() and isinstance(value, int)
        )
        self.assertEqual(values, list(range(len(values))), "코드가 연속적이지 않습니다")

    def test_names_map_covers_every_code(self) -> None:
        for name, value in vars(VerificationCode).items():
            if not name.isupper() or not isinstance(value, int):
                continue
            self.assertEqual(
                VerificationCode.name(value),
                name,
                f"name({value}) 이 {name} 을 반환하지 않습니다",
            )

    def test_unknown_code_returns_unknown(self) -> None:
        self.assertEqual(VerificationCode.name(9999), "UNKNOWN")


if __name__ == "__main__":
    unittest.main()
