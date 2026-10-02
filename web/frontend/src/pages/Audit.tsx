import { useEffect, useState } from 'react'
import { api, type AuditEntry } from '../api'
import { Toasts, useToasts } from '../toast'

export function Audit() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const { toasts, bad } = useToasts()

  useEffect(() => {
    api.audit().then(setEntries).catch((e) => bad(String(e)))
  }, [])

  return (
    <div>
      <header className="topbar">
        <h1 className="title">감사 로그</h1>
        <span className="ctx">발급 · 폐기 · Blacklist · 로그인 기록 (최근 200건)</span>
      </header>
      <div className="content">
        <table className="ledger">
          <thead>
            <tr><th>시각</th><th>작업자</th><th>동작</th><th>대상</th><th>상세</th></tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr><td colSpan={5} className="muted small">기록이 없습니다</td></tr>
            )}
            {entries.map((a) => (
              <tr key={a.id}>
                <td className="mono">{a.created_at.slice(0, 19)}</td>
                <td>{a.actor}</td>
                <td><span className="mono">{a.action}</span></td>
                <td className="mono">{a.target ?? '—'}</td>
                <td>{a.detail ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Toasts toasts={toasts} />
    </div>
  )
}