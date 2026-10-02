import { useEffect, useState, type FormEvent } from 'react'
import { api, downloadCertificate, type License } from '../api'

const EMPTY_FORM = {
  license_id: '',
  product: 'DXi',
  version: '1.0.0',
  level: '1',
  holder: '',
  device_id: '',
  expires_at: '2027-01-01T00:00:00Z',
}

export function Licenses() {
  const [licenses, setLicenses] = useState<License[]>([])
  const [filter, setFilter] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [certView, setCertView] = useState<Record<string, unknown> | null>(null)

  const load = (status?: string) => {
    api
      .licenses(status)
      .then(setLicenses)
      .catch((e) => setError(String(e)))
  }
  useEffect(() => {
    load()
  }, [])

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const create = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const body: Record<string, unknown> = {
        product: form.product,
        version: form.version,
        level: Number(form.level),
        holder: form.holder,
        expires_at: form.expires_at,
      }
      if (form.license_id.trim()) body.license_id = form.license_id.trim()
      if (form.device_id) body.device_id = form.device_id
      const created = await api.createLicense(body)
      setNotice(`라이선스 ${created.license_id} 생성됨`)
      setForm(EMPTY_FORM)
      load(filter)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create failed')
    } finally {
      setBusy(false)
    }
  }

  const issue = async (lic: License) => {
    setError('')
    try {
      const res = await api.issue(lic.id)
      setCertView(res.certificate)
      setNotice(`인증서 ${res.certificate_id} 발급됨`)
      load(filter)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'issue failed')
    }
  }

  const download = async (lic: License) => {
    try {
      await downloadCertificate(lic.id, `${lic.license_id}.json`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'download failed')
    }
  }

  const revoke = async (lic: License) => {
    try {
      await api.setStatus(lic.id, lic.status === 'active' ? 'revoked' : 'active')
      load(filter)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }

  return (
    <div>
      <h2>라이선스 관리</h2>
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <div className="card">
        <h3>라이선스 생성</h3>
        <form className="grid" onSubmit={create}>
          <label>License ID (비우면 자동 생성)<input placeholder="자동 생성" value={form.license_id} onChange={(e) => set('license_id', e.target.value)} /></label>
          <label>제품<input value={form.product} onChange={(e) => set('product', e.target.value)} required /></label>
          <label>버전<input value={form.version} onChange={(e) => set('version', e.target.value)} required /></label>
          <label>등급<select value={form.level} onChange={(e) => set('level', e.target.value)}>
            <option value="1">1 - Core (오프라인)</option>
            <option value="2">2 - Secure (서버)</option>
            <option value="3">3 - Device-Bound</option>
          </select></label>
          <label>소유자<input value={form.holder} onChange={(e) => set('holder', e.target.value)} required /></label>
          <label>Device ID (L3)<input value={form.device_id} onChange={(e) => set('device_id', e.target.value)} /></label>
          <label>만료일<input type="datetime-local" value={form.expires_at} onChange={(e) => set('expires_at', e.target.value)} /></label>
          <div />
          <button disabled={busy}>{busy ? '생성 중...' : '생성'}</button>
        </form>
      </div>

      <div className="toolbar">
        <label>상태 필터
          <select value={filter} onChange={(e) => { setFilter(e.target.value); load(e.target.value) }}>
            <option value="">전체</option>
            <option value="active">active</option>
            <option value="revoked">revoked</option>
            <option value="blacklisted">blacklisted</option>
          </select>
        </label>
      </div>

      <table className="data">
        <thead>
          <tr><th>ID</th><th>License</th><th>제품</th><th>등급</th><th>소유자</th><th>만료</th><th>상태</th><th>작업</th></tr>
        </thead>
        <tbody>
          {licenses.map((l) => (
            <tr key={l.id}>
              <td>{l.id}</td>
              <td>{l.license_id}</td>
              <td>{l.product} {l.version}</td>
              <td>L{l.level}</td>
              <td>{l.holder}</td>
              <td>{l.expires_at}</td>
              <td><span className={`badge ${l.status}`}>{l.status}</span></td>
              <td className="actions">
                <button onClick={() => issue(l)}>발급</button>
                <button onClick={() => download(l)}>다운로드</button>
                <button className="secondary" onClick={() => revoke(l)}>{l.status === 'active' ? '폐기' : '복구'}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {certView && (
        <div className="card">
          <h3>발급된 인증서</h3>
          <pre className="json">{JSON.stringify(certView, null, 2)}</pre>
          <button onClick={() => setCertView(null)}>닫기</button>
        </div>
      )}
    </div>
  )
}