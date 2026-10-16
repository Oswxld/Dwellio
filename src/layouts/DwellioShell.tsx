import { Suspense, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import PageSkeleton from '../components/loading/PageSkeleton'

type Props = { user: User; organizationId: string }
const navItems = [
  { label: 'Dashboard', icon: '⌂', href: '/' },
  { label: 'Properties', icon: '▦', href: '/properties' },
  { label: 'Tenants', icon: '♙', href: '/tenants' },
  { label: 'Billing', icon: '◈', href: '/billing' },
] as const

export default function DwellioShell({user, organizationId}: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  const [organizationName, setOrganizationName] = useState('Your organization')
  const [mobileOpen, setMobileOpen] = useState(false)

  const activeNav = location.pathname.startsWith('/settings/payments')
    ? 'Payment Settings'
    : location.pathname.startsWith('/billing') ? 'Billing'
    : location.pathname.startsWith('/properties') ? 'Properties'
    : location.pathname.startsWith('/tenants') ? 'Tenants'
    : 'Dashboard'

  const firstName = user.user_metadata?.full_name?.split(' ')[0] ||
    user.email?.split('@')[0] || 'there'

  useEffect(() => {
    let alive = true
    void supabase.from('organizations').select('name').eq('id', organizationId)
      .maybeSingle()
      .then(({data}) => {
        if (alive && data?.name) setOrganizationName(data.name)
      })
    return () => { alive = false }
  }, [organizationId])

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname, location.search])

  function go(href: string) {
    setMobileOpen(false)
    navigate(href)
  }

  return (
    <div className="app-shell">
      {mobileOpen && <button
        type="button" aria-label="Close navigation"
        className="mobile-nav-backdrop" onClick={() => setMobileOpen(false)}/>}
      <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark">d</div>
          <div className="brand-word">dwellio<span>.</span></div>
          <button type="button" className="mobile-nav-close"
            aria-label="Close menu" onClick={() => setMobileOpen(false)}>×</button>
        </div>

        <div className="workspace-label">WORKSPACE</div>
        <div className="workspace-card">
          <div className="workspace-avatar">{organizationName[0]?.toUpperCase() ?? 'D'}</div>
          <div className="workspace-copy">
            <strong>{organizationName}</strong>
            <span>Landlord workspace</span>
          </div>
        </div>

        <nav className="main-nav" aria-label="Main navigation">
          {navItems.map(item => (
            <button type="button" key={item.label}
              className={`nav-item ${activeNav === item.label ? 'active' : ''}`}
              onClick={() => go(item.href)}>
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
              {activeNav === item.label && <span className="nav-live"/>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button className={`nav-item ${activeNav === 'Payment Settings'?'active':''}`}
            type="button" onClick={() => go('/settings/payments')}>
            <span className="nav-icon">⚙</span><span>Payment Settings</span>
          </button>
          <button type="button" className="profile-mini"
            onClick={() => void supabase.auth.signOut()}>
            <div className="avatar">{firstName[0]?.toUpperCase() ?? 'D'}</div>
            <div><strong>{firstName}</strong><span>Sign out</span></div>
            <span>↪</span>
          </button>
        </div>
      </aside>

      <main className="dashboard-main">
        <header className="topbar">
          <button className="mobile-menu-toggle" type="button"
            aria-label="Open navigation" aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)}>☰</button>
          <div className="mobile-brand">
            <span className="brand-word">dwellio<span>.</span></span>
          </div>
          <span className="topbar-page-label">{activeNav}</span>
          <div className="topbar-right">
            <div className="topbar-avatar" aria-label={`Signed in as ${firstName}`}>
              {firstName[0]?.toUpperCase() ?? 'D'}
            </div>
          </div>
        </header>
        <Suspense fallback={<PageSkeleton variant={activeNav === 'Billing' ? 'billing' : 'dashboard'}/>}>
          <Outlet/>
        </Suspense>
      </main>
    </div>
  )
}
