import { useEffect, useState, type FormEvent } from 'react'
import { api, downloadCertificate, downloadEncryptedLicense, downloadLicensePublicKey, getCertificate, getEncryptedLicense, type License } from '../api'
import { Toasts, useToasts } from '../toast'

// 이미지의 P 필드 (Application ID, Target Language, Version, Level, Owner,
// Expired Date, Meta Data) 를 그대로 입력 폼으로 옮긴다.
const EMPTY_FORM = {
  license_id: '',
  product: '',
  version: '1.0.0',
  level: '1',
  holder: '',
  device_id: '',
  expires_at: '2027-01-01T00:00:00Z',
  metadata: '',
  target_language: 'cpp',
  application_public_key: '',
}

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
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const { toasts, ok, bad } = useToasts()
  const [showForm, setShowForm] = useState(false)
  const [certView, setCertView] = useState<{
    license: string
    cert: Record<string, unknown>
    lic?: Record<string, unknown> | null
    appId?: string | null
    lang?: string
  } | null>(null)

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
        expires_at: form.expires_at,
      }
      if (form.license_id.trim()) body.license_id = form.license_id.trim()
      if (form.device_id) body.device_id = form.device_id
      if (form.metadata.trim()) body.metadata = form.metadata.trim()
      if (form.target_language.trim()) body.target_language = form.target_language
      // AK2(Z_Pub)를 주면 발급 시 P가 이 키로 암호화되어 LIC로 저장된다.
      if (form.application_public_key.trim()) body.application_public_key = form.application_public_key.trim()
      const created = await api.createLicense(body)
      ok(`라이선스 ${created.license_id} 생성됨`)
      setForm(EMPTY_FORM)
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
      setCertView({
        license: lic.license_id,
        cert: res.certificate,
        lic: res.encrypted_license,
        appId: res.application_id,
        lang: res.target_language,
      })
      if (res.encrypted_license) {
        ok(`LIC 발급됨 — AK2(Z_Pub)로 암호화된 ${lic.license_id}.lic.json`)
      } else if (lic.application_public_key) {
        ok(`인증서 ${res.certificate_id} 발급됨`)
      } else {
        ok(`인증서 ${res.certificate_id} 발급됨 — AK2 미등록이므로 암호화 LIC는 없습니다`)
      }
      load(filter)
    } catch (err) {
      bad(err instanceof Error ? err.message : 'issue failed')
    }
  }

  // 이미지의 최종 산출물인 암호화된 LIC 를 내려받는다.
  const downloadLic = async (lic: License) => {
    if (!lic.encrypted_license) {
      bad(
        lic.application_public_key
          ? `'${lic.license_id}'에 아직 발급된 LIC가 없습니다 — 먼저 발급하세요`
          : `'${lic.license_id}'에 AK2(Z_Pub)가 없어 암호화 LIC를 만들 수 없습니다`,
      )
      return
    }
    try {
      await downloadEncryptedLicense(lic.id, lic.license_id)
      ok(`암호화된 LIC 다운로드됨 — ${lic.license_id}.lic.json`)
    } catch (err) {
      bad(err instanceof Error ? err.message : 'LIC download failed')
    }
  }

  const viewLic = async (lic: License) => {
    if (!lic.encrypted_license) {
      bad(`'${lic.license_id}'에 AK2(Z_Pub) 기반 LIC가 없습니다`)
      return
    }
    try {
      const licView = await getEncryptedLicense(lic.id)
      const cert = await getCertificate(lic.id)
      setCertView({ license: lic.license_id, cert, lic: licView, appId: lic.application_id, lang: lic.target_language ?? 'any' })
    } catch (err) {
      bad(err instanceof Error ? err.message : 'LIC load failed')
    }
  }

  const download = async (lic: License) => {
    if (lic.certificates === 0) {
      bad(`'${lic.license_id}'에 아직 발급된 인증서가 없습니다 — 먼저 발급하세요`)
      return
    }
    try {
      await downloadCertificate(lic.id, `${lic.license_id}.json`)
    } catch (err) {
      bad(err instanceof Error ? err.message : 'download failed')
    }
  }

  const viewCert = async (lic: License) => {
    if (lic.certificates === 0) {
      bad(`'${lic.license_id}'에 아직 발급된 인증서가 없습니다 — 먼저 발급하세요`)
      return
    }
    try {
      const cert = await getCertificate(lic.id)
      setCertView({ license: lic.license_id, cert, lic: null, appId: lic.application_id, lang: lic.target_language ?? 'any' })
    } catch (err) {
      bad(err instanceof Error ? err.message : 'certificate load failed')
    }
  }

  const downloadKey = async (lic: License) => {
    try {
      await downloadLicensePublicKey(lic.license_id)
      ok(`공개키 다운로드됨 — ${lic.license_id}-public-key.pem`)
    } catch (err) {
      bad(err instanceof Error ? err.message : 'public key download failed')
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
        <p className="muted small" style={{ margin: '0 0 12px' }}>
          이미지 발급 흐름: P(Application ID · Target Language · Version · Level · Owner · 만료일 · Meta Data)를 LH_Pri로 서명한 뒤,
          AK2(Z_Pub)로 암호화해 LIC로 저장합니다. Application ID 는 AK2 에서 자동 도출되므로 직접 입력하지 않습니다(RS-7).
        </p>

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
              <label className="f"><span className="lbl">제품 <span className="req">*</span></span>
                <input value={form.product} onChange={(e) => set('product', e.target.value)} placeholder="제품명" required />
              </label>
              <label className="f"><span className="lbl">버전 <span className="req">*</span></span>
                <input value={form.version} onChange={(e) => set('version', e.target.value)} required />
              </label>
              <label className="f">등급
                <select value={form.level} onChange={(e) => set('level', e.target.value)}>
                  <option value="1">1 — Core (오프라인)</option>
                  <option value="2">2 — Secure (서버)</option>
                  <option value="3">3 — Device-Bound</option>
                </select>
              </label>
              <label className="f"><span className="lbl">소유자 (Owner) <span className="req">*</span></span>
                <input value={form.holder} onChange={(e) => set('holder', e.target.value)} required />
              </label>
              <label className="f">Target Language
                <select value={form.target_language} onChange={(e) => set('target_language', e.target.value)}>
                  {LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </label>
              <label className="f wide"><span className="lbl">AK2 (Z_Pub) — Application 공개키 PEM</span>
                <textarea
                  rows={3}
                  value={form.application_public_key}
                  onChange={(e) => set('application_public_key', e.target.value)}
                  placeholder={'-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----'}
                />
              </label>
              <label className="f">Device ID (L3)
                <input value={form.device_id} onChange={(e) => set('device_id', e.target.value)} />
              </label>
              <label className="f">만료일
                <input type="datetime-local" value={form.expires_at} onChange={(e) => set('expires_at', e.target.value)} />
              </label>
              <label className="f wide">메타정보
                <input value={form.metadata} onChange={(e) => set('metadata', e.target.value)} placeholder="예: 고객사명, 계약번호" />
              </label>
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
              <th>만료</th><th>상태</th><th>LIC</th><th>작업</th>
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
                  {l.application_id ? `${l.application_id.slice(0, 12)}…` : <span className="muted">AK2 없음</span>}
                </td>
                <td>{l.holder}</td>
                <td className="mono">{l.expires_at.slice(0, 10)}</td>
                <td><span className={`status ${l.status}`}><span className="sq" />{l.status}</span></td>
                <td className="mono muted">
                  {l.encrypted_license ? (
                    <span title={`AK2 암호화 · key_id ${l.encrypted_license.key_id}`}>암호화</span>
                  ) : l.level === 3 && l.device_id ? (
                    'bound'
                  ) : l.certificates > 0 ? (
                    `${l.certificates}회`
                  ) : (
                    '—'
                  )}
                </td>
                <td className="actions">
                  <button className="btn small primary" onClick={() => issue(l)}>발급</button>
                  <button className="btn small" onClick={() => viewLic(l)} disabled={!l.encrypted_license}
                    title={l.encrypted_license ? '암호화된 LIC 확인' : 'AK2 미등록 또는 미발급'}>LIC</button>
                  <button className="btn small" onClick={() => downloadLic(l)} disabled={!l.encrypted_license}
                    title={l.encrypted_license ? `${l.license_id}.lic.json 내려받기` : 'AK2 미등록 또는 미발급'}>LIC↓</button>
                  <button className="btn small" onClick={() => viewCert(l)} disabled={l.certificates === 0}
                    title={l.certificates === 0 ? '인증서를 먼저 발급하세요' : undefined}>보기</button>
                  <button className="btn small" onClick={() => download(l)} disabled={l.certificates === 0}
                    title={l.certificates === 0 ? '인증서를 먼저 발급하세요' : undefined}>다운로드</button>
                  <button className="btn small" onClick={() => downloadKey(l)}>공개키</button>
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
              <h3 className="sec-title">
                {certView.lic ? '암호화된 LIC (EncryptedLicense)' : '서명 인증서 (X)'} — {certView.license}
              </h3>
              <div className="actions">
                {certView.lic && (
                  <button
                    className="btn small primary"
                    onClick={async () => {
                      try {
                        await downloadEncryptedLicense(
                          licenses.find((l) => l.license_id === certView.license)?.id ?? 0,
                          certView.license,
                        )
                      } catch (err) {
                        bad(err instanceof Error ? err.message : 'LIC download failed')
                      }
                    }}
                  >
                    LIC 내려받기
                  </button>
                )}
                <button className="btn small" onClick={() => setCertView(null)}>닫기</button>
              </div>
            </div>
            {certView.lic ? (
              <>
                <p className="muted small" style={{ margin: '0 0 8px' }}>
                  P 원문은 ciphertext 안에만 존재하므로 Owner·만료일 등은 이 화면에서 보이지 않습니다.
                  Application 은 AK1(Z_Pri)로 복호화한 뒤 X 내장 LK2로 서명을 검증합니다.
                </p>
                <pre className="jsonbox">{JSON.stringify(certView.lic, null, 2)}</pre>
              </>
            ) : (
              <pre className="jsonbox">{JSON.stringify(certView.cert, null, 2)}</pre>
            )}
          </section>
        )}
      </div>
      <Toasts toasts={toasts} />
    </div>
  )
}