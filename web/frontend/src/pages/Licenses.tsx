import { useEffect, useState, type FormEvent } from 'react'
import { api, downloadEncryptedLicense, saveApplicationPrivateKey, type License } from '../api'
import { Toasts, useToasts } from '../toast'

// date 입력(YYYY-MM-DD)을 그날 마지막 자정 직전(23:59:59 UTC)으로 바꾼다.
// 만료일 당일까지 유효하고 다음 날 0시부터 만료가 된다.
// 예: "2027-10-05" -> "2027-10-05T23:59:59Z"
function toEndOfDayRfc3339(date: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})$/.exec(date)
  return match ? `${match[1]}T23:59:59Z` : date
}

// 오늘 기준 1년 뒤를 date 입력 표시 형식(YYYY-MM-DD)으로 만든다.
function defaultExpiresAt(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() + 1)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// 이미지의 P 필드 (Application ID, Target Language, Version, Level, Owner,
// Expired Date, Meta Data) 를 그대로 입력 폼으로 옮긴다.
const emptyForm = () => ({
  license_id: '',
  product: '',
  version: '1.0.0',
  level: '1',
  holder: '',
  expires_at: defaultExpiresAt(),
  metadata: '',
  target_language: 'cpp',
  application_public_key: '',
  verification_url: '',
})

// 이미지의 Target Language 에 대응하는 런타임. "any" 는 제한 없음.
const LANGUAGES = [
  { value: 'any', label: 'any — 언어 제한 없음' },
  { value: 'cpp', label: 'C / C++' },
  { value: 'csharp', label: 'C# / .NET' },
  { value: 'python', label: 'Python' },
  { value: 'nodejs', label: 'Node.js' },
  { value: 'rust', label: 'Rust' },
]

export function Licenses() {
  const [licenses, setLicenses] = useState<License[]>([])
  const [filter, setFilter] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [busy, setBusy] = useState(false)
  const { toasts, ok, bad } = useToasts()
  const [showForm, setShowForm] = useState(false)
  // 서버가 자동 생성한 개인키. 생성 응답에서 한 번만 나오므로 여기서 받아
  // 파일로 저장하게 한 뒤 없앤다.
  const [keyReveal, setKeyReveal] = useState<{ license: string; privatePem: string } | null>(null)

  const load = (status?: string) => {
    api
      .licenses(status)
      .then(setLicenses)
      .catch((e) => bad(String(e)))
  }
  useEffect(() => {
    load()
  }, [])

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const create = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const body: Record<string, unknown> = {
        product: form.product,
        version: form.version,
        level: Number(form.level),
        holder: form.holder,
        expires_at: toEndOfDayRfc3339(form.expires_at),
      }
      if (form.license_id.trim()) body.license_id = form.license_id.trim()
      if (form.metadata.trim()) body.metadata = form.metadata.trim()
      if (form.target_language.trim()) body.target_language = form.target_language
      // 비우면 서버가 Application 키쌍을 생성한다. 채우면 앱이 가진 키로 암호화한다.
      if (form.application_public_key.trim()) body.application_public_key = form.application_public_key.trim()
      // L2에서 런타임에 라이선스 상태를 확인할 검증 서버 주소.
      // LicenseHub가 아니라 발급 시 지정한 라이선스별 서버 주소다.
      if (Number(form.level) === 2 && form.verification_url.trim()) {
        body.verification_url = form.verification_url.trim()
      }
      const created = await api.createLicense(body)
      // 공개키를 비워서 서버가 키쌍을 만들었다면 개인키가 이 응답으로 온다.
      // 서버는 저장하지 않으므로 이 시점에 반드시 받아야 한다.
      const generatedPrivateKey =
        typeof created.application_private_key === 'string' ? created.application_private_key : null
      if (generatedPrivateKey) {
        setKeyReveal({ license: created.license_id, privatePem: generatedPrivateKey })
      }
      ok(
        generatedPrivateKey
          ? `라이선스 ${created.license_id} 생성됨 — 개인키를 지금 내려받아 보관하세요`
          : `라이선스 ${created.license_id} 생성됨`,
      )
      setForm(emptyForm())
      setShowForm(false)
      load(filter)
    } catch (err) {
      bad(err instanceof Error ? err.message : 'create failed')
    } finally {
      setBusy(false)
    }
  }

  const issue = async (lic: License) => {
    try {
      const res = await api.issue(lic.id)
      // 키 없이 등록된 라이선스를 발급하면서 새 키를 만든 경우에도 개인키가
      // 이 응답으로 한 번만 온다.
      if (typeof res.application_private_key === 'string') {
        setKeyReveal({ license: lic.license_id, privatePem: res.application_private_key })
      }
      if (res.encrypted_license) {
        ok(`발급됨 — ${lic.license_id}.lic.json`)
      } else {
        ok(`인증서 ${res.certificate_id} 발급됨`)
      }
      load(filter)
    } catch (err) {
      bad(err instanceof Error ? err.message : 'issue failed')
    }
  }

// 최종 산출물인 암호화된 라이선스 파일을 내려받는다.
  const downloadLic = async (lic: License) => {
    if (!lic.encrypted_license) {
      bad(`'${lic.license_id}'에 아직 발급된 암호화 파일이 없습니다 — 먼저 발급하세요`)
      return
    }
    try {
      await downloadEncryptedLicense(lic.id, lic.license_id)
      ok(`암호화 파일 다운로드됨 — ${lic.license_id}.lic.json`)
    } catch (err) {
      bad(err instanceof Error ? err.message : '암호화 파일 다운로드 실패')
    }
  }

  const toggleStatus = async (lic: License) => {
    try {
      await api.setStatus(lic.id, lic.status === 'active' ? 'revoked' : 'active')
      ok(lic.status === 'active' ? `라이선스 ${lic.license_id} 폐기됨` : `라이선스 ${lic.license_id} 복구됨`)
      load(filter)
    } catch (err) {
      bad(err instanceof Error ? err.message : 'failed')
    }
  }

  return (
    <div>
      <header className="topbar">
        <h1 className="title">라이선스</h1>
        <span className="ctx">인증서 발급 · 회수 레지스트리</span>
      </header>

      <div className="content">
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
            <div className="form-cols">
              <div className="form-grid">
                <label className="f">License ID (비우면 자동)
                  <input placeholder="자동 생성" value={form.license_id} onChange={(e) => set('license_id', e.target.value)} />
                </label>
                <label className="f"><span className="lbl">제품 <span className="req">*</span></span>
                  <input value={form.product} onChange={(e) => set('product', e.target.value)} placeholder="제품명" required />
                </label>
                <label className="f"><span className="lbl">버전 <span className="req">*</span></span>
                  <input value={form.version} onChange={(e) => set('version', e.target.value)} required />
                </label>
                <label className="f"><span className="lbl">소유자 <span className="req">*</span></span>
                  <input value={form.holder} onChange={(e) => set('holder', e.target.value)} required />
                </label>
                <label className="f">등급
                  <select value={form.level} onChange={(e) => set('level', e.target.value)}>
                    <option value="1">1 — Core (오프라인)</option>
                    <option value="2">2 — Secure (서버)</option>
                                      </select>
                </label>
                {Number(form.level) === 2 && (
                  <label className="f wide"><span className="lbl">검증 서버 주소 <span className="req">*</span></span>
                    <input
                      type="url"
                      value={form.verification_url}
                      onChange={(e) => set('verification_url', e.target.value)}
                      placeholder="https://license.customer.com/v1/verify"
                      required
                    />
                  </label>
                )}
                <label className="f">언어
                  <select value={form.target_language} onChange={(e) => set('target_language', e.target.value)}>
                    {LANGUAGES.map((l) => (
                      <option key={l.value} value={l.value}>{l.label}</option>
                    ))}
                  </select>
                </label>
                <label className="f">만료일
                  <input type="date" value={form.expires_at} onChange={(e) => set('expires_at', e.target.value)} />
                </label>
                <label className="f wide">메타정보
                  <input value={form.metadata} onChange={(e) => set('metadata', e.target.value)} placeholder="예: 고객사명, 계약번호" />
                </label>
              </div>

              <div className="side">
                <label className="f"><span className="lbl">Application 공개키 (PEM)</span>
                  <textarea
                    value={form.application_public_key}
                    onChange={(e) => set('application_public_key', e.target.value)}
                    placeholder={'비우면 서버가 생성합니다\n-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----'}
                  />
                </label>
                <p className="hint">선택 입력. 비우면 키쌍을 만들어 개인키를 즉시 내려줍니다. 채우면 앱이 가진 키로 암호화합니다.</p>
              </div>
            </div>

            <div className="form-actions">
              <span className="sec-note"><span className="req">*</span> 필수</span>
              <button className="btn primary" disabled={busy}>{busy ? '생성 중…' : '생성'}</button>
            </div>
          </form>
        )}

        <table className="ledger">
          <thead>
            <tr>
              <th>License</th><th>제품 / 버전</th><th>등급</th><th>언어</th>
              <th>Application ID</th><th>소유자</th>
              <th>만료</th><th>상태</th><th>암호화</th><th>작업</th>
            </tr>
          </thead>
          <tbody>
            {licenses.length === 0 && (
              <tr><td colSpan={10} className="muted small">등록된 라이선스가 없습니다 — '새 라이선스'로 추가하세요</td></tr>
            )}
            {licenses.map((l) => (
              <tr key={l.id}>
                <td className="mono">{l.license_id}</td>
                <td>{l.product} <span className="muted">{l.version}</span></td>
                <td>L{l.level}</td>
                <td className="mono small">{l.target_language ?? '—'}</td>
                <td className="mono small" title={l.application_id ?? undefined}>
                  {l.application_id ? `${l.application_id.slice(0, 12)}…` : <span className="muted">미등록</span>}
                </td>
                <td>{l.holder}</td>
                <td className="mono">{l.expires_at.slice(0, 10)}</td>
                <td><span className={`status ${l.status}`}><span className="sq" />{l.status}</span></td>
                <td className="mono muted">
                  {l.encrypted_license ? (
                    <span title={`key_id ${l.encrypted_license.key_id}`}>암호화</span>
                  ) : l.certificates > 0 ? (
                    `${l.certificates}회`
                  ) : (
                    '—'
                  )}
                </td>
                <td className="actions">
                  <button className="btn small primary" onClick={() => issue(l)}
                    title="암호화된 라이선스 파일을 만듭니다">발급</button>
                  <button className="btn small" onClick={() => downloadLic(l)} disabled={!l.encrypted_license}
                    title={l.encrypted_license
                      ? `${l.license_id}.lic.json 내려받기`
                      : '먼저 발급하세요'}>암호화 파일</button>
                  <button className={`btn small ${l.status === 'active' ? 'danger' : ''}`} onClick={() => toggleStatus(l)}>
                    {l.status === 'active' ? '폐기' : '복구'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {keyReveal && (
          <section className="sec warn" style={{ marginTop: 22 }}>
            <div className="sec-head">
              <h3 className="sec-title">Application 개인키 — {keyReveal.license}</h3>
              <div className="actions">
                <button
                  className="btn small primary"
                  onClick={() => {
                    saveApplicationPrivateKey(keyReveal.license, keyReveal.privatePem)
                    ok(`${keyReveal.license}-application-private-key.pem 내려받음`)
                  }}
                >내려받기</button>
                <button className="btn small" onClick={() => setKeyReveal(null)}>닫기</button>
              </div>
            </div>
            <p className="small">
              이 창을 닫으면 다시 내려받을 수 없습니다. 서버는 이 키를 저장하지 않습니다.
              이 키를 받은 앱만 라이선스를 복호화할 수 있으므로 배포 대상 Application 에만 넣고,
              키보드에도 붙여넣지 말고 파일로 보관하세요.
            </p>
            <pre className="jsonbox">{keyReveal.privatePem}</pre>
          </section>
        )}

      </div>
      <Toasts toasts={toasts} />
    </div>
  )
}