import { useEffect, useState, type FormEvent } from 'react'
import { api, type User } from '../api'

export function Users() {
  const [users, setUsers] = useState<User[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('admin')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showForm, setShowForm] = useState(false)

  const load = () => api.users().then(setUsers).catch((e) => setError(String(e)))
  useEffect(() => { load() }, [])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await api.createUser({ username, password, role })
      setNotice(`사용자 ${username} 생성됨`)
      setUsername('')
      setPassword('')
      setShowForm(false)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create failed')
    }
  }

  return (
    <div>
      <header className="topbar">
        <h1 className="title">사용자</h1>
        <span className="ctx">관리자 · 운영자 계정</span>
      </header>
      <div className="content">
        {notice && <div className="alert ok">{notice}</div>}
        {error && <div className="alert bad">{error}</div>}

        <div className="toolbar">
          <button className="btn" onClick={() => setShowForm((v) => !v)}>
            {showForm ? '닫기' : '사용자 추가'}
          </button>
          <span className="count">{users.length}명</span>
        </div>

        {showForm && (
          <form className="form-strip" onSubmit={create}>
            <div className="form-grid">
              <label className="f">사용자명
                <input value={username} onChange={(e) => setUsername(e.target.value)} required />
              </label>
              <label className="f">비밀번호
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </label>
              <label className="f">역할
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="admin">admin</option>
                  <option value="operator">operator</option>
                </select>
              </label>
            </div>
            <div className="form-actions">
              <button className="btn primary">추가</button>
            </div>
          </form>
        )}

        <table className="ledger">
          <thead>
            <tr><th>ID</th><th>사용자명</th><th>역할</th><th>생성일</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className="mono muted">{u.id}</td>
                <td>{u.username}</td>
                <td><span className={`status ${u.role === 'admin' ? 'ok' : ''}`}><span className="sq" />{u.role}</span></td>
                <td className="mono">{u.created_at.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}