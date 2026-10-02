import { useEffect, useState } from 'react'
import { api } from '../api'
import { Toasts, useToasts } from '../toast'

export function Sync() {
  const [configured, setConfigured] = useState(false)
  const [repo, setRepo] = useState<string | null>(null)
  const { toasts, ok, bad } = useToasts()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.syncStatus().then((s) => { setConfigured(s.configured); setRepo(s.repo) }).catch((e) => bad(String(e)))
  }, [])

  const run = async (action: () => Promise<unknown>, label: string) => {
    setBusy(true)
    try {
      const res = await action()
      ok(`${label} 완료: ${JSON.stringify(res)}`)
    } catch (err) {
      bad(err instanceof Error ? err.message : `${label} 실패`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <header className="topbar">
        <h1 className="title">GitHub 동기화</h1>
        <span className="ctx">배포 저장소로 인증서 · Blacklist · 공개키 push</span>
      </header>
      <div className="content">
        {configured ? (
          <div className="alert ok">연동됨 — <span className="mono">{repo}</span> · 인증: GitHub App</div>
        ) : (
          <div className="alert bad">
            GitHub App이 구성되지 않았습니다. <span className="mono">GITHUB_REPO · GITHUB_APP_ID · GITHUB_INSTALLATION_ID · GITHUB_APP_PRIVATE_KEY</span> 설정 필요
          </div>
        )}

        <section className="sec" style={{ marginTop: 20 }}>
          <div className="sec-head">
            <h3 className="sec-title">배포 경로</h3>
            <span className="sec-note">프로비저닝 시 설치 · 기존 파일은 덮어씀</span>
          </div>
          <table className="ledger">
            <tbody>
              <tr><td className="mono">certificates/&#123;core|secure|device-bound&#125;/&#123;license-id&#125;.json</td><td className="muted">발급된 인증서</td></tr>
              <tr><td className="mono">blacklist/blacklist.json</td><td className="muted">폐기 목록 (버전 포함)</td></tr>
              <tr><td className="mono">keys/public-key.pem</td><td className="muted">검증용 공개키</td></tr>
            </tbody>
          </table>
        </section>

        <div className="toolbar end">
          <button className="btn primary" disabled={!configured || busy} onClick={() => run(api.syncAll, '전체 동기화')}>전체 동기화</button>
          <button className="btn" disabled={!configured || busy} onClick={() => run(api.syncCertificates, '인증서')}>인증서</button>
          <button className="btn" disabled={!configured || busy} onClick={() => run(api.syncBlacklist, 'Blacklist')}>Blacklist</button>
          <button className="btn" disabled={!configured || busy} onClick={() => run(api.syncPublicKey, '공개키')}>공개키</button>
        </div>
      </div>
      <Toasts toasts={toasts} />
    </div>
  )
}