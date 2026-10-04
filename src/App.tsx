import {
  useEffect,
  useState,
} from 'react'

import type {
  Session,
  User,
} from '@supabase/supabase-js'

import { supabase } from './lib/supabase'

import DwellioShell
  from './layouts/DwellioShell'

import AuthPage from './pages/AuthPage'
import OnboardingPage from './pages/OnboardingPage'
import DashboardPage from './pages/DashboardPage'
import TenantOnboardingPage
  from './pages/TenantOnboardingPage'
import BillingPage
  from './pages/BillingPage'


export default function App() {
  const [session, setSession] =
    useState<Session | null>(null)

  const [user, setUser] =
    useState<User | null>(null)

  const [loading, setLoading] =
    useState(true)

  const [hasOrganization, setHasOrganization] =
    useState(false)

  const [setupCompleted, setSetupCompleted] =
    useState(false)

  const [organizationId, setOrganizationId] =
    useState<string | null>(null)


  async function loadContext(
    currentUser: User,
  ) {
    const { data } = await supabase
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
      .maybeSingle()


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


  const pathname =
    window.location.pathname


  // ============================================================
  // TENANT ONBOARDING
  // ============================================================

  if (
    pathname ===
    '/tenants/new'
  ) {
    return (
      <TenantOnboardingPage
        organizationId={
          organizationId
        }
        onCancel={() => {
          window.location.href =
            '/'
        }}
        onComplete={() => {
          window.location.href =
            '/'
        }}
      />
    )
  }


  // ============================================================
  // BILLING
  // ============================================================

  if (
    pathname ===
    '/billing'
  ) {
    return (
      <DwellioShell
        user={user}
        organizationId={organizationId}
        activeNav="Billing"
      >
        <div className="dwellio-embedded-billing">
          <BillingPage />
        </div>
      </DwellioShell>
    )
  }


  // ============================================================
  // DASHBOARD / DEFAULT
  // ============================================================

  return (
    <DwellioShell
      user={user}
      organizationId={organizationId}
      activeNav="Dashboard"
    >
      <div className="dwellio-embedded-dashboard">
        <DashboardPage
          user={user}
        />
      </div>
    </DwellioShell>
  )
}
