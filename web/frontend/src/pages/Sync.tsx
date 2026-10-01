import { useEffect, useState } from 'react'
import { api } from '../api'

export function Sync() {
  const [configured, setConfigured] = useState(false)
  const [repo, setRepo] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.syncStatus().then((s) => { setConfigured(s.configured); setRepo(s.repo) }).catch((e) => setError(String(e)))
  }, [])

  const run = async (action: () => Promise<unknown>, label: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await action()
      setNotice(`${label} 완료: ${JSON.stringify(res)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label} 실패`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h2>GitHub 동기화</h2>
      {configured ? (
        <p className="notice">GitHub App 연동됨 → <strong>{repo}</strong></p>
      ) : (
        <p className="error">GitHub App이 구성되지 않았습니다. (GITHUB_REPO, GITHUB_APP_ID, GITHUB_INSTALLATION_ID, GITHUB_APP_PRIVATE_KEY 설정 필요)</p>
      )}
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <div className="card">
        <h3>Repository 동기화</h3>
        <p className="hint">
          인증서 → <code>certificates/&#123;core|secure|device-bound&#125;/&#123;license-id&#125;.json</code><br />
          Blacklist → <code>blacklist/blacklist.json</code><br />
          공개키 → <code>keys/public-key.pem</code>
        </p>
        <div className="actions">
          <button disabled={!configured || busy} onClick={() => run(api.syncAll, '전체 동기화')}>전체 동기화</button>
          <button disabled={!configured || busy} onClick={() => run(api.syncCertificates, '인증서 동기화')}>인증서</button>
          <button disabled={!configured || busy} onClick={() => run(api.syncBlacklist, 'Blacklist 동기화')}>Blacklist</button>
          <button disabled={!configured || busy} onClick={() => run(api.syncPublicKey, '공개키 동기화')}>공개키</button>
        </div>
      </div>
    </div>
  )
}