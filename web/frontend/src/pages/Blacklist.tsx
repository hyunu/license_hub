import { useEffect, useState, type FormEvent } from 'react'
import { api, type BlacklistEntry } from '../api'

export function Blacklist() {
  const [entries, setEntries] = useState<BlacklistEntry[]>([])
  const [licenseId, setLicenseId] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showForm, setShowForm] = useState(false)

  const load = () => api.blacklist().then(setEntries).catch((e) => setError(String(e)))
  useEffect(() => { load() }, [])

  const add = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await api.addBlacklist({ license_id: licenseId, reason })
      setNotice(`Blacklist 추가: ${licenseId}`)
      setLicenseId('')
      setReason('')
      setShowForm(false)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'add failed')
    }
  }

  const remove = async (licenseId: string) => {
    try {
      await api.removeBlacklist(licenseId)
      setNotice(`Blacklist 제거: ${licenseId}`)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'remove failed')
    }
  }

  return (
    <div>
      <header className="topbar">
        <h1 className="title">Blacklist</h1>
        <span className="ctx">폐기 · 회수된 라이선스 명부</span>
      </header>
      <div className="content">
        {notice && <div className="alert ok">{notice}</div>}
        {error && <div className="alert bad">{error}</div>}

        <div className="toolbar">
          <button className="btn" onClick={() => setShowForm((v) => !v)}>
            {showForm ? '닫기' : 'Blacklist 추가'}
          </button>
          <span className="count">{entries.length}건</span>
        </div>

        {showForm && (
          <form className="form-strip" onSubmit={add}>
            <div className="form-grid">
              <label className="f">License ID
                <input value={licenseId} onChange={(e) => setLicenseId(e.target.value)} required />
              </label>
              <label className="f">사유
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 미결제, 환불" />
              </label>
              <button className="btn primary">추가</button>
            </div>
          </form>
        )}

        <table className="ledger">
          <thead>
            <tr><th>License ID</th><th>사유</th><th>등록일</th><th>작업</th></tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr><td colSpan={4} className="muted small">Blacklist에 등록된 항목이 없습니다</td></tr>
            )}
            {entries.map((e) => (
              <tr key={e.license_id}>
                <td className="mono">{e.license_id}</td>
                <td>{e.reason || '—'}</td>
                <td className="mono">{e.created_at.slice(0, 10)}</td>
                <td><button className="btn small danger" onClick={() => remove(e.license_id)}>제거</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}