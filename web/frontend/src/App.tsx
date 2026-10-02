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
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="row">
            <span className="mark" />
            <span className="name">LicenseHub</span>
          </div>
          <div className="sub">certificate registry · admin</div>
        </div>
        <nav>
          <NavLink to="/" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>운영 현황</NavLink>
          <NavLink to="/licenses" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>라이선스</NavLink>
          <NavLink to="/blacklist" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>Blacklist</NavLink>
          <NavLink to="/users" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>사용자</NavLink>
          <NavLink to="/audit" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>감사 로그</NavLink>
          <NavLink to="/sync" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>GitHub 동기화</NavLink>
        </nav>
        <div className="foot">
          <div className="mono">{user?.username} · {user?.role}</div>
          <div className="who">
            <span className="mono">oracle · linux</span>
            <button className="btn small" onClick={logout}>로그아웃</button>
          </div>
        </div>
      </aside>
      <main className="main">
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