import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { DEMO } from '../api'

export function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(username, password)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <div className="login-card">
        <span className="mark" />
        <h1>LicenseHub</h1>
        <div className="muted small">certificate registry · admin</div>
        <hr className="rule" />
        <form onSubmit={submit}>
          {DEMO && <div className="hint">데모 모드 — 아무 계정으로 로그인</div>}
          <label className="f">사용자명
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
          </label>
          <label className="f">비밀번호
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          {error && <div className="err">{error}</div>}
          <button className="btn primary" disabled={busy}>{busy ? '로그인 중…' : '로그인'}</button>
        </form>
      </div>
    </div>
  )
}