#!/usr/bin/env sh
# C SDK 용 pkg-config 파일을 생성한다.
#
# 사용법: make_pkgconfig.sh <platform> <version> <out_dir>
#   platform  : macos-arm64 | linux-x86_64 | ...
#   out_dir   : .pc 파일을 쓸 디렉터리. 반드시 <sdk>/lib/<platform>/pkgconfig
#               형태여야 한다(.pc 안의 상대 경로가 이 깊이를 전제로 한다).
#
# .pc 안의 경로는 배포 zip 안에서 상대 경로로 쓰인다. pkg-config 가
# ${pcfiledir} 를 절대 경로로 확장하므로 SDK 를 어디에 풀어 쓰든 동작한다.
#
#   <sdk>/lib/<platform>/pkgconfig/licensehub_core.pc
#     prefix      = ${pcfiledir}/..             -> <sdk>/lib/<platform>
#     includedir  = ${prefix}/../../include     -> <sdk>/include
set -eu

if [ "$#" -ne 3 ]; then
    printf 'usage: %s <platform> <version> <out_dir>\n' "$0" >&2
    exit 2
fi

PLATFORM="$1"
VERSION="$2"
OUT_DIR="$3"

TEMPLATE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

case "$PLATFORM" in
    macos-*) PRIVATE_LIBS="-framework Security -framework CoreFoundation -liconv" ;;
    linux-*) PRIVATE_LIBS="-lpthread -ldl -lm" ;;
    *)
        # Windows(MSVC) 는 pkg-config 규약이 맞지 않아 생성하지 않는다.
        exit 0
        ;;
esac

mkdir -p "$OUT_DIR"

PREFIX='${pcfiledir}/..'
LIBDIR='${prefix}'
INCLUDEDIR='${prefix}/../../include'

render() {
    src="$1"
    dst="$2"
    sed \
        -e "s|@PREFIX@|${PREFIX}|g" \
        -e "s|@LIBDIR@|${LIBDIR}|g" \
        -e "s|@INCLUDEDIR@|${INCLUDEDIR}|g" \
        -e "s|@VERSION@|${VERSION}|g" \
        -e "s|@PRIVATE_LIBS@|${PRIVATE_LIBS}|g" \
        "$src" >"$dst"
}

render "$TEMPLATE_DIR/licensehub_core.pc.in" "$OUT_DIR/licensehub_core.pc"
render "$TEMPLATE_DIR/licensehub_core_static.pc.in" "$OUT_DIR/licensehub_core_static.pc"

printf 'pkg-config generated for %s: %s\n' "$PLATFORM" "$OUT_DIR"
