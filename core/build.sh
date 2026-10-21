#!/usr/bin/env sh
set -eu

# Cargo decides the native library extension from the compilation target.
# This script only collects those Cargo outputs into a predictable package.
#
# The layout is identical to the released C SDK, so code written against a
# local build keeps working against a release artifact:
#
#   core/dist/<os>-<arch>/
#     include/licensehub_core.h
#     lib/<os>-<arch>/shared/<shared library>
#     lib/<os>-<arch>/static/<static library>
#     lib/<os>-<arch>/pkgconfig/licensehub_core.pc
#     share/cmake/LicenseHubCore/LicenseHubCoreConfig.cmake
#
# The <os>-<arch> directory under lib/ is what lets a single SDK hold
# several platforms side by side.
#
CORE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGET_DIR="$CORE_DIR/target/release"
PACKAGING_DIR="$CORE_DIR/../packaging/c"

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
KEY="${PLATFORM}-${ARCH}"
DIST_DIR="$CORE_DIR/dist/${KEY}"
PLAT_LIB_DIR="$DIST_DIR/lib/${KEY}"
INCLUDE_DIR="$DIST_DIR/include"
CMAKE_DIR="$DIST_DIR/share/cmake/LicenseHubCore"

cargo build --manifest-path "$CORE_DIR/Cargo.toml" --release --features online

rm -rf "$DIST_DIR"
mkdir -p "$PLAT_LIB_DIR/shared" "$PLAT_LIB_DIR/static" "$PLAT_LIB_DIR/pkgconfig" \
    "$INCLUDE_DIR" "$CMAKE_DIR"

copy_if_exists() {
    SOURCE="$1"
    DEST="$2"
    if [ -f "$SOURCE" ]; then
        cp "$SOURCE" "$DEST/"
    fi
}

case "$PLATFORM" in
    macos)
        copy_if_exists "$TARGET_DIR/liblicensehub_core.dylib" "$PLAT_LIB_DIR/shared"
        copy_if_exists "$TARGET_DIR/liblicensehub_core.a" "$PLAT_LIB_DIR/static"
        ;;
    linux)
        copy_if_exists "$TARGET_DIR/liblicensehub_core.so" "$PLAT_LIB_DIR/shared"
        copy_if_exists "$TARGET_DIR/liblicensehub_core.a" "$PLAT_LIB_DIR/static"
        ;;
    windows)
        copy_if_exists "$TARGET_DIR/licensehub_core.dll" "$PLAT_LIB_DIR/shared"
        copy_if_exists "$TARGET_DIR/licensehub_core.dll.lib" "$PLAT_LIB_DIR/shared"
        copy_if_exists "$TARGET_DIR/licensehub_core.lib" "$PLAT_LIB_DIR/static"
        ;;
esac

cp "$CORE_DIR/include/licensehub_core.h" "$INCLUDE_DIR/"
cp "$PACKAGING_DIR/cmake/LicenseHubCoreConfig.cmake" "$CMAKE_DIR/"
cp "$PACKAGING_DIR/cmake/LicenseHubCoreConfigVersion.cmake" "$CMAKE_DIR/"

# 배포 산출물과 같은 형태(pkg-config)를 로컬에도 만든다.
sh "$PACKAGING_DIR/make_pkgconfig.sh" "$KEY" "0.1.0" "$PLAT_LIB_DIR/pkgconfig"

printf 'Built LicenseHub Core for %s\n' "$KEY"
printf 'Artifacts: %s\n' "$DIST_DIR"
