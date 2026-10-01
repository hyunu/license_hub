import { useEffect, useState } from 'react'
import { api, type AuditEntry } from '../api'

export function Audit() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    api.audit().then(setEntries).catch((e) => setError(String(e)))
  }, [])

  return (
    <div>
      <h2>감사 로그</h2>
      {error && <p className="error">{error}</p>}
      <table className="data">
        <thead><tr><th>ID</th><th>시각</th><th>작업자</th><th>동작</th><th>대상</th><th>상세</th></tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>{e.id}</td>
              <td>{e.created_at}</td>
              <td>{e.actor}</td>
              <td>{e.action}</td>
              <td>{e.target ?? ''}</td>
              <td>{e.detail ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}