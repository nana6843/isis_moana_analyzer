// src/pages/Login.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './Login.css'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const res = await fetch('/api/auth/login/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      localStorage.setItem('access', data.access)
      localStorage.setItem('refresh', data.refresh)
      navigate('/dashboard')
    } catch {
      setError('Username atau password salah.')
    }
  }

  return (
    <div className="login-bg">
      <span className="version-badge">● v19.7.2026</span>

      <div className="login-card">
        <h1 className="login-heading">WEB TCN</h1>
        <p className="login-sub">MAPS — SR-MPLS & Adjacency Path Simulator</p>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="input-field">
            <label>Username</label>
            <input
              type="text"
              placeholder="Masukkan username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="input-field">
            <label>Password</label>
            <input
              type="password"
              placeholder="Masukkan password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && <p className="form-error">{error}</p>}

          <button type="submit" className="submit-btn">Login</button>
        </form>

        <div className="login-note">
          <strong>Note:</strong> Login Using Your LADOMAIN
        </div>
      </div>
    </div>
  )
}