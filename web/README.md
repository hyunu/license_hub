# LicenseHub 웹앱

관리자 대시보드. 라이선스 생성·인증서 발급·Blacklist·사용자·감사 로그를
관리하고, GitHub App으로 GitHub Repository에 인증서/Blacklist/공개키를
동기화한다.

```text
web/
├── backend/     Rust + axum + SQLite (관리 API, GitHub App 동기화, 정적 서빙)
└── frontend/    React + Vite + TypeScript (GitHub Pages 배포 가능)
```

## 로컬 실행

1. 백엔드 실행 (기본 `admin`/`admin123`)

```sh
cd web/backend
cp .env.example .env
cargo run
```

2. 프론트엔드 개발 서버 (Vite가 `/api`를 백엔드로 프록시)

```sh
cd web/frontend
npm install
npm run dev
```

브라우저에서 `http://localhost:5173` 접속.

또는 프론트를 빌드해 백엔드가 직접 서빙:

```sh
cd web/frontend && npm install && npm run build
cd ../backend && cargo run   # http://127.0.0.1:8080
```

## Ubuntu 배포 (Oracle Cloud + Tailscale)

`web/deploy/ubuntu/README.md` 참고. Tailscale로 안전하게 접근하며, VCN
포트 오픈 없이 운영 가능하다.

## SSH 자동 배포 (Oracle)

SSH 접근이 있으면 GitHub Actions로 자동 배포·환경 구축이 가능하다.

- 환경 구축(1회): Actions → **Provision Oracle Backend**
- 자동 배포: `main`에서 `core/`·`web/backend/` 변경 시, 또는 Actions →
  **Deploy Backend to Oracle**
- 상세: `web/deploy/ssh/README.md`

## 환경 변수 (backend)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `BIND_ADDR` | `127.0.0.1:8080` | 바인딩 주소 |
| `LICENSEHUB_DB` | `data/licensehub.db` | SQLite 경로 |
| `FRONTEND_DIST` | `../frontend/dist` | 정적 프론트 경로 |
| `LICENSEHUB_SIGNING_KEY` | (없음) | 64자 hex 개인키. 운영 필수 |
| `LICENSEHUB_VERIFY_URL` | `http://127.0.0.1:8080/api/verify` | L2/L3 서버 검증 URL |
| `LICENSEHUB_ADMIN_USER/PASSWORD` | `admin` / `admin123` | 초기 관리자 |

## GitHub 연동

### GitHub App 동기화 (인증서/Blacklist/공개키)

`backend/.env` 에 설정:

```sh
GITHUB_REPO=owner/licensehub-distribution
GITHUB_APP_ID=123456
GITHUB_INSTALLATION_ID=654321
GITHUB_APP_PRIVATE_KEY_PATH=/path/to/app.pem
```

웹앱의 "GitHub 동기화" 화면에서 전체/인증서/Blacklist/공개키를 push한다.

- 인증서 → `certificates/{core|secure|device-bound}/{license-id}.json`
- Blacklist → `blacklist/blacklist.json`
- 공개키 → `keys/public-key.pem`

GitHub App 권한은 대상 Repository의 Contents Read/Write, Metadata Read
최소 권한으로 구성한다.

### GitHub Pages (프론트 호스팅)

1. GitHub 저장소 Settings → Pages → Source를 **GitHub Actions**로 변경
2. 저장소 Variables에 백엔드 주소 `API_BASE_URL` 설정 (없으면 같은 도메인의 `/api`)
3. `main` 브랜치 push 시 `.github/workflows/pages.yml` 이 프론트를 Pages에 배포

### CI/CD

`.github/workflows/ci.yml` 이 push/PR마다 다음을 수행한다.

- `core` 테스트 + Clippy
- `web/backend` 테스트 + Clippy
- `web/frontend` 빌드

## SW Client 다운로드

SW Client는 GitHub에 직접 접속하지 않고 **LicenseHub API(공개 엔드포인트)**로
데이터를 내려받는다.

| 엔드포인트 | 용도 | 인증 |
|---|---|---|
| `GET /api/claim/{license_id}` | 자신의 인증서 JSON 다운로드 | 없음 |
| `GET /api/client/blacklist` | 폐기 목록 (GitHub blacklist.json 형식) | 없음 |
| `GET /api/public-key` | 검증용 공개키 | 없음 |
| `POST /api/verify` | L2/L3 서버 검증 (approved/rejected) | 없음 |

Client 흐름:

```text
1. 인증서 다운로드 → GET /api/claim/{license_id}   (L1 오프라인 검증용)
2. 공개키        → GET /api/public-key            (서명 검증)
3. 폐기 확인     → GET /api/client/blacklist 주기적 캐시
4. (L2/L3)       → POST /api/verify 서버 상태 확인
```

GitHub 동기화 탭은 같은 데이터를 GitHub 저장소에 배포하는 채널이며, Client는
그 저장소가 Private이어도 상관없이 API를 통해 받는다.

## API 요약

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/auth/login` | 로그인 (토큰 발급) |
| GET | `/api/stats` | 대시보드 통계 |
| GET | `/api/licenses` | 라이선스 목록 |
| POST | `/api/licenses` | 라이선스 생성 |
| POST | `/api/licenses/{id}/issue` | 인증서 발급 (Core 서명) |
| GET | `/api/licenses/{id}/download` | 인증서 JSON 다운로드 |
| POST | `/api/licenses/{id}/status` | 상태 변경 (active/revoked/blacklisted) |
| GET/POST | `/api/users` | 사용자 목록/추가 |
| GET/POST/DELETE | `/api/blacklist[/{id}]` | Blacklist 관리 |
| GET | `/api/audit` | 감사 로그 |
| POST | `/api/verify` | L2/L3 서버 검증 (approved/rejected) |
| POST | `/api/sync/*` | GitHub Repository 동기화 |
| GET | `/api/public-key` | 공개키 (hex/PEM) |