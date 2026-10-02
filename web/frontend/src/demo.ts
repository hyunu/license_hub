// 백엔드 없이 프론트만 확인할 수 있는 데모 모드용 목 데이터.
// API_BASE_URL 이 비어 있으면(VITE_DEMO_MODE=true 포함) 데모 데이터를 반환한다.

import type { BlacklistEntry, AuditEntry, License, Stats, User } from './api'

let seq = 100

function now(): string {
  return new Date().toISOString()
}

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

export function demoIssueCertificate(id: number): { certificate: Record<string, unknown>; certificate_id: string } {
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
    issued_at: '2026-01-01T00:00:00Z',
    expires_at: lic?.expires_at ?? '2027-01-01T00:00:00Z',
    issuer: 'LicenseHub',
    signature_algorithm: 'Ed25519',
    key_id: 'license-signing-key',
    signature: 'DEMO-SIGNATURE-' + certificateId,
  }
  demoAudit.unshift({ id: seq + 2000, actor: 'admin', action: 'certificate.issue', target: lic?.license_id ?? null, detail: certificateId, created_at: now() })
  return { certificate: cert, certificate_id: certificateId }
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