import fs from 'node:fs'

const appPath = 'src/App.tsx'
const shellPath = 'src/layouts/DwellioShell.tsx'
const dashboardPath = 'src/pages/DashboardPage.tsx'
const billingPath = 'src/pages/BillingPage.tsx'
const workflowPath = '.github/workflows/apply-content-only-refactor.yml'
const selfPath = 'scripts/apply-content-only-refactor.mjs'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const app = `import {
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
        \`
        organization_id,
        organizations!inner(
          id,
          name,
          setup_completed
        )
        \`,
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

  return (
    <Routes>
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
`

const shell = `import {
  Suspense,
  useEffect,
  useState,
} from 'react'

import type { User } from '@supabase/supabase-js'
import {
  Outlet,
  useLocation,
  useNavigate,
} from 'react-router-dom'

import { supabase } from '../lib/supabase'
import PageSkeleton from '../components/loading/PageSkeleton'

type DwellioShellProps = {
  user: User
  organizationId: string
}

const navItems = [
  'Dashboard',
  'Properties',
  'Tenants',
  'Leases',
  'Billing',
  'Maintenance',
  'Staff',
  'Announcements',
  'Reports',
  'Documents',
] as const

const navIcons = [
  '⌂',
  '▦',
  '♙',
  '▤',
  '◈',
  '⚒',
  '♟',
  '◌',
  '↗',
  '□',
] as const

export default function DwellioShell({
  user,
  organizationId,
}: DwellioShellProps) {
  const navigate = useNavigate()
  const location = useLocation()

  const activeNav =
    location.pathname.startsWith('/billing')
      ? 'Billing'
      : 'Dashboard'

  const [organizationName, setOrganizationName] =
    useState('Your organization')

  const [notice, setNotice] =
    useState('')

  const firstName =
    user.user_metadata?.full_name?.split(' ')[0] ||
    user.email?.split('@')[0] ||
    'there'

  useEffect(() => {
    let alive = true

    async function loadOrganization() {
      const { data } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', organizationId)
        .maybeSingle()

      if (alive && data?.name) {
        setOrganizationName(data.name)
      }
    }

    void loadOrganization()

    return () => {
      alive = false
    }
  }, [organizationId])

  function handleNav(item: typeof navItems[number]) {
    setNotice('')

    if (item === 'Dashboard') {
      navigate('/')
      return
    }

    if (item === 'Billing') {
      navigate('/billing')
      return
    }

    setNotice(
      \`${'${item}'} is the next module — this dashboard keeps the navigation ready for it.\`,
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">d</div>

          <div className="brand-word">
            dwellio<span>.</span>
          </div>
        </div>

        <div className="workspace-label">
          WORKSPACE
        </div>

        <div className="workspace-card">
          <div className="workspace-avatar">
            {organizationName[0]?.toUpperCase() ?? 'D'}
          </div>

          <div className="workspace-copy">
            <strong>{organizationName}</strong>
            <span>Landlord workspace</span>
          </div>

          <span className="workspace-chevron">
            ⌄
          </span>
        </div>

        <nav
          className="main-nav"
          aria-label="Main navigation"
        >
          {navItems.map((item, index) => (
            <button
              key={item}
              className={\`nav-item ${'${activeNav === item ? \'active\' : \'\'}'}\`}
              onClick={() => handleNav(item)}
              type="button"
            >
              <span className="nav-icon">
                {navIcons[index]}
              </span>

              <span>{item}</span>

              {activeNav === item && (
                <span className="nav-live" />
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button
            className="nav-item"
            type="button"
            onClick={() =>
              setNotice(
                'Settings is the next module — this dashboard keeps the navigation ready for it.',
              )
            }
          >
            <span className="nav-icon">⚙</span>
            <span>Settings</span>
          </button>

          <button
            className="profile-mini"
            type="button"
            onClick={() =>
              void supabase.auth.signOut()
            }
          >
            <div className="avatar">
              {firstName[0].toUpperCase()}
            </div>

            <div>
              <strong>{firstName}</strong>
              <span>Sign out</span>
            </div>

            <span>↪</span>
          </button>
        </div>
      </aside>

      <main className="dashboard-main">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-word">
              dwellio<span>.</span>
            </span>
          </div>

          <div className="topbar-right">
            <button
              className="icon-button"
              aria-label="Search"
              type="button"
            >
              ⌕
            </button>

            <button
              className="icon-button notification-button"
              aria-label="Notifications"
              type="button"
            >
              ♢
              <span className="notification-dot" />
            </button>

            <div className="topbar-avatar">
              {firstName[0].toUpperCase()}
            </div>
          </div>
        </header>

        {notice && (
          <div className="dwellio-shell-notice-wrap">
            <div className="dashboard-notice">
              {notice}

              <button
                type="button"
                onClick={() => setNotice('')}
              >
                ×
              </button>
            </div>
          </div>
        )}

        <Suspense
          fallback={
            <PageSkeleton
              variant={
                activeNav === 'Billing'
                  ? 'billing'
                  : 'dashboard'
              }
            />
          }
        >
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}
`

fs.writeFileSync(appPath, app)
fs.writeFileSync(shellPath, shell)

let dashboard = fs.readFileSync(dashboardPath, 'utf8')

if (!dashboard.includes("from 'react-router-dom'")) {
  dashboard = dashboard.replace(
    "import type { User } from '@supabase/supabase-js'\n",
    "import type { User } from '@supabase/supabase-js'\nimport { useNavigate } from 'react-router-dom'\n",
  )
}

dashboard = dashboard.replace(
  "  const [activeNav, setActiveNav] =\n    useState('Dashboard')\n\n",
  '',
)

const dashboardComponentStart = `export default function DashboardPage({
  user,
}: DashboardPageProps) {
`
assert(dashboard.includes(dashboardComponentStart), 'Dashboard component start not found')
dashboard = dashboard.replace(
  dashboardComponentStart,
  `${dashboardComponentStart}  const navigate = useNavigate()\n\n`,
)

dashboard = dashboard.replace(
  '      window.location.href = item.href',
  '      navigate(item.href)',
)

const dashboardReturnStart = dashboard.indexOf('  return (\n    <div className="app-shell">')
const dashboardContentStart = dashboard.indexOf('        <div className="dashboard-content">', dashboardReturnStart)
const dashboardEndMarker = '        </div>\n      </main>\n    </div>\n  )\n}\n\nfunction MetricCard'
const dashboardEnd = dashboard.indexOf(dashboardEndMarker, dashboardContentStart)
assert(dashboardReturnStart >= 0, 'Dashboard return start not found')
assert(dashboardContentStart >= 0, 'Dashboard content start not found')
assert(dashboardEnd >= 0, 'Dashboard content end not found')

const dashboardContent = dashboard.slice(
  dashboardContentStart,
  dashboardEnd + '        </div>'.length,
)

const dashboardHelpers = dashboard.slice(
  dashboardEnd + '        </div>\n      </main>\n    </div>\n  )\n}\n\n'.length,
)

dashboard =
  dashboard.slice(0, dashboardReturnStart)
  + '  return (\n'
  + dashboardContent
  + '\n  )\n}\n\n'
  + dashboardHelpers

fs.writeFileSync(dashboardPath, dashboard)

let billing = fs.readFileSync(billingPath, 'utf8')

billing = billing.replace('  fetchWorkspaceIdentity,\n', '')
billing = billing.replace('  WorkspaceIdentity,\n', '')

if (!billing.includes("../components/loading/PageSkeleton")) {
  const typesImportEnd = "} from '../features/billing/data/types'\n"
  billing = billing.replace(
    typesImportEnd,
    `${typesImportEnd}\nimport PageSkeleton from '../components/loading/PageSkeleton'\n`,
  )
}

const identityStart = billing.indexOf('  const [\n    identity,')
const dashboardStateStart = billing.indexOf('  const [\n    dashboard,', identityStart)
assert(identityStart >= 0 && dashboardStateStart > identityStart, 'Billing identity state block not found')
billing = billing.slice(0, identityStart) + billing.slice(dashboardStateStart)

const propertyLoadStart = billing.indexOf('        const [\n          cycleRows,\n          workspace,')
const identitySetEndMarker = '        setIdentity(\n          workspace,\n        )\n'
const identitySetEnd = billing.indexOf(identitySetEndMarker, propertyLoadStart)
assert(propertyLoadStart >= 0 && identitySetEnd >= 0, 'Billing workspace property load block not found')

const propertyLoadReplacement = `        const cycleRows =
          await fetchBillingCycles(
            property!.id,
          )


        setCycles(
          cycleRows,
        )
`

billing =
  billing.slice(0, propertyLoadStart)
  + propertyLoadReplacement
  + billing.slice(identitySetEnd + identitySetEndMarker.length)

const loadingStart = billing.indexOf('  if (\n    loading &&\n    properties.length === 0')
const billingReturnStart = billing.indexOf('  return (\n    <div\n      className="', loadingStart)
assert(loadingStart >= 0 && billingReturnStart > loadingStart, 'Billing loading/return boundary not found')

billing =
  billing.slice(0, loadingStart)
  + `  if (
    loading &&
    properties.length === 0
  ) {
    return (
      <PageSkeleton variant="billing" />
    )
  }


`
  + billing.slice(billingReturnStart)

const returnStart = billing.indexOf('  return (\n    <div\n      className="', loadingStart)
const mainStart = billing.indexOf('        <main\n', returnStart)
const mainEndMarker = '\n        </main>'
const mainEndStart = billing.indexOf(mainEndMarker, mainStart)
assert(returnStart >= 0 && mainStart >= 0 && mainEndStart >= 0, 'Billing main content boundaries not found')
const mainEnd = mainEndStart + mainEndMarker.length

const drawerStart = billing.indexOf('      {/* DRAFT DRAWER */}', mainEnd)
const workflowStart = billing.indexOf('\n\n\n\nfunction WorkflowRail', drawerStart)
const outerClose = billing.lastIndexOf('\n\n    </div>\n  )\n}', workflowStart)
assert(drawerStart >= 0 && workflowStart >= 0 && outerClose >= 0, 'Billing drawer/outer boundaries not found')

const billingMain = billing.slice(mainStart, mainEnd)
const billingDrawer = billing.slice(drawerStart, outerClose)
const billingHelpers = billing.slice(workflowStart)

billing =
  billing.slice(0, returnStart)
  + `  return (
    <div
      className="
        billing-page
        min-h-[calc(100vh-68px)]
        bg-[#edfdf3]
        font-['Manrope']
        text-[#111e19]
      "
    >
`
  + billingMain
  + '\n\n'
  + billingDrawer
  + '\n    </div>\n  )\n}\n'
  + billingHelpers

const sidebarFunctionStart = billing.indexOf('\n\n\n\nfunction DwellioSidebar({')
assert(sidebarFunctionStart >= 0, 'Legacy Billing DwellioSidebar function not found')
billing = billing.slice(0, sidebarFunctionStart).trimEnd() + '\n'

fs.writeFileSync(billingPath, billing)

if (fs.existsSync(selfPath)) fs.unlinkSync(selfPath)
if (fs.existsSync(workflowPath)) fs.unlinkSync(workflowPath)

console.log('Converted Dashboard/Billing to content-only nested routes.')
