import { useEffect, useState, type FormEvent } from 'react'
import { api, type User } from '../api'
import { useAuth } from '../auth'
import { Toasts, useToasts } from '../toast'

export function Users() {
  const { user: me } = useAuth()
  const isAdmin = me?.role === 'admin'
  const [users, setUsers] = useState<User[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('admin')
  const [editingId, setEditingId] = useState<number | null>(null)
  const { toasts, ok, bad } = useToasts()
  const [showForm, setShowForm] = useState(false)

  const load = () => api.users().then(setUsers).catch((e) => bad(String(e)))
  useEffect(() => { load() }, [])

  const resetForm = () => {
    setUsername('')
    setPassword('')
    setRole('admin')
    setEditingId(null)
  }

  const openCreate = () => {
    resetForm()
    setShowForm(true)
  }

  const openEdit = (u: User) => {
    setEditingId(u.id)
    setUsername(u.username)
    setRole(u.role)
    setPassword('')
    setShowForm(true)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      if (editingId == null) {
        await api.createUser({ username, password, role })
        ok(`사용자 ${username} 생성됨`)
      } else {
        const body: { username?: string; role?: string; password?: string } = { username, role }
        // 비우면 서버가 기존 비밀번호를 유지한다.
        if (password) body.password = password
        await api.updateUser(editingId, body)
        ok(`사용자 ${username} 수정됨`)
      }
      resetForm()
      setShowForm(false)
      load()
    } catch (err) {
      bad(err instanceof Error ? err.message : '저장 실패')
    }
  }

  const remove = async (u: User) => {
    if (!window.confirm(`'${u.username}' 계정을 서버에서 삭제할까요? 되돌릴 수 없습니다.`)) return
    try {
      await api.deleteUser(u.id)
      ok(`사용자 ${u.username} 삭제됨`)
      load()
    } catch (err) {
      bad(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  return (
    <div>
      <header className="topbar">
        <h1 className="title">사용자</h1>
        <span className="ctx">관리자 · 운영자 계정</span>
      </header>
      <div className="content">
        <div className="toolbar">
          <div className="left">
            <span className="count">{users.length}명</span>
          </div>
          <button className="btn" onClick={() => (showForm ? (setShowForm(false), resetForm()) : openCreate())}>
            {showForm ? '닫기' : '사용자 추가'}
          </button>
        </div>

        {showForm && (
          <form className="form-strip" onSubmit={submit}>
            <div className="form-grid">
              <label className="f">사용자명
                <input value={username} onChange={(e) => setUsername(e.target.value)} required />
              </label>
              <label className="f">{editingId == null ? '비밀번호' : '비밀번호 (변경 시 입력)'}
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required={editingId == null}
                  placeholder={editingId == null ? '' : '비우면 유지'}
                />
              </label>
              <label className="f">역할
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="admin">admin</option>
                  <option value="operator">operator</option>
                </select>
              </label>
            </div>
            <div className="form-actions">
              <button className="btn primary">{editingId == null ? '추가' : '저장'}</button>
            </div>
          </form>
        )}

        <table className="ledger">
          <thead>
            <tr>
              <th>ID</th><th>사용자명</th><th>역할</th><th>생성일</th>
              {isAdmin && <th>작업</th>}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className="mono muted">{u.id}</td>
                <td>{u.username}</td>
                <td><span className={`status ${u.role === 'admin' ? 'ok' : ''}`}><span className="sq" />{u.role}</span></td>
                <td className="mono">{u.created_at.slice(0, 10)}</td>
                {isAdmin && (
                  <td className="actions">
                    <button className="btn small" onClick={() => openEdit(u)}>수정</button>
                    <button
                      className="btn small danger"
                      onClick={() => remove(u)}
                      disabled={u.id === me?.id}
                      title={u.id === me?.id ? '본인 계정은 삭제할 수 없습니다' : undefined}
                    >삭제</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Toasts toasts={toasts} />
    </div>
  )
}
