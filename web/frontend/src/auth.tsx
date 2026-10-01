import { createContext, useContext, useState, type ReactNode } from 'react'
import { api } from './api'

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