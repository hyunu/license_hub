#!/usr/bin/env sh
set -eu

# LicenseGuard Node.js 자가 테스트 실행 스크립트.
# 사용: ./run.sh

BIND_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ ! -d "$BIND_DIR/node_modules/koffi" ]; then
    printf 'Installing koffi (node_modules)...\n'
    (cd "$BIND_DIR" && npm install --no-audit --no-fund)
fi

(cd "$BIND_DIR" && node verify_all.js)