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

const { generateKeyPairSync } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
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
5) 통합: 핵심 로직을 분리하고 lh_decrypt_verify_trusted_license(L1) 또는 ..._online(L2)로 검증.
   rc==0 && code==LH_VALID 일 때만 활성화(fail-closed). PEM을 raw 32바이트로 변환해 전달.
6) 테스트: 성공/실패(라이선스 없음·변조·만료·L2 다운) 경로를 모두 확인.

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

## 4. 응용 프로그램 통합
- 핵심 로직을 별도 모듈로 분리한다.
- 시작 시 검증한다.
  C ABI: lh_decrypt_verify_trusted_license(lic, len, app_pri_raw32, 32, context_json, ctx_len, &code)
  L2:    lh_decrypt_verify_trusted_license_online(...)
- rc==0 && code==LH_VALID 일 때만 활성화한다. 그 외는 모두 비활성.
- context JSON 필드: now, product, version, product_id, executable_name, application_id, target_language, server_status("approved"|"rejected"), blacklisted, revoked.
- PEM을 C ABI에 그대로 넘기지 말고 raw 32바이트로 변환한다.

## 5. 검증/테스트
- 성공 경로와 실패 경로(라이선스 없음/변조/만료/L2 서버 다운)를 모두 테스트한다.
- 모든 실패에서 핵심 로직이 꺼져 있어야 한다.

## 6. 금지
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
