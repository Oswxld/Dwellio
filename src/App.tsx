import {
  lazy,
  useEffect,
  useState,
} from 'react'

import type {
  Session,
  User,
} from '@supabase/supabase-js'

import {
  Navigate,
  Route,
  Routes,
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

  const [setupCompleted, setSetupCompleted] =
    useState(false)

  const [organizationId, setOrganizationId] =
    useState<string | null>(null)

  async function loadContext(
    currentUser: User,
  ) {
    const [membershipResult, tenantResult] = await Promise.all([
      supabase
      .from('organization_members')
      .select(
        `
        organization_id,
        organizations!inner(
          id,
          name,
          setup_completed
        )
        `,
      )
      .eq(
        'user_id',
        currentUser.id,
      )
      .eq(
        'status',
        'active',
      )
      .limit(1)
      .maybeSingle(),
      supabase
        .from('tenants')
        .select('id')
        .eq('user_id', currentUser.id)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle(),
    ])

    const data = membershipResult.data
    setHasTenant(Boolean(tenantResult.data))

    const organization =
      Array.isArray(
        data?.organizations,
      )
        ? data.organizations[0]
        : data?.organizations

    setHasOrganization(
      Boolean(data),
    )

    setOrganizationId(
      data?.organization_id
      ?? null,
    )

    setSetupCompleted(
      organization
        ?.setup_completed
      === true,
    )
  }

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(
          data.session,
        )

        setUser(
          data.session?.user
          ?? null,
        )

        if (
          data.session?.user
        ) {
          loadContext(
            data.session.user,
          )
            .finally(
              () =>
                setLoading(false),
            )
        } else {
          setLoading(false)
        }
      })

    const {
      data: listener,
    } =
      supabase.auth
        .onAuthStateChange(
          (
            _event,
            nextSession,
          ) => {
            setSession(
              nextSession,
            )

            setUser(
              nextSession?.user
              ?? null,
            )

            if (
              nextSession?.user
            ) {
              void loadContext(
                nextSession.user,
              )
            } else {
              setHasOrganization(
                false,
              )

              setHasTenant(false)

              setSetupCompleted(
                false,
              )

              setOrganizationId(
                null,
              )
            }
          },
        )

    return () =>
      listener
        .subscription
        .unsubscribe()
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
    return <AuthPage />
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
