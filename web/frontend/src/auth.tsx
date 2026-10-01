import { createContext, useContext, useState, type ReactNode } from 'react'
import { api, DEMO } from './api'

interface AuthUser {
  id: number
  username: string
  role: string
}

interface AuthContextValue {
  token: string | null
  user: AuthUser | null
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('lh_token'))
  const [user, setUser] = useState<AuthUser | null>(() => {
    const raw = localStorage.getItem('lh_user')
    return raw ? (JSON.parse(raw) as AuthUser) : null
  })

  const login = async (username: string, password: string) => {
    if (DEMO) {
      // 데모 모드: 백엔드 없이 아무 계정으로 로그인해 UI를 확인한다.
      const user: AuthUser = { id: 1, username: username || 'demo', role: 'admin' }
      localStorage.setItem('lh_token', 'demo-token')
      localStorage.setItem('lh_user', JSON.stringify(user))
      setToken('demo-token')
      setUser(user)
      return
    }
    const res = await api.login(username, password)
    localStorage.setItem('lh_token', res.token)
    localStorage.setItem('lh_user', JSON.stringify(res.user))
    setToken(res.token)
    setUser(res.user)
  }

  const logout = async () => {
    try {
      await api.logout()
    } catch {
      /* ignore */
    }
    localStorage.removeItem('lh_token')
    localStorage.removeItem('lh_user')
    setToken(null)
    setUser(null)
    window.location.hash = '#/login'
  }

  return (
    <AuthContext.Provider value={{ token, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}