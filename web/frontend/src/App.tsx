import { useState, type ReactNode } from 'react'
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

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16" height="16" viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

const NAV: Array<{ to: string; label: string; icon: ReactNode }> = [
  {
    to: '/',
    label: '운영 현황',
    icon: (
      <Icon>
        <rect x="1.5" y="1.5" width="5" height="5" />
        <rect x="9.5" y="1.5" width="5" height="5" />
        <rect x="1.5" y="9.5" width="5" height="5" />
        <rect x="9.5" y="9.5" width="5" height="5" />
      </Icon>
    ),
  },
  {
    to: '/licenses',
    label: '라이선스',
    icon: (
      <Icon>
        <path d="M4 1.5h5.5L13 5v9.5H4z" />
        <path d="M9.5 1.5V5H13" />
      </Icon>
    ),
  },
  {
    to: '/blacklist',
    label: 'Blacklist',
    icon: (
      <Icon>
        <circle cx="8" cy="8" r="5.5" />
        <path d="M4.6 11.4 11.4 4.6" />
      </Icon>
    ),
  },
  {
    to: '/users',
    label: '사용자',
    icon: (
      <Icon>
        <circle cx="8" cy="5.2" r="2.4" />
        <path d="M3 13.5c.4-2.2 2.4-3.6 5-3.6s4.6 1.4 5 3.6" />
      </Icon>
    ),
  },
  {
    to: '/audit',
    label: '감사 로그',
    icon: (
      <Icon>
        <circle cx="8" cy="8" r="5.5" />
        <path d="M8 4.8V8l2.4 1.4" />
      </Icon>
    ),
  },
  {
    to: '/sync',
    label: 'GitHub 동기화',
    icon: (
      <Icon>
        <path d="M13.5 8a5.5 5.5 0 0 1-9.6 3.9" />
        <path d="M2.5 8a5.5 5.5 0 0 1 9.6-3.9" />
        <path d="M9.5 2h3.5v3.5" />
        <path d="M6.5 14H3v-3.5" />
      </Icon>
    ),
  },
]

function Layout() {
  const { user, logout } = useAuth()
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div className="app">
      <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
        <div className="brand">
          <div className="row">
            <span className="mark" />
            <span className="name">LicenseHub</span>
          </div>
          <div className="sub">certificate registry · admin</div>
        </div>
        <nav>
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              title={n.label}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <span className="nav-ico">{n.icon}</span>
              <span className="nav-label">{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="foot">
          <div className="mono">{user?.username} · {user?.role}</div>
          <div className="who">
            <span className="mono">oracle · linux</span>
            <button className="btn small" onClick={logout} title="로그아웃">
              <Icon>
                <path d="M10 2.5H4.5v11H10" />
                <path d="M6.5 8H14" />
                <path d="M11.5 5.5 14 8l-2.5 2.5" />
              </Icon>
              <span className="logout-label">로그아웃</span>
            </button>
          </div>
        </div>
        <button
          className="toggle-btn"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? '펼치기' : '접기'}
        >
          <Icon>
            {collapsed ? <path d="M6 3l4 5-4 5" /> : <path d="M10 3L6 8l4 5" />}
          </Icon>
        </button>
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