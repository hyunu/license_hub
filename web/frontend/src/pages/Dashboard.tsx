import { useEffect, useState } from 'react'
import { api, type Stats } from '../api'

export function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.stats().then(setStats).catch((e) => setError(String(e)))
  }, [])

  const cards: Array<[string, number | undefined, string]> = [
    ['전체 라이선스', stats?.licenses, ''],
    ['활성', stats?.active, 'ok'],
    ['폐기', stats?.revoked, 'warn'],
    ['Blacklist', stats?.blacklisted, 'bad'],
    ['발급 인증서', stats?.certificates, ''],
    ['사용자', stats?.users, ''],
    ['감사 이벤트', stats?.audit, ''],
  ]

  return (
    <div>
      <h2>대시보드</h2>
      {error && <p className="error">{error}</p>}
      <div className="cards">
        {cards.map(([label, value, tone]) => (
          <div key={label} className={`card stat ${tone}`}>
            <div className="stat-value">{value ?? '–'}</div>
            <div className="stat-label">{label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}