import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Portal = 'landlord' | 'tenant'

export default function AuthPage({ portal = 'landlord' }: { portal?: Portal }) {
  const isTenant = portal === 'tenant'
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const action = isTenant ? 'login' : mode

  // Switching portals only changes the UI. Permissions are checked after login.
  useEffect(() => {
    setMode('login')
    setMessage('')
    setError('')
  }, [portal])

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setMessage('')
    setError('')
    try {
      if (action === 'signup') {
        if (!fullName.trim()) throw new Error('Enter your full name.')
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName.trim() } },
        })
        if (signUpError) throw signUpError
        if (!data.session) {
          setMessage('Account created. Check your email to confirm your account, then sign in.')
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (signInError) throw signInError
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand">dwellio<span>.</span></div>
        <p className="muted auth-tagline">Your property. Your home. Simplified.</p>

        <div className="auth-portal-switch" role="group" aria-label="Choose your Dwellio portal">
          <Link
            to="/login"
            className={`auth-portal-option ${!isTenant ? 'auth-portal-option-active' : ''}`}
            aria-current={!isTenant ? 'page' : undefined}
          >
            <span className="material-symbols-outlined" aria-hidden="true">apartment</span>
            <span>Landlord / Manager</span>
          </Link>
          <Link
            to="/tenant/login"
            className={`auth-portal-option ${isTenant ? 'auth-portal-option-active' : ''}`}
            aria-current={isTenant ? 'page' : undefined}
          >
            <span className="material-symbols-outlined" aria-hidden="true">home</span>
            <span>Tenant</span>
          </Link>
        </div>

        <p className="eyebrow auth-portal-label">
          {isTenant ? 'TENANT PORTAL' : 'LANDLORD PORTAL'}
        </p>
        <h1>
          {isTenant
            ? 'Welcome home.'
            : action === 'login'
              ? 'Welcome back.'
              : 'Create your Dwellio account.'}
        </h1>
        <p className="muted">
          {isTenant
            ? 'Sign in to view your lease, personal information and billing.'
            : 'Manage your properties, units, tenants and rent from one place.'}
        </p>

        <form onSubmit={submit} className="form-stack">
          {action === 'signup' && (
            <label>Full name
              <input value={fullName} onChange={e => setFullName(e.target.value)}
                placeholder="Oscar Mwangi" autoComplete="name" required />
            </label>
          )}
          <label>Email
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" autoComplete="email" required />
          </label>
          <label>Password
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" autoComplete={action === 'signup' ? 'new-password' : 'current-password'}
              minLength={6} required />
          </label>
          {error && <div className="alert error" role="alert">{error}</div>}
          {message && <div className="alert success" role="status">{message}</div>}
          <button className="primary full" disabled={busy}>
            {busy ? 'Please wait…' : action === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        {isTenant ? (
          <p className="auth-portal-help">
            Need tenant access? Ask your property manager to link your Dwellio account
            with your registered tenant profile.
          </p>
        ) : (
          <button
            className="text-button"
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login')
              setError('')
              setMessage('')
            }}
          >
            {mode === 'login'
              ? "Don't have an account? Create one"
              : 'Already have an account? Sign in'}
          </button>
        )}
      </section>
    </main>
  )
}
