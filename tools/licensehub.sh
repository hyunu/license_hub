#!/usr/bin/env bash
# LicenseHub CLI — AI/에이전트가 로그인·라이선스 생성·발급·내려받기를 실행하는 얇은 래퍼.
#
# 의존성: curl, jq
# 환경변수:
#   LICENSEHUB_URL    (필수) 예: https://licensehub.example.com
#   LICENSEHUB_TOKEN  (선택) login 출력의 token. 있으면 login 생략 가능
#   LICENSEHUB_USER, LICENSEHUB_PASS  (login 시)
#
# 예)
#   export LICENSEHUB_URL=https://licensehub.example.com
#   export LICENSEHUB_USER=admin LICENSEHUB_PASS=secret
#   LICENSEHUB_TOKEN=$(tools/licensehub.sh login | jq -r .token)
#   tools/licensehub.sh create license.json
#   tools/licensehub.sh issue 7
set -euo pipefail

BASE="${LICENSEHUB_URL:-}"
if [[ -z "$BASE" ]]; then
  echo "licensehub: LICENSEHUB_URL 을 설정하세요" >&2
  exit 2
fi
BASE="${BASE%/}"

die() { echo "licensehub: $*" >&2; exit 1; }
need_token() { [[ -n "${LICENSEHUB_TOKEN:-}" ]] || die "LICENSEHUB_TOKEN 을 설정하세요 (login 출력의 token)"; }

auth=()
if [[ -n "${LICENSEHUB_TOKEN:-}" ]]; then
  auth=(-H "Authorization: Bearer ${LICENSEHUB_TOKEN}")
fi

usage() {
  cat <<'EOF'
사용법: licensehub.sh <command> [args]

  login                       LICENSEHUB_USER/PASS 로 로그인 (token 출력)
  pubkey                      발급 서버 공개키 조회
  list                        라이선스 목록
  create <json-file|->        라이선스 생성 (application_public_key 생략 시 서버가 키쌍 생성)
  issue <id>                  인증서 발급 + 암호화 라이선스 생성
  license <id>                암호화 라이선스(JSON) 조회
  download <id> <out-file>    암호화 라이선스 파일 내려받기

환경변수: LICENSEHUB_URL(필수), LICENSEHUB_TOKEN, LICENSEHUB_USER, LICENSEHUB_PASS
EOF
}

cmd="${1:-}"
shift || true

case "$cmd" in
  login)
    [[ -n "${LICENSEHUB_USER:-}" ]] || die "LICENSEHUB_USER 가 필요합니다"
    [[ -n "${LICENSEHUB_PASS:-}" ]] || die "LICENSEHUB_PASS 가 필요합니다"
    curl -sS -X POST "$BASE/api/auth/login" \
      -H 'content-type: application/json' \
      -d "$(jq -n --arg u "$LICENSEHUB_USER" --arg p "$LICENSEHUB_PASS" '{username:$u,password:$p}')"
    echo
    ;;
  pubkey)
    curl -sS "$BASE/api/public-key"
    echo
    ;;
  list)
    need_token
    curl -sS "${auth[@]}" "$BASE/api/licenses"
    echo
    ;;
  create)
    need_token
    src="${1:-}"
    [[ -n "$src" ]] || die "json 파일 또는 - 가 필요합니다"
    if [[ "$src" == "-" ]]; then
      body="$(cat)"
    else
      body="$(cat "$src")"
    fi
    curl -sS -X POST "$BASE/api/licenses" "${auth[@]}" \
      -H 'content-type: application/json' -d "$body"
    echo
    ;;
  issue)
    need_token
    id="${1:-}"
    [[ -n "$id" ]] || die "라이선스 id 가 필요합니다"
    curl -sS -X POST "$BASE/api/licenses/$id/issue" "${auth[@]}"
    echo
    ;;
  license)
    need_token
    id="${1:-}"
    [[ -n "$id" ]] || die "라이선스 id 가 필요합니다"
    curl -sS "${auth[@]}" "$BASE/api/licenses/$id/license"
    echo
    ;;
  download)
    need_token
    id="${1:-}"
    out="${2:-}"
    [[ -n "$id" && -n "$out" ]] || die "download <id> <out-file>"
    curl -sS "${auth[@]}" "$BASE/api/licenses/$id/license/download" -o "$out"
    echo "saved: $out"
    ;;
  *)
    usage
    exit 1
    ;;
esac
