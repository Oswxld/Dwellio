import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Portal = 'landlord' | 'tenant'
type Mode = 'login' | 'signup'
type TenantStep = 'email' | 'credentials' | 'confirmation'

export default function AuthPage({ portal = 'landlord' }: { portal?: Portal }) {
  const isTenant = portal === 'tenant'
  const [mode, setMode] = useState<Mode>('login')
  const [tenantStep, setTenantStep] = useState<TenantStep>('email')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setMode('login')
    setTenantStep('email')
    setEmail('')
    setPassword('')
    setMessage('')
    setError('')
  }, [portal])

  function chooseMode(nextMode: Mode) {
    setMode(nextMode)
    setPassword('')
    setError('')
    setMessage('')
  }

  function continueWithEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!email.trim() || !email.includes('@')) {
      setError('Enter a valid email address.')
      return
    }
    setEmail(email.trim().toLowerCase())
    setError('')
    setMessage('')
    setTenantStep('credentials')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    setError('')
    try {
      if (mode === 'signup') {
        if (!fullName.trim()) throw new Error('Enter your full name.')
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { full_name: fullName.trim() },
            ...(isTenant ? { emailRedirectTo: `${window.location.origin}/tenant/login` } : {}),
          },
        })
        if (signUpError) throw signUpError
        if (!data.session) {
          if (isTenant) setTenantStep('confirmation')
          setMessage('If your account was created, check your inbox for the confirmation link, then sign in.')
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (signInError) throw signInError
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  async function resendConfirmation() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/tenant/login` },
      })
      if (resendError) throw resendError
      setMessage('If a confirmation is pending, another email has been sent. Check your inbox and spam folder.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not resend confirmation.')
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
          <Link to="/login"
            className={`auth-portal-option ${!isTenant ? 'auth-portal-option-active' : ''}`}
            aria-current={!isTenant ? 'page' : undefined}>
            <span className="material-symbols-outlined" aria-hidden="true">apartment</span>
            <span>Landlord / Manager</span>
          </Link>
          <Link to="/tenant/login"
            className={`auth-portal-option ${isTenant ? 'auth-portal-option-active' : ''}`}
            aria-current={isTenant ? 'page' : undefined}>
            <span className="material-symbols-outlined" aria-hidden="true">home</span>
            <span>Tenant</span>
          </Link>
        </div>

        <p className="eyebrow auth-portal-label">{isTenant ? 'TENANT PORTAL' : 'LANDLORD PORTAL'}</p>

        {isTenant && tenantStep === 'email' ? (
          <>
            <h1>Welcome home.</h1>
            <p className="muted">
              Enter the email address your property manager registered for your tenancy.
            </p>
            <form onSubmit={continueWithEmail} className="form-stack">
              <label>Email address
                <input type="email" value={email} onChange={event => setEmail(event.target.value)}
                  placeholder="you@example.com" autoComplete="email" required />
              </label>
              {error && <div className="alert error" role="alert">{error}</div>}
              <button className="primary full" type="submit">Continue</button>
            </form>
            <p className="auth-portal-help">
              Already registered? Continue to sign in. New tenant? You can create an account
              using this same email address.
            </p>
          </>
        ) : isTenant && tenantStep === 'confirmation' ? (
          <>
            <h1>Confirm your email.</h1>
            <p className="muted">
              Check the inbox and spam folder for <strong>{email}</strong>. Open the
              Supabase confirmation link to verify your email. It will take you back
              to the Dwellio tenant login.
            </p>
            {error && <div className="alert error" role="alert">{error}</div>}
            {message && <div className="alert success" role="status">{message}</div>}
            <button className="primary full auth-confirm-action" type="button" disabled={busy}
              onClick={() => { chooseMode('login'); setTenantStep('credentials') }}>
              Back to sign in
            </button>
            <button className="text-button" type="button" disabled={busy}
              onClick={() => void resendConfirmation()}>
              {busy ? 'Please wait…' : 'Resend confirmation email'}
            </button>
          </>
        ) : (
          <>
            <h1>{isTenant
              ? mode === 'signup' ? 'Create your tenant account.' : 'Welcome home.'
              : mode === 'login' ? 'Welcome back.' : 'Create your Dwellio account.'}</h1>
            <p className="muted">{isTenant
              ? 'Use your registered email to access your lease, profile and billing.'
              : 'Manage your properties, units, tenants and rent from one place.'}</p>
            <form onSubmit={submit} className="form-stack">
              {mode === 'signup' && (
                <label>Full name
                  <input value={fullName} onChange={event => setFullName(event.target.value)}
                    placeholder="Your full name" autoComplete="name" required />
                </label>
              )}
              {isTenant ? (
                <div className="tenant-auth-selected-email">
                  <div><span>Registered email</span><strong>{email}</strong></div>
                  <button type="button" onClick={() => {
                    setTenantStep('email')
                    setPassword('')
                    setError('')
                    setMessage('')
                  }}>Change</button>
                </div>
              ) : (
                <label>Email
                  <input type="email" value={email} onChange={event => setEmail(event.target.value)}
                    placeholder="you@example.com" autoComplete="email" required />
                </label>
              )}
              <label>Password
                <input type="password" value={password} onChange={event => setPassword(event.target.value)}
                  placeholder="••••••••" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  minLength={6} required />
              </label>
              {error && <div className="alert error" role="alert">{error}</div>}
              {message && <div className="alert success" role="status">{message}</div>}
              <button className="primary full" type="submit" disabled={busy}>
                {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
              </button>
            </form>
            <button className="text-button" type="button"
              onClick={() => chooseMode(mode === 'login' ? 'signup' : 'login')}>
              {mode === 'login'
                ? "Don't have an account? Create one"
                : 'Already have an account? Sign in'}
            </button>
            {isTenant && <p className="auth-portal-help">
              Tenant access is activated automatically after your email is verified
              and matches a tenant registered by property management.
            </p>}
          </>
        )}
      </section>
    </main>
  )
}
