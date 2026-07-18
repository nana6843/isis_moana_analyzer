// src/pages/Dashboard.jsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import './Dashboard.css'
import ISISAnalyzer from './ISISAnalyzer'
import LSDBSimulator from './LSDBSimulator'
// ─────────────────────────────────────────────
// KONFIGURASI SIDEBAR — ganti sesuai kebutuhan
// ─────────────────────────────────────────────
const NAV_ITEMS = [
  // { icon: '◎', label: 'My Portfolio', path: '/dashboard' },
  // { icon: '▤', label: 'My Slideshows', path: '#' },
  // { icon: '◫', label: 'Projects', path: '#' },
  // { icon: '✓', label: 'My Task', path: '#' },
  // { icon: '⊞', label: 'My Teams', path: '#' },
  // { icon: '🔔', label: 'Inbox', path: '#', badge: 6 },
  { icon: '🖧', label: 'ISIS Analyzer', path: '#' },
  { icon: '⚗️', label: 'LSDB Simulator', path: '#' },  // ← tambah ini
]

// Ganti stats sesuai data kamu
const STATS = [
  { label: 'PROJECTS', value: '38' },
  { label: 'AVG PROGRESS', value: '74.2%', accent: true },
  { label: 'TASKS TOTAL', value: '282/540' },
  { label: 'HIGH RISKS', value: '0' },
]

export default function Dashboard() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [darkMode, setDarkMode] = useState(false)
  const [activeNav, setActiveNav] = useState('My Portfolio')
  const [userInfo, setUserInfo] = useState({ username: '', fullName: '' })
  const navigate = useNavigate()

  useEffect(() => {
    // Ambil username dari localStorage (disimpan saat login)
    const savedUsername = localStorage.getItem('username') || ''
    setUserInfo({ username: savedUsername, fullName: savedUsername })

    // Ambil data user lengkap dari Django
    const token = localStorage.getItem('access')
    if (token) {
      fetch('/api/auth/me/', {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((data) => {
          const full = [data.first_name, data.last_name].filter(Boolean).join(' ')
          setUserInfo({
            username: data.username,
            fullName: full || data.username,
          })
        })
        .catch(() => {}) // fallback ke localStorage jika endpoint belum ada
    }
  }, [])

  const handleLogout = () => {
    localStorage.clear()
    navigate('/login')
  }

  return (
    <div className={`db-root ${darkMode ? 'dark' : ''}`}>

      {/* ── Sidebar ── */}
      <aside className={`db-sidebar ${sidebarOpen ? 'open' : 'collapsed'}`}>

        {/* User info */}
        <div className="db-user">
          <span className="db-avatar">
            {userInfo.fullName ? userInfo.fullName.slice(0, 2).toUpperCase() : 'U'}
          </span>
          {sidebarOpen && (
            <div className="db-user-info">
              <div className="db-user-name">{userInfo.fullName || 'Loading...'}</div>
              <div className="db-user-role">{userInfo.username}</div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="db-nav">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.label}
              href={item.path}
              className={`db-nav-item ${activeNav === item.label ? 'active' : ''}`}
              onClick={(e) => { e.preventDefault(); setActiveNav(item.label) }}
              title={!sidebarOpen ? item.label : ''}
            >
              <span className="db-nav-icon">{item.icon}</span>
              {sidebarOpen && <span className="db-nav-label">{item.label}</span>}
              {sidebarOpen && item.badge && (
                <span className="db-badge">{item.badge}</span>
              )}
            </a>
          ))}
        </nav>

        {/* Bottom actions */}
        <div className="db-sidebar-bottom">
          {/* Dark mode toggle */}
          <button
            className="db-nav-item db-toggle-btn"
            onClick={() => setDarkMode(!darkMode)}
            title={!sidebarOpen ? (darkMode ? 'Light Mode' : 'Dark Mode') : ''}
          >
            <span className="db-nav-icon">{darkMode ? '☀️' : '🌙'}</span>
            {sidebarOpen && <span className="db-nav-label">{darkMode ? 'Light Mode' : 'Dark Mode'}</span>}
          </button>

          {/* Logout */}
          <button
            className="db-nav-item db-logout-btn"
            onClick={handleLogout}
            title={!sidebarOpen ? 'Logout' : ''}
          >
            <span className="db-nav-icon">⬅</span>
            {sidebarOpen && <span className="db-nav-label">Logout</span>}
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="db-main">

        {/* Topbar */}
        <header className="db-topbar">
          <button className="db-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? '«' : '»'}
          </button>
          <span className="db-page-title">{activeNav}</span>
          <div className="db-topbar-right">
            <span className="developer-credit">Developed by nru</span>
          </div>
        </header>

        {/* Content */}
        <div className="db-content">
          {activeNav === 'ISIS Analyzer' && <ISISAnalyzer />}
          {activeNav === 'LSDB Simulator'  && <LSDBSimulator />}  {/* ← tambah ini */}
        </div>
      </main>
    </div>
  )
}