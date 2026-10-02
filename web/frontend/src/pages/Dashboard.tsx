import { useEffect, useState } from 'react'
import { api, type AuditEntry, type License, type Stats } from '../api'

export function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [licenses, setLicenses] = useState<License[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [sync, setSync] = useState<{ configured: boolean; repo: string | null } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.stats().then(setStats).catch((e) => setError(String(e)))
    api.licenses().then((l) => setLicenses(l.slice(0, 8))).catch(() => {})
    api.audit().then((a) => setAudit(a.slice(0, 8))).catch(() => {})
    api.syncStatus().then(setSync).catch(() => {})
  }, [])

  const rows: Array<[string, number | undefined]> = [
    ['전체 라이선스', stats?.licenses],
    ['활성', stats?.active],
    ['폐기', stats?.revoked],
    ['Blacklist', stats?.blacklisted],
    ['발급 인증서', stats?.certificates],
    ['사용자', stats?.users],
    ['감사 이벤트', stats?.audit],
  ]

  return (
    <div>
      <header className="topbar">
        <h1 className="title">운영 현황</h1>
        <span className="ctx">
          {sync?.configured ? `배포 저장소 ${sync.repo}` : 'GitHub 동기화 미구성'} · 동기화 방식 GitHub App
        </span>
      </header>

      <div className="content">
        {error && <div className="alert bad">{error}</div>}

        <section className="sec">
          <div className="stats">
            {rows.map(([k, v]) => (
              <div className="stat" key={k}>
                <div className="k">{k}</div>
                <div className="v">{v ?? '–'}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="cols">
          <section className="col">
            <div className="col-head">최근 라이선스</div>
            <table className="ledger">
              <thead>
                <tr><th>License</th><th>제품</th><th>만료</th><th>상태</th></tr>
              </thead>
              <tbody>
                {licenses.length === 0 && (
                  <tr><td colSpan={4} className="muted small">발급된 라이선스가 없습니다</td></tr>
                )}
                {licenses.map((l) => (
                  <tr key={l.id}>
                    <td className="mono">{l.license_id}</td>
                    <td>{l.product} {l.version}</td>
                    <td className="mono">{l.expires_at.slice(0, 10)}</td>
                    <td><span className={`status ${l.status}`}><span className="sq" />{l.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="col">
            <div className="col-head">최근 감사 이벤트</div>
            <table className="ledger">
              <thead>
                <tr><th>시각</th><th>작업자</th><th>동작</th></tr>
              </thead>
              <tbody>
                {audit.length === 0 && (
                  <tr><td colSpan={3} className="muted small">기록이 없습니다</td></tr>
                )}
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td className="mono">{a.created_at.slice(5, 19)}</td>
                    <td>{a.actor}</td>
                    <td className="mono">{a.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  )
}