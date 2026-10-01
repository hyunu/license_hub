import { useEffect, useState, type FormEvent } from 'react'
import { api, type BlacklistEntry } from '../api'

export function Blacklist() {
  const [entries, setEntries] = useState<BlacklistEntry[]>([])
  const [licenseId, setLicenseId] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

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
      <h2>Blacklist 관리</h2>
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <div className="card">
        <h3>Blacklist 추가</h3>
        <form className="grid" onSubmit={add}>
          <label>License ID<input value={licenseId} onChange={(e) => setLicenseId(e.target.value)} required /></label>
          <label>사유<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <button>추가</button>
        </form>
      </div>

      <table className="data">
        <thead><tr><th>License ID</th><th>사유</th><th>등록일</th><th>작업</th></tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.license_id}>
              <td>{e.license_id}</td>
              <td>{e.reason}</td>
              <td>{e.created_at}</td>
              <td className="actions"><button className="secondary" onClick={() => remove(e.license_id)}>제거</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}