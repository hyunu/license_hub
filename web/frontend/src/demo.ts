// 백엔드 없이 프론트만 확인할 수 있는 데모 모드용 목 데이터.
// API_BASE_URL 이 비어 있으면(VITE_DEMO_MODE=true 포함) 데모 데이터를 반환한다.

import type { BlacklistEntry, AuditEntry, License, Stats, User } from './api'

let seq = 100

function now(): string {
  return new Date().toISOString()
}

// 데모용 AK2(Z_Pub) 예시 값. 실제 운영에서는 Application 이 Z_Pri 와 함께
// 제공해야 하며, 서버는 이 공개키로만 P를 암호화한다.
const DEMO_AK2_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA0M2VbFmvMEfM0mHIvbjJDlXhcHnRIcHwtLbOwtCQUzMxLcTt
oJ+GZ2Q1Yh0Yl0l8nS0a9Xk0CkL8Q0m1oE1nJ2CkL3wR8kY5pQ0m0Xk0CkL8Q0m1o
E1nJ2CkL3wR8kY5pQ0m0Xk0CkL8Q0m1oE1nJ2CkL3wR8kY5pQ0m0Xk0CkL8Q0m1o
-----END PUBLIC KEY-----`

// RS-7: Application ID는 수동 입력이 아니라 AK2 에서 도출한다.
const DEMO_APP_ID = '1-4bKc9xQmL2pT7vRzY0dNf8W3sH6gJ1aEuX5iOyC'

export const demoLicenses: License[] = [
  {
    id: 1,
    license_id: 'LIC-0001',
    product: 'SampleProduct',
    version: '1.2.0',
    level: 1,
    holder: 'ACME',
    device_id: null,
    expires_at: '2027-01-01T00:00:00Z',
    status: 'active',
    created_at: now(),
    certificates: 1,
    target_language: 'cpp',
    application_public_key: DEMO_AK2_PEM,
    application_id: DEMO_APP_ID,
    encrypted_license: { schema_version: 1, key_id: 'license-signing-key', encrypted_for: DEMO_APP_ID },
  },
  {
    id: 2,
    license_id: 'LIC-0002',
    product: 'SampleProduct',
    version: '1.2.0',
    level: 3,
    holder: 'BetaCorp',
    device_id: 'device-aaa',
    expires_at: '2027-01-01T00:00:00Z',
    status: 'active',
    created_at: now(),
    certificates: 2,
    target_language: 'csharp',
    application_public_key: DEMO_AK2_PEM,
    application_id: DEMO_APP_ID,
    encrypted_license: { schema_version: 1, key_id: 'license-signing-key', encrypted_for: DEMO_APP_ID },
  },
  {
    id: 3,
    license_id: 'LIC-0003',
    product: 'SampleProduct',
    version: '1.1.0',
    level: 2,
    holder: 'Gamma',
    device_id: null,
    expires_at: '2026-06-01T00:00:00Z',
    status: 'blacklisted',
    created_at: now(),
    certificates: 0,
    target_language: null,
    application_public_key: null,
    application_id: null,
    encrypted_license: null,
  },
]

export const demoUsers: User[] = [
  { id: 1, username: 'admin', role: 'admin', created_at: now() },
  { id: 2, username: 'operator', role: 'operator', created_at: now() },
]

export const demoBlacklist: BlacklistEntry[] = [
  { license_id: 'LIC-0003', reason: 'unpaid', created_at: now() },
]

export const demoAudit: AuditEntry[] = [
  { id: 1, actor: 'admin', action: 'login', target: null, detail: null, created_at: now() },
  { id: 2, actor: 'admin', action: 'certificate.issue', target: 'LIC-0001', detail: 'CERT-001', created_at: now() },
  { id: 3, actor: 'admin', action: 'blacklist.add', target: 'LIC-0003', detail: 'unpaid', created_at: now() },
]

export function demoStats(): Stats {
  return {
    users: demoUsers.length,
    licenses: demoLicenses.length,
    active: demoLicenses.filter((l) => l.status === 'active').length,
    revoked: demoLicenses.filter((l) => l.status === 'revoked').length,
    blacklisted: demoLicenses.filter((l) => l.status === 'blacklisted').length,
    certificates: demoLicenses.length,
    audit: demoAudit.length,
  }
}

export function demoLicensesByStatus(status?: string): License[] {
  return status ? demoLicenses.filter((l) => l.status === status) : demoLicenses
}

export function demoCreateLicense(body: Record<string, unknown>): License {
  seq += 1
  const licenseId = String(body.license_id ?? '').trim() || demoLicenseId()
  const ak2 = String(body.application_public_key ?? '').trim()
  const lic: License = {
    id: seq,
    license_id: licenseId,
    product: String(body.product),
    version: String(body.version),
    level: Number(body.level),
    holder: String(body.holder),
    device_id: body.device_id ? String(body.device_id) : null,
    expires_at: String(body.expires_at),
    status: 'active',
    created_at: now(),
    certificates: 0,
    target_language: String(body.target_language ?? '').trim() || null,
    application_public_key: ak2 || null,
    application_id: ak2 ? DEMO_APP_ID : null,
    encrypted_license: null,
  }
  demoLicenses.unshift(lic)
  demoAudit.unshift({ id: seq + 1000, actor: 'admin', action: 'license.create', target: lic.license_id, detail: null, created_at: now() })
  return lic
}

// 시스템 자동 생성 License ID (예: XXXX-XXXX)
function demoLicenseId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return `${s.slice(0, 4)}-${s.slice(4)}`
}

export function demoIssueCertificate(id: number): {
  certificate: Record<string, unknown>
  certificate_id: string
  encrypted_license: Record<string, unknown> | null
  application_id: string | null
  target_language: string
} {
  const lic = demoLicenses.find((l) => l.id === id)
  const level = lic?.level ?? 1
  const certificateId = `CERT-${seq++}`
  const cert: Record<string, unknown> = {
    schema_version: 1,
    certificate_id: certificateId,
    license_id: lic?.license_id ?? `LIC-${id}`,
    level,
    product: lic?.product ?? 'SampleProduct',
    version: lic?.version ?? '1.0.0',
    application_id: lic?.application_id ?? undefined,
    target_language: lic?.target_language ?? 'any',
    issued_at: '2026-01-01T00:00:00Z',
    expires_at: lic?.expires_at ?? '2027-01-01T00:00:00Z',
    issuer: 'LicenseHub',
    signature_algorithm: 'Ed25519',
    key_id: 'license-signing-key',
    signature: 'DEMO-SIGNATURE-' + certificateId,
  }
  if (lic) lic.certificates += 1

  // AK2가 있을 때만 P를 LH_Pri로 서명한 뒤 AK2로 암호화한 LIC를 만든다.
  let encrypted: Record<string, unknown> | null = null
  if (lic?.application_public_key) {
    encrypted = demoEncryptedLicense(certificateId)
    lic.encrypted_license = {
      schema_version: 1,
      key_id: 'license-signing-key',
      encrypted_for: lic.application_id ?? '',
    }
  }
  demoAudit.unshift({ id: seq + 2000, actor: 'admin', action: 'certificate.issue', target: lic?.license_id ?? null, detail: certificateId, created_at: now() })
  return {
    certificate: cert,
    certificate_id: certificateId,
    encrypted_license: encrypted,
    application_id: lic?.application_id ?? null,
    target_language: lic?.target_language ?? 'any',
  }
}

// 이미지의 LIC: P 원문은 ciphertext 안에만 존재한다.
export function demoEncryptedLicense(certificateId = 'CERT-DEMO'): Record<string, unknown> {
  return {
    schema_version: 1,
    key_id: 'license-signing-key',
    ephemeral_public_key: 'DEMO-EPHEMERAL-PUBLIC-KEY',
    nonce: 'DEMO-AES-GCM-NONCE',
    ciphertext: 'BASE64-CIPHERTEXT-' + certificateId,
    signature: 'BASE64-LHPRI-SIGNATURE',
  }
}

export function demoSetStatus(id: number, status: string): void {
  const lic = demoLicenses.find((l) => l.id === id)
  if (lic) lic.status = status
}

export function demoCreateUser(body: { username: string; password: string; role?: string }): void {
  demoUsers.push({ id: seq + 3000, username: body.username, role: body.role ?? 'admin', created_at: now() })
}

export function demoAddBlacklist(licenseId: string, reason: string): void {
  demoBlacklist.unshift({ license_id: licenseId, reason, created_at: now() })
  const lic = demoLicenses.find((l) => l.license_id === licenseId)
  if (lic) lic.status = 'blacklisted'
}

export function demoRemoveBlacklist(licenseId: string): void {
  const idx = demoBlacklist.findIndex((e) => e.license_id === licenseId)
  if (idx >= 0) demoBlacklist.splice(idx, 1)
  const lic = demoLicenses.find((l) => l.license_id === licenseId)
  if (lic) lic.status = 'active'
}

export function demoPublicKey() {
  return {
    key_id: 'license-signing-key',
    algorithm: 'Ed25519',
    hex: '7f9c2ba4e0f391b7d8c5a6... (demo)',
    pem: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAwEBA... (demo)\n-----END PUBLIC KEY-----',
  }
}