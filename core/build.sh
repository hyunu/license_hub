#!/usr/bin/env sh
set -eu

# Cargo decides the native library extension from the compilation target.
# This script only collects those Cargo outputs into a predictable package.
CORE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGET_DIR="$CORE_DIR/target/release"

case "$(uname -s)" in
    Darwin) PLATFORM="macos" ;;
    Linux) PLATFORM="linux" ;;
    MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
    *)
        printf '%s\n' "Unsupported host OS: $(uname -s)" >&2
        exit 1
        ;;
esac

ARCH=$(uname -m)
DIST_DIR="$CORE_DIR/dist/${PLATFORM}-${ARCH}"
LIB_DIR="$DIST_DIR/lib"
INCLUDE_DIR="$DIST_DIR/include"

cargo build --manifest-path "$CORE_DIR/Cargo.toml" --release --features online

rm -rf "$DIST_DIR"
mkdir -p "$LIB_DIR" "$INCLUDE_DIR"

copy_if_exists() {
    SOURCE="$1"
    if [ -f "$SOURCE" ]; then
        cp "$SOURCE" "$LIB_DIR/"
    fi
}

case "$PLATFORM" in
    macos)
        copy_if_exists "$TARGET_DIR/liblicensehub_core.dylib"
        copy_if_exists "$TARGET_DIR/liblicensehub_core.a"
        ;;
    linux)
        copy_if_exists "$TARGET_DIR/liblicensehub_core.so"
        copy_if_exists "$TARGET_DIR/liblicensehub_core.a"
        ;;
    windows)
        copy_if_exists "$TARGET_DIR/licensehub_core.dll"
        copy_if_exists "$TARGET_DIR/licensehub_core.dll.lib"
        copy_if_exists "$TARGET_DIR/licensehub_core.lib"
        ;;
esac

cp "$CORE_DIR/include/licensehub_core.h" "$INCLUDE_DIR/"
printf 'Built LicenseHub Core for %s-%s\n' "$PLATFORM" "$ARCH"
printf 'Artifacts: %s\n' "$DIST_DIR"
