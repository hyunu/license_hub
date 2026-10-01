import { HashRouter, Navigate, Outlet, Route, Routes, NavLink } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { Licenses } from './pages/Licenses'
import { Users } from './pages/Users'
import { Blacklist } from './pages/Blacklist'
import { Audit } from './pages/Audit'
import { Sync } from './pages/Sync'

function Protected() {
  const { token } = useAuth()
  if (!token) return <Navigate to="/login" replace />
  return <Outlet />
}

function Layout() {
  const { user, logout } = useAuth()
  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>LicenseHub</h1>
        <nav>
          <NavLink to="/">대시보드</NavLink>
          <NavLink to="/licenses">라이선스</NavLink>
          <NavLink to="/blacklist">Blacklist</NavLink>
          <NavLink to="/users">사용자</NavLink>
          <NavLink to="/audit">감사 로그</NavLink>
          <NavLink to="/sync">GitHub 동기화</NavLink>
        </nav>
        <div className="sidebar-footer">
          <span>{user?.username} ({user?.role})</span>
          <button onClick={logout}>로그아웃</button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}

export function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Protected />}>
            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="licenses" element={<Licenses />} />
              <Route path="blacklist" element={<Blacklist />} />
              <Route path="users" element={<Users />} />
              <Route path="audit" element={<Audit />} />
              <Route path="sync" element={<Sync />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  )
}