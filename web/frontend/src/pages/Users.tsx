import { useEffect, useState, type FormEvent } from 'react'
import { api, type User } from '../api'

export function Users() {
  const [users, setUsers] = useState<User[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('admin')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

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
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create failed')
    }
  }

  return (
    <div>
      <h2>사용자 관리</h2>
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <div className="card">
        <h3>사용자 추가</h3>
        <form className="grid" onSubmit={create}>
          <label>사용자명<input value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
          <label>비밀번호<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          <label>역할<select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="admin">admin</option>
            <option value="operator">operator</option>
          </select></label>
          <button>추가</button>
        </form>
      </div>

      <table className="data">
        <thead><tr><th>ID</th><th>사용자명</th><th>역할</th><th>생성일</th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.id}</td>
              <td>{u.username}</td>
              <td>{u.role}</td>
              <td>{u.created_at}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}