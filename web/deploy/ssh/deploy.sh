#!/usr/bin/env bash
set -euo pipefail

# 로컬에서 수동 배포 (GitHub Actions 없이 테스트용).
# 사용:
#   HOST=1.2.3.4 USER=ubuntu KEY=~/.ssh/id_ed25519 ./deploy.sh
# 프론트를 백엔드가 서빙하려면 FRONTEND_DIST를 맞춰 /opt/licensehub/frontend 를 채운다.

HOST="${HOST:?HOST 환경변수 필요 (예: 1.2.3.4 또는 licensehub.duckdns.org)}"
USER="${USER:-ubuntu}"
KEY="${KEY:-$HOME/.ssh/id_ed25519}"

BACKEND_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../../backend" && pwd)

echo "==> 빌드 (release)"
(cd "$BACKEND_DIR" && cargo build --release)

echo "==> 바이너리 전송"
scp -i "$KEY" -o StrictHostKeyChecking=accept-new \
    "$BACKEND_DIR/target/release/licensehub-web-backend" \
    "$USER@$HOST:/opt/licensehub/bin/"

echo "==> 서비스 재시작"
ssh -i "$KEY" "$USER@$HOST" \
    'chmod +x /opt/licensehub/bin/licensehub-web-backend && systemctl restart licensehub-web && systemctl status licensehub-web --no-pager | head -8'

echo "==> 배포 완료"