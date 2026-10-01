#!/usr/bin/env sh
set -eu

# LicenseHub 배포용 검증 라이브러리 패키지 생성 스크립트.
#
# 1) core/build.sh 로 네이티브 라이브러리 빌드
# 2) 언어별 배포 패키지를 distribute/ 아래에 생성
#    - cpp/     : 헤더 + 정적/공유 라이브러리 (플랫폼별)
#    - csharp/  : LicenseHub.LicenseGuard NuGet 패키지
#    - python/  : licensehub-licenseguard wheel
#    - nodejs/  : licensehub-node npm tgz
#    - rust/    : 배포 안내
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

rid_for() {
    os=${1%-*}
    arch=${1#*-}
    case "$arch" in
        arm64|aarch64) a="arm64" ;;
        x86_64) a="x64" ;;
        *) a="$arch" ;;
    esac
    case "$os" in
        macos) printf 'osx-%s\n' "$a" ;;
        linux) printf 'linux-%s\n' "$a" ;;
        windows) printf 'win-%s\n' "$a" ;;
        *) printf 'UNKNOWN\n' >&2; exit 1 ;;
    esac
}

plat_name_for() {
    case "$1" in
        macos-arm64) printf 'macosx_11_0_arm64\n' ;;
        macos-x86_64) printf 'macosx_10_9_x86_64\n' ;;
        linux-x86_64) printf 'linux_x86_64\n' ;;
        linux-aarch64) printf 'linux_aarch64\n' ;;
        windows-x86_64) printf 'win_amd64\n' ;;
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

# ---- 2. C/C++ 패키지 ----
printf '== C/C++ ==\n'
CPP="$DIST/cpp"
mkdir -p "$CPP/include" "$CPP/examples"
cp "$CORE_DIR/include/licensehub_core.h" "$CPP/include/"
cp "$ROOT/bindings/cpp/licenseguard.hpp" "$CPP/include/"
cp "$PKG_DIR/cpp/verify_example.c" "$CPP/examples/"
for p in $PLATFORMS; do
    mkdir -p "$CPP/lib/$p"
    cp "$CORE_DIR/dist/$p/lib/"* "$CPP/lib/$p/"
done

# ---- 3. C# NuGet 패키지 ----
printf '== C# ==\n'
RUNTIMES="$PKG_DIR/csharp/runtimes"
rm -rf "$RUNTIMES"
for p in $PLATFORMS; do
    rid=$(rid_for "$p")
    mkdir -p "$RUNTIMES/$rid/native"
    cp "$CORE_DIR/dist/$p/lib/$(lib_name "$p")" "$RUNTIMES/$rid/native/"
done
mkdir -p "$DIST/csharp"
dotnet pack "$PKG_DIR/csharp/LicenseHub.LicenseGuard.csproj" \
    -c Release -o "$DIST/csharp" --nologo -v minimal

# ---- 4. Python wheel (현재 호스트 플랫폼) ----
printf '== Python ==\n'
case "$(uname -s)" in
    Darwin) HOST="macos" ;;
    Linux) HOST="linux" ;;
    MINGW*|MSYS*|CYGWIN*) HOST="windows" ;;
    *) printf 'Unsupported host OS\n' >&2; exit 1 ;;
esac
HOST_PLAT="$HOST-$(uname -m)"
NATIVE_STAGE="$PKG_DIR/python/src/licensehub_licenseguard/native"
rm -rf "$NATIVE_STAGE"
mkdir -p "$NATIVE_STAGE/$HOST_PLAT"
cp "$CORE_DIR/dist/$HOST_PLAT/lib/$(lib_name "$HOST_PLAT")" "$NATIVE_STAGE/$HOST_PLAT/"
mkdir -p "$DIST/python"
PLAT_NAME=$(plat_name_for "$HOST_PLAT")
(cd "$PKG_DIR/python" && python3 setup.py -q bdist_wheel --plat-name "$PLAT_NAME" -d "$DIST/python")

# ---- 5. Node.js npm 패키지 ----
printf '== Node.js ==\n'
NODE_STAGE="$DIST/nodejs/package"
mkdir -p "$NODE_STAGE/native"
cp "$PKG_DIR/nodejs/package.json" "$NODE_STAGE/"
cp "$PKG_DIR/nodejs/licenseguard.js" "$NODE_STAGE/"
cp "$PKG_DIR/nodejs/README.md" "$NODE_STAGE/"
for p in $PLATFORMS; do
    mkdir -p "$NODE_STAGE/native/$p"
    cp "$CORE_DIR/dist/$p/lib/$(lib_name "$p")" "$NODE_STAGE/native/$p/"
done
(cd "$NODE_STAGE" && npm pack --quiet)
mv "$NODE_STAGE"/*.tgz "$DIST/nodejs/"
rm -rf "$NODE_STAGE"

# ---- 6. Rust 안내 ----
printf '== Rust ==\n'
mkdir -p "$DIST/rust"
cp "$PKG_DIR/rust/README.md" "$DIST/rust/"

printf '\nDistribution packages created under: %s\n' "$DIST"
find "$DIST" -maxdepth 2 -type f | sed "s|^$ROOT/||" | sort