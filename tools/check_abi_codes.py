#!/usr/bin/env python3
"""검증 코드(verification code) 계약 정합성 검사.

진실 공급원은 core/include/licensehub_core.h 의 enum lh_verification_code 다.
여기서 값이 어긋나면 호출자가 받는 실패 코드가 언어마다 달라지고,
AI 가 작성한 실패 경로 분기가 절대 매칭되지 않는다.

대조 대상:
  1. core/include/licensehub_core.h   (헤더)
  2. core/src/lib.rs                  (verification_code() 매핑)
  3. bindings/python/.../__init__.py  (VerificationCode)
  4. bindings/csharp/LicenseGuard.cs  (VerificationCode)

표준 라이브러리만 사용한다. CI 에서 별도 툴체인 없이 실행할 수 있다.

사용법:
    python3 tools/check_abi_codes.py [-v]
종료 코드: 0 = 일치, 1 = 불일치
"""

from __future__ import annotations

import argparse
import ast
import re
import sys
from pathlib import Path
from typing import Dict, List, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent

HEADER_PATH = REPO_ROOT / "core" / "include" / "licensehub_core.h"
CORE_SOURCE_PATH = REPO_ROOT / "core" / "src" / "lib.rs"
PYTHON_PATH = (
    REPO_ROOT / "bindings" / "python" / "licensehub_licenseguard" / "__init__.py"
)
CSHARP_PATH = REPO_ROOT / "bindings" / "csharp" / "LicenseGuard.cs"


class CheckError(Exception):
    """검사 실패."""


# ---------------------------------------------------------------------------
# 파서
# ---------------------------------------------------------------------------


def parse_header(path: Path) -> Dict[str, int]:
    """enum lh_verification_code 를 {이름: 값} 으로 파싱한다."""
    text = path.read_text(encoding="utf-8")
    match = re.search(
        r"enum\s+lh_verification_code\s*\{(?P<body>.*?)\}", text, re.DOTALL
    )
    if not match:
        raise CheckError(f"{path}: enum lh_verification_code 를 찾지 못했습니다")

    codes: Dict[str, int] = {}
    for line in match.group("body").splitlines():
        line = line.split("//")[0].strip()
        if not line or line.startswith("/*") or line.startswith("*"):
            continue
        if "=" not in line:
            continue
        name, _, value = line.partition("=")
        name = name.strip().rstrip(",")
        value = value.strip().rstrip(",")
        if not name.isidentifier() or not value.isdigit():
            continue
        codes[name] = int(value)
    if not codes:
        raise CheckError(f"{path}: enum 이 비어 있습니다")
    return codes


def parse_core_mapping(path: Path) -> Dict[str, int]:
    """verification_code() 의 매핑을 {변형이름: 값} 으로 파싱한다."""
    text = path.read_text(encoding="utf-8")
    start = text.find("fn verification_code(")
    if start < 0:
        raise CheckError(f"{path}: verification_code() 를 찾지 못했습니다")
    body = text[start:]
    end = body.find("\n}\n")
    if end >= 0:
        body = body[:end]

    arms: Dict[str, int] = {}
    for match in re.finditer(
        r"Err\(VerificationError::(?P<name>\w+)\)\s*=>\s*(?P<value>\d+)", body
    ):
        arms[match.group("name")] = int(match.group("value"))
    if not arms:
        raise CheckError(f"{path}: verification_code() 매핑을 찾지 못했습니다")
    return arms


def parse_python_codes(path: Path) -> Dict[str, int]:
    """VerificationCode 클래스의 정수 상수를 {이름: 값} 으로 파싱한다."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef) or node.name != "VerificationCode":
            continue
        codes: Dict[str, int] = {}
        for item in node.body:
            if not isinstance(item, ast.Assign) or len(item.targets) != 1:
                continue
            target = item.targets[0]
            if not isinstance(target, ast.Name) or not isinstance(item.value, ast.Constant):
                continue
            name = target.id
            value = item.value.value
            if name.startswith("_") or not isinstance(value, int) or isinstance(value, bool):
                continue
            codes[name] = value
        if not codes:
            raise CheckError(f"{path}: VerificationCode 상수를 찾지 못했습니다")
        return codes
    raise CheckError(f"{path}: VerificationCode 클래스를 찾지 못했습니다")


def parse_csharp_codes(path: Path) -> Dict[str, int]:
    """enum VerificationCode 를 {이름: 값} 으로 파싱한다."""
    text = path.read_text(encoding="utf-8")
    match = re.search(
        r"enum\s+VerificationCode\s*:\s*uint\s*\{(?P<body>.*?)\}", text, re.DOTALL
    )
    if not match:
        raise CheckError(f"{path}: enum VerificationCode 를 찾지 못했습니다")

    codes: Dict[str, int] = {}
    for match2 in re.finditer(
        r"^\s*(?P<name>[A-Za-z_]\w*)\s*=\s*(?P<value>\d+)\s*,?\s*$",
        match.group("body"),
        re.MULTILINE,
    ):
        codes[match2.group("name")] = int(match2.group("value"))
    if not codes:
        raise CheckError(f"{path}: enum 이 비어 있습니다")
    return codes


# ---------------------------------------------------------------------------
# 이름 변환
# ---------------------------------------------------------------------------


def screaming_snake(name: str) -> str:
    """CamelCase -> SCREAMING_SNAKE (InvalidFormat -> INVALID_FORMAT)."""
    out: List[str] = []
    prev_lower = False
    for ch in name:
        if ch.isupper() and prev_lower:
            out.append("_")
        prev_lower = ch.islower()
        out.append(ch.upper())
    return "".join(out)


def pascal_case(name: str) -> str:
    """SCREAMING_SNAKE -> PascalCase (INVALID_FORMAT -> InvalidFormat)."""
    return "".join(part.capitalize() for part in name.split("_") if part)


# ---------------------------------------------------------------------------
# 검사
# ---------------------------------------------------------------------------


def check(verbose: bool = False) -> List[str]:
    """불일치 목록을 반환한다. 빈 목록이면 모두 일치."""
    problems: List[str] = []

    header = parse_header(HEADER_PATH)
    core = parse_core_mapping(CORE_SOURCE_PATH)
    python = parse_python_codes(PYTHON_PATH)
    csharp = parse_csharp_codes(CSHARP_PATH)

    # 헤더는 LH_ 접두어를 가진 순수 대문자 이름이어야 한다.
    for name, value in header.items():
        if not name.startswith("LH_"):
            problems.append(f"헤더: {name} 은 LH_ 접두어가 없습니다")
        if value < 0:
            problems.append(f"헤더: {name} 의 값이 음수입니다 ({value})")
    if header.get("LH_VALID") != 0:
        problems.append("헤더: LH_VALID 는 0 이어야 합니다")

    # 헤더 이름 -> 공통 키 (접두어 제거)
    header_by_key = {name[len("LH_") :]: value for name, value in header.items()}

    # 1) 코어 <-> 헤더
    core_by_key = {screaming_snake(name): value for name, value in core.items()}
    for key, value in core_by_key.items():
        if key not in header_by_key:
            problems.append(f"코어: {key} 에 대응하는 헤더 코드가 없습니다")
        elif header_by_key[key] != value:
            problems.append(
                f"코어/헤더 불일치: {key} = 코어 {value} vs 헤더 {header_by_key[key]}"
            )
    for key in header_by_key:
        if key != "VALID" and key not in core_by_key:
            problems.append(f"코어: {key} 에 대응하는 VerificationError 변형이 없습니다")

    # 2) Python <-> 헤더
    for name, value in python.items():
        if name not in header_by_key:
            problems.append(f"Python: {name} 에 대응하는 헤더 코드가 없습니다")
        elif header_by_key[name] != value:
            problems.append(
                f"Python/헤더 불일치: {name} = Python {value} vs 헤더 {header_by_key[name]}"
            )
    for key in header_by_key:
        if key not in python:
            problems.append(f"Python: {key} 코드가 없습니다")

    # 3) C# <-> 헤더
    for name, value in csharp.items():
        key = screaming_snake(name)
        if key not in header_by_key:
            problems.append(f"C#: {name} 에 대응하는 헤더 코드가 없습니다")
        elif header_by_key[key] != value:
            problems.append(
                f"C#/헤더 불일치: {name} = C# {value} vs 헤더 {header_by_key[key]}"
            )
    for key in header_by_key:
        if pascal_case(key) not in csharp:
            problems.append(f"C#: {key} 코드가 없습니다")

    if verbose:
        print(f"{'코드':<28} {'헤더':>6} {'코어':>6} {'Python':>7} {'C#':>4}")
        print("-" * 58)
        for key, hvalue in sorted(header_by_key.items(), key=lambda kv: kv[1]):
            cv = core_by_key.get(key, "-")
            pv = python.get(key, "-")
            sv = csharp.get(pascal_case(key), "-")
            print(f"{key:<28} {hvalue:>6} {cv:>6} {pv:>7} {sv:>4}")

    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-v", "--verbose", action="store_true", help="대조표 출력")
    args = parser.parse_args()

    try:
        problems = check(verbose=args.verbose)
    except CheckError as exc:
        print(f"검사 실패: {exc}", file=sys.stderr)
        return 1

    if problems:
        print("검증 코드 계약이 어긋납니다:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1

    print("검증 코드 계약 일치: 헤더 / 코어 / Python / C#")
    return 0


if __name__ == "__main__":
    sys.exit(main())
