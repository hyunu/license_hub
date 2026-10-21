#!/usr/bin/env sh
set -eu

# LicenseHub 배포용 검증 라이브러리 패키지 생성 스크립트.
#
# 1) core/build.sh 로 네이티브 라이브러리 빌드
# 2) C / Rust 배포 패키지를 distribute/ 아래에 생성
#    - c/  : 헤더 + 정적/공유 라이브러리(플랫폼별) + pkg-config + CMake 설정 + 예제
#    - rust/: 게시 안내
#
# 레이아웃은 릴리스 워크플로(.github/workflows/release-core.yml)가 만드는
# C SDK 와 동일하다.
#
# 사용: ./package.sh

PKG_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$PKG_DIR/.." && pwd)
DIST="$ROOT/distribute"
CORE_DIR="$ROOT/core"

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
mkdir -p "$C_OUT/include" "$C_OUT/examples" "$C_OUT/share/cmake/LicenseHubCore"
cp "$CORE_DIR/include/licensehub_core.h" "$C_OUT/include/"
cp "$PKG_DIR/c/verify_example.c" "$C_OUT/examples/"
cp "$PKG_DIR/c/decrypt_verify_example.c" "$C_OUT/examples/"
cp "$PKG_DIR/c/cmake/LicenseHubCoreConfig.cmake" "$C_OUT/share/cmake/LicenseHubCore/"
cp "$PKG_DIR/c/cmake/LicenseHubCoreConfigVersion.cmake" "$C_OUT/share/cmake/LicenseHubCore/"
for p in $PLATFORMS; do
    SRC="$CORE_DIR/dist/$p"
    mkdir -p "$C_OUT/lib/$p"
    for kind in shared static pkgconfig; do
        if [ -d "$SRC/lib/$p/$kind" ]; then
            cp -r "$SRC/lib/$p/$kind" "$C_OUT/lib/$p/"
        fi
    done
done

# ---- 2b. 매니페스트 ----
if command -v python3 >/dev/null 2>&1; then
    printf '== Manifest ==\n'
    python3 "$ROOT/tools/gen_core_manifest.py" \
        --sdk "$C_OUT" --version "0.1.0" \
        --out "$C_OUT/licensehub-core-manifest.json"
fi

# ---- 3. Rust 안내 ----
printf '== Rust ==\n'
mkdir -p "$DIST/rust"
cp "$PKG_DIR/rust/README.md" "$DIST/rust/"

printf '\nDistribution packages created under: %s\n' "$DIST"
find "$DIST" -maxdepth 3 -type f | sed "s|^$ROOT/||" | sort
