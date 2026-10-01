#!/usr/bin/env sh
set -eu

# LicenseGuard C# 자가 테스트 실행 스크립트.
# 사용: ./run.sh

BIND_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CORE_DIR=$(CDPATH= cd -- "$BIND_DIR/../../core" && pwd)
TESTDATA=$(CDPATH= cd -- "$BIND_DIR/../testdata" && pwd)

case "$(uname -s)" in
    Darwin) PLATFORM="macos" ;;
    Linux) PLATFORM="linux" ;;
    MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
    *) printf 'Unsupported host OS: %s\n' "$(uname -s)" >&2; exit 1 ;;
esac
ARCH=$(uname -m)
DIST="$CORE_DIR/dist/${PLATFORM}-${ARCH}"

case "$PLATFORM" in
    macos) LIB_NAME="liblicensehub_core.dylib" ;;
    linux) LIB_NAME="liblicensehub_core.so" ;;
    windows) LIB_NAME="licensehub_core.dll" ;;
esac

if [ ! -f "$DIST/lib/$LIB_NAME" ]; then
    printf 'Native library not found: %s\n' "$DIST/lib/$LIB_NAME" >&2
    printf 'Run core/build.sh first.\n' >&2
    exit 1
fi

# .NET P/Invoke("licensehub_core") 가 플랫폼 네이티브 라이브러리를 찾도록
# 경로를 노출한다.
case "$PLATFORM" in
    macos) export DYLD_LIBRARY_PATH="$DIST/lib:${DYLD_LIBRARY_PATH:-}" ;;
    linux) export LD_LIBRARY_PATH="$DIST/lib:${LD_LIBRARY_PATH:-}" ;;
esac

dotnet run --project "$BIND_DIR" -- "$TESTDATA"