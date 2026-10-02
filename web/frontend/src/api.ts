import { demoAddBlacklist, demoAudit, demoBlacklist, demoCreateLicense, demoCreateUser, demoIssueCertificate, demoLicenses, demoLicensesByStatus, demoPublicKey, demoRemoveBlacklist, demoSetStatus, demoStats, demoUsers } from './demo'

export interface User {
  id: number
  username: string
  role: string
  created_at: string
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
  createLicense: (body: Record<string, unknown>) =>
    request<License>('/api/licenses', { method: 'POST', body: JSON.stringify(body) }),
  issue: (id: number) =>
    request<{ certificate: Record<string, unknown>; certificate_id: string }>(`/api/licenses/${id}/issue`, { method: 'POST' }),
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

// 라이선스가 사용한 검증 공개키(.pem) 다운로드. 발급 시 이력 DB에 저장된 값을
// 반환하므로 개인키가 교체되어도 해당 라이선스의 공개키를 받을 수 있다.
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