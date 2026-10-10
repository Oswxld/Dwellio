import {
  lazy,
  useEffect,
  useRef,
  useState,
} from 'react'

import type {
  Session,
  User,
} from '@supabase/supabase-js'

import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'

import { supabase } from './lib/supabase'

import DwellioShell
  from './layouts/DwellioShell'
import TenantPortal from './features/tenant/TenantPortal'

import AuthPage from './pages/AuthPage'
import OnboardingPage from './pages/OnboardingPage'
import TenantOnboardingPage
  from './pages/TenantOnboardingPage'

const DashboardPage = lazy(
  () => import('./pages/DashboardPage'),
)

const BillingPage = lazy(
  () => import('./pages/BillingPage'),
)

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const isTenantPath = location.pathname === '/tenant' || location.pathname.startsWith('/tenant/')

  const [session, setSession] =
    useState<Session | null>(null)

  const [user, setUser] =
    useState<User | null>(null)

  const [loading, setLoading] =
    useState(true)

  const [hasOrganization, setHasOrganization] =
    useState(false)

  const [hasTenant, setHasTenant] =
    useState(false)

  const [tenantLinkStatus, setTenantLinkStatus] =
    useState<string | null>(null)

  const [tenantLinkError, setTenantLinkError] =
    useState('')

  const contextRequestId = useRef(0)

  const [setupCompleted, setSetupCompleted] =
    useState(false)

  const [organizationId, setOrganizationId] =
    useState<string | null>(null)

  async function loadContext(currentUser: User) {
    const requestId = ++contextRequestId.current
    setLoading(true)

    try {
      // Auth email ownership is verified in the SECURITY DEFINER RPC.
      // Do not search `tenants.email` directly from the browser.
      const [membershipResult, claimResult] = await Promise.all([
        supabase
          .from('organization_members')
          .select(`
            organization_id,
            organizations!inner(
              id,
              name,
              setup_completed
            )
          `)
          .eq('user_id', currentUser.id)
          .eq('status', 'active')
          .limit(1)
          .maybeSingle(),
        supabase.rpc('claim_tenant_account'),
      ])

      if (requestId !== contextRequestId.current) return

      if (membershipResult.error) {
        console.error('[Auth] Organization membership lookup failed:', membershipResult.error)
      }

      const membership = membershipResult.data
      const organization = Array.isArray(membership?.organizations)
        ? membership.organizations[0]
        : membership?.organizations

      setHasOrganization(Boolean(membership))
      setOrganizationId(membership?.organization_id ?? null)
      setSetupCompleted(organization?.setup_completed === true)

      if (claimResult.error) {
        console.error('[Auth] Tenant email claim failed:', claimResult.error)
        setHasTenant(false)
        setTenantLinkStatus('error')
        setTenantLinkError(claimResult.error.message)
        return
      }

      const claim = claimResult.data as {
        status?: string
        linked_user_id?: string | null
      } | null

      setHasTenant(claim?.status === 'linked' && claim.linked_user_id === currentUser.id)
      setTenantLinkStatus(claim?.status ?? 'error')
      setTenantLinkError(claim ? '' : 'The tenant account check returned no result.')
    } catch (caught) {
      if (requestId !== contextRequestId.current) return
      console.error('[Auth] Could not load account context:', caught)
      setHasTenant(false)
      setTenantLinkStatus('error')
      setTenantLinkError(
        caught instanceof Error ? caught.message : 'Could not check your account.',
      )
    } finally {
      if (requestId === contextRequestId.current) setLoading(false)
    }
  }

  useEffect(() => {
    let mounted = true
    const pendingTimers: ReturnType<typeof setTimeout>[] = []

    function applySession(nextSession: Session | null) {
      if (!mounted) return
      setSession(nextSession)
      setUser(nextSession?.user ?? null)

      if (nextSession?.user) {
        setLoading(true)
        // Supabase advises deferring other auth-dependent requests from the
        // auth-state callback to avoid holding its internal auth lock.
        const timer = setTimeout(() => {
          if (mounted) void loadContext(nextSession.user)
        }, 0)
        pendingTimers.push(timer)
      } else {
        contextRequestId.current += 1
        setLoading(false)
        setHasOrganization(false)
        setHasTenant(false)
        setTenantLinkStatus(null)
        setTenantLinkError('')
        setSetupCompleted(false)
        setOrganizationId(null)
      }
    }

    void supabase.auth.getSession()
      .then(({ data }) => applySession(data.session))
      .catch((error: unknown) => {
        if (!mounted) return
        console.error('[Auth] Could not restore session:', error)
        setLoading(false)
      })

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => applySession(nextSession),
    )

    return () => {
      mounted = false
      pendingTimers.forEach(clearTimeout)
      contextRequestId.current += 1
      listener.subscription.unsubscribe()
    }
  }, [])

  if (loading) {
    return (
      <div className="center-screen">
        <div className="spinner" />
      </div>
    )
  }

  if (
    !session ||
    !user
  ) {
    return <AuthPage portal={isTenantPath ? 'tenant' : 'landlord'} />
  }

  // A tenant-sign-in URL does not confer tenant permissions.
  // Unlinked accounts must not fall into landlord/property onboarding.
  if (isTenantPath && !hasTenant) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="brand">dwellio<span>.</span></div>
          <p className="eyebrow">TENANT PORTAL</p>
          <h1>{tenantLinkStatus === 'email_unverified'
            ? 'Please confirm your email.'
            : tenantLinkStatus === 'error'
              ? 'Unable to verify tenant access.'
              : tenantLinkStatus === 'already_linked'
                ? 'Tenant record already linked.'
                : 'Tenant email not registered.'}</h1>
          <p className="muted">
            {tenantLinkStatus === 'email_unverified'
              ? 'Check your inbox and confirm your email using the Supabase verification link, then sign in again.'
              : tenantLinkStatus === 'error'
                ? `Dwellio could not complete the tenant account check. ${tenantLinkError || 'Please try again or contact support.'}`
                : tenantLinkStatus === 'already_linked'
                  ? 'A matching tenancy is already linked to another account. Ask your property manager to review the record.'
                  : 'No active tenant record matches your verified account email. Ask your property manager to register that exact email address.'}
          </p>
          <button className="primary full" type="button"
            onClick={() => void supabase.auth.signOut()}>
            Sign out to use another account
          </button>
          {hasOrganization && (
            <Link className="auth-back-link" to="/">
              Go to landlord dashboard
            </Link>
          )}
        </section>
      </main>
    )
  }

  // Tenant accounts do not need a landlord organization.
  // Keep landlord routing unchanged for users who also manage an organization.
  if (hasTenant && (!hasOrganization || !setupCompleted || !organizationId)) {
    return (
      <Routes>
        <Route path="/tenant/*" element={<TenantPortal />} />
        <Route path="*" element={<Navigate to="/tenant" replace />} />
      </Routes>
    )
  }

  if (
    !hasOrganization ||
    !setupCompleted ||
    !organizationId
  ) {
    return (
      <OnboardingPage
        user={user}
        onComplete={
          () =>
            loadContext(user)
        }
      />
    )
  }

  return (
    <Routes>
      {hasTenant && (
        <Route path="/tenant/*" element={<TenantPortal />} />
      )}
      <Route
        path="/tenants/new"
        element={
          <TenantOnboardingPage
            organizationId={organizationId}
            onCancel={() => navigate('/')}
            onComplete={() => navigate('/')}
          />
        }
      />

      <Route
        element={
          <DwellioShell
            user={user}
            organizationId={organizationId}
          />
        }
      >
        <Route
          index
          element={
            <DashboardPage
              user={user}
            />
          }
        />

        <Route
          path="billing"
          element={<BillingPage />}
        />

        <Route
          path="*"
          element={
            <Navigate
              to="/"
              replace
            />
          }
        />
      </Route>
    </Routes>
  )
}
