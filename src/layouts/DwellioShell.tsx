import {
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
      `${item} is the next module — this dashboard keeps the navigation ready for it.`,
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
              className={`nav-item ${activeNav === item ? 'active' : ''}`}
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
