#!/usr/bin/env sh
set -eu

# LicenseGuard C 자가 테스트 빌드·실행 스크립트.
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

case "$PLATFORM" in
    windows) STATIC_NAME="licensehub_core.lib" ;;
    *) STATIC_NAME="liblicensehub_core.a" ;;
esac

SHARED_LIB="$DIST/lib/${PLATFORM}-${ARCH}/shared/$LIB_NAME"
STATIC_LIB="$DIST/lib/${PLATFORM}-${ARCH}/static/$STATIC_NAME"

if [ -f "$STATIC_LIB" ]; then
    LIB_ARGS="$STATIC_LIB"
    case "$PLATFORM" in
        macos) LIB_ARGS="$LIB_ARGS -framework Security -framework CoreFoundation -liconv" ;;
        linux) LIB_ARGS="$LIB_ARGS -lpthread -ldl -lm" ;;
    esac
    printf 'Linking statically: %s\n' "$STATIC_LIB"
elif [ -f "$SHARED_LIB" ]; then
    LIB_ARGS="$SHARED_LIB"
    printf 'Linking shared: %s\n' "$SHARED_LIB"
else
    printf 'Native library not found under %s\n' "$DIST/lib" >&2
    printf 'Run core/build.sh first.\n' >&2
    exit 1
fi

# shellcheck disable=SC2086
cc "$BIND_DIR/verify_all.c" \
    -I"$DIST/include" \
    $LIB_ARGS \
    -o "$BIND_DIR/verify_all"

"$BIND_DIR/verify_all" "$TESTDATA"