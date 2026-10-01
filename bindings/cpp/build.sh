#!/usr/bin/env sh
set -eu

# LicenseGuard C++ 자가 테스트 빌드·실행 스크립트.
# 사용: ./build.sh

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

c++ -std=c++17 "$BIND_DIR/verify_all.cpp" \
    -I"$DIST/include" \
    "$DIST/lib/$LIB_NAME" \
    -o "$BIND_DIR/verify_all"

"$BIND_DIR/verify_all" "$TESTDATA"