#!/usr/bin/env sh
set -eu

# LicenseHub 배포용 검증 라이브러리 패키지 생성 스크립트.
#
# 1) core/build.sh 로 네이티브 라이브러리 빌드
# 2) C / Rust 배포 패키지를 distribute/ 아래에 생성
#    - c/  : 헤더 + 정적/공유 라이브러리 (플랫폼별) + 예제
#    - rust/: 게시 안내
#
# 사용: ./package.sh

PKG_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$PKG_DIR/.." && pwd)
DIST="$ROOT/distribute"
CORE_DIR="$ROOT/core"

lib_name() {
    case "$1" in
        macos-*) echo "liblicensehub_core.dylib" ;;
        linux-*) echo "liblicensehub_core.so" ;;
        windows-*) echo "licensehub_core.dll" ;;
        *) printf 'UNKNOWN\n' >&2; exit 1 ;;
    esac
}

# ---- 1. 네이티브 라이브러리 빌드 ----
printf '== Native build ==\n'
"$CORE_DIR/build.sh" >/dev/null

rm -rf "$DIST"
mkdir -p "$DIST"

PLATFORMS=$(find "$CORE_DIR/dist" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort)
if [ -z "$PLATFORMS" ]; then
    printf 'No native artifacts found in core/dist. Run core/build.sh first.\n' >&2
    exit 1
fi
printf 'Platforms available: %s\n\n' "$PLATFORMS"

# ---- 2. C 패키지 ----
printf '== C ==\n'
C_OUT="$DIST/c"
mkdir -p "$C_OUT/include" "$C_OUT/examples"
cp "$CORE_DIR/include/licensehub_core.h" "$C_OUT/include/"
cp "$PKG_DIR/c/verify_example.c" "$C_OUT/examples/"
for p in $PLATFORMS; do
    mkdir -p "$C_OUT/lib/$p"
    cp "$CORE_DIR/dist/$p/lib/"* "$C_OUT/lib/$p/"
done

# ---- 3. Rust 안내 ----
printf '== Rust ==\n'
mkdir -p "$DIST/rust"
cp "$PKG_DIR/rust/README.md" "$DIST/rust/"

printf '\nDistribution packages created under: %s\n' "$DIST"
find "$DIST" -maxdepth 2 -type f | sed "s|^$ROOT/||" | sort