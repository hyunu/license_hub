import { demoAddBlacklist, demoAudit, demoBlacklist, demoCreateLicense, demoCreateUser, demoEncryptedLicense, demoIssueCertificate, demoLicenses, demoLicensesByStatus, demoPublicKey, demoRemoveBlacklist, demoSetStatus, demoStats, demoUsers } from './demo'

export interface User {
  id: number
  username: string
  role: string
  created_at: string
}

export interface EncryptedLicenseInfo {
  schema_version: number
  key_id: string
  encrypted_for: string
}

export interface License {
  id: number
  license_id: string
  product: string
  version: string
  level: number
  holder: string
  device_id: string | null
  expires_at: string
  status: string
  created_at: string
  certificates: number
  target_language: string | null
  application_public_key: string | null
  application_id: string | null
  encrypted_license: EncryptedLicenseInfo | null
}

export interface BlacklistEntry {
  license_id: string
  reason: string
  created_at: string
}

export interface AuditEntry {
  id: number
  actor: string
  action: string
  target: string | null
  detail: string | null
  created_at: string
}

export interface Stats {
  users: number
  licenses: number
  active: number
  revoked: number
  blacklisted: number
  certificates: number
  audit: number
}

const BASE: string = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''

// 백엔드 URL이 설정되지 않았거나 VITE_DEMO_MODE=true 이면 데모 모드로 동작해
// 목 데이터로 UI를 확인할 수 있다 (GitHub Pages 배포본 등).
export const DEMO: boolean =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) === '' ||
  (import.meta.env.VITE_DEMO_MODE as string | undefined) === 'true'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function demoRoute<T>(path: string, options: RequestInit): Promise<T> {
  const method = options.method ?? 'GET'
  const [basePath, queryStr] = path.split('?')
  const query = new URLSearchParams(queryStr ?? '')
  const body = options.body ? (JSON.parse(options.body as string) as Record<string, unknown>) : undefined

  if (basePath === '/api/auth/login') {
    return Promise.resolve({
      token: 'demo-token',
      user: { id: 1, username: String(body?.username ?? 'demo'), role: 'admin' },
    } as T)
  }
  if (basePath === '/api/auth/logout') return Promise.resolve({ ok: true } as T)
  if (basePath === '/api/stats') return Promise.resolve(demoStats() as T)
  if (basePath === '/api/public-key') return Promise.resolve(demoPublicKey() as T)

  if (basePath === '/api/licenses' && method === 'GET') {
    return Promise.resolve(demoLicensesByStatus(query.get('status') ?? undefined) as T)
  }
  if (basePath === '/api/licenses' && method === 'POST') {
    return Promise.resolve(demoCreateLicense(body ?? {}) as T)
  }
  if (basePath.startsWith('/api/licenses/') && basePath.endsWith('/issue')) {
    return Promise.resolve(demoIssueCertificate(Number(basePath.split('/')[3])) as T)
  }
  if (basePath.startsWith('/api/licenses/') && basePath.endsWith('/license')) {
    return Promise.resolve(demoEncryptedLicense() as T)
  }
  if (basePath.startsWith('/api/licenses/') && basePath.endsWith('/application-public-key/download')) {
    return Promise.resolve(undefined as T)
  }
  if (basePath.startsWith('/api/licenses/') && basePath.endsWith('/status')) {
    demoSetStatus(Number(basePath.split('/')[3]), String(body?.status ?? 'active'))
    return Promise.resolve({ ok: true } as T)
  }

  if (basePath === '/api/users' && method === 'GET') return Promise.resolve(demoUsers as T)
  if (basePath === '/api/users' && method === 'POST') {
    demoCreateUser(body as { username: string; password: string; role?: string })
    return Promise.resolve({ ok: true } as T)
  }

  if (basePath === '/api/blacklist' && method === 'GET') return Promise.resolve(demoBlacklist as T)
  if (basePath === '/api/blacklist' && method === 'POST') {
    demoAddBlacklist(String(body?.license_id ?? ''), String(body?.reason ?? ''))
    return Promise.resolve({ ok: true } as T)
  }
  if (basePath.startsWith('/api/blacklist/') && method === 'DELETE') {
    demoRemoveBlacklist(decodeURIComponent(basePath.split('/')[3]))
    return Promise.resolve({ ok: true } as T)
  }

  if (basePath === '/api/audit') return Promise.resolve(demoAudit as T)
  if (basePath === '/api/sync/status') return Promise.resolve({ configured: false, repo: null } as T)
  if (basePath.startsWith('/api/sync/')) {
    return Promise.resolve({ ok: true, pushed: demoLicenses.length } as T)
  }

  return Promise.resolve({} as T)
}

async function request<T>(path: string, options: RequestInit = {}, auth = true): Promise<T> {
  if (DEMO) return demoRoute<T>(path, options)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) ?? {}),
  }
  if (auth) {
    const token = localStorage.getItem('lh_token')
    if (token) headers['Authorization'] = `Bearer ${token}`
  }
  const res = await fetch(BASE + path, { ...options, headers })
  if (res.status === 401 && auth) {
    localStorage.removeItem('lh_token')
    window.location.hash = '#/login'
    throw new ApiError(401, 'unauthorized')
  }
  if (!res.ok) {
    let msg = res.statusText
    try {
      const j = await res.json()
      if (j?.error) msg = j.error
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  login: (username: string, password: string) =>
    request<{ token: string; user: { id: number; username: string; role: string } }>(
      '/api/auth/login',
      { method: 'POST', body: JSON.stringify({ username, password }) },
      false,
    ),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  me: () => request<User>('/api/me'),
  stats: () => request<Stats>('/api/stats'),
  publicKey: () => request<{ key_id: string; algorithm: string; hex: string; pem: string }>('/api/public-key', {}, false),

  licenses: (status?: string) =>
    request<License[]>(`/api/licenses${status ? `?status=${status}` : ''}`),
  // 생성·발급 응답에만 나타난다. 공개키를 비워서 서버가 키쌍을 만들었을 때
  // 개인키가 한 번 내려오고, 이후에는 다시 받을 수 없다. 목록 응답에는 없다.
  createLicense: (body: Record<string, unknown>) =>
    request<License & { application_private_key?: string; application_key_generated?: boolean }>(
      '/api/licenses',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  issue: (id: number) =>
    request<{
      certificate: Record<string, unknown>
      certificate_id: string
      encrypted_license: Record<string, unknown> | null
      application_id: string | null
      target_language: string
      application_private_key?: string | null
      application_key_generated?: boolean
    }>(`/api/licenses/${id}/issue`, { method: 'POST' }),
  setStatus: (id: number, status: string) =>
    request<{ ok: boolean }>(`/api/licenses/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),

  users: () => request<User[]>('/api/users'),
  createUser: (body: { username: string; password: string; role?: string }) =>
    request<{ ok: boolean }>('/api/users', { method: 'POST', body: JSON.stringify(body) }),

  blacklist: () => request<BlacklistEntry[]>('/api/blacklist'),
  addBlacklist: (body: { license_id: string; reason: string }) =>
    request<{ ok: boolean }>('/api/blacklist', { method: 'POST', body: JSON.stringify(body) }),
  removeBlacklist: (licenseId: string) =>
    request<{ ok: boolean }>(`/api/blacklist/${encodeURIComponent(licenseId)}`, { method: 'DELETE' }),

  audit: () => request<AuditEntry[]>('/api/audit'),

  syncStatus: () => request<{ configured: boolean; repo: string | null }>('/api/sync/status'),
  syncAll: () => request<{ ok: boolean }>('/api/sync/all', { method: 'POST' }),
  syncBlacklist: () => request<{ ok: boolean; path?: string }>('/api/sync/blacklist', { method: 'POST' }),
  syncPublicKey: () => request<{ ok: boolean; path?: string }>('/api/sync/public-key', { method: 'POST' }),
  syncCertificates: () => request<{ ok: boolean; pushed?: number }>('/api/sync/certificates', { method: 'POST' }),
}

export async function downloadCertificate(id: number, filename: string): Promise<void> {
  if (DEMO) {
    console.info(`[demo] download certificate for license #${id} -> ${filename}`)
    return
  }
  const token = localStorage.getItem('lh_token')
  const res = await fetch(BASE + `/api/licenses/${id}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// 라이선스의 최신 인증서 JSON을 조회한다 (다운로드 경로 재사용).
export async function getCertificate(id: number): Promise<Record<string, unknown>> {
  if (DEMO) return demoIssueCertificate(id).certificate
  const token = localStorage.getItem('lh_token')
  const res = await fetch(BASE + `/api/licenses/${id}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error(`certificate load failed: ${res.status}`)
  return res.json()
}

// Application 공개키를 내려받는다. 라이선스를 암호화할 때 쓰인다.
export async function downloadApplicationPublicKey(id: number, licenseId: string): Promise<void> {
  await downloadPem(id, 'application-public-key', `${licenseId}-application-public-key.pem`)
}

// 생성 시점에 서버가 돌려준 Application 개인키를 파일로 저장한다.
// 서버는 이 키를 저장하지 않으므로 이 시점에 받지 않으면 다시 받을 수 없다.
export function saveApplicationPrivateKey(licenseId: string, privatePem: string): void {
  downloadText(`${licenseId}-application-private-key.pem`, privatePem)
}

function downloadText(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/x-pem-file' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function downloadPem(id: number, kind: string, filename: string): Promise<void> {
  if (DEMO) {
    console.info(`[demo] download ${kind} for license #${id} -> ${filename}`)
    return
  }
  const token = localStorage.getItem('lh_token')
  const res = await fetch(BASE + `/api/licenses/${id}/${kind}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// 최종 산출물인 암호화된 라이선스 파일을 내려받는다. Application 공개키로 암호화되어
// 있어 파일을 열어도 P의 원문은 노출되지 않는다.
export async function downloadEncryptedLicense(id: number, licenseId: string): Promise<void> {
  if (DEMO) {
    console.info(`[demo] download encrypted LIC for license #${id} -> ${licenseId}.lic.json`)
    return
  }
  const token = localStorage.getItem('lh_token')
  const res = await fetch(BASE + `/api/licenses/${id}/license/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error(`LIC download failed: ${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${licenseId}.lic.json`
  a.click()
  URL.revokeObjectURL(url)
}

// 암호화된 LIC 엔벨로프를 화면에서 확인한다 (ciphertext는 볼 수 없음).
export async function getEncryptedLicense(id: number): Promise<Record<string, unknown>> {
  if (DEMO) return demoEncryptedLicense()
  const token = localStorage.getItem('lh_token')
  const res = await fetch(BASE + `/api/licenses/${id}/license`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error(`LIC load failed: ${res.status}`)
  return res.json()
}

// 라이선스 검증에 쓰이는 서명 공개키(.pem) 다운로드. 발급 시 이력 DB에 저장된
// 값을 반환하므로 서명 키가 교체되어도 해당 라이선스의 공개키를 받을 수 있다.
export async function downloadLicensePublicKey(licenseId: string): Promise<void> {
  if (DEMO) {
    console.info(`[demo] download public key for ${licenseId}`)
    return
  }
  const token = localStorage.getItem('lh_token')
  const res = await fetch(
    BASE + `/api/certificates/${encodeURIComponent(licenseId)}/public-key/download`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  )
  if (!res.ok) throw new Error(`public key download failed: ${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${licenseId}-public-key.pem`
  a.click()
  URL.revokeObjectURL(url)
}