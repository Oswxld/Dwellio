import { FormEvent, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function AuthPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMessage(''); setError('')
    try {
      if (mode === 'signup') {
        if (!fullName.trim()) throw new Error('Enter your full name.')
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(), password,
          options: { data: { full_name: fullName.trim() } },
        })
        if (error) throw error
        if (!data.session) setMessage('Account created. Check your email to confirm your account, then sign in.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong.') }
    finally { setBusy(false) }
  }

  return <main className="auth-shell">
    <section className="auth-card">
      <div className="brand">dwellio<span>.</span></div>
      <p className="eyebrow">LANDLORD PORTAL</p>
      <h1>{mode === 'login' ? 'Welcome back.' : 'Create your Dwellio account.'}</h1>
      <p className="muted">Manage your properties, units, tenants and rent from one place.</p>
      <form onSubmit={submit} className="form-stack">
        {mode === 'signup' && <label>Full name<input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Oscar Mwangi" required /></label>}
        <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required /></label>
        <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" minLength={6} required /></label>
        {error && <div className="alert error">{error}</div>}
        {message && <div className="alert success">{message}</div>}
        <button className="primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
      <button className="text-button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setMessage('') }}>
        {mode === 'login' ? "Don't have an account? Create one" : 'Already have an account? Sign in'}
      </button>
    </section>
  </main>
}
