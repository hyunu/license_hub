#!/usr/bin/env node
'use strict';

/*
 * LicenseHub MCP 서버 (stdio, 의존성 없음)
 *
 * 에이전트가 LicenseHub를 "도구 호출"로 직접 사용할 수 있게 한다.
 *  - generate_keypair : App 키쌍(Ed25519) 로컬 생성
 *  - public_key       : 발급 서버 공개키 조회
 *  - list_licenses    : 라이선스 목록
 *  - create_license   : 라이선스 생성
 *  - issue_license    : 인증서 발급 + 암호화 라이선스 생성
 *  - download_license : 암호화 라이선스 조회/저장
 *  - verify_license   : 서버 기준 라이선스 상태 확인(L2)
 *
 * 환경변수:
 *  - LICENSEHUB_URL         (필수) 예: https://licensehub.example.com
 *  - LICENSEHUB_TOKEN       (선택) 로그인으로 받은 Bearer 토큰
 *  - LICENSEHUB_VERIFY_KEY  (선택) L2 검증 키 (기본값은 core 상수와 동일)
 *
 * stdout 은 JSON-RPC 전용이다. 로그는 반드시 stderr 로 보낸다.
 */

const { generateKeyPairSync } = require('node:crypto');
const fs = require('node:fs');
const readline = require('node:readline');

const SERVER_NAME = 'licensehub';
const SERVER_VERSION = '0.1.0';
const DEFAULT_PROTOCOL = '2024-11-05';

const BASE = (process.env.LICENSEHUB_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.LICENSEHUB_TOKEN || '';
// core/src/lib.rs 의 VERIFY_API_KEY 와 동일한 고정 키. 필요하면 env 로 재정의한다.
const VERIFY_KEY =
  process.env.LICENSEHUB_VERIFY_KEY || 'a9e54925-1acb-4214-8b2a-38616c561b96';

function log(...args) {
  console.error('[licensehub-mcp]', ...args);
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function ok(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function rpcError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function http(method, path, options = {}) {
  if (!BASE) throw new Error('LICENSEHUB_URL 이 설정되지 않았습니다');
  const { body, headers = {}, auth = false } = options;

  const h = { ...headers };
  if (auth) {
    if (!TOKEN) throw new Error('LICENSEHUB_TOKEN 이 설정되지 않았습니다');
    h['Authorization'] = 'Bearer ' + TOKEN;
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

const tools = [
  {
    name: 'generate_keypair',
    description:
      '응용 프로그램용 Ed25519 키쌍(App_Pub/App_Pri)을 로컬에서 생성한다. ' +
      '개인키는 네트워크로 나가지 않는다. C ABI 에는 raw 32바이트(private_key_hex)를 넘긴다.',
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
      '암호화 라이선스(JSON)를 조회한다. save_path 를 주면 해당 경로에 파일로 저장한다.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        save_path: { type: 'string', description: '저장할 파일 경로(선택)' },
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

async function callTool(name, args) {
  switch (name) {
    case 'generate_keypair':
      return generateKeypair();

    case 'public_key':
      return http('GET', '/api/public-key');

    case 'list_licenses':
      return http('GET', '/api/licenses', { auth: true });

    case 'create_license': {
      const payload = {};
      for (const key of CREATE_FIELDS) {
        if (args[key] !== undefined && args[key] !== null) payload[key] = args[key];
      }
      return http('POST', '/api/licenses', { body: payload, auth: true });
    }

    case 'issue_license': {
      const id = Number(args.id);
      if (!Number.isInteger(id)) throw new Error('id 는 정수여야 합니다');
      return http('POST', '/api/licenses/' + id + '/issue', { auth: true });
    }

    case 'download_license': {
      const id = Number(args.id);
      if (!Number.isInteger(id)) throw new Error('id 는 정수여야 합니다');
      const data = await http('GET', '/api/licenses/' + id + '/license', { auth: true });
      if (args.save_path) {
        fs.writeFileSync(args.save_path, JSON.stringify(data, null, 2));
        return { saved: args.save_path, bytes: fs.statSync(args.save_path).size };
      }
      return data;
    }

    case 'verify_license': {
      if (!args.license_id) throw new Error('license_id 가 필요합니다');
      return http('POST', '/api/verify', {
        headers: { 'x-licensehub-key': VERIFY_KEY },
        body: { license_id: args.license_id },
      });
    }

    default:
      throw new Error('알 수 없는 도구: ' + name);
  }
}

async function dispatch(message) {
  const { id, method, params } = message || {};
  if (method === undefined) return; // 응답 메시지는 무시

  if (method === 'initialize') {
    return ok(id, {
      protocolVersion: (params && params.protocolVersion) || DEFAULT_PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    });
  }

  if (typeof method === 'string' && method.startsWith('notifications/')) return;

  if (method === 'ping') return ok(id, {});

  if (method === 'tools/list') return ok(id, { tools });

  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    try {
      const result = await callTool(name, args);
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return ok(id, { content: [{ type: 'text', text }] });
    } catch (e) {
      return ok(id, {
        content: [{ type: 'text', text: '오류: ' + (e && e.message ? e.message : String(e)) }],
        isError: true,
      });
    }
  }

  if (id !== undefined && id !== null) {
    rpcError(id, -32601, 'method not found: ' + method);
  }
}

function main() {
  if (!BASE) log('경고: LICENSEHUB_URL 이 없습니다. 네트워크 도구는 실패합니다.');
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
      .then(() => dispatch(message))
      .catch((e) => log('처리 오류:', e && e.message ? e.message : String(e)));
  });
}

main();
