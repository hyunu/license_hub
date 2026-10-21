#!/usr/bin/env python3
"""플랫폼별 네이티브 라이브러리를 번들한 wheel 을 만든다.

예:
  python build_wheel.py --platform macos-arm64 --plat-name macosx_11_0_arm64 \
    --lib ../../core/dist/macos-arm64/lib/macos-arm64/shared/liblicensehub_core.dylib --out dist
"""

import argparse
import pathlib
import shutil
import subprocess
import sys

LIB_NAMES = {
    "macos": "liblicensehub_core.dylib",
    "linux": "liblicensehub_core.so",
    "windows": "licensehub_core.dll",
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--platform", required=True, help="예: macos-arm64, linux-x86_64, windows-x86_64")
    parser.add_argument("--plat-name", required=True, help="wheel 태그, 예: macosx_11_0_arm64")
    parser.add_argument("--lib", required=True, help="네이티브 라이브러리 경로")
    parser.add_argument("--out", default="dist")
    args = parser.parse_args()

    root = pathlib.Path(__file__).resolve().parent
    plat_os = args.platform.split("-", 1)[0]
    if plat_os not in LIB_NAMES:
        raise SystemExit(f"unsupported platform: {args.platform}")

    lib = pathlib.Path(args.lib).resolve()
    if not lib.exists():
        raise SystemExit(f"native library not found: {lib}")

    dest = root / "licensehub_licenseguard" / "native" / args.platform
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copy2(lib, dest / LIB_NAMES[plat_os])

    out = pathlib.Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable,
        "setup.py",
        "bdist_wheel",
        "--plat-name",
        args.plat_name,
        "-d",
        str(out),
    ]
    subprocess.check_call(cmd, cwd=root)
    print(f"wheel written to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
