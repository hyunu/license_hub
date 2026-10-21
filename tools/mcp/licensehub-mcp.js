#!/usr/bin/env node
'use strict';

/*
 * LicenseHub MCP 서버
 *
 * 두 가지 전송을 지원한다.
 *  - stdio (기본): MCP 클라이언트가 프로세스를 직접 실행
 *  - Streamable HTTP: `--http` 로 실행. 원격에서 URL로 접속
 *
 * 도구:
 *  - generate_keypair : App 키쌍(Ed25519) 생성
 *  - public_key       : 발급 서버 공개키 조회
 *  - list_licenses    : 라이선스 목록
 *  - create_license   : 라이선스 생성
 *  - issue_license    : 인증서 발급 + 암호화 라이선스 생성
 *  - download_license : 암호화 라이선스 조회 (원격에서는 save_path 금지)
 *  - verify_license   : 서버 기준 라이선스 상태 확인(L2)
 *
 * 공통 환경변수:
 *  - LICENSEHUB_URL         (필수) 예: https://licensehub.example.com
 *  - LICENSEHUB_TOKEN       (stdio) Bearer 토큰
 *  - LICENSEHUB_VERIFY_KEY  (선택) L2 검증 키
 *
 * HTTP 모드 환경변수:
 *  - MCP_HOST         (기본 127.0.0.1)
 *  - MCP_PORT         (기본 8090)
 *  - MCP_PATH         (기본 /mcp)
 *  - MCP_REQUIRE_AUTH (기본 1) 0이면 인증 생략(로컬 테스트 전용)
 *
 * HTTP 모드의 인증: 요청의 `Authorization: Bearer <token>` 을 그대로
 * LicenseHub 백엔드 호출에 전달한다. 서버에 관리자 토큰을 고정하지 않는다.
 */

const { createHash, generateKeyPairSync } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const readline = require('node:readline');

const SERVER_NAME = 'licensehub';
const SERVER_VERSION = '0.1.0';
const DEFAULT_PROTOCOL = '2024-11-05';
const MAX_BODY = 1_000_000;

const BASE = (process.env.LICENSEHUB_URL || '').replace(/\/+$/, '');
const ENV_TOKEN = process.env.LICENSEHUB_TOKEN || '';
const VERIFY_KEY =
  process.env.LICENSEHUB_VERIFY_KEY || 'a9e54925-1acb-4214-8b2a-38616c561b96';

const TRANSPORT =
  process.argv.includes('--http') || process.env.MCP_TRANSPORT === 'http' ? 'http' : 'stdio';
const MCP_HOST = process.env.MCP_HOST || '127.0.0.1';
const MCP_PORT = Number(process.env.MCP_PORT || 8090);
const MCP_PATH = process.env.MCP_PATH || '/mcp';
const REQUIRE_AUTH = (process.env.MCP_REQUIRE_AUTH || '1') !== '0';
// 클라이언트용 전용 액세스 키. 설정되면 이 키로 MCP 접근을 제한하고,
// 백엔드 호출은 서버 측 관리자 자격증명으로 로그인해 수행한다.
const MCP_ACCESS_KEY = process.env.MCP_ACCESS_KEY || '';
const ADMIN_USER = process.env.LICENSEHUB_ADMIN_USER || '';
const ADMIN_PASS = process.env.LICENSEHUB_ADMIN_PASSWORD || '';

// 검증 코어(네이티브) 매니페스트. 에이전트가 이 정보로 라이브러리를 받아
// 통합 코드를 쓴다.
const CORE_REPO = process.env.LICENSEHUB_CORE_REPO || 'hyunu/license_hub';
const CORE_MANIFEST_SOURCE = process.env.LICENSEHUB_CORE_MANIFEST || '';
const CORE_VERSION = (process.env.LICENSEHUB_CORE_VERSION || '').replace(/^v/, '');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function log(...args) {
  console.error('[licensehub-mcp]', ...args);
}

//--------------------------------------------------------------------------------
// 백엔드 HTTP 호출
//--------------------------------------------------------------------------------
async function backend(method, path, options = {}) {
  if (!BASE) throw new Error('LICENSEHUB_URL 이 설정되지 않았습니다');
  const { body, headers = {}, auth = false, token } = options;

  const h = { ...headers };
  if (auth) {
    const bearer = token || ENV_TOKEN;
    if (!bearer) throw new Error('인증 토큰이 없습니다 (Authorization 헤더 또는 LICENSEHUB_TOKEN)');
    h['Authorization'] = 'Bearer ' + bearer;
  }
  if (body !== undefined) h['content-type'] = 'application/json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: h,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      const msg = (data && data.error) || 'HTTP ' + res.status;
      throw new Error(res.status + ': ' + msg);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

//--------------------------------------------------------------------------------
// 서버 측 인증 (관리자 자격증명으로 백엔드 토큰 발급·캐시)
//--------------------------------------------------------------------------------
let serverToken = null;

async function serverSideToken() {
  if (serverToken) return serverToken;
  if (!ADMIN_USER || !ADMIN_PASS) {
    throw new Error('서버 인증 정보(LICENSEHUB_ADMIN_USER/PASSWORD)가 설정되지 않았습니다');
  }
  if (!BASE) throw new Error('LICENSEHUB_URL 이 설정되지 않았습니다');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(BASE + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.token) {
      throw new Error('백엔드 로그인 실패 (관리자 자격증명 확인)');
    }
    serverToken = data.token;
    return serverToken;
  } finally {
    clearTimeout(timer);
  }
}

//--------------------------------------------------------------------------------
// 검증 코어 매니페스트
//--------------------------------------------------------------------------------
let coreManifestCache = null;

function localManifestPaths() {
  const dist = path.join(REPO_ROOT, 'core', 'dist');
  const found = [];
  try {
    for (const entry of fs.readdirSync(dist, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(dist, entry.name, 'licensehub-core-manifest.json');
      if (fs.existsSync(candidate)) found.push(candidate);
    }
  } catch {
    // dist 가 없으면 무시한다.
  }
  return found;
}

function releaseManifestUrl() {
  const asset = 'licensehub-core-manifest.json';
  if (CORE_VERSION) {
    return `https://github.com/${CORE_REPO}/releases/download/v${CORE_VERSION}/${asset}`;
  }
  return `https://github.com/${CORE_REPO}/releases/latest/download/${asset}`;
}

async function readManifest(source) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return await response.json();
  }
  return JSON.parse(fs.readFileSync(source, 'utf8'));
}

async function loadCoreManifest({ refresh = false } = {}) {
  if (coreManifestCache && !refresh) return coreManifestCache;

  const candidates = [];
  if (CORE_MANIFEST_SOURCE) candidates.push(CORE_MANIFEST_SOURCE);
  candidates.push(...localManifestPaths());
  candidates.push(releaseManifestUrl());

  const errors = [];
  for (const source of candidates) {
    try {
      const manifest = await readManifest(source);
      if (!manifest || !manifest.platforms) {
        throw new Error('platforms 필드가 없습니다');
      }
      coreManifestCache = { ...manifest, _source: source };
      return coreManifestCache;
    } catch (error) {
      errors.push(`${source}: ${error.message}`);
    }
  }

  throw new Error(
    '검증 코어 매니페스트를 찾지 못했습니다. ' +
      'LICENSEHUB_CORE_MANIFEST(파일 경로 또는 URL)를 지정하거나 ' +
      'core/build.sh 로 로컬 산출물을 만들거나 릴리스를 배포하세요.\n' +
      errors.join('\n'),
  );
}

function platformKeys(manifest) {
  return Object.keys(manifest.platforms || {});
}

function filesOf(entry) {
  if (!entry) return [];
  if (Array.isArray(entry.files)) return entry.files;
  return [entry];
}

function sha256OfFile(filePath) {
  const digest = createHash('sha256');
  digest.update(fs.readFileSync(filePath));
  return digest.digest('hex');
}

function coreModuleInfo(manifest, platform, kind) {
  const platforms = manifest.platforms || {};
  const entry = platforms[platform];
  if (!entry) {
    throw new Error(
      `지원하지 않는 플랫폼: ${platform}. 사용 가능: ${platformKeys(manifest).join(', ')}`,
    );
  }
  const linkKind = kind === 'shared' ? 'shared' : 'static';
  const target = entry[linkKind];
  if (!target) {
    throw new Error(`${platform} 에 ${linkKind} 라이브러리가 없습니다`);
  }

  const files = filesOf(target);
  const primary = files[0];
  const pkgconfig = (entry.pkgconfig || {})[linkKind] || null;
  const cmakeTarget = (manifest.cmake && manifest.cmake.targets
    ? manifest.cmake.targets[linkKind]
    : null) || null;

  const release = manifest.release || {};
  const assetUrl = release.url || null;
  const commands = [];
  if (assetUrl) {
    commands.push(`curl -fL ${assetUrl} -o licensehub-core.zip`);
    commands.push('unzip -q licensehub-core.zip -d vendor');
    commands.push(
      `# ${platform} ${linkKind} 무결성 확인\n` +
        `shasum -a 256 vendor/c/${primary.path}  # => ${primary.sha256}`,
    );
  }

  const link = [];
  if (pkgconfig) {
    link.push(
      `export PKG_CONFIG_PATH=vendor/c/lib/${platform}/pkgconfig\n` +
        `cc app.c $(pkg-config --cflags --libs --static ${pkgconfig}) -o app`,
    );
  }
  if (cmakeTarget) {
    link.push(
      `cmake -S . -B build -DCMAKE_PREFIX_PATH=vendor/c\n` +
        `# target_link_libraries(app PRIVATE ${cmakeTarget})`,
    );
  }

  return {
    version: manifest.version,
    platform,
    kind: linkKind,
    header: manifest.header ? manifest.header.path : 'c/include/licensehub_core.h',
    files: files.map((file) => ({
      path: `c/${file.path}`,
      sha256: file.sha256,
      size: file.size,
    })),
    pkgconfig_library: pkgconfig,
    cmake_target: cmakeTarget,
    release_asset: release.c_sdk_asset || null,
    release_url: assetUrl,
    install_commands: commands,
    link_commands: link,
    verification_codes: manifest.verification_codes,
    notes: [
      '정적 라이브러리를 쓰면 LD_PRELOAD/DYLD_INSERT_LIBRARIES/라이브러리 교체로 검증을 가로챌 수 없다.',
      '공유 라이브러리는 개발 중 빠른 반복에만 쓰고 배포에는 쓰지 않는다.',
      'Python(ctypes)과 C#(DllImport)은 구조적으로 동적 로딩이라 정적 링크가 불가능하다.',
    ],
  };
}

//--------------------------------------------------------------------------------
// 도구 정의
//--------------------------------------------------------------------------------
const tools = [
  {
    name: 'generate_keypair',
    description:
      '응용 프로그램용 Ed25519 키쌍(App_Pub/App_Pri)을 생성한다. ' +
      'C ABI 에는 raw 32바이트(private_key_hex)를 넘긴다. ' +
      '원격(HTTP)에서는 클라이언트 측에서 생성하는 편이 더 안전하다.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'public_key',
    description: 'LicenseHub 발급 서버의 Ed25519 공개키를 조회한다.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_licenses',
    description: '라이선스 목록을 조회한다.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'create_license',
    description:
      '라이선스를 생성한다. application_public_key 를 생략하면 서버가 키쌍을 만들고 ' +
      'application_private_key 를 응답에 한 번만 포함한다. level=1 은 verification_url 금지, ' +
      'level=2 는 verification_url 필수.',
    inputSchema: {
      type: 'object',
      properties: {
        product: { type: 'string' },
        version: { type: 'string' },
        level: { type: 'integer', enum: [1, 2] },
        holder: { type: 'string' },
        expires_at: { type: 'string', description: 'RFC 3339 UTC, 예: 2027-01-01T00:00:00Z' },
        license_id: { type: 'string' },
        target_language: { type: 'string' },
        metadata: { type: 'string' },
        application_public_key: { type: 'string', description: 'Ed25519 SPKI PEM' },
        verification_url: { type: 'string', description: 'L2 필수, http(s) URL' },
      },
      required: ['product', 'version', 'level', 'holder', 'expires_at'],
      additionalProperties: false,
    },
  },
  {
    name: 'issue_license',
    description:
      '라이선스의 인증서를 발급하고 암호화 라이선스를 생성한다. ' +
      'id 는 숫자 DB id 이다. 응답의 encrypted_license 가 배포할 라이선스 파일이다.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'integer' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'download_license',
    description:
      '암호화 라이선스(JSON)를 조회한다. save_path 는 로컬(stdio)에서만 허용된다.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        save_path: { type: 'string', description: '저장할 파일 경로(로컬 모드 전용)' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'verify_license',
    description:
      'LicenseHub 서버 기준으로 라이선스 상태를 확인한다(승인/거부, L2). ' +
      '오프라인 암호문 검증은 응용 프로그램이 core ABI 로 수행한다.',
    inputSchema: {
      type: 'object',
      properties: { license_id: { type: 'string' } },
      required: ['license_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'core_manifest',
    description:
      '검증 코어(네이티브 라이브러리) 배포 매니페스트를 조회한다. ' +
      '플랫폼 키, 정적/공유 라이브러리 경로·SHA-256·크기, pkg-config 이름, ' +
      'CMake 타깃, 검증 코드 값을 담는다. 통합 코드를 쓰기 전에 먼저 호출한다.',
    inputSchema: {
      type: 'object',
      properties: { refresh: { type: 'boolean', description: '캐시 무시' } },
      additionalProperties: false,
    },
  },
  {
    name: 'core_module',
    description:
      '특정 플랫폼의 검증 코어를 내려받아 SHA-256 을 검증하고 로컬 경로에 푼다. ' +
      '반환된 root 를 include/lib 경로의 기준으로 쓴다. 기본은 static(정적 링크).',
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          description: '예: macos-arm64, linux-x86_64, windows-x86_64 (core_manifest 참고)',
        },
        kind: { type: 'string', enum: ['static', 'shared'], description: '기본 static' },
        dest: { type: 'string', description: '압축을 풀 디렉터리' },
        module: { type: 'string', description: '번들된 모듈 이름 (선택)' },
      },
      required: ['platform'],
      additionalProperties: false,
    },
  },
  {
    name: 'integration_snippet',
    description:
      '대상 언어에 맞는 LicenseHub 검증 통합 코드를 생성한다. ' +
      'fail-closed 골격이며 code==LH_VALID(0) 일 때만 핵심 로직을 켠다.',
    inputSchema: {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          enum: ['c', 'cpp', 'rust', 'python', 'csharp', 'go'],
        },
        level: { type: 'integer', enum: [1, 2], description: '1=오프라인, 2=온라인' },
        platform: { type: 'string', description: '예: macos-arm64 (선택)' },
        license_path: { type: 'string', description: '라이선스 파일 경로 (선택)' },
        private_key_path: { type: 'string', description: 'App 개인키 raw 32바이트 경로 (선택)' },
        application_id: { type: 'string', description: '앱 바인딩용 ID (선택)' },
        product: { type: 'string', description: '제품명 대조 (선택)' },
        version: { type: 'string', description: '버전 대조 (선택)' },
        executable_name: { type: 'string', description: '실행 파일명 대조 (선택)' },
      },
      required: ['language', 'level'],
      additionalProperties: false,
    },
  },
  {
    name: 'verify_local_module',
    description:
      '내려받은 검증 코어가 실제로 동작하는지 로컬에서 확인한다(스모크 테스트). ' +
      '컴파일러가 없으면 로드·심볼 검사만 한다.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          description: '예: macos-arm64 (생략 시 현재 플랫폼)',
        },
      },
      additionalProperties: false,
    },
  },
];

//--------------------------------------------------------------------------------
// 에이전트용 절차 (MCP instructions / prompts / resources)
//--------------------------------------------------------------------------------
const INSTRUCTIONS = `LicenseHub = 응용 프로그램의 핵심 로직을 보호하기 위해, 발급 서버가 서명한 인증서를 앱 공개키로 암호화해 주는 시스템이다.
사용자가 "LicenseHub로 핵심 로직을 보호해라"라고 하면 다음을 따른다.

1) 값 확인: project_path, product, version, level(1=오프라인/2=온라인), holder, expires_at(RFC3339), platform. 없으면 사용자에게 묻는다.
2) licensehub://integration 리소스를 읽거나 licensehub-integration 프롬프트로 전체 절차를 확인한다.
3) 키쌍: generate_keypair 도구 또는 클라이언트 측 openssl로 Ed25519 생성. 원격에서는 클라이언트 측 생성을 권장.
4) 발급: create_license -> issue_license(숫자 id) -> download_license. level=1은 verification_url 금지, level=2는 필수.
5) 코어: core_manifest 로 플랫폼을 고르고 core_module 로 검증 코어를 내려받아 SHA-256 을 확인한다. 기본은 정적 링크(static).
6) 통합: integration_snippet 으로 코드 골격을 만든 뒤 프로젝트에 맞게 고친다. fail-closed 를 유지한다.
7) 테스트: verify_local_module 로 코어 동작을 확인하고, 성공/실패(라이선스 없음·변조·만료·L2 다운) 경로를 모두 확인한다.

금지: LH_Pri 취급, App_Pri 로그/커밋/채팅 노출, 검증 결과 상수 하드코딩, L2 연결 실패를 통과로 처리.`;

const INTEGRATION_GUIDE = `# LicenseHub 통합 절차

## 0. 개념
LicenseHub는 발급 서버가 서명한 인증서를 응용 프로그램의 공개키로 암호화해 주는 시스템이다.
응용 프로그램은 자기 개인키로 복호화 -> 서명 검증 -> 자격 대조를 통과할 때만 핵심 로직을 켠다(fail-closed).

## 1. 입력 확인
project_path, product, version, level(1|2), holder, expires_at(RFC3339), platform.
값이 없으면 사용자에게 확인한다.

## 2. 키쌍
- generate_keypair 도구 또는 클라이언트 측 openssl로 Ed25519 키쌍을 만든다.
- 원격에서는 클라이언트 측 생성을 권장한다.
- App_Pub 는 SPKI PEM, App_Pri 는 raw 32바이트 seed.

## 3. 발급 (MCP 도구)
1) create_license { product, version, level, holder, expires_at, application_public_key }
2) issue_license { id }   // 숫자 DB id (문자열 license_id 아님)
3) download_license { id }  // 원격에서는 save_path 금지
- level=1: verification_url 금지. level=2: verification_url 필수.

## 4. 검증 코어 받기 (MCP 도구)
1) core_manifest { }              // 플랫폼 키와 라이브러리 경로·SHA-256 확인
2) core_module { platform, kind: "static", dest: "vendor/licensehub-core" }
   - 기본이 static(정적 링크)이다. 검증 코드가 바이너리 안으로 들어가
     LD_PRELOAD/DYLD_INSERT_LIBRARIES/라이브러리 파일 교체를 막는다.
   - 내려받은 파일의 SHA-256 을 매니페스트와 대조한다.
3) verify_local_module { platform } // 로드·심볼·컴파일·실행 스모크 테스트

## 5. 응용 프로그램 통합

integration_snippet { language, level, platform, ... } 로 골격을 생성한다.

- 핵심 로직을 별도 모듈로 분리한다.
- 시작 시 검증한다.
  C ABI: lh_decrypt_verify_trusted_license(lic, len, app_pri_raw32, 32, context_json, ctx_len, &code)
  L2:    lh_decrypt_verify_trusted_license_online(...)
- rc==0 && code==LH_VALID 일 때만 활성화한다. 그 외는 모두 비활성.
- context JSON 필드: now, product, version, product_id, executable_name, application_id, target_language, server_status("approved"|"rejected"), blacklisted, revoked, max_chain_depth.
- now 를 생략하면 시스템 시계를 쓴다(만료 검사가 고정 시각에 묶이지 않는다).
- PEM을 C ABI에 그대로 넘기지 말고 raw 32바이트로 변환한다.
- 빌드 후 \`ldd app\` / \`otool -L app\` 에 licensehub 가 없어야 정적 링크다.

## 6. 검증/테스트
- 성공 경로와 실패 경로(라이선스 없음/변조/만료/L2 서버 다운)를 모두 테스트한다.
- 모든 실패에서 핵심 로직이 꺼져 있어야 한다.

## 7. 금지
- LH_Pri(발급 서버 서명 개인키) 취급 금지.
- App_Pri 로그/커밋/채팅 노출 금지.
- 검증 결과 상수 하드코딩 금지.
- L2 연결 실패를 통과로 처리 금지.`;

const prompts = [
  {
    name: 'licensehub-integration',
    description: '응용 서비스의 핵심 로직을 LicenseHub로 보호하는 절차',
    arguments: [
      { name: 'project_path', description: '대상 프로젝트 경로', required: false },
      { name: 'product', description: '제품명', required: false },
      { name: 'version', description: '버전', required: false },
      { name: 'level', description: '1=오프라인, 2=온라인', required: false },
      { name: 'holder', description: '소유자', required: false },
      { name: 'expires_at', description: '만료(RFC3339)', required: false },
      { name: 'platform', description: '대상 플랫폼/언어', required: false },
    ],
  },
];

const resources = [
  {
    uri: 'licensehub://integration',
    name: 'LicenseHub 통합 가이드',
    description: '발급·키 형식·검증 통합·불변식',
    mimeType: 'text/markdown',
  },
];

//--------------------------------------------------------------------------------
// 도구 실행
//--------------------------------------------------------------------------------
function generateKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const pubJwk = publicKey.export({ format: 'jwk' });
  const priJwk = privateKey.export({ format: 'jwk' });
  const rawPub = Buffer.from(pubJwk.x, 'base64url');
  const rawPri = Buffer.from(priJwk.d, 'base64url');
  return {
    public_key_pem: publicPem,
    private_key_pem: privatePem,
    public_key_hex: rawPub.toString('hex'),
    private_key_hex: rawPri.toString('hex'),
    public_key_raw_len: rawPub.length,
    private_key_raw_len: rawPri.length,
    note:
      'C ABI 에는 private_key_hex 를 32바이트 raw 로 넘긴다. ' +
      'private_key_pem/hex 는 파일이나 OS 보호 저장소에만 보관하고 로그·커밋에 남기지 않는다.',
  };
}

//--------------------------------------------------------------------------------
// 통합 코드 생성
//--------------------------------------------------------------------------------
const LEVEL_HELPERS = {
  1: {
    c: 'lh_decrypt_verify_trusted_license',
    python: 'decrypt_verify_trusted_license',
    csharp: 'DecryptVerifyTrustedLicense',
  },
  2: {
    c: 'lh_decrypt_verify_trusted_license_online',
    python: 'decrypt_verify_trusted_license_online',
    csharp: 'DecryptVerifyTrustedLicenseOnline',
  },
};

const DEFAULT_LICENSE_PATH = {
  c: 'license.json',
  cpp: 'license.json',
  rust: 'license.json',
  python: 'license.json',
  csharp: 'license.json',
  go: 'license.json',
};
const DEFAULT_KEY_PATH = {
  c: 'app_private_key.bin',
  cpp: 'app_private_key.bin',
  rust: 'app_private_key.bin',
  python: 'app_private_key.bin',
  csharp: 'app_private_key.bin',
  go: 'app_private_key.bin',
};

function contextFields(args, language) {
  const fields = [];
  if (args.product) fields.push(`"product": "${args.product}"`);
  if (args.version) fields.push(`"version": "${args.version}"`);
  if (args.application_id) fields.push(`"application_id": "${args.application_id}"`);
  if (args.executable_name) fields.push(`"executable_name": "${args.executable_name}"`);
  if (language === 'rust') fields.push('"max_chain_depth": 3');
  return fields;
}

function cLikeSnippet(args, language, staticIntro) {
  const helper = LEVEL_HELPERS[args.level][language === 'cpp' ? 'c' : language];
  const licensePath = args.license_path || DEFAULT_LICENSE_PATH[language];
  const keyPath = args.private_key_path || DEFAULT_KEY_PATH[language];
  const fields = contextFields(args, language);
  const contextLiteral = fields.length
    ? `{${fields.join(', ')}}`
    : '{} /* now 를 생략하면 시스템 시계를 쓴다 */';
  const verifyFn = args.level === 2 ? 'verify_online' : 'decrypt_verify_trusted_license';
  const cpp = language === 'cpp';

  // C ABI 는 context 를 const uint8_t* 로 받는다(char* 를 넘기면 C++ 에서 오류).
  const contextDecl = cpp
    ? `    static const uint8_t context_json[] = R"json(${contextLiteral})json";`
    : `    static const uint8_t context_json[] = "${contextLiteral}";`;
  const contextLen = cpp ? 'sizeof(context_json) - 1' : 'strlen((const char *)context_json)';

  return [
    staticIntro,
    '',
    '#include <stdio.h>',
    '#include <stdlib.h>',
    '#include <string.h>',
    '',
    '#include "licensehub_core.h"',
    '',
    '/* 라이선스(암호문)와 App 개인키(raw 32바이트)를 읽는다. */',
    'static unsigned char *slurp(const char *path, size_t *len) {',
    '    FILE *fp = fopen(path, "rb");',
    '    if (!fp) { return NULL; }',
    '    fseek(fp, 0, SEEK_END);',
    '    long size = ftell(fp);',
    '    rewind(fp);',
    '    if (size <= 0) { fclose(fp); return NULL; }',
    '    unsigned char *buf = (unsigned char *)malloc((size_t)size);',
    '    if (!buf) { fclose(fp); return NULL; }',
    '    *len = fread(buf, 1, (size_t)size, fp);',
    '    fclose(fp);',
    '    return buf;',
    '}',
    '',
    `/* ${helper} 로 검증한다. rc == 0 && code == LH_VALID 일 때만 성공이다. */`,
    `static int ${verifyFn}(void) {`,
    '    size_t lic_len = 0, key_len = 0;',
    `    unsigned char *lic = slurp("${licensePath}", &lic_len);`,
    `    unsigned char *app_pri = slurp("${keyPath}", &key_len);`,
    '    if (!lic || !app_pri) {',
    '        free(lic); free(app_pri);',
    '        fprintf(stderr, "license or private key not readable\\n");',
    '        return 0;',
    '    }',
    '    if (key_len != 32) {',
    '        fprintf(stderr, "App private key must be raw 32 bytes, got %zu\\n", key_len);',
    '        free(lic); free(app_pri);',
    '        return 0;',
    '    }',
    '',
    `    ${contextDecl}`,
    '    uint32_t code = UINT32_MAX;',
    `    int32_t rc = ${helper}(`,
    '        lic, lic_len,',
    '        app_pri, (size_t)32,',
    `        context_json, ${contextLen},`,
    '        &code);',
    '',
    '    free(lic); free(app_pri);',
    '',
    '    /* fail-closed: 하나라도 어긋나면 핵심 로직을 켜지 않는다. */',
    '    if (rc == 0 && code == LH_VALID) {',
    '        return 1;',
    '    }',
    '    fprintf(stderr, "denied: rc=%d code=%u\\n", rc, code);',
    '    return 0;',
    '}',
    '',
    'int main(void) {',
    '    if (!' + verifyFn + '()) {',
    '        fprintf(stderr, "NB: keep core logic disabled\\n");',
    '        return 1;',
    '    }',
    '    /* --- 핵심 로직 활성화 --- */',
    '    return 0;',
    '}',
  ].join('\n');
}

function pythonSnippet(args, staticIntro, manifest, kind, platform) {
  const helper = LEVEL_HELPERS[args.level].python;
  const licensePath = args.license_path || DEFAULT_LICENSE_PATH.python;
  const keyPath = args.private_key_path || DEFAULT_KEY_PATH.python;
  const fields = contextFields(args, 'python');
  const context = fields.length ? `{${fields.join(', ')}}` : '{}';
  // Python 은 C 스타일 주석을 쓸 수 없으므로 빌드 지침을 '#' 주석으로 바꾼다.
  const header = staticIntro
    ? [
        '# ── 빌드 지침 (정적 링크) ─────────────────────────────',
        ...staticIntro
          .split('\n')
          .map((line) => {
            const bare = line.replace(/^\/\*/, '').replace(/\*\/$/, '').trim();
            return bare ? '# ' + bare : '#';
          }),
        '# ────────────────────────────────────────────────────',
        '',
      ]
    : [];
  return [
    ...header,
    'import json',
    'import pathlib',
    'import sys',
    '',
    'from licensehub_licenseguard import LicenseGuard, VerificationCode',
    '',
    `LICENSE_FILE = pathlib.Path("${licensePath}")`,
    `PRIVATE_KEY_FILE = pathlib.Path("${keyPath}")`,
    'CONTEXT = {**' + context + ', "now": "2026-06-01T00:00:00Z"}  # 운영에서는 현재 시각',
    '',
    '',
    'def verify() -> bool:',
    '    """rc/코드를 대조한다. code == VALID 일 때만 True."""',
    '    if not LICENSE_FILE.exists() or not PRIVATE_KEY_FILE.exists():',
    '        print("license or private key missing", file=sys.stderr)',
    '        return False',
    '',
    '    private_key = PRIVATE_KEY_FILE.read_bytes()',
    '    if len(private_key) != 32:',
    '        print(f"App private key must be raw 32 bytes, got {len(private_key)}", file=sys.stderr)',
    '        return False',
    '',
    '    guard = LicenseGuard()',
    `    result = guard.${helper}(`,
    '        LICENSE_FILE.read_bytes(),',
    '        private_key,',
    '        json.dumps(CONTEXT).encode(),',
    '    )',
    '    if not result.valid:',
    '        print(f"denied: status={result.status} code={result.code} "',
    '              f"({VerificationCode.name(result.code)})", file=sys.stderr)',
    '        return False',
    '    return True',
    '',
    '',
    'if __name__ == "__main__":',
    '    # fail-closed: 검증을 통과하지 못하면 핵심 로직을 켜지 않는다.',
    '    if not verify():',
    '        sys.exit(1)',
    '    # --- 핵심 로직 활성화 ---',
    '',
    '# 주의: Python(ctypes)은 네이티브 파일을 교체하면 검증이 무력화될 수 있다.',
    '#       중요한 로직은 C/C++ 정적 링크로 분리하거나 L2(온라인)를 함께 쓴다.',
  ].join('\n');
}

function csharpSnippet(args, staticIntro) {
  const helper = LEVEL_HELPERS[args.level].csharp;
  const licensePath = args.license_path || DEFAULT_LICENSE_PATH.csharp;
  const keyPath = args.private_key_path || DEFAULT_KEY_PATH.csharp;
  const fields = contextFields(args, 'csharp');
  const context = fields.length ? `{${fields.join(', ')}}` : '{}';

  return [
    staticIntro,
    '',
    'using System;',
    'using System.IO;',
    'using LicenseHub.LicenseGuard;',
    '',
    'internal static class Program',
    '{',
    `    private const string LicenseFile = @"${licensePath}";`,
    `    private const string PrivateKeyFile = @"${keyPath}";`,
    '',
    '    private static bool Verify()',
    '    {',
    '        if (!File.Exists(LicenseFile) || !File.Exists(PrivateKeyFile))',
    '        {',
    '            Console.Error.WriteLine("license or private key missing");',
    '            return false;',
    '        }',
    '',
    '        var privateKey = File.ReadAllBytes(PrivateKeyFile);',
    '        if (privateKey.Length != 32)',
    '        {',
    '            Console.Error.WriteLine($"App private key must be raw 32 bytes, got {privateKey.Length}");',
    '            return false;',
    '        }',
    '',
    `        var context = @"${context.replace(/"/g, '""')}";`,
    '        var result = LicenseGuard.' + helper + '(',
    '            File.ReadAllBytes(LicenseFile), privateKey, context);',
    '',
    '        if (!result.Valid)',
    '        {',
    '            Console.Error.WriteLine($"denied: code={result.Code} ({result.CodeName})");',
    '            return false;',
    '        }',
    '        return true;',
    '    }',
    '',
    '    private static int Main()',
    '    {',
    '        // fail-closed: 검증을 통과하지 못하면 핵심 로직을 켜지 않는다.',
    '        if (!Verify())',
    '        {',
    '            return 1;',
    '        }',
    '        // --- 핵심 로직 활성화 ---',
    '        return 0;',
    '    }',
    '}',
    '',
    '// 주의: C#(DllImport)은 네이티브 파일을 교체하면 검증이 무력화될 수 있다.',
    '//       중요한 로직은 C/C++ 정적 링크로 분리하거나 L2(온라인)를 함께 쓴다.',
  ].join('\n');
}

function rustSnippet(args, staticIntro) {
  const licensePath = args.license_path || DEFAULT_LICENSE_PATH.rust;
  const keyPath = args.private_key_path || DEFAULT_KEY_PATH.rust;
  const online = args.level === 2;
  const codec = online ? 'decrypt_verify_trusted_license_online' : 'decrypt_and_verify_trusted';

  return [
    staticIntro,
    '',
    'use ed25519_dalek::SigningKey;',
    'use licensehub_core::{',
    `    envelope::{${codec}, EncryptedLicense},`,
    '    VerificationContext,',
    '};',
    '',
    `const LICENSE_FILE: &str = "${licensePath}";`,
    `const PRIVATE_KEY_FILE: &str = "${keyPath}";`,
    '',
    'fn core_logic() {',
    '    // --- 핵심 로직 ---',
    '}',
    '',
    'fn main() {',
    '    let private_key_bytes = std::fs::read(PRIVATE_KEY_FILE).expect("private key file");',
    '    assert_eq!(private_key_bytes.len(), 32, "App private key must be raw 32 bytes");',
    '    let private_key = SigningKey::from_bytes(',
    '        &private_key_bytes.try_into().expect("32 bytes"),',
    '    );',
    '',
    '    let envelope: EncryptedLicense =',
    '        serde_json::from_slice(&std::fs::read(LICENSE_FILE).expect("license file"))',
    '            .expect("license envelope");',
    '',
    '    // now 를 생략하면 시스템 시계를 쓴다. 서버 상태(L2)는 코어가 조회한다.',
    '    let context = VerificationContext::default();',
    '',
    `    let verified = ${codec}(&envelope, &private_key, &context);`,
    '',
    '    // fail-closed: 검증을 통과하지 못하면 핵심 로직을 켜지 않는다.',
    '    match verified {',
    '        Ok(()) => core_logic(),',
    '        Err(error) => {',
    '            eprintln!("denied: {error:?}");',
    '            std::process::exit(1);',
    '        }',
    '    }',
    '}',
    '',
    '// 검증 코드는 응용 크레이트가 아니라 licensehub-core 안에 들어간다',
    '// (Rust 는 정적 링크가 기본). 같은 프로세스에서 호출하므로',
    '// LD_PRELOAD 로 검증 함수를 가로챌 접점이 없다.',
  ].join('\n');
}

function goSnippet(args, staticIntro) {
  const licensePath = args.license_path || DEFAULT_LICENSE_PATH.go;
  const keyPath = args.private_key_path || DEFAULT_KEY_PATH.go;
  const online = args.level === 2;
  const fn = online
    ? 'lh_decrypt_verify_trusted_license_online'
    : 'lh_decrypt_verify_trusted_license';

  return [
    staticIntro,
    '',
    'package main',
    '',
    '/*',
    '#cgo CFLAGS: -I${SRCDIR}/vendor/c/include',
    online
      ? '#cgo LDFLAGS: -L${SRCDIR}/vendor/c/lib/<platform>/static -llicensehub_core -lpthread -ldl -lm'
      : '#cgo LDFLAGS: -L${SRCDIR}/vendor/c/lib/<platform>/static -llicensehub_core -lpthread -ldl -lm',
    '#include <stdlib.h>',
    '#include "licensehub_core.h"',
    '*/',
    'import "C"',
    '',
    'import (',
    '\t"fmt"',
    '\t"os"',
    '\t"unsafe"',
    ')',
    '',
    `const licenseFile = "${licensePath}"`,
    `const privateKeyFile = "${keyPath}"`,
    '',
    'func verify(license, privateKey, context []byte) (bool, uint32) {',
    '\tcode := C.uint32_t(0xFFFFFFFF)',
    '\trc := C.' + fn + '(',
    '\t\t(*C.uint8_t)(unsafe.Pointer(&license[0])), C.size_t(len(license)),',
    '\t\t(*C.uint8_t)(unsafe.Pointer(&privateKey[0])), C.size_t(len(privateKey)),',
    '\t\t(*C.char)(unsafe.Pointer(&context[0])), C.size_t(len(context)),',
    '\t\t&code,',
    '\t)',
    '\t// fail-closed: rc == 0 && code == LH_VALID(0) 일 때만 성공이다.',
    '\treturn rc == 0 && code == C.LH_VALID, uint32(code)',
    '}',
    '',
    'func main() {',
    '\tlicense, err := os.ReadFile(licenseFile)',
    '\tif err != nil { panic(err) }',
    '\tprivateKey, err := os.ReadFile(privateKeyFile)',
    '\tif err != nil { panic(err) }',
    '\tif len(privateKey) != 32 {',
    '\t\tpanic("App private key must be raw 32 bytes")',
    '\t}',
    '\tcontext := []byte(`{}`) // now 생략 시 시스템 시계',
    '',
    '\tok, code := verify(license, privateKey, context)',
    '\tif !ok {',
    '\t\tfmt.Fprintf(os.Stderr, "denied: code=%d\\n", code)',
    '\t\tos.Exit(1)',
    '\t}',
    '\t// --- 핵심 로직 활성화 ---',
    '}',
  ].join('\n');
}

function staticIntro(args, manifest, platform, kind) {
  const lines = [];
  lines.push(
    `/* LicenseHub 검증 통합 (language, level=${args.level}) — fail-closed.`,
  );
  lines.push(' *');
  if (manifest) {
    lines.push(` * 검증 코어 v${manifest.version} / ${platform || '(플랫폼 미지정)'} / ${kind}`);
  }
  if (kind === 'static') {
    lines.push(' * 정적 링크: 검증 코드가 바이너리 안에 들어가 LD_PRELOAD/DYLD_INSERT_LIBRARIES/');
    lines.push(' * 라이브러리 파일 교체로 검증을 가로챌 수 없다.');
  } else {
    lines.push(' * 공유 링크: 개발용. 배포에는 정적 링크를 쓴다.');
  }
  lines.push(' *');
  lines.push(' * 빌드:');
  if (manifest && platform) {
    lines.push(` *   export PKG_CONFIG_PATH=vendor/c/lib/${platform}/pkgconfig`);
    lines.push(
      ` *   cc app.c $(pkg-config --cflags --libs ${kind === 'static' ? '--static ' : ''}licensehub_core${kind === 'static' ? '_static' : ''}) -o app`,
    );
  } else {
    lines.push(' *   core_manifest / core_module 도구로 코어를 받은 뒤 위 명령을 쓴다.');
  }
  lines.push(' */');
  return lines.join('\n');
}

function buildSnippet(args) {
  const language = args.language;
  const level = Number(args.level);
  if (![1, 2].includes(level)) throw new Error('level 은 1 또는 2 여야 합니다');
  if (!['c', 'cpp', 'rust', 'python', 'csharp', 'go'].includes(language)) {
    throw new Error('지원하지 않는 언어: ' + language);
  }
  const normalized = { ...args, level };
  const kind = 'static';
  const intro = (manifest, platform) => staticIntro(normalized, manifest, platform, kind);

  let code;
  switch (language) {
    case 'c':
    case 'cpp':
      code = cLikeSnippet(normalized, language, intro(null, args.platform));
      break;
    case 'python':
      code = [
        pythonSnippet(normalized, '"""', null, kind, args.platform, false),
        '',
        pythonSnippet(normalized, '', null, kind, args.platform, true),
      ].join('\n');
      break;
    case 'csharp':
      code = csharpSnippet(normalized, intro(null, args.platform));
      break;
    case 'rust':
      code = rustSnippet(normalized, intro(null, args.platform));
      break;
    case 'go':
      code = goSnippet(normalized, intro(null, args.platform));
      break;
    default:
      throw new Error('지원하지 않는 언어: ' + language);
  }

  return {
    language,
    level,
    link_kind: kind,
    platform: args.platform || null,
    snippet: code,
    invariants: [
      'rc == 0 && code == LH_VALID(0) 일 때만 핵심 로직을 켠다. 그 외는 모두 비활성.',
      'L2(온라인)는 서버 미응답 시 비활성이다. 연결 실패를 통과로 처리하지 않는다.',
      'PEM 을 C ABI 에 넘기지 않는다. App 개인키는 raw 32바이트 seed 다.',
      'App_Pri 는 파일/OS 보호 저장소에만 두고 로그·커밋·채팅에 남기지 않는다.',
    ],
    context_fields: {
      now: 'RFC 3339. 생략하면 시스템 시계를 쓴다.',
      product: '인증서 product 와 일치해야 한다',
      version: '인증서 version 과 일치해야 한다',
      product_id: '인증서 metadata["product_id"] 와 일치',
      executable_name: '인증서 metadata["executable_name"] 과 일치',
      application_id: '이미지 P 필드(서명된 Application ID)와 일치',
      target_language: '인증서 Target Language 와 일치',
      server_status: 'L2: "approved" | "rejected"',
      blacklisted: 'bool',
      revoked: 'bool',
      max_chain_depth: '중첩 인증서 최대 깊이 (기본 3)',
    },
    next: [
      'core_module 도구로 해당 플랫폼 코어를 받아 SHA-256 을 검증한다.',
      '생성된 코드의 성공/실패 경로(라이선스 없음·변조·만료·L2 다운)를 모두 테스트한다.',
      '빌드 후 ldd/otool -L 로 licensehub 동적 의존이 없는지 확인한다.',
    ],
  };
}

//--------------------------------------------------------------------------------
// 코어 모듈 내려받기
//--------------------------------------------------------------------------------
function currentPlatform() {
  const os = { darwin: 'macos', linux: 'linux', win32: 'windows' }[process.platform];
  if (!os) return null;
  const arch = { x64: 'x86_64', arm64: 'arm64' }[process.arch] || process.arch;
  return `${os}-${arch}`;
}

async function downloadTo(url, destination) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, buffer);
  return buffer.length;
}

async function fetchCoreModule(args) {
  const manifest = await loadCoreManifest();
  const platform = args.platform || currentPlatform();
  const kind = args.kind === 'shared' ? 'shared' : 'static';
  const info = coreModuleInfo(manifest, platform, kind);

  const dest = path.resolve(args.dest || path.join('vendor', 'licensehub-core'));
  fs.mkdirSync(dest, { recursive: true });

  if (!info.release_url) {
    throw new Error(
      '매니페스트에 릴리스 URL 이 없습니다. 로컬 산출물을 쓰려면 ' +
        '_source 경로 아래 파일을 직접 복사하세요.',
    );
  }

  const zipPath = path.join(dest, info.release_asset || 'licensehub-core.zip');
  const bytes = await downloadTo(info.release_url, zipPath);

  const unzip = spawnSync('unzip', ['-oq', zipPath, '-d', dest], { encoding: 'utf8' });
  if (unzip.error || unzip.status !== 0) {
    throw new Error(
      `unzip 실패: ${unzip.error ? unzip.error.message : unzip.stderr || unzip.status}\n` +
        `압축 파일은 ${zipPath} 에 있습니다.`,
    );
  }

  const root = path.join(dest, 'c');
  const verified = [];
  for (const file of info.files) {
    const filePath = path.join(dest, file.path);
    if (!fs.existsSync(filePath)) {
      throw new Error(`압축에 ${file.path} 가 없습니다`);
    }
    const actual = sha256OfFile(filePath);
    const ok = actual === file.sha256;
    verified.push({ path: file.path, expected: file.sha256, actual, ok });
    if (!ok) {
      throw new Error(`SHA-256 불일치: ${file.path} (기대 ${file.sha256}, 실제 ${actual})`);
    }
  }

  return {
    platform,
    kind,
    version: manifest.version,
    root,
    header: path.join(root, 'include', 'licensehub_core.h'),
    library: path.join(dest, info.files[0].path),
    pkgconfig_path: path.join(root, 'lib', platform, 'pkgconfig'),
    pkgconfig_library: info.pkgconfig_library,
    cmake_prefix: root,
    cmake_target: info.cmake_target,
    sha256_verified: verified,
    notes: info.notes,
  };
}

//--------------------------------------------------------------------------------
// 로컬 코어 스모크 테스트
//--------------------------------------------------------------------------------
function findTestDataDir() {
  const candidates = [
    path.join(REPO_ROOT, 'bindings', 'testdata'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function verifyLocalModule(args) {
  const manifest = await loadCoreManifest();
  const platform = args.platform || currentPlatform();
  if (!platform) throw new Error('현재 플랫폼을 알 수 없습니다. platform 을 지정하세요.');

  const report = { platform, checks: [], ok: false };
  const push = (name, ok, detail) => {
    report.checks.push({ name, ok, detail });
    if (!ok) report.ok = false;
  };

  const headerPath = (() => {
    const local = path.join(REPO_ROOT, 'core', 'dist', platform, 'include', 'licensehub_core.h');
    if (fs.existsSync(local)) return local;
    const vendored = path.join('vendor', 'licensehub-core', 'c', 'include', 'licensehub_core.h');
    return fs.existsSync(vendored) ? vendored : null;
  })();

  if (!headerPath) {
    push('header', false, 'licensehub_core.h 를 찾지 못했습니다');
    return report;
  }
  push('header', true, headerPath);

  const headerText = fs.readFileSync(headerPath, 'utf8');
  const declared = {};
  const enumMatch = headerText.match(/enum\s+lh_verification_code\s*\{([\s\S]*?)\}/);
  if (enumMatch) {
    for (const line of enumMatch[1].split('\n')) {
      const m = line.match(/^\s*(LH_[A-Z_]+)\s*=\s*(\d+)/);
      if (m) declared[m[1]] = Number(m[2]);
    }
  }
  const expected = Object.fromEntries(
    Object.entries(manifest.verification_codes || {}).map(([k, v]) => [
      `LH_${k.toUpperCase()}`,
      v,
    ]),
  );
  const codesOk =
    Object.keys(expected).length > 0 &&
    Object.keys(expected).every((key) => declared[key] === expected[key]);
  push(
    'verification_codes',
    codesOk,
    codesOk ? '헤더와 매니페스트의 코드 값이 일치합니다' : JSON.stringify({ declared, expected }),
  );

  const libEntry = (manifest.platforms[platform] || {}).static;
  if (!libEntry) {
    push('static_library', false, `${platform} 에 정적 라이브러리가 없습니다`);
    return report;
  }
  const localLib = path.join(REPO_ROOT, 'core', 'dist', platform, libEntry.path);
  const vendoredLib = path.join('vendor', 'licensehub-core', libEntry.path);
  const libPath = fs.existsSync(localLib)
    ? localLib
    : fs.existsSync(vendoredLib)
      ? vendoredLib
      : null;
  if (!libPath) {
    push('static_library', false, '정적 라이브러리를 찾지 못했습니다 (core_module 먼저 실행)');
    return report;
  }
  const libHash = sha256OfFile(libPath);
  const hashOk = libHash === libEntry.sha256;
  push(
    'static_library',
    hashOk,
    hashOk
      ? `${libPath} (SHA-256 일치)`
      : `SHA-256 불일치: 기대 ${libEntry.sha256}, 실제 ${libHash}`,
  );

  const testData = findTestDataDir();
  if (!testData) {
    push('smoke_test', false, 'bindings/testdata 를 찾지 못했습니다');
    return report;
  }

  const cc = process.env.CC || 'cc';
  const probe = spawnSync(cc, ['--version'], { encoding: 'utf8' });
  if (probe.error) {
    push('smoke_test', true, `${cc} 가 없어 컴파일 검사를 건너뜁니다 (로드 검사만)`);
    return report;
  }

  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'lh-mcp-'));
  const source = path.join(tmp, 'smoke.c');
  const binary = path.join(tmp, 'smoke');
  fs.writeFileSync(
    source,
    [
      '#include <stdio.h>',
      '#include "licensehub_core.h"',
      'int main(void) {',
      '    printf("%u\\n", (unsigned)LH_CHAIN_INVALID);',
      '    return 0;',
      '}',
    ].join('\n'),
  );

  const includeDir = path.dirname(headerPath);
  const extra =
    process.platform === 'darwin'
      ? ['-framework', 'Security', '-framework', 'CoreFoundation', '-liconv']
      : ['-lpthread', '-ldl', '-lm'];
  const compile = spawnSync(
    cc,
    [source, `-I${includeDir}`, libPath, ...extra, '-o', binary],
    { encoding: 'utf8' },
  );
  if (compile.status !== 0) {
    push('smoke_test', false, `컴파일 실패: ${compile.stderr || compile.status}`);
    return report;
  }
  const run = spawnSync(binary, [], { encoding: 'utf8' });
  const ran = run.status === 0 && run.stdout.trim() === '12';
  push(
    'smoke_test',
    ran,
    ran ? '정적 링크한 테스트 바이너리가 LH_CHAIN_INVALID=12 를 출력했습니다' : (run.stderr || run.stdout),
  );

  fs.rmSync(tmp, { recursive: true, force: true });

  report.ok = report.checks.every((check) => check.ok);
  return report;
}

const CREATE_FIELDS = [
  'license_id',
  'product',
  'version',
  'level',
  'holder',
  'expires_at',
  'status',
  'target_language',
  'application_public_key',
  'verification_url',
  'metadata',
];

async function callTool(name, args, ctx) {
  const callBackend = async (method, path, body) => {
    const token = ctx.useServerAuth ? await serverSideToken() : ctx.token;
    try {
      return await backend(method, path, { body, auth: true, token });
    } catch (e) {
      // 서버 측 토큰이 만료됐으면 한 번 재로그인한다.
      if (ctx.useServerAuth && /^401:/.test(e.message)) {
        serverToken = null;
        return backend(method, path, { body, auth: true, token: await serverSideToken() });
      }
      throw e;
    }
  };

  switch (name) {
    case 'generate_keypair':
      return generateKeypair();

    case 'public_key':
      return backend('GET', '/api/public-key');

    case 'list_licenses':
      return callBackend('GET', '/api/licenses');

    case 'create_license': {
      const payload = {};
      for (const key of CREATE_FIELDS) {
        if (args[key] !== undefined && args[key] !== null) payload[key] = args[key];
      }
      return callBackend('POST', '/api/licenses', payload);
    }

    case 'issue_license': {
      const id = Number(args.id);
      if (!Number.isInteger(id)) throw new Error('id 는 정수여야 합니다');
      return callBackend('POST', '/api/licenses/' + id + '/issue');
    }

    case 'download_license': {
      const id = Number(args.id);
      if (!Number.isInteger(id)) throw new Error('id 는 정수여야 합니다');
      if (args.save_path && ctx.transport === 'http') {
        throw new Error(
          '원격(HTTP) 모드에서는 save_path를 쓸 수 없습니다. 반환된 JSON을 클라이언트에서 저장하세요.',
        );
      }
      const data = await callBackend('GET', '/api/licenses/' + id + '/license');
      if (args.save_path) {
        fs.writeFileSync(args.save_path, JSON.stringify(data, null, 2));
        return { saved: args.save_path, bytes: fs.statSync(args.save_path).size };
      }
      return data;
    }

    case 'verify_license': {
      if (!args.license_id) throw new Error('license_id 가 필요합니다');
      return backend('POST', '/api/verify', {
        headers: { 'x-licensehub-key': VERIFY_KEY },
        body: { license_id: args.license_id },
      });
    }

    case 'core_manifest': {
      const manifest = await loadCoreManifest({ refresh: Boolean(args.refresh) });
      return {
        source: manifest._source,
        version: manifest.version,
        schema_version: manifest.schema_version,
        platforms: platformKeys(manifest),
        verification_codes: manifest.verification_codes,
        cmake: manifest.cmake,
        pkgconfig: manifest.pkgconfig,
        usage: manifest.usage,
        release: manifest.release || null,
        platform_detail: manifest.platforms,
      };
    }

    case 'core_module':
      return await fetchCoreModule(args);

    case 'integration_snippet': {
      let manifest = null;
      try {
        manifest = await loadCoreManifest();
      } catch {
        // 매니페스트가 없어도 골격은 만들 수 있다.
      }

      const result = buildSnippet(args);
      const platform = args.platform || currentPlatform();
      if (manifest && platform) {
        try {
          result.core = coreModuleInfo(manifest, platform, result.link_kind);
        } catch (error) {
          result.core = null;
          result.core_error = error.message;
          result.available_platforms = platformKeys(manifest);
          const actual = currentPlatform();
          if (actual) {
            result.core = coreModuleInfo(manifest, actual, result.link_kind);
            result.platform = actual;
            result.core_error += ` (현재 플랫폼 ${actual} 기준으로 경로를 채웠습니다)`;
          }
        }
        // 헤더 주석의 빌드 명령을 실제 경로로 채운다.
        result.snippet = result.snippet.replace(
          /^\/\* LicenseHub 검증 통합[\s\S]*?\*\//,
          staticIntro(args, manifest, result.platform || platform, result.link_kind),
        );
      } else if (manifest) {
        result.available_platforms = platformKeys(manifest);
      }
      return result;
    }

    case 'verify_local_module':
      return await verifyLocalModule(args);

    default:
      throw new Error('알 수 없는 도구: ' + name);
  }
}

//--------------------------------------------------------------------------------
// JSON-RPC 처리 (stdio / HTTP 공용)
//--------------------------------------------------------------------------------
async function handleRpc(message, ctx) {
  const { id, method, params } = message || {};
  if (method === undefined || typeof method !== 'string') return null;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: (params && params.protocolVersion) || DEFAULT_PROTOCOL,
        capabilities: { tools: {}, prompts: {}, resources: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: INSTRUCTIONS,
      },
    };
  }

  if (method.startsWith('notifications/')) return null;

  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };

  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools } };

  if (method === 'prompts/list') return { jsonrpc: '2.0', id, result: { prompts } };

  if (method === 'prompts/get') {
    const name = params && params.name;
    if (name !== 'licensehub-integration') {
      return { jsonrpc: '2.0', id, error: { code: -32602, message: 'unknown prompt: ' + name } };
    }
    const args = (params && params.arguments) || {};
    const lines = Object.entries(args).map(([k, v]) => '- ' + k + ': ' + v);
    const text =
      INTEGRATION_GUIDE + (lines.length ? '\n\n## 이번 작업 입력값\n' + lines.join('\n') : '');
    return {
      jsonrpc: '2.0',
      id,
      result: {
        description: 'LicenseHub 통합 절차',
        messages: [{ role: 'user', content: { type: 'text', text } }],
      },
    };
  }

  if (method === 'resources/list') return { jsonrpc: '2.0', id, result: { resources } };

  if (method === 'resources/templates/list') {
    return { jsonrpc: '2.0', id, result: { resourceTemplates: [] } };
  }

  if (method === 'resources/read') {
    const uri = params && params.uri;
    if (uri !== 'licensehub://integration') {
      return { jsonrpc: '2.0', id, error: { code: -32602, message: 'unknown resource: ' + uri } };
    }
    return {
      jsonrpc: '2.0',
      id,
      result: { contents: [{ uri, mimeType: 'text/markdown', text: INTEGRATION_GUIDE }] },
    };
  }

  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    try {
      const result = await callTool(name, args, ctx);
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } };
    } catch (e) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: '오류: ' + (e && e.message ? e.message : String(e)) }],
          isError: true,
        },
      };
    }
  }

  if (id !== undefined && id !== null) {
    return { jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found: ' + method } };
  }
  return null;
}

//--------------------------------------------------------------------------------
// stdio 전송
//--------------------------------------------------------------------------------
function startStdio() {
  if (!BASE) log('경고: LICENSEHUB_URL 이 없습니다. 네트워크 도구는 실패합니다.');
  const ctx = {
    token: ENV_TOKEN,
    transport: 'stdio',
    useServerAuth: Boolean(!ENV_TOKEN && ADMIN_USER && ADMIN_PASS),
  };
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      log('JSON 파싱 실패:', trimmed.slice(0, 120));
      return;
    }
    Promise.resolve()
      .then(() => handleRpc(message, ctx))
      .then((response) => {
        if (response) process.stdout.write(JSON.stringify(response) + '\n');
      })
      .catch((e) => log('처리 오류:', e && e.message ? e.message : String(e)));
  });
}

//--------------------------------------------------------------------------------
// Streamable HTTP 전송
//--------------------------------------------------------------------------------
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'authorization, content-type, mcp-session-id, mcp-protocol-version',
  );
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
}

function sendJson(res, status, payload, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...extra });
  res.end(JSON.stringify(payload));
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('요청 본문이 너무 큽니다'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function startHttp() {
  const server = http.createServer(async (req, res) => {
    setCors(res);

    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return sendJson(res, 400, { error: 'bad url' });
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === '/healthz') {
      return sendJson(res, 200, {
        ok: true,
        server: SERVER_NAME,
        version: SERVER_VERSION,
        transport: 'http',
        tools: tools.length,
        auth: REQUIRE_AUTH,
      });
    }

    if (url.pathname !== MCP_PATH) {
      return sendJson(res, 404, { error: 'not found' });
    }

    // 원격에서는 SSE 스트림을 제공하지 않는다(MCP 스펙상 405 허용).
    if (req.method === 'GET' || req.method === 'DELETE') {
      return sendJson(
        res,
        405,
        { jsonrpc: '2.0', error: { code: -32000, message: 'SSE stream is not supported' } },
        { allow: 'POST, OPTIONS' },
      );
    }

    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'method not allowed' }, { allow: 'POST, OPTIONS' });
    }

    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const requireAuth = REQUIRE_AUTH || Boolean(MCP_ACCESS_KEY);
    if (requireAuth && !token) {
      return sendJson(
        res,
        401,
        { jsonrpc: '2.0', error: { code: -32001, message: 'unauthorized: Bearer 토큰이 필요합니다' } },
        { 'www-authenticate': 'Bearer' },
      );
    }
    if (MCP_ACCESS_KEY && token !== MCP_ACCESS_KEY) {
      return sendJson(
        res,
        401,
        { jsonrpc: '2.0', error: { code: -32001, message: 'unauthorized: 잘못된 액세스 키입니다' } },
        { 'www-authenticate': 'Bearer' },
      );
    }

    let raw;
    try {
      raw = await readBody(req);
    } catch (e) {
      return sendJson(res, 413, { jsonrpc: '2.0', error: { code: -32600, message: e.message } });
    }

    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return sendJson(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'parse error' } });
    }

    const ctx = { token, transport: 'http', useServerAuth: Boolean(MCP_ACCESS_KEY) };

    if (Array.isArray(message)) {
      const out = [];
      for (const item of message) {
        const response = await handleRpc(item, ctx);
        if (response) out.push(response);
      }
      return sendJson(res, 200, out);
    }

    const response = await handleRpc(message, ctx);
    if (response === null) {
      res.writeHead(202);
      res.end();
      return;
    }
    return sendJson(res, 200, response);
  });

  server.listen(MCP_PORT, MCP_HOST, () => {
    log(
      `HTTP listening on http://${MCP_HOST}:${MCP_PORT}${MCP_PATH} ` +
        `(auth ${REQUIRE_AUTH ? 'on' : 'off'})`,
    );
  });
  server.on('error', (e) => {
    log('HTTP server error:', e.message);
    process.exit(1);
  });
}

if (TRANSPORT === 'http') startHttp();
else startStdio();
