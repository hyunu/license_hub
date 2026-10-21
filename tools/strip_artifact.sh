#!/usr/bin/env sh
# 배포 산출물에서 심볼/디버그 정보를 제거한다.
#
# 목적:
#   1) 배포물 크기 감소 (정적 라이브러리는 약 3배 작아진다)
#   2) 심볼 이름/경로 노출 감소
#
# 공유 라이브러리의 전역 심볼(lh_*)은 유지해야 하므로 로컬 심볼만 제거한다.
# 도구가 없으면 경고만 남기고 그대로 진행한다(릴리스 실패시키지 않음).
set -eu

if [ "$#" -eq 0 ]; then
    printf 'usage: %s <file>...\n' "$0" >&2
    exit 2
fi

strip_file() {
    target="$1"
    [ -f "$target" ] || return 0

    case "$(uname -s)" in
        Darwin)
            # BSD strip: -S 디버그 심볼 제거, -x 로컬 심볼 제거.
            # 전역 심볼(lh_*)은 남는다.
            if command -v strip >/dev/null 2>&1; then
                strip -S -x "$target" || true
            fi
            ;;
        *)
            # COFF 아카이브/PE 는 디버그 정보만 제거한다(내보내기 테이블 보존).
            case "$target" in
                *.dll|*.lib|*.exe)
                    if command -v llvm-strip >/dev/null 2>&1; then
                        llvm-strip --strip-debug "$target" || true
                    fi
                    ;;
                *)
                    if command -v llvm-strip >/dev/null 2>&1; then
                        # --discard-all == GNU -x: 로컬 심볼만 제거
                        llvm-strip --strip-debug --discard-all "$target" || true
                    elif command -v strip >/dev/null 2>&1; then
                        strip --strip-debug -x "$target" || true
                    fi
                    ;;
            esac
            ;;
    esac
}

for target in "$@"; do
    strip_file "$target"
done
