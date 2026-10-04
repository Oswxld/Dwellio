import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import {
  getDashboardProperties,
  getDashboardSummary,
} from '../lib/dashboard'
import type {
  DashboardProperty,
  DashboardSummary,
} from '../types/dashboard'

type DashboardPageProps = {
  user: User
}

type AttentionItem = {
  tone: 'danger' | 'warning' | 'info'
  title: string
  description: string
  action: string
  onClick?: () => void
}

type QuickAddItem = {
  label: string
  description: string
  enabled: boolean
  href?: string
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-KE').format(value)
}

function formatDate(dateString: string) {
  return new Intl.DateTimeFormat('en-KE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(dateString))
}

function getGreeting() {
  const hour = new Date().getHours()

  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'

  return 'Good evening'
}

export default function DashboardPage({
  user,
}: DashboardPageProps) {
  const [summary, setSummary] =
    useState<DashboardSummary | null>(null)

  const [properties, setProperties] =
    useState<DashboardProperty[]>([])

  const [loading, setLoading] = useState(true)

  const [error, setError] =
    useState<string | null>(null)

  const [activeNav, setActiveNav] =
    useState('Dashboard')

  const [notice, setNotice] = useState('')

  const [quickAddOpen, setQuickAddOpen] =
    useState(false)

  useEffect(() => {
    let alive = true

    async function load() {
      setLoading(true)
      setError(null)

      const {
        data: membership,
        error: membershipError,
      } = await supabase
        .from('organization_members')
        .select(
          'organization_id, organizations!inner(id, name)',
        )
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('joined_at', {
          ascending: true,
        })
        .limit(1)
        .maybeSingle()

      if (membershipError) {
        if (alive) {
          setError(membershipError.message)
        }

        setLoading(false)
        return
      }

      const organizationId =
        membership?.organization_id as
          | string
          | undefined

      if (!organizationId) {
        if (alive) {
          setError(
            'No active organization was found for this account.',
          )
        }

        setLoading(false)
        return
      }

      try {
        const [
          nextSummary,
          nextProperties,
        ] = await Promise.all([
          getDashboardSummary(organizationId),
          getDashboardProperties(organizationId),
        ])

        if (alive) {
          setSummary(nextSummary)
          setProperties(nextProperties)
        }
      } catch (loadError) {
        if (alive) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Unable to load dashboard.',
          )
        }
      } finally {
        if (alive) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      alive = false
    }
  }, [user.id])

  const occupancy = useMemo(() => {
    if (!summary || summary.unit_count === 0) {
      return 0
    }

    return Math.round(
      (summary.occupied_units /
        summary.unit_count) *
        100,
    )
  }, [summary])

  const attentionItems: AttentionItem[] =
    useMemo(() => {
      if (!summary) return []

      const items: AttentionItem[] = []

      /*
       * --------------------------------------------------
       * PROPERTY SETUP ATTENTION
       * --------------------------------------------------
       */

      if (summary.property_count === 0) {
        items.push({
          tone: 'danger',
          title: 'No property has been added',
          description:
            'Add a property before tenants, leases and billing can be managed.',
          action: 'Add property',
        })
      }

      if (
        summary.unit_count === 0 &&
        summary.property_count > 0
      ) {
        items.push({
          tone: 'warning',
          title:
            'Your property has no units yet',
          description:
            'Complete the building, floor and unit setup to start onboarding tenants.',
          action: 'Configure units',
        })
      }

      if (summary.unavailable_units > 0) {
        items.push({
          tone: 'warning',
          title: `${formatNumber(
            summary.unavailable_units,
          )} unit${
            summary.unavailable_units === 1
              ? ''
              : 's'
          } unavailable`,
          description:
            'Review units marked unavailable before assigning new tenants.',
          action: 'Review units',
        })
      }

      /*
       * --------------------------------------------------
       * LEASE ATTENTION
       * --------------------------------------------------
       */

      summary.pending_confirmation.forEach(
        lease => {
          items.push({
            tone: 'warning',
            title: `${lease.tenant_name} hasn't confirmed their lease`,
            description: `Unit ${
              lease.unit_name
            } is waiting for tenant acceptance. Lease starts ${formatDate(
              lease.start_date,
            )}.`,
            action: 'Review lease',
          })
        },
      )

      summary.expiring_soon.forEach(
        lease => {
          const days =
            lease.days_remaining

          items.push({
            tone: days <= 7 ? 'danger' : 'warning',
            title: `${lease.tenant_name}'s lease expires soon`,
            description:
              days === 0
                ? `The lease for unit ${lease.unit_name} expires today.`
                : `The lease for unit ${lease.unit_name} expires in ${days} day${
                    days === 1 ? '' : 's'
                  } on ${formatDate(
                    lease.end_date,
                  )}.`,
            action: 'Review lease',
          })
        },
      )

      summary.renewal_pending.forEach(
        request => {
          items.push({
            tone: 'info',
            title: `${request.tenant_name}'s renewal is awaiting response`,
            description: `Unit ${
              request.unit_name
            } has a pending renewal request ending ${formatDate(
              request.proposed_end_date,
            )}.`,
            action: 'Review renewal',
          })
        },
      )

      /*
       * --------------------------------------------------
       * DEFAULT STATE
       * --------------------------------------------------
       */

      if (items.length === 0) {
        items.push({
          tone: 'info',
          title:
            'Property setup is looking good',
          description:
            'Your core property structure and lease activity are looking good.',
          action: 'Continue setup',
        })
      }

      return items
    }, [summary])

  const quickAddItems: QuickAddItem[] =
    useMemo(
      () => [
        {
          label: 'Add tenant',
          description:
            'Create a tenant and start a lease',
          enabled: true,
          href: '/tenants/new',
        },
        {
          label: 'Add organization member',
          description:
            'Invite someone to your Dwellio workspace',
          enabled: false,
        },
        {
          label: 'Add building',
          description:
            'Create a building under a property',
          enabled: false,
        },
        {
          label: 'Add floor',
          description:
            'Create a floor inside a building',
          enabled: false,
        },
        {
          label: 'Add units',
          description:
            'Create units for a floor',
          enabled: false,
        },
      ],
      [],
    )

  const firstName =
    user.user_metadata?.full_name?.split(
      ' ',
    )[0] ||
    user.email?.split('@')[0] ||
    'there'

  function handleQuickAdd(item: QuickAddItem) {
    if (!item.enabled) {
      return
    }

    if (item.href) {
      window.location.href = item.href
    }
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
            {(
              summary?.organization_name?.[0] ??
              'D'
            ).toUpperCase()}
          </div>

          <div className="workspace-copy">
            <strong>
              {summary?.organization_name ??
                'Your organization'}
            </strong>

            <span>
              Landlord workspace
            </span>
          </div>

          <span className="workspace-chevron">
            ⌄
          </span>
        </div>

        <nav
          className="main-nav"
          aria-label="Main navigation"
        >
          {[
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
          ].map((item, index) => (
            <button
              key={item}
              className={`nav-item ${
                activeNav === item
                  ? 'active'
                  : ''
              }`}
              onClick={() => {
                setActiveNav(item)

                if (item !== 'Dashboard') {
                  setNotice(
                    `${item} is the next module — this dashboard keeps the navigation ready for it.`,
                  )
                } else {
                  setNotice('')
                }
              }}
              type="button"
            >
              <span className="nav-icon">
                {
                  [
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
                  ][index]
                }
              </span>

              <span>{item}</span>

              {item === 'Dashboard' && (
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
              setActiveNav('Settings')
            }
          >
            <span className="nav-icon">
              ⚙
            </span>

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

        <div className="dashboard-content">
          <section className="welcome-row">
            <div>
              <div className="eyebrow">
                LANDLORD OVERVIEW
              </div>

              <h1>
                {getGreeting()}, {firstName}
                <span className="heading-dot">
                  .
                </span>
              </h1>

              <p>
                Here’s what needs your attention
                across your property portfolio.
              </p>
            </div>

            <div className="welcome-actions">
              <div className="quick-add-wrapper">
                <button
                  className="quick-add-button"
                  type="button"
                  aria-expanded={
                    quickAddOpen
                  }
                  onClick={() =>
                    setQuickAddOpen(
                      previous =>
                        !previous,
                    )
                  }
                >
                  <span>＋</span>
                  Add
                </button>

                {quickAddOpen && (
                  <div className="quick-add-menu">
                    <div className="quick-add-menu-header">
                      <strong>
                        Create new
                      </strong>

                      <button
                        type="button"
                        aria-label="Close add menu"
                        onClick={() =>
                          setQuickAddOpen(
                            false,
                          )
                        }
                      >
                        ×
                      </button>
                    </div>

                    <div className="quick-add-list">
                      {quickAddItems.map(
                        item => (
                          <button
                            key={item.label}
                            type="button"
                            className={`quick-add-item ${
                              item.enabled
                                ? ''
                                : 'disabled'
                            }`}
                            disabled={
                              !item.enabled
                            }
                            onClick={() =>
                              handleQuickAdd(
                                item,
                              )
                            }
                          >
                            <span className="quick-add-item-icon">
                              {item.enabled
                                ? '+'
                                : '·'}
                            </span>

                            <span className="quick-add-item-copy">
                              <strong>
                                {item.label}
                              </strong>

                              <small>
                                {
                                  item.description
                                }
                              </small>
                            </span>
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="date-pill">
                <span>◷</span>

                {new Intl.DateTimeFormat(
                  'en-KE',
                  {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'short',
                  },
                ).format(new Date())}
              </div>
            </div>
          </section>

          {error && (
            <div className="dashboard-alert">
              {error}
            </div>
          )}

          {notice && (
            <div className="dashboard-notice">
              {notice}

              <button
                type="button"
                onClick={() =>
                  setNotice('')
                }
              >
                ×
              </button>
            </div>
          )}

          <section className="attention-section">
            <div className="section-heading">
              <div>
                <span className="section-kicker danger-kicker">
                  PRIORITY
                </span>

                <h2>Needs attention</h2>
              </div>

              <span className="attention-count">
                {attentionItems.length}{' '}
                item
                {attentionItems.length ===
                1
                  ? ''
                  : 's'}
              </span>
            </div>

            <div className="attention-grid">
              {loading ? (
                <div className="loading-card">
                  <div className="skeleton-line wide" />
                  <div className="skeleton-line" />
                </div>
              ) : (
                attentionItems.map(
                  item => (
                    <button
                      className={`attention-card ${item.tone}`}
                      key={`${item.title}-${item.description}`}
                      type="button"
                      onClick={
                        item.onClick
                      }
                    >
                      <div className="attention-symbol">
                        {item.tone ===
                        'danger'
                          ? '!'
                          : item.tone ===
                            'warning'
                          ? '△'
                          : '✓'}
                      </div>

                      <div className="attention-copy">
                        <strong>
                          {item.title}
                        </strong>

                        <span>
                          {
                            item.description
                          }
                        </span>
                      </div>

                      <span className="attention-action">
                        {item.action}{' '}
                        <b>→</b>
                      </span>
                    </button>
                  ),
                )
              )}
            </div>
          </section>

          <section className="metric-grid">
            <MetricCard
              label="Expected this month"
              value="—"
              sub="Billing module not connected"
              icon="◈"
              muted
            />

            <MetricCard
              label="Collected"
              value="—"
              sub="Billing module not connected"
              icon="↗"
              muted
            />

            <MetricCard
              label="Outstanding"
              value="—"
              sub="Billing module not connected"
              icon="!"
              muted
            />

            <MetricCard
              label="Occupancy"
              value={
                loading
                  ? '—'
                  : `${occupancy}%`
              }
              sub={
                loading
                  ? 'Loading property data'
                  : `${formatNumber(
                      summary?.occupied_units ??
                        0,
                    )} of ${formatNumber(
                      summary?.unit_count ??
                        0,
                    )} units occupied`
              }
              icon="▦"
            />
          </section>

          <div className="dashboard-columns">
            <section className="dashboard-card occupancy-card">
              <div className="card-heading">
                <div>
                  <span className="section-kicker">
                    PROPERTY
                  </span>

                  <h2>
                    Occupancy overview
                  </h2>
                </div>

                <button
                  className="ghost-button"
                  type="button"
                >
                  View properties →
                </button>
              </div>

              <div className="occupancy-body">
                <div
                  className="occupancy-ring"
                  style={
                    {
                      '--progress': `${occupancy}%`,
                    } as CSSProperties
                  }
                >
                  <div>
                    <strong>
                      {loading
                        ? '—'
                        : `${occupancy}%`}
                    </strong>

                    <span>
                      occupied
                    </span>
                  </div>
                </div>

                <div className="occupancy-stats">
                  <StatusRow
                    label="Occupied"
                    value={
                      summary?.occupied_units ??
                      0
                    }
                    className="occupied"
                  />

                  <StatusRow
                    label="Vacant"
                    value={
                      summary?.vacant_units ??
                      0
                    }
                    className="vacant"
                  />

                  <StatusRow
                    label="Reserved"
                    value={
                      summary?.reserved_units ??
                      0
                    }
                    className="reserved"
                  />

                  <StatusRow
                    label="Maintenance"
                    value={
                      summary?.maintenance_units ??
                      0
                    }
                    className="maintenance"
                  />
                </div>
              </div>
            </section>

            <section className="dashboard-card property-card">
              <div className="card-heading">
                <div>
                  <span className="section-kicker">
                    PORTFOLIO
                  </span>

                  <h2>
                    Your properties
                  </h2>
                </div>

                <span className="small-count">
                  {formatNumber(
                    summary?.property_count ??
                      0,
                  )}
                </span>
              </div>

              <div className="property-list">
                {loading ? (
                  <div className="property-skeleton" />
                ) : properties.length ===
                  0 ? (
                  <EmptyState
                    title="No properties yet"
                    text="Your properties will appear here."
                  />
                ) : (
                  properties.map(
                    property => (
                      <div
                        className="property-row"
                        key={property.id}
                      >
                        <div className="property-avatar">
                          {property.name[0].toUpperCase()}
                        </div>

                        <div>
                          <strong>
                            {
                              property.name
                            }
                          </strong>

                          <span>
                            {property.address ||
                              property.city ||
                              property.county ||
                              'Location not added'}
                          </span>
                        </div>

                        <span className="property-arrow">
                          →
                        </span>
                      </div>
                    ),
                  )
                )}
              </div>
            </section>
          </div>

          <div className="dashboard-columns lower">
            <ModuleCard
              icon="⚒"
              kicker="MAINTENANCE"
              title="Maintenance"
              description="Tickets, assignments, response times and resolutions will appear here once the maintenance module is connected."
            />

            <ModuleCard
              icon="▤"
              kicker="LEASES"
              title="Lease activity"
              description="Track active leases, upcoming expiries and pending signatures from one place."
            />
          </div>

          <section className="dashboard-card activity-card">
            <div className="card-heading">
              <div>
                <span className="section-kicker">
                  OPERATIONS
                </span>

                <h2>
                  Activity & communication
                </h2>
              </div>

              <button
                className="ghost-button"
                type="button"
              >
                View activity →
              </button>
            </div>

            <div className="activity-grid">
              <ModuleMini
                icon="♙"
                title="Tenants"
                text="Tenant activity will appear here after tenant management is connected."
              />

              <ModuleMini
                icon="♟"
                title="Staff"
                text={`${formatNumber(
                  summary?.staff_count ?? 0,
                )} active organization member${
                  summary?.staff_count === 1
                    ? ''
                    : 's'
                }.`}
              />

              <ModuleMini
                icon="◌"
                title="Announcements"
                text="Publish property-wide or organization-wide announcements here."
              />

              <ModuleMini
                icon="↗"
                title="Reports"
                text="Collection, occupancy and maintenance trends will appear here."
              />
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}

function MetricCard({
  label,
  value,
  sub,
  icon,
  muted = false,
}: {
  label: string
  value: string
  sub: string
  icon: string
  muted?: boolean
}) {
  return (
    <article
      className={`metric-card ${
        muted ? 'muted-metric' : ''
      }`}
    >
      <div className="metric-top">
        <span>{label}</span>
        <i>{icon}</i>
      </div>

      <strong>{value}</strong>

      <small>{sub}</small>
    </article>
  )
}

function StatusRow({
  label,
  value,
  className,
}: {
  label: string
  value: number
  className: string
}) {
  return (
    <div className="status-row">
      <span>
        <i className={className} />
        {label}
      </span>

      <strong>
        {formatNumber(value)}
      </strong>
    </div>
  )
}

function ModuleCard({
  icon,
  kicker,
  title,
  description,
}: {
  icon: string
  kicker: string
  title: string
  description: string
}) {
  return (
    <section className="dashboard-card module-card">
      <div className="module-icon">
        {icon}
      </div>

      <span className="section-kicker">
        {kicker}
      </span>

      <h2>{title}</h2>

      <p>{description}</p>

      <span className="coming-soon">
        Core module
      </span>
    </section>
  )
}

function ModuleMini({
  icon,
  title,
  text,
}: {
  icon: string
  title: string
  text: string
}) {
  return (
    <div className="module-mini">
      <div className="mini-icon">
        {icon}
      </div>

      <div>
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
    </div>
  )
}

function EmptyState({
  title,
  text,
}: {
  title: string
  text: string
}) {
  return (
    <div className="empty-state">
      <span>＋</span>
      <strong>{title}</strong>
      <small>{text}</small>
    </div>
  )
}