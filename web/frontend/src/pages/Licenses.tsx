import { useEffect, useState, type FormEvent } from 'react'
import { api, downloadCertificate, type License } from '../api'

const EMPTY_FORM = {
  license_id: '',
  product: '',
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
  const [showForm, setShowForm] = useState(false)
  const [certView, setCertView] = useState<{ license: string; cert: Record<string, unknown> } | null>(null)

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
      setShowForm(false)
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
      setCertView({ license: lic.license_id, cert: res.certificate })
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

  const toggleStatus = async (lic: License) => {
    try {
      await api.setStatus(lic.id, lic.status === 'active' ? 'revoked' : 'active')
      load(filter)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    }
  }

  return (
    <div>
      <header className="topbar">
        <h1 className="title">라이선스</h1>
        <span className="ctx">인증서 발급 · 회수 레지스트리</span>
      </header>

      <div className="content">
        {notice && <div className="alert ok">{notice}</div>}
        {error && <div className="alert bad">{error}</div>}

        <div className="toolbar">
          <div className="left">
            <label className="f">
              상태
              <select value={filter} onChange={(e) => { setFilter(e.target.value); load(e.target.value) }}>
                <option value="">전체</option>
                <option value="active">active</option>
                <option value="revoked">revoked</option>
                <option value="blacklisted">blacklisted</option>
              </select>
            </label>
            <span className="count">{licenses.length}건</span>
          </div>
          <button className="btn" onClick={() => setShowForm((v) => !v)}>
            {showForm ? '닫기' : '새 라이선스'}
          </button>
        </div>

        {showForm && (
          <form className="form-strip" onSubmit={create}>
            <div className="form-grid">
              <label className="f">License ID (비우면 자동)
                <input placeholder="자동 생성" value={form.license_id} onChange={(e) => set('license_id', e.target.value)} />
              </label>
              <label className="f">제품
                <input value={form.product} onChange={(e) => set('product', e.target.value)} placeholder="제품명" required />
              </label>
              <label className="f">버전
                <input value={form.version} onChange={(e) => set('version', e.target.value)} required />
              </label>
              <label className="f">등급
                <select value={form.level} onChange={(e) => set('level', e.target.value)}>
                  <option value="1">1 — Core (오프라인)</option>
                  <option value="2">2 — Secure (서버)</option>
                  <option value="3">3 — Device-Bound</option>
                </select>
              </label>
              <label className="f">소유자
                <input value={form.holder} onChange={(e) => set('holder', e.target.value)} required />
              </label>
              <label className="f">Device ID (L3)
                <input value={form.device_id} onChange={(e) => set('device_id', e.target.value)} />
              </label>
              <label className="f">만료일
                <input type="datetime-local" value={form.expires_at} onChange={(e) => set('expires_at', e.target.value)} />
              </label>
            </div>
            <div className="form-actions">
              <button className="btn primary" disabled={busy}>{busy ? '생성 중…' : '생성'}</button>
            </div>
          </form>
        )}

        <table className="ledger">
          <thead>
            <tr>
              <th>License</th><th>제품 / 버전</th><th>등급</th><th>소유자</th>
              <th>만료</th><th>상태</th><th>인증서</th><th>작업</th>
            </tr>
          </thead>
          <tbody>
            {licenses.length === 0 && (
              <tr><td colSpan={8} className="muted small">등록된 라이선스가 없습니다 — '새 라이선스'로 추가하세요</td></tr>
            )}
            {licenses.map((l) => (
              <tr key={l.id}>
                <td className="mono">{l.license_id}</td>
                <td>{l.product} <span className="muted">{l.version}</span></td>
                <td>L{l.level}</td>
                <td>{l.holder}</td>
                <td className="mono">{l.expires_at.slice(0, 10)}</td>
                <td><span className={`status ${l.status}`}><span className="sq" />{l.status}</span></td>
                <td className="mono muted">{l.level === 3 ? (l.device_id ? 'bound' : '—') : '—'}</td>
                <td className="actions">
                  <button className="btn small primary" onClick={() => issue(l)}>발급</button>
                  <button className="btn small" onClick={() => download(l)}>다운로드</button>
                  <button className={`btn small ${l.status === 'active' ? 'danger' : ''}`} onClick={() => toggleStatus(l)}>
                    {l.status === 'active' ? '폐기' : '복구'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {certView && (
          <section className="sec" style={{ marginTop: 22 }}>
            <div className="sec-head">
              <h3 className="sec-title">발급된 인증서 — {certView.license}</h3>
              <button className="btn small" onClick={() => setCertView(null)}>닫기</button>
            </div>
            <pre className="jsonbox">{JSON.stringify(certView.cert, null, 2)}</pre>
          </section>
        )}
      </div>
    </div>
  )
}