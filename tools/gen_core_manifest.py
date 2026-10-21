#!/usr/bin/env python3
"""C SDK 매니페스트(licensehub-core-manifest.json)를 생성한다.

에이전트는 이 파일 하나로 다음을 알 수 있다.

  - 어떤 플랫폼 키가 있는지 (`macos-arm64`, `linux-x86_64`, ...)
  - 각 플랫폼의 정적/공유 라이브러리 경로와 SHA-256, 크기
  - pkg-config 라이브러리 이름과 CMake 타깃 이름
  - 검증 코드 값(헤더 enum)

표준 라이브러리만 사용한다.

사용법:
    python3 tools/gen_core_manifest.py \
        --sdk dist/c --version 0.1.0 \
        --out licensehub-core-manifest.json \
        --repository hyunu/license_hub
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import sys
from typing import Any, Dict, Optional

MANIFEST_SCHEMA_VERSION = 1


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def describe(path: pathlib.Path, sdk: pathlib.Path) -> Dict[str, Any]:
    """파일 하나를 상대 경로 + 해시 + 크기로 기술한다."""
    return {
        "path": path.relative_to(sdk).as_posix(),
        "sha256": sha256_file(path),
        "size": path.stat().st_size,
    }


def parse_verification_codes(header: pathlib.Path) -> Dict[str, int]:
    text = header.read_text(encoding="utf-8")
    match = re.search(
        r"enum\s+lh_verification_code\s*\{(?P<body>.*?)\}", text, re.DOTALL
    )
    if not match:
        raise SystemExit(f"{header}: enum lh_verification_code 를 찾지 못했습니다")

    codes: Dict[str, int] = {}
    for line in match.group("body").splitlines():
        line = line.split("//")[0].strip()
        if "=" not in line:
            continue
        name, _, value = line.partition("=")
        name = name.strip().rstrip(",")
        value = value.strip().rstrip(",")
        if not name.startswith("LH_") or not value.isdigit():
            continue
        codes[name[len("LH_") :].lower()] = int(value)
    if not codes:
        raise SystemExit(f"{header}: enum 이 비어 있습니다")
    return codes


def primary_rank(path: pathlib.Path) -> int:
    """링커가 실제로 쓰는 파일을 먼저 고르기 위한 정렬 키."""
    suffix = path.suffix.lower()
    order = {".dll": 0, ".dylib": 0, ".so": 0, ".a": 0, ".lib": 1, ".dll.lib": 2}
    return order.get(suffix, 3)


def collect_platforms(sdk: pathlib.Path) -> Dict[str, Dict[str, Any]]:
    libdir = sdk / "lib"
    if not libdir.is_dir():
        raise SystemExit(f"{libdir}: lib 디렉터리가 없습니다")

    platforms: Dict[str, Dict[str, Any]] = {}
    for platform_dir in sorted(p for p in libdir.iterdir() if p.is_dir()):
        key = platform_dir.name
        entry: Dict[str, Any] = {"shared": None, "static": None, "pkgconfig": {}}

        for kind in ("shared", "static"):
            kind_dir = platform_dir / kind
            if not kind_dir.is_dir():
                continue
            paths = sorted(
                (p for p in kind_dir.iterdir() if p.is_file()),
                key=lambda p: (primary_rank(p), p.name),
            )
            if not paths:
                continue
            # path/sha256/size 는 링커가 쓰는 주 파일, files 는 전부.
            entry[kind] = describe(paths[0], sdk)
            entry[kind]["files"] = [describe(path, sdk) for path in paths]

        pc_dir = platform_dir / "pkgconfig"
        if pc_dir.is_dir():
            for pc in sorted(pc_dir.glob("*.pc")):
                name = pc.stem
                kind = "static" if "static" in name else "shared"
                entry["pkgconfig"][kind] = name

        platforms[key] = entry

    if not platforms:
        raise SystemExit(f"{libdir}: 플랫폼 디렉터리가 없습니다")
    return platforms


def build_manifest(
    sdk: pathlib.Path, version: str, repository: Optional[str]
) -> Dict[str, Any]:
    header = sdk / "include" / "licensehub_core.h"
    if not header.is_file():
        raise SystemExit(f"{header}: 헤더가 없습니다")

    manifest: Dict[str, Any] = {
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "version": version,
        "header": describe(header, sdk),
        "verification_codes": parse_verification_codes(header),
        "platforms": collect_platforms(sdk),
        "cmake": {
            "package": "LicenseHubCore",
            "path": "share/cmake/LicenseHubCore",
            "targets": {
                "shared": "LicenseHubCore::LicenseHubCore",
                "static": "LicenseHubCore::LicenseHubCoreStatic",
            },
        },
        "pkgconfig": {
            "search_path": "lib/<platform>/pkgconfig",
            "shared": "licensehub_core",
            "static": "licensehub_core_static",
        },
        "usage": {
            "verify": (
                "lh_decrypt_verify_trusted_license(license, license_len, "
                "app_private_key_raw32, 32, context_json, context_json_len, &code)"
            ),
            "verify_online": (
                "lh_decrypt_verify_trusted_license_online(license, license_len, "
                "app_private_key_raw32, 32, context_json, context_json_len, &code)"
            ),
            "success": "status == 0 && code == LH_VALID(0)",
        },
    }

    cmake_dir = sdk / "share" / "cmake" / "LicenseHubCore"
    if cmake_dir.is_dir():
        manifest["cmake"]["files"] = [
            describe(path, sdk) for path in sorted(cmake_dir.iterdir()) if path.is_file()
        ]

    if repository:
        tag = f"v{version}"
        asset = f"licensehub-core-{version}.zip"
        manifest["release"] = {
            "tag": tag,
            "c_sdk_asset": asset,
            "url": f"https://github.com/{repository}/releases/download/{tag}/{asset}",
        }

    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sdk", required=True, help="C SDK 루트 (dist/c)")
    parser.add_argument("--version", required=True, help="예: 0.1.0")
    parser.add_argument("--out", required=True, help="출력 경로")
    parser.add_argument(
        "--repository",
        default=None,
        help="owner/repo (있으면 릴리스 다운로드 URL 을 넣는다)",
    )
    parser.add_argument(
        "--also-inside-sdk",
        action="store_true",
        help="SDK 루트에도 매니페스트를 복사한다(배포 zip 안에 포함)",
    )
    args = parser.parse_args()

    sdk = pathlib.Path(args.sdk).resolve()
    manifest = build_manifest(sdk, args.version, args.repository)

    out = pathlib.Path(args.out)
    text = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
    out.write_text(text, encoding="utf-8")

    if args.also_inside_sdk:
        (sdk / "licensehub-core-manifest.json").write_text(text, encoding="utf-8")

    print(
        f"manifest: {out} "
        f"({len(manifest['platforms'])} platforms, version {args.version})"
    )
    for key, entry in manifest["platforms"].items():
        shared = (entry.get("shared") or {}).get("path", "-")
        static = (entry.get("static") or {}).get("path", "-")
        print(f"  {key:<16} shared={shared} static={static}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
